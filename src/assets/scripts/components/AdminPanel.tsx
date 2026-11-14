import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { playAudioUrl, clearChaosEffects } from "../core/liveClient";

interface ClientRecord {
  id: string;
  username: string;
  ip: string;
  page: string;
  game: string;
  connectedAt: number;
  lastSeen: number;
}

export interface SoundItem {
  id: string;
  name: string;
  url: string;
  source: "preset" | "myinstants" | "upload" | "custom";
  icon?: string;
}

const DEFAULT_PRESET_SOUNDS: SoundItem[] = [
  { id: "vine-boom", name: "Vine Boom", url: "https://www.myinstants.com/media/sounds/vine-boom.mp3", source: "preset", icon: "💥" },
  { id: "bruh", name: "Bruh Sound", url: "https://www.myinstants.com/media/sounds/movie_1.mp3", source: "preset", icon: "🗿" },
  { id: "metal-pipe", name: "Metal Pipe Drop", url: "https://www.myinstants.com/media/sounds/metal-pipe-falling-sound-effect.mp3", source: "preset", icon: "🔩" },
  { id: "discord-ping", name: "Discord Notification", url: "https://www.myinstants.com/media/sounds/discord-notification.mp3", source: "preset", icon: "🔔" },
  { id: "reverb-fart", name: "Reverb Fart", url: "https://www.myinstants.com/media/sounds/fart-with-reverb.mp3", source: "preset", icon: "💨" },
  { id: "taco-bell", name: "Taco Bell Bong", url: "https://www.myinstants.com/media/sounds/taco-bell-bong-sfx.mp3", source: "preset", icon: "🔔" },
  { id: "fbi-open-up", name: "FBI Open Up", url: "https://www.myinstants.com/media/sounds/fbi-open-up_mI4PDIx.mp3", source: "preset", icon: "🚨" },
  { id: "airhorn", name: "MLG Airhorn", url: "https://www.myinstants.com/media/sounds/mlg-airhorn.mp3", source: "preset", icon: "📢" },
  { id: "emotional-damage", name: "Emotional Damage", url: "https://www.myinstants.com/media/sounds/emotional-damage-meme.mp3", source: "preset", icon: "💔" },
  { id: "xp-error", name: "Windows XP Error", url: "https://www.myinstants.com/media/sounds/windows-xp-error.mp3", source: "preset", icon: "❌" },
  { id: "roblox-oof", name: "Roblox Death (Oof)", url: "https://www.myinstants.com/media/sounds/roblox-death-sound_1.mp3", source: "preset", icon: "💀" },
  { id: "sad-violin", name: "Sad Violin", url: "https://www.myinstants.com/media/sounds/sad-violin.mp3", source: "preset", icon: "🎻" },
  { id: "what-da-dog", name: "What Da Dog Doin", url: "https://www.myinstants.com/media/sounds/what-da-dog-doin.mp3", source: "preset", icon: "🐶" },
  { id: "run-meme", name: "Run Meme Song", url: "https://www.myinstants.com/media/sounds/run-vine-sound-effect.mp3", source: "preset", icon: "🏃" },
  { id: "door-knock", name: "Realistic Door Knock", url: "https://www.myinstants.com/media/sounds/knocking-on-door_1.mp3", source: "preset", icon: "🚪" },
  { id: "rickroll", name: "Rickroll Never Gonna", url: "https://www.myinstants.com/media/sounds/rick-roll.mp3", source: "preset", icon: "🕺" },
  { id: "screamer", name: "Loud Screamer", url: "https://www.myinstants.com/media/sounds/screamer-sound.mp3", source: "preset", icon: "😱" },
  { id: "snore-mimimi", name: "Cartoon Snore (Mimimi)", url: "https://www.myinstants.com/media/sounds/snore-mimimi.mp3", source: "preset", icon: "😴" },
];

const PRANK_LIST = [
  { id: "earthquake", icon: "🌋", title: "Earthquake Shake", desc: "Violently shakes their entire screen for 5 seconds" },
  { id: "screen-flip", icon: "🔄", title: "180° Screen Flip", desc: "Turns their entire browser viewport upside down" },
  { id: "eyelash", icon: "🪶", title: "Monitor Eyelash", desc: "Spawns a hyper-realistic curved hair on their screen" },
  { id: "dead-pixel", icon: "🔴", title: "Dead Pixel Dot", desc: "Injects a bright red hot pixel in the center of their display" },
  { id: "fake-battery", icon: "🪫", title: "Low Battery Alert", desc: "Windows 11 notification card: 'Battery critically low (3%)'" },
  { id: "admin-monitor", icon: "👁️", title: "Admin Monitor Banner", desc: "Top red banner warning their session is being recorded" },
  { id: "panic-doc", icon: "📄", title: "Google Doc Disguise", desc: "Instant full-screen AP History research essay disguise" },
  { id: "ghost-cursor", icon: "👻", title: "Ghost Cursor", desc: "Animated Windows mouse pointer drifting erratically" },
  { id: "flash-title", icon: "🚨", title: "Flashing Tab Title", desc: "Cycles tab title with '⚠️ VIOLATION DETECTED'" },
  { id: "invert-colors", icon: "🌓", title: "Invert Colors", desc: "High-contrast inverted color scheme" },
  { id: "matrix-rain", icon: "💻", title: "Matrix Code Rain", desc: "Falling green digital matrix code characters" },
  { id: "blur", icon: "🌫️", title: "Drunk Blur", desc: "Applies a heavy gaussian blur over the entire website" },
];

const TTS_PRESETS = [
  "Attention: Administrator bacon has assumed remote control of your screen.",
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
  const [activeTab, setActiveTab] = useState<"soundboard" | "tts" | "pranks" | "users">("soundboard");
  const [target, setTarget] = useState<string>("all");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Soundboard State
  const [sounds, setSounds] = useState<SoundItem[]>(() => {
    try {
      const stored = localStorage.getItem("cookie_admin_soundboard_v2");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_PRESET_SOUNDS;
  });

  const [soundFilter, setSoundFilter] = useState("");
  const [isAddDrawerOpen, setIsAddDrawerOpen] = useState(false);
  const [addDrawerTab, setAddDrawerTab] = useState<"myinstants" | "upload" | "url">("myinstants");
  const [sfxVolume, setSfxVolume] = useState(1.0);

  // Add Drawer - MyInstants Search
  const [myinstantsQuery, setMyinstantsQuery] = useState("");
  const [myinstantsLoading, setMyinstantsLoading] = useState(false);
  const [myinstantsResults, setMyinstantsResults] = useState<{ name: string; url: string }[]>([]);

  // Add Drawer - Upload Form
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Add Drawer - Paste URL Form
  const [customUrl, setCustomUrl] = useState("");
  const [customUrlName, setCustomUrlName] = useState("");
  const [resolvingUrl, setResolvingUrl] = useState(false);

  // TTS State
  const [ttsText, setTtsText] = useState(TTS_PRESETS[0]);
  const [ttsPitch, setTtsPitch] = useState(1.0);
  const [ttsRate, setTtsRate] = useState(1.0);

  // Save sounds to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("cookie_admin_soundboard_v2", JSON.stringify(sounds));
    } catch {}
  }, [sounds]);

  // Check saved session key on mount
  useEffect(() => {
    const savedKey = sessionStorage.getItem("sunshine_admin_key");
    if (savedKey) {
      setAdminKey(savedKey);
      setIsAuthenticated(true);
    }
  }, []);

  // Keyboard shortcut listener: Ctrl+Shift+Alt+A or custom event or 5 clicks on logo
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
    } catch {}
  }, [adminKey]);

  // Poll clients while open
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
      setAuthError("Enter the master key");
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
        setAuthError(data.error || "Access Denied: Invalid Key");
      }
    } catch {
      setAuthError("Failed to reach server");
    }
  };

  // Dispatches actions to clients
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
        setFeedback(`⚡ Dispatched to ${resData.count} client(s)`);
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

  // Soundboard Actions
  const handlePlayLocal = (sound: SoundItem) => {
    playAudioUrl(sound.url, sfxVolume);
  };

  const handleFireRemote = (sound: SoundItem) => {
    void triggerRemote("sfx", { url: sound.url, sound: sound.id, volume: sfxVolume });
  };

  const handleDeleteSound = (id: string) => {
    setSounds((prev) => prev.filter((s) => s.id !== id));
  };

  // Search MyInstants
  const handleSearchMyinstants = async (e?: Event) => {
    if (e) e.preventDefault();
    const query = myinstantsQuery.trim();
    if (!query || !adminKey) return;
    setMyinstantsLoading(true);
    try {
      const res = await fetch(`/api/admin/myinstants-search?query=${encodeURIComponent(query)}`, {
        headers: { "x-admin-key": adminKey },
      });
      const data = await res.json();
      if (data.results) {
        setMyinstantsResults(data.results);
      }
    } catch {
      setFeedback("❌ Failed to query MyInstants");
      window.setTimeout(() => setFeedback(null), 3000);
    } finally {
      setMyinstantsLoading(false);
    }
  };

  // Add Sound from MyInstants Search Result
  const handleAddFromMyinstants = (item: { name: string; url: string }) => {
    const customTitle = prompt("Enter custom name for this sound:", item.name) || item.name;
    const newSound: SoundItem = {
      id: "mi_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      name: customTitle.trim(),
      url: item.url,
      source: "myinstants",
      icon: "🎵",
    };
    setSounds((prev) => [newSound, ...prev]);
    setFeedback(`✅ Added "${newSound.name}" to Soundboard!`);
    window.setTimeout(() => setFeedback(null), 3000);
  };

  // Handle File Upload (MP3, WAV, etc.)
  const handleFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      setUploadFile(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
      if (!uploadName) {
        setUploadName(cleanName);
      }
    }
  };

  const handleUploadSubmit = async (e: Event) => {
    e.preventDefault();
    if (!uploadFile || !adminKey) return;
    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        const res = await fetch("/api/admin/upload-sound", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": adminKey,
          },
          body: JSON.stringify({
            name: uploadName.trim() || uploadFile.name,
            filename: uploadFile.name,
            data: base64Data,
          }),
        });

        const data = await res.json();
        if (data.success && data.url) {
          const newSound: SoundItem = {
            id: "up_" + Date.now(),
            name: uploadName.trim() || data.name,
            url: data.url,
            source: "upload",
            icon: "📁",
          };
          setSounds((prev) => [newSound, ...prev]);
          setFeedback(`✅ Uploaded "${newSound.name}"!`);
          setUploadFile(null);
          setUploadName("");
          if (fileInputRef.current) fileInputRef.current.value = "";
          setIsAddDrawerOpen(false);
        } else {
          setFeedback(`❌ Upload failed: ${data.error || "Unknown"}`);
        }
        setUploading(false);
      };
      reader.readAsDataURL(uploadFile);
    } catch {
      setUploading(false);
      setFeedback("❌ Failed to read audio file");
    }
  };

  // Handle Custom URL
  const handleUrlSubmit = async (e: Event) => {
    e.preventDefault();
    const raw = customUrl.trim();
    if (!raw || !adminKey) return;
    setResolvingUrl(true);

    try {
      const res = await fetch("/api/admin/resolve-sound", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ url: raw }),
      });
      const data = await res.json();
      const resolvedUrl = data.url || raw;
      const displayName = customUrlName.trim() || "Custom Sound";

      const newSound: SoundItem = {
        id: "url_" + Date.now(),
        name: displayName,
        url: resolvedUrl,
        source: raw.includes("myinstants.com") ? "myinstants" : "custom",
        icon: "🔗",
      };

      setSounds((prev) => [newSound, ...prev]);
      setFeedback(`✅ Added "${newSound.name}"!`);
      setCustomUrl("");
      setCustomUrlName("");
      setIsAddDrawerOpen(false);
    } catch {
      setFeedback("❌ Could not resolve URL");
    } finally {
      setResolvingUrl(false);
    }
  };

  const filteredSounds = sounds.filter((s) =>
    s.name.toLowerCase().includes(soundFilter.toLowerCase()),
  );

  if (!isOpen) return null;

  return (
    <div class="admin-modal-overlay" onClick={() => setIsOpen(false)}>
      <div class="admin-panel-card" onClick={(e) => e.stopPropagation()}>
        {!isAuthenticated ? (
          <div class="admin-auth-card" style={{ margin: "auto" }}>
            <div class="auth-icon-wrap">☀️</div>
            <div class="auth-title">Sunshine Control Center</div>
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
                <h2 class="admin-title">
                  <span>☀️</span> Sunshine Chaos & Control Center
                </h2>
                {feedback && (
                  <span style={{ color: "#ffaa33", fontSize: "12px", fontWeight: "bold" }}>
                    {feedback}
                  </span>
                )}
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
                Admin: <strong>{adminUsername}</strong> | Online: <span>{clients.length}</span>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div class="admin-nav">
              <button
                class={`admin-nav-tab ${activeTab === "soundboard" ? "active" : ""}`}
                onClick={() => setActiveTab("soundboard")}
              >
                🔊 Soundboard ({sounds.length})
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

            {/* Tab Viewport */}
            <div class="admin-tab-body">
              {/* SOUNDBOARD TAB */}
              {activeTab === "soundboard" && (
                <>
                  {/* Toolbar */}
                  <div class="soundboard-toolbar">
                    <div class="soundboard-search-wrap">
                      <span class="soundboard-search-icon">🔍</span>
                      <input
                        type="text"
                        class="soundboard-search-input"
                        placeholder="Search soundboard sounds..."
                        value={soundFilter}
                        onInput={(e) => setSoundFilter((e.target as HTMLInputElement).value)}
                      />
                    </div>

                    <div class="soundboard-actions">
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#a1a1aa" }}>
                        <span>🔊 Vol:</span>
                        <input
                          type="range"
                          min="0.1"
                          max="1.0"
                          step="0.05"
                          value={sfxVolume}
                          onInput={(e) => setSfxVolume(parseFloat((e.target as HTMLInputElement).value))}
                          style={{ width: "70px", accentColor: "#ff9800" }}
                        />
                      </div>

                      <button
                        class={`btn-add-sound ${isAddDrawerOpen ? "open" : ""}`}
                        onClick={() => setIsAddDrawerOpen((prev) => !prev)}
                      >
                        {isAddDrawerOpen ? "✕ Close Add Sound" : "+ Add Sound to Board"}
                      </button>
                    </div>
                  </div>

                  {/* Add Sound Drawer */}
                  {isAddDrawerOpen && (
                    <div class="add-sound-drawer">
                      <div class="drawer-tabs">
                        <button
                          class={`drawer-tab ${addDrawerTab === "myinstants" ? "active" : ""}`}
                          onClick={() => setAddDrawerTab("myinstants")}
                        >
                          🔍 Search MyInstants
                        </button>
                        <button
                          class={`drawer-tab ${addDrawerTab === "upload" ? "active" : ""}`}
                          onClick={() => setAddDrawerTab("upload")}
                        >
                          📁 Upload MP3 / Audio File
                        </button>
                        <button
                          class={`drawer-tab ${addDrawerTab === "url" ? "active" : ""}`}
                          onClick={() => setAddDrawerTab("url")}
                        >
                          🔗 Paste Sound or MyInstants URL
                        </button>
                      </div>

                      {/* Search MyInstants Tab */}
                      {addDrawerTab === "myinstants" && (
                        <div>
                          <form class="myinstants-search-row" onSubmit={handleSearchMyinstants}>
                            <input
                              type="text"
                              class="myinstants-search-input"
                              placeholder="Search MyInstants (e.g. vine boom, metal pipe, fart, scream)..."
                              value={myinstantsQuery}
                              onInput={(e) => setMyinstantsQuery((e.target as HTMLInputElement).value)}
                              autoFocus
                            />
                            <button type="submit" class="btn-search-myinstants" disabled={myinstantsLoading}>
                              {myinstantsLoading ? "Searching..." : "Search"}
                            </button>
                          </form>

                          {myinstantsResults.length > 0 && (
                            <div class="myinstants-results-grid">
                              {myinstantsResults.map((item, idx) => (
                                <div key={idx} class="myinstants-result-item">
                                  <span class="myinstants-result-title" title={item.name}>
                                    🎵 {item.name}
                                  </span>
                                  <div class="myinstants-btn-group">
                                    <button
                                      type="button"
                                      class="btn-preview-mini"
                                      title="Preview locally"
                                      onClick={() => playAudioUrl(item.url, sfxVolume)}
                                    >
                                      🎧 Test
                                    </button>
                                    <button
                                      type="button"
                                      class="btn-add-mini"
                                      title="Add to your soundboard"
                                      onClick={() => handleAddFromMyinstants(item)}
                                    >
                                      + Add
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Upload MP3 File Tab */}
                      {addDrawerTab === "upload" && (
                        <form class="drawer-form" onSubmit={handleUploadSubmit}>
                          <div class="form-field-group">
                            <label class="form-field-label">Choose Audio File (.mp3, .wav, .ogg, .m4a):</label>
                            <input
                              type="file"
                              ref={fileInputRef}
                              accept="audio/*,.mp3,.wav,.ogg,.m4a"
                              onChange={handleFileChange}
                              style={{ color: "#d4d4d8", fontSize: "13px" }}
                            />
                          </div>
                          <div class="form-field-group">
                            <label class="form-field-label">Custom Display Name:</label>
                            <input
                              type="text"
                              class="form-field-input"
                              placeholder="e.g. My Secret Troll Sound"
                              value={uploadName}
                              onInput={(e) => setUploadName((e.target as HTMLInputElement).value)}
                              required
                            />
                          </div>
                          <button
                            type="submit"
                            class="btn-submit-drawer"
                            disabled={!uploadFile || uploading}
                          >
                            {uploading ? "Uploading Audio..." : "📁 Upload to Server & Add to Board"}
                          </button>
                        </form>
                      )}

                      {/* Paste Sound URL Tab */}
                      {addDrawerTab === "url" && (
                        <form class="drawer-form" onSubmit={handleUrlSubmit}>
                          <div class="form-field-group">
                            <label class="form-field-label">
                              Audio File URL or MyInstants Link:
                            </label>
                            <input
                              type="url"
                              class="form-field-input"
                              placeholder="https://www.myinstants.com/en/instant/... or https://example.com/sound.mp3"
                              value={customUrl}
                              onInput={(e) => setCustomUrl((e.target as HTMLInputElement).value)}
                              required
                            />
                          </div>
                          <div class="form-field-group">
                            <label class="form-field-label">Custom Display Name:</label>
                            <input
                              type="text"
                              class="form-field-input"
                              placeholder="e.g. Discord Join Chime"
                              value={customUrlName}
                              onInput={(e) => setCustomUrlName((e.target as HTMLInputElement).value)}
                              required
                            />
                          </div>
                          <button
                            type="submit"
                            class="btn-submit-drawer"
                            disabled={!customUrl.trim() || resolvingUrl}
                          >
                            {resolvingUrl ? "Resolving Sound..." : "🔗 Add to Soundboard"}
                          </button>
                        </form>
                      )}
                    </div>
                  )}

                  {/* Soundboard Cards Grid */}
                  <div class="sfx-grid">
                    {filteredSounds.map((sound) => (
                      <div key={sound.id} class="sfx-card">
                        <div class="sfx-header">
                          <div class="sfx-title-area">
                            <span class="sfx-icon">{sound.icon || "🎵"}</span>
                            <span class="sfx-title" title={sound.name}>
                              {sound.name}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span class={`sfx-source-badge ${sound.source}`}>
                              {sound.source === "myinstants" ? "MyInstants" : sound.source === "upload" ? "Upload" : "Preset"}
                            </span>
                            <button
                              class="sfx-delete-btn"
                              title="Delete from soundboard"
                              onClick={() => handleDeleteSound(sound.id)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        <div class="sfx-btn-row">
                          <button
                            class="sfx-btn-test"
                            title="Preview sound locally"
                            onClick={() => handlePlayLocal(sound)}
                          >
                            🎧 Test
                          </button>
                          <button
                            class="sfx-btn-fire"
                            title="Blast through target user's computer speakers!"
                            onClick={() => handleFireRemote(sound)}
                          >
                            ⚡ FIRE REMOTE
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
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
                        <span style={{ color: "#8c8c8c" }}>(0.5 = Demon, 1.8 = Chipmunk)</span>
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
                        <span style={{ color: "#8c8c8c" }}>(0.6 = Slow, 1.4 = Fast)</span>
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
                      style={{ padding: "11px", fontSize: "13px" }}
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
                          <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "#8c8c8c" }}>
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
                              <code style={{ fontSize: "11px", color: "#8c8c8c" }}>{c.id}</code>
                            </td>
                            <td>
                              <span style={{ fontSize: "12px", color: "#8c8c8c" }}>{c.ip}</span>
                            </td>
                            <td>
                              <span style={{ color: "#ffaa33", fontSize: "12px" }}>{c.game || c.page}</span>
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
