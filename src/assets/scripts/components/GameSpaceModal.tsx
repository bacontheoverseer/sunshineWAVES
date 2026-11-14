import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { store, useStore } from "../state/store.ts";
import {
  getActiveUser,
  getLocalLeaderboard,
  recordLocalGameTick,
  syncGameActivityToServer,
  formatPlayTime,
  addCookieCoins,
  isWebsiteNotGame,
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

interface CloudPlayParty {
  code: string;
  gameTitle: string;
  gameUrl: string;
  host: {
    clientId: string;
    username: string;
    role: "wasd" | "arrows" | "all";
  };
  guest: {
    clientId: string;
    username: string;
    role: "arrows" | "wasd" | "all";
    joinedAt?: number;
  } | null;
  settings: {
    hostRole: "wasd" | "arrows" | "all";
    guestRole: "arrows" | "wasd" | "all";
    remapGuestWasdToArrows: boolean;
  };
}

interface RemoteKeyPayload {
  action: "keydown" | "keyup";
  key: string;
  code: string;
  keyCode: number;
  label: string;
}

const KEY_CODE_TABLE: Record<string, { key: string; code: string; keyCode: number; label: string }> = {
  KeyW: { key: "w", code: "KeyW", keyCode: 87, label: "W" },
  KeyA: { key: "a", code: "KeyA", keyCode: 65, label: "A" },
  KeyS: { key: "s", code: "KeyS", keyCode: 83, label: "S" },
  KeyD: { key: "d", code: "KeyD", keyCode: 68, label: "D" },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38, label: "↑" },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40, label: "↓" },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, label: "←" },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39, label: "→" },
  Space: { key: " ", code: "Space", keyCode: 32, label: "SPACE" },
  Enter: { key: "Enter", code: "Enter", keyCode: 13, label: "ENTER" },
  ShiftLeft: { key: "Shift", code: "ShiftLeft", keyCode: 16, label: "SHIFT" },
  ShiftRight: { key: "Shift", code: "ShiftRight", keyCode: 16, label: "R-SHIFT" },
  KeyE: { key: "e", code: "KeyE", keyCode: 69, label: "E" },
  KeyQ: { key: "q", code: "KeyQ", keyCode: 81, label: "Q" },
  KeyF: { key: "f", code: "KeyF", keyCode: 70, label: "F" },
  KeyR: { key: "r", code: "KeyR", keyCode: 82, label: "R" },
  KeyI: { key: "i", code: "KeyI", keyCode: 73, label: "I" },
  KeyO: { key: "o", code: "KeyO", keyCode: 79, label: "O" },
  KeyJ: { key: "j", code: "KeyJ", keyCode: 74, label: "J" },
  KeyK: { key: "k", code: "KeyK", keyCode: 75, label: "K" },
  KeyL: { key: "l", code: "KeyL", keyCode: 76, label: "L" },
  KeyU: { key: "u", code: "KeyU", keyCode: 85, label: "U" },
  KeyP: { key: "p", code: "KeyP", keyCode: 80, label: "P" },
  KeyM: { key: "m", code: "KeyM", keyCode: 77, label: "M" },
  KeyN: { key: "n", code: "KeyN", keyCode: 78, label: "N" },
  Slash: { key: "/", code: "Slash", keyCode: 191, label: "/" },
  Period: { key: ".", code: "Period", keyCode: 190, label: "." },
  Comma: { key: ",", code: "Comma", keyCode: 188, label: "," },
  Digit1: { key: "1", code: "Digit1", keyCode: 49, label: "1" },
  Digit2: { key: "2", code: "Digit2", keyCode: 50, label: "2" },
  Digit3: { key: "3", code: "Digit3", keyCode: 51, label: "3" },
};

const WASD_CODES = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyE", "KeyQ", "ShiftLeft", "KeyF", "KeyR", "Digit1", "Digit2"]);
const ARROW_CODES = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "ShiftRight",
  "Slash",
  "Period",
  "Comma",
  "KeyM",
  "KeyN",
  "KeyI",
  "KeyO",
  "KeyJ",
  "KeyK",
  "KeyL",
  "KeyU",
  "KeyP",
]);

function mapGuestKeyEvent(
  e: KeyboardEvent,
  guestRole: "arrows" | "wasd" | "all",
  remapWasdToArrows: boolean
): { key: string; code: string; keyCode: number; label: string } | null {
  let code = e.code;
  if (!code) {
    const k = e.key.toLowerCase();
    if (k === "w") code = "KeyW";
    else if (k === "a") code = "KeyA";
    else if (k === "s") code = "KeyS";
    else if (k === "d") code = "KeyD";
    else if (e.key === "ArrowUp") code = "ArrowUp";
    else if (e.key === "ArrowDown") code = "ArrowDown";
    else if (e.key === "ArrowLeft") code = "ArrowLeft";
    else if (e.key === "ArrowRight") code = "ArrowRight";
    else if (e.key === " ") code = "Space";
    else if (e.key === "Enter") code = "Enter";
  }

  // If comfort remap is enabled, Guest pressing W/A/S/D gets sent as ArrowUp/Left/Down/Right!
  if (remapWasdToArrows) {
    if (code === "KeyW") return KEY_CODE_TABLE.ArrowUp;
    if (code === "KeyA") return KEY_CODE_TABLE.ArrowLeft;
    if (code === "KeyS") return KEY_CODE_TABLE.ArrowDown;
    if (code === "KeyD") return KEY_CODE_TABLE.ArrowRight;
    if (code === "Space") return KEY_CODE_TABLE.Enter;
  }

  if (guestRole === "arrows" && !ARROW_CODES.has(code)) return null;
  if (guestRole === "wasd" && !WASD_CODES.has(code)) return null;

  if (KEY_CODE_TABLE[code]) {
    return KEY_CODE_TABLE[code];
  }
  if (guestRole === "all" && e.key && e.key.length <= 12) {
    const kc = e.keyCode || e.which || e.key.toUpperCase().charCodeAt(0) || 0;
    return {
      key: e.key,
      code: code || e.key,
      keyCode: kc,
      label: e.key === " " ? "SPACE" : e.key.toUpperCase(),
    };
  }
  return null;
}

function getHostGameContexts(): {
  windows: Window[];
  documents: Document[];
  canvases: HTMLCanvasElement[];
} {
  const windows: Window[] = [];
  const documents: Document[] = [];
  const canvases: HTMLCanvasElement[] = [];

  const collectFromIframe = (iframe: HTMLIFrameElement | null, depth = 0) => {
    if (!iframe || depth > 3) return;
    try {
      const win = iframe.contentWindow;
      const doc = iframe.contentDocument || win?.document;
      if (win && !windows.includes(win)) windows.push(win);
      if (doc && !documents.includes(doc)) {
        documents.push(doc);
        const foundCanvases = Array.from(doc.querySelectorAll("canvas"));
        for (const c of foundCanvases) {
          if (c.width > 40 && c.height > 40 && !canvases.includes(c)) {
            canvases.push(c);
          }
        }
        const innerIframes = Array.from(doc.querySelectorAll("iframe"));
        for (const inner of innerIframes) {
          collectFromIframe(inner, depth + 1);
        }
      }
    } catch {
      // Cross-origin inner iframe if any
    }
  };

  const activeTab = store.getActiveTab();
  if (activeTab?.iframe) {
    collectFromIframe(activeTab.iframe, 0);
  }
  const studioIframe = document.querySelector<HTMLIFrameElement>(
    "#studio-play-iframe, .studio-play-iframe, #iframe-container iframe.active"
  );
  if (studioIframe) {
    collectFromIframe(studioIframe, 0);
  }

  // Also check any studio canvas directly in document
  const mainStudioCanvases = Array.from(
    document.querySelectorAll<HTMLCanvasElement>(".studio-canvas-stage canvas, #studio-page canvas")
  );
  for (const c of mainStudioCanvases) {
    if (c.width > 40 && c.height > 40 && !canvases.includes(c)) {
      canvases.push(c);
    }
  }

  canvases.sort((a, b) => b.width * b.height - a.width * a.height);
  return { windows, documents, canvases };
}

function injectRemoteKeyIntoHostGame(
  action: "keydown" | "keyup",
  payload: { key: string; code: string; keyCode: number }
) {
  const { windows, documents, canvases } = getHostGameContexts();

  const createSynthKeyEvent = (targetWin: Window) => {
    const EventCtor = (targetWin as unknown as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent || KeyboardEvent;
    const ev = new EventCtor(action, {
      key: payload.key,
      code: payload.code,
      keyCode: payload.keyCode,
      which: payload.keyCode,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: targetWin,
    });
    try {
      Object.defineProperty(ev, "keyCode", { get: () => payload.keyCode });
      Object.defineProperty(ev, "which", { get: () => payload.keyCode });
      Object.defineProperty(ev, "charCode", { get: () => payload.keyCode });
    } catch {}
    return ev;
  };

  for (const canvas of canvases) {
    try {
      const win = canvas.ownerDocument?.defaultView || window;
      canvas.dispatchEvent(createSynthKeyEvent(win));
    } catch {}
  }

  for (const doc of documents) {
    try {
      const win = doc.defaultView || window;
      if (doc.body) doc.body.dispatchEvent(createSynthKeyEvent(win));
      doc.dispatchEvent(createSynthKeyEvent(win));
    } catch {}
  }

  for (const win of windows) {
    try {
      win.dispatchEvent(createSynthKeyEvent(win));
    } catch {}
  }

  // If no iframe targets found (e.g. Studio native canvas), also dispatch on main window
  if (windows.length === 0 && documents.length === 0) {
    try {
      window.dispatchEvent(createSynthKeyEvent(window));
      document.dispatchEvent(createSynthKeyEvent(window));
    } catch {}
  }
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
  const w = window as unknown as { showToast?: (t: string, m?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(type, message);
  }
}

export default function GameSpaceModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTabMode, setActiveTabMode] = useState<"leaderboard" | "space" | "cloudplay">("leaderboard");
  const [overrideGameName, setOverrideGameName] = useState<string | null>(null);

  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const currentBrowserTab = tabs.find((t) => t.id === activeTabId) || null;
  const isBrowserTabGame = Boolean(
    currentBrowserTab?.isGame && !isWebsiteNotGame(currentBrowserTab?.title)
  );
  const hasActiveGameContext = Boolean(
    (overrideGameName && !isWebsiteNotGame(overrideGameName)) || isBrowserTabGame
  );

  const activeGameTitle = (
    overrideGameName ||
    (isBrowserTabGame ? currentBrowserTab?.title : null) ||
    "cloudplay 2p party"
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
      if (!raw) return [];
      const parsed: SpaceMessage[] = JSON.parse(raw);
      const cleaned = Array.isArray(parsed)
        ? parsed.filter((m) => !isWebsiteNotGame(String(m?.channel || "").replace(/^space:/, "")))
        : [];
      if (cleaned.length !== parsed.length) {
        localStorage.setItem("cookie_space_messages_v1", JSON.stringify(cleaned));
      }
      return cleaned;
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

  // --- CloudPlay 2-Player Party & Remote Keybind / Stream State ---
  const [cloudParty, setCloudParty] = useState<CloudPlayParty | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [hostRolePref, setHostRolePref] = useState<"wasd" | "arrows" | "all">("wasd");
  const [guestRolePref, setGuestRolePref] = useState<"arrows" | "wasd" | "all">("arrows");
  const [remapGuestWasd, setRemapGuestWasd] = useState(false);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [guestStageFull, setGuestStageFull] = useState(false);
  const [remoteVideoActive, setRemoteVideoActive] = useState(false);
  const [latestFrameUrl, setLatestFrameUrl] = useState<string>("");
  const [hostHeldKeys, setHostHeldKeys] = useState<string[]>([]);
  const [guestHeldKeys, setGuestHeldKeys] = useState<string[]>([]);
  const [p2pConnected, setP2pConnected] = useState(false);

  const cloudPartyRef = useRef<CloudPlayParty | null>(null);
  cloudPartyRef.current = cloudParty;
  const cloudPcRef = useRef<RTCPeerConnection | null>(null);
  const cloudDcRef = useRef<RTCDataChannel | null>(null);
  const cloudBcRef = useRef<BroadcastChannel | null>(null);
  const guestVideoRef = useRef<HTMLVideoElement | null>(null);
  const guestRemoteStreamRef = useRef<MediaStream | null>(null);
  const remoteHeldSetRef = useRef<Map<string, RemoteKeyPayload>>(new Map());
  const localHeldSetRef = useRef<Set<string>>(new Set());
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const myUsername = getActiveUser();
  const isCloudHost = Boolean(
    cloudParty &&
      (cloudParty.host.clientId === getClientId() ||
        cloudParty.host.username.toLowerCase() === myUsername.toLowerCase())
  );
  const isCloudGuest = Boolean(
    cloudParty &&
      !isCloudHost &&
      cloudParty.guest &&
      (cloudParty.guest.clientId === getClientId() ||
        cloudParty.guest.username.toLowerCase() === myUsername.toLowerCase())
  );

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
      // Never track leaderboards or playtime for regular websites!
      if (inBrowser && !tab?.isGame) return;

      const gName = (
        overrideGameName ||
        (inBrowser && tab?.isGame ? tab?.title : null) ||
        (inStudio ? "game studio" : "")
      )
        .replace(/^game:\s*/i, "")
        .split("/")[0]
        .trim()
        .toLowerCase();

      if (
        !gName ||
        gName === "new tab" ||
        gName === "fetching data..." ||
        gName === "operation cookie" ||
        gName === "cloudplay 2p party" ||
        isWebsiteNotGame(gName)
      ) {
        return;
      }

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
      if (
        detail?.tab === "space" ||
        detail?.tab === "leaderboard" ||
        detail?.tab === "cloudplay"
      ) {
        setActiveTabMode(detail.tab);
        setIsOpen(true);
        return;
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

  // --- CloudPlay Signaling, WebRTC Stream, & Remote Keybind Injection ---
  const cleanupCloudRtc = useCallback(() => {
    for (const keyPayload of remoteHeldSetRef.current.values()) {
      injectRemoteKeyIntoHostGame("keyup", keyPayload);
    }
    remoteHeldSetRef.current.clear();
    localHeldSetRef.current.clear();
    setHostHeldKeys([]);
    setGuestHeldKeys([]);
    setP2pConnected(false);
    setRemoteVideoActive(false);

    if (cloudDcRef.current) {
      try {
        cloudDcRef.current.close();
      } catch {}
      cloudDcRef.current = null;
    }
    if (cloudPcRef.current) {
      try {
        cloudPcRef.current.close();
      } catch {}
      cloudPcRef.current = null;
    }
    guestRemoteStreamRef.current = null;
  }, []);

  const sendCloudSignal = useCallback(
    (signalType: string, data: Record<string, unknown>, codeOverride?: string) => {
      const code = codeOverride || cloudPartyRef.current?.code;
      if (!code) return;
      const fromClientId = getClientId();

      // Send over fast DataChannel if open and it's a KEY or FRAME packet
      if (
        (signalType === "KEY" || signalType === "FRAME") &&
        cloudDcRef.current &&
        cloudDcRef.current.readyState === "open"
      ) {
        try {
          cloudDcRef.current.send(
            JSON.stringify({ type: "CLOUDPLAY_DC", signalType, fromClientId, data })
          );
          return;
        } catch {}
      }

      // Broadcast over local channel for instant same-machine multi-tab testing
      try {
        cloudBcRef.current?.postMessage({
          type: "cloudplay-event",
          code,
          eventType: "SIGNAL",
          signalType,
          fromClientId,
          data,
        });
      } catch {}

      // Relay over server SSE to the remote computer
      fetch("/api/cloudplay/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, fromClientId, signalType, data }),
      }).catch(() => {});
    },
    []
  );

  const handleIncomingKeyFromGuest = useCallback((payload: RemoteKeyPayload) => {
    if (!payload || !payload.code) return;
    if (payload.action === "keydown") {
      remoteHeldSetRef.current.set(payload.code, payload);
    } else {
      remoteHeldSetRef.current.delete(payload.code);
    }
    setGuestHeldKeys(Array.from(remoteHeldSetRef.current.values()).map((k) => k.label));
    injectRemoteKeyIntoHostGame(payload.action, payload);
  }, []);

  const setupCloudWebRtc = useCallback(
    async (asHost: boolean, code: string) => {
      cleanupCloudRtc();
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      cloudPcRef.current = pc;

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendCloudSignal("ICE", { candidate: ev.candidate.toJSON() }, code);
        }
      };

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        setP2pConnected(st === "connected");
      };

      const bindDataChannel = (dc: RTCDataChannel) => {
        cloudDcRef.current = dc;
        dc.onopen = () => setP2pConnected(true);
        dc.onclose = () => setP2pConnected(false);
        dc.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg?.signalType === "KEY" && msg.data) {
              handleIncomingKeyFromGuest(msg.data as RemoteKeyPayload);
            } else if (msg?.signalType === "FRAME" && msg.data?.frame) {
              setLatestFrameUrl(String(msg.data.frame));
            }
          } catch {}
        };
      };

      if (asHost) {
        const dc = pc.createDataChannel("cloudplay_io", { ordered: false, maxRetransmits: 0 });
        bindDataChannel(dc);

        // Attach live canvas video stream from the Host's single game instance if available
        try {
          const { canvases } = getHostGameContexts();
          const primaryCanvas = canvases[0] as
            | (HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream })
            | undefined;
          if (primaryCanvas && typeof primaryCanvas.captureStream === "function") {
            const stream = primaryCanvas.captureStream(30);
            for (const track of stream.getTracks()) {
              pc.addTrack(track, stream);
            }
          }
        } catch {}

        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          if (pc.localDescription) {
            sendCloudSignal("OFFER", { sdp: pc.localDescription.toJSON() }, code);
          }
        } catch {}
      } else {
        pc.ondatachannel = (ev) => bindDataChannel(ev.channel);
        pc.ontrack = (ev) => {
          const stream = ev.streams[0];
          if (stream) {
            guestRemoteStreamRef.current = stream;
            setRemoteVideoActive(true);
            if (guestVideoRef.current) {
              guestVideoRef.current.srcObject = stream;
              guestVideoRef.current.play().catch(() => {});
            }
          }
        };
      }

      return pc;
    },
    [cleanupCloudRtc, handleIncomingKeyFromGuest, sendCloudSignal]
  );

  // Listen for CloudPlay SSE & BroadcastChannel events
  useEffect(() => {
    const handleCloudEvent = async (detail: Record<string, unknown>) => {
      const current = cloudPartyRef.current;
      if (!detail || !current) return;
      if (String(detail.code || "").toUpperCase() !== current.code.toUpperCase()) return;

      const myId = getClientId();
      const myName = getActiveUser().toLowerCase();
      const amHost =
        current.host.clientId === myId || current.host.username.toLowerCase() === myName;

      const eventType = String(detail.eventType || "");
      if (eventType === "PARTY_UPDATED" && detail.party) {
        const updated = detail.party as CloudPlayParty;
        setCloudParty(updated);
        setHostRolePref(updated.settings.hostRole);
        setGuestRolePref(updated.settings.guestRole);
        setRemapGuestWasd(updated.settings.remapGuestWasdToArrows);
        if (detail.joinedUser && amHost) {
          notifyToast(`@${detail.joinedUser} joined your cloudplay party!`, "success");
          void setupCloudWebRtc(true, updated.code);
        }
      } else if (eventType === "GUEST_LEFT" && detail.party) {
        setCloudParty(detail.party as CloudPlayParty);
        cleanupCloudRtc();
        notifyToast(`@${detail.leftUser || "player 2"} left the party`, "info");
      } else if (eventType === "PARTY_CLOSED") {
        cleanupCloudRtc();
        setCloudParty(null);
        setGuestStageFull(false);
        notifyToast(String(detail.reason || "cloudplay party ended"), "info");
      } else if (eventType === "SIGNAL") {
        if (detail.fromClientId === myId) return;
        const sigType = String(detail.signalType || "");
        const sigData = (detail.data || {}) as Record<string, unknown>;

        if (sigType === "KEY" && amHost) {
          handleIncomingKeyFromGuest(sigData as unknown as RemoteKeyPayload);
        } else if (sigType === "FRAME" && !amHost && sigData.frame) {
          setLatestFrameUrl(String(sigData.frame));
        } else if (sigType === "HOST_KEYS" && !amHost && Array.isArray(sigData.keys)) {
          setHostHeldKeys(sigData.keys as string[]);
        } else if (sigType === "GUEST_READY" && amHost) {
          void setupCloudWebRtc(true, current.code);
        } else if (sigType === "OFFER" && !amHost && sigData.sdp) {
          try {
            const pc = await setupCloudWebRtc(false, current.code);
            await pc.setRemoteDescription(
              new RTCSessionDescription(sigData.sdp as RTCSessionDescriptionInit)
            );
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            if (pc.localDescription) {
              sendCloudSignal("ANSWER", { sdp: pc.localDescription.toJSON() }, current.code);
            }
          } catch {}
        } else if (sigType === "ANSWER" && amHost && sigData.sdp && cloudPcRef.current) {
          try {
            await cloudPcRef.current.setRemoteDescription(
              new RTCSessionDescription(sigData.sdp as RTCSessionDescriptionInit)
            );
          } catch {}
        } else if (sigType === "ICE" && sigData.candidate && cloudPcRef.current) {
          try {
            await cloudPcRef.current.addIceCandidate(
              new RTCIceCandidate(sigData.candidate as RTCIceCandidateInit)
            );
          } catch {}
        }
      }
    };

    const onSseCloud = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) void handleCloudEvent(detail);
    };

    window.addEventListener("sunshine-cloudplay-event", onSseCloud);

    try {
      const bc = new BroadcastChannel("cookie_cloudplay_v1_channel");
      bc.onmessage = (ev) => {
        if (ev.data?.type === "cloudplay-event") {
          void handleCloudEvent(ev.data);
        }
      };
      cloudBcRef.current = bc;
    } catch {}

    return () => {
      window.removeEventListener("sunshine-cloudplay-event", onSseCloud);
      cloudBcRef.current?.close();
    };
  }, [cleanupCloudRtc, handleIncomingKeyFromGuest, sendCloudSignal, setupCloudWebRtc]);

  // Attach MediaStream to guest <video> whenever it mounts
  useEffect(() => {
    if (guestVideoRef.current && guestRemoteStreamRef.current) {
      guestVideoRef.current.srcObject = guestRemoteStreamRef.current;
      guestVideoRef.current.play().catch(() => {});
    }
  }, [remoteVideoActive, guestStageFull, isOpen, activeTabMode]);

  // Host: Capture & stream frames from the single game instance to Guest + track Host keys
  useEffect(() => {
    if (!cloudParty || !isCloudHost || !cloudParty.guest) return;

    const frameInterval = window.setInterval(() => {
      try {
        const { canvases } = getHostGameContexts();
        const srcCanvas = canvases[0];
        if (!srcCanvas) return;

        if (!offscreenCanvasRef.current) {
          const oc = document.createElement("canvas");
          oc.width = 480;
          oc.height = 270;
          offscreenCanvasRef.current = oc;
        }
        const oc = offscreenCanvasRef.current;
        const ctx = oc.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(srcCanvas, 0, 0, oc.width, oc.height);
        const frameDataUrl = oc.toDataURL("image/jpeg", 0.5);
        if (frameDataUrl && frameDataUrl.length > 100) {
          sendCloudSignal("FRAME", { frame: frameDataUrl });
        }
      } catch {
        // Canvas may be tainted if non-same-origin
      }
    }, 160);

    const onHostKeyDown = (e: KeyboardEvent) => {
      const mapped = KEY_CODE_TABLE[e.code];
      if (!mapped) return;
      if (!localHeldSetRef.current.has(mapped.label)) {
        localHeldSetRef.current.add(mapped.label);
        const list = Array.from(localHeldSetRef.current);
        setHostHeldKeys(list);
      }
    };
    const onHostKeyUp = (e: KeyboardEvent) => {
      const mapped = KEY_CODE_TABLE[e.code];
      if (!mapped) return;
      if (localHeldSetRef.current.has(mapped.label)) {
        localHeldSetRef.current.delete(mapped.label);
        const list = Array.from(localHeldSetRef.current);
        setHostHeldKeys(list);
      }
    };

    window.addEventListener("keydown", onHostKeyDown, true);
    window.addEventListener("keyup", onHostKeyUp, true);

    return () => {
      window.clearInterval(frameInterval);
      window.removeEventListener("keydown", onHostKeyDown, true);
      window.removeEventListener("keyup", onHostKeyUp, true);
    };
  }, [cloudParty, isCloudHost, sendCloudSignal]);

  // Guest: Capture keybinds on Guest's computer and send them to Host's single game instance!
  useEffect(() => {
    if (!cloudParty || !isCloudGuest) return;

    const isControllerActive =
      guestStageFull || (isOpen && activeTabMode === "cloudplay");
    if (!isControllerActive) return;

    const guestRole = cloudParty.settings.guestRole || "arrows";
    const remap = Boolean(cloudParty.settings.remapGuestWasdToArrows);

    const onGuestKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      const mapped = mapGuestKeyEvent(e, guestRole, remap);
      if (!mapped) return;

      e.preventDefault();
      e.stopPropagation();

      if (localHeldSetRef.current.has(mapped.code)) return;
      localHeldSetRef.current.add(mapped.code);
      setGuestHeldKeys(
        Array.from(localHeldSetRef.current).map(
          (c) => KEY_CODE_TABLE[c]?.label || c
        )
      );

      sendCloudSignal("KEY", {
        action: "keydown",
        key: mapped.key,
        code: mapped.code,
        keyCode: mapped.keyCode,
        label: mapped.label,
      });
    };

    const onGuestKeyUp = (e: KeyboardEvent) => {
      const mapped = mapGuestKeyEvent(e, guestRole, remap);
      if (!mapped) return;

      e.preventDefault();
      e.stopPropagation();

      localHeldSetRef.current.delete(mapped.code);
      setGuestHeldKeys(
        Array.from(localHeldSetRef.current).map(
          (c) => KEY_CODE_TABLE[c]?.label || c
        )
      );

      sendCloudSignal("KEY", {
        action: "keyup",
        key: mapped.key,
        code: mapped.code,
        keyCode: mapped.keyCode,
        label: mapped.label,
      });
    };

    const onWindowBlur = () => {
      for (const code of localHeldSetRef.current) {
        const info = KEY_CODE_TABLE[code];
        if (info) {
          sendCloudSignal("KEY", {
            action: "keyup",
            key: info.key,
            code: info.code,
            keyCode: info.keyCode,
            label: info.label,
          });
        }
      }
      localHeldSetRef.current.clear();
      setGuestHeldKeys([]);
    };

    window.addEventListener("keydown", onGuestKeyDown, { capture: true });
    window.addEventListener("keyup", onGuestKeyUp, { capture: true });
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onGuestKeyDown, { capture: true });
      window.removeEventListener("keyup", onGuestKeyUp, { capture: true });
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [cloudParty, isCloudGuest, guestStageFull, isOpen, activeTabMode, sendCloudSignal]);

  const handleCreateCloudParty = async () => {
    if (cloudBusy) return;
    setCloudBusy(true);
    try {
      const tab = store.getActiveTab();
      const gameUrl = tab?.iframe?.src || "";
      const res = await fetch("/api/cloudplay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: getClientId(),
          username: getActiveUser(),
          gameTitle: activeGameTitle,
          gameUrl,
          hostRole: hostRolePref,
          guestRole: guestRolePref,
          remapGuestWasdToArrows: remapGuestWasd,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.party) {
        setCloudParty(data.party);
        notifyToast(
          `cloudplay party #${data.party.code} created! share the code with player 2`,
          "success"
        );
      } else {
        notifyToast(data.error || "failed to create cloudplay party", "error");
      }
    } catch {
      notifyToast("network error creating party", "error");
    } finally {
      setCloudBusy(false);
    }
  };

  const handleJoinCloudParty = async (e?: Event) => {
    if (e) e.preventDefault();
    const cleanCode = joinCodeInput.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (!cleanCode || cleanCode.length < 4) {
      notifyToast("enter your friend's 6-character party code", "error");
      return;
    }
    if (cloudBusy) return;
    setCloudBusy(true);
    try {
      const res = await fetch("/api/cloudplay/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: cleanCode,
          clientId: getClientId(),
          username: getActiveUser(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.party) {
        const joinedParty = data.party as CloudPlayParty;
        setCloudParty(joinedParty);
        setHostRolePref(joinedParty.settings.hostRole);
        setGuestRolePref(joinedParty.settings.guestRole);
        setRemapGuestWasd(joinedParty.settings.remapGuestWasdToArrows);
        setJoinCodeInput("");
        notifyToast(
          `joined @${joinedParty.host.username}'s cloudplay party (#${joinedParty.code})!`,
          "success"
        );
        // Notify Host via broadcast & SSE that Guest is ready for WebRTC stream
        try {
          cloudBcRef.current?.postMessage({
            type: "cloudplay-event",
            code: joinedParty.code,
            eventType: "PARTY_UPDATED",
            party: joinedParty,
            joinedUser: getActiveUser(),
          });
        } catch {}
        sendCloudSignal("GUEST_READY", { username: getActiveUser() }, joinedParty.code);
      } else {
        notifyToast(data.error || "could not join cloudplay party", "error");
      }
    } catch {
      notifyToast("network error joining party", "error");
    } finally {
      setCloudBusy(false);
    }
  };

  const handleLeaveCloudParty = async () => {
    if (!cloudParty) return;
    const code = cloudParty.code;
    cleanupCloudRtc();
    setCloudParty(null);
    setGuestStageFull(false);
    try {
      cloudBcRef.current?.postMessage({
        type: "cloudplay-event",
        code,
        eventType: isCloudHost ? "PARTY_CLOSED" : "GUEST_LEFT",
        reason: `${getActiveUser()} left the party`,
        leftUser: getActiveUser(),
      });
    } catch {}
    await fetch("/api/cloudplay/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        clientId: getClientId(),
        username: getActiveUser(),
      }),
    }).catch(() => {});
    notifyToast("left cloudplay party", "info");
  };

  const handleUpdateCloudSettings = async (
    nextHostRole: "wasd" | "arrows" | "all",
    nextGuestRole: "arrows" | "wasd" | "all",
    nextRemap: boolean
  ) => {
    setHostRolePref(nextHostRole);
    setGuestRolePref(nextGuestRole);
    setRemapGuestWasd(nextRemap);
    if (!cloudParty) return;
    try {
      const res = await fetch("/api/cloudplay/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: cloudParty.code,
          hostRole: nextHostRole,
          guestRole: nextGuestRole,
          remapGuestWasdToArrows: nextRemap,
        }),
      });
      const data = await res.json();
      if (res.ok && data.party) {
        setCloudParty(data.party);
        try {
          cloudBcRef.current?.postMessage({
            type: "cloudplay-event",
            code: cloudParty.code,
            eventType: "PARTY_UPDATED",
            party: data.party,
          });
        } catch {}
      }
    } catch {}
  };

  const currentSpaceMessages = spaceMessages.filter((m) => m.channel === spaceChannelId);

  return (
    <>
      {/* Floating CloudPlay Host Pill when playing full-screen with Modal closed */}
      {cloudParty && !isOpen && !guestStageFull && (
        <div
          style={{
            position: "fixed",
            bottom: "18px",
            left: "18px",
            zIndex: 999990,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "9px 14px",
            borderRadius: "16px",
            backgroundColor: "rgba(12, 12, 16, 0.88)",
            backdropFilter: "blur(14px)",
            border: "1px solid var(--bg-surface-10)",
            color: "var(--text-primary)",
            fontSize: "12px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: cloudParty.guest ? "#4ade80" : "#facc15",
              display: "inline-block",
            }}
          />
          <span>
            <strong>cloudplay #{cloudParty.code}</strong> ·{" "}
            {cloudParty.guest
              ? `2/2 (@${cloudParty.host.username} + @${cloudParty.guest.username})`
              : "1/2 waiting for friend"}
          </span>
          {guestHeldKeys.length > 0 && (
            <span
              style={{
                padding: "2px 7px",
                borderRadius: "8px",
                backgroundColor: "var(--bg-surface-7)",
                color: "#4ade80",
                fontWeight: 600,
              }}
            >
              p2 keys: {guestHeldKeys.join(" ")}
            </span>
          )}
          <button
            type="button"
            class="chat-header-btn voice-active"
            style={{ padding: "4px 9px", fontSize: "11px" }}
            onClick={() => {
              if (isCloudGuest) {
                setGuestStageFull(true);
              } else {
                setActiveTabMode("cloudplay");
                setIsOpen(true);
              }
            }}
          >
            {isCloudGuest ? "open live stage" : "party settings"}
          </button>
        </div>
      )}

      {/* Full-Viewport CloudPlay Guest Live Stage (for Player 2 playing Host's game instance) */}
      {cloudParty && isCloudGuest && guestStageFull && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999996,
            backgroundColor: "#050507",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Top Stage Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 18px",
              backgroundColor: "var(--bg-body)",
              borderBottom: "1px solid var(--bg-surface-10)",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: "10px",
                  backgroundColor: "var(--bg-surface-6)",
                  fontWeight: 700,
                  fontSize: "12.5px",
                  color: "#4ade80",
                }}
              >
                <i class="fa-solid fa-tower-broadcast" /> cloudplay #{cloudParty.code} · 2/2
              </span>
              <span style={{ fontSize: "13px", color: "var(--text-primary)" }}>
                playing <strong>{cloudParty.gameTitle}</strong> on @{cloudParty.host.username}'s game instance
              </span>
              <span style={{ fontSize: "11.5px", color: "var(--color-sublabel)" }}>
                ({p2pConnected ? "webrtc p2p low-latency" : "cloud relay active"})
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "10px",
                  backgroundColor: "var(--bg-surface-4)",
                  color: "var(--text-primary)",
                }}
              >
                your controls:{" "}
                <strong>
                  {cloudParty.settings.remapGuestWasdToArrows
                    ? "WASD (auto-sent as Arrow Keys)"
                    : cloudParty.settings.guestRole.toUpperCase()}
                </strong>
                {guestHeldKeys.length > 0 ? ` · pressing: [${guestHeldKeys.join(" ")}]` : ""}
              </span>
              <button
                type="button"
                class="chat-header-btn"
                onClick={() =>
                  handleUpdateCloudSettings(
                    cloudParty.settings.hostRole,
                    cloudParty.settings.guestRole,
                    !cloudParty.settings.remapGuestWasdToArrows
                  )
                }
              >
                <i class="fa-solid fa-keyboard" />
                <span>
                  {cloudParty.settings.remapGuestWasdToArrows
                    ? "using WASD -> arrows"
                    : "remap my WASD -> arrows"}
                </span>
              </button>
              <button
                type="button"
                class="chat-header-btn"
                onClick={() => {
                  setGuestStageFull(false);
                  setActiveTabMode("cloudplay");
                  setIsOpen(true);
                }}
              >
                <i class="fa-solid fa-compress" />
                <span>dock</span>
              </button>
              <button
                type="button"
                class="chat-header-btn danger"
                onClick={handleLeaveCloudParty}
              >
                <i class="fa-solid fa-right-from-bracket" />
                <span>leave party</span>
              </button>
            </div>
          </div>

          {/* Live Stream Canvas / Video Stage */}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              overflow: "hidden",
              backgroundColor: "#000",
            }}
            tabIndex={0}
          >
            <video
              ref={guestVideoRef}
              autoplay
              playsInline
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                display: remoteVideoActive ? "block" : "none",
              }}
            />
            {!remoteVideoActive && latestFrameUrl && (
              <img
                src={latestFrameUrl}
                alt="cloudplay live stream"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
            )}
            {!remoteVideoActive && !latestFrameUrl && (
              <div style={{ textAlign: "center", color: "var(--color-sublabel)", padding: "24px" }}>
                <i class="fa-solid fa-tower-broadcast" style={{ fontSize: "34px", marginBottom: "12px" }} />
                <div style={{ fontSize: "15px", color: "var(--text-primary)", marginBottom: "6px" }}>
                  connected to @{cloudParty.host.username}'s game instance!
                </div>
                <div style={{ fontSize: "12.5px" }}>
                  press your keys ({cloudParty.settings.remapGuestWasdToArrows ? "WASD or Arrow Keys" : cloudParty.settings.guestRole.toUpperCase()}) right now — op cookie is sending your keystrokes live to the host's game!
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isOpen && (
      <div
        class="chat-modal-overlay open"
        onClick={(e) => {
          if (e.target === e.currentTarget) setIsOpen(false);
        }}
      >
        <div
          class="chat-app-window"
          style={{ maxWidth: "780px", height: "80vh", flexDirection: "column" }}
        >
          {/* Modal Header */}
          <div class="chat-main-header">
            <div class="chat-main-header-left">
              <div class="chat-main-channel-name">
                <i
                  class={`fa-solid ${
                    activeTabMode === "cloudplay"
                      ? "fa-tower-broadcast"
                      : activeTabMode === "space"
                      ? "fa-users-rectangle"
                      : "fa-trophy"
                  }`}
                ></i>
                <span>{activeGameTitle}</span>
              </div>
              <div class="chat-main-channel-desc">
                {activeTabMode === "cloudplay"
                  ? "cloudplay · play 2-player local co-op games (wasd + arrows) across 2 computers"
                  : "game leaderboard & private player space"}
              </div>
            </div>

            <div class="chat-main-header-actions">
              {hasActiveGameContext && (
                <>
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
                </>
              )}
              <button
                type="button"
                class={`chat-header-btn ${activeTabMode === "cloudplay" ? "voice-active" : ""}`}
                onClick={() => setActiveTabMode("cloudplay")}
              >
                <i class="fa-solid fa-tower-broadcast"></i>
                <span>
                  cloudplay {cloudParty ? `(${cloudParty.guest ? "2/2" : "1/2"})` : "(2p)"}
                </span>
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

          {activeTabMode === "cloudplay" ? (
            /* CLOUDPLAY 2-PLAYER CO-OP VIEW */
            <div class="chat-feed" style={{ gap: "14px", padding: "18px" }}>
              {/* Intro Banner */}
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "14px",
                  backgroundColor: "var(--bg-surface-3)",
                  border: "1px solid var(--bg-surface-10)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
                    <i class="fa-solid fa-gamepad" style={{ marginRight: "6px" }} />
                    cloudplay · 2-player local games over the cloud (max 2 players)
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-sublabel)" }}>
                    runs <strong>one game instance</strong> on player 1's computer while player 2 joins with a party code from their own computer. op cookie reads player 2's keybinds and injects them straight into the game!
                  </div>
                </div>
              </div>

              {!cloudParty ? (
                /* CREATE OR JOIN PARTY */
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
                    gap: "14px",
                  }}
                >
                  {/* Card 1: Host a 2-Player Party */}
                  <div
                    style={{
                      padding: "18px",
                      borderRadius: "15px",
                      backgroundColor: "var(--bg-surface-4)",
                      border: "1px solid var(--bg-surface-10)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
                        <i class="fa-solid fa-crown" style={{ color: "#facc15", marginRight: "6px" }} />
                        host a 2-player party (player 1)
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--color-sublabel)" }}>
                        open any 2-player game (fireboy & watergirl, basket random, getaway shootout, etc.) and create a party code for your friend.
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "12.5px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--color-sublabel)" }}>your keybinds (player 1):</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {(["wasd", "arrows", "all"] as const).map((r) => (
                            <button
                              key={r}
                              type="button"
                              class={`chat-header-btn ${hostRolePref === r ? "voice-active" : ""}`}
                              style={{ padding: "4px 9px", fontSize: "11.5px" }}
                              onClick={() => {
                                setHostRolePref(r);
                                if (r === "wasd") setGuestRolePref("arrows");
                                else if (r === "arrows") setGuestRolePref("wasd");
                              }}
                            >
                              {r.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--color-sublabel)" }}>friend's keybinds (player 2):</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          {(["arrows", "wasd", "all"] as const).map((r) => (
                            <button
                              key={r}
                              type="button"
                              class={`chat-header-btn ${guestRolePref === r ? "voice-active" : ""}`}
                              style={{ padding: "4px 9px", fontSize: "11.5px" }}
                              onClick={() => setGuestRolePref(r)}
                            >
                              {r.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "8px 10px",
                          borderRadius: "10px",
                          backgroundColor: "var(--bg-surface-6)",
                          cursor: "pointer",
                          fontSize: "12px",
                          color: "var(--text-primary)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={remapGuestWasd}
                          onChange={(e) => setRemapGuestWasd(e.currentTarget.checked)}
                        />
                        <span>
                          let friend press <strong>WASD</strong> on their keyboard (op cookie converts it to <strong>arrow keys</strong>)
                        </span>
                      </label>
                    </div>

                    <button
                      type="button"
                      class="auth-action-btn"
                      style={{ marginTop: "auto" }}
                      disabled={cloudBusy}
                      onClick={handleCreateCloudParty}
                    >
                      <i class="fa-solid fa-plus" style={{ marginRight: "6px" }} />
                      {cloudBusy ? "creating party..." : "create 2-player party"}
                    </button>
                  </div>

                  {/* Card 2: Join Friend's Party by Code */}
                  <div
                    style={{
                      padding: "18px",
                      borderRadius: "15px",
                      backgroundColor: "var(--bg-surface-4)",
                      border: "1px solid var(--bg-surface-10)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "4px" }}>
                        <i class="fa-solid fa-right-to-bracket" style={{ color: "#4ade80", marginRight: "6px" }} />
                        join friend's party (player 2)
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--color-sublabel)" }}>
                        enter the 6-character party code from your friend to stream their game instance and send your keybinds in real time.
                      </div>
                    </div>

                    <form
                      onSubmit={handleJoinCloudParty}
                      style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "auto" }}
                    >
                      <input
                        type="text"
                        class="admin-input"
                        placeholder="enter 6-digit party code (e.g. 7K4M9X)..."
                        value={joinCodeInput}
                        maxLength={8}
                        style={{
                          textAlign: "center",
                          fontSize: "18px",
                          fontWeight: 700,
                          letterSpacing: "3px",
                          textTransform: "uppercase",
                        }}
                        onInput={(e) =>
                          setJoinCodeInput((e.target as HTMLInputElement).value.toUpperCase())
                        }
                      />
                      <button
                        type="submit"
                        class="auth-action-btn"
                        disabled={cloudBusy || !joinCodeInput.trim()}
                      >
                        <i class="fa-solid fa-plug" style={{ marginRight: "6px" }} />
                        {cloudBusy ? "joining..." : "join 2-player party"}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                /* ACTIVE CLOUDPLAY PARTY DASHBOARD */
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {/* Party Code & Status Header */}
                  <div
                    style={{
                      padding: "16px 18px",
                      borderRadius: "15px",
                      backgroundColor: "var(--bg-surface-4)",
                      border: "1px solid var(--bg-surface-10)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div
                        style={{
                          padding: "10px 16px",
                          borderRadius: "12px",
                          backgroundColor: "var(--bg-surface-7)",
                          border: "1px solid var(--bg-surface-10)",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: "10px", color: "var(--color-sublabel)" }}>
                          party code (max 2)
                        </div>
                        <div
                          style={{
                            fontSize: "22px",
                            fontWeight: 800,
                            letterSpacing: "3px",
                            color: "#4ade80",
                          }}
                        >
                          {cloudParty.code}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: "14.5px", fontWeight: 600, color: "var(--text-primary)" }}>
                          {cloudParty.gameTitle} ·{" "}
                          <span style={{ color: cloudParty.guest ? "#4ade80" : "#facc15" }}>
                            {cloudParty.guest ? "2/2 players connected" : "1/2 waiting for friend to join..."}
                          </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-sublabel)", marginTop: "3px" }}>
                          {isCloudHost
                            ? "you are hosting the game instance. close this window anytime to play while player 2's keys are injected live!"
                            : `connected to @${cloudParty.host.username}'s game instance! press your keys below or expand to full screen.`}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        class="chat-header-btn"
                        onClick={() => {
                          navigator.clipboard?.writeText(cloudParty.code).catch(() => {});
                          notifyToast(`copied party code ${cloudParty.code}!`, "success");
                        }}
                      >
                        <i class="fa-solid fa-copy" />
                        <span>copy code</span>
                      </button>
                      {isCloudGuest && (
                        <button
                          type="button"
                          class="chat-header-btn voice-active"
                          onClick={() => {
                            setIsOpen(false);
                            setGuestStageFull(true);
                          }}
                        >
                          <i class="fa-solid fa-expand" />
                          <span>fullscreen stage</span>
                        </button>
                      )}
                      <button
                        type="button"
                        class="chat-header-btn danger"
                        onClick={handleLeaveCloudParty}
                      >
                        <i class="fa-solid fa-right-from-bracket" />
                        <span>{isCloudHost ? "end party" : "leave party"}</span>
                      </button>
                    </div>
                  </div>

                  {/* 2-Player Slots & Live Pressed Keys Visualizer */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                      gap: "12px",
                    }}
                  >
                    {/* Player 1 (Host) */}
                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "14px",
                        backgroundColor: "var(--bg-surface-3)",
                        border: "1px solid var(--bg-surface-10)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          <i class="fa-solid fa-crown" style={{ color: "#facc15", marginRight: "6px" }} />
                          player 1 (host): @{cloudParty.host.username}
                        </span>
                        <span class="chat-you-pill">
                          {cloudParty.settings.hostRole.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: "11.5px", color: "var(--color-sublabel)", marginBottom: "8px" }}>
                        runs the game instance · live keys:
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", minHeight: "26px" }}>
                        {hostHeldKeys.length === 0 ? (
                          <span style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                            no keys pressed
                          </span>
                        ) : (
                          hostHeldKeys.map((k) => (
                            <span
                              key={k}
                              style={{
                                padding: "3px 9px",
                                borderRadius: "8px",
                                backgroundColor: "var(--bg-surface-7)",
                                color: "#4ade80",
                                fontWeight: 700,
                                fontSize: "12px",
                              }}
                            >
                              {k}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Player 2 (Guest) */}
                    <div
                      style={{
                        padding: "14px",
                        borderRadius: "14px",
                        backgroundColor: "var(--bg-surface-3)",
                        border: "1px solid var(--bg-surface-10)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                          <i class="fa-solid fa-gamepad" style={{ color: "#4ade80", marginRight: "6px" }} />
                          player 2 (guest):{" "}
                          {cloudParty.guest ? `@${cloudParty.guest.username}` : "waiting..."}
                        </span>
                        <span class="chat-you-pill">
                          {cloudParty.settings.remapGuestWasdToArrows
                            ? "WASD -> ARROWS"
                            : cloudParty.settings.guestRole.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: "11.5px", color: "var(--color-sublabel)", marginBottom: "8px" }}>
                        remote keybinds injected into host's game:
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", minHeight: "26px" }}>
                        {guestHeldKeys.length === 0 ? (
                          <span style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                            {cloudParty.guest ? "press your keys to test!" : "waiting for friend to join..."}
                          </span>
                        ) : (
                          guestHeldKeys.map((k) => (
                            <span
                              key={k}
                              style={{
                                padding: "3px 9px",
                                borderRadius: "8px",
                                backgroundColor: "var(--bg-surface-7)",
                                color: "#38bdf8",
                                fontWeight: 700,
                                fontSize: "12px",
                              }}
                            >
                              {k}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Live Keybind Role Switcher */}
                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: "12px",
                      backgroundColor: "var(--bg-surface-3)",
                      border: "1px solid var(--bg-surface-10)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "10px",
                      fontSize: "12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <span style={{ color: "var(--color-sublabel)" }}>player 2 key mode:</span>
                      {(["arrows", "wasd", "all"] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          class={`chat-header-btn ${
                            cloudParty.settings.guestRole === r ? "voice-active" : ""
                          }`}
                          style={{ padding: "4px 9px", fontSize: "11.5px" }}
                          onClick={() =>
                            handleUpdateCloudSettings(
                              cloudParty.settings.hostRole,
                              r,
                              cloudParty.settings.remapGuestWasdToArrows
                            )
                          }
                        >
                          {r.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        cursor: "pointer",
                        color: "var(--text-primary)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={cloudParty.settings.remapGuestWasdToArrows}
                        onChange={(e) =>
                          handleUpdateCloudSettings(
                            cloudParty.settings.hostRole,
                            cloudParty.settings.guestRole,
                            e.currentTarget.checked
                          )
                        }
                      />
                      <span>comfort remap: convert player 2's WASD into Arrow Keys</span>
                    </label>
                  </div>

                  {/* Guest Docked Live Stream Preview */}
                  {isCloudGuest && (
                    <div
                      style={{
                        borderRadius: "14px",
                        overflow: "hidden",
                        border: "1px solid var(--bg-surface-10)",
                        backgroundColor: "#000",
                        height: "310px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                      }}
                      tabIndex={0}
                    >
                      {!guestStageFull && (
                        <video
                          ref={guestVideoRef}
                          autoplay
                          playsInline
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            display: remoteVideoActive ? "block" : "none",
                          }}
                        />
                      )}
                      {!remoteVideoActive && latestFrameUrl && (
                        <img
                          src={latestFrameUrl}
                          alt="host game stream"
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            userSelect: "none",
                            pointerEvents: "none",
                          }}
                        />
                      )}
                      {!remoteVideoActive && !latestFrameUrl && (
                        <div style={{ textAlign: "center", color: "var(--color-sublabel)", padding: "20px" }}>
                          <div style={{ fontSize: "13.5px", color: "var(--text-primary)", marginBottom: "4px" }}>
                            connected to @{cloudParty.host.username}'s game!
                          </div>
                          <div style={{ fontSize: "12px" }}>
                            press your keys now to control player 2 on the host's game, or click "fullscreen stage" above!
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : activeTabMode === "leaderboard" ? (
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
      )}
    </>
  );
}
