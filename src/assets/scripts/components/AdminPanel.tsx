import { useState, useEffect, useCallback } from "preact/hooks";
import { playSfxByName, clearChaosEffects } from "../core/liveClient";

interface ClientRecord {
  id: string;
  username: string;
  ip: string;
  page: string;
  game: string;
  connectedAt: number;
  lastSeen: number;
}

const SFX_LIST = [
  { id: "vine-boom", icon: "💥", title: "Vine Boom", desc: "Sub-bass distorted drop with maximum punch" },
  { id: "discord-ping", icon: "🔔", title: "Discord Ping", desc: "Ghost notification ping to make them check Discord" },
  { id: "metal-pipe", icon: "🔩", title: "Metal Pipe Drop", desc: "Clattering inharmonic high-reverb metal pipe hit" },
  { id: "windows-usb", icon: "🔌", title: "USB Disconnect", desc: "Windows hardware disconnect chime (E5 -> C5)" },
  { id: "door-knock", icon: "🚪", title: "3D Door Knock", desc: "Realistic wooden knuckle raps right behind them" },
  { id: "bruh", icon: "🗿", title: "Bruh Sound Effect", desc: "Deep formant vocal inflection with bass" },
  { id: "fart", icon: "💨", title: "Fart Sound", desc: "Low-frequency modulated sawtooth flutter" },
  { id: "keyboard-clatter", icon: "⌨️", title: "Keyboard Clatter", desc: "Rapid burst of mechanical blue switches" },
  { id: "screamer", icon: "😱", title: "Glitch Screamer", desc: "Sudden dissonant screech jump scare" },
  { id: "xp-error", icon: "❌", title: "Windows XP Error", desc: "Iconic brassy Critical Stop ding" },
  { id: "rickroll", icon: "🕺", title: "Rickroll Melody", desc: "8-bit chiptune 'Never Gonna Give You Up'" },
];

const PRANK_LIST = [
  { id: "earthquake", icon: "🌋", title: "Earthquake Shake", desc: "Violently shakes the entire webpage for 5 seconds" },
  { id: "screen-flip", icon: "🔄", title: "180° Screen Flip", desc: "Turns the entire browser viewport upside down" },
  { id: "eyelash", icon: "🪶", title: "Monitor Eyelash", desc: "Spawns a hyper-realistic curved hair on their screen" },
  { id: "dead-pixel", icon: "🔴", title: "Dead Pixel Dot", desc: "Injects a bright red hot pixel in the middle of their display" },
  { id: "fake-battery", icon: "🪫", title: "Low Battery Alert", desc: "Windows 11 notification: 'Battery critically low (3%)'" },
  { id: "admin-monitor", icon: "👁️", title: "Admin Monitor Banner", desc: "Red top banner stating their session is being recorded" },
  { id: "panic-doc", icon: "📄", title: "Google Doc Disguise", desc: "Instant full-screen AP History research paper disguise" },
  { id: "ghost-cursor", icon: "👻", title: "Ghost Cursor", desc: "Animated Windows mouse pointer drifting erratically" },
  { id: "flash-title", icon: "🚨", title: "Flashing Tab Title", desc: "Cycles tab title with '⚠️ VIOLATION DETECTED'" },
  { id: "invert-colors", icon: "🌓", title: "Invert Colors", desc: "High-contrast negative inverted color scheme" },
  { id: "matrix-rain", icon: "💻", title: "Matrix Code Rain", desc: "Falling green digital matrix rain characters" },
  { id: "blur", icon: "🌫️", title: "Drunk Blur", desc: "Applies a heavy gaussian blur over the entire website" },
];

const TTS_PRESETS = [
  "Attention: Administrator bacon has assumed remote control.",
  "I see you playing games during class. Tab closing in 5 seconds.",
  "Sunshine Security Protocol Activated. Please look behind you.",
  "Warning: Inappropriate homework evasion detected.",
  "Your microphone is currently broadcasting to the main hall.",
  "Bro, stop clicking so fast.",
];

export default function AdminPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [adminUsername, setAdminUsername] = useState("bacon");
  const [keyInput, setKeyInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState<"sfx" | "tts" | "pranks" | "users">("sfx");
  const [target, setTarget] = useState<string>("all");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [ttsText, setTtsText] = useState(TTS_PRESETS[0]);
  const [ttsPitch, setTtsPitch] = useState(1.0);
  const [ttsRate, setTtsRate] = useState(1.0);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Check existing session key on mount
  useEffect(() => {
    const savedKey = sessionStorage.getItem("sunshine_admin_key");
    if (savedKey) {
      setAdminKey(savedKey);
      setIsAuthenticated(true);
    }
  }, []);

  // Keyboard shortcut listener: Ctrl+Shift+Alt+A or custom event
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.altKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    const handleCustomOpen = () => {
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-admin-panel", handleCustomOpen);

    // Click 5 times on logo listener
    let logoClicks = 0;
    let logoClickTimer: number | null = null;
    const handleLogoClick = (e: MouseEvent) => {
      const targetEl = e.target as HTMLElement;
      if (targetEl && (targetEl.closest(".title") || targetEl.closest("#branding-container"))) {
        logoClicks++;
        if (logoClickTimer) window.clearTimeout(logoClickTimer);
        logoClickTimer = window.setTimeout(() => {
          logoClicks = 0;
        }, 1800);

        if (logoClicks >= 5) {
          logoClicks = 0;
          setIsOpen(true);
        }
      }
    };

    document.addEventListener("click", handleLogoClick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-admin-panel", handleCustomOpen);
      document.removeEventListener("click", handleLogoClick);
    };
  }, []);

  // Fetch online clients
  const fetchClients = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await fetch("/api/admin/clients", {
        headers: { "x-admin-key": adminKey },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.clients) {
          setClients(data.clients);
        }
      } else if (res.status === 401) {
        setIsAuthenticated(false);
        sessionStorage.removeItem("sunshine_admin_key");
      }
    } catch {
      // ignore network errors
    }
  }, [adminKey]);

  // Polling clients when open
  useEffect(() => {
    if (isOpen && isAuthenticated) {
      void fetchClients();
      const interval = window.setInterval(() => {
        void fetchClients();
      }, 4000);
      return () => window.clearInterval(interval);
    }
  }, [isOpen, isAuthenticated, fetchClients]);

  // Handle Admin Login
  const handleLogin = async (e: Event) => {
    e.preventDefault();
    setAuthError("");
    const key = keyInput.trim();
    if (!key) {
      setAuthError("Enter the secret admin key");
      return;
    }

    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminSecret: key }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        sessionStorage.setItem("sunshine_admin_key", key);
        setAdminKey(key);
        setAdminUsername(data.username || "bacon");
        setIsAuthenticated(true);
        setKeyInput("");
      } else {
        setAuthError(data.error || "Access Denied: Invalid Master Key");
      }
    } catch {
      setAuthError("Failed to reach server");
    }
  };

  // Dispatches actions
  const triggerRemote = async (action: string, data: Record<string, unknown>) => {
    if (!adminKey) return;
    try {
      const res = await fetch("/api/admin/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ target, action, data }),
      });
      const resData = await res.json();
      if (resData.success) {
        setFeedback(`⚡ Dispatched ${action} to ${resData.count} client(s)`);
        window.setTimeout(() => setFeedback(null), 3000);
      } else {
        setFeedback(`❌ Error: ${resData.error || "Failed"}`);
        window.setTimeout(() => setFeedback(null), 3000);
      }
    } catch {
      setFeedback("❌ Network request failed");
      window.setTimeout(() => setFeedback(null), 3000);
    }
  };

  const handleKillswitch = async () => {
    clearChaosEffects();
    await triggerRemote("clear", {});
  };

  if (!isOpen) return null;

  return (
    <div class="admin-modal-overlay" onClick={() => setIsOpen(false)}>
      <div class="admin-panel-card" onClick={(e) => e.stopPropagation()}>
        {!isAuthenticated ? (
          <div class="admin-auth-card" style={{ margin: "auto" }}>
            <div class="auth-icon-wrap">⚡</div>
            <div class="auth-title">Sunshine Chaos Console</div>
            <div class="auth-desc">Master Administrator Authentication Required</div>
            <form onSubmit={handleLogin} style={{ width: "100%" }}>
              <div class="auth-input-wrap">
                <input
                  type="password"
                  class="auth-input"
                  placeholder="Enter Master Secret Key..."
                  value={keyInput}
                  onInput={(e) => setKeyInput((e.target as HTMLInputElement).value)}
                  autoFocus
                />
              </div>
              {authError && <div class="auth-error">{authError}</div>}
              <button type="submit" class="auth-submit-btn">Unlock Console</button>
            </form>
          </div>
        ) : (
          <>
            {/* Header */}
            <div class="admin-header">
              <div class="admin-title-wrap">
                <span class="admin-badge">Admin</span>
                <h2 class="admin-title">Sunshine Chaos & Control Center</h2>
                {feedback && <span style={{ color: "#ff3366", fontSize: "12px", fontWeight: "bold" }}>{feedback}</span>}
              </div>
              <div class="admin-header-actions">
                <button class="killswitch-btn" onClick={handleKillswitch}>
                  🚨 RESET ALL EFFECTS
                </button>
                <button class="admin-close-btn" onClick={() => setIsOpen(false)}>
                  ✕
                </button>
              </div>
            </div>

            {/* Target Selector Bar */}
            <div class="admin-target-bar">
              <div class="target-label">
                <span>🎯 Target Player:</span>
                <select
                  class="target-select"
                  value={target}
                  onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}
                >
                  <option value="all">🌐 Broadcast to ALL Players ({clients.length} online)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      👤 {c.username} ({c.ip}) - {c.game || c.page}
                    </option>
                  ))}
                </select>
              </div>
              <div class="target-stats">
                Logged in as <strong>{adminUsername}</strong> | Online: <span>{clients.length}</span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div class="admin-nav">
              <button
                class={`admin-nav-tab ${activeTab === "sfx" ? "active" : ""}`}
                onClick={() => setActiveTab("sfx")}
              >
                🔊 Remote Soundboard
              </button>
              <button
                class={`admin-nav-tab ${activeTab === "tts" ? "active" : ""}`}
                onClick={() => setActiveTab("tts")}
              >
                🗣️ Voice of God (TTS)
              </button>
              <button
                class={`admin-nav-tab ${activeTab === "pranks" ? "active" : ""}`}
                onClick={() => setActiveTab("pranks")}
              >
                🎭 Visual Pranks & Chaos
              </button>
              <button
                class={`admin-nav-tab ${activeTab === "users" ? "active" : ""}`}
                onClick={() => setActiveTab("users")}
              >
                👥 Live Intelligence Radar ({clients.length})
              </button>
            </div>

            {/* Main Tab Viewport */}
            <div class="admin-tab-body">
              {/* SFX SOUNDBOARD */}
              {activeTab === "sfx" && (
                <div class="sfx-grid">
                  {SFX_LIST.map((sfx) => (
                    <div key={sfx.id} class="sfx-card">
                      <div class="sfx-header">
                        <span class="sfx-icon">{sfx.icon}</span>
                        <span class="sfx-title">{sfx.title}</span>
                      </div>
                      <div class="sfx-desc">{sfx.desc}</div>
                      <div class="sfx-btn-row">
                        <button
                          class="sfx-btn-test"
                          title="Preview only on your speakers"
                          onClick={() => playSfxByName(sfx.id)}
                        >
                          🎧 Test Local
                        </button>
                        <button
                          class="sfx-btn-fire"
                          title="Blast through target user's computer speakers!"
                          onClick={() => triggerRemote("sfx", { sound: sfx.id })}
                        >
                          ⚡ FIRE REMOTE
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* VOICE OF GOD (TTS) */}
              {activeTab === "tts" && (
                <div class="tts-container">
                  <div class="tts-input-wrap">
                    <label class="tts-label">Voice of God Message to Target:</label>
                    <textarea
                      class="tts-textarea"
                      value={ttsText}
                      onInput={(e) => setTtsText((e.target as HTMLTextAreaElement).value)}
                      placeholder="Type words that will be spoken aloud by their computer..."
                    />
                  </div>

                  <div>
                    <label class="tts-label" style={{ marginBottom: "8px", display: "block" }}>
                      Quick Prank Phrases:
                    </label>
                    <div class="tts-presets">
                      {TTS_PRESETS.map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          class="tts-preset-chip"
                          onClick={() => setTtsText(preset)}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div class="tts-sliders">
                    <div class="slider-group">
                      <div class="slider-header">
                        <span>Pitch: {ttsPitch.toFixed(1)}x</span>
                        <span style={{ color: "#71717a" }}>(0.5 = Demon, 1.8 = Chipmunk)</span>
                      </div>
                      <input
                        type="range"
                        min="0.4"
                        max="1.8"
                        step="0.1"
                        value={ttsPitch}
                        onInput={(e) => setTtsPitch(parseFloat((e.target as HTMLInputElement).value))}
                      />
                    </div>
                    <div class="slider-group">
                      <div class="slider-header">
                        <span>Speed / Rate: {ttsRate.toFixed(1)}x</span>
                        <span style={{ color: "#71717a" }}>(0.6 = Slow, 1.4 = Fast)</span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="1.6"
                        step="0.1"
                        value={ttsRate}
                        onInput={(e) => setTtsRate(parseFloat((e.target as HTMLInputElement).value))}
                      />
                    </div>
                  </div>

                  <div class="tts-actions">
                    <button
                      class="sfx-btn-test"
                      style={{ padding: "12px", fontSize: "13px" }}
                      onClick={() => {
                        if ("speechSynthesis" in window) {
                          window.speechSynthesis.cancel();
                          const utt = new SpeechSynthesisUtterance(ttsText);
                          utt.pitch = ttsPitch;
                          utt.rate = ttsRate;
                          window.speechSynthesis.speak(utt);
                        }
                      }}
                    >
                      🎧 Test Local Voice
                    </button>
                    <button
                      class="tts-speak-btn"
                      onClick={() => triggerRemote("tts", { text: ttsText, pitch: ttsPitch, rate: ttsRate })}
                    >
                      🗣️ Speak to Target Remote Speakers
                    </button>
                  </div>
                </div>
              )}

              {/* VISUAL PRANKS & CHAOS */}
              {activeTab === "pranks" && (
                <div class="pranks-grid">
                  {PRANK_LIST.map((prank) => (
                    <div key={prank.id} class="prank-card">
                      <div class="prank-header">
                        <span class="prank-icon">{prank.icon}</span>
                        <span class="prank-title">{prank.title}</span>
                      </div>
                      <div class="prank-desc">{prank.desc}</div>
                      <button
                        class="prank-trigger-btn"
                        onClick={() => triggerRemote("effect", { effect: prank.id, from: adminUsername })}
                      >
                        ⚡ Trigger Prank
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* LIVE USER INTELLIGENCE */}
              {activeTab === "users" && (
                <div class="users-table-wrap">
                  <table class="users-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>User</th>
                        <th>Client ID</th>
                        <th>IP Address</th>
                        <th>Current Page / Game</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "#71717a" }}>
                            No active online players connected to the live stream yet.
                          </td>
                        </tr>
                      ) : (
                        clients.map((c) => (
                          <tr key={c.id}>
                            <td>
                              <span class="user-status-dot"></span>
                              <span style={{ color: "#10b981", fontSize: "12px" }}>Online</span>
                            </td>
                            <td>
                              <strong style={{ color: "#fff" }}>{c.username}</strong>
                            </td>
                            <td>
                              <code style={{ fontSize: "11px", color: "#a1a1aa" }}>{c.id}</code>
                            </td>
                            <td>
                              <span style={{ fontSize: "12px", color: "#a1a1aa" }}>{c.ip}</span>
                            </td>
                            <td>
                              <span style={{ color: "#ff9944", fontSize: "12px" }}>{c.game || c.page}</span>
                            </td>
                            <td>
                              <button
                                class="btn-target-user"
                                onClick={() => {
                                  setTarget(c.id);
                                  setFeedback(`Target locked: ${c.username}`);
                                  window.setTimeout(() => setFeedback(null), 2500);
                                }}
                              >
                                🎯 Target
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
