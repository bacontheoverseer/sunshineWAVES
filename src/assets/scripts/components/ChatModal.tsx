import { useEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import { moderateChatMessage } from "../core/contentFilter.ts";
import { getClientId, detectCurrentGameSession } from "../core/liveClient.ts";
import { formatPlayTime } from "../core/cookieCoins.ts";

interface ChatMessage {
  id: string;
  author: string;
  avatarColor: string;
  text: string;
  timestamp: string;
  channel: string;
  recipient?: string | null;
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
  createdAt?: string | null;
}

interface UserProfileDetails {
  id: number | null;
  username: string;
  createdAt: string | null;
  cloudSyncVerified: boolean;
  bio: string;
  statusText: string;
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

  // User Profile Modal state (view own profile or any other user's profile)
  const [viewingProfileUsername, setViewingProfileUsername] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<UserProfileDetails | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [editingBio, setEditingBio] = useState("");
  const [editingStatusText, setEditingStatusText] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

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

  const handleSaveMyProfile = useCallback(
    async (e?: Event) => {
      if (e) e.preventDefault();
      if (!cloudUser || savingProfile) return;
      setSavingProfile(true);
      try {
        const res = await fetch("/api/chat/user-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: cloudUser,
            bio: editingBio,
            statusText: editingStatusText,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          notifyToast(data?.error || "could not update profile", "error");
          return;
        }
        setProfileData((prev) =>
          prev
            ? {
                ...prev,
                bio: data.profile?.bio ?? editingBio,
                statusText: data.profile?.statusText ?? editingStatusText,
              }
            : prev
        );
        notifyToast("profile updated!", "success");
      } catch {
        notifyToast("failed to save profile", "error");
      } finally {
        setSavingProfile(false);
      }
    },
    [cloudUser, editingBio, editingStatusText, savingProfile]
  );

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
        if (prev.some((m) => m.id === incoming.id)) return prev;
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
            notifyDmOrMentionToast(incoming.author, incoming.text, isDm, () => {
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
    const checkAuth = () => {
      try {
        const stored = localStorage.getItem("auth_user");
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

    window.addEventListener("storage", checkAuth);
    const interval = setInterval(checkAuth, 1500);
    return () => {
      window.removeEventListener("storage", checkAuth);
      clearInterval(interval);
    };
  }, []);

  // 1-second ticker so active game playtime on profiles updates live every second
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Poll chat & presence state in background even when Chat modal is closed (while playing games or browsing)
  useEffect(() => {
    const fetchChatAndPresenceState = () => {
      const isInitial = !initialStateLoadedRef.current;
      fetch(`/api/chat/state?username=${encodeURIComponent(cloudUser || "")}`)
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
    const pollInterval = window.setInterval(fetchChatAndPresenceState, 5000);
    return () => window.clearInterval(pollInterval);
  }, [cloudUser, isOpen, ingestIncomingMessage]);

  // Modal open / close handlers, SSE custom events & BroadcastChannel
  useEffect(() => {
    const handleToggle = () => setIsOpen((prev) => !prev);
    const handleClose = () => setIsOpen(false);

    const onSseChat = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) ingestIncomingMessage(detail.message);
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
    window.addEventListener("sunshine-chat-event", onSseChat);
    window.addEventListener("sunshine-voice-event", onSseVoice);
    window.addEventListener("sunshine-presence-event", onSsePresence);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (viewingProfileUsername) {
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
        } else if (event.data?.type === "VOICE_EVENT" && event.data.payload) {
          handleVoiceEvent(event.data.payload);
        }
      };
      broadcastRef.current = bc;
    } catch {}

    return () => {
      document.removeEventListener("toggleChatModal", handleToggle);
      document.removeEventListener("closeChatModal", handleClose);
      window.removeEventListener("sunshine-chat-event", onSseChat);
      window.removeEventListener("sunshine-voice-event", onSseVoice);
      window.removeEventListener("sunshine-presence-event", onSsePresence);
      window.removeEventListener("keydown", handleKeyDown);
      broadcastRef.current?.close();
    };
  }, [isOpen, viewingProfileUsername, ingestIncomingMessage, handleVoiceEvent]);

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

  const handleSendMessage = async (e?: Event) => {
    if (e) e.preventDefault();
    if (!cloudUser || isSending) return;
    const text = inputText.trim();
    if (!text) return;

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
      const modResult = await moderateChatMessage(text);
      if (modResult.blocked) {
        notifyToast(modResult.reason || "message blocked by openai moderation", "error");
        setIsSending(false);
        return;
      }

      const recipient = activeChannel.startsWith("dm:")
        ? getDmPartnerName(activeChannel, cloudUser)
        : null;

      const newMsg: ChatMessage = {
        id: "msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        author: cloudUser,
        avatarColor: stringToColor(cloudUser),
        text,
        timestamp: formatClockTime(new Date()),
        channel: activeChannel,
        recipient,
      };

      ingestIncomingMessage(newMsg);
      setInputText("");

      try {
        broadcastRef.current?.postMessage({ type: "NEW_MESSAGE", message: newMsg });
      } catch {}

      // Also broadcast via server SSE endpoint if available
      fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: newMsg,
        }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const errData = await res.json().catch(() => null);
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
        bio: myServerRecord?.bio || "",
        statusText: myServerRecord?.statusText || "",
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
          createdAt: su.createdAt || null,
        });
      }
    }
    return Array.from(map.values());
  }, [cloudUser, serverOnlineUsers, myGameSession]);

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
          lastSeen: off.lastSeen,
          bio: off.bio || "",
          statusText: off.statusText || "",
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
                            return (
                              <div key={m.clientId} class="chat-voice-sidebar-member">
                                <div
                                  class={`chat-voice-sidebar-avatar ${
                                    isSpeaking ? "speaking" : ""
                                  }`}
                                  style={{ backgroundColor: m.avatarColor }}
                                >
                                  {m.username.slice(0, 1).toLowerCase()}
                                </div>
                                <span style={{ flex: 1 }}>{m.username}</span>
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
                      <button
                        key={dmId}
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
                  <div
                    class="chat-user-avatar"
                    style={{
                      backgroundColor: stringToColor(cloudUser),
                      width: "32px",
                      height: "32px",
                      fontSize: "13px",
                      fontWeight: "600",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {cloudUser.slice(0, 1).toLowerCase()}
                  </div>
                  <div class="chat-user-dot"></div>
                </div>
                <div class="chat-sidebar-user-info">
                  <span class="chat-sidebar-username">{cloudUser}</span>
                  <span class="chat-sidebar-status">
                    <span style={{ fontSize: "8px" }}>●</span> online
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
                    return (
                      <div
                        key={p.clientId}
                        class={`chat-voice-card ${isSpeaking ? "speaking" : ""}`}
                      >
                        <div
                          class="chat-voice-card-avatar"
                          style={{ backgroundColor: p.avatarColor, cursor: "pointer" }}
                          title={`View @${p.username}'s profile`}
                          onClick={() => openUserProfile(p.username)}
                        >
                          {p.username.slice(0, 1).toLowerCase()}
                        </div>
                        <div
                          class="chat-voice-card-name"
                          style={{ cursor: "pointer" }}
                          onClick={() => openUserProfile(p.username)}
                        >
                          <span>{p.username}</span>
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
              channelMessages.map((msg) => {
                const isSelf =
                  cloudUser && msg.author.toLowerCase() === cloudUser.toLowerCase();
                return (
                  <div key={msg.id} class="chat-entry">
                    <div
                      class="chat-entry-avatar"
                      style={{
                        backgroundColor: msg.avatarColor || stringToColor(msg.author),
                      }}
                      title={`View @${msg.author}'s profile`}
                      onClick={() => openUserProfile(msg.author)}
                    >
                      {msg.author.slice(0, 1).toLowerCase()}
                    </div>
                    <div class="chat-entry-content">
                      <div class="chat-entry-header">
                        <span
                          class={`chat-entry-author ${isSelf ? "is-self" : ""}`}
                          title={`View @${msg.author}'s profile`}
                          onClick={() => openUserProfile(msg.author)}
                        >
                          {msg.author}
                        </span>
                        <span class="chat-entry-time">{msg.timestamp}</span>
                      </div>
                      <div class="chat-entry-text">{renderFormattedText(msg.text)}</div>
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
                      {!isSelf && (
                        <>
                          <button
                            type="button"
                            class="chat-entry-action-btn"
                            title={`Reply to @${msg.author}`}
                            onClick={() =>
                              setInputText((prev) =>
                                prev.includes(`@${msg.author}`)
                                  ? prev
                                  : `@${msg.author} ${prev}`
                              )
                            }
                          >
                            <i class="fa-solid fa-reply"></i>
                          </button>
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
            ) : (
              <form class="chat-input-pill" onSubmit={handleSendMessage}>
                <input
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
                  type="submit"
                  class="chat-submit-btn"
                  disabled={!inputText.trim() || isSending}
                  title="Send message"
                >
                  <i class="fa-solid fa-paper-plane"></i>
                </button>
              </form>
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
                return (
                  <div key={`online_${u.username}`} class="chat-user-item">
                    <div
                      class="chat-user-avatar-wrap"
                      title={`View @${u.username}'s profile`}
                      onClick={() => openUserProfile(u.username)}
                    >
                      <div
                        class="chat-user-avatar"
                        style={{
                          backgroundColor: u.color,
                          opacity: blocked ? 0.45 : 1,
                        }}
                      >
                        {u.username.slice(0, 1).toLowerCase()}
                      </div>
                      <div class="chat-user-dot"></div>
                    </div>
                    <div
                      class="chat-user-meta"
                      title={`View @${u.username}'s profile`}
                      onClick={() => openUserProfile(u.username)}
                    >
                      <div class="chat-user-name-row">
                        <span
                          class="chat-user-name"
                          style={
                            blocked
                              ? { textDecoration: "line-through", opacity: 0.6 }
                              : undefined
                          }
                        >
                          {u.username}
                        </span>
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
                  return (
                    <div key={`offline_${u.username}`} class="chat-user-item offline">
                      <div
                        class="chat-user-avatar-wrap"
                        title={`View @${u.username}'s profile`}
                        onClick={() => openUserProfile(u.username)}
                      >
                        <div
                          class="chat-user-avatar"
                          style={{
                            backgroundColor: u.color,
                            opacity: blocked ? 0.35 : 0.55,
                          }}
                        >
                          {u.username.slice(0, 1).toLowerCase()}
                        </div>
                        <div class="chat-user-dot offline"></div>
                      </div>
                      <div
                        class="chat-user-meta"
                        title={`View @${u.username}'s profile`}
                        onClick={() => openUserProfile(u.username)}
                      >
                        <div class="chat-user-name-row">
                          <span
                            class="chat-user-name"
                            style={{
                              opacity: blocked ? 0.45 : 0.7,
                              textDecoration: blocked ? "line-through" : undefined,
                            }}
                          >
                            {u.username}
                          </span>
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

              return (
                <div class="chat-profile-card">
                  <div
                    class="chat-profile-banner"
                    style={{
                      background: `linear-gradient(135deg, ${avatarCol}, #18181b)`,
                    }}
                  >
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
                      <div class="chat-profile-avatar-lg" style={{ backgroundColor: avatarCol }}>
                        {targetName.slice(0, 1).toLowerCase()}
                        <span
                          class={`chat-profile-status-dot ${isOnlineNow ? "online" : "offline"}`}
                        ></span>
                      </div>

                      <div class="chat-profile-badges">
                        {(profileData?.cloudSyncVerified ?? true) && (
                          <span class="chat-profile-badge verified">
                            <i class="fa-solid fa-cloud"></i> cloudsync verified
                          </span>
                        )}
                        {isViewingSelf && (
                          <span class="chat-profile-badge self">you</span>
                        )}
                        <span
                          class={`chat-profile-badge ${isOnlineNow ? "online" : "offline"}`}
                        >
                          {isOnlineNow ? "● online" : "○ offline"}
                        </span>
                      </div>
                    </div>

                    <div class="chat-profile-identity">
                      <h3 class="chat-profile-username">@{targetName}</h3>
                      {profileData?.statusText && !isViewingSelf && (
                        <div class="chat-profile-custom-status">{profileData.statusText}</div>
                      )}
                      {profileData?.createdAt && (
                        <div class="chat-profile-joined">
                          <i class="fa-regular fa-calendar"></i> member since{" "}
                          {new Date(profileData.createdAt).toLocaleDateString()}
                        </div>
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

                    {/* Bio / About Section (Editable for Own Profile) */}
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
                        <button
                          type="submit"
                          class="chat-auth-login-btn"
                          disabled={savingProfile}
                          style={{ alignSelf: "flex-end", padding: "6px 14px" }}
                        >
                          {savingProfile ? "saving..." : "save profile"}
                        </button>
                      </form>
                    ) : (
                      <div class="chat-profile-section">
                        <div class="chat-profile-section-title">about me</div>
                        <div class="chat-profile-bio-text">
                          {profileData?.bio || "no bio set yet."}
                        </div>
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

                    {/* Actions for other users */}
                    {!isViewingSelf && (
                      <div class="chat-profile-actions-row">
                        <button
                          type="button"
                          class="chat-auth-login-btn"
                          style={{ flex: 1 }}
                          onClick={() => openDirectMessage(targetName)}
                        >
                          <i class="fa-solid fa-paper-plane"></i> direct message
                        </button>
                        <button
                          type="button"
                          class="chat-header-btn voice-active"
                          onClick={() => {
                            const dmChan = makeDmChannelId(cloudUser || "guest", targetName);
                            setActiveChannel(dmChan);
                            setViewingProfileUsername(null);
                            joinVoiceRoom(`voice:${dmChan}`);
                          }}
                        >
                          <i class="fa-solid fa-phone-volume"></i> call
                        </button>
                        <button
                          type="button"
                          class={`chat-header-btn ${blocked ? "danger" : ""}`}
                          onClick={() => toggleBlockUser(targetName)}
                        >
                          <i class="fa-solid fa-ban"></i>{" "}
                          {blocked ? "unblock" : "block"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
