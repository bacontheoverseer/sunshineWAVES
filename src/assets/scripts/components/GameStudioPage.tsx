import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import { showHomeView, store } from "../state/store.ts";
import { moderateChatMessage } from "../core/contentFilter.ts";
import {
  getCookieCoins,
  addCookieCoins,
  getUserStudio,
  saveUserStudio,
  recordGameActivity,
  type StudioProfile,
} from "../core/cookieCoins.ts";

export type GameMode = "platformer" | "topdown" | "shooter" | "flappy";

export interface StudioGameProject {
  id: string;
  title: string;
  description: string;
  author: string;
  studioName?: string;
  studioColor?: string;
  mode: GameMode;
  grid: number[][];
  gravity: number;
  jumpForce: number;
  moveSpeed: number;
  playerColor: string;
  bgColor: string;
  wallColor: string;
  customScript: string;
  likes: number;
  plays: number;
  createdAt: string;
}

const ROWS = 12;
const COLS = 20;
const TILE_SIZE = 34; // 680 x 408 canvas

const BRUSH_TOOLS = [
  { id: 1, name: "wall block", color: "#3b82f6", icon: "fa-square" },
  { id: 2, name: "player spawn", color: "#22c55e", icon: "fa-user-astronaut" },
  { id: 3, name: "coin (+10)", color: "#eab308", icon: "fa-coins" },
  { id: 4, name: "lava / spike", color: "#ef4444", icon: "fa-skull-crossbones" },
  { id: 5, name: "patrol enemy", color: "#a855f7", icon: "fa-ghost" },
  { id: 6, name: "bounce pad", color: "#06b6d4", icon: "fa-angles-up" },
  { id: 7, name: "goal flag", color: "#10b981", icon: "fa-flag-checkered" },
  { id: 0, name: "eraser", color: "#64748b", icon: "fa-eraser" },
];

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

function createEmptyGrid(): number[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function makePresetGrid(preset: "platformer" | "topdown" | "shooter" | "flappy"): number[][] {
  const g = createEmptyGrid();
  if (preset === "platformer") {
    for (let c = 0; c < COLS; c++) g[ROWS - 1][c] = 1;
    g[ROWS - 1][8] = 4;
    g[ROWS - 1][9] = 4;
    g[ROWS - 1][10] = 4;
    g[8][4] = 1;
    g[8][5] = 1;
    g[8][6] = 1;
    g[6][8] = 1;
    g[6][9] = 1;
    g[6][10] = 1;
    g[5][13] = 1;
    g[5][14] = 1;
    g[5][15] = 1;
    g[ROWS - 2][7] = 6;
    g[ROWS - 2][2] = 2;
    g[7][5] = 3;
    g[5][9] = 3;
    g[4][14] = 3;
    g[ROWS - 2][12] = 3;
    g[ROWS - 2][14] = 5;
    g[4][18] = 7;
    g[5][18] = 1;
    g[5][17] = 1;
  } else if (preset === "topdown") {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) g[r][c] = 1;
      }
    }
    for (let r = 2; r < 9; r++) g[r][6] = 1;
    for (let r = 3; r < 11; r++) g[r][13] = 1;
    g[2][2] = 2;
    g[2][9] = 3;
    g[6][3] = 3;
    g[9][9] = 3;
    g[5][10] = 5;
    g[8][15] = 5;
    g[4][9] = 4;
    g[9][17] = 7;
  } else if (preset === "shooter") {
    for (let c = 0; c < COLS; c++) {
      g[0][c] = 1;
      g[ROWS - 1][c] = 1;
    }
    g[6][2] = 2;
    g[3][14] = 5;
    g[6][15] = 5;
    g[9][14] = 5;
    g[4][17] = 5;
    g[8][17] = 5;
    g[3][9] = 3;
    g[8][9] = 3;
    g[6][18] = 7;
  } else if (preset === "flappy") {
    for (let c = 0; c < COLS; c++) {
      g[0][c] = 4;
      g[ROWS - 1][c] = 4;
    }
    g[5][2] = 2;
    for (let r = 1; r <= 4; r++) g[r][7] = 1;
    for (let r = 8; r <= 10; r++) g[r][7] = 1;
    g[6][7] = 3;

    for (let r = 1; r <= 3; r++) g[r][12] = 1;
    for (let r = 7; r <= 10; r++) g[r][12] = 1;
    g[5][12] = 3;

    for (let r = 1; r <= 5; r++) g[r][16] = 1;
    for (let r = 9; r <= 10; r++) g[r][16] = 1;
    g[7][16] = 3;

    g[6][19] = 7;
  }
  return g;
}

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

function buildStandaloneGameHtml(project: StudioGameProject): string {
  const serialized = JSON.stringify(project);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${project.title} — ${project.studioName || project.author}</title>
<style>
  body { margin: 0; background: #070a12; color: #fff; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
  .hud { display: flex; gap: 20px; align-items: center; margin-bottom: 10px; font-size: 14px; background: rgba(255,255,255,0.06); padding: 8px 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); }
  canvas { border-radius: 12px; border: 2px solid rgba(255,255,255,0.18); box-shadow: 0 20px 60px rgba(0,0,0,0.7); }
  .hint { margin-top: 10px; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="hud">
    <strong>${project.title}</strong>
    <span>studio: ${project.studioName || project.author}</span>
    <span id="score">score: 0</span>
    <span id="status">playing</span>
  </div>
  <canvas id="c" width="680" height="408"></canvas>
  <div class="hint">controls: WASD / Arrow Keys to move & jump · SPACE to jump / shoot · R to restart</div>
<script>
const P = ${serialized};
const ROWS = 12, COLS = 20, T = 34;
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const keys = {};
window.addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "KeyR") reset(); });
window.addEventListener("keyup", e => { keys[e.code] = false; });

let player, coins, enemies, bullets, score, state;
function reset() {
  score = 0; state = "playing"; coins = []; enemies = []; bullets = [];
  player = { x: 68, y: 200, vx: 0, vy: 0, w: 24, h: 24, grounded: false, shootCd: 0 };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = P.grid[r][c];
      if (id === 2) { player.x = c * T + 5; player.y = r * T + 5; }
      else if (id === 3) coins.push({ x: c * T + 9, y: r * T + 9, w: 16, h: 16, taken: false });
      else if (id === 5) enemies.push({ x: c * T + 4, y: r * T + 4, w: 26, h: 26, vx: 1.6, alive: true });
    }
  }
}
reset();
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function loop() {
  if (state === "playing") {
    const left = keys["ArrowLeft"] || keys["KeyA"];
    const right = keys["ArrowRight"] || keys["KeyD"];
    const up = keys["ArrowUp"] || keys["KeyW"] || keys["Space"];
    if (P.mode === "platformer") {
      player.vx = (right ? P.moveSpeed : 0) - (left ? P.moveSpeed : 0);
      if (up && player.grounded) { player.vy = -P.jumpForce; player.grounded = false; }
      player.vy += P.gravity;
    } else if (P.mode === "topdown" || P.mode === "shooter") {
      const down = keys["ArrowDown"] || keys["KeyS"];
      player.vx = (right ? P.moveSpeed : 0) - (left ? P.moveSpeed : 0);
      player.vy = (down ? P.moveSpeed : 0) - ((keys["ArrowUp"] || keys["KeyW"]) ? P.moveSpeed : 0);
      if (P.mode === "shooter" && keys["Space"] && player.shootCd <= 0) {
        bullets.push({ x: player.x + 24, y: player.y + 10, w: 10, h: 4, vx: 9 });
        player.shootCd = 14;
      }
      if (player.shootCd > 0) player.shootCd--;
    } else if (P.mode === "flappy") {
      player.vx = P.moveSpeed * 0.65;
      if (up && !player._flapLock) { player.vy = -P.jumpForce; player._flapLock = true; }
      if (!up) player._flapLock = false;
      player.vy += P.gravity;
    }
    player.x += player.vx;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (P.grid[r][c] === 1 && overlap(player, { x: c*T, y: r*T, w: T, h: T })) {
        if (player.vx > 0) player.x = c*T - player.w;
        else if (player.vx < 0) player.x = (c+1)*T;
        if (P.mode === "flappy") state = "lost";
      }
    }
    player.y += player.vy;
    player.grounded = false;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const id = P.grid[r][c];
      const box = { x: c*T, y: r*T, w: T, h: T };
      if (!overlap(player, box)) continue;
      if (id === 1) {
        if (player.vy > 0) { player.y = r*T - player.h; player.vy = 0; player.grounded = true; }
        else if (player.vy < 0) { player.y = (r+1)*T; player.vy = 0; }
      } else if (id === 4) state = "lost";
      else if (id === 6) { player.vy = -P.jumpForce * 1.35; player.grounded = false; }
      else if (id === 7) state = "won";
    }
    for (const c of coins) if (!c.taken && overlap(player, c)) { c.taken = true; score += 10; }
    for (const b of bullets) {
      b.x += b.vx;
      for (const en of enemies) if (en.alive && overlap(b, en)) { en.alive = false; b.x = 9999; score += 25; }
    }
    for (const en of enemies) {
      if (!en.alive) continue;
      en.x += en.vx;
      const tc = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / T);
      const tr = Math.floor((en.y + 12) / T);
      if (tc < 0 || tc >= COLS || (P.grid[tr] && P.grid[tr][tc] === 1)) en.vx *= -1;
      if (overlap(player, en)) {
        if (P.mode === "platformer" && player.vy > 1 && player.y + player.h - player.vy <= en.y + 10) {
          en.alive = false; player.vy = -P.jumpForce * 0.8; score += 25;
        } else state = "lost";
      }
    }
  }
  document.getElementById("score").textContent = "score: " + score;
  document.getElementById("status").textContent = state === "won" ? "🎉 YOU WIN! (press R)" : state === "lost" ? "💥 GAME OVER (press R)" : "playing";
  ctx.fillStyle = P.bgColor; ctx.fillRect(0, 0, 680, 408);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const id = P.grid[r][c];
    if (id === 1) { ctx.fillStyle = P.wallColor; ctx.fillRect(c*T, r*T, T-1, T-1); }
    else if (id === 4) { ctx.fillStyle = "#ef4444"; ctx.fillRect(c*T, r*T+10, T, T-10); }
    else if (id === 6) { ctx.fillStyle = "#06b6d4"; ctx.fillRect(c*T+2, r*T+18, T-4, 16); }
    else if (id === 7) { ctx.fillStyle = "#10b981"; ctx.fillRect(c*T+8, r*T+4, 18, 28); }
  }
  ctx.fillStyle = "#eab308";
  for (const c of coins) if (!c.taken) { ctx.beginPath(); ctx.arc(c.x+8, c.y+8, 7, 0, Math.PI*2); ctx.fill(); }
  ctx.fillStyle = "#a855f7";
  for (const en of enemies) if (en.alive) ctx.fillRect(en.x, en.y, en.w, en.h);
  ctx.fillStyle = "#38bdf8";
  for (const b of bullets) if (b.x < 700) ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = P.playerColor;
  ctx.fillRect(player.x, player.y, player.w, player.h);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script>
</body>
</html>`;
}

export default function GameStudioPage() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  // Default page is OTHER PEOPLE'S GAMES ("community") as requested!
  const [subTab, setSubTab] = useState<"community" | "mystudio" | "editor">("community");
  const [searchQuery, setSearchQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | GameMode>("all");

  // User's Custom Named Game Studio & Cookie Coins
  const [userStudio, setUserStudio] = useState<StudioProfile>(() => getUserStudio());
  const [coins, setCoins] = useState<number>(() => getCookieCoins());

  // Studio edit form state
  const [studioNameInput, setStudioNameInput] = useState(userStudio.name);
  const [studioTaglineInput, setStudioTaglineInput] = useState(userStudio.tagline);
  const [studioColorInput, setStudioColorInput] = useState(userStudio.color);
  const [studioIconInput, setStudioIconInput] = useState(userStudio.icon);

  // Community published games state (only real user-published games)
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

  // Editor project state
  const [title, setTitle] = useState("my neon platformer");
  const [description, setDescription] = useState(
    "collect the coins, dodge the hazards, and reach the emerald goal flag!"
  );
  const [mode, setMode] = useState<GameMode>("platformer");
  const [grid, setGrid] = useState<number[][]>(() => makePresetGrid("platformer"));
  const [selectedBrush, setSelectedBrush] = useState<number>(1);
  const [gravity, setGravity] = useState(0.55);
  const [jumpForce, setJumpForce] = useState(11.5);
  const [moveSpeed, setMoveSpeed] = useState(4.2);
  const [playerColor, setPlayerColor] = useState("#22c55e");
  const [bgColor, setBgColor] = useState("#090d16");
  const [wallColor, setWallColor] = useState("#3b82f6");
  const [customScript, setCustomScript] = useState("// Optional JS per-frame hook:\n// state.score += 0;");

  // Live Play-Test Engine state
  const [isPlaying, setIsPlaying] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
  const [gameStatus, setGameStatus] = useState<"editing" | "playing" | "won" | "lost">("editing");
  const [isPublishing, setIsPublishing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPaintingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  const keysRef = useRef<Record<string, boolean>>({});
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const projectStateRef = useRef({
    title,
    mode,
    grid,
    gravity,
    jumpForce,
    moveSpeed,
    playerColor,
    bgColor,
    wallColor,
    customScript,
  });
  projectStateRef.current = {
    title,
    mode,
    grid,
    gravity,
    jumpForce,
    moveSpeed,
    playerColor,
    bgColor,
    wallColor,
    customScript,
  };

  const simRef = useRef<{
    player: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      w: number;
      h: number;
      grounded: boolean;
      shootCd: number;
      flapLock?: boolean;
    };
    coins: { x: number; y: number; w: number; h: number; taken: boolean }[];
    enemies: { x: number; y: number; w: number; h: number; vx: number; alive: boolean }[];
    bullets: { x: number; y: number; w: number; h: number; vx: number }[];
    particles: { x: number; y: number; vx: number; vy: number; color: string; life: number }[];
    score: number;
    status: "playing" | "won" | "lost";
    rewardedWin?: boolean;
  } | null>(null);

  const initSimulation = useCallback(() => {
    const p = projectStateRef.current;
    let spawnX = 68;
    let spawnY = 200;
    const coinsList: { x: number; y: number; w: number; h: number; taken: boolean }[] = [];
    const enemies: { x: number; y: number; w: number; h: number; vx: number; alive: boolean }[] = [];

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = p.grid[r][c];
        if (cell === 2) {
          spawnX = c * TILE_SIZE + 5;
          spawnY = r * TILE_SIZE + 5;
        } else if (cell === 3) {
          coinsList.push({
            x: c * TILE_SIZE + 9,
            y: r * TILE_SIZE + 9,
            w: 16,
            h: 16,
            taken: false,
          });
        } else if (cell === 5) {
          enemies.push({
            x: c * TILE_SIZE + 4,
            y: r * TILE_SIZE + 4,
            w: 26,
            h: 26,
            vx: 1.6,
            alive: true,
          });
        }
      }
    }

    simRef.current = {
      player: {
        x: spawnX,
        y: spawnY,
        vx: 0,
        vy: 0,
        w: 24,
        h: 24,
        grounded: false,
        shootCd: 0,
      },
      coins: coinsList,
      enemies,
      bullets: [],
      particles: [],
      score: 0,
      status: "playing",
      rewardedWin: false,
    };
    setLiveScore(0);
    setGameStatus("playing");
  }, []);

  const hide = useCallback(() => {
    if (!document.body.classList.contains("studio-view")) return;
    setIsPlaying(false);
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
      document.getElementById("branding-container") ||
      document.getElementById("brand");

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

    return () => {
      if (studioBtn) studioBtn.removeEventListener("click", onStudioClick);
      if (brand) brand.removeEventListener("click", onBrandClick);
      window.removeEventListener("cookie-coins-updated", onCoins);
    };
  }, [show, hide, toggle]);

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

  useEffect(() => {
    if (!visible) return;
    fetch("/api/studio/games")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.games)) {
          for (const g of data.games) mergePublishedGame(g);
        }
      })
      .catch(() => {});

    const onSseStudio = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.game) mergePublishedGame(detail.game);
    };
    window.addEventListener("sunshine-studio-event", onSseStudio);

    try {
      const bc = new BroadcastChannel("cookie_studio_v1_channel");
      bc.onmessage = (ev) => {
        if (ev.data?.type === "GAME_PUBLISHED" && ev.data.game) {
          mergePublishedGame(ev.data.game);
        }
      };
      broadcastRef.current = bc;
    } catch {}

    return () => {
      window.removeEventListener("sunshine-studio-event", onSseStudio);
      broadcastRef.current?.close();
    };
  }, [visible, mergePublishedGame]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }
      keysRef.current[e.code] = true;
      if (
        isPlayingRef.current &&
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)
      ) {
        e.preventDefault();
      }
      if (isPlayingRef.current && e.code === "KeyR") {
        initSimulation();
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
  }, [visible, initSimulation]);

  // 60fps Canvas Render & Physics Loop
  useEffect(() => {
    if (!visible || subTab !== "editor") return;
    let rafId = 0;

    const overlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number }
    ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const spawnParticles = (x: number, y: number, color: string) => {
      if (!simRef.current) return;
      for (let i = 0; i < 10; i++) {
        simRef.current.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 6,
          vy: (Math.random() - 0.5) * 6,
          color,
          life: 22,
        });
      }
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
      ctx.fillStyle = cfg.bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!isPlayingRef.current) {
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        for (let r = 0; r <= ROWS; r++) {
          ctx.beginPath();
          ctx.moveTo(0, r * TILE_SIZE);
          ctx.lineTo(COLS * TILE_SIZE, r * TILE_SIZE);
          ctx.stroke();
        }
        for (let c = 0; c <= COLS; c++) {
          ctx.beginPath();
          ctx.moveTo(c * TILE_SIZE, 0);
          ctx.lineTo(c * TILE_SIZE, ROWS * TILE_SIZE);
          ctx.stroke();
        }
      }

      const sim = simRef.current;
      if (isPlayingRef.current && sim && sim.status === "playing") {
        const keys = keysRef.current;
        const left = keys["ArrowLeft"] || keys["KeyA"];
        const right = keys["ArrowRight"] || keys["KeyD"];
        const up = keys["ArrowUp"] || keys["KeyW"] || keys["Space"];
        const down = keys["ArrowDown"] || keys["KeyS"];
        const pl = sim.player;

        if (cfg.mode === "platformer") {
          pl.vx = (right ? cfg.moveSpeed : 0) - (left ? cfg.moveSpeed : 0);
          if (up && pl.grounded) {
            pl.vy = -cfg.jumpForce;
            pl.grounded = false;
          }
          pl.vy += cfg.gravity;
        } else if (cfg.mode === "topdown" || cfg.mode === "shooter") {
          pl.vx = (right ? cfg.moveSpeed : 0) - (left ? cfg.moveSpeed : 0);
          pl.vy = (down ? cfg.moveSpeed : 0) - ((keys["ArrowUp"] || keys["KeyW"]) ? cfg.moveSpeed : 0);
          if (cfg.mode === "shooter" && keys["Space"] && pl.shootCd <= 0) {
            sim.bullets.push({
              x: pl.x + pl.w,
              y: pl.y + pl.h / 2 - 2,
              w: 12,
              h: 4,
              vx: 9.5,
            });
            pl.shootCd = 12;
          }
          if (pl.shootCd > 0) pl.shootCd--;
        } else if (cfg.mode === "flappy") {
          pl.vx = cfg.moveSpeed * 0.65;
          if (up && !pl.flapLock) {
            pl.vy = -cfg.jumpForce;
            pl.flapLock = true;
          }
          if (!up) pl.flapLock = false;
          pl.vy += cfg.gravity;
        }

        pl.x += pl.vx;
        if (pl.x < 0) pl.x = 0;
        if (pl.x + pl.w > COLS * TILE_SIZE) {
          if (cfg.mode === "flappy") {
            sim.status = "won";
            setGameStatus("won");
          } else {
            pl.x = COLS * TILE_SIZE - pl.w;
          }
        }

        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (cfg.grid[r][c] === 1) {
              const box = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
              if (overlap(pl, box)) {
                if (pl.vx > 0) pl.x = box.x - pl.w;
                else if (pl.vx < 0) pl.x = box.x + box.w;
                if (cfg.mode === "flappy") {
                  sim.status = "lost";
                  setGameStatus("lost");
                }
              }
            }
          }
        }

        pl.y += pl.vy;
        pl.grounded = false;
        if (pl.y > ROWS * TILE_SIZE) {
          sim.status = "lost";
          setGameStatus("lost");
        }

        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const cell = cfg.grid[r][c];
            if (cell === 0 || cell === 2 || cell === 3 || cell === 5) continue;
            const box = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
            if (!overlap(pl, box)) continue;

            if (cell === 1) {
              if (pl.vy > 0) {
                pl.y = box.y - pl.h;
                pl.vy = 0;
                pl.grounded = true;
              } else if (pl.vy < 0) {
                pl.y = box.y + box.h;
                pl.vy = 0;
              }
            } else if (cell === 4) {
              spawnParticles(pl.x + 12, pl.y + 12, "#ef4444");
              sim.status = "lost";
              setGameStatus("lost");
            } else if (cell === 6) {
              pl.vy = -cfg.jumpForce * 1.35;
              pl.grounded = false;
              spawnParticles(pl.x + 12, pl.y + 24, "#06b6d4");
            } else if (cell === 7) {
              spawnParticles(pl.x + 12, pl.y + 12, "#10b981");
              sim.status = "won";
              setGameStatus("won");
              if (!sim.rewardedWin) {
                sim.rewardedWin = true;
                addCookieCoins(20, `beat ${cfg.title}`);
                recordGameActivity(cfg.title, 20, 1, sim.score);
              }
            }
          }
        }

        for (const coin of sim.coins) {
          if (!coin.taken && overlap(pl, coin)) {
            coin.taken = true;
            sim.score += 10;
            setLiveScore(sim.score);
            spawnParticles(coin.x + 8, coin.y + 8, "#eab308");
          }
        }

        for (const b of sim.bullets) {
          b.x += b.vx;
          for (const en of sim.enemies) {
            if (en.alive && overlap(b, en)) {
              en.alive = false;
              b.x = 9999;
              sim.score += 25;
              setLiveScore(sim.score);
              spawnParticles(en.x + 12, en.y + 12, "#a855f7");
            }
          }
        }

        for (const en of sim.enemies) {
          if (!en.alive) continue;
          en.x += en.vx;
          const nextCol = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / TILE_SIZE);
          const row = Math.floor((en.y + 12) / TILE_SIZE);
          if (
            nextCol < 0 ||
            nextCol >= COLS ||
            (cfg.grid[row] && cfg.grid[row][nextCol] === 1)
          ) {
            en.vx *= -1;
          }
          if (overlap(pl, en)) {
            if (
              cfg.mode === "platformer" &&
              pl.vy > 1 &&
              pl.y + pl.h - pl.vy <= en.y + 12
            ) {
              en.alive = false;
              pl.vy = -cfg.jumpForce * 0.8;
              sim.score += 25;
              setLiveScore(sim.score);
              spawnParticles(en.x + 12, en.y + 12, "#a855f7");
            } else {
              spawnParticles(pl.x + 12, pl.y + 12, "#ef4444");
              sim.status = "lost";
              setGameStatus("lost");
            }
          }
        }

        if (cfg.customScript && cfg.customScript.trim()) {
          try {
            const fn = new Function("ctx", "state", "player", cfg.customScript);
            fn(ctx, sim, pl);
          } catch {}
        }
      }

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const id = cfg.grid[r][c];
          const x = c * TILE_SIZE;
          const y = r * TILE_SIZE;

          if (id === 1) {
            ctx.fillStyle = cfg.wallColor;
            ctx.fillRect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          } else if (id === 2 && !isPlayingRef.current) {
            ctx.fillStyle = cfg.playerColor;
            ctx.fillRect(x + 5, y + 5, 24, 24);
          } else if (id === 3 && !isPlayingRef.current) {
            ctx.fillStyle = "#eab308";
            ctx.beginPath();
            ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 8, 0, Math.PI * 2);
            ctx.fill();
          } else if (id === 4) {
            ctx.fillStyle = "#ef4444";
            ctx.beginPath();
            ctx.moveTo(x + 2, y + TILE_SIZE);
            ctx.lineTo(x + TILE_SIZE / 2, y + 8);
            ctx.lineTo(x + TILE_SIZE - 2, y + TILE_SIZE);
            ctx.closePath();
            ctx.fill();
          } else if (id === 5 && !isPlayingRef.current) {
            ctx.fillStyle = "#a855f7";
            ctx.fillRect(x + 4, y + 4, 26, 26);
          } else if (id === 6) {
            ctx.fillStyle = "#06b6d4";
            ctx.fillRect(x + 3, y + TILE_SIZE - 12, TILE_SIZE - 6, 12);
          } else if (id === 7) {
            ctx.fillStyle = "#10b981";
            ctx.fillRect(x + 7, y + 4, 4, TILE_SIZE - 4);
            ctx.beginPath();
            ctx.moveTo(x + 11, y + 4);
            ctx.lineTo(x + TILE_SIZE - 4, y + 12);
            ctx.lineTo(x + 11, y + 20);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      if (isPlayingRef.current && sim) {
        ctx.fillStyle = "#eab308";
        for (const coin of sim.coins) {
          if (!coin.taken) {
            ctx.beginPath();
            ctx.arc(coin.x + 8, coin.y + 8, 7, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        ctx.fillStyle = "#a855f7";
        for (const en of sim.enemies) {
          if (en.alive) {
            ctx.fillRect(en.x, en.y, en.w, en.h);
          }
        }

        ctx.fillStyle = "#38bdf8";
        for (const b of sim.bullets) {
          if (b.x < COLS * TILE_SIZE) {
            ctx.fillRect(b.x, b.y, b.w, b.h);
          }
        }

        for (let i = sim.particles.length - 1; i >= 0; i--) {
          const pt = sim.particles[i];
          pt.x += pt.vx;
          pt.y += pt.vy;
          pt.life--;
          ctx.fillStyle = pt.color;
          ctx.fillRect(pt.x, pt.y, 4, 4);
          if (pt.life <= 0) sim.particles.splice(i, 1);
        }

        ctx.fillStyle = cfg.playerColor;
        ctx.fillRect(sim.player.x, sim.player.y, sim.player.w, sim.player.h);

        if (sim.status !== "playing") {
          ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = sim.status === "won" ? "#4ade80" : "#f87171";
          ctx.font = "bold 26px Lexend, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            sim.status === "won" ? "LEVEL COMPLETE! (+20 COINS)" : "GAME OVER",
            canvas.width / 2,
            canvas.height / 2 - 10
          );
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "14px Lexend, sans-serif";
          ctx.fillText(
            `final score: ${sim.score} · press R to restart`,
            canvas.width / 2,
            canvas.height / 2 + 22
          );
        }
      }

      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [visible, subTab]);

  const handleCanvasPaint = (e: MouseEvent) => {
    if (isPlaying || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const col = Math.floor(((e.clientX - rect.left) * scaleX) / TILE_SIZE);
    const row = Math.floor(((e.clientY - rect.top) * scaleY) / TILE_SIZE);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;

    setGrid((prev) => {
      const copy = prev.map((r) => [...r]);
      if (selectedBrush === 2) {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (copy[r][c] === 2) copy[r][c] = 0;
          }
        }
      }
      copy[row][col] = selectedBrush;
      return copy;
    });
  };

  const applyTemplate = (preset: GameMode) => {
    setIsPlaying(false);
    setGameStatus("editing");
    setMode(preset);
    setGrid(makePresetGrid(preset));
    if (preset === "platformer") {
      setGravity(0.55);
      setJumpForce(11.5);
      setMoveSpeed(4.2);
    } else if (preset === "topdown") {
      setGravity(0);
      setJumpForce(0);
      setMoveSpeed(3.8);
    } else if (preset === "shooter") {
      setGravity(0);
      setJumpForce(0);
      setMoveSpeed(4.5);
    } else if (preset === "flappy") {
      setGravity(0.42);
      setJumpForce(7.8);
      setMoveSpeed(2.6);
    }
  };

  const handleTogglePlayTest = () => {
    if (isPlaying) {
      setIsPlaying(false);
      setGameStatus("editing");
    } else {
      initSimulation();
      setIsPlaying(true);
    }
  };

  const getActiveAuthor = (): string => {
    try {
      const raw = localStorage.getItem("auth_user");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.username) return parsed.username;
      }
    } catch {}
    return "guest_creator";
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
        setIsPublishing(false);
        return;
      }

      const newGame: StudioGameProject = {
        id: `game_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: cleanTitle,
        description: description.trim() || `built by ${userStudio.name}`,
        author: getActiveAuthor(),
        studioName: userStudio.name,
        studioColor: userStudio.color,
        mode,
        grid: grid.map((r) => [...r]),
        gravity,
        jumpForce,
        moveSpeed,
        playerColor,
        bgColor,
        wallColor,
        customScript,
        likes: 1,
        plays: 1,
        createdAt: new Date().toISOString(),
      };

      mergePublishedGame(newGame);
      try {
        broadcastRef.current?.postMessage({ type: "GAME_PUBLISHED", game: newGame });
      } catch {}

      await fetch("/api/studio/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: newGame }),
      }).catch(() => {});

      // Award +50 Cookie Coins launch bonus + +25 Studio treasury royalty
      addCookieCoins(50, `published "${cleanTitle}" under ${userStudio.name}`);
      const updatedStudio: StudioProfile = {
        ...userStudio,
        coinsEarned: (userStudio.coinsEarned || 0) + 50,
        unclaimedCoins: (userStudio.unclaimedCoins || 0) + 25,
      };
      saveUserStudio(updatedStudio);
      setUserStudio(updatedStudio);

      setSubTab("community");
    } finally {
      setIsPublishing(false);
    }
  };

  const loadGameIntoEngine = (g: StudioGameProject, autoPlay: boolean) => {
    setTitle(g.title);
    setDescription(g.description);
    setMode(g.mode);
    setGrid(g.grid.map((r) => [...r]));
    setGravity(g.gravity);
    setJumpForce(g.jumpForce);
    setMoveSpeed(g.moveSpeed);
    setPlayerColor(g.playerColor);
    setBgColor(g.bgColor);
    setWallColor(g.wallColor);
    setCustomScript(g.customScript || "");
    setSubTab("editor");

    setCommunityGames((prev) =>
      prev.map((item) => (item.id === g.id ? { ...item, plays: (item.plays || 0) + 1 } : item))
    );
    recordGameActivity(g.title, 10, 1);

    // If this game belongs to the user's Studio, add +10 unclaimed studio royalty coins
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

    setTimeout(() => {
      if (autoPlay) {
        initSimulation();
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
    tab.iframe.src = blobUrl;
    document.body.classList.add("browser-view");
    store.notify();
  };

  const openLeaderboardOrSpace = (gameName: string, tab: "leaderboard" | "space") => {
    document.dispatchEvent(
      new CustomEvent("toggleGameSpaceModal", {
        detail: { gameName, tab },
      })
    );
  };

  const filteredCommunityGames = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
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
  }, [communityGames, searchQuery, modeFilter]);

  const myStudioGames = useMemo(
    () =>
      communityGames.filter(
        (g) =>
          (g.studioName || "").toLowerCase() === userStudio.name.toLowerCase() ||
          g.author.toLowerCase() === getActiveAuthor().toLowerCase()
      ),
    [communityGames, userStudio.name]
  );

  if (!visible) return null;

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
        </div>

        <div class="studio-tabs">
          <button
            type="button"
            class={`studio-tab-btn ${subTab === "community" ? "active" : ""}`}
            onClick={() => {
              setIsPlaying(false);
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
            onClick={() => setSubTab("editor")}
          >
            <i class="fa-solid fa-hammer"></i>
            <span>game maker engine</span>
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

      {/* TAB 1 (DEFAULT): OTHER PEOPLE'S GAMES / COMMUNITY ARCADE */}
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
                  { id: "topdown", label: "top-down", icon: "fa-compass" },
                  { id: "shooter", label: "shooters", icon: "fa-jet-fighter" },
                  { id: "flappy", label: "flappy / dash", icon: "fa-dove" },
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
                style={{ width: "240px" }}
                placeholder="search games or studios..."
                value={searchQuery}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
              />
              <button
                type="button"
                class="apps-custom-btn"
                onClick={() => setSubTab("editor")}
              >
                <i class="fa-solid fa-plus"></i>
                <span>make a game (+50 coins)</span>
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
                class="fa-solid fa-gamepad"
                style={{ fontSize: "32px", color: "var(--color-icon-dim)" }}
              ></i>
              <h3 style={{ margin: 0, fontSize: "15px" }}>
                no community games published yet
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "12.5px",
                  color: "var(--color-sublabel)",
                  maxWidth: "420px",
                }}
              >
                only real user-created games appear here. open the{" "}
                <strong>game maker engine</strong> to build & publish the first game under your
                studio and earn +50 cookie coins!
              </p>
              <button
                type="button"
                class="apps-custom-btn"
                onClick={() => setSubTab("editor")}
              >
                <i class="fa-solid fa-hammer"></i>
                <span>open game maker engine</span>
              </button>
            </div>
          ) : (
          <div class="studio-community-grid">
            {filteredCommunityGames.map((g) => (
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
                    <span class="studio-game-mode-badge">{g.mode}</span>
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
                      <span>play</span>
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
                      title="Remix in Game Engine"
                      onClick={() => loadGameIntoEngine(g, false)}
                    >
                      <i class="fa-solid fa-code-branch"></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      title="Like game (+15 coins to studio)"
                      onClick={() => {
                        setCommunityGames((prev) =>
                          prev.map((item) =>
                            item.id === g.id
                              ? { ...item, likes: (item.likes || 0) + 1 }
                              : item
                          )
                        );
                        addCookieCoins(2, `liked ${g.title}`);
                        fetch(`/api/studio/games/${encodeURIComponent(g.id)}/stat`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ field: "likes" }),
                        }).catch(() => {});
                      }}
                    >
                      <i class="fa-solid fa-heart" style={{ color: "#f43f5e" }}></i>
                    </button>
                  </div>

                  {/* Per-Game Leaderboard & Private Space Buttons */}
                  <div class="studio-game-actions">
                    <button
                      type="button"
                      class="studio-tool-btn"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => openLeaderboardOrSpace(g.title, "leaderboard")}
                    >
                      <i class="fa-solid fa-trophy"></i>
                      <span>leaderboard</span>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => openLeaderboardOrSpace(g.title, "space")}
                    >
                      <i class="fa-solid fa-users-rectangle"></i>
                      <span>game space</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
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
          {/* Customize Studio Profile */}
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

          {/* Studio Revenue Dashboard & Studio Games */}
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
                    {userStudio.coinsEarned} 🍪
                  </div>
                </div>
              </div>
            </div>

            <div class="studio-panel">
              <div class="studio-panel-title">
                <span>games published by {userStudio.name}</span>
                <button
                  type="button"
                  class="studio-tool-btn"
                  onClick={() => setSubTab("editor")}
                >
                  <i class="fa-solid fa-plus"></i> new studio game
                </button>
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
                  your studio hasn't published any games yet — open the{" "}
                  <strong>game maker engine</strong> tab to publish your first game and earn +50
                  cookie coins!
                </div>
              ) : (
                <div class="studio-community-grid">
                  {myStudioGames.map((g) => (
                    <div key={g.id} class="studio-game-card">
                      <div>
                        <h4 style={{ margin: "0 0 4px", fontSize: "14px" }}>{g.title}</h4>
                        <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
                          {g.plays || 0} plays · {g.likes || 0} likes · {g.mode}
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: POLISHED 2D GAME MAKER ENGINE */}
      {subTab === "editor" && (
        <div class="studio-workspace">
          {/* LEFT PANEL: Game Modes, Templates & Tile Brushes */}
          <div class="studio-panel">
            <h3 class="studio-panel-title">
              <span>1. game mode & preset</span>
              <i class="fa-solid fa-gamepad"></i>
            </h3>
            <div class="studio-tool-grid">
              {(
                [
                  { id: "platformer", label: "platformer", icon: "fa-person-running" },
                  { id: "topdown", label: "top-down", icon: "fa-compass" },
                  { id: "shooter", label: "space shooter", icon: "fa-jet-fighter" },
                  { id: "flappy", label: "flappy dash", icon: "fa-dove" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  class={`studio-tool-btn ${mode === m.id ? "active" : ""}`}
                  onClick={() => applyTemplate(m.id)}
                >
                  <i class={`fa-solid ${m.icon}`}></i>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            <h3 class="studio-panel-title" style={{ marginTop: "6px" }}>
              <span>2. paint level tiles</span>
              <i class="fa-solid fa-paintbrush"></i>
            </h3>
            <div class="studio-tool-grid">
              {BRUSH_TOOLS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  class={`studio-tool-btn ${selectedBrush === b.id ? "active" : ""}`}
                  onClick={() => setSelectedBrush(b.id)}
                >
                  <span class="studio-Swatch" style={{ backgroundColor: b.color }}></span>
                  <span>{b.name}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              class="studio-tool-btn"
              style={{ justifyContent: "center", marginTop: "4px" }}
              onClick={() => {
                setIsPlaying(false);
                const g = createEmptyGrid();
                g[5][2] = 2;
                setGrid(g);
              }}
            >
              <i class="fa-solid fa-trash-can"></i>
              <span>clear entire grid</span>
            </button>
          </div>

          {/* CENTER PANEL: Interactive 2D Canvas Stage */}
          <div class="studio-stage-panel">
            <div class="studio-stage-toolbar">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  class="apps-custom-btn"
                  style={
                    isPlaying
                      ? { backgroundColor: "#ef4444", color: "#fff" }
                      : { backgroundColor: "#22c55e", color: "#052e16" }
                  }
                  onClick={handleTogglePlayTest}
                >
                  <i class={`fa-solid ${isPlaying ? "fa-stop" : "fa-play"}`}></i>
                  <span>{isPlaying ? "stop playing" : "test / play game"}</span>
                </button>

                {isPlaying && (
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={initSimulation}
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
                  score: <strong style={{ color: "var(--text-primary)" }}>{liveScore}</strong>
                </span>
                <span>mode: {mode}</span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  class="studio-tool-btn"
                  title="View Leaderboard for this Game"
                  onClick={() => openLeaderboardOrSpace(title, "leaderboard")}
                >
                  <i class="fa-solid fa-trophy"></i>
                  <span>leaderboard</span>
                </button>
                <button
                  type="button"
                  class="studio-tool-btn"
                  title="Open Private Game Space (Group Chat & Voice)"
                  onClick={() => openLeaderboardOrSpace(title, "space")}
                >
                  <i class="fa-solid fa-users-rectangle"></i>
                  <span>game space</span>
                </button>
                <button
                  type="button"
                  class="studio-tool-btn"
                  title="Launch in Full Browser Tab"
                  onClick={() =>
                    openGameInBrowserTab({
                      id: "preview",
                      title: title || "preview game",
                      description,
                      author: getActiveAuthor(),
                      studioName: userStudio.name,
                      studioColor: userStudio.color,
                      mode,
                      grid,
                      gravity,
                      jumpForce,
                      moveSpeed,
                      playerColor,
                      bgColor,
                      wallColor,
                      customScript,
                      likes: 0,
                      plays: 0,
                      createdAt: new Date().toISOString(),
                    })
                  }
                >
                  <i class="fa-solid fa-up-right-from-square"></i>
                </button>
              </div>
            </div>

            <div class="studio-canvas-wrap">
              <canvas
                ref={canvasRef}
                width={COLS * TILE_SIZE}
                height={ROWS * TILE_SIZE}
                class="studio-canvas"
                onMouseDown={(e) => {
                  isPaintingRef.current = true;
                  handleCanvasPaint(e);
                }}
                onMouseMove={(e) => {
                  if (isPaintingRef.current) handleCanvasPaint(e);
                }}
                onMouseUp={() => {
                  isPaintingRef.current = false;
                }}
                onMouseLeave={() => {
                  isPaintingRef.current = false;
                }}
              />
            </div>

            <div style={{ fontSize: "11.5px", color: "var(--color-sublabel)" }}>
              {isPlaying
                ? "controls: WASD / Arrows to move · SPACE to jump / flap / shoot · beat the goal flag for +20 cookie coins!"
                : "click or drag on the grid above to paint tiles, then click 'test / play game'!"}
            </div>
          </div>

          {/* RIGHT PANEL: Physics, Colors, Script & Studio Publish */}
          <form class="studio-panel" onSubmit={handlePublishGame}>
            <h3 class="studio-panel-title">
              <span>3. physics & visuals</span>
              <i class="fa-solid fa-sliders"></i>
            </h3>

            <div class="studio-field">
              <label>
                <span>move speed</span>
                <span>{moveSpeed.toFixed(1)}</span>
              </label>
              <input
                type="range"
                min="1.5"
                max="8"
                step="0.2"
                value={moveSpeed}
                onInput={(e) => setMoveSpeed(parseFloat(e.currentTarget.value))}
              />
            </div>

            {(mode === "platformer" || mode === "flappy") && (
              <>
                <div class="studio-field">
                  <label>
                    <span>jump / flap power</span>
                    <span>{jumpForce.toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="16"
                    step="0.5"
                    value={jumpForce}
                    onInput={(e) => setJumpForce(parseFloat(e.currentTarget.value))}
                  />
                </div>
                <div class="studio-field">
                  <label>
                    <span>gravity</span>
                    <span>{gravity.toFixed(2)}</span>
                  </label>
                  <input
                    type="range"
                    min="0.15"
                    max="1.2"
                    step="0.05"
                    value={gravity}
                    onInput={(e) => setGravity(parseFloat(e.currentTarget.value))}
                  />
                </div>
              </>
            )}

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
                <label>walls</label>
                <input
                  type="color"
                  value={wallColor}
                  onInput={(e) => setWallColor(e.currentTarget.value)}
                  style={{ width: "100%", height: "30px", border: "none", borderRadius: "6px" }}
                />
              </div>
              <div class="studio-field">
                <label>sky</label>
                <input
                  type="color"
                  value={bgColor}
                  onInput={(e) => setBgColor(e.currentTarget.value)}
                  style={{ width: "100%", height: "30px", border: "none", borderRadius: "6px" }}
                />
              </div>
            </div>

            <div class="studio-field">
              <label>
                <span>custom js onTick(ctx, state, player)</span>
              </label>
              <textarea
                class="studio-textarea"
                value={customScript}
                onInput={(e) => setCustomScript(e.currentTarget.value)}
              />
            </div>

            <h3 class="studio-panel-title" style={{ marginTop: "4px" }}>
              <span>4. publish under your studio</span>
              <i class="fa-solid fa-cloud-arrow-up"></i>
            </h3>

            <div
              style={{
                fontSize: "11.5px",
                color: "var(--color-sublabel)",
                backgroundColor: "var(--bg-surface-4)",
                padding: "7px 10px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>
                studio: <strong style={{ color: "var(--text-primary)" }}>{userStudio.name}</strong>
              </span>
              <button
                type="button"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: "11px",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
                onClick={() => setSubTab("mystudio")}
              >
                rename
              </button>
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
              <input
                type="text"
                class="studio-input"
                value={description}
                onInput={(e) => setDescription(e.currentTarget.value)}
                maxLength={140}
              />
            </div>

            <button
              type="submit"
              class="apps-custom-btn"
              style={{ justifyContent: "center", width: "100%", marginTop: "4px" }}
              disabled={isPublishing}
            >
              <i class="fa-solid fa-rocket"></i>
              <span>
                {isPublishing ? "publishing..." : "publish game (+50 cookie coins)"}
              </span>
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
