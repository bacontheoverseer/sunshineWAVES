/**
 * Operation Cookie — Game Achievement Scraper, Leveling & Profile Logging
 * Scrapes active games (DOM popups/toasts, localStorage diffs, postMessage/SDK events,
 * and console logs) to automatically detect and log achievements to the user's profile.
 */

import { store } from "../state/store.ts";
import { getActiveUser, isWebsiteNotGame } from "./cookieCoins.ts";

export interface UserAchievement {
  id: string;
  game: string;
  title: string;
  description?: string;
  source: "scraped" | "sdk" | "milestone";
  icon?: string;
  unlockedAt: number;
}

export interface AchievementProgress {
  level: number;
  count: number;
  currentLevelAt: number;
  nextLevelAt: number;
  progressPct: number;
  remainingToNext: number;
  tier: "starter" | "bronze" | "silver" | "gold" | "platinum" | "mythic";
}

export interface UserAchievementsSummary {
  count: number;
  level: number;
  currentLevelAt: number;
  nextLevelAt: number;
  items: UserAchievement[];
}

const STORAGE_KEY_PREFIX = "cookie_user_achievements_v1:";
const MAX_LOCAL_ACHIEVEMENTS = 250;

/**
 * Thresholds:
 * Lv 0: 0
 * Lv 1: 1, Lv 2: 3, Lv 3: 6, Lv 4: 10, Lv 5: 15,
 * Lv 6: 21, Lv 7: 28, Lv 8: 36, Lv 9: 45, Lv 10: 55
 * Lv 11+: +10 per level
 */
export function getThresholdForLevel(level: number): number {
  const lv = Math.max(0, Math.floor(level));
  if (lv <= 10) return (lv * (lv + 1)) / 2;
  return 55 + (lv - 10) * 10;
}

export function computeAchievementProgress(rawCount: number): AchievementProgress {
  const count = Math.max(0, Math.floor(Number(rawCount) || 0));
  let level = 0;
  while (getThresholdForLevel(level + 1) <= count) {
    level++;
    if (level >= 999) break;
  }
  const currentLevelAt = getThresholdForLevel(level);
  const nextLevelAt = getThresholdForLevel(level + 1);
  const span = Math.max(1, nextLevelAt - currentLevelAt);
  const progressPct = Math.max(
    0,
    Math.min(100, Math.round(((count - currentLevelAt) / span) * 100))
  );
  const remainingToNext = Math.max(0, nextLevelAt - count);

  let tier: AchievementProgress["tier"] = "starter";
  if (level >= 12) tier = "mythic";
  else if (level >= 8) tier = "platinum";
  else if (level >= 5) tier = "gold";
  else if (level >= 3) tier = "silver";
  else if (level >= 1) tier = "bronze";

  return {
    level,
    count,
    currentLevelAt,
    nextLevelAt,
    progressPct,
    remainingToNext,
    tier,
  };
}

function slugify(str: string): string {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function cleanText(raw: string, maxLen: number): string {
  return String(raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function getStorageKeyForUser(username: string): string {
  return `${STORAGE_KEY_PREFIX}${String(username || "guest").trim().toLowerCase()}`;
}

export function getLocalAchievements(username?: string): UserAchievement[] {
  const user = (username || getActiveUser() || "").trim();
  if (!user) return [];
  try {
    const raw = localStorage.getItem(getStorageKeyForUser(user));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a) => a && typeof a.id === "string" && typeof a.title === "string")
      .slice(0, MAX_LOCAL_ACHIEVEMENTS);
  } catch {
    return [];
  }
}

function saveLocalAchievements(username: string, list: UserAchievement[]): void {
  try {
    localStorage.setItem(
      getStorageKeyForUser(username),
      JSON.stringify(list.slice(0, MAX_LOCAL_ACHIEVEMENTS))
    );
  } catch {}
}

function getCloudAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const token =
      localStorage.getItem("auth_token") ||
      localStorage.getItem("cloudsync_token") ||
      localStorage.getItem("sunshine_cloudsync_token") ||
      "";
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
      headers["X-CloudSync-Token"] = token;
    }
  } catch {}
  return headers;
}

function notifyAchievementToast(game: string, title: string, levelUp?: number): void {
  const w = window as unknown as { showToast?: (t: string, m?: string) => void };
  if (typeof w.showToast === "function") {
    const suffix = levelUp ? ` · achievement lv ${levelUp}!` : "";
    w.showToast("success", `achievement unlocked (${game}): ${title}${suffix}`);
  }
}

export async function unlockAchievement(input: {
  game: string;
  title: string;
  description?: string;
  source?: "scraped" | "sdk" | "milestone";
  icon?: string;
  silent?: boolean;
}): Promise<{ unlocked: boolean; achievement?: UserAchievement; level?: number }> {
  const user = getActiveUser();
  if (!user || /^guest/i.test(user)) {
    // Still store locally for guests, but skip server sync
  }
  const cleanGame = cleanText(input.game, 64);
  const cleanTitle = cleanText(input.title, 80);
  const cleanDesc = input.description ? cleanText(input.description, 160) : "";
  if (!cleanGame || !cleanTitle || cleanTitle.length < 2) {
    return { unlocked: false };
  }
  if (isWebsiteNotGame(cleanGame)) {
    return { unlocked: false };
  }

  const id = `${slugify(cleanGame)}:${slugify(cleanTitle)}`;
  if (!id || id === ":") return { unlocked: false };

  const currentUser = user || "guest";
  const existing = getLocalAchievements(currentUser);
  if (existing.some((a) => a.id === id)) {
    return { unlocked: false };
  }

  const prevLevel = computeAchievementProgress(existing.length).level;
  const ach: UserAchievement = {
    id,
    game: cleanGame.toLowerCase(),
    title: cleanTitle,
    description: cleanDesc || undefined,
    source: input.source || "scraped",
    icon: input.icon || "fa-trophy",
    unlockedAt: Date.now(),
  };

  const nextList = [ach, ...existing].slice(0, MAX_LOCAL_ACHIEVEMENTS);
  saveLocalAchievements(currentUser, nextList);
  const nextProgress = computeAchievementProgress(nextList.length);
  const leveledUp = nextProgress.level > prevLevel ? nextProgress.level : undefined;

  if (!input.silent) {
    notifyAchievementToast(ach.game, ach.title, leveledUp);
  }

  try {
    window.dispatchEvent(
      new CustomEvent("cookie-achievements-changed", {
        detail: { username: currentUser, achievement: ach, progress: nextProgress },
      })
    );
  } catch {}

  // Persist to backend if signed into CloudSync
  if (user && !/^guest/i.test(user)) {
    try {
      await fetch("/api/achievements/unlock", {
        method: "POST",
        headers: getCloudAuthHeaders(),
        body: JSON.stringify({
          username: user,
          game: ach.game,
          title: ach.title,
          description: ach.description || "",
          source: ach.source,
          icon: ach.icon,
          unlockedAt: ach.unlockedAt,
        }),
      });
    } catch {
      // Kept safely in localStorage; will sync on next unlock
    }
  }

  return { unlocked: true, achievement: ach, level: nextProgress.level };
}

const NON_GAME_MILESTONE_TITLES = new Set([
  "game studio",
  "studio",
  "cloudplay 2p party",
  "operation cookie",
  "browsing",
]);

/**
 * Universal gameplay milestones so even canvas-only WebGL games earn profile achievements.
 */
export function checkGameplayMilestoneAchievements(
  gameTitle: string,
  sessionSeconds: number,
  uniqueGamesCount: number
): void {
  const g = cleanText(gameTitle, 64).toLowerCase();
  if (!g || isWebsiteNotGame(g) || NON_GAME_MILESTONE_TITLES.has(g)) return;

  if (sessionSeconds >= 60) {
    void unlockAchievement({
      game: g,
      title: `first steps in ${g}`,
      description: `played ${g} for over 1 minute`,
      source: "milestone",
      icon: "fa-gamepad",
    });
  }
  if (sessionSeconds >= 900) {
    void unlockAchievement({
      game: g,
      title: `${g} regular`,
      description: `played ${g} for 15 minutes`,
      source: "milestone",
      icon: "fa-fire",
    });
  }
  if (sessionSeconds >= 3600) {
    void unlockAchievement({
      game: g,
      title: `${g} master`,
      description: `played ${g} for 1 full hour`,
      source: "milestone",
      icon: "fa-crown",
    });
  }
  if (uniqueGamesCount >= 3) {
    void unlockAchievement({
      game: "operation cookie",
      title: "arcade explorer",
      description: "played 3 different games on operation cookie",
      source: "milestone",
      icon: "fa-compass",
    });
  }
  if (uniqueGamesCount >= 10) {
    void unlockAchievement({
      game: "operation cookie",
      title: "library regular",
      description: "played 10 different games on operation cookie",
      source: "milestone",
      icon: "fa-layer-group",
    });
  }
}

/* ============================================================================
 * LIVE GAME ACHIEVEMENT SCRAPER
 * Watches active game iframes for:
 *  1) DOM achievement toasts / popups / advancement banners
 *  2) localStorage achievement key diffs (Cookie Clicker, Unity, Godot, etc.)
 *  3) window.postMessage / CustomEvent SDK unlocks
 *  4) console.log / console.info achievement notifications
 * ========================================================================== */

const ACH_HEADER_REGEX =
  /\b(achievement\s+(?:unlocked|get|earned|complete|completed|achieved)|advancement\s+(?:made|unlocked)|trophy\s+(?:unlocked|earned)|medal\s+(?:unlocked|earned)|badge\s+(?:unlocked|earned)|new\s+(?:achievement|trophy|medal)|milestone\s+(?:reached|unlocked)|secret\s+(?:unlocked|found))\b/i;

const ACH_CLASS_HINT_REGEX =
  /(achiev|troph|medal|advanc|unlock|milestone|badge-pop|toast|notify|notification|popup)/i;

const ACH_STORAGE_KEY_REGEX =
  /(achiev|troph|medal|advanc|badge|unlock|milestone|cookieclicker)/i;

const IGNORED_TITLES = new Set([
  "achievement",
  "achievements",
  "achievement unlocked",
  "achievement get",
  "advancement made",
  "trophy unlocked",
  "medal earned",
  "badge unlocked",
  "new achievement",
  "unlocked",
  "close",
  "ok",
  "continue",
  "claim",
]);

function extractAchievementFromElement(el: Element): { title: string; description?: string } | null {
  if (!(el instanceof HTMLElement)) return null;
  const rawText = (el.innerText || el.textContent || "").trim();
  if (!rawText || rawText.length < 6 || rawText.length > 320) return null;

  const hasHeaderMatch = ACH_HEADER_REGEX.test(rawText);
  const classAndId = `${el.className || ""} ${el.id || ""} ${el.getAttribute("data-type") || ""}`;
  const hasClassHint = ACH_CLASS_HINT_REGEX.test(String(classAndId));

  if (!hasHeaderMatch && !hasClassHint) return null;
  if (!hasHeaderMatch) {
    // Require explicit achievement wording if only class matched, to avoid scraping random UI toasts
    if (!/(achiev|advanc|trophy|medal|unlocked)/i.test(rawText)) return null;
  }

  // Split into clean lines
  const lines = rawText
    .split(/\r?\n|[:–—|•]+/)
    .map((l) => cleanText(l, 90))
    .filter((l) => l.length >= 2);

  if (lines.length === 0) return null;

  // Find the first meaningful line that isn't just the generic header ("Achievement Unlocked!")
  let title = "";
  let description = "";
  for (const line of lines) {
    const lower = line.toLowerCase().replace(/[!.:]+$/g, "").trim();
    if (!lower || IGNORED_TITLES.has(lower) || ACH_HEADER_REGEX.test(lower)) {
      // Check if header + title are on the same line, e.g. "Achievement Unlocked - Speed Demon"
      const stripped = line.replace(ACH_HEADER_REGEX, "").replace(/^[\s:!\-–—]+/, "").trim();
      if (stripped.length >= 3 && !IGNORED_TITLES.has(stripped.toLowerCase())) {
        if (!title) title = stripped;
        else if (!description) description = stripped;
      }
      continue;
    }
    if (!title) {
      title = line;
    } else if (!description && line !== title) {
      description = line;
      break;
    }
  }

  if (!title || title.length < 3 || title.length > 80) return null;
  if (IGNORED_TITLES.has(title.toLowerCase())) return null;
  // Filter out pure numbers or UI button strings
  if (/^\d+(\s*\/\s*\d+)?$/.test(title)) return null;

  return { title, description: description || undefined };
}

function extractUnlockedKeysFromStorageValue(rawValue: string): string[] {
  if (!rawValue || rawValue.length > 200000) return [];
  const found: string[] = [];
  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string" && item.trim().length >= 2 && item.trim().length <= 80) {
          found.push(item.trim());
        } else if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const isUnlocked =
            obj.unlocked === true ||
            obj.earned === true ||
            obj.achieved === true ||
            obj.completed === true ||
            obj.won === 1 ||
            obj.won === true;
          const name = String(obj.title || obj.name || obj.label || obj.id || "").trim();
          if (isUnlocked && name.length >= 2 && name.length <= 80) {
            found.push(name);
          }
        }
      }
    } else if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v === true || v === 1 || (typeof v === "object" && v !== null && (v as Record<string, unknown>).unlocked === true)) {
          if (k.length >= 2 && k.length <= 80 && !/^(true|false|null|version|count|total)$/i.test(k)) {
            found.push(k);
          }
        }
      }
    }
  } catch {
    // Non-JSON string (e.g. comma-separated achievement names)
    if (rawValue.length < 4000 && rawValue.includes(",")) {
      const parts = rawValue.split(",").map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 60);
      if (parts.length <= 200) found.push(...parts);
    }
  }
  return found;
}

function prettifyStorageAchName(raw: string): string {
  return cleanText(
    raw
      .replace(/^(ach_|achievement_|trophy_|medal_|badge_)/i, "")
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2"),
    70
  );
}

interface WatchedContext {
  doc: Document;
  win: Window;
  gameTitle: string;
  observer: MutationObserver | null;
  seenDomKeys: Set<string>;
  storageBaseline: Map<string, Set<string>>;
  storageInitialized: boolean;
}

let watcherStarted = false;
const watchedDocs = new WeakMap<Document, WatchedContext>();
const hookedConsoles = new WeakSet<Window>();

function getActiveGameInfo(): { gameTitle: string; iframe: HTMLIFrameElement | null } {
  const activeTab = store.getActiveTab();
  if (activeTab?.isGame && activeTab.iframe && !isWebsiteNotGame(activeTab.title)) {
    const title = String(activeTab.title || "")
      .replace(/^game:\s*/i, "")
      .split("/")[0]
      .trim()
      .toLowerCase();
    if (title) return { gameTitle: title, iframe: activeTab.iframe };
  }
  const studioIframe = document.querySelector<HTMLIFrameElement>(
    "#studio-play-iframe, .studio-play-iframe"
  );
  if (studioIframe) {
    const title =
      studioIframe.getAttribute("data-game-title") ||
      studioIframe.getAttribute("title") ||
      "studio game";
    return { gameTitle: title.toLowerCase(), iframe: studioIframe };
  }
  return { gameTitle: "", iframe: null };
}

function collectSameOriginDocs(
  iframe: HTMLIFrameElement | null,
  out: Array<{ win: Window; doc: Document }>,
  depth = 0
): void {
  if (!iframe || depth > 2) return;
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (win && doc) {
      out.push({ win, doc });
      const nested = Array.from(doc.querySelectorAll("iframe"));
      for (const child of nested) {
        collectSameOriginDocs(child, out, depth + 1);
      }
    }
  } catch {
    // Cross-origin frame — skip safely
  }
}

function handleScrapedElement(ctx: WatchedContext, el: Element): void {
  const extracted = extractAchievementFromElement(el);
  if (!extracted) return;
  const dedupeKey = `${ctx.gameTitle}:${extracted.title.toLowerCase()}`;
  if (ctx.seenDomKeys.has(dedupeKey)) return;
  ctx.seenDomKeys.add(dedupeKey);
  void unlockAchievement({
    game: ctx.gameTitle,
    title: extracted.title,
    description: extracted.description,
    source: "scraped",
    icon: "fa-trophy",
  });
}

function attachConsoleHook(win: Window, gameTitle: string): void {
  if (hookedConsoles.has(win)) return;
  hookedConsoles.add(win);
  try {
    const c = (win as unknown as { console?: Console }).console;
    if (!c) return;
    for (const method of ["log", "info"] as const) {
      const orig = c[method];
      if (typeof orig !== "function") continue;
      c[method] = function (...args: unknown[]) {
        try {
          const joined = args
            .map((a) => (typeof a === "string" ? a : typeof a === "object" && a ? JSON.stringify(a).slice(0, 180) : String(a)))
            .join(" ");
          if (ACH_HEADER_REGEX.test(joined)) {
            const stripped = cleanText(
              joined.replace(ACH_HEADER_REGEX, "").replace(/^[\s:!\-–—\[\]]+/, ""),
              76
            );
            if (stripped.length >= 3 && !IGNORED_TITLES.has(stripped.toLowerCase())) {
              void unlockAchievement({
                game: gameTitle,
                title: stripped,
                source: "scraped",
                icon: "fa-trophy",
              });
            }
          }
        } catch {}
        return orig.apply(this, args);
      };
    }
  } catch {}
}

function scanStorageDiff(ctx: WatchedContext): void {
  try {
    const ls = ctx.win.localStorage;
    if (!ls) return;
    // Skip if same localStorage as parent Operation Cookie shell (avoid scraping OC's own keys)
    const isParentStorage = ls === window.localStorage;

    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (!key) continue;
      if (isParentStorage && (key.startsWith("cookie_") || key.startsWith("sunshine_") || key.startsWith("cloudsync_"))) {
        continue;
      }
      if (!ACH_STORAGE_KEY_REGEX.test(key)) continue;

      const val = ls.getItem(key);
      if (!val) continue;
      const items = extractUnlockedKeysFromStorageValue(val);
      const prevSet = ctx.storageBaseline.get(key);

      if (!ctx.storageInitialized || !prevSet) {
        ctx.storageBaseline.set(key, new Set(items));
        continue;
      }

      for (const item of items) {
        if (!prevSet.has(item)) {
          prevSet.add(item);
          const pretty = prettifyStorageAchName(item);
          if (pretty.length >= 3 && !IGNORED_TITLES.has(pretty.toLowerCase())) {
            void unlockAchievement({
              game: ctx.gameTitle,
              title: pretty,
              source: "scraped",
              icon: "fa-award",
            });
          }
        }
      }
    }
    ctx.storageInitialized = true;
  } catch {
    // Storage access blocked
  }
}

function ensureWatchingDoc(win: Window, doc: Document, gameTitle: string): void {
  let ctx = watchedDocs.get(doc);
  if (ctx) {
    ctx.gameTitle = gameTitle;
    scanStorageDiff(ctx);
    return;
  }

  ctx = {
    doc,
    win,
    gameTitle,
    observer: null,
    seenDomKeys: new Set<string>(),
    storageBaseline: new Map<string, Set<string>>(),
    storageInitialized: false,
  };
  watchedDocs.set(doc, ctx);

  attachConsoleHook(win, gameTitle);
  scanStorageDiff(ctx);

  // Attach MutationObserver to catch live achievement toasts/banners
  try {
    const target = doc.body || doc.documentElement;
    if (target) {
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "childList") {
            m.addedNodes.forEach((node) => {
              if (node instanceof Element) {
                handleScrapedElement(ctx!, node);
                const nested = node.querySelectorAll?.(
                  '[class*="achiev" i], [id*="achiev" i], [class*="trophy" i], [class*="medal" i], [class*="toast" i], [class*="advanc" i]'
                );
                nested?.forEach((child) => handleScrapedElement(ctx!, child));
              }
            });
          } else if (m.type === "attributes" && m.target instanceof Element) {
            handleScrapedElement(ctx!, m.target);
          }
        }
      });
      obs.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "style"],
      });
      ctx.observer = obs;
    }
  } catch {}
}

export function startAchievementWatcher(): void {
  if (watcherStarted || typeof window === "undefined") return;
  watcherStarted = true;

  // 1) Listen for postMessage SDK achievement payloads from game iframes
  window.addEventListener("message", (event: MessageEvent) => {
    try {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const obj = data as Record<string, unknown>;
      const typeStr = String(obj.type || obj.event || obj.action || "").toLowerCase();
      const isAchEvent =
        typeStr.includes("achievement") ||
        typeStr.includes("medal") ||
        typeStr.includes("trophy") ||
        typeStr.includes("advancement");
      if (!isAchEvent) return;

      const { gameTitle } = getActiveGameInfo();
      const game = cleanText(String(obj.game || obj.gameTitle || gameTitle || ""), 64);
      const title = cleanText(
        String(obj.title || obj.name || obj.achievement || obj.medal || obj.label || ""),
        80
      );
      const description = cleanText(String(obj.description || obj.desc || ""), 160);
      if (game && title) {
        void unlockAchievement({
          game,
          title,
          description: description || undefined,
          source: "sdk",
          icon: "fa-trophy",
        });
      }
    } catch {}
  });

  // 2) Poll active game iframe every 4s to attach observers & diff localStorage
  window.setInterval(() => {
    try {
      const { gameTitle, iframe } = getActiveGameInfo();
      if (!gameTitle || !iframe) return;
      const docs: Array<{ win: Window; doc: Document }> = [];
      collectSameOriginDocs(iframe, docs, 0);
      for (const { win, doc } of docs) {
        ensureWatchingDoc(win, doc, gameTitle);
      }
    } catch {}
  }, 4000);
}
