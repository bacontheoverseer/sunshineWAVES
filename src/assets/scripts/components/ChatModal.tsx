import { useEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import { memo } from "preact/compat";
import { moderateChatMessage } from "../core/contentFilter.ts";
import {
  batchedLocalStorageGet,
  batchedLocalStorageSet,
  isGameActivePerfMode,
  useChromebookMode,
} from "../core/chromebookMode.ts";
import {
  getClientId,
  detectCurrentGameSession,
  isClientAutoIdle,
  isLiveStreamConnected,
} from "../core/liveClient.ts";
import {
  awardChatMessageCoins,
  formatPlayTime,
  getCookieCoins,
  isCookieMasterActive,
  spendCookieCoins,
} from "../core/cookieCoins.ts";
import { getDeviceSignature } from "../core/deviceSignature.ts";
import {
  ChatRole,
  LastfmProfileState,
  ProfileCustomization,
  fallbackAvatarColor,
  getBannerInlineStyle,
  getDefaultCustomization,
  loadLocalProfileCustomization,
  sanitizeCustomization,
  sanitizeLastfmUsername,
  saveLocalProfileCustomization,
} from "../core/profileCustomization.ts";
import LastfmListeningCard from "./LastfmListeningCard.tsx";
import ProfileCustomizerModal from "./ProfileCustomizerModal.tsx";
import StaffManagerModal, {
  STAFF_NOTE_CATEGORIES,
  type StaffActionLogRecord,
  type StaffNoteCategory,
  type StaffNoteRecord,
  buildModAuthHeaders,
  formatStaffLogActionMeta,
  formatStaffTimestamp,
} from "./StaffManagerModal.tsx";
import EmojiPicker, { getJumboEmojiCount } from "./EmojiPicker.tsx";
import GroupChatModal, { ChatGroupDef } from "./GroupChatModal.tsx";
import {
  GoatBadge,
  MasterVerifiedBadge,
  NameplateMediaLayer,
  ProfileEffectLayer,
  ProfileFrameLayer,
  RoleBadge,
  UserAvatar,
  getNameClasses,
} from "./ProfileVisuals.tsx";
import ChatCameraModal from "./ChatCameraModal.tsx";
import {
  type CompressedImageResult,
  compressImageFile,
  formatBytesLabel,
  isAllowedChatImageUrl,
  uploadChatImage,
} from "../core/imageUpload.ts";

interface ChatReplyRef {
  id: string;
  author: string;
  text?: string;
  hasGif?: boolean;
  hasImage?: boolean;
}

interface ChatGiftPayload {
  type: "coins" | "cookie_master";
  from: string;
  to: string;
  amount?: number;
  note?: string;
}

interface ChatMessage {
  id: string;
  author: string;
  avatarColor: string;
  role?: ChatRole;
  customization?: ProfileCustomization | null;
  text: string;
  gift?: ChatGiftPayload | null;
  gifUrl?: string;
  gifTitle?: string;
  imageUrl?: string;
  imageName?: string;
  timestamp: string;
  channel: string;
  recipient?: string | null;
  replyTo?: ChatReplyRef | null;
  reactions?: Record<string, string[]> | undefined;
  edited?: boolean;
  editedAt?: number;
}

interface KlipyGifItem {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  width: number;
  height: number;
}

function isAllowedKlipyUrl(rawUrl?: string): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const h = parsed.hostname.toLowerCase();
    return h === "klipy.com" || h.endsWith(".klipy.com");
  } catch {
    return false;
  }
}

function getKlipyProxySrc(rawUrl?: string): string {
  if (!isAllowedKlipyUrl(rawUrl)) return "";
  return `/api/chat/gif-proxy?url=${encodeURIComponent(rawUrl!)}`;
}

interface OnlineUser {
  username: string;
  color: string;
  status?: "online" | "offline";
  isIdle?: boolean | undefined;
  isSelf?: boolean;
  game?: string;
  isPlayingGame?: boolean;
  gameStartedAt?: number;
  lastSeen?: number;
  bio?: string;
  statusText?: string;
  customization?: ProfileCustomization | null;
  role?: ChatRole;
  isGoat?: boolean | undefined;
  isTimedOut?: boolean;
  timeoutUntil?: number;
  createdAt?: string | null;
}

interface UserProfileDetails {
  id: number | null;
  username: string;
  createdAt: string | null;
  cloudSyncVerified: boolean;
  bio: string;
  statusText: string;
  customization?: ProfileCustomization | null;
  lastfmConfigured?: boolean | undefined;
  lastfm?: LastfmProfileState | null | undefined;
  role?: ChatRole;
  isGoat?: boolean | undefined;
  isTimedOut?: boolean;
  timeoutUntil?: number;
  timeoutReason?: string;
  online: boolean;
  game: string;
  isPlayingGame: boolean;
  gameStartedAt: number;
  lastSeen: number;
  stats: {
    totalSeconds: number;
    totalPlays: number;
    gamesPlayedCount: number;
    topGames: {
      game: string;
      seconds: number;
      plays: number;
      highScore: number;
      lastPlayed: string;
    }[];
  };
  studio: {
    name: string;
    tagline: string;
    color: string;
    icon: string;
  } | null;
  publishedGamesCount: number;
  isShadowbanned?: boolean;
  staffNotes?: StaffNoteRecord[];
  staffLogs?: StaffActionLogRecord[];
}

interface VoiceParticipant {
  clientId: string;
  username: string;
  avatarColor: string;
  muted: boolean;
  deafened: boolean;
  speaking?: boolean;
}

interface ChatChannelDef {
  id: string;
  name: string;
  icon: string;
  categoryId: string;
  categoryLabel: string;
  visibility: "all" | "staff";
  writeAccess: "all" | "staff";
}

const DEFAULT_CHAT_CHANNELS: ChatChannelDef[] = [
  { id: "rules", name: "rules", icon: "fa-book", categoryId: "info", categoryLabel: "info", visibility: "all", writeAccess: "staff" },
  { id: "announcements", name: "announcements", icon: "fa-bullhorn", categoryId: "info", categoryLabel: "info", visibility: "all", writeAccess: "staff" },
  { id: "updates", name: "updates", icon: "fa-sparkles", categoryId: "info", categoryLabel: "info", visibility: "all", writeAccess: "all" },
  { id: "staff-chat", name: "staff-chat", icon: "fa-user-shield", categoryId: "staff", categoryLabel: "staff", visibility: "staff", writeAccess: "staff" },
  { id: "general", name: "general", icon: "fa-hashtag", categoryId: "social", categoryLabel: "social", visibility: "all", writeAccess: "all" },
  { id: "introductions", name: "introductions", icon: "fa-hashtag", categoryId: "social", categoryLabel: "social", visibility: "all", writeAccess: "all" },
  { id: "off-topic", name: "off-topic", icon: "fa-hashtag", categoryId: "social", categoryLabel: "social", visibility: "all", writeAccess: "all" },
  { id: "games", name: "games", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "anime", name: "anime", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "music", name: "music", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "tech", name: "tech", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "help", name: "help", icon: "fa-hashtag", categoryId: "support", categoryLabel: "support", visibility: "all", writeAccess: "all" },
];

const CHANNEL_ICON_OPTIONS = [
  { value: "fa-hashtag", label: "# hashtag" },
  { value: "fa-bullhorn", label: "announcements" },
  { value: "fa-book", label: "rules / guide" },
  { value: "fa-user-shield", label: "staff shield" },
  { value: "fa-lock", label: "lock" },
  { value: "fa-sparkles", label: "updates" },
  { value: "fa-gamepad", label: "gaming" },
  { value: "fa-code", label: "tech / dev" },
];

const VOICE_CHANNELS = [
  { id: "voice:general", name: "general voice", icon: "fa-volume-high" },
  { id: "voice:gaming", name: "gaming lounge", icon: "fa-headset" },
  { id: "voice:chill", name: "music & chill", icon: "fa-music" },
];

const PALETTE = [
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

function stringToColor(str: string): string {
  const clean = (str || "guest").trim().toLowerCase();
  return fallbackAvatarColor(clean || "guest");
}

function getEffectivePresenceDot(
  chosenStatus: string | undefined,
  isIdle: boolean | undefined
): "online" | "idle" | "dnd" {
  if (chosenStatus === "dnd") return "dnd";
  if (chosenStatus === "idle" || isIdle) return "idle";
  return "online";
}

function isStaleUninitializedCustom(c: ProfileCustomization | null | undefined): boolean {
  if (!c) return false;
  return (
    !c.displayName &&
    !c.pronouns &&
    !c.customTag &&
    !c.avatarUrl &&
    !c.bannerUrl &&
    !c.decorationUrl &&
    !c.profileEffectUrl &&
    !c.nameplateUrl &&
    !c.cardFrameId &&
    !c.cardFrameUrl &&
    !c.cardBgColor &&
    !c.avatarEmoji &&
    c.avatarColor?.toLowerCase() === "#6366f1" &&
    (!c.avatarDecoration || c.avatarDecoration === "none") &&
    (!c.bannerStyle || c.bannerStyle === "solid") &&
    (!c.nameStyle || c.nameStyle === "default") &&
    (!c.nameFont || c.nameFont === "default") &&
    (!c.nameplate || c.nameplate === "none") &&
    (!c.profileEffect || c.profileEffect === "none") &&
    !c.lastfmUsername
  );
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

export function makeDmChannelId(userA: string, userB: string): string {
  const sorted = [userA.trim().toLowerCase(), userB.trim().toLowerCase()].sort();
  return `dm:${sorted[0]}:${sorted[1]}`;
}

function getDmPartnerName(channelId: string, currentUsername: string | null): string {
  if (!channelId.startsWith("dm:")) return channelId;
  const parts = channelId.slice(3).split(":");
  if (parts.length !== 2) return channelId;
  const me = (currentUsername || "").toLowerCase();
  return parts[0] === me ? parts[1] : parts[0];
}

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

function notifyDmOrMentionToast(
  sender: string,
  messageText: string,
  isDm: boolean,
  onView: () => void
) {
  const w = window as unknown as {
    showToast?: (
      type: string,
      message: string,
      iconName?: string,
      duration?: number,
      actions?: { text: string; callback: () => void }[]
    ) => void;
  };
  if (typeof w.showToast === "function") {
    const cleanText = messageText.trim();
    const preview =
      cleanText.length > 56 ? cleanText.slice(0, 56) + "..." : cleanText;
    const label = isDm
      ? `dm from @${sender}: "${preview}"`
      : `@${sender} mentioned you: "${preview}"`;
    w.showToast("info", label, "comment-dots", 8500, [
      {
        text: "view",
        callback: onView,
      },
    ]);
  }
}

function extractMsgEpochMs(msg: ChatMessage): number | null {
  const m = /^msg_(\d{12,15})_/.exec(msg.id || "");
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function getMsgTimestampMs(msg: ChatMessage): number {
  const fromId = extractMsgEpochMs(msg);
  if (fromId !== null && fromId > 0) return fromId;
  const parsed = Number(new Date(msg.timestamp).getTime());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function shouldGroupMessages(prev: ChatMessage | undefined, curr: ChatMessage): boolean {
  if (!prev) return false;
  if (curr.replyTo) return false;
  if (prev.author.toLowerCase() !== curr.author.toLowerCase()) return false;
  const prevMs = extractMsgEpochMs(prev);
  const currMs = extractMsgEpochMs(curr);
  if (prevMs !== null && currMs !== null && currMs - prevMs > 7 * 60 * 1000) {
    return false;
  }
  return true;
}

function formatElapsedDuration(startedAtMs: number | undefined, nowMs: number): string {
  if (!startedAtMs || startedAtMs <= 0) return "1s";
  const totalSec = Math.max(1, Math.floor((nowMs - startedAtMs) / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function renderFormattedText(text: string) {
  const parts = text.split(/(\bhttps?:\/\/[^\s]+|@[a-zA-Z0-9_.-]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("http://") || part.startsWith("https://")) {
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      );
    }
    if (part.startsWith("@")) {
      return (
        <span key={i} class="chat-mention">
          {part}
        </span>
      );
    }
    return part;
  });
}

const CHROMEBOOK_INITIAL_MSG_CAP = 60;
const CHROMEBOOK_MSG_STEP = 60;
const QUICK_REACT_EMOJIS = ["😂", "❤️", "😭", "🔥", "👍", "💀", "🎉", "👀"] as const;

interface ChatMessageRowProps {
  msg: ChatMessage;
  isGrouped: boolean;
  isSelf: boolean;
  msgCustom: ProfileCustomization | null;
  safeFallbackColor: string;
  authorRole: ChatRole;
  isAuthorGoat: boolean;
  isAuthorCookieMaster?: boolean;
  canDeleteMsg: boolean;
  displayName: string;
  replyAuthorLabel: string;
  replyMiniCustom: ProfileCustomization | null;
  replyTextColorClass: string;
  isHighlighted: boolean;
  isEditingThis: boolean;
  editingMessageText: string;
  savingEdit: boolean;
  isReacting: boolean;
  isReactPickerOpen: boolean;
  reactPickerRef: preact.RefObject<HTMLDivElement>;
  cloudUser: string | null;
  canReplyOrReact: boolean;
  onScrollToMessage: (id: string) => void;
  onOpenUserProfile: (username: string) => void;
  onStartEditMessage: (msg: ChatMessage) => void;
  onSaveEditMessage: (msg: ChatMessage) => void;
  onCancelEditMessage: () => void;
  onEditingTextChange: (text: string) => void;
  onToggleReaction: (msgId: string, emoji: string) => void;
  onToggleReactMenu: (msgId: string) => void;
  onOpenReactPicker: (msgId: string) => void;
  onCloseReactPicker: () => void;
  onReplyMessage: (msg: ChatMessage) => void;
  onOpenDirectMessage: (username: string) => void;
  onToggleBlockUser: (username: string) => void;
  onDeleteMessage: (msg: ChatMessage) => void;
  onOpenImageLightbox: (url: string, name?: string | undefined) => void;
}

function buildChatImageSrc(rawUrl: string | undefined, retryCount: number): string {
  const s = String(rawUrl || "").trim();
  if (!s || retryCount <= 0 || !s.startsWith("/api/chat/media/")) return s;
  const sep = s.includes("?") ? "&" : "?";
  return `${s}${sep}r=${retryCount}`;
}

const ChatMessageRow = memo(function ChatMessageRow({
  msg,
  isGrouped,
  isSelf,
  msgCustom,
  safeFallbackColor,
  authorRole,
  isAuthorGoat,
  isAuthorCookieMaster,
  canDeleteMsg,
  displayName,
  replyAuthorLabel,
  replyMiniCustom,
  replyTextColorClass,
  isHighlighted,
  isEditingThis,
  editingMessageText,
  savingEdit,
  isReacting,
  isReactPickerOpen,
  reactPickerRef,
  cloudUser,
  canReplyOrReact,
  onScrollToMessage,
  onOpenUserProfile,
  onStartEditMessage,
  onSaveEditMessage,
  onCancelEditMessage,
  onEditingTextChange,
  onToggleReaction,
  onToggleReactMenu,
  onOpenReactPicker,
  onCloseReactPicker,
  onReplyMessage,
  onOpenDirectMessage,
  onToggleBlockUser,
  onDeleteMessage,
  onOpenImageLightbox,
}: ChatMessageRowProps) {
  const replyRef = msg.replyTo || null;
  const [imgBroken, setImgBroken] = useState(false);
  const [imgRetryCount, setImgRetryCount] = useState(0);
  const retryTimerRef = useRef<number | null>(null);
  useEffect(() => {
    setImgBroken(false);
    setImgRetryCount(0);
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [msg.imageUrl]);

  const handleChatImgError = () => {
    const raw = String(msg.imageUrl || "");
    if (raw.startsWith("/api/chat/media/") && imgRetryCount === 0) {
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        setImgRetryCount(1);
      }, 900);
      return;
    }
    setImgBroken(true);
  };

  return (
    <div
      id={`chat-msg-${msg.id}`}
      class={`chat-entry ${isGrouped ? "is-grouped" : ""} ${
        replyRef ? "has-reply" : ""
      } ${isHighlighted ? "is-highlighted" : ""}`}
    >
      {replyRef && (
        <div
          class="chat-reply-context"
          title="Jump to original message"
          onClick={() => onScrollToMessage(replyRef.id)}
        >
          <span class="chat-reply-spine" aria-hidden="true" />
          <UserAvatar
            username={replyRef.author}
            custom={replyMiniCustom}
            fallbackColor={stringToColor(replyRef.author)}
            className="chat-reply-mini-avatar"
          />
          <span class={`chat-reply-author ${replyTextColorClass}`}>
            @{replyAuthorLabel}
          </span>
          <span class="chat-reply-snippet">
            {replyRef.text
              ? replyRef.text
              : replyRef.hasImage
              ? "clicked to view image"
              : replyRef.hasGif
              ? "clicked to see GIF"
              : "message"}
          </span>
        </div>
      )}

      <div class="chat-entry-main">
        {isGrouped ? (
          <div class="chat-entry-gutter" aria-hidden="true">
            <span class="chat-entry-hover-time">{msg.timestamp}</span>
          </div>
        ) : (
          <UserAvatar
            username={msg.author}
            custom={msgCustom}
            fallbackColor={safeFallbackColor}
            className="chat-entry-avatar"
            title={`View @${msg.author}'s profile`}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              onOpenUserProfile(msg.author);
            }}
          />
        )}
        <div class="chat-entry-content">
          {!isGrouped && (
            <div class="chat-entry-header">
              <span
                class={`chat-entry-author ${isSelf ? "is-self" : ""} ${getNameClasses(
                  msgCustom
                )}`}
                title={`View @${msg.author}'s profile`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUserProfile(msg.author);
                }}
              >
                {displayName}
              </span>
              <MasterVerifiedBadge isCookieMaster={isAuthorCookieMaster} />
              <RoleBadge role={authorRole} />
              <GoatBadge isGoat={isAuthorGoat} />
              {msgCustom?.customTag && (
                <span class="chat-role-badge custom-tag">{msgCustom.customTag}</span>
              )}
              <span class="chat-entry-time">{msg.timestamp}</span>
            </div>
          )}
          {isEditingThis ? (
            <form
              class="chat-edit-form"
              onSubmit={(e) => {
                e.preventDefault();
                onSaveEditMessage(msg);
              }}
            >
              <input
                type="text"
                class="chat-edit-input"
                maxLength={500}
                autoFocus
                disabled={savingEdit}
                value={editingMessageText}
                onInput={(e) =>
                  onEditingTextChange((e.target as HTMLInputElement).value)
                }
              />
              <div class="chat-edit-meta-row">
                <span>escape to cancel · enter to save</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    class="chat-gif-more-btn"
                    onClick={onCancelEditMessage}
                  >
                    cancel
                  </button>
                  <button
                    type="submit"
                    class="chat-gif-more-btn"
                    disabled={savingEdit}
                    style={{
                      backgroundColor: "var(--btn-primary-bg)",
                      color: "var(--btn-primary-text)",
                    }}
                  >
                    {savingEdit ? "saving..." : "save"}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            msg.text &&
            (() => {
              const jumboCount = getJumboEmojiCount(msg.text);
              const jumboCls =
                jumboCount > 0
                  ? ` is-jumbo-emoji${jumboCount <= 3 ? " is-jumbo-lg" : ""}`
                  : "";
              return (
                <div class={`chat-entry-text${jumboCls}`}>
                  {renderFormattedText(msg.text)}
                  {msg.edited && <span class="chat-msg-edited">(edited)</span>}
                </div>
              );
            })()
          )}
          {msg.gift && (
            <div class={`chat-gift-card${msg.gift.type === "cookie_master" ? " is-master" : ""}`}>
              <div class="chat-gift-card-icon">
                <i class="fa-solid fa-gift"></i>
              </div>
              <div class="chat-gift-card-body">
                <div class="chat-gift-card-route">
                  <span class="chat-gift-card-user">@{msg.gift.from}</span>
                  <i class="fa-solid fa-arrow-right chat-gift-card-arrow"></i>
                  <span class="chat-gift-card-user">@{msg.gift.to}</span>
                </div>
                <div class="chat-gift-card-amount">
                  {msg.gift.type === "cookie_master" ? (
                    <>
                      <i class="fa-solid fa-crown"></i> 1 month of cookie master
                    </>
                  ) : (
                    <>
                      <i class="fa-solid fa-coins"></i> {(Number(msg.gift.amount) || 0).toLocaleString()} cookie coins
                    </>
                  )}
                </div>
                {msg.gift.note && (
                  <div class="chat-gift-card-note">
                    <em>&ldquo;{msg.gift.note}&rdquo;</em>
                  </div>
                )}
              </div>
            </div>
          )}
          {isAllowedKlipyUrl(msg.gifUrl) && (
            <div class="chat-entry-gif-wrap">
              <img
                class="chat-entry-gif"
                src={getKlipyProxySrc(msg.gifUrl)}
                alt={msg.gifTitle || "GIF"}
                loading="lazy"
                decoding="async"
              />
            </div>
          )}
          {isAllowedChatImageUrl(msg.imageUrl) && (
            <div class="chat-entry-image-wrap">
              {imgBroken ? (
                <div class="chat-entry-image-broken" role="img" aria-label={msg.imageName || "Image unavailable"}>
                  <i class="fa-regular fa-image" aria-hidden="true"></i>
                  <div class="chat-entry-image-broken-text">
                    <span>image unavailable</span>
                    {msg.imageName && <small title={msg.imageName}>{msg.imageName}</small>}
                  </div>
                  {msg.imageUrl?.startsWith("/api/chat/media/") && (
                    <button
                      type="button"
                      class="chat-entry-image-retry"
                      title="Retry loading image"
                      onClick={() => {
                        setImgBroken(false);
                        setImgRetryCount((n) => n + 1);
                      }}
                    >
                      <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  class="chat-entry-image-btn"
                  title={`View full image${msg.imageName ? ` (${msg.imageName})` : ""}`}
                  onClick={() => onOpenImageLightbox(msg.imageUrl!, msg.imageName)}
                >
                  <img
                    class="chat-entry-image"
                    src={buildChatImageSrc(msg.imageUrl, imgRetryCount)}
                    alt={msg.imageName || "Uploaded image"}
                    decoding="async"
                    onError={handleChatImgError}
                  />
                </button>
              )}
            </div>
          )}
          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
            <div class="chat-reaction-bar">
              {Object.entries(msg.reactions).map(([emoji, users]) => {
                if (!Array.isArray(users) || users.length === 0) return null;
                const meReacted = Boolean(
                  cloudUser && users.includes(cloudUser.toLowerCase())
                );
                return (
                  <button
                    key={emoji}
                    type="button"
                    class={`chat-reaction-pill${meReacted ? " is-reacted" : ""}`}
                    title={`${users.map((u) => `@${u}`).join(", ")}`}
                    onClick={() => onToggleReaction(msg.id, emoji)}
                  >
                    <span class="chat-reaction-emoji">{emoji}</span>
                    <span class="chat-reaction-count">{users.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Hover actions on each message */}
      <div class="chat-entry-actions">
        {canReplyOrReact && (
          <button
            type="button"
            class="chat-entry-action-btn chat-react-toggle-btn"
            title="Add reaction"
            onClick={() => onToggleReactMenu(msg.id)}
          >
            <i class="fa-regular fa-face-smile"></i>
          </button>
        )}
        {canReplyOrReact && (
          <button
            type="button"
            class="chat-entry-action-btn"
            title={`Reply to @${msg.author}`}
            onClick={() => onReplyMessage(msg)}
          >
            <i class="fa-solid fa-reply"></i>
          </button>
        )}
        {isSelf && !isEditingThis && (
          <button
            type="button"
            class="chat-entry-action-btn"
            title="Edit message"
            onClick={() => onStartEditMessage(msg)}
          >
            <i class="fa-solid fa-pen"></i>
          </button>
        )}
        {!isSelf && (
          <button
            type="button"
            class="chat-entry-action-btn"
            title={`Direct message @${msg.author}`}
            onClick={() => onOpenDirectMessage(msg.author)}
          >
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        )}
        {canDeleteMsg && (
          <button
            type="button"
            class="chat-entry-action-btn danger"
            title="Delete message"
            onClick={() => onDeleteMessage(msg)}
          >
            <i class="fa-solid fa-trash-can"></i>
          </button>
        )}
      </div>

      {isReacting && (
        <div class="chat-quick-react-bar">
          {QUICK_REACT_EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              class="chat-quick-react-btn"
              title={`React with ${em}`}
              onClick={() => onToggleReaction(msg.id, em)}
            >
              {em}
            </button>
          ))}
          <button
            type="button"
            class="chat-quick-react-btn chat-quick-react-more"
            title="More emojis"
            onClick={() => onOpenReactPicker(msg.id)}
          >
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      )}
    </div>
  );
});

interface ChatUserRowProps {
  user: OnlineUser;
  offline?: boolean;
  blocked: boolean;
  isGoat: boolean;
  isCookieMaster?: boolean;
  dotStatus: "online" | "idle" | "dnd";
  playingDurationLabel: string;
  onOpenUserProfile: (username: string) => void;
  onOpenDirectMessage: (username: string) => void;
  onToggleBlockUser: (username: string) => void;
}

const ChatUserRow = memo(function ChatUserRow({
  user: u,
  offline = false,
  blocked,
  isGoat,
  isCookieMaster,
  dotStatus,
  playingDurationLabel,
  onOpenUserProfile,
  onOpenDirectMessage,
  onToggleBlockUser,
}: ChatUserRowProps) {
  const uCustom = u.customization || null;
  const npClass = [
    uCustom?.nameplate && uCustom.nameplate !== "none"
      ? `has-nameplate nameplate-${uCustom.nameplate}`
      : "",
    uCustom?.nameplateUrl ? "has-nameplate has-media-nameplate" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const displayName = uCustom?.displayName?.trim() || u.username;

  return (
    <div
      class={`chat-user-item${offline ? " offline" : ""} ${npClass}`}
      onClick={() => onOpenUserProfile(u.username)}
      title={`View @${u.username}'s profile`}
    >
      <NameplateMediaLayer url={uCustom?.nameplateUrl} />
      <div
        class="chat-user-avatar-wrap"
        onClick={(e) => {
          e.stopPropagation();
          onOpenUserProfile(u.username);
        }}
      >
        <UserAvatar
          username={u.username}
          custom={uCustom}
          fallbackColor={u.color}
          className="chat-user-avatar"
          opacity={offline ? (blocked ? 0.35 : 0.65) : blocked ? 0.45 : 1}
        />
        <div class={`chat-user-dot ${offline ? "offline" : dotStatus}`}></div>
      </div>
      <div
        class="chat-user-meta"
        title={`View @${u.username}'s profile`}
        onClick={(e) => {
          e.stopPropagation();
          onOpenUserProfile(u.username);
        }}
      >
        <div class="chat-user-name-row">
          <span
            class={`chat-user-name ${getNameClasses(uCustom)}`}
            style={
              offline
                ? {
                    opacity: blocked ? 0.45 : 0.78,
                    textDecoration: blocked ? "line-through" : undefined,
                  }
                : blocked
                ? { textDecoration: "line-through", opacity: 0.6 }
                : undefined
            }
          >
            {displayName}
          </span>
          <MasterVerifiedBadge isCookieMaster={isCookieMaster} />
          <RoleBadge role={u.role} />
          <GoatBadge isGoat={isGoat} />
          {!offline && u.isTimedOut && (
            <span class="chat-role-badge muted-pill">muted</span>
          )}
          {!offline && u.isSelf && <span class="chat-you-pill">you</span>}
        </div>
        {!offline && dotStatus !== "idle" && !u.isIdle && playingDurationLabel ? (
          <div class="chat-user-game-sub" title={`Playing ${u.game}`}>
            <i class="fa-solid fa-gamepad"></i>
            <span>
              playing {u.game} · {playingDurationLabel}
            </span>
          </div>
        ) : (
          <div class={`chat-user-status-sub${offline ? " offline" : ""}`}>
            {offline
              ? u.statusText
                ? u.statusText
                : "offline"
              : u.statusText
              ? u.statusText
              : dotStatus === "dnd"
              ? "do not disturb"
              : dotStatus === "idle"
              ? "idle"
              : "online"}
          </div>
        )}
      </div>

      {(offline || !u.isSelf) && (
        <div class="chat-user-actions">
          <button
            type="button"
            class="chat-user-mini-btn"
            title={`Direct message @${u.username}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenDirectMessage(u.username);
            }}
          >
            <i class="fa-solid fa-comment-dots"></i>
          </button>
          {blocked && (
            <button
              type="button"
              class="chat-user-mini-btn blocked"
              title={`Unblock @${u.username}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleBlockUser(u.username);
              }}
            >
              <i class="fa-solid fa-ban"></i>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default function ChatModal() {
  const chromebookMode = useChromebookMode();
  const chromebookModeRef = useRef(chromebookMode);
  chromebookModeRef.current = chromebookMode;
  const [msgRenderLimit, setMsgRenderLimit] = useState(CHROMEBOOK_INITIAL_MSG_CAP);
  const [isOpen, setIsOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState("general");
  const [inputText, setInputText] = useState("");
  const [typingByChannel, setTypingByChannel] = useState<Record<string, Record<string, number>>>({});
  const lastTypingSentAtRef = useRef<number>(0);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingChannelRef = useRef<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGiftPicker, setShowGiftPicker] = useState(false);
  const [giftTab, setGiftTab] = useState<"coins" | "cookie_master">("coins");
  const [giftRecipient, setGiftRecipient] = useState("");
  const [giftAmount, setGiftAmount] = useState("100");
  const [giftNote, setGiftNote] = useState("");
  const [isSendingGift, setIsSendingGift] = useState(false);
  const [myCoinBalance, setMyCoinBalance] = useState(() => getCookieCoins());
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [pendingImage, setPendingImage] = useState<CompressedImageResult | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    name?: string | undefined;
  } | null>(null);
  const [lightboxBroken, setLightboxBroken] = useState(false);
  const [lightboxRetryCount, setLightboxRetryCount] = useState(0);
  useEffect(() => {
    setLightboxBroken(false);
    setLightboxRetryCount(0);
  }, [lightboxImage?.url]);
  const [dragOverChat, setDragOverChat] = useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [gifSearch, setGifSearch] = useState("");
  const [gifItems, setGifItems] = useState<KlipyGifItem[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifConfigured, setGifConfigured] = useState(true);
  const [gifError, setGifError] = useState("");
  const [gifPage, setGifPage] = useState(1);
  const [gifHasNext, setGifHasNext] = useState(false);
  const gifPickerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const giftPickerRef = useRef<HTMLDivElement>(null);
  const giftSendLockRef = useRef(false);
  const gifAbortRef = useRef<AbortController | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  // CloudSync user state
  const [cloudUser, setCloudUser] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem("auth_user");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed?.username === "string" && parsed.username.trim().length > 0) {
          return parsed.username.trim();
        }
      }
    } catch {}
    return null;
  });

  // Blocked users list (stored lowercase)
  const [blockedUsers, setBlockedUsers] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("cookie_chat_blocked_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // Known DM partners list
  const [dmPeers, setDmPeers] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("cookie_chat_dm_peers_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [showNewDmInput, setShowNewDmInput] = useState(false);
  const [newDmTarget, setNewDmTarget] = useState("");

  // Messages list
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = batchedLocalStorageGet("cookie_chat_messages_v2");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // Server-reported online, offline, and registered CloudSync users
  const [serverOnlineUsers, setServerOnlineUsers] = useState<OnlineUser[]>([]);
  const [serverOfflineUsers, setServerOfflineUsers] = useState<OnlineUser[]>([]);
  const [registeredCloudSyncUsers, setRegisteredCloudSyncUsers] = useState<string[]>([]);
  const [serverTotalUsersCount, setServerTotalUsersCount] = useState<number>(0);

  // User Profile Modal & Staff/Mod state
  const [viewingProfileUsername, setViewingProfileUsername] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<UserProfileDetails | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [lastfmRefreshing, setLastfmRefreshing] = useState(false);
  const [selfCreatedAt, setSelfCreatedAt] = useState<number | undefined>(undefined);
  const viewingProfileRef = useRef<string | null>(null);
  viewingProfileRef.current = viewingProfileUsername;
  const profileReqSeqRef = useRef(0);
  const profileFetchAbortRef = useRef<AbortController | null>(null);
  const [editingBio, setEditingBio] = useState("");
  const [editingStatusText, setEditingStatusText] = useState("");
  const [editingCustom, setEditingCustom] = useState<ProfileCustomization>(() => {
    try {
      const raw = localStorage.getItem("auth_user");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.username) {
          const uname = String(parsed.username).trim();
          return loadLocalProfileCustomization(uname) || getDefaultCustomization(uname);
        }
      }
    } catch {}
    return getDefaultCustomization("");
  });
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [profileAuditTab, setProfileAuditTab] = useState<"notes" | "logs">("notes");
  const [profileNoteDraft, setProfileNoteDraft] = useState("");
  const [profileNoteCategory, setProfileNoteCategory] = useState<StaffNoteCategory>("general");
  const [savingProfileNote, setSavingProfileNote] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [staffMods, setStaffMods] = useState<string[]>([]);
  const [ownerUsers, setOwnerUsers] = useState<string[]>([]);
  const ownerUsersRef = useRef<string[]>([]);
  ownerUsersRef.current = ownerUsers;
  const [goatUsers, setGoatUsers] = useState<string[]>([]);
  const [cookieMasterUsers, setCookieMasterUsers] = useState<string[]>([]);
  const [selfIsCookieMaster, setSelfIsCookieMaster] = useState<boolean>(() => isCookieMasterActive());
  const [selfRole, setSelfRole] = useState<ChatRole>("member");
  const [selfTimeout, setSelfTimeout] = useState<{ until: number; reason?: string } | null>(null);
  const [selfIdle, setSelfIdle] = useState<boolean>(() => isClientAutoIdle());
  const hydratedLocalCustomForRef = useRef<string | null>(null);
  const [chatGroups, setChatGroups] = useState<ChatGroupDef[]>([]);
  const [chatChannels, setChatChannels] = useState<ChatChannelDef[]>(DEFAULT_CHAT_CHANNELS);
  const [channelEditorOpen, setChannelEditorOpen] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [chName, setChName] = useState("");
  const [chCategory, setChCategory] = useState("social");
  const [chIcon, setChIcon] = useState("fa-hashtag");
  const [chVisibility, setChVisibility] = useState<"all" | "staff">("all");
  const [chWriteAccess, setChWriteAccess] = useState<"all" | "staff">("all");
  const [savingChannel, setSavingChannel] = useState(false);
  const fetchChatStateRef = useRef<((force?: boolean) => void) | null>(null);
  const [groupModalMode, setGroupModalMode] = useState<"create" | "members" | null>(null);
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [reactPickerMessageId, setReactPickerMessageId] = useState<string | null>(null);
  const reactPickerRef = useRef<HTMLDivElement>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState<string | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Voice Chat state
  const [activeVoiceRoom, setActiveVoiceRoom] = useState<string | null>(null);
  const [voiceRooms, setVoiceRooms] = useState<Record<string, VoiceParticipant[]>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [speakingMap, setSpeakingMap] = useState<Record<string, boolean>>({});
  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});

  const chatFeedRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevFeedScrollTopRef = useRef<number>(0);
  const ignoreAutoExpandUntilRef = useRef<number>(0);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const pendingPresenceDetailRef = useRef<any>(null);
  const presenceBatchTimerRef = useRef<number | null>(null);
  const presenceBatchRafRef = useRef<number | null>(null);
  const activeChannelRef = useRef(activeChannel);
  activeChannelRef.current = activeChannel;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const seenMessageIdsRef = useRef<Set<string>>(new Set(messages.map((m) => m.id)));
  const pendingMessageIdsRef = useRef<Set<string>>(new Set());
  const lastPresenceAtRef = useRef<number>(0);
  const initialStateLoadedRef = useRef(false);
  const lastStateFetchAtRef = useRef<number>(0);
  const blockedUsersRef = useRef<string[]>(blockedUsers);
  blockedUsersRef.current = blockedUsers;

  // WebRTC & WebAudio refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const activeVoiceRoomRef = useRef<string | null>(null);
  activeVoiceRoomRef.current = activeVoiceRoom;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;
  const isDeafenedRef = useRef(isDeafened);
  isDeafenedRef.current = isDeafened;

  const isUserBlocked = useCallback(
    (username: string) => blockedUsers.includes(username.trim().toLowerCase()),
    [blockedUsers]
  );

  const toggleBlockUser = useCallback(
    (targetUsername: string) => {
      const clean = targetUsername.trim();
      const lower = clean.toLowerCase();
      if (!lower || (cloudUser && lower === cloudUser.toLowerCase())) return;

      setBlockedUsers((prev) => {
        const exists = prev.includes(lower);
        const next = exists ? prev.filter((u) => u !== lower) : [...prev, lower];
        try {
          localStorage.setItem("cookie_chat_blocked_v1", JSON.stringify(next));
        } catch {}
        notifyToast(
          exists ? `unblocked ${clean}` : `blocked ${clean} — messages & voice muted`,
          exists ? "info" : "success"
        );
        return next;
      });
    },
    [cloudUser]
  );

  const closeUserProfile = useCallback(() => {
    profileReqSeqRef.current += 1;
    if (profileFetchAbortRef.current) {
      try {
        profileFetchAbortRef.current.abort();
      } catch {}
      profileFetchAbortRef.current = null;
    }
    viewingProfileRef.current = null;
    setViewingProfileUsername(null);
    setProfileData(null);
    setProfileLoading(false);
    setProfileNoteDraft("");
  }, []);

  useEffect(() => {
    return () => {
      if (profileFetchAbortRef.current) {
        try {
          profileFetchAbortRef.current.abort();
        } catch {}
        profileFetchAbortRef.current = null;
      }
    };
  }, []);

  const openUserProfile = useCallback(
    async (targetUsername: string) => {
      const clean = targetUsername.trim().replace(/^@/, "");
      if (!clean) return;
      const cleanLower = clean.toLowerCase();

      // Abort any previous profile lookup and clear stale profile state immediately
      // so clicking user B never displays user A's cached card or out-of-order response.
      const reqId = ++profileReqSeqRef.current;
      if (profileFetchAbortRef.current) {
        try {
          profileFetchAbortRef.current.abort();
        } catch {}
      }
      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      profileFetchAbortRef.current = controller;

      viewingProfileRef.current = clean;
      setViewingProfileUsername(clean);
      setProfileData(null);
      setProfileNoteDraft("");
      setProfileLoading(true);
      try {
        const res = await fetch(
          `/api/chat/user-profile?username=${encodeURIComponent(clean)}`,
          {
            cache: "no-store",
            headers: buildModAuthHeaders(),
            ...(controller ? { signal: controller.signal } : {}),
          }
        );
        if (
          reqId !== profileReqSeqRef.current ||
          viewingProfileRef.current?.toLowerCase() !== cleanLower
        ) {
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (
            reqId !== profileReqSeqRef.current ||
            viewingProfileRef.current?.toLowerCase() !== cleanLower
          ) {
            return;
          }
          if (data && data.exists === false) {
            notifyToast(
              data.error || `user "@${clean}" does not exist in cloudsync`,
              "error"
            );
            viewingProfileRef.current = null;
            setViewingProfileUsername(null);
            setProfileData(null);
            return;
          }
          if (data?.profile) {
            const fetchedName = String(data.profile.username || "").trim();
            if (fetchedName && fetchedName.toLowerCase() !== cleanLower) {
              viewingProfileRef.current = fetchedName;
              setViewingProfileUsername(fetchedName);
            }
            setProfileData(data.profile);
            if (cloudUser && cleanLower === cloudUser.toLowerCase()) {
              if (data.profile.createdAt) setSelfCreatedAt(data.profile.createdAt);
              setEditingBio(data.profile.bio || "");
              setEditingStatusText(data.profile.statusText || "");
              const merged = data.profile.customization
                ? sanitizeCustomization(data.profile.customization, clean)
                : loadLocalProfileCustomization(clean) || getDefaultCustomization(clean);
              setEditingCustom(merged);
            }
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        // Fallback profile card if offline
      } finally {
        if (reqId === profileReqSeqRef.current) {
          setProfileLoading(false);
        }
      }
    },
    [cloudUser]
  );

  const refreshProfileLastfm = useCallback(async (targetUsername: string, force = false) => {
    const clean = targetUsername.trim();
    if (!clean) return;
    const cleanLower = clean.toLowerCase();
    if (force) setLastfmRefreshing(true);
    try {
      const res = await fetch(
        `/api/chat/lastfm?username=${encodeURIComponent(clean)}${force ? "&force=1" : ""}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data || viewingProfileRef.current?.toLowerCase() !== cleanLower) return;
      setProfileData((prev) => {
        if (!prev || prev.username.toLowerCase() !== cleanLower) return prev;
        return {
          ...prev,
          lastfmConfigured: Boolean(data.configured),
          lastfm: data.lastfm ?? null,
        };
      });
    } catch {}
    finally {
      if (force) setLastfmRefreshing(false);
    }
  }, []);

  // Poll Last.fm listening status gently while viewing a profile with a linked account
  const activeProfileLastfmUser = profileData?.lastfm?.username || "";
  useEffect(() => {
    const target = viewingProfileUsername;
    if (!target || !activeProfileLastfmUser) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void refreshProfileLastfm(target, false);
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [viewingProfileUsername, activeProfileLastfmUser, refreshProfileLastfm]);

  const applyProfileUpdateLocally = useCallback(
    (payload: {
      username: string;
      bio?: string;
      statusText?: string;
      customization?: ProfileCustomization;
      lastfm?: LastfmProfileState | null;
      lastfmConfigured?: boolean;
      role?: "owner" | "mod" | "member";
    }) => {
      const cleanName = String(payload.username || "").trim();
      if (!cleanName) return;
      const lower = cleanName.toLowerCase();
      const cleanCustom = payload.customization
        ? sanitizeCustomization(payload.customization, cleanName)
        : undefined;

      if (cleanCustom) {
        saveLocalProfileCustomization(cleanName, cleanCustom);
        window.dispatchEvent(
          new CustomEvent("sunshine-profile-customization-updated", {
            detail: { username: cleanName, customization: cleanCustom },
          }),
        );
      }

      if (cloudUser && lower === cloudUser.toLowerCase()) {
        if (cleanCustom) setEditingCustom(cleanCustom);
        if (typeof payload.bio === "string") setEditingBio(payload.bio);
        if (typeof payload.statusText === "string") {
          setEditingStatusText(payload.statusText);
        }
      }

      setProfileData((prev) => {
        if (
          !prev ||
          prev.username.toLowerCase() !== lower ||
          viewingProfileRef.current?.toLowerCase() !== lower
        ) {
          return prev;
        }
        return {
          ...prev,
          ...(typeof payload.bio === "string" ? { bio: payload.bio } : {}),
          ...(typeof payload.statusText === "string"
            ? { statusText: payload.statusText }
            : {}),
          ...(cleanCustom ? { customization: cleanCustom } : {}),
          ...(payload.lastfm !== undefined ? { lastfm: payload.lastfm } : {}),
          ...(typeof payload.lastfmConfigured === "boolean"
            ? { lastfmConfigured: payload.lastfmConfigured }
            : {}),
          ...(payload.role ? { role: payload.role } : {}),
        };
      });

      const patchUserList = (list: OnlineUser[]) =>
        list.map((u) =>
          u.username.toLowerCase() === lower
            ? {
                ...u,
                ...(typeof payload.bio === "string" ? { bio: payload.bio } : {}),
                ...(typeof payload.statusText === "string"
                  ? { statusText: payload.statusText }
                  : {}),
                ...(cleanCustom ? { customization: cleanCustom } : {}),
                ...(payload.role ? { role: payload.role } : {}),
              }
            : u
        );

      setServerOnlineUsers(patchUserList);
      setServerOfflineUsers(patchUserList);

      if (cleanCustom || payload.role) {
        setMessages((prev) => {
          let changed = false;
          const next = prev.map((m) => {
            if ((m.author || "").toLowerCase() !== lower) return m;
            changed = true;
            return {
              ...m,
              ...(cleanCustom ? { customization: cleanCustom } : {}),
              ...(cleanCustom?.avatarColor ? { avatarColor: cleanCustom.avatarColor } : {}),
              ...(payload.role ? { role: payload.role } : {}),
            };
          });
          if (!changed) return prev;
          try {
            batchedLocalStorageSet("cookie_chat_messages_v2", JSON.stringify(next));
          } catch {}
          return next;
        });
      }
    },
    [cloudUser]
  );

  const savingProfileRef = useRef(false);
  const queuedProfileSaveRef = useRef<{
    payload: {
      bio: string;
      statusText: string;
      customization?: ProfileCustomization;
    };
    silent: boolean;
  } | null>(null);

  const saveProfilePayload = useCallback(
    async (
      payload: {
        bio: string;
        statusText: string;
        customization?: ProfileCustomization;
      },
      options: { silent?: boolean } = {}
    ): Promise<boolean> => {
      if (!cloudUser) return false;
      const silent = Boolean(options.silent);
      if (savingProfileRef.current) {
        queuedProfileSaveRef.current = { payload, silent };
        return true;
      }
      savingProfileRef.current = true;
      setSavingProfile(true);
      try {
        let token = "";
        try { token = localStorage.getItem("auth_token") || ""; } catch {}
        const cleanCustom = sanitizeCustomization(
          payload.customization || editingCustom,
          cloudUser
        );
        const res = await fetch("/api/chat/user-profile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            username: cloudUser,
            bio: payload.bio,
            statusText: payload.statusText,
            customization: cleanCustom,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not update profile", "error");
          return false;
        }
        const savedCustom = sanitizeCustomization(
          data.profile?.customization || cleanCustom,
          cloudUser
        );
        const savedBio = data.profile?.bio ?? payload.bio;
        const savedStatusText = data.profile?.statusText ?? payload.statusText;
        applyProfileUpdateLocally({
          username: cloudUser,
          bio: savedBio,
          statusText: savedStatusText,
          customization: savedCustom,
          lastfm: data.profile?.lastfm ?? null,
          ...(typeof data.profile?.lastfmConfigured === "boolean"
            ? { lastfmConfigured: data.profile.lastfmConfigured }
            : {}),
        });
        try {
          broadcastRef.current?.postMessage({
            type: "PROFILE_UPDATED",
            username: cloudUser,
            bio: savedBio,
            statusText: savedStatusText,
            customization: savedCustom,
          });
        } catch {}
        if (!silent) {
          notifyToast("profile & animations saved!", "success");
        }
        return true;
      } catch {
        notifyToast("failed to save profile", "error");
        return false;
      } finally {
        savingProfileRef.current = false;
        setSavingProfile(false);
        const nextQueued = queuedProfileSaveRef.current;
        if (nextQueued) {
          queuedProfileSaveRef.current = null;
          void saveProfilePayload(nextQueued.payload, { silent: nextQueued.silent });
        }
      }
    },
    [cloudUser, editingCustom, applyProfileUpdateLocally]
  );

  const inlineProfileEditedRef = useRef(false);
  const inlineProfileSaveTimerRef = useRef<number | null>(null);

  const handleSaveMyProfile = useCallback(
    async (e?: Event) => {
      if (e) e.preventDefault();
      if (inlineProfileSaveTimerRef.current !== null) {
        window.clearTimeout(inlineProfileSaveTimerRef.current);
        inlineProfileSaveTimerRef.current = null;
      }
      inlineProfileEditedRef.current = false;
      await saveProfilePayload({
        bio: editingBio,
        statusText: editingStatusText,
        customization: editingCustom,
      });
    },
    [saveProfilePayload, editingBio, editingStatusText, editingCustom]
  );

  useEffect(() => {
    if (!cloudUser || !inlineProfileEditedRef.current) return;
    if (inlineProfileSaveTimerRef.current !== null) {
      window.clearTimeout(inlineProfileSaveTimerRef.current);
    }
    inlineProfileSaveTimerRef.current = window.setTimeout(() => {
      inlineProfileSaveTimerRef.current = null;
      inlineProfileEditedRef.current = false;
      void saveProfilePayload(
        {
          bio: editingBio,
          statusText: editingStatusText,
          customization: editingCustom,
        },
        { silent: true }
      );
    }, 700);
    return () => {
      if (inlineProfileSaveTimerRef.current !== null) {
        window.clearTimeout(inlineProfileSaveTimerRef.current);
        inlineProfileSaveTimerRef.current = null;
      }
    };
  }, [cloudUser, editingBio, editingStatusText, editingCustom, saveProfilePayload]);

  const handleOpenCustomizer = useCallback(async () => {
    if (!cloudUser) {
      document.dispatchEvent(new CustomEvent("toggleAuthModal"));
      return;
    }
    const localSaved = loadLocalProfileCustomization(cloudUser);
    if (localSaved) {
      setEditingCustom(localSaved);
    } else {
      setEditingCustom(getDefaultCustomization(cloudUser));
    }
    setShowCustomizer(true);
    try {
      const res = await fetch(
        `/api/chat/user-profile?username=${encodeURIComponent(cloudUser)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.profile) {
          if (data.profile.createdAt) {
            setSelfCreatedAt(data.profile.createdAt);
          }
          if (viewingProfileRef.current?.toLowerCase() === cloudUser.toLowerCase()) {
            setProfileData(data.profile);
          }
          setEditingBio(data.profile.bio || "");
          setEditingStatusText(data.profile.statusText || "");
          if (data.profile.customization) {
            setEditingCustom(
              sanitizeCustomization(data.profile.customization, cloudUser)
            );
          }
        }
      }
    } catch {}
  }, [cloudUser]);

  const openDirectMessage = useCallback(
    async (targetUsername: string) => {
      const clean = targetUsername.trim().replace(/^@/, "");
      if (!clean) return;
      if (cloudUser && clean.toLowerCase() === cloudUser.toLowerCase()) {
        openUserProfile(clean);
        return;
      }

      const peerLower = clean.toLowerCase();

      // Verify target user exists in the CloudSync database before allowing DM
      let canonicalTarget = clean;
      const foundInOnlineOrMeta =
        serverOnlineUsers.find(
          (u) =>
            u.username.toLowerCase() === peerLower ||
            u.customization?.displayName?.trim().toLowerCase() === peerLower
        )?.username ||
        serverOfflineUsers.find(
          (u) =>
            u.username.toLowerCase() === peerLower ||
            u.customization?.displayName?.trim().toLowerCase() === peerLower
        )?.username ||
        registeredCloudSyncUsers.find((u) => u.toLowerCase() === peerLower);

      if (foundInOnlineOrMeta) {
        canonicalTarget = foundInOnlineOrMeta;
      } else {
        try {
          const checkRes = await fetch(
            `/api/chat/user-profile?username=${encodeURIComponent(clean)}`
          );
          const checkData = await checkRes.json().catch(() => null);
          if (!checkData || checkData.exists === false) {
            notifyToast(
              checkData?.error || `user "@${clean}" does not exist in cloudsync`,
              "error"
            );
            return;
          }
          if (checkData.profile?.username) {
            canonicalTarget = checkData.profile.username;
          }
        } catch {
          notifyToast(`user "@${clean}" does not exist in cloudsync`, "error");
          return;
        }
      }

      const targetKeyLower = canonicalTarget.toLowerCase();
      const isTargetAdminOrStaff =
        targetKeyLower === "bacontheoverseer" ||
        ownerUsersRef.current.some((u) => u.toLowerCase() === targetKeyLower) ||
        staffMods.some((m) => m.toLowerCase() === targetKeyLower);
      const isSelfStaff = selfRole === "owner" || selfRole === "mod";
      const parsedSelfCreated = selfCreatedAt
        ? Number(selfCreatedAt) || Date.parse(String(selfCreatedAt)) || 0
        : 0;
      if (
        !isSelfStaff &&
        isTargetAdminOrStaff &&
        parsedSelfCreated > 0 &&
        Date.now() - parsedSelfCreated < 15 * 60 * 1000
      ) {
        notifyToast(
          "Accounts must be at least 15 minutes old before initiating DMs with admins",
          "error"
        );
        return;
      }

      setDmPeers((prev) => {
        if (prev.some((p) => p.toLowerCase() === canonicalTarget.toLowerCase())) return prev;
        const next = [canonicalTarget, ...prev];
        try {
          localStorage.setItem("cookie_chat_dm_peers_v1", JSON.stringify(next));
        } catch {}
        return next;
      });
      const dmChannel = makeDmChannelId(cloudUser || "guest", canonicalTarget);
      setActiveChannel(dmChannel);
      closeUserProfile();
      setUnreadCounts((prev) => ({ ...prev, [dmChannel]: 0 }));
    },
    [
      cloudUser,
      serverOnlineUsers,
      serverOfflineUsers,
      registeredCloudSyncUsers,
      openUserProfile,
      closeUserProfile,
    ]
  );

  // Sync audio element volumes and mute states when deafened / blocked / volume slider changes
  useEffect(() => {
    for (const [, audioEl] of remoteAudioElementsRef.current.entries()) {
      const peerUsername = audioEl.dataset.username || "";
      const blocked = isUserBlocked(peerUsername);
      const customVol = userVolumes[peerUsername.toLowerCase()] ?? 1;
      audioEl.muted = isDeafened || blocked;
      audioEl.volume = Math.max(0, Math.min(1, customVol));
    }
  }, [isDeafened, blockedUsers, userVolumes, isUserBlocked]);

  // Incoming message handler (shared by SSE, BroadcastChannel, and API poll)
  const ingestIncomingMessage = useCallback(
    (incoming: ChatMessage, options?: { silent?: boolean }) => {
      if (!incoming || !incoming.id) return;

      const isAlreadySeen = seenMessageIdsRef.current.has(incoming.id);
      const myLower = (cloudUser || "guest").toLowerCase();
      const authorLower = (incoming.author || "").toLowerCase();

      if (incoming.channel && authorLower) {
        setTypingByChannel((prev) => {
          const curCh = prev[incoming.channel];
          if (!curCh) return prev;
          const matchingKey = Object.keys(curCh).find((k) => k.toLowerCase() === authorLower);
          if (!matchingKey) return prev;
          const nextCh = { ...curCh };
          delete nextCh[matchingKey];
          if (Object.keys(nextCh).length === 0) {
            const next = { ...prev };
            delete next[incoming.channel];
            return next;
          }
          return { ...prev, [incoming.channel]: nextCh };
        });
      }

      // If it's a DM, verify current user is one of the 2 participants
      if (incoming.channel.startsWith("dm:")) {
        const parts = incoming.channel.slice(3).split(":");
        if (!parts.includes(myLower)) return;

        const partner = parts[0] === myLower ? parts[1] : parts[0];
        if (partner && !blockedUsers.includes(partner.toLowerCase())) {
          setDmPeers((prev) => {
            if (prev.some((p) => p.toLowerCase() === partner.toLowerCase())) return prev;
            const next = [partner, ...prev];
            try {
              localStorage.setItem("cookie_chat_dm_peers_v1", JSON.stringify(next));
            } catch {}
            return next;
          });
        }
      }

      seenMessageIdsRef.current.add(incoming.id);

      setMessages((prev) => {
        const existingIdx = prev.findIndex((m) => m.id === incoming.id);
        if (existingIdx >= 0) {
          const existing = prev[existingIdx];
          const editChanged =
            existing &&
            incoming.edited &&
            (existing.text !== incoming.text || !existing.edited || existing.editedAt !== incoming.editedAt);
          const reactionsChanged =
            existing &&
            JSON.stringify(existing.reactions || {}) !== JSON.stringify(incoming.reactions || {});
          const metaChanged =
            existing &&
            (existing.role !== incoming.role ||
              existing.avatarColor !== incoming.avatarColor ||
              JSON.stringify(existing.customization || null) !==
                JSON.stringify(incoming.customization || null));
          if (editChanged || reactionsChanged || metaChanged) {
            const next = prev.slice();
            next[existingIdx] = {
              ...existing,
              ...(editChanged
                ? {
                    text: incoming.text,
                    edited: true,
                    ...(incoming.editedAt ? { editedAt: incoming.editedAt } : {}),
                  }
                : {}),
              ...(reactionsChanged ? { reactions: incoming.reactions || {} } : {}),
              ...(incoming.role ? { role: incoming.role } : {}),
              ...(incoming.avatarColor ? { avatarColor: incoming.avatarColor } : {}),
              ...(incoming.customization ? { customization: incoming.customization } : {}),
            };
            try {
              batchedLocalStorageSet("cookie_chat_messages_v2", JSON.stringify(next));
            } catch {}
            return next;
          }
          return prev;
        }
        const incomingTs = getMsgTimestampMs(incoming);
        let updated: ChatMessage[];
        if (
          prev.length > 0 &&
          incomingTs > 0 &&
          incomingTs < getMsgTimestampMs(prev[prev.length - 1]!)
        ) {
          updated = [...prev, incoming]
            .sort((a, b) => getMsgTimestampMs(a) - getMsgTimestampMs(b))
            .slice(-250);
        } else {
          updated = [...prev, incoming].slice(-250);
        }
        try {
          batchedLocalStorageSet("cookie_chat_messages_v2", JSON.stringify(updated));
        } catch {}
        return updated;
      });

      if (
        !isAlreadySeen &&
        authorLower !== myLower &&
        !blockedUsers.includes(authorLower)
      ) {
        if (!isOpenRef.current || incoming.channel !== activeChannelRef.current) {
          setUnreadCounts((prev) => ({
            ...prev,
            [incoming.channel]: (prev[incoming.channel] || 0) + 1,
          }));
        }

        if (!options?.silent) {
          const isDm = incoming.channel.startsWith("dm:");
          const isMention = Boolean(
            cloudUser &&
              incoming.text.toLowerCase().includes(`@${cloudUser.toLowerCase()}`)
          );
          if (
            (isDm || isMention) &&
            (!isOpenRef.current || activeChannelRef.current !== incoming.channel)
          ) {
            const toastPreview = incoming.text.trim() || (incoming.gifUrl ? "[gif]" : "");
            notifyDmOrMentionToast(incoming.author, toastPreview, isDm, () => {
              setActiveChannel(incoming.channel);
              setIsOpen(true);
              setUnreadCounts((prev) => ({ ...prev, [incoming.channel]: 0 }));
            });
          }
        }
      }
    },
    [cloudUser, blockedUsers]
  );

  // Send WebRTC / Voice signal over both API and BroadcastChannel
  const sendVoiceSignal = useCallback(
    async (payload: Record<string, unknown>) => {
      const fullPayload = {
        ...payload,
        fromClientId: getClientId(),
        username: cloudUser || "guest",
        avatarColor: stringToColor(cloudUser || "guest"),
      };
      try {
        broadcastRef.current?.postMessage({ type: "VOICE_EVENT", payload: fullPayload });
      } catch {}
      try {
        await fetch("/api/voice/signal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fullPayload),
        });
      } catch {}
    },
    [cloudUser]
  );

  const flushPendingIceCandidates = useCallback(async (remoteClientId: string, pc: RTCPeerConnection) => {
    const queued = pendingIceCandidatesRef.current.get(remoteClientId);
    if (!queued || queued.length === 0) return;
    pendingIceCandidatesRef.current.delete(remoteClientId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }
  }, []);

  const ensureRemoteAudioPlaying = useCallback((audioEl: HTMLAudioElement) => {
    audioEl.play().catch(() => {
      const retryPlay = () => {
        for (const el of remoteAudioElementsRef.current.values()) {
          if (!el.muted && el.paused) {
            el.play().catch(() => {});
          }
        }
        if (audioCtxRef.current?.state === "suspended") {
          void audioCtxRef.current.resume().catch(() => {});
        }
        window.removeEventListener("pointerdown", retryPlay, true);
        window.removeEventListener("keydown", retryPlay, true);
      };
      window.addEventListener("pointerdown", retryPlay, { capture: true, once: true });
      window.addEventListener("keydown", retryPlay, { capture: true, once: true });
    });
  }, []);

  // Create or get RTCPeerConnection for a remote peer
  const getOrCreatePeerConnection = useCallback(
    (remoteClientId: string, remoteUsername: string, roomId: string, initiator: boolean) => {
      const existing = peerConnectionsRef.current.get(remoteClientId);
      if (existing && existing.connectionState !== "failed" && existing.connectionState !== "closed") {
        if (localStreamRef.current && existing.getSenders().length === 0) {
          for (const track of localStreamRef.current.getTracks()) {
            existing.addTrack(track, localStreamRef.current);
          }
        }
        return existing;
      }
      if (existing) {
        try { existing.close(); } catch {}
        peerConnectionsRef.current.delete(remoteClientId);
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun.cloudflare.com:3478" },
        ],
      });

      peerConnectionsRef.current.set(remoteClientId, pc);

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      } else {
        try {
          pc.addTransceiver("audio", { direction: "recvonly" });
        } catch {}
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendVoiceSignal({
            signalType: "VOICE_ICE",
            roomId,
            targetClientId: remoteClientId,
            sdpOrCandidate: e.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams?.[0] || (e.track ? new MediaStream([e.track]) : null);
        if (!stream) return;
        let audioEl = remoteAudioElementsRef.current.get(remoteClientId);
        if (!audioEl) {
          audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          (audioEl as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
          audioEl.style.display = "none";
          document.body.appendChild(audioEl);
          remoteAudioElementsRef.current.set(remoteClientId, audioEl);
        }
        audioEl.dataset.username = remoteUsername;
        audioEl.srcObject = stream;
        audioEl.volume = Math.max(0, Math.min(1, userVolumes[remoteUsername.toLowerCase()] ?? 1));
        audioEl.muted = isDeafenedRef.current || isUserBlocked(remoteUsername);
        ensureRemoteAudioPlaying(audioEl);

        // Set up remote VAD speaking detector
        try {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
          const ctx = audioCtxRef.current;
          if (ctx.state === "suspended") void ctx.resume().catch(() => {});
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const checkRemoteSpeech = () => {
            if (!peerConnectionsRef.current.has(remoteClientId)) return;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            const isSpeaking = avg > 14;
            setSpeakingMap((prev) =>
              prev[remoteClientId] === isSpeaking ? prev : { ...prev, [remoteClientId]: isSpeaking }
            );
            requestAnimationFrame(checkRemoteSpeech);
          };
          requestAnimationFrame(checkRemoteSpeech);
        } catch {}
      };

      if (initiator) {
        pc.createOffer({ offerToReceiveAudio: true })
          .then((offer) => pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => {
            sendVoiceSignal({
              signalType: "VOICE_OFFER",
              roomId,
              targetClientId: remoteClientId,
              sdpOrCandidate: offer,
            });
          })
          .catch(() => {});
      }

      return pc;
    },
    [sendVoiceSignal, isUserBlocked, userVolumes, ensureRemoteAudioPlaying]
  );

  // Incoming voice event handler
  const handleVoiceEvent = useCallback(
    async (ev: Record<string, any>) => {
      if (!ev || !ev.signalType) return;
      const myClientId = getClientId();
      const {
        signalType,
        roomId,
        fromClientId,
        targetClientId,
        username,
        avatarColor,
        participants,
        muted,
        deafened,
        speaking,
        sdpOrCandidate,
      } = ev;

      if (signalType === "VOICE_JOIN") {
        setVoiceRooms((prev) => {
          const list = Array.isArray(participants)
            ? participants
            : [
                ...(prev[roomId] || []).filter((p) => p.clientId !== fromClientId),
                {
                  clientId: fromClientId,
                  username: username || "guest",
                  avatarColor: avatarColor || stringToColor(username || "guest"),
                  muted: !!muted,
                  deafened: !!deafened,
                },
              ];
          return { ...prev, [roomId]: list };
        });

        if (activeVoiceRoomRef.current === roomId && fromClientId && fromClientId !== myClientId) {
          getOrCreatePeerConnection(fromClientId, username || "guest", roomId, true);
        }
      } else if (signalType === "VOICE_LEAVE") {
        setVoiceRooms((prev) => {
          const list = Array.isArray(participants)
            ? participants
            : (prev[roomId] || []).filter((p) => p.clientId !== fromClientId);
          return { ...prev, [roomId]: list };
        });
        const pc = peerConnectionsRef.current.get(fromClientId);
        if (pc) {
          pc.close();
          peerConnectionsRef.current.delete(fromClientId);
        }
        pendingIceCandidatesRef.current.delete(fromClientId);
        const audio = remoteAudioElementsRef.current.get(fromClientId);
        if (audio) {
          audio.pause();
          audio.srcObject = null;
          audio.remove();
          remoteAudioElementsRef.current.delete(fromClientId);
        }
      } else if (signalType === "VOICE_STATE") {
        if (typeof speaking === "boolean" && fromClientId) {
          setSpeakingMap((prev) => ({ ...prev, [fromClientId]: speaking }));
        }
        if (Array.isArray(participants) && participants.length > 0) {
          const normalized = participants.map((p: any) => {
            const cid = p.clientId || p.peerId;
            if (cid === myClientId) {
              return {
                ...p,
                clientId: cid,
                avatarColor: p.avatarColor || stringToColor(p.username || "guest"),
                muted: isMutedRef.current,
                deafened: isDeafenedRef.current,
              };
            }
            return {
              ...p,
              clientId: cid,
              avatarColor: p.avatarColor || stringToColor(p.username || "guest"),
            };
          });
          setVoiceRooms((prev) => ({ ...prev, [roomId]: normalized }));
        } else if (fromClientId && roomId) {
          setVoiceRooms((prev) => ({
            ...prev,
            [roomId]: (prev[roomId] || []).map((p) =>
              p.clientId === fromClientId
                ? {
                    ...p,
                    muted: typeof muted === "boolean" ? muted : p.muted,
                    deafened: typeof deafened === "boolean" ? deafened : p.deafened,
                  }
                : p
            ),
          }));
        }
      } else if (
        signalType === "VOICE_OFFER" &&
        targetClientId === myClientId &&
        activeVoiceRoomRef.current === roomId
      ) {
        const pc = getOrCreatePeerConnection(fromClientId, username || "guest", roomId, false);
        try {
          const isPolite = myClientId < fromClientId;
          if (pc.signalingState !== "stable") {
            if (!isPolite) return;
            await pc.setLocalDescription({ type: "rollback" });
          }
          await pc.setRemoteDescription(new RTCSessionDescription(sdpOrCandidate));
          await flushPendingIceCandidates(fromClientId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendVoiceSignal({
            signalType: "VOICE_ANSWER",
            roomId,
            targetClientId: fromClientId,
            sdpOrCandidate: answer,
          });
        } catch {}
      } else if (
        signalType === "VOICE_ANSWER" &&
        targetClientId === myClientId &&
        activeVoiceRoomRef.current === roomId
      ) {
        const pc = peerConnectionsRef.current.get(fromClientId);
        if (pc && pc.signalingState === "have-local-offer") {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdpOrCandidate));
            await flushPendingIceCandidates(fromClientId, pc);
          } catch {}
        }
      } else if (
        signalType === "VOICE_ICE" &&
        targetClientId === myClientId &&
        activeVoiceRoomRef.current === roomId
      ) {
        const pc = peerConnectionsRef.current.get(fromClientId);
        if (sdpOrCandidate) {
          if (pc && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(sdpOrCandidate));
            } catch {}
          } else {
            const list = pendingIceCandidatesRef.current.get(fromClientId) || [];
            if (list.length < 64) {
              list.push(sdpOrCandidate);
              pendingIceCandidatesRef.current.set(fromClientId, list);
            }
          }
        }
      }
    },
    [getOrCreatePeerConnection, sendVoiceSignal, flushPendingIceCandidates]
  );

  // Leave active voice channel
  const leaveVoiceRoom = useCallback(async () => {
    const currentRoom = activeVoiceRoomRef.current;
    if (!currentRoom) return;

    if (vadIntervalRef.current) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }

    for (const pc of peerConnectionsRef.current.values()) {
      try {
        pc.close();
      } catch {}
    }
    peerConnectionsRef.current.clear();
    pendingIceCandidatesRef.current.clear();

    for (const audio of remoteAudioElementsRef.current.values()) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    remoteAudioElementsRef.current.clear();

    const myClientId = getClientId();
    activeVoiceRoomRef.current = null;
    setActiveVoiceRoom(null);
    setSpeakingMap((prev) => ({ ...prev, [myClientId]: false }));
    setVoiceRooms((prev) => ({
      ...prev,
      [currentRoom]: (prev[currentRoom] || []).filter((p) => p.clientId !== myClientId),
    }));

    await sendVoiceSignal({
      signalType: "VOICE_LEAVE",
      roomId: currentRoom,
    });
  }, [sendVoiceSignal]);

  // Join a voice channel or DM voice call
  const joinVoiceRoom = useCallback(
    async (roomId: string) => {
      if (!cloudUser) {
        notifyToast("sign in to cloudsync to join voice chat", "error");
        document.dispatchEvent(new CustomEvent("toggleAuthModal"));
        return;
      }

      if (activeVoiceRoomRef.current === roomId) {
        setActiveChannel(roomId);
        return;
      }

      if (activeVoiceRoomRef.current) {
        await leaveVoiceRoom();
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch {
        notifyToast("joined voice in listen-only mode (microphone unavailable)", "info");
      }

      localStreamRef.current = stream;
      const myClientId = getClientId();

      if (stream) {
        for (const track of stream.getAudioTracks()) {
          track.enabled = !isMutedRef.current;
        }
        // Start local Voice Activity Detection
        try {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
          const ctx = audioCtxRef.current;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const freqData = new Uint8Array(analyser.frequencyBinCount);
          let lastSpeaking = false;

          vadIntervalRef.current = window.setInterval(() => {
            if (isMutedRef.current) {
              if (lastSpeaking) {
                lastSpeaking = false;
                setSpeakingMap((prev) => ({ ...prev, [myClientId]: false }));
              }
              return;
            }
            analyser.getByteFrequencyData(freqData);
            let sum = 0;
            for (let i = 0; i < freqData.length; i++) sum += freqData[i];
            const avg = sum / freqData.length;
            const speakingNow = avg > 15;
            if (speakingNow !== lastSpeaking) {
              lastSpeaking = speakingNow;
              setSpeakingMap((prev) => ({ ...prev, [myClientId]: speakingNow }));
              try {
                broadcastRef.current?.postMessage({
                  type: "VOICE_EVENT",
                  payload: {
                    signalType: "VOICE_STATE",
                    roomId,
                    fromClientId: myClientId,
                    speaking: speakingNow,
                  },
                });
              } catch {}
            }
          }, 120);
        } catch {}
      }

      const selfParticipant: VoiceParticipant = {
        clientId: myClientId,
        username: cloudUser,
        avatarColor: stringToColor(cloudUser),
        muted: isMutedRef.current,
        deafened: isDeafenedRef.current,
      };

      activeVoiceRoomRef.current = roomId;
      setActiveVoiceRoom(roomId);
      setVoiceRooms((prev) => {
        const current = (prev[roomId] || []).filter((p) => p.clientId !== myClientId);
        return { ...prev, [roomId]: [...current, selfParticipant] };
      });

      await sendVoiceSignal({
        signalType: "VOICE_JOIN",
        roomId,
        muted: selfParticipant.muted,
        deafened: selfParticipant.deafened,
      });

      notifyToast(`connected to ${roomId.replace("voice:", "")}`, "success");
    },
    [cloudUser, leaveVoiceRoom, sendVoiceSignal]
  );

  const applyVoiceMuteDeafenState = useCallback(
    (nextMuted: boolean, nextDeafened: boolean) => {
      isMutedRef.current = nextMuted;
      isDeafenedRef.current = nextDeafened;
      setIsMuted(nextMuted);
      setIsDeafened(nextDeafened);

      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getAudioTracks()) {
          t.enabled = !nextMuted && !nextDeafened;
        }
      }

      for (const [, audioEl] of remoteAudioElementsRef.current.entries()) {
        const peerUsername = audioEl.dataset.username || "";
        audioEl.muted = nextDeafened || isUserBlocked(peerUsername);
      }

      const myClientId = getClientId();
      if (nextMuted || nextDeafened) {
        setSpeakingMap((prev) => ({ ...prev, [myClientId]: false }));
      }

      const rId = activeVoiceRoomRef.current;
      if (rId) {
        setVoiceRooms((rooms) => ({
          ...rooms,
          [rId]: (rooms[rId] || []).map((p) =>
            p.clientId === myClientId
              ? { ...p, muted: nextMuted, deafened: nextDeafened }
              : p
          ),
        }));
        sendVoiceSignal({
          signalType: "VOICE_STATE",
          roomId: rId,
          muted: nextMuted,
          deafened: nextDeafened,
          speaking: false,
        });
      }
    },
    [sendVoiceSignal, isUserBlocked]
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !isMutedRef.current;
    // If unmuting while deafened, also undeafen so user can talk & hear
    const nextDeafened = !nextMuted && isDeafenedRef.current ? false : isDeafenedRef.current;
    applyVoiceMuteDeafenState(nextMuted, nextDeafened);
  }, [applyVoiceMuteDeafenState]);

  const toggleDeafen = useCallback(() => {
    const nextDeafened = !isDeafenedRef.current;
    // Deafening also mutes mic; undeafening unmutes mic
    const nextMuted = nextDeafened ? true : false;
    applyVoiceMuteDeafenState(nextMuted, nextDeafened);
  }, [applyVoiceMuteDeafenState]);

  // Poll / listen for CloudSync login updates
  useEffect(() => {
    let lastRaw: string | null = "__init__";
    const checkAuth = () => {
      try {
        const stored = localStorage.getItem("auth_user");
        if (stored === lastRaw) return;
        lastRaw = stored;
        if (stored) {
          const parsed = JSON.parse(stored);
          if (typeof parsed?.username === "string" && parsed.username.trim().length > 0) {
            setCloudUser(parsed.username.trim());
            return;
          }
        }
      } catch {}
      setCloudUser(null);
    };

    checkAuth();
    window.addEventListener("storage", checkAuth);
    window.addEventListener("cloudsync-auth-changed", checkAuth);
    const interval = setInterval(checkAuth, 5000);
    return () => {
      window.removeEventListener("storage", checkAuth);
      window.removeEventListener("cloudsync-auth-changed", checkAuth);
      clearInterval(interval);
    };
  }, []);

  // Track automatic user activity idle/online state from liveClient
  useEffect(() => {
    setSelfIdle(isClientAutoIdle());
    const onIdleChange = (e: Event) => {
      const idleVal = Boolean((e as CustomEvent)?.detail?.idle);
      setSelfIdle(idleVal);
    };
    window.addEventListener("sunshine-idle-change", onIdleChange);
    return () => window.removeEventListener("sunshine-idle-change", onIdleChange);
  }, []);

  // Ensure editingCustom default matches active username before any customization is saved
  useEffect(() => {
    if (!cloudUser) {
      hydratedLocalCustomForRef.current = null;
      setEditingCustom(getDefaultCustomization(""));
      setChatGroups([]);
      return;
    }
    const localSaved = loadLocalProfileCustomization(cloudUser);
    setEditingCustom(localSaved || getDefaultCustomization(cloudUser));
  }, [cloudUser]);

  // 1-second ticker while Chat modal is open (paused/throttled under Chromebook Mode)
  useEffect(() => {
    if (!isOpen) return;
    setNowMs(Date.now());
    const intervalMs = chromebookMode ? 15000 : 1000;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      if (chromebookMode && isGameActivePerfMode()) return;
      setNowMs(Date.now());
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isOpen, chromebookMode]);

  // Poll chat & presence state gently (SSE handles real-time push; background poll acts as sync safety net)
  useEffect(() => {
    const fetchChatAndPresenceState = (force = false) => {
      if (document.hidden && initialStateLoadedRef.current) return;
      const nowReq = Date.now();
      if (!force && initialStateLoadedRef.current && nowReq - lastStateFetchAtRef.current < 4000) {
        return;
      }
      lastStateFetchAtRef.current = nowReq;
      const isInitial = !initialStateLoadedRef.current;
      let authToken = "";
      try { authToken = localStorage.getItem("auth_token") || ""; } catch {}
      fetch(`/api/chat/state?username=${encodeURIComponent(cloudUser || "")}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          initialStateLoadedRef.current = true;
          if (Array.isArray(data.channels)) {
            setChatChannels(data.channels);
          }
          if (typeof data.totalUsersCount === "number" && Number.isFinite(data.totalUsersCount)) {
            setServerTotalUsersCount(data.totalUsersCount);
          }
          if (Array.isArray(data.messages)) {
            const serverMsgs = data.messages as ChatMessage[];
            const hasMore = Boolean(data.hasMoreMessages);
            const myLower = (cloudUser || "guest").toLowerCase();
            const serverIds = new Set<string>();
            const newlyArrived: ChatMessage[] = [];
            let minServerTs = Infinity;
            const nowTs = Date.now();

            for (const m of serverMsgs) {
              if (!m || !m.id) continue;
              if (m.channel?.startsWith("dm:")) {
                const parts = m.channel.slice(3).split(":");
                if (!parts.includes(myLower)) continue;
                const partner = parts[0] === myLower ? parts[1] : parts[0];
                if (partner && !blockedUsersRef.current.includes(partner.toLowerCase())) {
                  setDmPeers((prev) => {
                    if (prev.some((p) => p.toLowerCase() === partner.toLowerCase())) return prev;
                    const next = [partner, ...prev];
                    try {
                      localStorage.setItem("cookie_chat_dm_peers_v1", JSON.stringify(next));
                    } catch {}
                    return next;
                  });
                }
              }
              serverIds.add(m.id);
              const ts = getMsgTimestampMs(m);
              if (ts > 0 && ts < minServerTs) minServerTs = ts;
              if (!seenMessageIdsRef.current.has(m.id)) {
                seenMessageIdsRef.current.add(m.id);
                newlyArrived.push(m);
              }
            }

            setMessages((prev) => {
              let changed = false;
              const byServerId = new Map<string, ChatMessage>();
              for (const m of serverMsgs) {
                if (m?.id && serverIds.has(m.id)) byServerId.set(m.id, m);
              }

              const kept: ChatMessage[] = [];
              const seenKept = new Set<string>();
              for (const existing of prev) {
                const srv = byServerId.get(existing.id);
                if (srv) {
                  seenKept.add(existing.id);
                  const editChanged =
                    Boolean(srv.edited) !== Boolean(existing.edited) ||
                    existing.text !== srv.text ||
                    existing.editedAt !== srv.editedAt;
                  const reactionsChanged =
                    JSON.stringify(existing.reactions || {}) !==
                    JSON.stringify(srv.reactions || {});
                  const metaChanged =
                    existing.role !== srv.role ||
                    existing.avatarColor !== srv.avatarColor ||
                    JSON.stringify(existing.customization || null) !==
                      JSON.stringify(srv.customization || null);
                  if (editChanged || reactionsChanged || metaChanged) {
                    changed = true;
                    kept.push({
                      ...existing,
                      text: srv.text,
                      ...(srv.edited !== undefined ? { edited: srv.edited } : {}),
                      ...(srv.editedAt !== undefined ? { editedAt: srv.editedAt } : {}),
                      reactions: srv.reactions || {},
                      ...(srv.role ? { role: srv.role } : {}),
                      ...(srv.avatarColor ? { avatarColor: srv.avatarColor } : {}),
                      ...(srv.customization ? { customization: srv.customization } : {}),
                    });
                  } else {
                    kept.push(existing);
                  }
                } else {
                  const exTs = getMsgTimestampMs(existing);
                  const isPending =
                    pendingMessageIdsRef.current.has(existing.id) ||
                    (exTs > 0 && nowTs - exTs < 30000);
                  const withinServerWindow =
                    !hasMore || (minServerTs < Infinity && exTs > 0 && exTs >= minServerTs);
                  if (!isPending && withinServerWindow) {
                    changed = true;
                  } else {
                    kept.push(existing);
                  }
                }
              }

              for (const srv of serverMsgs) {
                if (srv?.id && serverIds.has(srv.id) && !seenKept.has(srv.id)) {
                  changed = true;
                  kept.push(srv);
                }
              }

              if (!changed) return prev;
              const sorted = kept
                .sort((a, b) => getMsgTimestampMs(a) - getMsgTimestampMs(b))
                .slice(-250);
              try {
                batchedLocalStorageSet("cookie_chat_messages_v2", JSON.stringify(sorted));
              } catch {}
              return sorted;
            });

            if (!isInitial && newlyArrived.length > 0) {
              for (const msg of newlyArrived) {
                const authorLower = (msg.author || "").toLowerCase();
                if (authorLower === myLower || blockedUsers.includes(authorLower)) continue;
                if (!isOpenRef.current || msg.channel !== activeChannelRef.current) {
                  setUnreadCounts((prev) => ({
                    ...prev,
                    [msg.channel]: (prev[msg.channel] || 0) + 1,
                  }));
                }
                const isDm = msg.channel.startsWith("dm:");
                const isMention = Boolean(
                  cloudUser && msg.text.toLowerCase().includes(`@${cloudUser.toLowerCase()}`),
                );
                if (
                  (isDm || isMention) &&
                  (!isOpenRef.current || activeChannelRef.current !== msg.channel)
                ) {
                  const toastPreview =
          msg.text.trim() ||
          (msg.gift
            ? msg.gift.type === "cookie_master"
              ? `gifted 1 month of cookie master to @${msg.gift.to}`
              : `gifted ${(Number(msg.gift.amount) || 0).toLocaleString()} coins to @${msg.gift.to}`
            : msg.gifUrl
              ? "[gif]"
              : "");
                  notifyDmOrMentionToast(msg.author, toastPreview, isDm, () => {
                    setActiveChannel(msg.channel);
                    setIsOpen(true);
                    setUnreadCounts((prev) => ({ ...prev, [msg.channel]: 0 }));
                  });
                }
              }
            }
          }
          if (Array.isArray(data.groups)) {
            setChatGroups(data.groups);
          }
          if (data.voiceRooms && typeof data.voiceRooms === "object") {
            setVoiceRooms((prev) => ({ ...prev, ...data.voiceRooms }));
          }
          const incomingPresenceAt = Number(data.presenceAt || 0);
          const usersLoaded = data.usersLoaded !== false;
          if (!incomingPresenceAt || incomingPresenceAt >= lastPresenceAtRef.current) {
            if (incomingPresenceAt && usersLoaded) lastPresenceAtRef.current = incomingPresenceAt;
            if (Array.isArray(data.onlineUsers)) {
              setServerOnlineUsers(data.onlineUsers);
            }
            if (Array.isArray(data.offlineUsers) && (usersLoaded || data.offlineUsers.length > 0)) {
              setServerOfflineUsers(data.offlineUsers);
            }
          } else if (usersLoaded && Array.isArray(data.offlineUsers) && data.offlineUsers.length > 0) {
            setServerOfflineUsers((prev) => (prev.length === 0 ? data.offlineUsers : prev));
          }
          if (Array.isArray(data.staffMods)) {
            setStaffMods(data.staffMods);
          }
          if (Array.isArray(data.ownerUsers)) {
            setOwnerUsers(data.ownerUsers);
          }
          if (Array.isArray(data.goatUsers)) {
            setGoatUsers(data.goatUsers);
          }
          if (Array.isArray(data.cookieMasterUsers)) {
            setCookieMasterUsers(data.cookieMasterUsers);
          }
          if (typeof data.selfRole === "string") {
            setSelfRole(data.selfRole as ChatRole);
          } else {
            setSelfRole("member");
          }
          setSelfTimeout(data.selfTimeout || null);
          if (data.selfCreatedAt) {
            setSelfCreatedAt(String(data.selfCreatedAt));
          }

          if (cloudUser && hydratedLocalCustomForRef.current !== cloudUser.toLowerCase()) {
            const myRecord =
              (Array.isArray(data.onlineUsers) ? data.onlineUsers : []).find(
                (u: any) => u?.username?.toLowerCase() === cloudUser.toLowerCase()
              ) ||
              (Array.isArray(data.offlineUsers) ? data.offlineUsers : []).find(
                (u: any) => u?.username?.toLowerCase() === cloudUser.toLowerCase()
              );
            const localCustom = loadLocalProfileCustomization(cloudUser);
            if (myRecord?.customization) {
              hydratedLocalCustomForRef.current = cloudUser.toLowerCase();
              const sanitized = sanitizeCustomization(myRecord.customization, cloudUser);
              setEditingCustom(sanitized);
              saveLocalProfileCustomization(cloudUser, sanitized);
            } else if (localCustom) {
              setEditingCustom(localCustom);
              // Only auto-upload cached local customization after server hydration finishes and the user has a meaningful customization
              if (usersLoaded && myRecord) {
                hydratedLocalCustomForRef.current = cloudUser.toLowerCase();
                if (authToken && !isStaleUninitializedCustom(localCustom)) {
                  fetch("/api/chat/user-profile", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                      bio: myRecord?.bio || "",
                      statusText: myRecord?.statusText || "",
                      customization: localCustom,
                    }),
                  }).catch(() => {});
                }
              }
            } else {
              if (usersLoaded) {
                hydratedLocalCustomForRef.current = cloudUser.toLowerCase();
              }
              setEditingCustom(getDefaultCustomization(cloudUser));
            }
            if (typeof myRecord?.bio === "string") setEditingBio(myRecord.bio);
            if (typeof myRecord?.statusText === "string") {
              setEditingStatusText(myRecord.statusText);
            }
          }
          if (Array.isArray(data.registeredUsers) && (usersLoaded || data.registeredUsers.length > 0)) {
            setRegisteredCloudSyncUsers(data.registeredUsers);
            if (data.registeredUsers.length > 0) {
              const validSet = new Set(
                data.registeredUsers.map((u: string) => u.toLowerCase())
              );
              setDmPeers((prev) => {
                const filtered = prev.filter((p) => validSet.has(p.toLowerCase()));
                if (filtered.length !== prev.length) {
                  try {
                    localStorage.setItem(
                      "cookie_chat_dm_peers_v1",
                      JSON.stringify(filtered)
                    );
                  } catch {}
                  return filtered;
                }
                return prev;
              });
            }
          }
        })
        .catch(() => {});
    };

    fetchChatAndPresenceState(true);
    const onVisWake = () => {
      if (!document.hidden) fetchChatAndPresenceState();
    };
    const onSyncWake = () => fetchChatAndPresenceState();
    document.addEventListener("visibilitychange", onVisWake);
    window.addEventListener("sunshine-sse-open", onSyncWake);
    fetchChatStateRef.current = fetchChatAndPresenceState;
    window.addEventListener("online", onSyncWake);
    let lastPollAt = Date.now();
    const pollInterval = window.setInterval(() => {
      const sseOpen = isLiveStreamConnected();
      const targetInterval = !initialStateLoadedRef.current
        ? 4000
        : isOpenRef.current
          ? sseOpen
            ? 20000
            : 5000
          : sseOpen
            ? 60000
            : 20000;
      if (Date.now() - lastPollAt >= targetInterval - 200) {
        lastPollAt = Date.now();
        fetchChatAndPresenceState();
      }
    }, 4000);
    return () => {
      window.clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", onVisWake);
      window.removeEventListener("sunshine-sse-open", onSyncWake);
      window.removeEventListener("online", onSyncWake);
    };
  }, [cloudUser]);

  useEffect(() => {
    setReplyingTo(null);
    setEditingMessageId(null);
    setConfirmDeleteChat(null);
    setReactingMessageId(null);
    setReactPickerMessageId(null);
    setMsgRenderLimit(CHROMEBOOK_INITIAL_MSG_CAP);
  }, [activeChannel]);

  useEffect(() => {
    if (!isOpen) {
      setShowCameraModal(false);
      setLightboxImage(null);
      setDragOverChat(false);
    }
  }, [isOpen]);

  const filterMessagesLocally = useCallback(
    (predicate: (m: ChatMessage) => boolean) => {
      setMessages((prev) => {
        const next = prev.filter(predicate);
        if (next.length === prev.length) return prev;
        try {
          batchedLocalStorageSet("cookie_chat_messages_v2", JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  const updateMessageLocally = useCallback(
    (messageId: string, updater: (m: ChatMessage) => ChatMessage) => {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx < 0 || !prev[idx]) return prev;
        const next = prev.slice();
        next[idx] = updater(prev[idx]);
        try {
          batchedLocalStorageSet("cookie_chat_messages_v2", JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    []
  );

  // Modal open / close handlers, SSE custom events & BroadcastChannel
  useEffect(() => {
    const handleToggle = () => setIsOpen((prev) => !prev);
    const handleClose = () => setIsOpen(false);
    const onOpenCustomizerEvt = () => {
      setIsOpen(true);
      handleOpenCustomizer();
    };

    const onSseChat = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      if (detail.message) ingestIncomingMessage(detail.message);
      const evtKind = detail.event || detail.type;
      if (evtKind === "MESSAGE_DELETED" && detail.messageId) {
        filterMessagesLocally((m) => m.id !== detail.messageId);
      } else if (evtKind === "MESSAGE_EDITED" && detail.messageId) {
        updateMessageLocally(detail.messageId, (m) => ({
          ...m,
          text: typeof detail.text === "string" ? detail.text : m.text,
          edited: true,
          ...(detail.editedAt ? { editedAt: Number(detail.editedAt) } : {}),
        }));
      } else if (evtKind === "MESSAGE_REACTED" && detail.messageId) {
        updateMessageLocally(String(detail.messageId), (m) => ({
          ...m,
          reactions: detail.reactions && typeof detail.reactions === "object" ? detail.reactions : {},
        }));
      } else if (evtKind === "GROUP_UPDATED" && detail.group?.id) {
        const g = detail.group as ChatGroupDef;
        const myL = (cloudUser || "").toLowerCase();
        setChatGroups((prev) => {
          const isStillMember = Array.isArray(g.members) && g.members.includes(myL);
          const filtered = prev.filter((x) => x.id !== g.id);
          return isStillMember ? [g, ...filtered] : filtered;
        });
        if (!Array.isArray(g.members) || !g.members.includes(myL)) {
          setActiveChannel((ch) => (ch === g.id ? "general" : ch));
        }
      } else if (evtKind === "GROUP_DELETED" && detail.groupId) {
        const gid = String(detail.groupId);
        setChatGroups((prev) => prev.filter((x) => x.id !== gid));
        setActiveChannel((ch) => (ch === gid ? "general" : ch));
      } else if (evtKind === "CHANNEL_CLEARED" && detail.channel) {
        const ch = String(detail.channel);
        const target = detail.targetUsername ? String(detail.targetUsername).toLowerCase() : "";
        filterMessagesLocally((m) => {
          if (m.channel !== ch) return true;
          if (target && m.author.toLowerCase() !== target) return true;
          return false;
        });
      } else if (evtKind === "USER_WIPED" && detail.targetUsername) {
        const target = String(detail.targetUsername).trim().replace(/^@/, "").toLowerCase();
        if (target) {
          const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const mentionRe = new RegExp(`(^|[^a-zA-Z0-9_])@${escaped}(?=$|[^a-zA-Z0-9_])`, "gi");
          setMessages((prev) => {
            const next = [];
            for (const m of prev) {
              if (!m || String(m.author || "").trim().toLowerCase() === target) continue;
              let copy = m;
              if (m.replyTo && String(m.replyTo.author || "").trim().toLowerCase() === target) {
                copy = { ...copy };
                delete copy.replyTo;
              }
              if (typeof copy.text === "string" && mentionRe.test(copy.text)) {
                mentionRe.lastIndex = 0;
                const cleanedText = copy.text
                  .replace(mentionRe, "$1")
                  .replace(/[ \t]{2,}/g, " ")
                  .trim();
                const hasMedia = Boolean(copy.media || copy.attachment || copy.sticker || copy.image);
                if (!cleanedText && !hasMedia) continue;
                copy = { ...copy, text: cleanedText };
              }
              next.push(copy);
            }
            return next;
          });
          setDmPeers((prev) => prev.filter((p) => p.toLowerCase() !== target));
        }
      } else if (evtKind === "USER_TYPING" && detail.channel && detail.username) {
        const ch = String(detail.channel);
        const typer = String(detail.username).trim();
        if (!typer) return;
        if (cloudUser && typer.toLowerCase() === cloudUser.toLowerCase()) return;
        if (blockedUsersRef.current.includes(typer.toLowerCase())) return;
        const isTypingNow = Boolean(detail.isTyping);
        setTypingByChannel((prev) => {
          const curCh = prev[ch] || {};
          if (!isTypingNow) {
            if (!(typer in curCh)) return prev;
            const nextCh = { ...curCh };
            delete nextCh[typer];
            if (Object.keys(nextCh).length === 0) {
              const next = { ...prev };
              delete next[ch];
              return next;
            }
            return { ...prev, [ch]: nextCh };
          }
          return {
            ...prev,
            [ch]: {
              ...curCh,
              [typer]: Date.now() + 5000,
            },
          };
        });
      } else if (evtKind === "STAFF_UPDATED") {
        if (Array.isArray(detail.staffMods)) setStaffMods(detail.staffMods);
        if (Array.isArray(detail.ownerUsers)) setOwnerUsers(detail.ownerUsers);
        if (cloudUser) {
          const lower = cloudUser.toLowerCase();
          const owners = Array.isArray(detail.ownerUsers)
            ? detail.ownerUsers
            : ownerUsersRef.current;
          const mods = Array.isArray(detail.staffMods) ? detail.staffMods : [];
          if (owners.some((u: string) => u.toLowerCase() === lower)) {
            setSelfRole("owner");
          } else if (mods.some((u: string) => u.toLowerCase() === lower)) {
            setSelfRole("mod");
          } else {
            setSelfRole("member");
          }
        }
        fetchChatStateRef.current?.(true);
      } else if (evtKind === "CHANNELS_UPDATED") {
        fetchChatStateRef.current?.(true);
      } else if (evtKind === "GOAT_UPDATED") {
        if (Array.isArray(detail.goatUsers)) setGoatUsers(detail.goatUsers);
      } else if (evtKind === "PROFILE_UPDATED" && detail.username) {
        applyProfileUpdateLocally({
          username: String(detail.username),
          bio: typeof detail.bio === "string" ? detail.bio : undefined,
          statusText: typeof detail.statusText === "string" ? detail.statusText : undefined,
          customization: detail.customization,
          ...(detail.lastfm !== undefined ? { lastfm: detail.lastfm } : {}),
          role: detail.role,
        });
      } else if (evtKind === "MOD_UPDATE" && detail.targetUsername) {
        const targetLower = String(detail.targetUsername).toLowerCase();
        if (cloudUser && targetLower === cloudUser.toLowerCase()) {
          setSelfTimeout(detail.timeout || null);
        }
        const updateTimeoutFields = (u: OnlineUser): OnlineUser =>
          u.username.toLowerCase() === targetLower
            ? {
                ...u,
                isTimedOut: Boolean(detail.timeout),
                timeoutUntil: Number(detail.timeout?.until) || 0,
              }
            : u;
        setServerOnlineUsers((prev) => prev.map(updateTimeoutFields));
        setServerOfflineUsers((prev) => prev.map(updateTimeoutFields));
      }
    };

    const onSseVoice = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) handleVoiceEvent(detail);
    };

    const applyPresenceDetail = (detail: any) => {
      if (!detail) return;
      const incomingAt = Number(detail.snapshotAt || 0);
      const usersLoaded = detail.usersLoaded !== false;
      if (incomingAt && incomingAt < lastPresenceAtRef.current) return;
      if (incomingAt && usersLoaded) lastPresenceAtRef.current = incomingAt;
      if (Array.isArray(detail.onlineUsers)) {
        setServerOnlineUsers(detail.onlineUsers);
      }
      if (Array.isArray(detail.offlineUsers) && (usersLoaded || detail.offlineUsers.length > 0)) {
        setServerOfflineUsers(detail.offlineUsers);
      }
      const combinedUsers: OnlineUser[] = [
        ...(Array.isArray(detail.onlineUsers) ? detail.onlineUsers : []),
        ...(Array.isArray(detail.offlineUsers) ? detail.offlineUsers : []),
      ];
      if (combinedUsers.length > 0) {
        setProfileData((prev) => {
          if (!prev) return prev;
          const lower = prev.username.toLowerCase();
          if (viewingProfileRef.current?.toLowerCase() !== lower) return null;
          const match = combinedUsers.find((u) => u.username?.toLowerCase() === lower);
          if (!match) return prev;
          const isOnline = Array.isArray(detail.onlineUsers)
            ? detail.onlineUsers.some((u: OnlineUser) => u.username?.toLowerCase() === lower)
            : prev.online;
          return {
            ...prev,
            online: isOnline,
            isIdle: Boolean(match.isIdle),
            ...(typeof match.bio === "string" ? { bio: match.bio } : {}),
            ...(typeof match.statusText === "string" ? { statusText: match.statusText } : {}),
            ...(match.customization ? { customization: match.customization } : {}),
            ...(match.role ? { role: match.role } : {}),
          };
        });
      }
      if (Array.isArray(detail.staffMods)) {
        setStaffMods(detail.staffMods);
      }
      if (Array.isArray(detail.ownerUsers)) {
        setOwnerUsers(detail.ownerUsers);
      }
      if (Array.isArray(detail.goatUsers)) {
        setGoatUsers(detail.goatUsers);
      }
      if (Array.isArray(detail.cookieMasterUsers)) {
        setCookieMasterUsers(detail.cookieMasterUsers);
      }
      if (Array.isArray(detail.registeredUsers) && (usersLoaded || detail.registeredUsers.length > 0)) {
        setRegisteredCloudSyncUsers(detail.registeredUsers);
      }
      if (typeof detail.totalUsersCount === "number" && Number.isFinite(detail.totalUsersCount)) {
        setServerTotalUsersCount(detail.totalUsersCount);
      }
      if (cloudUser && (Array.isArray(detail.ownerUsers) || Array.isArray(detail.staffMods))) {
        const lower = cloudUser.toLowerCase();
        const owners = Array.isArray(detail.ownerUsers)
          ? detail.ownerUsers
          : ownerUsersRef.current;
        const mods = Array.isArray(detail.staffMods) ? detail.staffMods : [];
        if (owners.some((u: string) => u.toLowerCase() === lower)) {
          setSelfRole("owner");
        } else if (mods.some((u: string) => u.toLowerCase() === lower)) {
          setSelfRole("mod");
        } else if (Array.isArray(detail.staffMods)) {
          setSelfRole("member");
        }
      }
    };

    const onSsePresence = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      if (!chromebookModeRef.current) {
        applyPresenceDetail(detail);
        return;
      }
      const prev = pendingPresenceDetailRef.current;
      pendingPresenceDetailRef.current = prev
        ? {
            ...prev,
            ...detail,
            ...(Array.isArray(detail.onlineUsers)
              ? { onlineUsers: detail.onlineUsers }
              : prev.onlineUsers
              ? { onlineUsers: prev.onlineUsers }
              : {}),
            ...(Array.isArray(detail.offlineUsers) &&
            (detail.usersLoaded !== false || detail.offlineUsers.length > 0)
              ? { offlineUsers: detail.offlineUsers }
              : prev.offlineUsers
              ? { offlineUsers: prev.offlineUsers }
              : {}),
          }
        : detail;
      if (presenceBatchTimerRef.current === null) {
        presenceBatchTimerRef.current = window.setTimeout(() => {
          presenceBatchTimerRef.current = null;
          if (presenceBatchRafRef.current !== null) {
            window.cancelAnimationFrame(presenceBatchRafRef.current);
          }
          presenceBatchRafRef.current = window.requestAnimationFrame(() => {
            presenceBatchRafRef.current = null;
            const merged = pendingPresenceDetailRef.current;
            pendingPresenceDetailRef.current = null;
            if (merged) applyPresenceDetail(merged);
          });
        }, 500);
      }
    };

    document.addEventListener("toggleChatModal", handleToggle);
    document.addEventListener("closeChatModal", handleClose);
    window.addEventListener("openProfileCustomizer", onOpenCustomizerEvt);
    window.addEventListener("sunshine-chat-event", onSseChat);
    window.addEventListener("sunshine-voice-event", onSseVoice);
    window.addEventListener("sunshine-presence-event", onSsePresence);

    try {
      const bc = new BroadcastChannel("cookie_chat_v2_channel");
      bc.onmessage = (event) => {
        if (event.data?.type === "NEW_MESSAGE" && event.data.message) {
          ingestIncomingMessage(event.data.message);
        } else if (event.data?.type === "MESSAGE_DELETED" && event.data.messageId) {
          filterMessagesLocally((m) => m.id !== event.data.messageId);
        } else if (event.data?.type === "MESSAGE_EDITED" && event.data.messageId) {
          updateMessageLocally(event.data.messageId, (m) => ({
            ...m,
            text: typeof event.data.text === "string" ? event.data.text : m.text,
            edited: true,
            ...(event.data.editedAt ? { editedAt: Number(event.data.editedAt) } : {}),
          }));
        } else if (event.data?.type === "MESSAGE_REACTED" && event.data.messageId) {
          updateMessageLocally(String(event.data.messageId), (m) => ({
            ...m,
            reactions: event.data.reactions && typeof event.data.reactions === "object" ? event.data.reactions : {},
          }));
        } else if (event.data?.type === "CHANNEL_CLEARED" && event.data.channel) {
          filterMessagesLocally((m) => m.channel !== event.data.channel);
        } else if (event.data?.type === "VOICE_EVENT" && event.data.payload) {
          handleVoiceEvent(event.data.payload);
        } else if (event.data?.type === "PROFILE_UPDATED" && event.data.username) {
          applyProfileUpdateLocally({
            username: String(event.data.username),
            bio: typeof event.data.bio === "string" ? event.data.bio : undefined,
            statusText: typeof event.data.statusText === "string" ? event.data.statusText : undefined,
            customization: event.data.customization,
            role: event.data.role,
          });
        }
      };
      broadcastRef.current = bc;
    } catch {}

    return () => {
      document.removeEventListener("toggleChatModal", handleToggle);
      document.removeEventListener("closeChatModal", handleClose);
      window.removeEventListener("openProfileCustomizer", onOpenCustomizerEvt);
      window.removeEventListener("sunshine-chat-event", onSseChat);
      window.removeEventListener("sunshine-voice-event", onSseVoice);
      window.removeEventListener("sunshine-presence-event", onSsePresence);
      if (presenceBatchTimerRef.current !== null) {
        window.clearTimeout(presenceBatchTimerRef.current);
        presenceBatchTimerRef.current = null;
      }
      if (presenceBatchRafRef.current !== null) {
        window.cancelAnimationFrame(presenceBatchRafRef.current);
        presenceBatchRafRef.current = null;
      }
      pendingPresenceDetailRef.current = null;
      broadcastRef.current?.close();
    };
  }, [
    cloudUser,
    ingestIncomingMessage,
    filterMessagesLocally,
    updateMessageLocally,
    applyProfileUpdateLocally,
    handleVoiceEvent,
    handleOpenCustomizer,
  ]);

  const escStateRef = useRef<{
    lightboxImage: typeof lightboxImage;
    showCameraModal: boolean;
    editingMessageId: string | null;
    reactPickerMessageId: string | null;
    reactingMessageId: string | null;
    groupModalMode: typeof groupModalMode;
    confirmDeleteChat: string | null;
    showStaffModal: boolean;
    showCustomizer: boolean;
    showGifPicker: boolean;
    showEmojiPicker: boolean;
    replyingTo: typeof replyingTo;
    viewingProfileUsername: string | null;
  }>({
    lightboxImage: null,
    showCameraModal: false,
    editingMessageId: null,
    reactPickerMessageId: null,
    reactingMessageId: null,
    groupModalMode: null,
    confirmDeleteChat: null,
    showStaffModal: false,
    showCustomizer: false,
    showGifPicker: false,
    showEmojiPicker: false,
    replyingTo: null,
    viewingProfileUsername: null,
  });
  escStateRef.current = {
    lightboxImage,
    showCameraModal,
    editingMessageId,
    reactPickerMessageId,
    reactingMessageId,
    groupModalMode,
    confirmDeleteChat,
    showStaffModal,
    showCustomizer,
    showGifPicker,
    showEmojiPicker,
    replyingTo,
    viewingProfileUsername,
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const st = escStateRef.current;
      if (st.lightboxImage) {
        setLightboxImage(null);
      } else if (st.showCameraModal) {
        setShowCameraModal(false);
      } else if (st.editingMessageId) {
        setEditingMessageId(null);
      } else if (st.reactPickerMessageId) {
        setReactPickerMessageId(null);
      } else if (st.reactingMessageId) {
        setReactingMessageId(null);
      } else if (st.groupModalMode) {
        setGroupModalMode(null);
      } else if (st.confirmDeleteChat) {
        setConfirmDeleteChat(null);
      } else if (st.showStaffModal) {
        setShowStaffModal(false);
      } else if (st.showCustomizer) {
        setShowCustomizer(false);
      } else if (st.showGifPicker) {
        setShowGifPicker(false);
      } else if (st.showEmojiPicker) {
        setShowEmojiPicker(false);
      } else if (st.replyingTo) {
        setReplyingTo(null);
      } else if (st.viewingProfileUsername) {
        closeUserProfile();
      } else {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeUserProfile]);

  const fetchKlipyGifs = useCallback(
    async (query: string, pageNum: number, append: boolean) => {
      if (gifAbortRef.current) gifAbortRef.current.abort();
      const ctrl = new AbortController();
      gifAbortRef.current = ctrl;

      setGifLoading(true);
      setGifError("");
      try {
        const params = new URLSearchParams({
          page: String(pageNum),
          perPage: "18",
          customerId: getClientId(),
        });
        if (query.trim()) params.set("q", query.trim());

        const res = await fetch(`/api/chat/gifs?${params.toString()}`, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = await res.json().catch(() => null);
        if (ctrl.signal.aborted) return;

        if (!data || data.configured === false) {
          setGifConfigured(false);
          setGifItems([]);
          setGifHasNext(false);
          return;
        }

        setGifConfigured(true);
        if (!res.ok || !data.success) {
          setGifError(data?.error || "failed to load gifs from klipy");
          return;
        }

        const nextItems = Array.isArray(data.items) ? data.items : [];
        setGifItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
        setGifPage(pageNum);
        setGifHasNext(Boolean(data.hasNext));
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setGifError("could not load gifs right now");
        }
      } finally {
        if (gifAbortRef.current === ctrl) {
          setGifLoading(false);
        }
      }
    },
    []
  );

  // Lazy-load Klipy GIFs when picker opens or search changes
  useEffect(() => {
    if (!isOpen || !showGifPicker) return;
    const timer = window.setTimeout(() => {
      void fetchKlipyGifs(gifSearch, 1, false);
    }, gifSearch ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, showGifPicker, gifSearch, fetchKlipyGifs]);

  // Sync local Cookie Coins balance & Cookie Master status
  useEffect(() => {
    const syncCoins = () => setMyCoinBalance(getCookieCoins());
    const syncMaster = () => setSelfIsCookieMaster(isCookieMasterActive());
    syncCoins();
    syncMaster();
    window.addEventListener("cookie-coins-updated", syncCoins);
    window.addEventListener("cookie-master-changed", syncMaster);
    document.addEventListener("cloudsync-restored", syncCoins);
    return () => {
      window.removeEventListener("cookie-coins-updated", syncCoins);
      window.removeEventListener("cookie-master-changed", syncMaster);
      document.removeEventListener("cloudsync-restored", syncCoins);
    };
  }, []);

  // Close GIF, Emoji, Gift, or Reaction picker when clicking outside
  useEffect(() => {
    if (!showGifPicker && !showEmojiPicker && !showGiftPicker && !reactingMessageId && !reactPickerMessageId) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (
        showGifPicker &&
        !gifPickerRef.current?.contains(target) &&
        !target.closest(".chat-gif-toggle-btn")
      ) {
        setShowGifPicker(false);
      }
      if (
        showEmojiPicker &&
        !emojiPickerRef.current?.contains(target) &&
        !target.closest(".chat-emoji-toggle-btn")
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showGiftPicker &&
        !giftPickerRef.current?.contains(target) &&
        !target.closest(".chat-gift-toggle-btn")
      ) {
        setShowGiftPicker(false);
      }
      if (
        reactingMessageId &&
        !target.closest(".chat-quick-react-bar") &&
        !target.closest(".chat-react-toggle-btn")
      ) {
        setReactingMessageId(null);
      }
      if (
        reactPickerMessageId &&
        !reactPickerRef.current?.contains(target) &&
        !target.closest(".chat-quick-react-more")
      ) {
        setReactPickerMessageId(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showGifPicker, showEmojiPicker, showGiftPicker, reactingMessageId, reactPickerMessageId]);

  const isOwnerUser = Boolean(
    cloudUser &&
      (selfRole === "owner" ||
        ownerUsers.some((u) => u.toLowerCase() === cloudUser.toLowerCase()) ||
        cloudUser.toLowerCase() === "bacontheoverseer" ||
        cloudUser.toLowerCase() === "bacon"),
  );

  const GIFT_COOKIE_MASTER_COST = 5000;
  const handleSendGift = useCallback(
    async (e?: Event) => {
      if (e) e.preventDefault();
      if (!cloudUser || giftSendLockRef.current || isSendingGift) return;
      const recipient = giftRecipient.trim().replace(/^@/, "");
      if (!recipient) {
        notifyToast("enter a @username to send a gift to", "error");
        return;
      }
      if (!isOwnerUser && recipient.toLowerCase() === cloudUser.toLowerCase()) {
        notifyToast("you cannot send a gift to yourself", "error");
        return;
      }

      const isOwner = isOwnerUser;
      let cost = 0;
      let parsedAmount = 0;
      if (giftTab === "coins") {
        parsedAmount = Math.floor(Number(giftAmount) || 0);
        const minAmt = isOwner ? 1 : 10;
        const maxAmt = isOwner ? 1000000000 : 1000000;
        if (parsedAmount < minAmt || parsedAmount > maxAmt) {
          notifyToast(
            isOwner
              ? "enter a gift amount of at least 1 coin"
              : "gift amount must be between 10 and 1,000,000 coins",
            "error",
          );
          return;
        }
        cost = isOwner ? 0 : parsedAmount;
      } else {
        cost = isOwner ? 0 : GIFT_COOKIE_MASTER_COST;
      }

      if (cost > 0 && !spendCookieCoins(cost)) {
        notifyToast(`not enough cookie coins (need ${cost.toLocaleString()})`, "error");
        return;
      }

      giftSendLockRef.current = true;
      setIsSendingGift(true);
      setMyCoinBalance(getCookieCoins());
      try {
        const token = localStorage.getItem("auth_token") || "";
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch("/api/chat/gift", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            recipient,
            giftType: giftTab,
            amount: giftTab === "coins" ? parsedAmount : undefined,
            channel: activeChannel,
            note: giftNote.trim().slice(0, 120),
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          if (cost > 0) {
            const refund = getCookieCoins() + cost;
            localStorage.setItem("cookie_coins_balance_v1", String(refund));
            window.dispatchEvent(new CustomEvent("cookie-coins-updated", { detail: { balance: refund } }));
            setMyCoinBalance(getCookieCoins());
          }
          notifyToast(data?.error || "failed to send gift", "error");
          return;
        }
        notifyToast(
          giftTab === "cookie_master"
            ? `gifted 1 month of cookie master to @${data.recipient || recipient}!`
            : `gifted ${parsedAmount.toLocaleString()} cookie coins to @${data.recipient || recipient}!`,
          "success",
        );
        setGiftNote("");
        setShowGiftPicker(false);
      } catch {
        if (cost > 0) {
          const refund = getCookieCoins() + cost;
          localStorage.setItem("cookie_coins_balance_v1", String(refund));
          window.dispatchEvent(new CustomEvent("cookie-coins-updated", { detail: { balance: refund } }));
          setMyCoinBalance(getCookieCoins());
        }
        notifyToast("network error sending gift", "error");
      } finally {
        giftSendLockRef.current = false;
        setIsSendingGift(false);
      }
    },
    [cloudUser, isSendingGift, giftRecipient, isOwnerUser, giftTab, giftAmount, activeChannel, giftNote],
  );

  const handleInsertEmoji = useCallback((emoji: string) => {
    const input = chatInputRef.current;
    if (input) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      setInputText((prev) => {
        const safeStart = Math.min(start, prev.length);
        const safeEnd = Math.min(Math.max(end, safeStart), prev.length);
        const next = prev.slice(0, safeStart) + emoji + prev.slice(safeEnd);
        return next.slice(0, 500);
      });
      requestAnimationFrame(() => {
        input.focus();
        const pos = Math.min(start + emoji.length, 500);
        try {
          input.setSelectionRange(pos, pos);
        } catch {}
      });
    } else {
      setInputText((prev) => (prev + emoji).slice(0, 500));
    }
  }, []);

  const sendTypingSignal = useCallback(
    (channel: string, isTyping: boolean) => {
      if (!cloudUser || !channel) return;
      if (isTyping) {
        const now = Date.now();
        if (lastTypingChannelRef.current === channel && now - lastTypingSentAtRef.current < 2400) {
          return;
        }
        lastTypingSentAtRef.current = now;
        lastTypingChannelRef.current = channel;
      } else {
        if (typingStopTimerRef.current !== null) {
          window.clearTimeout(typingStopTimerRef.current);
          typingStopTimerRef.current = null;
        }
        if (lastTypingChannelRef.current === channel) {
          lastTypingChannelRef.current = null;
          lastTypingSentAtRef.current = 0;
        }
      }
      let token = "";
      try {
        token = localStorage.getItem("auth_token") || "";
      } catch {}
      void fetch("/api/chat/typing", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}`, "x-cloudsync-token": token } : {}),
        },
        body: JSON.stringify({ channel, isTyping }),
      }).catch(() => {});
    },
    [cloudUser],
  );

  const handleTypingActivity = useCallback(
    (nextValue: string) => {
      if (!cloudUser || !isOpen) return;
      const trimmed = nextValue.trim();
      if (!trimmed) {
        if (lastTypingChannelRef.current === activeChannel) {
          sendTypingSignal(activeChannel, false);
        }
        return;
      }
      sendTypingSignal(activeChannel, true);
      if (typingStopTimerRef.current !== null) {
        window.clearTimeout(typingStopTimerRef.current);
      }
      const ch = activeChannel;
      typingStopTimerRef.current = window.setTimeout(() => {
        typingStopTimerRef.current = null;
        sendTypingSignal(ch, false);
      }, 3500);
    },
    [cloudUser, isOpen, activeChannel, sendTypingSignal],
  );

  useEffect(() => {
    const prevCh = lastTypingChannelRef.current;
    if (prevCh && (!isOpen || prevCh !== activeChannel)) {
      sendTypingSignal(prevCh, false);
    }
  }, [isOpen, activeChannel, sendTypingSignal]);

  useEffect(() => {
    if (Object.keys(typingByChannel).length === 0) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setTypingByChannel((prev) => {
        let changed = false;
        const next: Record<string, Record<string, number>> = {};
        for (const [ch, users] of Object.entries(prev)) {
          const kept: Record<string, number> = {};
          for (const [u, exp] of Object.entries(users)) {
            if (exp > now) {
              kept[u] = exp;
            } else {
              changed = true;
            }
          }
          if (Object.keys(kept).length > 0) {
            next[ch] = kept;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [typingByChannel]);

  const activeChannelTypers = useMemo(() => {
    const map = typingByChannel[activeChannel];
    if (!map) return [];
    const now = Date.now();
    return Object.entries(map)
      .filter(([, exp]) => exp > now)
      .map(([u]) => u);
  }, [typingByChannel, activeChannel]);

  const typingLabel = useMemo(() => {
    if (activeChannelTypers.length === 0) return "";
    if (activeChannelTypers.length === 1) return `${activeChannelTypers[0]} is typing...`;
    if (activeChannelTypers.length <= 3) {
      return `${activeChannelTypers.join(", ")} are typing...`;
    }
    return `${activeChannelTypers.slice(0, 3).join(", ")} +${activeChannelTypers.length - 3} more are typing...`;
  }, [activeChannelTypers]);

  // Scroll to bottom when messages change or channel changes
  useEffect(() => {
    if (isOpen) {
      setUnreadCounts((prev) =>
        prev[activeChannel] ? { ...prev, [activeChannel]: 0 } : prev
      );
      if (chromebookMode) {
        ignoreAutoExpandUntilRef.current = Date.now() + 250;
      }
      setTimeout(() => {
        if (chromebookMode && chatFeedRef.current) {
          chatFeedRef.current.scrollTop = chatFeedRef.current.scrollHeight;
          prevFeedScrollTopRef.current = chatFeedRef.current.scrollTop;
        } else {
          messagesEndRef.current?.scrollIntoView({
            behavior: chromebookMode ? "auto" : "smooth",
          });
        }
      }, 40);
    }
  }, [messages, isOpen, activeChannel, chromebookMode]);

  const stageChatImageFile = useCallback(async (file?: File | null) => {
    if (!file) return;
    if (!cloudUser) {
      notifyToast("sign in to cloudsync to upload images", "error");
      return;
    }
    try {
      const compressed = await compressImageFile(file, {
        maxWidth: 1080,
        maxHeight: 1080,
        maxGifBytes: 900 * 1024,
        quality: 0.85,
      });
      setPendingImage(compressed);
      setShowGifPicker(false);
      setShowEmojiPicker(false);
      window.setTimeout(() => chatInputRef.current?.focus(), 30);
    } catch (err: any) {
      notifyToast(err?.message || "could not process image", "error");
    }
  }, [cloudUser]);

  const sendChatMessage = async (
    rawText: string,
    gif?: { url: string; title?: string },
    imageOverride?: CompressedImageResult | null
  ) => {
    if (!cloudUser || isSending) return;
    const text = rawText.trim();
    const validGif = gif && isAllowedKlipyUrl(gif.url) ? gif : undefined;
    const imageToSend = imageOverride !== undefined ? imageOverride : pendingImage;
    if (!text && !validGif && !imageToSend) return;

    // Prevent sending DM to a user you have blocked
    if (activeChannel.startsWith("dm:")) {
      const partner = getDmPartnerName(activeChannel, cloudUser);
      if (isUserBlocked(partner)) {
        notifyToast(`unblock ${partner} before sending a direct message`, "error");
        return;
      }
    }

    setIsSending(true);
    try {
      if (text) {
        const modResult = await moderateChatMessage(text);
        if (modResult.blocked) {
          notifyToast(modResult.reason || "message blocked by openai moderation", "error");
          setIsSending(false);
          return;
        }
      }

      let uploadedImageMeta: { imageUrl: string; imageName: string } | null = null;
      if (imageToSend) {
        try {
          const uploaded = await uploadChatImage(imageToSend.dataUrl, imageToSend.name);
          uploadedImageMeta = {
            imageUrl: uploaded.imageUrl,
            imageName: uploaded.imageName,
          };
          if (imageOverride === undefined) setPendingImage(null);
        } catch (err: any) {
          const status = Number(err?.status) || 0;
          const isTransient = status === 0 || status === 408 || status === 429 || status >= 500;
          // Fall back to bounded inline data URL only on transient/network server failure,
          // never bypassing explicit 4xx auth, validation, or quota rejections.
          if (isTransient && isAllowedChatImageUrl(imageToSend.dataUrl)) {
            uploadedImageMeta = {
              imageUrl: imageToSend.dataUrl,
              imageName: imageToSend.name,
            };
            if (imageOverride === undefined) setPendingImage(null);
          } else {
            notifyToast(err?.message || "image upload failed", "error");
            setIsSending(false);
            return;
          }
        }
      }

      const recipient = activeChannel.startsWith("dm:")
        ? getDmPartnerName(activeChannel, cloudUser)
        : null;

      const activeReply = replyingTo;
      const newMsg: ChatMessage = {
        id: "msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        author: cloudUser,
        avatarColor: stringToColor(cloudUser),
        role: selfRole,
        customization: editingCustom,
        text,
        ...(validGif
          ? { gifUrl: validGif.url, gifTitle: validGif.title || "GIF" }
          : {}),
        ...(uploadedImageMeta
          ? {
              imageUrl: uploadedImageMeta.imageUrl,
              imageName: uploadedImageMeta.imageName,
            }
          : {}),
        ...(activeReply
          ? {
              replyTo: {
                id: activeReply.id,
                author: activeReply.author,
                text: (activeReply.text || "").slice(0, 200),
                hasGif: Boolean(activeReply.gifUrl),
                hasImage: Boolean(activeReply.imageUrl),
              },
            }
          : {}),
        timestamp: formatClockTime(new Date()),
        channel: activeChannel,
        recipient,
      };

      pendingMessageIdsRef.current.add(newMsg.id);
      ingestIncomingMessage(newMsg);
      if (text) setInputText("");
      if (activeReply) setReplyingTo(null);
      if (validGif) setShowGifPicker(false);
      setShowEmojiPicker(false);

      try {
        broadcastRef.current?.postMessage({ type: "NEW_MESSAGE", message: newMsg });
      } catch {}

      // Also broadcast via server SSE endpoint if available
      let sendToken = "";
      try { sendToken = localStorage.getItem("auth_token") || ""; } catch {}
      const deviceSig = await getDeviceSignature();
      fetch("/api/chat/send", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(sendToken ? { Authorization: `Bearer ${sendToken}` } : {}),
        },
        body: JSON.stringify({
          message: newMsg,
          fingerprint_id: deviceSig.fingerprint_id,
          storage_token: deviceSig.storage_token,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            pendingMessageIdsRef.current.delete(newMsg.id);
            filterMessagesLocally((m) => m.id !== newMsg.id);
            const errData = await res.json().catch(() => null);
            if (errData?.timedOut && errData.until !== undefined) {
              setSelfTimeout({ until: Number(errData.until) });
            }
            if (typeof errData?.probationRemainingMs === "number" && errData.probationRemainingMs > 0) {
              setSelfCreatedAt(String(Date.now() - (10 * 60 * 1000 - errData.probationRemainingMs)));
            }
            if (errData?.error) {
              notifyToast(errData.error, "error");
            }
          } else {
            window.setTimeout(() => {
              pendingMessageIdsRef.current.delete(newMsg.id);
            }, 15000);
            const okData = await res.json().catch(() => null);
            if (okData?.message) {
              ingestIncomingMessage(okData.message);
            }
          }
        })
        .catch(() => {
          window.setTimeout(() => {
            pendingMessageIdsRef.current.delete(newMsg.id);
          }, 15000);
        });
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = useCallback(
    async (msg: ChatMessage) => {
      if (!cloudUser) return;
      let token = "";
      try { token = localStorage.getItem("auth_token") || ""; } catch {}
      if (!token) return;
      try {
        const res = await fetch("/api/chat/mod/delete-message", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messageId: msg.id,
            channel: msg.channel,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not delete message", "error");
          return;
        }
        filterMessagesLocally((m) => m.id !== msg.id);
        if (replyingTo?.id === msg.id) setReplyingTo(null);
        if (editingMessageId === msg.id) setEditingMessageId(null);
        try {
          broadcastRef.current?.postMessage({ type: "MESSAGE_DELETED", messageId: msg.id });
        } catch {}
        notifyToast("message deleted", "success");
      } catch {
        notifyToast("failed to delete message", "error");
      }
    },
    [cloudUser, filterMessagesLocally, replyingTo, editingMessageId]
  );

  const handleStartEditMessage = useCallback((msg: ChatMessage) => {
    setEditingMessageId(msg.id);
    setEditingMessageText(msg.text || "");
  }, []);

  const handleSaveEditMessage = useCallback(
    async (msg: ChatMessage) => {
      if (!cloudUser || savingEdit) return;
      const cleanText = editingMessageText.trim();
      if (!cleanText && !msg.gifUrl && !msg.imageUrl) {
        notifyToast("message cannot be empty (use delete instead)", "error");
        return;
      }
      if (cleanText === (msg.text || "").trim()) {
        setEditingMessageId(null);
        return;
      }
      setSavingEdit(true);
      try {
        if (cleanText) {
          const modResult = await moderateChatMessage(cleanText);
          if (modResult.blocked) {
            notifyToast(modResult.reason || "edited message blocked by moderation", "error");
            return;
          }
        }
        let token = "";
        try { token = localStorage.getItem("auth_token") || ""; } catch {}
        if (!token) {
          notifyToast("sign in to edit messages", "error");
          return;
        }
        const res = await fetch("/api/chat/edit", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ messageId: msg.id, text: cleanText }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not edit message", "error");
          return;
        }
        const editedAt = Number(data.message?.editedAt) || Date.now();
        updateMessageLocally(msg.id, (m) => ({
          ...m,
          text: cleanText,
          edited: true,
          editedAt,
        }));
        try {
          broadcastRef.current?.postMessage({
            type: "MESSAGE_EDITED",
            messageId: msg.id,
            text: cleanText,
            editedAt,
          });
        } catch {}
        setEditingMessageId(null);
        notifyToast("message updated", "success");
      } catch {
        notifyToast("failed to edit message", "error");
      } finally {
        setSavingEdit(false);
      }
    },
    [cloudUser, savingEdit, editingMessageText, updateMessageLocally]
  );

  const handleDeleteChat = useCallback(
    async (channelId: string) => {
      if (!cloudUser || !channelId) return;
      let token = "";
      try { token = localStorage.getItem("auth_token") || ""; } catch {}
      if (!token) return;
      try {
        const res = await fetch("/api/chat/delete-chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ channel: channelId }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not delete chat", "error");
          return;
        }
        filterMessagesLocally((m) => m.channel !== channelId);
        try {
          broadcastRef.current?.postMessage({ type: "CHANNEL_CLEARED", channel: channelId });
        } catch {}
        if (channelId.startsWith("dm:")) {
          const partnerLower = getDmPartnerName(channelId, cloudUser).toLowerCase();
          setDmPeers((prev) => {
            const next = prev.filter((p) => p.toLowerCase() !== partnerLower);
            try {
              localStorage.setItem("cookie_chat_dm_peers_v1", JSON.stringify(next));
            } catch {}
            return next;
          });
          setUnreadCounts((prev) => {
            if (!prev[channelId]) return prev;
            const copy = { ...prev };
            delete copy[channelId];
            return copy;
          });
          if (activeChannel === channelId) {
            setActiveChannel("general");
          }
          notifyToast("direct message chat deleted", "success");
        } else if (channelId.startsWith("group:")) {
          setChatGroups((prev) => prev.filter((g) => g.id !== channelId));
          setUnreadCounts((prev) => {
            if (!prev[channelId]) return prev;
            const copy = { ...prev };
            delete copy[channelId];
            return copy;
          });
          if (activeChannel === channelId) {
            setActiveChannel("general");
          }
          notifyToast("group chat deleted", "success");
        } else {
          notifyToast(`cleared #${channelId} chat history`, "success");
        }
        setConfirmDeleteChat(null);
      } catch {
        notifyToast("failed to delete chat", "error");
      }
    },
    [cloudUser, activeChannel, filterMessagesLocally]
  );

  const handleToggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!cloudUser) {
        notifyToast("sign in to cloudsync to react to messages", "error");
        return;
      }
      const userLower = cloudUser.toLowerCase();
      setReactingMessageId(null);
      setReactPickerMessageId(null);

      // Optimistic toggle
      updateMessageLocally(messageId, (m) => {
        const nextR: Record<string, string[]> = { ...(m.reactions || {}) };
        const arr = Array.isArray(nextR[emoji]) ? [...nextR[emoji]] : [];
        const i = arr.indexOf(userLower);
        if (i >= 0) {
          arr.splice(i, 1);
          if (arr.length === 0) delete nextR[emoji];
          else nextR[emoji] = arr;
        } else {
          arr.push(userLower);
          nextR[emoji] = arr;
        }
        return { ...m, reactions: nextR };
      });

      let token = "";
      try { token = localStorage.getItem("auth_token") || ""; } catch {}
      try {
        const res = await fetch("/api/chat/react", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ messageId, emoji }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not update reaction", "error");
          return;
        }
        if (data.reactions) {
          updateMessageLocally(messageId, (m) => ({ ...m, reactions: data.reactions }));
          try {
            broadcastRef.current?.postMessage({
              type: "MESSAGE_REACTED",
              messageId,
              reactions: data.reactions,
            });
          } catch {}
        }
      } catch {}
    },
    [cloudUser, updateMessageLocally]
  );

  const handleToggleReactMenu = useCallback((msgId: string) => {
    setReactPickerMessageId(null);
    setReactingMessageId((cur) => (cur === msgId ? null : msgId));
  }, []);

  const handleOpenReactPicker = useCallback((msgId: string) => {
    setReactingMessageId(null);
    setReactPickerMessageId(msgId);
  }, []);

  const handleCloseReactPicker = useCallback(() => {
    setReactPickerMessageId(null);
  }, []);

  const handleOpenImageLightbox = useCallback((url: string, name?: string | undefined) => {
    setLightboxImage({ url, name });
  }, []);

  const handleCancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  const handleReplyMessage = useCallback((msg: ChatMessage) => {
    setReplyingTo(msg);
    window.setTimeout(() => chatInputRef.current?.focus(), 20);
  }, []);

  const channelMessagesRef = useRef<ChatMessage[]>([]);

  const scrollToMessage = useCallback((msgId: string) => {
    const existingEl = document.getElementById(`chat-msg-${msgId}`);
    if (existingEl) {
      existingEl.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMsgId(msgId);
      window.setTimeout(() => {
        setHighlightedMsgId((cur) => (cur === msgId ? null : cur));
      }, 1600);
      return;
    }

    if (chromebookModeRef.current) {
      const idx = channelMessagesRef.current.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        const needed = channelMessagesRef.current.length - idx + 10;
        setMsgRenderLimit((cur) => Math.max(cur, needed));
        requestAnimationFrame(() => {
          const revealed = document.getElementById(`chat-msg-${msgId}`);
          if (revealed) {
            revealed.scrollIntoView({ behavior: "smooth", block: "center" });
            setHighlightedMsgId(msgId);
            window.setTimeout(() => {
              setHighlightedMsgId((cur) => (cur === msgId ? null : cur));
            }, 1600);
          }
        });
        return;
      }
    }

    notifyToast("original message is no longer in chat history", "info");
  }, []);

  const refreshViewingUserStaffAudit = useCallback(async (targetUsername: string) => {
    const lower = targetUsername.trim().toLowerCase();
    if (!lower || viewingProfileRef.current?.toLowerCase() !== lower) return;
    try {
      const [notesRes, logsRes] = await Promise.all([
        fetch(`/api/chat/mod/notes?username=${encodeURIComponent(targetUsername)}`, {
          cache: "no-store",
          headers: buildModAuthHeaders(),
        }),
        fetch(`/api/chat/mod/logs?username=${encodeURIComponent(targetUsername)}&limit=60`, {
          cache: "no-store",
          headers: buildModAuthHeaders(),
        }),
      ]);
      const notesJson = notesRes.ok ? await notesRes.json().catch(() => null) : null;
      const logsJson = logsRes.ok ? await logsRes.json().catch(() => null) : null;
      if (viewingProfileRef.current?.toLowerCase() !== lower) return;
      setProfileData((prev) =>
        prev && prev.username.toLowerCase() === lower
          ? {
              ...prev,
              ...(Array.isArray(notesJson?.notes) ? { staffNotes: notesJson.notes } : {}),
              ...(Array.isArray(logsJson?.logs) ? { staffLogs: logsJson.logs } : {}),
            }
          : prev
      );
    } catch {}
  }, []);

  const handleAddProfileStaffNote = useCallback(
    async (targetUsername: string) => {
      const cleanNote = profileNoteDraft.trim();
      if (!targetUsername || !cleanNote || savingProfileNote) return;
      setSavingProfileNote(true);
      try {
        const res = await fetch("/api/chat/mod/notes", {
          method: "POST",
          headers: buildModAuthHeaders(),
          body: JSON.stringify({
            username: targetUsername,
            note: cleanNote,
            category: profileNoteCategory,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not save staff note", "error");
          return;
        }
        setProfileNoteDraft("");
        const targetLower = targetUsername.toLowerCase();
        setProfileData((prev) =>
          prev &&
          prev.username.toLowerCase() === targetLower &&
          viewingProfileRef.current?.toLowerCase() === targetLower
            ? {
                ...prev,
                staffNotes: Array.isArray(data.notes) ? data.notes : prev.staffNotes,
                staffLogs: Array.isArray(data.userLogs) ? data.userLogs : prev.staffLogs,
              }
            : prev
        );
        notifyToast(`saved private note on @${targetUsername}`, "success");
      } catch {
        notifyToast("failed to save staff note", "error");
      } finally {
        setSavingProfileNote(false);
      }
    },
    [profileNoteDraft, profileNoteCategory, savingProfileNote]
  );

  const handleDeleteProfileStaffNote = useCallback(
    async (noteId: string, targetUsername: string) => {
      if (!noteId || !targetUsername) return;
      try {
        const res = await fetch(
          `/api/chat/mod/notes/${encodeURIComponent(noteId)}?username=${encodeURIComponent(
            targetUsername
          )}`,
          {
            method: "DELETE",
            headers: buildModAuthHeaders(),
          }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not remove staff note", "error");
          return;
        }
        const targetLower = targetUsername.toLowerCase();
        setProfileData((prev) =>
          prev &&
          prev.username.toLowerCase() === targetLower &&
          viewingProfileRef.current?.toLowerCase() === targetLower
            ? {
                ...prev,
                staffNotes: Array.isArray(data.notes) ? data.notes : [],
                staffLogs: Array.isArray(data.userLogs) ? data.userLogs : prev.staffLogs,
              }
            : prev
        );
        notifyToast("removed staff note", "success");
      } catch {
        notifyToast("failed to remove staff note", "error");
      }
    },
    []
  );

  const handleTimeoutUser = useCallback(
    async (targetUsername: string, durationMinutes: number) => {
      if (!targetUsername) return;
      const headers = buildModAuthHeaders();
      if (!headers.Authorization && !headers["x-admin-key"]) return;
      try {
        const res = await fetch("/api/chat/mod/timeout", {
          method: "POST",
          headers,
          body: JSON.stringify({
            username: targetUsername,
            durationMinutes,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not update timeout", "error");
          return;
        }
        setProfileData((prev) =>
          prev &&
          prev.username.toLowerCase() === targetUsername.toLowerCase() &&
          viewingProfileRef.current?.toLowerCase() === targetUsername.toLowerCase()
            ? {
                ...prev,
                isTimedOut: durationMinutes > 0,
                timeoutUntil: data.until || 0,
                ...(Array.isArray(data.userLogs) ? { staffLogs: data.userLogs } : {}),
              }
            : prev
        );
        notifyToast(
          durationMinutes > 0
            ? `muted @${targetUsername} (${durationMinutes >= 525600 ? "permanent" : `${durationMinutes}m`})`
            : `unmuted @${targetUsername}`,
          "success"
        );
      } catch {
        notifyToast("moderation request failed", "error");
      }
    },
    []
  );

  const handlePurgeUserMessages = useCallback(
    async (targetUsername: string) => {
      if (!targetUsername) return;
      const headers = buildModAuthHeaders();
      if (!headers.Authorization && !headers["x-admin-key"]) return;
      try {
        const res = await fetch("/api/chat/mod/clear-channel", {
          method: "POST",
          headers,
          body: JSON.stringify({
            channel: activeChannel,
            targetUsername,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not purge messages", "error");
          return;
        }
        const lower = targetUsername.toLowerCase();
        filterMessagesLocally(
          (m) => !(m.channel === activeChannel && m.author.toLowerCase() === lower)
        );
        void refreshViewingUserStaffAudit(targetUsername);
        notifyToast(`cleared @${targetUsername}'s messages in #${activeChannel}`, "success");
      } catch {
        notifyToast("failed to purge messages", "error");
      }
    },
    [activeChannel, filterMessagesLocally, refreshViewingUserStaffAudit]
  );

  const goatSet = useMemo(
    () => new Set(goatUsers.map((g) => g.toLowerCase())),
    [goatUsers]
  );
  const isUserGoat = useCallback(
    (username?: string | null) => Boolean(username && goatSet.has(username.toLowerCase())),
    [goatSet]
  );

  const cookieMasterSet = useMemo(() => {
    const set = new Set(cookieMasterUsers.map((u) => u.toLowerCase()));
    if (selfIsCookieMaster && cloudUser) {
      set.add(cloudUser.trim().toLowerCase());
    }
    return set;
  }, [cookieMasterUsers, selfIsCookieMaster, cloudUser]);

  const isUserCookieMaster = useCallback(
    (username?: string | null) =>
      Boolean(username && cookieMasterSet.has(username.trim().toLowerCase())),
    [cookieMasterSet]
  );

  const handleToggleGoatUser = useCallback(
    async (targetUsername: string, granted: boolean) => {
      if (!targetUsername) return;
      const headers = buildModAuthHeaders();
      if (!headers.Authorization && !headers["x-admin-key"]) return;
      try {
        const res = await fetch("/api/chat/mod/goat", {
          method: "POST",
          headers,
          body: JSON.stringify({
            username: targetUsername,
            granted,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not update GOAT title", "error");
          return;
        }
        if (Array.isArray(data.goatUsers)) {
          setGoatUsers(data.goatUsers);
        }
        setProfileData((prev) =>
          prev &&
          prev.username.toLowerCase() === targetUsername.toLowerCase() &&
          viewingProfileRef.current?.toLowerCase() === targetUsername.toLowerCase()
            ? { ...prev, isGoat: Boolean(data.granted) }
            : prev
        );
        void refreshViewingUserStaffAudit(targetUsername);
        notifyToast(
          data.granted
            ? `awarded golden GOAT title to @${data.targetUsername || targetUsername}`
            : `removed GOAT title from @${data.targetUsername || targetUsername}`,
          "success"
        );
      } catch {
        notifyToast("GOAT update request failed", "error");
      }
    },
    [refreshViewingUserStaffAudit]
  );

  const handleSendMessage = async (e?: Event) => {
    if (e) e.preventDefault();
    if (!canTypeInActiveChannel) {
      notifyToast("only owners and mods can type in this channel", "error");
      return;
    }
    await sendChatMessage(inputText);
    awardChatMessageCoins();
  };

  const handleSendGif = async (gif: KlipyGifItem) => {
    if (!canTypeInActiveChannel) {
      notifyToast("only owners and mods can type in this channel", "error");
      return;
    }
    await sendChatMessage("", { url: gif.url, title: gif.title });
  };

  const handleOpenCloudSyncModal = () => {
    document.dispatchEvent(new CustomEvent("toggleAuthModal"));
  };

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  // Filter messages for active channel and exclude blocked authors
  const channelMessages = useMemo(
    () =>
      messages.filter(
        (m) => m.channel === activeChannel && !isUserBlocked(m.author)
      ),
    [messages, activeChannel, isUserBlocked]
  );

  // Local user's live game session (updated every 1s via nowMs)
  const myGameSession = useMemo(() => {
    void nowMs;
    return detectCurrentGameSession();
  }, [nowMs]);

  // Combine online users from current user + live server presence
  const onlineUsers = useMemo(() => {
    const map = new Map<string, OnlineUser>();
    if (cloudUser) {
      const myServerRecord = serverOnlineUsers.find(
        (u) => u.username.toLowerCase() === cloudUser.toLowerCase()
      );
      const selfIsIdle = Boolean(selfIdle) || editingCustom?.presenceStatus === "idle";
      map.set(cloudUser.toLowerCase(), {
        username: cloudUser,
        color: stringToColor(cloudUser),
        status: "online",
        isIdle: Boolean(selfIdle),
        isSelf: true,
        game: selfIsIdle ? "browsing" : myGameSession.game,
        isPlayingGame: !selfIsIdle && myGameSession.isPlayingGame,
        gameStartedAt: selfIsIdle ? 0 : myGameSession.gameStartedAt,
        bio: myServerRecord?.bio ?? editingBio,
        statusText: myServerRecord?.statusText ?? editingStatusText,
        customization: editingCustom || myServerRecord?.customization || null,
        role: (myServerRecord?.role as ChatRole) || selfRole,
        isTimedOut: Boolean(selfTimeout) || Boolean(myServerRecord?.isTimedOut),
        timeoutUntil: selfTimeout?.until || Number(myServerRecord?.timeoutUntil) || 0,
        createdAt: myServerRecord?.createdAt || null,
      });
    }
    for (const su of serverOnlineUsers) {
      if (!su || !su.username) continue;
      const k = su.username.toLowerCase();
      if (cloudUser && k === cloudUser.toLowerCase()) {
        continue;
      }
      if (!map.has(k)) {
        map.set(k, {
          username: su.username,
          color: su.color || stringToColor(su.username),
          status: "online",
          isIdle: Boolean(su.isIdle),
          game: su.game || "browsing",
          isPlayingGame: Boolean(su.isPlayingGame),
          gameStartedAt: Number(su.gameStartedAt) || 0,
          bio: su.bio || "",
          statusText: su.statusText || "",
          customization: su.customization || null,
          role: (su.role as ChatRole) || "member",
          isTimedOut: Boolean(su.isTimedOut),
          timeoutUntil: Number(su.timeoutUntil) || 0,
          createdAt: su.createdAt || null,
        });
      }
    }
    return Array.from(map.values());
  }, [
    cloudUser,
    serverOnlineUsers,
    myGameSession,
    editingBio,
    editingStatusText,
    editingCustom,
    selfRole,
    selfTimeout,
    selfIdle,
  ]);

  // Offline users: registered CloudSync users who are not currently online
  const offlineUsers = useMemo(() => {
    const onlineKeys = new Set(onlineUsers.map((u) => u.username.toLowerCase()));
    const validSet =
      registeredCloudSyncUsers.length > 0
        ? new Set(registeredCloudSyncUsers.map((u) => u.toLowerCase()))
        : null;
    const map = new Map<string, OnlineUser>();

    for (const off of serverOfflineUsers) {
      if (!off || !off.username) continue;
      const k = off.username.toLowerCase();
      if (validSet && !validSet.has(k)) continue;
      if (!onlineKeys.has(k) && !map.has(k)) {
        map.set(k, {
          username: off.username,
          color: off.color || stringToColor(off.username),
          status: "offline",
          ...(typeof off.lastSeen === "number" ? { lastSeen: off.lastSeen } : {}),
          bio: off.bio || "",
          statusText: off.statusText || "",
          customization: off.customization || null,
          role: (off.role as ChatRole) || "member",
          isTimedOut: Boolean(off.isTimedOut),
          timeoutUntil: Number(off.timeoutUntil) || 0,
          createdAt: off.createdAt || null,
        });
      }
    }

    for (const peer of dmPeers) {
      const clean = peer.trim();
      if (!clean) continue;
      const k = clean.toLowerCase();
      if (validSet && !validSet.has(k)) continue;
      if (!onlineKeys.has(k) && !map.has(k)) {
        map.set(k, {
          username: clean,
          color: stringToColor(clean),
          status: "offline",
        });
      }
    }

    return Array.from(map.values());
  }, [onlineUsers, serverOfflineUsers, dmPeers, registeredCloudSyncUsers]);

  // Fast lookup map of all known users' latest customization & roles
  const userMetaMap = useMemo(() => {
    const map = new Map<string, OnlineUser>();
    for (const u of offlineUsers) {
      map.set(u.username.toLowerCase(), u);
    }
    for (const u of onlineUsers) {
      map.set(u.username.toLowerCase(), u);
    }
    return map;
  }, [onlineUsers, offlineUsers]);

  // Active channel metadata
  const activeChannelDef = useMemo(() => {
    if (activeChannel.startsWith("group:")) {
      const grp = chatGroups.find((g) => g.id === activeChannel) || null;
      return {
        id: activeChannel,
        name: grp?.name || "group chat",
        icon: "fa-user-group",
        isDm: false,
        isGroup: true,
        isVoice: false,
        groupDef: grp,
        desc: grp
          ? `${grp.members.length} members · group chat`
          : "private group chat",
      };
    }
    if (activeChannel.startsWith("dm:")) {
      const partner = getDmPartnerName(activeChannel, cloudUser);
      const partnerOnline = onlineUsers.find(
        (u) => u.username.toLowerCase() === partner.toLowerCase()
      );
      let dmDesc = `direct message with @${partner} · offline`;
      if (partnerOnline) {
        const effStatus = getEffectivePresenceDot(
          partnerOnline.customization?.presenceStatus,
          partnerOnline.isIdle
        );
        const labelStatus =
          effStatus === "dnd" ? "do not disturb" : effStatus === "idle" ? "idle" : "online";
        if (effStatus !== "idle" && !partnerOnline.isIdle && partnerOnline.isPlayingGame && partnerOnline.game) {
          dmDesc = `@${partner} is ${labelStatus} · playing ${partnerOnline.game} (${formatElapsedDuration(
            partnerOnline.gameStartedAt,
            nowMs
          )})`;
        } else {
          dmDesc = `@${partner} is ${labelStatus} · browsing`;
        }
      }
      return {
        id: activeChannel,
        name: partner,
        icon: "fa-at",
        isDm: true,
        isGroup: false,
        isVoice: false,
        groupDef: null as ChatGroupDef | null,
        desc: dmDesc,
      };
    }
    const voiceFound = VOICE_CHANNELS.find((v) => v.id === activeChannel);
    if (voiceFound) {
      return {
        ...voiceFound,
        isDm: false,
        isGroup: false,
        isVoice: true,
        groupDef: null as ChatGroupDef | null,
        desc: `voice & text lounge · ${voiceFound.name}`,
      };
    }
    const foundTextChannel = chatChannels.find((c) => c.id === activeChannel);
    if (foundTextChannel) {
      return {
        ...foundTextChannel,
        isDm: false,
        isGroup: false,
        isVoice: false,
        groupDef: null as ChatGroupDef | null,
        desc:
          foundTextChannel.visibility === "staff"
            ? "staff-only channel · owners & mods"
            : foundTextChannel.writeAccess === "staff"
            ? "read-only · owners & mods post here"
            : "",
      };
    }
    return {
      id: activeChannel,
      name: activeChannel,
      icon: "fa-hashtag",
      isDm: false,
      isGroup: false,
      isVoice: false,
      groupDef: null as ChatGroupDef | null,
      desc: "",
    };
  }, [activeChannel, cloudUser, onlineUsers, chatGroups, chatChannels, nowMs]);

  const isStaffUser = Boolean(cloudUser && (selfRole === "owner" || selfRole === "mod"));
  const selfCreatedAtMs = useMemo(() => {
    if (!selfCreatedAt) return 0;
    const num = Number(selfCreatedAt);
    if (Number.isFinite(num) && num > 0) return num;
    const parsed = Date.parse(String(selfCreatedAt));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [selfCreatedAt]);
  const probationRemainingMs =
    !isStaffUser && selfCreatedAtMs > 0
      ? Math.max(0, 10 * 60 * 1000 - (nowMs - selfCreatedAtMs))
      : 0;

  useEffect(() => {
    if (!isOpen || probationRemainingMs <= 0) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isOpen, probationRemainingMs > 0]);

  const handleDeviceBanUser = useCallback(
    async (targetUsername: string, unban = false) => {
      if (!isStaffUser) return;
      try {
        const res = await fetch("/api/chat/mod/ban-device", {
          method: "POST",
          headers: buildModAuthHeaders(),
          body: JSON.stringify({
            username: targetUsername,
            action: unban ? "unban" : "ban",
            reason: unban ? "unbanned by staff" : "device & shadowban by staff",
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "failed to update device ban", "error");
          return;
        }
        setProfileData((prev) =>
          prev && prev.username.toLowerCase() === targetUsername.toLowerCase()
            ? { ...prev, isShadowbanned: Boolean(data.isShadowbanned) }
            : prev
        );
        void refreshViewingUserStaffAudit(targetUsername);
        notifyToast(
          unban
            ? `removed shadowban & device ban from @${targetUsername}`
            : `device-banned & shadowbanned @${targetUsername}`,
          "success"
        );
      } catch {
        notifyToast("device ban request failed", "error");
      }
    },
    [isStaffUser, refreshViewingUserStaffAudit]
  );
  const visibleChannels = useMemo(
    () => chatChannels.filter((c) => c.visibility !== "staff" || isStaffUser),
    [chatChannels, isStaffUser]
  );
  const visibleCategories = useMemo(() => {
    const map = new Map<string, { id: string; label: string; channels: ChatChannelDef[] }>();
    for (const ch of visibleChannels) {
      const catId = ch.categoryId || "social";
      const catLabel = ch.categoryLabel || catId;
      let bucket = map.get(catId);
      if (!bucket) {
        bucket = { id: catId, label: catLabel, channels: [] };
        map.set(catId, bucket);
      }
      bucket.channels.push(ch);
    }
    return Array.from(map.values());
  }, [visibleChannels]);

  const activeChannelCfg = useMemo(
    () => chatChannels.find((c) => c.id === activeChannel) || null,
    [chatChannels, activeChannel]
  );
  const canTypeInActiveChannel = useMemo(() => {
    if (activeChannelDef.isDm || activeChannelDef.isGroup || activeChannelDef.isVoice) return true;
    if (!activeChannelCfg) return true;
    if (activeChannelCfg.visibility === "staff" && !isStaffUser) return false;
    if (activeChannelCfg.writeAccess === "staff" && !isStaffUser) return false;
    return true;
  }, [activeChannelDef, activeChannelCfg, isStaffUser]);

  useEffect(() => {
    if (
      !activeChannel.startsWith("dm:") &&
      !activeChannel.startsWith("group:") &&
      !activeChannel.startsWith("voice:")
    ) {
      const stillVisible = visibleChannels.some((c) => c.id === activeChannel);
      if (!stillVisible && visibleChannels.length > 0) {
        setActiveChannel(
          visibleChannels.find((c) => c.id === "general")?.id ||
            visibleChannels[0]?.id ||
            "general"
        );
      }
    }
  }, [activeChannel, visibleChannels]);

  const openCreateChannelModal = useCallback(() => {
    setEditingChannelId(null);
    setChName("");
    setChCategory("social");
    setChIcon("fa-hashtag");
    setChVisibility("all");
    setChWriteAccess("all");
    setChannelEditorOpen(true);
  }, []);

  const openEditChannelModal = useCallback((ch: ChatChannelDef) => {
    setEditingChannelId(ch.id);
    setChName(ch.name);
    setChCategory(ch.categoryLabel || ch.categoryId || "social");
    setChIcon(ch.icon || "fa-hashtag");
    setChVisibility(ch.visibility === "staff" ? "staff" : "all");
    setChWriteAccess(ch.writeAccess === "staff" ? "staff" : "all");
    setChannelEditorOpen(true);
  }, []);

  const handleSaveChannel = useCallback(
    async (e: Event) => {
      e.preventDefault();
      if (!cloudUser || !isStaffUser || savingChannel) return;
      const cleanName = chName.trim().toLowerCase();
      if (cleanName.length < 2) {
        notifyToast("channel name must be at least 2 characters", "error");
        return;
      }
      setSavingChannel(true);
      try {
        let token = "";
        try {
          token = localStorage.getItem("auth_token") || "";
        } catch {}
        const endpoint = editingChannelId
          ? "/api/chat/channels/edit"
          : "/api/chat/channels/create";
        const res = await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            ...(editingChannelId ? { id: editingChannelId } : {}),
            name: cleanName,
            categoryLabel: chCategory.trim().toLowerCase() || "social",
            icon: chIcon,
            visibility: chVisibility,
            writeAccess: chWriteAccess,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not save channel", "error");
          return;
        }
        setChannelEditorOpen(false);
        fetchChatStateRef.current?.(true);
        if (!editingChannelId && data.channel?.id) {
          setActiveChannel(data.channel.id);
        }
        notifyToast(
          editingChannelId ? `updated #${data.channel?.name || cleanName}` : `created #${cleanName}`,
          "success"
        );
      } catch {
        notifyToast("failed to save channel", "error");
      } finally {
        setSavingChannel(false);
      }
    },
    [
      cloudUser,
      isStaffUser,
      savingChannel,
      chName,
      chCategory,
      chIcon,
      chVisibility,
      chWriteAccess,
      editingChannelId,
    ]
  );

  const handleDeleteChannel = useCallback(async () => {
    if (!editingChannelId || editingChannelId === "general" || savingChannel) return;
    setSavingChannel(true);
    try {
      let token = "";
      try {
        token = localStorage.getItem("auth_token") || "";
      } catch {}
      const res = await fetch("/api/chat/channels/delete", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: editingChannelId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notifyToast(data?.error || "could not delete channel", "error");
        return;
      }
      setChannelEditorOpen(false);
      if (activeChannel === editingChannelId) setActiveChannel("general");
      fetchChatStateRef.current?.(true);
      notifyToast("channel deleted", "success");
    } catch {
      notifyToast("failed to delete channel", "error");
    } finally {
      setSavingChannel(false);
    }
  }, [editingChannelId, savingChannel, activeChannel]);

  const currentDmPartner = activeChannelDef.isDm ? activeChannelDef.name : null;
  const isCurrentDmBlocked = currentDmPartner ? isUserBlocked(currentDmPartner) : false;

  // Determine if we should show the Voice Stage in the center column
  const stageVoiceRoomId = activeChannelDef.isVoice
    ? activeChannelDef.id
    : activeVoiceRoom && activeVoiceRoom === `voice:${activeChannel}`
    ? activeVoiceRoom
    : null;

  const stageParticipants = stageVoiceRoomId ? voiceRooms[stageVoiceRoomId] || [] : [];

  channelMessagesRef.current = channelMessages;
  const hasHiddenOlderMessages = chromebookMode && channelMessages.length > msgRenderLimit;
  const renderedMessages = hasHiddenOlderMessages
    ? channelMessages.slice(-msgRenderLimit)
    : channelMessages;

  if (chromebookMode && !isOpen) {
    return null;
  }

  return (
    <div
      class={`chat-modal-overlay ${isOpen ? "open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false);
      }}
    >
      <div class="chat-app-window">
        {/* ── COLUMN 1: Channels, Voice & Direct Messages Sidebar ── */}
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <div class="chat-sidebar-brand">
              <i class="fa-solid fa-comments"></i>
              <span>chatroom</span>
            </div>
            {isStaffUser && (
              <button
                type="button"
                class="chat-category-add-btn"
                title="Create new channel"
                aria-label="Create new channel"
                onClick={openCreateChannelModal}
              >
                <i class="fa-solid fa-plus"></i>
              </button>
            )}
          </div>

          <div class="chat-sidebar-scroll">
            {/* Text Channel Categories */}
            {visibleCategories.map((cat) => {
              const isCollapsed = !!collapsedCategories[cat.id];
              return (
                <div key={cat.id} class="chat-category">
                  <div
                    class="chat-category-title"
                    onClick={() => toggleCategory(cat.id)}
                  >
                    <div class="chat-category-title-left">
                      <span
                        class="chat-category-chevron"
                        style={{
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                        }}
                      >
                        ▼
                      </span>
                      <span>{cat.label}</span>
                    </div>
                  </div>

                  {!isCollapsed &&
                    cat.channels.map((ch) => {
                      const unread = unreadCounts[ch.id] || 0;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          class={`chat-channel-item ${activeChannel === ch.id ? "active" : ""}`}
                          onClick={() => setActiveChannel(ch.id)}
                        >
                          <div class="chat-channel-item-left">
                            <i class={`fa-solid ${ch.icon} chat-channel-prefix`}></i>
                            <span>{ch.name}</span>
                            {ch.visibility === "staff" ? (
                              <i
                                class="fa-solid fa-eye-slash"
                                title="Staff-only visibility (owners & mods)"
                                style={{ fontSize: "10px", opacity: 0.7, marginLeft: "4px" }}
                              ></i>
                            ) : ch.writeAccess === "staff" ? (
                              <i
                                class="fa-solid fa-lock"
                                title="Read-only for members (owners & mods can type)"
                                style={{ fontSize: "10px", opacity: 0.65, marginLeft: "4px" }}
                              ></i>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {unread > 0 && <span class="chat-unread-badge">{unread}</span>}
                            {isStaffUser && (
                              <span
                                role="button"
                                tabIndex={0}
                                title={`Edit #${ch.name}`}
                                aria-label={`Edit #${ch.name}`}
                                class="chat-channel-edit-icon"
                                style={{
                                  fontSize: "11px",
                                  opacity: 0.65,
                                  padding: "2px 4px",
                                  borderRadius: "4px",
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditChannelModal(ch);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openEditChannelModal(ch);
                                  }
                                }}
                              >
                                <i class="fa-solid fa-gear"></i>
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>
              );
            })}

            {/* Voice Channels Category */}
            <div class="chat-category">
              <div
                class="chat-category-title"
                onClick={() => toggleCategory("voice")}
              >
                <div class="chat-category-title-left">
                  <span
                    class="chat-category-chevron"
                    style={{
                      transform: collapsedCategories["voice"]
                        ? "rotate(-90deg)"
                        : "rotate(0deg)",
                    }}
                  >
                    ▼
                  </span>
                  <span>voice channels</span>
                </div>
              </div>

              {!collapsedCategories["voice"] &&
                VOICE_CHANNELS.map((vc) => {
                  const members = voiceRooms[vc.id] || [];
                  const isConnectedHere = activeVoiceRoom === vc.id;
                  return (
                    <div key={vc.id}>
                      <button
                        type="button"
                        class={`chat-channel-item ${
                          activeChannel === vc.id || isConnectedHere ? "active" : ""
                        }`}
                        onClick={() => {
                          setActiveChannel(vc.id);
                          if (!isConnectedHere) {
                            joinVoiceRoom(vc.id);
                          }
                        }}
                      >
                        <div class="chat-channel-item-left">
                          <i
                            class={`fa-solid ${vc.icon} chat-channel-prefix`}
                            style={isConnectedHere ? { color: "#4ade80" } : undefined}
                          ></i>
                          <span>{vc.name}</span>
                        </div>
                        {members.length > 0 && (
                          <span class="chat-voice-count-badge">{members.length}</span>
                        )}
                      </button>

                      {members.length > 0 && (
                        <div class="chat-voice-sidebar-members">
                          {members.map((m) => {
                            const isSpeaking = !!speakingMap[m.clientId];
                            const vMeta = userMetaMap.get(m.username.toLowerCase());
                            return (
                              <div key={m.clientId} class="chat-voice-sidebar-member">
                                <UserAvatar
                                  username={m.username}
                                  custom={vMeta?.customization}
                                  fallbackColor={m.avatarColor}
                                  className={`chat-voice-sidebar-avatar ${
                                    isSpeaking ? "speaking" : ""
                                  }`}
                                />
                                <span
                                  class={getNameClasses(vMeta?.customization)}
                                  style={{ flex: 1 }}
                                >
                                  {vMeta?.customization?.displayName || m.username}
                                </span>
                                {m.deafened && (
                                  <i
                                    class="fa-solid fa-volume-xmark"
                                    title="Deafened"
                                    style={{ fontSize: "10px", color: "#f87171" }}
                                  ></i>
                                )}
                                {m.muted && (
                                  <i
                                    class="fa-solid fa-microphone-slash"
                                    title="Muted"
                                    style={{ fontSize: "10px", color: "#f87171" }}
                                  ></i>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Group Chats Category */}
            {cloudUser && (
              <div class="chat-category">
                <div class="chat-category-title">
                  <div
                    class="chat-category-title-left"
                    onClick={() => toggleCategory("groups")}
                  >
                    <span
                      class="chat-category-chevron"
                      style={{
                        transform: collapsedCategories["groups"]
                          ? "rotate(-90deg)"
                          : "rotate(0deg)",
                      }}
                    >
                      ▼
                    </span>
                    <span>group chats</span>
                  </div>
                  <i
                    class="fa-solid fa-plus"
                    title="Create group chat"
                    onClick={() => setGroupModalMode("create")}
                  ></i>
                </div>

                {!collapsedCategories["groups"] &&
                  (chatGroups.length === 0 ? (
                    <div
                      style={{
                        padding: "4px 10px",
                        fontSize: "11px",
                        color: "var(--color-sublabel)",
                      }}
                    >
                      click + to start a group
                    </div>
                  ) : (
                    chatGroups.map((grp) => {
                      const unread = unreadCounts[grp.id] || 0;
                      return (
                        <button
                          key={grp.id}
                          type="button"
                          class={`chat-channel-item ${activeChannel === grp.id ? "active" : ""}`}
                          onClick={() => setActiveChannel(grp.id)}
                        >
                          <div class="chat-channel-item-left">
                            <i class="fa-solid fa-user-group chat-channel-prefix"></i>
                            <span>{grp.name}</span>
                          </div>
                          {unread > 0 ? (
                            <span class="chat-unread-badge">{unread}</span>
                          ) : (
                            <span class="chat-group-count">{grp.members.length}</span>
                          )}
                        </button>
                      );
                    })
                  ))}
              </div>
            )}

            {/* Direct Messages Category */}
            <div class="chat-category">
              <div class="chat-category-title">
                <div
                  class="chat-category-title-left"
                  onClick={() => toggleCategory("dms")}
                >
                  <span
                    class="chat-category-chevron"
                    style={{
                      transform: collapsedCategories["dms"]
                        ? "rotate(-90deg)"
                        : "rotate(0deg)",
                    }}
                  >
                    ▼
                  </span>
                  <span>direct messages</span>
                </div>
                <i
                  class="fa-solid fa-plus"
                  title="New direct message"
                  onClick={() => setShowNewDmInput((p) => !p)}
                ></i>
              </div>

              {showNewDmInput && (
                <form
                  style={{ display: "flex", gap: "4px", padding: "2px 4px" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newDmTarget.trim()) {
                      openDirectMessage(newDmTarget.trim());
                      setNewDmTarget("");
                      setShowNewDmInput(false);
                    }
                  }}
                >
                  <input
                    type="text"
                    class="chat-mod-input"
                    style={{ width: "100%", padding: "4px 8px", fontSize: "11px" }}
                    placeholder="username..."
                    value={newDmTarget}
                    onInput={(e) => setNewDmTarget((e.target as HTMLInputElement).value)}
                  />
                </form>
              )}

              {!collapsedCategories["dms"] &&
                (dmPeers.length === 0 ? (
                  <div
                    style={{
                      padding: "4px 10px",
                      fontSize: "11px",
                      color: "var(--color-sublabel)",
                    }}
                  >
                    click any user to dm
                  </div>
                ) : (
                  dmPeers.map((peer) => {
                    const dmId = makeDmChannelId(cloudUser || "guest", peer);
                    const unread = unreadCounts[dmId] || 0;
                    const blocked = isUserBlocked(peer);
                    return (
                      <div key={dmId} class="chat-dm-row-wrap">
                        <button
                          type="button"
                          class={`chat-channel-item ${activeChannel === dmId ? "active" : ""}`}
                          onClick={() => setActiveChannel(dmId)}
                        >
                          <div class="chat-channel-item-left">
                            <i class="fa-solid fa-at chat-channel-prefix"></i>
                            <span
                              style={
                                blocked
                                  ? { textDecoration: "line-through", opacity: 0.6 }
                                  : undefined
                              }
                            >
                              {peer}
                            </span>
                          </div>
                          {unread > 0 && !blocked && (
                            <span class="chat-unread-badge">{unread}</span>
                          )}
                        </button>
                        {cloudUser && (
                          <button
                            type="button"
                            class="chat-dm-delete-btn"
                            title={`Delete chat with @${peer}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveChannel(dmId);
                              setConfirmDeleteChat(dmId);
                            }}
                          >
                            <i class="fa-solid fa-xmark"></i>
                          </button>
                        )}
                      </div>
                    );
                  })
                ))}
            </div>
          </div>

          {/* Voice Connected Bottom Control Bar */}
          {activeVoiceRoom && (
            <div class="chat-voice-status-bar">
              <div class="chat-voice-status-top">
                <div class="chat-voice-status-info">
                  <span class="chat-voice-status-title">
                    <i class="fa-solid fa-signal"></i> voice connected
                  </span>
                  <span class="chat-voice-status-room">
                    {activeVoiceRoom.replace("voice:", "")}
                  </span>
                </div>
                <button
                  type="button"
                  class="chat-user-mini-btn blocked"
                  title="Disconnect from voice"
                  onClick={leaveVoiceRoom}
                >
                  <i class="fa-solid fa-phone-slash"></i>
                </button>
              </div>
              <div class="chat-voice-controls-row">
                <button
                  type="button"
                  class={`chat-voice-ctrl-btn ${isMuted ? "active-danger" : ""}`}
                  onClick={toggleMute}
                >
                  <i
                    class={`fa-solid ${
                      isMuted ? "fa-microphone-slash" : "fa-microphone"
                    }`}
                  ></i>
                  <span>{isMuted ? "muted" : "mute"}</span>
                </button>
                <button
                  type="button"
                  class={`chat-voice-ctrl-btn ${isDeafened ? "active-danger" : ""}`}
                  onClick={toggleDeafen}
                >
                  <i
                    class={`fa-solid ${
                      isDeafened ? "fa-volume-xmark" : "fa-headphones"
                    }`}
                  ></i>
                  <span>{isDeafened ? "deafened" : "deafen"}</span>
                </button>
              </div>
            </div>
          )}

          {/* User profile footer (click to view your own profile) */}
          <div
            class="chat-sidebar-user"
            style={cloudUser ? { cursor: "pointer" } : undefined}
            title={cloudUser ? "Click to view & edit your profile" : undefined}
            onClick={() => {
              if (cloudUser) openUserProfile(cloudUser);
            }}
          >
            {cloudUser ? (
              <>
                <div class="chat-user-avatar-wrap">
                  <UserAvatar
                    username={cloudUser}
                    custom={editingCustom}
                    fallbackColor={stringToColor(cloudUser)}
                    className="chat-user-avatar"
                  />
                  {(() => {
                    const effDot = getEffectivePresenceDot(editingCustom.presenceStatus, selfIdle);
                    return <div class={`chat-user-dot ${effDot}`}></div>;
                  })()}
                </div>
                <div class="chat-sidebar-user-info">
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0 }}>
                    <span class={`chat-sidebar-username ${getNameClasses(editingCustom)}`}>
                      {editingCustom.displayName || cloudUser}
                    </span>
                    <MasterVerifiedBadge isCookieMaster={isUserCookieMaster(cloudUser)} />
                    <RoleBadge role={selfRole} />
                    <GoatBadge isGoat={isUserGoat(cloudUser)} />
                  </div>
                  <span
                    class="chat-sidebar-status"
                    style={
                      getEffectivePresenceDot(editingCustom.presenceStatus, selfIdle) === "idle"
                        ? { color: "#facc15" }
                        : getEffectivePresenceDot(editingCustom.presenceStatus, selfIdle) === "dnd"
                        ? { color: "#f87171" }
                        : undefined
                    }
                  >
                    <span style={{ fontSize: "8px" }}>●</span>{" "}
                    {editingStatusText ||
                      (editingCustom.presenceStatus === "dnd"
                        ? "do not disturb"
                        : selfIdle
                        ? "idle (auto)"
                        : editingCustom.presenceStatus || "online")}
                  </span>
                  {!selfIdle &&
                    editingCustom.presenceStatus !== "idle" &&
                    myGameSession.isPlayingGame &&
                    myGameSession.game && (
                    <div class="chat-profile-game-status" title={`Playing ${myGameSession.game}`}>
                      <i class="fa-solid fa-gamepad"></i>
                      <span>
                        playing {myGameSession.game} ·{" "}
                        {formatElapsedDuration(myGameSession.gameStartedAt, nowMs)}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  class="chat-user-mini-btn"
                  title="Customize profile"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleOpenCustomizer();
                  }}
                >
                  <i class="fa-solid fa-sliders"></i>
                </button>
              </>
            ) : (
              <button
                type="button"
                class="chat-auth-login-btn"
                style={{ width: "100%" }}
                onClick={handleOpenCloudSyncModal}
              >
                <i class="fa-solid fa-arrow-right-to-bracket"></i> sign in with cloudsync
              </button>
            )}
          </div>
        </div>

        {/* ── COLUMN 2: Center Chat Feed, Voice Stage & Input ── */}
        <div
          class={`chat-main${dragOverChat ? " is-drag-over" : ""}`}
          onDragOver={(e) => {
            if (!cloudUser) return;
            if (e.dataTransfer?.types?.includes("Files")) {
              e.preventDefault();
              setDragOverChat(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOverChat(false);
            }
          }}
          onDrop={(e) => {
            setDragOverChat(false);
            if (!cloudUser) return;
            const file = Array.from(e.dataTransfer?.files || []).find((f) =>
              f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(f.name)
            );
            if (file) {
              e.preventDefault();
              void stageChatImageFile(file);
            }
          }}
        >
          {/* Header */}
          <div class="chat-main-header">
            <div class="chat-main-header-left">
              <div
                class="chat-main-channel-name"
                style={activeChannelDef.isDm ? { cursor: "pointer" } : undefined}
                title={
                  activeChannelDef.isDm
                    ? `Click to view @${activeChannelDef.name}'s profile`
                    : undefined
                }
                onClick={() => {
                  if (activeChannelDef.isDm && currentDmPartner) {
                    openUserProfile(currentDmPartner);
                  }
                }}
              >
                <i class={`fa-solid ${activeChannelDef.icon}`}></i>
                <span>{activeChannelDef.name}</span>
              </div>
              <div class="chat-main-channel-desc">{activeChannelDef.desc}</div>
            </div>

            <div class="chat-main-header-actions">
              {/* DM Header Actions: View Profile, Voice Call & Block/Unblock */}
              {activeChannelDef.isDm && currentDmPartner && (
                <>
                  <button
                    type="button"
                    class="chat-header-btn"
                    title={`View @${currentDmPartner}'s profile`}
                    onClick={() => openUserProfile(currentDmPartner)}
                  >
                    <i class="fa-solid fa-id-card"></i>
                    <span>profile</span>
                  </button>
                  <button
                    type="button"
                    class={`chat-header-btn ${
                      activeVoiceRoom === `voice:${activeChannel}` ? "voice-active" : ""
                    }`}
                    onClick={() => {
                      const dmVoiceId = `voice:${activeChannel}`;
                      if (activeVoiceRoom === dmVoiceId) {
                        leaveVoiceRoom();
                      } else {
                        joinVoiceRoom(dmVoiceId);
                      }
                    }}
                  >
                    <i class="fa-solid fa-phone-volume"></i>
                    <span>
                      {activeVoiceRoom === `voice:${activeChannel}`
                        ? "in call"
                        : "voice call"}
                    </span>
                  </button>
                  <button
                    type="button"
                    class={`chat-header-btn ${isCurrentDmBlocked ? "danger" : ""}`}
                    onClick={() => toggleBlockUser(currentDmPartner)}
                  >
                    <i class="fa-solid fa-ban"></i>
                    <span>{isCurrentDmBlocked ? "unblock" : "block"}</span>
                  </button>
                  <button
                    type="button"
                    class="chat-header-btn danger"
                    title={`Delete chat with @${currentDmPartner}`}
                    onClick={() => setConfirmDeleteChat(activeChannel)}
                  >
                    <i class="fa-solid fa-trash-can"></i>
                    <span>delete chat</span>
                  </button>
                </>
              )}

              {/* Group Chat Header Actions */}
              {activeChannelDef.isGroup && activeChannelDef.groupDef && cloudUser && (
                <>
                  <button
                    type="button"
                    class="chat-header-btn"
                    title="View or manage group members"
                    onClick={() => setGroupModalMode("members")}
                  >
                    <i class="fa-solid fa-users"></i>
                    <span>members ({activeChannelDef.groupDef.members.length})</span>
                  </button>
                  {(activeChannelDef.groupDef.creator.toLowerCase() === cloudUser.toLowerCase() ||
                    selfRole === "owner") && (
                    <button
                      type="button"
                      class="chat-header-btn danger"
                      title={`Delete group "${activeChannelDef.name}"`}
                      onClick={() => setConfirmDeleteChat(activeChannel)}
                    >
                      <i class="fa-solid fa-trash-can"></i>
                      <span>delete group</span>
                    </button>
                  )}
                </>
              )}

              {/* Public Channel Edit & Clear Chat Actions for Owner/Mod */}
              {!activeChannelDef.isDm &&
                !activeChannelDef.isGroup &&
                !activeChannelDef.isVoice &&
                isStaffUser && (
                  <>
                    {activeChannelCfg && (
                      <button
                        type="button"
                        class="chat-header-btn"
                        title={`Edit #${activeChannelDef.name} visibility & permissions`}
                        onClick={() => openEditChannelModal(activeChannelCfg)}
                      >
                        <i class="fa-solid fa-sliders"></i>
                        <span>edit channel</span>
                      </button>
                    )}
                    <button
                      type="button"
                      class="chat-header-btn danger"
                      title={`Clear all messages in #${activeChannelDef.name}`}
                      onClick={() => setConfirmDeleteChat(activeChannel)}
                    >
                      <i class="fa-solid fa-broom"></i>
                      <span>clear chat</span>
                    </button>
                  </>
                )}

              {/* Voice Channel Header Action */}
              {activeChannelDef.isVoice && (
                <button
                  type="button"
                  class={`chat-header-btn ${
                    activeVoiceRoom === activeChannelDef.id ? "danger" : "voice-active"
                  }`}
                  onClick={() => {
                    if (activeVoiceRoom === activeChannelDef.id) {
                      leaveVoiceRoom();
                    } else {
                      joinVoiceRoom(activeChannelDef.id);
                    }
                  }}
                >
                  <i
                    class={`fa-solid ${
                      activeVoiceRoom === activeChannelDef.id
                        ? "fa-phone-slash"
                        : "fa-headset"
                    }`}
                  ></i>
                  <span>
                    {activeVoiceRoom === activeChannelDef.id
                      ? "disconnect"
                      : "join voice"}
                  </span>
                </button>
              )}

              {cloudUser && (selfRole === "owner" || selfRole === "mod") && (
                <button
                  type="button"
                  class="chat-header-btn"
                  title="Manage staff moderators & timeouts"
                  onClick={() => setShowStaffModal(true)}
                >
                  <i class="fa-solid fa-shield-halved"></i>
                  <span>staff</span>
                </button>
              )}

              {cloudUser && (
                <button
                  type="button"
                  class="chat-header-btn is-round-pill"
                  title="Customize profile, banner, avatar frame & card effects"
                  onClick={() => void handleOpenCustomizer()}
                >
                  <i class="fa-solid fa-wand-magic-sparkles"></i>
                  <span>customize</span>
                </button>
              )}

              <button
                type="button"
                class="chat-window-close"
                title="Close chat"
                onClick={() => setIsOpen(false)}
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>

          {/* Voice Stage (shown when viewing a voice channel or an active DM call) */}
          {stageVoiceRoomId && (
            <div class="chat-voice-stage">
              <div class="chat-voice-stage-header">
                <div class="chat-voice-stage-title">
                  <i class="fa-solid fa-wave-square"></i>
                  <span>
                    {stageVoiceRoomId.replace("voice:", "")} · {stageParticipants.length}{" "}
                    in voice
                  </span>
                </div>
                {activeVoiceRoom === stageVoiceRoomId ? (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      class={`chat-header-btn ${isMuted ? "danger" : ""}`}
                      onClick={toggleMute}
                    >
                      <i
                        class={`fa-solid ${
                          isMuted ? "fa-microphone-slash" : "fa-microphone"
                        }`}
                      ></i>
                      <span>{isMuted ? "unmute" : "mute"}</span>
                    </button>
                    <button
                      type="button"
                      class={`chat-header-btn ${isDeafened ? "danger" : ""}`}
                      onClick={toggleDeafen}
                    >
                      <i
                        class={`fa-solid ${
                          isDeafened ? "fa-volume-xmark" : "fa-headphones"
                        }`}
                      ></i>
                      <span>{isDeafened ? "undeafen" : "deafen"}</span>
                    </button>
                    <button
                      type="button"
                      class="chat-header-btn danger"
                      onClick={leaveVoiceRoom}
                    >
                      <i class="fa-solid fa-phone-slash"></i>
                      <span>leave</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    class="chat-header-btn voice-active"
                    onClick={() => joinVoiceRoom(stageVoiceRoomId)}
                  >
                    <i class="fa-solid fa-headset"></i>
                    <span>join voice channel</span>
                  </button>
                )}
              </div>

              {stageParticipants.length === 0 ? (
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--color-sublabel)",
                    padding: "8px 0",
                  }}
                >
                  no one is currently in this voice channel — click join voice to start talking.
                </div>
              ) : (
                <div class="chat-voice-grid">
                  {stageParticipants.map((p) => {
                    const isSpeaking = !!speakingMap[p.clientId];
                    const isMe = p.clientId === getClientId();
                    const vol = userVolumes[p.username.toLowerCase()] ?? 1;
                    const vMeta = userMetaMap.get(p.username.toLowerCase());
                    return (
                      <div
                        key={p.clientId}
                        class={`chat-voice-card ${isSpeaking ? "speaking" : ""}`}
                      >
                        <UserAvatar
                          username={p.username}
                          custom={vMeta?.customization}
                          fallbackColor={p.avatarColor}
                          className="chat-voice-card-avatar"
                          title={`View @${p.username}'s profile`}
                          onClick={() => openUserProfile(p.username)}
                        />
                        <div
                          class="chat-voice-card-name"
                          style={{ cursor: "pointer" }}
                          onClick={() => openUserProfile(p.username)}
                        >
                          <span class={getNameClasses(vMeta?.customization)}>
                            {vMeta?.customization?.displayName || p.username}
                          </span>
                          <MasterVerifiedBadge isCookieMaster={isUserCookieMaster(p.username)} />
                          <RoleBadge role={vMeta?.role} />
                          <GoatBadge isGoat={isUserGoat(p.username)} />
                          {isMe && <span class="chat-you-pill">you</span>}
                        </div>
                        <div class="chat-voice-card-badges">
                          {p.deafened ? (
                            <span style={{ color: "#f87171" }}>
                              <i class="fa-solid fa-volume-xmark"></i> deafened
                            </span>
                          ) : p.muted ? (
                            <span style={{ color: "#f87171" }}>
                              <i class="fa-solid fa-microphone-slash"></i> muted
                            </span>
                          ) : isSpeaking ? (
                            <span style={{ color: "#4ade80" }}>
                              <i class="fa-solid fa-microphone"></i> speaking
                            </span>
                          ) : (
                            <span>
                              <i class="fa-solid fa-microphone"></i> connected
                            </span>
                          )}
                        </div>
                        {!isMe && (
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={vol}
                            title={`Volume: ${Math.round(vol * 100)}%`}
                            class="chat-voice-vol-slider"
                            onInput={(e) => {
                              const v = parseFloat((e.target as HTMLInputElement).value);
                              setUserVolumes((prev) => ({
                                ...prev,
                                [p.username.toLowerCase()]: v,
                              }));
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Confirm Delete / Clear Chat Banner */}
          {confirmDeleteChat === activeChannel && (
            <div class="chat-confirm-banner">
              <span>
                <i class="fa-solid fa-triangle-exclamation" style={{ marginRight: "6px" }}></i>
                {activeChannelDef.isDm
                  ? `delete this direct message chat with @${currentDmPartner}?`
                  : activeChannelDef.isGroup
                  ? `delete group "${activeChannelDef.name}" and all its messages?`
                  : `delete all messages in #${activeChannelDef.name}?`}
              </span>
              <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                <button
                  type="button"
                  class="chat-header-btn danger"
                  onClick={() => void handleDeleteChat(activeChannel)}
                >
                  confirm delete
                </button>
                <button
                  type="button"
                  class="chat-header-btn"
                  onClick={() => setConfirmDeleteChat(null)}
                >
                  cancel
                </button>
              </div>
            </div>
          )}

          {/* Messages feed */}
          <div
            ref={chatFeedRef}
            class="chat-feed"
            onScroll={
              chromebookMode && hasHiddenOlderMessages
                ? (e) => {
                    const el = e.currentTarget;
                    const prevTopSeen = prevFeedScrollTopRef.current;
                    prevFeedScrollTopRef.current = el.scrollTop;
                    if (
                      el.scrollTop <= 24 &&
                      el.scrollTop < prevTopSeen &&
                      Date.now() > ignoreAutoExpandUntilRef.current
                    ) {
                      const prevHeight = el.scrollHeight;
                      const prevTop = el.scrollTop;
                      setMsgRenderLimit((prev) =>
                        Math.min(channelMessages.length, prev + CHROMEBOOK_MSG_STEP)
                      );
                      requestAnimationFrame(() => {
                        const feed = chatFeedRef.current;
                        if (feed) {
                          const targetTop = feed.scrollHeight - prevHeight + prevTop;
                          feed.scrollTop = targetTop;
                          prevFeedScrollTopRef.current = targetTop;
                        }
                      });
                    }
                  }
                : undefined
            }
          >
            {hasHiddenOlderMessages && (
              <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                <button
                  type="button"
                  class="chat-gif-more-btn"
                  onClick={() =>
                    setMsgRenderLimit((prev) =>
                      Math.min(channelMessages.length, prev + CHROMEBOOK_MSG_STEP)
                    )
                  }
                >
                  load older messages ({channelMessages.length - renderedMessages.length} hidden)
                </button>
              </div>
            )}
            {channelMessages.length === 0 ? (
              <div class="chat-empty-state">
                <i class={`fa-solid ${activeChannelDef.icon}`}></i>
                <p>
                  {activeChannelDef.isDm
                    ? `no messages with @${activeChannelDef.name} yet`
                    : activeChannelDef.isGroup
                    ? `no messages in ${activeChannelDef.name} yet`
                    : `no messages in #${activeChannelDef.name} yet`}
                </p>
              </div>
            ) : (
              renderedMessages.map((msg, idx) => {
                const sliceStartIdx = channelMessages.length - renderedMessages.length;
                const prevMsg =
                  idx > 0
                    ? renderedMessages[idx - 1]
                    : sliceStartIdx > 0
                    ? channelMessages[sliceStartIdx - 1]
                    : undefined;
                const isGrouped = shouldGroupMessages(prevMsg, msg);
                const isSelf = Boolean(
                  cloudUser && msg.author.toLowerCase() === cloudUser.toLowerCase()
                );
                const authorMeta = userMetaMap.get(msg.author.toLowerCase());
                const rawFallbackCustom = isStaleUninitializedCustom(msg.customization)
                  ? null
                  : msg.customization || null;
                const msgCustom = authorMeta?.customization || rawFallbackCustom;
                const safeFallbackColor =
                  msg.avatarColor &&
                  (!isStaleUninitializedCustom(msg.customization) ||
                    msg.avatarColor.toLowerCase() !== "#6366f1")
                    ? msg.avatarColor
                    : stringToColor(msg.author);
                const authorRole = authorMeta?.role || msg.role || "member";
                const canDeleteMsg = Boolean(
                  cloudUser &&
                    (isSelf ||
                      (!activeChannel.startsWith("dm:") &&
                        !activeChannel.startsWith("group:") &&
                        (selfRole === "owner" || selfRole === "mod")))
                );
                const displayName = msgCustom?.displayName?.trim() || msg.author;
                const replyRef = msg.replyTo || null;
                const replyMeta = replyRef
                  ? userMetaMap.get(replyRef.author.toLowerCase())
                  : undefined;
                const replyAuthorLabel =
                  replyMeta?.customization?.displayName?.trim() || replyRef?.author || "";
                const replyMiniCustom = replyMeta?.customization
                  ? {
                      ...replyMeta.customization,
                      avatarDecoration: "none" as const,
                      decorationUrl: "",
                    }
                  : null;
                const isEditingThis = editingMessageId === msg.id;

                return (
                  <ChatMessageRow
                    key={msg.id}
                    msg={msg}
                    isGrouped={isGrouped}
                    isSelf={isSelf}
                    msgCustom={msgCustom}
                    safeFallbackColor={safeFallbackColor}
                    authorRole={authorRole}
                    isAuthorGoat={isUserGoat(msg.author)}
                    isAuthorCookieMaster={isUserCookieMaster(msg.author)}
                    canDeleteMsg={canDeleteMsg}
                    displayName={displayName}
                    replyAuthorLabel={replyAuthorLabel}
                    replyMiniCustom={replyMiniCustom}
                    replyTextColorClass={getNameClasses(replyMeta?.customization)}
                    isHighlighted={highlightedMsgId === msg.id}
                    isEditingThis={isEditingThis}
                    editingMessageText={isEditingThis ? editingMessageText : ""}
                    savingEdit={isEditingThis ? savingEdit : false}
                    isReacting={reactingMessageId === msg.id}
                    isReactPickerOpen={reactPickerMessageId === msg.id}
                    reactPickerRef={reactPickerRef}
                    cloudUser={cloudUser}
                    canReplyOrReact={Boolean(cloudUser)}
                    onScrollToMessage={scrollToMessage}
                    onOpenUserProfile={openUserProfile}
                    onStartEditMessage={handleStartEditMessage}
                    onSaveEditMessage={handleSaveEditMessage}
                    onCancelEditMessage={handleCancelEditMessage}
                    onEditingTextChange={setEditingMessageText}
                    onToggleReaction={handleToggleReaction}
                    onToggleReactMenu={handleToggleReactMenu}
                    onOpenReactPicker={handleOpenReactPicker}
                    onCloseReactPicker={handleCloseReactPicker}
                    onReplyMessage={handleReplyMessage}
                    onOpenDirectMessage={openDirectMessage}
                    onToggleBlockUser={toggleBlockUser}
                    onDeleteMessage={handleDeleteMessage}
                    onOpenImageLightbox={handleOpenImageLightbox}
                  />
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div class="chat-input-container">
            {!cloudUser ? (
              <div class="chat-auth-locked">
                <div class="chat-auth-locked-text">
                  <i class="fa-solid fa-lock"></i>
                  <span>you must be signed into cloudsync to chat or join voice.</span>
                </div>
                <button
                  type="button"
                  class="chat-auth-login-btn"
                  onClick={handleOpenCloudSyncModal}
                >
                  sign in to cloudsync
                </button>
              </div>
            ) : isCurrentDmBlocked && currentDmPartner ? (
              <div class="chat-auth-locked">
                <div class="chat-auth-locked-text">
                  <i class="fa-solid fa-ban"></i>
                  <span>you have blocked @{currentDmPartner}.</span>
                </div>
                <button
                  type="button"
                  class="chat-auth-login-btn"
                  onClick={() => toggleBlockUser(currentDmPartner)}
                >
                  unblock user
                </button>
              </div>
            ) : selfTimeout && (selfTimeout.until === -1 || selfTimeout.until > nowMs) ? (
              <div class="chat-auth-locked">
                <div class="chat-auth-locked-text" style={{ color: "#fca5a5" }}>
                  <i class="fa-solid fa-comment-slash"></i>
                  <span>
                    you are timed out in chat (
                    {selfTimeout.until === -1 || selfTimeout.until - nowMs > 365 * 86400_000
                      ? "permanent"
                      : `${Math.max(1, Math.ceil((selfTimeout.until - nowMs) / 60000))}m remaining`}
                    ).
                  </span>
                </div>
              </div>
            ) : probationRemainingMs > 0 ? (
              <div class="chat-auth-locked">
                <div class="chat-auth-locked-text" style={{ color: "#fcd34d" }}>
                  <i class="fa-solid fa-hourglass-half"></i>
                  <span>
                    New accounts must wait{" "}
                    {Math.floor(Math.ceil(probationRemainingMs / 1000) / 60)}m{" "}
                    {Math.ceil(probationRemainingMs / 1000) % 60}s before chatting
                  </span>
                </div>
              </div>
            ) : !canTypeInActiveChannel ? (
              <div class="chat-auth-locked">
                <div class="chat-auth-locked-text">
                  <i class="fa-solid fa-lock"></i>
                  <span>only owners &amp; mods can type in #{activeChannelDef.name}.</span>
                </div>
              </div>
            ) : (
              <>
                {replyingTo && (
                  <div class="chat-replying-bar">
                    <div class="chat-replying-bar-left">
                      <i class="fa-solid fa-reply" style={{ color: "#c084fc" }}></i>
                      <span>
                        replying to{" "}
                        <strong>
                          @
                          {userMetaMap.get(replyingTo.author.toLowerCase())?.customization?.displayName?.trim() ||
                            replyingTo.author}
                        </strong>
                      </span>
                      <span class="chat-replying-bar-snippet">
                        {replyingTo.text
                          ? `— ${replyingTo.text}`
                          : replyingTo.imageUrl
                          ? "— [image]"
                          : replyingTo.gifUrl
                          ? "— [GIF]"
                          : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="chat-replying-cancel"
                      title="Cancel reply"
                      onClick={() => setReplyingTo(null)}
                    >
                      <i class="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                )}
                {pendingImage && (
                  <div class="chat-pending-image-bar">
                    <div class="chat-pending-image-left">
                      <img
                        src={pendingImage.dataUrl}
                        alt={pendingImage.name}
                        class="chat-pending-image-thumb"
                      />
                      <div class="chat-pending-image-meta">
                        <span class="chat-pending-image-name">{pendingImage.name}</span>
                        <span class="chat-pending-image-size">
                          {pendingImage.width > 0 && pendingImage.height > 0
                            ? `${pendingImage.width}×${pendingImage.height} · `
                            : ""}
                          {formatBytesLabel(pendingImage.bytes)} · ready to send
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="chat-replying-cancel"
                      title="Remove image"
                      onClick={() => setPendingImage(null)}
                    >
                      <i class="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                )}
                <input
                  ref={imageFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const input = e.currentTarget as HTMLInputElement;
                    const file = input.files?.[0];
                    input.value = "";
                    void stageChatImageFile(file);
                  }}
                />
                {typingLabel && (
                  <div class="chat-typing-indicator" aria-live="polite">
                    <span class="chat-typing-dots" aria-hidden="true">
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                    <span class="chat-typing-text">{typingLabel}</span>
                  </div>
                )}
                <form class="chat-input-pill" onSubmit={(e) => {
                  if (lastTypingChannelRef.current === activeChannel) {
                    sendTypingSignal(activeChannel, false);
                  }
                  void handleSendMessage(e);
                }}>
                  <input
                    ref={chatInputRef}
                    type="text"
                    class="chat-input-field"
                    placeholder={
                      pendingImage
                        ? "add a caption or press enter to send photo..."
                        : activeChannelDef.isDm
                        ? `message @${activeChannelDef.name}...`
                        : `message #${activeChannelDef.name}...`
                    }
                    value={inputText}
                    onInput={(e) => {
                      const val = (e.target as HTMLInputElement).value;
                      setInputText(val);
                      handleTypingActivity(val);
                    }}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      for (const item of Array.from(items)) {
                        if (item.type.startsWith("image/")) {
                          const file = item.getAsFile();
                          if (file) {
                            e.preventDefault();
                            void stageChatImageFile(file);
                            break;
                          }
                        }
                      }
                    }}
                    maxLength={500}
                  />
                  <button
                    type="button"
                    class="chat-media-toggle-btn"
                    title="Upload image (or paste / drop file)"
                    aria-label="Upload image"
                    disabled={isSending}
                    onClick={() => imageFileInputRef.current?.click()}
                  >
                    <i class="fa-solid fa-image"></i>
                  </button>
                  <button
                    type="button"
                    class={`chat-media-toggle-btn${showCameraModal ? " active" : ""}`}
                    title="Take photo with in-site camera"
                    aria-label="Open camera"
                    disabled={isSending}
                    onClick={() => {
                      setShowGifPicker(false);
                      setShowEmojiPicker(false);
                      setShowGiftPicker(false);
                      setShowCameraModal(true);
                    }}
                  >
                    <i class="fa-solid fa-camera"></i>
                  </button>
                  <button
                    type="button"
                    class={`chat-emoji-toggle-btn${showEmojiPicker ? " active" : ""}`}
                    title="Pick an emoji"
                    aria-label="Open emoji picker"
                    onClick={() => {
                      setShowGifPicker(false);
                      setShowGiftPicker(false);
                      setShowEmojiPicker((v) => !v);
                    }}
                  >
                    <i class="fa-regular fa-face-smile"></i>
                  </button>
                  <button
                    type="button"
                    class={`chat-gift-toggle-btn${showGiftPicker ? " active" : ""}`}
                    title="Send a gift (Cookie Coins or 1 Month Cookie Master)"
                    aria-label="Send a gift"
                    onClick={() => {
                      setShowGifPicker(false);
                      setShowEmojiPicker(false);
                      setShowGiftPicker((prev) => {
                        const next = !prev;
                        if (next && activeChannelDef.isDm && activeChannelDef.name) {
                          setGiftRecipient(activeChannelDef.name);
                        }
                        return next;
                      });
                    }}
                  >
                    <i class="fa-solid fa-gift"></i>
                  </button>
                  <button
                    type="button"
                    class={`chat-gif-toggle-btn${showGifPicker ? " active" : ""}`}
                    title="Send a GIF via KLIPY"
                    onClick={() => {
                      setShowEmojiPicker(false);
                      setShowGiftPicker(false);
                      setShowGifPicker((v) => !v);
                    }}
                  >
                    GIF
                  </button>
                  <button
                    type="submit"
                    class="chat-submit-btn"
                    disabled={(!inputText.trim() && !pendingImage) || isSending}
                    title="Send message"
                  >
                    <i class={`fa-solid ${isSending ? "fa-spinner fa-spin" : "fa-paper-plane"}`}></i>
                  </button>
                </form>
              </>
            )}

            {cloudUser && !isCurrentDmBlocked && showEmojiPicker && (
              <EmojiPicker
                pickerRef={emojiPickerRef}
                onSelect={handleInsertEmoji}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}

            {cloudUser && !isCurrentDmBlocked && reactPickerMessageId && (
              <EmojiPicker
                pickerRef={reactPickerRef}
                containerClass="is-reaction-picker"
                onSelect={(emoji) => {
                  const targetId = reactPickerMessageId;
                  setReactPickerMessageId(null);
                  if (targetId) void handleToggleReaction(targetId, emoji);
                }}
                onClose={() => setReactPickerMessageId(null)}
              />
            )}

            {cloudUser && !isCurrentDmBlocked && showGiftPicker && (
              <form class="chat-gift-picker" ref={giftPickerRef as any} onSubmit={handleSendGift}>
                <div class="chat-gift-picker-header">
                  <span class="chat-gift-picker-title">
                    <i class="fa-solid fa-gift" style={{ color: "#facc15" }}></i>
                    send a gift
                  </span>
                  <span class="chat-gift-balance-pill">
                    <i class={`fa-solid ${isOwnerUser ? "fa-infinity" : "fa-coins"}`}></i>
                    {isOwnerUser ? "unlimited" : `${myCoinBalance.toLocaleString()} coins`}
                  </span>
                </div>

                <div class="chat-gift-tabs">
                  <button
                    type="button"
                    class={`chat-gift-tab-btn${giftTab === "coins" ? " active" : ""}`}
                    onClick={() => setGiftTab("coins")}
                  >
                    <i class="fa-solid fa-coins"></i> cookie coins
                  </button>
                  <button
                    type="button"
                    class={`chat-gift-tab-btn${giftTab === "cookie_master" ? " active" : ""}`}
                    onClick={() => setGiftTab("cookie_master")}
                  >
                    <i class="fa-solid fa-crown"></i> 1 mo master
                  </button>
                </div>

                <input
                  type="text"
                  class="chat-gift-input"
                  placeholder="recipient @username..."
                  list="chat-gift-users-datalist"
                  value={giftRecipient}
                  onInput={(e) => setGiftRecipient((e.target as HTMLInputElement).value)}
                />
                <datalist id="chat-gift-users-datalist">
                  {[...onlineUsers, ...offlineUsers]
                    .filter((u) => isOwnerUser || u.username.toLowerCase() !== cloudUser.toLowerCase())
                    .slice(0, 60)
                    .map((u) => (
                      <option key={u.username} value={u.username} />
                    ))}
                </datalist>

                {giftTab === "coins" ? (
                  <>
                    <div class="chat-gift-presets">
                      {(isOwnerUser ? [100, 1000, 5000, 10000, 50000] : [50, 100, 250, 500, 1000]).map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          class={`chat-gift-preset-btn${Number(giftAmount) === amt ? " active" : ""}`}
                          onClick={() => setGiftAmount(String(amt))}
                        >
                          {amt.toLocaleString()}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      min={isOwnerUser ? 1 : 10}
                      max={isOwnerUser ? 1000000000 : 1000000}
                      class="chat-gift-input"
                      placeholder="custom coin amount..."
                      value={giftAmount}
                      onInput={(e) => setGiftAmount((e.target as HTMLInputElement).value)}
                    />
                  </>
                ) : (
                  <div class="chat-gift-cm-card">
                    <span class="chat-gift-cm-title">
                      <i class="fa-solid fa-crown"></i> 1 month of cookie master
                    </span>
                    <span class="chat-gift-cm-desc">
                      unlocks ad-free browsing, +1,000 daily cookie coins, and the exclusive crown badge for 30 days.{" "}
                      {isOwnerUser ? "(free for owner)" : `(${GIFT_COOKIE_MASTER_COST.toLocaleString()} coins)`}
                    </span>
                  </div>
                )}

                <input
                  type="text"
                  class="chat-gift-input"
                  maxLength={120}
                  placeholder="optional gift message..."
                  value={giftNote}
                  onInput={(e) => setGiftNote((e.target as HTMLInputElement).value)}
                />

                <button
                  type="submit"
                  class="chat-gift-send-btn"
                  disabled={isSendingGift || !giftRecipient.trim()}
                >
                  <i class={`fa-solid ${isSendingGift ? "fa-spinner fa-spin" : "fa-gift"}`}></i>
                  {isSendingGift
                    ? "sending gift..."
                    : giftTab === "cookie_master"
                    ? `gift 1 mo cookie master${isOwnerUser ? "" : ` (${GIFT_COOKIE_MASTER_COST.toLocaleString()} coins)`}`
                    : `send ${(Math.max(0, Math.floor(Number(giftAmount) || 0))).toLocaleString()} coins`}
                </button>
              </form>
            )}

            {cloudUser && !isCurrentDmBlocked && showGifPicker && (
              <div class="chat-gif-picker" ref={gifPickerRef}>
                <div class="chat-gif-picker-header">
                  <input
                    type="text"
                    class="chat-gif-picker-search"
                    placeholder="search klipy gifs..."
                    value={gifSearch}
                    autoFocus
                    onInput={(e) =>
                      setGifSearch((e.target as HTMLInputElement).value)
                    }
                  />
                  <button
                    type="button"
                    class="chat-gif-more-btn"
                    onClick={() => setShowGifPicker(false)}
                    title="Close GIF picker"
                  >
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>

                <div class="chat-gif-grid-wrap">
                  {!gifConfigured ? (
                    <div class="chat-gif-empty">
                      <i class="fa-solid fa-film" style={{ fontSize: "20px" }}></i>
                      <span>
                        klipy gifs not configured yet — set KLIPY_API_KEY on the server.
                      </span>
                    </div>
                  ) : gifLoading && gifItems.length === 0 ? (
                    <div class="chat-gif-empty">
                      <i class="fa-solid fa-spinner fa-spin" style={{ fontSize: "18px" }}></i>
                      <span>loading gifs...</span>
                    </div>
                  ) : gifError && gifItems.length === 0 ? (
                    <div class="chat-gif-empty">
                      <span>{gifError}</span>
                    </div>
                  ) : gifItems.length === 0 ? (
                    <div class="chat-gif-empty">
                      <span>no matching gifs found</span>
                    </div>
                  ) : (
                    <div class="chat-gif-grid">
                      {gifItems.map((gif) => (
                        <button
                          key={gif.id}
                          type="button"
                          class="chat-gif-item"
                          title={gif.title}
                          disabled={isSending}
                          onClick={() => void handleSendGif(gif)}
                        >
                          <img
                            src={getKlipyProxySrc(gif.previewUrl)}
                            alt={gif.title}
                            loading="lazy"
                            decoding="async"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div class="chat-gif-footer">
                  <span>powered by klipy</span>
                  {gifConfigured && gifHasNext && (
                    <button
                      type="button"
                      class="chat-gif-more-btn"
                      disabled={gifLoading}
                      onClick={() => void fetchKlipyGifs(gifSearch, gifPage + 1, true)}
                    >
                      {gifLoading ? "loading..." : "load more"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── COLUMN 3: Right Online / Offline Users & Blocked List Sidebar ── */}
        <div class="chat-online-panel">
          <div class="chat-online-header">
            <span>online · {onlineUsers.length}</span>
          </div>

          <div class="chat-online-list">
            {onlineUsers.length === 0 ? (
              <div
                style={{
                  padding: "12px",
                  color: "var(--color-sublabel)",
                  fontSize: "11px",
                  textAlign: "center",
                }}
              >
                no one online
              </div>
            ) : (
              onlineUsers.map((u) => {
                const blocked = isUserBlocked(u.username);
                const uCustom = u.customization || null;
                const dotStatus = getEffectivePresenceDot(uCustom?.presenceStatus, u.isIdle);
                const playingActive = Boolean(
                  dotStatus !== "idle" &&
                    !u.isIdle &&
                    u.isPlayingGame &&
                    u.game &&
                    u.game !== "browsing"
                );
                const playingDurationLabel = playingActive
                  ? formatElapsedDuration(u.gameStartedAt, nowMs)
                  : "";
                return (
                  <ChatUserRow
                    key={`online_${u.username}`}
                    user={u}
                    blocked={blocked}
                    isGoat={isUserGoat(u.username)}
                    isCookieMaster={isUserCookieMaster(u.username)}
                    dotStatus={dotStatus}
                    playingDurationLabel={playingDurationLabel}
                    onOpenUserProfile={openUserProfile}
                    onOpenDirectMessage={openDirectMessage}
                    onToggleBlockUser={toggleBlockUser}
                  />
                );
              })
            )}

            {/* Offline Users Section */}
            {(() => {
              const onlineRegisteredCount = onlineUsers.filter(
                (u) => !/^guest[-_]/i.test(u.username) && u.username.toLowerCase() !== "guest"
              ).length;
              const totalSignedUp = Math.max(
                serverTotalUsersCount,
                registeredCloudSyncUsers.length,
                onlineRegisteredCount + offlineUsers.length
              );
              const displayOfflineCount = Math.max(
                offlineUsers.length,
                Math.max(0, totalSignedUp - onlineRegisteredCount)
              );
              return (
                <div class="chat-offline-section">
                  <div class="chat-section-sub-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                    <span>offline · {displayOfflineCount}</span>
                    {totalSignedUp > 0 && (
                      <span style={{ fontSize: "10px", opacity: 0.72 }}>
                        total · {totalSignedUp}
                      </span>
                    )}
                  </div>
                  {offlineUsers.length === 0 ? (
                <div
                  style={{
                    padding: "6px 8px",
                    color: "var(--color-sublabel)",
                    fontSize: "11px",
                    opacity: 0.7,
                  }}
                >
                  no offline users yet
                </div>
              ) : (
                offlineUsers.map((u) => (
                  <ChatUserRow
                    key={`offline_${u.username}`}
                    user={u}
                    offline
                    blocked={isUserBlocked(u.username)}
                    isGoat={isUserGoat(u.username)}
                    isCookieMaster={isUserCookieMaster(u.username)}
                    dotStatus="idle"
                    playingDurationLabel=""
                    onOpenUserProfile={openUserProfile}
                    onOpenDirectMessage={openDirectMessage}
                    onToggleBlockUser={toggleBlockUser}
                  />
                ))
              )}
                </div>
              );
            })()}

            {/* Blocked Users Management Section */}
            {blockedUsers.length > 0 && (
              <div style={{ marginTop: "14px" }}>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--color-sublabel)",
                    padding: "4px 8px",
                    textTransform: "lowercase",
                  }}
                >
                  blocked · {blockedUsers.length}
                </div>
                {blockedUsers.map((bu) => (
                  <div key={bu} class="chat-user-item">
                    <div class="chat-user-meta">
                      <span
                        class="chat-user-name"
                        style={{ opacity: 0.65, fontSize: "12px" }}
                      >
                        {bu}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="chat-user-mini-btn blocked"
                      title={`Unblock ${bu}`}
                      onClick={() => toggleBlockUser(bu)}
                    >
                      <i class="fa-solid fa-unlock"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── USER PROFILE OVERLAY MODAL (View Own Profile or Any User's Profile) ── */}
        {viewingProfileUsername && (
          <div
            class="chat-profile-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeUserProfile();
            }}
          >
            {(() => {
              const verifiedProfile =
                profileData &&
                profileData.username?.toLowerCase() === viewingProfileUsername.toLowerCase()
                  ? profileData
                  : null;
              const targetName = verifiedProfile?.username || viewingProfileUsername;
              const isViewingSelf = Boolean(
                cloudUser && targetName.toLowerCase() === cloudUser.toLowerCase()
              );
              const metaMatch = userMetaMap.get(targetName.toLowerCase());
              const onlineMatch = onlineUsers.find(
                (u) => u.username.toLowerCase() === targetName.toLowerCase()
              );
              const isOnlineNow =
                isViewingSelf || Boolean(onlineMatch || verifiedProfile?.online);
              const avatarCol = stringToColor(targetName);
              const blocked = isUserBlocked(targetName);

              const custom = isViewingSelf
                ? editingCustom
                : sanitizeCustomization(
                    verifiedProfile?.customization || metaMatch?.customization,
                    targetName
                  );
              const targetIsIdle = isViewingSelf
                ? Boolean(selfIdle || custom.presenceStatus === "idle")
                : Boolean(onlineMatch?.isIdle || custom.presenceStatus === "idle");
              const activeGameName = targetIsIdle
                ? ""
                : isViewingSelf
                ? myGameSession.isPlayingGame
                  ? myGameSession.game
                  : ""
                : onlineMatch?.isPlayingGame
                ? onlineMatch.game || ""
                : verifiedProfile?.isPlayingGame
                ? verifiedProfile.game
                : "";
              const activeGameStart = targetIsIdle
                ? 0
                : isViewingSelf
                ? myGameSession.gameStartedAt
                : onlineMatch?.gameStartedAt || verifiedProfile?.gameStartedAt || 0;
              const targetRole: ChatRole =
                (isViewingSelf ? selfRole : verifiedProfile?.role || metaMatch?.role) ||
                (ownerUsers.some((o) => o.toLowerCase() === targetName.toLowerCase())
                  ? "owner"
                  : staffMods.some((m) => m.toLowerCase() === targetName.toLowerCase())
                  ? "mod"
                  : "member");
              const targetTimedOut = Boolean(
                verifiedProfile?.isTimedOut ||
                  metaMatch?.isTimedOut ||
                  (isViewingSelf &&
                    selfTimeout &&
                    (selfTimeout.until === -1 || selfTimeout.until > nowMs))
              );
              const bannerStyle = getBannerInlineStyle(custom);
              const bannerClass =
                !custom.bannerUrl && custom.bannerStyle !== "solid"
                  ? `banner-${custom.bannerStyle}`
                  : "";
              const displayLabel = custom.displayName?.trim() || targetName;
              const dotClass = isOnlineNow
                ? getEffectivePresenceDot(
                    custom.presenceStatus,
                    isViewingSelf ? selfIdle : onlineMatch?.isIdle
                  )
                : "offline";
              const canModTarget = Boolean(
                !isViewingSelf &&
                  (selfRole === "owner" || selfRole === "mod") &&
                  targetRole !== "owner" &&
                  (selfRole === "owner" || targetRole !== "mod")
              );
              const targetIsGoat = Boolean(
                isUserGoat(targetName) || verifiedProfile?.isGoat
              );
              const canGrantGoat = Boolean(
                cloudUser && (selfRole === "owner" || selfRole === "mod")
              );
              const canViewStaffAudit = Boolean(
                verifiedProfile
                  ? Array.isArray(verifiedProfile.staffNotes) ||
                      Array.isArray(verifiedProfile.staffLogs)
                  : selfRole === "owner" || selfRole === "mod"
              );
              const targetStaffNotes = Array.isArray(verifiedProfile?.staffNotes)
                ? verifiedProfile.staffNotes
                : [];
              const targetStaffLogs = Array.isArray(verifiedProfile?.staffLogs)
                ? verifiedProfile.staffLogs
                : [];

              return (
                <div
                  key={targetName.toLowerCase()}
                  class={`chat-profile-card theme-${custom.cardTheme} ${
                    custom.profileEffect === "lightning-border" ? "effect-lightning-border" : ""
                  }`}
                  style={custom.cardBgColor ? { background: custom.cardBgColor } : undefined}
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
                    <div class={`chat-profile-banner ${bannerClass}`} style={bannerStyle}>
                      {isViewingSelf && (
                        <button
                          type="button"
                          class="chat-profile-close-btn"
                          style={{ right: "44px", width: "auto", padding: "0 10px", gap: "5px" }}
                          title="Customize pfp, gif banner, animated frames & effects"
                          onClick={() => {
                            closeUserProfile();
                            void handleOpenCustomizer();
                          }}
                        >
                          <i class="fa-solid fa-wand-magic-sparkles"></i>
                          <span style={{ fontSize: "11px", fontWeight: 600 }}>customize</span>
                        </button>
                      )}
                      <button
                        type="button"
                        class="chat-profile-close-btn"
                        title="Close profile"
                        onClick={closeUserProfile}
                      >
                        <i class="fa-solid fa-xmark"></i>
                      </button>
                    </div>

                    <div class="chat-profile-body">
                      <div class="chat-profile-top-row">
                        <UserAvatar
                          username={targetName}
                          custom={custom}
                          fallbackColor={avatarCol}
                          className="chat-profile-avatar-lg"
                        >
                          <span class={`chat-profile-status-dot ${dotClass}`}></span>
                        </UserAvatar>

                        {(custom.customTag || targetTimedOut) && (
                          <div class="chat-profile-badges">
                            {custom.customTag && (
                              <span class="chat-role-badge custom-tag">{custom.customTag}</span>
                            )}
                            {targetTimedOut && (
                              <span class="chat-role-badge muted-pill">
                                <i class="fa-solid fa-comment-slash"></i> timed out
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div class="chat-profile-identity">
                        <div class="chat-profile-name-row">
                          <h3 class={`chat-profile-username ${getNameClasses(custom)}`}>
                            {displayLabel}
                          </h3>
                          <MasterVerifiedBadge isCookieMaster={isUserCookieMaster(targetName)} />
                          <RoleBadge role={targetRole} />
                          <GoatBadge isGoat={targetIsGoat} />
                        </div>
                        <div class="chat-profile-handle-row">
                          <span>@{targetName}</span>
                          {custom.pronouns && <span>· {custom.pronouns}</span>}
                        </div>
                        {verifiedProfile?.statusText && !isViewingSelf && (
                          <div class="chat-profile-custom-status">{verifiedProfile.statusText}</div>
                        )}
                      </div>

                      {/* Live Game Activity Section */}
                      {activeGameName && activeGameName !== "browsing" && (
                        <div class="chat-profile-activity-box">
                          <div class="chat-profile-activity-label">
                            <i class="fa-solid fa-gamepad"></i> currently playing
                          </div>
                          <div class="chat-profile-activity-main">
                            <span class="chat-profile-activity-game">{activeGameName}</span>
                            <span class="chat-profile-activity-time">
                              {formatElapsedDuration(activeGameStart, nowMs)} elapsed
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Live Last.fm Listening / Scrobble Card */}
                      {(() => {
                        const displayLastfmHandle = isViewingSelf
                          ? sanitizeLastfmUsername(custom.lastfmUsername || "")
                          : sanitizeLastfmUsername(
                              verifiedProfile?.lastfm?.username || custom.lastfmUsername || "",
                            );
                        if (!displayLastfmHandle) return null;
                        const matchingLastfm =
                          verifiedProfile?.lastfm &&
                          verifiedProfile.lastfm.username.toLowerCase() ===
                            displayLastfmHandle.toLowerCase()
                            ? verifiedProfile.lastfm
                            : null;
                        return (
                          <LastfmListeningCard
                            lastfmUsername={displayLastfmHandle}
                            lastfm={matchingLastfm}
                            loading={
                              (profileLoading && !verifiedProfile) ||
                              (isViewingSelf && !matchingLastfm && Boolean(custom.lastfmUsername))
                            }
                            nowMs={nowMs}
                            refreshing={lastfmRefreshing}
                            onRefresh={() => void refreshProfileLastfm(targetName, true)}
                          />
                        );
                      })()}

                      {/* Bio / About Section (Editable for Own Profile + Joined Date) */}
                      {isViewingSelf ? (
                        <form class="chat-profile-edit-form" onSubmit={handleSaveMyProfile}>
                          <div class="chat-profile-section-title">your status, bio &amp; last.fm</div>
                          <input
                            type="text"
                            class="chat-mod-input"
                            placeholder="custom status (e.g. grinding slope)..."
                            maxLength={60}
                            value={editingStatusText}
                            onInput={(e) => {
                              inlineProfileEditedRef.current = true;
                              setEditingStatusText((e.target as HTMLInputElement).value);
                            }}
                          />
                          <textarea
                            class="chat-mod-input chat-profile-bio-textarea"
                            placeholder="write a short bio for your profile..."
                            maxLength={220}
                            rows={2}
                            value={editingBio}
                            onInput={(e) => {
                              inlineProfileEditedRef.current = true;
                              setEditingBio((e.target as HTMLTextAreaElement).value);
                            }}
                          />
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <input
                              type="text"
                              class="chat-mod-input"
                              placeholder="last.fm username or profile url..."
                              maxLength={80}
                              value={editingCustom.lastfmUsername}
                              onInput={(e) => {
                                inlineProfileEditedRef.current = true;
                                const val = sanitizeLastfmUsername(
                                  (e.target as HTMLInputElement).value
                                );
                                setEditingCustom((prev) => ({
                                  ...prev,
                                  lastfmUsername: val,
                                }));
                              }}
                            />
                            {editingCustom.lastfmUsername && (
                              <button
                                type="button"
                                class="chat-profile-pill-btn"
                                style={{ flexShrink: 0 }}
                                onClick={() => {
                                  inlineProfileEditedRef.current = true;
                                  setEditingCustom((prev) => ({
                                    ...prev,
                                    lastfmUsername: "",
                                  }));
                                }}
                              >
                                unlink
                              </button>
                            )}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              class="chat-profile-pill-btn"
                              onClick={() => {
                                closeUserProfile();
                                void handleOpenCustomizer();
                              }}
                            >
                              <i class="fa-solid fa-wand-magic-sparkles"></i> edit look &amp; effects
                            </button>
                            <button
                              type="submit"
                              class="chat-auth-login-btn"
                              disabled={savingProfile}
                              style={{ padding: "6px 14px" }}
                            >
                              {savingProfile ? "saving..." : "save profile"}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div class={`chat-profile-section chat-profile-bio-card bio-${custom.bioStyle}`}>
                          <div class="chat-profile-bio-text">
                            {verifiedProfile?.bio || "no bio set yet."}
                          </div>
                          {verifiedProfile?.createdAt && (
                            <div class="chat-profile-joined">
                              <i class="fa-solid fa-calendar-days"></i> member since{" "}
                              {new Date(verifiedProfile.createdAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Game & Leaderboard Stats */}
                      <div class="chat-profile-section">
                        <div class="chat-profile-section-title">game & studio stats</div>
                        {profileLoading && !verifiedProfile ? (
                          <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                            loading profile stats...
                          </div>
                        ) : (
                          <>
                            <div class="chat-profile-stats-grid">
                              <div class="chat-profile-stat-pill">
                                <span class="chat-profile-stat-val">
                                  {formatPlayTime(verifiedProfile?.stats?.totalSeconds || 0)}
                                </span>
                                <span class="chat-profile-stat-lbl">total time played</span>
                              </div>
                              <div class="chat-profile-stat-pill">
                                <span class="chat-profile-stat-val">
                                  {verifiedProfile?.stats?.totalPlays || 0}
                                </span>
                                <span class="chat-profile-stat-lbl">total game sessions</span>
                              </div>
                              <div class="chat-profile-stat-pill">
                                <span class="chat-profile-stat-val">
                                  {verifiedProfile?.publishedGamesCount || 0}
                                </span>
                                <span class="chat-profile-stat-lbl">published games</span>
                              </div>
                            </div>

                            {verifiedProfile?.studio && (
                              <div class="chat-profile-studio-row">
                                <i
                                  class={`fa-solid ${verifiedProfile.studio.icon || "fa-rocket"}`}
                                  style={{ color: verifiedProfile.studio.color || "#60a5fa" }}
                                ></i>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: "12px" }}>
                                    {verifiedProfile.studio.name}
                                  </div>
                                  <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                                    {verifiedProfile.studio.tagline}
                                  </div>
                                </div>
                              </div>
                            )}

                            {verifiedProfile?.stats?.topGames &&
                              verifiedProfile.stats.topGames.length > 0 && (
                                <div class="chat-profile-top-games">
                                  {verifiedProfile.stats.topGames.slice(0, 3).map((g) => (
                                    <div key={g.game} class="chat-profile-top-game-row">
                                      <span class="chat-profile-top-game-name">{g.game}</span>
                                      <span class="chat-profile-top-game-time">
                                        {formatPlayTime(g.seconds)}
                                        {g.highScore > 0 ? ` · score ${g.highScore}` : ""}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                          </>
                        )}
                      </div>

                      {/* Actions for other users (mention / message / block + call) */}
                      {!isViewingSelf && (
                        <>
                          <div class="chat-profile-actions-grid">
                            <button
                              type="button"
                              class="chat-profile-pill-btn"
                              onClick={() => {
                                setInputText((prev) =>
                                  prev.includes(`@${targetName}`)
                                    ? prev
                                    : `@${targetName} ${prev}`
                                );
                                closeUserProfile();
                              }}
                            >
                              mention
                            </button>
                            <button
                              type="button"
                              class="chat-profile-pill-btn primary"
                              onClick={() => openDirectMessage(targetName)}
                            >
                              message
                            </button>
                            <button
                              type="button"
                              class={`chat-profile-pill-btn ${blocked ? "danger" : ""}`}
                              onClick={() => toggleBlockUser(targetName)}
                            >
                              {blocked ? "unblock" : "block"}
                            </button>
                          </div>

                          <button
                            type="button"
                            class="chat-header-btn voice-active"
                            style={{ width: "100%", justifyContent: "center" }}
                            onClick={() => {
                              const dmChan = makeDmChannelId(cloudUser || "guest", targetName);
                              setActiveChannel(dmChan);
                              closeUserProfile();
                              joinVoiceRoom(`voice:${dmChan}`);
                            }}
                          >
                            <i class="fa-solid fa-phone-volume"></i> voice call @{targetName}
                          </button>

                        </>
                      )}

                      {(canModTarget || canGrantGoat) && (
                        <div
                          class="chat-profile-section"
                          style={{
                            borderColor: canModTarget
                              ? "rgba(45, 212, 191, 0.28)"
                              : "rgba(250, 204, 21, 0.35)",
                          }}
                        >
                          <div
                            class="chat-profile-section-title"
                            style={{ color: canModTarget ? "#5eead4" : "#fde047" }}
                          >
                            <i class="fa-solid fa-shield-halved"></i> staff moderation
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                            {canGrantGoat && (
                              <button
                                type="button"
                                class="chat-profile-pill-btn"
                                style={
                                  targetIsGoat
                                    ? {
                                        color: "#fca5a5",
                                        borderColor: "rgba(239, 68, 68, 0.42)",
                                      }
                                    : {
                                        color: "#fef08a",
                                        borderColor: "rgba(250, 204, 21, 0.58)",
                                        background: "rgba(234, 179, 8, 0.22)",
                                      }
                                }
                                onClick={() =>
                                  void handleToggleGoatUser(targetName, !targetIsGoat)
                                }
                              >
                                <i class="fa-solid fa-trophy"></i>{" "}
                                {targetIsGoat ? "remove GOAT" : "award GOAT"}
                              </button>
                            )}
                            {canModTarget && (
                              <>
                                {targetTimedOut ? (
                                  <button
                                    type="button"
                                    class="chat-profile-pill-btn"
                                    onClick={() => void handleTimeoutUser(targetName, 0)}
                                  >
                                    unmute
                                  </button>
                                ) : (
                                  <>
                                    {[
                                      [1, "1m"],
                                      [5, "5m"],
                                      [15, "15m"],
                                      [60, "1h"],
                                      [525600, "perm"],
                                    ].map(([mins, label]) => (
                                      <button
                                        key={String(mins)}
                                        type="button"
                                        class="chat-profile-pill-btn danger"
                                        onClick={() =>
                                          void handleTimeoutUser(targetName, Number(mins))
                                        }
                                      >
                                        mute {label}
                                      </button>
                                    ))}
                                  </>
                                )}
                                {!activeChannel.startsWith("dm:") && (
                                  <button
                                    type="button"
                                    class="chat-profile-pill-btn danger"
                                    onClick={() => void handlePurgeUserMessages(targetName)}
                                  >
                                    purge #{activeChannel}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  class={`chat-profile-pill-btn ${
                                    verifiedProfile?.isShadowbanned ? "" : "danger"
                                  }`}
                                  title="Device-ban & shadowban user (invalidates sessions & blocks device)"
                                  onClick={() =>
                                    void handleDeviceBanUser(
                                      targetName,
                                      Boolean(verifiedProfile?.isShadowbanned)
                                    )
                                  }
                                >
                                  <i class="fa-solid fa-fingerprint"></i>{" "}
                                  {verifiedProfile?.isShadowbanned
                                    ? "unban device / shadowban"
                                    : "device ban & shadowban"}
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {canViewStaffAudit && (
                        <div
                          class="chat-profile-section chat-profile-staff-audit"
                          style={{
                            borderColor: "rgba(167, 139, 250, 0.35)",
                            background: "rgba(30, 27, 46, 0.65)",
                          }}
                        >
                          <div class="chat-profile-section-title" style={{ color: "#c4b5fd" }}>
                            <i class="fa-solid fa-lock"></i> staff notes &amp; action log · admins/staff only
                          </div>

                          <div class="chat-staff-tabs" style={{ marginBottom: "6px" }}>
                            <button
                              type="button"
                              class={`chat-staff-tab ${profileAuditTab === "notes" ? "active" : ""}`}
                              onClick={() => setProfileAuditTab("notes")}
                            >
                              <i class="fa-solid fa-note-sticky" /> notes ({targetStaffNotes.length})
                            </button>
                            <button
                              type="button"
                              class={`chat-staff-tab ${profileAuditTab === "logs" ? "active" : ""}`}
                              onClick={() => setProfileAuditTab("logs")}
                            >
                              <i class="fa-solid fa-clock-rotate-left" /> action log ({targetStaffLogs.length})
                            </button>
                          </div>

                          {profileAuditTab === "notes" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                              <form
                                style={{ display: "flex", flexDirection: "column", gap: "5px" }}
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  void handleAddProfileStaffNote(targetName);
                                }}
                              >
                                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                                  {STAFF_NOTE_CATEGORIES.map((cat) => (
                                    <button
                                      key={cat.id}
                                      type="button"
                                      class={`chat-note-cat-btn cat-${cat.id} ${
                                        profileNoteCategory === cat.id ? "active" : ""
                                      }`}
                                      onClick={() => setProfileNoteCategory(cat.id)}
                                    >
                                      <i class={`fa-solid ${cat.icon}`} /> {cat.label}
                                    </button>
                                  ))}
                                </div>
                                <div style={{ display: "flex", gap: "5px" }}>
                                  <input
                                    type="text"
                                    class="chat-mod-input"
                                    placeholder={`private staff note on @${targetName}...`}
                                    maxLength={400}
                                    value={profileNoteDraft}
                                    onInput={(e) =>
                                      setProfileNoteDraft((e.target as HTMLInputElement).value)
                                    }
                                  />
                                  <button
                                    type="submit"
                                    class="chat-profile-pill-btn primary"
                                    disabled={savingProfileNote || !profileNoteDraft.trim()}
                                    style={{ flexShrink: 0 }}
                                  >
                                    {savingProfileNote ? "..." : "save"}
                                  </button>
                                </div>
                              </form>

                              {profileLoading && !verifiedProfile ? (
                                <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                                  loading staff notes...
                                </div>
                              ) : targetStaffNotes.length === 0 ? (
                                <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                                  no staff notes on @{targetName} yet.
                                </div>
                              ) : (
                                <div class="chat-staff-log-list is-compact">
                                  {targetStaffNotes.map((n) => (
                                    <div
                                      key={n.id}
                                      class={`chat-staff-note-card cat-${n.category || "general"}`}
                                    >
                                      <div class="chat-staff-note-head">
                                        <span class={`chat-note-cat-pill cat-${n.category || "general"}`}>
                                          {n.category || "general"}
                                        </span>
                                        <span class="chat-staff-log-time">
                                          @{n.author} · {formatStaffTimestamp(n.createdAt)}
                                        </span>
                                        <button
                                          type="button"
                                          class="chat-staff-note-del"
                                          title="Delete note"
                                          onClick={() =>
                                            void handleDeleteProfileStaffNote(n.id, targetName)
                                          }
                                        >
                                          ×
                                        </button>
                                      </div>
                                      <div class="chat-staff-note-body">{n.note}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : profileLoading && !verifiedProfile ? (
                            <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                              loading action log...
                            </div>
                          ) : targetStaffLogs.length === 0 ? (
                            <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                              no staff actions logged on @{targetName} yet.
                            </div>
                          ) : (
                            <div class="chat-staff-log-list is-compact">
                              {targetStaffLogs.map((log) => {
                                const meta = formatStaffLogActionMeta(log.action);
                                return (
                                  <div key={log.id} class="chat-staff-log-item">
                                    <div class="chat-staff-log-top">
                                      <span class={`chat-action-badge ${meta.tone}`}>
                                        {meta.label}
                                      </span>
                                      {log.channel && (
                                        <span class="chat-staff-log-channel">#{log.channel}</span>
                                      )}
                                      <span class="chat-staff-log-time">
                                        {formatStaffTimestamp(log.timestamp)}
                                      </span>
                                    </div>
                                    <div class="chat-staff-log-meta">
                                      <span>by @{log.actor}</span>
                                      {log.details ? <span> · {log.details}</span> : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── DEEP PROFILE & ANIMATIONS CUSTOMIZER MODAL ── */}
        {showCustomizer && cloudUser && (
          <ProfileCustomizerModal
            username={cloudUser}
            role={selfRole}
            isGoat={isUserGoat(cloudUser)}
            createdAt={
              selfCreatedAt ||
              (profileData?.username?.toLowerCase() === cloudUser.toLowerCase()
                ? profileData.createdAt
                : undefined) ||
              userMetaMap.get(cloudUser.toLowerCase())?.createdAt
            }
            initialCustom={editingCustom}
            initialBio={editingBio}
            initialStatusText={editingStatusText}
            saving={savingProfile}
            onAutoSave={(payload) => saveProfilePayload(payload, { silent: true })}
            onSave={async (payload) => {
              const ok = await saveProfilePayload(payload);
              if (ok) setShowCustomizer(false);
            }}
            onClose={() => setShowCustomizer(false)}
          />
        )}

        {/* ── STAFF & MODERATOR MANAGEMENT MODAL ── */}
        {showStaffModal && (
          <StaffManagerModal
            onClose={() => setShowStaffModal(false)}
            notify={(type, msg) => notifyToast(msg, type === "error" ? "error" : "success")}
          />
        )}

        {/* ── GROUP CHAT CREATE / MEMBERS MODAL ── */}
        {groupModalMode && cloudUser && (
          <GroupChatModal
            mode={groupModalMode}
            currentUser={cloudUser}
            knownUsernames={
              registeredCloudSyncUsers.length > 0
                ? registeredCloudSyncUsers
                : Array.from(userMetaMap.values()).map((u) => u.username)
            }
            existingGroup={
              groupModalMode === "members" ? activeChannelDef.groupDef : null
            }
            isSiteOwner={selfRole === "owner"}
            onGroupSaved={(grp) => {
              setChatGroups((prev) => [grp, ...prev.filter((x) => x.id !== grp.id)]);
              setActiveChannel(grp.id);
              setGroupModalMode(null);
            }}
            onGroupRemoved={(gid) => {
              setChatGroups((prev) => prev.filter((x) => x.id !== gid));
              setActiveChannel((ch) => (ch === gid ? "general" : ch));
              setGroupModalMode(null);
            }}
            onClose={() => setGroupModalMode(null)}
            notify={(msg, type) => notifyToast(msg, type)}
          />
        )}

        {/* ── CHANNEL CREATE / EDIT MODAL (OWNER & MOD) ── */}
        {channelEditorOpen && isStaffUser && (
          <div
            class="chat-modal-overlay open"
            style={{ zIndex: 10030, background: "rgba(0,0,0,0.65)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget && !savingChannel) setChannelEditorOpen(false);
            }}
          >
            <div
              class="studio-panel"
              style={{
                width: "min(440px, 92vw)",
                padding: "20px 22px",
                gap: "14px",
                background: "var(--bg-surface-2, #16161d)",
                border: "1px solid var(--bg-surface-10, rgba(255,255,255,0.12))",
                borderRadius: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
                  {editingChannelId ? `edit #${chName || editingChannelId}` : "create channel"}
                </h3>
                <button
                  type="button"
                  class="chat-header-btn"
                  disabled={savingChannel}
                  onClick={() => setChannelEditorOpen(false)}
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>

              <form onSubmit={handleSaveChannel} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", color: "var(--color-sublabel)" }}>
                  <span>channel name</span>
                  <input
                    type="text"
                    class="apps-custom-input"
                    value={chName}
                    maxLength={32}
                    placeholder="e.g. staff-lounge"
                    onInput={(e) => setChName((e.target as HTMLInputElement).value)}
                    required
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", color: "var(--color-sublabel)" }}>
                    <span>category</span>
                    <input
                      type="text"
                      class="apps-custom-input"
                      value={chCategory}
                      maxLength={24}
                      placeholder="e.g. staff, info, social"
                      onInput={(e) => setChCategory((e.target as HTMLInputElement).value)}
                    />
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", color: "var(--color-sublabel)" }}>
                    <span>icon</span>
                    <select
                      class="apps-custom-input"
                      value={chIcon}
                      onChange={(e) => setChIcon((e.target as HTMLSelectElement).value)}
                    >
                      {CHANNEL_ICON_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", color: "var(--color-sublabel)" }}>
                    <span>who can see this channel</span>
                    <select
                      class="apps-custom-input"
                      value={chVisibility}
                      onChange={(e) =>
                        setChVisibility((e.target as HTMLSelectElement).value === "staff" ? "staff" : "all")
                      }
                    >
                      <option value="all">everyone</option>
                      <option value="staff">owners &amp; mods only</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "12px", color: "var(--color-sublabel)" }}>
                    <span>who can type</span>
                    <select
                      class="apps-custom-input"
                      value={chWriteAccess}
                      onChange={(e) =>
                        setChWriteAccess((e.target as HTMLSelectElement).value === "staff" ? "staff" : "all")
                      }
                    >
                      <option value="all">everyone</option>
                      <option value="staff">owners &amp; mods only</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", marginTop: "6px" }}>
                  {editingChannelId && editingChannelId !== "general" ? (
                    <button
                      type="button"
                      class="chat-header-btn danger"
                      disabled={savingChannel}
                      onClick={() => void handleDeleteChannel()}
                    >
                      <i class="fa-solid fa-trash"></i>
                      <span>delete</span>
                    </button>
                  ) : (
                    <span />
                  )}

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      class="chat-header-btn"
                      disabled={savingChannel}
                      onClick={() => setChannelEditorOpen(false)}
                    >
                      cancel
                    </button>
                    <button
                      type="submit"
                      class="apps-custom-btn"
                      disabled={savingChannel}
                    >
                      {savingChannel ? "saving..." : editingChannelId ? "save changes" : "create channel"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── IN-SITE CAMERA CAPTURE MODAL ── */}
        {showCameraModal && cloudUser && (
          <ChatCameraModal
            onAttach={(img) => {
              setPendingImage(img);
              window.setTimeout(() => chatInputRef.current?.focus(), 40);
            }}
            onSendNow={(img) => {
              void sendChatMessage(inputText, undefined, img);
            }}
            onFallbackUpload={() => imageFileInputRef.current?.click()}
            onClose={() => setShowCameraModal(false)}
          />
        )}

        {/* ── FULLSCREEN CHAT IMAGE LIGHTBOX ── */}
        {lightboxImage && (
          <div
            class="chat-lightbox-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setLightboxImage(null);
            }}
          >
            <div class="chat-lightbox-card" onClick={(e) => e.stopPropagation()}>
              <div class="chat-lightbox-topbar">
                <span title={lightboxImage.name || "image preview"}>
                  {lightboxImage.name || "image preview"}
                </span>
                <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                  {!lightboxBroken && (
                    <a
                      href={lightboxImage.url}
                      download={lightboxImage.name || "chat-image"}
                      class="chat-header-btn"
                      style={{ textDecoration: "none" }}
                    >
                      <i class="fa-solid fa-download"></i>
                      <span>save</span>
                    </a>
                  )}
                  <button
                    type="button"
                    class="chat-header-btn"
                    onClick={() => setLightboxImage(null)}
                  >
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>
              {lightboxBroken ? (
                <div class="chat-lightbox-broken">
                  <i class="fa-regular fa-image" aria-hidden="true"></i>
                  <span>image could not be loaded</span>
                  {lightboxImage.name && <small title={lightboxImage.name}>{lightboxImage.name}</small>}
                  {lightboxImage.url.startsWith("/api/chat/media/") && (
                    <button
                      type="button"
                      class="chat-header-btn"
                      onClick={() => {
                        setLightboxBroken(false);
                        setLightboxRetryCount((n) => n + 1);
                      }}
                    >
                      <i class="fa-solid fa-arrows-rotate"></i>
                      <span>retry</span>
                    </button>
                  )}
                </div>
              ) : (
                <img
                  src={buildChatImageSrc(lightboxImage.url, lightboxRetryCount)}
                  alt={lightboxImage.name || "Full image preview"}
                  class="chat-lightbox-img"
                  onError={() => setLightboxBroken(true)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
