type ConnectionState =
  | "IDLE"
  | "CONNECTING"
  | "CONNECTED"
  | "FAILED"
  | "RECONNECTING";

interface AppConfig {
  backend: string;
  transport: string;
}

interface ResolvablePromise<T = void> extends Promise<T> {
  _resolve: (value: T | PromiseLike<T>) => void;
  _reject: (reason?: unknown) => void;
  _settled: boolean;
}

interface BareMuxConnectionInstance {
  getTransport(): Promise<string>;
  setTransport(module: string, options: Array<{ wisp: string }>): Promise<void>;
}

declare global {
  interface Window {
    sunshineConnection: sunshineConnectionManager;
    BareMux?: {
      BareMuxConnection: new (path: string) => BareMuxConnectionInstance;
    };
  }
}

declare const BareMux: Window["BareMux"];

const STATES = Object.freeze({
  IDLE: "IDLE",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  FAILED: "FAILED",
  RECONNECTING: "RECONNECTING",
} as const);

const TRANSPORT_MAP: Record<string, string> = {
  epoxy: "/epoxy/index.mjs",
  libcurl: "/libcurl/index.mjs",
};

const SCOPE_MAP: Record<string, string> = {
  ultraviolet: "/b/u/r/",
  scramjet: "/b/s/r/",
};

function createResolvablePromise<T = void>(): ResolvablePromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  }) as ResolvablePromise<T>;
  promise._settled = false;
  promise._resolve = (value: T | PromiseLike<T>) => {
    promise._settled = true;
    resolve(value);
  };
  promise._reject = (reason?: unknown) => {
    promise._settled = true;
    reject(reason);
  };
  return promise;
}

class sunshineConnectionManager {
  state: ConnectionState;
  appConfig: AppConfig;
  bareMuxConnection: BareMuxConnectionInstance | null;
  currentWispUrl: string;
  healthCheckInterval: ReturnType<typeof setInterval> | null;
  isInitialLoad: boolean;
  _transportReadyPromise: ResolvablePromise;
  _retryCount: number;
  _isRecovering: boolean;
  _tabWasHiddenWhileConnected: boolean;
  _hiddenAtMs: number;
  _swEnsurePromises: Map<string, Promise<ServiceWorkerRegistration>>;
  _inRetryBackoff: boolean;

  constructor() {
    this.state = STATES.IDLE;
    this.appConfig = { backend: "scramjet", transport: "libcurl" };
    this.bareMuxConnection = null;
    this.currentWispUrl = "";
    this.healthCheckInterval = null;
    this.isInitialLoad = true;
    this._transportReadyPromise = createResolvablePromise();
    this._retryCount = 0;
    this._isRecovering = false;
    this._tabWasHiddenWhileConnected = false;
    this._hiddenAtMs = 0;
    this._swEnsurePromises = new Map();
    this._inRetryBackoff = false;

    const app = ((window as unknown as Record<string, unknown>)["sunshineApp"] ??= {}) as typeof window.sunshineApp;
    app.transportReady = this._transportReadyPromise;
    (app as unknown as Record<string, unknown>)["ensureServiceWorkerReady"] = (
      opts?: { scope?: string; forceReRegister?: boolean; timeoutMs?: number },
    ) => this.ensureServiceWorkerReady(opts);

    app.waitForTransport = async (timeoutMs = 10000) => {
      if (this._transportReadyPromise._settled && this.state === STATES.CONNECTED) {
        const [swOk, transportOk] = await Promise.all([
          this._verifyServiceWorker(),
          this._verifyTransport(),
        ]);
        if (!swOk || !transportOk) {
          this._resetTransportReady();
          await this.recoverOnWake({ forceReapply: true });
        }
      } else {
        if (this._transportReadyPromise._settled && this.state !== STATES.CONNECTED) {
          this._resetTransportReady();
        }
        if (
          this.state === STATES.IDLE ||
          this.state === STATES.FAILED ||
          (this.state === STATES.RECONNECTING && this._inRetryBackoff)
        ) {
          void this.initializeApp(this.state !== STATES.IDLE);
        }
      }
      return Promise.race([
        this._transportReadyPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("transport setup timed out")), timeoutMs),
        ),
      ]);
    };

    if (document.readyState === "complete" || document.readyState === "interactive") {
      this.start();
    } else {
      window.addEventListener("DOMContentLoaded", () => this.start());
    }
  }

  start(): void {
    if (!this.preFlightChecks()) return;
    this.loadConfig();
    this.initializeApp();
    this.startHealthCheck();
    this.setupEventListeners();
  }

  _resetTransportReady(): void {
    if (this._transportReadyPromise._settled) {
      this._transportReadyPromise = createResolvablePromise();
      window.sunshineApp.transportReady = this._transportReadyPromise;
    }
  }

  _resolveTransportReady(): void {
    this._transportReadyPromise._resolve(undefined);
  }

  setState(newState: ConnectionState): void {
    if (!Object.values(STATES).includes(newState)) return;
    this.state = newState;
  }

  preFlightChecks(): boolean {
    if (!navigator.serviceWorker) {
      this.updateStatus("fatal: service workers are not supported!", "error");
      this.setState(STATES.FAILED);
      return false;
    }
    if (typeof BareMux !== "object" || !BareMux.BareMuxConnection) {
      this.updateStatus("fatal: baremux library not found!", "error");
      this.setState(STATES.FAILED);
      return false;
    }
    return true;
  }

  updateStatus(message: string, type: string = "info"): void {
    const statusEl = document.getElementById("connection-status");
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = `status-${type}`;
    }
    if (type === "error") {
      console.error(`Status: ${message}`);
    }
  }

  loadConfig(): void {
    try {
      this.appConfig.backend = localStorage.getItem("backend") || "scramjet";
      this.appConfig.transport = localStorage.getItem("transport") || "libcurl";
    } catch {
      this.updateStatus("could not access localStorage! using defaults...", "error");
    }
  }

  async unregisterAllServiceWorkers(): Promise<void> {
    try {
      if ("caches" in window) {
        try {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((name) => caches.delete(name).catch(() => false)));
        } catch {}
      }

      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    } catch (e) {
      this.updateStatus(`sw unregistration failed: ${(e as Error).message}`, "error");
    }
  }

  getActiveScope(): string {
    return SCOPE_MAP[this.appConfig.backend] || "/b/s/r/";
  }

  async _getRegistrationForScope(
    targetScope: string,
  ): Promise<ServiceWorkerRegistration | undefined> {
    if (!("serviceWorker" in navigator)) return undefined;
    const expectedScope = new URL(targetScope, window.location.origin).href;
    try {
      const reg = await navigator.serviceWorker.getRegistration(targetScope);
      if (reg && reg.scope === expectedScope) return reg;
    } catch {}
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.find((r) => r.scope === expectedScope);
    } catch {
      return undefined;
    }
  }

  async _verifyServiceWorker(targetScope?: string): Promise<boolean> {
    if (!("serviceWorker" in navigator)) return false;
    const scope = targetScope || this.getActiveScope();
    const reg = await this._getRegistrationForScope(scope);
    return reg?.active?.state === "activated";
  }

  async _waitForRegistrationActive(
    registration: ServiceWorkerRegistration,
    timeoutMs = 8000,
  ): Promise<void> {
    if (registration.active?.state === "activated") return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const watched = new Set<ServiceWorker>();
      let timer: ReturnType<typeof setTimeout>;
      let failDelayTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        clearTimeout(timer);
        if (failDelayTimer) clearTimeout(failDelayTimer);
        registration.removeEventListener("updatefound", attachCurrent);
        watched.forEach((sw) => sw.removeEventListener("statechange", evaluate));
      };

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else resolve();
      };

      const evaluate = () => {
        if (registration.active?.state === "activated") {
          finish();
          return;
        }
        const candidates = [
          registration.active,
          registration.waiting,
          registration.installing,
        ].filter((sw): sw is ServiceWorker => Boolean(sw));

        const hasLiveWorker = candidates.some((sw) => sw.state !== "redundant");
        if (hasLiveWorker) {
          if (failDelayTimer) {
            clearTimeout(failDelayTimer);
            failDelayTimer = null;
          }
          return;
        }

        // Wait a short tick in case skipWaiting() is swapping installing -> waiting/active
        if (!failDelayTimer) {
          failDelayTimer = setTimeout(() => {
            failDelayTimer = null;
            if (registration.active?.state === "activated") {
              finish();
              return;
            }
            const nextCandidates = [
              registration.active,
              registration.waiting,
              registration.installing,
            ].filter((sw): sw is ServiceWorker => Boolean(sw));
            if (!nextCandidates.some((sw) => sw.state !== "redundant")) {
              finish(new Error("service worker installation failed or became redundant"));
            }
          }, 120);
        }
      };

      const watchWorker = (sw: ServiceWorker | null) => {
        if (!sw || watched.has(sw)) return;
        watched.add(sw);
        sw.addEventListener("statechange", evaluate);
      };

      const attachCurrent = () => {
        watchWorker(registration.installing);
        watchWorker(registration.waiting);
        watchWorker(registration.active);
        evaluate();
      };

      timer = setTimeout(() => {
        finish(new Error("service worker activation timed out"));
      }, timeoutMs);

      registration.addEventListener("updatefound", attachCurrent);
      attachCurrent();
    });
  }

  async ensureServiceWorkerReady(options?: {
    scope?: string;
    forceReRegister?: boolean;
    timeoutMs?: number;
  }): Promise<ServiceWorkerRegistration> {
    if (!window.isSecureContext) {
      throw new Error("service workers require HTTPS (secure context)!");
    }
    if (!("serviceWorker" in navigator)) {
      throw new Error("service workers are not supported!");
    }
    const targetScope = options?.scope || SCOPE_MAP[this.appConfig.backend];
    if (!targetScope) {
      throw new Error(`unknown backend: ${this.appConfig.backend}`);
    }

    const inflight = this._swEnsurePromises.get(targetScope);
    if (inflight) {
      if (!options?.forceReRegister) return inflight;
      await inflight.catch(() => {});
    }

    const work = (async (): Promise<ServiceWorkerRegistration> => {
      if (!options?.forceReRegister) {
        const existing = await this._getRegistrationForScope(targetScope);
        if (existing?.active?.state === "activated") {
          return existing;
        }
        if (existing && (existing.active || existing.waiting || existing.installing)) {
          try {
            await this._waitForRegistrationActive(existing, Math.min(options?.timeoutMs ?? 8000, 4500));
            const refreshed = await this._getRegistrationForScope(targetScope);
            if (refreshed?.active?.state === "activated") {
              return refreshed;
            }
          } catch {}
        }
      }

      // Primary URL is rewritten by build.js to /b/<swHash>.js; fallback remains /b/sw.js if hashed asset 404s.
      const primarySwUrl = "/b/sw.js";
      const fallbackSwUrl = ["", "b", "sw.js"].join("/");
      const scriptCandidates = [primarySwUrl, fallbackSwUrl];

      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const scriptUrl = scriptCandidates[Math.min(attempt, scriptCandidates.length - 1)]!;
        try {
          if (attempt > 0 || options?.forceReRegister) {
            const stale = await this._getRegistrationForScope(targetScope);
            if (stale && stale.active?.state !== "activated") {
              await stale.unregister().catch(() => false);
            }
          }
          const reg = await navigator.serviceWorker.register(scriptUrl, {
            scope: targetScope,
          });
          if (reg.active?.state !== "activated") {
            await this._waitForRegistrationActive(reg, options?.timeoutMs ?? 8000);
          }
          if (reg.active?.state === "activated") {
            return reg;
          }
          lastErr = new Error("service worker registered without active worker");
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            const stuck = await this._getRegistrationForScope(targetScope);
            if (stuck && stuck.active?.state !== "activated") {
              await stuck.unregister().catch(() => false);
            }
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      }
      throw lastErr instanceof Error
        ? lastErr
        : new Error("service worker failed to activate");
    })().finally(() => {
      if (this._swEnsurePromises.get(targetScope) === work) {
        this._swEnsurePromises.delete(targetScope);
      }
    });

    this._swEnsurePromises.set(targetScope, work);
    return work;
  }

  async ensureWispServerConnection(url: string, timeout: number = 1500): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        let ws: WebSocket | undefined;
        let settled = false;
        try {
          ws = new WebSocket(url);
        } catch {
          return reject(new Error("invalid websocket url!"));
        }
  
        const connectionTimeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          if (ws && ws.readyState !== WebSocket.CLOSED) {
            ws.close();
          }
          reject(new Error("wisp connection timed out!"));
        }, timeout);
  
        ws.onopen = () => {
          if (settled) return;
          settled = true;
          clearTimeout(connectionTimeout);
          ws!.close();
          resolve();
        };
        
        ws.onerror = () => {
          if (settled) return;
          settled = true;
          clearTimeout(connectionTimeout);
          reject(new Error("wisp connection failed!"));
        };
  
        ws.onclose = () => {
          if (settled) return;
          settled = true;
          clearTimeout(connectionTimeout);
          reject(new Error("wisp connection closed!"));
        };
      });
    }

  async _verifyTransport(): Promise<boolean> {
    if (!this.bareMuxConnection) return false;
    try {
      const name = await Promise.race([
        this.bareMuxConnection.getTransport(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("transport verify timed out!")), 4000),
        ),
      ]);
      return name.length > 0;
    } catch (e) {
      console.warn("transport verification failed:", e);
      return false;
    }
  }

  async _reapplyTransport(): Promise<boolean> {
    if (!this.bareMuxConnection) return false;
    try {
      const transportModule = TRANSPORT_MAP[this.appConfig.transport];
      if (!transportModule) return false;

      await this.bareMuxConnection.setTransport(transportModule, [
        { wisp: this.currentWispUrl },
      ]);

      const verified = await this._verifyTransport();
      if (verified) {
        this._resolveTransportReady();
        return true;
      }
      return false;
    } catch (e) {
      console.error("failed to re-apply transport:", e);
      return false;
    }
  }

  async initializeApp(isRetry: boolean = false): Promise<boolean | undefined> {
    if (this.state === STATES.CONNECTING && !isRetry) return;
    if (this.state === STATES.RECONNECTING && !this._inRetryBackoff && isRetry) return;
    this._inRetryBackoff = false;
    this.setState(isRetry ? STATES.RECONNECTING : STATES.CONNECTING);

    this._resetTransportReady();

    if (!isRetry) this.updateStatus("connecting...", "info");

    try {
      if (!this.bareMuxConnection) {
        this.bareMuxConnection = new BareMux!.BareMuxConnection("/bmux/worker.js");
        window.sunshineApp.bareMuxConnection = this.bareMuxConnection;
      }

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      this.currentWispUrl = `${protocol}://${window.location.host}/w/`;

      const scope = SCOPE_MAP[this.appConfig.backend];
      if (!scope) throw new Error(`unknown backend: ${this.appConfig.backend}`);

      const scramjetReady =
        this.appConfig.backend === "scramjet"
          ? ((window as unknown as Record<string, unknown>)["ensureScramjetReady"]
              ? (
                  (window as unknown as Record<string, unknown>)[
                    "ensureScramjetReady"
                  ] as () => Promise<void>
                )()
              : ((window as unknown as Record<string, unknown>)[
                  "scramjetReady"
                ] as Promise<unknown> | undefined) || Promise.resolve())
          : Promise.resolve();

      await Promise.all([
        this.ensureWispServerConnection(this.currentWispUrl, 10000),
        this.ensureServiceWorkerReady({ scope }),
        Promise.race([
          scramjetReady,
          new Promise<void>((resolve) => setTimeout(resolve, 8000)),
        ]),
      ]);

      const transportModule = TRANSPORT_MAP[this.appConfig.transport];
      if (!transportModule) throw new Error(`unknown transport: ${this.appConfig.transport}`);

      await this.bareMuxConnection.setTransport(transportModule, [
        { wisp: this.currentWispUrl },
      ]);

      const [transportVerified, swVerified] = await Promise.all([
        this._verifyTransport(),
        this._verifyServiceWorker(scope),
      ]);
      if (!swVerified) {
        throw new Error("service worker is not active after registration");
      }
      if (!transportVerified) {
        throw new Error("transport was set but verification failed");
      }

      this._resolveTransportReady();
      this.updateStatus("successfully connected!", "success");
      this.setState(STATES.CONNECTED);
      this._retryCount = 0;
      this.isInitialLoad = false;

      const el = document.querySelector(".transport-selected");
      if (el) el.textContent = this.appConfig.transport;

      return true;
    } catch (error) {
      this.updateStatus(`connection failed: ${(error as Error).message}`, "error");
      console.error("full error object:", error);
      await this.handleConnectionFailure();
      return false;
    }
  }

  async handleConnectionFailure(): Promise<void> {
    this.setState(STATES.RECONNECTING);
    if (this._retryCount < 10) {
      const delay = Math.min(Math.pow(2, this._retryCount) * 500, 15000);
      this._retryCount++;
      this.updateStatus(`retrying in ${delay / 1000}s... (attempt ${this._retryCount}/10)`, "info");
      this._inRetryBackoff = true;
      await new Promise<void>((res) => setTimeout(res, delay));
      if (!this._inRetryBackoff) return;
      this._inRetryBackoff = false;
      await this.initializeApp(true);
    } else {
      this.updateStatus("connection failed after multiple retries!", "error");
      this.setState(STATES.FAILED);
      this._retryCount = 0;
    }
  }

  startHealthCheck(): void {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    let isChecking = false;
    this.healthCheckInterval = setInterval(async () => {
      if (document.hidden) return;
      if (
        isChecking ||
        this._isRecovering ||
        this.state === STATES.CONNECTING ||
        this.state === STATES.RECONNECTING
      )
        return;

      if (window.sunshineApp?.isLoading) return;
      if (this.state !== STATES.CONNECTED) return;

      isChecking = true;
      try {
        await this.ensureWispServerConnection(this.currentWispUrl, 3000);

        const swAlive = await this._verifyServiceWorker();
        if (!swAlive) {
          console.warn("health check: service worker missing or inactive, re-registering...");
          this._resetTransportReady();
          await this.ensureServiceWorkerReady({ forceReRegister: true });
          const reapplied = await this._reapplyTransport();
          if (!reapplied) {
            await this.initializeApp(true);
          }
          return;
        }

        const transportAlive = await this._verifyTransport();
        if (!transportAlive) {
          console.warn("health check: transport lost in sharedWorker, re-applying...");
          this._resetTransportReady();
          const recovered = await this._reapplyTransport();
          if (!recovered) {
            this.updateStatus("transport lost. reconnecting...", "error");
            await this.initializeApp();
          } else {
            console.log("health check: transport recovered successfully!");
          }
        }
      } catch {
        this.updateStatus("health check failed. reconnecting...", "error");
        await this.initializeApp();
      } finally {
        isChecking = false;
      }
    }, 8000);
  }

  async recoverOnWake(options?: { forceReapply?: boolean }): Promise<void> {
    if (
      this._isRecovering ||
      this.state === STATES.CONNECTING ||
      this.state === STATES.RECONNECTING
    )
      return;

    if (this.state === STATES.IDLE) return;
    if (!navigator.onLine) return;

    const forceReapply = options?.forceReapply === true;

    this._isRecovering = true;
    try {
      const hadActiveSw = await this._verifyServiceWorker();
      await Promise.all([
        this.ensureWispServerConnection(this.currentWispUrl, 3000),
        hadActiveSw ? Promise.resolve() : this.ensureServiceWorkerReady(),
      ]);

      if ((forceReapply || !hadActiveSw) && this.state === STATES.CONNECTED && this.bareMuxConnection) {
        this._resetTransportReady();
        const reapplied = await this._reapplyTransport();
        if (reapplied) {
          this.setState(STATES.CONNECTED);
          this.updateStatus("successfully connected!", "success");
          return;
        }
        console.warn("wake recovery: re-apply failed after resume, full re-init");
        this._retryCount = 0;
        await this.initializeApp(true);
        return;
      }

      const alive = await this._verifyTransport();
      if (alive) {
        if (!this._transportReadyPromise._settled) {
          this._resolveTransportReady();
        }
        if (this.state !== STATES.CONNECTED) {
          this.setState(STATES.CONNECTED);
          this.updateStatus("successfully connected!", "success");
        }
        return;
      }

      console.warn("wake recovery: transport dead, re-applying...");
      this._resetTransportReady();
      const recovered = await this._reapplyTransport();
      if (recovered) {
        console.log("wake recovery: transport recovered via re-apply");
        this.setState(STATES.CONNECTED);
        return;
      }

      console.warn("wake recovery: full re-init required");
      this._retryCount = 0;
      await this.initializeApp(true);
    } catch (err) {
      console.warn("wake recovery: wisp unreachable, full re-init", err);
      this._retryCount = 0;
      this._resetTransportReady();
      await this.initializeApp(true);
    } finally {
      this._isRecovering = false;
    }
  }

  setupEventListeners(): void {
    window.addEventListener("message", async (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; url?: string } | null;
      if (!data || data.type !== "sunshine-prefetch-bridge") return;
      if (typeof data.url !== "string") return;
      try {
        const u = new URL(data.url);
        if (u.origin !== window.location.origin) return;
        if (!u.pathname.startsWith("/b/s/") && !u.pathname.startsWith("/b/u/")) return;
      } catch {
        return;
      }
      let ctrl = navigator.serviceWorker.controller;
      if (!ctrl) {
        const scope = SCOPE_MAP[this.appConfig.backend];
        if (scope) {
          const reg = await navigator.serviceWorker.getRegistration(scope);
          ctrl = reg?.active || null;
        }
      }
      if (!ctrl) return;
      try {
        ctrl.postMessage({ type: "sunshine-prefetch", url: data.url });
      } catch (e) {
        console.warn("failed to postMessage to service worker:", e);
      }
    });

    const applyLiveChanges = async (
      updateFn: () => Promise<void>,
      options?: { resetWorkers?: boolean },
    ): Promise<void> => {
      if (this.state === STATES.CONNECTING || this.state === STATES.RECONNECTING) return;

      this.updateStatus("switching engine...", "info");
      this._resetTransportReady();

      await updateFn();
      if (options?.resetWorkers) {
        await this.ensureServiceWorkerReady({ forceReRegister: true });
      }

      if (this.state === STATES.CONNECTED && this.bareMuxConnection && !options?.resetWorkers) {
        const reapplied = await this._reapplyTransport();
        if (reapplied) {
          this.updateStatus("switched successfully!", "success");
          const el = document.querySelector(".transport-selected");
          if (el) el.textContent = this.appConfig.transport;
          return;
        }
      }

      const success = await this.initializeApp(true);
      if (success) {
        this.updateStatus("switched successfully!", "success");
      }
    };

    window.addEventListener("online", () => {
      this._retryCount = 0;
      if (
        this.state !== STATES.CONNECTED &&
        this.state !== STATES.CONNECTING &&
        this.state !== STATES.RECONNECTING
      ) {
        this.initializeApp();
      } else if (this.state === STATES.CONNECTED) {
        this._resetTransportReady();
        void this.recoverOnWake({ forceReapply: true });
      }
    });

    window.addEventListener("offline", () => {
      this.updateStatus("network offline!", "error");
      this.setState(STATES.FAILED);
      this._resetTransportReady();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this._tabWasHiddenWhileConnected = this.state === STATES.CONNECTED;
        this._hiddenAtMs = Date.now();
      } else {
        const resumeFromHidden = this._tabWasHiddenWhileConnected;
        const hiddenDurationMs = this._hiddenAtMs ? Date.now() - this._hiddenAtMs : 0;
        this._tabWasHiddenWhileConnected = false;
        this._hiddenAtMs = 0;
        const shouldForceReapply = resumeFromHidden && hiddenDurationMs >= 25000;
        if (shouldForceReapply && this.state === STATES.CONNECTED) {
          this._resetTransportReady();
        }
        setTimeout(
          () => void this.recoverOnWake(shouldForceReapply ? { forceReapply: true } : undefined),
          0,
        );
      }
    });

    window.addEventListener("pageshow", (ev: PageTransitionEvent) => {
      if (!ev.persisted) return;
      if (this.state !== STATES.CONNECTED) return;
      this._resetTransportReady();
      void this.recoverOnWake({ forceReapply: true });
    });

    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { type?: string; failures?: number } | null;
        if (data?.type !== "transport-error") return;
        if (this.state !== STATES.CONNECTED) return;

        const failures = data.failures ?? 1;
        console.warn(`transport error reported by service worker (${failures} consecutive failures), recovering...`);
        this._resetTransportReady();
        this._reapplyTransport().then((recovered) => {
          if (!recovered && failures >= 3) {
            console.warn("multiple consecutive failures, full reconnect...");
            this.initializeApp();
          }
        });
      });
    }

    document.addEventListener("newTransport", (e) =>
      applyLiveChanges(async () => {
        this.appConfig.transport = (e as CustomEvent<string>).detail;
      }),
    );
    document.addEventListener("backendUpdated", (e) =>
      applyLiveChanges(async () => {
        this.appConfig.backend = (e as CustomEvent<string>).detail;
      }, { resetWorkers: true }),
    );
  }
}

window.sunshineConnection = new sunshineConnectionManager();
export {};
