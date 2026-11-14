/**
 * Operation Cookie - Global Cookie Coins Currency, Game Studios & Leaderboards
 * (Strictly real user data — no fake players)
 */

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
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function getLocalLeaderboard(gameName: string): LeaderboardEntry[] {
  const key = (gameName || "global").trim().toLowerCase();
  try {
    const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    const all: Record<string, LeaderboardEntry[]> = raw ? JSON.parse(raw) : {};
    const list = all[key] || [];
    return [...list].sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);
  } catch {
    return [];
  }
}

export async function recordGameActivity(
  gameName: string,
  addSeconds: number,
  addPlay = 0,
  score = 0
): Promise<LeaderboardEntry[]> {
  const key = (gameName || "global").trim().toLowerCase();
  const username = getActiveUser();
  const userLower = username.toLowerCase();

  let updatedList: LeaderboardEntry[] = [];
  try {
    const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
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
    localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(all));
    updatedList = list;
  } catch {}

  try {
    const res = await fetch("/api/games/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        game: key,
        username,
        addSeconds,
        addPlay,
        score,
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
