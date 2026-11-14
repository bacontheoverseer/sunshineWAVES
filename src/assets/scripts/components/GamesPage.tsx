import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import { memo } from "preact/compat";
import { fetchGameData, resetGameCache, getGameDisplayLabel, type GameEntry } from "../features/games.ts";
import { showHomeView } from "../state/store.ts";
import { attachSearchLight } from "../core/searchLight.ts";

const FADE_DURATION = 100;
const SKELETON_KEYS = Array.from({ length: 12 }, (_, i) => `skeleton-${i}`);
const RENDER_BATCH = 48;

const GameCard = memo(function GameCard({
  game,
  onPlay,
  onCloudPlay,
}: {
  game: GameEntry;
  onPlay: (game: GameEntry) => void;
  onCloudPlay: (game: GameEntry, e: MouseEvent) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  return (
    <article class="game-card" onClick={() => onPlay(game)}>
      <div
        class={`game-cover${!loaded && !errored ? " skeleton" : ""}${errored ? " no-cover" : ""}${loaded && !errored ? " loaded" : ""}`}
      >
        {game.coverUrl && !errored && (
          <img
            loading="lazy"
            decoding="async"
            src={game.coverUrl}
            onLoad={() => setLoaded(true)}
            onError={() => { setLoaded(true); setErrored(true); }}
          />
        )}
      </div>
      <button
        type="button"
        class="game-card-2p-btn"
        title="Launch with CloudPlay (2-Player Party)"
        onClick={(e) => onCloudPlay(game, e)}
      >
        <i class="fa-solid fa-tower-broadcast" style={{ color: "#4ade80", fontSize: "9.5px" }}></i>
        <span>2p</span>
      </button>
      <div class="game-info">
        <h1>{game.name}</h1>
      </div>
    </article>
  );
});

const SkeletonCard = memo(function SkeletonCard() {
  return (
    <article class="game-card skeleton-card">
      <div class="game-cover skeleton" />
      <div class="game-info">
        <div />
        <div />
      </div>
    </article>
  );
});

export default function GamesPage() {
  const [allGames, setAllGames] = useState<GameEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const searchBarRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scrollTargetRef = useRef<HTMLElement | Window | null>(null);
  const savedScrollRef = useRef(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadGames = useCallback(() => {
    setError(null);
    fetchGameData()
      .then((games) => {
        setAllGames(games);
        setLoaded(true);
      })
      .catch(() => {
        setError(
          "failed to fetch games .‸. (this is an issue with the source)",
        );
        setLoaded(true);
      });
  }, []);

  const hide = useCallback(() => {
    if (!document.body.classList.contains("games-view")) return;

    const target = scrollTargetRef.current;
    if (target) {
      savedScrollRef.current =
        target === window
          ? window.scrollY || document.documentElement.scrollTop
          : (target as HTMLElement).scrollTop;
    }

    setActive(false);

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setVisible(false);
      document.body.classList.remove("games-view");
      fadeTimerRef.current = null;
    }, FADE_DURATION);

    const iconEl = document.querySelector("#choi i");
    if (iconEl) iconEl.className = "fa-solid fa-gamepad";
  }, []);

  useEffect(() => {
    if (searchBarRef.current) attachSearchLight(searchBarRef.current);
  }, [visible]);

  useEffect(() => {
    scrollTargetRef.current = document.querySelector<HTMLElement>(".meow") || window;
  }, []);

  useEffect(() => {
    if (!visible) return;
    const target = scrollTargetRef.current;
    const bar = searchBarRef.current;
    if (!target || !bar) return;
    const readTop = () => (target === window ? window.scrollY : (target as HTMLElement).scrollTop);
    bar.classList.toggle("is-sticky", readTop() > 10);

    let scrollRaf: number | null = null;
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        bar.classList.toggle("is-sticky", readTop() > 10);
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
    };
  }, [visible]);

  useEffect(() => {
    const handler = () => {
      resetGameCache();
      setAllGames([]);
      setLoaded(false);
      setError(null);
      setQuery("");
      if (visible) loadGames();
    };
    document.addEventListener("gameSourceUpdated", handler);
    return () => document.removeEventListener("gameSourceUpdated", handler);
  }, [visible, loadGames]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible, hide]);

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
    if (
      document.body.classList.contains("watch-view") &&
      window.hideWatchMenu
    ) {
      window.hideWatchMenu();
    }
    if (
      document.body.classList.contains("apps-view") &&
      (window as any).hideAppsMenu
    ) {
      (window as any).hideAppsMenu();
    }
    if (
      document.body.classList.contains("studio-view") &&
      (window as any).hideStudioMenu
    ) {
      (window as any).hideStudioMenu();
    }
    if (
      document.body.classList.contains("shop-view") &&
      (window as any).hideShopMenu
    ) {
      (window as any).hideShopMenu();
    }

    showHomeView();
    document.body.classList.add("games-view");
    setVisible(true);
    localStorage.setItem("sunshineUserOpenedGameMenu", "true");

    requestAnimationFrame(() => {
      setActive(true);
      const target = scrollTargetRef.current;
      if (target) {
        if (target === window) window.scrollTo(0, savedScrollRef.current);
        else (target as HTMLElement).scrollTop = savedScrollRef.current;
      }
    });

    if (!loaded || allGames.length === 0) {
      loadGames();
    }

    const iconEl = document.querySelector("#choi i");
    if (iconEl) iconEl.className = "fa-solid fa-magnifying-glass";
  }, [loaded, allGames.length, loadGames]);

  const toggle = useCallback(() => {
    if (document.body.classList.contains("games-view")) hide();
    else show();
  }, [show, hide]);

  useEffect(() => {
    (window as any).showGameMenu = show;
    (window as any).hideGameMenu = hide;
    (window as any).toggleGameMenu = toggle;

    ((window as any).sunshineApp ??= {}).getGameDisplayLabel = getGameDisplayLabel;

    const gameIcon = document.getElementById("choi");
    const brand =
      document.getElementById("branding-container") ||
      document.getElementById("brand");
    const onGameIconClick = (e: MouseEvent) => {
      e.preventDefault();
      toggle();
    };
    const onBrandClick = (e: MouseEvent) => {
      e.preventDefault();
      if (document.body.classList.contains("games-view")) hide();
    };

    if (gameIcon) gameIcon.addEventListener("click", onGameIconClick);
    if (brand) brand.addEventListener("click", onBrandClick);

    return () => {
      if (gameIcon) gameIcon.removeEventListener("click", onGameIconClick);
      if (brand) brand.removeEventListener("click", onBrandClick);
    };
  }, [show, hide, toggle]);

  const handlePlay = useCallback(
    async (game: GameEntry) => {
      if (game.isExternal) {
        window.open(game.gameUrl, "_blank");
      } else if ((window as any).sunshineApp?.handleSearch) {
        hide();
        (window as any).sunshineApp.handleSearch(game.gameUrl, game.name, game.coverUrl);
      }
    },
    [hide],
  );

  const handleCloudPlayGame = useCallback(
    async (game: GameEntry, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!game.isExternal && (window as any).sunshineApp?.handleSearch) {
        hide();
        await (window as any).sunshineApp.handleSearch(game.gameUrl, game.name, game.coverUrl);
        setTimeout(() => {
          document.dispatchEvent(
            new CustomEvent("toggleGameSpaceModal", {
              detail: { tab: "cloudplay", gameName: game.name },
            }),
          );
        }, 120);
      } else {
        document.dispatchEvent(
          new CustomEvent("toggleGameSpaceModal", {
            detail: { tab: "cloudplay", gameName: game.name },
          }),
        );
      }
    },
    [hide],
  );

  const filteredGames = useMemo(() => {
    if (!query) return allGames;
    const q = query.toLowerCase().trim();
    if (!q) return allGames;
    return allGames.filter(
      (g) => (g._nameLc || "").includes(q) || (g._authorLc || "").includes(q),
    );
  }, [allGames, query]);

  const [renderCount, setRenderCount] = useState(RENDER_BATCH);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRenderCount(RENDER_BATCH);
  }, [filteredGames]);

  useEffect(() => {
    if (!visible || !loaded || renderCount >= filteredGames.length) return;
    const el = loadMoreRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      const id = setTimeout(() => {
        setRenderCount((c) => Math.min(c + RENDER_BATCH, filteredGames.length));
      }, 60);
      return () => clearTimeout(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderCount((c) => Math.min(c + RENDER_BATCH, filteredGames.length));
        }
      },
      { rootMargin: "420px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, loaded, renderCount, filteredGames.length]);

  const visibleGames = useMemo(
    () => filteredGames.slice(0, renderCount),
    [filteredGames, renderCount],
  );

  const placeholder = loaded
    ? `search through ${allGames.length} games... :D`
    : "fetching games...";

  if (!visible) return null;

  return (
    <section
      id="games-page"
      class={`games-page${visible ? " is-visible" : ""}${active ? " is-active" : ""}`}
      aria-hidden={!visible}
    >
      <div class="games-topbar">
        <div class="search-bar games-search-bar" ref={searchBarRef}>
          <div class="light"></div>
          <div class="light-border"></div>
          <div class="light-inset-bg"></div>
          <i class="fa-solid fa-magnifying-glass games-search-icon"></i>
          <input
            type="text"
            id="gameSearchInput"
            ref={searchInputRef}
            placeholder={placeholder}
            autocomplete="off"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            style={{ paddingRight: "112px" }}
          />
          <button
            type="button"
            title="CloudPlay — Join or Host a 2-Player Co-op Party (WASD + Arrow Keys)"
            onClick={() => {
              document.dispatchEvent(
                new CustomEvent("toggleGameSpaceModal", {
                  detail: { tab: "cloudplay" },
                }),
              );
            }}
            style={{
              position: "absolute",
              right: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 5,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 11px",
              borderRadius: "16px",
              backgroundColor: "var(--bg-surface-5)",
              border: "1px solid var(--bg-surface-10)",
              color: "var(--text-primary)",
              fontSize: "11.5px",
              fontWeight: 500,
              cursor: "pointer",
              textTransform: "lowercase",
            }}
          >
            <i class="fa-solid fa-tower-broadcast" style={{ color: "#4ade80", fontSize: "11px" }}></i>
            <span>cloudplay</span>
          </button>
        </div>
      </div>
      <div class="game-grid-container">
        <div
          class="game-grid"
          style={filteredGames.length ? "display:grid" : "display:none"}
        >
          {!loaded
            ? SKELETON_KEYS.map((key) => <SkeletonCard key={key} />)
            : visibleGames.map((game) => (
                <GameCard
                  key={`${game.sourceKey}-${game.gameUrl}`}
                  game={game}
                  onPlay={handlePlay}
                  onCloudPlay={handleCloudPlayGame}
                />
              ))}
        </div>
        {loaded && renderCount < filteredGames.length && (
          <div
            ref={loadMoreRef}
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "22px 0 12px",
            }}
          >
            <button
              type="button"
              class="studio-tab-btn"
              onClick={() =>
                setRenderCount((c) => Math.min(c + RENDER_BATCH, filteredGames.length))
              }
            >
              load more games ({filteredGames.length - renderCount} left)
            </button>
          </div>
        )}
        {loaded && filteredGames.length === 0 && (
          <p class="no-results">{error || "zero games match were found :("}</p>
        )}
      </div>
    </section>
  );
}
