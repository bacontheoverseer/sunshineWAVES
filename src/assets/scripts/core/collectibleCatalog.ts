import catalogJson from "./collectibleCatalog.json";

const PREFIX_MAP: ReadonlyArray<readonly [string, string]> = [
  [
    "@g:",
    "https://raw.githubusercontent.com/JulesZYTB/discord-collectibles-downloader/main/discord_collectibles/",
  ],
  ["@d:", "https://cdn.discordapp.com/"],
  ["@a:", "https://discord-decoration.art/decorations/"],
];

export interface RawDecorationEntry {
  n: string;
  u: string;
  c: string;
  a?: number;
}

export interface RawEffectEntry {
  n: string;
  t?: string;
  l: string[];
  a?: number;
}

export interface RawNameplateEntry {
  n: string;
  u: string;
  a?: number;
}

export type FrameLayerSlot = "t" | "b" | "f";

export interface RawFrameEntry {
  id: string;
  n: string;
  l: Array<[FrameLayerSlot, string]>;
  a?: number;
}

export type CollectibleVibe = "all" | "auraful" | "dark" | "anime" | "cyber" | "cosmos";

const VIBE_REGEXES: Record<Exclude<CollectibleVibe, "all" | "auraful">, RegExp> = {
  dark: /omen|nevermore|night|dark|void|crimson|venom|demon|reaper|shadow|ghost|skull|witch|abyss|blood|goth|roses|fallen|black flash|shrine|vengeance/i,
  anime: /shrine|void|katana|sakura|kitsune|anime|spirit|dragon|tiger|mage|blade|soul|shatter|kawaii|mariposa|starlight/i,
  cyber: /cyber|glitch|neon|chaos|retro|futurism|surge|lightning|divide|dimensional|matrix|arcade|hologram|laser|pixel/i,
  cosmos: /moon|star|cosmos|nebula|eclipse|aurora|galaxy|crystal|amethyst|aquamarine|carnelian|peridot|pond|spring|lotus|flame|fire|phoenix/i,
};

/** Expands compact storage tokens (@g:, @d:, @a:) back into full CDN HTTPS URLs. */
export function expandCollectibleUrl(urlOrToken: string): string {
  const s = (urlOrToken || "").trim();
  for (const [token, base] of PREFIX_MAP) {
    if (s.startsWith(token)) return base + s.slice(token.length);
  }
  return s;
}

interface CollectibleCatalogShape {
  decorations: RawDecorationEntry[];
  effects: RawEffectEntry[];
  nameplates: RawNameplateEntry[];
  frames: RawFrameEntry[];
}

const catalog = catalogJson as unknown as CollectibleCatalogShape;

const effectLayersByUrl = new Map<string, string[]>();
for (const eff of catalog.effects) {
  const expandedLayers = eff.l.map(expandCollectibleUrl);
  for (const url of expandedLayers) {
    if (!effectLayersByUrl.has(url)) {
      effectLayersByUrl.set(url, expandedLayers);
    }
  }
}

const frameById = new Map<string, RawFrameEntry>();
for (const frame of catalog.frames) {
  frameById.set(frame.id, frame);
}

export function getCatalogDecorations(): readonly RawDecorationEntry[] {
  return catalog.decorations;
}

export function getCatalogEffects(): readonly RawEffectEntry[] {
  return catalog.effects;
}

export function getCatalogNameplates(): readonly RawNameplateEntry[] {
  return catalog.nameplates;
}

export function getCatalogFrames(): readonly RawFrameEntry[] {
  return catalog.frames;
}

/** Checks whether a catalog item matches both text query and selected vibe filter. */
export function matchesCollectibleFilter(
  name: string,
  isAura: number | undefined,
  query: string,
  vibe: CollectibleVibe,
): boolean {
  if (vibe === "auraful" && !isAura) return false;
  if (vibe !== "all" && vibe !== "auraful") {
    const re = VIBE_REGEXES[vibe];
    if (!re.test(name)) return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q);
}

/** Looks up multi-layer animated APNG stack for an effect URL (or falls back to `[url]`). */
export function findProfileEffectLayers(effectUrl: string): string[] {
  const clean = (effectUrl || "").trim();
  if (!clean) return [];
  return effectLayersByUrl.get(clean) || [clean];
}

/** Looks up multi-layer border placements `[slot, expandedUrl]` for a saved frame id. */
export function findFrameLayers(
  frameId: string,
): Array<[FrameLayerSlot, string]> {
  const clean = (frameId || "").trim();
  if (!clean) return [];
  const entry = frameById.get(clean);
  if (!entry) return [];
  return entry.l.map(([slot, url]) => [slot, expandCollectibleUrl(url)]);
}
