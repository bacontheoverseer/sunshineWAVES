import { useEffect, useMemo, useState } from "preact/hooks";
import {
  type CollectibleVibe,
  expandCollectibleUrl,
  getCatalogDecorations,
  getCatalogEffects,
  getCatalogFrames,
  getCatalogNameplates,
  matchesCollectibleFilter,
} from "../core/collectibleCatalog.ts";
import {
  AVATAR_DECORATIONS,
  NAMEPLATES,
  PROFILE_EFFECTS,
  type ProfileCustomization,
  type StyleOption,
  getSafeMediaProxySrc,
} from "../core/profileCustomization.ts";
import { isChromebookModeEnabled } from "../core/chromebookMode.ts";

export type CollectibleTabKind = "decoration" | "effect" | "nameplate" | "frame";

interface CollectiblePickerPanelProps {
  kind: CollectibleTabKind;
  custom: ProfileCustomization;
  onPatch: (patch: Partial<ProfileCustomization>) => void;
}

const VIBE_OPTIONS: ReadonlyArray<readonly [CollectibleVibe, string]> = [
  ["all", "all"],
  ["auraful", "auraful ✦"],
  ["dark", "dark / goth"],
  ["anime", "anime"],
  ["cyber", "cyber / neon"],
  ["cosmos", "cosmos"],
];

const PAGE_SIZE = 24;

export default function CollectiblePickerPanel({
  kind,
  custom,
  onPatch,
}: CollectiblePickerPanelProps) {
  const [query, setQuery] = useState("");
  const [vibe, setVibe] = useState<CollectibleVibe>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [showClassic, setShowClassic] = useState(false);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [kind, query, vibe]);

  const counts = useMemo(
    () => ({
      decoration: getCatalogDecorations().length,
      effect: getCatalogEffects().length,
      nameplate: getCatalogNameplates().length,
      frame: getCatalogFrames().length,
    }),
    [],
  );

  const filteredItems = useMemo(() => {
    if (kind === "decoration") {
      return getCatalogDecorations().filter((x) =>
        matchesCollectibleFilter(x.n, x.a, query, vibe),
      );
    }
    if (kind === "effect") {
      return getCatalogEffects().filter((x) =>
        matchesCollectibleFilter(x.n, x.a, query, vibe),
      );
    }
    if (kind === "nameplate") {
      return getCatalogNameplates().filter((x) =>
        matchesCollectibleFilter(x.n, x.a, query, vibe),
      );
    }
    return getCatalogFrames().filter((x) =>
      matchesCollectibleFilter(x.n, x.a, query, vibe),
    );
  }, [kind, query, vibe]);

  const shown = filteredItems.slice(0, visibleCount);
  const remaining = Math.max(0, filteredItems.length - shown.length);

  const nounPlural =
    kind === "decoration"
      ? "avatar decorations"
      : kind === "effect"
      ? "profile effects"
      : kind === "nameplate"
      ? "nameplates"
      : "card frames";

  const removeLabel =
    kind === "decoration"
      ? "remove avatar decoration"
      : kind === "effect"
      ? "remove profile effect"
      : kind === "nameplate"
      ? "remove nameplate"
      : "remove card frame";

  const currentCustomUrl =
    kind === "decoration"
      ? custom.decorationUrl
      : kind === "effect"
      ? custom.profileEffectUrl
      : kind === "nameplate"
      ? custom.nameplateUrl
      : custom.cardFrameUrl;

  const handleRemove = () => {
    if (kind === "decoration") {
      onPatch({ decorationUrl: "", avatarDecoration: "none" });
    } else if (kind === "effect") {
      onPatch({ profileEffectUrl: "", profileEffect: "none" });
    } else if (kind === "nameplate") {
      onPatch({ nameplateUrl: "", nameplate: "none" });
    } else {
      onPatch({ cardFrameId: "", cardFrameUrl: "" });
    }
  };

  const handleCustomUrlInput = (val: string) => {
    const clean = val.trim();
    if (kind === "decoration") {
      onPatch({ decorationUrl: clean, avatarDecoration: clean ? "none" : custom.avatarDecoration });
    } else if (kind === "effect") {
      onPatch({ profileEffectUrl: clean, profileEffect: clean ? "none" : custom.profileEffect });
    } else if (kind === "nameplate") {
      onPatch({ nameplateUrl: clean, nameplate: clean ? "none" : custom.nameplate });
    } else {
      onPatch({ cardFrameUrl: clean, cardFrameId: clean ? "" : custom.cardFrameId });
    }
  };

  const classicList: StyleOption<string>[] =
    kind === "decoration"
      ? AVATAR_DECORATIONS
      : kind === "effect"
      ? PROFILE_EFFECTS
      : kind === "nameplate"
      ? NAMEPLATES
      : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div class="chat-collectible-toolbar">
        <div class="chat-collectible-search-wrap">
          <i class="fa-solid fa-magnifying-glass chat-collectible-search-icon" />
          <input
            type="text"
            class="chat-collectible-search"
            placeholder={`search through ${counts[kind]} ${nounPlural}... ╮(╯▽╰)╭`}
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>

        <div class="chat-collectible-vibes">
          {VIBE_OPTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              class={`chat-vibe-pill ${vibe === id ? "active" : ""}`}
              onClick={() => setVibe(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div
          style={{
            padding: "24px 12px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--color-sublabel)",
            border: "1px dashed var(--bg-surface-10)",
            borderRadius: "10px",
          }}
        >
          no matching {nounPlural} found — try clearing search or pasting a custom url below
        </div>
      ) : (
        <div class={`chat-collectible-grid is-${kind}s`}>
          {shown.map((item, idx) => {
            const imgLoading = isChromebookModeEnabled()
              ? "lazy"
              : idx < 9
                ? "eager"
                : "lazy";
            if (kind === "decoration") {
              const d = item as ReturnType<typeof getCatalogDecorations>[number];
              const fullUrl = expandCollectibleUrl(d.u);
              const active = custom.decorationUrl === fullUrl;
              return (
                <button
                  key={`${d.n}:${d.u}`}
                  type="button"
                  class={`chat-collectible-card ${active ? "active" : ""}`}
                  title={d.n}
                  onClick={() =>
                    onPatch({ decorationUrl: fullUrl, avatarDecoration: "none" })
                  }
                >
                  {d.a ? <span class="chat-collectible-aura-dot">✦</span> : null}
                  <div class="chat-collectible-thumb-box">
                    <img
                      src={getSafeMediaProxySrc(fullUrl)}
                      alt={d.n}
                      class="chat-collectible-thumb-img"
                      loading={imgLoading}
                      decoding="async"
                    />
                  </div>
                  <span class="chat-collectible-card-label">{d.n}</span>
                </button>
              );
            }

            if (kind === "effect") {
              const ef = item as ReturnType<typeof getCatalogEffects>[number];
              const primaryUrl = expandCollectibleUrl(ef.l[0] || "");
              const thumbUrl = expandCollectibleUrl(ef.t || ef.l[0] || "");
              const active = Boolean(primaryUrl && custom.profileEffectUrl === primaryUrl);
              return (
                <button
                  key={`${ef.n}:${primaryUrl}`}
                  type="button"
                  class={`chat-collectible-card ${active ? "active" : ""}`}
                  title={ef.n}
                  onClick={() =>
                    onPatch({ profileEffectUrl: primaryUrl, profileEffect: "none" })
                  }
                >
                  {ef.a ? <span class="chat-collectible-aura-dot">✦</span> : null}
                  <div class="chat-collectible-thumb-box">
                    <img
                      src={getSafeMediaProxySrc(active ? primaryUrl : thumbUrl)}
                      alt={ef.n}
                      class="chat-collectible-thumb-img"
                      loading={imgLoading}
                      decoding="async"
                    />
                  </div>
                  <span class="chat-collectible-card-label">{ef.n}</span>
                </button>
              );
            }

            if (kind === "nameplate") {
              const np = item as ReturnType<typeof getCatalogNameplates>[number];
              const fullUrl = expandCollectibleUrl(np.u);
              const active = custom.nameplateUrl === fullUrl;
              return (
                <button
                  key={`${np.n}:${np.u}`}
                  type="button"
                  class={`chat-collectible-card ${active ? "active" : ""}`}
                  title={np.n}
                  onClick={() =>
                    onPatch({ nameplateUrl: fullUrl, nameplate: "none" })
                  }
                >
                  {np.a ? <span class="chat-collectible-aura-dot">✦</span> : null}
                  <div class="chat-collectible-thumb-box">
                    <img
                      src={getSafeMediaProxySrc(fullUrl)}
                      alt={np.n}
                      class="chat-collectible-thumb-img"
                      loading={imgLoading}
                      decoding="async"
                    />
                  </div>
                  <span class="chat-collectible-card-label">{np.n}</span>
                </button>
              );
            }

            const fr = item as ReturnType<typeof getCatalogFrames>[number];
            const active = custom.cardFrameId === fr.id && !custom.cardFrameUrl;
            return (
              <button
                key={fr.id}
                type="button"
                class={`chat-collectible-card ${active ? "active" : ""}`}
                title={fr.n}
                onClick={() => onPatch({ cardFrameId: fr.id, cardFrameUrl: "" })}
              >
                {fr.a ? <span class="chat-collectible-aura-dot">✦</span> : null}
                <div class="chat-collectible-thumb-box">
                  {fr.l.map(([slot, rawU]) => {
                    const expanded = expandCollectibleUrl(rawU);
                    return (
                      <img
                        key={`${slot}:${expanded}`}
                        src={getSafeMediaProxySrc(expanded)}
                        alt=""
                        class="chat-collectible-frame-thumb-layer"
                        loading={imgLoading}
                        decoding="async"
                      />
                    );
                  })}
                </div>
                <span class="chat-collectible-card-label">{fr.n}</span>
              </button>
            );
          })}
        </div>
      )}

      {remaining > 0 && (
        <button
          type="button"
          class="chat-collectible-load-more"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
        >
          load {Math.min(PAGE_SIZE, remaining)} more ({remaining} left)
        </button>
      )}

      <button
        type="button"
        class="chat-collectible-remove-btn"
        onClick={handleRemove}
      >
        {removeLabel}
      </button>

      <div>
        <input
          type="url"
          class="chat-mod-input"
          placeholder={`or paste custom https:// animated ${kind} png/apng/gif url...`}
          value={currentCustomUrl}
          onInput={(e) =>
            handleCustomUrlInput((e.target as HTMLInputElement).value)
          }
        />
      </div>

      {classicList.length > 0 && (
        <div>
          <button
            type="button"
            class="chat-gif-more-btn"
            style={{ width: "100%", justifyContent: "space-between", gap: "6px" }}
            onClick={() => setShowClassic((s) => !s)}
          >
            <span>built-in css presets</span>
            <i class={`fa-solid fa-chevron-${showClassic ? "up" : "down"}`} />
          </button>
          {showClassic && (
            <div class="chat-customizer-grid" style={{ marginTop: "6px" }}>
              {classicList.map((opt) => {
                const isSelected =
                  kind === "decoration"
                    ? !custom.decorationUrl && custom.avatarDecoration === opt.id
                    : kind === "effect"
                    ? !custom.profileEffectUrl && custom.profileEffect === opt.id
                    : !custom.nameplateUrl && custom.nameplate === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    class={`chat-style-chip ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      if (kind === "decoration") {
                        onPatch({ decorationUrl: "", avatarDecoration: opt.id });
                      } else if (kind === "effect") {
                        onPatch({ profileEffectUrl: "", profileEffect: opt.id });
                      } else {
                        onPatch({ nameplateUrl: "", nameplate: opt.id });
                      }
                    }}
                  >
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
