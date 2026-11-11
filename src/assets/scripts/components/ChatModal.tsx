import { useEffect, useRef, useState } from "preact/hooks";

interface ChatMessage {
  id: string;
  author: string;
  avatarColor: string;
  text: string;
  timestamp: string;
  channel: string;
  isSystem?: boolean;
}

const CHANNELS = [
  { id: "general", name: "#general", icon: "fa-hashtag" },
  { id: "games", name: "#games", icon: "fa-gamepad" },
  { id: "off-topic", name: "#off-topic", icon: "fa-comment-dots" },
];

const AVATAR_COLORS = [
  "#f97316", // orange
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#10b981", // emerald
  "#3b82f6", // blue
  "#eab308", // yellow
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    id: "welcome-1",
    author: "CookieBot",
    avatarColor: "#ff9800",
    text: "Welcome to the Operation Cookie chatroom! Chat with players, share game tips, and hang out.",
    timestamp: "12:00 PM",
    channel: "general",
    isSystem: true,
  },
  {
    id: "msg-2",
    author: "RetroWave",
    avatarColor: "#8b5cf6",
    text: "Has anyone beat Retro Bowl on extreme difficulty yet?",
    timestamp: "12:05 PM",
    channel: "games",
  },
  {
    id: "msg-3",
    author: "Nova",
    avatarColor: "#06b6d4",
    text: "Slope is running super smooth on here today 🔥",
    timestamp: "12:12 PM",
    channel: "general",
  },
];

export default function ChatModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState("general");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem("cookie_chat_messages");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_MESSAGES;
  });

  const [inputText, setInputText] = useState("");
  const [onlineCount] = useState(() => Math.floor(Math.random() * 20) + 15);
  const [nickname, setNickname] = useState(() => {
    try {
      const auth = JSON.parse(localStorage.getItem("auth_user") || "{}");
      if (auth.username) return auth.username;
    } catch {}
    const savedNick = localStorage.getItem("cookie_chat_nickname");
    if (savedNick) return savedNick;
    const randomId = Math.floor(Math.random() * 900) + 100;
    return `CookiePlayer_${randomId}`;
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  // Scroll to bottom on message change or modal open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    }
  }, [messages, isOpen, activeChannel]);

  // Setup broadcast channel & global toggle event
  useEffect(() => {
    const handleToggle = () => setIsOpen((prev) => !prev);
    const handleClose = () => setIsOpen(false);

    document.addEventListener("toggleChatModal", handleToggle);
    document.addEventListener("closeChatModal", handleClose);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    // Sync across open browser tabs
    try {
      const bc = new BroadcastChannel("cookie_chat_broadcast");
      bc.onmessage = (event) => {
        if (event.data?.type === "NEW_MESSAGE" && event.data.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === event.data.message.id)) return prev;
            const updated = [...prev, event.data.message];
            try {
              localStorage.setItem("cookie_chat_messages", JSON.stringify(updated.slice(-100)));
            } catch {}
            return updated;
          });
        }
      };
      broadcastRef.current = bc;
    } catch {}

    return () => {
      document.removeEventListener("toggleChatModal", handleToggle);
      document.removeEventListener("closeChatModal", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
      broadcastRef.current?.close();
    };
  }, [isOpen]);

  const handleSendMessage = (e?: Event) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    const newMsg: ChatMessage = {
      id: "msg-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6),
      author: nickname,
      avatarColor: getAvatarColor(nickname),
      text: trimmed,
      timestamp: formatTime(new Date()),
      channel: activeChannel,
    };

    setMessages((prev) => {
      const updated = [...prev, newMsg].slice(-100);
      try {
        localStorage.setItem("cookie_chat_messages", JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setInputText("");

    // Broadcast to other tabs
    try {
      broadcastRef.current?.postMessage({ type: "NEW_MESSAGE", message: newMsg });
    } catch {}
  };

  const handleEditNickname = () => {
    const next = window.prompt("Enter your chat nickname:", nickname);
    if (next && next.trim()) {
      const clean = next.trim().slice(0, 20);
      setNickname(clean);
      localStorage.setItem("cookie_chat_nickname", clean);
    }
  };

  const currentChannelMessages = messages.filter(
    (m) => (m.channel || "general") === activeChannel
  );

  return (
    <div
      class={`chat-modal-overlay ${isOpen ? "open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false);
      }}
    >
      <div class="chat-window">
        {/* Header */}
        <div class="chat-header">
          <div class="chat-header-left">
            <div class="chat-header-title">
              <i class="fa-solid fa-comments"></i>
              <span>Operation Cookie Chat</span>
            </div>
            <div class="chat-online-badge">
              <span class="chat-online-dot"></span>
              <span>{onlineCount} online</span>
            </div>
          </div>
          <div class="chat-header-actions">
            <button
              class="chat-action-btn"
              title="Close chat"
              onClick={() => setIsOpen(false)}
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </div>

        {/* Channels bar */}
        <div class="chat-channels">
          {CHANNELS.map((ch) => (
            <button
              key={ch.id}
              class={`chat-channel-btn ${activeChannel === ch.id ? "active" : ""}`}
              onClick={() => setActiveChannel(ch.id)}
            >
              <i class={`fa-solid ${ch.icon}`}></i>
              <span>{ch.name}</span>
            </button>
          ))}
        </div>

        {/* Nickname identity bar */}
        <div class="chat-nick-bar">
          <div class="chat-nick-tag">
            <span>Chatting as:</span>
            <strong style={{ color: getAvatarColor(nickname) }}>{nickname}</strong>
            <span
              class="chat-nick-edit"
              onClick={handleEditNickname}
              title="Change your nickname"
            >
              (change)
            </span>
          </div>
          <div>{CHANNELS.find((c) => c.id === activeChannel)?.name}</div>
        </div>

        {/* Messages List */}
        <div class="chat-messages">
          {currentChannelMessages.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", margin: "auto" }}>
              <i class="fa-regular fa-comment-dots" style={{ fontSize: "28px", marginBottom: "8px", display: "block" }}></i>
              <span>No messages yet in #{activeChannel}. Say hi!</span>
            </div>
          ) : (
            currentChannelMessages.map((msg) => {
              const isOwn = msg.author.toLowerCase() === nickname.toLowerCase();
              return (
                <div
                  key={msg.id}
                  class={`chat-msg ${isOwn ? "is-own" : ""} ${msg.isSystem ? "is-system" : ""}`}
                >
                  <div
                    class="chat-avatar"
                    style={{ backgroundColor: msg.avatarColor || getAvatarColor(msg.author) }}
                  >
                    {msg.author.slice(0, 2)}
                  </div>
                  <div class="chat-msg-body">
                    <div class="chat-msg-meta">
                      <span class="chat-author">{msg.author}</span>
                      {isOwn && <span class="chat-badge you">YOU</span>}
                      {msg.isSystem && <span class="chat-badge system">BOT</span>}
                      <span class="chat-time">{msg.timestamp}</span>
                    </div>
                    <div class="chat-text">{msg.text}</div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input Bar */}
        <form class="chat-input-bar" onSubmit={handleSendMessage}>
          <div class="chat-input-wrap">
            <input
              type="text"
              class="chat-input"
              placeholder={`Message #${activeChannel}...`}
              value={inputText}
              onInput={(e) => setInputText((e.target as HTMLInputElement).value)}
              maxLength={300}
            />
          </div>
          <button
            type="submit"
            class="chat-send-btn"
            disabled={!inputText.trim()}
            title="Send Message"
          >
            <i class="fa-solid fa-paper-plane"></i>
          </button>
        </form>
      </div>
    </div>
  );
}
