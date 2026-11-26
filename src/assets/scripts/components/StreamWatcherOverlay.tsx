import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  getAddonAppOpenState,
  isAddonAppInstalled,
  parseStreamEmbedUrl,
  setAddonAppOpenState,
} from "../core/addonApps.ts";

interface StreamWatcherGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RecentStream {
  raw: string;
  embedUrl: string;
  label: string;
  platform: "twitch" | "youtube" | "kick" | "web";
}

const GEOMETRY_KEY = "cookie_streamwatcher_geom_v1";
const STREAM_KEY = "cookie_streamwatcher_stream_v1";
const RECENTS_KEY = "cookie_streamwatcher_recents_v1";

const MIN_W = 260;
const MIN_H = 180;

function loadGeometry(): StreamWatcherGeometry {
  const defaultW = 380;
  const defaultH = 248;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;
  const fallback: StreamWatcherGeometry = {
    x: Math.max(16, vw - defaultW - 24),
    y: Math.max(72, vh - defaultH - 24),
    w: defaultW,
    h: defaultH,
  };
  try {
    const raw = localStorage.getItem(GEOMETRY_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return fallback;
    const w = Math.max(MIN_W, Math.min(vw - 24, Number(p.w) || defaultW));
    const h = Math.max(MIN_H, Math.min(vh - 24, Number(p.h) || defaultH));
    const x = Math.max(8, Math.min(vw - Math.min(w, 180) - 8, Number(p.x) ?? fallback.x));
    const y = Math.max(8, Math.min(vh - 56, Number(p.y) ?? fallback.y));
    return { x, y, w, h };
  } catch {
    return fallback;
  }
}

function loadSavedStream(): RecentStream | null {
  try {
    const raw = localStorage.getItem(STREAM_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p.embedUrl === "string" && p.embedUrl) {
      return p as RecentStream;
    }
  } catch {}
  return null;
}

function loadRecentStreams(): RecentStream[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.slice(0, 4) : [];
  } catch {
    return [];
  }
}

export default function StreamWatcherOverlay() {
  const [visible, setVisible] = useState<boolean>(
    () => isAddonAppInstalled("streamwatcher") && getAddonAppOpenState("streamwatcher")
  );
  const [geom, setGeom] = useState<StreamWatcherGeometry>(() => loadGeometry());
  const [minimized, setMinimized] = useState(false);
  const [activeStream, setActiveStream] = useState<RecentStream | null>(() => loadSavedStream());
  const [recents, setRecents] = useState<RecentStream[]>(() => loadRecentStreams());
  const [editingUrl, setEditingUrl] = useState<boolean>(() => !loadSavedStream());
  const [urlInput, setUrlInput] = useState<string>(() => loadSavedStream()?.raw || "");
  const [errorMsg, setErrorMsg] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [interacting, setInteracting] = useState(false);

  const geomRef = useRef(geom);
  geomRef.current = geom;

  const syncVisible = useCallback(() => {
    const shouldShow =
      isAddonAppInstalled("streamwatcher") && getAddonAppOpenState("streamwatcher");
    setVisible(shouldShow);
  }, []);

  useEffect(() => {
    window.addEventListener("cookie-addons-updated", syncVisible);
    window.addEventListener("storage", syncVisible);
    document.addEventListener("cloudsync-restored", syncVisible);
    return () => {
      window.removeEventListener("cookie-addons-updated", syncVisible);
      window.removeEventListener("storage", syncVisible);
      document.removeEventListener("cloudsync-restored", syncVisible);
    };
  }, [syncVisible]);

  // Keep PiP clamped inside viewport on window resize
  useEffect(() => {
    const onWinResize = () => {
      setGeom((prev) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = Math.max(MIN_W, Math.min(vw - 16, prev.w));
        const h = Math.max(MIN_H, Math.min(vh - 16, prev.h));
        const x = Math.max(8, Math.min(vw - 120, prev.x));
        const y = Math.max(8, Math.min(vh - 48, prev.y));
        return { x, y, w, h };
      });
    };
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, []);

  const persistGeom = (next: StreamWatcherGeometry) => {
    try {
      localStorage.setItem(GEOMETRY_KEY, JSON.stringify(next));
    } catch {}
  };

  const startDrag = (e: PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button") || target?.closest("input")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const init = { ...geomRef.current };
    setInteracting(true);

    const onMove = (ev: PointerEvent) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nx = Math.max(8, Math.min(vw - 120, init.x + (ev.clientX - startX)));
      const ny = Math.max(8, Math.min(vh - 48, init.y + (ev.clientY - startY)));
      setGeom((prev) => ({ ...prev, x: nx, y: ny }));
    };

    const onUp = () => {
      setInteracting(false);
      persistGeom(geomRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const startResize = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const init = { ...geomRef.current };
    setInteracting(true);

    const onMove = (ev: PointerEvent) => {
      const maxW = Math.max(MIN_W, window.innerWidth - init.x - 10);
      const maxH = Math.max(MIN_H, window.innerHeight - init.y - 10);
      const nw = Math.max(MIN_W, Math.min(maxW, init.w + (ev.clientX - startX)));
      const nh = Math.max(MIN_H, Math.min(maxH, init.h + (ev.clientY - startY)));
      setGeom((prev) => ({ ...prev, w: Math.round(nw), h: Math.round(nh) }));
    };

    const onUp = () => {
      setInteracting(false);
      persistGeom(geomRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const applyStream = (raw: string) => {
    setErrorMsg("");
    const parsed = parseStreamEmbedUrl(raw);
    if (!parsed) {
      setErrorMsg("paste a twitch, youtube, kick, or stream url");
      return;
    }
    if (parsed.error || !parsed.embedUrl) {
      setErrorMsg(parsed.error || "invalid stream url");
      return;
    }
    const next: RecentStream = {
      raw: raw.trim(),
      embedUrl: parsed.embedUrl,
      label: parsed.label,
      platform: parsed.platform,
    };
    setActiveStream(next);
    setUrlInput(next.raw);
    setEditingUrl(false);
    setReloadNonce((n) => n + 1);
    try {
      localStorage.setItem(STREAM_KEY, JSON.stringify(next));
      const nextRecents = [next, ...recents.filter((r) => r.embedUrl !== next.embedUrl)].slice(0, 4);
      setRecents(nextRecents);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(nextRecents));
    } catch {}
  };

  if (!visible) return null;

  if (minimized) {
    return (
      <div
        class="streamwatcher-pill"
        style={{ left: `${geom.x}px`, top: `${geom.y}px` }}
        onPointerDown={startDrag as any}
      >
        <i class="fa-solid fa-tv" style={{ color: "#c084fc" }} />
        <span class="streamwatcher-pill-label">
          {activeStream ? activeStream.label : "streamwatcher"}
        </span>
        <button
          type="button"
          class="streamwatcher-icon-btn"
          title="Expand stream"
          onClick={() => setMinimized(false)}
        >
          <i class="fa-solid fa-up-right-and-down-left-from-center" />
        </button>
        <button
          type="button"
          class="streamwatcher-icon-btn"
          title="Close streamwatcher"
          onClick={() => setAddonAppOpenState("streamwatcher", false)}
        >
          <i class="fa-solid fa-xmark" />
        </button>
      </div>
    );
  }

  return (
    <div
      class={`streamwatcher-window${interacting ? " is-interacting" : ""}`}
      style={{
        left: `${geom.x}px`,
        top: `${geom.y}px`,
        width: `${geom.w}px`,
        height: `${geom.h}px`,
      }}
    >
      {/* Draggable Header Bar */}
      <div class="streamwatcher-header" onPointerDown={startDrag as any}>
        <div class="streamwatcher-title">
          <span class="streamwatcher-live-dot" />
          <i class="fa-solid fa-tv" />
          <span>{activeStream ? activeStream.label : "streamwatcher"}</span>
        </div>

        <div class="streamwatcher-actions">
          <button
            type="button"
            class={`streamwatcher-icon-btn${editingUrl ? " active" : ""}`}
            title="Change stream URL"
            onClick={() => setEditingUrl((v) => !v)}
          >
            <i class="fa-solid fa-link" />
          </button>
          {activeStream && (
            <button
              type="button"
              class="streamwatcher-icon-btn"
              title="Reload stream"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <i class="fa-solid fa-rotate-right" />
            </button>
          )}
          <button
            type="button"
            class="streamwatcher-icon-btn"
            title="Minimize to pill"
            onClick={() => setMinimized(true)}
          >
            <i class="fa-solid fa-minus" />
          </button>
          <button
            type="button"
            class="streamwatcher-icon-btn danger"
            title="Close streamwatcher"
            onClick={() => setAddonAppOpenState("streamwatcher", false)}
          >
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
      </div>

      {/* Stream URL Switcher Drawer */}
      {editingUrl && (
        <form
          class="streamwatcher-url-bar"
          onSubmit={(e) => {
            e.preventDefault();
            applyStream(urlInput);
          }}
        >
          <div class="streamwatcher-url-row">
            <input
              type="text"
              class="streamwatcher-input"
              placeholder="twitch.tv/name, youtube live url, kick.com/name..."
              value={urlInput}
              onInput={(e) => {
                setUrlInput((e.target as HTMLInputElement).value);
                setErrorMsg("");
              }}
            />
            <button type="submit" class="streamwatcher-go-btn">
              <i class="fa-solid fa-play" />
            </button>
          </div>
          {errorMsg && <div class="streamwatcher-error">{errorMsg}</div>}
          {recents.length > 0 && (
            <div class="streamwatcher-recents">
              {recents.map((r) => (
                <button
                  key={r.embedUrl}
                  type="button"
                  class="streamwatcher-recent-chip"
                  onClick={() => applyStream(r.raw)}
                >
                  <i
                    class={`fa-solid ${
                      r.platform === "twitch"
                        ? "fa-tower-broadcast"
                        : r.platform === "youtube"
                          ? "fa-play"
                          : "fa-tv"
                    }`}
                  />
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          )}
        </form>
      )}

      {/* Video Stage */}
      <div class="streamwatcher-stage">
        {activeStream ? (
          <iframe
            key={`${activeStream.embedUrl}:${reloadNonce}`}
            src={activeStream.embedUrl}
            class="streamwatcher-iframe"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <div class="streamwatcher-empty">
            <i class="fa-solid fa-tv" />
            <div class="streamwatcher-empty-title">streamwatcher pip</div>
            <div class="streamwatcher-empty-sub">
              paste a twitch, youtube live, kick, or stream url above — drag &amp; resize anywhere on every page
            </div>
          </div>
        )}
        {interacting && <div class="streamwatcher-pointer-shield" />}
      </div>

      {/* Bottom-Right Resize Grip */}
      <div
        class="streamwatcher-resize-handle"
        title="Drag to resize"
        onPointerDown={startResize as any}
      >
        <i class="fa-solid fa-up-right-and-down-left-from-center" />
      </div>
    </div>
  );
}
