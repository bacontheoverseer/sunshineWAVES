import {
  DEVICE_IDB_NAME,
  DEVICE_STORAGE_TOKEN_KEY,
  getDeviceSignature,
} from "../core/deviceSignature.ts";

interface SyncMeta {
  dirty: boolean;
  last_synced: string | null;
}

interface AuthUser {
  username?: string;
  id?: string | number;
  hasRecoveryQuestion?: boolean;
  recoveryQuestionId?: string;
  recoveryQuestionText?: string;
  [key: string]: unknown;
}

const RECOVERY_PRESET_QUESTIONS: Array<{ id: string; text: string }> = [
  { id: "q1", text: "what was the name of your first pet?" },
  { id: "q2", text: "what is your favorite video game of all time?" },
  { id: "q3", text: "what city or town were you born in?" },
  { id: "q4", text: "what is your favorite food or snack?" },
  { id: "q5", text: "what was your childhood nickname?" },
  { id: "q6", text: "what is the name of your elementary school?" },
  { id: "q7", text: "what is your favorite movie or tv show?" },
  { id: "q8", text: "what is your dream car or vehicle?" },
  { id: "q9", text: "what is your favorite sports team or athlete?" },
  { id: "q10", text: "what was the first concert or live event you went to?" },
];

interface SyncPayload {
  localStorage: Record<string, string>;
  indexedDB: Record<string, unknown>;
  [key: string]: unknown;
}

interface DeltaPayload {
  _delta: boolean;
  localStorage: Record<string, string | null>;
  indexedDB?: Record<string, unknown>;
}

interface ToastController {
  update(type: string, message: string, icon?: string): void;
  hide(): void;
}

interface SessionData {
  user: AuthUser;
  token?: string;
  [key: string]: unknown;
}

interface DBExportRecord {
  key: unknown;
  value: unknown;
}

interface DBExportStore {
  __isExportFormatV2?: boolean;
  usesOutOfLineKeys?: boolean;
  data: DBExportRecord[];
}

type DBExport = Record<string, DBExportStore>;

interface IDBHashEntry {
  hash: string;
}

declare global {
  interface Window {
    sunshineExportAllData?: () => Promise<SyncPayload>;
    sunshineImportDataFromObject?: (
      data: unknown,
      callback: (progressText: string) => void,
    ) => Promise<void>;
    bypassPreventClosing?: boolean;
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          theme?: "dark" | "light" | "auto";
          size?: "normal" | "compact" | "flexible";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset?: (widgetId?: string) => void;
      getResponse?: (widgetId?: string) => string | undefined;
    };
  }
}

const POLL_INTERVAL = 20000;
const POLL_MAX_INTERVAL = 60000;
const DIRTY_DEBOUNCE = 1500;
const DELTA_MAX_KEYS = 20;
const DELTA_FULL_INTERVAL = 10;
const SYNC_TIMEOUT = 60000;

const SKIP_KEYS = new Set([
  "auth_user",
  "auth_token",
  "sunshine-sync-meta",
  DEVICE_STORAGE_TOKEN_KEY,
]);

const LOADING_SCREEN = `
    <div id="loading-screen" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; z-index: 99999; display: flex; justify-content: center; align-items: center; color: #858585; font-family: 'Lexend', sans-serif;">
        <h1 style="margin: 0; font-size: 1.2rem; font-weight: 300;">syncing data...</h1>
    </div>
`;

function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 8000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  const storedToken = localStorage.getItem("auth_token") || "";
  const extraHeaders: Record<string, string> = {};
  if (storedToken) {
    extraHeaders["x-cloudsync-token"] = storedToken;
  }
  return fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...extraHeaders,
      ...((options.headers as Record<string, string>) || {}),
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
}

export class CloudSync {
  user: AuthUser;
  syncMeta: SyncMeta;
  syncTimeout: ReturnType<typeof setTimeout> | null;
  isSyncing: boolean;
  isAuthenticated: boolean;
  isRestoring: boolean;
  _lastStatusText: string | undefined;
  _lastStatusType: string | undefined;
  _uploadRetries: number;
  _dirtyKeys: Map<string, string | null>;
  _idbHashes: Map<string, string>;
  _deltaCount: number;
  _pollInterval: number;
  _checkIntervalId: ReturnType<typeof setInterval> | null;
  _authCheckPromise: Promise<void> | null;
  _lastAuthCheckAt: number;
  _turnstileToken: string;
  _turnstileWidgetId: string | null;
  _loginTurnstileToken: string;
  _loginTurnstileWidgetId: string | null;
  _turnstileSiteKey: string;
  _turnstileEnabled: boolean;

  constructor() {
    this.user = JSON.parse(localStorage.getItem("auth_user") || "{}");
    try {
      this.syncMeta = JSON.parse(
        localStorage.getItem("sunshine-sync-meta") ||
          '{"dirty": false, "last_synced": null}',
      );
    } catch (e) {
      this.syncMeta = { dirty: false, last_synced: null };
    }

    this.syncTimeout = null;
    this.isSyncing = false;
    this.isAuthenticated = false;
    this.isRestoring = false;
    this._lastStatusText = undefined;
    this._lastStatusType = undefined;
    this._uploadRetries = 0;
    this._dirtyKeys = new Map();
    this._idbHashes = new Map();
    this._deltaCount = 0;
    this._pollInterval = POLL_INTERVAL;
    this._checkIntervalId = null;
    this._authCheckPromise = null;
    this._lastAuthCheckAt = 0;
    this._turnstileToken = "";
    this._turnstileWidgetId = null;
    this._loginTurnstileToken = "";
    this._loginTurnstileWidgetId = null;
    this._turnstileSiteKey = "";
    this._turnstileEnabled = false;

    void getDeviceSignature();
    this.init();
  }

  async enforceAuthGate(): Promise<void> {
    if (this.isAuthenticated) {
      const gate = document.getElementById("auth-gate-backdrop");
      if (gate) gate.remove();
      return;
    }
    if (!document.getElementById("auth-modal")) {
      await this.createAuthModal();
    }
    let gate = document.getElementById("auth-gate-backdrop");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "auth-gate-backdrop";
      gate.className = "cloudsync-gate-backdrop";
      document.body.appendChild(gate);
    }
    const modal = document.getElementById("auth-modal") as HTMLElement | null;
    if (modal) {
      modal.style.display = "flex";
      modal.style.zIndex = "1000001";
      modal.classList.remove("fade-out-prompt");
      modal.classList.add("fade-in-prompt");
    }
    this.updateModalState();
  }

  async init(): Promise<void> {
    document.addEventListener("toggleAuthModal", () => this.toggleModal());
    this.hookStorage();

    if (!this.user || Object.keys(this.user).length === 0) {
      this.isAuthenticated = false;
      this.updateModalState();
      await this.enforceAuthGate();
      return;
    }

    let needsLoadingScreen = false;
    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const [authRes, metaRes] = await Promise.all([
        fetchWithTimeout("/api/auth/me", { cache: "no-store" }),
        fetchWithTimeout("/api/sync/meta", { cache: "no-store" }),
      ]);

      if (authRes.ok) {
        const data = await authRes.json();
        this.user = data.user;
        this.isAuthenticated = true;
        localStorage.setItem("auth_user", JSON.stringify(this.user));
        window.dispatchEvent(
          new CustomEvent("cloudsync-auth-changed", { detail: this.user })
        );
      } else if (authRes.status === 401 || authRes.status === 403) {
        this.isAuthenticated = false;
        this.user = {};
        localStorage.removeItem("auth_user");
        localStorage.removeItem("auth_token");
        window.dispatchEvent(new CustomEvent("cloudsync-auth-changed", { detail: null }));
      } else {
        // Transient 5xx/503 deploy restart or 429 must never log the user out
        this.isAuthenticated = Boolean(this.user && Object.keys(this.user).length > 0);
        this.updateStatus("reconnecting...", "info");
        setTimeout(() => {
          void this.checkAuthStatus();
        }, 15000);
      }
      this.updateModalState();

      if (!this.isAuthenticated) {
        await this.enforceAuthGate();
        return;
      }

      if (this.isAuthenticated && metaRes.ok) {
        const metaData = await metaRes.json();
        const serverUpdatedAt: string = metaData.updated_at;

        if (this.syncMeta.dirty) {
          await this.syncData(true);
        } else if (
          serverUpdatedAt &&
          serverUpdatedAt !== this.syncMeta.last_synced
        ) {
          needsLoadingScreen = true;
          this.showLoadingScreen();
          safetyTimer = setTimeout(() => this.hideLoadingScreen(), 10000);
          await this.restoreData(true);
        } else {
          this.updateStatus("synced", "success");
        }
      }
    } catch (e) {
      console.warn("[cloudsync] startup check failed", e);
      // Keep locally cached session alive during temporary network/restart outages
      this.isAuthenticated = Boolean(this.user && Object.keys(this.user).length > 0);
      this.updateModalState();
      if (!this.isAuthenticated) {
        await this.enforceAuthGate();
      } else {
        this.updateStatus("reconnecting...", "info");
        setTimeout(() => {
          void this.checkAuthStatus();
        }, 15000);
      }
    } finally {
      if (safetyTimer) clearTimeout(safetyTimer);
      if (needsLoadingScreen) this.hideLoadingScreen();
    }

    if (this.isAuthenticated) {
      this.startPolling();
      if (this.user && this.user.hasRecoveryQuestion === false) {
        setTimeout(() => {
          if (this.isAuthenticated && this.user?.hasRecoveryQuestion === false) {
            void this.promptMissingRecoveryQuestion();
          }
        }, 900);
      }
    }
  }

  async promptMissingRecoveryQuestion(): Promise<void> {
    if (!document.getElementById("auth-modal")) {
      await this.createAuthModal();
    }
    this.updateModalState();
    const modal = document.getElementById("auth-modal") as HTMLElement | null;
    const overlay = document.getElementById("overlay") as HTMLElement | null;
    if (modal && modal.style.display !== "flex") {
      modal.style.display = "flex";
      modal.classList.remove("fade-out-prompt");
      modal.classList.add("fade-in-prompt");
      overlay?.classList.add("show");
      if (window.showToast) {
        window.showToast(
          "info",
          "choose a recovery question & save an answer so you can always recover your account!",
          "shield-halved"
        );
      }
    }
  }

  startPolling(): void {
    this.stopPolling();
    this._pollInterval = POLL_INTERVAL;
    this._checkIntervalId = setInterval(() => {
      if (this.isAuthenticated && !this.isSyncing && this.syncMeta.dirty) {
        this.syncData();
      }
    }, this._pollInterval);
  }

  stopPolling(): void {
    if (this._checkIntervalId) {
      clearInterval(this._checkIntervalId);
      this._checkIntervalId = null;
    }
  }

  onSyncError(): void {
    this._pollInterval = Math.min(this._pollInterval * 2, POLL_MAX_INTERVAL);
    this.startPolling();
  }

  onSyncSuccess(): void {
    if (this._pollInterval > POLL_INTERVAL) {
      this._pollInterval = POLL_INTERVAL;
      this.startPolling();
    }
  }

  async sync(): Promise<void> {
    try {
      if (!this.isAuthenticated) return;
      const metaRes = await fetchWithTimeout("/api/sync/meta", {
        cache: "no-store",
      });
      if (!metaRes.ok) return;

      const metaData = await metaRes.json();
      const serverUpdatedAt: string = metaData.updated_at;

      if (this.syncMeta.dirty) {
        await this.syncData(true);
      } else if (
        serverUpdatedAt &&
        serverUpdatedAt !== this.syncMeta.last_synced
      ) {
        await this.restoreData(true);
      } else {
        this.updateStatus("synced", "success");
      }
    } catch (e) {
      console.warn("[cloudsync] sync error", e);
    }
  }

  showLoadingScreen(): void {
    if (!document.getElementById("loading-screen")) {
      const div = document.createElement("div");
      div.innerHTML = LOADING_SCREEN.trim();
      document.body.appendChild(div.firstChild!);
    }
  }

  hideLoadingScreen(): void {
    const screen = document.getElementById("loading-screen");
    if (screen) {
      screen.remove();
    }
  }

  async checkAuthStatus(): Promise<void> {
    if (this._authCheckPromise) {
      return this._authCheckPromise;
    }
    const now = Date.now();
    if (now - this._lastAuthCheckAt < 4000) {
      return;
    }
    this._lastAuthCheckAt = now;
    const p = (async () => {
      try {
        const res = await fetchWithTimeout("/api/auth/me", { cache: "no-store" });
        if (res.ok) {
          const prevName = this.user?.username;
          const data = await res.json();
          this.user = data.user;
          this.isAuthenticated = true;
          localStorage.setItem("auth_user", JSON.stringify(this.user));
          if (prevName !== this.user?.username) {
            window.dispatchEvent(new CustomEvent("cloudsync-auth-changed", { detail: this.user }));
          }
          this.startPolling();
        } else if (res.status === 401 || res.status === 403) {
          this.isAuthenticated = false;
          this.user = {};
          localStorage.removeItem("auth_user");
          localStorage.removeItem("auth_token");
          window.dispatchEvent(new CustomEvent("cloudsync-auth-changed", { detail: null }));
        } else {
          this.isAuthenticated = Boolean(this.user && Object.keys(this.user).length > 0);
        }
        this.updateModalState();
      } catch (e) {
        console.warn("auth check failed!", e);
        this.isAuthenticated = Boolean(this.user && Object.keys(this.user).length > 0);
      } finally {
        if (this._authCheckPromise === p) {
          this._authCheckPromise = null;
        }
      }
    })();
    this._authCheckPromise = p;
    return p;
  }

  saveMeta(): void {
    localStorage.setItem("sunshine-sync-meta", JSON.stringify(this.syncMeta));
  }

  hookStorage(): void {
    const originalSetItem = localStorage.setItem;
    const self = this;
    localStorage.setItem = function (key: string, value: string): void {
      originalSetItem.call(localStorage, key, value);
      if (!SKIP_KEYS.has(key)) {
        self._dirtyKeys.set(key, value);
        self.markDirty();
      }
    };

    const originalRemoveItem = localStorage.removeItem;
    localStorage.removeItem = function (key: string): void {
      originalRemoveItem.call(localStorage, key);
      if (!SKIP_KEYS.has(key)) {
        self._dirtyKeys.set(key, null);
        self.markDirty();
      }
    };

    const originalClear = localStorage.clear;
    localStorage.clear = function (): void {
      originalClear.call(localStorage);
      if (!self.isAuthenticated || self.isRestoring) return;
      self._dirtyKeys.clear();
      self.markDirty();
    };

    window.addEventListener("storage", (e: StorageEvent) => {
      if (!self.isAuthenticated || self.isRestoring) return;
      if (e.storageArea !== localStorage) return;
      if (e.key === null) {
        self._dirtyKeys.clear();
        self.markDirty();
        return;
      }
      if (SKIP_KEYS.has(e.key)) return;
      self._dirtyKeys.set(e.key, e.newValue);
      self.markDirty();
    });

    if (typeof IDBObjectStore !== "undefined") {
      type IDBMutableMethod = "put" | "add" | "delete" | "clear";
      const hookIDB = (method: IDBMutableMethod): void => {
        const proto = IDBObjectStore.prototype as unknown as Record<
          string,
          unknown
        >;
        const original = proto[method] as (...args: unknown[]) => IDBRequest;
        if (!original) return;
        proto[method] = function (this: IDBObjectStore, ...args: unknown[]) {
          self.markDirty();
          return original.apply(this, args);
        };
      };
      hookIDB("put");
      hookIDB("add");
      hookIDB("delete");
      hookIDB("clear");
    }
  }

  markDirty(): void {
    if (!this.isAuthenticated || this.isRestoring) return;
    if (!this.syncMeta.dirty) {
      this.syncMeta.dirty = true;
      this.saveMeta();
    }

    if (this.syncTimeout) clearTimeout(this.syncTimeout);

    this.updateStatus("syncing...", "loading");

    this.syncTimeout = setTimeout(() => {
      this.syncData();
    }, DIRTY_DEBOUNCE);
  }

  checkForChanges(): void {
    if (this.isAuthenticated && !this.isSyncing && this.syncMeta.dirty) {
      this.syncData();
    }
  }

  async computeIDBHashes(): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    if (!("indexedDB" in window) || typeof indexedDB.databases !== "function") {
      return hashes;
    }
    try {
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;
        try {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(dbInfo.name!);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            req.onblocked = () => reject(new Error("blocked"));
          });
          const storeNames = Array.from(db.objectStoreNames);
          for (const storeName of storeNames) {
            try {
              const tx = db.transaction(storeName, "readonly");
              const store = tx.objectStore(storeName);
              const count = await new Promise<number>((resolve, reject) => {
                const req = store.count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
              });
              hashes.set(`${dbInfo.name}:${storeName}`, String(count));
            } catch {}
          }
          db.close();
        } catch {}
      }
    } catch {}
    return hashes;
  }

  async syncData(
    manual: boolean = false,
    _retryCount: number = 0,
  ): Promise<void> {
    if (!manual && (!this.isAuthenticated || this.isSyncing)) return;
    this.isSyncing = true;

    try {
      if (typeof window.sunshineExportAllData !== "function") {
        if (_retryCount >= 3) {
          console.warn(
            "[cloudsync] sunshineExportAllData not available after 3 retries, aborting sync",
          );
          this.isSyncing = false;
          this.updateStatus("sync skipped", "error");
          this.onSyncError();
          return;
        }
        console.warn(
          `[cloudsync] sunshineExportAllData not available yet, retry ${_retryCount + 1}/3...`,
        );
        this.isSyncing = false;
        setTimeout(() => this.syncData(manual, _retryCount + 1), 2000);
        return;
      }

      this._deltaCount++;
      const shouldFullSync = this._deltaCount % DELTA_FULL_INTERVAL === 0;
      const dirtyKeyCount = this._dirtyKeys.size;

      let body: string;

      if (shouldFullSync || dirtyKeyCount === 0 || dirtyKeyCount > DELTA_MAX_KEYS) {
        const data = await window.sunshineExportAllData();
        body = JSON.stringify(data);
      } else {
        const newIdbHashes = await this.computeIDBHashes();
        const delta: DeltaPayload = {
          _delta: true,
          localStorage: Object.fromEntries(this._dirtyKeys),
        };
        const changedDbs: Record<string, unknown> = {};
        let hasIdbChanges = false;

        for (const [key, hash] of newIdbHashes) {
          const oldHash = this._idbHashes.get(key);
          if (oldHash !== hash) {
            hasIdbChanges = true;
            const [dbName, storeName] = key.split(":");
            if (!dbName || !storeName) continue;
            if (!changedDbs[dbName]) changedDbs[dbName] = {};
          }
        }

        if (hasIdbChanges) {
          const fullData = await window.sunshineExportAllData();
          const idbData = fullData.indexedDB || {};
          for (const dbName of Object.keys(changedDbs)) {
            if (idbData[dbName]) {
              changedDbs[dbName] = idbData[dbName];
            }
          }
          delta.indexedDB = changedDbs;
        }

        this._idbHashes = newIdbHashes;
        body = JSON.stringify(delta);
      }

      const res = await fetchWithTimeout(
        "/api/sync/upload",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body,
        },
        SYNC_TIMEOUT,
      );

      if (res.ok) {
        const result = await res.json();
        this.syncMeta.dirty = false;
        this.syncMeta.last_synced =
          result.updated_at ||
          new Date().toISOString().replace("T", " ").slice(0, 19);
        this.saveMeta();
        this._dirtyKeys.clear();

        this.updateStatus("synced", "success");
        this._uploadRetries = 0;
        this.onSyncSuccess();
      } else {
        console.warn("[cloudsync] upload failed:", res.status);
        if (
          (res.status === 429 || res.status >= 500) &&
          (!this._uploadRetries || this._uploadRetries < 3)
        ) {
          this._uploadRetries = (this._uploadRetries || 0) + 1;
          const delay = Math.min(
            2000 * Math.pow(2, this._uploadRetries - 1),
            8000,
          );
          console.warn(
            `[cloudsync] retrying upload in ${delay}ms (attempt ${this._uploadRetries}/3)`,
          );
          this.updateStatus("retrying sync...", "loading");
          this.isSyncing = false;
          setTimeout(() => this.syncData(manual, _retryCount), delay);
          return;
        }
        this._uploadRetries = 0;
        this.updateStatus("sync failed", "error");
        this.onSyncError();
      }
    } catch (err) {
      console.error("sync error!", err);
      if (!this._uploadRetries || this._uploadRetries < 3) {
        this._uploadRetries = (this._uploadRetries || 0) + 1;
        const delay = Math.min(
          2000 * Math.pow(2, this._uploadRetries - 1),
          8000,
        );
        console.warn(
          `[cloudsync] retrying upload in ${delay}ms (attempt ${this._uploadRetries}/3)`,
        );
        this.updateStatus("retrying sync...", "loading");
        this.isSyncing = false;
        setTimeout(() => this.syncData(manual, _retryCount), delay);
        return;
      }
      this._uploadRetries = 0;
      this.updateStatus("connection error", "error");
      this.onSyncError();
    } finally {
      this.isSyncing = false;
    }
  }

  async restoreData(
    silent: boolean = false,
    _retryCount: number = 0,
  ): Promise<void> {
    if (!this.isAuthenticated) return;
    if (this.isRestoring) return;
    if (!silent) this.updateStatus("restoring...", "loading");
    this.isRestoring = true;

    let restoreToast: ToastController | null = null;
    let reloading = false;

    if (!silent && window.showToast) {
      restoreToast = window.showToast("info", "restoring data...", "rotate", 0);
    }

    const maxRetries = 6;
    const jitter = (): number => Math.floor(Math.random() * 400);

    try {
      const res = await fetchWithTimeout("/api/sync/download", {}, SYNC_TIMEOUT);

      if (res.status === 429 || res.status >= 500) {
        if (_retryCount < maxRetries) {
          const delay =
            Math.min(1000 * Math.pow(2, _retryCount), 30000) + jitter();
          if (!silent) this.updateStatus("restore retrying...", "loading");
          console.warn(
            `[cloudsync] restore retry ${_retryCount + 1}/${maxRetries} after ${delay}ms (status ${res.status})`,
          );
          this.isRestoring = false;
          setTimeout(() => this.restoreData(silent, _retryCount + 1), delay);
          return;
        }
        if (!silent) this.updateStatus("server busy", "error");
        this.isRestoring = false;
        return;
      }

      if (!res.ok && res.status !== 404) {
        if (
          _retryCount < maxRetries &&
          res.status >= 400 &&
          res.status !== 401
        ) {
          const delay =
            Math.min(1000 * Math.pow(2, _retryCount), 30000) + jitter();
          if (!silent) this.updateStatus("restore retrying...", "loading");
          console.warn(
            `[cloudsync] restore retry ${_retryCount + 1}/${maxRetries} after ${delay}ms (status ${res.status})`,
          );
          this.isRestoring = false;
          setTimeout(() => this.restoreData(silent, _retryCount + 1), delay);
          return;
        }
        if (!silent) this.updateStatus("server error", "error");
        this.isRestoring = false;
        return;
      }

      const json = await res.json();

      if (res.ok && json.data) {
        if (typeof window.sunshineImportDataFromObject === "function") {
          await window.sunshineImportDataFromObject(
            json.data,
            (progressText: string) => {
              const loadingH1 =
                document.querySelector<HTMLElement>("#loading-screen h1");
              if (loadingH1) loadingH1.textContent = progressText;
            },
          );

          this.syncMeta.dirty = false;
          this.syncMeta.last_synced = json.updated_at;
          this.saveMeta();
          this._dirtyKeys.clear();

          if (!silent) {
            reloading = true;
            window.bypassPreventClosing = true;
            window.location.reload();
          } else {
            try {
              const restoredCoins = Math.max(
                0,
                parseInt(localStorage.getItem("cookie_coins_balance_v1") || "150", 10) || 0,
              );
              window.dispatchEvent(
                new CustomEvent("cookie-coins-updated", { detail: { balance: restoredCoins } }),
              );
            } catch {}
            document.dispatchEvent(new CustomEvent("cloudsync-restored"));
            this.updateStatus("synced", "success");
          }
        }
      } else if (res.status === 404) {
        if (!silent) this.updateStatus("no data found", "success");
      }
    } catch (err) {
      console.error("restore error!", err);
      if (_retryCount < maxRetries) {
        const delay =
          Math.min(1000 * Math.pow(2, _retryCount), 30000) + jitter();
        if (!silent) this.updateStatus("restore retrying...", "loading");
        this.isRestoring = false;
        setTimeout(() => this.restoreData(silent, _retryCount + 1), delay);
        return;
      }
      if (!silent) this.updateStatus("restore failed", "error");
    } finally {
      this.isRestoring = false;
      if (restoreToast && !reloading) {
        restoreToast.hide();
      }
    }
  }

  async createAuthModal(): Promise<void> {
    if (document.getElementById("auth-modal")) return;

    const questionOptionsHtml = RECOVERY_PRESET_QUESTIONS.map(
      (q) => `<option value="${q.id}">${q.text}</option>`
    ).join("");

    const modal = document.createElement("div");
    modal.id = "auth-modal";
    modal.className = "popup";
    modal.innerHTML = `
                <h2 id="auth-title" style="text-align: center; margin-top: 0; margin-bottom: 6px;">create account</h2>
                <p id="auth-subtitle" style="text-align: center; font-size: 12px; color: var(--text-muted); margin-top: 0; margin-bottom: 16px;">
                    sign up or log in with cloudsync to use operation cookie
                </p>
                <div id="auth-forms" class="input-container">
                    <form id="login-form" style="display: none;">
                        <label>username</label>
                        <input type="text" id="login-username" placeholder="enter username" autocomplete="off">

                        <label style="margin-top: 15px;">password</label>
                        <div style="position: relative;">
                            <input type="password" id="login-password" placeholder="enter password" style="width: 100%; padding-right: 35px; box-sizing: border-box;">
                            <i class="fa-solid fa-eye password-toggle" data-target="login-password" style="position: absolute; right: 10px; top: 59%; transform: translateY(-50%); cursor: pointer; color: var(--text-muted); font-size: 13px;"></i>
                        </div>

                        <div id="login-turnstile-container" style="margin-top: 12px; display: flex; justify-content: center;"></div>

                        <div style="text-align: center;">
                            <button type="submit" class="auth-action-btn" style="width: 55%; margin-top: 15px;">login</button>
                        </div>
                    </form>

                    <form id="register-form" style="display: block;">
                        <label>username</label>
                        <input type="text" id="reg-username" placeholder="create username" autocomplete="off">
                        <div id="reg-username-feedback" style="font-size: 11px; color: var(--text-muted); margin-top: 4px; text-align: left; min-height: 14px;">3-20 chars, letters/numbers</div>

                        <label style="margin-top: 15px;">password</label>
                        <div style="position: relative;">
                            <input type="password" id="reg-password" placeholder="create password" style="width: 100%; padding-right: 35px; box-sizing: border-box;">
                            <i class="fa-solid fa-eye password-toggle" data-target="reg-password" style="position: absolute; right: 10px; top: 59%; transform: translateY(-50%); cursor: pointer; color: var(--text-muted); font-size: 13px;"></i>
                        </div>
                        <div id="reg-password-feedback" style="font-size: 11px; color: var(--text-muted); margin-top: 4px; text-align: left; min-height: 14px;">8+ chars, 1 number, 1 symbol</div>

                        <div id="reg-turnstile-container" style="margin-top: 10px; display: flex; justify-content: center;"></div>

                        <div style="text-align: center;">
                            <button type="submit" class="auth-action-btn" style="width: 65%; margin-top: 15px;">sign up for cloudsync</button>
                            <p style="font-size: 11px; color: var(--text-muted); margin-top: 8px; max-width: 90%; margin-left: auto; margin-right: auto;">
                                by signing up, you agree to our <a href="/terms" target="_blank" rel="noopener noreferrer" class="cloudsync-legal-link" data-doc="terms" style="color: var(--text-white); text-decoration: underline;">terms of service</a> &amp; <a href="/privacy" target="_blank" rel="noopener noreferrer" class="cloudsync-legal-link" data-doc="privacy" style="color: var(--text-white); text-decoration: underline;">privacy policy</a>
                            </p>
                        </div>
                    </form>

                    <form id="recover-form" style="display: none;">
                        <label>username</label>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <input type="text" id="recover-username" placeholder="enter your username" autocomplete="off" style="flex: 1;">
                            <button type="button" id="recover-lookup-btn" class="auth-action-btn" style="width: auto; padding: 10px 14px; white-space: nowrap;">find question</button>
                        </div>

                        <div id="recover-step-2" style="display: none; margin-top: 12px;">
                            <div class="cloudsync-recovery-question-box">
                                <div style="font-size: 10.5px; color: var(--text-muted); margin-bottom: 3px;">your saved recovery question:</div>
                                <div id="recover-question-display" style="font-size: 13px; color: var(--text-white); font-weight: 500;"></div>
                            </div>

                            <label style="margin-top: 12px;">your answer</label>
                            <input type="text" id="recover-answer" placeholder="type your saved answer (close matches work!)" autocomplete="off">

                            <label style="margin-top: 12px;">new password</label>
                            <div style="position: relative;">
                                <input type="password" id="recover-new-password" placeholder="enter new password (8+ chars)" style="width: 100%; padding-right: 35px; box-sizing: border-box;">
                                <i class="fa-solid fa-eye password-toggle" data-target="recover-new-password" style="position: absolute; right: 10px; top: 59%; transform: translateY(-50%); cursor: pointer; color: var(--text-muted); font-size: 13px;"></i>
                            </div>

                            <div style="text-align: center;">
                                <button type="submit" class="auth-action-btn" style="width: 72%; margin-top: 14px;">reset password &amp; sign in</button>
                            </div>
                        </div>

                        <div style="text-align: center; margin-top: 12px;">
                            <span id="recover-back-btn" class="hover-link" style="font-size: 12.5px; color: var(--text-muted);">back to login</span>
                        </div>
                    </form>

                    <div style="margin-top: 14px; font-size: 13px; color: var(--text-muted); text-align: center;" id="auth-switch-container">
                        <div>
                            <span id="auth-prompt-text">already have an account?</span> <span id="auth-action-text" class="hover-link">login!</span>
                        </div>
                        <div style="margin-top: 6px;">
                            <span role="button" tabindex="0" id="auth-recover-open-btn" class="cloudsync-tiny-recover-btn">recover your account</span>
                        </div>
                    </div>
                    <div id="auth-error" style="color: #ff5555; margin-top: 10px; font-size: 13px; min-height: 18px; text-align: center;"></div>
                </div>
                <div id="auth-logged-in" style="display: none; text-align: center;">
                    <p style="margin-bottom: 12px; font-size: 16px;">logged in as <span id="auth-user-display" style="color: var(--text-white);"></span></p>

                    <div style="margin-bottom: 14px;">
                        <span id="sync-status-indicator" style="color: var(--text-muted); font-size: 14px;">
                            <i class="fa-solid fa-check" style="color: var(--text-white)"></i> synced
                        </span>
                    </div>

                    <div class="cloudsync-recovery-setup-card">
                        <div id="account-recovery-status" class="cloudsync-recovery-status">
                            <i class="fa-solid fa-key"></i>
                            <span>account recovery question</span>
                        </div>
                        <select id="account-recovery-question" class="cloudsync-select">
                            ${questionOptionsHtml}
                        </select>
                        <input type="text" id="account-recovery-answer" class="cloudsync-recovery-input" placeholder="write your recovery answer..." autocomplete="off">
                        <button type="button" id="save-recovery-btn" class="auth-action-btn" style="padding: 8px 12px; font-size: 12.5px; margin-top: 4px;">
                            save recovery question
                        </button>
                    </div>

                    <button id="logout-btn" class="auth-action-btn auth-secondary-btn">
                        logout
                    </button>

                    <button id="delete-account-btn" class="auth-action-btn auth-secondary-btn">
                        delete account
                    </button>
                </div>
            <button id="close-auth-modal" class="cloudsync-close-btn">
                <i class="fa-solid fa-xmark"></i>
            </button>
        `;

    document.body.appendChild(modal);
    this.attachModalListeners(modal);
    this.updateModalState();
    void this.initTurnstileWidget();
  }

  mountTurnstileWidgets(): void {
    const siteKey = this._turnstileSiteKey;
    if (!siteKey || !window.turnstile) return;

    const regContainer = document.getElementById("reg-turnstile-container");
    if (regContainer && !this._turnstileWidgetId) {
      this._turnstileWidgetId = window.turnstile.render(regContainer, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token: string) => {
          this._turnstileToken = token || "";
        },
        "expired-callback": () => {
          this._turnstileToken = "";
        },
        "error-callback": () => {
          this._turnstileToken = "";
        },
      });
    }

    const loginContainer = document.getElementById("login-turnstile-container");
    if (loginContainer && !this._loginTurnstileWidgetId) {
      this._loginTurnstileWidgetId = window.turnstile.render(loginContainer, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token: string) => {
          this._loginTurnstileToken = token || "";
        },
        "expired-callback": () => {
          this._loginTurnstileToken = "";
        },
        "error-callback": () => {
          this._loginTurnstileToken = "";
        },
      });
    }
  }

  async initTurnstileWidget(): Promise<void> {
    try {
      const res = await fetch("/api/auth/turnstile-config", { cache: "no-store" });
      if (!res.ok) return;
      const cfg = (await res.json()) as { enabled?: boolean; siteKey?: string };
      const siteKey = typeof cfg?.siteKey === "string" ? cfg.siteKey.trim() : "";
      this._turnstileEnabled = Boolean(cfg?.enabled && siteKey);
      this._turnstileSiteKey = siteKey;
      if (!siteKey) return;

      if (window.turnstile) {
        this.mountTurnstileWidgets();
        return;
      }

      if (!document.getElementById("cf-turnstile-script")) {
        const script = document.createElement("script");
        script.id = "cf-turnstile-script";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.onload = () => this.mountTurnstileWidgets();
        document.head.appendChild(script);
      }
    } catch {}
  }

  attachModalListeners(modal: HTMLElement): void {
    (modal.querySelector("#close-auth-modal") as HTMLElement).addEventListener(
      "click",
      () => {
        if (!this.isAuthenticated) return;
        void this.toggleModal();
      },
    );
    const loginForm = modal.querySelector<HTMLFormElement>("#login-form")!;
    const regForm = modal.querySelector<HTMLFormElement>("#register-form")!;
    modal.querySelectorAll<HTMLAnchorElement>(".cloudsync-legal-link").forEach((link) => {
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        const doc = link.dataset.doc === "privacy" ? "privacy" : "terms";
        document.dispatchEvent(
          new CustomEvent("openSettingsLegal", {
            detail: { doc, fullscreen: true },
          }),
        );
      });
    });

    const regUsername = modal.querySelector<HTMLInputElement>("#reg-username")!;
    const regUsernameFeedback = modal.querySelector<HTMLElement>(
      "#reg-username-feedback",
    )!;
    const regPassword = modal.querySelector<HTMLInputElement>("#reg-password")!;
    const regPasswordFeedback = modal.querySelector<HTMLElement>(
      "#reg-password-feedback",
    )!;

    regUsername.addEventListener("input", () => {
      const val = regUsername.value;
      const len = val.length;
      const validChar = /^[a-zA-Z0-9_]+$/.test(val);

      if (len === 0) {
        regUsernameFeedback.textContent = "3-20 chars, letters/numbers";
        regUsernameFeedback.style.color = "var(--text-muted)";
      } else if (len < 3 || len > 20) {
        regUsernameFeedback.textContent = `${len}/20 chars (must be 3-20)`;
        regUsernameFeedback.style.color = "#ff5555";
      } else if (!validChar) {
        regUsernameFeedback.textContent = "letters, numbers, underscores only";
        regUsernameFeedback.style.color = "#ff5555";
      } else {
        regUsernameFeedback.textContent = `${len}/20 chars - looks good`;
        regUsernameFeedback.style.color = "#55ff55";
      }
    });

    regPassword.addEventListener("input", () => {
      const val = regPassword.value;
      const len = val.length;
      const hasNum = /[0-9]/.test(val);
      const hasSym = /[!@#$%^&*_\-+=?.]/.test(val);

      if (len === 0) {
        regPasswordFeedback.textContent = "8+ chars, 1 number, 1 symbol";
        regPasswordFeedback.style.color = "var(--text-muted)";
      } else if (len < 8) {
        regPasswordFeedback.textContent = `${len}/8 chars`;
        regPasswordFeedback.style.color = "#ff5555";
      } else if (!hasNum) {
        regPasswordFeedback.textContent = "tip: add a number";
        regPasswordFeedback.style.color = "#facc15";
      } else if (!hasSym) {
        regPasswordFeedback.textContent = "looks good (8+ chars)";
        regPasswordFeedback.style.color = "#55ff55";
      } else {
        regPasswordFeedback.textContent = "strong password - looks good";
        regPasswordFeedback.style.color = "#55ff55";
      }
    });

    const promptText = modal.querySelector<HTMLElement>("#auth-prompt-text")!;
    const actionText = modal.querySelector<HTMLElement>("#auth-action-text")!;
    const authTitle = modal.querySelector<HTMLElement>("#auth-title")!;
    const switchContainer = modal.querySelector<HTMLElement>("#auth-switch-container")!;
    const recoverForm = modal.querySelector<HTMLFormElement>("#recover-form")!;
    const recoverOpenBtn = modal.querySelector<HTMLElement>("#auth-recover-open-btn")!;
    const recoverBackBtn = modal.querySelector<HTMLElement>("#recover-back-btn")!;
    const recoverLookupBtn = modal.querySelector<HTMLButtonElement>("#recover-lookup-btn")!;
    const recoverUsername = modal.querySelector<HTMLInputElement>("#recover-username")!;
    const recoverStep2 = modal.querySelector<HTMLElement>("#recover-step-2")!;
    const recoverQuestionDisplay = modal.querySelector<HTMLElement>("#recover-question-display")!;
    const saveRecoveryBtn = modal.querySelector<HTMLButtonElement>("#save-recovery-btn")!;

    const loginUsername = modal.querySelector<HTMLInputElement>("#login-username")!;
    const loginPassword = modal.querySelector<HTMLInputElement>("#login-password")!;

    actionText.addEventListener("click", () => {
      const isLogin = loginForm.style.display !== "none";
      recoverForm.style.display = "none";
      switchContainer.style.display = "block";
      if (isLogin) {
        regUsername.value = loginUsername.value;
        regPassword.value = loginPassword.value;
        loginForm.style.display = "none";
        regForm.style.display = "block";
        authTitle.textContent = "create account";
        promptText.textContent = "already have an account?";
        actionText.textContent = "login!";
      } else {
        loginUsername.value = regUsername.value;
        loginPassword.value = regPassword.value;
        loginForm.style.display = "block";
        regForm.style.display = "none";
        authTitle.textContent = "login";
        promptText.textContent = "don't have an account?";
        actionText.textContent = "create an account!";
      }
      this.mountTurnstileWidgets();
      this.showError("");
    });

    recoverOpenBtn.addEventListener("click", () => {
      const seedUser = (loginForm.style.display !== "none" ? loginUsername.value : regUsername.value).trim();
      if (seedUser) recoverUsername.value = seedUser;
      loginForm.style.display = "none";
      regForm.style.display = "none";
      recoverForm.style.display = "block";
      recoverStep2.style.display = "none";
      switchContainer.style.display = "none";
      authTitle.textContent = "recover account";
      this.showError("");
      if (recoverUsername.value.trim().length >= 3) {
        void this.handleRecoveryLookup();
      }
    });

    recoverBackBtn.addEventListener("click", () => {
      recoverForm.style.display = "none";
      regForm.style.display = "none";
      loginForm.style.display = "block";
      switchContainer.style.display = "block";
      authTitle.textContent = "login";
      promptText.textContent = "don't have an account?";
      actionText.textContent = "create an account!";
      this.mountTurnstileWidgets();
      this.showError("");
    });

    recoverLookupBtn.addEventListener("click", () => {
      void this.handleRecoveryLookup();
    });

    recoverUsername.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && recoverStep2.style.display === "none") {
        ev.preventDefault();
        void this.handleRecoveryLookup();
      }
    });

    loginForm.addEventListener("submit", (e) => this.handleLogin(e));
    regForm.addEventListener("submit", (e) => this.handleRegister(e));
    recoverForm.addEventListener("submit", (e) => this.handleRecoverReset(e));
    saveRecoveryBtn.addEventListener("click", () => {
      void this.handleSaveRecoveryQuestion();
    });

    modal
      .querySelector<HTMLElement>("#logout-btn")!
      .addEventListener("click", () => this.logout());

    const deleteBtn = modal.querySelector<HTMLElement>("#delete-account-btn")!;
    deleteBtn.addEventListener("click", () => {
      void this.deleteAccount();
    });

    document.addEventListener("click", (e) => {
      if (!this.isAuthenticated) return;
      const overlay = document.getElementById("overlay");
      if (overlay && e.target === overlay && modal.style.display === "flex") {
        void this.toggleModal();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (!this.isAuthenticated) return;
      if (e.key === "Escape" && modal.style.display === "flex") {
        void this.toggleModal();
      }
    });

    const toggles = modal.querySelectorAll<HTMLElement>(".password-toggle");
    toggles.forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const targetId = toggle.getAttribute("data-target");
        const input = document.getElementById(
          targetId!,
        ) as HTMLInputElement | null;
        if (!input) return;

        if (input.type === "password") {
          input.type = "text";
          toggle.classList.remove("fa-eye");
          toggle.classList.add("fa-eye-slash");
        } else {
          input.type = "password";
          toggle.classList.remove("fa-eye-slash");
          toggle.classList.add("fa-eye");
        }
      });
    });

  }

  async toggleModal(): Promise<void> {
    if (!document.getElementById("auth-modal")) {
      await this.createAuthModal();
    }

    const modal = document.getElementById("auth-modal") as HTMLElement;
    const overlay = document.getElementById("overlay") as HTMLElement | null;

    if (!this.isAuthenticated) {
      await this.enforceAuthGate();
      return;
    }

    if (
      modal.style.display === "flex" &&
      !modal.classList.contains("fade-out-prompt")
    ) {
      modal.classList.remove("fade-in-prompt");
      modal.classList.add("fade-out-prompt");
      overlay?.classList.remove("show");
      setTimeout(() => {
        modal.style.display = "none";
        modal.classList.remove("fade-out-prompt");
      }, 100);
    } else {
      modal.style.display = "flex";
      modal.classList.remove("fade-out-prompt");
      modal.classList.add("fade-in-prompt");
      overlay?.classList.add("show");
    }
  }

  updateModalState(): void {
    const loggedInView = document.getElementById("auth-logged-in");
    const formsView = document.getElementById("auth-forms");
    const userDisplay = document.getElementById("auth-user-display");
    const authTitle = document.getElementById("auth-title");
    const authSubtitle = document.getElementById("auth-subtitle");
    const closeBtn = document.getElementById("close-auth-modal");
    const regForm = document.getElementById("register-form");

    if (this.isAuthenticated) {
      if (loggedInView) loggedInView.style.display = "block";
      if (formsView) formsView.style.display = "none";
      if (userDisplay) userDisplay.textContent = this.user.username ?? "";
      if (authTitle) authTitle.textContent = "cloud sync";
      if (authSubtitle) authSubtitle.style.display = "none";
      if (closeBtn) closeBtn.style.display = "inline-flex";
      const gate = document.getElementById("auth-gate-backdrop");
      if (gate) gate.remove();

      const recSelect = document.getElementById("account-recovery-question") as HTMLSelectElement | null;
      const recStatus = document.getElementById("account-recovery-status");
      if (recSelect && this.user?.recoveryQuestionId) {
        recSelect.value = String(this.user.recoveryQuestionId);
      }
      if (recStatus) {
        if (this.user?.hasRecoveryQuestion) {
          recStatus.innerHTML = `<i class="fa-solid fa-shield-halved" style="color: #4ade80;"></i> <span>recovery question saved (update anytime)</span>`;
        } else {
          recStatus.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: #facc15;"></i> <span>choose a recovery question &amp; save an answer</span>`;
        }
      }
    } else {
      if (loggedInView) loggedInView.style.display = "none";
      if (formsView) formsView.style.display = "block";
      if (authTitle) {
        authTitle.textContent =
          regForm && regForm.style.display !== "none" ? "create account" : "login";
      }
      if (authSubtitle) authSubtitle.style.display = "block";
      if (closeBtn) closeBtn.style.display = "none";
    }

    const statusEl = document.querySelector<HTMLElement>("#auth-status");
    if (statusEl && !statusEl.closest("#auth-container.is-profile-pill"))
      statusEl.textContent = this.isAuthenticated
        ? (this.user.username ?? "")
        : "cloud sync";
  }

  updateStatus(text: string, cls?: string): void {
    const ind = document.getElementById("sync-status-indicator");

    const updateEl = (el: HTMLElement | null): void => {
      if (!el) return;
      if (this._lastStatusText === text && this._lastStatusType === cls) return;
      this._lastStatusText = text;
      this._lastStatusType = cls;

      const iconEl = document.createElement("i");
      if (cls === "loading") {
        iconEl.className = "fa-solid fa-rotate";
        iconEl.style.color = "var(--text-white)";
      } else if (cls === "error") {
        iconEl.className = "fa-solid fa-triangle-exclamation";
        iconEl.style.color = "#ff5555";
      } else {
        iconEl.className = "fa-solid fa-check";
        iconEl.style.color = "var(--text-white)";
      }
      el.replaceChildren(iconEl, document.createTextNode(` ${text}`));
    };

    updateEl(ind);
  }

  async handleLogin(e: Event): Promise<void> {
    e.preventDefault();
    const username = (
      document.getElementById("login-username") as HTMLInputElement
    ).value;
    const password = (
      document.getElementById("login-password") as HTMLInputElement
    ).value;

    const domLoginTurnstileInput = document.querySelector<HTMLInputElement>(
      '#login-form [name="cf-turnstile-response"]'
    );
    const loginTurnstileToken =
      this._loginTurnstileToken ||
      (this._loginTurnstileWidgetId && window.turnstile?.getResponse
        ? window.turnstile.getResponse(this._loginTurnstileWidgetId) || ""
        : "") ||
      domLoginTurnstileInput?.value ||
      "";

    if (this._turnstileEnabled && !loginTurnstileToken) {
      const msg = "please complete the security check first!";
      this.showError(msg);
      if (window.showToast) window.showToast("error", msg, "shield-halved");
      return;
    }

    let toastController: ToastController | null = null;
    if (window.showToast)
      toastController = window.showToast(
        "info",
        "logging in...",
        "right-to-bracket",
        0,
      );

    try {
      const deviceSig = await getDeviceSignature();
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username,
          password,
          fingerprint_id: deviceSig.fingerprint_id,
          storage_token: deviceSig.storage_token,
          "cf-turnstile-response": loginTurnstileToken,
        }),
      });

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error("server is restarting — please try again in a few seconds");
        }
        throw new Error(`server returned ${res.status}`);
      }

      if (res.ok) {
        if (toastController) toastController.hide();
        this._loginTurnstileToken = "";
        this.setSession(data as unknown as SessionData);
        await this.toggleModal();
        await this.restoreData();
        if (this.isAuthenticated && this.user?.hasRecoveryQuestion === false) {
          setTimeout(() => {
            void this.promptMissingRecoveryQuestion();
          }, 500);
        }
      } else {
        if (toastController) toastController.hide();
        this._loginTurnstileToken = "";
        if (this._loginTurnstileWidgetId && window.turnstile?.reset) {
          window.turnstile.reset(this._loginTurnstileWidgetId);
        }
        const msg = (data.error as string) || "login failed!";
        this.showError(msg);
        if (window.showToast)
          window.showToast("error", msg, "warning");
      }
    } catch (err) {
      if (toastController) toastController.hide();
      this._loginTurnstileToken = "";
      if (this._loginTurnstileWidgetId && window.turnstile?.reset) {
        window.turnstile.reset(this._loginTurnstileWidgetId);
      }
      const msg = err instanceof Error ? err.message : "connection error!";
      this.showError(msg);
      if (window.showToast)
        window.showToast("error", msg, "warning");
      console.error(err);
    }
  }

  async handleRegister(e: Event): Promise<void> {
    e.preventDefault();
    const username = (
      document.getElementById("reg-username") as HTMLInputElement
    ).value;
    const password = (
      document.getElementById("reg-password") as HTMLInputElement
    ).value;

    if (!username || !password) {
      this.showError("please fill in both fields!");
      if (window.showToast)
        window.showToast(
          "error",
          "please fill in both username and password!",
          "triangle-exclamation",
        );
      return;
    }

    let toastController: ToastController | null = null;
    if (window.showToast)
      toastController = window.showToast(
        "info",
        "creating account...",
        "user-plus",
        0,
      );

    try {
      const deviceSig = await getDeviceSignature();
      const domTurnstileInput = document.querySelector<HTMLInputElement>(
        '#register-form [name="cf-turnstile-response"]'
      );
      const turnstileToken =
        this._turnstileToken ||
        (this._turnstileWidgetId && window.turnstile?.getResponse
          ? window.turnstile.getResponse(this._turnstileWidgetId) || ""
          : "") ||
        domTurnstileInput?.value ||
        "";

      if (this._turnstileEnabled && !turnstileToken) {
        if (toastController) toastController.hide();
        const msg = "please complete the security check first!";
        this.showError(msg);
        if (window.showToast) window.showToast("error", msg, "shield-halved");
        return;
      }

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username,
          password,
          fingerprint_id: deviceSig.fingerprint_id,
          storage_token: deviceSig.storage_token,
          "cf-turnstile-response": turnstileToken,
        }),
      });

      let data: Record<string, unknown>;
      try {
        data = await res.json();
      } catch {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error("server is restarting — please try again in a few seconds");
        }
        throw new Error(`server returned ${res.status}`);
      }

      if (res.ok) {
        if (toastController) toastController.hide();
        this._turnstileToken = "";
        this.setSession(data as unknown as SessionData);
        this.syncMeta.dirty = true;
        this._dirtyKeys.clear();
        this.saveMeta();
        await this.syncData();
        // Keep the modal open on their newly created account so they choose & save their recovery question right now
        await this.promptMissingRecoveryQuestion();
      } else {
        if (toastController) toastController.hide();
        this._turnstileToken = "";
        if (this._turnstileWidgetId && window.turnstile?.reset) {
          window.turnstile.reset(this._turnstileWidgetId);
        }
        const msg = (data.error as string) || "registration failed!";
        this.showError(msg);
        if (window.showToast)
          window.showToast("error", msg, "warning");
      }
    } catch (err) {
      if (toastController) toastController.hide();
      this._turnstileToken = "";
      if (this._turnstileWidgetId && window.turnstile?.reset) {
        window.turnstile.reset(this._turnstileWidgetId);
      }
      const msg = err instanceof Error ? err.message : "connection error!";
      this.showError(msg);
      if (window.showToast)
        window.showToast("error", msg, "warning");
    }
  }

  async handleRecoveryLookup(): Promise<void> {
    const usernameInput = document.getElementById("recover-username") as HTMLInputElement | null;
    const step2 = document.getElementById("recover-step-2") as HTMLElement | null;
    const questionDisplay = document.getElementById("recover-question-display") as HTMLElement | null;
    const lookupBtn = document.getElementById("recover-lookup-btn") as HTMLButtonElement | null;
    const username = usernameInput?.value.trim() || "";

    if (username.length < 3) {
      this.showError("enter your username first!");
      return;
    }

    this.showError("");
    if (lookupBtn) lookupBtn.disabled = true;
    try {
      const res = await fetch(
        `/api/auth/recovery/lookup?username=${encodeURIComponent(username)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        if (step2) step2.style.display = "none";
        this.showError(data?.error || "could not find recovery question for that username");
        return;
      }
      if (usernameInput && data.username) usernameInput.value = String(data.username);
      if (questionDisplay) questionDisplay.textContent = String(data.questionText || "");
      if (step2) step2.style.display = "block";
      (document.getElementById("recover-answer") as HTMLInputElement | null)?.focus();
    } catch {
      this.showError("connection error looking up account");
    } finally {
      if (lookupBtn) lookupBtn.disabled = false;
    }
  }

  async handleRecoverReset(e: Event): Promise<void> {
    e.preventDefault();
    const username = (
      document.getElementById("recover-username") as HTMLInputElement | null
    )?.value.trim() || "";
    const answer = (
      document.getElementById("recover-answer") as HTMLInputElement | null
    )?.value.trim() || "";
    const newPassword = (
      document.getElementById("recover-new-password") as HTMLInputElement | null
    )?.value || "";

    if (!username || !answer || !newPassword) {
      this.showError("please enter your answer and a new password!");
      return;
    }
    if (newPassword.length < 8) {
      this.showError("new password must be at least 8 characters!");
      return;
    }

    this.showError("");
    try {
      const res = await fetch("/api/auth/recovery/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, answer, newPassword }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error || "could not recover account";
        this.showError(msg);
        if (window.showToast) window.showToast("error", msg, "warning");
        return;
      }

      if (window.showToast) {
        window.showToast("success", "password reset! welcome back", "check");
      }
      this.setSession(data as unknown as SessionData);
      await this.toggleModal();
      await this.restoreData();
    } catch {
      this.showError("connection error resetting password");
    }
  }

  async handleSaveRecoveryQuestion(): Promise<void> {
    const qSelect = document.getElementById("account-recovery-question") as HTMLSelectElement | null;
    const ansInput = document.getElementById("account-recovery-answer") as HTMLInputElement | null;
    const saveBtn = document.getElementById("save-recovery-btn") as HTMLButtonElement | null;
    const questionId = qSelect?.value || "q1";
    const answer = ansInput?.value.trim() || "";

    if (answer.length < 2) {
      if (window.showToast) {
        window.showToast("error", "write an answer (at least 2 characters) first!", "key");
      }
      return;
    }

    if (saveBtn) saveBtn.disabled = true;
    try {
      const res = await fetchWithTimeout("/api/auth/recovery/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, answer }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        if (window.showToast) {
          window.showToast("error", data?.error || "failed to save recovery question", "warning");
        }
        return;
      }
      this.user = {
        ...this.user,
        hasRecoveryQuestion: true,
        recoveryQuestionId: questionId,
        recoveryQuestionText: data.questionText || "",
      };
      localStorage.setItem("auth_user", JSON.stringify(this.user));
      if (ansInput) ansInput.value = "";
      this.updateModalState();
      if (window.showToast) {
        window.showToast("success", "recovery question & answer saved!", "shield-halved");
      }
    } catch {
      if (window.showToast) {
        window.showToast("error", "failed to save recovery question", "warning");
      }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  setSession(data: SessionData): void {
    this.isAuthenticated = true;
    this.user = data.user;
    localStorage.setItem("auth_user", JSON.stringify(this.user));
    if (typeof data.token === "string" && data.token) {
      localStorage.setItem("auth_token", data.token);
    }
    const gate = document.getElementById("auth-gate-backdrop");
    if (gate) gate.remove();
    this.updateModalState();
    this.startPolling();
    window.dispatchEvent(
      new CustomEvent("cloudsync-auth-changed", { detail: this.user })
    );
  }

  async logout(): Promise<void> {
    if (window.showToast) {
      window.showToast("info", "confirm logout?", "sign-out-alt", [
        {
          text: "cancel",
          dismiss: true,
        },
        {
          text: "logout",
          class: "danger-btn",
          dismiss: true,
          callback: async () => {
            await this.performLogout();
          },
        },
      ]);
    } else {
      if (!confirm("confirm logout?")) return;
      void this.performLogout();
    }
  }

  async performLogout(): Promise<void> {
    let toastController: ToastController | null = null;
    if (window.showToast)
      toastController = window.showToast(
        "info",
        "logging out...",
        "right-from-bracket",
        0,
      );

    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (e) {
      console.warn("logout failed!", e);
    }

    if (toastController) toastController.hide();

    this.stopPolling();
    this.isAuthenticated = false;
    this.user = {};
    this._dirtyKeys.clear();
    localStorage.removeItem("auth_user");
    localStorage.removeItem("auth_token");
    localStorage.removeItem("sunshine-sync-meta");

    await this.wipeLocalData();

    window.bypassPreventClosing = true;
    window.location.reload();
  }

  async deleteAccount(): Promise<void> {
    if (!this.isAuthenticated) return;

    if (window.showToast) {
      window.showToast("info", "confirm deletion?", "trash-alt", [
        {
          text: "cancel",
          dismiss: true,
        },
        {
          text: "delete",
          class: "danger-btn",
          dismiss: true,
          callback: async () => {
            await this.performDelete();
          },
        },
      ]);
    } else {
      if (
        confirm(
          "are you sure? this will delete your account and all synced data permanently.",
        )
      ) {
        void this.performDelete();
      }
    }
  }

  async performDelete(): Promise<void> {
    let toastController: ToastController | null = null;
    if (window.showToast)
      toastController = window.showToast(
        "info",
        "deleting account...",
        "trash-alt",
        0,
      );

    try {
      let token = "";
      try {
        token = localStorage.getItem("auth_token") || "";
      } catch {}
      const res = await fetch("/api/auth/me", {
        method: "DELETE",
        credentials: "same-origin",
        headers: token
          ? { Authorization: `Bearer ${token}`, "x-cloudsync-token": token }
          : undefined,
      });

      if (res.ok) {
        if (toastController) toastController.hide();
        this.stopPolling();
        this.isAuthenticated = false;
        this.user = {};
        this._dirtyKeys.clear();
        localStorage.removeItem("auth_user");
        localStorage.removeItem("sunshine-sync-meta");

        await this.wipeLocalData();

        window.bypassPreventClosing = true;
        window.location.reload();
      } else {
        if (toastController) toastController.hide();
        const data = await res.json();
        if (window.showToast)
          window.showToast(
            "error",
            data.error || "deletion failed!",
            "warning",
          );
        else
          alert("failed to delete account: " + (data.error || "unknown error"));
      }
    } catch (err) {
      if (toastController) toastController.hide();
      if (window.showToast)
        window.showToast("error", "deletion failed!", "warning");
      else alert("failed to delete account!");
    }
  }

  showError(msg: string): void {
    const el = document.getElementById("auth-error");
    if (el) {
      el.textContent = msg;
      setTimeout(() => (el.textContent = ""), 3000);
    }
  }

  async wipeLocalData(): Promise<void> {
    try {
      const preserveKeys = [
        "alertClosed",
        "sunshineVisited",
        "sunshineVersion",
        DEVICE_STORAGE_TOKEN_KEY,
      ];

      const preservedData: Record<string, string> = {};
      preserveKeys.forEach((key) => {
        const val = localStorage.getItem(key);
        if (val !== null) preservedData[key] = val;
      });

      localStorage.clear();
      sessionStorage.clear();

      localStorage.removeItem("sunshine-bookmarks");
      const sourceKey = preservedData["gameSource"] || "selenite";
      sessionStorage.removeItem(`sunshine-game-cache${sourceKey}`);

      Object.keys(preservedData).forEach((key) => {
        localStorage.setItem(key, preservedData[key]!);
      });
    } catch (e) {
      console.error("[cloudsync] error during storage wipe:", e);
    }

    try {
      document.cookie.split(";").forEach((c) => {
        document.cookie = c
          .replace(/^ +/, "")
          .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
    } catch (e) {
      console.warn("cookie clear failed!", e);
    }

    if ("indexedDB" in window && typeof indexedDB.databases === "function") {
      try {
        const dbs = await indexedDB.databases();
        for (const dbInfo of dbs) {
          if (dbInfo.name && dbInfo.name !== DEVICE_IDB_NAME) {
            indexedDB.deleteDatabase(
              dbInfo.name!,
            );
          }
        }
      } catch (e) {
        console.warn("[cloudsync] error wiping idb:", e);
      }
    }

    if ("serviceWorker" in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      } catch (e) {
        console.warn("[cloudsync] error unregistering service workers:", e);
      }
    }

    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) {
        console.warn("[cloudsync] error clearing caches:", e);
      }
    }
  }
}

function initCloudSync(): void {
  void new CloudSync();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCloudSync, {
    once: true,
  });
} else {
  initCloudSync();
}

