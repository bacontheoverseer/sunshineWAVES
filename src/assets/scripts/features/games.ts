import { encodeMochiUrl, normalizeGameHistoryUrl } from "../core/utils.ts";
import { fetchAllLuminGames, type LuminRawGame } from "./luminSdk.ts";

export interface GameEntry {
  id: string | number;
  name: string;
  author?: string | undefined;
  coverUrl: string;
  gameUrl: string;
  isExternal: boolean;
  featured: boolean;
  sourceKey: string;
  _nameLc?: string;
  _authorLc?: string;
}

interface SourceConfig {
  selenite: { games: string; assets: string };
  "gn-math": { zones: string; covers: string; html: string };
  velara: { games: string; assets: string };
  truffled: { games: string; base: string };
  seraph: { games: string; base: string };
  "wasm.rip": { games: string; base: string };
  tglsc: { games: string; base: string };
  "3kh0": { games: string; gitlabRawBase: string };
  luminsdk: { sdk: string };
  alexr: { games: string; base: string };
  ccported: { games: string; cdnBase: string };
  easyfun: { games: string };
}

type SourceKey = keyof SourceConfig;

interface SeleniteGame {
  name: string;
  directory: string;
  image?: string;
}

interface VelaraGame {
  title: string;
  location?: string;
  image?: string;
  grdmca?: unknown;
}

interface EdurocksGame {
  id?: string | number;
  legacyId?: string | number;
  name: string;
  url: string;
  img: string;
}

interface TruffledGame {
  name: string;
  url: string;
  thumbnail: string;
  frameType: string;
}

interface GnMathZone {
  id: string | number;
  name: string;
  author?: string;
  cover: string;
  url: string;
  featured?: boolean;
}

interface WasmRipGame {
  id?: string | number;
  name: string;
  gameUrl: string;
  imageUrl?: string;
  porter?: string;
  featured?: boolean;
}

interface TglscGame {
  id?: string | number;
  title?: string;
  name?: string;
  slug?: string;
  thumbnail?: string;
  game_url?: string;
  embed_url?: string;
}

interface ThreeKhoGame {
  link: string;
  imgSrc?: string;
  title: string;
}

interface AlexrGame {
  title?: string;
  name?: string;
  img?: string;
  path?: string;
  category?: string;
  description?: string;
}

interface CcportedGame {
  id: string;
  name: string;
  thumb?: string;
  category?: string;
}

interface EasyFunGame {
  id: string;
  name: string;
  playUrl: string;
  cover?: string;
}

const SOURCE_CONFIG: SourceConfig = {
  selenite: {
    games: "/!!/" + encodeMochiUrl("https://selenite.cc/resources/games.json") + "/",
    assets: "https://selenite.cc/resources/semag/",
  },
  "gn-math": {
    zones: "/!!/" + encodeMochiUrl("https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json") + "/",
    covers: "https://cdn.jsdelivr.net/gh/freebuisness/covers@main",
    html: "https://cdn.jsdelivr.net/gh/freebuisness/html@main",
  },
  velara: {
    games: "/!!/" + encodeMochiUrl("https://velara.cc/data/games.json") + "/",
    assets: "https://velara.cc",
  },
  truffled: {
    games: "/!!/" + encodeMochiUrl("https://truffled.lol/js/json/g.json") + "/",
    base: "https://truffled.lol",
  },
  seraph: {
    games: "/!!/" + encodeMochiUrl("https://seraph-delta.vercel.app/games/index.html") + "/",
    base: "https://seraph-delta.vercel.app",
  },
  "wasm.rip": {
    games: "/!!/" + encodeMochiUrl("https://wasm.rip/games.json") + "/",
    base: "https://wasm.rip",
  },
  tglsc: {
    games: "/!!/" + encodeMochiUrl("https://glseries.net/api/cdn") + "/",
    base: "https://glseries.net",
  },
  "3kh0": {
    games: "/!!/" + encodeMochiUrl("https://raw.githubusercontent.com/3kh0/3kh0-lite/main/config/games.json") + "/",
    gitlabRawBase: "https://gitlab.com/3kh0/3kh0-assets/-/raw/main/",
  },
  luminsdk: {
    sdk: "https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js",
  },
  alexr: {
    games: "/!!/" + encodeMochiUrl("https://dskjfoisjfsjio.github.io/games.json") + "/",
    base: "https://dskjfoisjfsjio.github.io/",
  },
  ccported: {
    games: "/api/ccported/games.json",
    cdnBase: "https://cdn.jsdelivr.net/gh/ccported/games@main/",
  },
  easyfun: {
    games: "/api/easyfun/games.json",
  },
};

const ALL_SOURCE_KEYS: SourceKey[] = [
  "selenite",
  "gn-math",
  "velara",
  "truffled",
  "seraph",
  "wasm.rip",
  "tglsc",
  "3kh0",
  "luminsdk",
  "alexr",
  "ccported",
  "easyfun",
];

export function isCombineGameSourcesEnabled(): boolean {
  try {
    return localStorage.getItem("combineGameSources") !== "false";
  } catch {
    return true;
  }
}

let allGames: GameEntry[] = [];
let gameDataPromise: Promise<GameEntry[]> | null = null;

function getSourceKey(): SourceKey {
  const source = localStorage.getItem("gameSource") || "selenite";
  if (!ALL_SOURCE_KEYS.includes(source as SourceKey)) {
    return "selenite";
  }
  return source as SourceKey;
}

type CacheScopeKey = SourceKey | "all";

function getActiveCacheScope(): CacheScopeKey {
  return isCombineGameSourcesEnabled() ? "all" : getSourceKey();
}

const GAMES_DISK_CACHE = "sunshine-games-v11";
const GAMES_CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(scope: CacheScopeKey = getActiveCacheScope()): string {
  return `sunshine-game-cache-v11-${scope}`;
}

function getPersistentCacheRequestUrl(scope: CacheScopeKey): string {
  return `/__cache/games/${scope}.json`;
}

async function readPersistentGamesCache(
  scope: CacheScopeKey,
): Promise<{ games: GameEntry[]; fresh: boolean } | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(GAMES_DISK_CACHE);
    const match = await cache.match(getPersistentCacheRequestUrl(scope));
    if (!match) return null;
    const savedAt = Number(match.headers.get("X-Cached-At") || "0");
    const games = (await match.json()) as GameEntry[];
    if (!Array.isArray(games) || games.length === 0) return null;
    return {
      games: applySearchCacheFields(games),
      fresh: Date.now() - savedAt < GAMES_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writePersistentGamesCache(scope: CacheScopeKey, games: GameEntry[]): void {
  if (typeof caches === "undefined") return;
  void caches
    .open(GAMES_DISK_CACHE)
    .then((cache) =>
      cache.put(
        getPersistentCacheRequestUrl(scope),
        new Response(JSON.stringify(games), {
          headers: {
            "Content-Type": "application/json",
            "X-Cached-At": String(Date.now()),
          },
        }),
      ),
    )
    .catch(() => {});
}

function applySearchCacheFields(games: GameEntry[]): GameEntry[] {
  for (const g of games) {
    g._nameLc = (g.name || "").toLowerCase();
    g._authorLc = (g.author || "").toLowerCase();
  }
  return games;
}

function saveToCache(scope: CacheScopeKey, games: GameEntry[]): GameEntry[] {
  try {
    sessionStorage.setItem(getCacheKey(scope), JSON.stringify(games));
  } catch (e) {
    console.warn("unable to cache games", e);
  }
  writePersistentGamesCache(scope, games);
  return games;
}

function mapSeleniteGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as SeleniteGame[]) : [];
  return games
    .filter((g) => g && g.name && g.directory)
    .map((game) => {
      const gamePath = String(game.directory).replace(/^\/+/, "");
      const imagePath = String(game.image || "").replace(/^\/+/, "");
      const finalUrl = `${SOURCE_CONFIG.selenite.assets}${gamePath}`;
      const finalCover = imagePath
        ? `${SOURCE_CONFIG.selenite.assets}${gamePath}/${imagePath}`
        : "";
      return {
        id: game.name,
        name: game.name,
        coverUrl: finalCover ? `/!cover!/${encodeMochiUrl(finalCover)}/` : "",
        gameUrl: finalUrl,
        isExternal: false,
        featured: false,
        sourceKey: "selenite",
      } satisfies GameEntry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapVelaraGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as VelaraGame[]) : [];
  return games
    .filter(
      (g) =>
        g &&
        g.title &&
        g.title !== "!!DMCA" &&
        g.title !== "!!Game Request" &&
        !g.title.includes("[!]") &&
        !(g.location?.includes("astra")),
    )
    .map((game) => {
      let finalUrl = game.location ?? "";
      if (finalUrl && !finalUrl.startsWith("http")) {
        finalUrl = SOURCE_CONFIG.velara.assets + (finalUrl.startsWith("/") ? "" : "/") + finalUrl;
      }
      const finalCover = `${SOURCE_CONFIG.velara.assets}/${game.image ?? ""}`;
      return {
        id: game.title,
        name: game.title,
        coverUrl: `/!cover!/${encodeMochiUrl(finalCover)}/`,
        gameUrl: finalUrl,
        isExternal: !game.location && !!game.grdmca,
        featured: false,
        sourceKey: "velara",
      } satisfies GameEntry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapEdurocksGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as EdurocksGame[]) : [];
  return games
    .map((game) => {
      const base = SOURCE_CONFIG.edurocks.assets + "/";
      const finalUrl = game.url.startsWith("http")
        ? game.url
        : base + game.url.replace(/^\.\//, "");
      const finalCover = game.img.startsWith("http")
        ? game.img
        : base + game.img.replace(/^\.\//, "");
      return {
        id: game.id ?? game.legacyId ?? game.name,
        name: game.name,
        coverUrl: `/!cover!/${encodeMochiUrl(finalCover)}/`,
        gameUrl: finalUrl,
        isExternal: false,
        featured: false,
        sourceKey: "edurocks",
      } satisfies GameEntry;
    })
    .filter((g) => !g.name.includes("[!]"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapGnMathGames(data: unknown): GameEntry[] {
  const zones = Array.isArray(data) ? (data as GnMathZone[]) : [];
  return zones
    .map((zone) => {
      const rawUrl = String(zone.url || "").trim();
      const isHtmlZone = rawUrl.includes("{HTML_URL}");
      const isExternal = rawUrl ? /^https?:\/\//.test(rawUrl) && !isHtmlZone : false;
      const finalUrl = isHtmlZone
        ? rawUrl.replace("{HTML_URL}", SOURCE_CONFIG["gn-math"].html)
        : isExternal
          ? rawUrl
          : `https://gn-math.dev/?id=${zone.id}`;
      const finalCover = zone.cover.replace("{COVER_URL}", SOURCE_CONFIG["gn-math"].covers);
      return {
        id: zone.id,
        name: zone.name,
        author: zone.author,
        coverUrl: `/!cover!/${encodeMochiUrl(finalCover)}/`,
        gameUrl: finalUrl,
        isExternal,
        featured: zone.featured ?? false,
        sourceKey: "gn-math",
      } satisfies GameEntry;
    })
    .filter((g) => !g.name.includes("[!]") && !g.name.startsWith("Chat Bot"))
    .sort((a, b) =>
      a.featured === b.featured ? a.name.localeCompare(b.name) : a.featured ? -1 : 1,
    );
}

function mapTruffledGames(data: unknown): GameEntry[] {
  const wrapper = data as { games?: TruffledGame[] };
  const games = Array.isArray(wrapper?.games) ? wrapper.games : [];
  const base = SOURCE_CONFIG.truffled.base;
  return games
    .filter((g) => g && g.name && g.url)
    .map((game) => {
      const gameUrl = game.url.startsWith("http")
        ? game.url
        : base + (game.url.startsWith("/") ? "" : "/") + game.url;
      const thumbUrl = game.thumbnail
        ? (game.thumbnail.startsWith("http")
          ? game.thumbnail
          : base + (game.thumbnail.startsWith("/") ? "" : "/") + game.thumbnail)
        : "";
      return {
        id: game.name,
        name: game.name,
        coverUrl: thumbUrl ? `/!cover!/${encodeMochiUrl(thumbUrl)}/` : "",
        gameUrl,
        isExternal: false,
        featured: false,
        sourceKey: "truffled",
      } satisfies GameEntry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapSeraphGames(html: string): GameEntry[] {
  if (!html || typeof html !== "string") return [];
  const gamesBase = `${SOURCE_CONFIG.seraph.base}/games/`;
  const re =
    /<a[^>]+href="([^"]+)"[^>]*>\s*<div[^>]*class="button"[^>]*style="[^"]*background-image:\s*url\(['"]?([^'")]+)['"]?\)[^"]*"[^>]*>[\s\S]*?<h2>([^<]+)<\/h2>[\s\S]*?<\/a>/gi;
  const out: GameEntry[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const rawHref = (m[1] || "").trim();
    const rawImg = (m[2] || "").trim();
    const name = (m[3] || "").trim();
    if (!rawHref || !name || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;
    let gameUrl = "";
    let coverUrl = "";
    try {
      gameUrl = new URL(rawHref, gamesBase).href;
    } catch {
      continue;
    }
    if (seen.has(gameUrl)) continue;
    seen.add(gameUrl);
    if (rawImg) {
      try {
        const resolvedImg = new URL(rawImg, gamesBase).href;
        coverUrl = `/!cover!/${encodeMochiUrl(resolvedImg)}/`;
      } catch {}
    }
    out.push({
      id: name,
      name,
      coverUrl,
      gameUrl,
      isExternal: false,
      featured: false,
      sourceKey: "seraph",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function mapWasmRipGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as WasmRipGame[]) : [];
  const base = `${SOURCE_CONFIG["wasm.rip"].base}/`;
  return games
    .filter((g) => g && g.name && g.gameUrl)
    .map((game) => {
      let gameUrl = game.gameUrl;
      try {
        gameUrl = new URL(game.gameUrl, base).href;
      } catch {}
      let coverUrl = "";
      if (game.imageUrl) {
        try {
          const resolvedImg = new URL(game.imageUrl, base).href;
          coverUrl = `/!cover!/${encodeMochiUrl(resolvedImg)}/`;
        } catch {}
      }
      return {
        id: game.id ?? game.name,
        name: game.name,
        author: game.porter,
        coverUrl,
        gameUrl,
        isExternal: false,
        featured: Boolean(game.featured),
        sourceKey: "wasm.rip",
      } satisfies GameEntry;
    })
    .sort((a, b) =>
      a.featured === b.featured ? a.name.localeCompare(b.name) : a.featured ? -1 : 1,
    );
}

function mapTglscGames(data: unknown): GameEntry[] {
  const wrapper = data as { data?: TglscGame[] } | TglscGame[];
  const games = Array.isArray(wrapper)
    ? wrapper
    : Array.isArray(wrapper?.data)
      ? wrapper.data
      : [];
  const base = `${SOURCE_CONFIG.tglsc.base}/`;
  return games
    .filter((g) => g && (g.title || g.name) && (g.embed_url || g.game_url))
    .map((game) => {
      const name = String(game.title || game.name || "").trim();
      const rawUrl = String(game.embed_url || game.game_url || "").trim();
      let gameUrl = rawUrl;
      try {
        gameUrl = new URL(rawUrl, base).href;
      } catch {}
      let coverUrl = "";
      if (game.thumbnail) {
        try {
          const resolvedImg = new URL(game.thumbnail, base).href;
          coverUrl = `/!cover!/${encodeMochiUrl(resolvedImg)}/`;
        } catch {}
      }
      return {
        id: game.id ?? game.slug ?? name,
        name,
        coverUrl,
        gameUrl,
        isExternal: false,
        featured: false,
        sourceKey: "tglsc",
      } satisfies GameEntry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapThreeKhoGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as ThreeKhoGame[]) : [];
  const rawBase = SOURCE_CONFIG["3kh0"].gitlabRawBase;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return games
    .filter((g) => g && g.title && g.link)
    .map((game) => {
      const relLink = String(game.link).replace(/^\/+/, "").replace(/^projects\//, "");
      const relImg = String(game.imgSrc || "").replace(/^\/+/, "").replace(/^projects\//, "");
      const gameUrl = `${origin}/api/3kh0/${relLink}`;
      const coverUrl = relImg ? `/!cover!/${encodeMochiUrl(`${rawBase}${relImg}`)}/` : "";
      return {
        id: relLink || game.title,
        name: String(game.title).trim(),
        coverUrl,
        gameUrl,
        isExternal: false,
        featured: false,
        sourceKey: "3kh0",
      } satisfies GameEntry;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapLuminGames(games: LuminRawGame[]): GameEntry[] {
  if (!Array.isArray(games)) return [];
  const seen = new Set<string>();
  const out: GameEntry[] = [];
  for (const game of games) {
    if (!game || !game.id || !game.name) continue;
    const id = String(game.id).trim();
    const name = String(game.name).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      author: game.category ? String(game.category).trim() : undefined,
      coverUrl: game.image_token ? `luminsdk-img://${game.image_token}` : "",
      gameUrl: `luminsdk://${encodeURIComponent(id)}`,
      isExternal: false,
      featured: false,
      sourceKey: "luminsdk",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function mapAlexrGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as AlexrGame[]) : [];
  const base = SOURCE_CONFIG.alexr.base;
  const seen = new Set<string>();
  const out: GameEntry[] = [];
  for (const game of games) {
    const title = String(game?.title || game?.name || "").trim();
    const rawPath = String(game?.path || "").trim();
    if (!title || !rawPath) continue;
    let gameUrl = "";
    try {
      gameUrl = new URL(rawPath, base).href;
    } catch {
      continue;
    }
    if (seen.has(gameUrl)) continue;
    seen.add(gameUrl);
    let coverUrl = "";
    const rawImg = String(game?.img || "").trim();
    if (rawImg) {
      try {
        const resolvedImg = new URL(rawImg, base).href;
        coverUrl = `/!cover!/${encodeMochiUrl(resolvedImg)}/`;
      } catch {}
    }
    out.push({
      id: rawPath || title,
      name: title,
      author: game?.category ? String(game.category).trim() : undefined,
      coverUrl,
      gameUrl,
      isExternal: false,
      featured: false,
      sourceKey: "alexr",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function mapCcportedGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as CcportedGame[]) : [];
  const cdnBase = SOURCE_CONFIG.ccported.cdnBase;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const seen = new Set<string>();
  const out: GameEntry[] = [];
  for (const game of games) {
    const id = String(game?.id || "").trim();
    const name = String(game?.name || "").trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const thumbRel = String(game?.thumb || "/thumb.jpg").trim();
    const thumbPath = thumbRel.startsWith("/") ? thumbRel : `/${thumbRel}`;
    const coverUrl = `/!cover!/${encodeMochiUrl(`${cdnBase}${id}${thumbPath}`)}/`;
    const gameUrl = `${origin}/api/ccported/${encodeURIComponent(id)}/index.html`;
    out.push({
      id,
      name,
      author: game?.category ? String(game.category).trim() : undefined,
      coverUrl,
      gameUrl,
      isExternal: false,
      featured: false,
      sourceKey: "ccported",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function mapEasyFunGames(data: unknown): GameEntry[] {
  const games = Array.isArray(data) ? (data as EasyFunGame[]) : [];
  const seen = new Set<string>();
  const out: GameEntry[] = [];
  for (const game of games) {
    const id = String(game?.id || "").trim();
    const name = String(game?.name || "").trim();
    const playUrl = String(game?.playUrl || "").trim();
    if (!id || !name || !playUrl || seen.has(id)) continue;
    seen.add(id);
    const rawCover = String(game?.cover || "").trim();
    const coverUrl = rawCover ? `/!cover!/${encodeMochiUrl(rawCover)}/` : "";
    out.push({
      id,
      name,
      author: "cloud",
      coverUrl,
      gameUrl: playUrl,
      isExternal: false,
      featured: false,
      sourceKey: "easyfun",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function fetchWithTimeout(url: string, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
  });
}

export function fetchGameData(onProgress?: (games: GameEntry[]) => void): Promise<GameEntry[]> {
  if (gameDataPromise) {
    if (onProgress && allGames.length > 0) onProgress(allGames);
    return gameDataPromise;
  }

  const combineAll = isCombineGameSourcesEnabled();
  const scope: CacheScopeKey = combineAll ? "all" : getSourceKey();
  const cacheKey = getCacheKey(scope);

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      allGames = applySearchCacheFields(JSON.parse(cached) as GameEntry[]);
      return Promise.resolve(allGames);
    }
  } catch {
    sessionStorage.removeItem(cacheKey);
  }

  const ok = (res: Response) => (res.ok ? res.json() : Promise.reject(res.statusText));
  const okText = (res: Response) => (res.ok ? res.text() : Promise.reject(res.statusText));

  const fetchSourceGames: Record<SourceKey, () => Promise<GameEntry[]>> = {
    velara: () => fetchWithTimeout(SOURCE_CONFIG.velara.games).then(ok).then(mapVelaraGames),
    selenite: () => fetchWithTimeout(SOURCE_CONFIG.selenite.games).then(ok).then(mapSeleniteGames),
    "gn-math": () => fetchWithTimeout(SOURCE_CONFIG["gn-math"].zones).then(ok).then(mapGnMathGames),
    truffled: () => fetchWithTimeout(SOURCE_CONFIG.truffled.games).then(ok).then(mapTruffledGames),
    seraph: () => fetchWithTimeout(SOURCE_CONFIG.seraph.games).then(okText).then(mapSeraphGames),
    "wasm.rip": () => fetchWithTimeout(SOURCE_CONFIG["wasm.rip"].games).then(ok).then(mapWasmRipGames),
    tglsc: () => fetchWithTimeout(SOURCE_CONFIG.tglsc.games).then(ok).then(mapTglscGames),
    "3kh0": () => fetchWithTimeout(SOURCE_CONFIG["3kh0"].games).then(ok).then(mapThreeKhoGames),
    luminsdk: () => fetchAllLuminGames().then(mapLuminGames),
    alexr: () => fetchWithTimeout(SOURCE_CONFIG.alexr.games).then(ok).then(mapAlexrGames),
    ccported: () => fetchWithTimeout(SOURCE_CONFIG.ccported.games, 15000).then(ok).then(mapCcportedGames),
    easyfun: () => fetchWithTimeout(SOURCE_CONFIG.easyfun.games, 15000).then(ok).then(mapEasyFunGames),
  };

  const fetchFresh = async (isRetry = false): Promise<GameEntry[]> => {
    if (combineAll) {
      const byDedupKey = new Map<string, GameEntry>();
      let succeededSources = 0;

      const buildSnapshot = (): GameEntry[] =>
        applySearchCacheFields(Array.from(byDedupKey.values())).sort((a, b) =>
          a.featured === b.featured ? a.name.localeCompare(b.name) : a.featured ? -1 : 1,
        );

      const addBatch = (batch: GameEntry[]) => {
        let changed = false;
        for (const g of batch) {
          const normName = String(g.name || "").trim().toLowerCase();
          const dedupKey =
            g.sourceKey === "easyfun"
              ? `easyfun:${g.id}`
              : normName || `${g.sourceKey}:${g.gameUrl}`;
          const existing = byDedupKey.get(dedupKey);
          if (!existing) {
            byDedupKey.set(dedupKey, g);
            changed = true;
          } else if (g.sourceKey === "wasm.rip" && existing.sourceKey !== "wasm.rip") {
            // Always prioritize wasm.rip PC ports so PC games count & filter stay 100% consistent
            byDedupKey.set(dedupKey, g);
            changed = true;
          }
        }
        if (changed) {
          const snapshot = buildSnapshot();
          allGames = snapshot;
          if (onProgress) onProgress(snapshot);
        }
      };

      await Promise.allSettled(
        ALL_SOURCE_KEYS.map((key) =>
          fetchSourceGames[key]()
            .then((list) => {
              if (Array.isArray(list) && list.length > 0) {
                succeededSources++;
                addBatch(list);
              }
            })
            .catch(() => {}),
        ),
      );

      if (byDedupKey.size === 0) {
        if (!isRetry) {
          await new Promise((r) => setTimeout(r, 600));
          return fetchFresh(true);
        }
        throw new Error("All game sources failed to load");
      }
      const finalMerged = buildSnapshot();
      allGames = finalMerged;
      // Only persist to disk/session cache when most sources succeeded so partial timeouts never lock in a low count
      if (succeededSources >= Math.max(1, ALL_SOURCE_KEYS.length - 1)) {
        saveToCache("all", finalMerged);
      }
      return finalMerged;
    }

    const source = scope as SourceKey;
    try {
      const list = await (fetchSourceGames[source] ?? fetchSourceGames.selenite)();
      const ready = saveToCache(source, applySearchCacheFields(list));
      allGames = ready;
      return ready;
    } catch (err) {
      if (!isRetry) {
        await new Promise((r) => setTimeout(r, 600));
        return fetchFresh(true);
      }
      throw err;
    }
  };

  gameDataPromise = readPersistentGamesCache(scope)
    .then((diskHit) => {
      if (diskHit) {
        allGames = diskHit.games;
        if (!diskHit.fresh) {
          void fetchFresh().catch(() => {});
        }
        return diskHit.games;
      }
      return fetchFresh();
    })
    .catch(() => fetchFresh());

  gameDataPromise.catch((err) => {
    console.error("game fetch failed:", err);
    gameDataPromise = null;
  });

  return gameDataPromise;
}

export function resetGameCache(): void {
  const scopes: CacheScopeKey[] = ["all", getSourceKey()];
  allGames = [];
  gameDataPromise = null;
  for (const sc of scopes) {
    try {
      sessionStorage.removeItem(getCacheKey(sc));
    } catch {}
    if (typeof caches !== "undefined") {
      void caches
        .open(GAMES_DISK_CACHE)
        .then((cache) => cache.delete(getPersistentCacheRequestUrl(sc)))
        .catch(() => {});
    }
  }
}

export function getGameDisplayLabel(realUrl: string): string | null {
  try {
    if (!realUrl || !allGames.length) return null;

    let match = allGames.find((g) => g.gameUrl === realUrl);

    if (!match) {
      const normalized = normalizeGameHistoryUrl(realUrl);
      if (normalized) {
        match = allGames.find((g) => normalizeGameHistoryUrl(g.gameUrl) === normalized);
      }
    }

    if (!match) {
      try {
        const u = new URL(realUrl);
        if (u.hostname.includes("gn-math.dev")) {
          const id = u.searchParams.get("id");
          if (id) {
            const rawId = String(id).trim();
            const decodedId = decodeURIComponent(rawId);
            match = allGames.find(
              (g) =>
                g.sourceKey === "gn-math" &&
                (String(g.id) === rawId || String(g.id) === decodedId),
            );
            if (!match) {
              const numericId = rawId.match(/\d+/)?.[0];
              if (numericId) {
                match = allGames.find(
                  (g) => g.sourceKey === "gn-math" && String(g.id) === numericId,
                );
              }
            }
          }
        }
      } catch {}
    }

    if (!match) return null;

    const sourceKey = (
      match.sourceKey ||
      localStorage.getItem("gameSource") ||
      "selenite"
    ).toLowerCase();

    return `game: ${String(match.name || match.id || realUrl).toLowerCase()} / source: ${sourceKey}`;
  } catch {
    return null;
  }
}
