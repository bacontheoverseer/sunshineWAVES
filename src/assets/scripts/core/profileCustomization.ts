export type AvatarDecorationId =
  | "none"
  | "angel-bloom"
  | "cyber-ring"
  | "flame-aura"
  | "prism-spin"
  | "glitch-ring"
  | "sakura-orbit"
  | "frost-pulse"
  | "void-vortex"
  | "gold-royal"
  | "kitty-neon"
  | "dragon-crest";

export type BannerStyleId =
  | "solid"
  | "animated-aurora"
  | "animated-cybergrid"
  | "animated-starfield"
  | "animated-plasma"
  | "animated-sunset"
  | "animated-gold"
  | "animated-sakura"
  | "animated-void";

export type NameStyleId =
  | "default"
  | "gradient-sunset"
  | "gradient-ocean"
  | "gradient-crimson"
  | "animated-rainbow"
  | "animated-fire"
  | "animated-cyber"
  | "animated-gold"
  | "animated-galaxy";

export type NameFontId = "default" | "mono" | "serif" | "rounded" | "wide";

export type NameplateId =
  | "none"
  | "aurora-mist"
  | "ember-sparks"
  | "cyber-scan"
  | "sakura-breeze"
  | "starlight-shimmer"
  | "nebula-flow"
  | "crimson-velvet";

export type ProfileEffectId =
  | "none"
  | "starlight-petals"
  | "sakura-fall"
  | "confetti-pop"
  | "rain-drops"
  | "fireflies"
  | "shooting-stars"
  | "lightning-border"
  | "snowflakes";

export type CardThemeId =
  | "obsidian"
  | "midnight-glass"
  | "crimson-noir"
  | "emerald-cyber"
  | "sakura-velvet"
  | "royal-gold";

export type BioStyleId = "frosted" | "minimal" | "neon-border" | "accent-tint";

export type MsgPillStyleId =
  | "default"
  | "midnight"
  | "frosted"
  | "tinted"
  | "neon"
  | "rose"
  | "emerald"
  | "gold"
  | "sunset"
  | "cyber";

export type ChatRole = "owner" | "mod" | "member";

export interface LastfmTrackInfo {
  name: string;
  artist: string;
  album: string;
  albumArt: string;
  url: string;
  nowPlaying: boolean;
  scrobbledAt: number;
}

export interface LastfmProfileState {
  username: string;
  configured: boolean;
  found: boolean;
  privateProfile?: boolean;
  nowPlaying: boolean;
  track: LastfmTrackInfo | null;
  profileUrl: string;
  fetchedAt?: number;
  error?: string;
}

export interface ProfileCustomization {
  displayName: string;
  pronouns: string;
  customTag: string;
  lastfmUsername: string;
  avatarUrl: string;
  bannerUrl: string;
  decorationUrl: string;
  profileEffectUrl: string;
  nameplateUrl: string;
  cardFrameId: string;
  cardFrameUrl: string;
  avatarColor: string;
  avatarSecondary: string;
  cardBgColor: string;
  avatarEmoji: string;
  avatarDecoration: AvatarDecorationId;
  bannerStyle: BannerStyleId;
  nameStyle: NameStyleId;
  nameFont: NameFontId;
  nameplate: NameplateId;
  profileEffect: ProfileEffectId;
  cardTheme: CardThemeId;
  bioStyle: BioStyleId;
  msgPillStyle: MsgPillStyleId;
  presenceStatus: "online" | "idle" | "dnd";
}

export interface StyleOption<T extends string> {
  id: T;
  label: string;
  animated?: boolean;
  previewColor?: string;
}

export const AVATAR_DECORATIONS: StyleOption<AvatarDecorationId>[] = [
  { id: "none", label: "none" },
  { id: "angel-bloom", label: "angelic bloom", animated: true, previewColor: "#f3e8ff" },
  { id: "cyber-ring", label: "cyber orbit", animated: true, previewColor: "#22d3ee" },
  { id: "flame-aura", label: "solar flame", animated: true, previewColor: "#fb923c" },
  { id: "prism-spin", label: "prism holo", animated: true, previewColor: "#e879f9" },
  { id: "glitch-ring", label: "neon glitch", animated: true, previewColor: "#f43f5e" },
  { id: "sakura-orbit", label: "sakura petals", animated: true, previewColor: "#f9a8d4" },
  { id: "frost-pulse", label: "frost crystal", animated: true, previewColor: "#7dd3fc" },
  { id: "void-vortex", label: "void vortex", animated: true, previewColor: "#a855f7" },
  { id: "gold-royal", label: "royal halo", animated: true, previewColor: "#facc15" },
  { id: "kitty-neon", label: "neon ears", animated: true, previewColor: "#f472b6" },
  { id: "dragon-crest", label: "crimson crest", animated: true, previewColor: "#ef4444" },
];

export const BANNER_STYLES: StyleOption<BannerStyleId>[] = [
  { id: "solid", label: "classic gradient" },
  { id: "animated-aurora", label: "aurora flow", animated: true },
  { id: "animated-cybergrid", label: "synthwave grid", animated: true },
  { id: "animated-starfield", label: "starlight warp", animated: true },
  { id: "animated-plasma", label: "magma plasma", animated: true },
  { id: "animated-sunset", label: "vapor sunset", animated: true },
  { id: "animated-sakura", label: "dreamy sakura", animated: true },
  { id: "animated-void", label: "abyss nebula", animated: true },
  { id: "animated-gold", label: "liquid gold", animated: true },
];

export const NAME_STYLES: StyleOption<NameStyleId>[] = [
  { id: "default", label: "standard" },
  { id: "gradient-sunset", label: "sunset fade" },
  { id: "gradient-ocean", label: "ocean wave" },
  { id: "gradient-crimson", label: "ruby rose" },
  { id: "animated-rainbow", label: "rgb prism", animated: true },
  { id: "animated-fire", label: "ember glow", animated: true },
  { id: "animated-cyber", label: "cyber pulse", animated: true },
  { id: "animated-galaxy", label: "nebula shift", animated: true },
  { id: "animated-gold", label: "chrome gold", animated: true },
];

export const NAME_FONTS: StyleOption<NameFontId>[] = [
  { id: "default", label: "modern" },
  { id: "mono", label: "terminal" },
  { id: "serif", label: "royal serif" },
  { id: "rounded", label: "bubbly" },
  { id: "wide", label: "wide display" },
];

export const NAMEPLATES: StyleOption<NameplateId>[] = [
  { id: "none", label: "none" },
  { id: "aurora-mist", label: "aurora mist", animated: true },
  { id: "ember-sparks", label: "ember stream", animated: true },
  { id: "cyber-scan", label: "holo scan", animated: true },
  { id: "sakura-breeze", label: "sakura breeze", animated: true },
  { id: "starlight-shimmer", label: "starlight", animated: true },
  { id: "nebula-flow", label: "nebula flow", animated: true },
  { id: "crimson-velvet", label: "crimson velvet", animated: true },
];

export const PROFILE_EFFECTS: StyleOption<ProfileEffectId>[] = [
  { id: "none", label: "none" },
  { id: "starlight-petals", label: "glowing petals", animated: true },
  { id: "sakura-fall", label: "sakura blossom", animated: true },
  { id: "shooting-stars", label: "shooting stars", animated: true },
  { id: "confetti-pop", label: "confetti burst", animated: true },
  { id: "rain-drops", label: "neon rain", animated: true },
  { id: "fireflies", label: "amber fireflies", animated: true },
  { id: "lightning-border", label: "electric surge", animated: true },
  { id: "snowflakes", label: "starry frost", animated: true },
];

export const CARD_THEMES: StyleOption<CardThemeId>[] = [
  { id: "obsidian", label: "obsidian" },
  { id: "midnight-glass", label: "midnight" },
  { id: "crimson-noir", label: "crimson noir" },
  { id: "emerald-cyber", label: "matrix" },
  { id: "sakura-velvet", label: "sakura velvet" },
  { id: "royal-gold", label: "royal gold" },
];

export const BIO_STYLES: StyleOption<BioStyleId>[] = [
  { id: "frosted", label: "frosted card" },
  { id: "minimal", label: "minimal" },
  { id: "neon-border", label: "accent border" },
  { id: "accent-tint", label: "tinted glass" },
];

export const MSG_PILL_STYLES: StyleOption<MsgPillStyleId>[] = [
  { id: "default", label: "dark glass", previewColor: "#181822" },
  { id: "midnight", label: "midnight", previewColor: "#1e1b4b" },
  { id: "frosted", label: "ice frost", previewColor: "#334155" },
  { id: "tinted", label: "accent tint", previewColor: "#6366f1" },
  { id: "neon", label: "cyber neon", previewColor: "#06b6d4" },
  { id: "rose", label: "sakura rose", previewColor: "#ec4899" },
  { id: "emerald", label: "emerald mist", previewColor: "#10b981" },
  { id: "gold", label: "royal gold", previewColor: "#f59e0b" },
  { id: "sunset", label: "sunset glow", previewColor: "#f97316" },
  { id: "cyber", label: "matrix cyber", previewColor: "#22c55e" },
];

export const COLOR_SWATCHES = [
  "#6366f1",
  "#3b82f6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#f97316",
  "#14b8a6",
  "#84cc16",
  "#18181b",
];

export const CARD_BG_SWATCHES = [
  "",
  "#09090b",
  "#0f172a",
  "#1a0b1c",
  "#1c0a0d",
  "#061a14",
  "#171124",
  "#141418",
];

export const AVATAR_EMOJIS = [
  "",
  "🍪",
  "👑",
  "⚡",
  "🔥",
  "🎮",
  "👾",
  "💎",
  "🌟",
  "🚀",
  "🦊",
  "🐱",
  "🌙",
  "🎧",
  "💀",
  "🌸",
];

export const CUSTOM_TAG_PRESETS = [
  "",
  "gamer",
  "night owl",
  "pro",
  "vip",
  "builder",
  "vibes",
  "legend",
  "artist",
];

const FALLBACK_COLORS = [
  "#b45309",
  "#4338ca",
  "#78350f",
  "#9a3412",
  "#1e3a8a",
  "#047857",
  "#6b21a8",
  "#0e7490",
  "#be123c",
];

export function fallbackAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length] || "#4338ca";
}

function isValidHexColor(val: unknown): val is string {
  return typeof val === "string" && /^#[0-9a-f]{6}$/i.test(val.trim());
}

export function isValidCustomMediaUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s || s.length > 450000) return false;
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-zA-Z0-9+/=]+$/i.test(s)) {
    return true;
  }
  if (s.length > 1000) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function getSafeMediaProxySrc(raw?: string): string {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";
  if (s.startsWith("data:image/")) {
    return isValidCustomMediaUrl(s) ? s : "";
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return "";
    const h = u.hostname.toLowerCase();
    if (h === "klipy.com" || h.endsWith(".klipy.com")) {
      return `/api/chat/gif-proxy?url=${encodeURIComponent(s)}`;
    }
    return `/api/chat/image-proxy?url=${encodeURIComponent(s)}`;
  } catch {
    return "";
  }
}

function pickId<T extends string>(
  raw: unknown,
  options: StyleOption<T>[],
  fallback: T
): T {
  if (typeof raw !== "string") return fallback;
  return options.some((o) => o.id === raw) ? (raw as T) : fallback;
}

export function sanitizeLastfmUsername(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  const urlMatch = /^https?:\/\/(?:www\.)?last\.fm\/user\/([^/?#]+)/i.exec(s);
  if (urlMatch && urlMatch[1]) s = urlMatch[1];
  s = s.replace(/^@+/, "");
  return s.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
}

export function getDefaultCustomization(username = ""): ProfileCustomization {
  const baseColor = username ? fallbackAvatarColor(username) : "#6366f1";
  return {
    displayName: "",
    pronouns: "",
    customTag: "",
    lastfmUsername: "",
    avatarUrl: "",
    bannerUrl: "",
    decorationUrl: "",
    profileEffectUrl: "",
    nameplateUrl: "",
    cardFrameId: "",
    cardFrameUrl: "",
    avatarColor: baseColor,
    avatarSecondary: "#18181b",
    cardBgColor: "",
    avatarEmoji: "",
    avatarDecoration: "none",
    bannerStyle: "solid",
    nameStyle: "default",
    nameFont: "default",
    nameplate: "none",
    profileEffect: "none",
    cardTheme: "obsidian",
    bioStyle: "frosted",
    msgPillStyle: "default",
    presenceStatus: "online",
  };
}

export function sanitizeCustomization(
  raw: unknown,
  username = ""
): ProfileCustomization {
  const defaults = getDefaultCustomization(username);
  if (!raw || typeof raw !== "object") return defaults;
  const obj = raw as Record<string, unknown>;
  const emojiRaw = typeof obj.avatarEmoji === "string" ? obj.avatarEmoji.trim() : "";
  const presenceRaw = obj.presenceStatus;
  const presenceStatus =
    presenceRaw === "idle" || presenceRaw === "dnd" ? presenceRaw : "online";
  return {
    displayName:
      typeof obj.displayName === "string"
        ? obj.displayName.trim().slice(0, 32)
        : "",
    pronouns:
      typeof obj.pronouns === "string" ? obj.pronouns.trim().slice(0, 24) : "",
    customTag:
      typeof obj.customTag === "string" ? obj.customTag.trim().slice(0, 18) : "",
    lastfmUsername: sanitizeLastfmUsername(obj.lastfmUsername),
    avatarUrl: isValidCustomMediaUrl(obj.avatarUrl) ? obj.avatarUrl.trim() : "",
    bannerUrl: isValidCustomMediaUrl(obj.bannerUrl) ? obj.bannerUrl.trim() : "",
    decorationUrl: isValidCustomMediaUrl(obj.decorationUrl) ? obj.decorationUrl.trim() : "",
    profileEffectUrl: isValidCustomMediaUrl(obj.profileEffectUrl) ? obj.profileEffectUrl.trim() : "",
    nameplateUrl: isValidCustomMediaUrl(obj.nameplateUrl) ? obj.nameplateUrl.trim() : "",
    cardFrameId:
      typeof obj.cardFrameId === "string"
        ? obj.cardFrameId.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
        : "",
    cardFrameUrl: isValidCustomMediaUrl(obj.cardFrameUrl) ? obj.cardFrameUrl.trim() : "",
    avatarColor: isValidHexColor(obj.avatarColor)
      ? obj.avatarColor.trim().toLowerCase()
      : defaults.avatarColor,
    avatarSecondary: isValidHexColor(obj.avatarSecondary)
      ? obj.avatarSecondary.trim().toLowerCase()
      : defaults.avatarSecondary,
    cardBgColor: isValidHexColor(obj.cardBgColor)
      ? obj.cardBgColor.trim().toLowerCase()
      : "",
    avatarEmoji: AVATAR_EMOJIS.includes(emojiRaw) ? emojiRaw : "",
    avatarDecoration: pickId(obj.avatarDecoration, AVATAR_DECORATIONS, "none"),
    bannerStyle: pickId(obj.bannerStyle, BANNER_STYLES, "solid"),
    nameStyle: pickId(obj.nameStyle, NAME_STYLES, "default"),
    nameFont: pickId(obj.nameFont, NAME_FONTS, "default"),
    nameplate: pickId(obj.nameplate, NAMEPLATES, "none"),
    profileEffect: pickId(obj.profileEffect, PROFILE_EFFECTS, "none"),
    cardTheme: pickId(obj.cardTheme, CARD_THEMES, "obsidian"),
    bioStyle: pickId(obj.bioStyle, BIO_STYLES, "frosted"),
    msgPillStyle: pickId(obj.msgPillStyle, MSG_PILL_STYLES, "default"),
    presenceStatus,
  };
}

export function getBannerInlineStyle(
  custom: ProfileCustomization
): Record<string, string> {
  const c1 = custom.avatarColor || "#4338ca";
  const c2 = custom.avatarSecondary || "#18181b";
  const style: Record<string, string> = {
    "--banner-accent-1": c1,
    "--banner-accent-2": c2,
  };
  if (custom.bannerUrl) {
    const proxied = getSafeMediaProxySrc(custom.bannerUrl);
    if (proxied) {
      style.backgroundImage = `url("${proxied}")`;
      style.backgroundSize = "cover";
      style.backgroundPosition = "center";
      return style;
    }
  }
  if (custom.bannerStyle === "solid") {
    style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  }
  return style;
}

const LOCAL_CUSTOM_STORAGE_PREFIX = "cookie_profile_custom_v1:";

export function loadLocalProfileCustomization(
  username: string
): ProfileCustomization | null {
  const clean = username.trim().toLowerCase();
  if (!clean) return null;
  try {
    const raw = localStorage.getItem(`${LOCAL_CUSTOM_STORAGE_PREFIX}${clean}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return sanitizeCustomization(parsed, username);
  } catch {
    return null;
  }
}

export function saveLocalProfileCustomization(
  username: string,
  custom: ProfileCustomization
): void {
  const clean = username.trim().toLowerCase();
  if (!clean) return;
  try {
    localStorage.setItem(
      `${LOCAL_CUSTOM_STORAGE_PREFIX}${clean}`,
      JSON.stringify(sanitizeCustomization(custom, username))
    );
  } catch {}
}
