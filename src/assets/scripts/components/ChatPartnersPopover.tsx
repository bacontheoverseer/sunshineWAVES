import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { checkContent } from "../core/contentFilter.ts";

export interface ChatPartnerMusicCard {
  type: "music";
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  previewUrl?: string;
  spotifyUrl?: string;
  durationSec?: number;
}

export interface ChatPartnerEmbedCard {
  type: "embed";
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  domain?: string;
  imageUrl?: string;
}

export interface ChatPartnerDrawingCard {
  type: "drawing";
  imageUrl: string;
  title?: string;
}

export type ChatPartnerCardPayload =
  | ChatPartnerMusicCard
  | ChatPartnerEmbedCard
  | ChatPartnerDrawingCard;

interface MusicTrackHit {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  previewUrl?: string;
  spotifyUrl?: string;
  durationSec?: number;
}

// Single shared audio element so only one music snippet plays at a time across chat
let activePartnerAudio: HTMLAudioElement | null = null;
let activePartnerAudioKey: string | null = null;
const partnerAudioListeners = new Set<() => void>();

function notifyPartnerAudioListeners() {
  for (const fn of partnerAudioListeners) {
    try { fn(); } catch {}
  }
}

function toggleGlobalSnippetAudio(key: string, previewUrl: string) {
  if (!previewUrl) return;
  if (activePartnerAudio && activePartnerAudioKey === key) {
    if (activePartnerAudio.paused) {
      activePartnerAudio.play().catch(() => {});
    } else {
      activePartnerAudio.pause();
    }
    notifyPartnerAudioListeners();
    return;
  }
  if (activePartnerAudio) {
    try {
      activePartnerAudio.pause();
      activePartnerAudio.src = "";
    } catch {}
  }
  const audio = new Audio(previewUrl);
  audio.crossOrigin = "anonymous";
  audio.volume = 0.85;
  activePartnerAudio = audio;
  activePartnerAudioKey = key;
  audio.addEventListener("timeupdate", notifyPartnerAudioListeners);
  audio.addEventListener("ended", () => {
    if (activePartnerAudio === audio) {
      activePartnerAudioKey = null;
    }
    notifyPartnerAudioListeners();
  });
  audio.addEventListener("pause", notifyPartnerAudioListeners);
  audio.addEventListener("play", notifyPartnerAudioListeners);
  audio.play().catch(() => {});
  notifyPartnerAudioListeners();
}

const DRAW_COLORS = [
  "#ffffff",
  "#f43f5e",
  "#f97316",
  "#facc15",
  "#4ade80",
  "#38bdf8",
  "#a855f7",
  "#111116",
];

const BRUSH_SIZES = [
  { label: "S", size: 3 },
  { label: "M", size: 7 },
  { label: "L", size: 14 },
];

export function ChatPartnerCard({
  card,
  onOpenImageLightbox,
  onCloseChat,
}: {
  card: ChatPartnerCardPayload;
  onOpenImageLightbox: (url: string, name?: string) => void;
  onCloseChat?: () => void;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (card.type !== "music") return;
    const listener = () => setTick((n) => n + 1);
    partnerAudioListeners.add(listener);
    return () => {
      partnerAudioListeners.delete(listener);
    };
  }, [card.type]);

  if (card.type === "music") {
    const audioKey = `card:${card.previewUrl || card.title}:${card.artist}`;
    const isThisActive = activePartnerAudioKey === audioKey && activePartnerAudio !== null;
    const isPlaying = isThisActive && !activePartnerAudio!.paused;
    const progressPct =
      isThisActive && activePartnerAudio && activePartnerAudio.duration > 0
        ? Math.min(100, (activePartnerAudio.currentTime / activePartnerAudio.duration) * 100)
        : 0;

    return (
      <div class="chat-partner-card chat-partner-music-card">
        <div class="chat-partner-music-art">
          {card.artworkUrl ? (
            <img src={card.artworkUrl} alt={card.title} loading="lazy" decoding="async" />
          ) : (
            <i class="fa-solid fa-music"></i>
          )}
        </div>
        <div class="chat-partner-music-body">
          <div class="chat-partner-music-top">
            <div class="chat-partner-music-meta">
              <div class="chat-partner-music-title" title={card.title}>
                {card.title}
              </div>
              <div class="chat-partner-music-artist" title={card.artist}>
                {card.artist}
              </div>
            </div>
            <div class="chat-partner-music-controls">
              {card.previewUrl && (
                <button
                  type="button"
                  class={`chat-partner-play-btn${isPlaying ? " playing" : ""}`}
                  title={isPlaying ? "Pause snippet" : "Play 30s snippet"}
                  onClick={() => toggleGlobalSnippetAudio(audioKey, card.previewUrl!)}
                >
                  <i class={`fa-solid ${isPlaying ? "fa-pause" : "fa-play"}`}></i>
                </button>
              )}
              {card.spotifyUrl && (
                <a
                  href={card.spotifyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="chat-partner-spotify-link"
                  title="Open on Spotify"
                >
                  <i class="fa-brands fa-spotify"></i>
                </a>
              )}
            </div>
          </div>
          <div class="chat-partner-music-bar">
            <div class="chat-partner-music-bar-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div class="chat-partner-music-foot">
            <span>
              <i class="fa-brands fa-spotify" style={{ color: "#1db954", marginRight: "4px" }}></i>
              music snippet · 30s
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (card.type === "embed") {
    const safeCheck = checkContent(`${card.url} ${card.title} ${card.description || ""}`);
    if (safeCheck.blocked) {
      return (
        <div class="chat-partner-card chat-partner-embed-blocked">
          <i class="fa-solid fa-shield-halved"></i>
          <span>embed hidden by content safety filter</span>
        </div>
      );
    }

    const handleOpenEmbed = (e: Event) => {
      e.preventDefault();
      if ((window as any).sunshineApp?.handleSearch) {
        onCloseChat?.();
        void (window as any).sunshineApp.handleSearch(card.url, card.title);
      } else {
        window.open(card.url, "_blank", "noopener,noreferrer");
      }
    };

    return (
      <a
        href={card.url}
        class="chat-partner-card chat-partner-embed-card"
        onClick={handleOpenEmbed}
        title={`Open ${card.url}`}
      >
        <div class="chat-partner-embed-body">
          <div class="chat-partner-embed-site">
            <i class="fa-solid fa-globe"></i>
            <span>{card.siteName || card.domain || "link"}</span>
          </div>
          <div class="chat-partner-embed-title">{card.title}</div>
          {card.description && (
            <div class="chat-partner-embed-desc">{card.description}</div>
          )}
          <div class="chat-partner-embed-url">{card.domain || card.url}</div>
        </div>
        {card.imageUrl && (
          <div class="chat-partner-embed-thumb">
            <img
              src={`/api/chat/image-proxy?url=${encodeURIComponent(card.imageUrl)}`}
              alt={card.title}
              loading="lazy"
              decoding="async"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
      </a>
    );
  }

  if (card.type === "drawing") {
    return (
      <div class="chat-partner-card chat-partner-drawing-card">
        <div class="chat-partner-drawing-head">
          <i class="fa-solid fa-paintbrush"></i>
          <span>{card.title || "sketch"}</span>
        </div>
        <img
          src={card.imageUrl}
          alt={card.title || "Drawing"}
          class="chat-partner-drawing-img"
          loading="lazy"
          decoding="async"
          title="Click to view full size"
          onClick={() => onOpenImageLightbox(card.imageUrl, card.title || "sketch")}
        />
      </div>
    );
  }

  return null;
}

export default function ChatPartnersPopover({
  popoverRef,
  disabled,
  onSendPartnerCard,
  onOpenCamera,
  onClose,
  notifyToast,
}: {
  popoverRef: any;
  disabled?: boolean;
  onSendPartnerCard: (card: ChatPartnerCardPayload) => Promise<void>;
  onOpenCamera: () => void;
  onClose: () => void;
  notifyToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [tab, setTab] = useState<"music" | "embed" | "draw">("music");
  const [sendingCard, setSendingCard] = useState(false);

  // Music state
  const [musicQuery, setMusicQuery] = useState("");
  const [musicHits, setMusicHits] = useState<MusicTrackHit[]>([]);
  const [musicLoading, setMusicLoading] = useState(false);
  const [, setAudioTick] = useState(0);

  // Embed state
  const [embedUrl, setEmbedUrl] = useState("");
  const [embedTitle, setEmbedTitle] = useState("");
  const [embedDesc, setEmbedDesc] = useState("");
  const [embedPreview, setEmbedPreview] = useState<ChatPartnerEmbedCard | null>(null);
  const [embedLoading, setEmbedLoading] = useState(false);
  const [embedError, setEmbedError] = useState("");

  // Draw state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawColor, setDrawColor] = useState("#ffffff");
  const [brushSize, setBrushSize] = useState(7);
  const [isEraser, setIsEraser] = useState(false);
  const [drawTitle, setDrawTitle] = useState("");
  const isDrawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    const listener = () => setAudioTick((n) => n + 1);
    partnerAudioListeners.add(listener);
    return () => {
      partnerAudioListeners.delete(listener);
    };
  }, []);

  // Initialize drawing canvas dark background when switching to Draw tab
  useEffect(() => {
    if (tab !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!hasDrawnRef.current) {
      ctx.fillStyle = "#14141b";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, [tab]);

  const searchMusic = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setMusicHits([]);
      return;
    }
    setMusicLoading(true);
    try {
      const res = await fetch(`/api/chat/partners/music?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json().catch(() => null);
      setMusicHits(Array.isArray(data?.tracks) ? data.tracks : []);
    } catch {
      setMusicHits([]);
    } finally {
      setMusicLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "music") return;
    const trimmed = musicQuery.trim();
    if (!trimmed) {
      setMusicHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchMusic(trimmed);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [musicQuery, tab, searchMusic]);

  const handleFetchEmbedPreview = async () => {
    setEmbedError("");
    const raw = embedUrl.trim();
    if (!raw) {
      setEmbedError("enter a website url first");
      return;
    }
    const localCheck = checkContent(`${raw} ${embedTitle} ${embedDesc}`);
    if (localCheck.blocked) {
      setEmbedError(localCheck.reason || "blocked by safety filter");
      return;
    }
    setEmbedLoading(true);
    try {
      const res = await fetch("/api/chat/partners/embed-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data?.embed) {
        setEmbedError(String(data?.error || "could not load embed preview").toLowerCase());
        setEmbedPreview(null);
        return;
      }
      const fetched: ChatPartnerEmbedCard = {
        type: "embed",
        url: data.embed.url,
        title: embedTitle.trim() || data.embed.title || data.embed.domain,
        description: embedDesc.trim() || data.embed.description || "",
        siteName: data.embed.siteName || data.embed.domain,
        domain: data.embed.domain,
        imageUrl: data.embed.imageUrl || "",
      };
      setEmbedPreview(fetched);
      if (!embedTitle.trim()) setEmbedTitle(fetched.title);
      if (!embedDesc.trim() && fetched.description) setEmbedDesc(fetched.description);
    } catch {
      setEmbedError("failed to preview url");
    } finally {
      setEmbedLoading(false);
    }
  };

  const handleSendEmbed = async () => {
    setEmbedError("");
    const raw = embedUrl.trim();
    if (!raw) {
      setEmbedError("enter a website url first");
      return;
    }
    const localCheck = checkContent(`${raw} ${embedTitle} ${embedDesc}`);
    if (localCheck.blocked) {
      setEmbedError(localCheck.reason || "blocked by safety filter");
      return;
    }
    setSendingCard(true);
    try {
      let finalCard = embedPreview;
      if (!finalCard || finalCard.url !== (raw.startsWith("http") ? raw : `https://${raw}`)) {
        const res = await fetch("/api/chat/partners/embed-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: raw }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !data?.embed) {
          setEmbedError(String(data?.error || "embed blocked or invalid").toLowerCase());
          return;
        }
        finalCard = {
          type: "embed",
          url: data.embed.url,
          title: embedTitle.trim() || data.embed.title || data.embed.domain,
          description: embedDesc.trim() || data.embed.description || "",
          siteName: data.embed.siteName || data.embed.domain,
          domain: data.embed.domain,
          imageUrl: data.embed.imageUrl || "",
        };
      } else {
        finalCard = {
          ...finalCard,
          title: embedTitle.trim() || finalCard.title,
          description: embedDesc.trim() || finalCard.description,
        };
      }
      await onSendPartnerCard(finalCard);
      setEmbedUrl("");
      setEmbedTitle("");
      setEmbedDesc("");
      setEmbedPreview(null);
      onClose();
    } finally {
      setSendingCard(false);
    }
  };

  // Canvas drawing helpers
  const getCanvasPoint = (e: PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: PointerEvent) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(e.pointerId);
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStackRef.current.length > 20) undoStackRef.current.shift();
    isDrawingRef.current = true;
    hasDrawnRef.current = true;
    const pt = getCanvasPoint(e);
    lastPtRef.current = pt;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, (isEraser ? brushSize * 1.6 : brushSize) / 2, 0, Math.PI * 2);
    ctx.fillStyle = isEraser ? "#14141b" : drawColor;
    ctx.fill();
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !lastPtRef.current) return;
    const pt = getCanvasPoint(e);
    ctx.beginPath();
    ctx.moveTo(lastPtRef.current.x, lastPtRef.current.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.strokeStyle = isEraser ? "#14141b" : drawColor;
    ctx.lineWidth = isEraser ? brushSize * 1.6 : brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPtRef.current = pt;
  };

  const handlePointerUp = () => {
    isDrawingRef.current = false;
    lastPtRef.current = null;
  };

  const handleUndoDraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
  };

  const handleClearDraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    ctx.fillStyle = "#14141b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
  };

  const handleSendDrawing = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawnRef.current) {
      notifyToast("draw something on the canvas first!", "error");
      return;
    }
    setSendingCard(true);
    try {
      const dataUrl = canvas.toDataURL("image/webp", 0.86);
      let token = "";
      try { token = localStorage.getItem("auth_token") || ""; } catch {}
      const upRes = await fetch("/api/chat/upload-image", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}`, "x-cloudsync-token": token } : {}),
        },
        body: JSON.stringify({
          dataUrl,
          name: `${drawTitle.trim() || "sketch"}.webp`,
        }),
      });
      const upData = await upRes.json().catch(() => null);
      if (!upRes.ok || !upData?.success || !upData?.url) {
        notifyToast(upData?.error || "failed to upload drawing", "error");
        return;
      }
      await onSendPartnerCard({
        type: "drawing",
        imageUrl: String(upData.url),
        title: drawTitle.trim().slice(0, 80) || "sketch",
      });
      handleClearDraw();
      setDrawTitle("");
      onClose();
    } catch {
      notifyToast("failed to send drawing", "error");
    } finally {
      setSendingCard(false);
    }
  };

  return (
    <div class="chat-partners-popover" ref={popoverRef}>
      <div class="chat-partners-header">
        <div class="chat-partners-title">
          <i class="fa-solid fa-link"></i>
          <span>partners</span>
        </div>
        <div class="chat-partners-tabs">
          <button
            type="button"
            class={`chat-partners-tab${tab === "music" ? " active" : ""}`}
            onClick={() => setTab("music")}
          >
            <i class="fa-solid fa-music"></i>
            <span>music</span>
          </button>
          <button
            type="button"
            class={`chat-partners-tab${tab === "embed" ? " active" : ""}`}
            onClick={() => setTab("embed")}
          >
            <i class="fa-solid fa-globe"></i>
            <span>embed</span>
          </button>
          <button
            type="button"
            class={`chat-partners-tab${tab === "draw" ? " active" : ""}`}
            onClick={() => setTab("draw")}
          >
            <i class="fa-solid fa-paintbrush"></i>
            <span>draw</span>
          </button>
          <button
            type="button"
            class="chat-partners-tab"
            title="Open in-site camera"
            onClick={() => {
              onClose();
              onOpenCamera();
            }}
          >
            <i class="fa-solid fa-camera"></i>
          </button>
        </div>
      </div>

      {tab === "music" && (
        <div class="chat-partners-pane">
          <div class="chat-partners-search-row">
            <i class="fa-brands fa-spotify" style={{ color: "#1db954" }}></i>
            <input
              type="text"
              class="chat-partners-input"
              placeholder="search a song, artist, or paste spotify track link..."
              value={musicQuery}
              autoFocus
              onInput={(e) => setMusicQuery((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="chat-partners-music-list">
            {musicLoading ? (
              <div class="chat-partners-empty">
                <i class="fa-solid fa-spinner fa-spin"></i> searching snippets...
              </div>
            ) : musicHits.length === 0 ? (
              <div class="chat-partners-empty">
                <i class="fa-solid fa-headphones"></i>{" "}
                {musicQuery.trim()
                  ? "no tracks found — try another song or artist"
                  : "search any song to send a playable 30s music snippet"}
              </div>
            ) : (
              musicHits.map((track) => {
                const pKey = `picker:${track.id}`;
                const playing =
                  activePartnerAudioKey === pKey &&
                  activePartnerAudio !== null &&
                  !activePartnerAudio.paused;
                return (
                  <div key={track.id} class="chat-partners-track-row">
                    <div class="chat-partners-track-art">
                      {track.artworkUrl ? (
                        <img src={track.artworkUrl} alt={track.title} loading="lazy" />
                      ) : (
                        <i class="fa-solid fa-music"></i>
                      )}
                    </div>
                    <div class="chat-partners-track-info">
                      <div class="chat-partners-track-title">{track.title}</div>
                      <div class="chat-partners-track-artist">{track.artist}</div>
                    </div>
                    <div class="chat-partners-track-actions">
                      {track.previewUrl && (
                        <button
                          type="button"
                          class={`chat-partners-mini-btn${playing ? " active" : ""}`}
                          title={playing ? "Pause preview" : "Preview 30s"}
                          onClick={() => toggleGlobalSnippetAudio(pKey, track.previewUrl!)}
                        >
                          <i class={`fa-solid ${playing ? "fa-pause" : "fa-play"}`}></i>
                        </button>
                      )}
                      <button
                        type="button"
                        class="chat-partners-send-pill"
                        disabled={disabled || sendingCard}
                        onClick={async () => {
                          setSendingCard(true);
                          try {
                            await onSendPartnerCard({
                              type: "music",
                              title: track.title,
                              artist: track.artist,
                              album: track.album,
                              artworkUrl: track.artworkUrl,
                              previewUrl: track.previewUrl,
                              spotifyUrl: track.spotifyUrl,
                              durationSec: 30,
                            });
                            onClose();
                          } finally {
                            setSendingCard(false);
                          }
                        }}
                      >
                        <i class="fa-solid fa-paper-plane"></i>
                        <span>send</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {tab === "embed" && (
        <div class="chat-partners-pane">
          <div class="chat-partners-embed-form">
            <div class="chat-partners-url-row">
              <input
                type="url"
                class="chat-partners-input"
                placeholder="https://example.com..."
                value={embedUrl}
                onInput={(e) => {
                  setEmbedUrl((e.target as HTMLInputElement).value);
                  setEmbedError("");
                }}
              />
              <button
                type="button"
                class="chat-partners-mini-btn"
                disabled={embedLoading || !embedUrl.trim()}
                title="Fetch link preview"
                onClick={() => void handleFetchEmbedPreview()}
              >
                <i class={`fa-solid ${embedLoading ? "fa-spinner fa-spin" : "fa-eye"}`}></i>
              </button>
            </div>
            <input
              type="text"
              class="chat-partners-input"
              maxLength={120}
              placeholder="optional custom title..."
              value={embedTitle}
              onInput={(e) => setEmbedTitle((e.target as HTMLInputElement).value)}
            />
            <input
              type="text"
              class="chat-partners-input"
              maxLength={220}
              placeholder="optional description..."
              value={embedDesc}
              onInput={(e) => setEmbedDesc((e.target as HTMLInputElement).value)}
            />
            {embedError && (
              <div class="chat-partners-error">
                <i class="fa-solid fa-shield-halved"></i> {embedError}
              </div>
            )}
            {embedPreview && (
              <div class="chat-partners-embed-preview-box">
                <div class="chat-partner-embed-site">
                  <i class="fa-solid fa-globe"></i> {embedPreview.siteName || embedPreview.domain}
                </div>
                <div class="chat-partner-embed-title">{embedTitle.trim() || embedPreview.title}</div>
                {(embedDesc.trim() || embedPreview.description) && (
                  <div class="chat-partner-embed-desc">
                    {embedDesc.trim() || embedPreview.description}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              class="chat-partners-primary-btn"
              disabled={disabled || sendingCard || embedLoading || !embedUrl.trim()}
              onClick={() => void handleSendEmbed()}
            >
              <i class={`fa-solid ${sendingCard ? "fa-spinner fa-spin" : "fa-paper-plane"}`}></i>
              <span>{sendingCard ? "sending embed..." : "send embed card"}</span>
            </button>
          </div>
        </div>
      )}

      {tab === "draw" && (
        <div class="chat-partners-pane">
          <div class="chat-partners-draw-tools">
            <div class="chat-partners-swatches">
              {DRAW_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  class={`chat-partners-swatch${!isEraser && drawColor === c ? " active" : ""}`}
                  style={{ backgroundColor: c }}
                  title={c}
                  onClick={() => {
                    setIsEraser(false);
                    setDrawColor(c);
                  }}
                />
              ))}
            </div>
            <div class="chat-partners-brush-group">
              {BRUSH_SIZES.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  class={`chat-partners-mini-btn${!isEraser && brushSize === b.size ? " active" : ""}`}
                  onClick={() => {
                    setIsEraser(false);
                    setBrushSize(b.size);
                  }}
                >
                  {b.label}
                </button>
              ))}
              <button
                type="button"
                class={`chat-partners-mini-btn${isEraser ? " active" : ""}`}
                title="Eraser"
                onClick={() => setIsEraser((v) => !v)}
              >
                <i class="fa-solid fa-eraser"></i>
              </button>
              <button
                type="button"
                class="chat-partners-mini-btn"
                title="Undo"
                onClick={handleUndoDraw}
              >
                <i class="fa-solid fa-rotate-left"></i>
              </button>
              <button
                type="button"
                class="chat-partners-mini-btn"
                title="Clear canvas"
                onClick={handleClearDraw}
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>

          <canvas
            ref={canvasRef}
            width={420}
            height={220}
            class="chat-partners-canvas"
            onPointerDown={handlePointerDown as any}
            onPointerMove={handlePointerMove as any}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />

          <div class="chat-partners-draw-footer">
            <input
              type="text"
              class="chat-partners-input"
              maxLength={60}
              placeholder="optional sketch title..."
              value={drawTitle}
              onInput={(e) => setDrawTitle((e.target as HTMLInputElement).value)}
            />
            <button
              type="button"
              class="chat-partners-send-pill"
              disabled={disabled || sendingCard}
              onClick={() => void handleSendDrawing()}
            >
              <i class={`fa-solid ${sendingCard ? "fa-spinner fa-spin" : "fa-paper-plane"}`}></i>
              <span>{sendingCard ? "sending..." : "send"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
