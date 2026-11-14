import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import { showHomeView } from "../state/store.ts";
import { attachSearchLight } from "../core/searchLight.ts";

export interface ProxyAppEntry {
  id: string;
  name: string;
  url: string;
  desc: string;
  category: "social" | "media" | "gaming" | "tools";
  icon: string;
  gradient: string;
}

const APPS_LIST: ProxyAppEntry[] = [
  {
    id: "youtube",
    name: "youtube",
    url: "https://www.youtube.com",
    desc: "watch videos, streams, and shorts unblocked",
    category: "media",
    icon: "fa-brands fa-youtube",
    gradient: "linear-gradient(135deg, #ef4444, #991b1b)",
  },
  {
    id: "tiktok",
    name: "tiktok",
    url: "https://www.tiktok.com",
    desc: "short-form trending videos and creators",
    category: "social",
    icon: "fa-brands fa-tiktok",
    gradient: "linear-gradient(135deg, #ec4899, #06b6d4)",
  },
  {
    id: "discord",
    name: "discord",
    url: "https://discord.com/app",
    desc: "chat, servers, voice, and communities",
    category: "social",
    icon: "fa-brands fa-discord",
    gradient: "linear-gradient(135deg, #5865F2, #3b44a8)",
  },
  {
    id: "soundcloud",
    name: "soundcloud",
    url: "https://soundcloud.com",
    desc: "stream underground tracks, beats, and playlists",
    category: "media",
    icon: "fa-brands fa-soundcloud",
    gradient: "linear-gradient(135deg, #f97316, #c2410c)",
  },
  {
    id: "spotify",
    name: "spotify",
    url: "https://open.spotify.com",
    desc: "web music player for songs, albums & podcasts",
    category: "media",
    icon: "fa-brands fa-spotify",
    gradient: "linear-gradient(135deg, #22c55e, #15803d)",
  },
  {
    id: "roblox",
    name: "roblox.com",
    url: "https://www.roblox.com",
    desc: "official roblox platform, avatar shop & games",
    category: "gaming",
    icon: "fa-solid fa-cube",
    gradient: "linear-gradient(135deg, #e11d48, #881337)",
  },
  {
    id: "roblox-cloud",
    name: "roblox cloud (now.gg)",
    url: "https://now.gg/apps/roblox-corporation/5349/roblox.html",
    desc: "play roblox in the browser via cloud streaming",
    category: "gaming",
    icon: "fa-solid fa-cloud-bolt",
    gradient: "linear-gradient(135deg, #ec4899, #be185d)",
  },
  {
    id: "twitch",
    name: "twitch",
    url: "https://www.twitch.tv",
    desc: "live gaming, esports, and creator broadcasts",
    category: "media",
    icon: "fa-brands fa-twitch",
    gradient: "linear-gradient(135deg, #9146FF, #5b21b6)",
  },
  {
    id: "geforce-now",
    name: "geforce now",
    url: "https://play.geforcenow.com",
    desc: "cloud PC gaming for fortnite, apex & steam games",
    category: "gaming",
    icon: "fa-solid fa-microchip",
    gradient: "linear-gradient(135deg, #76b900, #3f6212)",
  },
  {
    id: "xbox-cloud",
    name: "xbox cloud gaming",
    url: "https://www.xbox.com/play",
    desc: "stream console games directly in your browser",
    category: "gaming",
    icon: "fa-brands fa-xbox",
    gradient: "linear-gradient(135deg, #107C10, #064e3b)",
  },
  {
    id: "reddit",
    name: "reddit",
    url: "https://www.reddit.com",
    desc: "forums, memes, communities & discussions",
    category: "social",
    icon: "fa-brands fa-reddit-alien",
    gradient: "linear-gradient(135deg, #FF4500, #9a3412)",
  },
  {
    id: "instagram",
    name: "instagram",
    url: "https://www.instagram.com",
    desc: "reels, stories, messages, and posts",
    category: "social",
    icon: "fa-brands fa-instagram",
    gradient: "linear-gradient(135deg, #f43f5e, #a855f7)",
  },
  {
    id: "twitter",
    name: "x / twitter",
    url: "https://x.com",
    desc: "breaking news, posts, and real-time feed",
    category: "social",
    icon: "fa-brands fa-x-twitter",
    gradient: "linear-gradient(135deg, #334155, #0f172a)",
  },
  {
    id: "snapchat",
    name: "snapchat web",
    url: "https://web.snapchat.com",
    desc: "message friends and send snaps from your browser",
    category: "social",
    icon: "fa-brands fa-snapchat",
    gradient: "linear-gradient(135deg, #eab308, #a16207)",
  },
  {
    id: "yt-music",
    name: "youtube music",
    url: "https://music.youtube.com",
    desc: "official music videos, remixes, and live albums",
    category: "media",
    icon: "fa-solid fa-circle-play",
    gradient: "linear-gradient(135deg, #dc2626, #7f1d1d)",
  },
  {
    id: "netflix",
    name: "netflix",
    url: "https://www.netflix.com",
    desc: "movies, series, and anime streaming",
    category: "media",
    icon: "fa-solid fa-film",
    gradient: "linear-gradient(135deg, #E50914, #7f1d1d)",
  },
  {
    id: "crunchyroll",
    name: "crunchyroll",
    url: "https://www.crunchyroll.com",
    desc: "stream anime series and simulcasts",
    category: "media",
    icon: "fa-solid fa-dragon",
    gradient: "linear-gradient(135deg, #f97316, #ea580c)",
  },
  {
    id: "pinterest",
    name: "pinterest",
    url: "https://www.pinterest.com",
    desc: "aesthetic boards, wallpapers, and inspiration",
    category: "social",
    icon: "fa-brands fa-pinterest",
    gradient: "linear-gradient(135deg, #e11d48, #9f1239)",
  },
  {
    id: "chess",
    name: "chess.com",
    url: "https://www.chess.com",
    desc: "play online chess against players & bots",
    category: "gaming",
    icon: "fa-solid fa-chess-knight",
    gradient: "linear-gradient(135deg, #65a30d, #365314)",
  },
  {
    id: "poki",
    name: "poki",
    url: "https://poki.com",
    desc: "instant web arcade & multiplayer games",
    category: "gaming",
    icon: "fa-solid fa-joystick",
    gradient: "linear-gradient(135deg, #0ea5e9, #0369a1)",
  },
  {
    id: "crazygames",
    name: "crazygames",
    url: "https://www.crazygames.com",
    desc: "3D browser games, io games, and shooters",
    category: "gaming",
    icon: "fa-solid fa-rocket",
    gradient: "linear-gradient(135deg, #8b5cf6, #5b21b6)",
  },
  {
    id: "coolmath",
    name: "coolmathgames",
    url: "https://www.coolmathgames.com",
    desc: "classic strategy, logic, and platformer games",
    category: "gaming",
    icon: "fa-solid fa-puzzle-piece",
    gradient: "linear-gradient(135deg, #f59e0b, #b45309)",
  },
  {
    id: "duck-ai",
    name: "ai chat (duck.ai)",
    url: "https://duckduckgo.com/?q=DuckDuckGo+AI+Chat&ia=chat&duckai=1",
    desc: "private AI assistant powered by GPT-4o mini & Claude",
    category: "tools",
    icon: "fa-solid fa-robot",
    gradient: "linear-gradient(135deg, #14b8a6, #0f766e)",
  },
  {
    id: "github",
    name: "github",
    url: "https://github.com",
    desc: "repositories, code hosting, and open source",
    category: "tools",
    icon: "fa-brands fa-github",
    gradient: "linear-gradient(135deg, #475569, #1e293b)",
  },
  {
    id: "scratch",
    name: "scratch",
    url: "https://scratch.mit.edu",
    desc: "create & play block-coded community projects",
    category: "tools",
    icon: "fa-solid fa-cat",
    gradient: "linear-gradient(135deg, #f59e0b, #d97706)",
  },
  {
    id: "wikipedia",
    name: "wikipedia",
    url: "https://www.wikipedia.org",
    desc: "free encyclopedia and research reference",
    category: "tools",
    icon: "fa-brands fa-wikipedia-w",
    gradient: "linear-gradient(135deg, #64748b, #334155)",
  },
  {
    id: "google",
    name: "google",
    url: "https://www.google.com",
    desc: "web search through the proxy",
    category: "tools",
    icon: "fa-brands fa-google",
    gradient: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
  },
];

const FADE_DURATION = 100;

export default function AppsPage() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "social" | "media" | "gaming" | "tools">("all");
  const [customUrl, setCustomUrl] = useState("");

  const searchBarRef = useRef<HTMLDivElement | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (!document.body.classList.contains("apps-view")) return;
    setActive(false);

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setVisible(false);
      document.body.classList.remove("apps-view");
      fadeTimerRef.current = null;
    }, FADE_DURATION);

    const iconEl = document.querySelector("#apps-btn i");
    if (iconEl) iconEl.className = "fa-solid fa-table-cells-large";
  }, []);

  const show = useCallback(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    if (
      (window as any).toggleSettingsMenu &&
      document.getElementById("settings-menu")?.classList.contains("open")
    ) {
      (window as any).toggleSettingsMenu();
    }
    if (document.body.classList.contains("games-view") && (window as any).hideGameMenu) {
      (window as any).hideGameMenu();
    }
    if (document.body.classList.contains("studio-view") && (window as any).hideStudioMenu) {
      (window as any).hideStudioMenu();
    }
    if (document.body.classList.contains("shop-view") && (window as any).hideShopMenu) {
      (window as any).hideShopMenu();
    }

    showHomeView();
    document.body.classList.add("apps-view");
    setVisible(true);

    requestAnimationFrame(() => {
      setActive(true);
    });

    const iconEl = document.querySelector("#apps-btn i");
    if (iconEl) iconEl.className = "fa-solid fa-xmark";
  }, []);

  const toggle = useCallback(() => {
    if (document.body.classList.contains("apps-view")) hide();
    else show();
  }, [show, hide]);

  useEffect(() => {
    if (searchBarRef.current) attachSearchLight(searchBarRef.current);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible, hide]);

  useEffect(() => {
    (window as any).showAppsMenu = show;
    (window as any).hideAppsMenu = hide;
    (window as any).toggleAppsMenu = toggle;

    const appsBtn = document.getElementById("apps-btn");
    const brand =
      document.getElementById("branding-container") ||
      document.getElementById("brand");

    const onAppsClick = (e: MouseEvent) => {
      e.preventDefault();
      toggle();
    };
    const onBrandClick = (e: MouseEvent) => {
      e.preventDefault();
      if (document.body.classList.contains("apps-view")) hide();
    };

    if (appsBtn) appsBtn.addEventListener("click", onAppsClick);
    if (brand) brand.addEventListener("click", onBrandClick);

    return () => {
      if (appsBtn) appsBtn.removeEventListener("click", onAppsClick);
      if (brand) brand.removeEventListener("click", onBrandClick);
    };
  }, [show, hide, toggle]);

  const handleLaunchApp = useCallback(
    (appUrl: string) => {
      if (!appUrl.trim()) return;
      hide();
      if ((window as any).sunshineApp?.handleSearch) {
        // Do NOT pass appName as gameName so proxy apps/websites are never treated as games
        (window as any).sunshineApp.handleSearch(appUrl.trim());
      }
    },
    [hide]
  );

  const filteredApps = useMemo(() => {
    const q = query.toLowerCase().trim();
    return APPS_LIST.filter((app) => {
      if (category !== "all" && app.category !== category) return false;
      if (!q) return true;
      return (
        app.name.toLowerCase().includes(q) ||
        app.desc.toLowerCase().includes(q) ||
        app.url.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  if (!visible) return null;

  return (
    <section
      id="apps-page"
      class={`apps-page${visible ? " is-visible" : ""}${active ? " is-active" : ""}`}
      aria-hidden={!visible}
    >
      <div class="apps-header-bar">
        <div
          class="search-bar games-search-bar"
          ref={searchBarRef}
          style={{ marginTop: 0 }}
        >
          <div class="light"></div>
          <div class="light-border"></div>
          <div class="light-inset-bg"></div>
          <i class="fa-solid fa-magnifying-glass games-search-icon"></i>
          <input
            type="text"
            placeholder={`search ${APPS_LIST.length} apps (youtube, tiktok, discord, roblox...)`}
            autocomplete="off"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>

        <div class="apps-category-pills">
          {(
            [
              { id: "all", label: "all apps", icon: "fa-layer-group" },
              { id: "social", label: "social & chat", icon: "fa-comments" },
              { id: "media", label: "video & music", icon: "fa-play" },
              { id: "gaming", label: "roblox & cloud gaming", icon: "fa-gamepad" },
              { id: "tools", label: "tools & ai", icon: "fa-bolt" },
            ] as const
          ).map((c) => (
            <button
              key={c.id}
              type="button"
              class={`apps-cat-pill ${category === c.id ? "active" : ""}`}
              onClick={() => setCategory(c.id)}
            >
              <i class={`fa-solid ${c.icon}`}></i>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Custom URL Proxy Launcher */}
      <div class="apps-custom-launcher">
        <div class="apps-custom-launcher-label">
          <i class="fa-solid fa-globe"></i>
          <span>launch any custom website url through the proxy:</span>
        </div>
        <form
          class="apps-custom-launcher-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (customUrl.trim()) {
              handleLaunchApp(customUrl.trim());
              setCustomUrl("");
            }
          }}
        >
          <input
            type="text"
            class="apps-custom-input"
            placeholder="https://example.com or domain..."
            value={customUrl}
            onInput={(e) => setCustomUrl((e.target as HTMLInputElement).value)}
          />
          <button type="submit" class="apps-custom-btn">
            <i class="fa-solid fa-arrow-up-right-from-square"></i>
            <span>open in proxy</span>
          </button>
        </form>
      </div>

      {/* Apps Grid */}
      <div class="apps-grid">
        {filteredApps.map((app) => (
          <article
            key={app.id}
            class="app-card"
            onClick={() => handleLaunchApp(app.url)}
          >
            <div class="app-card-top">
              <div class="app-icon-box" style={{ background: app.gradient }}>
                <i class={app.icon}></i>
              </div>
              <span class="app-proxy-badge">proxy</span>
            </div>
            <div class="app-card-meta">
              <h2 class="app-card-title">{app.name}</h2>
              <p class="app-card-desc">{app.desc}</p>
            </div>
          </article>
        ))}
      </div>

      {filteredApps.length === 0 && (
        <p class="no-results">no matching apps found — try launching it with the custom url bar above!</p>
      )}
    </section>
  );
}
