import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { store, useStore } from "../state/store.ts";
import {
  getActiveUser,
  getLocalLeaderboard,
  recordLocalGameTick,
  syncGameActivityToServer,
  formatPlayTime,
  addCookieCoins,
  type LeaderboardEntry,
} from "../core/cookieCoins.ts";
import { moderateChatMessage } from "../core/contentFilter.ts";
import { getClientId } from "../core/liveClient.ts";

interface SpaceMessage {
  id: string;
  author: string;
  avatarColor: string;
  text: string;
  timestamp: string;
  channel: string;
}

interface SpaceVoiceMember {
  peerId: string;
  username: string;
  muted: boolean;
  deafened: boolean;
}

const PALETTE = [
  "#b45309",
  "#4338ca",
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
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

export default function GameSpaceModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTabMode, setActiveTabMode] = useState<"leaderboard" | "space">("leaderboard");
  const [overrideGameName, setOverrideGameName] = useState<string | null>(null);

  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const currentBrowserTab = tabs.find((t) => t.id === activeTabId) || null;

  const activeGameTitle = (
    overrideGameName ||
    currentBrowserTab?.title ||
    "operation cookie lobby"
  )
    .replace(/^game:\s*/i, "")
    .split("/")[0]
    .trim()
    .toLowerCase();

  const spaceChannelId = `space:${activeGameTitle.replace(/[^a-z0-9_-]/g, "_")}`;
  const spaceVoiceRoomId = `voice:${spaceChannelId}`;

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [spaceMessages, setSpaceMessages] = useState<SpaceMessage[]>(() => {
    try {
      const raw = localStorage.getItem("cookie_space_messages_v1");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Space Voice Chat state
  const [inSpaceVoice, setInSpaceVoice] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [voiceMembers, setVoiceMembers] = useState<SpaceVoiceMember[]>([]);

  const inSpaceVoiceRef = useRef(false);
  const isMutedRef = useRef(false);
  const isDeafenedRef = useRef(false);
  const spaceVoiceRoomIdRef = useRef(spaceVoiceRoomId);
  spaceVoiceRoomIdRef.current = spaceVoiceRoomId;

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const bcRef = useRef<BroadcastChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const sendSpaceVoiceSignal = useCallback((payload: Record<string, unknown>) => {
    const full = {
      ...payload,
      roomId: spaceVoiceRoomIdRef.current,
    };
    try {
      bcRef.current?.postMessage(full);
    } catch {}
    fetch("/api/voice/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(full),
    }).catch(() => {});
  }, []);

  const createSpacePeerConnection = useCallback(
    (remotePeerId: string, isInitiator: boolean) => {
      const myPeerId = getClientId();
      const existing = pcsRef.current.get(remotePeerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcsRef.current.set(remotePeerId, pc);

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSpaceVoiceSignal({
            type: "VOICE_ICE",
            signalType: "VOICE_ICE",
            peerId: myPeerId,
            fromClientId: myPeerId,
            targetPeerId: remotePeerId,
            targetClientId: remotePeerId,
            sdpOrCandidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        if (!stream) return;
        let audioEl = remoteAudiosRef.current.get(remotePeerId);
        if (!audioEl) {
          audioEl = new Audio();
          audioEl.autoplay = true;
          remoteAudiosRef.current.set(remotePeerId, audioEl);
        }
        audioEl.srcObject = stream;
        audioEl.muted = isDeafenedRef.current;
        audioEl.play().catch(() => {});
      };

      if (isInitiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            if (pc.localDescription) {
              sendSpaceVoiceSignal({
                type: "VOICE_OFFER",
                signalType: "VOICE_OFFER",
                peerId: myPeerId,
                fromClientId: myPeerId,
                targetPeerId: remotePeerId,
                targetClientId: remotePeerId,
                sdpOrCandidate: pc.localDescription.toJSON(),
              });
            }
          })
          .catch(() => {});
      }

      return pc;
    },
    [sendSpaceVoiceSignal]
  );

  const applySpaceMuteDeafen = useCallback(
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

      for (const audioEl of remoteAudiosRef.current.values()) {
        audioEl.muted = nextDeafened;
      }

      const myPeerId = getClientId();
      const username = getActiveUser();

      setVoiceMembers((prev) =>
        prev.map((m) =>
          m.peerId === myPeerId
            ? { ...m, muted: nextMuted, deafened: nextDeafened }
            : m
        )
      );

      if (inSpaceVoiceRef.current) {
        sendSpaceVoiceSignal({
          type: "VOICE_STATE",
          signalType: "VOICE_STATE",
          peerId: myPeerId,
          fromClientId: myPeerId,
          username,
          muted: nextMuted,
          deafened: nextDeafened,
        });
      }
    },
    [sendSpaceVoiceSignal]
  );

  const toggleSpaceMute = useCallback(() => {
    const nextMuted = !isMutedRef.current;
    const nextDeafened = !nextMuted && isDeafenedRef.current ? false : isDeafenedRef.current;
    applySpaceMuteDeafen(nextMuted, nextDeafened);
    notifyToast(nextMuted ? "space mic muted" : "space mic unmuted", "info");
  }, [applySpaceMuteDeafen]);

  const toggleSpaceDeafen = useCallback(() => {
    const nextDeafened = !isDeafenedRef.current;
    const nextMuted = nextDeafened ? true : false;
    applySpaceMuteDeafen(nextMuted, nextDeafened);
    notifyToast(nextDeafened ? "space audio deafened" : "space audio undeafened", "info");
  }, [applySpaceMuteDeafen]);

  // Refresh leaderboard when opened or game changes
  const refreshLeaderboard = useCallback(async () => {
    const local = getLocalLeaderboard(activeGameTitle);
    setEntries(local);
    try {
      const res = await fetch(
        `/api/games/leaderboard?game=${encodeURIComponent(activeGameTitle)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.entries) && data.entries.length > 0) {
          const map = new Map<string, LeaderboardEntry>();
          for (const item of local) map.set(item.username.toLowerCase(), item);
          for (const item of data.entries as LeaderboardEntry[]) {
            const k = item.username.toLowerCase();
            const prev = map.get(k);
            if (!prev || item.seconds >= prev.seconds) map.set(k, item);
          }
          setEntries(
            Array.from(map.values()).sort(
              (a, b) => b.seconds - a.seconds || b.plays - a.plays
            )
          );
        }
      }
    } catch {}
  }, [activeGameTitle]);

  // Background playtime tracker while playing any game in browser-view or studio (exact 1-second precision)
  const lastTrackedGameRef = useRef<string>("");
  const pendingSyncSecondsRef = useRef<number>(0);

  useEffect(() => {
    let playSeconds = 0;
    const interval = window.setInterval(() => {
      const inBrowser = document.body.classList.contains("browser-view");
      const inStudio = document.body.classList.contains("studio-view");
      if (!inBrowser && !inStudio) return;

      const tab = store.getActiveTab();
      const gName = (
        overrideGameName ||
        (inBrowser ? tab?.title : null) ||
        (inStudio ? "game studio" : "")
      )
        .replace(/^game:\s*/i, "")
        .split("/")[0]
        .trim()
        .toLowerCase();

      if (!gName || gName === "new tab" || gName === "fetching data..." || gName === "operation cookie") return;

      const isNewSession = lastTrackedGameRef.current !== gName;
      if (isNewSession) {
        lastTrackedGameRef.current = gName;
      }

      playSeconds++;
      pendingSyncSecondsRef.current += 1;

      const localUpdated = recordLocalGameTick(gName, 1, isNewSession ? 1 : 0);
      if (isOpen && gName === activeGameTitle) {
        setEntries(localUpdated);
      }

      // Sync accumulated exact seconds to server every 4 seconds or on new game start
      if (isNewSession || pendingSyncSecondsRef.current >= 4) {
        const deltaSec = pendingSyncSecondsRef.current;
        pendingSyncSecondsRef.current = 0;
        syncGameActivityToServer(gName, deltaSec, isNewSession ? 1 : 0).then((serverUpdated) => {
          if (isOpen && gName === activeGameTitle) {
            setEntries(serverUpdated);
          }
        });
      }

      // Every 60 seconds of active play, award +5 Cookie Coins!
      if (playSeconds % 60 === 0) {
        addCookieCoins(5, `playing ${gName}`);
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [overrideGameName, isOpen, activeGameTitle]);

  // Open/Close listener & SSE / BroadcastChannel for Space messages & Voice
  useEffect(() => {
    const onToggle = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.gameName) {
        setOverrideGameName(detail.gameName);
      } else {
        setOverrideGameName(null);
      }
      if (detail?.tab === "space" || detail?.tab === "leaderboard") {
        setActiveTabMode(detail.tab);
      }
      setIsOpen((prev) => !prev);
    };

    const onSseChat = (e: Event) => {
      const msg = (e as CustomEvent).detail?.message as SpaceMessage | undefined;
      if (msg && msg.channel?.startsWith("space:")) {
        setSpaceMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          const next = [...prev, msg].slice(-150);
          try {
            localStorage.setItem("cookie_space_messages_v1", JSON.stringify(next));
          } catch {}
          return next;
        });
      }
    };

    const handleVoicePayload = async (detail: Record<string, unknown>) => {
      if (!detail || detail.roomId !== spaceVoiceRoomIdRef.current) return;
      const myPeerId = getClientId();
      const sigType = String(detail.signalType || detail.type || "");
      const fromPeer = String(detail.fromClientId || detail.peerId || "");
      const targetPeer = String(detail.targetClientId || detail.targetPeerId || "");

      if (
        detail.voiceRooms &&
        typeof detail.voiceRooms === "object" &&
        Array.isArray((detail.voiceRooms as Record<string, unknown>)[spaceVoiceRoomIdRef.current])
      ) {
        const list = (detail.voiceRooms as Record<string, SpaceVoiceMember[]>)[
          spaceVoiceRoomIdRef.current
        ].map((m) => {
          const pid = m.peerId || (m as unknown as { clientId?: string }).clientId || "";
          if (pid === myPeerId) {
            return {
              peerId: myPeerId,
              username: m.username || getActiveUser(),
              muted: isMutedRef.current,
              deafened: isDeafenedRef.current,
            };
          }
          return {
            peerId: pid,
            username: m.username || "player",
            muted: Boolean(m.muted),
            deafened: Boolean(m.deafened),
          };
        });
        setVoiceMembers(list);
      } else if (sigType === "VOICE_STATE" && fromPeer) {
        setVoiceMembers((prev) =>
          prev.map((m) =>
            m.peerId === fromPeer
              ? {
                  ...m,
                  muted: fromPeer === myPeerId ? isMutedRef.current : Boolean(detail.muted),
                  deafened:
                    fromPeer === myPeerId ? isDeafenedRef.current : Boolean(detail.deafened),
                }
              : m
          )
        );
      }

      if (!inSpaceVoiceRef.current || !fromPeer || fromPeer === myPeerId) return;
      if (targetPeer && targetPeer !== myPeerId) return;

      try {
        if (sigType === "VOICE_JOIN") {
          createSpacePeerConnection(fromPeer, true);
        } else if (sigType === "VOICE_LEAVE") {
          const pc = pcsRef.current.get(fromPeer);
          if (pc) {
            pc.close();
            pcsRef.current.delete(fromPeer);
          }
          const audioEl = remoteAudiosRef.current.get(fromPeer);
          if (audioEl) {
            audioEl.pause();
            remoteAudiosRef.current.delete(fromPeer);
          }
        } else if (sigType === "VOICE_OFFER" && detail.sdpOrCandidate) {
          const pc = createSpacePeerConnection(fromPeer, false);
          await pc.setRemoteDescription(
            new RTCSessionDescription(detail.sdpOrCandidate as RTCSessionDescriptionInit)
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (pc.localDescription) {
            sendSpaceVoiceSignal({
              type: "VOICE_ANSWER",
              signalType: "VOICE_ANSWER",
              peerId: myPeerId,
              fromClientId: myPeerId,
              targetPeerId: fromPeer,
              targetClientId: fromPeer,
              sdpOrCandidate: pc.localDescription.toJSON(),
            });
          }
        } else if (sigType === "VOICE_ANSWER" && detail.sdpOrCandidate) {
          const pc = pcsRef.current.get(fromPeer);
          if (pc) {
            await pc.setRemoteDescription(
              new RTCSessionDescription(detail.sdpOrCandidate as RTCSessionDescriptionInit)
            );
          }
        } else if (sigType === "VOICE_ICE" && detail.sdpOrCandidate) {
          const pc = pcsRef.current.get(fromPeer);
          if (pc) {
            await pc.addIceCandidate(
              new RTCIceCandidate(detail.sdpOrCandidate as RTCIceCandidateInit)
            );
          }
        }
      } catch {}
    };

    const onSseVoice = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) handleVoicePayload(detail);
    };

    document.addEventListener("toggleGameSpaceModal", onToggle);
    window.addEventListener("sunshine-chat-event", onSseChat);
    window.addEventListener("sunshine-voice-event", onSseVoice);

    try {
      const bc = new BroadcastChannel("cookie_space_v1_channel");
      bc.onmessage = (ev) => {
        if (ev.data?.type === "SPACE_MSG" && ev.data.message) {
          const msg = ev.data.message as SpaceMessage;
          setSpaceMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            const next = [...prev, msg].slice(-150);
            try {
              localStorage.setItem("cookie_space_messages_v1", JSON.stringify(next));
            } catch {}
            return next;
          });
        } else if (ev.data?.roomId === spaceVoiceRoomIdRef.current) {
          handleVoicePayload(ev.data);
        }
      };
      bcRef.current = bc;
    } catch {}

    return () => {
      document.removeEventListener("toggleGameSpaceModal", onToggle);
      window.removeEventListener("sunshine-chat-event", onSseChat);
      window.removeEventListener("sunshine-voice-event", onSseVoice);
      bcRef.current?.close();
    };
  }, [spaceVoiceRoomId, createSpacePeerConnection, sendSpaceVoiceSignal]);

  useEffect(() => {
    if (isOpen) {
      if (pendingSyncSecondsRef.current > 0) {
        const delta = pendingSyncSecondsRef.current;
        pendingSyncSecondsRef.current = 0;
        syncGameActivityToServer(activeGameTitle, delta, 0).then((list) => setEntries(list));
      }
      refreshLeaderboard();
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 40);
    }
  }, [isOpen, activeGameTitle, refreshLeaderboard]);

  const handleSendSpaceMessage = async (e: Event) => {
    e.preventDefault();
    if (isSending || !chatInput.trim()) return;
    const text = chatInput.trim();
    const author = getActiveUser();

    setIsSending(true);
    try {
      const mod = await moderateChatMessage(text);
      if (mod.blocked) {
        notifyToast(mod.reason || "message blocked by openai moderation", "error");
        setIsSending(false);
        return;
      }

      const newMsg: SpaceMessage = {
        id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        author,
        avatarColor: stringToColor(author),
        text,
        timestamp: new Date()
          .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          .toLowerCase(),
        channel: spaceChannelId,
      };

      setSpaceMessages((prev) => {
        const next = [...prev, newMsg].slice(-150);
        try {
          localStorage.setItem("cookie_space_messages_v1", JSON.stringify(next));
        } catch {}
        return next;
      });
      setChatInput("");

      try {
        bcRef.current?.postMessage({ type: "SPACE_MSG", message: newMsg });
      } catch {}

      fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMsg }),
      }).catch(() => {});

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 30);
    } finally {
      setIsSending(false);
    }
  };

  const toggleSpaceVoice = async () => {
    const myPeerId = getClientId();
    const username = getActiveUser();

    if (inSpaceVoiceRef.current) {
      if (localStreamRef.current) {
        for (const t of localStreamRef.current.getTracks()) t.stop();
        localStreamRef.current = null;
      }
      for (const pc of pcsRef.current.values()) pc.close();
      pcsRef.current.clear();
      for (const a of remoteAudiosRef.current.values()) a.pause();
      remoteAudiosRef.current.clear();

      inSpaceVoiceRef.current = false;
      setInSpaceVoice(false);
      setVoiceMembers((prev) => prev.filter((m) => m.peerId !== myPeerId));
      sendSpaceVoiceSignal({
        type: "VOICE_LEAVE",
        signalType: "VOICE_LEAVE",
        peerId: myPeerId,
        fromClientId: myPeerId,
        username,
      });
      notifyToast("left game space voice chat", "info");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      for (const t of stream.getAudioTracks()) {
        t.enabled = !isMutedRef.current && !isDeafenedRef.current;
      }
      localStreamRef.current = stream;
    } catch {
      notifyToast("joined game space voice in listen-only mode", "info");
    }

    inSpaceVoiceRef.current = true;
    setInSpaceVoice(true);
    setVoiceMembers((prev) => [
      ...prev.filter((m) => m.peerId !== myPeerId),
      {
        peerId: myPeerId,
        username,
        muted: isMutedRef.current,
        deafened: isDeafenedRef.current,
      },
    ]);

    sendSpaceVoiceSignal({
      type: "VOICE_JOIN",
      signalType: "VOICE_JOIN",
      peerId: myPeerId,
      fromClientId: myPeerId,
      username,
      muted: isMutedRef.current,
      deafened: isDeafenedRef.current,
    });

    notifyToast(`connected to ${activeGameTitle} space voice!`, "success");
  };

  const currentSpaceMessages = spaceMessages.filter((m) => m.channel === spaceChannelId);

  return (
    <div
      class={`chat-modal-overlay ${isOpen ? "open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false);
      }}
    >
      <div
        class="chat-app-window"
        style={{ maxWidth: "760px", height: "78vh", flexDirection: "column" }}
      >
        {/* Modal Header */}
        <div class="chat-main-header">
          <div class="chat-main-header-left">
            <div class="chat-main-channel-name">
              <i class="fa-solid fa-trophy"></i>
              <span>{activeGameTitle}</span>
            </div>
            <div class="chat-main-channel-desc">
              game leaderboard & private player space
            </div>
          </div>

          <div class="chat-main-header-actions">
            <button
              type="button"
              class={`chat-header-btn ${activeTabMode === "leaderboard" ? "voice-active" : ""}`}
              onClick={() => setActiveTabMode("leaderboard")}
            >
              <i class="fa-solid fa-ranking-star"></i>
              <span>leaderboard</span>
            </button>
            <button
              type="button"
              class={`chat-header-btn ${activeTabMode === "space" ? "voice-active" : ""}`}
              onClick={() => setActiveTabMode("space")}
            >
              <i class="fa-solid fa-users-rectangle"></i>
              <span>game space ({currentSpaceMessages.length})</span>
            </button>
            <button
              type="button"
              class="chat-window-close"
              onClick={() => setIsOpen(false)}
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        {activeTabMode === "leaderboard" ? (
          /* LEADERBOARD VIEW */
          <div class="chat-feed" style={{ gap: "8px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                backgroundColor: "var(--bg-surface-3)",
                border: "1px solid var(--bg-surface-10)",
                borderRadius: "12px",
                fontSize: "12px",
                color: "var(--color-sublabel)",
              }}
            >
              <span>
                <i class="fa-solid fa-clock"></i> ranked by most time played on{" "}
                <strong style={{ color: "var(--text-primary)" }}>{activeGameTitle}</strong>
              </span>
              <span>+5 cookie coins / min played</span>
            </div>

            {entries.length === 0 ? (
              <div class="chat-empty-state">
                <i class="fa-solid fa-trophy"></i>
                <p>no play records yet — you are #1 on this game!</p>
              </div>
            ) : (
              entries.map((entry, idx) => {
                const isMe =
                  entry.username.toLowerCase() === getActiveUser().toLowerCase();
                return (
                  <div
                    key={entry.username}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      backgroundColor: isMe
                        ? "var(--bg-surface-5)"
                        : "var(--bg-surface-3)",
                      border: "1px solid var(--bg-surface-10)",
                      borderRadius: "12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "14px",
                          width: "28px",
                          color:
                            idx === 0
                              ? "#facc15"
                              : idx === 1
                              ? "#cbd5e1"
                              : idx === 2
                              ? "#fb923c"
                              : "var(--color-sublabel)",
                        }}
                      >
                        #{idx + 1}
                      </span>
                      <div
                        class="chat-entry-avatar"
                        style={{
                          backgroundColor: stringToColor(entry.username),
                          width: "32px",
                          height: "32px",
                          fontSize: "13px",
                        }}
                      >
                        {entry.username.slice(0, 1).toLowerCase()}
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: "13.5px",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>@{entry.username}</span>
                          {isMe && <span class="chat-you-pill">you</span>}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                          {entry.plays} sessions played
                          {entry.highScore > 0 ? ` · best score: ${entry.highScore}` : ""}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      <i
                        class="fa-solid fa-stopwatch"
                        style={{ color: "var(--color-sublabel)" }}
                      ></i>
                      <span>{formatPlayTime(entry.seconds)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          /* PRIVATE GAME SPACE (GROUP CHAT + VOICE CHAT FOR PLAYERS OF THIS GAME) */
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            {/* Space Voice Bar */}
            <div class="chat-voice-stage">
              <div class="chat-voice-stage-header">
                <div class="chat-voice-stage-title">
                  <i class="fa-solid fa-headset"></i>
                  <span>
                    {activeGameTitle} space voice · {voiceMembers.length} talking
                  </span>
                </div>

                <div style={{ display: "flex", gap: "6px" }}>
                  {inSpaceVoice && (
                    <>
                      <button
                        type="button"
                        class={`chat-header-btn ${isMuted ? "danger" : ""}`}
                        onClick={toggleSpaceMute}
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
                        onClick={toggleSpaceDeafen}
                      >
                        <i
                          class={`fa-solid ${
                            isDeafened ? "fa-volume-xmark" : "fa-headphones"
                          }`}
                        ></i>
                        <span>{isDeafened ? "undeafen" : "deafen"}</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    class={`chat-header-btn ${inSpaceVoice ? "danger" : "voice-active"}`}
                    onClick={toggleSpaceVoice}
                  >
                    <i
                      class={`fa-solid ${
                        inSpaceVoice ? "fa-phone-slash" : "fa-phone-volume"
                      }`}
                    ></i>
                    <span>{inSpaceVoice ? "leave space voice" : "join space voice"}</span>
                  </button>
                </div>
              </div>

              {voiceMembers.length > 0 && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {voiceMembers.map((vm) => {
                    const isRestricted = vm.deafened || vm.muted;
                    return (
                      <div
                        key={vm.peerId}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "5px 10px",
                          borderRadius: "20px",
                          backgroundColor: "var(--bg-surface-4)",
                          border: `1px solid ${isRestricted ? "#f87171" : "#4ade80"}`,
                          fontSize: "12px",
                        }}
                      >
                        <i
                          class={`fa-solid ${
                            vm.deafened
                              ? "fa-volume-xmark"
                              : vm.muted
                              ? "fa-microphone-slash"
                              : "fa-microphone"
                          }`}
                          style={{ color: isRestricted ? "#f87171" : "#4ade80" }}
                        ></i>
                        <span>@{vm.username}</span>
                        {vm.deafened && (
                          <span style={{ fontSize: "10px", color: "#f87171" }}>
                            (deafened)
                          </span>
                        )}
                        {!vm.deafened && vm.muted && (
                          <span style={{ fontSize: "10px", color: "#f87171" }}>
                            (muted)
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Space Group Chat Feed */}
            <div class="chat-feed">
              {currentSpaceMessages.length === 0 ? (
                <div class="chat-empty-state">
                  <i class="fa-solid fa-comments"></i>
                  <p>welcome to the private space for {activeGameTitle}!</p>
                  <span style={{ fontSize: "11px" }}>
                    only players inside {activeGameTitle} see messages & voice here.
                  </span>
                </div>
              ) : (
                currentSpaceMessages.map((msg) => (
                  <div key={msg.id} class="chat-entry">
                    <div
                      class="chat-entry-avatar"
                      style={{ backgroundColor: msg.avatarColor }}
                    >
                      {msg.author.slice(0, 1).toLowerCase()}
                    </div>
                    <div class="chat-entry-content">
                      <div class="chat-entry-header">
                        <span class="chat-entry-author">{msg.author}</span>
                        <span class="chat-entry-time">{msg.timestamp}</span>
                      </div>
                      <div class="chat-entry-text">{msg.text}</div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Space Chat Input */}
            <div class="chat-input-container">
              <form class="chat-input-pill" onSubmit={handleSendSpaceMessage}>
                <input
                  type="text"
                  class="chat-input-field"
                  placeholder={`message players in ${activeGameTitle} space...`}
                  value={chatInput}
                  onInput={(e) => setChatInput(e.currentTarget.value)}
                  maxLength={400}
                />
                <button
                  type="submit"
                  class="chat-submit-btn"
                  disabled={!chatInput.trim() || isSending}
                >
                  <i class="fa-solid fa-paper-plane"></i>
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
