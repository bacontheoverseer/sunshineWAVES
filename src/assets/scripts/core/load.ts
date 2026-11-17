import { attachSearchLight } from "./searchLight.ts";

declare global {
  interface Window {
    sunshineUpdater: {
      successEl: HTMLElement | null;
      overlay: HTMLElement | null;
      closeBtn: HTMLElement | null;
      init(): void;
      showSuccess(): void;
      hideSuccess(calledByOther: boolean): void;
      performUpdate(): Promise<void>;
      checkVersion(): Promise<void>;
    };
    SharePromoter: {
      shareEl: HTMLElement | null;
      overlay: HTMLElement | null;
      closeBtn: HTMLElement | null;
      init(): void;
      showWarningPrompt(): boolean;
      hideWarningPrompt(calledByOther: boolean): void;
    };
    toggleSettingsMenu?: () => void;
    hideBookmarkPrompt?: (calledByOther: boolean) => void;
    __sunshineUpdatePollerStarted?: boolean;
    __sunshineStuffData?: Promise<Record<string, unknown> | null>;
  }
}

type StuffResponse = {
  version: string;
  build?: string;
};

function parseStuffResponse(input: unknown): StuffResponse {
  if (!input || typeof input !== "object") {
    throw new Error("invalid /api/stuff response payload");
  }

  const payload = input as Record<string, unknown>;
  if (typeof payload.version !== "string" || payload.version.length === 0) {
    throw new Error("invalid /api/stuff response: version must be a non-empty string");
  }

  if (payload.build !== undefined && typeof payload.build !== "string") {
    throw new Error("invalid /api/stuff response: build must be a string when present");
  }

  const parsed: StuffResponse = { version: payload.version };
  if (typeof payload.build === "string") parsed.build = payload.build;
  return parsed;
}

const SCRAMJET_IDB_STORES = [
  "config",
  "cookies",
  "redirectTrackers",
  "referrerPolicies",
  "publicSuffixList",
] as const;

let _scramjetInitPromise: Promise<void> | null = null;
let _scramjetControllerCreated = false;
let _pageIdbGuardInstalled = false;
const _openPageScramjetDbs = new Set<IDBDatabase>();

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (val) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve(val);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}

function ensureScramjetObjectStores(db: IDBDatabase): void {
  for (const store of SCRAMJET_IDB_STORES) {
    if (!db.objectStoreNames.contains(store)) {
      db.createObjectStore(store);
    }
  }
}

function hasAllScramjetStores(db: IDBDatabase): boolean {
  return SCRAMJET_IDB_STORES.every((store) => db.objectStoreNames.contains(store));
}

function installPageScramjetIdbGuard(): void {
  if (_pageIdbGuardInstalled) return;
  if (typeof IDBFactory === "undefined" || !IDBFactory.prototype?.open) return;
  _pageIdbGuardInstalled = true;
  const origOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function patchedPageScramjetOpen(
    name: string,
    version?: number,
  ) {
    const req =
      version !== undefined
        ? origOpen.call(this, name, version)
        : origOpen.call(this, name);
    if (name === "$scramjet") {
      req.addEventListener("upgradeneeded", (ev) => {
        try {
          const db = (ev.target as IDBOpenDBRequest | null)?.result || req.result;
          if (db) ensureScramjetObjectStores(db);
        } catch {}
      });
      req.addEventListener("success", () => {
        try {
          const db = req.result;
          if (!db) return;
          _openPageScramjetDbs.add(db);
          db.addEventListener("close", () => _openPageScramjetDbs.delete(db));
          // Release page handle immediately on versionchange so healing deletes never deadlock
          db.addEventListener("versionchange", () => {
            try {
              db.close();
            } catch {}
            _openPageScramjetDbs.delete(db);
          });
        } catch {}
      });
    }
    return req;
  };
}

async function closeAllScramjetConnections(): Promise<void> {
  for (const db of _openPageScramjetDbs) {
    try {
      db.close();
    } catch {}
  }
  _openPageScramjetDbs.clear();

  if (!("serviceWorker" in navigator)) return;
  const targets: ServiceWorker[] = [];
  if (navigator.serviceWorker.controller) {
    targets.push(navigator.serviceWorker.controller);
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration("/b/s/r/");
    for (const sw of [reg?.active, reg?.waiting, reg?.installing]) {
      if (sw && !targets.includes(sw)) targets.push(sw);
    }
  } catch {}

  await Promise.all(
    targets.map(
      (sw) =>
        new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 200);
          try {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
              window.clearTimeout(timer);
              try {
                channel.port1.close();
              } catch {}
              resolve();
            };
            sw.postMessage({ type: "sunshine-close-scramjet-idb" }, [
              channel.port2,
            ]);
          } catch {
            window.clearTimeout(timer);
            resolve();
          }
        }),
    ),
  );
}

function probeScramjetIdb(timeoutMs = 1200): Promise<"ok" | "heal" | "timeout"> {
  if (typeof indexedDB === "undefined") return Promise.resolve("ok");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (status: "ok" | "heal" | "timeout") => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(status);
      }
    };
    const timer = window.setTimeout(() => finish("timeout"), timeoutMs);
    try {
      const req = indexedDB.open("$scramjet");
      req.onupgradeneeded = () => {
        try {
          if (req.result) ensureScramjetObjectStores(req.result);
        } catch {}
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const valid = db.version === 1 && hasAllScramjetStores(db);
          try {
            db.close();
          } catch {}
          _openPageScramjetDbs.delete(db);
          finish(valid ? "ok" : "heal");
        } catch {
          finish("heal");
        }
      };
      req.onerror = () => finish("heal");
      req.onblocked = () => finish("heal");
    } catch {
      finish("heal");
    }
  });
}

function deleteCorruptScramjetDb(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (deleted: boolean) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(deleted);
      }
    };
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    try {
      const req = indexedDB.deleteDatabase("$scramjet");
      req.onsuccess = () => finish(true);
      req.onerror = () => finish(false);
      // Do not resolve early on onblocked: let closeAllScramjetConnections unblock onsuccess
      req.onblocked = () => {
        void closeAllScramjetConnections();
      };
    } catch {
      finish(false);
    }
  });
}

async function waitForScramjetController(timeoutMs = 3500): Promise<
  (new (config: unknown) => { init(): Promise<void> }) | null
> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loader = (window as unknown as Record<string, unknown>)[
      "$scramjetLoadController"
    ];
    if (typeof loader === "function") {
      try {
        const controllerFactory = (loader as () => Record<string, unknown>)();
        if (controllerFactory?.["ScramjetController"]) {
          return controllerFactory["ScramjetController"] as new (config: unknown) => {
            init(): Promise<void>;
          };
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
}

function notifyScramjetWorkerReady(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .getRegistration("/b/s/r/")
    .then((reg) => {
      try {
        const worker = reg?.active || reg?.waiting;
        worker?.postMessage({ type: "sunshine-scramjet-ready" });
      } catch {}
    })
    .catch(() => {});
}

export async function ensureScramjetReady(): Promise<void> {
  if (
    typeof window !== "undefined" &&
    (!window.isSecureContext || !("serviceWorker" in navigator))
  ) {
    return;
  }
  installPageScramjetIdbGuard();
  if (_scramjetInitPromise) return _scramjetInitPromise;
  _scramjetInitPromise = (async () => {
    try {
      const ScramjetControllerRef = await waitForScramjetController(3500);
      if (!ScramjetControllerRef) return;
      const createController = () =>
        new ScramjetControllerRef({
          prefix: "/b/s/r/",
          files: {
            wasm: "/b/s/jetty.wasm.wasm",
            all: "/b/s/jetty.all.js",
            sync: "/b/s/jetty.sync.js",
          },
          flags: {
            sourcemaps: false,
            captureErrors: false,
            rewriterLogs: false,
            strictRewrites: false,
            destructureRewrites: false,
          },
        });

      const probeStatus = await probeScramjetIdb(1200);
      if (probeStatus === "heal") {
        await closeAllScramjetConnections();
        await deleteCorruptScramjetDb(1500);
      }

      let initialized = false;
      const runInitWithTimeout = async () => {
        const controller = createController() as {
          init(): Promise<void>;
          db?: IDBDatabase;
        };
        const ok = await withTimeout(
          controller.init().then(
            () => true,
            () => false,
          ),
          3000,
          false,
        );
        if (!ok) {
          try {
            controller.db?.close();
          } catch {}
        }
        return ok;
      };

      initialized = await runInitWithTimeout();
      if (!initialized) {
        // Recover cleanly from stale/corrupt/blocked $scramjet IndexedDB stores
        await closeAllScramjetConnections();
        const deleted = await deleteCorruptScramjetDb(1500);
        if (deleted) {
          initialized = await runInitWithTimeout();
        }
      }
      if (initialized) {
        _scramjetControllerCreated = true;
        notifyScramjetWorkerReady();
      }
    } catch {}
  })();
  try {
    await _scramjetInitPromise;
  } finally {
    if (!_scramjetControllerCreated) {
      _scramjetInitPromise = null;
    }
  }
}

{
  const w = window as unknown as Record<string, unknown>;
  w["ensureScramjetReady"] = ensureScramjetReady;
  if (localStorage.getItem("backend") !== "ultraviolet") {
    w["scramjetReady"] = ensureScramjetReady();
  } else {
    w["scramjetReady"] = Promise.resolve();
  }
}

let _scrollShadowInitialized = false;
let _loadInitialized = false;

function setupScrollShadow(): void {
  if (_scrollShadowInitialized) return;
  _scrollShadowInitialized = true;
  const meow = document.querySelector(".meow");
  const threshold = 48;
  let raf: number | null = null;

  const readScrollTop = (): number =>
    Math.max(window.scrollY || 0, meow?.scrollTop || 0);

  const updateShadow = (): void => {
    raf = null;
    const isGamesView = document.body.classList.contains("games-view");
    const isWatchView = document.body.classList.contains("watch-view");
    const shouldShow =
      (isGamesView || isWatchView) && readScrollTop() > threshold;
    document.body.classList.toggle("has-scroll-shadow", shouldShow);
  };

  const requestUpdate = (): void => {
    if (raf) return;
    raf = requestAnimationFrame(updateShadow);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  meow?.addEventListener("scroll", requestUpdate, { passive: true });

  requestUpdate();
}

export function initializeLoad(): void {
  if (_loadInitialized) return;
  _loadInitialized = true;

  document
    .querySelectorAll<HTMLElement>(".search-bar")
    .forEach(attachSearchLight);
  setupScrollShadow();

  window.sunshineUpdater = {
    successEl: null,
    overlay: document.getElementById("overlay"),
    closeBtn: null,
    init() {
      this.successEl = document.getElementById("updateSuccess");
      if (!this.successEl) {
        this.successEl = document.createElement("div");
        this.successEl.id = "updateSuccess";
        document.body.appendChild(this.successEl);
        this.successEl.innerHTML = `
            <i class="fa-solid fa-check-circle" style="font-size:40px;margin-bottom:15px;"></i>
            <label>Successfully updated</label>
            <p>if you don't see any changes or the site breaks, do ctrl + shift + r a few times!</p>
            <button class="prompt-close-btn" id="updateSuccessClose">Okay</button>
          `;
      }
      this.closeBtn = document.getElementById("updateSuccessClose");

      this.closeBtn?.addEventListener("click", () => this.hideSuccess(false));
      if (localStorage.getItem("justUpdated") === "true") {
        localStorage.removeItem("justUpdated");
        this.showSuccess();
      }

      document.addEventListener("keydown", (e: KeyboardEvent) => {
        if (
          e.key === "Escape" &&
          this.successEl &&
          this.successEl.style.display === "block" &&
          !this.successEl.classList.contains("fade-out")
        ) {
          this.hideSuccess(false);
        }
      });
    },
    showSuccess() {
      this.overlay = document.getElementById("overlay");
      if (!this.successEl || !this.overlay) return;

      if (!this.overlay.dataset["sunshineUpdateOverlayBound"]) {
        this.overlay.addEventListener("click", (e: MouseEvent) => {
          const activeOverlay = document.getElementById("overlay");
          if (!activeOverlay || e.target !== activeOverlay) return;
          if (document.getElementById("updateSuccess")?.style.display === "block") {
            window.sunshineUpdater.hideSuccess(false);
          }
        });
        this.overlay.dataset["sunshineUpdateOverlayBound"] = "true";
      }

      if (
        window.toggleSettingsMenu &&
        document.getElementById("settings-menu")?.classList.contains("open")
      ) {
        window.toggleSettingsMenu();
      }
      if (
        window.SharePromoter &&
        typeof window.SharePromoter.hideWarningPrompt === "function" &&
        document.getElementById("warningPrompt")?.style.display === "block"
      ) {
        window.SharePromoter.hideWarningPrompt(true);
      }
      if (
        window.hideBookmarkPrompt &&
        document.getElementById("bookmark-prompt")?.style.display === "block"
      ) {
        window.hideBookmarkPrompt(true);
      }

      this.overlay.classList.add("show");
      this.successEl.style.display = "block";
      this.successEl.classList.remove("fade-out");
    },
    hideSuccess(calledByOther: boolean) {
      if (!this.successEl || this.successEl.style.display === "none") return;

      this.successEl.classList.add("fade-out");
      this.successEl.addEventListener(
        "animationend",
        () => {
          this.successEl!.style.display = "none";
          this.successEl!.classList.remove("fade-out");

          if (calledByOther) return;

          this.overlay?.classList.remove("show");
        },
        { once: true },
      );
    },
    async performUpdate() {
      localStorage.setItem("justUpdated", "true");
      try {
        if ("serviceWorker" in navigator) {
          await Promise.all(
            (await navigator.serviceWorker.getRegistrations()).map((e) =>
              e.unregister(),
            ),
          );
        }
        if ("caches" in window) {
          await Promise.all(
            (await caches.keys()).map((e) => caches.delete(e).catch(() => false)),
          );
        }
      } catch (e) {
        console.error("automatic update failed:", e);
        localStorage.removeItem("justUpdated");
      }
      // Do not let beforeunload preventClosing cancel the update reload after unregistering SWs
      (window as unknown as Record<string, unknown>)["bypassPreventClosing"] = true;
      location.reload();
    },
    async checkVersion() {
      try {
        if (!window.__sunshineStuffData) return;
        const data = await window.__sunshineStuffData;
        if (!data) return;
        const { version, build } = parseStuffResponse(data);
        const currentStamp = `${version}:${build || ""}`;
        const prevStamp = localStorage.getItem("sunshineVersionStamp");
        const prev = localStorage.getItem("sunshineVersion");
        localStorage.setItem("sunshineVersion", version);
        localStorage.setItem("sunshineVersionStamp", currentStamp);
        if (prevStamp && prevStamp !== currentStamp) {
          await this.performUpdate();
          return;
        }
        if (!prevStamp && prev && version !== prev) await this.performUpdate();
      } catch (e) {
        console.warn("version check failed:", e);
      }
    },
  };
  window.sunshineUpdater.init();
  window.sunshineUpdater.checkVersion();
  if (!window.__sunshineUpdatePollerStarted) {
    window.__sunshineUpdatePollerStarted = true;
    window.setInterval(() => {
      if (document.visibilityState === "visible") {
        window.__sunshineStuffData = fetch("/api/stuff", { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
        void window.sunshineUpdater.checkVersion();
      }
    }, 5 * 60 * 1000);
  }

  window.SharePromoter = {
    shareEl: null,
    overlay: null,
    closeBtn: null,
    init() {
      this.overlay = document.getElementById("overlay");
      this.shareEl = document.getElementById("warningPrompt");
      if (!this.shareEl) {
        this.shareEl = document.createElement("div");
        this.shareEl.id = "warningPrompt";
        this.shareEl.style.display = "none";
        document.body.appendChild(this.shareEl);
        this.shareEl.innerHTML = `
            <i class="fa-solid fa-triangle-exclamation" style="font-size:40px;margin-bottom:15px;"></i>
            <label>Warning</label>
            <p>please close any new tabs that open up randomly; those are ads!</p>
            <button class="prompt-close-btn" id="warningPromptClose">Okay</button>
          `;
      }
      this.closeBtn = document.getElementById("warningPromptClose");

      this.closeBtn?.addEventListener("click", () =>
        this.hideWarningPrompt(false),
      );

      const trigger = () => {
        const visited = localStorage.getItem("sunshineWarningPromptSeen");
        if (!visited) {
          const shown = this.showWarningPrompt();
          if (shown) {
            localStorage.setItem("sunshineWarningPromptSeen", "true");
            return;
          }

          let tries = 0;
          const maxTries = 20;
          const retryTimer = window.setInterval(() => {
            tries += 1;
            const retryShown = this.showWarningPrompt();
            if (retryShown) {
              localStorage.setItem("sunshineWarningPromptSeen", "true");
              window.clearInterval(retryTimer);
              return;
            }
            if (tries >= maxTries) {
              window.clearInterval(retryTimer);
            }
          }, 120);
        } else {
          if (Math.random() < 0.1) {
            void this.showWarningPrompt();
          }
        }
      };

      trigger();

      document.addEventListener("keydown", (e: KeyboardEvent) => {
        if (
          e.key === "Escape" &&
          this.shareEl &&
          this.shareEl.style.display === "block" &&
          !this.shareEl.classList.contains("fade-out")
        ) {
          this.hideWarningPrompt(false);
        }
      });
    },
    showWarningPrompt() {
      if (!this.shareEl) return false;
      if (document.getElementById("ixl-cloak")) return false;
      if (!this.overlay) this.overlay = document.getElementById("overlay");
      if (!this.overlay) return false;

      if (!this.overlay.dataset["sunshineShareOverlayBound"]) {
        this.overlay.addEventListener("click", (e: MouseEvent) => {
          const activeOverlay = document.getElementById("overlay");
          if (!activeOverlay || e.target !== activeOverlay) return;
          if (document.getElementById("warningPrompt")?.style.display === "block") {
            window.SharePromoter.hideWarningPrompt(false);
          }
        });
        this.overlay.dataset["sunshineShareOverlayBound"] = "true";
      }

      {
        if (
          window.toggleSettingsMenu &&
          document.getElementById("settings-menu")?.classList.contains("open")
        ) {
          window.toggleSettingsMenu();
        }
        if (
          window.sunshineUpdater &&
          typeof window.sunshineUpdater.hideSuccess === "function" &&
          document.getElementById("updateSuccess")?.style.display === "block"
        ) {
          window.sunshineUpdater.hideSuccess(true);
        }
        if (
          window.hideBookmarkPrompt &&
          document.getElementById("bookmark-prompt")?.style.display === "block"
        ) {
          window.hideBookmarkPrompt(true);
        }

        this.overlay?.classList.add("show");
        this.shareEl.style.display = "block";
        this.shareEl.classList.remove("fade-out");
        return true;
      }
    },
    hideWarningPrompt(calledByOther: boolean) {
      if (!this.shareEl || this.shareEl.style.display === "none") return;

      this.shareEl.classList.add("fade-out");
      this.shareEl.addEventListener(
        "animationend",
        () => {
          this.shareEl!.style.display = "none";
          this.shareEl!.classList.remove("fade-out");

          if (calledByOther) return;

          this.overlay?.classList.remove("show");
        },
        { once: true },
      );
    },
  };

  window.SharePromoter.init();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === "sunshine-request-scramjet-config") {
        void ensureScramjetReady();
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initializeLoad(), {
    once: true,
  });
} else {
  initializeLoad();
}
