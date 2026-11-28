// Advanced No-Code 2D & 3D Game Engine Core for Operation Cookie Game Studio
// 100% backward-compatible with legacy 20x12 StudioGameProject entries.

export type GameMode =
  | "platformer"
  | "metroidvania"
  | "fps3d"
  | "topdown"
  | "shooter"
  | "survivor"
  | "gravrunner"
  | "flappy"
  | "custom_html";

export type WorldSizePreset = "room" | "wide" | "tower" | "mega";

export type WeaponType =
  | "none"
  | "blaster"
  | "shotgun"
  | "laser"
  | "boomerang"
  | "grenade"
  | "sword";

export type WinConditionType =
  | "portal"
  | "all_enemies"
  | "all_coins"
  | "survive_timer";

export type WeatherType =
  | "none"
  | "starfield"
  | "rain"
  | "snow"
  | "embers"
  | "matrix";

export type PaintToolMode = "brush" | "thick" | "rect" | "line" | "bucket";

export type BrushCategory = "all" | "terrain" | "gadgets" | "enemies" | "items";

export type RuleTriggerType =
  | "on_start"
  | "on_all_coins"
  | "on_all_enemies"
  | "on_boss_defeated"
  | "on_switch_on"
  | "on_score_50"
  | "on_score_150"
  | "on_every_10s"
  | "on_low_hp";

export type RuleActionType =
  | "open_doors"
  | "win_level"
  | "low_gravity"
  | "flip_gravity"
  | "grant_shield"
  | "heal_player"
  | "overdrive_weapon"
  | "spawn_boss"
  | "shatter_bricks"
  | "announce";

export interface StudioLogicRule {
  id: string;
  when: RuleTriggerType;
  action: RuleActionType;
  text?: string;
}

export interface StudioGameLevel {
  id: string;
  name: string;
  grid: number[][];
  bgColor?: string;
  wallColor?: string;
  worldSize?: WorldSizePreset;
  weather?: WeatherType;
  darknessMode?: boolean;
  winCondition?: WinConditionType;
  timeLimitSec?: number;
  signText?: string;
}

export interface StudioGameProject {
  id: string;
  title: string;
  description: string;
  author: string;
  studioName?: string;
  studioColor?: string;
  mode: GameMode;
  grid: number[][];
  levels?: StudioGameLevel[];
  gravity: number;
  jumpForce: number;
  moveSpeed: number;
  maxHp?: number;
  enableDash?: boolean;
  enableDoubleJump?: boolean;
  enableWallJump?: boolean;
  enableJetpack?: boolean;
  enableBlaster?: boolean;
  weaponType?: WeaponType;
  mouseAim?: boolean;
  autoFire?: boolean;
  winCondition?: WinConditionType;
  timeLimitSec?: number;
  weather?: WeatherType;
  darknessMode?: boolean;
  sfxEnabled?: boolean;
  screenShake?: boolean;
  cameraZoom?: number;
  rules?: StudioLogicRule[];
  playerColor: string;
  bgColor: string;
  wallColor: string;
  customScript: string;
  isCustomHtml?: boolean;
  customHtmlContent?: string;
  likes: number;
  likedBy?: string[];
  plays: number;
  createdAt: string;
}

export const VIEWPORT_COLS = 20;
export const VIEWPORT_ROWS = 12;
export const TILE_SIZE = 34; // 680 x 408 viewport canvas

export const WORLD_SIZE_PRESETS: Record<
  WorldSizePreset,
  { label: string; cols: number; rows: number; desc: string; icon: string }
> = {
  room: {
    label: "arena (20×12)",
    cols: 20,
    rows: 12,
    desc: "classic single-screen room",
    icon: "fa-border-all",
  },
  wide: {
    label: "scrolling world (48×14)",
    cols: 48,
    rows: 14,
    desc: "wide side-scrolling adventure",
    icon: "fa-arrows-left-right",
  },
  tower: {
    label: "vertical tower (24×30)",
    cols: 24,
    rows: 30,
    desc: "tall climbing & drop shaft",
    icon: "fa-arrows-up-down",
  },
  mega: {
    label: "mega world (46×26)",
    cols: 46,
    rows: 26,
    desc: "massive open metroidvania / dungeon",
    icon: "fa-globe",
  },
};

export const ENGINE_MODES: {
  id: Exclude<GameMode, "custom_html">;
  label: string;
  shortLabel: string;
  icon: string;
  desc: string;
}[] = [
  {
    id: "platformer",
    label: "2d platformer",
    shortLabel: "platformers",
    icon: "fa-person-running",
    desc: "tight jump, wall-kick, dash & boss action",
  },
  {
    id: "metroidvania",
    label: "metroidvania",
    shortLabel: "metroidvania",
    icon: "fa-dungeon",
    desc: "sprawling scrolling caverns, wall-jumps, switches & keys",
  },
  {
    id: "fps3d",
    label: "1st-person 3d",
    shortLabel: "first-person 3d",
    icon: "fa-cube",
    desc: "60fps raycasted 3d corridors, doors, turrets & bosses",
  },
  {
    id: "topdown",
    label: "2d rpg / dungeon",
    shortLabel: "top-down rpg",
    icon: "fa-compass",
    desc: "8-way dungeon crawler with NPC signs, puzzles & bosses",
  },
  {
    id: "shooter",
    label: "twin-stick shooter",
    shortLabel: "shooters",
    icon: "fa-crosshairs",
    desc: "360° cursor-aim combat with 6 weapons & TNT",
  },
  {
    id: "survivor",
    label: "wave survivor",
    shortLabel: "wave survivor",
    icon: "fa-skull",
    desc: "bullet-heaven horde survival with auto-spawning waves",
  },
  {
    id: "gravrunner",
    label: "gravity runner",
    shortLabel: "gravity runner",
    icon: "fa-bolt",
    desc: "auto-scrolling cyber runner — press jump to flip gravity!",
  },
  {
    id: "flappy",
    label: "flappy dash",
    shortLabel: "flappy dash",
    icon: "fa-dove",
    desc: "aerial thruster gauntlet through hazards & rings",
  },
];

export interface BrushDef {
  id: number;
  name: string;
  color: string;
  icon: string;
  category: Exclude<BrushCategory, "all">;
  hint: string;
}

export const STUDIO_BRUSHES: BrushDef[] = [
  // Terrain
  { id: 1, name: "solid wall", color: "#3b82f6", icon: "fa-square", category: "terrain", hint: "indestructible wall block" },
  { id: 13, name: "one-way ledge", color: "#60a5fa", icon: "fa-grip-lines", category: "terrain", hint: "jump up from below, stand on top" },
  { id: 14, name: "breakable brick", color: "#d97706", icon: "fa-border-none", category: "terrain", hint: "shatters from shots, sword, dash or TNT" },
  { id: 15, name: "ice block", color: "#67e8f9", icon: "fa-snowflake", category: "terrain", hint: "low-friction momentum slide" },
  { id: 4, name: "lava / spikes", color: "#ef4444", icon: "fa-skull-crossbones", category: "terrain", hint: "deals 1 heart damage on contact" },
  { id: 0, name: "eraser", color: "#64748b", icon: "fa-eraser", category: "terrain", hint: "clear tile (or right-click anywhere)" },

  // Gadgets & Contraptions
  { id: 6, name: "bounce pad", color: "#06b6d4", icon: "fa-angles-up", category: "gadgets", hint: "launches hero high into the air" },
  { id: 8, name: "h-platform", color: "#6366f1", icon: "fa-arrows-left-right", category: "gadgets", hint: "horizontal moving platform" },
  { id: 17, name: "v-elevator", color: "#818cf8", icon: "fa-arrows-up-down", category: "gadgets", hint: "vertical moving elevator" },
  { id: 16, name: "conveyor belt", color: "#fb923c", icon: "fa-forward", category: "gadgets", hint: "pushes hero & enemies fast" },
  { id: 18, name: "gravity pad", color: "#c084fc", icon: "fa-retweet", category: "gadgets", hint: "flips gravity upside-down / normal" },
  { id: 19, name: "teleporter", color: "#2dd4bf", icon: "fa-bullseye", category: "gadgets", hint: "warps between placed teleporters" },
  { id: 20, name: "laser switch", color: "#facc15", icon: "fa-toggle-on", category: "gadgets", hint: "toggles switch doors & rules" },
  { id: 21, name: "switch door", color: "#fb7185", icon: "fa-bars-staggered", category: "gadgets", hint: "opens when laser switch is ON" },
  { id: 12, name: "key gate", color: "#94a3b8", icon: "fa-lock", category: "gadgets", hint: "opens once all golden keys are collected" },
  { id: 22, name: "tnt barrel", color: "#f97316", icon: "fa-bomb", category: "gadgets", hint: "explodes in chain-reaction AoE blast" },

  // Enemies & Hazards
  { id: 5, name: "patrol walker", color: "#a855f7", icon: "fa-ghost", category: "enemies", hint: "patrols ledges; stomp or shoot" },
  { id: 9, name: "cyber boss", color: "#ec4899", icon: "fa-dragon", category: "enemies", hint: "armored multi-HP hunter boss" },
  { id: 23, name: "flying drone", color: "#e879f9", icon: "fa-helicopter", category: "enemies", hint: "aerial sine-wave hover drone" },
  { id: 24, name: "laser turret", color: "#f43f5e", icon: "fa-tower-observation", category: "enemies", hint: "aims & fires plasma bolts at hero" },
  { id: 25, name: "spawner rift", color: "#7c3aed", icon: "fa-hurricane", category: "enemies", hint: "spawns enemies until destroyed" },

  // Items, Spawns & Goals
  { id: 2, name: "hero spawn", color: "#22c55e", icon: "fa-user-astronaut", category: "items", hint: "starting position for this level" },
  { id: 7, name: "goal portal", color: "#10b981", icon: "fa-flag-checkered", category: "items", hint: "advances to next level or wins game" },
  { id: 3, name: "coin (+10)", color: "#eab308", icon: "fa-coins", category: "items", hint: "collectible score & coin objective" },
  { id: 11, name: "golden key", color: "#f59e0b", icon: "fa-key", category: "items", hint: "unlocks key gates" },
  { id: 10, name: "checkpoint +hp", color: "#fb7185", icon: "fa-heart-pulse", category: "items", hint: "saves respawn point & heals +1 heart" },
  { id: 26, name: "overdrive orb", color: "#38bdf8", icon: "fa-bolt-lightning", category: "items", hint: "grants shield + rapid-fire + speed" },
  { id: 27, name: "npc / signpost", color: "#fde047", icon: "fa-comment-dots", category: "items", hint: "shows custom level dialogue bubble" },
];

export const WEAPON_OPTIONS: {
  id: WeaponType;
  label: string;
  icon: string;
  desc: string;
}[] = [
  { id: "blaster", label: "plasma blaster", icon: "fa-crosshairs", desc: "balanced rapid energy bolts" },
  { id: "shotgun", label: "tri-scatter", icon: "fa-burst", desc: "3-way spread burst; shreds crowds" },
  { id: "laser", label: "pierce railbeam", icon: "fa-wand-magic-sparkles", desc: "instant high-velocity piercing beam" },
  { id: "boomerang", label: "cyber chakram", icon: "fa-compact-disc", desc: "curves back to hero & hits twice" },
  { id: "grenade", label: "demo launcher", icon: "fa-bomb", desc: "arcing AoE blast; breaks bricks & TNT" },
  { id: "sword", label: "energy katana", icon: "fa-khanda", desc: "close cleave that deflects enemy shots!" },
  { id: "none", label: "unarmed", icon: "fa-ban", desc: "pure platforming / dodge challenge" },
];

export const RULE_TRIGGERS: { id: RuleTriggerType; label: string }[] = [
  { id: "on_start", label: "when level starts" },
  { id: "on_all_coins", label: "when all coins collected" },
  { id: "on_all_enemies", label: "when all enemies defeated" },
  { id: "on_boss_defeated", label: "when a boss is defeated" },
  { id: "on_switch_on", label: "when laser switch turns ON" },
  { id: "on_score_50", label: "when score reaches 50+" },
  { id: "on_score_150", label: "when score reaches 150+" },
  { id: "on_every_10s", label: "every 10 seconds" },
  { id: "on_low_hp", label: "when hero drops to 1 heart" },
];

export const RULE_ACTIONS: { id: RuleActionType; label: string }[] = [
  { id: "open_doors", label: "unlock all gates & switch doors" },
  { id: "win_level", label: "complete level immediately" },
  { id: "grant_shield", label: "grant 6s invincible shield" },
  { id: "overdrive_weapon", label: "activate 8s rapid-fire overdrive" },
  { id: "heal_player", label: "restore +2 hearts" },
  { id: "low_gravity", label: "set moon low-gravity" },
  { id: "flip_gravity", label: "invert gravity direction" },
  { id: "shatter_bricks", label: "shatter all breakable bricks" },
  { id: "spawn_boss", label: "spawn ambush cyber boss" },
  { id: "announce", label: "show custom banner message" },
];

// ============================================================================
// PROCEDURAL WEBAUDIO SYNTHESIZER (Zero external audio files needed)
// ============================================================================
let sharedAudioCtx: AudioContext | null = null;

export type SfxKind =
  | "jump"
  | "dash"
  | "shoot"
  | "laser"
  | "sword"
  | "explosion"
  | "coin"
  | "powerup"
  | "hit"
  | "switch"
  | "teleport"
  | "win";

export function playStudioSfx(kind: SfxKind, enabled = true): void {
  if (!enabled || typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume().catch(() => {});
    }
    const ctx = sharedAudioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (kind === "jump") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(540, now + 0.11);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (kind === "dash") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.1);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (kind === "shoot") {
      osc.type = "square";
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(210, now + 0.08);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      osc.start(now);
      osc.stop(now + 0.085);
    } else if (kind === "laser") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(980, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.13);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
      osc.start(now);
      osc.stop(now + 0.13);
    } else if (kind === "sword") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.07);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (kind === "explosion") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(38, now + 0.26);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.27);
      osc.start(now);
      osc.stop(now + 0.27);
    } else if (kind === "coin") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(780, now);
      osc.frequency.setValueAtTime(1080, now + 0.055);
      gain.gain.setValueAtTime(0.075, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      osc.start(now);
      osc.stop(now + 0.14);
    } else if (kind === "powerup") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(1120, now + 0.22);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
      osc.start(now);
      osc.stop(now + 0.23);
    } else if (kind === "hit") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.16);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc.start(now);
      osc.stop(now + 0.17);
    } else if (kind === "switch") {
      osc.type = "square";
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.setValueAtTime(720, now + 0.04);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    } else if (kind === "teleport") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(1250, now + 0.16);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);
      osc.start(now);
      osc.stop(now + 0.17);
    } else if (kind === "win") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      osc.frequency.setValueAtTime(1046.5, now + 0.24);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc.start(now);
      osc.stop(now + 0.42);
    }
  } catch {}
}

// ============================================================================
// GRID HELPERS, PAINTING TOOLS & PROCEDURAL LEVEL GENERATOR
// ============================================================================

export function getGridDimensions(grid?: number[][]): { rows: number; cols: number } {
  const rows = Array.isArray(grid) && grid.length >= 8 ? grid.length : VIEWPORT_ROWS;
  const cols = Array.isArray(grid?.[0]) && grid[0].length >= 12 ? grid[0].length : VIEWPORT_COLS;
  return { rows, cols };
}

export function inferWorldSizePreset(grid?: number[][]): WorldSizePreset {
  const { rows, cols } = getGridDimensions(grid);
  if (cols >= 40 && rows >= 22) return "mega";
  if (cols >= 36) return "wide";
  if (rows >= 22) return "tower";
  return "room";
}

export function createSizedEmptyGrid(rows = VIEWPORT_ROWS, cols = VIEWPORT_COLS): number[][] {
  return Array.from({ length: rows }, () => Array<number>(cols).fill(0));
}

function setCell(grid: number[][], r: number, c: number, val: number): void {
  const row = grid[r];
  if (row && c >= 0 && c < row.length) {
    row[c] = val;
  }
}

function getCell(grid: number[][], r: number, c: number): number {
  return grid[r]?.[c] ?? 0;
}

export function resizeLevelGrid(
  oldGrid: number[][],
  newRows: number,
  newCols: number,
  anchorBottom = false
): number[][] {
  const { rows: oldRows, cols: oldCols } = getGridDimensions(oldGrid);
  const next = createSizedEmptyGrid(newRows, newCols);
  const rowOffset = anchorBottom ? newRows - oldRows : 0;

  let hasSpawn = false;
  for (let r = 0; r < oldRows; r++) {
    const dstR = r + rowOffset;
    if (dstR < 0 || dstR >= newRows) continue;
    for (let c = 0; c < Math.min(oldCols, newCols); c++) {
      const val = getCell(oldGrid, r, c);
      setCell(next, dstR, c, val);
      if (val === 2) hasSpawn = true;
    }
  }
  if (!hasSpawn) {
    setCell(next, Math.max(1, newRows - 3), 2, 2);
  }
  return next;
}

function clearOtherSpawns(grid: number[][]): void {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c] === 2) row[c] = 0;
    }
  }
}

export function applyRectPaint(
  grid: number[][],
  r0: number,
  c0: number,
  r1: number,
  c1: number,
  brushId: number
): number[][] {
  const rows = grid.length;
  const cols = grid[0]?.length || VIEWPORT_COLS;
  const copy = grid.map((row) => [...row]);
  if (brushId === 2) {
    clearOtherSpawns(copy);
    if (r1 >= 0 && r1 < rows && c1 >= 0 && c1 < cols) setCell(copy, r1, c1, 2);
    return copy;
  }
  const minR = Math.max(0, Math.min(r0, r1));
  const maxR = Math.min(rows - 1, Math.max(r0, r1));
  const minC = Math.max(0, Math.min(c0, c1));
  const maxC = Math.min(cols - 1, Math.max(c0, c1));
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      setCell(copy, r, c, brushId);
    }
  }
  return copy;
}

export function applyLinePaint(
  grid: number[][],
  r0: number,
  c0: number,
  r1: number,
  c1: number,
  brushId: number
): number[][] {
  const rows = grid.length;
  const cols = grid[0]?.length || VIEWPORT_COLS;
  const copy = grid.map((row) => [...row]);
  if (brushId === 2) {
    clearOtherSpawns(copy);
    if (r1 >= 0 && r1 < rows && c1 >= 0 && c1 < cols) setCell(copy, r1, c1, 2);
    return copy;
  }
  let x0 = c0;
  let y0 = r0;
  const x1 = c1;
  const y1 = r1;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let guard = 0;
  while (guard++ < 500) {
    if (y0 >= 0 && y0 < rows && x0 >= 0 && x0 < cols) {
      setCell(copy, y0, x0, brushId);
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return copy;
}

export function applyFloodFill(
  grid: number[][],
  startR: number,
  startC: number,
  brushId: number
): number[][] {
  const rows = grid.length;
  const cols = grid[0]?.length || VIEWPORT_COLS;
  if (startR < 0 || startR >= rows || startC < 0 || startC >= cols) return grid;
  const copy = grid.map((row) => [...row]);
  if (brushId === 2) {
    clearOtherSpawns(copy);
    setCell(copy, startR, startC, 2);
    return copy;
  }
  const target = getCell(copy, startR, startC);
  if (target === brushId) return copy;

  const queue: [number, number][] = [[startR, startC]];
  const visited = new Set<number>([startR * cols + startC]);
  let count = 0;
  while (queue.length > 0 && count++ < rows * cols) {
    const item = queue.shift();
    if (!item) break;
    const [r, c] = item;
    setCell(copy, r, c, brushId);
    const dirs: [number, number][] = [
      [r - 1, c],
      [r + 1, c],
      [r, c - 1],
      [r, c + 1],
    ];
    for (const [nr, nc] of dirs) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const key = nr * cols + nc;
      if (!visited.has(key) && getCell(copy, nr, nc) === target) {
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
  }
  return copy;
}

export function generateProceduralLevel(
  mode: GameMode,
  rows = VIEWPORT_ROWS,
  cols = VIEWPORT_COLS,
  seedOffset = 0
): number[][] {
  const g = createSizedEmptyGrid(rows, cols);
  let seed = (Date.now() + seedOffset * 7919) % 2147483647;
  const rnd = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const randInt = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;

  if (mode === "fps3d" || mode === "topdown" || mode === "survivor") {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) setCell(g, r, c, 1);
      }
    }
    if (mode === "survivor") {
      const midR = Math.floor(rows / 2);
      const midC = Math.floor(cols / 2);
      setCell(g, midR, midC, 2);
      const pillars = Math.max(4, Math.floor((rows * cols) / 55));
      for (let i = 0; i < pillars; i++) {
        const pr = randInt(2, rows - 3);
        const pc = randInt(2, cols - 3);
        if (Math.hypot(pr - midR, pc - midC) < 3.5) continue;
        setCell(g, pr, pc, rnd() < 0.3 ? 14 : 1);
        if (pc + 1 < cols - 2 && rnd() < 0.5) setCell(g, pr, pc + 1, 14);
      }
      setCell(g, 2, 2, 25);
      setCell(g, 2, cols - 3, 25);
      setCell(g, rows - 3, 2, 25);
      setCell(g, rows - 3, cols - 3, 25);
      setCell(g, Math.max(2, midR - 3), midC, 22);
      setCell(g, Math.min(rows - 3, midR + 3), midC, 22);
      setCell(g, midR, Math.max(2, midC - 5), 26);
      setCell(g, midR, Math.min(cols - 3, midC + 5), 10);
      for (let i = 0; i < 10; i++) {
        const cr = randInt(2, rows - 3);
        const cc = randInt(2, cols - 3);
        if (getCell(g, cr, cc) === 0) setCell(g, cr, cc, 3);
      }
      return g;
    }

    const roomCols = Math.max(3, Math.floor(cols / 7));
    for (let idx = 1; idx < roomCols; idx++) {
      const wallC = Math.min(cols - 3, idx * Math.floor(cols / roomCols));
      const doorR = randInt(2, rows - 3);
      for (let r = 1; r < rows - 1; r++) {
        if (Math.abs(r - doorR) <= 1) {
          if (idx === roomCols - 1 && r === doorR) setCell(g, r, wallC, 12);
        } else {
          setCell(g, r, wallC, rnd() < 0.18 ? 14 : 1);
        }
      }
    }
    setCell(g, 2, 2, 2);
    setCell(g, 2, 3, 27);
    setCell(g, rows - 3, cols - 3, 7);
    setCell(g, randInt(2, rows - 3), Math.max(3, Math.floor(cols * 0.55)), 11);
    setCell(g, randInt(2, rows - 3), Math.max(4, Math.floor(cols * 0.45)), 10);

    const enemyCount = Math.max(4, Math.floor((rows * cols) / 48));
    for (let i = 0; i < enemyCount; i++) {
      const er = randInt(2, rows - 3);
      const ec = randInt(5, cols - 4);
      if (getCell(g, er, ec) === 0) {
        const roll = rnd();
        setCell(g, er, ec, roll < 0.2 ? 9 : roll < 0.45 ? 24 : 5);
      }
    }
    for (let i = 0; i < enemyCount + 5; i++) {
      const cr = randInt(2, rows - 3);
      const cc = randInt(3, cols - 3);
      if (getCell(g, cr, cc) === 0) setCell(g, cr, cc, rnd() < 0.18 ? 22 : 3);
    }
    return g;
  }

  if (mode === "gravrunner" || mode === "flappy") {
    for (let c = 0; c < cols; c++) {
      setCell(g, 0, c, mode === "flappy" ? 4 : 1);
      setCell(g, rows - 1, c, mode === "flappy" ? 4 : 1);
    }
    setCell(g, Math.floor(rows / 2), 2, 2);
    for (let c = 6; c < cols - 3; c += randInt(4, 6)) {
      if (mode === "flappy") {
        const gapR = randInt(3, rows - 4);
        for (let r = 1; r < rows - 1; r++) {
          if (Math.abs(r - gapR) >= 2) setCell(g, r, c, 1);
          else if (r === gapR) setCell(g, r, c, 3);
        }
      } else {
        const onTop = rnd() < 0.5;
        if (onTop) {
          setCell(g, 1, c, 4);
          if (c + 1 < cols - 2) setCell(g, 1, c + 1, 4);
          setCell(g, rows - 2, c, 3);
        } else {
          setCell(g, rows - 2, c, 4);
          if (c + 1 < cols - 2) setCell(g, rows - 2, c + 1, 4);
          setCell(g, 1, c, 3);
        }
        const mid = Math.floor(rows / 2) + randInt(-2, 2);
        if (rnd() < 0.55) {
          setCell(g, mid, c, 1);
          if (c + 1 < cols - 3) setCell(g, mid, c + 1, 18);
        }
      }
    }
    setCell(g, Math.floor(rows / 2), cols - 2, 7);
    if (mode === "gravrunner") setCell(g, rows - 2, cols - 2, 7);
    return g;
  }

  if (mode === "shooter") {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) setCell(g, r, c, 1);
      }
    }
    setCell(g, Math.floor(rows / 2), 2, 2);
    for (let c = 6; c < cols - 4; c += 5) {
      const rMid = randInt(2, rows - 4);
      setCell(g, rMid, c, 14);
      setCell(g, rMid + 1, c, 22);
      if (rMid - 2 >= 1) setCell(g, rMid - 2, c + 1, 24);
      if (rMid + 2 < rows - 1) setCell(g, rMid + 2, c + 1, rnd() < 0.4 ? 9 : 23);
      setCell(g, randInt(2, rows - 3), c - 1, 3);
    }
    setCell(g, Math.floor(rows / 2), Math.floor(cols / 2), 26);
    setCell(g, Math.floor(rows / 2), cols - 3, 7);
    return g;
  }

  for (let c = 0; c < cols; c++) {
    setCell(g, rows - 1, c, 1);
    if (mode === "metroidvania") {
      setCell(g, 0, c, 1);
      if (c === 0 || c === cols - 1) {
        for (let r = 0; r < rows; r++) setCell(g, r, c, 1);
      }
    }
  }

  setCell(g, rows - 2, 2, 2);
  setCell(g, rows - 2, 4, 27);

  let curR = rows - 4;
  for (let c = 5; c < cols - 4; c += randInt(4, 6)) {
    const span = randInt(3, 5);
    curR = Math.max(3, Math.min(rows - 3, curR + randInt(-2, 2)));
    const tileKind = rnd() < 0.25 ? 13 : rnd() < 0.2 ? 15 : 1;

    for (let dc = 0; dc < span && c + dc < cols - 3; dc++) {
      setCell(g, curR, c + dc, tileKind);
    }

    if (rnd() < 0.45 && curR < rows - 2) {
      setCell(g, rows - 1, c, 4);
      if (c + 1 < cols - 3) setCell(g, rows - 1, c + 1, 4);
    }

    if (curR - 1 >= 1) {
      setCell(g, curR - 1, c, 3);
      const featureRoll = rnd();
      if (featureRoll < 0.24 && c + 1 < cols - 3) setCell(g, curR - 1, c + 1, 5);
      else if (featureRoll < 0.38 && c + 1 < cols - 3) setCell(g, curR - 1, c + 1, 22);
      else if (featureRoll < 0.52 && c + 1 < cols - 3) setCell(g, curR - 1, c + 1, 6);
      else if (featureRoll < 0.64 && c + 1 < cols - 3) setCell(g, curR - 1, c + 1, 24);
      else if (featureRoll < 0.76 && curR - 2 >= 1) setCell(g, curR - 2, c + 1, 23);
    }

    if (rows >= 18) {
      const upperR = randInt(4, Math.max(5, Math.floor(rows / 2) - 2));
      for (let dc = 0; dc < 3 && c + dc < cols - 3; dc++) {
        setCell(g, upperR, c + dc, dc === 1 ? 14 : 13);
      }
      setCell(g, upperR - 1, c + 1, rnd() < 0.3 ? 26 : 3);
      if (rnd() < 0.35) setCell(g, upperR + 2, c, 17);
    }
  }

  const midC = Math.floor(cols / 2);
  setCell(g, rows - 2, midC, 10);
  if (cols >= 20) {
    setCell(g, rows - 2, cols - 6, 20);
    setCell(g, rows - 2, cols - 4, 21);
    setCell(g, rows - 3, cols - 4, 21);
    setCell(g, rows - 4, cols - 4, 1);
    setCell(g, rows - 4, cols - 3, 1);
    setCell(g, rows - 4, cols - 2, 1);
  }
  setCell(g, rows - 2, cols - 5, 9);
  setCell(g, rows - 2, cols - 2, 7);
  return g;
}

export function makeDefaultStudioLevels(preset: GameMode): StudioGameLevel[] {
  const defaultSize: WorldSizePreset =
    preset === "metroidvania"
      ? "mega"
      : preset === "platformer" || preset === "gravrunner"
        ? "wide"
        : "room";
  const dims = WORLD_SIZE_PRESETS[defaultSize];

  if (preset === "platformer") {
    const g1 = generateProceduralLevel("platformer", dims.rows, dims.cols, 11);
    const g2 = generateProceduralLevel("platformer", dims.rows, dims.cols, 97);
    return [
      {
        id: "lvl_1",
        name: "level 1: neon skyline",
        grid: g1,
        worldSize: defaultSize,
        bgColor: "#090d16",
        wallColor: "#3b82f6",
        weather: "starfield",
        winCondition: "portal",
        signText: "welcome! use WASD/arrows, shift to dash, F or click to fire, and flip the yellow laser switch!",
      },
      {
        id: "lvl_2",
        name: "level 2: cyberreactor",
        grid: g2,
        worldSize: defaultSize,
        bgColor: "#0f091c",
        wallColor: "#8b5cf6",
        weather: "embers",
        winCondition: "portal",
        signText: "watch out for plasma turrets & chain-reaction TNT barrels!",
      },
    ];
  }

  return [
    {
      id: "lvl_1",
      name: `level 1: ${preset} sector`,
      grid: generateProceduralLevel(preset, dims.rows, dims.cols, 23),
      worldSize: defaultSize,
      bgColor: "#090d16",
      wallColor: "#3b82f6",
      weather: preset === "survivor" ? "embers" : "starfield",
      winCondition: preset === "survivor" ? "survive_timer" : "portal",
      timeLimitSec: 45,
      signText: "explore the stage, trigger gadgets, and clear your objective!",
    },
    {
      id: "lvl_2",
      name: "level 2: core breach",
      grid: generateProceduralLevel(preset, dims.rows, dims.cols, 89),
      worldSize: defaultSize,
      bgColor: "#0f091c",
      wallColor: "#8b5cf6",
      weather: "matrix",
      winCondition: preset === "survivor" ? "survive_timer" : "portal",
      timeLimitSec: 60,
      signText: "final sector — defeat the cyber boss guardian!",
    },
  ];
}

// ============================================================================
// CRISP PROCEDURAL 2D TILE RENDERER (All 28 Tile Types)
// ============================================================================
export function drawStudioTile2D(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  isPlaying: boolean,
  opts: {
    wallColor: string;
    playerColor: string;
    allKeysTaken: boolean;
    switchesOn: boolean;
    doorsForcedOpen: boolean;
    tick: number;
  }
): void {
  const T = TILE_SIZE;
  if (id === 0) return;

  if (id === 1) {
    // Beveled Neon Wall
    ctx.fillStyle = opts.wallColor;
    ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(x + 2, y + 2, T - 4, 3);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x + 2, y + T - 5, T - 4, 3);
  } else if (id === 13) {
    // One-Way Platform Ledge
    ctx.fillStyle = "#60a5fa";
    ctx.fillRect(x + 1, y + 1, T - 2, 9);
    ctx.fillStyle = "#bfdbfe";
    ctx.fillRect(x + 3, y + 2, T - 6, 2);
    ctx.fillStyle = "rgba(96,165,250,0.3)";
    ctx.fillRect(x + 5, y + 10, 4, 4);
    ctx.fillRect(x + T - 9, y + 10, 4, 4);
  } else if (id === 14) {
    // Breakable Brick Block
    ctx.fillStyle = "#b45309";
    ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(x + 3, y + 3, 13, 12);
    ctx.fillRect(x + 18, y + 3, 13, 12);
    ctx.fillRect(x + 3, y + 18, 8, 12);
    ctx.fillRect(x + 13, y + 18, 18, 12);
  } else if (id === 15) {
    // Ice Block
    ctx.fillStyle = "#0891b2";
    ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.fillStyle = "#67e8f9";
    ctx.fillRect(x + 2, y + 2, T - 4, T - 6);
    ctx.strokeStyle = "#ecfeff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + T - 8);
    ctx.lineTo(x + T - 8, y + 6);
    ctx.stroke();
  } else if (id === 16) {
    // Conveyor Belt
    ctx.fillStyle = "#334155";
    ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.fillStyle = "#fb923c";
    const shift = Math.floor((opts.tick * 0.5) % 10);
    for (let ox = 4 + (shift % 8); ox < T - 6; ox += 10) {
      ctx.fillRect(x + ox, y + 4, 5, T - 8);
    }
    ctx.strokeStyle = "#fdba74";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 2, y + 2, T - 4, T - 4);
  } else if (id === 2 && !isPlaying) {
    ctx.fillStyle = opts.playerColor;
    ctx.fillRect(x + 5, y + 5, 24, 24);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + 18, y + 10, 5, 5);
  } else if (id === 3 && !isPlaying) {
    ctx.fillStyle = "#eab308";
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(x + T / 2 - 2, y + T / 2 - 4, 4, 8);
  } else if (id === 4) {
    // Spikes / Lava
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.moveTo(x + 1, y + T);
    ctx.lineTo(x + T * 0.25, y + 9);
    ctx.lineTo(x + T * 0.5, y + T - 4);
    ctx.lineTo(x + T * 0.75, y + 9);
    ctx.lineTo(x + T - 1, y + T);
    ctx.closePath();
    ctx.fill();
  } else if ((id === 5 || id === 9 || id === 23) && !isPlaying) {
    ctx.fillStyle = id === 9 ? "#ec4899" : id === 23 ? "#e879f9" : "#a855f7";
    if (id === 23) {
      ctx.beginPath();
      ctx.arc(x + T / 2, y + T / 2, 11, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(x + 4, y + 4, 26, 26);
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(x + 9, y + 11, 5, 5);
    ctx.fillRect(x + 20, y + 11, 5, 5);
  } else if (id === 24 && !isPlaying) {
    // Turret preview
    ctx.fillStyle = "#475569";
    ctx.fillRect(x + 6, y + 16, 22, 16);
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.arc(x + T / 2, y + 15, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + T / 2, y + 12, 14, 5);
  } else if (id === 25 && !isPlaying) {
    // Spawner Rift preview
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#7c3aed";
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 6) {
    // Bounce Pad
    ctx.fillStyle = "#0891b2";
    ctx.fillRect(x + 4, y + T - 6, T - 8, 6);
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(x + 2, y + T - 13, T - 4, 7);
  } else if (id === 7) {
    // Swirling Emerald Goal Portal
    const pulse = Math.sin(opts.tick * 0.1) * 2;
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(x + T / 2, y + T / 2, 10 + pulse * 0.4, 14, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(16, 185, 129, 0.38)";
    ctx.fill();
  } else if ((id === 8 || id === 17) && !isPlaying) {
    ctx.fillStyle = id === 17 ? "#818cf8" : "#6366f1";
    ctx.fillRect(x + 1, y + 8, T - 2, 14);
  } else if (id === 18) {
    // Gravity Flip Pad
    ctx.fillStyle = "#9333ea";
    ctx.fillRect(x + 3, y + 4, T - 6, T - 8);
    ctx.fillStyle = "#e9d5ff";
    ctx.beginPath();
    ctx.moveTo(x + T / 2, y + 7);
    ctx.lineTo(x + T - 8, y + 15);
    ctx.lineTo(x + 8, y + 15);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + T / 2, y + T - 7);
    ctx.lineTo(x + T - 8, y + T - 15);
    ctx.lineTo(x + 8, y + T - 15);
    ctx.closePath();
    ctx.fill();
  } else if (id === 19) {
    // Teleporter Pad
    ctx.strokeStyle = "#2dd4bf";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(45, 212, 191, 0.35)";
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 20) {
    // Laser Switch
    ctx.fillStyle = "#475569";
    ctx.fillRect(x + 6, y + T - 8, T - 12, 8);
    ctx.fillStyle = opts.switchesOn ? "#4ade80" : "#facc15";
    ctx.fillRect(opts.switchesOn ? x + 18 : x + 9, y + 10, 7, 16);
  } else if (id === 21) {
    // Switch Door
    const isOpen = isPlaying && (opts.switchesOn || opts.doorsForcedOpen);
    if (!isOpen) {
      ctx.fillStyle = "rgba(244, 63, 94, 0.25)";
      ctx.fillRect(x + 4, y, T - 8, T);
      ctx.fillStyle = "#fb7185";
      ctx.fillRect(x + 9, y, 4, T);
      ctx.fillRect(x + T - 13, y, 4, T);
    } else {
      ctx.strokeStyle = "rgba(74, 222, 128, 0.32)";
      ctx.strokeRect(x + 6, y + 2, T - 12, T - 4);
    }
  } else if (id === 22 && !isPlaying) {
    // TNT Barrel preview
    ctx.fillStyle = "#ea580c";
    ctx.fillRect(x + 5, y + 3, T - 10, T - 6);
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(x + 5, y + 13, T - 10, 8);
  } else if (id === 10 && !isPlaying) {
    ctx.fillStyle = "#f43f5e";
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 9, 0, Math.PI * 2);
    ctx.fill();
  } else if (id === 11 && !isPlaying) {
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(x + 9, y + 9, 16, 16);
  } else if (id === 12) {
    const unlocked = isPlaying && (opts.allKeysTaken || opts.doorsForcedOpen);
    if (!unlocked) {
      ctx.fillStyle = "#64748b";
      ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(x + 12, y + 12, 10, 10);
    }
  } else if (id === 26 && !isPlaying) {
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(x + T / 2, y + T / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e0f2fe";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (id === 27) {
    // NPC / Signpost
    ctx.fillStyle = "#92400e";
    ctx.fillRect(x + 15, y + 16, 4, 18);
    ctx.fillStyle = "#fde047";
    ctx.fillRect(x + 5, y + 5, 24, 13);
    ctx.fillStyle = "#422006";
    ctx.fillRect(x + 9, y + 9, 16, 2);
    ctx.fillRect(x + 9, y + 13, 11, 2);
  }
}

// ============================================================================
// STANDALONE FULL-TAB HTML5 EXPORT (Supports Scrolling Worlds, 3D, Weapons, Rules)
// ============================================================================
function escapeHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildAdvancedStandaloneGameHtml(project: StudioGameProject): string {
  const serialized = JSON.stringify(project).replace(/</g, "\\u003c");
  const safeTitle = escapeHtml(project.title);
  const safeCreator = escapeHtml(project.studioName || project.author);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${safeTitle} — ${safeCreator}</title>
<style>
  body { margin: 0; background: #060912; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; overflow: hidden; user-select: none; }
  .hud { display: flex; gap: 16px; align-items: center; margin-bottom: 10px; font-size: 13px; background: rgba(15,23,42,0.85); padding: 8px 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); flex-wrap: wrap; justify-content: center; }
  canvas { border-radius: 12px; border: 2px solid rgba(255,255,255,0.16); box-shadow: 0 22px 60px rgba(0,0,0,0.75); cursor: crosshair; max-width: 96vw; max-height: 78vh; }
  .hint { margin-top: 10px; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="hud">
    <strong>${safeTitle}</strong>
    <span id="lvl">level 1</span>
    <span id="hp">hp: 3</span>
    <span id="score">score: 0</span>
    <span id="goal">goal: reach portal</span>
    <span id="status">playing</span>
  </div>
  <canvas id="c" width="680" height="408"></canvas>
  <div class="hint">WASD / Arrows move · SPACE jump / flip · SHIFT dash · F or Click attack · R restart</div>
<script>
const P = ${serialized};
const levels = Array.isArray(P.levels) && P.levels.length > 0 ? P.levels : [{ name: "level 1", grid: P.grid }];
const T = 34, VW = 680, VH = 408;
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const keys = {};
let mouseX = VW / 2, mouseY = VH / 2, mouseDown = false, lookDelta = 0;
window.addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "KeyR") reset(curLvl, 0); });
window.addEventListener("keyup", e => { keys[e.code] = false; });
canvas.addEventListener("mousemove", e => {
  const r = canvas.getBoundingClientRect();
  mouseX = (e.clientX - r.left) * (VW / r.width);
  mouseY = (e.clientY - r.top) * (VH / r.height);
  if (document.pointerLockElement === canvas || e.buttons === 1) lookDelta += e.movementX || 0;
});
canvas.addEventListener("mousedown", () => {
  mouseDown = true;
  if (P.mode === "fps3d" && canvas.requestPointerLock) canvas.requestPointerLock();
});
window.addEventListener("mouseup", () => { mouseDown = false; });

let curLvl = 0, score = 0, state = "playing", tick = 0, camX = 0, camY = 0;
let grid = [], ROWS = 12, COLS = 20;
let player, coins, keysList, checkpoints, platforms, enemies, bullets, eBullets, tnts, powerups, spawners, teleporters;
let switchesOn = false, doorsForcedOpen = false, gravDir = 1, gravScale = 1, timerFrames = 0, banner = "", bannerFrames = 0, firedRules = {};

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function reset(idx, carry) {
  curLvl = Math.max(0, Math.min(levels.length - 1, idx));
  score = carry || 0; state = "playing"; tick = 0;
  switchesOn = false; doorsForcedOpen = false; gravDir = 1; gravScale = 1; firedRules = {};
  const src = levels[curLvl].grid || P.grid;
  grid = src.map(r => r.slice());
  ROWS = grid.length || 12; COLS = (grid[0] && grid[0].length) || 20;
  coins = []; keysList = []; checkpoints = []; platforms = []; enemies = [];
  bullets = []; eBullets = []; tnts = []; powerups = []; spawners = []; teleporters = [];
  let sx = 68, sy = 160;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const id = grid[r][c] || 0;
    if (id === 2) { sx = c * T + 5; sy = r * T + 5; }
    else if (id === 3) coins.push({ x: c*T+9, y: r*T+9, w: 16, h: 16, taken: false });
    else if (id === 11) keysList.push({ x: c*T+7, y: r*T+7, w: 20, h: 20, taken: false });
    else if (id === 10) checkpoints.push({ x: c*T+6, y: r*T+6, w: 22, h: 22, used: false });
    else if (id === 8 || id === 17) platforms.push({ r, c, x: c*T, y: r*T, w: T, h: 14, vx: id === 8 ? 1.5 : 0, vy: id === 17 ? 1.3 : 0, vert: id === 17 });
    else if (id === 5 || id === 9 || id === 23 || id === 24) {
      enemies.push({ x: c*T+4, y: r*T+4, baseY: r*T+4, w: id === 9 ? 28 : 24, h: id === 9 ? 28 : 24, vx: id === 24 ? 0 : (id === 9 ? 2 : 1.5), hp: id === 9 ? 4 : id === 24 ? 2 : 1, maxHp: id === 9 ? 4 : 1, kind: id, cd: 55, alive: true });
    } else if (id === 22) tnts.push({ r, c, x: c*T+3, y: r*T+3, w: 28, h: 28, intact: true });
    else if (id === 25) spawners.push({ x: c*T+3, y: r*T+3, w: 28, h: 28, hp: 3, cd: 120, alive: true });
    else if (id === 26) powerups.push({ x: c*T+7, y: r*T+7, w: 20, h: 20, taken: false });
    else if (id === 19) teleporters.push({ x: c*T, y: r*T, w: T, h: T });
  }
  const lim = (levels[curLvl].timeLimitSec || P.timeLimitSec || 45);
  timerFrames = lim * 60;
  player = { x: sx, y: sy, vx: 0, vy: 0, w: 22, h: 22, angle: 0, facing: 1, grounded: false, jumps: P.enableDoubleJump ? 2 : 1, jLock: false, dashCd: 0, dashF: 0, shootCd: 0, hp: P.maxHp || 3, invuln: 0, overF: 0, tpCd: 0, fuel: 100, cpX: sx, cpY: sy };
  banner = levels[curLvl].name || ("level " + (curLvl + 1)); bannerFrames = 90;
  runRules("on_start");
}

function runRules(trig) {
  const rules = Array.isArray(P.rules) ? P.rules : [];
  for (const rl of rules) {
    if (rl.when !== trig) continue;
    if (trig !== "on_every_10s" && trig !== "on_switch_on" && firedRules[rl.id]) continue;
    firedRules[rl.id] = true;
    if (rl.action === "open_doors") { doorsForcedOpen = true; switchesOn = true; }
    else if (rl.action === "win_level") advanceOrWin();
    else if (rl.action === "low_gravity") gravScale = 0.45;
    else if (rl.action === "flip_gravity") gravDir *= -1;
    else if (rl.action === "grant_shield") player.invuln = 360;
    else if (rl.action === "heal_player") player.hp = Math.min((P.maxHp || 3) + 2, player.hp + 2);
    else if (rl.action === "overdrive_weapon") player.overF = 480;
    else if (rl.action === "shatter_bricks") { for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (grid[r][c]===14) grid[r][c]=0; }
    else if (rl.action === "spawn_boss") enemies.push({ x: Math.min((COLS-2)*T, player.x + 150), y: Math.max(T, player.y - 30), baseY: player.y, w: 28, h: 28, vx: 2, hp: 4, maxHp: 4, kind: 9, cd: 50, alive: true });
    if (rl.text || rl.action === "announce") { banner = rl.text || "event triggered!"; bannerFrames = 120; }
  }
}

function explodeAt(cx, cy) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (grid[r][c] === 14 && Math.hypot(c*T+17 - cx, r*T+17 - cy) < 88) grid[r][c] = 0;
  }
  for (const en of enemies) if (en.alive && Math.hypot(en.x+12 - cx, en.y+12 - cy) < 92) {
    en.hp -= 3; if (en.hp <= 0) { en.alive = false; score += 35; }
  }
  for (const t of tnts) if (t.intact && Math.hypot(t.x+14 - cx, t.y+14 - cy) < 88) {
    t.intact = false; explodeAt(t.x + 14, t.y + 14);
  }
}

function advanceOrWin() {
  if (curLvl + 1 < levels.length) reset(curLvl + 1, score + 50);
  else state = "won";
}

function hurtPlayer() {
  if (player.invuln > 0) return;
  player.hp--;
  if (player.hp === 1) runRules("on_low_hp");
  if (player.hp <= 0) state = "lost";
  else { player.invuln = 65; player.x = player.cpX; player.y = player.cpY; player.vx = 0; player.vy = 0; }
}

function isSolid(r, c) {
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
  const id = grid[r][c];
  if (id === 1 || id === 14 || id === 15 || id === 16) return true;
  if (id === 12 && !doorsForcedOpen && !keysList.every(k => k.taken)) return true;
  if (id === 21 && !doorsForcedOpen && !switchesOn) return true;
  return false;
}

reset(0, 0);

function loop() {
  tick++;
  const lvl = levels[curLvl];
  const winCond = lvl.winCondition || P.winCondition || "portal";
  const wpn = P.weaponType || (P.enableBlaster === false ? "none" : "blaster");

  if (state === "playing") {
    if (player.invuln > 0) player.invuln--;
    if (player.dashCd > 0) player.dashCd--;
    if (player.shootCd > 0) player.shootCd--;
    if (player.overF > 0) player.overF--;
    if (player.tpCd > 0) player.tpCd--;
    if (bannerFrames > 0) bannerFrames--;
    if (tick % 600 === 0) runRules("on_every_10s");

    if (P.mode === "survivor" && tick % 150 === 0 && enemies.filter(e => e.alive).length < 18) {
      const ang = Math.random() * Math.PI * 2;
      const sx = Math.max(T*1.5, Math.min((COLS-2.5)*T, player.x + Math.cos(ang) * 230));
      const sy = Math.max(T*1.5, Math.min((ROWS-2.5)*T, player.y + Math.sin(ang) * 180));
      enemies.push({ x: sx, y: sy, baseY: sy, w: 24, h: 24, vx: 1.5, hp: 1, maxHp: 1, kind: 9, cd: 60, alive: true });
    }

    const left = keys["ArrowLeft"] || keys["KeyA"];
    const right = keys["ArrowRight"] || keys["KeyD"];
    const up = keys["ArrowUp"] || keys["KeyW"] || keys["Space"];
    const down = keys["ArrowDown"] || keys["KeyS"];
    const spd = P.moveSpeed * (player.overF > 0 ? 1.25 : 1);

    if (P.mode === "fps3d") {
      if (keys["ArrowLeft"]) player.angle -= 0.055;
      if (keys["ArrowRight"]) player.angle += 0.055;
      if (lookDelta) { player.angle += lookDelta * 0.0045; lookDelta = 0; }
      let dx = 0, dy = 0;
      if (keys["KeyW"] || keys["ArrowUp"]) { dx += Math.cos(player.angle)*spd*0.65; dy += Math.sin(player.angle)*spd*0.65; }
      if (keys["KeyS"] || keys["ArrowDown"]) { dx -= Math.cos(player.angle)*spd*0.65; dy -= Math.sin(player.angle)*spd*0.65; }
      if (keys["KeyA"]) { dx += Math.cos(player.angle - 1.57)*spd*0.5; dy += Math.sin(player.angle - 1.57)*spd*0.5; }
      if (keys["KeyD"]) { dx += Math.cos(player.angle + 1.57)*spd*0.5; dy += Math.sin(player.angle + 1.57)*spd*0.5; }
      const cr = Math.floor((player.y+11)/T), cc = Math.floor((player.x+11)/T);
      if (!isSolid(cr, Math.floor((player.x+dx+11+(dx>0?8:-8))/T))) player.x += dx;
      if (!isSolid(Math.floor((player.y+dy+11+(dy>0?8:-8))/T), cc)) player.y += dy;
      if ((keys["Space"] || mouseDown) && player.shootCd <= 0) {
        player.shootCd = 14;
        for (const en of enemies) {
          if (!en.alive) continue;
          let da = Math.atan2(en.y+12-(player.y+11), en.x+12-(player.x+11)) - player.angle;
          while (da < -Math.PI) da += Math.PI*2; while (da > Math.PI) da -= Math.PI*2;
          if (Math.abs(da) < 0.24) { en.hp--; if (en.hp <= 0) { en.alive = false; score += 30; } break; }
        }
      }
    } else {
      if (right) player.facing = 1; else if (left) player.facing = -1;
      if (P.enableDash && (keys["ShiftLeft"] || keys["ShiftRight"]) && player.dashCd <= 0) {
        player.dashF = 7; player.dashCd = 40; player.invuln = Math.max(player.invuln, 8);
      }
      const isTop = P.mode === "topdown" || P.mode === "shooter" || P.mode === "survivor";
      if (isTop) {
        player.vx = (right ? spd : 0) - (left ? spd : 0);
        player.vy = (down ? spd : 0) - ((keys["ArrowUp"] || keys["KeyW"]) ? spd : 0);
        if (player.dashF > 0) { player.vx *= 2.4; player.vy *= 2.4; player.dashF--; }
      } else if (P.mode === "gravrunner") {
        player.vx = spd * 0.85;
        if (up && !player.jLock && player.grounded) { gravDir *= -1; player.grounded = false; player.jLock = true; }
        if (!up) player.jLock = false;
        player.vy += (P.gravity || 0.55) * gravDir * gravScale;
      } else if (P.mode === "flappy") {
        player.vx = spd * 0.65;
        if (up && !player.jLock) { player.vy = -P.jumpForce; player.jLock = true; }
        if (!up) player.jLock = false;
        player.vy += P.gravity * gravScale;
      } else {
        const targetVx = (right ? spd : 0) - (left ? spd : 0);
        player.vx = player.dashF > 0 ? player.facing * spd * 2.5 : targetVx;
        if (player.dashF > 0) player.dashF--;
        if (up && !player.jLock && player.jumps > 0) {
          player.vy = -P.jumpForce * gravDir; player.grounded = false; player.jumps--; player.jLock = true;
        } else if (P.enableJetpack && up && player.fuel > 0) {
          player.vy -= 0.85 * gravDir; player.fuel = Math.max(0, player.fuel - 1.5);
        }
        if (!up) player.jLock = false;
        player.vy += P.gravity * gravDir * gravScale;
      }

      const fireHeld = keys["KeyF"] || mouseDown || P.autoFire || ((P.mode === "shooter" || P.mode === "survivor") && keys["Space"]);
      if (wpn !== "none" && fireHeld && player.shootCd <= 0) {
        let ang = player.facing > 0 ? 0 : Math.PI;
        if (P.mouseAim || isTop) ang = Math.atan2((mouseY + camY) - (player.y + 11), (mouseX + camX) - (player.x + 11));
        const cdMult = player.overF > 0 ? 0.45 : 1;
        if (wpn === "shotgun") {
          for (const off of [-0.22, 0, 0.22]) bullets.push({ x: player.x+11, y: player.y+11, w: 9, h: 9, vx: Math.cos(ang+off)*9, vy: Math.sin(ang+off)*9, kind: wpn, life: 42 });
          player.shootCd = Math.round(24 * cdMult);
        } else if (wpn === "laser") {
          bullets.push({ x: player.x+11, y: player.y+11, w: 14, h: 6, vx: Math.cos(ang)*15, vy: Math.sin(ang)*15, kind: wpn, pierce: true, life: 50 });
          player.shootCd = Math.round(18 * cdMult);
        } else if (wpn === "boomerang") {
          bullets.push({ x: player.x+11, y: player.y+11, w: 14, h: 14, vx: Math.cos(ang)*9, vy: Math.sin(ang)*9, kind: wpn, pierce: true, life: 75 });
          player.shootCd = Math.round(22 * cdMult);
        } else if (wpn === "grenade") {
          bullets.push({ x: player.x+11, y: player.y+8, w: 12, h: 12, vx: Math.cos(ang)*7.5, vy: Math.sin(ang)*7.5 - (isTop ? 0 : 3.5), kind: wpn, life: 65 });
          player.shootCd = Math.round(26 * cdMult);
        } else if (wpn === "sword") {
          bullets.push({ x: player.x+11+Math.cos(ang)*20-16, y: player.y+11+Math.sin(ang)*20-16, w: 32, h: 32, vx: 0, vy: 0, kind: wpn, pierce: true, life: 8 });
          for (const eb of eBullets) if (Math.hypot(eb.x - player.x, eb.y - player.y) < 46) eb.dead = true;
          player.shootCd = Math.round(14 * cdMult);
        } else {
          bullets.push({ x: player.x+11, y: player.y+11, w: 10, h: 6, vx: Math.cos(ang)*10, vy: Math.sin(ang)*10, kind: "blaster", life: 65 });
          player.shootCd = Math.round(13 * cdMult);
        }
      }

      for (const mp of platforms) {
        if (mp.vert) {
          mp.y += mp.vy;
          const nr = Math.floor((mp.y + (mp.vy > 0 ? mp.h : 0)) / T);
          if (nr <= 0 || nr >= ROWS - 1 || isSolid(nr, mp.c)) mp.vy *= -1;
        } else {
          mp.x += mp.vx;
          const nc = Math.floor((mp.x + (mp.vx > 0 ? mp.w : 0)) / T);
          if (nc < 0 || nc >= COLS || isSolid(mp.r, nc)) mp.vx *= -1;
        }
      }

      player.x += player.vx;
      player.x = Math.max(0, Math.min(COLS*T - player.w, player.x));
      let hitWallX = 0;
      for (let r = Math.max(0, Math.floor(player.y/T)-1); r <= Math.min(ROWS-1, Math.floor((player.y+player.h)/T)+1); r++) {
        for (let c = Math.max(0, Math.floor(player.x/T)-1); c <= Math.min(COLS-1, Math.floor((player.x+player.w)/T)+1); c++) {
          if (isSolid(r, c) && overlap(player, { x: c*T, y: r*T, w: T, h: T })) {
            if (player.dashF > 0 && grid[r][c] === 14) { grid[r][c] = 0; continue; }
            if (player.vx > 0) { player.x = c*T - player.w; hitWallX = 1; }
            else if (player.vx < 0) { player.x = (c+1)*T; hitWallX = -1; }
          }
        }
      }
      if (P.enableWallJump && hitWallX !== 0 && !player.grounded && player.vy * gravDir > 1.5) {
        player.vy = 1.5 * gravDir;
        player.jumps = Math.max(player.jumps, 1);
      }

      const prevY = player.y;
      player.y += player.vy;
      player.grounded = false;
      if (player.y > ROWS*T + 20 || player.y < -40) hurtPlayer();

      for (const mp of platforms) {
        if (overlap(player, mp) && player.vy * gravDir >= 0 && prevY + player.h <= mp.y + 12) {
          player.y = mp.y - player.h; player.vy = 0; player.x += mp.vx; player.grounded = true;
          player.jumps = P.enableDoubleJump ? 2 : 1; player.fuel = 100;
        }
      }

      for (let r = Math.max(0, Math.floor(player.y/T)-1); r <= Math.min(ROWS-1, Math.floor((player.y+player.h)/T)+1); r++) {
        for (let c = Math.max(0, Math.floor(player.x/T)-1); c <= Math.min(COLS-1, Math.floor((player.x+player.w)/T)+1); c++) {
          const id = grid[r][c];
          const box = { x: c*T, y: r*T, w: T, h: T };
          if (!overlap(player, box)) continue;
          if (isSolid(r, c)) {
            if (player.vy * gravDir > 0) {
              player.y = gravDir > 0 ? r*T - player.h : (r+1)*T;
              player.vy = 0; player.grounded = true; player.jumps = P.enableDoubleJump ? 2 : 1; player.fuel = 100;
              if (id === 16) player.x += 2.4;
            } else if (player.vy * gravDir < 0) {
              player.y = gravDir > 0 ? (r+1)*T : r*T - player.h; player.vy = 0;
            }
          } else if (id === 13 && gravDir > 0 && player.vy >= 0 && prevY + player.h <= r*T + 10) {
            player.y = r*T - player.h; player.vy = 0; player.grounded = true; player.jumps = P.enableDoubleJump ? 2 : 1; player.fuel = 100;
          } else if (id === 4) hurtPlayer();
          else if (id === 6) { player.vy = -P.jumpForce * 1.38 * gravDir; player.grounded = false; }
          else if (id === 18 && !player.jLock) { gravDir *= -1; player.vy = 2 * gravDir; player.jLock = true; }
          else if (id === 19 && player.tpCd <= 0 && teleporters.length > 1) {
            const others = teleporters.filter(tp => Math.hypot(tp.x - box.x, tp.y - box.y) > 20);
            if (others.length) { const dst = others[0]; player.x = dst.x + 5; player.y = dst.y + 5; player.tpCd = 55; }
          } else if (id === 20 && player.tpCd <= 0) {
            switchesOn = !switchesOn; player.tpCd = 30; if (switchesOn) runRules("on_switch_on");
          } else if (id === 7 && winCond === "portal") advanceOrWin();
        }
      }
    }

    for (const co of coins) if (!co.taken && overlap(player, co)) {
      co.taken = true; score += 10;
      if (score >= 50) runRules("on_score_50");
      if (score >= 150) runRules("on_score_150");
      if (coins.every(x => x.taken)) { runRules("on_all_coins"); if (winCond === "all_coins") advanceOrWin(); }
    }
    for (const k of keysList) if (!k.taken && overlap(player, k)) { k.taken = true; score += 20; }
    for (const cp of checkpoints) if (!cp.used && overlap(player, cp)) { cp.used = true; player.cpX = cp.x; player.cpY = cp.y; player.hp = Math.min(P.maxHp||3, player.hp+1); }
    for (const pu of powerups) if (!pu.taken && overlap(player, pu)) { pu.taken = true; player.overF = 420; player.invuln = 240; score += 25; }

    for (const sp of spawners) {
      if (!sp.alive) continue;
      sp.cd--;
      if (sp.cd <= 0 && enemies.filter(e => e.alive).length < 18) {
        sp.cd = 170;
        enemies.push({ x: sp.x, y: sp.y, baseY: sp.y, w: 24, h: 24, vx: 1.6, hp: 1, maxHp: 1, kind: 5, cd: 60, alive: true });
      }
    }

    for (const b of bullets) {
      if (b.dead) continue;
      if (b.kind === "boomerang" && b.life < 42) {
        const a = Math.atan2(player.y+11 - b.y, player.x+11 - b.x);
        b.vx = Math.cos(a)*9.5; b.vy = Math.sin(a)*9.5;
      } else if (b.kind === "grenade" && P.mode !== "topdown" && P.mode !== "shooter" && P.mode !== "survivor") {
        b.vy += 0.28;
      }
      b.x += b.vx; b.y += b.vy; b.life--;
      const br = Math.floor(b.y/T), bc = Math.floor(b.x/T);
      if (br >= 0 && br < ROWS && bc >= 0 && bc < COLS && grid[br][bc] === 14) {
        grid[br][bc] = 0; if (!b.pierce) b.dead = true;
      } else if (b.kind !== "sword" && b.kind !== "boomerang" && isSolid(br, bc)) {
        if (b.kind === "grenade") explodeAt(b.x, b.y);
        b.dead = true;
      }
      for (const t of tnts) if (t.intact && overlap(b, t)) { t.intact = false; explodeAt(t.x+14, t.y+14); b.dead = true; }
      for (const sp of spawners) if (sp.alive && overlap(b, sp)) { sp.hp--; if (sp.hp <= 0) { sp.alive = false; score += 50; } if (!b.pierce) b.dead = true; }
      for (const en of enemies) if (en.alive && overlap(b, en)) {
        en.hp--; if (b.kind === "grenade") explodeAt(b.x, b.y);
        if (!b.pierce) b.dead = true;
        if (en.hp <= 0) {
          en.alive = false; score += en.kind === 9 ? 75 : 25;
          if (en.kind === 9) runRules("on_boss_defeated");
          if (enemies.every(x => !x.alive) && spawners.every(s => !s.alive)) {
            runRules("on_all_enemies");
            if (winCond === "all_enemies") advanceOrWin();
          }
        }
      }
      if (b.life <= 0) { if (b.kind === "grenade") explodeAt(b.x, b.y); b.dead = true; }
    }
    bullets = bullets.filter(b => !b.dead);

    for (const eb of eBullets) {
      eb.x += eb.vx; eb.y += eb.vy; eb.life--;
      if (overlap(eb, player)) { eb.dead = true; hurtPlayer(); }
      if (eb.life <= 0 || isSolid(Math.floor(eb.y/T), Math.floor(eb.x/T))) eb.dead = true;
    }
    eBullets = eBullets.filter(e => !e.dead);

    for (const en of enemies) {
      if (!en.alive) continue;
      if (en.kind === 24) {
        en.cd--;
        if (en.cd <= 0 && Math.hypot(player.x - en.x, player.y - en.y) < 340) {
          en.cd = 85;
          const a = Math.atan2(player.y - en.y, player.x - en.x);
          eBullets.push({ x: en.x+12, y: en.y+12, w: 8, h: 8, vx: Math.cos(a)*4.2, vy: Math.sin(a)*4.2, life: 95 });
        }
      } else if (en.kind === 23) {
        en.x += en.vx; en.y = en.baseY + Math.sin(tick * 0.08 + en.x * 0.02) * 26;
        const nc = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / T);
        if (nc < 0 || nc >= COLS || isSolid(Math.floor(en.y/T), nc)) en.vx *= -1;
      } else if (en.kind === 9 && (P.mode === "fps3d" || P.mode === "topdown" || P.mode === "shooter" || P.mode === "survivor")) {
        const a = Math.atan2(player.y - en.y, player.x - en.x);
        en.x += Math.cos(a)*1.35; en.y += Math.sin(a)*1.35;
      } else {
        en.x += en.vx;
        const nc = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / T);
        if (nc < 0 || nc >= COLS || isSolid(Math.floor((en.y+12)/T), nc)) en.vx *= -1;
      }
      if (overlap(player, en)) {
        if (P.mode === "platformer" && player.vy > 1 && player.y + player.h - player.vy <= en.y + 14) {
          en.hp--; player.vy = -P.jumpForce * 0.8; if (en.hp <= 0) { en.alive = false; score += 25; }
        } else hurtPlayer();
      }
    }

    if (winCond === "survive_timer") {
      timerFrames--;
      if (timerFrames <= 0) advanceOrWin();
    }
  }

  camX += (Math.max(0, Math.min(COLS*T - VW, player.x - VW/2)) - camX) * 0.14;
  camY += (Math.max(0, Math.min(ROWS*T - VH, player.y - VH/2)) - camY) * 0.14;

  document.getElementById("lvl").textContent = lvl.name || ("level " + (curLvl + 1));
  document.getElementById("hp").textContent = "hp: " + player.hp;
  document.getElementById("score").textContent = "score: " + score;
  document.getElementById("goal").textContent = winCond === "survive_timer" ? ("survive: " + Math.ceil(timerFrames/60) + "s") : ("goal: " + winCond.replace("_", " "));
  document.getElementById("status").textContent = state === "won" ? "VICTORY! (R)" : state === "lost" ? "GAME OVER (R)" : "playing";

  const bg = lvl.bgColor || P.bgColor || "#090d16";
  const wall = lvl.wallColor || P.wallColor || "#3b82f6";

  if (P.mode === "fps3d") {
    ctx.fillStyle = "#030712"; ctx.fillRect(0, 0, VW, VH/2);
    ctx.fillStyle = "#111827"; ctx.fillRect(0, VH/2, VW, VH/2);
    const px = (player.x+11)/T, py = (player.y+11)/T, fov = Math.PI/3, rays = 170;
    for (let i = 0; i < rays; i++) {
      const ra = player.angle - fov/2 + (i/rays)*fov;
      let rx = px, ry = py, d = 0;
      while (d < 24) {
        rx += Math.cos(ra)*0.035; ry += Math.sin(ra)*0.035; d += 0.035;
        if (isSolid(Math.floor(ry), Math.floor(rx))) break;
      }
      const pd = Math.max(0.15, d * Math.cos(ra - player.angle));
      const wh = Math.min(VH*1.4, (VH*0.92)/pd);
      ctx.globalAlpha = Math.max(0.2, 1 - pd/18);
      ctx.fillStyle = wall;
      ctx.fillRect(i*(VW/rays), (VH-wh)/2, VW/rays + 1, wh);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, VW, VH);
    ctx.save(); ctx.translate(-Math.round(camX), -Math.round(camY));
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const id = grid[r][c], x = c*T, y = r*T;
      if (id === 1) { ctx.fillStyle = wall; ctx.fillRect(x+1, y+1, T-2, T-2); }
      else if (id === 13) { ctx.fillStyle = "#60a5fa"; ctx.fillRect(x+1, y+1, T-2, 9); }
      else if (id === 14) { ctx.fillStyle = "#d97706"; ctx.fillRect(x+1, y+1, T-2, T-2); }
      else if (id === 15) { ctx.fillStyle = "#67e8f9"; ctx.fillRect(x+1, y+1, T-2, T-2); }
      else if (id === 16) { ctx.fillStyle = "#fb923c"; ctx.fillRect(x+1, y+1, T-2, T-2); }
      else if (id === 4) { ctx.fillStyle = "#ef4444"; ctx.fillRect(x+2, y+12, T-4, T-12); }
      else if (id === 6) { ctx.fillStyle = "#06b6d4"; ctx.fillRect(x+2, y+20, T-4, 14); }
      else if (id === 7) { ctx.strokeStyle = "#10b981"; ctx.lineWidth = 3; ctx.strokeRect(x+7, y+4, 20, 26); }
      else if (id === 18) { ctx.fillStyle = "#a855f7"; ctx.fillRect(x+4, y+4, T-8, T-8); }
      else if (id === 19) { ctx.strokeStyle = "#2dd4bf"; ctx.strokeRect(x+6, y+6, T-12, T-12); }
      else if (id === 20) { ctx.fillStyle = switchesOn ? "#4ade80" : "#facc15"; ctx.fillRect(x+9, y+10, 16, 20); }
      else if (id === 21 && !switchesOn && !doorsForcedOpen) { ctx.fillStyle = "#fb7185"; ctx.fillRect(x+8, y, 18, T); }
      else if (id === 12 && !doorsForcedOpen && !keysList.every(k => k.taken)) { ctx.fillStyle = "#64748b"; ctx.fillRect(x+2, y+2, T-4, T-4); }
      else if (id === 27) { ctx.fillStyle = "#fde047"; ctx.fillRect(x+5, y+5, 24, 14); }
    }
    ctx.fillStyle = "#6366f1"; for (const mp of platforms) ctx.fillRect(mp.x, mp.y, mp.w, mp.h);
    ctx.fillStyle = "#eab308"; for (const co of coins) if (!co.taken) { ctx.beginPath(); ctx.arc(co.x+8, co.y+8, 7, 0, Math.PI*2); ctx.fill(); }
    ctx.fillStyle = "#f59e0b"; for (const k of keysList) if (!k.taken) ctx.fillRect(k.x, k.y, k.w, k.h);
    ctx.fillStyle = "#f97316"; for (const t of tnts) if (t.intact) ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = "#7c3aed"; for (const sp of spawners) if (sp.alive) ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
    ctx.fillStyle = "#38bdf8"; for (const pu of powerups) if (!pu.taken) { ctx.beginPath(); ctx.arc(pu.x+10, pu.y+10, 9, 0, Math.PI*2); ctx.fill(); }
    for (const en of enemies) if (en.alive) {
      ctx.fillStyle = en.kind === 9 ? "#ec4899" : en.kind === 24 ? "#f43f5e" : "#a855f7";
      ctx.fillRect(en.x, en.y, en.w, en.h);
    }
    ctx.fillStyle = "#38bdf8"; for (const b of bullets) ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "#fb7185"; for (const eb of eBullets) { ctx.beginPath(); ctx.arc(eb.x+4, eb.y+4, 5, 0, Math.PI*2); ctx.fill(); }
    if (player.invuln % 4 < 2) { ctx.fillStyle = P.playerColor || "#22c55e"; ctx.fillRect(player.x, player.y, player.w, player.h); }
    ctx.restore();
  }

  if (bannerFrames > 0) {
    ctx.fillStyle = "rgba(9,13,22,0.84)"; ctx.fillRect(VW/2 - 180, 12, 360, 30);
    ctx.fillStyle = "#38bdf8"; ctx.font = "bold 13px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(banner, VW/2, 32);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script>
</body>
</html>`;
}
