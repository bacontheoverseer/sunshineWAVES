import { useEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import { moderateChatMessage } from "../core/contentFilter.ts";
import { getClientId } from "../core/liveClient.ts";

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
  status?: string;
  isSelf?: boolean;
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

  // Server-reported online users
  const [serverOnlineUsers, setServerOnlineUsers] = useState<{ username: string; color: string }[]>([]);

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

  const openDirectMessage = useCallback(
    (targetUsername: string) => {
      const clean = targetUsername.trim();
      if (!clean) return;
      if (cloudUser && clean.toLowerCase() === cloudUser.toLowerCase()) {
        notifyToast("you cannot direct message yourself", "info");
        return;
      }
      const peerLower = clean.toLowerCase();
      setDmPeers((prev) => {
        if (prev.some((p) => p.toLowerCase() === peerLower)) return prev;
        const next = [clean, ...prev];
        try {
          localStorage.setItem("cookie_chat_dm_peers_v1", JSON.stringify(next));
        } catch {}
        return next;
      });
      const dmChannel = makeDmChannelId(cloudUser || "guest", clean);
      setActiveChannel(dmChannel);
      setUnreadCounts((prev) => ({ ...prev, [dmChannel]: 0 }));
    },
    [cloudUser]
  );

  // Sync audio element volumes and mute states when deafened / blocked / volume slider changes
  useEffect(() => {
    for (const [peerClientId, audioEl] of remoteAudioElementsRef.current.entries()) {
      const peerUsername = audioEl.dataset.username || "";
      const blocked = isUserBlocked(peerUsername);
      const customVol = userVolumes[peerUsername.toLowerCase()] ?? 1;
      audioEl.muted = isDeafened || blocked;
      audioEl.volume = Math.max(0, Math.min(1, customVol));
    }
  }, [isDeafened, blockedUsers, userVolumes, isUserBlocked]);

  // Incoming message handler (shared by SSE, BroadcastChannel, and API poll)
  const ingestIncomingMessage = useCallback(
    (incoming: ChatMessage) => {
      if (!incoming || !incoming.id) return;
      // If it's a DM, verify current user is one of the 2 participants
      if (incoming.channel.startsWith("dm:")) {
        if (!cloudUser) return;
        const parts = incoming.channel.slice(3).split(":");
        const myLower = cloudUser.toLowerCase();
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

      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        const updated = [...prev, incoming].slice(-250);
        try {
          localStorage.setItem("cookie_chat_messages_v2", JSON.stringify(updated));
        } catch {}
        return updated;
      });

      if (
        incoming.channel !== activeChannelRef.current &&
        incoming.author.toLowerCase() !== (cloudUser || "").toLowerCase() &&
        !blockedUsers.includes(incoming.author.toLowerCase())
      ) {
        setUnreadCounts((prev) => ({
          ...prev,
          [incoming.channel]: (prev[incoming.channel] || 0) + 1,
        }));
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

  // Fetch initial chat & voice state when opened
  useEffect(() => {
    if (!isOpen) return;
    fetch(`/api/chat/state?username=${encodeURIComponent(cloudUser || "")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.messages)) {
          for (const m of data.messages) ingestIncomingMessage(m);
        }
        if (data.voiceRooms && typeof data.voiceRooms === "object") {
          setVoiceRooms((prev) => ({ ...prev, ...data.voiceRooms }));
        }
        if (Array.isArray(data.onlineUsers)) {
          setServerOnlineUsers(data.onlineUsers);
        }
      })
      .catch(() => {});
  }, [isOpen, cloudUser, ingestIncomingMessage]);

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

    document.addEventListener("toggleChatModal", handleToggle);
    document.addEventListener("closeChatModal", handleClose);
    window.addEventListener("sunshine-chat-event", onSseChat);
    window.addEventListener("sunshine-voice-event", onSseVoice);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
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
      window.removeEventListener("keydown", handleKeyDown);
      broadcastRef.current?.close();
    };
  }, [isOpen, ingestIncomingMessage, handleVoiceEvent]);

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
      }).catch(() => {});
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

  // Combine online users from current user, server state, and recent message authors
  const onlineUsers = useMemo(() => {
    const map = new Map<string, OnlineUser>();
    if (cloudUser) {
      map.set(cloudUser.toLowerCase(), {
        username: cloudUser,
        color: stringToColor(cloudUser),
        isSelf: true,
      });
    }
    for (const su of serverOnlineUsers) {
      const k = su.username.toLowerCase();
      if (!map.has(k)) {
        map.set(k, {
          username: su.username,
          color: su.color || stringToColor(su.username),
        });
      }
    }
    for (const msg of messages) {
      const key = msg.author.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          username: msg.author,
          color: msg.avatarColor || stringToColor(msg.author),
        });
      }
    }
    return Array.from(map.values());
  }, [cloudUser, serverOnlineUsers, messages]);

  // Active channel metadata
  const activeChannelDef = useMemo(() => {
    if (activeChannel.startsWith("dm:")) {
      const partner = getDmPartnerName(activeChannel, cloudUser);
      return {
        id: activeChannel,
        name: partner,
        icon: "fa-at",
        isDm: true,
        isVoice: false,
        desc: `direct message with @${partner}`,
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
  }, [activeChannel, cloudUser]);

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

          {/* User profile footer */}
          <div class="chat-sidebar-user">
            {cloudUser ? (
              <>
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
                <div class="chat-sidebar-user-info">
                  <span class="chat-sidebar-username">{cloudUser}</span>
                  <span class="chat-sidebar-status">
                    <span style={{ fontSize: "8px" }}>●</span> online
                  </span>
                </div>
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
              <div class="chat-main-channel-name">
                <i class={`fa-solid ${activeChannelDef.icon}`}></i>
                <span>{activeChannelDef.name}</span>
              </div>
              <div class="chat-main-channel-desc">{activeChannelDef.desc}</div>
            </div>

            <div class="chat-main-header-actions">
              {/* DM Header Actions: Voice Call & Block/Unblock */}
              {activeChannelDef.isDm && currentDmPartner && (
                <>
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
                          style={{ backgroundColor: p.avatarColor }}
                        >
                          {p.username.slice(0, 1).toLowerCase()}
                        </div>
                        <div class="chat-voice-card-name">
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
                      title={isSelf ? msg.author : `Message @${msg.author}`}
                      onClick={() => {
                        if (!isSelf) openDirectMessage(msg.author);
                      }}
                    >
                      {msg.author.slice(0, 1).toLowerCase()}
                    </div>
                    <div class="chat-entry-content">
                      <div class="chat-entry-header">
                        <span
                          class={`chat-entry-author ${isSelf ? "is-self" : ""}`}
                          onClick={() => {
                            if (!isSelf) openDirectMessage(msg.author);
                          }}
                        >
                          {msg.author}
                        </span>
                        <span class="chat-entry-time">{msg.timestamp}</span>
                      </div>
                      <div class="chat-entry-text">{renderFormattedText(msg.text)}</div>
                    </div>

                    {/* Hover actions on each message */}
                    {!isSelf && (
                      <div class="chat-entry-actions">
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
                      </div>
                    )}
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

        {/* ── COLUMN 3: Right Online Users & Blocked List Sidebar ── */}
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
                return (
                  <div key={u.username} class="chat-user-item">
                    <div
                      class="chat-user-avatar-wrap"
                      onClick={() => {
                        if (!u.isSelf) openDirectMessage(u.username);
                      }}
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
                      onClick={() => {
                        if (!u.isSelf) openDirectMessage(u.username);
                      }}
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
                    </div>

                    {!u.isSelf && (
                      <div class="chat-user-actions">
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
                    )}
                  </div>
                );
              })
            )}

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
      </div>
    </div>
  );
}
