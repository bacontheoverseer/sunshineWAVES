import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  FollowedStreamer,
  buildStreamEmbedUrl,
  followStreamer,
  getFollowedStreamers,
  isAddonAppInstalled,
  unfollowStreamer,
} from "../core/addonApps.ts";

interface StreamWatcherGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LiveStatusInfo {
  live: boolean;
  videoId?: string;
  title?: string;
  uptime?: string;
  checkedAt: number;
}

interface ActivePipStream {
  streamerId: string;
  platform: "twitch" | "youtube";
  channel: string;
  label: string;
  videoId?: string;
  title?: string;
}

const GEOMETRY_KEY = "cookie_streamwatcher_geom_v1";
const MIN_W = 270;
const MIN_H = 185;
const LIVE_POLL_INTERVAL_MS = 60 * 1000;

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

function loadGeometry(): StreamWatcherGeometry {
  const defaultW = 384;
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

export default function StreamWatcherOverlay() {
  const [installed, setInstalled] = useState<boolean>(() => isAddonAppInstalled("streamwatcher"));
  const [managerOpen, setManagerOpen] = useState(false);
  const [follows, setFollows] = useState<FollowedStreamer[]>(() => getFollowedStreamers());
  const [liveMap, setLiveMap] = useState<Record<string, LiveStatusInfo>>({});
  const [checkingLive, setCheckingLive] = useState(false);

  // Follow form state
  const [followInput, setFollowInput] = useState("");
  const [followError, setFollowError] = useState("");

  // Active PiP state
  const [activeStream, setActiveStream] = useState<ActivePipStream | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isHoveringStream, setIsHoveringStream] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [geom, setGeom] = useState<StreamWatcherGeometry>(() => loadGeometry());
  const [interacting, setInteracting] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [useProxy, setUseProxy] = useState(true);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const activeStreamRef = useRef(activeStream);
  activeStreamRef.current = activeStream;
  const dismissedLiveIdsRef = useRef<Set<string>>(new Set());

  const syncFromStorage = useCallback(() => {
    const isInst = isAddonAppInstalled("streamwatcher");
    setInstalled(isInst);
    setFollows(getFollowedStreamers());
    if (!isInst) {
      setManagerOpen(false);
      setActiveStream(null);
    }
  }, []);

  useEffect(() => {
    const onOpenUi = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.id === "streamwatcher") {
        setInstalled(isAddonAppInstalled("streamwatcher"));
        setFollows(getFollowedStreamers());
        setManagerOpen(true);
      }
    };
    window.addEventListener("cookie-addons-updated", syncFromStorage);
    window.addEventListener("cookie-addon-open-ui", onOpenUi);
    window.addEventListener("storage", syncFromStorage);
    document.addEventListener("cloudsync-restored", syncFromStorage);
    return () => {
      window.removeEventListener("cookie-addons-updated", syncFromStorage);
      window.removeEventListener("cookie-addon-open-ui", onOpenUi);
      window.removeEventListener("storage", syncFromStorage);
      document.removeEventListener("cloudsync-restored", syncFromStorage);
    };
  }, [syncFromStorage]);

  const openStreamInPip = useCallback(
    (s: FollowedStreamer, liveInfo?: LiveStatusInfo, opts?: { autoTriggered?: boolean }) => {
      dismissedLiveIdsRef.current.delete(s.id);
      setActiveStream({
        streamerId: s.id,
        platform: s.platform,
        channel: s.channel,
        label: s.label,
        videoId: liveInfo?.videoId,
        title: liveInfo?.title,
      });
      setIsMuted(true); // Always starts muted; hover over stream to unmute
      setMinimized(false);
      setReloadNonce((n) => n + 1);
      if (opts?.autoTriggered) {
        notifyToast(`${s.label} is live! hover stream to unmute`, "info");
      }
    },
    []
  );

  // Background live checker for all followed streamers
  const checkFollowedLive = useCallback(
    async (listOverride?: FollowedStreamer[]) => {
      if (!isAddonAppInstalled("streamwatcher")) return;
      const list = listOverride || getFollowedStreamers();
      if (list.length === 0) return;

      setCheckingLive(true);
      try {
        const results = await Promise.all(
          list.map(async (s) => {
            try {
              const res = await fetch(
                `/api/addons/streamwatcher/check?platform=${encodeURIComponent(s.platform)}&channel=${encodeURIComponent(s.channel)}`,
                { cache: "no-store" }
              );
              const data = res.ok ? await res.json().catch(() => null) : null;
              return {
                streamer: s,
                info: {
                  live: Boolean(data?.live),
                  videoId: typeof data?.videoId === "string" ? data.videoId : undefined,
                  title: typeof data?.title === "string" ? data.title : undefined,
                  uptime: typeof data?.uptime === "string" ? data.uptime : undefined,
                  checkedAt: Date.now(),
                } as LiveStatusInfo,
              };
            } catch {
              return {
                streamer: s,
                info: { live: false, checkedAt: Date.now() } as LiveStatusInfo,
              };
            }
          })
        );

        const nextMap: Record<string, LiveStatusInfo> = {};
        let firstAutoLive: { streamer: FollowedStreamer; info: LiveStatusInfo } | null = null;

        for (const r of results) {
          nextMap[r.streamer.id] = r.info;
          if (!r.info.live) {
            // Stream went offline, clear dismissal so next time they go live it pops up again
            dismissedLiveIdsRef.current.delete(r.streamer.id);
          } else if (
            !firstAutoLive &&
            !dismissedLiveIdsRef.current.has(r.streamer.id) &&
            (r.streamer.platform === "twitch" || Boolean(r.info.videoId))
          ) {
            firstAutoLive = r;
          }
        }

        setLiveMap((prev) => ({ ...prev, ...nextMap }));

        // If no PiP stream is currently open, auto-popup the live streamer (muted)!
        if (!activeStreamRef.current && firstAutoLive) {
          openStreamInPip(firstAutoLive.streamer, firstAutoLive.info, { autoTriggered: true });
        }
      } finally {
        setCheckingLive(false);
      }
    },
    [openStreamInPip]
  );

  // Poll every 60s whenever streamwatcher is installed and has followed streamers
  useEffect(() => {
    if (!installed || follows.length === 0) return;
    void checkFollowedLive(follows);
    const id = window.setInterval(() => {
      void checkFollowedLive();
    }, LIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [installed, follows.length, checkFollowedLive]);

  // Clamp PiP to viewport on resize
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

  const toggleMute = () => {
    if (!activeStream) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    // Instant postMessage mute/unmute for YouTube without reloading!
    if (activeStream.platform === "youtube" && iframeRef.current?.contentWindow) {
      try {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: nextMuted ? "mute" : "unMute",
            args: "",
          }),
          "*"
        );
      } catch {}
    }
  };

  const handleAddFollow = (e: Event) => {
    e.preventDefault();
    setFollowError("");
    const res = followStreamer(followInput);
    if (!res.added || !res.streamer) {
      setFollowError(res.error || "could not follow channel");
      return;
    }
    setFollowInput("");
    const updated = getFollowedStreamers();
    setFollows(updated);
    notifyToast(`following ${res.streamer.label} — checking live status...`, "success");
    void checkFollowedLive(updated);
  };

  const handleClosePip = () => {
    if (activeStream) {
      dismissedLiveIdsRef.current.add(activeStream.streamerId);
    }
    setActiveStream(null);
  };

  if (!installed) return null;

  const activeEmbedUrl = activeStream
    ? buildStreamEmbedUrl(activeStream.platform, activeStream.channel, {
        muted: activeStream.platform === "youtube" ? true : isMuted,
        videoId: activeStream.videoId,
        useProxy,
      })
    : "";

  return (
    <>
      {/* ── STREAMWATCHER APP MANAGER UI (Opened from Add-ons -> Apps -> Open) ── */}
      {managerOpen && (
        <div
          class="streamwatcher-modal-overlay"
          onClick={() => setManagerOpen(false)}
        >
          <div
            class="streamwatcher-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="streamwatcher-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div class="streamwatcher-modal-icon">
                  <i class="fa-solid fa-tv" />
                </div>
                <div>
                  <h3 class="streamwatcher-modal-title">streamwatcher</h3>
                  <div class="streamwatcher-modal-sub">
                    follow twitch or youtube channels — streams auto-pop muted when live
                  </div>
                </div>
              </div>
              <button
                type="button"
                class="streamwatcher-icon-btn"
                title="Close"
                onClick={() => setManagerOpen(false)}
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </div>

            <form class="streamwatcher-follow-form" onSubmit={handleAddFollow}>
              <input
                type="text"
                class="streamwatcher-input"
                placeholder="paste twitch.tv/channel or youtube.com/@channel..."
                value={followInput}
                onInput={(e) => {
                  setFollowInput((e.target as HTMLInputElement).value);
                  setFollowError("");
                }}
              />
              <button type="submit" class="streamwatcher-follow-btn">
                <i class="fa-solid fa-heart" />
                <span>follow</span>
              </button>
            </form>
            {followError && <div class="streamwatcher-error">{followError}</div>}

            <div class="streamwatcher-list-head">
              <span>followed channels ({follows.length})</span>
              <button
                type="button"
                class="streamwatcher-refresh-btn"
                disabled={checkingLive || follows.length === 0}
                onClick={() => void checkFollowedLive()}
              >
                <i class={`fa-solid ${checkingLive ? "fa-spinner fa-spin" : "fa-rotate"}`} />
                <span>{checkingLive ? "checking..." : "check live"}</span>
              </button>
            </div>

            <div class="streamwatcher-follow-list">
              {follows.length === 0 ? (
                <div class="streamwatcher-follow-empty">
                  <i class="fa-solid fa-satellite-dish" />
                  <span>no followed channels yet — paste a twitch or youtube channel url above</span>
                </div>
              ) : (
                follows.map((s) => {
                  const info = liveMap[s.id];
                  const isLive = Boolean(info?.live);
                  const isWatching = activeStream?.streamerId === s.id;
                  return (
                    <div
                      key={s.id}
                      class={`streamwatcher-follow-row${isLive ? " is-live" : ""}`}
                    >
                      <div class="streamwatcher-follow-info">
                        <div class="streamwatcher-follow-name-row">
                          <span class={`streamwatcher-status-dot${isLive ? " is-live" : ""}`} />
                          <i
                            class={`fa-brands ${
                              s.platform === "twitch" ? "fa-twitch" : "fa-youtube"
                            }`}
                            style={{
                              color: s.platform === "twitch" ? "#a855f7" : "#ef4444",
                              fontSize: "12px",
                            }}
                          />
                          <span class="streamwatcher-follow-label">{s.label}</span>
                          {isLive && <span class="streamwatcher-live-tag">live</span>}
                        </div>
                        <div class="streamwatcher-follow-meta">
                          {isLive
                            ? info?.title || info?.uptime || "streaming live now"
                            : "offline · will auto-pop muted when live"}
                        </div>
                      </div>

                      <div class="streamwatcher-follow-actions">
                        {(s.platform === "twitch" || (isLive && info?.videoId)) && (
                          <button
                            type="button"
                            class="streamwatcher-watch-btn"
                            onClick={() => {
                              openStreamInPip(s, info);
                              setManagerOpen(false);
                            }}
                          >
                            <i class={`fa-solid ${isWatching ? "fa-tv" : "fa-play"}`} />
                            <span>{isWatching ? "watching" : "watch"}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          class="streamwatcher-icon-btn danger"
                          title={`Unfollow ${s.label}`}
                          onClick={() => {
                            unfollowStreamer(s.id);
                            if (activeStream?.streamerId === s.id) {
                              setActiveStream(null);
                            }
                            setFollows(getFollowedStreamers());
                          }}
                        >
                          <i class="fa-solid fa-trash-can" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── FLOATING GLOBAL PiP WINDOW (Rounded Rectangle, Draggable, Resizable, Hover to Unmute) ── */}
      {activeStream &&
        (minimized ? (
          <div
            class="streamwatcher-pill"
            style={{ left: `${geom.x}px`, top: `${geom.y}px` }}
            onPointerDown={startDrag as any}
          >
            <span class="streamwatcher-live-dot" />
            <span class="streamwatcher-pill-label">{activeStream.label}</span>
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
              class="streamwatcher-icon-btn danger"
              title="Close stream"
              onClick={handleClosePip}
            >
              <i class="fa-solid fa-xmark" />
            </button>
          </div>
        ) : (
          <div
            class={`streamwatcher-window${interacting ? " is-interacting" : ""}`}
            style={{
              left: `${geom.x}px`,
              top: `${geom.y}px`,
              width: `${geom.w}px`,
              height: `${geom.h}px`,
            }}
            onPointerEnter={() => setIsHoveringStream(true)}
            onPointerLeave={() => setIsHoveringStream(false)}
          >
            <div class="streamwatcher-header" onPointerDown={startDrag as any}>
              <div class="streamwatcher-title">
                <span class="streamwatcher-live-dot" />
                <i
                  class={`fa-brands ${
                    activeStream.platform === "twitch" ? "fa-twitch" : "fa-youtube"
                  }`}
                />
                <span>{activeStream.label}</span>
              </div>

              <div class="streamwatcher-actions">
                <button
                  type="button"
                  class={`streamwatcher-icon-btn${!isMuted ? " active" : ""}`}
                  title={isMuted ? "Unmute stream" : "Mute stream"}
                  onClick={toggleMute}
                >
                  <i class={`fa-solid ${isMuted ? "fa-volume-xmark" : "fa-volume-high"}`} />
                </button>
                <button
                  type="button"
                  class="streamwatcher-icon-btn"
                  title="Followed channels"
                  onClick={() => setManagerOpen(true)}
                >
                  <i class="fa-solid fa-list" />
                </button>
                <button
                  type="button"
                  class={`streamwatcher-icon-btn${useProxy ? " active" : ""}`}
                  title={useProxy ? "Using built-in proxy (click for direct)" : "Using direct embed (click for proxy)"}
                  onClick={() => {
                    setUseProxy((v) => !v);
                    setReloadNonce((n) => n + 1);
                  }}
                >
                  <i class="fa-solid fa-shield-halved" />
                </button>
                <button
                  type="button"
                  class="streamwatcher-icon-btn"
                  title="Reload stream"
                  onClick={() => setReloadNonce((n) => n + 1)}
                >
                  <i class="fa-solid fa-rotate-right" />
                </button>
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
                  title="Close stream"
                  onClick={handleClosePip}
                >
                  <i class="fa-solid fa-xmark" />
                </button>
              </div>
            </div>

            <div class="streamwatcher-stage">
              {activeEmbedUrl && (
                <iframe
                  ref={iframeRef}
                  key={`${activeStream.streamerId}:${activeStream.platform === "twitch" ? (isMuted ? "m" : "u") : "yt"}:${reloadNonce}`}
                  src={activeEmbedUrl}
                  class="streamwatcher-iframe"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                />
              )}

              {/* Hover over the stream to unmute/mute */}
              {isHoveringStream && !interacting && (
                <button
                  type="button"
                  class={`streamwatcher-hover-mute-btn${isMuted ? " is-muted" : ""}`}
                  onClick={toggleMute}
                >
                  <i class={`fa-solid ${isMuted ? "fa-volume-xmark" : "fa-volume-high"}`} />
                  <span>{isMuted ? "unmute stream" : "mute"}</span>
                </button>
              )}

              {interacting && <div class="streamwatcher-pointer-shield" />}
            </div>

            <div
              class="streamwatcher-resize-handle"
              title="Drag to resize"
              onPointerDown={startResize as any}
            >
              <i class="fa-solid fa-up-right-and-down-left-from-center" />
            </div>
          </div>
        ))}
    </>
  );
}
