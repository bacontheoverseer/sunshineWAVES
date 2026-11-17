import { useEffect, useState } from "preact/hooks";

export const CHROMEBOOK_MODE_STORAGE_KEY = "chromebookMode";

const pendingStorageWrites = new Map<string, string>();
let storageFlushTimerId: number | null = null;
const activeGameSources = new Set<string>();
let lifecycleBound = false;
let bodyClassObserver: MutationObserver | null = null;

function ensureBodyClassObserver(enabled: boolean): void {
  if (typeof document === "undefined" || !document.body) return;
  if (!enabled) {
    if (bodyClassObserver) {
      bodyClassObserver.disconnect();
      bodyClassObserver = null;
    }
    return;
  }
  if (bodyClassObserver || typeof MutationObserver === "undefined") return;
  bodyClassObserver = new MutationObserver(() => {
    syncGameActivePerfMode();
  });
  bodyClassObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

export function isChromebookModeEnabled(): boolean {
  try {
    if (
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("chromebook-mode")
    ) {
      return true;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(CHROMEBOOK_MODE_STORAGE_KEY) === "true";
    }
  } catch {}
  return false;
}

export function isGameActivePerfMode(): boolean {
  try {
    return (
      isChromebookModeEnabled() &&
      typeof document !== "undefined" &&
      document.body.classList.contains("game-active-perf-mode")
    );
  } catch {
    return false;
  }
}

export function flushBatchedLocalStorageWrites(): void {
  if (storageFlushTimerId !== null && typeof window !== "undefined") {
    window.clearTimeout(storageFlushTimerId);
    storageFlushTimerId = null;
  }
  if (pendingStorageWrites.size === 0 || typeof localStorage === "undefined") {
    pendingStorageWrites.clear();
    return;
  }
  const entries = Array.from(pendingStorageWrites.entries());
  pendingStorageWrites.clear();
  for (const [key, value] of entries) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
}

function ensureStorageLifecycleFlush(): void {
  if (lifecycleBound || typeof window === "undefined") return;
  lifecycleBound = true;
  window.addEventListener("pagehide", flushBatchedLocalStorageWrites);
  window.addEventListener("beforeunload", flushBatchedLocalStorageWrites);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        flushBatchedLocalStorageWrites();
      }
    });
  }
}

export function batchedLocalStorageGet(key: string): string | null {
  if (pendingStorageWrites.has(key)) {
    return pendingStorageWrites.get(key) ?? null;
  }
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function batchedLocalStorageSet(
  key: string,
  value: string,
  delayMs = 500,
): void {
  if (!isChromebookModeEnabled()) {
    pendingStorageWrites.delete(key);
    try {
      localStorage.setItem(key, value);
    } catch {}
    return;
  }

  ensureStorageLifecycleFlush();
  pendingStorageWrites.set(key, value);
  if (storageFlushTimerId === null && typeof window !== "undefined") {
    storageFlushTimerId = window.setTimeout(() => {
      storageFlushTimerId = null;
      flushBatchedLocalStorageWrites();
    }, Math.max(16, delayMs));
  }
}

export function setGameSourceActive(source: string, active: boolean): void {
  if (active) {
    activeGameSources.add(source);
  } else {
    activeGameSources.delete(source);
  }
  syncGameActivePerfMode();
}

export function syncGameActivePerfMode(): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const enabled = isChromebookModeEnabled();
  ensureBodyClassObserver(enabled);
  if (!enabled) {
    if (document.body.classList.contains("game-active-perf-mode")) {
      document.body.classList.remove("game-active-perf-mode");
    }
    return false;
  }

  let hasActiveGame = activeGameSources.size > 0;
  if (!hasActiveGame && document.body.classList.contains("browser-view")) {
    try {
      const app = (window as any).sunshineApp;
      const activeTab = app?.getActiveTab?.();
      const splitPair = app?.splitPair;
      const isSplit = document.body.classList.contains("split-view");
      if (activeTab?.isGame || activeTab?.isUrlLoaded) {
        hasActiveGame = true;
      } else if (isSplit && Array.isArray(app?.tabs) && splitPair) {
        hasActiveGame = app.tabs.some(
          (t: any) =>
            (t.id === splitPair.left || t.id === splitPair.right) &&
            (t.isGame || t.isUrlLoaded),
        );
      } else if (document.querySelector("#iframe-container iframe")) {
        hasActiveGame = true;
      }
    } catch {
      hasActiveGame = Boolean(document.querySelector("#iframe-container iframe"));
    }
  }

  const currentlyActive = document.body.classList.contains("game-active-perf-mode");
  if (currentlyActive !== hasActiveGame) {
    document.body.classList.toggle("game-active-perf-mode", hasActiveGame);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("gamePerfModeChanged", { detail: { active: hasActiveGame } }),
      );
    }
  }
  return hasActiveGame;
}

export function setChromebookModeEnabled(enabled: boolean): void {
  const next = Boolean(enabled);
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("chromebook-mode", next);
  }
  ensureBodyClassObserver(next);
  if (!next) {
    flushBatchedLocalStorageWrites();
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("game-active-perf-mode");
    }
  } else {
    syncGameActivePerfMode();
  }

  if (typeof window !== "undefined") {
    const detail = { enabled: next };
    window.dispatchEvent(new CustomEvent("chromebookModeUpdated", { detail }));
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent("chromebookModeUpdated", { detail }));
    }
  }
}

export function useChromebookMode(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => isChromebookModeEnabled());

  useEffect(() => {
    const sync = () => setEnabled(isChromebookModeEnabled());
    sync();

    const onCustom = () => sync();
    const onCloudSync = () => {
      try {
        const stored = localStorage.getItem(CHROMEBOOK_MODE_STORAGE_KEY) === "true";
        if (stored !== document.documentElement.classList.contains("chromebook-mode")) {
          setChromebookModeEnabled(stored);
        } else {
          sync();
        }
      } catch {
        sync();
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === CHROMEBOOK_MODE_STORAGE_KEY) {
        onCloudSync();
      }
    };

    window.addEventListener("chromebookModeUpdated", onCustom);
    document.addEventListener("chromebookModeUpdated", onCustom);
    window.addEventListener("cloudsync-restored", onCloudSync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("chromebookModeUpdated", onCustom);
      document.removeEventListener("chromebookModeUpdated", onCustom);
      window.removeEventListener("cloudsync-restored", onCloudSync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return enabled;
}

export function teardownIframeElement(
  iframe: HTMLIFrameElement | null | undefined,
  forceDeepCleanup = isChromebookModeEnabled(),
): void {
  if (!iframe) return;
  try {
    iframe.dataset.proxyUnavailable = "";
    iframe.dataset.pendingProxyUrl = "";
  } catch {}

  if (forceDeepCleanup) {
    try {
      const win = iframe.contentWindow as any;
      const doc = iframe.contentDocument;
      if (doc) {
        try {
          doc.querySelectorAll("audio, video").forEach((el) => {
            try {
              const media = el as HTMLMediaElement;
              media.pause();
              media.removeAttribute("src");
              media.load();
            } catch {}
          });
        } catch {}
        try {
          doc.querySelectorAll("canvas").forEach((canvas) => {
            try {
              const gl =
                canvas.getContext("webgl2") ||
                canvas.getContext("webgl") ||
                canvas.getContext("experimental-webgl");
              const loseCtx = (gl as any)?.getExtension?.("WEBGL_lose_context");
              loseCtx?.loseContext?.();
            } catch {}
          });
        } catch {}
      }
      if (win?.AudioContext || win?.webkitAudioContext) {
        // Browsing away to about:blank drops child audio contexts
      }
    } catch {}
  }

  try {
    if (iframe.contentWindow) {
      iframe.contentWindow.stop();
    }
  } catch {}

  try {
    iframe.src = "about:blank";
  } catch {
    try {
      iframe.setAttribute("src", "about:blank");
    } catch {}
  }
}
