import { useState, useEffect, useRef } from "preact/hooks";
import { readImageFileAsDataUrl } from "../core/imageUpload.ts";
import {
  AVATAR_EMOJIS,
  BANNER_STYLES,
  BIO_STYLES,
  CARD_BG_SWATCHES,
  CARD_THEMES,
  COLOR_SWATCHES,
  CUSTOM_TAG_PRESETS,
  ChatRole,
  LastfmProfileState,
  NAME_FONTS,
  NAME_STYLES,
  ProfileCustomization,
  getBannerInlineStyle,
  getDefaultCustomization,
  getSafeMediaProxySrc,
  sanitizeLastfmUsername,
} from "../core/profileCustomization.ts";
import LastfmListeningCard from "./LastfmListeningCard.tsx";
import { isChromebookModeEnabled } from "../core/chromebookMode.ts";
import {
  GoatBadge,
  NameplateMediaLayer,
  ProfileEffectLayer,
  ProfileFrameLayer,
  RoleBadge,
  UserAvatar,
  getNameClasses,
} from "./ProfileVisuals.tsx";
import CollectiblePickerPanel from "./CollectiblePickerPanel.tsx";
import ImageCropModal from "./ImageCropModal.tsx";

interface ProfileCustomizerModalProps {
  username: string;
  role: ChatRole;
  isGoat?: boolean | undefined;
  createdAt?: string | null | undefined;
  initialCustom: ProfileCustomization;
  initialBio: string;
  initialStatusText: string;
  saving: boolean;
  onSave: (payload: {
    bio: string;
    statusText: string;
    customization: ProfileCustomization;
  }) => Promise<void>;
  onClose: () => void;
}

interface KlipySearchHit {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
}

export default function ProfileCustomizerModal({
  username,
  role,
  isGoat,
  createdAt,
  initialCustom,
  initialBio,
  initialStatusText,
  saving,
  onSave,
  onClose,
}: ProfileCustomizerModalProps) {
  const [tab, setTab] = useState<
    "profile" | "decoration" | "effect" | "nameplate" | "frame"
  >("profile");
  const [profileSub, setProfileSub] = useState<
    "identity" | "avatar" | "banner" | "theme"
  >("identity");
  const [custom, setCustom] = useState<ProfileCustomization>(initialCustom);
  const [bio, setBio] = useState(initialBio);
  const [statusText, setStatusText] = useState(initialStatusText);
  const [uploadError, setUploadError] = useState("");
  const [gifPickerFor, setGifPickerFor] = useState<"avatar" | "banner" | null>(null);
  const [gifQuery, setGifQuery] = useState("");
  const [gifHits, setGifHits] = useState<KlipySearchHit[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [cropDraft, setCropDraft] = useState<{ kind: "avatar" | "banner"; src: string } | null>(
    null
  );
  const [lastfmPreview, setLastfmPreview] = useState<LastfmProfileState | null>(null);
  const [lastfmPreviewLoading, setLastfmPreviewLoading] = useState(false);

  const avatarFileRef = useRef<HTMLInputElement>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);
  const hasEditedRef = useRef(false);

  // Hydrate draft if parent finishes loading the saved server profile after mount
  useEffect(() => {
    if (hasEditedRef.current) return;
    setCustom(initialCustom);
    setBio(initialBio);
    setStatusText(initialStatusText);
  }, [initialCustom, initialBio, initialStatusText]);

  // Live-fetch Last.fm track preview whenever custom.lastfmUsername changes
  useEffect(() => {
    const handle = sanitizeLastfmUsername(custom.lastfmUsername);
    if (!handle) {
      setLastfmPreview(null);
      setLastfmPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setLastfmPreviewLoading(true);
    const t = window.setTimeout(() => {
      fetch(`/api/chat/lastfm?lastfmUser=${encodeURIComponent(handle)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data?.lastfm) setLastfmPreview(data.lastfm);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLastfmPreviewLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [custom.lastfmUsername]);

  const refreshLastfmPreview = async () => {
    const handle = sanitizeLastfmUsername(custom.lastfmUsername);
    if (!handle) return;
    setLastfmPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/chat/lastfm?lastfmUser=${encodeURIComponent(handle)}&force=1`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.lastfm) setLastfmPreview(data.lastfm);
      }
    } catch {}
    finally {
      setLastfmPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (!gifPickerFor) return;
    let cancelled = false;
    setGifLoading(true);
    const t = window.setTimeout(() => {
      const params = new URLSearchParams({
        page: "1",
        perPage: "12",
        customerId: username,
      });
      if (gifQuery.trim()) params.set("q", gifQuery.trim());
      fetch(`/api/chat/gifs?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && Array.isArray(data?.items)) {
            setGifHits(data.items);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setGifLoading(false);
        });
    }, gifQuery ? 260 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [gifPickerFor, gifQuery, username]);

  const updateField = <K extends keyof ProfileCustomization>(
    key: K,
    value: ProfileCustomization[K]
  ) => {
    hasEditedRef.current = true;
    setCustom((prev) => ({ ...prev, [key]: value }));
  };

  const patchCustom = (patch: Partial<ProfileCustomization>) => {
    hasEditedRef.current = true;
    setCustom((prev) => ({ ...prev, ...patch }));
  };

  const handleFileUpload = async (
    kind: "avatar" | "banner",
    file?: File | null,
    inputEl?: HTMLInputElement | null
  ) => {
    if (inputEl) inputEl.value = "";
    if (!file) return;
    setUploadError("");
    try {
      const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
      if (isGif) {
        const dataUrl = await readImageFileAsDataUrl(file, 256, 256, 320 * 1024);
        updateField(kind === "avatar" ? "avatarUrl" : "bannerUrl", dataUrl);
        return;
      }
      if (
        !file.type.startsWith("image/") &&
        !/\.(png|jpe?g|webp|bmp|avif|gif|jfif)$/i.test(file.name)
      ) {
        throw new Error("Please select an image file");
      }
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read image file"));
        reader.readAsDataURL(file);
      });
      setCropDraft({ kind, src: rawDataUrl });
    } catch (err) {
      setUploadError((err as Error).message || "Could not process image");
    }
  };

  const displayLabel = custom.displayName.trim() || username;
  const bannerStyle = getBannerInlineStyle(custom);
  const bannerClass =
    !custom.bannerUrl && custom.bannerStyle !== "solid"
      ? `banner-${custom.bannerStyle}`
      : "";
  const nameplateClass = [
    custom.nameplate !== "none" ? `has-nameplate nameplate-${custom.nameplate}` : "",
    custom.nameplateUrl ? "has-nameplate has-media-nameplate" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bioClass = `bio-${custom.bioStyle}`;

  return (
    <div
      class="chat-profile-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="chat-customizer-card" onClick={(e) => e.stopPropagation()}>
        <div class="chat-customizer-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <i class="fa-solid fa-wand-magic-sparkles" style={{ color: "#c084fc" }} />
            <span style={{ fontWeight: 700, fontSize: "14px", textTransform: "lowercase" }}>
              customize account profile
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              class="chat-gif-more-btn"
              onClick={() => {
                hasEditedRef.current = true;
                setCustom(getDefaultCustomization(username));
                setBio("");
                setStatusText("");
                setLastfmPreview(null);
              }}
            >
              reset defaults
            </button>
            <button
              type="button"
              class="chat-header-btn"
              onClick={onClose}
              title="Close customizer"
            >
              <i class="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        <div class="chat-customizer-body">
          {/* LEFT: CONTROLS */}
          <div class="chat-customizer-controls">
            <div class="chat-customizer-tabs">
              {(
                [
                  ["profile", "profile"],
                  ["decoration", "decoration"],
                  ["effect", "effect"],
                  ["nameplate", "nameplate"],
                  ["frame", "frame"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  class={`chat-customizer-tab ${tab === id ? "active" : ""}`}
                  onClick={() => {
                    setTab(id);
                    setGifPickerFor(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "profile" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                {(
                  [
                    ["identity", "identity & bio"],
                    ["avatar", "avatar"],
                    ["banner", "banner"],
                    ["theme", "name & theme"],
                  ] as const
                ).map(([sid, slabel]) => (
                  <button
                    key={sid}
                    type="button"
                    class={`chat-vibe-pill ${profileSub === sid ? "active" : ""}`}
                    onClick={() => {
                      setProfileSub(sid);
                      setGifPickerFor(null);
                    }}
                  >
                    {slabel}
                  </button>
                ))}
              </div>
            )}

            {tab !== "profile" && (
              <CollectiblePickerPanel
                kind={tab}
                custom={custom}
                onPatch={patchCustom}
              />
            )}

            {uploadError && (
              <div
                style={{
                  fontSize: "11px",
                  color: "#fca5a5",
                  background: "rgba(239, 68, 68, 0.14)",
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  padding: "6px 10px",
                  borderRadius: "8px",
                }}
              >
                {uploadError}
              </div>
            )}

            {tab === "profile" && profileSub === "identity" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "4px" }}>
                    display name
                  </div>
                  <input
                    type="text"
                    class="chat-mod-input"
                    placeholder={username}
                    maxLength={32}
                    value={custom.displayName}
                    onInput={(e) =>
                      updateField("displayName", (e.target as HTMLInputElement).value)
                    }
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <div class="chat-profile-section-title" style={{ marginBottom: "4px" }}>
                      pronouns
                    </div>
                    <input
                      type="text"
                      class="chat-mod-input"
                      placeholder="they/them, he/him..."
                      maxLength={24}
                      value={custom.pronouns}
                      onInput={(e) =>
                        updateField("pronouns", (e.target as HTMLInputElement).value)
                      }
                    />
                  </div>
                  <div>
                    <div class="chat-profile-section-title" style={{ marginBottom: "4px" }}>
                      custom profile tag
                    </div>
                    <input
                      type="text"
                      class="chat-mod-input"
                      placeholder="gamer, vip, night owl..."
                      maxLength={18}
                      value={custom.customTag}
                      onInput={(e) =>
                        updateField("customTag", (e.target as HTMLInputElement).value)
                      }
                    />
                  </div>
                </div>

                <div class="chat-emoji-grid">
                  {CUSTOM_TAG_PRESETS.map((preset) => (
                    <button
                      key={preset || "none"}
                      type="button"
                      class={`chat-style-chip ${custom.customTag === preset ? "active" : ""}`}
                      style={{ padding: "4px 8px" }}
                      onClick={() => updateField("customTag", preset)}
                    >
                      {preset || "no tag"}
                    </button>
                  ))}
                </div>

                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "4px" }}>
                    custom status & presence dot
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      type="text"
                      class="chat-mod-input"
                      placeholder="chilling on sunshinewaves..."
                      maxLength={60}
                      value={statusText}
                      onInput={(e) => {
                        hasEditedRef.current = true;
                        setStatusText((e.target as HTMLInputElement).value);
                      }}
                    />
                    {(["online", "idle", "dnd"] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        class={`chat-style-chip ${custom.presenceStatus === st ? "active" : ""}`}
                        onClick={() => updateField("presenceStatus", st)}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "4px" }}>
                    last.fm listening (live music on profile)
                  </div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      type="text"
                      class="chat-mod-input"
                      placeholder="last.fm username or profile url..."
                      maxLength={80}
                      value={custom.lastfmUsername}
                      onInput={(e) => {
                        const raw = (e.target as HTMLInputElement).value;
                        updateField("lastfmUsername", sanitizeLastfmUsername(raw));
                      }}
                    />
                    <button
                      type="button"
                      class="chat-style-chip"
                      disabled={!sanitizeLastfmUsername(custom.lastfmUsername) || lastfmPreviewLoading}
                      onClick={() => void refreshLastfmPreview()}
                      title="Fetch latest Last.fm track"
                    >
                      {lastfmPreviewLoading ? "..." : "test"}
                    </button>
                    {custom.lastfmUsername && (
                      <button
                        type="button"
                        class="chat-style-chip"
                        onClick={() => updateField("lastfmUsername", "")}
                        title="Unlink Last.fm"
                      >
                        unlink
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "4px" }}>
                    about me bio
                  </div>
                  <textarea
                    class="chat-mod-input chat-profile-bio-textarea"
                    placeholder="write a bio for your profile card..."
                    maxLength={220}
                    rows={3}
                    value={bio}
                    onInput={(e) => {
                      hasEditedRef.current = true;
                      setBio((e.target as HTMLTextAreaElement).value);
                    }}
                  />
                </div>
              </div>
            )}

            {tab === "profile" && profileSub === "avatar" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
                    custom avatar picture or animated gif
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
                    <input
                      ref={avatarFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const inputEl = e.target as HTMLInputElement;
                        void handleFileUpload("avatar", inputEl.files?.[0], inputEl);
                      }}
                    />
                    <button
                      type="button"
                      class="chat-gif-more-btn"
                      onClick={() => avatarFileRef.current?.click()}
                    >
                      <i class="fa-solid fa-upload" /> upload image / gif
                    </button>
                    <button
                      type="button"
                      class="chat-gif-more-btn"
                      onClick={() =>
                        setGifPickerFor((p) => (p === "avatar" ? null : "avatar"))
                      }
                    >
                      <i class="fa-solid fa-film" /> pick klipy gif
                    </button>
                    {custom.avatarUrl.startsWith("data:image/") &&
                      !custom.avatarUrl.startsWith("data:image/gif") && (
                        <button
                          type="button"
                          class="chat-gif-more-btn"
                          onClick={() =>
                            setCropDraft({ kind: "avatar", src: custom.avatarUrl })
                          }
                        >
                          <i class="fa-solid fa-crop-simple" /> adjust placement
                        </button>
                      )}
                    {custom.avatarUrl && (
                      <button
                        type="button"
                        class="chat-gif-more-btn"
                        onClick={() => updateField("avatarUrl", "")}
                      >
                        clear picture
                      </button>
                    )}
                  </div>
                  <input
                    type="url"
                    class="chat-mod-input"
                    placeholder="or paste https:// image / gif url..."
                    value={custom.avatarUrl.startsWith("data:") ? "" : custom.avatarUrl}
                    onInput={(e) =>
                      updateField("avatarUrl", (e.target as HTMLInputElement).value.trim())
                    }
                  />
                </div>

                {gifPickerFor === "avatar" && (
                  <div
                    style={{
                      background: "var(--bg-surface-3)",
                      border: "1px solid var(--bg-surface-10)",
                      borderRadius: "10px",
                      padding: "8px",
                    }}
                  >
                    <input
                      type="text"
                      class="chat-mod-input"
                      placeholder="search klipy gifs for your avatar..."
                      value={gifQuery}
                      onInput={(e) => setGifQuery((e.target as HTMLInputElement).value)}
                      style={{ marginBottom: "6px" }}
                    />
                    {gifLoading ? (
                      <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                        loading klipy gifs...
                      </div>
                    ) : (
                      <div class="chat-gif-grid" style={{ maxHeight: "150px", overflowY: "auto" }}>
                        {gifHits.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            class="chat-gif-item"
                            style={{ height: "64px" }}
                            onClick={() => {
                              updateField("avatarUrl", g.url);
                              setGifPickerFor(null);
                            }}
                          >
                            <img
                              src={getSafeMediaProxySrc(g.previewUrl)}
                              alt={g.title}
                              loading={isChromebookModeEnabled() ? "lazy" : undefined}
                              decoding="async"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
                    fallback gradient colors & emoji
                  </div>
                  <div class="chat-swatch-row" style={{ marginBottom: "6px" }}>
                    {COLOR_SWATCHES.map((col) => (
                      <button
                        key={col}
                        type="button"
                        class={`chat-swatch-dot ${custom.avatarColor === col ? "active" : ""}`}
                        style={{ backgroundColor: col }}
                        onClick={() => updateField("avatarColor", col)}
                      />
                    ))}
                    <input
                      type="color"
                      value={custom.avatarColor}
                      onInput={(e) =>
                        updateField("avatarColor", (e.target as HTMLInputElement).value)
                      }
                      title="Custom accent color"
                      style={{
                        width: "26px",
                        height: "24px",
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    />
                  </div>
                  <div class="chat-emoji-grid">
                    {AVATAR_EMOJIS.map((em) => (
                      <button
                        key={em || "letter"}
                        type="button"
                        class={`chat-emoji-btn ${custom.avatarEmoji === em ? "active" : ""}`}
                        onClick={() => updateField("avatarEmoji", em)}
                      >
                        {em || username.slice(0, 1).toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "profile" && profileSub === "banner" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
                    custom banner image or animated gif
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
                    <input
                      ref={bannerFileRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const inputEl = e.target as HTMLInputElement;
                        void handleFileUpload("banner", inputEl.files?.[0], inputEl);
                      }}
                    />
                    <button
                      type="button"
                      class="chat-gif-more-btn"
                      onClick={() => bannerFileRef.current?.click()}
                    >
                      <i class="fa-solid fa-upload" /> upload banner / gif
                    </button>
                    <button
                      type="button"
                      class="chat-gif-more-btn"
                      onClick={() =>
                        setGifPickerFor((p) => (p === "banner" ? null : "banner"))
                      }
                    >
                      <i class="fa-solid fa-film" /> pick klipy banner gif
                    </button>
                    {custom.bannerUrl.startsWith("data:image/") &&
                      !custom.bannerUrl.startsWith("data:image/gif") && (
                        <button
                          type="button"
                          class="chat-gif-more-btn"
                          onClick={() =>
                            setCropDraft({ kind: "banner", src: custom.bannerUrl })
                          }
                        >
                          <i class="fa-solid fa-crop-simple" /> adjust placement
                        </button>
                      )}
                    {custom.bannerUrl && (
                      <button
                        type="button"
                        class="chat-gif-more-btn"
                        onClick={() => updateField("bannerUrl", "")}
                      >
                        use animated preset instead
                      </button>
                    )}
                  </div>
                  <input
                    type="url"
                    class="chat-mod-input"
                    placeholder="or paste https:// banner image / gif url..."
                    value={custom.bannerUrl.startsWith("data:") ? "" : custom.bannerUrl}
                    onInput={(e) =>
                      updateField("bannerUrl", (e.target as HTMLInputElement).value.trim())
                    }
                  />
                </div>

                {gifPickerFor === "banner" && (
                  <div
                    style={{
                      background: "var(--bg-surface-3)",
                      border: "1px solid var(--bg-surface-10)",
                      borderRadius: "10px",
                      padding: "8px",
                    }}
                  >
                    <input
                      type="text"
                      class="chat-mod-input"
                      placeholder="search klipy gifs for your banner..."
                      value={gifQuery}
                      onInput={(e) => setGifQuery((e.target as HTMLInputElement).value)}
                      style={{ marginBottom: "6px" }}
                    />
                    {gifLoading ? (
                      <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                        loading klipy gifs...
                      </div>
                    ) : (
                      <div class="chat-gif-grid" style={{ maxHeight: "150px", overflowY: "auto" }}>
                        {gifHits.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            class="chat-gif-item"
                            style={{ height: "64px" }}
                            onClick={() => {
                              updateField("bannerUrl", g.url);
                              setGifPickerFor(null);
                            }}
                          >
                            <img
                              src={getSafeMediaProxySrc(g.previewUrl)}
                              alt={g.title}
                              loading={isChromebookModeEnabled() ? "lazy" : undefined}
                              decoding="async"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
                    animated banner presets
                  </div>
                  <div class="chat-customizer-grid">
                    {BANNER_STYLES.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        class={`chat-style-chip ${
                          !custom.bannerUrl && custom.bannerStyle === opt.id ? "active" : ""
                        }`}
                        onClick={() => {
                          updateField("bannerUrl", "");
                          updateField("bannerStyle", opt.id);
                        }}
                      >
                        <span>{opt.label}</span>
                        {opt.animated && <i class="fa-solid fa-sparkles" style={{ fontSize: "9px" }} />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "profile" && profileSub === "theme" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
                    animated username effect
                  </div>
                  <div class="chat-customizer-grid">
                    {NAME_STYLES.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        class={`chat-style-chip ${custom.nameStyle === opt.id ? "active" : ""}`}
                        onClick={() => updateField("nameStyle", opt.id)}
                      >
                        <span class={opt.id !== "default" ? `name-${opt.id}` : ""}>
                          {opt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
                    username font & bio card style
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "6px" }}>
                    {NAME_FONTS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        class={`chat-style-chip ${custom.nameFont === opt.id ? "active" : ""}`}
                        onClick={() => updateField("nameFont", opt.id)}
                      >
                        <span class={opt.id !== "default" ? `name-font-${opt.id}` : ""}>
                          {opt.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {BIO_STYLES.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        class={`chat-style-chip ${custom.bioStyle === opt.id ? "active" : ""}`}
                        onClick={() => updateField("bioStyle", opt.id)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
                    profile card theme & tint
                  </div>
                  <div class="chat-customizer-grid" style={{ marginBottom: "6px" }}>
                    {CARD_THEMES.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        class={`chat-style-chip ${custom.cardTheme === opt.id ? "active" : ""}`}
                        onClick={() => {
                          updateField("cardTheme", opt.id);
                          updateField("cardBgColor", "");
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div class="chat-swatch-row">
                    {CARD_BG_SWATCHES.map((col) => (
                      <button
                        key={col || "auto"}
                        type="button"
                        class={`chat-swatch-dot ${custom.cardBgColor === col ? "active" : ""}`}
                        style={{
                          backgroundColor: col || "#27272a",
                          borderStyle: col ? "solid" : "dashed",
                        }}
                        title={col || "Theme default"}
                        onClick={() => updateField("cardBgColor", col)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              class="chat-auth-login-btn"
              disabled={saving}
              style={{ marginTop: "auto", padding: "9px 14px", width: "100%" }}
              onClick={() => void onSave({ bio, statusText, customization: custom })}
            >
              {saving ? "saving profile..." : "save profile & effects"}
            </button>
          </div>

          {/* RIGHT: LIVE PREVIEW */}
          <div
            class="chat-customizer-preview-panel"
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            <div class="chat-profile-section-title">live preview</div>

            {/* Preview Profile Card */}
            <div
              class={`chat-profile-card preview-only theme-${custom.cardTheme} ${
                custom.profileEffect === "lightning-border" ? "effect-lightning-border" : ""
              }`}
              style={{
                maxWidth: "100%",
                maxHeight: "none",
                ...(custom.cardBgColor ? { background: custom.cardBgColor } : {}),
              }}
            >
              <ProfileEffectLayer
                effect={custom.profileEffect}
                effectUrl={custom.profileEffectUrl}
              />
              <ProfileFrameLayer
                frameId={custom.cardFrameId}
                frameUrl={custom.cardFrameUrl}
              />
              <div class="chat-profile-scroll">
                <div class={`chat-profile-banner ${bannerClass}`} style={bannerStyle} />
                <div class="chat-profile-body">
                  <div class="chat-profile-top-row">
                    <UserAvatar
                      username={username}
                      custom={custom}
                      className="chat-profile-avatar-lg"
                    >
                      <span class={`chat-profile-status-dot ${custom.presenceStatus}`} />
                    </UserAvatar>
                    <div class="chat-profile-badges">
                      {custom.customTag && (
                        <span class="chat-role-badge custom-tag">{custom.customTag}</span>
                      )}
                      <span class="chat-profile-badge verified">
                        <i class="fa-solid fa-cloud" /> cloudsync
                      </span>
                    </div>
                  </div>

                  <div class="chat-profile-identity">
                    <div class="chat-profile-name-row">
                      <h3 class={`chat-profile-username ${getNameClasses(custom)}`}>
                        {displayLabel}
                      </h3>
                      <RoleBadge role={role} />
                      <GoatBadge isGoat={isGoat} />
                    </div>
                    <div class="chat-profile-handle-row">
                      <span>@{username}</span>
                      {custom.pronouns && <span>· {custom.pronouns}</span>}
                    </div>
                    {statusText && (
                      <div class="chat-profile-custom-status">{statusText}</div>
                    )}
                  </div>

                  <LastfmListeningCard
                    lastfmUsername={custom.lastfmUsername}
                    lastfm={lastfmPreview}
                    loading={lastfmPreviewLoading}
                    refreshing={lastfmPreviewLoading}
                    onRefresh={() => void refreshLastfmPreview()}
                    compact
                  />

                  <div class={`chat-profile-section chat-profile-bio-card ${bioClass}`}>
                    <div class="chat-profile-bio-text">
                      {bio || "looking amazing! edit your bio, banner gif, or avatar frame."}
                    </div>
                    <div class="chat-profile-joined">
                      <i class="fa-solid fa-calendar-days" /> joined{" "}
                      {createdAt ? new Date(createdAt).toLocaleDateString() : "recently"}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mini Chat + Member Preview */}
            <div
              style={{
                background: "var(--bg-surface-3)",
                border: "1px solid var(--bg-surface-10)",
                borderRadius: "12px",
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div class={`chat-user-item ${nameplateClass}`} style={{ padding: "5px 8px" }}>
                <NameplateMediaLayer url={custom.nameplateUrl} />
                <div class="chat-user-avatar-wrap">
                  <UserAvatar
                    username={username}
                    custom={custom}
                    className="chat-user-avatar"
                  />
                  <div class={`chat-user-dot ${custom.presenceStatus}`} />
                </div>
                <div class="chat-user-meta">
                  <div class="chat-user-name-row">
                    <span class={`chat-user-name ${getNameClasses(custom)}`}>
                      {displayLabel}
                    </span>
                    <RoleBadge role={role} />
                    <GoatBadge isGoat={isGoat} />
                  </div>
                  <div class="chat-user-status-sub">
                    {statusText || "member nameplate preview"}
                  </div>
                </div>
              </div>

              <div class="chat-entry" style={{ padding: "2px 4px" }}>
                <UserAvatar
                  username={username}
                  custom={custom}
                  className="chat-entry-avatar"
                />
                <div class="chat-entry-content">
                  <div class="chat-entry-header">
                    <span class={`chat-entry-author ${getNameClasses(custom)}`}>
                      {displayLabel}
                    </span>
                    <RoleBadge role={role} />
                    <GoatBadge isGoat={isGoat} />
                    <span class="chat-entry-time">just now</span>
                  </div>
                  <div class="chat-entry-text">new animated profile look in #general ✨</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {cropDraft && (
        <ImageCropModal
          kind={cropDraft.kind}
          imageSrc={cropDraft.src}
          onApply={(croppedUrl) => {
            updateField(
              cropDraft.kind === "avatar" ? "avatarUrl" : "bannerUrl",
              croppedUrl
            );
            setCropDraft(null);
          }}
          onCancel={() => setCropDraft(null)}
        />
      )}
    </div>
  );
}
