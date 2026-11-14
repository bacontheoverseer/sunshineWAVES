import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { playAudioUrl, clearChaosEffects, normalizeSoundUrl } from "../core/liveClient";

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
}

const DEFAULT_PRESET_SOUNDS: SoundItem[] = [
  { id: "vine-boom", name: "vine boom", url: "/assets/sounds/vine-boom.mp3", source: "preset" },
  { id: "bruh", name: "bruh", url: "/assets/sounds/bruh.mp3", source: "preset" },
  { id: "metal-pipe", name: "metal pipe", url: "/assets/sounds/metal-pipe.mp3", source: "preset" },
  { id: "discord-ping", name: "discord ping", url: "/assets/sounds/discord-ping.mp3", source: "preset" },
  { id: "reverb-fart", name: "reverb fart", url: "/assets/sounds/reverb-fart.mp3", source: "preset" },
  { id: "taco-bell", name: "taco bell bong", url: "/assets/sounds/taco-bell.mp3", source: "preset" },
  { id: "fbi-open-up", name: "fbi open up", url: "/assets/sounds/fbi-open-up.mp3", source: "preset" },
  { id: "airhorn", name: "mlg airhorn", url: "/assets/sounds/airhorn.mp3", source: "preset" },
  { id: "emotional-damage", name: "emotional damage", url: "/assets/sounds/emotional-damage.mp3", source: "preset" },
  { id: "xp-error", name: "windows xp error", url: "/assets/sounds/xp-error.mp3", source: "preset" },
  { id: "roblox-oof", name: "roblox oof", url: "/assets/sounds/roblox-oof.mp3", source: "preset" },
  { id: "sad-violin", name: "sad violin", url: "/assets/sounds/sad-violin.mp3", source: "preset" },
  { id: "what-da-dog", name: "what da dog doin", url: "/assets/sounds/what-da-dog.mp3", source: "preset" },
  { id: "run-meme", name: "run meme", url: "/assets/sounds/run-meme.mp3", source: "preset" },
  { id: "door-knock", name: "3d door knock", url: "/assets/sounds/door-knock.mp3", source: "preset" },
  { id: "rickroll", name: "rickroll", url: "/assets/sounds/rickroll.mp3", source: "preset" },
  { id: "screamer", name: "loud screamer", url: "/assets/sounds/screamer.mp3", source: "preset" },
  { id: "snore-mimimi", name: "snore mimimi", url: "/assets/sounds/snore-mimimi.mp3", source: "preset" },
];

const PRANK_LIST = [
  { id: "earthquake", icon: "fa-house-crack", title: "earthquake", desc: "violently shakes the viewport for 5 seconds." },
  { id: "screen-flip", icon: "fa-rotate", title: "180° screen flip", desc: "turns the browser viewport upside down." },
  { id: "eyelash", icon: "fa-feather", title: "monitor eyelash", desc: "places a realistic curved hair on their screen." },
  { id: "dead-pixel", icon: "fa-circle-dot", title: "dead pixel", desc: "places a bright red hot pixel on their display." },
  { id: "fake-battery", icon: "fa-battery-empty", title: "low battery alert", desc: "shows a critical 3% low battery warning." },
  { id: "admin-monitor", icon: "fa-eye", title: "admin monitor banner", desc: "displays a live session recording banner." },
  { id: "panic-doc", icon: "fa-file-lines", title: "google doc disguise", desc: "covers the screen with a fake history essay." },
  { id: "ghost-cursor", icon: "fa-arrow-pointer", title: "ghost cursor", desc: "spawns an erratic possessed mouse pointer." },
  { id: "flash-title", icon: "fa-bell", title: "flashing tab title", desc: "flashes warning alerts in the browser tab." },
  { id: "invert-colors", icon: "fa-circle-half-stroke", title: "invert colors", desc: "inverts all colors across the page." },
  { id: "matrix-rain", icon: "fa-terminal", title: "matrix rain", desc: "overlays falling green digital code rain." },
  { id: "blur", icon: "fa-droplet", title: "screen blur", desc: "applies a heavy blur filter to the page." },
];

const TTS_PRESETS = [
  "attention: administrator has assumed remote control.",
  "i see you playing games during class.",
  "security protocol activated. please look behind you.",
  "warning: homework evasion detected.",
  "your microphone is currently broadcasting.",
  "bro, stop clicking so fast.",
];

function toast(type: "success" | "error", msg: string) {
  const w = window as unknown as { showToast?: (t: string, m: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(type, msg);
  }
}

export default function AdminPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [adminUsername, setAdminUsername] = useState("bacon");
  const [keyInput, setKeyInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState<"soundboard" | "tts" | "pranks" | "users">("soundboard");
  const [target, setTarget] = useState<string>("all");
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const [clients, setClients] = useState<ClientRecord[]>([]);

  // Soundboard State (v3 uses local /assets/sounds/*.mp3 paths)
  const [sounds, setSounds] = useState<SoundItem[]>(() => {
    try {
      const stored = localStorage.getItem("cookie_admin_soundboard_v3");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s: SoundItem) => ({
            ...s,
            url: normalizeSoundUrl(s.url),
          }));
        }
      }
    } catch {}
    return DEFAULT_PRESET_SOUNDS;
  });

  const [soundFilter, setSoundFilter] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(true);
  const [addMode, setAddMode] = useState<"myinstants" | "upload" | "url">("myinstants");
  const [sfxVolume, setSfxVolume] = useState(1.0);

  // MyInstants Search State
  const [miQuery, setMiQuery] = useState("");
  const [miLoading, setMiLoading] = useState(false);
  const [miSearchedOnce, setMiSearchedOnce] = useState(false);
  const [miAddingUrl, setMiAddingUrl] = useState<string | null>(null);
  const [miResults, setMiResults] = useState<{ name: string; url: string; rawUrl?: string }[]>([]);
  const [miCustomName, setMiCustomName] = useState("");

  // Upload MP3 State
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Custom URL State
  const [customUrl, setCustomUrl] = useState("");
  const [customUrlName, setCustomUrlName] = useState("");
  const [resolvingUrl, setResolvingUrl] = useState(false);

  // TTS State
  const [ttsText, setTtsText] = useState(TTS_PRESETS[0]);
  const [ttsPitch, setTtsPitch] = useState(1.0);
  const [ttsRate, setTtsRate] = useState(1.0);

  useEffect(() => {
    try {
      localStorage.setItem("cookie_admin_soundboard_v3", JSON.stringify(sounds));
    } catch {}
  }, [sounds]);

  useEffect(() => {
    const savedKey = sessionStorage.getItem("sunshine_admin_key");
    if (savedKey) {
      setAdminKey(savedKey);
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.altKey && (e.key === "A" || e.key === "a")) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    const handleCustomOpen = () => setIsOpen(true);

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
  }, [isOpen]);

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

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      void fetchClients();
      const interval = window.setInterval(() => {
        void fetchClients();
      }, 4000);
      return () => window.clearInterval(interval);
    }
  }, [isOpen, isAuthenticated, fetchClients]);

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    setAuthError("");
    const key = keyInput.trim();
    if (!key) {
      setAuthError("enter your secret key");
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
        toast("success", "admin unlocked");
      } else {
        setAuthError(data.error?.toLowerCase() || "invalid secret key");
      }
    } catch {
      setAuthError("failed to reach server");
    }
  };

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
        toast("success", `sent ${action} to ${resData.count} user(s)`);
      } else {
        toast("error", resData.error || "failed to trigger");
      }
    } catch {
      toast("error", "network error");
    }
  };

  const handleKillswitch = async () => {
    clearChaosEffects();
    await triggerRemote("clear", {});
  };

  const handlePlayLocal = (sound: SoundItem) => {
    playAudioUrl(sound.url, sfxVolume);
  };

  const handleFireRemote = (sound: SoundItem) => {
    void triggerRemote("sfx", { url: sound.url, sound: sound.id, volume: sfxVolume });
  };

  const handleDeleteSound = (id: string) => {
    setSounds((prev) => prev.filter((s) => s.id !== id));
    toast("success", "sound removed");
  };

  const handleResetPresets = () => {
    setSounds(DEFAULT_PRESET_SOUNDS);
    toast("success", "default sounds restored");
  };

  const runMyinstantsSearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      setMiLoading(true);
      setMiSearchedOnce(true);
      try {
        const res = await fetch(
          `/api/admin/myinstants-search?query=${encodeURIComponent(query)}`,
          {
            headers: adminKey ? { "x-admin-key": adminKey } : {},
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.results)) {
            setMiResults(data.results);
            return;
          }
        }
        toast("error", "failed to search myinstants");
      } catch {
        toast("error", "failed to search myinstants");
      } finally {
        setMiLoading(false);
      }
    },
    [adminKey]
  );

  // Auto-load popular MyInstants sounds when the MyInstants add box is opened
  useEffect(() => {
    if (isOpen && isAuthenticated && isAddOpen && addMode === "myinstants" && !miSearchedOnce) {
      void runMyinstantsSearch("");
    }
  }, [isOpen, isAuthenticated, isAddOpen, addMode, miSearchedOnce, runMyinstantsSearch]);

  const handleSearchMyinstants = async (e?: Event) => {
    if (e) e.preventDefault();
    await runMyinstantsSearch(miQuery);
  };

  const handleAddFromMyinstants = async (item: { name: string; url: string; rawUrl?: string }) => {
    const customTitle = (miCustomName.trim() || item.name).toLowerCase();
    let finalUrl = item.url;
    const itemKey = item.rawUrl || item.url;
    setMiAddingUrl(itemKey);

    // Cache locally via resolve-sound if available
    if (item.rawUrl) {
      try {
        const res = await fetch("/api/admin/resolve-sound", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(adminKey ? { "x-admin-key": adminKey } : {}),
          },
          body: JSON.stringify({ url: item.rawUrl }),
        });
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const data = await res.json();
          if (data.url) finalUrl = data.url;
        }
      } catch {}
    }

    const newSound: SoundItem = {
      id: "mi_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      name: customTitle,
      url: finalUrl,
      source: "myinstants",
    };
    setSounds((prev) => [newSound, ...prev]);
    setMiCustomName("");
    setMiAddingUrl(null);
    toast("success", `added "${newSound.name}" to soundboard`);
  };

  const handleFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      setUploadFile(file);
      const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ").toLowerCase();
      if (!uploadName) {
        setUploadName(cleanName);
      }
    }
  };

  const handleUploadSubmit = (e: Event) => {
    e.preventDefault();
    if (!uploadFile || !adminKey) return;
    setUploading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result as string;
      const customTitle = (uploadName.trim() || uploadFile.name.replace(/\.[^/.]+$/, "")).toLowerCase();

      try {
        const res = await fetch("/api/admin/upload-sound", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": adminKey,
          },
          body: JSON.stringify({
            name: customTitle,
            filename: uploadFile.name,
            data: base64Data,
          }),
        });

        const ct = res.headers.get("content-type") || "";
        if (res.ok && ct.includes("application/json")) {
          const data = await res.json();
          if (data.success && data.url) {
            const newSound: SoundItem = {
              id: "up_" + Date.now(),
              name: customTitle,
              url: data.url,
              source: "upload",
            };
            setSounds((prev) => [newSound, ...prev]);
            toast("success", `uploaded "${newSound.name}"`);
            setUploadFile(null);
            setUploadName("");
            if (fileInputRef.current) fileInputRef.current.value = "";
            setIsAddOpen(false);
            setUploading(false);
            return;
          }
        }
      } catch {}

      // Automatic client-side DataURL fallback so uploaded MP3 works even without server restart
      const fallbackSound: SoundItem = {
        id: "up_" + Date.now(),
        name: customTitle,
        url: base64Data,
        source: "upload",
      };
      setSounds((prev) => [fallbackSound, ...prev]);
      toast("success", `added "${fallbackSound.name}"`);
      setUploadFile(null);
      setUploadName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setIsAddOpen(false);
      setUploading(false);
    };
    reader.readAsDataURL(uploadFile);
  };

  const handleUrlSubmit = async (e: Event) => {
    e.preventDefault();
    const raw = customUrl.trim();
    if (!raw || !adminKey) return;
    setResolvingUrl(true);

    const displayName = (customUrlName.trim() || "custom sound").toLowerCase();
    let finalUrl = normalizeSoundUrl(raw);

    try {
      const res = await fetch("/api/admin/resolve-sound", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ url: raw }),
      });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        const data = await res.json();
        if (data.url) finalUrl = data.url;
      }
    } catch {}

    const newSound: SoundItem = {
      id: "url_" + Date.now(),
      name: displayName,
      url: finalUrl,
      source: raw.includes("myinstants.com") ? "myinstants" : "custom",
    };

    setSounds((prev) => [newSound, ...prev]);
    toast("success", `added "${newSound.name}"`);
    setCustomUrl("");
    setCustomUrlName("");
    setIsAddOpen(false);
    setResolvingUrl(false);
  };

  if (!isOpen) return null;

  const filteredSounds = sounds.filter((s) =>
    s.name.toLowerCase().includes(soundFilter.toLowerCase()),
  );

  const selectedTargetLabel =
    target === "all"
      ? `everyone (${clients.length} online)`
      : (() => {
          const found = clients.find((c) => c.id === target);
          return found ? `${found.username} (${found.game || found.page})` : target;
        })();

  const tabs = [
    { id: "soundboard" as const, icon: "fa-volume-high", label: "soundboard" },
    { id: "tts" as const, icon: "fa-microphone-lines", label: "voice of god" },
    { id: "pranks" as const, icon: "fa-wand-magic-sparkles", label: "visual trolls" },
    { id: "users" as const, icon: "fa-users", label: `users (${clients.length})` },
  ];

  return (
    <>
      <div class="admin-backdrop" onClick={() => setIsOpen(false)} />

      {!isAuthenticated ? (
        <div class="admin-auth-popup" onClick={(e) => e.stopPropagation()}>
          <h2>admin authentication</h2>
          <p>enter your master secret key to unlock the admin panel.</p>
          <form onSubmit={handleLogin} class="input-container">
            <input
              type="password"
              class="admin-input"
              placeholder="secret key"
              value={keyInput}
              onInput={(e) => setKeyInput((e.target as HTMLInputElement).value)}
              style={{ marginBottom: "10px" }}
              autoFocus
            />
            {authError && (
              <p style={{ color: "var(--toast-danger-text)", marginBottom: "10px" }}>
                {authError}
              </p>
            )}
            <button type="submit" class="auth-action-btn">
              unlock
            </button>
          </form>
          <button class="admin-close-btn" onClick={() => setIsOpen(false)}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
      ) : (
        <div class="admin-menu" onClick={(e) => e.stopPropagation()}>
          <h2>admin</h2>

          <div class="admin-container">
            {/* Left Sidebar Tabs (Identical to SettingsMenu) */}
            <div class="admin-tabs">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  class={`tab-button${activeTab === t.id ? " active" : ""}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <i class={`fa-solid ${t.icon}`} />{" "}
                  {t.label}
                </button>
              ))}

              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "8px" }}>
                <button class="admin-btn-danger" onClick={handleKillswitch} style={{ width: "100%" }}>
                  <i class="fa-solid fa-rotate-left" /> reset effects
                </button>
                <div class="settings-bottom">
                  {adminUsername} • {clients.length} online
                </div>
              </div>
            </div>

            {/* Right Content Area */}
            <div class="admin-content-wrapper">
              {/* Target Selector Item */}
              <div class="admin-section" style={{ paddingBottom: "6px" }}>
                <label>target user</label>
                <p>choose who receives your sound effects and visual trolls.</p>
                <div class="admin-selector">
                  <div
                    class="admin-selected"
                    onClick={() => setTargetDropdownOpen((prev) => !prev)}
                  >
                    <span>{selectedTargetLabel}</span>
                    <i class="fa-solid fa-chevron-down" style={{ fontSize: "11px", color: "var(--color-icon-muted)" }} />
                  </div>
                  {targetDropdownOpen && (
                    <div class="admin-options">
                      <div
                        onClick={() => {
                          setTarget("all");
                          setTargetDropdownOpen(false);
                        }}
                      >
                        everyone ({clients.length} online)
                      </div>
                      {clients.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setTarget(c.id);
                            setTargetDropdownOpen(false);
                          }}
                        >
                          {c.username} ({c.ip}) — {c.game || c.page}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* TAB 1: SOUNDBOARD */}
              {activeTab === "soundboard" && (
                <div class="admin-section">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                    <div>
                      <label>soundboard</label>
                      <p style={{ marginBottom: "6px" }}>play custom sounds or myinstants clips through target speakers.</p>
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        class={isAddOpen ? "admin-btn-primary" : "admin-btn-secondary"}
                        onClick={() => setIsAddOpen((prev) => !prev)}
                      >
                        <i class={`fa-solid ${isAddOpen ? "fa-xmark" : "fa-plus"}`} />{" "}
                        {isAddOpen ? "close" : "add sound"}
                      </button>
                    </div>
                  </div>

                  {/* Add Custom Sound Box */}
                  {isAddOpen && (
                    <div class="admin-add-box">
                      <div class="admin-subtabs">
                        <button
                          type="button"
                          class={`admin-subtab${addMode === "myinstants" ? " active" : ""}`}
                          onClick={() => setAddMode("myinstants")}
                        >
                          <i class="fa-solid fa-magnifying-glass" /> myinstants
                        </button>
                        <button
                          type="button"
                          class={`admin-subtab${addMode === "upload" ? " active" : ""}`}
                          onClick={() => setAddMode("upload")}
                        >
                          <i class="fa-solid fa-upload" /> upload mp3
                        </button>
                        <button
                          type="button"
                          class={`admin-subtab${addMode === "url" ? " active" : ""}`}
                          onClick={() => setAddMode("url")}
                        >
                          <i class="fa-solid fa-link" /> sound url
                        </button>
                      </div>

                      {addMode === "myinstants" && (
                        <div>
                          <form class="admin-toolbar-row" onSubmit={handleSearchMyinstants} style={{ marginBottom: "8px" }}>
                            <input
                              type="text"
                              class="admin-input"
                              placeholder="search myinstants (e.g. vine boom, fart, airhorn, goofy)..."
                              value={miQuery}
                              onInput={(e) => setMiQuery((e.target as HTMLInputElement).value)}
                            />
                            <button type="submit" class="admin-btn-primary" disabled={miLoading} style={{ flexShrink: 0 }}>
                              <i class="fa-solid fa-magnifying-glass" /> {miLoading ? "searching..." : "search"}
                            </button>
                          </form>
                          <input
                            type="text"
                            class="admin-input"
                            placeholder="optional custom name before clicking add..."
                            value={miCustomName}
                            onInput={(e) => setMiCustomName((e.target as HTMLInputElement).value)}
                          />
                          {miLoading ? (
                            <div style={{ fontSize: "12px", color: "var(--color-sublabel)", marginTop: "10px", textAlign: "center" }}>
                              searching myinstants...
                            </div>
                          ) : miResults.length > 0 ? (
                            <div class="admin-search-results">
                              {miResults.map((item, idx) => {
                                const isAddingThis = miAddingUrl === (item.rawUrl || item.url);
                                return (
                                  <div key={idx} class="admin-search-row">
                                    <span class="admin-search-name" title={item.name}>{item.name.toLowerCase()}</span>
                                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                                      <button
                                        type="button"
                                        class="admin-btn-secondary"
                                        style={{ padding: "5px 9px", fontSize: "11.5px" }}
                                        onClick={() => playAudioUrl(item.url, sfxVolume)}
                                      >
                                        test
                                      </button>
                                      <button
                                        type="button"
                                        class="admin-btn-secondary"
                                        style={{ padding: "5px 9px", fontSize: "11.5px" }}
                                        onClick={() =>
                                          void triggerRemote("sfx", {
                                            url: item.url,
                                            sound: item.name,
                                            volume: sfxVolume,
                                          })
                                        }
                                      >
                                        play
                                      </button>
                                      <button
                                        type="button"
                                        class="admin-btn-primary"
                                        style={{ padding: "5px 10px", fontSize: "11.5px" }}
                                        disabled={isAddingThis}
                                        onClick={() => handleAddFromMyinstants(item)}
                                      >
                                        {isAddingThis ? "..." : "add"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            miSearchedOnce && (
                              <div style={{ fontSize: "12px", color: "var(--color-sublabel)", marginTop: "10px", textAlign: "center" }}>
                                no myinstants sounds found for "{miQuery}"
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {addMode === "upload" && (
                        <form onSubmit={handleUploadSubmit} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <input
                            type="file"
                            ref={fileInputRef}
                            accept="audio/*,.mp3,.wav,.ogg,.m4a"
                            onChange={handleFileChange}
                            class="admin-input"
                          />
                          <input
                            type="text"
                            class="admin-input"
                            placeholder="custom sound name..."
                            value={uploadName}
                            onInput={(e) => setUploadName((e.target as HTMLInputElement).value)}
                            required
                          />
                          <button type="submit" class="admin-btn-primary" disabled={!uploadFile || uploading}>
                            <i class="fa-solid fa-upload" /> {uploading ? "uploading..." : "save to soundboard"}
                          </button>
                        </form>
                      )}

                      {addMode === "url" && (
                        <form onSubmit={handleUrlSubmit} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <input
                            type="url"
                            class="admin-input"
                            placeholder="paste mp3 link or myinstants page url..."
                            value={customUrl}
                            onInput={(e) => setCustomUrl((e.target as HTMLInputElement).value)}
                            required
                          />
                          <input
                            type="text"
                            class="admin-input"
                            placeholder="custom sound name..."
                            value={customUrlName}
                            onInput={(e) => setCustomUrlName((e.target as HTMLInputElement).value)}
                            required
                          />
                          <button type="submit" class="admin-btn-primary" disabled={!customUrl.trim() || resolvingUrl}>
                            <i class="fa-solid fa-plus" /> {resolvingUrl ? "adding..." : "add to soundboard"}
                          </button>
                        </form>
                      )}
                    </div>
                  )}

                  {/* Search & Volume Toolbar */}
                  <div class="admin-toolbar-row">
                    <input
                      type="text"
                      class="admin-input"
                      placeholder="filter sounds..."
                      value={soundFilter}
                      onInput={(e) => setSoundFilter((e.target as HTMLInputElement).value)}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: "120px" }}>
                      <i class="fa-solid fa-volume-low" style={{ color: "var(--color-icon-dim)", fontSize: "12px" }} />
                      <input
                        type="range"
                        class="admin-range"
                        min="0.1"
                        max="1.0"
                        step="0.05"
                        value={sfxVolume}
                        onInput={(e) => setSfxVolume(parseFloat((e.target as HTMLInputElement).value))}
                      />
                    </div>
                    <button
                      type="button"
                      class="admin-btn-secondary"
                      title="restore default sounds"
                      onClick={handleResetPresets}
                      style={{ flexShrink: 0, padding: "8px 10px" }}
                    >
                      <i class="fa-solid fa-rotate" />
                    </button>
                  </div>

                  {/* Soundboard Grid */}
                  <div class="admin-list-grid">
                    {filteredSounds.map((sound) => (
                      <div key={sound.id} class="admin-item-card">
                        <div class="admin-item-top">
                          <div style={{ overflow: "hidden" }}>
                            <div class="admin-item-title" title={sound.name}>
                              {sound.name}
                            </div>
                            <div class="admin-item-sub">{sound.source}</div>
                          </div>
                          <button
                            class="admin-icon-btn"
                            title="remove sound"
                            onClick={() => handleDeleteSound(sound.id)}
                          >
                            <i class="fa-solid fa-trash-can" />
                          </button>
                        </div>
                        <div class="admin-item-actions">
                          <button
                            type="button"
                            class="admin-btn-secondary"
                            onClick={() => handlePlayLocal(sound)}
                          >
                            <i class="fa-solid fa-headphones" /> test
                          </button>
                          <button
                            type="button"
                            class="admin-btn-primary"
                            onClick={() => handleFireRemote(sound)}
                          >
                            <i class="fa-solid fa-play" /> play
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 2: VOICE OF GOD (TTS) */}
              {activeTab === "tts" && (
                <div class="admin-section">
                  <label>voice of god (tts)</label>
                  <p>speak a custom message aloud through the target user's speakers.</p>

                  <textarea
                    class="admin-textarea"
                    value={ttsText}
                    onInput={(e) => setTtsText((e.target as HTMLTextAreaElement).value)}
                    placeholder="type message to speak..."
                    style={{ marginBottom: "10px" }}
                  />

                  <div class="admin-chips">
                    {TTS_PRESETS.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        class="admin-chip"
                        onClick={() => setTtsText(preset)}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                    <div>
                      <p style={{ marginBottom: "4px" }}>pitch ({ttsPitch.toFixed(1)}x)</p>
                      <input
                        type="range"
                        class="admin-range"
                        min="0.4"
                        max="1.8"
                        step="0.1"
                        value={ttsPitch}
                        onInput={(e) => setTtsPitch(parseFloat((e.target as HTMLInputElement).value))}
                      />
                    </div>
                    <div>
                      <p style={{ marginBottom: "4px" }}>speed ({ttsRate.toFixed(1)}x)</p>
                      <input
                        type="range"
                        class="admin-range"
                        min="0.5"
                        max="1.6"
                        step="0.1"
                        value={ttsRate}
                        onInput={(e) => setTtsRate(parseFloat((e.target as HTMLInputElement).value))}
                      />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      class="admin-btn-secondary"
                      style={{ flex: 1 }}
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
                      <i class="fa-solid fa-headphones" /> test local
                    </button>
                    <button
                      type="button"
                      class="admin-btn-primary"
                      style={{ flex: 1.5 }}
                      onClick={() => triggerRemote("tts", { text: ttsText, pitch: ttsPitch, rate: ttsRate })}
                    >
                      <i class="fa-solid fa-microphone-lines" /> speak on target
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: VISUAL TROLLS */}
              {activeTab === "pranks" && (
                <div class="admin-section">
                  <label>visual trolls</label>
                  <p>trigger visual effects and screen pranks on the target user.</p>

                  <div class="admin-list-grid">
                    {PRANK_LIST.map((prank) => (
                      <div key={prank.id} class="admin-item-card">
                        <div>
                          <div class="admin-item-title">
                            <i class={`fa-solid ${prank.icon}`} style={{ marginRight: "6px", color: "var(--color-icon-muted)" }} />
                            {prank.title}
                          </div>
                          <div class="admin-item-sub" style={{ marginTop: "3px" }}>
                            {prank.desc}
                          </div>
                        </div>
                        <button
                          type="button"
                          class="admin-btn-primary"
                          onClick={() => triggerRemote("effect", { effect: prank.id, from: adminUsername })}
                        >
                          <i class="fa-solid fa-bolt" /> trigger
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 4: LIVE USERS */}
              {activeTab === "users" && (
                <div class="admin-section">
                  <label>online users</label>
                  <p>active sessions currently connected to the live stream.</p>

                  {clients.length === 0 ? (
                    <p>no active users connected yet.</p>
                  ) : (
                    clients.map((c) => (
                      <div key={c.id} class="admin-user-row">
                        <div class="admin-user-info">
                          <div class="admin-user-name">
                            <span class="admin-online-dot" />
                            <span>{c.username}</span>
                          </div>
                          <div class="admin-user-meta">
                            {c.ip} • {c.game || c.page} • id: {c.id}
                          </div>
                        </div>
                        <button
                          type="button"
                          class={target === c.id ? "admin-btn-primary" : "admin-btn-secondary"}
                          onClick={() => {
                            setTarget(c.id);
                            toast("success", `targeted ${c.username}`);
                          }}
                        >
                          {target === c.id ? "selected" : "target"}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <button class="admin-close-btn" onClick={() => setIsOpen(false)}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>
      )}
    </>
  );
}
