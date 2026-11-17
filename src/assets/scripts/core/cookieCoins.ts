/**
 * Operation Cookie - Global Cookie Coins Currency, Game Studios & Leaderboards
 * (Strictly real user data — no fake players)
 */

import {
  batchedLocalStorageGet,
  batchedLocalStorageSet,
} from "./chromebookMode.ts";

export interface StudioProfile {
  id: string;
  name: string;
  tagline: string;
  owner: string;
  color: string;
  icon: string;
  coinsEarned: number;
  unclaimedCoins: number;
  createdAt: string;
}

export interface LeaderboardEntry {
  username: string;
  seconds: number;
  plays: number;
  highScore: number;
  lastPlayed: string;
}

const COINS_STORAGE_KEY = "cookie_coins_balance_v1";
const STUDIO_STORAGE_KEY = "cookie_user_studio_v1";
const LEADERBOARD_STORAGE_KEY = "cookie_game_leaderboards_v2";
const AD_FREE_UNTIL_KEY = "sunshine_ad_free_until";
export const COOKIE_MASTER_STORAGE_KEY = "cookie_master_status_v1";
export const COOKIE_MASTER_DAILY_COINS = 1000;
const DAILY_CLAIM_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface CookieMasterState {
  active: boolean;
  licenseKey: string;
  subscriptionId?: string;
  status?: string;
  email?: string;
  verifiedAt: number;
  expiresAt?: number;
  cancelledAt?: string | null;
  lastDailyClaimAt: number;
}

export function getCookieMasterState(): CookieMasterState | null {
  try {
    const raw = localStorage.getItem(COOKIE_MASTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      active: parsed.active === true,
      licenseKey: typeof parsed.licenseKey === "string" ? parsed.licenseKey : "",
      subscriptionId: typeof parsed.subscriptionId === "string" ? parsed.subscriptionId : undefined,
      status: typeof parsed.status === "string" ? parsed.status : undefined,
      email: typeof parsed.email === "string" ? parsed.email : undefined,
      verifiedAt: Number(parsed.verifiedAt) || 0,
      expiresAt: Number(parsed.expiresAt) || 0,
      cancelledAt: typeof parsed.cancelledAt === "string" ? parsed.cancelledAt : null,
      lastDailyClaimAt: Number(parsed.lastDailyClaimAt) || 0,
    };
  } catch {
    return null;
  }
}

export function isCookieMasterActive(): boolean {
  const st = getCookieMasterState();
  if (!st?.active) return false;
  if (st.expiresAt && st.expiresAt > 0 && st.expiresAt <= Date.now()) return false;
  return true;
}

export function setCookieMasterState(next: CookieMasterState | null): void {
  try {
    if (!next) {
      localStorage.removeItem(COOKIE_MASTER_STORAGE_KEY);
    } else {
      localStorage.setItem(COOKIE_MASTER_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {}
  syncAdFreeDomClass();
  try {
    window.dispatchEvent(new CustomEvent("cookie-master-changed", { detail: next }));
    window.dispatchEvent(
      new CustomEvent("sunshine-ad-free-changed", {
        detail: { until: getAdFreeUntil(), masterActive: Boolean(next?.active) },
      }),
    );
  } catch {}
}

export function getNextDailyClaimRemainingMs(): number {
  const st = getCookieMasterState();
  if (!st?.active) return DAILY_CLAIM_INTERVAL_MS;
  if (!st.lastDailyClaimAt) return 0;
  return Math.max(0, st.lastDailyClaimAt + DAILY_CLAIM_INTERVAL_MS - Date.now());
}

export function canClaimDailyMasterCoins(): boolean {
  const st = getCookieMasterState();
  return Boolean(st?.active) && getNextDailyClaimRemainingMs() === 0;
}

export function formatDurationCompact(ms: number): string {
  const diff = Math.max(0, ms);
  if (diff <= 0) return "ready now";
  const totalMins = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function claimDailyMasterCoins(): {
  claimed: boolean;
  amount: number;
  nextBalance: number;
  remainingMs: number;
} {
  const st = getCookieMasterState();
  if (!st?.active) {
    return {
      claimed: false,
      amount: 0,
      nextBalance: getCookieCoins(),
      remainingMs: DAILY_CLAIM_INTERVAL_MS,
    };
  }
  const remaining = getNextDailyClaimRemainingMs();
  if (remaining > 0) {
    return {
      claimed: false,
      amount: 0,
      nextBalance: getCookieCoins(),
      remainingMs: remaining,
    };
  }
  const nextBalance = addCookieCoins(COOKIE_MASTER_DAILY_COINS, "cookie master daily coins");
  setCookieMasterState({
    ...st,
    lastDailyClaimAt: Date.now(),
  });
  return {
    claimed: true,
    amount: COOKIE_MASTER_DAILY_COINS,
    nextBalance,
    remainingMs: DAILY_CLAIM_INTERVAL_MS,
  };
}

export function getAdFreeUntil(): number {
  try {
    const raw = localStorage.getItem(AD_FREE_UNTIL_KEY);
    const ts = raw ? Number(raw) : 0;
    return Number.isFinite(ts) && ts > Date.now() ? ts : 0;
  } catch {
    return 0;
  }
}

export function isAdFreeActive(): boolean {
  return isCookieMasterActive() || getAdFreeUntil() > Date.now();
}

export function syncAdFreeDomClass(): void {
  try {
    document.documentElement.classList.toggle("sunshine-ad-free", isAdFreeActive());
  } catch {}
}

export function activateAdFreePass(durationMs: number): number {
  const base = Math.max(getAdFreeUntil(), Date.now());
  const nextUntil = base + Math.max(0, Math.floor(durationMs));
  try {
    localStorage.setItem(AD_FREE_UNTIL_KEY, String(nextUntil));
  } catch {}
  syncAdFreeDomClass();
  try {
    window.dispatchEvent(
      new CustomEvent("sunshine-ad-free-changed", { detail: { until: nextUntil } }),
    );
  } catch {}
  return nextUntil;
}

export function formatAdFreeRemaining(untilMs: number): string {
  const diff = Math.max(0, untilMs - Date.now());
  if (diff <= 0) return "expired";
  const totalMins = Math.ceil(diff / 60000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

const NON_GAME_WEBSITE_PATTERNS = [
  /^https?:\/\//i,
  /^www\./i,
  /\.(com|org|net|edu|gov|mil|co|uk|ca|de|jp|fr|au|ru|ch|it|nl|se|no|es|me|tv|gg|ai|app|dev|xyz)(\/|$|\s)/i,
  /^(new tab|untitled|fetching data\.\.\.|fetching lesson\.\.\.|about:blank|operation cookie|browsing)$/i,
  /\b(duckduckgo|google|bing|yahoo|youtube|tiktok|discord|soundcloud|spotify|netflix|reddit|instagram|twitter|x\.com|snapchat|pinterest|crunchyroll|wikipedia|github|twitch)\b/i,
];

export function isWebsiteNotGame(rawName: string | null | undefined): boolean {
  const s = (rawName || "").trim().toLowerCase();
  if (!s || s.length > 80) return true;
  // Allow known .lol / .io games
  if (/\b(1v1\.lol|[a-z0-9-]+\.io)\b/i.test(s) && !/^https?:\/\//i.test(s)) {
    return false;
  }
  return NON_GAME_WEBSITE_PATTERNS.some((re) => re.test(s));
}

export function pruneWebsiteStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const rawLb = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    if (rawLb) {
      const all: Record<string, LeaderboardEntry[]> = JSON.parse(rawLb);
      let changed = false;
      for (const k of Object.keys(all)) {
        if (isWebsiteNotGame(k)) {
          delete all[k];
          changed = true;
        }
      }
      if (changed) {
        localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(all));
      }
    }
    // Also remove legacy v1 leaderboard key if present
    localStorage.removeItem("cookie_game_leaderboards_v1");
  } catch {}
}

if (typeof window !== "undefined") {
  pruneWebsiteStorage();
}

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

export function getActiveUser(): string {
  try {
    const raw = localStorage.getItem("auth_user");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.username === "string" && parsed.username.trim()) {
        return parsed.username.trim();
      }
    }
  } catch {}
  return "guest";
}

export function getCookieCoins(): number {
  try {
    const raw = batchedLocalStorageGet(COINS_STORAGE_KEY);
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return Math.max(0, n);
    }
    batchedLocalStorageSet(COINS_STORAGE_KEY, "150");
    return 150;
  } catch {
    return 150;
  }
}

export function setCookieCoins(nextBalance: number): number {
  const clean = Math.max(0, Math.floor(nextBalance));
  try {
    batchedLocalStorageSet(COINS_STORAGE_KEY, String(clean));
  } catch {}
  window.dispatchEvent(new CustomEvent("cookie-coins-updated", { detail: { balance: clean } }));
  return clean;
}

export function addCookieCoins(amount: number, toastReason?: string): number {
  const current = getCookieCoins();
  const next = setCookieCoins(current + Math.max(0, Math.floor(amount)));
  if (toastReason && amount > 0) {
    notifyToast(`+${Math.floor(amount)} cookie coins · ${toastReason}`, "success");
  }
  return next;
}

export function spendCookieCoins(cost: number): boolean {
  const cleanCost = Math.max(0, Math.floor(cost));
  const current = getCookieCoins();
  if (current < cleanCost) return false;
  setCookieCoins(current - cleanCost);
  return true;
}

export function getUserStudio(): StudioProfile {
  const owner = getActiveUser();
  try {
    const raw = localStorage.getItem(STUDIO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.name === "string") {
        return parsed as StudioProfile;
      }
    }
  } catch {}

  const defaultStudio: StudioProfile = {
    id: `studio_${owner.toLowerCase()}`,
    name: `${owner}'s studio`,
    tagline: "building web games on operation cookie",
    owner,
    color: "#3b82f6",
    icon: "fa-rocket",
    coinsEarned: 0,
    unclaimedCoins: 0,
    createdAt: new Date().toISOString(),
  };
  return defaultStudio;
}

export function saveUserStudio(studio: StudioProfile): StudioProfile {
  try {
    localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(studio));
  } catch {}
  window.dispatchEvent(new CustomEvent("cookie-studio-updated", { detail: { studio } }));
  fetch("/api/studio/studios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studio }),
  }).catch(() => {});
  return studio;
}

export function formatPlayTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function getLocalLeaderboard(gameName: string): LeaderboardEntry[] {
  const key = (gameName || "").trim().toLowerCase();
  if (!key || isWebsiteNotGame(key)) return [];
  try {
    const raw = batchedLocalStorageGet(LEADERBOARD_STORAGE_KEY);
    const all: Record<string, LeaderboardEntry[]> = raw ? JSON.parse(raw) : {};
    const list = all[key] || [];
    return [...list].sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);
  } catch {
    return [];
  }
}

export function recordLocalGameTick(
  gameName: string,
  addSeconds = 1,
  addPlay = 0,
  score = 0
): LeaderboardEntry[] {
  const key = (gameName || "").trim().toLowerCase();
  if (!key || isWebsiteNotGame(key)) return [];
  const username = getActiveUser();
  const userLower = username.toLowerCase();

  try {
    const raw = batchedLocalStorageGet(LEADERBOARD_STORAGE_KEY);
    const all: Record<string, LeaderboardEntry[]> = raw ? JSON.parse(raw) : {};
    const list: LeaderboardEntry[] = all[key] || [];

    const existingIdx = list.findIndex((e) => e.username.toLowerCase() === userLower);
    if (existingIdx >= 0) {
      list[existingIdx].seconds += Math.max(0, addSeconds);
      list[existingIdx].plays += Math.max(0, addPlay);
      if (score > list[existingIdx].highScore) list[existingIdx].highScore = score;
      list[existingIdx].lastPlayed = new Date().toISOString();
    } else {
      list.push({
        username,
        seconds: Math.max(0, addSeconds),
        plays: Math.max(1, addPlay),
        highScore: Math.max(0, score),
        lastPlayed: new Date().toISOString(),
      });
    }

    list.sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);
    all[key] = list;
    batchedLocalStorageSet(LEADERBOARD_STORAGE_KEY, JSON.stringify(all));
    return [...list];
  } catch {
    return [];
  }
}

export async function syncGameActivityToServer(
  gameName: string,
  addSeconds: number,
  addPlay = 0,
  score = 0
): Promise<LeaderboardEntry[]> {
  const key = (gameName || "").trim().toLowerCase();
  if (!key || isWebsiteNotGame(key)) return [];
  const username = getActiveUser();
  let updatedList = getLocalLeaderboard(key);

  try {
    const res = await fetch("/api/games/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: key,
        username,
        addSeconds: Math.max(0, Math.floor(addSeconds)),
        addPlay: Math.max(0, Math.floor(addPlay)),
        score: Math.max(0, Math.floor(score)),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.entries) && data.entries.length > 0) {
        const map = new Map<string, LeaderboardEntry>();
        for (const item of updatedList) map.set(item.username.toLowerCase(), item);
        for (const item of data.entries as LeaderboardEntry[]) {
          const k = item.username.toLowerCase();
          const prev = map.get(k);
          if (!prev || item.seconds >= prev.seconds) {
            map.set(k, item);
          }
        }
        updatedList = Array.from(map.values()).sort(
          (a, b) => b.seconds - a.seconds || b.plays - a.plays
        );
      }
    }
  } catch {}

  return updatedList;
}

export async function recordGameActivity(
  gameName: string,
  addSeconds: number,
  addPlay = 0,
  score = 0
): Promise<LeaderboardEntry[]> {
  recordLocalGameTick(gameName, addSeconds, addPlay, score);
  return syncGameActivityToServer(gameName, addSeconds, addPlay, score);
}
