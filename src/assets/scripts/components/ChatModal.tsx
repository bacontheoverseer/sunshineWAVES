import { useEffect, useRef, useState, useMemo } from "preact/hooks";
import { checkContent } from "../core/contentFilter.ts";

interface ChatMessage {
  id: string;
  author: string;
  avatarColor: string;
  text: string;
  timestamp: string;
  channel: string;
}

interface OnlineUser {
  username: string;
  color: string;
  status?: string;
  isSelf?: boolean;
}

interface Category {
  id: string;
  label: string;
  channels: { id: string; name: string; isHash?: boolean }[];
}

const CATEGORIES: Category[] = [
  {
    id: "info",
    label: "info",
    channels: [
      { id: "rules", name: "rules", isHash: false },
      { id: "announcements", name: "announcements", isHash: false },
      { id: "updates", name: "updates", isHash: false },
    ],
  },
  {
    id: "social",
    label: "social",
    channels: [
      { id: "general", name: "general", isHash: true },
      { id: "introductions", name: "introductions", isHash: true },
      { id: "off-topic", name: "off-topic", isHash: true },
    ],
  },
  {
    id: "interests",
    label: "interests",
    channels: [
      { id: "games", name: "games", isHash: true },
      { id: "anime", name: "anime", isHash: true },
      { id: "manga", name: "manga", isHash: true },
      { id: "music", name: "music", isHash: true },
      { id: "movies", name: "movies", isHash: true },
      { id: "tech", name: "tech", isHash: true },
    ],
  },
  {
    id: "support",
    label: "support",
    channels: [
      { id: "help", name: "help", isHash: true },
    ],
  },
];

const PALETTE = [
  "#b45309", // warm amber/brown (like in screenshot)
  "#4338ca", // indigo
  "#78350f", // terracotta
  "#9a3412", // rust
  "#1e3a8a", // navy
  "#047857", // deep emerald
  "#6b21a8", // dark purple
  "#0e7490", // deep cyan
  "#be123c", // crimson
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

// Formats text with clickable URLs and orange @mentions
function renderFormattedText(text: string) {
  const parts = text.split(/(\bhttps?:\/\/[^\s]+|@[a-zA-Z0-9_]+)/g);
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
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  // Check CloudSync login state
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

  // Real messages only (no fake messages)
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

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

  // Modal open / close handlers & BroadcastChannel
  useEffect(() => {
    const handleToggle = () => setIsOpen((prev) => !prev);
    const handleClose = () => setIsOpen(false);

    document.addEventListener("toggleChatModal", handleToggle);
    document.addEventListener("closeChatModal", handleClose);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);

    try {
      const bc = new BroadcastChannel("cookie_chat_v2_channel");
      bc.onmessage = (event) => {
        if (event.data?.type === "NEW_MESSAGE" && event.data.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === event.data.message.id)) return prev;
            const updated = [...prev, event.data.message];
            try {
              localStorage.setItem("cookie_chat_messages_v2", JSON.stringify(updated.slice(-200)));
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

  // Scroll to bottom when messages change or channel changes
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 40);
    }
  }, [messages, isOpen, activeChannel]);

  const handleSendMessage = (e?: Event) => {
    if (e) e.preventDefault();
    if (!cloudUser) return;
    const text = inputText.trim();
    if (!text) return;

    const filter = checkContent(text);
    if (filter.blocked) {
      alert(`⚠️ Message blocked: ${filter.reason}`);
      return;
    }

    const newMsg: ChatMessage = {
      id: "msg_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      author: cloudUser,
      avatarColor: stringToColor(cloudUser),
      text,
      timestamp: formatClockTime(new Date()),
      channel: activeChannel,
    };

    setMessages((prev) => {
      const updated = [...prev, newMsg].slice(-200);
      try {
        localStorage.setItem("cookie_chat_messages_v2", JSON.stringify(updated));
      } catch {}
      return updated;
    });

    setInputText("");

    try {
      broadcastRef.current?.postMessage({ type: "NEW_MESSAGE", message: newMsg });
    } catch {}
  };

  const handleOpenCloudSyncModal = () => {
    document.dispatchEvent(new CustomEvent("toggleAuthModal"));
  };

  const toggleCategory = (catId: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }));
  };

  // Filter messages for active channel
  const channelMessages = useMemo(
    () => messages.filter((m) => m.channel === activeChannel),
    [messages, activeChannel]
  );

  // Online members list based on current user + active channel authors
  const onlineUsers = useMemo(() => {
    const map = new Map<string, OnlineUser>();
    if (cloudUser) {
      map.set(cloudUser.toLowerCase(), {
        username: cloudUser,
        color: stringToColor(cloudUser),
        isSelf: true,
      });
    }
    // Add authors who recently sent messages
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
  }, [cloudUser, messages]);

  const activeChannelDef = useMemo(() => {
    for (const cat of CATEGORIES) {
      const found = cat.channels.find((c) => c.id === activeChannel);
      if (found) return found;
    }
    return { id: activeChannel, name: activeChannel, isHash: true };
  }, [activeChannel]);

  return (
    <div
      class={`chat-modal-overlay ${isOpen ? "open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) setIsOpen(false);
      }}
    >
      <div class="chat-app-window">
        {/* Close Button */}
        <button
          class="chat-window-close"
          title="Close chat"
          onClick={() => setIsOpen(false)}
        >
          <i class="fa-solid fa-xmark"></i>
        </button>

        {/* ── COLUMN 1: Channels Sidebar ── */}
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <i class="fa-solid fa-cookie-bite"></i>
            <span>Operation Cookie</span>
          </div>

          <div class="chat-sidebar-scroll">
            {CATEGORIES.map((cat) => {
              const isCollapsed = !!collapsedCategories[cat.id];
              return (
                <div key={cat.id} class="chat-category">
                  <div
                    class="chat-category-title"
                    onClick={() => toggleCategory(cat.id)}
                  >
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

                  {!isCollapsed &&
                    cat.channels.map((ch) => (
                      <button
                        key={ch.id}
                        class={`chat-channel-item ${activeChannel === ch.id ? "active" : ""}`}
                        onClick={() => setActiveChannel(ch.id)}
                      >
                        <span class="chat-channel-prefix">
                          {ch.isHash ? "#" : "•"}
                        </span>
                        <span>{ch.name}</span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>

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
              <div
                style={{
                  fontSize: "12px",
                  color: "#ff9800",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                onClick={handleOpenCloudSyncModal}
              >
                <i class="fa-solid fa-arrow-right-to-bracket"></i>
                <span>Sign in with CloudSync</span>
              </div>
            )}
          </div>
        </div>

        {/* ── COLUMN 2: Center Chat Feed & Input ── */}
        <div class="chat-main">
          {/* Header */}
          <div class="chat-main-header">
            <div class="chat-main-channel-name">
              <span>{activeChannelDef.isHash ? "#" : ""}</span>
              <span>{activeChannelDef.name}</span>
            </div>
            <div class="chat-main-channel-desc">
              Welcome to the {activeChannelDef.name} channel!
            </div>
          </div>

          {/* Messages feed */}
          <div class="chat-feed">
            {channelMessages.length === 0 ? (
              <div class="chat-empty-state">
                <i class="fa-regular fa-comments"></i>
                <p>Welcome to #{activeChannelDef.name}!</p>
                <span style={{ fontSize: "11px", color: "#555" }}>
                  This is the start of the #{activeChannelDef.name} channel.
                </span>
              </div>
            ) : (
              channelMessages.map((msg) => {
                const isSelf = cloudUser && msg.author.toLowerCase() === cloudUser.toLowerCase();
                return (
                  <div key={msg.id} class="chat-entry">
                    <div
                      class="chat-entry-avatar"
                      style={{
                        backgroundColor: msg.avatarColor || stringToColor(msg.author),
                      }}
                    >
                      {msg.author.slice(0, 1).toLowerCase()}
                    </div>
                    <div class="chat-entry-content">
                      <div class="chat-entry-header">
                        <span class={`chat-entry-author ${isSelf ? "is-self" : ""}`}>
                          {msg.author}
                        </span>
                        <span class="chat-entry-time">{msg.timestamp}</span>
                      </div>
                      <div class="chat-entry-text">{renderFormattedText(msg.text)}</div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <div class="chat-input-container">
            {cloudUser ? (
              <form class="chat-input-pill" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  class="chat-input-field"
                  placeholder={`message #${activeChannelDef.name} (->w<-)`}
                  value={inputText}
                  onInput={(e) => setInputText((e.target as HTMLInputElement).value)}
                  maxLength={400}
                />
                <button
                  type="submit"
                  class="chat-submit-btn"
                  disabled={!inputText.trim()}
                  title="Send message"
                >
                  <i class="fa-solid fa-paper-plane"></i>
                </button>
              </form>
            ) : (
              <div class="chat-auth-locked">
                <div class="chat-auth-locked-text">
                  <i class="fa-solid fa-lock"></i>
                  <span>You must be signed into CloudSync to chat.</span>
                </div>
                <button
                  type="button"
                  class="chat-auth-login-btn"
                  onClick={handleOpenCloudSyncModal}
                >
                  Sign in to CloudSync
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── COLUMN 3: Right Online Users Sidebar ── */}
        <div class="chat-online-panel">
          <div class="chat-online-header">
            <span>online · {onlineUsers.length}</span>
          </div>

          <div class="chat-online-list">
            {onlineUsers.length === 0 ? (
              <div style={{ padding: "12px", color: "#666", fontSize: "11px", textAlign: "center" }}>
                no one online
              </div>
            ) : (
              onlineUsers.map((u) => (
                <div key={u.username} class="chat-user-item">
                  <div class="chat-user-avatar-wrap">
                    <div
                      class="chat-user-avatar"
                      style={{ backgroundColor: u.color }}
                    >
                      {u.username.slice(0, 1).toLowerCase()}
                    </div>
                    <div class="chat-user-dot"></div>
                  </div>
                  <div class="chat-user-meta">
                    <div class="chat-user-name-row">
                      <span class="chat-user-name">{u.username}</span>
                      {u.isSelf && <span class="chat-you-pill">you</span>}
                    </div>
                    {u.status && (
                      <span class="chat-user-status">{u.status}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
