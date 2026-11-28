import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import { showHomeView, store } from "../state/store.ts";
import { moderateChatMessage } from "../core/contentFilter.ts";
import { awardGamePassXp } from "../core/gamePass.ts";
import {
  getCookieCoins,
  addCookieCoins,
  spendCookieCoins,
  getUserStudio,
  saveUserStudio,
  recordGameActivity,
  type StudioProfile,
} from "../core/cookieCoins.ts";
import {
  isChromebookModeEnabled,
  setGameSourceActive,
  teardownIframeElement,
  useChromebookMode,
} from "../core/chromebookMode.ts";
import {
  type GameMode,
  type WorldSizePreset,
  type WeaponType,
  type WinConditionType,
  type WeatherType,
  type PaintToolMode,
  type BrushCategory,
  type RuleTriggerType,
  type RuleActionType,
  type StudioLogicRule,
  type StudioGameLevel,
  type StudioGameProject,
  VIEWPORT_COLS,
  VIEWPORT_ROWS,
  TILE_SIZE,
  WORLD_SIZE_PRESETS,
  ENGINE_MODES,
  STUDIO_BRUSHES,
  WEAPON_OPTIONS,
  RULE_TRIGGERS,
  RULE_ACTIONS,
  playStudioSfx,
  getGridDimensions,
  inferWorldSizePreset,
  createSizedEmptyGrid,
  resizeLevelGrid,
  applyRectPaint,
  applyLinePaint,
  applyFloodFill,
  generateProceduralLevel,
  makeDefaultStudioLevels,
  drawStudioTile2D,
  buildAdvancedStandaloneGameHtml,
} from "../core/studioEngineCore.ts";

export type { GameMode, StudioGameLevel, StudioGameProject };

export interface CloudSyncPlayerProgress {
  username: string;
  cloudSynced: boolean;
  currentLevel: number;
  highestLevel: number;
  bestScore: number;
  totalCoinsCollected: number;
  deaths: number;
  completions: number;
  lastUpdated: string;
}

const CUSTOM_HTML_UPLOAD_COST = 1000;
const CANVAS_W = VIEWPORT_COLS * TILE_SIZE; // 680
const CANVAS_H = VIEWPORT_ROWS * TILE_SIZE; // 408

const STUDIO_ICONS = [
  "fa-rocket",
  "fa-dragon",
  "fa-bolt",
  "fa-crown",
  "fa-gamepad",
  "fa-fire",
  "fa-wand-magic-sparkles",
  "fa-ghost",
];

const THEME_PALETTES = [
  { name: "cyberpunk", bg: "#090d16", wall: "#3b82f6", hero: "#22c55e" },
  { name: "matrix", bg: "#04120b", wall: "#10b981", hero: "#bef264" },
  { name: "volcanic", bg: "#170808", wall: "#ea580c", hero: "#facc15" },
  { name: "void violet", bg: "#0d071b", wall: "#8b5cf6", hero: "#38bdf8" },
  { name: "arctic", bg: "#081421", wall: "#06b6d4", hero: "#f43f5e" },
];

const SAMPLE_CUSTOM_HTML_GAME = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Custom Studio HTML5 Game</title>
<style>
  body { margin: 0; background: #060913; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
  canvas { border: 2px solid #38bdf8; border-radius: 14px; box-shadow: 0 0 40px rgba(56,189,248,0.25); background: #090d1a; cursor: crosshair; }
  .hud { display: flex; gap: 18px; margin-bottom: 10px; font-size: 14px; background: rgba(255,255,255,0.06); padding: 8px 18px; border-radius: 10px; }
</style>
</head>
<body>
  <div class="hud">
    <strong>Neon Orbit Defender (Custom index.html)</strong>
    <span id="score">Score: 0</span>
    <span id="wave">Level: 1</span>
  </div>
  <canvas id="game" width="660" height="390"></canvas>
  <script>
    const c = document.getElementById("game");
    const ctx = c.getContext("2d");
    let score = 0, level = 1, orbs = [], mx = 330, my = 195;
    c.addEventListener("mousemove", e => {
      const r = c.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
    });
    c.addEventListener("mousedown", () => {
      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i];
        if (Math.hypot(o.x - mx, o.y - my) < o.r + 18) {
          orbs.splice(i, 1);
          score += 25;
          if (score % 150 === 0) {
            level++;
            if (window.CookieCloudSync) window.CookieCloudSync.reportProgress({ score, level });
          }
          document.getElementById("score").textContent = "Score: " + score;
          document.getElementById("wave").textContent = "Level: " + level;
        }
      }
    });
    setInterval(() => {
      if (orbs.length < 8 + level) {
        orbs.push({ x: Math.random() * 600 + 30, y: Math.random() * 330 + 30, vx: (Math.random() - 0.5) * (2 + level * 0.5), vy: (Math.random() - 0.5) * (2 + level * 0.5), r: 16 });
      }
    }, 650);
    function loop() {
      ctx.fillStyle = "rgba(9, 13, 26, 0.35)";
      ctx.fillRect(0, 0, c.width, c.height);
      for (const o of orbs) {
        o.x += o.vx; o.y += o.vy;
        if (o.x < o.r || o.x > c.width - o.r) o.vx *= -1;
        if (o.y < o.r || o.y > c.height - o.r) o.vy *= -1;
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = "#22c55e";
      ctx.beginPath(); ctx.arc(mx, my, 14, 0, Math.PI * 2); ctx.stroke();
      requestAnimationFrame(loop);
    }
    loop();
  </script>
</body>
</html>`;

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

function getCloudSyncState(): { username: string; isCloudSynced: boolean } {
  try {
    const raw = localStorage.getItem("auth_user");
    const token = localStorage.getItem("cloudsync_token") || localStorage.getItem("auth_token");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.username) {
        return { username: parsed.username, isCloudSynced: Boolean(token || parsed.username) };
      }
    }
    const g = localStorage.getItem("cookie_guest_name");
    if (g) return { username: g, isCloudSynced: false };
  } catch {}
  return { username: "guest_creator", isCloudSynced: false };
}

function rewriteExternalHtmlAssetsForCoep(rawHtml: string): string {
  return rawHtml.replace(
    /\b(src|href)\s*=\s*(["'])(https?:\/\/[^"']+)\2/gi,
    (match, attr, quote, url) => {
      if (url.includes("/!!/")) return match;
      return `${attr}=${quote}/!!/${url}${quote}`;
    }
  );
}

function injectCloudSyncBridgeIntoHtml(rawHtml: string, project: StudioGameProject): string {
  const { username, isCloudSynced } = getCloudSyncState();
  const coepSafeHtml = rewriteExternalHtmlAssetsForCoep(rawHtml || "");
  const bridgeScript = `
<script>
(function() {
  try {
    void window.localStorage.length;
  } catch (e) {
    try {
      var mem = Object.create(null);
      var memStorage = {
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function(k, v) { mem[String(k)] = String(v); },
        removeItem: function(k) { delete mem[String(k)]; },
        clear: function() { mem = Object.create(null); },
        key: function(i) { return Object.keys(mem)[i] || null; },
        get length() { return Object.keys(mem).length; }
      };
      Object.defineProperty(window, "localStorage", { value: memStorage });
      Object.defineProperty(window, "sessionStorage", { value: memStorage });
    } catch (_) {}
  }

  try {
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(input, init) {
        if (typeof input === "string" && /^https?:\\/\\//i.test(input) && input.indexOf(location.host) === -1) {
          input = location.origin + "/!!/" + input;
        }
        return origFetch.call(this, input, init);
      };
    }
  } catch (e) {}

  window.CookieCloudSync = {
    gameId: ${JSON.stringify(project.id).replace(/</g, "\\u003c")},
    gameTitle: ${JSON.stringify(project.title).replace(/</g, "\\u003c")},
    username: ${JSON.stringify(username).replace(/</g, "\\u003c")},
    isCloudSynced: ${JSON.stringify(isCloudSynced)},
    reportProgress: function(data) {
      try {
        window.parent.postMessage({
          type: "COOKIE_CLOUDSYNC_PROGRESS",
          gameId: ${JSON.stringify(project.id).replace(/</g, "\\u003c")},
          gameTitle: ${JSON.stringify(project.title).replace(/</g, "\\u003c")},
          score: Number(data && data.score) || 0,
          levelReached: Number(data && data.level) || 1,
          coinsAdded: Number(data && data.coins) || 0,
          completedGame: Boolean(data && data.completed)
        }, "*");
      } catch (e) {}
    }
  };
})();
</script>`;
  if (/<\/head>/i.test(coepSafeHtml)) {
    return coepSafeHtml.replace(/<\/head>/i, `${bridgeScript}</head>`);
  }
  if (/<body[^>]*>/i.test(coepSafeHtml)) {
    return coepSafeHtml.replace(/<body[^>]*>/i, (m) => `${m}${bridgeScript}`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />${bridgeScript}</head><body>${coepSafeHtml}</body></html>`;
}

function buildStandaloneGameHtml(project: StudioGameProject): string {
  if (project.isCustomHtml && project.customHtmlContent) {
    return injectCloudSyncBridgeIntoHtml(project.customHtmlContent, project);
  }
  return buildAdvancedStandaloneGameHtml(project);
}

interface SimState {
  levelIndex: number;
  runtimeGrid: number[][];
  rows: number;
  cols: number;
  tick: number;
  camX: number;
  camY: number;
  shakeFrames: number;
  shakeMag: number;
  switchesOn: boolean;
  doorsForcedOpen: boolean;
  gravDir: number;
  gravScale: number;
  timerFrames: number;
  firedRules: Record<string, boolean>;
  bannerText: string;
  levelBannerFrames: number;
  rewardedWin?: boolean;
  player: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    w: number;
    h: number;
    angle: number;
    grounded: boolean;
    onIce: boolean;
    jumpsLeft: number;
    jumpKeyLock: boolean;
    dashCd: number;
    dashFrames: number;
    facing: number;
    shootCd: number;
    hp: number;
    invulnFrames: number;
    overdriveFrames: number;
    tpCooldown: number;
    jetpackFuel: number;
    checkpointX: number;
    checkpointY: number;
    muzzleFlash: number;
    bobPhase: number;
    flapLock?: boolean;
    trail: { x: number; y: number; alpha: number }[];
  };
  coins: { x: number; y: number; w: number; h: number; taken: boolean }[];
  keysList: { x: number; y: number; w: number; h: number; taken: boolean }[];
  checkpoints: { x: number; y: number; w: number; h: number; used: boolean }[];
  powerups: { x: number; y: number; w: number; h: number; taken: boolean }[];
  tntBarrels: { r: number; c: number; x: number; y: number; w: number; h: number; intact: boolean }[];
  teleporters: { x: number; y: number; w: number; h: number }[];
  spawners: { x: number; y: number; w: number; h: number; hp: number; maxHp: number; cd: number; alive: boolean }[];
  signs: { x: number; y: number }[];
  movingPlatforms: {
    r: number;
    c: number;
    x: number;
    y: number;
    w: number;
    h: number;
    vx: number;
    vy: number;
    vertical: boolean;
  }[];
  enemies: {
    x: number;
    y: number;
    baseY: number;
    w: number;
    h: number;
    vx: number;
    vy: number;
    hp: number;
    maxHp: number;
    kind: number; // 5 walker, 9 boss, 23 drone, 24 turret
    isBoss: boolean;
    cd: number;
    aimAngle: number;
    alive: boolean;
  }[];
  bullets: {
    x: number;
    y: number;
    w: number;
    h: number;
    vx: number;
    vy: number;
    kind: WeaponType;
    pierce?: boolean;
    life: number;
    dead?: boolean;
  }[];
  enemyBullets: {
    x: number;
    y: number;
    w: number;
    h: number;
    vx: number;
    vy: number;
    life: number;
    dead?: boolean;
  }[];
  shockwaves: { x: number; y: number; radius: number; maxRadius: number; color: string }[];
  popups: { x: number; y: number; text: string; color: string; life: number }[];
  particles: { x: number; y: number; vx: number; vy: number; color: string; life: number; size?: number | undefined }[];
  weatherDrops: { x: number; y: number; vx: number; vy: number; size: number; char?: string | undefined }[];
  score: number;
  status: "playing" | "level_clear" | "won" | "lost";
}

export default function GameStudioPage() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  const [subTab, setSubTab] = useState<"community" | "mystudio" | "editor" | "htmlupload">(
    "community"
  );
  const chromebookMode = useChromebookMode();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | GameMode>("all");

  useEffect(() => {
    if (!chromebookMode) {
      setDebouncedSearchQuery(searchQuery);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchQuery, chromebookMode]);

  // User's Custom Named Game Studio & Cookie Coins
  const [userStudio, setUserStudio] = useState<StudioProfile>(() => getUserStudio());
  const [coins, setCoins] = useState<number>(() => getCookieCoins());

  // Studio edit form state
  const [studioNameInput, setStudioNameInput] = useState(userStudio.name);
  const [studioTaglineInput, setStudioTaglineInput] = useState(userStudio.tagline);
  const [studioColorInput, setStudioColorInput] = useState(userStudio.color);
  const [studioIconInput, setStudioIconInput] = useState(userStudio.icon);

  // Community published games state
  const [communityGames, setCommunityGames] = useState<StudioGameProject[]>(() => {
    try {
      const saved = localStorage.getItem("cookie_studio_games_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const [serverGameIds, setServerGameIds] = useState<Set<string>>(() => new Set());
  const [serverSyncLoaded, setServerSyncLoaded] = useState(false);
  const [isRefreshingLibrary, setIsRefreshingLibrary] = useState(false);

  // CloudSync Player Tracking state
  const [activeGameId, setActiveGameId] = useState<string>("editor_preview");
  const [, setCloudPlayers] = useState<CloudSyncPlayerProgress[]>([]);
  const [myCloudProgress, setMyCloudProgress] = useState<CloudSyncPlayerProgress | null>(null);
  const [playingCustomHtmlGame, setPlayingCustomHtmlGame] = useState<StudioGameProject | null>(
    null
  );
  const likingGamesRef = useRef<Set<string>>(new Set());
  const [likedGameIds, setLikedGameIds] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("studio_liked_games_v1") || "[]");
      return new Set(Array.isArray(raw) ? raw.map((x) => String(x)) : []);
    } catch {
      return new Set();
    }
  });

  // Custom index.html upload state (1,000 Cookie Coins)
  const [htmlTitle, setHtmlTitle] = useState("");
  const [htmlDesc, setHtmlDesc] = useState("");
  const [htmlFileName, setHtmlFileName] = useState<string>("");
  const [customHtmlCode, setCustomHtmlCode] = useState<string>(SAMPLE_CUSTOM_HTML_GAME);
  const [isUploadingHtml, setIsUploadingHtml] = useState(false);
  const [previewRefreshTick, setPreviewRefreshTick] = useState<number>(0);
  const [htmlPreviewBlobUrl, setHtmlPreviewBlobUrl] = useState<string>("");
  const [playingCustomBlobUrl, setPlayingCustomBlobUrl] = useState<string>("");

  // Advanced No-Code Engine Project State
  const [title, setTitle] = useState("cyber odyssey xl");
  const [description, setDescription] = useState(
    "scrolling multi-level world with 6 weapons, wall-jumps, switches, TNT chain reactions & visual logic rules!"
  );
  const [mode, setMode] = useState<GameMode>("platformer");
  const [levels, setLevels] = useState<StudioGameLevel[]>(() =>
    makeDefaultStudioLevels("platformer")
  );
  const [activeLevelIdx, setActiveLevelIdx] = useState<number>(0);

  const currentLevel = levels[activeLevelIdx] || levels[0];
  const currentDims = getGridDimensions(currentLevel?.grid);

  // Editor Palette & Paint Tool State
  const [selectedBrush, setSelectedBrush] = useState<number>(1);
  const [brushCategory, setBrushCategory] = useState<BrushCategory>("all");
  const [paintTool, setPaintTool] = useState<PaintToolMode>("brush");
  const [inspectorTab, setInspectorTab] = useState<"hero" | "rules" | "world" | "publish">("hero");
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const undoStackRef = useRef<number[][][]>([]);
  const redoStackRef = useRef<number[][][]>([]);

  // Editor Camera & Drag Preview Refs
  const editorCamRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragShapeRef = useRef<{
    active: boolean;
    tool: PaintToolMode;
    r0: number;
    c0: number;
    r1: number;
    c1: number;
    brushId: number;
  } | null>(null);
  const isPanningEditorRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  });

  // No-Code Mechanics, Weapons, Rules & FX State
  const [gravity, setGravity] = useState(0.55);
  const [jumpForce, setJumpForce] = useState(11.5);
  const [moveSpeed, setMoveSpeed] = useState(4.4);
  const [maxHp, setMaxHp] = useState(3);
  const [enableDoubleJump, setEnableDoubleJump] = useState(true);
  const [enableWallJump, setEnableWallJump] = useState(true);
  const [enableDash, setEnableDash] = useState(true);
  const [enableJetpack, setEnableJetpack] = useState(false);
  const [weaponType, setWeaponType] = useState<WeaponType>("blaster");
  const [mouseAim, setMouseAim] = useState(true);
  const [autoFire, setAutoFire] = useState(false);
  const [render3DInTest, setRender3DInTest] = useState(false);

  const [winCondition, setWinCondition] = useState<WinConditionType>("portal");
  const [timeLimitSec, setTimeLimitSec] = useState<number>(45);
  const [rules, setRules] = useState<StudioLogicRule[]>([
    { id: "r_default_1", when: "on_switch_on", action: "open_doors", text: "laser switch activated — security doors open!" },
    { id: "r_default_2", when: "on_boss_defeated", action: "overdrive_weapon", text: "boss defeated — weapon overdrive unlocked!" },
  ]);

  const [weather, setWeather] = useState<WeatherType>("starfield");
  const [darknessMode, setDarknessMode] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [screenShake, setScreenShake] = useState(true);
  const [cameraZoom, setCameraZoom] = useState<number>(1);

  const [playerColor, setPlayerColor] = useState("#22c55e");
  const [bgColor, setBgColor] = useState("#090d16");
  const [wallColor, setWallColor] = useState("#3b82f6");
  const [customScript, setCustomScript] = useState("");
  const isForeignProjectRef = useRef(false);

  // Live Play-Test Engine state
  const [isPlaying, setIsPlaying] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
  const [liveHp, setLiveHp] = useState(3);
  const [livePlayLevelIdx, setLivePlayLevelIdx] = useState(0);
  const [, setGameStatus] = useState<"editing" | "playing" | "level_clear" | "won" | "lost">(
    "editing"
  );
  const [isPublishing, setIsPublishing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPaintingRef = useRef(false);
  const paintButtonRef = useRef<number>(0);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const playingCustomIframeRef = useRef<HTMLIFrameElement | null>(null);
  const htmlPreviewIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const el = htmlPreviewIframeRef.current;
    return () => {
      if (isChromebookModeEnabled() && el) {
        teardownIframeElement(el, true);
      }
    };
  }, [htmlPreviewBlobUrl, subTab, visible]);

  useEffect(() => {
    const activeInStudio = Boolean(
      visible &&
        subTab === "editor" &&
        (Boolean(playingCustomHtmlGame && playingCustomBlobUrl) || isPlaying)
    );
    setGameSourceActive("studio-play", activeInStudio);
    return () => setGameSourceActive("studio-play", false);
  }, [visible, subTab, playingCustomHtmlGame, playingCustomBlobUrl, isPlaying, chromebookMode]);

  useEffect(() => {
    const el = playingCustomIframeRef.current;
    return () => {
      if (isChromebookModeEnabled() && el) {
        teardownIframeElement(el, true);
      }
    };
  }, [playingCustomBlobUrl]);

  const keysRef = useRef<Record<string, boolean>>({});
  const mouseLookDeltaRef = useRef<number>(0);
  const mouseFireRef = useRef<boolean>(false);
  const mouseHeldRef = useRef<boolean>(false);
  const mouseCanvasPosRef = useRef<{ x: number; y: number }>({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
  const hoverCellRef = useRef<{ r: number; c: number } | null>(null);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const projectStateRef = useRef({
    activeGameId,
    title,
    mode,
    levels,
    activeLevelIdx,
    livePlayLevelIdx,
    gravity,
    jumpForce,
    moveSpeed,
    maxHp,
    enableDoubleJump,
    enableWallJump,
    enableDash,
    enableJetpack,
    weaponType,
    mouseAim,
    autoFire,
    winCondition,
    timeLimitSec,
    weather,
    darknessMode,
    sfxEnabled,
    screenShake,
    cameraZoom,
    rules,
    render3DInTest,
    playerColor,
    bgColor,
    wallColor,
    customScript,
  });
  projectStateRef.current = {
    activeGameId,
    title,
    mode,
    levels,
    activeLevelIdx,
    livePlayLevelIdx,
    gravity,
    jumpForce,
    moveSpeed,
    maxHp,
    enableDoubleJump,
    enableWallJump,
    enableDash,
    enableJetpack,
    weaponType,
    mouseAim,
    autoFire,
    winCondition,
    timeLimitSec,
    weather,
    darknessMode,
    sfxEnabled,
    screenShake,
    cameraZoom,
    rules,
    render3DInTest,
    playerColor,
    bgColor,
    wallColor,
    customScript,
  };

  const pushUndoSnapshot = useCallback((gridSnap: number[][]) => {
    const cloned = gridSnap.map((r) => [...r]);
    undoStackRef.current.push(cloned);
    if (undoStackRef.current.length > 35) undoStackRef.current.shift();
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, []);

  const handleUndo = useCallback(() => {
    if (isPlayingRef.current || undoStackRef.current.length === 0) return;
    const prevSnap = undoStackRef.current.pop()!;
    setLevels((prevLevels) =>
      prevLevels.map((lvl, idx) => {
        if (idx !== activeLevelIdx) return lvl;
        redoStackRef.current.push(lvl.grid.map((r) => [...r]));
        return { ...lvl, grid: prevSnap };
      })
    );
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [activeLevelIdx]);

  const handleRedo = useCallback(() => {
    if (isPlayingRef.current || redoStackRef.current.length === 0) return;
    const nextSnap = redoStackRef.current.pop()!;
    setLevels((prevLevels) =>
      prevLevels.map((lvl, idx) => {
        if (idx !== activeLevelIdx) return lvl;
        undoStackRef.current.push(lvl.grid.map((r) => [...r]));
        return { ...lvl, grid: nextSnap };
      })
    );
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
  }, [activeLevelIdx]);

  // Sync Player Progress to CloudSync + Backend
  const syncProgressToCloud = useCallback(
    (payload: {
      gameId?: string;
      gameTitle?: string;
      levelReached?: number;
      score?: number;
      coinsAdded?: number;
      deathsAdded?: number;
      completedGame?: boolean;
    }) => {
      const { username, isCloudSynced } = getCloudSyncState();
      const gId = payload.gameId || projectStateRef.current.activeGameId || "editor_preview";
      const gTitle = payload.gameTitle || projectStateRef.current.title || "studio game";

      try {
        const raw = localStorage.getItem("cookie_cloudsync_progress_v1");
        const all: Record<string, CloudSyncPlayerProgress> = raw ? JSON.parse(raw) : {};
        const key = `${gId}:${username.toLowerCase()}`;
        const prev = all[key] || {
          username,
          cloudSynced: isCloudSynced,
          currentLevel: 1,
          highestLevel: 1,
          bestScore: 0,
          totalCoinsCollected: 0,
          deaths: 0,
          completions: 0,
          lastUpdated: new Date().toISOString(),
        };
        if (payload.levelReached && payload.levelReached >= 1) {
          prev.currentLevel = payload.levelReached;
          if (payload.levelReached > prev.highestLevel) prev.highestLevel = payload.levelReached;
        }
        if (typeof payload.score === "number" && payload.score > prev.bestScore) {
          prev.bestScore = payload.score;
        }
        if (payload.coinsAdded) prev.totalCoinsCollected += payload.coinsAdded;
        if (payload.deathsAdded) prev.deaths += payload.deathsAdded;
        if (payload.completedGame) prev.completions += 1;
        prev.cloudSynced = isCloudSynced;
        prev.lastUpdated = new Date().toISOString();
        all[key] = prev;
        localStorage.setItem("cookie_cloudsync_progress_v1", JSON.stringify(all));
        setMyCloudProgress({ ...prev });
      } catch {}

      fetch("/api/studio/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId: gId,
          gameTitle: gTitle,
          username,
          cloudSynced: isCloudSynced,
          ...payload,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.myProgress) setMyCloudProgress(data.myProgress);
          if (Array.isArray(data?.players)) setCloudPlayers(data.players);
        })
        .catch(() => {});
    },
    []
  );

  const fetchCloudProgressForGame = useCallback((gameId: string) => {
    const { username } = getCloudSyncState();
    try {
      const raw = localStorage.getItem("cookie_cloudsync_progress_v1");
      if (raw) {
        const all = JSON.parse(raw);
        const localEntry = all[`${gameId}:${username.toLowerCase()}`];
        if (localEntry) setMyCloudProgress(localEntry);
      }
    } catch {}

    fetch(
      `/api/studio/progress?gameId=${encodeURIComponent(gameId)}&user=${encodeURIComponent(
        username
      )}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.myProgress) setMyCloudProgress(data.myProgress);
        if (Array.isArray(data?.players)) setCloudPlayers(data.players);
      })
      .catch(() => {});
  }, []);

  const simRef = useRef<SimState | null>(null);

  const initSimulation = useCallback((targetLevelIdx = 0, carryScore = 0) => {
    const p = projectStateRef.current;
    const safeLvlIdx = Math.max(0, Math.min(p.levels.length - 1, targetLevelIdx));
    const lvl = p.levels[safeLvlIdx] || p.levels[0];
    const runtimeGrid = (lvl?.grid || createSizedEmptyGrid()).map((r) => [...r]);
    const { rows, cols } = getGridDimensions(runtimeGrid);

    let spawnX = 68;
    let spawnY = Math.max(68, (rows - 3) * TILE_SIZE);
    const coinsList: SimState["coins"] = [];
    const keysList: SimState["keysList"] = [];
    const checkpoints: SimState["checkpoints"] = [];
    const powerups: SimState["powerups"] = [];
    const tntBarrels: SimState["tntBarrels"] = [];
    const teleporters: SimState["teleporters"] = [];
    const spawners: SimState["spawners"] = [];
    const signs: SimState["signs"] = [];
    const movingPlatforms: SimState["movingPlatforms"] = [];
    const enemies: SimState["enemies"] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = runtimeGrid[r]?.[c] || 0;
        if (cell === 2) {
          spawnX = c * TILE_SIZE + 6;
          spawnY = r * TILE_SIZE + 6;
        } else if (cell === 3) {
          coinsList.push({ x: c * TILE_SIZE + 9, y: r * TILE_SIZE + 9, w: 16, h: 16, taken: false });
        } else if (cell === 5 || cell === 9 || cell === 23 || cell === 24) {
          const isBoss = cell === 9;
          const hp = isBoss ? 4 : cell === 24 ? 2 : 1;
          enemies.push({
            x: c * TILE_SIZE + 4,
            y: r * TILE_SIZE + 4,
            baseY: r * TILE_SIZE + 4,
            w: isBoss ? 28 : 24,
            h: isBoss ? 28 : 24,
            vx: cell === 24 ? 0 : isBoss ? 2.0 : 1.5,
            vy: 0,
            hp,
            maxHp: hp,
            kind: cell,
            isBoss,
            cd: 55 + ((r * 13 + c * 7) % 35),
            aimAngle: Math.PI,
            alive: true,
          });
        } else if (cell === 8 || cell === 17) {
          movingPlatforms.push({
            r,
            c,
            x: c * TILE_SIZE,
            y: r * TILE_SIZE,
            w: TILE_SIZE,
            h: 14,
            vx: cell === 8 ? 1.5 : 0,
            vy: cell === 17 ? 1.3 : 0,
            vertical: cell === 17,
          });
        } else if (cell === 10) {
          checkpoints.push({
            x: c * TILE_SIZE + 6,
            y: r * TILE_SIZE + 6,
            w: 22,
            h: 22,
            used: false,
          });
        } else if (cell === 11) {
          keysList.push({
            x: c * TILE_SIZE + 7,
            y: r * TILE_SIZE + 7,
            w: 20,
            h: 20,
            taken: false,
          });
        } else if (cell === 19) {
          teleporters.push({ x: c * TILE_SIZE, y: r * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE });
        } else if (cell === 22) {
          tntBarrels.push({
            r,
            c,
            x: c * TILE_SIZE + 3,
            y: r * TILE_SIZE + 3,
            w: 28,
            h: 28,
            intact: true,
          });
        } else if (cell === 25) {
          spawners.push({
            x: c * TILE_SIZE + 3,
            y: r * TILE_SIZE + 3,
            w: 28,
            h: 28,
            hp: 3,
            maxHp: 3,
            cd: 110,
            alive: true,
          });
        } else if (cell === 26) {
          powerups.push({
            x: c * TILE_SIZE + 7,
            y: r * TILE_SIZE + 7,
            w: 20,
            h: 20,
            taken: false,
          });
        } else if (cell === 27) {
          signs.push({ x: c * TILE_SIZE + 17, y: r * TILE_SIZE });
        }
      }
    }

    const activeWeather = lvl?.weather || p.weather || "none";
    const weatherDrops: SimState["weatherDrops"] = [];
    if (activeWeather !== "none") {
      const count = activeWeather === "rain" ? 55 : activeWeather === "starfield" ? 45 : 38;
      for (let i = 0; i < count; i++) {
        weatherDrops.push({
          x: Math.random() * CANVAS_W,
          y: Math.random() * CANVAS_H,
          vx: activeWeather === "rain" ? -1.4 : activeWeather === "snow" ? (Math.random() - 0.5) * 0.9 : 0,
          vy:
            activeWeather === "rain"
              ? 6.5 + Math.random() * 2.5
              : activeWeather === "snow"
                ? 1.1 + Math.random() * 1.1
                : activeWeather === "embers"
                  ? -(0.8 + Math.random() * 1.4)
                  : activeWeather === "matrix"
                    ? 2.2 + Math.random() * 2.0
                    : 0.15 + Math.random() * 0.35,
          size: activeWeather === "starfield" ? 1.5 + Math.random() * 1.8 : 2.5,
          char: activeWeather === "matrix" ? (Math.random() < 0.5 ? "1" : "0") : undefined,
        });
      }
    }

    const startHp = p.maxHp || 3;
    const limSec = lvl?.timeLimitSec || p.timeLimitSec || 45;
    const initCamX = Math.max(0, Math.min(cols * TILE_SIZE - CANVAS_W, spawnX - CANVAS_W / 2));
    const initCamY = Math.max(0, Math.min(rows * TILE_SIZE - CANVAS_H, spawnY - CANVAS_H / 2));

    const newSim: SimState = {
      levelIndex: safeLvlIdx,
      runtimeGrid,
      rows,
      cols,
      tick: 0,
      camX: initCamX,
      camY: initCamY,
      shakeFrames: 0,
      shakeMag: 0,
      switchesOn: false,
      doorsForcedOpen: false,
      gravDir: 1,
      gravScale: 1,
      timerFrames: limSec * 60,
      firedRules: {},
      bannerText: `${lvl?.name || `level ${safeLvlIdx + 1}`} (${safeLvlIdx + 1}/${p.levels.length})`,
      levelBannerFrames: 85,
      rewardedWin: false,
      player: {
        x: spawnX,
        y: spawnY,
        vx: 0,
        vy: 0,
        w: 22,
        h: 22,
        angle: 0,
        grounded: false,
        onIce: false,
        jumpsLeft: p.enableDoubleJump ? 2 : 1,
        jumpKeyLock: false,
        dashCd: 0,
        dashFrames: 0,
        facing: 1,
        shootCd: 0,
        hp: startHp,
        invulnFrames: 0,
        overdriveFrames: 0,
        tpCooldown: 0,
        jetpackFuel: 100,
        checkpointX: spawnX,
        checkpointY: spawnY,
        muzzleFlash: 0,
        bobPhase: 0,
        trail: [],
      },
      coins: coinsList,
      keysList,
      checkpoints,
      powerups,
      tntBarrels,
      teleporters,
      spawners,
      signs,
      movingPlatforms,
      enemies,
      bullets: [],
      enemyBullets: [],
      shockwaves: [],
      popups: [],
      particles: [],
      weatherDrops,
      score: carryScore,
      status: "playing",
    };

    // Execute any "on_start" rules immediately
    for (const rl of p.rules || []) {
      if (rl.when === "on_start") {
        newSim.firedRules[rl.id] = true;
        if (rl.action === "low_gravity") newSim.gravScale = 0.45;
        else if (rl.action === "flip_gravity") newSim.gravDir = -1;
        else if (rl.action === "grant_shield") newSim.player.invulnFrames = 360;
        else if (rl.action === "overdrive_weapon") newSim.player.overdriveFrames = 480;
        else if (rl.action === "open_doors") {
          newSim.doorsForcedOpen = true;
          newSim.switchesOn = true;
        }
        if (rl.text) {
          newSim.bannerText = rl.text;
          newSim.levelBannerFrames = 115;
        }
      }
    }

    simRef.current = newSim;
    setLivePlayLevelIdx(safeLvlIdx);
    setLiveScore(carryScore);
    setLiveHp(startHp);
    setGameStatus("playing");
  }, []);

  const hide = useCallback(() => {
    if (!document.body.classList.contains("studio-view")) return;
    setIsPlaying(false);
    setPlayingCustomHtmlGame(null);
    setGameStatus("editing");
    setActive(false);

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setVisible(false);
      document.body.classList.remove("studio-view");
      fadeTimerRef.current = null;
    }, 100);
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
    if (document.body.classList.contains("apps-view") && (window as any).hideAppsMenu) {
      (window as any).hideAppsMenu();
    }
    if (document.body.classList.contains("shop-view") && (window as any).hideShopMenu) {
      (window as any).hideShopMenu();
    }
    if (document.body.classList.contains("master-view") && (window as any).hideMasterMenu) {
      (window as any).hideMasterMenu();
    }

    showHomeView();
    document.body.classList.add("studio-view");
    setVisible(true);
    setCoins(getCookieCoins());
    const st = getUserStudio();
    setUserStudio(st);

    requestAnimationFrame(() => {
      setActive(true);
    });
  }, []);

  const toggle = useCallback(() => {
    if (document.body.classList.contains("studio-view")) hide();
    else show();
  }, [show, hide]);

  useEffect(() => {
    (window as any).showStudioMenu = show;
    (window as any).hideStudioMenu = hide;
    (window as any).toggleStudioMenu = toggle;

    const studioBtn = document.getElementById("studio-btn");
    const brand =
      document.getElementById("branding-container") || document.getElementById("brand");

    const onStudioClick = (e: MouseEvent) => {
      e.preventDefault();
      toggle();
    };
    const onBrandClick = (e: MouseEvent) => {
      e.preventDefault();
      if (document.body.classList.contains("studio-view")) hide();
    };

    if (studioBtn) studioBtn.addEventListener("click", onStudioClick);
    if (brand) brand.addEventListener("click", onBrandClick);

    const onCoins = () => setCoins(getCookieCoins());
    window.addEventListener("cookie-coins-updated", onCoins);

    const onWindowMessage = (ev: MessageEvent) => {
      if (ev.data?.type === "COOKIE_CLOUDSYNC_PROGRESS") {
        syncProgressToCloud({
          gameId: ev.data.gameId,
          gameTitle: ev.data.gameTitle,
          score: ev.data.score,
          levelReached: ev.data.levelReached,
          coinsAdded: ev.data.coinsAdded,
          completedGame: ev.data.completedGame,
        });
      }
    };
    window.addEventListener("message", onWindowMessage);

    return () => {
      if (studioBtn) studioBtn.removeEventListener("click", onStudioClick);
      if (brand) brand.removeEventListener("click", onBrandClick);
      window.removeEventListener("cookie-coins-updated", onCoins);
      window.removeEventListener("message", onWindowMessage);
    };
  }, [show, hide, toggle, syncProgressToCloud]);

  const mergePublishedGame = useCallback((incoming: StudioGameProject) => {
    if (!incoming || !incoming.id) return;
    setCommunityGames((prev) => {
      const exists = prev.some((g) => g.id === incoming.id);
      const next = exists
        ? prev.map((g) => (g.id === incoming.id ? incoming : g))
        : [incoming, ...prev];
      try {
        localStorage.setItem("cookie_studio_games_v2", JSON.stringify(next.slice(0, 80)));
      } catch {}
      return next;
    });
  }, []);

  const refreshCommunityLibrary = useCallback(async (forceFresh = false) => {
    setIsRefreshingLibrary(true);
    try {
      const qs = forceFresh ? `fresh=1&t=${Date.now()}` : `t=${Date.now()}`;
      const res = await fetch(`/api/studio/games?${qs}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (Array.isArray(data?.games)) {
        const remoteList = data.games as StudioGameProject[];
        setServerGameIds(new Set(remoteList.map((g) => g.id)));
        setServerSyncLoaded(true);
        setCommunityGames((prev) => {
          const byId = new Map<string, StudioGameProject>();
          const seenTitles = new Set<string>();
          for (const g of remoteList) {
            if (g?.id) {
              byId.set(g.id, g);
              const tNorm = String(g.title || "")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, " ");
              if (tNorm) seenTitles.add(tNorm);
            }
          }
          const myAuthor = getCloudSyncState().username.toLowerCase();
          for (const g of prev) {
            if (!g?.id || byId.has(g.id)) continue;
            const tNorm = String(g.title || "")
              .trim()
              .toLowerCase()
              .replace(/\s+/g, " ");
            if (tNorm && seenTitles.has(tNorm)) continue;
            if (String(g.author || "").trim().toLowerCase() !== myAuthor) continue;
            if (tNorm) seenTitles.add(tNorm);
            byId.set(g.id, g);
          }
          const next = Array.from(byId.values()).slice(0, 80);
          try {
            localStorage.setItem("cookie_studio_games_v2", JSON.stringify(next));
          } catch {}
          return next;
        });
      }
    } catch {} finally {
      setIsRefreshingLibrary(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void refreshCommunityLibrary(subTab === "community");
    fetchCloudProgressForGame(activeGameId);

    const onSseStudio = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.game?.id) {
        setServerGameIds((prev) => new Set(prev).add(detail.game.id));
        mergePublishedGame(detail.game);
      }
    };
    const onVisChange = () => {
      if (!document.hidden && visible) void refreshCommunityLibrary();
    };
    window.addEventListener("sunshine-studio-event", onSseStudio);
    document.addEventListener("visibilitychange", onVisChange);

    try {
      const bc = new BroadcastChannel("cookie_studio_v1_channel");
      bc.onmessage = (ev) => {
        if (ev.data?.type === "GAME_PUBLISHED" && ev.data.game?.id) {
          setServerGameIds((prev) => new Set(prev).add(ev.data.game.id));
          mergePublishedGame(ev.data.game);
        }
      };
      broadcastRef.current = bc;
    } catch {}

    return () => {
      window.removeEventListener("sunshine-studio-event", onSseStudio);
      document.removeEventListener("visibilitychange", onVisChange);
      broadcastRef.current?.close();
    };
  }, [visible, subTab, activeGameId, mergePublishedGame, fetchCloudProgressForGame, refreshCommunityLibrary]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (!isPlayingRef.current && (e.ctrlKey || e.metaKey)) {
        if (e.code === "KeyZ" && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
          return;
        }
        if (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey)) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      keysRef.current[e.code] = true;
      if (
        isPlayingRef.current &&
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(
          e.code
        )
      ) {
        e.preventDefault();
      }
      if (!isPlayingRef.current && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
      }
      if (isPlayingRef.current && e.code === "KeyR") {
        initSimulation(projectStateRef.current.livePlayLevelIdx, 0);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.code] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [visible, initSimulation, handleUndo, handleRedo]);

  // =========================================================================
  // 60FPS SCROLLING 2D + FIRST-PERSON 3D RAYCASTER ENGINE & EDITOR LOOP
  // =========================================================================
  useEffect(() => {
    if (!visible || subTab !== "editor" || playingCustomHtmlGame) return;
    let rafId = 0;

    const overlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number }
    ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const spawnParticles = (x: number, y: number, color: string, count = 10, spd = 6.5) => {
      if (!simRef.current) return;
      for (let i = 0; i < count; i++) {
        simRef.current.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * spd,
          vy: (Math.random() - 0.5) * spd,
          color,
          life: 18 + Math.floor(Math.random() * 12),
          size: 3 + Math.random() * 2,
        });
      }
    };

    const addPopup = (x: number, y: number, text: string, color = "#facc15") => {
      if (!simRef.current) return;
      simRef.current.popups.push({ x, y, text, color, life: 42 });
    };

    const triggerShake = (frames = 8, mag = 5) => {
      if (!simRef.current || !projectStateRef.current.screenShake) return;
      simRef.current.shakeFrames = Math.max(simRef.current.shakeFrames, frames);
      simRef.current.shakeMag = Math.max(simRef.current.shakeMag, mag);
    };

    const renderLoop = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        rafId = requestAnimationFrame(renderLoop);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const cfg = projectStateRef.current;
      const sim = simRef.current;
      const activeLvl =
        isPlayingRef.current && sim
          ? cfg.levels[sim.levelIndex] || cfg.levels[0]
          : cfg.levels[cfg.activeLevelIdx] || cfg.levels[0];
      const editGrid = activeLvl?.grid || cfg.levels[0]?.grid || createSizedEmptyGrid();
      const activeGrid = isPlayingRef.current && sim ? sim.runtimeGrid : editGrid;
      const { rows: mapRows, cols: mapCols } = getGridDimensions(activeGrid);
      const worldW = mapCols * TILE_SIZE;
      const worldH = mapRows * TILE_SIZE;

      const lvlBg = activeLvl?.bgColor || cfg.bgColor;
      const lvlWall = activeLvl?.wallColor || cfg.wallColor;
      const activeWinCond = activeLvl?.winCondition || cfg.winCondition || "portal";
      const activeWeather = activeLvl?.weather || cfg.weather || "none";
      const activeDarkness = Boolean(activeLvl?.darknessMode ?? cfg.darknessMode);
      const use3D = isPlayingRef.current && (cfg.mode === "fps3d" || cfg.render3DInTest);

      const completeLevelOrGame = () => {
        if (!sim || sim.status !== "playing") return;
        playStudioSfx("win", cfg.sfxEnabled);
        spawnParticles(sim.player.x + 11, sim.player.y + 11, "#10b981", 24, 8);
        const nextLvlIdx = sim.levelIndex + 1;
        if (nextLvlIdx < cfg.levels.length) {
          const bonusScore = sim.score + 50;
          addCookieCoins(10, `cleared level ${sim.levelIndex + 1} in ${cfg.title}`);
          awardGamePassXp(12, "game", { silent: true });
          syncProgressToCloud({
            levelReached: nextLvlIdx + 1,
            score: bonusScore,
          });
          notifyToast(
            `level ${sim.levelIndex + 1} complete! advancing to ${cfg.levels[nextLvlIdx]?.name || `level ${nextLvlIdx + 1}`} (+10 coins)`,
            "success"
          );
          initSimulation(nextLvlIdx, bonusScore);
        } else {
          sim.status = "won";
          setGameStatus("won");
          if (!sim.rewardedWin) {
            sim.rewardedWin = true;
            sim.score += 100;
            setLiveScore(sim.score);
            addCookieCoins(25, `beat all levels of ${cfg.title}`);
            awardGamePassXp(25, "game", { silent: true });
            recordGameActivity(cfg.title, 25, 1, sim.score);
            syncProgressToCloud({
              levelReached: cfg.levels.length,
              score: sim.score,
              completedGame: true,
            });
          }
        }
      };

      const fireRuleTrigger = (trig: RuleTriggerType) => {
        if (!sim) return;
        for (const rl of cfg.rules || []) {
          if (rl.when !== trig) continue;
          const repeatable = trig === "on_every_10s" || trig === "on_switch_on";
          if (!repeatable && sim.firedRules[rl.id]) continue;
          sim.firedRules[rl.id] = true;

          if (rl.action === "open_doors") {
            sim.doorsForcedOpen = true;
            sim.switchesOn = true;
            playStudioSfx("switch", cfg.sfxEnabled);
          } else if (rl.action === "win_level") {
            completeLevelOrGame();
            return;
          } else if (rl.action === "grant_shield") {
            sim.player.invulnFrames = 360;
            playStudioSfx("powerup", cfg.sfxEnabled);
          } else if (rl.action === "overdrive_weapon") {
            sim.player.overdriveFrames = 480;
            playStudioSfx("powerup", cfg.sfxEnabled);
          } else if (rl.action === "heal_player") {
            sim.player.hp = Math.min((cfg.maxHp || 3) + 2, sim.player.hp + 2);
            setLiveHp(sim.player.hp);
            playStudioSfx("powerup", cfg.sfxEnabled);
          } else if (rl.action === "low_gravity") {
            sim.gravScale = 0.45;
          } else if (rl.action === "flip_gravity") {
            sim.gravDir *= -1;
          } else if (rl.action === "shatter_bricks") {
            for (let r = 0; r < sim.rows; r++) {
              const rowArr = sim.runtimeGrid[r];
              if (!rowArr) continue;
              for (let c = 0; c < sim.cols; c++) {
                if (rowArr[c] === 14) rowArr[c] = 0;
              }
            }
            triggerShake(12, 7);
            playStudioSfx("explosion", cfg.sfxEnabled);
          } else if (rl.action === "spawn_boss") {
            sim.enemies.push({
              x: Math.min((sim.cols - 2) * TILE_SIZE, sim.player.x + 150),
              y: Math.max(TILE_SIZE, sim.player.y - 24),
              baseY: sim.player.y,
              w: 28,
              h: 28,
              vx: 2.0,
              vy: 0,
              hp: 4,
              maxHp: 4,
              kind: 9,
              isBoss: true,
              cd: 50,
              aimAngle: Math.PI,
              alive: true,
            });
          }
          if (rl.text || rl.action === "announce") {
            sim.bannerText = rl.text || `rule triggered: ${rl.action.replace("_", " ")}!`;
            sim.levelBannerFrames = 130;
          }
        }
      };

      const damagePlayer = () => {
        if (!sim || sim.player.invulnFrames > 0) return;
        sim.player.hp -= 1;
        setLiveHp(sim.player.hp);
        playStudioSfx("hit", cfg.sfxEnabled);
        triggerShake(10, 6);
        spawnParticles(sim.player.x + 11, sim.player.y + 11, "#ef4444", 18);
        if (sim.player.hp === 1) fireRuleTrigger("on_low_hp");
        if (sim.player.hp <= 0) {
          sim.status = "lost";
          setGameStatus("lost");
          syncProgressToCloud({
            levelReached: sim.levelIndex + 1,
            score: sim.score,
            deathsAdded: 1,
          });
        } else {
          sim.player.invulnFrames = 65;
          sim.player.x = sim.player.checkpointX;
          sim.player.y = sim.player.checkpointY;
          sim.player.vx = 0;
          sim.player.vy = 0;
          sim.gravDir = 1;
        }
      };

      const triggerExplosion = (cx: number, cy: number, radius = 88) => {
        if (!sim) return;
        playStudioSfx("explosion", cfg.sfxEnabled);
        triggerShake(13, 8);
        sim.shockwaves.push({ x: cx, y: cy, radius: 8, maxRadius: radius, color: "#fb923c" });
        spawnParticles(cx, cy, "#f97316", 22, 9);
        addPopup(cx, cy - 12, "BOOM!", "#fb923c");

        for (let r = 0; r < sim.rows; r++) {
          const rowArr = sim.runtimeGrid[r];
          if (!rowArr) continue;
          for (let c = 0; c < sim.cols; c++) {
            if (
              rowArr[c] === 14 &&
              Math.hypot(c * TILE_SIZE + 17 - cx, r * TILE_SIZE + 17 - cy) <= radius
            ) {
              rowArr[c] = 0;
              spawnParticles(c * TILE_SIZE + 17, r * TILE_SIZE + 17, "#f59e0b", 6);
            }
          }
        }

        for (const en of sim.enemies) {
          if (en.alive && Math.hypot(en.x + en.w / 2 - cx, en.y + en.h / 2 - cy) <= radius + 12) {
            en.hp -= 3;
            if (en.hp <= 0) {
              en.alive = false;
              const pts = en.isBoss ? 75 : 30;
              sim.score += pts;
              setLiveScore(sim.score);
              addPopup(en.x + 12, en.y, `+${pts}`, "#f472b6");
              if (en.isBoss) fireRuleTrigger("on_boss_defeated");
            }
          }
        }

        for (const sp of sim.spawners) {
          if (sp.alive && Math.hypot(sp.x + 14 - cx, sp.y + 14 - cy) <= radius) {
            sp.hp -= 3;
            if (sp.hp <= 0) {
              sp.alive = false;
              sim.score += 50;
              setLiveScore(sim.score);
            }
          }
        }

        // Chain-react nearby TNT barrels!
        for (const tnt of sim.tntBarrels) {
          if (tnt.intact && Math.hypot(tnt.x + 14 - cx, tnt.y + 14 - cy) <= radius) {
            tnt.intact = false;
            triggerExplosion(tnt.x + 14, tnt.y + 14, radius);
          }
        }
      };

      // --- EDITOR CAMERA PANNING WHEN NOT PLAYING ---
      if (!isPlayingRef.current) {
        const keys = keysRef.current;
        const panSpd = 8;
        if (keys["ArrowLeft"] || keys["KeyA"]) editorCamRef.current.x -= panSpd;
        if (keys["ArrowRight"] || keys["KeyD"]) editorCamRef.current.x += panSpd;
        if (keys["ArrowUp"] || keys["KeyW"]) editorCamRef.current.y -= panSpd;
        if (keys["ArrowDown"] || keys["KeyS"]) editorCamRef.current.y += panSpd;
        editorCamRef.current.x = Math.max(0, Math.min(Math.max(0, worldW - CANVAS_W), editorCamRef.current.x));
        editorCamRef.current.y = Math.max(0, Math.min(Math.max(0, worldH - CANVAS_H), editorCamRef.current.y));
      }

      // --- SIMULATION STEP ---
      if (isPlayingRef.current && sim && sim.status === "playing") {
        sim.tick++;
        const keys = keysRef.current;
        const pl = sim.player;
        if (pl.invulnFrames > 0) pl.invulnFrames--;
        if (pl.dashCd > 0) pl.dashCd--;
        if (pl.shootCd > 0) pl.shootCd--;
        if (pl.overdriveFrames > 0) pl.overdriveFrames--;
        if (pl.tpCooldown > 0) pl.tpCooldown--;
        if (pl.muzzleFlash > 0) pl.muzzleFlash--;
        if (sim.levelBannerFrames > 0) sim.levelBannerFrames--;
        if (sim.shakeFrames > 0) sim.shakeFrames--;
        if (sim.tick % 600 === 0) fireRuleTrigger("on_every_10s");

        const allKeysCollected = sim.keysList.every((k) => k.taken);
        const isSolidCell = (r: number, c: number) => {
          if (r < 0 || r >= sim.rows || c < 0 || c >= sim.cols) return true;
          const id = activeGrid[r]?.[c] || 0;
          if (id === 1 || id === 14 || id === 15 || id === 16) return true;
          if (id === 12 && !allKeysCollected && !sim.doorsForcedOpen) return true;
          if (id === 21 && !sim.switchesOn && !sim.doorsForcedOpen) return true;
          return false;
        };

        // Survivor auto-wave horde spawns
        if (
          cfg.mode === "survivor" &&
          sim.tick % 135 === 0 &&
          sim.enemies.filter((e) => e.alive).length < 20
        ) {
          const ang = Math.random() * Math.PI * 2;
          const sx = Math.max(
            TILE_SIZE * 1.4,
            Math.min((sim.cols - 2.4) * TILE_SIZE, pl.x + Math.cos(ang) * 240)
          );
          const sy = Math.max(
            TILE_SIZE * 1.4,
            Math.min((sim.rows - 2.4) * TILE_SIZE, pl.y + Math.sin(ang) * 185)
          );
          const isWaveBoss = sim.tick % 810 === 0;
          sim.enemies.push({
            x: sx,
            y: sy,
            baseY: sy,
            w: isWaveBoss ? 28 : 24,
            h: isWaveBoss ? 28 : 24,
            vx: 1.6,
            vy: 0,
            hp: isWaveBoss ? 4 : 1,
            maxHp: isWaveBoss ? 4 : 1,
            kind: 9,
            isBoss: isWaveBoss,
            cd: 60,
            aimAngle: 0,
            alive: true,
          });
        }

        const effSpeed = cfg.moveSpeed * (pl.overdriveFrames > 0 ? 1.28 : 1);

        if (use3D) {
          // --- FIRST-PERSON 3D RAYCASTER MOVEMENT & COMBAT ---
          const turnSpeed = 0.055;
          if (keys["ArrowLeft"]) pl.angle -= turnSpeed;
          if (keys["ArrowRight"]) pl.angle += turnSpeed;
          if (mouseLookDeltaRef.current !== 0) {
            pl.angle += mouseLookDeltaRef.current * 0.0045;
            mouseLookDeltaRef.current = 0;
          }

          const moveSpd = effSpeed * 0.65;
          let dx = 0;
          let dy = 0;
          if (keys["KeyW"] || keys["ArrowUp"]) {
            dx += Math.cos(pl.angle) * moveSpd;
            dy += Math.sin(pl.angle) * moveSpd;
          }
          if (keys["KeyS"] || keys["ArrowDown"]) {
            dx -= Math.cos(pl.angle) * moveSpd;
            dy -= Math.sin(pl.angle) * moveSpd;
          }
          if (keys["KeyA"]) {
            dx += Math.cos(pl.angle - Math.PI / 2) * (moveSpd * 0.8);
            dy += Math.sin(pl.angle - Math.PI / 2) * (moveSpd * 0.8);
          }
          if (keys["KeyD"]) {
            dx += Math.cos(pl.angle + Math.PI / 2) * (moveSpd * 0.8);
            dy += Math.sin(pl.angle + Math.PI / 2) * (moveSpd * 0.8);
          }
          if (cfg.enableDash && (keys["ShiftLeft"] || keys["ShiftRight"]) && pl.dashCd <= 0) {
            dx *= 3.2;
            dy *= 3.2;
            pl.dashCd = 40;
            playStudioSfx("dash", cfg.sfxEnabled);
          }
          if (Math.hypot(dx, dy) > 0.1) pl.bobPhase += 0.18;

          const nextX = pl.x + dx;
          const nextY = pl.y + dy;
          const pad = 8;
          const curR = Math.floor((pl.y + 11) / TILE_SIZE);
          const curC = Math.floor((pl.x + 11) / TILE_SIZE);
          const checkC = Math.floor((nextX + 11 + (dx > 0 ? pad : -pad)) / TILE_SIZE);
          const checkR = Math.floor((nextY + 11 + (dy > 0 ? pad : -pad)) / TILE_SIZE);

          if (!isSolidCell(curR, checkC)) pl.x = nextX;
          if (!isSolidCell(checkR, curC)) pl.y = nextY;

          // Fire 3D Weapon
          if (
            cfg.weaponType !== "none" &&
            (keys["Space"] || keys["KeyF"] || mouseFireRef.current || mouseHeldRef.current) &&
            pl.shootCd <= 0
          ) {
            mouseFireRef.current = false;
            pl.shootCd = pl.overdriveFrames > 0 ? 7 : 14;
            pl.muzzleFlash = 6;
            playStudioSfx(cfg.weaponType === "laser" ? "laser" : "shoot", cfg.sfxEnabled);

            // Check breakable brick or TNT along center ray first
            let rx = (pl.x + 11) / TILE_SIZE;
            let ry = (pl.y + 11) / TILE_SIZE;
            for (let step = 0; step < 36; step++) {
              rx += Math.cos(pl.angle) * 0.25;
              ry += Math.sin(pl.angle) * 0.25;
              const rr = Math.floor(ry);
              const cc = Math.floor(rx);
              if (rr >= 0 && rr < sim.rows && cc >= 0 && cc < sim.cols) {
                const rowArr = activeGrid[rr];
                if (rowArr && rowArr[cc] === 14) {
                  rowArr[cc] = 0;
                  break;
                }
                if (isSolidCell(rr, cc)) break;
              }
            }

            for (const tnt of sim.tntBarrels) {
              if (!tnt.intact) continue;
              const tx = tnt.x + 14 - (pl.x + 11);
              const ty = tnt.y + 14 - (pl.y + 11);
              let diff = Math.atan2(ty, tx) - pl.angle;
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;
              if (Math.abs(diff) < 0.2 && Math.hypot(tx, ty) < 420) {
                tnt.intact = false;
                triggerExplosion(tnt.x + 14, tnt.y + 14);
                break;
              }
            }

            let bestEnemy: (typeof sim.enemies)[0] | null = null;
            let bestDist = 9999;
            for (const en of sim.enemies) {
              if (!en.alive) continue;
              const ex = en.x + en.w / 2 - (pl.x + 11);
              const ey = en.y + en.h / 2 - (pl.y + 11);
              const dist = Math.hypot(ex, ey);
              let diff = Math.atan2(ey, ex) - pl.angle;
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;
              const cone = cfg.weaponType === "shotgun" ? 0.36 : 0.22;
              if (Math.abs(diff) < cone && dist < bestDist) {
                bestDist = dist;
                bestEnemy = en;
              }
            }
            if (bestEnemy) {
              bestEnemy.hp -= cfg.weaponType === "shotgun" || cfg.weaponType === "laser" ? 2 : 1;
              if (bestEnemy.hp <= 0) {
                bestEnemy.alive = false;
                sim.score += bestEnemy.isBoss ? 75 : 30;
                setLiveScore(sim.score);
                if (bestEnemy.isBoss) fireRuleTrigger("on_boss_defeated");
              }
            }
          }
        } else {
          // --- 2D SCROLLING WORLD MOVEMENT, GADGETS & 6 WEAPONS ---
          const left = keys["ArrowLeft"] || keys["KeyA"];
          const right = keys["ArrowRight"] || keys["KeyD"];
          const up = keys["ArrowUp"] || keys["KeyW"] || keys["Space"];
          const down = keys["ArrowDown"] || keys["KeyS"];
          const dashKey = keys["ShiftLeft"] || keys["ShiftRight"];

          if (right) pl.facing = 1;
          else if (left) pl.facing = -1;

          // Shift Dash with brief i-frames & afterimage trail
          if (cfg.enableDash && dashKey && pl.dashCd <= 0) {
            pl.dashFrames = 8;
            pl.dashCd = 40;
            pl.invulnFrames = Math.max(pl.invulnFrames, 9);
            playStudioSfx("dash", cfg.sfxEnabled);
            spawnParticles(pl.x + 11, pl.y + 11, "#38bdf8", 10);
          }

          if (pl.dashFrames > 0 || pl.overdriveFrames > 0) {
            pl.trail.push({ x: pl.x, y: pl.y, alpha: 0.55 });
            if (pl.trail.length > 6) pl.trail.shift();
          }

          const isTopDown =
            cfg.mode === "topdown" || cfg.mode === "shooter" || cfg.mode === "survivor";

          if (isTopDown) {
            const targetVx = (right ? effSpeed : 0) - (left ? effSpeed : 0);
            const targetVy =
              (down ? effSpeed : 0) - (keys["ArrowUp"] || keys["KeyW"] ? effSpeed : 0);
            const mult = pl.dashFrames > 0 ? 2.4 : 1;
            pl.vx = targetVx * mult;
            pl.vy = targetVy * mult;
            if (pl.dashFrames > 0) pl.dashFrames--;
          } else if (cfg.mode === "gravrunner") {
            pl.vx = effSpeed * 0.88;
            if (up && !pl.jumpKeyLock && pl.grounded) {
              sim.gravDir *= -1;
              pl.grounded = false;
              pl.jumpKeyLock = true;
              playStudioSfx("jump", cfg.sfxEnabled);
              spawnParticles(pl.x + 11, pl.y + 11, "#c084fc", 8);
            }
            if (!up) pl.jumpKeyLock = false;
            pl.vy += (cfg.gravity || 0.55) * sim.gravDir * sim.gravScale;
          } else if (cfg.mode === "flappy") {
            pl.vx = effSpeed * 0.65;
            if (up && !pl.flapLock) {
              pl.vy = -cfg.jumpForce;
              pl.flapLock = true;
              playStudioSfx("jump", cfg.sfxEnabled);
            }
            if (!up) pl.flapLock = false;
            pl.vy += cfg.gravity * sim.gravScale;
          } else {
            // Platformer & Metroidvania
            const targetVx = (right ? effSpeed : 0) - (left ? effSpeed : 0);
            if (pl.dashFrames > 0) {
              pl.vx = pl.facing * effSpeed * 2.55;
              pl.vy *= 0.4;
              pl.dashFrames--;
            } else if (pl.onIce) {
              pl.vx += (targetVx - pl.vx) * 0.07;
            } else {
              pl.vx = targetVx;
            }

            if (up && !pl.jumpKeyLock && pl.jumpsLeft > 0) {
              pl.vy = -cfg.jumpForce * sim.gravDir;
              pl.grounded = false;
              pl.jumpsLeft--;
              pl.jumpKeyLock = true;
              playStudioSfx("jump", cfg.sfxEnabled);
              spawnParticles(pl.x + 11, pl.y + (sim.gravDir > 0 ? 22 : 0), "#94a3b8", 6);
            } else if (cfg.enableJetpack && up && pl.jetpackFuel > 0) {
              pl.vy = Math.max(-6.5, Math.min(6.5, pl.vy - 0.88 * sim.gravDir));
              pl.jetpackFuel = Math.max(0, pl.jetpackFuel - 1.4);
              if (sim.tick % 3 === 0) {
                spawnParticles(pl.x + 11, pl.y + 22, "#38bdf8", 2, 2.5);
              }
            }
            if (!up) pl.jumpKeyLock = false;
            pl.vy += cfg.gravity * sim.gravDir * sim.gravScale;
            pl.vy = Math.max(-16, Math.min(16, pl.vy));
          }

          // --- 6 NO-CODE WEAPONS + 360° CURSOR AIM / AUTO-FIRE ---
          const fireTriggered =
            keys["KeyF"] ||
            mouseFireRef.current ||
            mouseHeldRef.current ||
            cfg.autoFire ||
            (isTopDown && keys["Space"]);

          if (cfg.weaponType !== "none" && fireTriggered && pl.shootCd <= 0) {
            mouseFireRef.current = false;
            const zoom = cfg.cameraZoom || 1;
            const worldMouseX = (mouseCanvasPosRef.current.x - CANVAS_W / 2) / zoom + CANVAS_W / 2 + sim.camX;
            const worldMouseY = (mouseCanvasPosRef.current.y - CANVAS_H / 2) / zoom + CANVAS_H / 2 + sim.camY;

            let aimAng = pl.facing > 0 ? 0 : Math.PI;
            if (cfg.mode === "survivor") {
              // Auto-target nearest living enemy if autoFire, else cursor
              let nearestDist = 9999;
              for (const en of sim.enemies) {
                if (!en.alive) continue;
                const d = Math.hypot(en.x - pl.x, en.y - pl.y);
                if (d < nearestDist) {
                  nearestDist = d;
                  aimAng = Math.atan2(en.y + 12 - (pl.y + 11), en.x + 12 - (pl.x + 11));
                }
              }
              if (mouseHeldRef.current || (!cfg.autoFire && cfg.mouseAim)) {
                aimAng = Math.atan2(worldMouseY - (pl.y + 11), worldMouseX - (pl.x + 11));
              }
            } else if (cfg.mouseAim || isTopDown) {
              aimAng = Math.atan2(worldMouseY - (pl.y + 11), worldMouseX - (pl.x + 11));
              pl.facing = Math.cos(aimAng) >= 0 ? 1 : -1;
            }

            const cdMult = pl.overdriveFrames > 0 ? 0.45 : 1;
            if (cfg.weaponType === "shotgun") {
              playStudioSfx("shoot", cfg.sfxEnabled);
              for (const off of [-0.24, 0, 0.24]) {
                sim.bullets.push({
                  x: pl.x + 11,
                  y: pl.y + 11,
                  w: 9,
                  h: 9,
                  vx: Math.cos(aimAng + off) * 9.5,
                  vy: Math.sin(aimAng + off) * 9.5,
                  kind: "shotgun",
                  life: 38,
                });
              }
              pl.shootCd = Math.round(23 * cdMult);
            } else if (cfg.weaponType === "laser") {
              playStudioSfx("laser", cfg.sfxEnabled);
              sim.bullets.push({
                x: pl.x + 11,
                y: pl.y + 9,
                w: 16,
                h: 6,
                vx: Math.cos(aimAng) * 15.5,
                vy: Math.sin(aimAng) * 15.5,
                kind: "laser",
                pierce: true,
                life: 48,
              });
              pl.shootCd = Math.round(17 * cdMult);
            } else if (cfg.weaponType === "boomerang") {
              playStudioSfx("sword", cfg.sfxEnabled);
              sim.bullets.push({
                x: pl.x + 7,
                y: pl.y + 7,
                w: 14,
                h: 14,
                vx: Math.cos(aimAng) * 9.2,
                vy: Math.sin(aimAng) * 9.2,
                kind: "boomerang",
                pierce: true,
                life: 76,
              });
              pl.shootCd = Math.round(22 * cdMult);
            } else if (cfg.weaponType === "grenade") {
              playStudioSfx("shoot", cfg.sfxEnabled);
              sim.bullets.push({
                x: pl.x + 7,
                y: pl.y + 6,
                w: 12,
                h: 12,
                vx: Math.cos(aimAng) * 7.8,
                vy: Math.sin(aimAng) * 7.8 - (isTopDown ? 0 : 3.6 * sim.gravDir),
                kind: "grenade",
                life: 68,
              });
              pl.shootCd = Math.round(26 * cdMult);
            } else if (cfg.weaponType === "sword") {
              playStudioSfx("sword", cfg.sfxEnabled);
              const sx = pl.x + 11 + Math.cos(aimAng) * 22 - 18;
              const sy = pl.y + 11 + Math.sin(aimAng) * 22 - 18;
              sim.bullets.push({
                x: sx,
                y: sy,
                w: 36,
                h: 36,
                vx: 0,
                vy: 0,
                kind: "sword",
                pierce: true,
                life: 9,
              });
              // Deflect / slice enemy plasma bolts!
              for (const eb of sim.enemyBullets) {
                if (Math.hypot(eb.x - (pl.x + 11), eb.y - (pl.y + 11)) < 52) {
                  eb.dead = true;
                  spawnParticles(eb.x, eb.y, "#38bdf8", 6);
                  addPopup(eb.x, eb.y - 8, "PARRY!", "#38bdf8");
                }
              }
              pl.shootCd = Math.round(14 * cdMult);
            } else {
              playStudioSfx("shoot", cfg.sfxEnabled);
              sim.bullets.push({
                x: pl.x + 8,
                y: pl.y + 9,
                w: 10,
                h: 6,
                vx: Math.cos(aimAng) * 10.5,
                vy: Math.sin(aimAng) * 10.5,
                kind: "blaster",
                life: 62,
              });
              pl.shootCd = Math.round(13 * cdMult);
            }
          }

          // Update H-Moving & V-Elevator platforms
          for (const mp of sim.movingPlatforms) {
            if (mp.vertical) {
              mp.y += mp.vy;
              const nextR = Math.floor((mp.y + (mp.vy > 0 ? mp.h : 0)) / TILE_SIZE);
              if (nextR <= 0 || nextR >= sim.rows - 1 || isSolidCell(nextR, mp.c)) {
                mp.vy *= -1;
              }
            } else {
              mp.x += mp.vx;
              const nextC = Math.floor((mp.x + (mp.vx > 0 ? mp.w : 0)) / TILE_SIZE);
              if (nextC < 0 || nextC >= sim.cols || isSolidCell(mp.r, nextC)) {
                mp.vx *= -1;
              }
            }
          }

          // Horizontal Move & Wall-Jump Detection
          pl.x += pl.vx;
          if (pl.x < 0) pl.x = 0;
          if (pl.x + pl.w > worldW) pl.x = worldW - pl.w;

          let wallTouchDir = 0;
          const rStart = Math.max(0, Math.floor(pl.y / TILE_SIZE) - 1);
          const rEnd = Math.min(sim.rows - 1, Math.floor((pl.y + pl.h) / TILE_SIZE) + 1);
          const cStart = Math.max(0, Math.floor(pl.x / TILE_SIZE) - 1);
          const cEnd = Math.min(sim.cols - 1, Math.floor((pl.x + pl.w) / TILE_SIZE) + 1);

          for (let r = rStart; r <= rEnd; r++) {
            for (let c = cStart; c <= cEnd; c++) {
              if (!isSolidCell(r, c)) continue;
              const box = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
              if (overlap(pl, box)) {
                // Dashing into breakable brick shatters it!
                const rowArr = activeGrid[r];
                if (pl.dashFrames > 0 && rowArr && rowArr[c] === 14) {
                  rowArr[c] = 0;
                  spawnParticles(box.x + 17, box.y + 17, "#f59e0b", 10);
                  triggerShake(6, 4);
                  continue;
                }
                if (pl.vx > 0) {
                  pl.x = box.x - pl.w;
                  wallTouchDir = 1;
                } else if (pl.vx < 0) {
                  pl.x = box.x + box.w;
                  wallTouchDir = -1;
                }
                if (cfg.mode === "flappy" || cfg.mode === "gravrunner") damagePlayer();
              }
            }
          }

          // Wall-Slide & Wall-Kick
          if (
            cfg.enableWallJump &&
            !isTopDown &&
            wallTouchDir !== 0 &&
            !pl.grounded &&
            pl.vy * sim.gravDir > 1.3
          ) {
            pl.vy = 1.4 * sim.gravDir;
            pl.jumpsLeft = Math.max(pl.jumpsLeft, 1);
            if (up && !pl.jumpKeyLock) {
              pl.vy = -cfg.jumpForce * 0.96 * sim.gravDir;
              pl.vx = -wallTouchDir * effSpeed * 1.35;
              pl.facing = -wallTouchDir;
              pl.jumpKeyLock = true;
              playStudioSfx("jump", cfg.sfxEnabled);
              spawnParticles(pl.x + (wallTouchDir > 0 ? pl.w : 0), pl.y + 11, "#e2e8f0", 8);
            }
          }

          // Vertical Move & Platform Collisions
          const prevY = pl.y;
          pl.y += pl.vy;
          pl.grounded = false;
          pl.onIce = false;
          if (pl.y > worldH + 24 || pl.y < -48) {
            damagePlayer();
          }

          for (const mp of sim.movingPlatforms) {
            if (overlap(pl, mp) && pl.vy * sim.gravDir >= 0 && prevY + pl.h <= mp.y + 12) {
              pl.y = mp.y - pl.h;
              pl.vy = 0;
              pl.x += mp.vx;
              pl.y += mp.vy;
              pl.grounded = true;
              pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
              pl.jetpackFuel = 100;
            }
          }
        }

        // Shared Tile Interactions (Solid Y, One-Way, Ice, Conveyor, Spikes, Bounce, Gravity, Teleporter, Switch, Portal)
        const trStart = Math.max(0, Math.floor(pl.y / TILE_SIZE) - 1);
        const trEnd = Math.min(sim.rows - 1, Math.floor((pl.y + pl.h) / TILE_SIZE) + 1);
        const tcStart = Math.max(0, Math.floor(pl.x / TILE_SIZE) - 1);
        const tcEnd = Math.min(sim.cols - 1, Math.floor((pl.x + pl.w) / TILE_SIZE) + 1);

        for (let r = trStart; r <= trEnd; r++) {
          for (let c = tcStart; c <= tcEnd; c++) {
            const cell = activeGrid[r]?.[c] || 0;
            if (cell === 0 || cell === 2 || cell === 3 || cell === 5 || cell === 8 || cell === 9)
              continue;
            const box = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
            if (!overlap(pl, box)) continue;

            if (!use3D && isSolidCell(r, c)) {
              if (sim.gravDir > 0) {
                if (pl.vy > 0) {
                  pl.y = box.y - pl.h;
                  pl.vy = 0;
                  pl.grounded = true;
                  pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
                  pl.jetpackFuel = 100;
                  if (cell === 15) pl.onIce = true;
                  if (cell === 16) pl.x = Math.min(worldW - pl.w, pl.x + 2.6);
                } else if (pl.vy < 0) {
                  pl.y = box.y + box.h;
                  pl.vy = 0;
                }
              } else {
                if (pl.vy < 0) {
                  pl.y = box.y + box.h;
                  pl.vy = 0;
                  pl.grounded = true;
                  pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
                  pl.jetpackFuel = 100;
                } else if (pl.vy > 0) {
                  pl.y = box.y - pl.h;
                  pl.vy = 0;
                }
              }
            } else if (
              !use3D &&
              cell === 13 &&
              sim.gravDir > 0 &&
              !(keys["ArrowDown"] || keys["KeyS"]) &&
              pl.vy >= 0 &&
              pl.y + pl.h - pl.vy <= box.y + 11
            ) {
              pl.y = box.y - pl.h;
              pl.vy = 0;
              pl.grounded = true;
              pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
              pl.jetpackFuel = 100;
            } else if (cell === 4) {
              damagePlayer();
            } else if (cell === 6) {
              playStudioSfx("jump", cfg.sfxEnabled);
              if (use3D) {
                pl.x += Math.cos(pl.angle) * 16;
                pl.y += Math.sin(pl.angle) * 16;
              } else {
                pl.vy = -cfg.jumpForce * 1.42 * sim.gravDir;
                pl.grounded = false;
                pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
              }
              spawnParticles(pl.x + 11, pl.y + 20, "#06b6d4", 9);
            } else if (cell === 18 && pl.tpCooldown <= 0) {
              sim.gravDir *= -1;
              pl.vy = 2.5 * sim.gravDir;
              pl.tpCooldown = 28;
              playStudioSfx("teleport", cfg.sfxEnabled);
              spawnParticles(pl.x + 11, pl.y + 11, "#c084fc", 12);
            } else if (cell === 19 && pl.tpCooldown <= 0 && sim.teleporters.length > 1) {
              const others = sim.teleporters.filter(
                (tp) => Math.hypot(tp.x - box.x, tp.y - box.y) > 22
              );
              if (others.length > 0) {
                const dest = others[Math.floor(Math.random() * others.length)] || others[0]!;
                pl.x = dest.x + 6;
                pl.y = dest.y + 6;
                pl.tpCooldown = 55;
                playStudioSfx("teleport", cfg.sfxEnabled);
                spawnParticles(pl.x + 11, pl.y + 11, "#2dd4bf", 16);
                addPopup(pl.x, pl.y - 8, "WARP!", "#2dd4bf");
              }
            } else if (cell === 20 && pl.tpCooldown <= 0) {
              sim.switchesOn = !sim.switchesOn;
              pl.tpCooldown = 32;
              playStudioSfx("switch", cfg.sfxEnabled);
              spawnParticles(box.x + 17, box.y + 17, "#facc15", 10);
              addPopup(box.x + 10, box.y, sim.switchesOn ? "SWITCH ON!" : "SWITCH OFF", "#4ade80");
              if (sim.switchesOn) fireRuleTrigger("on_switch_on");
            } else if (cell === 7 && activeWinCond === "portal") {
              completeLevelOrGame();
              break;
            }
          }
        }

        // Collect Coins
        for (const coin of sim.coins) {
          if (!coin.taken && overlap(pl, coin)) {
            coin.taken = true;
            sim.score += 10;
            setLiveScore(sim.score);
            playStudioSfx("coin", cfg.sfxEnabled);
            spawnParticles(coin.x + 8, coin.y + 8, "#eab308", 8);
            addPopup(coin.x, coin.y - 6, "+10", "#fde08a");
            syncProgressToCloud({ score: sim.score, coinsAdded: 1 });
            if (sim.score >= 50) fireRuleTrigger("on_score_50");
            if (sim.score >= 150) fireRuleTrigger("on_score_150");
            if (sim.coins.every((c) => c.taken)) {
              fireRuleTrigger("on_all_coins");
              if (activeWinCond === "all_coins") completeLevelOrGame();
            }
          }
        }

        // Collect Keys
        for (const k of sim.keysList) {
          if (!k.taken && overlap(pl, k)) {
            k.taken = true;
            sim.score += 20;
            setLiveScore(sim.score);
            playStudioSfx("powerup", cfg.sfxEnabled);
            spawnParticles(k.x + 10, k.y + 10, "#f59e0b", 12);
            addPopup(k.x, k.y - 8, "KEY UNLOCKED!", "#fbbf24");
          }
        }

        // Checkpoints / +HP Hearts
        for (const cp of sim.checkpoints) {
          if (!cp.used && overlap(pl, cp)) {
            cp.used = true;
            pl.checkpointX = cp.x;
            pl.checkpointY = cp.y;
            if (pl.hp < (cfg.maxHp || 3)) {
              pl.hp += 1;
              setLiveHp(pl.hp);
            }
            sim.score += 15;
            setLiveScore(sim.score);
            playStudioSfx("powerup", cfg.sfxEnabled);
            spawnParticles(cp.x + 10, cp.y + 10, "#f43f5e", 12);
            addPopup(cp.x, cp.y - 8, "CHECKPOINT +HP", "#fb7185");
          }
        }

        // Overdrive Powerup Orbs
        for (const pu of sim.powerups) {
          if (!pu.taken && overlap(pl, pu)) {
            pu.taken = true;
            pl.overdriveFrames = 450;
            pl.invulnFrames = Math.max(pl.invulnFrames, 260);
            sim.score += 30;
            setLiveScore(sim.score);
            playStudioSfx("powerup", cfg.sfxEnabled);
            spawnParticles(pu.x + 10, pu.y + 10, "#38bdf8", 18);
            addPopup(pu.x, pu.y - 10, "OVERDRIVE!", "#38bdf8");
          }
        }

        // Enemy Spawner Rifts
        for (const sp of sim.spawners) {
          if (!sp.alive) continue;
          sp.cd--;
          if (sp.cd <= 0 && sim.enemies.filter((e) => e.alive).length < 18) {
            sp.cd = 175;
            sim.enemies.push({
              x: sp.x + 2,
              y: sp.y + 2,
              baseY: sp.y + 2,
              w: 24,
              h: 24,
              vx: pl.x >= sp.x ? 1.65 : -1.65,
              vy: 0,
              hp: 1,
              maxHp: 1,
              kind: cfg.mode === "topdown" || cfg.mode === "survivor" ? 9 : 5,
              isBoss: false,
              cd: 65,
              aimAngle: 0,
              alive: true,
            });
            spawnParticles(sp.x + 14, sp.y + 14, "#a855f7", 8);
          }
        }

        // Update Player Projectiles
        for (const b of sim.bullets) {
          if (b.dead) continue;
          if (b.kind === "boomerang" && b.life < 44) {
            const retAng = Math.atan2(pl.y + 11 - b.y, pl.x + 11 - b.x);
            b.vx = Math.cos(retAng) * 10;
            b.vy = Math.sin(retAng) * 10;
          } else if (
            b.kind === "grenade" &&
            cfg.mode !== "topdown" &&
            cfg.mode !== "shooter" &&
            cfg.mode !== "survivor"
          ) {
            b.vy += 0.3 * sim.gravDir;
          }

          b.x += b.vx;
          b.y += b.vy;
          b.life--;

          const br = Math.floor((b.y + b.h / 2) / TILE_SIZE);
          const bc = Math.floor((b.x + b.w / 2) / TILE_SIZE);
          const bRow = activeGrid[br];
          if (br >= 0 && br < sim.rows && bc >= 0 && bc < sim.cols && bRow && bRow[bc] === 14) {
            bRow[bc] = 0;
            spawnParticles(bc * TILE_SIZE + 17, br * TILE_SIZE + 17, "#f59e0b", 8);
            if (b.kind === "grenade") triggerExplosion(b.x, b.y);
            if (!b.pierce) b.dead = true;
          } else if (b.kind !== "sword" && b.kind !== "boomerang" && isSolidCell(br, bc)) {
            if (b.kind === "grenade") triggerExplosion(b.x, b.y);
            b.dead = true;
          }

          for (const tnt of sim.tntBarrels) {
            if (tnt.intact && overlap(b, tnt)) {
              tnt.intact = false;
              triggerExplosion(tnt.x + 14, tnt.y + 14);
              if (!b.pierce) b.dead = true;
            }
          }

          for (const sp of sim.spawners) {
            if (sp.alive && overlap(b, sp)) {
              sp.hp -= 1;
              if (!b.pierce) b.dead = true;
              spawnParticles(sp.x + 14, sp.y + 14, "#c084fc", 8);
              if (sp.hp <= 0) {
                sp.alive = false;
                sim.score += 50;
                setLiveScore(sim.score);
                addPopup(sp.x, sp.y - 8, "+50 RIFT CLOSED!", "#c084fc");
              }
            }
          }

          for (const en of sim.enemies) {
            if (en.alive && overlap(b, en)) {
              en.hp -= 1;
              if (b.kind === "grenade") triggerExplosion(b.x, b.y);
              if (!b.pierce) b.dead = true;
              if (en.hp <= 0) {
                en.alive = false;
                const pts = en.isBoss ? 75 : 25;
                sim.score += pts;
                setLiveScore(sim.score);
                triggerShake(5, 3);
                spawnParticles(en.x + 12, en.y + 12, en.isBoss ? "#ec4899" : "#a855f7", 14);
                addPopup(en.x, en.y - 6, `+${pts}`, en.isBoss ? "#f472b6" : "#d8b4fe");
                if (en.isBoss) fireRuleTrigger("on_boss_defeated");
                if (
                  sim.enemies.every((x) => !x.alive) &&
                  sim.spawners.every((s) => !s.alive)
                ) {
                  fireRuleTrigger("on_all_enemies");
                  if (activeWinCond === "all_enemies") completeLevelOrGame();
                }
              } else {
                spawnParticles(en.x + 12, en.y + 12, "#facc15", 5);
              }
            }
          }

          if (b.life <= 0) {
            if (b.kind === "grenade") triggerExplosion(b.x, b.y);
            b.dead = true;
          }
        }
        sim.bullets = sim.bullets.filter((b) => !b.dead);

        // Update Enemy Turret Bolts
        for (const eb of sim.enemyBullets) {
          eb.x += eb.vx;
          eb.y += eb.vy;
          eb.life--;
          if (overlap(eb, pl)) {
            eb.dead = true;
            damagePlayer();
          }
          const er = Math.floor(eb.y / TILE_SIZE);
          const ec = Math.floor(eb.x / TILE_SIZE);
          if (eb.life <= 0 || isSolidCell(er, ec)) eb.dead = true;
        }
        sim.enemyBullets = sim.enemyBullets.filter((eb) => !eb.dead);

        // Update Enemies (Walkers, Boss Chasers, Flying Sine-Drones, Aimed Laser Turrets)
        for (const en of sim.enemies) {
          if (!en.alive) continue;
          if (en.kind === 24) {
            en.aimAngle = Math.atan2(pl.y + 11 - (en.y + 12), pl.x + 11 - (en.x + 12));
            en.cd--;
            if (en.cd <= 0 && Math.hypot(pl.x - en.x, pl.y - en.y) < 380) {
              en.cd = 88;
              sim.enemyBullets.push({
                x: en.x + 12,
                y: en.y + 12,
                w: 8,
                h: 8,
                vx: Math.cos(en.aimAngle) * 4.3,
                vy: Math.sin(en.aimAngle) * 4.3,
                life: 105,
              });
            }
          } else if (en.kind === 23) {
            en.x += en.vx;
            en.y = en.baseY + Math.sin(sim.tick * 0.075 + en.x * 0.02) * 28;
            const nextCol = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / TILE_SIZE);
            const row = Math.floor((en.y + 12) / TILE_SIZE);
            if (nextCol < 0 || nextCol >= sim.cols || isSolidCell(row, nextCol)) {
              en.vx *= -1;
            }
          } else if (
            en.isBoss &&
            (use3D || cfg.mode === "topdown" || cfg.mode === "shooter" || cfg.mode === "survivor")
          ) {
            const ang = Math.atan2(pl.y - en.y, pl.x - en.x);
            en.x += Math.cos(ang) * 1.3;
            en.y += Math.sin(ang) * 1.3;
          } else {
            en.x += en.vx;
            const nextCol = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / TILE_SIZE);
            const row = Math.floor((en.y + 12) / TILE_SIZE);
            if (nextCol < 0 || nextCol >= sim.cols || isSolidCell(row, nextCol)) {
              en.vx *= -1;
            }
          }

          if (overlap(pl, en)) {
            if (pl.dashFrames > 0) {
              // Dash-strike enemy!
              en.hp -= 1;
              if (en.hp <= 0) {
                en.alive = false;
                sim.score += en.isBoss ? 75 : 25;
                setLiveScore(sim.score);
                spawnParticles(en.x + 12, en.y + 12, "#38bdf8", 12);
                if (en.isBoss) fireRuleTrigger("on_boss_defeated");
              }
            } else if (
              !use3D &&
              (cfg.mode === "platformer" || cfg.mode === "metroidvania") &&
              pl.vy * sim.gravDir > 1 &&
              (sim.gravDir > 0 ? pl.y + pl.h - pl.vy <= en.y + 14 : pl.y - pl.vy >= en.y + en.h - 14)
            ) {
              en.hp -= 1;
              pl.vy = -cfg.jumpForce * 0.85 * sim.gravDir;
              playStudioSfx("jump", cfg.sfxEnabled);
              if (en.hp <= 0) {
                en.alive = false;
                sim.score += en.isBoss ? 75 : 25;
                if (en.isBoss) fireRuleTrigger("on_boss_defeated");
                if (
                  sim.enemies.every((x) => !x.alive) &&
                  sim.spawners.every((s) => !s.alive)
                ) {
                  fireRuleTrigger("on_all_enemies");
                  if (activeWinCond === "all_enemies") completeLevelOrGame();
                }
              }
              setLiveScore(sim.score);
              spawnParticles(en.x + 12, en.y + 12, "#a855f7", 12);
            } else {
              damagePlayer();
            }
          }
        }

        // Survive Timer Win Condition
        if (activeWinCond === "survive_timer") {
          sim.timerFrames--;
          if (sim.timerFrames <= 0) {
            completeLevelOrGame();
          }
        }

        // Smooth Follow Camera with World Bounds Clamping
        const targetCamX = Math.max(0, Math.min(Math.max(0, worldW - CANVAS_W), pl.x + 11 - CANVAS_W / 2));
        const targetCamY = Math.max(0, Math.min(Math.max(0, worldH - CANVAS_H), pl.y + 11 - CANVAS_H / 2));
        sim.camX += (targetCamX - sim.camX) * 0.14;
        sim.camY += (targetCamY - sim.camY) * 0.14;

        // Optional legacy per-frame hook
        if (cfg.customScript && cfg.customScript.trim() && !isForeignProjectRef.current) {
          try {
            const fn = new Function("ctx", "state", "player", cfg.customScript);
            fn(ctx, sim, pl);
          } catch {}
        }
      }

      // =====================================================================
      // RENDER STAGE (FIRST-PERSON 3D OR 2D SCROLLING + EDITOR)
      // =====================================================================
      const globalTick = sim ? sim.tick : Math.floor(performance.now() / 16);

      if (use3D && sim) {
        const W = canvas.width;
        const H = canvas.height;
        const pl = sim.player;
        const fov = Math.PI / 3;
        const numRays = 180;
        const stripW = W / numRays;
        const zBuffer = new Float32Array(numRays);

        const skyGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
        skyGrad.addColorStop(0, "#030712");
        skyGrad.addColorStop(1, lvlBg);
        ctx.fillStyle = skyGrad;
        ctx.fillRect(0, 0, W, H / 2);

        const floorGrad = ctx.createLinearGradient(0, H / 2, 0, H);
        floorGrad.addColorStop(0, "#0b1120");
        floorGrad.addColorStop(1, "#1e293b");
        ctx.fillStyle = floorGrad;
        ctx.fillRect(0, H / 2, W, H / 2);

        const px = (pl.x + 11) / TILE_SIZE;
        const py = (pl.y + 11) / TILE_SIZE;
        const allKeysTaken = sim.keysList.every((k) => k.taken);

        for (let i = 0; i < numRays; i++) {
          const rayAngle = pl.angle - fov / 2 + (i / numRays) * fov;
          const sin = Math.sin(rayAngle);
          const cos = Math.cos(rayAngle);

          let dist = 0;
          let hitId = 0;
          let hitSide = 0;
          const step = 0.032;
          let rx = px;
          let ry = py;

          while (dist < 26) {
            rx += cos * step;
            ry += sin * step;
            dist += step;
            const c = Math.floor(rx);
            const r = Math.floor(ry);
            if (r < 0 || r >= sim.rows || c < 0 || c >= sim.cols) {
              hitId = 1;
              break;
            }
            const cell = activeGrid[r]?.[c] ?? 0;
            if (
              cell === 1 ||
              cell === 8 ||
              cell === 14 ||
              cell === 15 ||
              (cell === 12 && !allKeysTaken && !sim.doorsForcedOpen) ||
              (cell === 21 && !sim.switchesOn && !sim.doorsForcedOpen)
            ) {
              hitId = cell;
              const fracX = Math.abs(rx - Math.round(rx));
              const fracY = Math.abs(ry - Math.round(ry));
              hitSide = fracX < fracY ? 1 : 0;
              break;
            }
          }

          const perpDist = Math.max(0.15, dist * Math.cos(rayAngle - pl.angle));
          zBuffer[i] = perpDist;

          const wallH = Math.min(H * 1.45, (H * 0.92) / perpDist);
          const topY = (H - wallH) / 2;
          const shade =
            Math.max(activeDarkness ? 0.05 : 0.18, 1 - perpDist / (activeDarkness ? 8.5 : 18)) *
            (hitSide ? 0.78 : 1);

          ctx.fillStyle =
            hitId === 12
              ? "#f59e0b"
              : hitId === 21
                ? "#fb7185"
                : hitId === 14
                  ? "#d97706"
                  : hitId === 15
                    ? "#67e8f9"
                    : hitId === 8
                      ? "#6366f1"
                      : lvlWall;
          ctx.globalAlpha = shade;
          ctx.fillRect(i * stripW, topY, stripW + 1, wallH);

          ctx.fillStyle = hitId === 21 ? "#fda4af" : "#38bdf8";
          ctx.fillRect(i * stripW, topY, stripW + 1, 2);
          ctx.fillRect(i * stripW, topY + wallH - 2, stripW + 1, 2);
        }
        ctx.globalAlpha = 1;

        const sprites: { x: number; y: number; color: string; kind: string }[] = [];
        for (const coin of sim.coins) {
          if (!coin.taken) sprites.push({ x: (coin.x + 8) / TILE_SIZE, y: (coin.y + 8) / TILE_SIZE, color: "#eab308", kind: "orb" });
        }
        for (const k of sim.keysList) {
          if (!k.taken) sprites.push({ x: (k.x + 10) / TILE_SIZE, y: (k.y + 10) / TILE_SIZE, color: "#f59e0b", kind: "orb" });
        }
        for (const pu of sim.powerups) {
          if (!pu.taken) sprites.push({ x: (pu.x + 10) / TILE_SIZE, y: (pu.y + 10) / TILE_SIZE, color: "#38bdf8", kind: "orb" });
        }
        for (const tnt of sim.tntBarrels) {
          if (tnt.intact) sprites.push({ x: (tnt.x + 14) / TILE_SIZE, y: (tnt.y + 14) / TILE_SIZE, color: "#f97316", kind: "tnt" });
        }
        for (const en of sim.enemies) {
          if (en.alive) {
            sprites.push({
              x: (en.x + en.w / 2) / TILE_SIZE,
              y: (en.y + en.h / 2) / TILE_SIZE,
              color: en.isBoss ? "#ec4899" : en.kind === 24 ? "#f43f5e" : "#a855f7",
              kind: en.isBoss ? "boss" : "enemy",
            });
          }
        }
        for (const eb of sim.enemyBullets) {
          sprites.push({ x: eb.x / TILE_SIZE, y: eb.y / TILE_SIZE, color: "#fb7185", kind: "orb" });
        }
        for (let r = 0; r < sim.rows; r++) {
          for (let c = 0; c < sim.cols; c++) {
            const id = activeGrid[r]?.[c] ?? 0;
            if (id === 7) sprites.push({ x: c + 0.5, y: r + 0.5, color: "#10b981", kind: "portal" });
            else if (id === 4) sprites.push({ x: c + 0.5, y: r + 0.5, color: "#ef4444", kind: "lava" });
            else if (id === 20) sprites.push({ x: c + 0.5, y: r + 0.5, color: sim.switchesOn ? "#4ade80" : "#facc15", kind: "orb" });
          }
        }

        sprites.sort((a, b) => Math.hypot(b.x - px, b.y - py) - Math.hypot(a.x - px, a.y - py));
        for (const sp of sprites) {
          const sx = sp.x - px;
          const sy = sp.y - py;
          const dist = Math.hypot(sx, sy);
          if (dist < 0.25 || dist > 22) continue;

          let spriteAngle = Math.atan2(sy, sx) - pl.angle;
          while (spriteAngle < -Math.PI) spriteAngle += Math.PI * 2;
          while (spriteAngle > Math.PI) spriteAngle -= Math.PI * 2;
          if (Math.abs(spriteAngle) > fov * 0.7) continue;

          const screenX = (0.5 + spriteAngle / fov) * W;
          const rayIdx = Math.floor((screenX / W) * numRays);
          if (rayIdx >= 0 && rayIdx < numRays && (zBuffer[rayIdx] ?? 999) < dist) continue;

          const size = Math.min(220, (H * 0.65) / dist);
          ctx.fillStyle = sp.color;
          if (sp.kind === "orb") {
            ctx.beginPath();
            ctx.arc(screenX, H / 2 + size * 0.14, size * 0.24, 0, Math.PI * 2);
            ctx.fill();
          } else if (sp.kind === "portal") {
            ctx.strokeStyle = "#10b981";
            ctx.lineWidth = 4;
            ctx.strokeRect(screenX - size * 0.28, H / 2 - size * 0.45, size * 0.56, size * 0.9);
          } else if (sp.kind === "lava") {
            ctx.fillRect(screenX - size * 0.35, H / 2 + size * 0.35, size * 0.7, size * 0.18);
          } else if (sp.kind === "tnt") {
            ctx.fillRect(screenX - size * 0.25, H / 2 - size * 0.1, size * 0.5, size * 0.55);
            ctx.fillStyle = "#fef08a";
            ctx.fillRect(screenX - size * 0.25, H / 2 + size * 0.1, size * 0.5, size * 0.12);
          } else {
            const boxW = sp.kind === "boss" ? size * 0.68 : size * 0.5;
            const boxH = sp.kind === "boss" ? size * 0.85 : size * 0.65;
            ctx.fillRect(screenX - boxW / 2, H / 2 - boxH / 2, boxW, boxH);
            ctx.fillStyle = "#fff";
            ctx.fillRect(screenX - boxW * 0.22, H / 2 - boxH * 0.2, boxW * 0.14, boxW * 0.14);
            ctx.fillRect(screenX + boxW * 0.08, H / 2 - boxH * 0.2, boxW * 0.14, boxW * 0.14);
          }
        }

        // Crosshair & 3D Viewmodel
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 10, H / 2);
        ctx.lineTo(W / 2 + 10, H / 2);
        ctx.moveTo(W / 2, H / 2 - 10);
        ctx.lineTo(W / 2, H / 2 + 10);
        ctx.stroke();

        const bobX = Math.cos(pl.bobPhase) * 6;
        const bobY = Math.abs(Math.sin(pl.bobPhase)) * 6 + (pl.muzzleFlash > 0 ? 8 : 0);
        if (pl.muzzleFlash > 0) {
          ctx.fillStyle = "#38bdf8";
          ctx.beginPath();
          ctx.arc(W * 0.66 + bobX, H - 95 + bobY, 26, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(W * 0.63 + bobX, H - 90 + bobY, 54, 95);
        ctx.fillStyle = cfg.playerColor;
        ctx.fillRect(W * 0.65 + bobX, H - 82 + bobY, 16, 65);

        // Scaled 3D Minimap
        const mmScale = Math.min(5.2, 130 / Math.max(sim.cols, sim.rows));
        ctx.fillStyle = "rgba(9, 13, 22, 0.84)";
        ctx.fillRect(10, 10, sim.cols * mmScale + 4, sim.rows * mmScale + 4);
        for (let r = 0; r < sim.rows; r++) {
          for (let c = 0; c < sim.cols; c++) {
            const id = activeGrid[r]?.[c] ?? 0;
            if (id === 1 || id === 14) {
              ctx.fillStyle = id === 14 ? "#d97706" : lvlWall;
              ctx.fillRect(12 + c * mmScale, 12 + r * mmScale, mmScale, mmScale);
            } else if (id === 7) {
              ctx.fillStyle = "#10b981";
              ctx.fillRect(12 + c * mmScale, 12 + r * mmScale, mmScale, mmScale);
            }
          }
        }
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(12 + px * mmScale - 2, 12 + py * mmScale - 2, 4, 4);
      } else {
        // ===================================================================
        // 2D SCROLLING WORLD & TILE EDITOR RENDERER
        // ===================================================================
        ctx.fillStyle = lvlBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const camX = isPlayingRef.current && sim ? sim.camX : editorCamRef.current.x;
        const camY = isPlayingRef.current && sim ? sim.camY : editorCamRef.current.y;
        const zoom = isPlayingRef.current ? cfg.cameraZoom || 1 : 1;
        const shakeX =
          isPlayingRef.current && sim && sim.shakeFrames > 0
            ? (Math.random() - 0.5) * sim.shakeMag * 2
            : 0;
        const shakeY =
          isPlayingRef.current && sim && sim.shakeFrames > 0
            ? (Math.random() - 0.5) * sim.shakeMag * 2
            : 0;

        // Background Weather (Starfield)
        if (activeWeather === "starfield") {
          ctx.fillStyle = "rgba(226, 232, 240, 0.55)";
          for (let i = 0; i < 42; i++) {
            const sx = ((i * 173 - camX * 0.25) % CANVAS_W + CANVAS_W) % CANVAS_W;
            const sy = ((i * 97 - camY * 0.25) % CANVAS_H + CANVAS_H) % CANVAS_H;
            ctx.fillRect(sx, sy, i % 3 === 0 ? 2.5 : 1.5, i % 3 === 0 ? 2.5 : 1.5);
          }
        }

        ctx.save();
        if (zoom !== 1) {
          ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
          ctx.scale(zoom, zoom);
          ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
        }
        ctx.translate(-Math.round(camX - shakeX), -Math.round(camY - shakeY));

        const visStartC = Math.max(0, Math.floor(camX / TILE_SIZE) - 2);
        const visEndC = Math.min(mapCols - 1, Math.ceil((camX + CANVAS_W) / TILE_SIZE) + 2);
        const visStartR = Math.max(0, Math.floor(camY / TILE_SIZE) - 2);
        const visEndR = Math.min(mapRows - 1, Math.ceil((camY + CANVAS_H) / TILE_SIZE) + 2);

        if (!isPlayingRef.current) {
          ctx.strokeStyle = "rgba(255,255,255,0.055)";
          ctx.lineWidth = 1;
          for (let r = visStartR; r <= visEndR + 1; r++) {
            ctx.beginPath();
            ctx.moveTo(visStartC * TILE_SIZE, r * TILE_SIZE);
            ctx.lineTo((visEndC + 1) * TILE_SIZE, r * TILE_SIZE);
            ctx.stroke();
          }
          for (let c = visStartC; c <= visEndC + 1; c++) {
            ctx.beginPath();
            ctx.moveTo(c * TILE_SIZE, visStartR * TILE_SIZE);
            ctx.lineTo(c * TILE_SIZE, (visEndR + 1) * TILE_SIZE);
            ctx.stroke();
          }
        }

        const allKeysTaken = sim ? sim.keysList.every((k) => k.taken) : false;
        const switchesOn = sim ? sim.switchesOn : false;
        const doorsForcedOpen = sim ? sim.doorsForcedOpen : false;

        for (let r = visStartR; r <= visEndR; r++) {
          for (let c = visStartC; c <= visEndC; c++) {
            const id = activeGrid[r]?.[c] || 0;
            if (id !== 0) {
              drawStudioTile2D(ctx, id, c * TILE_SIZE, r * TILE_SIZE, isPlayingRef.current, {
                wallColor: lvlWall,
                playerColor: cfg.playerColor,
                allKeysTaken,
                switchesOn,
                doorsForcedOpen,
                tick: globalTick,
              });
            }
          }
        }

        // Editor Hover Cursor & Rect/Line Drag Preview
        if (!isPlayingRef.current) {
          const drag = dragShapeRef.current;
          if (drag && drag.active) {
            ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 2;
            const minR = Math.min(drag.r0, drag.r1);
            const maxR = Math.max(drag.r0, drag.r1);
            const minC = Math.min(drag.c0, drag.c1);
            const maxC = Math.max(drag.c0, drag.c1);
            if (drag.tool === "rect") {
              const rx = minC * TILE_SIZE;
              const ry = minR * TILE_SIZE;
              const rw = (maxC - minC + 1) * TILE_SIZE;
              const rh = (maxR - minR + 1) * TILE_SIZE;
              ctx.fillRect(rx, ry, rw, rh);
              ctx.strokeRect(rx, ry, rw, rh);
            } else if (drag.tool === "line") {
              ctx.beginPath();
              ctx.moveTo(drag.c0 * TILE_SIZE + 17, drag.r0 * TILE_SIZE + 17);
              ctx.lineTo(drag.c1 * TILE_SIZE + 17, drag.r1 * TILE_SIZE + 17);
              ctx.stroke();
            }
          } else if (hoverCellRef.current) {
            const { r, c } = hoverCellRef.current;
            if (r >= 0 && r < mapRows && c >= 0 && c < mapCols) {
              ctx.strokeStyle = "rgba(255,255,255,0.45)";
              ctx.lineWidth = 1.5;
              const span = paintTool === "thick" ? 2 : 1;
              ctx.strokeRect(c * TILE_SIZE, r * TILE_SIZE, TILE_SIZE * span, TILE_SIZE * span);
            }
          }
        }

        // Dynamic Play-Mode Entities
        if (isPlayingRef.current && sim) {
          for (const mp of sim.movingPlatforms) {
            ctx.fillStyle = mp.vertical ? "#818cf8" : "#6366f1";
            ctx.fillRect(mp.x, mp.y, mp.w, mp.h);
          }

          for (const coin of sim.coins) {
            if (!coin.taken) {
              ctx.fillStyle = "#eab308";
              ctx.beginPath();
              ctx.arc(coin.x + 8, coin.y + 8, 7, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          for (const k of sim.keysList) {
            if (!k.taken) {
              ctx.fillStyle = "#f59e0b";
              ctx.fillRect(k.x, k.y, k.w, k.h);
            }
          }

          for (const cp of sim.checkpoints) {
            if (!cp.used) {
              ctx.fillStyle = "#f43f5e";
              ctx.beginPath();
              ctx.arc(cp.x + 10, cp.y + 10, 8, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          for (const pu of sim.powerups) {
            if (!pu.taken) {
              ctx.fillStyle = "#38bdf8";
              ctx.beginPath();
              ctx.arc(pu.x + 10, pu.y + 10, 9, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = "#e0f2fe";
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          }

          for (const tnt of sim.tntBarrels) {
            if (tnt.intact) {
              ctx.fillStyle = "#ea580c";
              ctx.fillRect(tnt.x, tnt.y, tnt.w, tnt.h);
              ctx.fillStyle = "#fef08a";
              ctx.fillRect(tnt.x, tnt.y + 10, tnt.w, 8);
            }
          }

          for (const sp of sim.spawners) {
            if (sp.alive) {
              ctx.strokeStyle = "#a855f7";
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(sp.x + 14, sp.y + 14, 12 + Math.sin(sim.tick * 0.15) * 2, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = "#7c3aed";
              ctx.beginPath();
              ctx.arc(sp.x + 14, sp.y + 14, 6, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          for (const en of sim.enemies) {
            if (!en.alive) continue;
            if (en.kind === 24) {
              ctx.fillStyle = "#475569";
              ctx.fillRect(en.x + 2, en.y + 10, 20, 14);
              ctx.fillStyle = "#f43f5e";
              ctx.beginPath();
              ctx.arc(en.x + 12, en.y + 11, 9, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = "#fda4af";
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.moveTo(en.x + 12, en.y + 11);
              ctx.lineTo(
                en.x + 12 + Math.cos(en.aimAngle) * 15,
                en.y + 11 + Math.sin(en.aimAngle) * 15
              );
              ctx.stroke();
            } else if (en.kind === 23) {
              ctx.fillStyle = "#e879f9";
              ctx.beginPath();
              ctx.arc(en.x + 12, en.y + 12, 11, 0, Math.PI * 2);
              ctx.fill();
            } else {
              ctx.fillStyle = en.isBoss ? "#ec4899" : "#a855f7";
              ctx.fillRect(en.x, en.y, en.w, en.h);
            }
            ctx.fillStyle = "#fff";
            ctx.fillRect(en.x + 5, en.y + 6, 4, 4);
            ctx.fillRect(en.x + en.w - 9, en.y + 6, 4, 4);
            if (en.maxHp > 1) {
              ctx.fillStyle = "rgba(0,0,0,0.6)";
              ctx.fillRect(en.x, en.y - 7, en.w, 4);
              ctx.fillStyle = "#ef4444";
              ctx.fillRect(en.x, en.y - 7, (en.w * en.hp) / en.maxHp, 4);
            }
          }

          // Player Projectiles
          for (const b of sim.bullets) {
            if (b.kind === "sword") {
              ctx.strokeStyle = "#38bdf8";
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.arc(b.x + 18, b.y + 18, 18, 0, Math.PI * 2);
              ctx.stroke();
            } else if (b.kind === "grenade") {
              ctx.fillStyle = "#fb923c";
              ctx.beginPath();
              ctx.arc(b.x + 6, b.y + 6, 6, 0, Math.PI * 2);
              ctx.fill();
            } else if (b.kind === "boomerang") {
              ctx.strokeStyle = "#facc15";
              ctx.lineWidth = 3;
              ctx.strokeRect(b.x + 2, b.y + 2, 10, 10);
            } else {
              ctx.fillStyle = b.kind === "laser" ? "#f472b6" : "#38bdf8";
              ctx.fillRect(b.x, b.y, b.w, b.h);
            }
          }

          // Enemy Turret Bolts
          ctx.fillStyle = "#fb7185";
          for (const eb of sim.enemyBullets) {
            ctx.beginPath();
            ctx.arc(eb.x + 4, eb.y + 4, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // Explosion Shockwaves
          for (let i = sim.shockwaves.length - 1; i >= 0; i--) {
            const sw = sim.shockwaves[i];
            if (!sw) continue;
            sw.radius += 7;
            ctx.strokeStyle = sw.color;
            ctx.lineWidth = 3;
            ctx.globalAlpha = Math.max(0, 1 - sw.radius / sw.maxRadius);
            ctx.beginPath();
            ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            if (sw.radius >= sw.maxRadius) sim.shockwaves.splice(i, 1);
          }

          // Particles
          for (let i = sim.particles.length - 1; i >= 0; i--) {
            const pt = sim.particles[i];
            if (!pt) continue;
            pt.x += pt.vx;
            pt.y += pt.vy;
            pt.life--;
            ctx.fillStyle = pt.color;
            ctx.fillRect(pt.x, pt.y, pt.size || 4, pt.size || 4);
            if (pt.life <= 0) sim.particles.splice(i, 1);
          }

          // Hero Dash Afterimage Trail & Hero Body
          for (let i = sim.player.trail.length - 1; i >= 0; i--) {
            const tr = sim.player.trail[i];
            if (!tr) continue;
            tr.alpha -= 0.08;
            if (tr.alpha <= 0) {
              sim.player.trail.splice(i, 1);
              continue;
            }
            ctx.globalAlpha = tr.alpha;
            ctx.fillStyle = "#38bdf8";
            ctx.fillRect(tr.x, tr.y, sim.player.w, sim.player.h);
          }
          ctx.globalAlpha = 1;

          if (sim.player.invulnFrames % 4 < 3) {
            ctx.fillStyle = cfg.playerColor;
            ctx.fillRect(sim.player.x, sim.player.y, sim.player.w, sim.player.h);
            ctx.fillStyle = "#fff";
            const eyeX = sim.player.facing >= 0 ? sim.player.x + 14 : sim.player.x + 3;
            const eyeY = sim.gravDir > 0 ? sim.player.y + 5 : sim.player.y + 13;
            ctx.fillRect(eyeX, eyeY, 5, 5);
          }

          // Shield Ring when invincible > 70 frames
          if (sim.player.invulnFrames > 70) {
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(sim.player.x + 11, sim.player.y + 11, 17, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Jetpack Fuel Bar above Hero
          if (cfg.enableJetpack && sim.player.jetpackFuel < 99) {
            ctx.fillStyle = "rgba(0,0,0,0.65)";
            ctx.fillRect(sim.player.x - 2, sim.player.y - 9, 26, 4);
            ctx.fillStyle = "#38bdf8";
            ctx.fillRect(sim.player.x - 2, sim.player.y - 9, (26 * sim.player.jetpackFuel) / 100, 4);
          }

          // NPC / Lore Signpost Dialogue Bubble when Hero is near
          const signMsg = (activeLvl?.signText || "").trim();
          if (signMsg) {
            for (const sg of sim.signs) {
              if (Math.hypot(sim.player.x + 11 - sg.x, sim.player.y + 11 - sg.y) < 82) {
                ctx.font = "11.5px Lexend, sans-serif";
                const textW = Math.min(270, ctx.measureText(signMsg).width + 20);
                const bx = Math.max(8, Math.min(worldW - textW - 8, sg.x - textW / 2));
                const by = Math.max(8, sg.y - 34);
                ctx.fillStyle = "rgba(9, 13, 22, 0.92)";
                ctx.fillRect(bx, by, textW, 24);
                ctx.strokeStyle = "#fde047";
                ctx.lineWidth = 1.5;
                ctx.strokeRect(bx, by, textW, 24);
                ctx.fillStyle = "#fef9c3";
                ctx.textAlign = "center";
                ctx.fillText(signMsg.slice(0, 48), bx + textW / 2, by + 16);
              }
            }
          }

          // Floating Score / Action Popups
          ctx.font = "bold 11.5px Lexend, sans-serif";
          ctx.textAlign = "center";
          for (let i = sim.popups.length - 1; i >= 0; i--) {
            const pop = sim.popups[i];
            if (!pop) continue;
            pop.y -= 0.7;
            pop.life--;
            ctx.globalAlpha = Math.min(1, pop.life / 20);
            ctx.fillStyle = pop.color;
            ctx.fillText(pop.text, pop.x, pop.y);
            if (pop.life <= 0) sim.popups.splice(i, 1);
          }
          ctx.globalAlpha = 1;
        }

        ctx.restore();

        // Foreground Weather Overlay (Rain, Snow, Embers, Matrix)
        if (isPlayingRef.current && sim && activeWeather !== "none" && activeWeather !== "starfield") {
          ctx.font = "11px monospace";
          for (const d of sim.weatherDrops) {
            d.x = ((d.x + d.vx) % CANVAS_W + CANVAS_W) % CANVAS_W;
            d.y = ((d.y + d.vy) % CANVAS_H + CANVAS_H) % CANVAS_H;
            if (activeWeather === "rain") {
              ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(d.x, d.y);
              ctx.lineTo(d.x - 3, d.y + 9);
              ctx.stroke();
            } else if (activeWeather === "snow") {
              ctx.fillStyle = "rgba(241, 245, 249, 0.75)";
              ctx.beginPath();
              ctx.arc(d.x, d.y, d.size, 0, Math.PI * 2);
              ctx.fill();
            } else if (activeWeather === "embers") {
              ctx.fillStyle = "rgba(251, 146, 60, 0.75)";
              ctx.fillRect(d.x, d.y, 3, 3);
            } else if (activeWeather === "matrix") {
              ctx.fillStyle = "rgba(74, 222, 128, 0.55)";
              ctx.fillText(d.char || "1", d.x, d.y);
            }
          }
        }

        // Dynamic Flashlight / Darkness Atmosphere Overlay
        if (isPlayingRef.current && sim && activeDarkness) {
          const heroScreenX = sim.player.x + 11 - sim.camX;
          const heroScreenY = sim.player.y + 11 - sim.camY;
          const radGrad = ctx.createRadialGradient(
            heroScreenX,
            heroScreenY,
            34,
            heroScreenX,
            heroScreenY,
            195
          );
          radGrad.addColorStop(0, "rgba(2, 6, 16, 0)");
          radGrad.addColorStop(0.65, "rgba(2, 6, 16, 0.72)");
          radGrad.addColorStop(1, "rgba(2, 6, 16, 0.94)");
          ctx.fillStyle = radGrad;
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }

        // Interactive Minimap Overlay when World > 20x12
        if (mapCols > VIEWPORT_COLS || mapRows > VIEWPORT_ROWS) {
          const mmScale = Math.min(3.4, 136 / Math.max(mapCols, mapRows));
          const mmW = mapCols * mmScale;
          const mmH = mapRows * mmScale;
          const mmX = CANVAS_W - mmW - 10;
          const mmY = 10;
          ctx.fillStyle = "rgba(9, 13, 22, 0.82)";
          ctx.fillRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);
          ctx.strokeStyle = "rgba(255,255,255,0.2)";
          ctx.lineWidth = 1;
          ctx.strokeRect(mmX - 2, mmY - 2, mmW + 4, mmH + 4);

          for (let r = 0; r < mapRows; r++) {
            for (let c = 0; c < mapCols; c++) {
              const id = activeGrid[r]?.[c] || 0;
              if (id === 1 || id === 14 || id === 15) {
                ctx.fillStyle = lvlWall;
                ctx.fillRect(mmX + c * mmScale, mmY + r * mmScale, mmScale, mmScale);
              } else if (id === 7) {
                ctx.fillStyle = "#10b981";
                ctx.fillRect(mmX + c * mmScale, mmY + r * mmScale, mmScale + 1, mmScale + 1);
              } else if (id === 4) {
                ctx.fillStyle = "#ef4444";
                ctx.fillRect(mmX + c * mmScale, mmY + r * mmScale, mmScale, mmScale);
              }
            }
          }
          // Viewport frame on minimap
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 1.2;
          ctx.strokeRect(
            mmX + (camX / TILE_SIZE) * mmScale,
            mmY + (camY / TILE_SIZE) * mmScale,
            VIEWPORT_COLS * mmScale,
            VIEWPORT_ROWS * mmScale
          );
          if (isPlayingRef.current && sim) {
            ctx.fillStyle = cfg.playerColor;
            ctx.fillRect(
              mmX + (sim.player.x / TILE_SIZE) * mmScale - 1.5,
              mmY + (sim.player.y / TILE_SIZE) * mmScale - 1.5,
              3.5,
              3.5
            );
          }
        }
      }

      // Live HUD Banner, Survive Timer & Win/Loss Overlay
      if (isPlayingRef.current && sim) {
        if (activeWinCond === "survive_timer" && sim.status === "playing") {
          ctx.fillStyle = "rgba(9, 13, 22, 0.84)";
          ctx.fillRect(12, 10, 128, 26);
          ctx.fillStyle = "#facc15";
          ctx.font = "bold 12px Lexend, sans-serif";
          ctx.textAlign = "left";
          ctx.fillText(`survive: ${Math.max(0, Math.ceil(sim.timerFrames / 60))}s`, 22, 27);
        }

        if (sim.levelBannerFrames > 0 && sim.status === "playing") {
          ctx.fillStyle = "rgba(9, 13, 22, 0.84)";
          ctx.fillRect(CANVAS_W / 2 - 185, 12, 370, 30);
          ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
          ctx.lineWidth = 1;
          ctx.strokeRect(CANVAS_W / 2 - 185, 12, 370, 30);
          ctx.fillStyle = "#38bdf8";
          ctx.font = "bold 12.5px Lexend, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(sim.bannerText.slice(0, 56), CANVAS_W / 2, 31);
        }

        if (sim.status !== "playing") {
          ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = sim.status === "won" ? "#4ade80" : "#f87171";
          ctx.font = "bold 24px Lexend, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            sim.status === "won"
              ? `ALL ${cfg.levels.length} LEVELS COMPLETED! (+25 COINS)`
              : "GAME OVER — OUT OF HEARTS",
            canvas.width / 2,
            canvas.height / 2 - 10
          );
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "13.5px Lexend, sans-serif";
          ctx.fillText(
            `final score: ${sim.score} · synced to cloudsync · press R to play again`,
            canvas.width / 2,
            canvas.height / 2 + 22
          );
        }
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [visible, subTab, playingCustomHtmlGame, paintTool, initSimulation, syncProgressToCloud]);

  const updateCurrentLevelGrid = (updater: (prevGrid: number[][]) => number[][]) => {
    setLevels((prevLevels) =>
      prevLevels.map((lvl, idx) =>
        idx === activeLevelIdx ? { ...lvl, grid: updater(lvl.grid) } : lvl
      )
    );
  };

  const getCanvasCellFromEvent = (e: MouseEvent): { r: number; c: number; canvasX: number; canvasY: number } | null => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    const c = Math.floor((canvasX + editorCamRef.current.x) / TILE_SIZE);
    const r = Math.floor((canvasY + editorCamRef.current.y) / TILE_SIZE);
    return { r, c, canvasX, canvasY };
  };

  const applySingleOrThickPaint = (row: number, col: number, brushId: number) => {
    updateCurrentLevelGrid((prev) => {
      const { rows, cols } = getGridDimensions(prev);
      if (row < 0 || row >= rows || col < 0 || col >= cols) return prev;
      const copy = prev.map((r) => [...r]);
      if (brushId === 2) {
        for (let r = 0; r < rows; r++) {
          const rowArr = copy[r];
          if (!rowArr) continue;
          for (let c = 0; c < cols; c++) {
            if (rowArr[c] === 2) rowArr[c] = 0;
          }
        }
        const targetRow = copy[row];
        if (targetRow) targetRow[col] = 2;
        return copy;
      }
      const span = paintTool === "thick" ? 2 : 1;
      for (let dr = 0; dr < span; dr++) {
        const targetRow = copy[row + dr];
        if (!targetRow) continue;
        for (let dc = 0; dc < span; dc++) {
          if (row + dr < rows && col + dc < cols) {
            targetRow[col + dc] = brushId;
          }
        }
      }
      return copy;
    });
  };

  const handleCanvasMouseDown = (e: MouseEvent) => {
    const pos = getCanvasCellFromEvent(e);
    if (!pos) return;
    mouseCanvasPosRef.current = { x: pos.canvasX, y: pos.canvasY };

    if (isPlaying) {
      if (e.button === 0) {
        mouseFireRef.current = true;
        mouseHeldRef.current = true;
        if (
          (mode === "fps3d" || render3DInTest) &&
          canvasRef.current &&
          document.pointerLockElement !== canvasRef.current
        ) {
          canvasRef.current.requestPointerLock?.();
        }
      }
      return;
    }

    // Check if user clicked inside the top-right minimap to jump camera!
    const { rows, cols } = getGridDimensions(currentLevel?.grid);
    if (cols > VIEWPORT_COLS || rows > VIEWPORT_ROWS) {
      const mmScale = Math.min(3.4, 136 / Math.max(cols, rows));
      const mmW = cols * mmScale;
      const mmH = rows * mmScale;
      const mmX = CANVAS_W - mmW - 10;
      const mmY = 10;
      if (
        pos.canvasX >= mmX - 4 &&
        pos.canvasX <= mmX + mmW + 4 &&
        pos.canvasY >= mmY - 4 &&
        pos.canvasY <= mmY + mmH + 4
      ) {
        const targetCol = (pos.canvasX - mmX) / mmScale;
        const targetRow = (pos.canvasY - mmY) / mmScale;
        editorCamRef.current.x = Math.max(
          0,
          Math.min(cols * TILE_SIZE - CANVAS_W, targetCol * TILE_SIZE - CANVAS_W / 2)
        );
        editorCamRef.current.y = Math.max(
          0,
          Math.min(rows * TILE_SIZE - CANVAS_H, targetRow * TILE_SIZE - CANVAS_H / 2)
        );
        return;
      }
    }

    // Middle-click or Space+Click pans editor camera
    if (e.button === 1 || keysRef.current["Space"]) {
      e.preventDefault();
      isPanningEditorRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      return;
    }

    const effectiveBrush = e.button === 2 ? 0 : selectedBrush;
    paintButtonRef.current = e.button;

    if (pos.r < 0 || pos.r >= rows || pos.c < 0 || pos.c >= cols || !currentLevel) return;
    pushUndoSnapshot(currentLevel.grid);

    if (paintTool === "bucket" && e.button !== 2) {
      updateCurrentLevelGrid((prev) => applyFloodFill(prev, pos.r, pos.c, effectiveBrush));
      return;
    }

    if ((paintTool === "rect" || paintTool === "line") && e.button !== 2) {
      dragShapeRef.current = {
        active: true,
        tool: paintTool,
        r0: pos.r,
        c0: pos.c,
        r1: pos.r,
        c1: pos.c,
        brushId: effectiveBrush,
      };
      return;
    }

    isPaintingRef.current = true;
    applySingleOrThickPaint(pos.r, pos.c, effectiveBrush);
  };

  const handleCanvasMouseMove = (e: MouseEvent) => {
    const pos = getCanvasCellFromEvent(e);
    if (pos) {
      mouseCanvasPosRef.current = { x: pos.canvasX, y: pos.canvasY };
      hoverCellRef.current = { r: pos.r, c: pos.c };
    }

    if (isPlaying) {
      if (mode === "fps3d" || render3DInTest) {
        if (document.pointerLockElement === canvasRef.current || e.buttons === 1) {
          mouseLookDeltaRef.current += e.movementX || 0;
        }
      }
      return;
    }

    if (isPanningEditorRef.current.active) {
      const dx = e.clientX - isPanningEditorRef.current.lastX;
      const dy = e.clientY - isPanningEditorRef.current.lastY;
      isPanningEditorRef.current.lastX = e.clientX;
      isPanningEditorRef.current.lastY = e.clientY;
      const { rows, cols } = getGridDimensions(currentLevel?.grid);
      editorCamRef.current.x = Math.max(
        0,
        Math.min(Math.max(0, cols * TILE_SIZE - CANVAS_W), editorCamRef.current.x - dx * 1.4)
      );
      editorCamRef.current.y = Math.max(
        0,
        Math.min(Math.max(0, rows * TILE_SIZE - CANVAS_H), editorCamRef.current.y - dy * 1.4)
      );
      return;
    }

    if (dragShapeRef.current?.active && pos) {
      dragShapeRef.current.r1 = pos.r;
      dragShapeRef.current.c1 = pos.c;
      return;
    }

    if (isPaintingRef.current && pos) {
      const effectiveBrush = paintButtonRef.current === 2 ? 0 : selectedBrush;
      applySingleOrThickPaint(pos.r, pos.c, effectiveBrush);
    }
  };

  const handleCanvasMouseUp = () => {
    mouseFireRef.current = false;
    mouseHeldRef.current = false;
    isPaintingRef.current = false;
    isPanningEditorRef.current.active = false;

    if (dragShapeRef.current?.active) {
      const drag = dragShapeRef.current;
      dragShapeRef.current = null;
      updateCurrentLevelGrid((prev) =>
        drag.tool === "rect"
          ? applyRectPaint(prev, drag.r0, drag.c0, drag.r1, drag.c1, drag.brushId)
          : applyLinePaint(prev, drag.r0, drag.c0, drag.r1, drag.c1, drag.brushId)
      );
    }
  };

  const applyTemplate = (preset: GameMode) => {
    setIsPlaying(false);
    setGameStatus("editing");
    setMode(preset);
    setRender3DInTest(preset === "fps3d");
    setLevels(makeDefaultStudioLevels(preset));
    setActiveLevelIdx(0);
    editorCamRef.current = { x: 0, y: 0 };
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoCount(0);
    setRedoCount(0);

    if (preset === "platformer" || preset === "metroidvania") {
      setGravity(0.55);
      setJumpForce(11.5);
      setMoveSpeed(4.4);
      setEnableWallJump(true);
      setEnableJetpack(preset === "metroidvania");
      setWinCondition("portal");
    } else if (preset === "fps3d" || preset === "topdown") {
      setGravity(0);
      setJumpForce(0);
      setMoveSpeed(4.0);
      setWinCondition("portal");
    } else if (preset === "shooter") {
      setGravity(0);
      setJumpForce(0);
      setMoveSpeed(4.6);
      setWeaponType("shotgun");
      setMouseAim(true);
      setWinCondition("portal");
    } else if (preset === "survivor") {
      setGravity(0);
      setJumpForce(0);
      setMoveSpeed(4.5);
      setWeaponType("blaster");
      setAutoFire(true);
      setWinCondition("survive_timer");
      setTimeLimitSec(45);
    } else if (preset === "gravrunner") {
      setGravity(0.6);
      setJumpForce(10.5);
      setMoveSpeed(4.8);
      setWinCondition("portal");
    } else if (preset === "flappy") {
      setGravity(0.42);
      setJumpForce(7.8);
      setMoveSpeed(2.8);
      setWinCondition("portal");
    }
  };

  const handleChangeWorldSize = (sizeKey: WorldSizePreset) => {
    const target = WORLD_SIZE_PRESETS[sizeKey];
    if (!target || !currentLevel) return;
    setIsPlaying(false);
    pushUndoSnapshot(currentLevel.grid);
    const anchorBottom = mode === "platformer" || mode === "metroidvania";
    setLevels((prev) =>
      prev.map((lvl, idx) =>
        idx === activeLevelIdx
          ? {
              ...lvl,
              worldSize: sizeKey,
              grid: resizeLevelGrid(lvl.grid, target.rows, target.cols, anchorBottom),
            }
          : lvl
      )
    );
    editorCamRef.current = { x: 0, y: 0 };
    notifyToast(`resized level ${activeLevelIdx + 1} to ${target.label}`, "info");
  };

  const handleProceduralGenerateStage = () => {
    if (!currentLevel) return;
    setIsPlaying(false);
    pushUndoSnapshot(currentLevel.grid);
    const { rows, cols } = getGridDimensions(currentLevel.grid);
    const generated = generateProceduralLevel(mode, rows, cols, Math.floor(Math.random() * 1000));
    updateCurrentLevelGrid(() => generated);
    notifyToast(`generated new ${cols}×${rows} ${mode} stage!`, "success");
  };

  const handleAddLevel = () => {
    setIsPlaying(false);
    setLevels((prev) => {
      const nextNum = prev.length + 1;
      const curSize = inferWorldSizePreset(prev[activeLevelIdx]?.grid);
      const dims = WORLD_SIZE_PRESETS[curSize];
      const newLvl: StudioGameLevel = {
        id: `lvl_${Date.now()}`,
        name: `level ${nextNum}: sector ${nextNum}`,
        worldSize: curSize,
        grid: generateProceduralLevel(mode, dims.rows, dims.cols, nextNum * 37),
        bgColor,
        wallColor,
        weather,
        winCondition,
        timeLimitSec,
      };
      const updated = [...prev, newLvl];
      setActiveLevelIdx(updated.length - 1);
      return updated;
    });
    editorCamRef.current = { x: 0, y: 0 };
    notifyToast("added new generated level to your game!", "success");
  };

  const handleDuplicateLevel = () => {
    setIsPlaying(false);
    setLevels((prev) => {
      const src = prev[activeLevelIdx] || prev[0];
      if (!src) return prev;
      const nextNum = prev.length + 1;
      const copy: StudioGameLevel = {
        ...src,
        id: `lvl_${Date.now()}`,
        name: `level ${nextNum} (copy)`,
        grid: src.grid.map((r) => [...r]),
      };
      const updated = [...prev, copy];
      setActiveLevelIdx(updated.length - 1);
      return updated;
    });
    notifyToast("duplicated current level", "info");
  };

  const handleDeleteLevel = () => {
    if (levels.length <= 1) {
      notifyToast("your game must have at least 1 level", "error");
      return;
    }
    setIsPlaying(false);
    setLevels((prev) => {
      const next = prev.filter((_, idx) => idx !== activeLevelIdx);
      setActiveLevelIdx(Math.max(0, activeLevelIdx - 1));
      return next;
    });
    notifyToast("removed level", "info");
  };

  const handleTogglePlayTest = (startAtLevel = activeLevelIdx) => {
    if (isPlaying) {
      setIsPlaying(false);
      setGameStatus("editing");
    } else {
      initSimulation(startAtLevel, 0);
      setIsPlaying(true);
    }
  };

  const getActiveAuthor = (): string => getCloudSyncState().username;

  const buildCurrentProjectSnapshot = (): StudioGameProject => ({
    id: activeGameId,
    title: title || "preview game",
    description,
    author: getActiveAuthor(),
    studioName: userStudio.name,
    studioColor: userStudio.color,
    mode,
    grid: (levels[0]?.grid || createSizedEmptyGrid()).map((r) => [...r]),
    levels: levels.map((l) => ({ ...l, grid: l.grid.map((r) => [...r]) })),
    gravity,
    jumpForce,
    moveSpeed,
    maxHp,
    enableDoubleJump,
    enableWallJump,
    enableDash,
    enableJetpack,
    enableBlaster: weaponType !== "none",
    weaponType,
    mouseAim,
    autoFire,
    winCondition,
    timeLimitSec,
    weather,
    darknessMode,
    sfxEnabled,
    screenShake,
    cameraZoom,
    rules,
    playerColor,
    bgColor,
    wallColor,
    customScript,
    likes: 0,
    plays: 0,
    createdAt: new Date().toISOString(),
  });

  const handleExportStandaloneHtmlFile = () => {
    const snap = buildCurrentProjectSnapshot();
    const html = buildStandaloneGameHtml(snap);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(snap.title || "studio_game").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notifyToast("exported standalone playable .html game!", "success");
  };

  const handleSaveStudioProfile = async (e: Event) => {
    e.preventDefault();
    const cleanName = studioNameInput.trim();
    if (!cleanName) {
      notifyToast("enter a name for your game studio", "error");
      return;
    }
    const mod = await moderateChatMessage(`${cleanName} ${studioTaglineInput}`);
    if (mod.blocked) {
      notifyToast(mod.reason || "studio name blocked by moderation", "error");
      return;
    }
    const updated: StudioProfile = {
      ...userStudio,
      name: cleanName,
      tagline: studioTaglineInput.trim() || "independent game studio",
      color: studioColorInput,
      icon: studioIconInput,
      owner: getActiveAuthor(),
    };
    saveUserStudio(updated);
    setUserStudio(updated);
    notifyToast(`saved studio "${cleanName}"!`, "success");
  };

  const handleClaimStudioEarnings = () => {
    if (userStudio.unclaimedCoins <= 0) {
      notifyToast("publish games or get plays to earn more studio royalties!", "info");
      return;
    }
    const amount = userStudio.unclaimedCoins;
    addCookieCoins(amount, `studio royalties from ${userStudio.name}`);
    const updated: StudioProfile = {
      ...userStudio,
      coinsEarned: (userStudio.coinsEarned || 0) + amount,
      unclaimedCoins: 0,
    };
    saveUserStudio(updated);
    setUserStudio(updated);
  };

  const handleHtmlFileSelect = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      notifyToast("html file too large (max 5MB)", "error");
      return;
    }
    setHtmlFileName(file.name);
    if (!htmlTitle.trim()) {
      setHtmlTitle(file.name.replace(/\.html?$/i, "").replace(/[-_]/g, " "));
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setCustomHtmlCode(reader.result);
        setPreviewRefreshTick((t) => t + 1);
        notifyToast(`loaded ${file.name} (${reader.result.length} bytes)`, "success");
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    if (!visible || subTab !== "htmlupload") return;
    const timer = window.setTimeout(() => {
      const fullHtml = injectCloudSyncBridgeIntoHtml(customHtmlCode, {
        id: "html_preview",
        title: htmlTitle || "preview",
        description: htmlDesc,
        author: getActiveAuthor(),
        mode: "custom_html",
        grid: [],
        gravity: 0,
        jumpForce: 0,
        moveSpeed: 0,
        playerColor: "#fff",
        bgColor: "#000",
        wallColor: "#fff",
        customScript: "",
        likes: 0,
        plays: 0,
        createdAt: "",
      });
      const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
      const nextUrl = URL.createObjectURL(blob);
      setHtmlPreviewBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [visible, subTab, customHtmlCode, htmlTitle, htmlDesc, previewRefreshTick]);

  useEffect(() => {
    if (!playingCustomHtmlGame || !playingCustomHtmlGame.customHtmlContent) {
      setPlayingCustomBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return "";
      });
      return;
    }
    const fullHtml = injectCloudSyncBridgeIntoHtml(
      playingCustomHtmlGame.customHtmlContent,
      playingCustomHtmlGame
    );
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const nextUrl = URL.createObjectURL(blob);
    setPlayingCustomBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [playingCustomHtmlGame]);

  const publishStudioGameToServer = useCallback(
    async (gamePayload: StudioGameProject): Promise<StudioGameProject> => {
      let authToken = "";
      try {
        authToken =
          localStorage.getItem("cloudsync_token") || localStorage.getItem("auth_token") || "";
      } catch {}
      const res = await fetch("/api/studio/games", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ game: gamePayload }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data?.game) {
        throw new Error(
          data?.error || `Failed to publish to global library (HTTP ${res.status})`
        );
      }
      return data.game as StudioGameProject;
    },
    []
  );

  const handleRepublishGame = useCallback(
    async (g: StudioGameProject) => {
      try {
        const saved = await publishStudioGameToServer({
          ...g,
          author: g.author || getActiveAuthor(),
        });
        setServerGameIds((prev) => new Set(prev).add(saved.id));
        mergePublishedGame(saved);
        try {
          broadcastRef.current?.postMessage({ type: "GAME_PUBLISHED", game: saved });
        } catch {}
        notifyToast(`republished "${saved.title}" to community library!`, "success");
      } catch (err) {
        notifyToast(
          (err as Error)?.message || "failed to republish game to server",
          "error"
        );
      }
    },
    [publishStudioGameToServer, mergePublishedGame]
  );

  const handlePublishCustomHtmlGame = async (e: Event) => {
    e.preventDefault();
    if (isUploadingHtml) return;
    const cleanTitle = htmlTitle.trim();
    if (!cleanTitle) {
      notifyToast("enter a game title for your custom index.html game", "error");
      return;
    }
    if (!customHtmlCode.trim()) {
      notifyToast("upload or paste an index.html file first", "error");
      return;
    }
    if (new Blob([customHtmlCode]).size > 5 * 1024 * 1024) {
      notifyToast("custom index.html exceeds 5MB limit", "error");
      return;
    }
    if (coins < CUSTOM_HTML_UPLOAD_COST) {
      notifyToast(
        `you need ${CUSTOM_HTML_UPLOAD_COST} cookie coins to publish a custom index.html studio game (you have ${coins} coins)`,
        "error"
      );
      return;
    }

    setIsUploadingHtml(true);
    try {
      const mod = await moderateChatMessage(`${cleanTitle} ${htmlDesc}`);
      if (mod.blocked) {
        notifyToast(mod.reason || "title or description blocked by moderation", "error");
        return;
      }

      const newGame: StudioGameProject = {
        id: `htmlgame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: cleanTitle,
        description:
          htmlDesc.trim() || `custom index.html game served by ${userStudio.name}`,
        author: getActiveAuthor(),
        studioName: userStudio.name,
        studioColor: userStudio.color,
        mode: "custom_html",
        grid: createSizedEmptyGrid(),
        levels: [],
        gravity: 0.5,
        jumpForce: 10,
        moveSpeed: 4,
        playerColor: userStudio.color || "#38bdf8",
        bgColor: "#060913",
        wallColor: "#38bdf8",
        customScript: "",
        isCustomHtml: true,
        customHtmlContent: customHtmlCode,
        likes: 1,
        plays: 1,
        createdAt: new Date().toISOString(),
      };

      const savedGame = await publishStudioGameToServer(newGame);
      if (!spendCookieCoins(CUSTOM_HTML_UPLOAD_COST)) {
        notifyToast(`insufficient cookie coins (${CUSTOM_HTML_UPLOAD_COST} required)`, "error");
        return;
      }
      setCoins(getCookieCoins());

      setServerGameIds((prev) => new Set(prev).add(savedGame.id));
      mergePublishedGame(savedGame);
      try {
        broadcastRef.current?.postMessage({ type: "GAME_PUBLISHED", game: savedGame });
      } catch {}

      notifyToast(
        `published custom index.html game "${savedGame.title}" under ${userStudio.name}! (-1,000 coins)`,
        "success"
      );
      setSubTab("community");
    } catch (err) {
      notifyToast(
        (err as Error)?.message || "failed to publish custom game to community library",
        "error"
      );
    } finally {
      setIsUploadingHtml(false);
    }
  };

  const handlePublishGame = async (e: Event) => {
    e.preventDefault();
    if (isPublishing) return;
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      notifyToast("enter a title for your game before publishing", "error");
      return;
    }

    setIsPublishing(true);
    try {
      const mod = await moderateChatMessage(`${cleanTitle} ${description}`);
      if (mod.blocked) {
        notifyToast(mod.reason || "game title or description blocked by moderation", "error");
        return;
      }

      const canUpdateExisting =
        !isForeignProjectRef.current &&
        activeGameId &&
        activeGameId !== "editor_preview" &&
        !activeGameId.startsWith("htmlgame_");

      const snap = buildCurrentProjectSnapshot();
      const newGame: StudioGameProject = {
        ...snap,
        id: canUpdateExisting
          ? activeGameId
          : `game_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: cleanTitle,
        description: description.trim() || `built by ${userStudio.name}`,
        likes: 1,
        plays: 1,
      };

      const savedGame = await publishStudioGameToServer(newGame);
      setServerGameIds((prev) => new Set(prev).add(savedGame.id));
      mergePublishedGame(savedGame);
      setActiveGameId(savedGame.id);
      try {
        broadcastRef.current?.postMessage({ type: "GAME_PUBLISHED", game: savedGame });
      } catch {}

      addCookieCoins(50, `published "${savedGame.title}" under ${userStudio.name}`);
      awardGamePassXp(40, "game", { label: `published ${savedGame.title}` });
      const updatedStudio: StudioProfile = {
        ...userStudio,
        coinsEarned: (userStudio.coinsEarned || 0) + 50,
        unclaimedCoins: (userStudio.unclaimedCoins || 0) + 25,
      };
      saveUserStudio(updatedStudio);
      setUserStudio(updatedStudio);

      setSubTab("community");
    } catch (err) {
      notifyToast(
        (err as Error)?.message || "failed to publish game to community library",
        "error"
      );
    } finally {
      setIsPublishing(false);
    }
  };

  const loadGameIntoEngine = (g: StudioGameProject, autoPlay: boolean) => {
    setActiveGameId(g.id);
    fetchCloudProgressForGame(g.id);

    setCommunityGames((prev) =>
      prev.map((item) => (item.id === g.id ? { ...item, plays: (item.plays || 0) + 1 } : item))
    );
    recordGameActivity(g.title, 10, 1);

    if (
      g.studioName?.toLowerCase() === userStudio.name.toLowerCase() ||
      g.author.toLowerCase() === getActiveAuthor().toLowerCase()
    ) {
      const updatedStudio = {
        ...userStudio,
        unclaimedCoins: (userStudio.unclaimedCoins || 0) + 10,
      };
      saveUserStudio(updatedStudio);
      setUserStudio(updatedStudio);
    }

    fetch(`/api/studio/games/${encodeURIComponent(g.id)}/stat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field: "plays" }),
    }).catch(() => {});

    if (g.isCustomHtml && g.customHtmlContent) {
      if (autoPlay) {
        setPlayingCustomHtmlGame(g);
        setSubTab("editor");
        return;
      } else {
        setPlayingCustomHtmlGame(null);
        setHtmlTitle(g.title);
        setHtmlDesc(g.description);
        setCustomHtmlCode(g.customHtmlContent);
        setSubTab("htmlupload");
        return;
      }
    }

    setPlayingCustomHtmlGame(null);
    isForeignProjectRef.current = Boolean(
      g.author && g.author.toLowerCase() !== getActiveAuthor().toLowerCase()
    );
    setTitle(g.title);
    setDescription(g.description);
    setMode(g.mode);
    setRender3DInTest(g.mode === "fps3d");
    const loadedLevels =
      Array.isArray(g.levels) && g.levels.length > 0
        ? g.levels.map((l) => ({
            ...l,
            worldSize: l.worldSize || inferWorldSizePreset(l.grid),
            grid: l.grid.map((r) => [...r]),
          }))
        : [
            {
              id: "lvl_1",
              name: "level 1",
              worldSize: inferWorldSizePreset(g.grid),
              grid: g.grid.map((r) => [...r]),
              bgColor: g.bgColor,
              wallColor: g.wallColor,
            },
          ];
    setLevels(loadedLevels);
    setActiveLevelIdx(0);
    editorCamRef.current = { x: 0, y: 0 };
    undoStackRef.current = [];
    redoStackRef.current = [];
    setUndoCount(0);
    setRedoCount(0);

    setGravity(g.gravity);
    setJumpForce(g.jumpForce);
    setMoveSpeed(g.moveSpeed);
    setMaxHp(g.maxHp || 3);
    setEnableDoubleJump(g.enableDoubleJump ?? true);
    setEnableWallJump(g.enableWallJump ?? false);
    setEnableDash(g.enableDash ?? true);
    setEnableJetpack(g.enableJetpack ?? false);
    setWeaponType(g.weaponType || (g.enableBlaster === false ? "none" : "blaster"));
    setMouseAim(g.mouseAim ?? false);
    setAutoFire(g.autoFire ?? false);
    setWinCondition(g.winCondition || "portal");
    setTimeLimitSec(g.timeLimitSec || 45);
    setWeather(g.weather || "none");
    setDarknessMode(Boolean(g.darknessMode));
    setSfxEnabled(g.sfxEnabled ?? true);
    setScreenShake(g.screenShake ?? true);
    setCameraZoom(g.cameraZoom || 1);
    setRules(Array.isArray(g.rules) ? g.rules : []);
    setPlayerColor(g.playerColor);
    setBgColor(g.bgColor);
    setWallColor(g.wallColor);
    setCustomScript(g.customScript || "");
    setSubTab("editor");

    setTimeout(() => {
      if (autoPlay) {
        initSimulation(0, 0);
        setIsPlaying(true);
      } else {
        setIsPlaying(false);
        setGameStatus("editing");
      }
    }, 30);
  };

  const openGameInBrowserTab = (g: StudioGameProject) => {
    recordGameActivity(g.title, 15, 1);
    const html = buildStandaloneGameHtml(g);
    const blob = new Blob([html], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    hide();
    const tab = store.addTab(null, g.title, true);
    tab.isUrlLoaded = true;
    tab.iframe.setAttribute("sandbox", "allow-scripts allow-pointer-lock allow-forms allow-popups");
    tab.iframe.src = blobUrl;
    document.body.classList.add("browser-view");
    store.notify();
  };

  const handleToggleLikeGame = async (g: StudioGameProject) => {
    if (likingGamesRef.current.has(g.id)) return;
    likingGamesRef.current.add(g.id);
    try {
      let token = "";
      try {
        token =
          localStorage.getItem("cloudsync_token") || localStorage.getItem("auth_token") || "";
      } catch {}
      const res = await fetch(`/api/studio/games/${encodeURIComponent(g.id)}/stat`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}`, "x-cloudsync-token": token } : {}),
        },
        body: JSON.stringify({ field: "likes" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notifyToast(data?.error || "could not update like right now", "error");
        return;
      }
      const nowLiked = Boolean(data.liked);
      setLikedGameIds((prev) => {
        const next = new Set(prev);
        if (nowLiked) next.add(g.id);
        else next.delete(g.id);
        try {
          localStorage.setItem("studio_liked_games_v1", JSON.stringify(Array.from(next)));
        } catch {}
        return next;
      });
      if (data.game) {
        setCommunityGames((prev) =>
          prev.map((item) =>
            item.id === g.id
              ? {
                  ...item,
                  likes: Number(data.game.likes ?? item.likes ?? 0),
                  likedBy: Array.isArray(data.game.likedBy) ? data.game.likedBy : item.likedBy,
                }
              : item
          )
        );
      }
      if (Number(data.rewardCoins) > 0) {
        addCookieCoins(Number(data.rewardCoins), `liked ${g.title}`);
      }
    } catch {
      notifyToast("failed to update like", "error");
    } finally {
      likingGamesRef.current.delete(g.id);
    }
  };

  const openLeaderboardOrSpace = (
    gameName: string,
    tab: "leaderboard" | "space" | "cloudplay"
  ) => {
    document.dispatchEvent(
      new CustomEvent("toggleGameSpaceModal", {
        detail: { gameName, tab },
      })
    );
  };

  const filteredCommunityGames = useMemo(() => {
    const q = (chromebookMode ? debouncedSearchQuery : searchQuery).toLowerCase().trim();
    return communityGames.filter((g) => {
      if (modeFilter !== "all" && g.mode !== modeFilter) return false;
      if (!q) return true;
      return (
        g.title.toLowerCase().includes(q) ||
        g.author.toLowerCase().includes(q) ||
        (g.studioName || "").toLowerCase().includes(q) ||
        g.description.toLowerCase().includes(q)
      );
    });
  }, [communityGames, searchQuery, debouncedSearchQuery, chromebookMode, modeFilter]);

  const myStudioGames = useMemo(
    () =>
      communityGames.filter(
        (g) =>
          (g.studioName || "").toLowerCase() === userStudio.name.toLowerCase() ||
          g.author.toLowerCase() === getActiveAuthor().toLowerCase()
      ),
    [communityGames, userStudio.name]
  );

  const visibleBrushes = useMemo(
    () =>
      brushCategory === "all"
        ? STUDIO_BRUSHES
        : STUDIO_BRUSHES.filter((b) => b.category === brushCategory),
    [brushCategory]
  );

  const activeBrushMeta = useMemo(
    () =>
      STUDIO_BRUSHES.find((b) => b.id === selectedBrush) ||
      STUDIO_BRUSHES[0] || {
        id: 1,
        name: "solid wall",
        color: "#3b82f6",
        icon: "fa-square",
        category: "terrain" as const,
        hint: "indestructible wall block",
      },
    [selectedBrush]
  );

  if (!visible) return null;

  const cloudSyncInfo = getCloudSyncState();
  const activeWorldSizeKey = currentLevel?.worldSize || inferWorldSizePreset(currentLevel?.grid);

  return (
    <section
      id="studio-page"
      class={`studio-page${visible ? " is-visible" : ""}${active ? " is-active" : ""}`}
      aria-hidden={!visible}
    >
      {/* Studio Topbar */}
      <div class="studio-topbar">
        <div class="studio-brand">
          <i class={`fa-solid ${userStudio.icon}`} style={{ color: userStudio.color }}></i>
          <span>game studio · {userStudio.name}</span>
          <span
            style={{
              fontSize: "10.5px",
              padding: "2px 8px",
              borderRadius: "10px",
              backgroundColor: cloudSyncInfo.isCloudSynced
                ? "rgba(34, 197, 94, 0.16)"
                : "var(--bg-surface-4)",
              color: cloudSyncInfo.isCloudSynced ? "#4ade80" : "var(--color-sublabel)",
              border: `1px solid ${
                cloudSyncInfo.isCloudSynced ? "rgba(74,222,128,0.4)" : "var(--bg-surface-10)"
              }`,
            }}
            title="CloudSync Player Progression & Level Tracking"
          >
            <i class="fa-solid fa-cloud"></i>{" "}
            {cloudSyncInfo.isCloudSynced
              ? `cloudsync: @${cloudSyncInfo.username}`
              : `local: @${cloudSyncInfo.username}`}
          </span>
        </div>

        <div class="studio-tabs">
          <button
            type="button"
            class={`studio-tab-btn ${subTab === "community" ? "active" : ""}`}
            onClick={() => {
              setIsPlaying(false);
              setPlayingCustomHtmlGame(null);
              setSubTab("community");
            }}
          >
            <i class="fa-solid fa-earth-americas"></i>
            <span>discover games ({communityGames.length})</span>
          </button>

          <button
            type="button"
            class={`studio-tab-btn ${subTab === "mystudio" ? "active" : ""}`}
            onClick={() => {
              setIsPlaying(false);
              setPlayingCustomHtmlGame(null);
              setSubTab("mystudio");
            }}
          >
            <i class="fa-solid fa-building-user"></i>
            <span>my studio & earnings</span>
            {userStudio.unclaimedCoins > 0 && (
              <span class="chat-unread-badge">+{userStudio.unclaimedCoins}</span>
            )}
          </button>

          <button
            type="button"
            class={`studio-tab-btn ${subTab === "editor" ? "active" : ""}`}
            onClick={() => {
              setPlayingCustomHtmlGame(null);
              setSubTab("editor");
            }}
          >
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            <span>no-code 2d / 3d engine</span>
          </button>

          <button
            type="button"
            class={`studio-tab-btn ${subTab === "htmlupload" ? "active" : ""}`}
            onClick={() => {
              setIsPlaying(false);
              setPlayingCustomHtmlGame(null);
              setSubTab("htmlupload");
            }}
          >
            <i class="fa-solid fa-file-code"></i>
            <span>
              upload index.html (1,000 <i class="fa-solid fa-cookie-bite"></i>)
            </span>
          </button>

          <button
            type="button"
            class="studio-tab-btn"
            onClick={() => openLeaderboardOrSpace(title || "game studio", "cloudplay")}
            title="CloudPlay — Host or Join a 2-Player Co-op Party"
          >
            <i class="fa-solid fa-tower-broadcast" style={{ color: "#4ade80" }}></i>
            <span>cloudplay (2p)</span>
          </button>

          <button
            type="button"
            class="studio-tab-btn"
            onClick={() => {
              hide();
              (window as any).showShopMenu?.();
            }}
            title="Open Cookie Shop"
          >
            <i class="fa-solid fa-cookie-bite"></i>
            <span>{coins} coins</span>
          </button>
        </div>
      </div>

      {/* TAB 1: COMMUNITY ARCADE */}
      {subTab === "community" && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div class="apps-category-pills">
              {(
                [
                  { id: "all", label: "all games", icon: "fa-layer-group" },
                  { id: "platformer", label: "platformers", icon: "fa-person-running" },
                  { id: "metroidvania", label: "metroidvania", icon: "fa-dungeon" },
                  { id: "fps3d", label: "first-person 3d", icon: "fa-cube" },
                  { id: "topdown", label: "rpg / dungeon", icon: "fa-compass" },
                  { id: "shooter", label: "shooters", icon: "fa-crosshairs" },
                  { id: "survivor", label: "wave survivor", icon: "fa-skull" },
                  { id: "gravrunner", label: "gravity runner", icon: "fa-bolt" },
                  { id: "custom_html", label: "custom index.html", icon: "fa-code" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  class={`apps-cat-pill ${modeFilter === m.id ? "active" : ""}`}
                  onClick={() => setModeFilter(m.id)}
                >
                  <i class={`fa-solid ${m.icon}`}></i>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="text"
                class="studio-input"
                style={{ width: "220px" }}
                placeholder="search games or studios..."
                value={searchQuery}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
              />
              <button
                type="button"
                class="studio-tool-btn"
                title="Refresh shared community library"
                disabled={isRefreshingLibrary}
                onClick={() => void refreshCommunityLibrary(true)}
              >
                <i
                  class={`fa-solid ${
                    isRefreshingLibrary ? "fa-spinner fa-spin" : "fa-rotate-right"
                  }`}
                ></i>
                <span>refresh</span>
              </button>
              <button
                type="button"
                class="apps-custom-btn"
                onClick={() => setSubTab("editor")}
              >
                <i class="fa-solid fa-plus"></i>
                <span>build 2d/3d game (+50 coins)</span>
              </button>
            </div>
          </div>

          {filteredCommunityGames.length === 0 ? (
            <div
              class="studio-panel"
              style={{
                padding: "48px 24px",
                alignItems: "center",
                textAlign: "center",
                gap: "12px",
              }}
            >
              <i
                class="fa-solid fa-cubes"
                style={{ fontSize: "32px", color: "var(--color-icon-dim)" }}
              ></i>
              <h3 style={{ margin: 0, fontSize: "15px" }}>
                no community games match this filter yet
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "12.5px",
                  color: "var(--color-sublabel)",
                  maxWidth: "480px",
                }}
              >
                open the <strong>no-code 2d / 3d game engine</strong> (with scrolling mega-worlds,
                6 weapons, visual logic rules, and first-person 3d raycasting) or{" "}
                <strong>upload a custom index.html file</strong> to publish your game!
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  class="apps-custom-btn"
                  onClick={() => setSubTab("editor")}
                >
                  <i class="fa-solid fa-wand-magic-sparkles"></i>
                  <span>open no-code game engine</span>
                </button>
                <button
                  type="button"
                  class="studio-tool-btn"
                  onClick={() => setSubTab("htmlupload")}
                >
                  <i class="fa-solid fa-file-code"></i>
                  <span>upload custom index.html (1,000 coins)</span>
                </button>
              </div>
            </div>
          ) : (
            <div class="studio-community-grid">
              {filteredCommunityGames.map((g) => {
                const lvlCount = Array.isArray(g.levels) && g.levels.length > 0 ? g.levels.length : 1;
                return (
                  <article key={g.id} class="studio-game-card">
                    <div>
                      <div
                        class="studio-game-preview-banner"
                        style={{ backgroundColor: g.bgColor }}
                      >
                        <div
                          style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "6px",
                            backgroundColor: g.playerColor,
                            boxShadow: `0 0 18px ${g.playerColor}`,
                          }}
                        />
                        <span class="studio-game-mode-badge">
                          {g.isCustomHtml
                            ? "custom index.html"
                            : `${g.mode} · ${lvlCount} lvl${lvlCount > 1 ? "s" : ""}`}
                        </span>
                        {g.studioName && (
                          <span
                            style={{
                              position: "absolute",
                              bottom: "8px",
                              left: "8px",
                              backgroundColor: "rgba(0,0,0,0.72)",
                              border: `1px solid ${g.studioColor || "#3b82f6"}`,
                              color: "#fff",
                              fontSize: "10px",
                              padding: "2px 8px",
                              borderRadius: "8px",
                              textTransform: "lowercase",
                            }}
                          >
                            <i class="fa-solid fa-building"></i> {g.studioName}
                          </span>
                        )}
                      </div>

                      <h3
                        style={{
                          fontSize: "15px",
                          fontWeight: 600,
                          margin: "12px 0 4px",
                          color: "var(--text-primary)",
                          textTransform: "lowercase",
                        }}
                      >
                        {g.title}
                      </h3>
                      <div
                        style={{
                          fontSize: "11.5px",
                          color: "var(--color-sublabel)",
                          marginBottom: "8px",
                        }}
                      >
                        by @{g.author} · {g.plays || 0} plays · {g.likes || 0} likes
                      </div>
                      <p
                        style={{
                          fontSize: "12px",
                          color: "var(--color-sublabel)",
                          margin: 0,
                          lineHeight: 1.4,
                        }}
                      >
                        {g.description}
                      </p>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <div class="studio-game-actions">
                        <button
                          type="button"
                          class="apps-custom-btn"
                          style={{ flex: 1, justifyContent: "center" }}
                          onClick={() => loadGameIntoEngine(g, true)}
                        >
                          <i class="fa-solid fa-play"></i>
                          <span>{g.isCustomHtml ? "play index.html" : "play"}</span>
                        </button>
                        <button
                          type="button"
                          class="studio-tool-btn"
                          title="Open in full browser tab"
                          onClick={() => openGameInBrowserTab(g)}
                        >
                          <i class="fa-solid fa-up-right-from-square"></i>
                        </button>
                        <button
                          type="button"
                          class="studio-tool-btn"
                          title="Remix in No-Code Game Engine"
                          onClick={() => loadGameIntoEngine(g, false)}
                        >
                          <i class="fa-solid fa-code-branch"></i>
                        </button>
                        {(() => {
                          const myActorKey = `u:${getActiveAuthor().toLowerCase()}`;
                          const isLiked =
                            (Array.isArray(g.likedBy) && g.likedBy.includes(myActorKey)) ||
                            likedGameIds.has(g.id);
                          return (
                            <button
                              type="button"
                              class={`studio-tool-btn${isLiked ? " studio-like-btn-active" : ""}`}
                              title={isLiked ? "Unlike game" : "Like game"}
                              aria-pressed={isLiked}
                              onClick={() => void handleToggleLikeGame(g)}
                            >
                              <i
                                class={`${isLiked ? "fa-solid" : "fa-regular"} fa-heart`}
                                style={{ color: isLiked ? "#f43f5e" : "var(--text-muted)" }}
                              ></i>
                            </button>
                          );
                        })()}
                      </div>

                      {serverSyncLoaded &&
                        !serverGameIds.has(g.id) &&
                        g.author.toLowerCase() === getActiveAuthor().toLowerCase() && (
                          <div class="studio-game-actions">
                            <button
                              type="button"
                              class="studio-tool-btn"
                              style={{
                                flex: 1,
                                justifyContent: "center",
                                borderColor: "rgba(251, 191, 36, 0.4)",
                                color: "#fbbf24",
                              }}
                              title="This game is only saved locally; click to republish to global library"
                              onClick={() => void handleRepublishGame(g)}
                            >
                              <i class="fa-solid fa-cloud-arrow-up"></i>
                              <span>republish globally</span>
                            </button>
                          </div>
                        )}

                      <div class="studio-game-actions-secondary">
                        <button
                          type="button"
                          class="studio-tool-btn studio-card-mini-btn"
                          title="Leaderboard"
                          onClick={() => openLeaderboardOrSpace(g.title, "leaderboard")}
                        >
                          <i class="fa-solid fa-trophy"></i>
                          <span>ranks</span>
                        </button>
                        <button
                          type="button"
                          class="studio-tool-btn studio-card-mini-btn"
                          title="Game Space (Chat & Voice)"
                          onClick={() => openLeaderboardOrSpace(g.title, "space")}
                        >
                          <i class="fa-solid fa-users-rectangle"></i>
                          <span>space</span>
                        </button>
                        <button
                          type="button"
                          class="studio-tool-btn studio-card-mini-btn"
                          title="CloudPlay (2-Player Co-op)"
                          onClick={() => openLeaderboardOrSpace(g.title, "cloudplay")}
                        >
                          <i class="fa-solid fa-tower-broadcast" style={{ color: "#4ade80" }}></i>
                          <span>cloudplay</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* TAB 2: MY GAME STUDIO & COOKIE COIN EARNINGS */}
      {subTab === "mystudio" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "340px 1fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          <form class="studio-panel" onSubmit={handleSaveStudioProfile}>
            <h3 class="studio-panel-title">
              <span>customize your game studio</span>
              <i class="fa-solid fa-building-user"></i>
            </h3>

            <div class="studio-field">
              <label>studio name</label>
              <input
                type="text"
                class="studio-input"
                value={studioNameInput}
                onInput={(e) => setStudioNameInput(e.currentTarget.value)}
                maxLength={40}
                placeholder="e.g. neon wave studios"
                required
              />
            </div>

            <div class="studio-field">
              <label>studio tagline</label>
              <input
                type="text"
                class="studio-input"
                value={studioTaglineInput}
                onInput={(e) => setStudioTaglineInput(e.currentTarget.value)}
                maxLength={90}
                placeholder="what kind of games do you build?"
              />
            </div>

            <div class="studio-field">
              <label>studio badge color</label>
              <input
                type="color"
                value={studioColorInput}
                onInput={(e) => setStudioColorInput(e.currentTarget.value)}
                style={{ width: "100%", height: "34px", border: "none", borderRadius: "8px" }}
              />
            </div>

            <div class="studio-field">
              <label>studio emblem icon</label>
              <div class="studio-tool-grid">
                {STUDIO_ICONS.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    class={`studio-tool-btn ${studioIconInput === ic ? "active" : ""}`}
                    onClick={() => setStudioIconInput(ic)}
                    style={{ justifyContent: "center" }}
                  >
                    <i class={`fa-solid ${ic}`}></i>
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              class="apps-custom-btn"
              style={{ justifyContent: "center", width: "100%", marginTop: "4px" }}
            >
              <i class="fa-solid fa-floppy-disk"></i>
              <span>save studio identity</span>
            </button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div class="studio-panel">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div
                    class="app-icon-box"
                    style={{
                      backgroundColor: userStudio.color,
                      width: "48px",
                      height: "48px",
                    }}
                  >
                    <i class={`fa-solid ${userStudio.icon}`}></i>
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: "17px", textTransform: "lowercase" }}>
                      {userStudio.name}
                    </h2>
                    <p
                      style={{
                        margin: "3px 0 0",
                        fontSize: "12px",
                        color: "var(--color-sublabel)",
                      }}
                    >
                      {userStudio.tagline} · owner: @{userStudio.owner}
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    class="apps-custom-btn"
                    onClick={handleClaimStudioEarnings}
                  >
                    <i class="fa-solid fa-coins"></i>
                    <span>
                      claim studio royalties (+{userStudio.unclaimedCoins} cookie coins)
                    </span>
                  </button>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() => setSubTab("htmlupload")}
                  >
                    <i class="fa-solid fa-file-code"></i>
                    <span>
                      upload custom index.html (1,000 <i class="fa-solid fa-cookie-bite"></i>)
                    </span>
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                  gap: "10px",
                  marginTop: "8px",
                }}
              >
                <div
                  style={{
                    backgroundColor: "var(--bg-surface-4)",
                    padding: "12px",
                    borderRadius: "11px",
                    border: "1px solid var(--bg-surface-10)",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                    published studio games
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 700, marginTop: "4px" }}>
                    {myStudioGames.length}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "var(--bg-surface-4)",
                    padding: "12px",
                    borderRadius: "11px",
                    border: "1px solid var(--bg-surface-10)",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                    total studio plays
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 700, marginTop: "4px" }}>
                    {myStudioGames.reduce((acc, g) => acc + (g.plays || 0), 0)}
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "var(--bg-surface-4)",
                    padding: "12px",
                    borderRadius: "11px",
                    border: "1px solid var(--bg-surface-10)",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                    total coins earned
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 700, marginTop: "4px" }}>
                    {userStudio.coinsEarned} <i class="fa-solid fa-cookie-bite"></i>
                  </div>
                </div>
              </div>
            </div>

            <div class="studio-panel">
              <div class="studio-panel-title">
                <span>games published by {userStudio.name}</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() => setSubTab("editor")}
                  >
                    <i class="fa-solid fa-plus"></i> new engine game
                  </button>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() => setSubTab("htmlupload")}
                  >
                    <i class="fa-solid fa-upload"></i> upload index.html
                  </button>
                </div>
              </div>

              {myStudioGames.length === 0 ? (
                <div
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "var(--color-sublabel)",
                    fontSize: "13px",
                  }}
                >
                  your studio hasn't published any games yet — build a multi-level 2d/3d game in the
                  no-code engine (+50 coins) or upload a custom index.html file (1,000 coins)!
                </div>
              ) : (
                <div class="studio-community-grid">
                  {myStudioGames.map((g) => (
                    <div key={g.id} class="studio-game-card">
                      <div>
                        <h4 style={{ margin: "0 0 4px", fontSize: "14px" }}>{g.title}</h4>
                        <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                          {g.plays || 0} plays · {g.likes || 0} likes ·{" "}
                          {g.isCustomHtml ? "custom index.html" : g.mode}
                        </div>
                      </div>
                      <div class="studio-game-actions">
                        <button
                          type="button"
                          class="apps-custom-btn"
                          style={{ flex: 1, justifyContent: "center" }}
                          onClick={() => loadGameIntoEngine(g, true)}
                        >
                          <i class="fa-solid fa-play"></i> play
                        </button>
                        <button
                          type="button"
                          class="studio-tool-btn"
                          onClick={() => loadGameIntoEngine(g, false)}
                        >
                          <i class="fa-solid fa-pen"></i> edit
                        </button>
                        {serverSyncLoaded && !serverGameIds.has(g.id) && (
                          <button
                            type="button"
                            class="studio-tool-btn"
                            title="Republish to global community library"
                            onClick={() => void handleRepublishGame(g)}
                          >
                            <i class="fa-solid fa-cloud-arrow-up"></i> republish
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: UPLOAD SINGLE INDEX.HTML TO STUDIO (1,000 COOKIE COINS) */}
      {subTab === "htmlupload" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "380px 1fr",
            gap: "16px",
            alignItems: "start",
          }}
        >
          <form class="studio-panel" onSubmit={handlePublishCustomHtmlGame}>
            <h3 class="studio-panel-title">
              <span>
                upload index.html to studio (1,000 <i class="fa-solid fa-cookie-bite"></i>)
              </span>
              <i class="fa-solid fa-file-code"></i>
            </h3>

            <div
              style={{
                padding: "10px 12px",
                borderRadius: "10px",
                backgroundColor: "var(--bg-surface-4)",
                border: "1px solid var(--bg-surface-10)",
                fontSize: "12px",
                color: "var(--color-sublabel)",
                lineHeight: 1.45,
              }}
            >
              pay <strong style={{ color: "var(--text-primary)" }}>1,000 cookie coins</strong> to
              upload & host a single <code style={{ color: "#38bdf8" }}>index.html</code> file on
              your studio (<strong>{userStudio.name}</strong>). when players open your game, it
              serves your <code style={{ color: "#38bdf8" }}>index.html</code> directly with
              cloudsync player tracking bridged in!
            </div>

            <div class="studio-field">
              <label>game title</label>
              <input
                type="text"
                class="studio-input"
                value={htmlTitle}
                onInput={(e) => setHtmlTitle(e.currentTarget.value)}
                placeholder="e.g. cyber drift html5"
                maxLength={50}
                required
              />
            </div>

            <div class="studio-field">
              <label>description</label>
              <input
                type="text"
                class="studio-input"
                value={htmlDesc}
                onInput={(e) => setHtmlDesc(e.currentTarget.value)}
                placeholder="describe your custom index.html game..."
                maxLength={140}
              />
            </div>

            <div class="studio-field">
              <label>choose index.html file from computer</label>
              <input
                type="file"
                accept=".html,.htm"
                onChange={handleHtmlFileSelect}
                class="studio-input"
                style={{ padding: "8px" }}
              />
              {htmlFileName && (
                <span style={{ fontSize: "11px", color: "#4ade80" }}>
                  selected: {htmlFileName}
                </span>
              )}
            </div>

            <div class="studio-field">
              <label>
                <span>or edit / paste index.html source code</span>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#38bdf8",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                  onClick={() => setCustomHtmlCode(SAMPLE_CUSTOM_HTML_GAME)}
                >
                  reset sample html
                </button>
              </label>
              <textarea
                class="studio-textarea"
                style={{ minHeight: "150px", fontFamily: "monospace", fontSize: "11px" }}
                value={customHtmlCode}
                onInput={(e) => setCustomHtmlCode(e.currentTarget.value)}
              />
            </div>

            <button
              type="submit"
              class="apps-custom-btn"
              style={{
                justifyContent: "center",
                width: "100%",
                opacity: coins >= CUSTOM_HTML_UPLOAD_COST ? 1 : 0.65,
              }}
              disabled={isUploadingHtml}
            >
              <i class="fa-solid fa-cloud-arrow-up"></i>
              <span>
                {isUploadingHtml
                  ? "publishing index.html..."
                  : `publish index.html to ${userStudio.name} (1,000 coins)`}
              </span>
            </button>
          </form>

          <div class="studio-stage-panel" style={{ width: "100%" }}>
            <div class="studio-stage-toolbar">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <i class="fa-solid fa-eye" style={{ color: "#38bdf8" }}></i>
                <strong style={{ fontSize: "13px" }}>
                  live index.html preview ({htmlTitle || htmlFileName || "untitled html game"})
                </strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  class="studio-tool-btn"
                  onClick={() => setPreviewRefreshTick((t) => t + 1)}
                  title="Reload HTML Preview"
                >
                  <i class="fa-solid fa-rotate-right"></i>
                  <span>reload preview</span>
                </button>
                <button
                  type="button"
                  class="studio-tool-btn"
                  onClick={() =>
                    openGameInBrowserTab({
                      id: "html_preview_tab",
                      title: htmlTitle || htmlFileName || "html preview",
                      description: htmlDesc,
                      author: getActiveAuthor(),
                      studioName: userStudio.name,
                      studioColor: userStudio.color,
                      mode: "custom_html",
                      grid: [],
                      gravity: 0,
                      jumpForce: 0,
                      moveSpeed: 0,
                      playerColor: "#38bdf8",
                      bgColor: "#060913",
                      wallColor: "#38bdf8",
                      customScript: "",
                      isCustomHtml: true,
                      customHtmlContent: customHtmlCode,
                      likes: 0,
                      plays: 0,
                      createdAt: new Date().toISOString(),
                    })
                  }
                  title="Test in Full Browser Tab"
                >
                  <i class="fa-solid fa-up-right-from-square"></i>
                  <span>test full tab</span>
                </button>
              </div>
            </div>

            {htmlPreviewBlobUrl ? (
              <iframe
                ref={htmlPreviewIframeRef}
                key={htmlPreviewBlobUrl}
                title="Custom HTML Game Preview"
                src={htmlPreviewBlobUrl}
                sandbox="allow-scripts allow-pointer-lock allow-forms allow-popups"
                allow="fullscreen; autoplay; gamepad; pointer-lock; clipboard-read; clipboard-write"
                style={{
                  width: "100%",
                  height: "460px",
                  border: "1px solid var(--bg-surface-10)",
                  borderRadius: "12px",
                  backgroundColor: "#060913",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "460px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-sublabel)",
                  fontSize: "13px",
                }}
              >
                loading html preview...
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: ADVANCED NO-CODE MULTI-WORLD 2D & 3D GAME ENGINE */}
      {subTab === "editor" && (
        <>
          {playingCustomHtmlGame ? (
            <div class="studio-stage-panel" style={{ width: "100%" }}>
              <div class="studio-stage-toolbar">
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() => {
                      if (isChromebookModeEnabled() && playingCustomIframeRef.current) {
                        teardownIframeElement(playingCustomIframeRef.current, true);
                      }
                      setPlayingCustomHtmlGame(null);
                      setSubTab("community");
                    }}
                  >
                    <i class="fa-solid fa-arrow-left"></i>
                    <span>back to games</span>
                  </button>
                  <strong style={{ fontSize: "14px" }}>
                    {playingCustomHtmlGame.title} · served via custom index.html by{" "}
                    {playingCustomHtmlGame.studioName || playingCustomHtmlGame.author}
                  </strong>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() =>
                      openLeaderboardOrSpace(playingCustomHtmlGame.title, "leaderboard")
                    }
                  >
                    <i class="fa-solid fa-trophy"></i> leaderboard
                  </button>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() => openLeaderboardOrSpace(playingCustomHtmlGame.title, "space")}
                  >
                    <i class="fa-solid fa-users-rectangle"></i> game space
                  </button>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() => openLeaderboardOrSpace(playingCustomHtmlGame.title, "cloudplay")}
                  >
                    <i class="fa-solid fa-tower-broadcast" style={{ color: "#4ade80" }}></i> cloudplay
                  </button>
                  <button
                    type="button"
                    class="apps-custom-btn"
                    onClick={() => openGameInBrowserTab(playingCustomHtmlGame)}
                  >
                    <i class="fa-solid fa-up-right-from-square"></i> full tab
                  </button>
                </div>
              </div>

              {playingCustomBlobUrl && (
                <iframe
                  ref={playingCustomIframeRef}
                  key={playingCustomBlobUrl}
                  title={playingCustomHtmlGame.title}
                  src={playingCustomBlobUrl}
                  sandbox="allow-scripts allow-pointer-lock allow-forms allow-popups"
                  allow="fullscreen; autoplay; gamepad; pointer-lock; clipboard-read; clipboard-write"
                  style={{
                    width: "100%",
                    height: "520px",
                    border: "1px solid var(--bg-surface-10)",
                    borderRadius: "14px",
                    backgroundColor: "#060913",
                  }}
                />
              )}
            </div>
          ) : (
            <div class="studio-workspace studio-workspace-pro">
              {/* LEFT PANEL: 8 Modes, Multi-Level + World Size + Generator, Paint Tools & 28 Categorized Brushes */}
              <div class="studio-panel studio-left-panel">
                <h3 class="studio-panel-title">
                  <span>1. game genre & engine mode</span>
                  <i class="fa-solid fa-gamepad"></i>
                </h3>
                <div class="studio-tool-grid">
                  {ENGINE_MODES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      class={`studio-tool-btn studio-compact-btn ${mode === m.id ? "active" : ""}`}
                      title={m.desc}
                      onClick={() => applyTemplate(m.id)}
                    >
                      <i class={`fa-solid ${m.icon}`}></i>
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>

                {/* MULTI-LEVEL & WORLD SIZE MANAGER */}
                <h3 class="studio-panel-title" style={{ marginTop: "4px" }}>
                  <span>
                    2. world & levels ({currentDims.cols}×{currentDims.rows})
                  </span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      class="studio-tool-btn studio-mini-action"
                      onClick={handleAddLevel}
                      title="Add New Level"
                    >
                      <i class="fa-solid fa-plus"></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn studio-mini-action"
                      onClick={handleDuplicateLevel}
                      title="Duplicate Current Level"
                    >
                      <i class="fa-solid fa-copy"></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn studio-mini-action"
                      onClick={handleDeleteLevel}
                      title="Delete Current Level"
                    >
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </h3>

                <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                  {levels.map((lvl, idx) => (
                    <button
                      key={lvl.id}
                      type="button"
                      class={`studio-tool-btn studio-mini-action ${
                        activeLevelIdx === idx ? "active" : ""
                      }`}
                      onClick={() => {
                        setActiveLevelIdx(idx);
                        editorCamRef.current = { x: 0, y: 0 };
                        if (isPlaying) initSimulation(idx, liveScore);
                      }}
                    >
                      <span>lvl {idx + 1}</span>
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  class="studio-input"
                  style={{ fontSize: "11.5px", padding: "6px 9px" }}
                  value={currentLevel?.name || ""}
                  onInput={(e) => {
                    const val = e.currentTarget.value;
                    setLevels((prev) =>
                      prev.map((l, i) => (i === activeLevelIdx ? { ...l, name: val } : l))
                    );
                  }}
                  placeholder="level name..."
                />

                <div class="studio-worldsize-row">
                  <select
                    class="studio-select"
                    style={{ flex: 1, fontSize: "11.5px", padding: "6px 8px" }}
                    value={activeWorldSizeKey}
                    onChange={(e) =>
                      handleChangeWorldSize(e.currentTarget.value as WorldSizePreset)
                    }
                    title="Resize level map dimensions (keeps painted tiles!)"
                  >
                    {(Object.keys(WORLD_SIZE_PRESETS) as WorldSizePreset[]).map((k) => (
                      <option key={k} value={k}>
                        {WORLD_SIZE_PRESETS[k].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    class="studio-tool-btn studio-compact-btn"
                    style={{ borderColor: "rgba(56, 189, 248, 0.4)", color: "#38bdf8" }}
                    onClick={handleProceduralGenerateStage}
                    title="Auto-generate a rich playable level for this mode & world size!"
                  >
                    <i class="fa-solid fa-wand-sparkles"></i>
                    <span>auto-gen</span>
                  </button>
                </div>

                {/* PAINT TOOLS & UNDO/REDO */}
                <h3 class="studio-panel-title" style={{ marginTop: "4px" }}>
                  <span>3. paint tools & 28 brushes</span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      class="studio-tool-btn studio-mini-action"
                      disabled={undoCount === 0 || isPlaying}
                      onClick={handleUndo}
                      title="Undo (Ctrl+Z)"
                    >
                      <i class="fa-solid fa-rotate-left"></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn studio-mini-action"
                      disabled={redoCount === 0 || isPlaying}
                      onClick={handleRedo}
                      title="Redo (Ctrl+Y)"
                    >
                      <i class="fa-solid fa-rotate-right"></i>
                    </button>
                  </div>
                </h3>

                <div class="studio-paint-toolbar">
                  {(
                    [
                      { id: "brush", icon: "fa-pen", label: "1×1" },
                      { id: "thick", icon: "fa-paintbrush", label: "2×2" },
                      { id: "rect", icon: "fa-vector-square", label: "box" },
                      { id: "line", icon: "fa-slash", label: "line" },
                      { id: "bucket", icon: "fa-fill-drip", label: "fill" },
                    ] as const
                  ).map((pt) => (
                    <button
                      key={pt.id}
                      type="button"
                      class={`studio-paint-mode-btn ${paintTool === pt.id ? "active" : ""}`}
                      onClick={() => setPaintTool(pt.id)}
                      title={`Paint mode: ${pt.label}`}
                    >
                      <i class={`fa-solid ${pt.icon}`}></i>
                      <span>{pt.label}</span>
                    </button>
                  ))}
                </div>

                <div class="studio-cat-tabs">
                  {(["all", "terrain", "gadgets", "enemies", "items"] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      class={`studio-cat-pill ${brushCategory === cat ? "active" : ""}`}
                      onClick={() => setBrushCategory(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div class="studio-brush-scroll">
                  <div class="studio-tool-grid">
                    {visibleBrushes.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        class={`studio-tool-btn studio-compact-btn ${
                          selectedBrush === b.id ? "active" : ""
                        }`}
                        title={b.hint}
                        onClick={() => setSelectedBrush(b.id)}
                      >
                        <span class="studio-Swatch" style={{ backgroundColor: b.color }}></span>
                        <span>{b.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div class="studio-brush-hint">
                  <i class={`fa-solid ${activeBrushMeta.icon}`} style={{ color: activeBrushMeta.color }}></i>
                  <span>
                    <strong>{activeBrushMeta.name}:</strong> {activeBrushMeta.hint}
                  </span>
                </div>

                <button
                  type="button"
                  class="studio-tool-btn studio-compact-btn"
                  style={{ justifyContent: "center" }}
                  onClick={() => {
                    if (!currentLevel) return;
                    setIsPlaying(false);
                    pushUndoSnapshot(currentLevel.grid);
                    const { rows, cols } = getGridDimensions(currentLevel.grid);
                    const g = createSizedEmptyGrid(rows, cols);
                    const spawnRow = g[Math.max(1, rows - 2)];
                    if (spawnRow) spawnRow[2] = 2;
                    updateCurrentLevelGrid(() => g);
                  }}
                >
                  <i class="fa-solid fa-trash-can"></i>
                  <span>clear level {activeLevelIdx + 1} canvas</span>
                </button>
              </div>

              {/* CENTER PANEL: Interactive Scrolling 2D / First-Person 3D Stage */}
              <div class="studio-stage-panel">
                <div class="studio-stage-toolbar">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      class="apps-custom-btn"
                      style={
                        isPlaying
                          ? { backgroundColor: "#ef4444", color: "#fff" }
                          : { backgroundColor: "#22c55e", color: "#052e16" }
                      }
                      onClick={() => handleTogglePlayTest(activeLevelIdx)}
                    >
                      <i class={`fa-solid ${isPlaying ? "fa-stop" : "fa-play"}`}></i>
                      <span>
                        {isPlaying
                          ? "stop & edit"
                          : `play lvl ${activeLevelIdx + 1}/${levels.length}`}
                      </span>
                    </button>

                    <button
                      type="button"
                      class={`studio-tool-btn ${
                        mode === "fps3d" || render3DInTest ? "active" : ""
                      }`}
                      onClick={() => {
                        const next3D = !render3DInTest;
                        setRender3DInTest(next3D);
                        if (!isPlaying) {
                          initSimulation(activeLevelIdx, 0);
                          setIsPlaying(true);
                        }
                      }}
                      title="Toggle First-Person 3D Raycaster View on any map!"
                    >
                      <i class="fa-solid fa-vr-cardboard"></i>
                      <span>{mode === "fps3d" || render3DInTest ? "3d view: on" : "3d view"}</span>
                    </button>

                    <button
                      type="button"
                      class={`studio-tool-btn ${sfxEnabled ? "active" : ""}`}
                      onClick={() => setSfxEnabled((v) => !v)}
                      title="Toggle Arcade WebAudio Sound Effects"
                    >
                      <i class={`fa-solid ${sfxEnabled ? "fa-volume-high" : "fa-volume-xmark"}`}></i>
                    </button>

                    {isPlaying && (
                      <button
                        type="button"
                        class="studio-tool-btn"
                        onClick={() => initSimulation(livePlayLevelIdx, 0)}
                      >
                        <i class="fa-solid fa-rotate-right"></i>
                        <span>restart (R)</span>
                      </button>
                    )}
                  </div>

                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--color-sublabel)",
                      display: "flex",
                      gap: "12px",
                      alignItems: "center",
                    }}
                  >
                    <span>
                      lvl:{" "}
                      <strong style={{ color: "var(--text-primary)" }}>
                        {(isPlaying ? livePlayLevelIdx : activeLevelIdx) + 1}/{levels.length}
                      </strong>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                      hp:{" "}
                      <strong style={{ color: "#f43f5e", display: "inline-flex", gap: "2px" }}>
                        {Array.from({ length: Math.max(0, isPlaying ? liveHp : maxHp) }).map(
                          (_, idx) => (
                            <i key={idx} class="fa-solid fa-heart"></i>
                          )
                        )}
                      </strong>
                    </span>
                    <span>
                      score: <strong style={{ color: "var(--text-primary)" }}>{liveScore}</strong>
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      title="View Leaderboard for this Game"
                      onClick={() => openLeaderboardOrSpace(title, "leaderboard")}
                    >
                      <i class="fa-solid fa-trophy"></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      title="Open Private Game Space (Group Chat & Voice)"
                      onClick={() => openLeaderboardOrSpace(title, "space")}
                    >
                      <i class="fa-solid fa-users-rectangle"></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      title="Open CloudPlay (2-Player WASD + Arrows Party)"
                      onClick={() => openLeaderboardOrSpace(title, "cloudplay")}
                    >
                      <i class="fa-solid fa-tower-broadcast" style={{ color: "#4ade80" }}></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      title="Launch in Full Browser Tab"
                      onClick={() => openGameInBrowserTab(buildCurrentProjectSnapshot())}
                    >
                      <i class="fa-solid fa-up-right-from-square"></i>
                    </button>
                  </div>
                </div>

                <div class="studio-canvas-wrap">
                  <canvas
                    ref={canvasRef}
                    width={CANVAS_W}
                    height={CANVAS_H}
                    class="studio-canvas"
                    onContextMenu={(e) => e.preventDefault()}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    onMouseLeave={() => {
                      hoverCellRef.current = null;
                      handleCanvasMouseUp();
                    }}
                  />
                </div>

                <div style={{ fontSize: "11.5px", color: "var(--color-sublabel)", textAlign: "center" }}>
                  {isPlaying
                    ? mode === "fps3d" || render3DInTest
                      ? "3D CONTROLS: W/S move · A/D strafe · Mouse/Arrows look · Click/SPACE fire · SHIFT dash"
                      : `2D CONTROLS: WASD/Arrows move · SPACE ${
                          mode === "gravrunner" ? "flip gravity" : "jump / wall-kick / jetpack"
                        } · SHIFT dash (breaks bricks!) · F or Click fire (${weaponType})`
                    : `EDIT CONTROLS: Left-click paint (${paintTool}) · Right-click instant erase · WASD/Arrows or click minimap to pan ${currentDims.cols}×${currentDims.rows} world · Ctrl+Z undo`}
                </div>

                {/* CLOUDSYNC PLAYER TRACKING BAR */}
                <div
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "11px",
                    backgroundColor: "var(--bg-surface-4)",
                    border: "1px solid var(--bg-surface-10)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "10px",
                    fontSize: "11.5px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <i class="fa-solid fa-cloud-bolt" style={{ color: "#38bdf8" }}></i>
                    <span>
                      <strong>cloudsync tracker:</strong> @{cloudSyncInfo.username} · unlocked{" "}
                      <strong>
                        {myCloudProgress?.highestLevel || 1}/{levels.length}
                      </strong>{" "}
                      · best: <strong>{myCloudProgress?.bestScore || 0}</strong> · coins:{" "}
                      <strong>{myCloudProgress?.totalCoinsCollected || 0}</strong> · clears:{" "}
                      <strong>{myCloudProgress?.completions || 0}</strong>
                    </span>
                  </div>

                  {myCloudProgress && myCloudProgress.highestLevel > 1 && (
                    <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                      <span style={{ color: "var(--color-sublabel)" }}>jump to:</span>
                      {levels.slice(0, myCloudProgress.highestLevel).map((l, idx) => (
                        <button
                          key={l.id}
                          type="button"
                          class="studio-tool-btn studio-mini-action"
                          onClick={() => {
                            initSimulation(idx, 0);
                            setIsPlaying(true);
                          }}
                        >
                          lvl {idx + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT PANEL: 100% NO-CODE TABBED INSPECTOR (HERO & WEAPONS / VISUAL RULES / WORLD FX / PUBLISH) */}
              <form class="studio-panel studio-right-panel" onSubmit={handlePublishGame}>
                <div class="studio-inspector-tabs">
                  {(
                    [
                      { id: "hero", label: "hero & gear", icon: "fa-bolt" },
                      { id: "rules", label: "rules", icon: "fa-diagram-project" },
                      { id: "world", label: "fx & theme", icon: "fa-palette" },
                      { id: "publish", label: "publish", icon: "fa-rocket" },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      class={`studio-inspector-tab ${inspectorTab === t.id ? "active" : ""}`}
                      onClick={() => setInspectorTab(t.id)}
                    >
                      <i class={`fa-solid ${t.icon}`}></i>
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>

                {/* INSPECTOR TAB 1: HERO, PHYSICS, ABILITIES & 6 WEAPONS */}
                {inspectorTab === "hero" && (
                  <>
                    <div class="studio-field">
                      <label>
                        <span>equipped weapon</span>
                        <span style={{ color: "#38bdf8" }}>{weaponType}</span>
                      </label>
                      <div class="studio-tool-grid">
                        {WEAPON_OPTIONS.map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            class={`studio-tool-btn studio-compact-btn ${
                              weaponType === w.id ? "active" : ""
                            }`}
                            title={w.desc}
                            onClick={() => setWeaponType(w.id)}
                          >
                            <i class={`fa-solid ${w.icon}`}></i>
                            <span>{w.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div class="studio-field">
                      <label>no-code abilities & controls</label>
                      <div class="studio-tool-grid">
                        <button
                          type="button"
                          class={`studio-tool-btn studio-compact-btn ${
                            enableDoubleJump ? "active" : ""
                          }`}
                          onClick={() => setEnableDoubleJump((v) => !v)}
                        >
                          <i class="fa-solid fa-angles-up"></i>
                          <span>double jump</span>
                        </button>
                        <button
                          type="button"
                          class={`studio-tool-btn studio-compact-btn ${
                            enableWallJump ? "active" : ""
                          }`}
                          onClick={() => setEnableWallJump((v) => !v)}
                        >
                          <i class="fa-solid fa-person-shelter"></i>
                          <span>wall-kick</span>
                        </button>
                        <button
                          type="button"
                          class={`studio-tool-btn studio-compact-btn ${enableDash ? "active" : ""}`}
                          onClick={() => setEnableDash((v) => !v)}
                        >
                          <i class="fa-solid fa-wind"></i>
                          <span>shift dash</span>
                        </button>
                        <button
                          type="button"
                          class={`studio-tool-btn studio-compact-btn ${
                            enableJetpack ? "active" : ""
                          }`}
                          onClick={() => setEnableJetpack((v) => !v)}
                        >
                          <i class="fa-solid fa-fire-flame-simple"></i>
                          <span>jetpack</span>
                        </button>
                        <button
                          type="button"
                          class={`studio-tool-btn studio-compact-btn ${mouseAim ? "active" : ""}`}
                          onClick={() => setMouseAim((v) => !v)}
                        >
                          <i class="fa-solid fa-bullseye"></i>
                          <span>360° cursor aim</span>
                        </button>
                        <button
                          type="button"
                          class={`studio-tool-btn studio-compact-btn ${autoFire ? "active" : ""}`}
                          onClick={() => setAutoFire((v) => !v)}
                        >
                          <i class="fa-solid fa-infinity"></i>
                          <span>auto-fire</span>
                        </button>
                      </div>
                    </div>

                    <div class="studio-field">
                      <label>
                        <span>move speed</span>
                        <span>{moveSpeed.toFixed(1)}</span>
                      </label>
                      <input
                        type="range"
                        min="1.5"
                        max="8.5"
                        step="0.2"
                        value={moveSpeed}
                        onInput={(e) => setMoveSpeed(parseFloat(e.currentTarget.value))}
                      />
                    </div>

                    <div class="studio-field">
                      <label>
                        <span>hero max hearts</span>
                        <span>{maxHp} hp</span>
                      </label>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={maxHp}
                        onInput={(e) => setMaxHp(parseInt(e.currentTarget.value, 10))}
                      />
                    </div>

                    {mode !== "fps3d" && mode !== "topdown" && mode !== "shooter" && mode !== "survivor" && (
                      <>
                        <div class="studio-field">
                          <label>
                            <span>jump / thruster power</span>
                            <span>{jumpForce.toFixed(1)}</span>
                          </label>
                          <input
                            type="range"
                            min="5"
                            max="17"
                            step="0.5"
                            value={jumpForce}
                            onInput={(e) => setJumpForce(parseFloat(e.currentTarget.value))}
                          />
                        </div>
                        <div class="studio-field">
                          <label>
                            <span>gravity pull</span>
                            <span>{gravity.toFixed(2)}</span>
                          </label>
                          <input
                            type="range"
                            min="0.12"
                            max="1.25"
                            step="0.04"
                            value={gravity}
                            onInput={(e) => setGravity(parseFloat(e.currentTarget.value))}
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* INSPECTOR TAB 2: NO-CODE WIN GOALS, NPC DIALOGUE & "WHEN -> DO" VISUAL RULE BUILDER */}
                {inspectorTab === "rules" && (
                  <>
                    <div class="studio-field">
                      <label>level win objective</label>
                      <select
                        class="studio-select"
                        value={currentLevel?.winCondition || winCondition}
                        onChange={(e) => {
                          const val = e.currentTarget.value as WinConditionType;
                          setWinCondition(val);
                          setLevels((prev) =>
                            prev.map((l, i) =>
                              i === activeLevelIdx ? { ...l, winCondition: val } : l
                            )
                          );
                        }}
                      >
                        <option value="portal">reach emerald goal portal</option>
                        <option value="all_enemies">defeat all enemies & spawners</option>
                        <option value="all_coins">collect every coin in stage</option>
                        <option value="survive_timer">survive countdown timer</option>
                      </select>
                    </div>

                    {(currentLevel?.winCondition || winCondition) === "survive_timer" && (
                      <div class="studio-field">
                        <label>
                          <span>survival countdown</span>
                          <span>{currentLevel?.timeLimitSec || timeLimitSec}s</span>
                        </label>
                        <input
                          type="range"
                          min="15"
                          max="180"
                          step="5"
                          value={currentLevel?.timeLimitSec || timeLimitSec}
                          onInput={(e) => {
                            const sec = parseInt(e.currentTarget.value, 10);
                            setTimeLimitSec(sec);
                            setLevels((prev) =>
                              prev.map((l, i) =>
                                i === activeLevelIdx ? { ...l, timeLimitSec: sec } : l
                              )
                            );
                          }}
                        />
                      </div>
                    )}

                    <div class="studio-field">
                      <label>npc / signpost dialogue (lvl {activeLevelIdx + 1})</label>
                      <input
                        type="text"
                        class="studio-input"
                        maxLength={80}
                        placeholder="shown when hero walks near a signpost..."
                        value={currentLevel?.signText || ""}
                        onInput={(e) => {
                          const val = e.currentTarget.value;
                          setLevels((prev) =>
                            prev.map((l, i) => (i === activeLevelIdx ? { ...l, signText: val } : l))
                          );
                        }}
                      />
                    </div>

                    <div class="studio-panel-title" style={{ marginTop: "4px" }}>
                      <span>visual logic rules ({rules.length})</span>
                      <button
                        type="button"
                        class="studio-tool-btn studio-mini-action"
                        onClick={() =>
                          setRules((prev) => [
                            ...prev,
                            {
                              id: `rule_${Date.now()}`,
                              when: "on_all_coins",
                              action: "open_doors",
                              text: "all coins collected — secret doors unlocked!",
                            },
                          ])
                        }
                      >
                        <i class="fa-solid fa-plus"></i> add rule
                      </button>
                    </div>

                    <div class="studio-rules-list">
                      {rules.length === 0 ? (
                        <div class="studio-brush-hint">
                          no visual rules yet — click <strong>add rule</strong> to build automatic
                          events without writing a single line of code!
                        </div>
                      ) : (
                        rules.map((rl, rIdx) => (
                          <div key={rl.id} class="studio-rule-card">
                            <div class="studio-rule-row">
                              <span class="studio-rule-badge">when</span>
                              <select
                                class="studio-select studio-rule-select"
                                value={rl.when}
                                onChange={(e) => {
                                  const val = e.currentTarget.value as RuleTriggerType;
                                  setRules((prev) =>
                                    prev.map((item, i) =>
                                      i === rIdx ? { ...item, when: val } : item
                                    )
                                  );
                                }}
                              >
                                {RULE_TRIGGERS.map((tr) => (
                                  <option key={tr.id} value={tr.id}>
                                    {tr.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                class="studio-rule-del"
                                title="Remove rule"
                                onClick={() =>
                                  setRules((prev) => prev.filter((_, i) => i !== rIdx))
                                }
                              >
                                <i class="fa-solid fa-xmark"></i>
                              </button>
                            </div>
                            <div class="studio-rule-row">
                              <span class="studio-rule-badge do">then</span>
                              <select
                                class="studio-select studio-rule-select"
                                value={rl.action}
                                onChange={(e) => {
                                  const val = e.currentTarget.value as RuleActionType;
                                  setRules((prev) =>
                                    prev.map((item, i) =>
                                      i === rIdx ? { ...item, action: val } : item
                                    )
                                  );
                                }}
                              >
                                {RULE_ACTIONS.map((ac) => (
                                  <option key={ac.id} value={ac.id}>
                                    {ac.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <input
                              type="text"
                              class="studio-input"
                              style={{ fontSize: "11px", padding: "5px 8px" }}
                              placeholder="optional screen announcement banner..."
                              maxLength={60}
                              value={rl.text || ""}
                              onInput={(e) => {
                                const val = e.currentTarget.value;
                                setRules((prev) =>
                                  prev.map((item, i) =>
                                    i === rIdx ? { ...item, text: val } : item
                                  )
                                );
                              }}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}

                {/* INSPECTOR TAB 3: WORLD ATMOSPHERE, WEATHER, LIGHTING & PALETTES */}
                {inspectorTab === "world" && (
                  <>
                    <div class="studio-field">
                      <label>1-click neon theme presets</label>
                      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                        {THEME_PALETTES.map((pal) => (
                          <button
                            key={pal.name}
                            type="button"
                            class="studio-tool-btn studio-mini-action"
                            onClick={() => {
                              setBgColor(pal.bg);
                              setWallColor(pal.wall);
                              setPlayerColor(pal.hero);
                              setLevels((prev) =>
                                prev.map((l, i) =>
                                  i === activeLevelIdx
                                    ? { ...l, bgColor: pal.bg, wallColor: pal.wall }
                                    : l
                                )
                              );
                            }}
                          >
                            <span class="studio-Swatch" style={{ backgroundColor: pal.wall }}></span>
                            <span>{pal.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                      <div class="studio-field">
                        <label>hero</label>
                        <input
                          type="color"
                          value={playerColor}
                          onInput={(e) => setPlayerColor(e.currentTarget.value)}
                          style={{ width: "100%", height: "30px", border: "none", borderRadius: "6px" }}
                        />
                      </div>
                      <div class="studio-field">
                        <label>lvl wall</label>
                        <input
                          type="color"
                          value={currentLevel?.wallColor || wallColor}
                          onInput={(e) => {
                            const val = e.currentTarget.value;
                            setWallColor(val);
                            setLevels((prev) =>
                              prev.map((l, i) => (i === activeLevelIdx ? { ...l, wallColor: val } : l))
                            );
                          }}
                          style={{ width: "100%", height: "30px", border: "none", borderRadius: "6px" }}
                        />
                      </div>
                      <div class="studio-field">
                        <label>lvl sky</label>
                        <input
                          type="color"
                          value={currentLevel?.bgColor || bgColor}
                          onInput={(e) => {
                            const val = e.currentTarget.value;
                            setBgColor(val);
                            setLevels((prev) =>
                              prev.map((l, i) => (i === activeLevelIdx ? { ...l, bgColor: val } : l))
                            );
                          }}
                          style={{ width: "100%", height: "30px", border: "none", borderRadius: "6px" }}
                        />
                      </div>
                    </div>

                    <div class="studio-field">
                      <label>weather & particle atmosphere</label>
                      <select
                        class="studio-select"
                        value={currentLevel?.weather || weather}
                        onChange={(e) => {
                          const val = e.currentTarget.value as WeatherType;
                          setWeather(val);
                          setLevels((prev) =>
                            prev.map((l, i) => (i === activeLevelIdx ? { ...l, weather: val } : l))
                          );
                        }}
                      >
                        <option value="starfield">parallax starfield</option>
                        <option value="rain">cyber neon rain</option>
                        <option value="snow">blizzard snowfall</option>
                        <option value="embers">rising lava embers</option>
                        <option value="matrix">matrix digital stream</option>
                        <option value="none">clear sky (none)</option>
                      </select>
                    </div>

                    <div class="studio-tool-grid">
                      <button
                        type="button"
                        class={`studio-tool-btn studio-compact-btn ${
                          currentLevel?.darknessMode ?? darknessMode ? "active" : ""
                        }`}
                        onClick={() => {
                          const next = !(currentLevel?.darknessMode ?? darknessMode);
                          setDarknessMode(next);
                          setLevels((prev) =>
                            prev.map((l, i) =>
                              i === activeLevelIdx ? { ...l, darknessMode: next } : l
                            )
                          );
                        }}
                      >
                        <i class="fa-solid fa-moon"></i>
                        <span>flashlight dark</span>
                      </button>
                      <button
                        type="button"
                        class={`studio-tool-btn studio-compact-btn ${screenShake ? "active" : ""}`}
                        onClick={() => setScreenShake((v) => !v)}
                      >
                        <i class="fa-solid fa-burst"></i>
                        <span>screen shake</span>
                      </button>
                      <button
                        type="button"
                        class={`studio-tool-btn studio-compact-btn ${sfxEnabled ? "active" : ""}`}
                        onClick={() => setSfxEnabled((v) => !v)}
                      >
                        <i class="fa-solid fa-volume-high"></i>
                        <span>synth sfx</span>
                      </button>
                      <button
                        type="button"
                        class={`studio-tool-btn studio-compact-btn ${
                          render3DInTest ? "active" : ""
                        }`}
                        onClick={() => setRender3DInTest((v) => !v)}
                      >
                        <i class="fa-solid fa-cube"></i>
                        <span>3d raycaster</span>
                      </button>
                    </div>

                    <div class="studio-field">
                      <label>
                        <span>camera zoom</span>
                        <span>{cameraZoom.toFixed(2)}x</span>
                      </label>
                      <input
                        type="range"
                        min="0.8"
                        max="1.35"
                        step="0.05"
                        value={cameraZoom}
                        onInput={(e) => setCameraZoom(parseFloat(e.currentTarget.value))}
                      />
                    </div>
                  </>
                )}

                {/* INSPECTOR TAB 4: PUBLISH & STANDALONE EXPORT */}
                {inspectorTab === "publish" && (
                  <>
                    <div class="studio-brush-hint">
                      <i class={`fa-solid ${userStudio.icon}`} style={{ color: userStudio.color }}></i>
                      <span>
                        publishing under <strong>{userStudio.name}</strong> · includes{" "}
                        <strong>{levels.length}</strong> level{levels.length > 1 ? "s" : ""},{" "}
                        <strong>{rules.length}</strong> visual rule{rules.length === 1 ? "" : "s"} &{" "}
                        <strong>{weaponType}</strong>
                      </span>
                    </div>

                    <div class="studio-field">
                      <label>game title</label>
                      <input
                        type="text"
                        class="studio-input"
                        value={title}
                        onInput={(e) => setTitle(e.currentTarget.value)}
                        maxLength={50}
                        required
                      />
                    </div>

                    <div class="studio-field">
                      <label>description</label>
                      <textarea
                        class="studio-input"
                        style={{ minHeight: "64px", resize: "vertical" }}
                        value={description}
                        onInput={(e) => setDescription(e.currentTarget.value)}
                        maxLength={140}
                      />
                    </div>

                    <button
                      type="button"
                      class="studio-tool-btn"
                      style={{ justifyContent: "center", width: "100%" }}
                      onClick={handleExportStandaloneHtmlFile}
                    >
                      <i class="fa-solid fa-download"></i>
                      <span>export standalone playable .html</span>
                    </button>
                  </>
                )}

                {/* ALWAYS-ACCESSIBLE PUBLISH CTA AT BOTTOM OF INSPECTOR */}
                <button
                  type="submit"
                  class="apps-custom-btn"
                  style={{ justifyContent: "center", width: "100%", marginTop: "auto" }}
                  disabled={isPublishing}
                >
                  <i class="fa-solid fa-rocket"></i>
                  <span>
                    {isPublishing
                      ? "publishing..."
                      : `publish ${levels.length}-lvl game (+50 coins)`}
                  </span>
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
