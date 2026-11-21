import { encodeMochiUrl } from "../core/utils.ts";

export interface LuminRawGame {
  id: string;
  name: string;
  image_token?: string;
  category?: string;
}

interface LuminGamesResponse {
  games?: LuminRawGame[];
  total?: number;
  page?: number;
  pages?: number;
}

interface LuminGlobal {
  init(config: {
    headless?: boolean;
    container?: string | HTMLElement;
    theme?: "dark" | "light" | "auto";
    onError?: (err: Error) => void;
  }): Promise<void>;
  getGames(opts?: {
    page?: number;
    limit?: number;
    q?: string;
  }): Promise<LuminGamesResponse>;
  getGameUrl(gameId: string): Promise<{
    url: string;
    meta?: { id?: string; name?: string; category?: string };
  }>;
  getImageUrl(token: string): Promise<string>;
}

const LUMIN_CDN_URL = "https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js";
const LUMIN_PROXY_URL = `/!!/${encodeMochiUrl(LUMIN_CDN_URL)}/`;

let luminReadyPromise: Promise<LuminGlobal> | null = null;
const imageBlobCache = new Map<string, string>();
const imageInFlight = new Map<string, Promise<string>>();

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (val) => {
        window.clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function loadScript(src: string, timeoutMs = 8000): Promise<void> {
  return withTimeout(
    new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[data-lumin-sdk="true"]`);
      if (existing && (window as unknown as { Lumin?: LuminGlobal }).Lumin) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.luminSdk = "true";
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error(`Failed to load LuminSDK script from ${src}`));
      };
      document.head.appendChild(script);
    }),
    timeoutMs,
    "LuminSDK script load",
  );
}

export function ensureLuminReady(timeoutMs = 12000): Promise<LuminGlobal> {
  if (luminReadyPromise) return luminReadyPromise;

  const initFlow = async (): Promise<LuminGlobal> => {
    const win = window as unknown as { Lumin?: LuminGlobal };
    if (!win.Lumin) {
      try {
        await loadScript(LUMIN_CDN_URL, 7000);
      } catch {
        await loadScript(LUMIN_PROXY_URL, 7000);
      }
    }
    const lumin = win.Lumin;
    if (!lumin || typeof lumin.init !== "function") {
      throw new Error("LuminSDK global not available after script load");
    }
    await withTimeout(
      lumin.init({ headless: true }),
      timeoutMs,
      "LuminSDK headless init",
    );
    return lumin;
  };

  luminReadyPromise = initFlow().catch((err) => {
    luminReadyPromise = null;
    throw err;
  });

  return luminReadyPromise;
}

export async function fetchAllLuminGames(totalTimeoutMs = 14000): Promise<LuminRawGame[]> {
  const deadline = Date.now() + totalTimeoutMs;
  const lumin = await ensureLuminReady(Math.min(9000, totalTimeoutMs));

  const pageSize = 200;
  const firstPage = await withTimeout(
    lumin.getGames({ page: 1, limit: pageSize }),
    Math.max(2500, deadline - Date.now()),
    "LuminSDK getGames page 1",
  );

  const collected: LuminRawGame[] = Array.isArray(firstPage?.games)
    ? [...firstPage.games]
    : [];

  const totalPages = Number(firstPage?.pages || 1);
  if (totalPages <= 1 || collected.length === 0) {
    return collected;
  }

  const remainingPages: number[] = [];
  for (let p = 2; p <= totalPages; p++) {
    remainingPages.push(p);
  }

  const CONCURRENCY = 4;
  for (let i = 0; i < remainingPages.length; i += CONCURRENCY) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 1200) break;

    const batch = remainingPages.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((page) =>
        withTimeout(
          lumin.getGames({ page, limit: pageSize }),
          Math.min(5000, remainingMs),
          `LuminSDK getGames page ${page}`,
        ),
      ),
    );

    for (const res of results) {
      if (res.status === "fulfilled" && Array.isArray(res.value?.games)) {
        collected.push(...res.value.games);
      }
    }
  }

  return collected;
}

export function getCachedLuminImageUrl(imageToken: string): string | null {
  return imageBlobCache.get(imageToken) ?? null;
}

export function resolveLuminImageUrl(imageToken: string): Promise<string> {
  if (!imageToken) return Promise.reject(new Error("Missing image token"));

  const cached = imageBlobCache.get(imageToken);
  if (cached) return Promise.resolve(cached);

  const existing = imageInFlight.get(imageToken);
  if (existing) return existing;

  const task = (async () => {
    const lumin = await ensureLuminReady(10000);
    const blobUrl = await withTimeout(
      lumin.getImageUrl(imageToken),
      8000,
      "LuminSDK getImageUrl",
    );
    if (!blobUrl || typeof blobUrl !== "string") {
      throw new Error("Empty LuminSDK image URL");
    }
    imageBlobCache.set(imageToken, blobUrl);
    return blobUrl;
  })().finally(() => {
    imageInFlight.delete(imageToken);
  });

  imageInFlight.set(imageToken, task);
  return task;
}

export async function resolveLuminGameUrl(gameId: string): Promise<string> {
  const lumin = await ensureLuminReady(10000);
  const res = await withTimeout(
    lumin.getGameUrl(gameId),
    10000,
    "LuminSDK getGameUrl",
  );
  if (!res?.url || typeof res.url !== "string") {
    throw new Error("LuminSDK did not return a playable URL");
  }
  return res.url;
}
