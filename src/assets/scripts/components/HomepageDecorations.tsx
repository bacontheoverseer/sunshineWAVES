import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  type CollectibleVibe,
  expandCollectibleUrl,
  getCatalogDecorations,
  matchesCollectibleFilter,
} from "../core/collectibleCatalog.ts";
import { getSafeMediaProxySrc } from "../core/profileCustomization.ts";

const STORAGE_KEY = "sunshine_home_decorations_v1";
const BETA_KEY = "betaHomepageDecorations";
const MAX_HOME_DECORATIONS = 12;
const CATALOG_PAGE_SIZE = 24;

export interface HomeDecorationItem {
  id: string;
  name: string;
  url: string;
  xPct: number;
  yPct: number;
  sizePx: number;
  opacity: number;
  rotationDeg: number;
  flipX?: boolean;
  layer?: "back" | "front";
}

const SUBVIEW_CLASSES = [
  "browser-view",
  "games-view",
  "apps-view",
  "studio-view",
  "shop-view",
  "master-view",
  "watch-view",
];

const VIBE_OPTIONS: ReadonlyArray<readonly [CollectibleVibe, string]> = [
  ["auraful", "auraful ✦"],
  ["all", "all"],
  ["anime", "anime"],
  ["cyber", "cyber / neon"],
  ["dark", "dark / goth"],
  ["cosmos", "cosmos"],
];

function isHomeViewActive(): boolean {
  const cl = document.body.classList;
  return !SUBVIEW_CLASSES.some((c) => cl.contains(c));
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function sanitizeItems(raw: unknown): HomeDecorationItem[] {
  if (!Array.isArray(raw)) return [];
  const clean: HomeDecorationItem[] = [];
  for (const entry of raw.slice(0, MAX_HOME_DECORATIONS)) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url.trim() : "";
    if (!url) continue;
    clean.push({
      id:
        typeof obj.id === "string" && obj.id
          ? obj.id
          : `hd_${Math.random().toString(36).slice(2, 9)}`,
      name: typeof obj.name === "string" && obj.name ? obj.name : "decoration",
      url,
      xPct: clamp(Number(obj.xPct) || 50, 4, 96),
      yPct: clamp(Number(obj.yPct) || 50, 6, 94),
      sizePx: clamp(Number(obj.sizePx) || 150, 56, 360),
      opacity: clamp(Number(obj.opacity) || 0.92, 0.15, 1),
      rotationDeg: clamp(Number(obj.rotationDeg) || 0, -180, 180),
      flipX: Boolean(obj.flipX),
      layer: obj.layer === "front" ? "front" : "back",
    });
  }
  return clean;
}

function buildStarterDecorations(): HomeDecorationItem[] {
  const all = getCatalogDecorations();
  const auraful = all.filter((d) => d.a);
  const pool = auraful.length >= 2 ? auraful : all;
  if (pool.length === 0) return [];
  const preferredNames = [
    /void|aura|sakura|lightning|infinity|dragon/i,
    /star|galaxy|flame|cyber|shrine/i,
  ];
  const first = pool.find((d) => preferredNames[0]!.test(d.n)) || pool[0]!;
  const second =
    pool.find((d) => d.u !== first.u && preferredNames[1]!.test(d.n)) ||
    pool[Math.min(1, pool.length - 1)]!;
  return [
    {
      id: "starter_left",
      name: first.n,
      url: first.u,
      xPct: 16,
      yPct: 45,
      sizePx: 170,
      opacity: 0.94,
      rotationDeg: -6,
      flipX: false,
      layer: "front",
    },
    {
      id: "starter_right",
      name: second.n,
      url: second.u,
      xPct: 84,
      yPct: 45,
      sizePx: 170,
      opacity: 0.94,
      rotationDeg: 6,
      flipX: false,
      layer: "front",
    },
  ];
}

function loadSavedDecorations(): HomeDecorationItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      const starter = buildStarterDecorations();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(starter));
      return starter;
    }
    return sanitizeItems(JSON.parse(raw));
  } catch {
    return [];
  }
}

export default function HomepageDecorations() {
  const [betaEnabled, setBetaEnabled] = useState(
    () => localStorage.getItem(BETA_KEY) === "true",
  );
  const [onHome, setOnHome] = useState(() => isHomeViewActive());
  const [items, setItems] = useState<HomeDecorationItem[]>(() =>
    localStorage.getItem(BETA_KEY) === "true" ? loadSavedDecorations() : [],
  );
  const [editMode, setEditMode] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [vibe, setVibe] = useState<CollectibleVibe>("auraful");
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [customUrlInput, setCustomUrlInput] = useState("");
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    origXPct: number;
    origYPct: number;
  } | null>(null);

  const persist = useCallback((next: HomeDecorationItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  useEffect(() => {
    const syncBetaState = (forced?: boolean) => {
      const active =
        typeof forced === "boolean"
          ? forced
          : localStorage.getItem(BETA_KEY) === "true";
      setBetaEnabled(active);
      if (active) {
        const loaded = loadSavedDecorations();
        setItems(loaded);
        if (loaded.length > 0) {
          setSelectedId((prev) => prev || loaded[0]!.id);
        }
      } else {
        setEditMode(false);
        setShowPicker(false);
      }
    };

    const onBetaEvt = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      syncBetaState(typeof detail === "boolean" ? detail : undefined);
    };
    const onOpenEditorEvt = () => {
      if (localStorage.getItem(BETA_KEY) !== "true") {
        localStorage.setItem(BETA_KEY, "true");
        syncBetaState(true);
      }
      const w = window as unknown as {
        hideGamesMenu?: () => void;
        hideAppsMenu?: () => void;
      };
      w.hideGamesMenu?.();
      w.hideAppsMenu?.();
      setEditMode(true);
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === BETA_KEY || e.key === STORAGE_KEY) {
        syncBetaState();
      }
    };
    const onCloudRestore = () => syncBetaState();

    window.addEventListener("betaHomepageDecorationsUpdated", onBetaEvt);
    document.addEventListener("betaHomepageDecorationsUpdated", onBetaEvt);
    window.addEventListener("openHomepageDecorEditor", onOpenEditorEvt);
    window.addEventListener("storage", onStorage);
    document.addEventListener("cloudsync-restored", onCloudRestore);

    const observer = new MutationObserver(() => {
      const nextHome = isHomeViewActive();
      setOnHome(nextHome);
      if (!nextHome) {
        setEditMode(false);
        setShowPicker(false);
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      window.removeEventListener("betaHomepageDecorationsUpdated", onBetaEvt);
      document.removeEventListener("betaHomepageDecorationsUpdated", onBetaEvt);
      window.removeEventListener("openHomepageDecorEditor", onOpenEditorEvt);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("cloudsync-restored", onCloudRestore);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    setVisibleCount(CATALOG_PAGE_SIZE);
  }, [query, vibe]);

  useEffect(() => {
    if (!editMode) return;
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const vw = Math.max(window.innerWidth, 320);
      const vh = Math.max(window.innerHeight, 320);
      const nextX = clamp(d.origXPct + (dx / vw) * 100, 4, 96);
      const nextY = clamp(d.origYPct + (dy / vh) * 100, 6, 94);
      setItems((prev) =>
        prev.map((it) =>
          it.id === d.id
            ? {
                ...it,
                xPct: Math.round(nextX * 10) / 10,
                yPct: Math.round(nextY * 10) / 10,
              }
            : it,
        ),
      );
    };
    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setItems((prev) => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(prev));
        } catch {}
        return prev;
      });
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [editMode]);

  const filteredCatalog = useMemo(() => {
    return getCatalogDecorations().filter((x) =>
      matchesCollectibleFilter(x.n, x.a, query, vibe),
    );
  }, [query, vibe]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  const updateSelected = useCallback(
    (patch: Partial<HomeDecorationItem>) => {
      const targetId = selectedId;
      setItems((prev) => {
        const activeTarget = prev.find((it) => it.id === targetId) || prev[0];
        if (!activeTarget) return prev;
        const next = prev.map((it) =>
          it.id === activeTarget.id ? { ...it, ...patch } : it,
        );
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [selectedId],
  );

  const handleAddCatalogItem = useCallback(
    (name: string, urlToken: string) => {
      if (items.length >= MAX_HOME_DECORATIONS) {
        window.showToast?.(
          "error",
          `max ${MAX_HOME_DECORATIONS} homepage decorations reached`,
        );
        return;
      }
      const offset = (items.length % 5) * 4 - 8;
      const newItem: HomeDecorationItem = {
        id: `hd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name: name || "decoration",
        url: urlToken,
        xPct: clamp(50 + offset, 12, 88),
        yPct: clamp(42 + offset, 14, 82),
        sizePx: 165,
        opacity: 0.94,
        rotationDeg: 0,
        flipX: false,
        layer: "back",
      };
      const next = [...items, newItem];
      persist(next);
      setSelectedId(newItem.id);
      setShowPicker(false);
    },
    [items, persist],
  );

  const handleRemoveSelected = useCallback(() => {
    if (!selectedItem) return;
    const next = items.filter((it) => it.id !== selectedItem.id);
    persist(next);
    setSelectedId(next[0]?.id || null);
  }, [items, persist, selectedItem]);

  if (!betaEnabled || !onHome) return null;

  const shownCatalog = filteredCatalog.slice(0, visibleCount);
  const remainingCatalog = Math.max(0, filteredCatalog.length - shownCatalog.length);

  return (
    <>
      <div
        id="home-decorations-stage"
        class={`home-decor-stage${editMode ? " is-editing" : ""}`}
        aria-hidden={!editMode}
      >
        {items.map((item) => {
          const isSelected = editMode && selectedItem?.id === item.id;
          const expanded = expandCollectibleUrl(item.url);
          const safeSrc = getSafeMediaProxySrc(expanded);
          const zIdx = editMode
            ? isSelected
              ? 88
              : 86
            : item.layer === "front"
              ? 18
              : 2;
          return (
            <div
              key={item.id}
              class={`home-decor-item${isSelected ? " is-selected" : ""}${
                editMode ? " is-draggable" : ""
              }`}
              data-home-decor-id={item.id}
              style={{
                left: `${item.xPct}%`,
                top: `${item.yPct}%`,
                width: `${item.sizePx}px`,
                height: `${item.sizePx}px`,
                opacity: item.opacity,
                zIndex: zIdx,
                transform: `translate(-50%, -50%) rotate(${item.rotationDeg}deg)${
                  item.flipX ? " scaleX(-1)" : ""
                }`,
              }}
              onPointerDown={(e: PointerEvent) => {
                if (!editMode) return;
                e.preventDefault();
                e.stopPropagation();
                setSelectedId(item.id);
                dragRef.current = {
                  id: item.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  origXPct: item.xPct,
                  origYPct: item.yPct,
                };
              }}
              title={editMode ? `${item.name} — drag to move` : undefined}
            >
              <img
                src={safeSrc}
                alt={item.name}
                draggable={false}
                decoding="async"
                class="home-decor-img"
              />
            </div>
          );
        })}
      </div>

      <div class="home-decor-dock">
        {editMode && (
          <div id="home-decor-editor" class="home-decor-editor">
            <div class="home-decor-editor-head">
              <div class="home-decor-editor-title">
                <i class="fa-solid fa-wand-magic-sparkles" />
                <span>homepage decor</span>
                <span class="home-decor-beta-tag">beta</span>
              </div>
              <div class="home-decor-head-actions">
                <button
                  type="button"
                  id="home-decor-add-btn"
                  class={`home-decor-btn${showPicker ? " is-active" : ""}`}
                  onClick={() => setShowPicker((v) => !v)}
                >
                  <i class="fa-solid fa-plus" /> add
                </button>
                <button
                  type="button"
                  class="home-decor-btn"
                  onClick={() => setEditMode(false)}
                >
                  done
                </button>
              </div>
            </div>

            {showPicker ? (
              <div class="home-decor-picker">
                <div class="home-decor-picker-search">
                  <input
                    type="text"
                    placeholder={`search ${filteredCatalog.length} decorations...`}
                    value={query}
                    onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                  />
                  <form
                    class="home-decor-url-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const clean = customUrlInput.trim();
                      if (!clean) return;
                      handleAddCatalogItem("custom url", clean);
                      setCustomUrlInput("");
                    }}
                  >
                    <input
                      type="text"
                      placeholder="or paste image/gif/apng https:// url..."
                      value={customUrlInput}
                      onInput={(e) =>
                        setCustomUrlInput((e.target as HTMLInputElement).value)
                      }
                    />
                    <button type="submit" class="home-decor-btn">
                      use url
                    </button>
                  </form>
                </div>

                <div class="home-decor-vibes">
                  {VIBE_OPTIONS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      class={`home-decor-vibe${vibe === id ? " active" : ""}`}
                      onClick={() => setVibe(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div class="home-decor-grid">
                  {shownCatalog.map((entry, idx) => {
                    const src = getSafeMediaProxySrc(expandCollectibleUrl(entry.u));
                    return (
                      <button
                        key={`${entry.u}_${idx}`}
                        type="button"
                        class="home-decor-card"
                        onClick={() => handleAddCatalogItem(entry.n, entry.u)}
                        title={entry.n}
                      >
                        <img
                          src={src}
                          alt={entry.n}
                          loading={idx < 8 ? "eager" : "lazy"}
                          decoding="async"
                        />
                        <span>{entry.n}</span>
                      </button>
                    );
                  })}
                  {shownCatalog.length === 0 && (
                    <div class="home-decor-empty">no matching decorations</div>
                  )}
                </div>

                {remainingCatalog > 0 && (
                  <button
                    type="button"
                    class="home-decor-btn home-decor-more-btn"
                    onClick={() => setVisibleCount((c) => c + CATALOG_PAGE_SIZE)}
                  >
                    show more ({remainingCatalog} remaining)
                  </button>
                )}
              </div>
            ) : selectedItem ? (
              <div class="home-decor-controls">
                <div class="home-decor-selected-row">
                  <span class="home-decor-selected-name" title={selectedItem.name}>
                    {selectedItem.name}
                  </span>
                  <div class="home-decor-item-pills">
                    {items.map((it, idx) => (
                      <button
                        key={it.id}
                        type="button"
                        class={`home-decor-pill${
                          it.id === selectedItem.id ? " active" : ""
                        }`}
                        onClick={() => setSelectedId(it.id)}
                        title={it.name}
                      >
                        #{idx + 1}
                      </button>
                    ))}
                  </div>
                </div>

                <div class="home-decor-hint">
                  drag any decoration on screen to move ({Math.round(selectedItem.xPct)}%,{" "}
                  {Math.round(selectedItem.yPct)}%)
                </div>

                <label class="home-decor-slider-row">
                  <span>size · {Math.round(selectedItem.sizePx)}px</span>
                  <input
                    id="home-decor-size-slider"
                    type="range"
                    min="56"
                    max="340"
                    step="2"
                    value={selectedItem.sizePx}
                    onInput={(e) =>
                      updateSelected({
                        sizePx: Number((e.target as HTMLInputElement).value),
                      })
                    }
                  />
                </label>

                <label class="home-decor-slider-row">
                  <span>opacity · {Math.round(selectedItem.opacity * 100)}%</span>
                  <input
                    id="home-decor-opacity-slider"
                    type="range"
                    min="0.15"
                    max="1"
                    step="0.05"
                    value={selectedItem.opacity}
                    onInput={(e) =>
                      updateSelected({
                        opacity: Number((e.target as HTMLInputElement).value),
                      })
                    }
                  />
                </label>

                <label class="home-decor-slider-row">
                  <span>rotate · {Math.round(selectedItem.rotationDeg)}°</span>
                  <input
                    id="home-decor-rotate-slider"
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={selectedItem.rotationDeg}
                    onInput={(e) =>
                      updateSelected({
                        rotationDeg: Number((e.target as HTMLInputElement).value),
                      })
                    }
                  />
                </label>

                <div class="home-decor-action-row">
                  <button
                    type="button"
                    class={`home-decor-btn${selectedItem.flipX ? " is-active" : ""}`}
                    onClick={() => updateSelected({ flipX: !selectedItem.flipX })}
                  >
                    flip
                  </button>
                  <button
                    type="button"
                    class={`home-decor-btn${
                      selectedItem.layer === "front" ? " is-active" : ""
                    }`}
                    onClick={() =>
                      updateSelected({
                        layer: selectedItem.layer === "front" ? "back" : "front",
                      })
                    }
                  >
                    {selectedItem.layer === "front" ? "front layer" : "back layer"}
                  </button>
                  <button
                    type="button"
                    class="home-decor-btn"
                    onClick={() => updateSelected({ rotationDeg: 0, flipX: false })}
                  >
                    reset
                  </button>
                  <button
                    type="button"
                    id="home-decor-remove-btn"
                    class="home-decor-btn is-danger"
                    onClick={handleRemoveSelected}
                  >
                    remove
                  </button>
                </div>
              </div>
            ) : (
              <div class="home-decor-empty-state">
                <p>no decorations placed yet.</p>
                <div class="home-decor-action-row">
                  <button
                    type="button"
                    class="home-decor-btn is-active"
                    onClick={() => setShowPicker(true)}
                  >
                    <i class="fa-solid fa-plus" /> browse catalog
                  </button>
                  <button
                    type="button"
                    class="home-decor-btn"
                    onClick={() => {
                      const starter = buildStarterDecorations();
                      persist(starter);
                      setSelectedId(starter[0]?.id || null);
                    }}
                  >
                    starter aura
                  </button>
                </div>
              </div>
            )}

            {items.length > 0 && !showPicker && (
              <div class="home-decor-footer-row">
                <button
                  type="button"
                  class="home-decor-link-btn"
                  onClick={() => {
                    const starter = buildStarterDecorations();
                    persist(starter);
                    setSelectedId(starter[0]?.id || null);
                  }}
                >
                  load starter preset
                </button>
                <button
                  type="button"
                  class="home-decor-link-btn"
                  onClick={() => {
                    persist([]);
                    setSelectedId(null);
                  }}
                >
                  clear all
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          id="home-decor-toggle-edit-btn"
          class={`home-decor-fab${editMode ? " is-active" : ""}`}
          onClick={() => setEditMode((v) => !v)}
          title="Customize Homepage Decorations (Beta)"
        >
          <i class="fa-solid fa-wand-magic-sparkles" />
          <span>{editMode ? "close editor" : "home decor (beta)"}</span>
        </button>
      </div>
    </>
  );
}
