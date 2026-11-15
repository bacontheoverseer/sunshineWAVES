import { useEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import { moderateChatMessage } from "../core/contentFilter.ts";
import { getClientId, detectCurrentGameSession } from "../core/liveClient.ts";
import { formatPlayTime } from "../core/cookieCoins.ts";
import {
  ChatRole,
  ProfileCustomization,
  getBannerInlineStyle,
  getDefaultCustomization,
  loadLocalProfileCustomization,
  sanitizeCustomization,
  saveLocalProfileCustomization,
} from "../core/profileCustomization.ts";
import ProfileCustomizerModal from "./ProfileCustomizerModal.tsx";
import StaffManagerModal from "./StaffManagerModal.tsx";
import {
  ProfileEffectLayer,
  RoleBadge,
  UserAvatar,
  getNameClasses,
} from "./ProfileVisuals.tsx";

interface ChatReplyRef {
  id: string;
  author: string;
  text?: string;
  hasGif?: boolean;
}

interface ChatMessage {
  id: string;
  author: string;
  avatarColor: string;
  role?: ChatRole;
  customization?: ProfileCustomization | null;
  text: string;
  gifUrl?: string;
  gifTitle?: string;
  timestamp: string;
  channel: string;
  recipient?: string | null;
  replyTo?: ChatReplyRef | null;
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
  isSelf?: boolean;
  game?: string;
  isPlayingGame?: boolean;
  gameStartedAt?: number;
  lastSeen?: number;
  bio?: string;
  statusText?: string;
  customization?: ProfileCustomization | null;
  role?: ChatRole;
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
  role?: ChatRole;
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
}

interface VoiceParticipant {
  clientId: string;
  username: string;
  avatarColor: string;
  muted: boolean;
  deafened: boolean;
  speaking?: boolean;
}

interface Category {
  id: string;
  label: string;
  channels: { id: string; name: string; icon: string }[];
}

const TEXT_CATEGORIES: Category[] = [
  {
    id: "info",
    label: "info",
    channels: [
      { id: "rules", name: "rules", icon: "fa-book" },
      { id: "announcements", name: "announcements", icon: "fa-bullhorn" },
      { id: "updates", name: "updates", icon: "fa-sparkles" },
    ],
  },
  {
    id: "social",
    label: "social",
    channels: [
      { id: "general", name: "general", icon: "fa-hashtag" },
      { id: "introductions", name: "introductions", icon: "fa-hashtag" },
      { id: "off-topic", name: "off-topic", icon: "fa-hashtag" },
    ],
  },
  {
    id: "interests",
    label: "interests",
    channels: [
      { id: "games", name: "games", icon: "fa-hashtag" },
      { id: "anime", name: "anime", icon: "fa-hashtag" },
      { id: "music", name: "music", icon: "fa-hashtag" },
      { id: "tech", name: "tech", icon: "fa-hashtag" },
    ],
  },
  {
    id: "support",
    label: "support",
    channels: [{ id: "help", name: "help", icon: "fa-hashtag" }],
  },
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
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
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

export default function ChatModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState("general");
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState("");
  const [gifItems, setGifItems] = useState<KlipyGifItem[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifConfigured, setGifConfigured] = useState(true);
  const [gifError, setGifError] = useState("");
  const [gifPage, setGifPage] = useState(1);
  const [gifHasNext, setGifHasNext] = useState(false);
  const gifPickerRef = useRef<HTMLDivElement>(null);
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
      const stored = localStorage.getItem("cookie_chat_messages_v2");
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

  // User Profile Modal & Staff/Mod state
  const [viewingProfileUsername, setViewingProfileUsername] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<UserProfileDetails | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [editingBio, setEditingBio] = useState("");
  const [editingStatusText, setEditingStatusText] = useState("");
  const [editingCustom, setEditingCustom] = useState<ProfileCustomization>(() =>
    getDefaultCustomization()
  );
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [staffMods, setStaffMods] = useState<string[]>([]);
  const [ownerUsers, setOwnerUsers] = useState<string[]>([]);
  const [selfRole, setSelfRole] = useState<ChatRole>("member");
  const [selfTimeout, setSelfTimeout] = useState<{ until: number; reason?: string } | null>(null);
  const hydratedLocalCustomForRef = useRef<string | null>(null);
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const activeChannelRef = useRef(activeChannel);
  activeChannelRef.current = activeChannel;
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const seenMessageIdsRef = useRef<Set<string>>(new Set(messages.map((m) => m.id)));
  const initialStateLoadedRef = useRef(false);

  // WebRTC & WebAudio refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
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

  const openUserProfile = useCallback(
    async (targetUsername: string) => {
      const clean = targetUsername.trim().replace(/^@/, "");
      if (!clean) return;
      setViewingProfileUsername(clean);
      setProfileLoading(true);
      try {
        const res = await fetch(
          `/api/chat/user-profile?username=${encodeURIComponent(clean)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.exists === false) {
            notifyToast(
              data.error || `user "@${clean}" does not exist in cloudsync`,
              "error"
            );
            setViewingProfileUsername(null);
            setProfileData(null);
            return;
          }
          if (data?.profile) {
            setProfileData(data.profile);
            if (cloudUser && clean.toLowerCase() === cloudUser.toLowerCase()) {
              setEditingBio(data.profile.bio || "");
              setEditingStatusText(data.profile.statusText || "");
              const merged = data.profile.customization
                ? sanitizeCustomization(data.profile.customization, clean)
                : loadLocalProfileCustomization(clean) || getDefaultCustomization(clean);
              setEditingCustom(merged);
            }
          }
        }
      } catch {
        // Fallback profile card if offline
      } finally {
        setProfileLoading(false);
      }
    },
    [cloudUser]
  );

  const saveProfilePayload = useCallback(
    async (payload: {
      bio: string;
      statusText: string;
      customization?: ProfileCustomization;
    }): Promise<boolean> => {
      if (!cloudUser || savingProfile) return false;
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
        saveLocalProfileCustomization(cloudUser, savedCustom);
        setEditingCustom(savedCustom);
        setEditingBio(data.profile?.bio ?? payload.bio);
        setEditingStatusText(data.profile?.statusText ?? payload.statusText);
        setProfileData((prev) =>
          prev
            ? {
                ...prev,
                bio: data.profile?.bio ?? payload.bio,
                statusText: data.profile?.statusText ?? payload.statusText,
                customization: savedCustom,
              }
            : prev
        );
        setServerOnlineUsers((prev) =>
          prev.map((u) =>
            u.username.toLowerCase() === cloudUser.toLowerCase()
              ? {
                  ...u,
                  bio: data.profile?.bio ?? payload.bio,
                  statusText: data.profile?.statusText ?? payload.statusText,
                  customization: savedCustom,
                }
              : u
          )
        );
        notifyToast("profile & animations saved!", "success");
        return true;
      } catch {
        notifyToast("failed to save profile", "error");
        return false;
      } finally {
        setSavingProfile(false);
      }
    },
    [cloudUser, editingCustom, savingProfile]
  );

  const handleSaveMyProfile = useCallback(
    async (e?: Event) => {
      if (e) e.preventDefault();
      await saveProfilePayload({
        bio: editingBio,
        statusText: editingStatusText,
        customization: editingCustom,
      });
    },
    [saveProfilePayload, editingBio, editingStatusText, editingCustom]
  );

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
          setProfileData(data.profile);
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
      if (registeredCloudSyncUsers.length > 0) {
        const foundInRegistry = registeredCloudSyncUsers.find(
          (u) => u.toLowerCase() === peerLower
        );
        if (!foundInRegistry) {
          // Double-check live with server in case user just registered seconds ago
          try {
            const checkRes = await fetch(
              `/api/chat/user-profile?username=${encodeURIComponent(clean)}`
            );
            const checkData = await checkRes.json().catch(() => null);
            if (!checkData || checkData.exists === false) {
              notifyToast(
                `user "@${clean}" does not exist in cloudsync`,
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
        } else {
          canonicalTarget = foundInRegistry;
        }
      } else {
        try {
          const checkRes = await fetch(
            `/api/chat/user-profile?username=${encodeURIComponent(clean)}`
          );
          const checkData = await checkRes.json().catch(() => null);
          if (checkData && checkData.exists === false) {
            notifyToast(
              checkData.error || `user "@${clean}" does not exist in cloudsync`,
              "error"
            );
            return;
          }
          if (checkData?.profile?.username) {
            canonicalTarget = checkData.profile.username;
          }
        } catch {}
      }

      setDmPeers((prev) => {
        if (prev.some((p) => p.toLowerCase() === peerLower)) return prev;
        const next = [canonicalTarget, ...prev];
        try {
          localStorage.setItem("cookie_chat_dm_peers_v1", JSON.stringify(next));
        } catch {}
        return next;
      });
      const dmChannel = makeDmChannelId(cloudUser || "guest", canonicalTarget);
      setActiveChannel(dmChannel);
      setViewingProfileUsername(null);
      setUnreadCounts((prev) => ({ ...prev, [dmChannel]: 0 }));
    },
    [cloudUser, registeredCloudSyncUsers, openUserProfile]
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
          if (
            existing &&
            incoming.edited &&
            (existing.text !== incoming.text || !existing.edited || existing.editedAt !== incoming.editedAt)
          ) {
            const next = prev.slice();
            next[existingIdx] = {
              ...existing,
              text: incoming.text,
              edited: true,
              ...(incoming.editedAt ? { editedAt: incoming.editedAt } : {}),
            };
            try {
              localStorage.setItem("cookie_chat_messages_v2", JSON.stringify(next));
            } catch {}
            return next;
          }
          return prev;
        }
        const updated = [...prev, incoming].slice(-250);
        try {
          localStorage.setItem("cookie_chat_messages_v2", JSON.stringify(updated));
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

  // Create or get RTCPeerConnection for a remote peer
  const getOrCreatePeerConnection = useCallback(
    (remoteClientId: string, remoteUsername: string, roomId: string, initiator: boolean) => {
      const existing = peerConnectionsRef.current.get(remoteClientId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });

      peerConnectionsRef.current.set(remoteClientId, pc);

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
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
        const stream = e.streams?.[0];
        if (!stream) return;
        let audioEl = remoteAudioElementsRef.current.get(remoteClientId);
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          remoteAudioElementsRef.current.set(remoteClientId, audioEl);
        }
        audioEl.dataset.username = remoteUsername;
        audioEl.srcObject = stream;
        audioEl.muted = isDeafenedRef.current || isUserBlocked(remoteUsername);
        audioEl.play().catch(() => {});

        // Set up remote VAD speaking detector
        try {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
          const ctx = audioCtxRef.current;
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
    [sendVoiceSignal, isUserBlocked]
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
        const audio = remoteAudioElementsRef.current.get(fromClientId);
        if (audio) {
          audio.pause();
          audio.srcObject = null;
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
          await pc.setRemoteDescription(new RTCSessionDescription(sdpOrCandidate));
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
        if (pc) {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdpOrCandidate));
          } catch {}
        }
      } else if (
        signalType === "VOICE_ICE" &&
        targetClientId === myClientId &&
        activeVoiceRoomRef.current === roomId
      ) {
        const pc = peerConnectionsRef.current.get(fromClientId);
        if (pc && sdpOrCandidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(sdpOrCandidate));
          } catch {}
        }
      }
    },
    [getOrCreatePeerConnection, sendVoiceSignal]
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

    for (const audio of remoteAudioElementsRef.current.values()) {
      audio.pause();
      audio.srcObject = null;
    }
    remoteAudioElementsRef.current.clear();

    const myClientId = getClientId();
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

  // 1-second ticker only while Chat modal is open so active playtime updates without background re-renders
  useEffect(() => {
    if (!isOpen) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      if (!document.hidden) setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  // Poll chat & presence state gently (SSE handles real-time push; background poll acts as sync safety net)
  useEffect(() => {
    const fetchChatAndPresenceState = () => {
      if (document.hidden && initialStateLoadedRef.current) return;
      const isInitial = !initialStateLoadedRef.current;
      let authToken = "";
      try { authToken = localStorage.getItem("auth_token") || ""; } catch {}
      fetch(`/api/chat/state?username=${encodeURIComponent(cloudUser || "")}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          initialStateLoadedRef.current = true;
          if (Array.isArray(data.messages)) {
            for (const m of data.messages) {
              ingestIncomingMessage(m, { silent: isInitial });
            }
          }
          if (data.voiceRooms && typeof data.voiceRooms === "object") {
            setVoiceRooms((prev) => ({ ...prev, ...data.voiceRooms }));
          }
          if (Array.isArray(data.onlineUsers)) {
            setServerOnlineUsers(data.onlineUsers);
          }
          if (Array.isArray(data.offlineUsers)) {
            setServerOfflineUsers(data.offlineUsers);
          }
          if (Array.isArray(data.staffMods)) {
            setStaffMods(data.staffMods);
          }
          if (Array.isArray(data.ownerUsers)) {
            setOwnerUsers(data.ownerUsers);
          }
          if (typeof data.selfRole === "string") {
            setSelfRole(data.selfRole as ChatRole);
          } else {
            setSelfRole("member");
          }
          setSelfTimeout(data.selfTimeout || null);

          if (cloudUser && hydratedLocalCustomForRef.current !== cloudUser.toLowerCase()) {
            hydratedLocalCustomForRef.current = cloudUser.toLowerCase();
            const myRecord =
              (Array.isArray(data.onlineUsers) ? data.onlineUsers : []).find(
                (u: any) => u?.username?.toLowerCase() === cloudUser.toLowerCase()
              ) ||
              (Array.isArray(data.offlineUsers) ? data.offlineUsers : []).find(
                (u: any) => u?.username?.toLowerCase() === cloudUser.toLowerCase()
              );
            const localCustom = loadLocalProfileCustomization(cloudUser);
            if (myRecord?.customization) {
              const sanitized = sanitizeCustomization(myRecord.customization, cloudUser);
              setEditingCustom(sanitized);
              saveLocalProfileCustomization(cloudUser, sanitized);
            } else if (localCustom) {
              setEditingCustom(localCustom);
              if (authToken) {
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
            if (typeof myRecord?.bio === "string") setEditingBio(myRecord.bio);
            if (typeof myRecord?.statusText === "string") {
              setEditingStatusText(myRecord.statusText);
            }
          }
          if (Array.isArray(data.registeredUsers)) {
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

    fetchChatAndPresenceState();
    const pollInterval = window.setInterval(
      fetchChatAndPresenceState,
      isOpen ? 8000 : 45000
    );
    return () => window.clearInterval(pollInterval);
  }, [cloudUser, isOpen, ingestIncomingMessage]);

  useEffect(() => {
    setReplyingTo(null);
    setEditingMessageId(null);
    setConfirmDeleteChat(null);
  }, [activeChannel]);

  const filterMessagesLocally = useCallback(
    (predicate: (m: ChatMessage) => boolean) => {
      setMessages((prev) => {
        const next = prev.filter(predicate);
        if (next.length === prev.length) return prev;
        try {
          localStorage.setItem("cookie_chat_messages_v2", JSON.stringify(next));
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
          localStorage.setItem("cookie_chat_messages_v2", JSON.stringify(next));
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
      } else if (evtKind === "CHANNEL_CLEARED" && detail.channel) {
        const ch = String(detail.channel);
        const target = detail.targetUsername ? String(detail.targetUsername).toLowerCase() : "";
        filterMessagesLocally((m) => {
          if (m.channel !== ch) return true;
          if (target && m.author.toLowerCase() !== target) return true;
          return false;
        });
      } else if (evtKind === "STAFF_UPDATED") {
        if (Array.isArray(detail.staffMods)) setStaffMods(detail.staffMods);
        if (Array.isArray(detail.ownerUsers)) setOwnerUsers(detail.ownerUsers);
        if (cloudUser) {
          const lower = cloudUser.toLowerCase();
          const owners = Array.isArray(detail.ownerUsers) ? detail.ownerUsers : [];
          const mods = Array.isArray(detail.staffMods) ? detail.staffMods : [];
          if (owners.some((u: string) => u.toLowerCase() === lower)) {
            setSelfRole("owner");
          } else if (mods.some((u: string) => u.toLowerCase() === lower)) {
            setSelfRole("mod");
          } else {
            setSelfRole("member");
          }
        }
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

    const onSsePresence = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      if (Array.isArray(detail.onlineUsers)) {
        setServerOnlineUsers(detail.onlineUsers);
      }
      if (Array.isArray(detail.offlineUsers)) {
        setServerOfflineUsers(detail.offlineUsers);
      }
      if (Array.isArray(detail.registeredUsers)) {
        setRegisteredCloudSyncUsers(detail.registeredUsers);
      }
    };

    document.addEventListener("toggleChatModal", handleToggle);
    document.addEventListener("closeChatModal", handleClose);
    window.addEventListener("openProfileCustomizer", onOpenCustomizerEvt);
    window.addEventListener("sunshine-chat-event", onSseChat);
    window.addEventListener("sunshine-voice-event", onSseVoice);
    window.addEventListener("sunshine-presence-event", onSsePresence);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (editingMessageId) {
          setEditingMessageId(null);
        } else if (confirmDeleteChat) {
          setConfirmDeleteChat(null);
        } else if (showStaffModal) {
          setShowStaffModal(false);
        } else if (showCustomizer) {
          setShowCustomizer(false);
        } else if (showGifPicker) {
          setShowGifPicker(false);
        } else if (replyingTo) {
          setReplyingTo(null);
        } else if (viewingProfileUsername) {
          setViewingProfileUsername(null);
        } else {
          setIsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);

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
        } else if (event.data?.type === "CHANNEL_CLEARED" && event.data.channel) {
          filterMessagesLocally((m) => m.channel !== event.data.channel);
        } else if (event.data?.type === "VOICE_EVENT" && event.data.payload) {
          handleVoiceEvent(event.data.payload);
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
      window.removeEventListener("keydown", handleKeyDown);
      broadcastRef.current?.close();
    };
  }, [
    isOpen,
    editingMessageId,
    confirmDeleteChat,
    replyingTo,
    showStaffModal,
    showCustomizer,
    showGifPicker,
    viewingProfileUsername,
    cloudUser,
    ingestIncomingMessage,
    filterMessagesLocally,
    updateMessageLocally,
    handleVoiceEvent,
    handleOpenCustomizer,
  ]);

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

  // Close GIF picker when clicking outside
  useEffect(() => {
    if (!showGifPicker) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (gifPickerRef.current?.contains(target)) return;
      if (target.closest(".chat-gif-toggle-btn")) return;
      setShowGifPicker(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showGifPicker]);

  // Scroll to bottom when messages change or channel changes
  useEffect(() => {
    if (isOpen) {
      setUnreadCounts((prev) =>
        prev[activeChannel] ? { ...prev, [activeChannel]: 0 } : prev
      );
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 40);
    }
  }, [messages, isOpen, activeChannel]);

  const sendChatMessage = async (
    rawText: string,
    gif?: { url: string; title?: string }
  ) => {
    if (!cloudUser || isSending) return;
    const text = rawText.trim();
    const validGif = gif && isAllowedKlipyUrl(gif.url) ? gif : undefined;
    if (!text && !validGif) return;

    // Prevent sending DM to a user you have blocked or who does not exist in CloudSync
    if (activeChannel.startsWith("dm:")) {
      const partner = getDmPartnerName(activeChannel, cloudUser);
      if (isUserBlocked(partner)) {
        notifyToast(`unblock ${partner} before sending a direct message`, "error");
        return;
      }
      if (
        registeredCloudSyncUsers.length > 0 &&
        !registeredCloudSyncUsers.some((u) => u.toLowerCase() === partner.toLowerCase())
      ) {
        notifyToast(`user "@${partner}" does not exist in cloudsync`, "error");
        setActiveChannel("general");
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
        ...(activeReply
          ? {
              replyTo: {
                id: activeReply.id,
                author: activeReply.author,
                text: (activeReply.text || "").slice(0, 200),
                hasGif: Boolean(activeReply.gifUrl),
              },
            }
          : {}),
        timestamp: formatClockTime(new Date()),
        channel: activeChannel,
        recipient,
      };

      ingestIncomingMessage(newMsg);
      if (text) setInputText("");
      if (activeReply) setReplyingTo(null);
      if (validGif) setShowGifPicker(false);

      try {
        broadcastRef.current?.postMessage({ type: "NEW_MESSAGE", message: newMsg });
      } catch {}

      // Also broadcast via server SSE endpoint if available
      let sendToken = "";
      try { sendToken = localStorage.getItem("auth_token") || ""; } catch {}
      fetch("/api/chat/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sendToken ? { Authorization: `Bearer ${sendToken}` } : {}),
        },
        body: JSON.stringify({
          message: newMsg,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            filterMessagesLocally((m) => m.id !== newMsg.id);
            const errData = await res.json().catch(() => null);
            if (errData?.timedOut && errData.until !== undefined) {
              setSelfTimeout({ until: Number(errData.until) });
            }
            if (errData?.error) {
              notifyToast(errData.error, "error");
            }
          }
        })
        .catch(() => {});
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
      if (!cleanText && !msg.gifUrl) {
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

  const scrollToMessage = useCallback((msgId: string) => {
    const el = document.getElementById(`chat-msg-${msgId}`);
    if (!el) {
      notifyToast("original message is no longer in chat history", "info");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMsgId(msgId);
    window.setTimeout(() => {
      setHighlightedMsgId((cur) => (cur === msgId ? null : cur));
    }, 1600);
  }, []);

  const handleTimeoutUser = useCallback(
    async (targetUsername: string, durationMinutes: number) => {
      if (!cloudUser || !targetUsername) return;
      let token = "";
      try { token = localStorage.getItem("auth_token") || ""; } catch {}
      if (!token) return;
      try {
        const res = await fetch("/api/chat/mod/timeout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
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
        if (profileData && profileData.username.toLowerCase() === targetUsername.toLowerCase()) {
          setProfileData((prev) =>
            prev
              ? {
                  ...prev,
                  isTimedOut: durationMinutes > 0,
                  timeoutUntil: data.timeout?.until || 0,
                }
              : prev
          );
        }
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
    [cloudUser, profileData]
  );

  const handlePurgeUserMessages = useCallback(
    async (targetUsername: string) => {
      if (!cloudUser || !targetUsername) return;
      let token = "";
      try { token = localStorage.getItem("auth_token") || ""; } catch {}
      if (!token) return;
      try {
        const res = await fetch("/api/chat/mod/clear-channel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
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
        notifyToast(`cleared @${targetUsername}'s messages in #${activeChannel}`, "success");
      } catch {
        notifyToast("failed to purge messages", "error");
      }
    },
    [cloudUser, activeChannel, filterMessagesLocally]
  );

  const handleSendMessage = async (e?: Event) => {
    if (e) e.preventDefault();
    await sendChatMessage(inputText);
  };

  const handleSendGif = async (gif: KlipyGifItem) => {
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
      map.set(cloudUser.toLowerCase(), {
        username: cloudUser,
        color: stringToColor(cloudUser),
        status: "online",
        isSelf: true,
        game: myGameSession.game,
        isPlayingGame: myGameSession.isPlayingGame,
        gameStartedAt: myGameSession.gameStartedAt,
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
    if (activeChannel.startsWith("dm:")) {
      const partner = getDmPartnerName(activeChannel, cloudUser);
      const partnerOnline = onlineUsers.find(
        (u) => u.username.toLowerCase() === partner.toLowerCase()
      );
      let dmDesc = `direct message with @${partner} · offline`;
      if (partnerOnline) {
        if (partnerOnline.isPlayingGame && partnerOnline.game) {
          dmDesc = `@${partner} is online · playing ${partnerOnline.game} (${formatElapsedDuration(
            partnerOnline.gameStartedAt,
            nowMs
          )})`;
        } else {
          dmDesc = `@${partner} is online · browsing`;
        }
      }
      return {
        id: activeChannel,
        name: partner,
        icon: "fa-at",
        isDm: true,
        isVoice: false,
        desc: dmDesc,
      };
    }
    const voiceFound = VOICE_CHANNELS.find((v) => v.id === activeChannel);
    if (voiceFound) {
      return {
        ...voiceFound,
        isDm: false,
        isVoice: true,
        desc: `voice & text lounge · ${voiceFound.name}`,
      };
    }
    for (const cat of TEXT_CATEGORIES) {
      const found = cat.channels.find((c) => c.id === activeChannel);
      if (found) {
        return {
          ...found,
          isDm: false,
          isVoice: false,
          desc: `welcome to the #${found.name} channel`,
        };
      }
    }
    return {
      id: activeChannel,
      name: activeChannel,
      icon: "fa-hashtag",
      isDm: false,
      isVoice: false,
      desc: `welcome to #${activeChannel}`,
    };
  }, [activeChannel, cloudUser, onlineUsers, nowMs]);

  const currentDmPartner = activeChannelDef.isDm ? activeChannelDef.name : null;
  const isCurrentDmBlocked = currentDmPartner ? isUserBlocked(currentDmPartner) : false;

  // Determine if we should show the Voice Stage in the center column
  const stageVoiceRoomId = activeChannelDef.isVoice
    ? activeChannelDef.id
    : activeVoiceRoom && activeVoiceRoom === `voice:${activeChannel}`
    ? activeVoiceRoom
    : null;

  const stageParticipants = stageVoiceRoomId ? voiceRooms[stageVoiceRoomId] || [] : [];

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
          </div>

          <div class="chat-sidebar-scroll">
            {/* Text Channel Categories */}
            {TEXT_CATEGORIES.map((cat) => {
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
                          </div>
                          {unread > 0 && <span class="chat-unread-badge">{unread}</span>}
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
                  <div class={`chat-user-dot ${editingCustom.presenceStatus || "online"}`}></div>
                </div>
                <div class="chat-sidebar-user-info">
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0 }}>
                    <span class={`chat-sidebar-username ${getNameClasses(editingCustom)}`}>
                      {editingCustom.displayName || cloudUser}
                    </span>
                    <RoleBadge role={selfRole} />
                  </div>
                  <span class="chat-sidebar-status">
                    <span style={{ fontSize: "8px" }}>●</span>{" "}
                    {editingStatusText ||
                      (editingCustom.presenceStatus === "dnd"
                        ? "do not disturb"
                        : editingCustom.presenceStatus || "online")}
                  </span>
                  {myGameSession.isPlayingGame && myGameSession.game && (
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
                  title="Customize profile & animations"
                  style={{ opacity: 0.9 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleOpenCustomizer();
                  }}
                >
                  <i class="fa-solid fa-wand-magic-sparkles"></i>
                </button>
                <button
                  type="button"
                  class="chat-user-mini-btn"
                  title="View your profile"
                  style={{ opacity: 0.85 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openUserProfile(cloudUser);
                  }}
                >
                  <i class="fa-solid fa-id-card"></i>
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
        <div class="chat-main">
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

              {/* Public Channel Clear Chat Action for Owner/Mod */}
              {!activeChannelDef.isDm &&
                !activeChannelDef.isVoice &&
                cloudUser &&
                (selfRole === "owner" || selfRole === "mod") && (
                  <button
                    type="button"
                    class="chat-header-btn danger"
                    title={`Clear all messages in #${activeChannelDef.name}`}
                    onClick={() => setConfirmDeleteChat(activeChannel)}
                  >
                    <i class="fa-solid fa-broom"></i>
                    <span>clear chat</span>
                  </button>
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
                  class="chat-header-btn"
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
                          <RoleBadge role={vMeta?.role} />
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
          <div class="chat-feed">
            {channelMessages.length === 0 ? (
              <div class="chat-empty-state">
                <i class={`fa-solid ${activeChannelDef.icon}`}></i>
                <p>
                  {activeChannelDef.isDm
                    ? `start a direct conversation with @${activeChannelDef.name}`
                    : `welcome to #${activeChannelDef.name}`}
                </p>
                <span style={{ fontSize: "11px" }}>
                  openai moderation enabled (excluding swear words)
                </span>
              </div>
            ) : (
              channelMessages.map((msg, idx) => {
                const isGrouped = shouldGroupMessages(channelMessages[idx - 1], msg);
                const isSelf =
                  cloudUser && msg.author.toLowerCase() === cloudUser.toLowerCase();
                const authorMeta = userMetaMap.get(msg.author.toLowerCase());
                const msgCustom = authorMeta?.customization || msg.customization || null;
                const authorRole = authorMeta?.role || msg.role || "member";
                const canDeleteMsg = Boolean(
                  cloudUser &&
                    (isSelf ||
                      (!activeChannel.startsWith("dm:") &&
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
                  ? { ...replyMeta.customization, avatarDecoration: "none" as const }
                  : null;
                const isEditingThis = editingMessageId === msg.id;

                return (
                  <div
                    key={msg.id}
                    id={`chat-msg-${msg.id}`}
                    class={`chat-entry ${isGrouped ? "is-grouped" : ""} ${
                      replyRef ? "has-reply" : ""
                    } ${highlightedMsgId === msg.id ? "is-highlighted" : ""}`}
                  >
                    {replyRef && (
                      <div
                        class="chat-reply-context"
                        title="Jump to original message"
                        onClick={() => scrollToMessage(replyRef.id)}
                      >
                        <span class="chat-reply-spine" aria-hidden="true" />
                        <UserAvatar
                          username={replyRef.author}
                          custom={replyMiniCustom}
                          fallbackColor={stringToColor(replyRef.author)}
                          className="chat-reply-mini-avatar"
                        />
                        <span class={`chat-reply-author ${getNameClasses(replyMeta?.customization)}`}>
                          @{replyAuthorLabel}
                        </span>
                        <span class="chat-reply-snippet">
                          {replyRef.text ? replyRef.text : replyRef.hasGif ? "clicked to see GIF" : "message"}
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
                          fallbackColor={msg.avatarColor || stringToColor(msg.author)}
                          className="chat-entry-avatar"
                          title={`View @${msg.author}'s profile`}
                          onClick={() => openUserProfile(msg.author)}
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
                              onClick={() => openUserProfile(msg.author)}
                            >
                              {displayName}
                            </span>
                            <RoleBadge role={authorRole} />
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
                              void handleSaveEditMessage(msg);
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
                                setEditingMessageText((e.target as HTMLInputElement).value)
                              }
                            />
                            <div class="chat-edit-meta-row">
                              <span>escape to cancel · enter to save</span>
                              <div style={{ display: "flex", gap: "6px" }}>
                                <button
                                  type="button"
                                  class="chat-gif-more-btn"
                                  onClick={() => setEditingMessageId(null)}
                                >
                                  cancel
                                </button>
                                <button
                                  type="submit"
                                  class="chat-gif-more-btn"
                                  disabled={savingEdit}
                                  style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-text)" }}
                                >
                                  {savingEdit ? "saving..." : "save"}
                                </button>
                              </div>
                            </div>
                          </form>
                        ) : (
                          msg.text && (
                            <div class="chat-entry-text">
                              {renderFormattedText(msg.text)}
                              {msg.edited && <span class="chat-msg-edited">(edited)</span>}
                            </div>
                          )
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
                      </div>
                    </div>

                    {/* Hover actions on each message */}
                    <div class="chat-entry-actions">
                      <button
                        type="button"
                        class="chat-entry-action-btn"
                        title={`View @${msg.author}'s profile`}
                        onClick={() => openUserProfile(msg.author)}
                      >
                        <i class="fa-solid fa-id-card"></i>
                      </button>
                      {cloudUser && (
                        <button
                          type="button"
                          class="chat-entry-action-btn"
                          title={`Reply to @${msg.author}`}
                          onClick={() => {
                            setReplyingTo(msg);
                            window.setTimeout(() => chatInputRef.current?.focus(), 20);
                          }}
                        >
                          <i class="fa-solid fa-reply"></i>
                        </button>
                      )}
                      {isSelf && !isEditingThis && (
                        <button
                          type="button"
                          class="chat-entry-action-btn"
                          title="Edit message"
                          onClick={() => handleStartEditMessage(msg)}
                        >
                          <i class="fa-solid fa-pen"></i>
                        </button>
                      )}
                      {!isSelf && (
                        <>
                          <button
                            type="button"
                            class="chat-entry-action-btn"
                            title={`Direct message @${msg.author}`}
                            onClick={() => openDirectMessage(msg.author)}
                          >
                            <i class="fa-solid fa-paper-plane"></i>
                          </button>
                          <button
                            type="button"
                            class="chat-entry-action-btn danger"
                            title={`Block @${msg.author}`}
                            onClick={() => toggleBlockUser(msg.author)}
                          >
                            <i class="fa-solid fa-ban"></i>
                          </button>
                        </>
                      )}
                      {canDeleteMsg && (
                        <button
                          type="button"
                          class="chat-entry-action-btn danger"
                          title="Delete message"
                          onClick={() => void handleDeleteMessage(msg)}
                        >
                          <i class="fa-solid fa-trash-can"></i>
                        </button>
                      )}
                    </div>
                  </div>
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
                        {replyingTo.text ? `— ${replyingTo.text}` : replyingTo.gifUrl ? "— [GIF]" : ""}
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
                <form class="chat-input-pill" onSubmit={handleSendMessage}>
                  <input
                    ref={chatInputRef}
                    type="text"
                    class="chat-input-field"
                    placeholder={
                      activeChannelDef.isDm
                        ? `message @${activeChannelDef.name}...`
                        : `message #${activeChannelDef.name}...`
                    }
                    value={inputText}
                    onInput={(e) => setInputText((e.target as HTMLInputElement).value)}
                    maxLength={500}
                  />
                  <button
                    type="button"
                    class={`chat-gif-toggle-btn${showGifPicker ? " active" : ""}`}
                    title="Send a GIF via KLIPY"
                    onClick={() => setShowGifPicker((v) => !v)}
                  >
                    GIF
                  </button>
                  <button
                    type="submit"
                    class="chat-submit-btn"
                    disabled={!inputText.trim() || isSending}
                    title="Send message"
                  >
                    <i class="fa-solid fa-paper-plane"></i>
                  </button>
                </form>
              </>
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
                const playingActive = Boolean(u.isPlayingGame && u.game && u.game !== "browsing");
                const uCustom = u.customization || null;
                const npClass =
                  uCustom?.nameplate && uCustom.nameplate !== "none"
                    ? `has-nameplate nameplate-${uCustom.nameplate}`
                    : "";
                const dotStatus = uCustom?.presenceStatus || "online";
                const displayName = uCustom?.displayName?.trim() || u.username;
                return (
                  <div key={`online_${u.username}`} class={`chat-user-item ${npClass}`}>
                    <div
                      class="chat-user-avatar-wrap"
                      title={`View @${u.username}'s profile`}
                      onClick={() => openUserProfile(u.username)}
                    >
                      <UserAvatar
                        username={u.username}
                        custom={uCustom}
                        fallbackColor={u.color}
                        className="chat-user-avatar"
                        opacity={blocked ? 0.45 : 1}
                      />
                      <div class={`chat-user-dot ${dotStatus}`}></div>
                    </div>
                    <div
                      class="chat-user-meta"
                      title={`View @${u.username}'s profile`}
                      onClick={() => openUserProfile(u.username)}
                    >
                      <div class="chat-user-name-row">
                        <span
                          class={`chat-user-name ${getNameClasses(uCustom)}`}
                          style={
                            blocked
                              ? { textDecoration: "line-through", opacity: 0.6 }
                              : undefined
                          }
                        >
                          {displayName}
                        </span>
                        <RoleBadge role={u.role} />
                        {u.isTimedOut && (
                          <span class="chat-role-badge muted-pill">muted</span>
                        )}
                        {u.isSelf && <span class="chat-you-pill">you</span>}
                      </div>
                      {playingActive ? (
                        <div class="chat-user-game-sub" title={`Playing ${u.game}`}>
                          <i class="fa-solid fa-gamepad"></i>
                          <span>
                            playing {u.game} · {formatElapsedDuration(u.gameStartedAt, nowMs)}
                          </span>
                        </div>
                      ) : (
                        <div class="chat-user-status-sub">
                          {u.statusText ? u.statusText : "online"}
                        </div>
                      )}
                    </div>

                    <div class="chat-user-actions">
                      <button
                        type="button"
                        class="chat-user-mini-btn"
                        title={u.isSelf ? "View your profile" : `View @${u.username}'s profile`}
                        onClick={() => openUserProfile(u.username)}
                      >
                        <i class="fa-solid fa-id-card"></i>
                      </button>
                      {!u.isSelf && (
                        <>
                          <button
                            type="button"
                            class="chat-user-mini-btn"
                            title={`Direct message ${u.username}`}
                            onClick={() => openDirectMessage(u.username)}
                          >
                            <i class="fa-solid fa-comment-dots"></i>
                          </button>
                          <button
                            type="button"
                            class={`chat-user-mini-btn ${blocked ? "blocked" : ""}`}
                            title={blocked ? `Unblock ${u.username}` : `Block ${u.username}`}
                            onClick={() => toggleBlockUser(u.username)}
                          >
                            <i class="fa-solid fa-ban"></i>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Offline Users Section */}
            <div class="chat-offline-section">
              <div class="chat-section-sub-header">
                <span>offline · {offlineUsers.length}</span>
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
                offlineUsers.map((u) => {
                  const blocked = isUserBlocked(u.username);
                  const uCustom = u.customization || null;
                  const npClass =
                    uCustom?.nameplate && uCustom.nameplate !== "none"
                      ? `has-nameplate nameplate-${uCustom.nameplate}`
                      : "";
                  const displayName = uCustom?.displayName?.trim() || u.username;
                  return (
                    <div key={`offline_${u.username}`} class={`chat-user-item offline ${npClass}`}>
                      <div
                        class="chat-user-avatar-wrap"
                        title={`View @${u.username}'s profile`}
                        onClick={() => openUserProfile(u.username)}
                      >
                        <UserAvatar
                          username={u.username}
                          custom={uCustom}
                          fallbackColor={u.color}
                          className="chat-user-avatar"
                          opacity={blocked ? 0.35 : 0.65}
                        />
                        <div class="chat-user-dot offline"></div>
                      </div>
                      <div
                        class="chat-user-meta"
                        title={`View @${u.username}'s profile`}
                        onClick={() => openUserProfile(u.username)}
                      >
                        <div class="chat-user-name-row">
                          <span
                            class={`chat-user-name ${getNameClasses(uCustom)}`}
                            style={{
                              opacity: blocked ? 0.45 : 0.78,
                              textDecoration: blocked ? "line-through" : undefined,
                            }}
                          >
                            {displayName}
                          </span>
                          <RoleBadge role={u.role} />
                        </div>
                        <div class="chat-user-status-sub offline">
                          {u.statusText ? u.statusText : "offline"}
                        </div>
                      </div>

                      <div class="chat-user-actions">
                        <button
                          type="button"
                          class="chat-user-mini-btn"
                          title={`View @${u.username}'s profile`}
                          onClick={() => openUserProfile(u.username)}
                        >
                          <i class="fa-solid fa-id-card"></i>
                        </button>
                        <button
                          type="button"
                          class="chat-user-mini-btn"
                          title={`Direct message ${u.username}`}
                          onClick={() => openDirectMessage(u.username)}
                        >
                          <i class="fa-solid fa-comment-dots"></i>
                        </button>
                        <button
                          type="button"
                          class={`chat-user-mini-btn ${blocked ? "blocked" : ""}`}
                          title={blocked ? `Unblock ${u.username}` : `Block ${u.username}`}
                          onClick={() => toggleBlockUser(u.username)}
                        >
                          <i class="fa-solid fa-ban"></i>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

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
              if (e.target === e.currentTarget) setViewingProfileUsername(null);
            }}
          >
            {(() => {
              const targetName = profileData?.username || viewingProfileUsername;
              const isViewingSelf = Boolean(
                cloudUser && targetName.toLowerCase() === cloudUser.toLowerCase()
              );
              const metaMatch = userMetaMap.get(targetName.toLowerCase());
              const onlineMatch = onlineUsers.find(
                (u) => u.username.toLowerCase() === targetName.toLowerCase()
              );
              const isOnlineNow = isViewingSelf || Boolean(onlineMatch || profileData?.online);
              const activeGameName = isViewingSelf
                ? myGameSession.isPlayingGame
                  ? myGameSession.game
                  : ""
                : onlineMatch?.isPlayingGame
                ? onlineMatch.game || ""
                : profileData?.isPlayingGame
                ? profileData.game
                : "";
              const activeGameStart = isViewingSelf
                ? myGameSession.gameStartedAt
                : onlineMatch?.gameStartedAt || profileData?.gameStartedAt || 0;
              const avatarCol = stringToColor(targetName);
              const blocked = isUserBlocked(targetName);

              const custom = isViewingSelf
                ? editingCustom
                : sanitizeCustomization(
                    profileData?.customization || metaMatch?.customization,
                    targetName
                  );
              const targetRole: ChatRole =
                (isViewingSelf ? selfRole : profileData?.role || metaMatch?.role) ||
                (ownerUsers.some((o) => o.toLowerCase() === targetName.toLowerCase())
                  ? "owner"
                  : staffMods.some((m) => m.toLowerCase() === targetName.toLowerCase())
                  ? "mod"
                  : "member");
              const targetTimedOut = Boolean(
                profileData?.isTimedOut ||
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
              const dotClass = isOnlineNow ? custom.presenceStatus || "online" : "offline";
              const canModTarget = Boolean(
                !isViewingSelf &&
                  (selfRole === "owner" || selfRole === "mod") &&
                  targetRole !== "owner" &&
                  (selfRole === "owner" || targetRole !== "mod")
              );

              return (
                <div
                  class={`chat-profile-card theme-${custom.cardTheme} ${
                    custom.profileEffect === "lightning-border" ? "effect-lightning-border" : ""
                  }`}
                  style={custom.cardBgColor ? { background: custom.cardBgColor } : undefined}
                >
                  <ProfileEffectLayer effect={custom.profileEffect} />

                  <div class="chat-profile-scroll">
                    <div class={`chat-profile-banner ${bannerClass}`} style={bannerStyle}>
                      {isViewingSelf && (
                        <button
                          type="button"
                          class="chat-profile-close-btn"
                          style={{ right: "44px", width: "auto", padding: "0 10px", gap: "5px" }}
                          title="Customize pfp, gif banner, animated frames & effects"
                          onClick={() => {
                            setViewingProfileUsername(null);
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
                        onClick={() => setViewingProfileUsername(null)}
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

                        <div class="chat-profile-badges">
                          {custom.customTag && (
                            <span class="chat-role-badge custom-tag">{custom.customTag}</span>
                          )}
                          {(profileData?.cloudSyncVerified ?? true) && (
                            <span class="chat-profile-badge verified">
                              <i class="fa-solid fa-cloud"></i> cloudsync
                            </span>
                          )}
                          {targetTimedOut && (
                            <span class="chat-role-badge muted-pill">
                              <i class="fa-solid fa-comment-slash"></i> timed out
                            </span>
                          )}
                          {isViewingSelf && (
                            <span class="chat-profile-badge self">you</span>
                          )}
                          <span
                            class={`chat-profile-badge ${isOnlineNow ? "online" : "offline"}`}
                          >
                            {isOnlineNow
                              ? dotClass === "dnd"
                                ? "● dnd"
                                : dotClass === "idle"
                                ? "● idle"
                                : "● online"
                              : "○ offline"}
                          </span>
                        </div>
                      </div>

                      <div class="chat-profile-identity">
                        <div class="chat-profile-name-row">
                          <h3 class={`chat-profile-username ${getNameClasses(custom)}`}>
                            {displayLabel}
                          </h3>
                          <RoleBadge role={targetRole} />
                        </div>
                        <div class="chat-profile-handle-row">
                          <span>@{targetName}</span>
                          {custom.pronouns && <span>· {custom.pronouns}</span>}
                        </div>
                        {profileData?.statusText && !isViewingSelf && (
                          <div class="chat-profile-custom-status">{profileData.statusText}</div>
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

                      {/* Bio / About Section (Editable for Own Profile + Joined Date) */}
                      {isViewingSelf ? (
                        <form class="chat-profile-edit-form" onSubmit={handleSaveMyProfile}>
                          <div class="chat-profile-section-title">your status & bio</div>
                          <input
                            type="text"
                            class="chat-mod-input"
                            placeholder="custom status (e.g. grinding slope)..."
                            maxLength={60}
                            value={editingStatusText}
                            onInput={(e) =>
                              setEditingStatusText((e.target as HTMLInputElement).value)
                            }
                          />
                          <textarea
                            class="chat-mod-input chat-profile-bio-textarea"
                            placeholder="write a short bio for your profile..."
                            maxLength={220}
                            rows={2}
                            value={editingBio}
                            onInput={(e) =>
                              setEditingBio((e.target as HTMLTextAreaElement).value)
                            }
                          />
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              class="chat-profile-pill-btn"
                              onClick={() => {
                                setViewingProfileUsername(null);
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
                            {profileData?.bio || "no bio set yet."}
                          </div>
                          {profileData?.createdAt && (
                            <div class="chat-profile-joined">
                              <i class="fa-solid fa-calendar-days"></i> member since{" "}
                              {new Date(profileData.createdAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Game & Leaderboard Stats */}
                      <div class="chat-profile-section">
                        <div class="chat-profile-section-title">game & studio stats</div>
                        {profileLoading && !profileData ? (
                          <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                            loading profile stats...
                          </div>
                        ) : (
                          <>
                            <div class="chat-profile-stats-grid">
                              <div class="chat-profile-stat-pill">
                                <span class="chat-profile-stat-val">
                                  {formatPlayTime(profileData?.stats?.totalSeconds || 0)}
                                </span>
                                <span class="chat-profile-stat-lbl">total time played</span>
                              </div>
                              <div class="chat-profile-stat-pill">
                                <span class="chat-profile-stat-val">
                                  {profileData?.stats?.totalPlays || 0}
                                </span>
                                <span class="chat-profile-stat-lbl">total game sessions</span>
                              </div>
                              <div class="chat-profile-stat-pill">
                                <span class="chat-profile-stat-val">
                                  {profileData?.publishedGamesCount || 0}
                                </span>
                                <span class="chat-profile-stat-lbl">published games</span>
                              </div>
                            </div>

                            {profileData?.studio && (
                              <div class="chat-profile-studio-row">
                                <i
                                  class={`fa-solid ${profileData.studio.icon || "fa-rocket"}`}
                                  style={{ color: profileData.studio.color || "#60a5fa" }}
                                ></i>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: "12px" }}>
                                    {profileData.studio.name}
                                  </div>
                                  <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                                    {profileData.studio.tagline}
                                  </div>
                                </div>
                              </div>
                            )}

                            {profileData?.stats?.topGames &&
                              profileData.stats.topGames.length > 0 && (
                                <div class="chat-profile-top-games">
                                  {profileData.stats.topGames.slice(0, 3).map((g) => (
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
                                setViewingProfileUsername(null);
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
                              setViewingProfileUsername(null);
                              joinVoiceRoom(`voice:${dmChan}`);
                            }}
                          >
                            <i class="fa-solid fa-phone-volume"></i> voice call @{targetName}
                          </button>

                          {canModTarget && (
                            <div class="chat-profile-section" style={{ borderColor: "rgba(45, 212, 191, 0.28)" }}>
                              <div class="chat-profile-section-title" style={{ color: "#5eead4" }}>
                                <i class="fa-solid fa-shield-halved"></i> staff moderation
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
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
                              </div>
                            </div>
                          )}
                        </>
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
            createdAt={profileData?.createdAt || userMetaMap.get(cloudUser.toLowerCase())?.createdAt}
            initialCustom={editingCustom}
            initialBio={editingBio}
            initialStatusText={editingStatusText}
            saving={savingProfile}
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
      </div>
    </div>
  );
}
