import { encodeMochiUrl, normalizeGameHistoryUrl } from "../core/utils.ts";

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
};

const ALL_SOURCE_KEYS: SourceKey[] = [
  "selenite",
  "gn-math",
  "velara",
  "truffled",
  "seraph",
  "wasm.rip",
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

const GAMES_DISK_CACHE = "sunshine-games-v3";
const GAMES_CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(scope: CacheScopeKey = getActiveCacheScope()): string {
  return `sunshine-game-cache-v3-${scope}`;
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

function fetchWithTimeout(url: string, timeoutMs = 7000): Promise<Response> {
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
  };

  const fetchFresh = async (isRetry = false): Promise<GameEntry[]> => {
    if (combineAll) {
      const merged: GameEntry[] = [];
      const seenKeys = new Set<string>();

      const addBatch = (batch: GameEntry[]) => {
        let added = 0;
        for (const g of batch) {
          const normName = String(g.name || "").trim().toLowerCase();
          const dedupKey = normName || `${g.sourceKey}:${g.gameUrl}`;
          if (seenKeys.has(dedupKey)) continue;
          seenKeys.add(dedupKey);
          merged.push(g);
          added++;
        }
        if (added > 0) {
          const snapshot = applySearchCacheFields([...merged]).sort((a, b) =>
            a.featured === b.featured ? a.name.localeCompare(b.name) : a.featured ? -1 : 1,
          );
          allGames = snapshot;
          if (onProgress) onProgress(snapshot);
        }
      };

      await Promise.allSettled(
        ALL_SOURCE_KEYS.map((key) =>
          fetchSourceGames[key]()
            .then((list) => {
              if (Array.isArray(list) && list.length > 0) addBatch(list);
            })
            .catch(() => {}),
        ),
      );

      if (merged.length === 0) {
        if (!isRetry) {
          await new Promise((r) => setTimeout(r, 600));
          return fetchFresh(true);
        }
        throw new Error("All game sources failed to load");
      }
      merged.sort((a, b) =>
        a.featured === b.featured ? a.name.localeCompare(b.name) : a.featured ? -1 : 1,
      );
      const ready = saveToCache("all", applySearchCacheFields(merged));
      allGames = ready;
      return ready;
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
