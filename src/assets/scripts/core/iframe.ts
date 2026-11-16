import { showLoading, hideLoading } from "../state/store.ts";
import { decodeUrl, getProxyUrl, normalizeGameHistoryUrl } from "./utils";

interface sunshineTab {
  id: number;
  iframe: HTMLIFrameElement;
  title: string;
  favicon: string | null;
  isUrlLoaded: boolean;
  isLoading: boolean;
  fixedTitle?: boolean;
  fixedFavicon?: boolean;
  gameDisplayByUrl?: Record<string, string>;
  historyManager?: {
    getCurrentUrl(): string | null;
    canGoBack(): boolean;
    canGoForward(): boolean;
    push(url: string): void;
    replace(url: string): void;
    back(): string | null;
    forward(): string | null;
  };
  [key: string]: unknown;
}

interface HistoryUIState {
  currentUrl: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
}

declare global {
  interface Window {
    sunshineApp: {
      tabs?: sunshineTab[];
      isLoading?: boolean;
      [key: string]: unknown;
    };
  }
}

let loadingTimeout: ReturnType<typeof setTimeout> | null = null;

function getTabIdFromIframe(iframe: HTMLIFrameElement): number | null {
  if (!iframe) return null;
  const val = iframe.dataset?.tabId;
  if (!val) return null;
  const num = parseInt(val, 10);
  return Number.isNaN(num) ? null : num;
}

function detachContentWindowListeners(iframe: HTMLIFrameElement): void {
  try {
    const iframeWindow = iframe.contentWindow as
      | (Window & Record<string, unknown>)
      | null;
    if (!iframeWindow) return;
    if (iframeWindow.__beforeUnloadHandler) {
      iframeWindow.removeEventListener(
        "beforeunload",
        iframeWindow.__beforeUnloadHandler as EventListener,
      );
      iframeWindow.__beforeUnloadHandler = null;
    }
    if (iframeWindow.__domContentLoadedHandler) {
      iframeWindow.removeEventListener(
        "DOMContentLoaded",
        iframeWindow.__domContentLoadedHandler as EventListener,
      );
      iframeWindow.__domContentLoadedHandler = null;
    }
    if (iframeWindow.__sunshineFocusHandler) {
      iframeWindow.removeEventListener(
        "mousedown",
        iframeWindow.__sunshineFocusHandler as EventListener,
        true,
      );
      iframeWindow.__sunshineFocusHandler = null;
    }
  } catch (e) {
    console.warn("unable to detach iframe window listeners:", e);
  }
}

export function stopIframeLoading(iframe: HTMLIFrameElement): void {
  if (!iframe) return;
  const tabId = getTabIdFromIframe(iframe);
  const iframeExt = iframe as HTMLIFrameElement & Record<string, unknown>;

  if (loadingTimeout) clearTimeout(loadingTimeout);
  if (iframeExt.__usableTimeout) {
    clearTimeout(iframeExt.__usableTimeout as ReturnType<typeof setTimeout>);
    iframeExt.__usableTimeout = null;
  }

  try {
    if (iframe.contentWindow) iframe.contentWindow.stop();
  } catch (e) {
    console.warn("could not stop iframe loading:", e);
  }

  updateTabDetails(iframe);

  hideLoading(tabId ?? undefined);
  window.sunshineApp.isLoading = false;
  iframe.parentElement?.classList.add("loaded");

  const tab = window.sunshineApp?.tabs?.find((tab) => tab.iframe === iframe);
  let currentUrl: string | null | undefined = iframe.dataset.manualUrl;
  if (!currentUrl) {
    try {
      currentUrl = iframe.contentWindow?.location?.href;
    } catch (e) {
      currentUrl = null;
    }
  }
  if (!currentUrl) currentUrl = iframe.src;

  if (tab && currentUrl && currentUrl !== "about:blank") {
    if (tab.historyManager) {
      const hasExistingEntry = !!tab.historyManager.getCurrentUrl();
      if (hasExistingEntry) {
        tab.historyManager.replace(currentUrl);
      } else {
        tab.historyManager.push(currentUrl);
      }
    }
    updateHistoryUI(tab, {
      currentUrl: tab.historyManager?.getCurrentUrl?.() ?? currentUrl,
      canGoBack: tab.historyManager?.canGoBack?.() ?? false,
      canGoForward: tab.historyManager?.canGoForward?.() ?? false,
    });
  }
}

const RETRY_IFRAME_BACKOFF_MS = [250, 500, 900, 1400, 2000, 2500];

function getProxyScopeFromUrl(rawUrl: string): string | null {
  if (!rawUrl || rawUrl === "about:blank") return null;
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    if (parsed.pathname.startsWith("/b/s/")) return "/b/s/r/";
    if (parsed.pathname.startsWith("/b/u/")) return "/b/u/r/";
  } catch {}
  return null;
}

async function getRegistrationForExactScope(
  scope: string,
): Promise<ServiceWorkerRegistration | undefined> {
  if (!("serviceWorker" in navigator)) return undefined;
  const expectedScope = new URL(scope, window.location.origin).href;
  try {
    const reg = await navigator.serviceWorker.getRegistration(scope);
    if (reg && reg.scope === expectedScope) return reg;
  } catch {}
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    return regs.find((r) => r.scope === expectedScope);
  } catch {
    return undefined;
  }
}

async function isActiveServiceWorkerForScope(scope: string): Promise<boolean> {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return false;
  const reg = await getRegistrationForExactScope(scope);
  if (!reg) return false;
  if (reg.active?.state === "activated") return true;
  if (reg.active?.state === "activating" || reg.waiting) {
    const worker = reg.active || reg.waiting;
    if (!worker) return false;
    return await new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        worker.removeEventListener("statechange", onState);
        resolve(ok);
      };
      const onState = () => {
        if (reg.active?.state === "activated") finish(true);
        else if (worker.state === "redundant") finish(false);
      };
      const timer = setTimeout(() => finish(reg.active?.state === "activated"), 2500);
      worker.addEventListener("statechange", onState);
      onState();
    });
  }
  return false;
}

function escapeHtmlAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderProxyUnavailableFrame(
  iframe: HTMLIFrameElement,
  targetUrl: string,
  reason?: string,
): void {
  iframe.dataset.proxyUnavailable = "true";
  iframe.dataset.pendingProxyUrl = targetUrl;
  const safeUrl = escapeHtmlAttr(targetUrl);
  const safeReason = reason ? escapeHtmlAttr(reason) : "";
  iframe.srcdoc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Connection Error</title>
<style>
  body{margin:0;height:100vh;background:#050505;color:#e7e7e7;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;text-align:center}
  .card{max-width:440px;padding:24px}
  h2{margin:0 0 10px;font-size:20px;font-weight:700}
  p{margin:0 0 14px;font-size:13px;color:#b8b8b8;line-height:1.5}
  .reason{font-size:11px;color:#7a7a7a;word-break:break-word;margin-bottom:18px}
  button{background:#fff;color:#050505;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer}
  button:hover{opacity:.9}
</style>
</head>
<body>
  <div class="card">
    <h2>proxy still connecting</h2>
    <p>the service worker or transport wasn't ready in time. Click retry to reconnect and load this page.</p>
    ${safeReason ? `<p class="reason">${safeReason}</p>` : ""}
    <button id="retryBtn" type="button" data-url="${safeUrl}">Retry connection</button>
  </div>
  <script>
    document.getElementById("retryBtn").addEventListener("click", function () {
      this.disabled = true;
      this.textContent = "Reconnecting...";
      window.parent.postMessage({ type: "sunshine-retry-proxy", url: this.getAttribute("data-url") }, "*");
    });
  </script>
</body>
</html>`;
}

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type !== "sunshine-retry-proxy" || typeof data.url !== "string") return;
    const tabs = window.sunshineApp?.tabs || [];
    const matchingTab = tabs.find((t) => t.iframe?.contentWindow === event.source);
    if (matchingTab?.iframe) {
      navigateIframeTo(matchingTab.iframe, data.url, { forceSwRetry: true });
    }
  });
}

async function prepareProxyNavigation(
  targetScope: string,
  forceSwRetry: boolean,
): Promise<{ ready: boolean; reason?: string }> {
  if (!window.isSecureContext) {
    return {
      ready: false,
      reason: "Service workers require HTTPS or localhost (insecure HTTP context).",
    };
  }
  if (!("serviceWorker" in navigator)) {
    return {
      ready: false,
      reason: "Service workers are unavailable or blocked in this browser/profile.",
    };
  }

  const app = window.sunshineApp as unknown as Record<string, unknown>;
  const w = window as unknown as Record<string, unknown>;
  let failureReason = "";

  const runScramjetInit = async () => {
    if (targetScope !== "/b/s/r/") return;
    const ensureFn = w["ensureScramjetReady"];
    const p =
      typeof ensureFn === "function"
        ? (ensureFn as () => Promise<void>)()
        : w["scramjetReady"] &&
            typeof (w["scramjetReady"] as Promise<unknown>).then === "function"
          ? (w["scramjetReady"] as Promise<unknown>)
          : null;
    if (p) {
      await Promise.race([p, new Promise<void>((r) => setTimeout(r, 4500))]).catch(
        () => {},
      );
    }
  };

  const ensureSwFn = app?.["ensureServiceWorkerReady"] as
    | ((opts?: { scope?: string; forceReRegister?: boolean; timeoutMs?: number }) => Promise<unknown>)
    | undefined;
  const ensureProxyFn = app?.["ensureProxyReady"] as (() => Promise<unknown>) | undefined;
  const waitTransportFn = app?.["waitForTransport"] as
    | ((timeoutMs: number) => Promise<void>)
    | undefined;

  try {
    if (typeof ensureProxyFn === "function") {
      await Promise.race([
        ensureProxyFn(),
        new Promise<void>((r) => setTimeout(r, 4000)),
      ]).catch(() => {});
    }
    const resolvedEnsureSw =
      (app?.["ensureServiceWorkerReady"] as typeof ensureSwFn) || ensureSwFn;
    await Promise.all([
      runScramjetInit(),
      typeof resolvedEnsureSw === "function"
        ? resolvedEnsureSw({ scope: targetScope, forceReRegister: forceSwRetry, timeoutMs: 8000 })
        : Promise.resolve(),
    ]);
    const resolvedWaitTransport =
      (app?.["waitForTransport"] as typeof waitTransportFn) || waitTransportFn;
    if (typeof resolvedWaitTransport === "function") {
      await resolvedWaitTransport(4500).catch((err: unknown) => {
        if (err instanceof Error && err.message) failureReason = err.message;
      });
    }
    if (await isActiveServiceWorkerForScope(targetScope)) {
      return { ready: true };
    }
  } catch (e: unknown) {
    failureReason = (e as Error)?.message || String(e);
    console.warn(
      "navigateIframeTo: transport/service worker not ready, attempting recovery...",
      failureReason,
    );
  }

  const conn = w["sunshineConnection"] as
    | {
        recoverOnWake?: (opts?: { forceReapply?: boolean }) => Promise<void>;
        ensureServiceWorkerReady?: (opts?: {
          scope?: string;
          forceReRegister?: boolean;
          timeoutMs?: number;
        }) => Promise<unknown>;
      }
    | undefined;
  try {
    await runScramjetInit();
    if (conn?.ensureServiceWorkerReady) {
      await conn.ensureServiceWorkerReady({
        scope: targetScope,
        forceReRegister: true,
        timeoutMs: 8000,
      });
    } else if (typeof ensureSwFn === "function") {
      await ensureSwFn({ scope: targetScope, forceReRegister: true, timeoutMs: 8000 });
    } else {
      await navigator.serviceWorker.register(["", "b", "sw.js"].join("/"), {
        scope: targetScope,
      });
    }
    if (conn?.recoverOnWake) {
      await Promise.race([
        conn.recoverOnWake({ forceReapply: true }),
        new Promise<void>((r) => setTimeout(r, 4000)),
      ]).catch(() => {});
    }
    if (typeof waitTransportFn === "function") {
      await waitTransportFn(4000).catch(() => {});
    }
  } catch (recoveryErr: unknown) {
    failureReason = (recoveryErr as Error)?.message || failureReason;
    console.warn("navigateIframeTo: recovery failed", failureReason);
  }

  const active = await isActiveServiceWorkerForScope(targetScope);
  return active
    ? { ready: true }
    : {
        ready: false,
        reason: failureReason || "Service worker did not reach activated state.",
      };
}

export function navigateIframeTo(
  iframe: HTMLIFrameElement,
  url: string,
  options?: { isRecoveryRetry?: boolean; forceSwRetry?: boolean },
): void {
  if (!url || !iframe) return;
  const iframeExt = iframe as HTMLIFrameElement & Record<string, unknown>;
  const tab = window.sunshineApp.tabs!.find((t) => t.iframe === iframe);
  showLoading((tab?.id || getTabIdFromIframe(iframe)) ?? undefined);
  window.sunshineApp.isLoading = true;
  delete iframe.dataset.reloadAttempted;
  if (!options?.isRecoveryRetry) {
    delete iframe.dataset.reloadCount;
    delete iframe.dataset.lastReloadAt;
  }
  iframe.parentElement?.classList.remove("loaded");

  if (tab) {
    if (!tab.fixedTitle) {
      tab.title = "fetching data...";
    }
    if (!tab.fixedFavicon) {
      tab.favicon = null;
    }
    if (window.sunshineApp.renderTabs)
      (window.sunshineApp.renderTabs as () => void)();
  }

  iframe.dataset.navigationStarted = "true";
  iframe.removeAttribute("srcdoc");
  delete iframe.dataset.proxyUnavailable;
  delete iframe.dataset.manualUrl;
  delete iframe.dataset.pendingProxyUrl;

  if (iframeExt.__usableTimeout) {
    clearTimeout(iframeExt.__usableTimeout as ReturnType<typeof setTimeout>);
    iframeExt.__usableTimeout = null;
  }

  const navSeq = String(Number(iframe.dataset.navSeq || "0") + 1);
  iframe.dataset.navSeq = navSeq;
  if (iframe.dataset.retryTimer) {
    window.clearTimeout(Number(iframe.dataset.retryTimer));
    delete iframe.dataset.retryTimer;
  }

  const proxyScope = getProxyScopeFromUrl(url);
  if (proxyScope) {
    iframe.dataset.pendingProxyUrl = url;
    (async () => {
      const { ready, reason } = await prepareProxyNavigation(
        proxyScope,
        Boolean(options?.forceSwRetry),
      );
      if (iframe.dataset.navSeq !== navSeq) return;
      if (ready) {
        delete iframe.dataset.pendingProxyUrl;
        iframe.removeAttribute("srcdoc");
        iframe.src = url;
      } else {
        hideLoading((tab?.id || getTabIdFromIframe(iframe)) ?? undefined);
        window.sunshineApp.isLoading = false;
        iframe.parentElement?.classList.add("loaded");
        if (tab && !tab.fixedTitle) {
          tab.title = "Connection Error";
        }
        if (window.sunshineApp.renderTabs) {
          (window.sunshineApp.renderTabs as () => void)();
        }
        renderProxyUnavailableFrame(iframe, url, reason);
      }
    })();
  } else {
    iframe.src = url;
  }
}

export function cleanupIframe(iframe: HTMLIFrameElement): void {
  if (!iframe) return;
  const iframeExt = iframe as HTMLIFrameElement & Record<string, unknown>;
  const handlers = iframeExt.__sunshineInternalHandlers as
    | { onError: EventListener; onLoad: EventListener }
    | null
    | undefined;
  if (handlers) {
    iframe.removeEventListener("error", handlers.onError);
    iframe.removeEventListener("load", handlers.onLoad);
    iframeExt.__sunshineInternalHandlers = null;
  }
  iframeExt[SUSPEND_KEY] = undefined;
  detachContentWindowListeners(iframe);
  iframe.removeAttribute("srcdoc");
  iframe.removeAttribute("data-navigation-started");
  iframe.removeAttribute("data-reload-attempted");
  iframe.removeAttribute("data-manual-url");
  delete iframe.dataset.reloadCount;
  try {
    iframe.contentWindow?.stop?.();
  } catch (e) {}
  try {
    iframe.src = "about:blank";
  } catch (e) {}
  const wrapper = iframe.parentElement;
  if (wrapper) {
    wrapper.style.boxShadow = "";
    wrapper.classList.remove(
      "loaded",
      "active",
      "active-split-left",
      "active-split-right",
      "active-focus",
    );
  }
}

interface sunshineSuspendState {
  hiddenPatched?: boolean;
  rafSuspended?: boolean;
}

const SUSPEND_KEY = "__sunshineSuspend";

function trySuspendAnimations(win: Window & typeof globalThis): void {
  try {
    (win as any).__sunshineSuspendedRAF = win.requestAnimationFrame;
    (win as any).__sunshineSuspendedCAF = win.cancelAnimationFrame;
    let pending = 0;
    const id = win.requestAnimationFrame(() => {
      pending--;
    });
    win.cancelAnimationFrame(id);
    (win as any).requestAnimationFrame = () => 0;
    (win as any).cancelAnimationFrame = () => {};
  } catch (e) {}
}

function tryRestoreAnimations(win: Window & typeof globalThis): void {
  try {
    if ((win as any).__sunshineSuspendedRAF) {
      win.requestAnimationFrame = (win as any).__sunshineSuspendedRAF;
      win.cancelAnimationFrame = (win as any).__sunshineSuspendedCAF;
      (win as any).__sunshineSuspendedRAF = undefined;
      (win as any).__sunshineSuspendedCAF = undefined;
    }
  } catch (e) {}
}

export function reduceIframeMemory(iframe: HTMLIFrameElement): void {
  if (!iframe) return;
  const iframeExt = iframe as HTMLIFrameElement &
    Record<string, sunshineSuspendState | undefined>;
  if (iframeExt[SUSPEND_KEY]) return;

  const state: sunshineSuspendState = {};

  try {
    const win = iframe.contentWindow as
      | (Window & typeof globalThis)
      | null;
    if (!win) return;

    try {
      win.performance?.clearResourceTimings?.();
    } catch (e) {}

    try {
      iframe.blur();
      win.blur?.();
    } catch (e) {}

    iframe.setAttribute("loading", "lazy");

    let doc: Document | null = null;
    try {
      doc = win.document;
    } catch (e) {
      doc = null;
    }
    if (!doc) {
      iframeExt[SUSPEND_KEY] = state;
      return;
    }

    try {
      Object.defineProperty(doc, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(doc, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      state.hiddenPatched = true;
      try {
        doc.dispatchEvent(new Event("visibilitychange"));
      } catch (e) {}
    } catch (e) {}

    try {
      trySuspendAnimations(win);
      state.rafSuspended = true;
    } catch (e) {}
  } catch (e) {}

  iframeExt[SUSPEND_KEY] = state;
}

export function restoreIframeMemory(iframe: HTMLIFrameElement): void {
  if (!iframe) return;
  const iframeExt = iframe as HTMLIFrameElement &
    Record<string, sunshineSuspendState | undefined>;
  const state = iframeExt[SUSPEND_KEY];
  if (!state) return;
  iframeExt[SUSPEND_KEY] = undefined;

  iframe.removeAttribute("loading");

  let doc: Document | null = null;
  let win: Window | null = null;
  try {
    win = iframe.contentWindow;
    doc = iframe.contentWindow?.document ?? null;
  } catch (e) {
    doc = null;
  }

  if (win && state.rafSuspended) {
    tryRestoreAnimations(win as Window & typeof globalThis);
  }

  if (doc && state.hiddenPatched) {
    try {
      delete (doc as unknown as Record<string, unknown>).hidden;
      delete (doc as unknown as Record<string, unknown>).visibilityState;
    } catch (e) {}
    try {
      doc.dispatchEvent(new Event("visibilitychange"));
    } catch (e) {}
  }
}

function updateTabDetails(iframe: HTMLIFrameElement): void {
  const tabToUpdate = window.sunshineApp.tabs!.find(
    (tab) => tab.iframe === iframe,
  );
  if (!tabToUpdate || iframe.dataset.proxyUnavailable === "true") return;
  const prevTitle = tabToUpdate.title;
  const prevFavicon = tabToUpdate.favicon;
  let isReloading = false;
  try {
    const iframeWindow = iframe.contentWindow!;
    const doc = iframeWindow.document;
    const currentProxiedUrl =
      iframe.dataset.manualUrl || iframeWindow.location.href;
    const realUrl = decodeUrl(currentProxiedUrl);

    const newTitle = (doc.title || "").trim();
    const bodyText = (doc.body?.innerText || "").trim();
    const isExpress404Fallthrough =
      newTitle === "404" &&
      (!!doc.getElementById("msgBox") ||
        bodyText.includes("Your content will be available very soon"));
    const isProxyTransientError =
      newTitle === "Scramjet" || newTitle === "Error";
    const currentUrl = iframe.dataset.manualUrl || iframe.src;
    const isProxyTarget = !!getProxyScopeFromUrl(currentUrl);
    const shouldRecoverProxy =
      isProxyTarget && (isExpress404Fallthrough || isProxyTransientError);

    if (!tabToUpdate.fixedTitle) {
      if (newTitle && !shouldRecoverProxy) {
        tabToUpdate.title = newTitle;
      } else if (tabToUpdate.title === "fetching data..." || shouldRecoverProxy) {
        try {
          tabToUpdate.title =
            prevTitle &&
            prevTitle !== "404" &&
            prevTitle !== "Scramjet" &&
            prevTitle !== "Error"
              ? prevTitle
              : new URL(realUrl).hostname || "fetching data...";
        } catch (e) {
          tabToUpdate.title = "fetching data...";
        }
      }
    }

    if (shouldRecoverProxy) {
      const MAX_RELOADS = RETRY_IFRAME_BACKOFF_MS.length;
      const reloadCount = parseInt(iframe.dataset.reloadCount || "0", 10);
      const lastReloadAt = parseInt(iframe.dataset.lastReloadAt || "0", 10);
      const minIntervalMs =
        RETRY_IFRAME_BACKOFF_MS[
          Math.min(reloadCount, RETRY_IFRAME_BACKOFF_MS.length - 1)
        ] ?? 600;
      const now = Date.now();
      const elapsed = lastReloadAt ? now - lastReloadAt : minIntervalMs;
      const isActiveTab = document.body.classList.contains("split-view")
        ? tabToUpdate.id === (window.sunshineApp as any)?.splitPair?.left ||
          tabToUpdate.id === (window.sunshineApp as any)?.splitPair?.right ||
          tabToUpdate.id === (window.sunshineApp as any)?.getActiveTab?.()?.id
        : tabToUpdate.id === (window.sunshineApp as any)?.getActiveTab?.()?.id;
      if (reloadCount < MAX_RELOADS && isActiveTab) {
        iframe.dataset.reloadCount = (reloadCount + 1).toString();
        isReloading = true;
        if (!tabToUpdate.fixedTitle) {
          tabToUpdate.title =
            prevTitle &&
            prevTitle !== "404" &&
            prevTitle !== "Scramjet" &&
            prevTitle !== "Error"
              ? prevTitle
              : "fetching data...";
        }
        iframe.parentElement?.classList.remove("loaded");

        const delayMs = elapsed >= minIntervalMs ? 0 : minIntervalMs - elapsed;
        if (iframe.dataset.retryTimer) {
          window.clearTimeout(Number(iframe.dataset.retryTimer));
        }
        const timerId = window.setTimeout(() => {
          delete iframe.dataset.retryTimer;
          iframe.dataset.lastReloadAt = Date.now().toString();
          navigateIframeTo(iframe, currentUrl, {
            isRecoveryRetry: true,
            forceSwRetry: isExpress404Fallthrough && reloadCount >= 1,
          });
        }, delayMs);
        iframe.dataset.retryTimer = String(timerId);
        return;
      }

      hideLoading(tabToUpdate.id);
      window.sunshineApp.isLoading = false;
      iframe.parentElement?.classList.add("loaded");
      if (!tabToUpdate.fixedTitle) {
        tabToUpdate.title = "Connection Error";
      }
      renderProxyUnavailableFrame(
        iframe,
        currentUrl,
        "Proxy transport/upstream failed to load this page after retries.",
      );
      if (window.sunshineApp.renderTabs) {
        (window.sunshineApp.renderTabs as () => void)();
      }
      return;
    } else if (newTitle) {
      delete iframe.dataset.reloadCount;
      delete iframe.dataset.lastReloadAt;
    }
    const iconLink = doc.querySelector("link[rel*='icon']");
    if (!tabToUpdate.fixedFavicon) {
      if (iconLink) {
        const decodedFavicon = decodeUrl((iconLink as HTMLLinkElement).href);
        tabToUpdate.favicon = decodedFavicon ? getProxyUrl(decodedFavicon) : null;
      } else {
        try {
          tabToUpdate.favicon = getProxyUrl(
            new URL("favicon.ico", realUrl).href,
          );
        } catch (e) {
          tabToUpdate.favicon = null;
        }
      }
    }
  } catch (e) {
    tabToUpdate.title = prevTitle || "new tab";
    if (!tabToUpdate.fixedFavicon) {
      tabToUpdate.favicon = prevFavicon || null;
    }
  } finally {
    if (!isReloading && window.sunshineApp.renderTabs)
      (window.sunshineApp.renderTabs as () => void)();
  }
}

function setupIframeContentListeners(
  iframe: HTMLIFrameElement,
  historyManager: NonNullable<sunshineTab["historyManager"]>,
  tabId: number | null,
): void {
  try {
    const iframeWindow = iframe.contentWindow;
    const hasManualUrl = !!iframe.dataset.manualUrl;
    const isBlank = iframeWindow?.location?.href === "about:blank";
    if (!iframeWindow || iframeWindow === window || (isBlank && !hasManualUrl))
      return;

    const handleNav = (isReplace = false): void => {
      const newUrlInIframe = iframeWindow.location.href;
      const baseManualUrl = iframe.dataset.manualUrl;
      let finalUrlToPush = newUrlInIframe;
      if (baseManualUrl && newUrlInIframe.startsWith("about:blank")) {
        try {
          const newUrlObj = new URL(newUrlInIframe, window.location.origin);
          const baseManualUrlObj = new URL(baseManualUrl);
          baseManualUrlObj.hash = newUrlObj.hash;
          baseManualUrlObj.search = newUrlObj.search;
          finalUrlToPush = baseManualUrlObj.toString();
        } catch (e) {
          finalUrlToPush = newUrlInIframe;
        }
      }
      if (finalUrlToPush !== "about:blank") {
        const currentHistoryUrl = historyManager.getCurrentUrl?.();
        if (isReplace) {
          historyManager.replace(finalUrlToPush);
        } else if (!currentHistoryUrl || currentHistoryUrl !== finalUrlToPush) {
          historyManager.push(finalUrlToPush);
        } else {
          historyManager.replace(finalUrlToPush);
        }
      }
    };

    if (!(iframeWindow.history.pushState as any).__isPatched) {
      const originalPushState = iframeWindow.history.pushState;
      (iframeWindow as any).history.pushState = function (
        ...args: Parameters<typeof History.prototype.pushState>
      ) {
        originalPushState.apply(this, args);
        handleNav();
      };
      (iframeWindow.history.pushState as any).__isPatched = true;
    }
    if (!(iframeWindow.history.replaceState as any).__isPatched) {
      const originalReplaceState = iframeWindow.history.replaceState;
      (iframeWindow as any).history.replaceState = function (
        ...args: Parameters<typeof History.prototype.replaceState>
      ) {
        originalReplaceState.apply(this, args);
        handleNav(true);
      };
      (iframeWindow.history.replaceState as any).__isPatched = true;
    }

    const beforeUnloadHandler = () => {
      showLoading(tabId ?? undefined);
      window.sunshineApp.isLoading = true;
      iframe.parentElement?.classList.remove("loaded");
      const tab = window.sunshineApp.tabs!.find((t) => t.id === tabId);
      if (tab) {
        if (!tab.fixedTitle) {
          tab.title = "fetching data...";
        }
        if (!tab.fixedFavicon) {
          tab.favicon = null;
        }
        if (window.sunshineApp.renderTabs)
          (window.sunshineApp.renderTabs as () => void)();
      }
    };
    (iframeWindow as Window & Record<string, unknown>).__beforeUnloadHandler =
      beforeUnloadHandler;
    iframeWindow.addEventListener("beforeunload", beforeUnloadHandler);

    const domLoadedHandler = () => {
      if (loadingTimeout) clearTimeout(loadingTimeout);

      try {
        const currentUrl = iframeWindow.location.href;
        if (currentUrl && currentUrl !== "about:blank")
          historyManager.replace(currentUrl);
      } catch (e) {}

      updateTabDetails(iframe);
    };
    (iframeWindow as Window & Record<string, unknown>).__domContentLoadedHandler =
      domLoadedHandler;
    iframeWindow.addEventListener("DOMContentLoaded", domLoadedHandler);

    const mouseDownHandler = () => {
      const focusEvent = new CustomEvent("iframe-focus", {
        detail: { tabId },
        bubbles: false,
      });
      iframe.dispatchEvent(focusEvent);
    };
    (iframeWindow as Window & Record<string, unknown>).__sunshineFocusHandler =
      mouseDownHandler;
    iframeWindow.addEventListener("mousedown", mouseDownHandler, true);
  } catch (e) {
    console.warn("could not attach listeners to iframe content.");
  }
}

let _searchInputNav: HTMLInputElement | null = null;
let _backIcon: HTMLElement | null = null;
let _forwardIcon: HTMLElement | null = null;
let _lockIcon: HTMLElement | null = null;
let _navElCheckCount = 0;

function getNavEls() {
  _navElCheckCount++;
  const needsRefresh = _navElCheckCount % 100 === 0;
  if (!_searchInputNav || needsRefresh) _searchInputNav = document.getElementById("searchInputt") as HTMLInputElement | null;
  if (!_backIcon || needsRefresh) _backIcon = document.getElementById("backIcon");
  if (!_forwardIcon || needsRefresh) _forwardIcon = document.getElementById("forwardIcon");
  if (!_lockIcon || needsRefresh) _lockIcon = document.getElementById("lockIcon");
}

export function updateHistoryUI(
  activeTab: sunshineTab,
  { currentUrl, canGoBack, canGoForward }: HistoryUIState,
): void {
  getNavEls();
  const stillExists =
    activeTab && window.sunshineApp?.tabs?.some((tab) => tab.id === activeTab.id);

  if (!activeTab || !activeTab.iframe || !stillExists) {
    if (_searchInputNav) _searchInputNav.value = "";
    if (_backIcon) _backIcon.classList.add("disabled");
    if (_forwardIcon) _forwardIcon.classList.add("disabled");
    if (_lockIcon) _lockIcon.className = "fa-solid fa-magnifying-glass";
    return;
  }

  const { iframe } = activeTab;

  if (_backIcon && _forwardIcon) {
    _backIcon.classList.toggle("disabled", !canGoBack);
    _forwardIcon.classList.toggle("disabled", !canGoForward);
  }

  if (_searchInputNav) {
    let displayUrl: string | null | undefined = currentUrl;
    if (displayUrl === undefined || displayUrl === null) {
      displayUrl = iframe.dataset.manualUrl || iframe.src;
    }

    const decoded = decodeUrl(displayUrl);
    let displayText: string = decoded;

    try {
      const formatter = window.sunshineApp && window.sunshineApp.getGameDisplayLabel;
      if (typeof formatter === "function") {
        const custom = formatter(decoded);
        if (custom) displayText = custom as string;
      }
    } catch (e) {}

    if (
      displayText === decoded &&
      activeTab.gameDisplayByUrl &&
      typeof activeTab.gameDisplayByUrl === "object"
    ) {
      const normalized = normalizeGameHistoryUrl(decoded);
      const remembered = normalized
        ? (activeTab.gameDisplayByUrl as Record<string, string>)[normalized]
        : null;
      if (remembered) displayText = remembered;
    }

    if (displayText === decoded && activeTab.fixedTitle) {
      const rawTitle = (activeTab.title || "").trim();
      const safeTitle = rawTitle.toLowerCase();
      if (
        safeTitle &&
        safeTitle !== "fetching data..." &&
        safeTitle !== "new tab"
      ) {
        const source = (
          localStorage.getItem("gameSource") || "selenite"
        ).toLowerCase();
        displayText = `game: ${safeTitle} / source: ${source}`;
      }
    }

    if (document.activeElement !== _searchInputNav) {
      _searchInputNav.value =
        displayText === "about:blank" || !displayText ? "" : displayText;
    }

    if (_lockIcon) {
      const real = (decoded || "").trim().toLowerCase();
      const hasProtocol = /^[a-z]+:\/\//i.test(real);

      let newClass = "";
      if (!real || real === "about:blank" || !hasProtocol) {
        newClass = "fa-solid fa-magnifying-glass";
      } else if (real.startsWith("https://")) {
        newClass = "fa-solid fa-lock";
      } else {
        newClass = "fa-solid fa-unlock";
      }

      if (_lockIcon.className !== newClass) {
        _lockIcon.className = newClass;
      }
    }
  }
}

export function initializeIframe(
  iframe: HTMLIFrameElement,
  historyManager: NonNullable<sunshineTab["historyManager"]>,
  tabId: number | null,
): void {
  const iframeExt = iframe as HTMLIFrameElement & Record<string, unknown>;

  const onError = (): void => {
    if (loadingTimeout) clearTimeout(loadingTimeout);
    if (iframeExt.__usableTimeout) {
      clearTimeout(iframeExt.__usableTimeout as ReturnType<typeof setTimeout>);
      iframeExt.__usableTimeout = null;
    }
    hideLoading(tabId ?? undefined);
    window.sunshineApp.isLoading = false;
  };

  const onLoad = (): void => {
    if (loadingTimeout) clearTimeout(loadingTimeout);
    if (iframeExt.__usableTimeout) {
      clearTimeout(iframeExt.__usableTimeout as ReturnType<typeof setTimeout>);
      iframeExt.__usableTimeout = null;
    }

    let newUrl: string | undefined;
    try {
      newUrl =
        iframe.dataset.manualUrl ??
        iframe.contentWindow?.location.href ??
        iframe.src;
    } catch (e) {
      newUrl = iframe.dataset.manualUrl ?? iframe.src;
    }

    if (
      newUrl &&
      newUrl !== "about:blank" &&
      newUrl !== "about:srcdoc" &&
      iframe.dataset.proxyUnavailable !== "true"
    ) {
      historyManager.push(newUrl);
    }

    updateTabDetails(iframe);

    hideLoading(tabId ?? undefined);
    window.sunshineApp.isLoading = false;
    iframe.parentElement?.classList.add("loaded");

    setupIframeContentListeners(iframe, historyManager, tabId);
  };

  iframe.addEventListener("error", onError);
  iframe.addEventListener("load", onLoad);
  iframeExt.__sunshineInternalHandlers = { onError, onLoad };
}
