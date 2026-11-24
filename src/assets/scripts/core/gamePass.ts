/**
 * Operation Cookie - Cookie Pass (Battle Pass / Game Pass)
 * Unlock levels by using the site, chatting, and playing games.
 * Zero locked cosmetics — purely high-utility economy, shop tokens, boosters, vaults & membership perks.
 */

import {
  activateAdFreePass,
  activateCoinBoost,
  addCookieCoins,
  getCoinBoostUntil,
  getCookieMasterState,
  isCookieMasterActive,
  setCookieMasterState,
} from "./cookieCoins.ts";

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
  crateRange?: [number, number];
  prankTokens?: number;
  coinBoostMins?: number;
  xpBoostMins?: number;
  adFreeHours?: number;
  masterDays?: number;
}

export interface PassLevelDef {
  level: number;
  xpRequired: number;
  free: PassReward;
  pro: PassReward;
}

export interface GamePassState {
  season: number;
  xp: number;
  claimedIds: string[];
  prankTokens: number;
  xpBoostUntil: number;
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
  prankTokens: number;
  xpBoostRemainingMs: number;
  coinBoostRemainingMs: number;
  effectiveXpMultiplier: number;
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
const SITE_USAGE_TICK_MS = 5 * 60 * 1000; // +5 XP every 5 min active on site
const SITE_IDLE_THRESHOLD_MS = 3 * 60 * 1000;

export const GAME_PASS_LEVELS: PassLevelDef[] = [
  {
    level: 1,
    xpRequired: 150,
    free: {
      id: "s1_l1_free",
      title: "+25 coins",
      subtitle: "starter coin pouch",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 25,
    },
    pro: {
      id: "s1_l1_pro",
      title: "+100 coins",
      subtitle: "pro welcome drop",
      icon: "fa-coins",
      accent: "#fbbf24",
      rarity: "rare",
      coins: 100,
    },
  },
  {
    level: 2,
    xpRequired: 400,
    free: {
      id: "s1_l2_free",
      title: "15m 2x xp",
      subtitle: "short xp boost",
      icon: "fa-angles-up",
      accent: "#60a5fa",
      rarity: "common",
      xpBoostMins: 15,
    },
    pro: {
      id: "s1_l2_pro",
      title: "1x prank token",
      subtitle: "1 free shop prank",
      icon: "fa-ticket",
      accent: "#22d3ee",
      rarity: "rare",
      prankTokens: 1,
    },
  },
  {
    level: 3,
    xpRequired: 750,
    free: {
      id: "s1_l3_free",
      title: "+35 coins",
      subtitle: "cookie stash",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 35,
    },
    pro: {
      id: "s1_l3_pro",
      title: "30m 2x coins",
      subtitle: "2x game & chat coins",
      icon: "fa-bolt",
      accent: "#f59e0b",
      rarity: "epic",
      coinBoostMins: 30,
    },
  },
  {
    level: 4,
    xpRequired: 1200,
    free: {
      id: "s1_l4_free",
      title: "30m ad-free",
      subtitle: "temporary ad shield",
      icon: "fa-shield-halved",
      accent: "#60a5fa",
      rarity: "common",
      adFreeHours: 0.5,
    },
    pro: {
      id: "s1_l4_pro",
      title: "+175 coins",
      subtitle: "pro coin crate",
      icon: "fa-coins",
      accent: "#fbbf24",
      rarity: "rare",
      coins: 175,
    },
  },
  {
    level: 5,
    xpRequired: 1800,
    free: {
      id: "s1_l5_free",
      title: "+50 coins",
      subtitle: "cookie pouch",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 50,
    },
    pro: {
      id: "s1_l5_pro",
      title: "golden vault",
      subtitle: "rolls 175–400 coins",
      icon: "fa-box-open",
      accent: "#fb923c",
      rarity: "epic",
      crateRange: [175, 400],
    },
  },
  {
    level: 6,
    xpRequired: 2550,
    free: {
      id: "s1_l6_free",
      title: "15m 2x coins",
      subtitle: "2x game & chat coins",
      icon: "fa-bolt",
      accent: "#fb923c",
      rarity: "rare",
      coinBoostMins: 15,
    },
    pro: {
      id: "s1_l6_pro",
      title: "30m 2x xp boost",
      subtitle: "stacks to 3x pro xp",
      icon: "fa-rocket",
      accent: "#a855f7",
      rarity: "epic",
      xpBoostMins: 30,
    },
  },
  {
    level: 7,
    xpRequired: 3450,
    free: {
      id: "s1_l7_free",
      title: "+65 coins",
      subtitle: "cookie stash",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 65,
    },
    pro: {
      id: "s1_l7_pro",
      title: "1x prank token",
      subtitle: "1 free shop prank",
      icon: "fa-ticket",
      accent: "#22d3ee",
      rarity: "epic",
      prankTokens: 1,
    },
  },
  {
    level: 8,
    xpRequired: 4500,
    free: {
      id: "s1_l8_free",
      title: "mystery box",
      subtitle: "rolls 40–110 coins",
      icon: "fa-cube",
      accent: "#60a5fa",
      rarity: "rare",
      crateRange: [40, 110],
    },
    pro: {
      id: "s1_l8_pro",
      title: "+250 coins",
      subtitle: "pro treasury drop",
      icon: "fa-coins",
      accent: "#fbbf24",
      rarity: "epic",
      coins: 250,
    },
  },
  {
    level: 9,
    xpRequired: 5750,
    free: {
      id: "s1_l9_free",
      title: "1h ad-free",
      subtitle: "clean browse pass",
      icon: "fa-shield-halved",
      accent: "#60a5fa",
      rarity: "rare",
      adFreeHours: 1,
    },
    pro: {
      id: "s1_l9_pro",
      title: "45m 2x coins",
      subtitle: "2x game & chat coins",
      icon: "fa-fire-flame-curved",
      accent: "#facc15",
      rarity: "epic",
      coinBoostMins: 45,
    },
  },
  {
    level: 10,
    xpRequired: 7200,
    free: {
      id: "s1_l10_free",
      title: "1x prank token",
      subtitle: "1 free shop prank",
      icon: "fa-ticket",
      accent: "#818cf8",
      rarity: "rare",
      prankTokens: 1,
    },
    pro: {
      id: "s1_l10_pro",
      title: "+400c & +1d pro",
      subtitle: "+400 coins + 1d master",
      icon: "fa-crown",
      accent: "#fbbf24",
      rarity: "legendary",
      coins: 400,
      masterDays: 1,
    },
  },
  {
    level: 11,
    xpRequired: 8900,
    free: {
      id: "s1_l11_free",
      title: "+85 coins",
      subtitle: "cookie pouch",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "common",
      coins: 85,
    },
    pro: {
      id: "s1_l11_pro",
      title: "diamond vault",
      subtitle: "rolls 300–700 coins",
      icon: "fa-gem",
      accent: "#22d3ee",
      rarity: "legendary",
      crateRange: [300, 700],
    },
  },
  {
    level: 12,
    xpRequired: 10850,
    free: {
      id: "s1_l12_free",
      title: "20m 2x xp",
      subtitle: "double pass xp",
      icon: "fa-angles-up",
      accent: "#7dd3fc",
      rarity: "rare",
      xpBoostMins: 20,
    },
    pro: {
      id: "s1_l12_pro",
      title: "2x prank tokens",
      subtitle: "2 free shop pranks",
      icon: "fa-ticket",
      accent: "#f43f5e",
      rarity: "legendary",
      prankTokens: 2,
    },
  },
  {
    level: 13,
    xpRequired: 13100,
    free: {
      id: "s1_l13_free",
      title: "+110 coins",
      subtitle: "cookie pouch",
      icon: "fa-coins",
      accent: "#94a3b8",
      rarity: "rare",
      coins: 110,
    },
    pro: {
      id: "s1_l13_pro",
      title: "1h 2x surge",
      subtitle: "1h 2x coins & 2x xp",
      icon: "fa-bolt",
      accent: "#38bdf8",
      rarity: "legendary",
      coinBoostMins: 60,
      xpBoostMins: 60,
    },
  },
  {
    level: 14,
    xpRequired: 15700,
    free: {
      id: "s1_l14_free",
      title: "20m 2x coins",
      subtitle: "2x game & chat coins",
      icon: "fa-bolt",
      accent: "#60a5fa",
      rarity: "rare",
      coinBoostMins: 20,
    },
    pro: {
      id: "s1_l14_pro",
      title: "+600 coins",
      subtitle: "royal bank drop",
      icon: "fa-sack-dollar",
      accent: "#facc15",
      rarity: "legendary",
      coins: 600,
    },
  },
  {
    level: 15,
    xpRequired: 18800,
    free: {
      id: "s1_l15_free",
      title: "+200c & 2h ad-free",
      subtitle: "season 1 free finale",
      icon: "fa-trophy",
      accent: "#60a5fa",
      rarity: "epic",
      coins: 200,
      adFreeHours: 2,
    },
    pro: {
      id: "s1_l15_pro",
      title: "pro jackpot pack",
      subtitle: "+1,200c, +3d pro & 2x tokens",
      icon: "fa-crown",
      accent: "#fbbf24",
      rarity: "legendary",
      coins: 1200,
      masterDays: 3,
      prankTokens: 2,
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
    prankTokens: 0,
    xpBoostUntil: 0,
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
      prankTokens: Math.max(0, Math.floor(Number(parsed.prankTokens) || 0)),
      xpBoostUntil: Math.max(0, Number(parsed.xpBoostUntil) || 0),
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
    prankTokens: Math.max(0, Math.floor(next.prankTokens || 0)),
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

export function getShopPrankTokens(): number {
  return getGamePassState().prankTokens;
}

export function consumeShopPrankToken(): boolean {
  const st = getGamePassState();
  if (st.prankTokens <= 0) return false;
  saveGamePassState({
    ...st,
    prankTokens: st.prankTokens - 1,
  });
  return true;
}

export function computeLevelFromXp(xp: number): number {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 0;
  for (const def of GAME_PASS_LEVELS) {
    if (safeXp >= def.xpRequired) {
      level = def.level;
    } else {
      break;
    }
  }
  return level;
}

export function getEffectiveXpMultiplier(): number {
  const st = getGamePassState();
  const proMult = isCookieMasterActive() ? GAME_PASS_PRO_XP_MULTIPLIER : 1;
  const boostMult = st.xpBoostUntil > Date.now() ? 2 : 1;
  return proMult * boostMult;
}

export function getGamePassProgress(): GamePassProgress {
  const st = getGamePassState();
  const maxLevel = GAME_PASS_LEVELS[GAME_PASS_LEVELS.length - 1].level;
  const level = computeLevelFromXp(st.xp);
  const currentDef = level > 0 ? GAME_PASS_LEVELS[level - 1] : null;
  const nextDef = GAME_PASS_LEVELS[level] || null;
  const isMaxLevel = !nextDef;
  const currentLevelFloorXp = currentDef ? currentDef.xpRequired : 0;
  const nextLevelXp = nextDef ? nextDef.xpRequired : currentLevelFloorXp;
  const xpIntoLevel = isMaxLevel ? 0 : Math.max(0, st.xp - currentLevelFloorXp);
  const xpNeededForNext = isMaxLevel ? 0 : Math.max(1, nextLevelXp - currentLevelFloorXp);
  const levelPercent = isMaxLevel
    ? 100
    : Math.min(100, Math.max(0, Math.round((xpIntoLevel / xpNeededForNext) * 100)));

  const now = Date.now();
  const dailyXpRemainingMs = st.lastDailyXpAt
    ? Math.max(0, st.lastDailyXpAt + DAILY_XP_COOLDOWN_MS - now)
    : 0;
  const xpBoostRemainingMs = st.xpBoostUntil > now ? st.xpBoostUntil - now : 0;
  const coinBoostUntil = getCoinBoostUntil();
  const coinBoostRemainingMs = coinBoostUntil > now ? coinBoostUntil - now : 0;

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
    prankTokens: st.prankTokens,
    xpBoostRemainingMs,
    coinBoostRemainingMs,
    effectiveXpMultiplier: getEffectiveXpMultiplier(),
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

  if (source === "chat") {
    const now = Date.now();
    if (now - lastChatXpAt < 45000) {
      const cur = getGamePassState();
      return { awarded: 0, leveledUp: false, level: computeLevelFromXp(cur.xp), totalXp: cur.xp };
    }
    lastChatXpAt = now;
  }

  const mult = getEffectiveXpMultiplier();
  const awarded = Math.max(1, Math.round(cleanBase * mult));

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
  const res = awardGamePassXp(30, "daily", { label: "daily check-in" });
  return { claimed: true, awarded: res.awarded, remainingMs: DAILY_XP_COOLDOWN_MS };
}

function rollCrateCoins(range: [number, number]): number {
  const [min, max] = range;
  const raw = min + Math.random() * Math.max(0, max - min);
  return Math.max(min, Math.round(raw / 5) * 5);
}

function extendCookieMasterDays(days: number): void {
  if (days <= 0) return;
  const addMs = days * 24 * 60 * 60 * 1000;
  const prev = getCookieMasterState();
  const baseExpiry =
    prev?.expiresAt && prev.expiresAt > Date.now() ? prev.expiresAt : Date.now();
  setCookieMasterState({
    active: true,
    licenseKey: prev?.licenseKey || "cookie_pass_bonus",
    subscriptionId: prev?.subscriptionId,
    status: "active",
    email: prev?.email,
    verifiedAt: Date.now(),
    expiresAt: baseExpiry + addMs,
    cancelledAt: prev?.cancelledAt || null,
    lastDailyClaimAt: prev?.lastDailyClaimAt || 0,
  });
}

function applyRewardEffects(reward: PassReward, level: number, track: PassTrack): number {
  let grantedCoins = 0;

  if (reward.coins && reward.coins > 0) {
    grantedCoins += reward.coins;
    addCookieCoins(reward.coins, `cookie pass lvl ${level} (${track})`);
  }

  if (reward.crateRange) {
    const rolled = rollCrateCoins(reward.crateRange);
    grantedCoins += rolled;
    addCookieCoins(rolled, `opened ${reward.title} (lvl ${level})`);
  }

  if (reward.adFreeHours && reward.adFreeHours > 0) {
    activateAdFreePass(reward.adFreeHours * 60 * 60 * 1000);
    notifyToast(`+${reward.adFreeHours}h ad-free pass activated!`, "success");
  }

  if (reward.coinBoostMins && reward.coinBoostMins > 0) {
    activateCoinBoost(reward.coinBoostMins * 60 * 1000);
    notifyToast(`2x coin boost active for +${reward.coinBoostMins}m!`, "success");
  }

  if (reward.masterDays && reward.masterDays > 0) {
    extendCookieMasterDays(reward.masterDays);
    notifyToast(`+${reward.masterDays} days added to your cookie master pass!`, "success");
  }

  const st = getGamePassState();
  let stateChanged = false;
  let nextTokens = st.prankTokens;
  let nextXpBoostUntil = st.xpBoostUntil;

  if (reward.prankTokens && reward.prankTokens > 0) {
    nextTokens += reward.prankTokens;
    stateChanged = true;
    notifyToast(
      `+${reward.prankTokens} free shop prank token${reward.prankTokens > 1 ? "s" : ""} added!`,
      "success"
    );
  }

  if (reward.xpBoostMins && reward.xpBoostMins > 0) {
    const base = Math.max(nextXpBoostUntil, Date.now());
    nextXpBoostUntil = base + reward.xpBoostMins * 60 * 1000;
    stateChanged = true;
    notifyToast(`2x pass xp boost active for +${reward.xpBoostMins}m!`, "success");
  }

  if (stateChanged) {
    saveGamePassState({
      ...st,
      prankTokens: nextTokens,
      xpBoostUntil: nextXpBoostUntil,
    });
  }

  return grantedCoins;
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

  applyRewardEffects(reward, level, track);

  return { claimed: true, reward };
}

export function claimAllReadyPassRewards(): { count: number; totalCoins: number } {
  const st = getGamePassState();
  const currentLevel = computeLevelFromXp(st.xp);
  const proActive = isCookieMasterActive();
  const claimedSet = new Set(st.claimedIds);

  const toClaim: Array<{ level: number; track: PassTrack; reward: PassReward }> = [];

  for (const def of GAME_PASS_LEVELS) {
    if (def.level > currentLevel) break;
    const tracks: PassTrack[] = proActive ? ["free", "pro"] : ["free"];
    for (const track of tracks) {
      const reward = track === "pro" ? def.pro : def.free;
      if (claimedSet.has(reward.id)) continue;
      claimedSet.add(reward.id);
      toClaim.push({ level: def.level, track, reward });
    }
  }

  if (toClaim.length === 0) return { count: 0, totalCoins: 0 };

  saveGamePassState({
    ...st,
    claimedIds: Array.from(claimedSet),
  });

  let totalCoins = 0;
  for (const item of toClaim) {
    totalCoins += applyRewardEffects(item.reward, item.level, item.track);
  }

  return { count: toClaim.length, totalCoins };
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
    awardGamePassXp(5, "site", { silent: true });
  }, SITE_USAGE_TICK_MS);
}

if (typeof window !== "undefined") {
  startSiteUsageXpTracker();
}
