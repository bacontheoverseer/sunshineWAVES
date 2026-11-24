/**
 * Operation Cookie - Cookie Pass (Battle Pass / Game Pass)
 * Unlock levels by using the site, chatting, and playing games.
 * Free track offers solid rewards; Pro track (Cookie Master) unlocks premium drops.
 */

import {
  activateAdFreePass,
  addCookieCoins,
  getActiveUser,
  isCookieMasterActive,
} from "./cookieCoins.ts";
import {
  ProfileCustomization,
  getDefaultCustomization,
  loadLocalProfileCustomization,
  saveLocalProfileCustomization,
} from "./profileCustomization.ts";

export type PassTrack = "free" | "pro";
export type PassXpSource = "chat" | "game" | "site" | "daily";

export interface PassReward {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accent: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  coins?: number;
  adFreeHours?: number;
  profilePatch?: Partial<ProfileCustomization>;
}

export interface PassLevelDef {
  level: number;
  xpRequired: number; // Cumulative XP needed to unlock this level
  free: PassReward;
  pro: PassReward;
}

export interface GamePassState {
  season: number;
  xp: number;
  claimedIds: string[];
  chatXp: number;
  gameXp: number;
  siteXp: number;
  lastDailyXpAt: number;
  updatedAt: number;
}

export interface GamePassProgress {
  season: number;
  xp: number;
  level: number;
  maxLevel: number;
  isMaxLevel: boolean;
  currentLevelFloorXp: number;
  nextLevelXp: number;
  xpIntoLevel: number;
  xpNeededForNext: number;
  levelPercent: number;
  claimedIds: string[];
  chatXp: number;
  gameXp: number;
  siteXp: number;
  canClaimDailyXp: boolean;
  dailyXpRemainingMs: number;
  readyClaimCount: number;
}

export const GAME_PASS_SEASON = 1;
export const GAME_PASS_STORAGE_KEY = "cookie_gamepass_v1";
export const GAME_PASS_PRO_XP_MULTIPLIER = 1.5;
const DAILY_XP_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const SITE_USAGE_TICK_MS = 2 * 60 * 1000; // +15 XP every 2 min active on site
const SITE_IDLE_THRESHOLD_MS = 3 * 60 * 1000;

export const GAME_PASS_LEVELS: PassLevelDef[] = [
  {
    level: 1,
    xpRequired: 0,
    free: {
      id: "s1_l1_free",
      title: "+50 coins",
      subtitle: "starter stash",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 50,
    },
    pro: {
      id: "s1_l1_pro",
      title: "+250 coins",
      subtitle: "pro welcome drop",
      icon: "fa-coins",
      accent: "#fbbf24",
      rarity: "rare",
      coins: 250,
    },
  },
  {
    level: 2,
    xpRequired: 100,
    free: {
      id: "s1_l2_free",
      title: "tag: rookie",
      subtitle: "chat profile tag",
      icon: "fa-tag",
      accent: "#94a3b8",
      rarity: "common",
      profilePatch: { customTag: "rookie" },
    },
    pro: {
      id: "s1_l2_pro",
      title: "cyber neon pill",
      subtitle: "chat message pill",
      icon: "fa-comment-dots",
      accent: "#22d3ee",
      rarity: "epic",
      profilePatch: { msgPillStyle: "neon" },
    },
  },
  {
    level: 3,
    xpRequired: 225,
    free: {
      id: "s1_l3_free",
      title: "+75 coins",
      subtitle: "coin pouch",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 75,
    },
    pro: {
      id: "s1_l3_pro",
      title: "rgb prism name",
      subtitle: "animated name style",
      icon: "fa-wand-magic-sparkles",
      accent: "#e879f9",
      rarity: "epic",
      profilePatch: { nameStyle: "animated-rainbow" },
    },
  },
  {
    level: 4,
    xpRequired: 375,
    free: {
      id: "s1_l4_free",
      title: "1h ad-free",
      subtitle: "temporary shield",
      icon: "fa-shield-halved",
      accent: "#60a5fa",
      rarity: "rare",
      adFreeHours: 1,
    },
    pro: {
      id: "s1_l4_pro",
      title: "+400 coins",
      subtitle: "pro coin crate",
      icon: "fa-coins",
      accent: "#fbbf24",
      rarity: "rare",
      coins: 400,
    },
  },
  {
    level: 5,
    xpRequired: 550,
    free: {
      id: "s1_l5_free",
      title: "ice frost pill",
      subtitle: "chat message pill",
      icon: "fa-comment-dots",
      accent: "#7dd3fc",
      rarity: "rare",
      profilePatch: { msgPillStyle: "frosted" },
    },
    pro: {
      id: "s1_l5_pro",
      title: "solar flame aura",
      subtitle: "animated avatar ring",
      icon: "fa-fire-flame-curved",
      accent: "#fb923c",
      rarity: "epic",
      profilePatch: { avatarDecoration: "flame-aura" },
    },
  },
  {
    level: 6,
    xpRequired: 750,
    free: {
      id: "s1_l6_free",
      title: "+100 coins",
      subtitle: "cookie stash",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 100,
    },
    pro: {
      id: "s1_l6_pro",
      title: "aurora banner",
      subtitle: "animated profile banner",
      icon: "fa-panorama",
      accent: "#34d399",
      rarity: "epic",
      profilePatch: { bannerStyle: "animated-aurora" },
    },
  },
  {
    level: 7,
    xpRequired: 975,
    free: {
      id: "s1_l7_free",
      title: "sunset name",
      subtitle: "gradient username",
      icon: "fa-font",
      accent: "#fb923c",
      rarity: "rare",
      profilePatch: { nameStyle: "gradient-sunset" },
    },
    pro: {
      id: "s1_l7_pro",
      title: "+600 coins",
      subtitle: "pro vault drop",
      icon: "fa-coins",
      accent: "#fbbf24",
      rarity: "epic",
      coins: 600,
    },
  },
  {
    level: 8,
    xpRequired: 1225,
    free: {
      id: "s1_l8_free",
      title: "+125 coins",
      subtitle: "cookie pouch",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 125,
    },
    pro: {
      id: "s1_l8_pro",
      title: "shooting stars",
      subtitle: "animated profile effect",
      icon: "fa-meteor",
      accent: "#a855f7",
      rarity: "epic",
      profilePatch: { profileEffect: "shooting-stars" },
    },
  },
  {
    level: 9,
    xpRequired: 1500,
    free: {
      id: "s1_l9_free",
      title: "2h ad-free",
      subtitle: "clean browse pass",
      icon: "fa-shield-halved",
      accent: "#60a5fa",
      rarity: "rare",
      adFreeHours: 2,
    },
    pro: {
      id: "s1_l9_pro",
      title: "royal gold pill",
      subtitle: "premium message pill",
      icon: "fa-comment-dots",
      accent: "#facc15",
      rarity: "epic",
      profilePatch: { msgPillStyle: "gold" },
    },
  },
  {
    level: 10,
    xpRequired: 1800,
    free: {
      id: "s1_l10_free",
      title: "midnight pill",
      subtitle: "chat message pill",
      icon: "fa-moon",
      accent: "#818cf8",
      rarity: "rare",
      profilePatch: { msgPillStyle: "midnight" },
    },
    pro: {
      id: "s1_l10_pro",
      title: "+1,000 coins",
      subtitle: "milestone jackpot",
      icon: "fa-sack-dollar",
      accent: "#fbbf24",
      rarity: "legendary",
      coins: 1000,
    },
  },
  {
    level: 11,
    xpRequired: 2125,
    free: {
      id: "s1_l11_free",
      title: "+150 coins",
      subtitle: "cookie stash",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 150,
    },
    pro: {
      id: "s1_l11_pro",
      title: "holo scan plate",
      subtitle: "animated nameplate",
      icon: "fa-id-badge",
      accent: "#22d3ee",
      rarity: "epic",
      profilePatch: { nameplate: "cyber-scan" },
    },
  },
  {
    level: 12,
    xpRequired: 2475,
    free: {
      id: "s1_l12_free",
      title: "frost ring",
      subtitle: "avatar decoration",
      icon: "fa-snowflake",
      accent: "#7dd3fc",
      rarity: "rare",
      profilePatch: { avatarDecoration: "frost-pulse" },
    },
    pro: {
      id: "s1_l12_pro",
      title: "crimson crest",
      subtitle: "dragon avatar aura",
      icon: "fa-dragon",
      accent: "#ef4444",
      rarity: "legendary",
      profilePatch: { avatarDecoration: "dragon-crest" },
    },
  },
  {
    level: 13,
    xpRequired: 2850,
    free: {
      id: "s1_l13_free",
      title: "+200 coins",
      subtitle: "cookie pouch",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "rare",
      coins: 200,
    },
    pro: {
      id: "s1_l13_pro",
      title: "electric surge",
      subtitle: "lightning profile border",
      icon: "fa-bolt",
      accent: "#38bdf8",
      rarity: "legendary",
      profilePatch: { profileEffect: "lightning-border" },
    },
  },
  {
    level: 14,
    xpRequired: 3250,
    free: {
      id: "s1_l14_free",
      title: "tag: grinder",
      subtitle: "season 1 badge tag",
      icon: "fa-tag",
      accent: "#60a5fa",
      rarity: "rare",
      profilePatch: { customTag: "grinder" },
    },
    pro: {
      id: "s1_l14_pro",
      title: "chrome gold name",
      subtitle: "animated gold username",
      icon: "fa-sparkles",
      accent: "#facc15",
      rarity: "legendary",
      profilePatch: { nameStyle: "animated-gold" },
    },
  },
  {
    level: 15,
    xpRequired: 3700,
    free: {
      id: "s1_l15_free",
      title: "+350 coins",
      subtitle: "season 1 finale",
      icon: "fa-trophy",
      accent: "#60a5fa",
      rarity: "epic",
      coins: 350,
    },
    pro: {
      id: "s1_l15_pro",
      title: "royal crown pack",
      subtitle: "+2,500 coins & royal halo",
      icon: "fa-crown",
      accent: "#fbbf24",
      rarity: "legendary",
      coins: 2500,
      profilePatch: { avatarDecoration: "gold-royal", cardTheme: "royal-gold" },
    },
  },
];

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

function getDefaultPassState(): GamePassState {
  return {
    season: GAME_PASS_SEASON,
    xp: 0,
    claimedIds: [],
    chatXp: 0,
    gameXp: 0,
    siteXp: 0,
    lastDailyXpAt: 0,
    updatedAt: Date.now(),
  };
}

export function getGamePassState(): GamePassState {
  try {
    const raw = localStorage.getItem(GAME_PASS_STORAGE_KEY);
    if (!raw) return getDefaultPassState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return getDefaultPassState();
    const claimed = Array.isArray(parsed.claimedIds)
      ? parsed.claimedIds.filter((x: unknown): x is string => typeof x === "string")
      : [];
    return {
      season: Number(parsed.season) || GAME_PASS_SEASON,
      xp: Math.max(0, Math.floor(Number(parsed.xp) || 0)),
      claimedIds: Array.from(new Set(claimed)),
      chatXp: Math.max(0, Math.floor(Number(parsed.chatXp) || 0)),
      gameXp: Math.max(0, Math.floor(Number(parsed.gameXp) || 0)),
      siteXp: Math.max(0, Math.floor(Number(parsed.siteXp) || 0)),
      lastDailyXpAt: Math.max(0, Number(parsed.lastDailyXpAt) || 0),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return getDefaultPassState();
  }
}

function saveGamePassState(next: GamePassState): GamePassState {
  const clean: GamePassState = {
    ...next,
    xp: Math.max(0, Math.floor(next.xp)),
    claimedIds: Array.from(new Set(next.claimedIds)),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(GAME_PASS_STORAGE_KEY, JSON.stringify(clean));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent("cookie-pass-updated", { detail: clean }));
  } catch {}
  return clean;
}

export function computeLevelFromXp(xp: number): number {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  for (const def of GAME_PASS_LEVELS) {
    if (safeXp >= def.xpRequired) {
      level = def.level;
    } else {
      break;
    }
  }
  return level;
}

export function getGamePassProgress(): GamePassProgress {
  const st = getGamePassState();
  const maxLevel = GAME_PASS_LEVELS[GAME_PASS_LEVELS.length - 1].level;
  const level = computeLevelFromXp(st.xp);
  const currentDef = GAME_PASS_LEVELS[level - 1] || GAME_PASS_LEVELS[0];
  const nextDef = GAME_PASS_LEVELS[level] || null;
  const isMaxLevel = !nextDef;
  const currentLevelFloorXp = currentDef.xpRequired;
  const nextLevelXp = nextDef ? nextDef.xpRequired : currentDef.xpRequired;
  const xpIntoLevel = isMaxLevel ? 0 : Math.max(0, st.xp - currentLevelFloorXp);
  const xpNeededForNext = isMaxLevel ? 0 : Math.max(1, nextLevelXp - currentLevelFloorXp);
  const levelPercent = isMaxLevel
    ? 100
    : Math.min(100, Math.max(0, Math.round((xpIntoLevel / xpNeededForNext) * 100)));

  const now = Date.now();
  const dailyXpRemainingMs = st.lastDailyXpAt
    ? Math.max(0, st.lastDailyXpAt + DAILY_XP_COOLDOWN_MS - now)
    : 0;

  const proActive = isCookieMasterActive();
  const claimedSet = new Set(st.claimedIds);
  let readyClaimCount = 0;
  for (const def of GAME_PASS_LEVELS) {
    if (def.level > level) break;
    if (!claimedSet.has(def.free.id)) readyClaimCount += 1;
    if (proActive && !claimedSet.has(def.pro.id)) readyClaimCount += 1;
  }

  return {
    season: st.season,
    xp: st.xp,
    level,
    maxLevel,
    isMaxLevel,
    currentLevelFloorXp,
    nextLevelXp,
    xpIntoLevel,
    xpNeededForNext,
    levelPercent,
    claimedIds: st.claimedIds,
    chatXp: st.chatXp,
    gameXp: st.gameXp,
    siteXp: st.siteXp,
    canClaimDailyXp: dailyXpRemainingMs === 0,
    dailyXpRemainingMs,
    readyClaimCount,
  };
}

let lastChatXpAt = 0;

export function awardGamePassXp(
  baseAmount: number,
  source: PassXpSource,
  opts?: { silent?: boolean; label?: string }
): { awarded: number; leveledUp: boolean; level: number; totalXp: number } {
  const cleanBase = Math.max(0, Math.floor(baseAmount));
  if (cleanBase <= 0) {
    const cur = getGamePassState();
    return { awarded: 0, leveledUp: false, level: computeLevelFromXp(cur.xp), totalXp: cur.xp };
  }

  // Soft cooldown for chat XP to prevent spam farming
  if (source === "chat") {
    const now = Date.now();
    if (now - lastChatXpAt < 20000) {
      const cur = getGamePassState();
      return { awarded: 0, leveledUp: false, level: computeLevelFromXp(cur.xp), totalXp: cur.xp };
    }
    lastChatXpAt = now;
  }

  const proBoost = isCookieMasterActive() ? GAME_PASS_PRO_XP_MULTIPLIER : 1;
  const awarded = Math.max(1, Math.round(cleanBase * proBoost));

  const prev = getGamePassState();
  const prevLevel = computeLevelFromXp(prev.xp);
  const nextXp = prev.xp + awarded;
  const nextLevel = computeLevelFromXp(nextXp);
  const leveledUp = nextLevel > prevLevel;

  saveGamePassState({
    ...prev,
    xp: nextXp,
    chatXp: prev.chatXp + (source === "chat" ? awarded : 0),
    gameXp: prev.gameXp + (source === "game" ? awarded : 0),
    siteXp: prev.siteXp + (source === "site" || source === "daily" ? awarded : 0),
  });

  if (leveledUp) {
    notifyToast(
      `cookie pass level ${nextLevel} unlocked! claim your reward in cookie master`,
      "success"
    );
  } else if (!opts?.silent && opts?.label) {
    notifyToast(`+${awarded} pass xp · ${opts.label}`, "info");
  }

  return { awarded, leveledUp, level: nextLevel, totalXp: nextXp };
}

export function claimDailyPassXp(): { claimed: boolean; awarded: number; remainingMs: number } {
  const prog = getGamePassProgress();
  if (!prog.canClaimDailyXp) {
    return { claimed: false, awarded: 0, remainingMs: prog.dailyXpRemainingMs };
  }
  const st = getGamePassState();
  saveGamePassState({
    ...st,
    lastDailyXpAt: Date.now(),
  });
  const res = awardGamePassXp(50, "daily", { label: "daily check-in" });
  return { claimed: true, awarded: res.awarded, remainingMs: DAILY_XP_COOLDOWN_MS };
}

export async function equipPassStyleReward(reward: PassReward): Promise<boolean> {
  if (!reward.profilePatch) return false;
  const username = getActiveUser();
  const base =
    (username !== "guest" ? loadLocalProfileCustomization(username) : null) ||
    getDefaultCustomization(username === "guest" ? "" : username);
  const merged: ProfileCustomization = {
    ...base,
    ...reward.profilePatch,
  };

  if (username !== "guest") {
    saveLocalProfileCustomization(username, merged);
    try {
      const token = localStorage.getItem("auth_token") || "";
      await fetch("/api/chat/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ customization: merged }),
      });
    } catch {}
  }

  try {
    window.dispatchEvent(new CustomEvent("cookie-pass-updated"));
  } catch {}
  notifyToast(`equipped ${reward.title}!`, "success");
  return true;
}

export function claimPassReward(
  level: number,
  track: PassTrack
): { claimed: boolean; reason?: string; reward?: PassReward } {
  const def = GAME_PASS_LEVELS.find((l) => l.level === level);
  if (!def) return { claimed: false, reason: "invalid level" };

  const st = getGamePassState();
  const currentLevel = computeLevelFromXp(st.xp);
  if (currentLevel < level) {
    return { claimed: false, reason: `reach level ${level} to unlock` };
  }

  if (track === "pro" && !isCookieMasterActive()) {
    return { claimed: false, reason: "requires active cookie master pass" };
  }

  const reward = track === "pro" ? def.pro : def.free;
  if (st.claimedIds.includes(reward.id)) {
    return { claimed: false, reason: "already claimed" };
  }

  saveGamePassState({
    ...st,
    claimedIds: [...st.claimedIds, reward.id],
  });

  if (reward.coins && reward.coins > 0) {
    addCookieCoins(reward.coins, `cookie pass lvl ${level} (${track})`);
  }
  if (reward.adFreeHours && reward.adFreeHours > 0) {
    activateAdFreePass(reward.adFreeHours * 60 * 60 * 1000);
    notifyToast(`+${reward.adFreeHours}h ad-free activated!`, "success");
  }
  if (reward.profilePatch && !reward.coins) {
    notifyToast(`unlocked ${reward.title}! click equip to wear it`, "success");
  }

  return { claimed: true, reward };
}

export function claimAllReadyPassRewards(): { count: number; totalCoins: number } {
  const st = getGamePassState();
  const currentLevel = computeLevelFromXp(st.xp);
  const proActive = isCookieMasterActive();
  const claimedSet = new Set(st.claimedIds);

  let count = 0;
  let totalCoins = 0;
  let totalAdFreeHours = 0;
  const newlyClaimed: string[] = [];

  for (const def of GAME_PASS_LEVELS) {
    if (def.level > currentLevel) break;
    const tracks: PassTrack[] = proActive ? ["free", "pro"] : ["free"];
    for (const track of tracks) {
      const reward = track === "pro" ? def.pro : def.free;
      if (claimedSet.has(reward.id)) continue;
      claimedSet.add(reward.id);
      newlyClaimed.push(reward.id);
      count += 1;
      if (reward.coins) totalCoins += reward.coins;
      if (reward.adFreeHours) totalAdFreeHours += reward.adFreeHours;
    }
  }

  if (count === 0) return { count: 0, totalCoins: 0 };

  saveGamePassState({
    ...st,
    claimedIds: Array.from(claimedSet),
  });

  if (totalCoins > 0) {
    addCookieCoins(totalCoins, `claimed ${count} cookie pass rewards`);
  }
  if (totalAdFreeHours > 0) {
    activateAdFreePass(totalAdFreeHours * 60 * 60 * 1000);
  }
  if (totalCoins === 0) {
    notifyToast(`claimed ${count} cookie pass reward${count === 1 ? "" : "s"}!`, "success");
  }

  return { count, totalCoins };
}

let siteTrackerStarted = false;
let lastUserInteractionAt = Date.now();

export function startSiteUsageXpTracker(): void {
  if (typeof window === "undefined" || siteTrackerStarted) return;
  siteTrackerStarted = true;
  lastUserInteractionAt = Date.now();

  const markActive = () => {
    lastUserInteractionAt = Date.now();
  };

  window.addEventListener("pointerdown", markActive, { passive: true });
  window.addEventListener("keydown", markActive, { passive: true });
  window.addEventListener("scroll", markActive, { passive: true });

  window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastUserInteractionAt > SITE_IDLE_THRESHOLD_MS) return;
    awardGamePassXp(15, "site", { silent: true });
  }, SITE_USAGE_TICK_MS);
}

if (typeof window !== "undefined") {
  startSiteUsageXpTracker();
}
