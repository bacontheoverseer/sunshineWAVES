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
const COIN_BOOST_UNTIL_KEY = "cookie_coin_boost_until_v1";
export const COOKIE_MASTER_STORAGE_KEY = "cookie_master_status_v1";
export const COOKIE_MASTER_DAILY_COINS = 1000;
export const COOKIE_MASTER_COIN_PRICE = 5000;
const DAILY_CLAIM_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HOURLY_DROP_KEY = "cookie_hourly_drop_at_v1";
const HOURLY_DROP_INTERVAL_MS = 60 * 60 * 1000;
export const HOURLY_DROP_COINS = 75;
const DAILY_STREAK_KEY = "cookie_daily_streak_v1";
const CLICKER_BONUS_KEY = "cookie_clicker_bonus_v1";
const CLICKER_WINDOW_MS = 30 * 60 * 1000;
const CLICKER_MAX_BURSTS = 8;
export const CLICKER_BURST_COINS = 10;
let lastChatCoinAwardAt = 0;
let memHourlyClaimAt = 0;
let memStreakClaimAt = 0;
let memDailyMasterClaimAt = 0;
let memClickerWindowStart = 0;
let memClickerUsed = 0;
let memLastClickerBurstAt = 0;

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
  const lastAt = Math.max(Number(st.lastDailyClaimAt || 0), memDailyMasterClaimAt);
  if (!lastAt) return 0;
  return Math.max(0, lastAt + DAILY_CLAIM_INTERVAL_MS - Date.now());
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
  const now = Date.now();
  memDailyMasterClaimAt = now;
  setCookieMasterState({
    ...st,
    lastDailyClaimAt: now,
  });
  const nextBalance = addCookieCoins(COOKIE_MASTER_DAILY_COINS, "cookie master daily coins");
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

export function getCoinBoostUntil(): number {
  try {
    const raw = localStorage.getItem(COIN_BOOST_UNTIL_KEY);
    const ts = raw ? Number(raw) : 0;
    return Number.isFinite(ts) && ts > Date.now() ? ts : 0;
  } catch {
    return 0;
  }
}

export function isCoinBoostActive(): boolean {
  return getCoinBoostUntil() > Date.now();
}

export function getCoinMultiplier(): number {
  return isCoinBoostActive() ? 2 : 1;
}

export function activateCoinBoost(durationMs: number): number {
  const base = Math.max(getCoinBoostUntil(), Date.now());
  const nextUntil = base + Math.max(0, Math.floor(durationMs));
  try {
    localStorage.setItem(COIN_BOOST_UNTIL_KEY, String(nextUntil));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("cookie-coins-updated"));
    window.dispatchEvent(new CustomEvent("cookie-pass-updated"));
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
    const raw = localStorage.getItem(COINS_STORAGE_KEY);
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return Math.max(0, n);
    }
    localStorage.setItem(COINS_STORAGE_KEY, "150");
    return 150;
  } catch {
    return 150;
  }
}

export function setCookieCoins(nextBalance: number): number {
  const clean = Math.max(0, Math.floor(nextBalance));
  try {
    localStorage.setItem(COINS_STORAGE_KEY, String(clean));
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

export function awardChatMessageCoins(): number {
  const now = Date.now();
  if (now - lastChatCoinAwardAt < 30000) return 0;
  lastChatCoinAwardAt = now;
  const amount = 5 * getCoinMultiplier();
  setCookieCoins(getCookieCoins() + amount);
  return amount;
}

export function getHourlyDropRemainingMs(): number {
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(HOURLY_DROP_KEY) || "0");
  } catch {}
  const last = Math.max(stored, memHourlyClaimAt);
  if (!last) return 0;
  return Math.max(0, last + HOURLY_DROP_INTERVAL_MS - Date.now());
}

export function claimHourlyCookieDrop(): { claimed: boolean; amount: number; remainingMs: number } {
  const rem = getHourlyDropRemainingMs();
  if (rem > 0) return { claimed: false, amount: 0, remainingMs: rem };
  const now = Date.now();
  memHourlyClaimAt = now;
  try {
    localStorage.setItem(HOURLY_DROP_KEY, String(now));
  } catch {}
  addCookieCoins(HOURLY_DROP_COINS, "hourly cookie jar");
  return { claimed: true, amount: HOURLY_DROP_COINS, remainingMs: HOURLY_DROP_INTERVAL_MS };
}

export function getDailyStreakState(): { streak: number; remainingMs: number; nextReward: number } {
  const rewards = [100, 150, 225, 325, 500];
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_STREAK_KEY) || "{}");
    const lastAt = Math.max(Number(raw?.lastAt || 0), memStreakClaimAt);
    let streak = Math.max(0, Number(raw?.streak || 0));
    const now = Date.now();
    if (lastAt > 0 && now - lastAt > 48 * 60 * 60 * 1000) {
      streak = 0;
    }
    const remainingMs = lastAt > 0 ? Math.max(0, lastAt + DAILY_CLAIM_INTERVAL_MS - now) : 0;
    const nextIdx = Math.min(rewards.length - 1, streak);
    return { streak, remainingMs, nextReward: rewards[nextIdx] };
  } catch {
    const rem = memStreakClaimAt > 0 ? Math.max(0, memStreakClaimAt + DAILY_CLAIM_INTERVAL_MS - Date.now()) : 0;
    return { streak: 0, remainingMs: rem, nextReward: 100 };
  }
}

export function claimDailyStreakBonus(): { claimed: boolean; amount: number; streak: number; remainingMs: number } {
  const st = getDailyStreakState();
  if (st.remainingMs > 0) {
    return { claimed: false, amount: 0, streak: st.streak, remainingMs: st.remainingMs };
  }
  const now = Date.now();
  memStreakClaimAt = now;
  const nextStreak = st.streak + 1;
  const amount = st.nextReward;
  try {
    localStorage.setItem(DAILY_STREAK_KEY, JSON.stringify({ streak: nextStreak, lastAt: now }));
  } catch {}
  addCookieCoins(amount, `day ${nextStreak} check-in streak`);
  return { claimed: true, amount, streak: nextStreak, remainingMs: DAILY_CLAIM_INTERVAL_MS };
}

export function getClickerBonusState(): { remainingBursts: number; resetInMs: number } {
  const now = Date.now();
  let windowStart = memClickerWindowStart;
  let used = memClickerUsed;
  try {
    const raw = JSON.parse(localStorage.getItem(CLICKER_BONUS_KEY) || "{}");
    const lsStart = Number(raw?.windowStart || 0);
    const lsUsed = Math.max(0, Number(raw?.used || 0));
    if (lsStart && now - lsStart < CLICKER_WINDOW_MS) {
      if (!windowStart || now - windowStart >= CLICKER_WINDOW_MS || lsUsed > used) {
        windowStart = lsStart;
        used = lsUsed;
      }
    }
  } catch {}
  if (!windowStart || now - windowStart >= CLICKER_WINDOW_MS) {
    return { remainingBursts: CLICKER_MAX_BURSTS, resetInMs: 0 };
  }
  return {
    remainingBursts: Math.max(0, CLICKER_MAX_BURSTS - used),
    resetInMs: Math.max(0, windowStart + CLICKER_WINDOW_MS - now),
  };
}

export function claimCookieClickerBurst(): { claimed: boolean; amount: number; remainingBursts: number; resetInMs: number } {
  const now = Date.now();
  if (memLastClickerBurstAt > 0 && now - memLastClickerBurstAt < 1200) {
    const cur = getClickerBonusState();
    return { claimed: false, amount: 0, remainingBursts: cur.remainingBursts, resetInMs: cur.resetInMs };
  }
  let windowStart = now;
  let used = 0;
  if (memClickerWindowStart > 0 && now - memClickerWindowStart < CLICKER_WINDOW_MS) {
    windowStart = memClickerWindowStart;
    used = memClickerUsed;
  }
  try {
    const raw = JSON.parse(localStorage.getItem(CLICKER_BONUS_KEY) || "{}");
    if (raw?.windowStart && now - Number(raw.windowStart) < CLICKER_WINDOW_MS) {
      const lsUsed = Math.max(0, Number(raw.used || 0));
      if (lsUsed > used) {
        windowStart = Number(raw.windowStart);
        used = lsUsed;
      }
    }
  } catch {}
  if (used >= CLICKER_MAX_BURSTS) {
    return {
      claimed: false,
      amount: 0,
      remainingBursts: 0,
      resetInMs: Math.max(0, windowStart + CLICKER_WINDOW_MS - now),
    };
  }
  used += 1;
  memClickerWindowStart = windowStart;
  memClickerUsed = used;
  memLastClickerBurstAt = now;
  try {
    localStorage.setItem(CLICKER_BONUS_KEY, JSON.stringify({ windowStart, used }));
  } catch {}
  setCookieCoins(getCookieCoins() + CLICKER_BURST_COINS);
  return {
    claimed: true,
    amount: CLICKER_BURST_COINS,
    remainingBursts: Math.max(0, CLICKER_MAX_BURSTS - used),
    resetInMs: Math.max(0, windowStart + CLICKER_WINDOW_MS - now),
  };
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
