import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";
import { showHomeView, store } from "../state/store.ts";
import { moderateChatMessage } from "../core/contentFilter.ts";
import {
  getCookieCoins,
  addCookieCoins,
  spendCookieCoins,
  getUserStudio,
  saveUserStudio,
  recordGameActivity,
  type StudioProfile,
} from "../core/cookieCoins.ts";

export type GameMode = "platformer" | "fps3d" | "topdown" | "shooter" | "flappy" | "custom_html";

export interface StudioGameLevel {
  id: string;
  name: string;
  grid: number[][];
  bgColor?: string;
  wallColor?: string;
}

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
  enableBlaster?: boolean;
  playerColor: string;
  bgColor: string;
  wallColor: string;
  customScript: string;
  isCustomHtml?: boolean;
  customHtmlContent?: string;
  likes: number;
  plays: number;
  createdAt: string;
}

const ROWS = 12;
const COLS = 20;
const TILE_SIZE = 34; // 680 x 408 canvas
const CUSTOM_HTML_UPLOAD_COST = 1000;

const BRUSH_TOOLS = [
  { id: 1, name: "wall block", color: "#3b82f6", icon: "fa-square" },
  { id: 2, name: "player spawn", color: "#22c55e", icon: "fa-user-astronaut" },
  { id: 3, name: "coin (+10)", color: "#eab308", icon: "fa-coins" },
  { id: 4, name: "lava / hazard", color: "#ef4444", icon: "fa-skull-crossbones" },
  { id: 5, name: "patrol enemy", color: "#a855f7", icon: "fa-ghost" },
  { id: 9, name: "boss / chaser", color: "#ec4899", icon: "fa-dragon" },
  { id: 6, name: "bounce / boost", color: "#06b6d4", icon: "fa-angles-up" },
  { id: 8, name: "moving platform", color: "#6366f1", icon: "fa-arrows-left-right" },
  { id: 10, name: "checkpoint +hp", color: "#f43f5e", icon: "fa-heart-pulse" },
  { id: 11, name: "golden key", color: "#f59e0b", icon: "fa-key" },
  { id: 12, name: "locked gate", color: "#94a3b8", icon: "fa-lock" },
  { id: 7, name: "level portal", color: "#10b981", icon: "fa-flag-checkered" },
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
    let score = 0, level = 1, orbs = [], particles = [], mx = 330, my = 195;
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

function createEmptyGrid(): number[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function makePresetGrid(preset: GameMode, levelIndex = 0): number[][] {
  const g = createEmptyGrid();
  if (preset === "fps3d" || preset === "topdown") {
    // Perimeter walls for 3D raycaster / top-down dungeon
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1) g[r][c] = 1;
      }
    }
    if (levelIndex % 2 === 0) {
      for (let r = 1; r < 8; r++) g[r][5] = 1;
      for (let r = 4; r < ROWS - 1; r++) g[r][10] = 1;
      for (let r = 1; r < 8; r++) g[r][15] = 1;
      g[2][2] = 2; // Player spawn
      g[2][8] = 3; // Coin
      g[6][3] = 3;
      g[9][7] = 3;
      g[3][13] = 3;
      g[5][8] = 5; // Enemy
      g[8][13] = 9; // Boss/chaser
      g[5][12] = 10; // Checkpoint / medkit
      g[2][13] = 11; // Key
      g[8][15] = 12; // Locked gate
      g[9][18] = 7; // Goal portal
    } else {
      for (let c = 3; c < 16; c++) if (c !== 9) g[4][c] = 1;
      for (let c = 4; c < 17; c++) if (c !== 11) g[8][c] = 1;
      g[2][2] = 2;
      g[2][12] = 3;
      g[6][6] = 3;
      g[6][14] = 9;
      g[10][8] = 5;
      g[6][10] = 10;
      g[10][18] = 7;
    }
  } else if (preset === "platformer") {
    for (let c = 0; c < COLS; c++) g[ROWS - 1][c] = 1;
    if (levelIndex === 0) {
      g[ROWS - 1][8] = 4;
      g[ROWS - 1][9] = 4;
      g[ROWS - 1][10] = 4;
      g[8][4] = 1;
      g[8][5] = 1;
      g[8][6] = 1;
      g[6][8] = 8; // Moving platform
      g[6][9] = 1;
      g[6][10] = 1;
      g[5][13] = 1;
      g[5][14] = 1;
      g[5][15] = 1;
      g[ROWS - 2][7] = 6;
      g[ROWS - 2][2] = 2;
      g[7][5] = 3;
      g[5][9] = 3;
      g[4][14] = 10; // Checkpoint +HP
      g[ROWS - 2][12] = 3;
      g[ROWS - 2][14] = 5;
      g[4][18] = 7;
      g[5][18] = 1;
      g[5][17] = 1;
    } else {
      for (let c = 5; c < 15; c++) g[ROWS - 1][c] = 4;
      g[ROWS - 2][2] = 2;
      g[9][5] = 8;
      g[7][9] = 8;
      g[5][13] = 8;
      g[8][5] = 3;
      g[6][9] = 10;
      g[4][13] = 3;
      g[ROWS - 2][16] = 9;
      g[4][18] = 7;
      g[5][18] = 1;
    }
  } else if (preset === "shooter") {
    for (let c = 0; c < COLS; c++) {
      g[0][c] = 1;
      g[ROWS - 1][c] = 1;
    }
    g[6][2] = 2;
    g[3][12] = 5;
    g[6][14] = 9;
    g[9][12] = 5;
    g[4][16] = 5;
    g[8][16] = 9;
    g[3][8] = 3;
    g[8][8] = 3;
    g[6][9] = 10;
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

function makeDefaultLevels(preset: GameMode): StudioGameLevel[] {
  return [
    {
      id: "lvl_1",
      name: "level 1: neon entry",
      grid: makePresetGrid(preset, 0),
      bgColor: "#090d16",
      wallColor: "#3b82f6",
    },
    {
      id: "lvl_2",
      name: "level 2: cyber core",
      grid: makePresetGrid(preset, 1),
      bgColor: "#0f091c",
      wallColor: "#8b5cf6",
    },
  ];
}

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
  // Rewrite external http(s) script/link/img/audio/video/source URLs through /!!/ so COEP (require-corp) never blocks CDN libraries
  return rawHtml.replace(
    /\b(src|href)\s*=\s*(["'])(https?:\/\/[^"']+)\2/gi,
    (match, attr, quote, url) => {
      if (url.includes("/!!/")) return match;
      return `${attr}=${quote}/!!/${url}${quote}`;
    }
  );
}

function escapeStudioHtml(str: string): string {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function injectCloudSyncBridgeIntoHtml(rawHtml: string, project: StudioGameProject): string {
  const { username, isCloudSynced } = getCloudSyncState();
  const coepSafeHtml = rewriteExternalHtmlAssetsForCoep(rawHtml || "");
  const bridgeScript = `
<script>
(function() {
  // Provide isolated in-memory storage fallback when running inside sandbox without allow-same-origin
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

  // Auto-proxy cross-origin fetch requests through /!!/ so COEP never blocks external game assets
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
  const serialized = JSON.stringify(project).replace(/</g, "\\u003c");
  const safeTitle = escapeStudioHtml(project.title);
  const safeCreator = escapeStudioHtml(project.studioName || project.author);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${safeTitle} — ${safeCreator}</title>
<style>
  body { margin: 0; background: #070a12; color: #fff; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; overflow: hidden; }
  .hud { display: flex; gap: 18px; align-items: center; margin-bottom: 10px; font-size: 13px; background: rgba(255,255,255,0.06); padding: 8px 18px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.12); }
  canvas { border-radius: 12px; border: 2px solid rgba(255,255,255,0.18); box-shadow: 0 20px 60px rgba(0,0,0,0.7); }
  .hint { margin-top: 10px; font-size: 12px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="hud">
    <strong>${safeTitle}</strong>
    <span id="lvl">level 1</span>
    <span id="hp">hp: ❤️❤️❤️</span>
    <span id="score">score: 0</span>
    <span id="status">playing</span>
  </div>
  <canvas id="c" width="680" height="408"></canvas>
  <div class="hint">controls: WASD / Arrows to move · SPACE to jump / shoot · SHIFT to dash · R to restart</div>
<script>
const P = ${serialized};
const levels = Array.isArray(P.levels) && P.levels.length > 0 ? P.levels : [{ name: "level 1", grid: P.grid }];
let curLvl = 0;
const ROWS = 12, COLS = 20, T = 34;
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const keys = {};
window.addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "KeyR") reset(0); });
window.addEventListener("keyup", e => { keys[e.code] = false; });

let player, coins, enemies, bullets, score = 0, state = "playing";
function reset(lvlIdx) {
  curLvl = lvlIdx;
  if (curLvl === 0) score = 0;
  state = "playing"; coins = []; enemies = []; bullets = [];
  const grid = levels[curLvl].grid;
  player = { x: 68, y: 200, vx: 0, vy: 0, w: 24, h: 24, angle: 0, grounded: false, shootCd: 0, hp: P.maxHp || 3 };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const id = grid[r][c];
      if (id === 2) { player.x = c * T + 5; player.y = r * T + 5; }
      else if (id === 3) coins.push({ x: c * T + 9, y: r * T + 9, w: 16, h: 16, taken: false });
      else if (id === 5 || id === 9) enemies.push({ x: c * T + 4, y: r * T + 4, w: 26, h: 26, vx: id === 9 ? 2.1 : 1.5, hp: id === 9 ? 3 : 1, boss: id === 9, alive: true });
    }
  }
  document.getElementById("lvl").textContent = levels[curLvl].name || ("level " + (curLvl + 1));
}
reset(0);
function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function loop() {
  const grid = levels[curLvl].grid;
  if (state === "playing") {
    const left = keys["ArrowLeft"] || keys["KeyA"];
    const right = keys["ArrowRight"] || keys["KeyD"];
    const up = keys["ArrowUp"] || keys["KeyW"] || keys["Space"];
    const down = keys["ArrowDown"] || keys["KeyS"];
    if (P.mode === "platformer") {
      player.vx = (right ? P.moveSpeed : 0) - (left ? P.moveSpeed : 0);
      if (up && player.grounded) { player.vy = -P.jumpForce; player.grounded = false; }
      player.vy += P.gravity;
    } else {
      player.vx = (right ? P.moveSpeed : 0) - (left ? P.moveSpeed : 0);
      player.vy = (down ? P.moveSpeed : 0) - ((keys["ArrowUp"] || keys["KeyW"]) ? P.moveSpeed : 0);
    }
    if (keys["Space"] && player.shootCd <= 0) {
      bullets.push({ x: player.x + 12, y: player.y + 10, w: 10, h: 4, vx: 9 });
      player.shootCd = 14;
    }
    if (player.shootCd > 0) player.shootCd--;
    player.x += player.vx;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if ((grid[r][c] === 1 || grid[r][c] === 8) && overlap(player, { x: c*T, y: r*T, w: T, h: T })) {
        if (player.vx > 0) player.x = c*T - player.w;
        else if (player.vx < 0) player.x = (c+1)*T;
      }
    }
    player.y += player.vy;
    player.grounded = false;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const id = grid[r][c];
      const box = { x: c*T, y: r*T, w: T, h: T };
      if (!overlap(player, box)) continue;
      if (id === 1 || id === 8) {
        if (player.vy > 0) { player.y = r*T - player.h; player.vy = 0; player.grounded = true; }
        else if (player.vy < 0) { player.y = (r+1)*T; player.vy = 0; }
      } else if (id === 4) state = "lost";
      else if (id === 6) { player.vy = -P.jumpForce * 1.35; player.grounded = false; }
      else if (id === 7) {
        if (curLvl + 1 < levels.length) reset(curLvl + 1);
        else state = "won";
      }
    }
    for (const c of coins) if (!c.taken && overlap(player, c)) { c.taken = true; score += 10; }
    for (const b of bullets) {
      b.x += b.vx;
      for (const en of enemies) if (en.alive && overlap(b, en)) { en.hp--; if (en.hp <= 0) en.alive = false; b.x = 9999; score += 25; }
    }
    for (const en of enemies) {
      if (!en.alive) continue;
      en.x += en.vx;
      const tc = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / T);
      const tr = Math.floor((en.y + 12) / T);
      if (tc < 0 || tc >= COLS || (grid[tr] && grid[tr][tc] === 1)) en.vx *= -1;
      if (overlap(player, en)) state = "lost";
    }
  }
  document.getElementById("score").textContent = "score: " + score;
  document.getElementById("status").textContent = state === "won" ? "🎉 ALL LEVELS CLEARED! (R)" : state === "lost" ? "💥 GAME OVER (R)" : "playing";
  ctx.fillStyle = levels[curLvl].bgColor || P.bgColor; ctx.fillRect(0, 0, 680, 408);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const id = grid[r][c];
    if (id === 1 || id === 8) { ctx.fillStyle = id === 8 ? "#6366f1" : (levels[curLvl].wallColor || P.wallColor); ctx.fillRect(c*T, r*T, T-1, T-1); }
    else if (id === 4) { ctx.fillStyle = "#ef4444"; ctx.fillRect(c*T, r*T+10, T, T-10); }
    else if (id === 6) { ctx.fillStyle = "#06b6d4"; ctx.fillRect(c*T+2, r*T+18, T-4, 16); }
    else if (id === 7) { ctx.fillStyle = "#10b981"; ctx.fillRect(c*T+8, r*T+4, 18, 28); }
  }
  ctx.fillStyle = "#eab308";
  for (const c of coins) if (!c.taken) { ctx.beginPath(); ctx.arc(c.x+8, c.y+8, 7, 0, Math.PI*2); ctx.fill(); }
  for (const en of enemies) if (en.alive) { ctx.fillStyle = en.boss ? "#ec4899" : "#a855f7"; ctx.fillRect(en.x, en.y, en.w, en.h); }
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
  // Default page is OTHER PEOPLE'S GAMES ("community")
  const [subTab, setSubTab] = useState<"community" | "mystudio" | "editor" | "htmlupload">(
    "community"
  );
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

  // CloudSync Player Tracking state
  const [activeGameId, setActiveGameId] = useState<string>("editor_preview");
  const [cloudPlayers, setCloudPlayers] = useState<CloudSyncPlayerProgress[]>([]);
  const [myCloudProgress, setMyCloudProgress] = useState<CloudSyncPlayerProgress | null>(null);
  const [playingCustomHtmlGame, setPlayingCustomHtmlGame] = useState<StudioGameProject | null>(
    null
  );

  // Custom index.html upload state (1,000 Cookie Coins)
  const [htmlTitle, setHtmlTitle] = useState("");
  const [htmlDesc, setHtmlDesc] = useState("");
  const [htmlFileName, setHtmlFileName] = useState<string>("");
  const [customHtmlCode, setCustomHtmlCode] = useState<string>(SAMPLE_CUSTOM_HTML_GAME);
  const [isUploadingHtml, setIsUploadingHtml] = useState(false);
  const [previewRefreshTick, setPreviewRefreshTick] = useState<number>(0);
  const [htmlPreviewBlobUrl, setHtmlPreviewBlobUrl] = useState<string>("");
  const [playingCustomBlobUrl, setPlayingCustomBlobUrl] = useState<string>("");

  // Multi-Level & Sophisticated Engine Project state
  const [title, setTitle] = useState("cyber dungeon 3d & 2d");
  const [description, setDescription] = useState(
    "multi-level adventure with cloudsync progression, checkpoints, bosses, and 3d first-person mode!"
  );
  const [mode, setMode] = useState<GameMode>("platformer");
  const [levels, setLevels] = useState<StudioGameLevel[]>(() => makeDefaultLevels("platformer"));
  const [activeLevelIdx, setActiveLevelIdx] = useState<number>(0);

  const currentLevel = levels[activeLevelIdx] || levels[0];
  const grid = currentLevel?.grid || makePresetGrid("platformer", 0);

  const [selectedBrush, setSelectedBrush] = useState<number>(1);
  const [gravity, setGravity] = useState(0.55);
  const [jumpForce, setJumpForce] = useState(11.5);
  const [moveSpeed, setMoveSpeed] = useState(4.2);
  const [maxHp, setMaxHp] = useState(3);
  const [enableDoubleJump, setEnableDoubleJump] = useState(true);
  const [enableDash, setEnableDash] = useState(true);
  const [enableBlaster, setEnableBlaster] = useState(true);
  const [render3DInTest, setRender3DInTest] = useState(false);

  const [playerColor, setPlayerColor] = useState("#22c55e");
  const [bgColor, setBgColor] = useState("#090d16");
  const [wallColor, setWallColor] = useState("#3b82f6");
  const [customScript, setCustomScript] = useState(
    "// Optional JS per-frame hook:\n// state.score += 0;"
  );
  const isForeignProjectRef = useRef(false);

  // Live Play-Test Engine state
  const [isPlaying, setIsPlaying] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
  const [liveHp, setLiveHp] = useState(3);
  const [livePlayLevelIdx, setLivePlayLevelIdx] = useState(0);
  const [gameStatus, setGameStatus] = useState<
    "editing" | "playing" | "level_clear" | "won" | "lost"
  >("editing");
  const [isPublishing, setIsPublishing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPaintingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  const keysRef = useRef<Record<string, boolean>>({});
  const mouseLookDeltaRef = useRef<number>(0);
  const mouseFireRef = useRef<boolean>(false);

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
    enableDash,
    enableBlaster,
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
    enableDash,
    enableBlaster,
    render3DInTest,
    playerColor,
    bgColor,
    wallColor,
    customScript,
  };

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

      // Save to local CloudSync cache immediately
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

      // Sync to backend CloudSync telemetry endpoint
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

  const simRef = useRef<{
    levelIndex: number;
    player: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      w: number;
      h: number;
      angle: number;
      grounded: boolean;
      jumpsLeft: number;
      jumpKeyLock: boolean;
      dashCd: number;
      dashFrames: number;
      facing: number;
      shootCd: number;
      hp: number;
      invulnFrames: number;
      checkpointX: number;
      checkpointY: number;
      muzzleFlash: number;
      bobPhase: number;
      flapLock?: boolean;
    };
    coins: { x: number; y: number; w: number; h: number; taken: boolean }[];
    keysList: { x: number; y: number; w: number; h: number; taken: boolean }[];
    checkpoints: { x: number; y: number; w: number; h: number; used: boolean }[];
    movingPlatforms: { r: number; c: number; x: number; y: number; w: number; h: number; vx: number }[];
    enemies: {
      x: number;
      y: number;
      w: number;
      h: number;
      vx: number;
      vy: number;
      hp: number;
      maxHp: number;
      isBoss: boolean;
      alive: boolean;
    }[];
    bullets: { x: number; y: number; w: number; h: number; vx: number; vy: number }[];
    particles: { x: number; y: number; vx: number; vy: number; color: string; life: number }[];
    score: number;
    status: "playing" | "level_clear" | "won" | "lost";
    levelBannerFrames: number;
    rewardedWin?: boolean;
  } | null>(null);

  const initSimulation = useCallback(
    (targetLevelIdx = 0, carryScore = 0) => {
      const p = projectStateRef.current;
      const safeLvlIdx = Math.max(0, Math.min(p.levels.length - 1, targetLevelIdx));
      const lvl = p.levels[safeLvlIdx] || p.levels[0];
      const lvlGrid = lvl.grid;

      let spawnX = 68;
      let spawnY = 200;
      const coinsList: { x: number; y: number; w: number; h: number; taken: boolean }[] = [];
      const keysList: { x: number; y: number; w: number; h: number; taken: boolean }[] = [];
      const checkpoints: { x: number; y: number; w: number; h: number; used: boolean }[] = [];
      const movingPlatforms: {
        r: number;
        c: number;
        x: number;
        y: number;
        w: number;
        h: number;
        vx: number;
      }[] = [];
      const enemies: {
        x: number;
        y: number;
        w: number;
        h: number;
        vx: number;
        vy: number;
        hp: number;
        maxHp: number;
        isBoss: boolean;
        alive: boolean;
      }[] = [];

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = lvlGrid[r]?.[c] || 0;
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
          } else if (cell === 5 || cell === 9) {
            const isBoss = cell === 9;
            enemies.push({
              x: c * TILE_SIZE + 4,
              y: r * TILE_SIZE + 4,
              w: isBoss ? 28 : 24,
              h: isBoss ? 28 : 24,
              vx: isBoss ? 2.0 : 1.5,
              vy: 0,
              hp: isBoss ? 3 : 1,
              maxHp: isBoss ? 3 : 1,
              isBoss,
              alive: true,
            });
          } else if (cell === 8) {
            movingPlatforms.push({
              r,
              c,
              x: c * TILE_SIZE,
              y: r * TILE_SIZE,
              w: TILE_SIZE,
              h: 14,
              vx: 1.4,
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
          }
        }
      }

      const startHp = p.maxHp || 3;
      simRef.current = {
        levelIndex: safeLvlIdx,
        player: {
          x: spawnX,
          y: spawnY,
          vx: 0,
          vy: 0,
          w: 22,
          h: 22,
          angle: 0,
          grounded: false,
          jumpsLeft: p.enableDoubleJump ? 2 : 1,
          jumpKeyLock: false,
          dashCd: 0,
          dashFrames: 0,
          facing: 1,
          shootCd: 0,
          hp: startHp,
          invulnFrames: 0,
          checkpointX: spawnX,
          checkpointY: spawnY,
          muzzleFlash: 0,
          bobPhase: 0,
        },
        coins: coinsList,
        keysList,
        checkpoints,
        movingPlatforms,
        enemies,
        bullets: [],
        particles: [],
        score: carryScore,
        status: "playing",
        levelBannerFrames: 75,
        rewardedWin: false,
      };
      setLivePlayLevelIdx(safeLvlIdx);
      setLiveScore(carryScore);
      setLiveHp(startHp);
      setGameStatus("playing");
    },
    []
  );

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

    // Listen for CloudSync progress postMessages from custom index.html games
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

    fetchCloudProgressForGame(activeGameId);

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
  }, [visible, activeGameId, mergePublishedGame, fetchCloudProgressForGame]);

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
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(
          e.code
        )
      ) {
        e.preventDefault();
      }
      if (isPlayingRef.current && e.code === "KeyR") {
        initSimulation(0, 0);
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

  // 60fps Canvas Render & Physics Loop (Supports 2D Multi-Level AND First-Person 3D Raycaster!)
  useEffect(() => {
    if (!visible || subTab !== "editor" || playingCustomHtmlGame) return;
    let rafId = 0;

    const overlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number }
    ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const spawnParticles = (x: number, y: number, color: string, count = 10) => {
      if (!simRef.current) return;
      for (let i = 0; i < count; i++) {
        simRef.current.particles.push({
          x,
          y,
          vx: (Math.random() - 0.5) * 6.5,
          vy: (Math.random() - 0.5) * 6.5,
          color,
          life: 22,
        });
      }
    };

    const damagePlayer = () => {
      const sim = simRef.current;
      if (!sim || sim.player.invulnFrames > 0) return;
      sim.player.hp -= 1;
      setLiveHp(sim.player.hp);
      spawnParticles(sim.player.x + 11, sim.player.y + 11, "#ef4444", 16);
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
      const sim = simRef.current;
      const activeLvl = isPlayingRef.current && sim
        ? cfg.levels[sim.levelIndex] || cfg.levels[0]
        : cfg.levels[cfg.activeLevelIdx] || cfg.levels[0];
      const activeGrid = activeLvl?.grid || cfg.levels[0].grid;
      const lvlBg = activeLvl?.bgColor || cfg.bgColor;
      const lvlWall = activeLvl?.wallColor || cfg.wallColor;
      const use3D = isPlayingRef.current && (cfg.mode === "fps3d" || cfg.render3DInTest);

      // --- SIMULATION STEP ---
      if (isPlayingRef.current && sim && sim.status === "playing") {
        const keys = keysRef.current;
        const pl = sim.player;
        if (pl.invulnFrames > 0) pl.invulnFrames--;
        if (pl.dashCd > 0) pl.dashCd--;
        if (pl.shootCd > 0) pl.shootCd--;
        if (pl.muzzleFlash > 0) pl.muzzleFlash--;
        if (sim.levelBannerFrames > 0) sim.levelBannerFrames--;

        const allKeysCollected = sim.keysList.every((k) => k.taken);

        if (use3D) {
          // --- FIRST-PERSON 3D RAYCASTER MOVEMENT & SHOOTING ---
          const turnSpeed = 0.055;
          if (keys["ArrowLeft"]) pl.angle -= turnSpeed;
          if (keys["ArrowRight"]) pl.angle += turnSpeed;
          if (mouseLookDeltaRef.current !== 0) {
            pl.angle += mouseLookDeltaRef.current * 0.0045;
            mouseLookDeltaRef.current = 0;
          }

          const moveSpd = cfg.moveSpeed * 0.65;
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
          if (Math.hypot(dx, dy) > 0.1) pl.bobPhase += 0.18;

          const isSolidCell = (r: number, c: number) => {
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
            const id = activeGrid[r][c];
            if (id === 1 || id === 8) return true;
            if (id === 12 && !allKeysCollected) return true;
            return false;
          };

          const nextX = pl.x + dx;
          const nextY = pl.y + dy;
          const pad = 8;
          const curR = Math.floor((pl.y + 11) / TILE_SIZE);
          const curC = Math.floor((pl.x + 11) / TILE_SIZE);
          const checkC = Math.floor((nextX + 11 + (dx > 0 ? pad : -pad)) / TILE_SIZE);
          const checkR = Math.floor((nextY + 11 + (dy > 0 ? pad : -pad)) / TILE_SIZE);

          if (!isSolidCell(curR, checkC)) pl.x = nextX;
          if (!isSolidCell(checkR, curC)) pl.y = nextY;

          // Fire 3D Hitscan / Plasma Ray
          if ((keys["Space"] || mouseFireRef.current) && pl.shootCd <= 0) {
            mouseFireRef.current = false;
            pl.shootCd = 15;
            pl.muzzleFlash = 6;

            // Find closest enemy near center crosshair ray
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
              if (Math.abs(diff) < 0.22 && dist < bestDist) {
                bestDist = dist;
                bestEnemy = en;
              }
            }
            if (bestEnemy) {
              bestEnemy.hp -= 1;
              if (bestEnemy.hp <= 0) {
                bestEnemy.alive = false;
                sim.score += bestEnemy.isBoss ? 75 : 30;
                setLiveScore(sim.score);
              }
            }
          }
        } else {
          // --- 2D SOPHISTICATED PLATFORMER / TOPDOWN / SHOOTER / FLAPPY ---
          const left = keys["ArrowLeft"] || keys["KeyA"];
          const right = keys["ArrowRight"] || keys["KeyD"];
          const up = keys["ArrowUp"] || keys["KeyW"] || keys["Space"];
          const down = keys["ArrowDown"] || keys["KeyS"];
          const dashKey = keys["ShiftLeft"] || keys["ShiftRight"];

          if (right) pl.facing = 1;
          else if (left) pl.facing = -1;

          // Dash ability
          if (cfg.enableDash && dashKey && pl.dashCd <= 0) {
            pl.dashFrames = 7;
            pl.dashCd = 42;
            spawnParticles(pl.x + 11, pl.y + 11, "#38bdf8", 8);
          }

          if (cfg.mode === "platformer") {
            const baseVx = (right ? cfg.moveSpeed : 0) - (left ? cfg.moveSpeed : 0);
            pl.vx = pl.dashFrames > 0 ? pl.facing * cfg.moveSpeed * 2.5 : baseVx;
            if (pl.dashFrames > 0) pl.dashFrames--;

            if (up && !pl.jumpKeyLock && pl.jumpsLeft > 0) {
              pl.vy = -cfg.jumpForce;
              pl.grounded = false;
              pl.jumpsLeft--;
              pl.jumpKeyLock = true;
              spawnParticles(pl.x + 11, pl.y + 22, "#94a3b8", 5);
            }
            if (!up) pl.jumpKeyLock = false;
            pl.vy += cfg.gravity;
          } else if (cfg.mode === "topdown" || cfg.mode === "shooter") {
            pl.vx = (right ? cfg.moveSpeed : 0) - (left ? cfg.moveSpeed : 0);
            pl.vy =
              (down ? cfg.moveSpeed : 0) -
              (keys["ArrowUp"] || keys["KeyW"] ? cfg.moveSpeed : 0);
          } else if (cfg.mode === "flappy") {
            pl.vx = cfg.moveSpeed * 0.65;
            if (up && !pl.flapLock) {
              pl.vy = -cfg.jumpForce;
              pl.flapLock = true;
            }
            if (!up) pl.flapLock = false;
            pl.vy += cfg.gravity;
          }

          // Blaster firing in 2D
          if (
            (cfg.enableBlaster || cfg.mode === "shooter") &&
            (keys["KeyF"] || (cfg.mode === "shooter" && keys["Space"]) || mouseFireRef.current) &&
            pl.shootCd <= 0
          ) {
            mouseFireRef.current = false;
            sim.bullets.push({
              x: pl.facing > 0 ? pl.x + pl.w : pl.x - 10,
              y: pl.y + pl.h / 2 - 2,
              w: 12,
              h: 4,
              vx: pl.facing * 9.5,
              vy: 0,
            });
            pl.shootCd = 14;
          }

          // Update moving platforms
          for (const mp of sim.movingPlatforms) {
            mp.x += mp.vx;
            const nextC = Math.floor((mp.x + (mp.vx > 0 ? mp.w : 0)) / TILE_SIZE);
            if (
              nextC < 0 ||
              nextC >= COLS ||
              activeGrid[mp.r]?.[nextC] === 1
            ) {
              mp.vx *= -1;
            }
          }

          pl.x += pl.vx;
          if (pl.x < 0) pl.x = 0;
          if (pl.x + pl.w > COLS * TILE_SIZE) pl.x = COLS * TILE_SIZE - pl.w;

          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              const cell = activeGrid[r][c];
              if (cell === 1 || (cell === 12 && !allKeysCollected)) {
                const box = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
                if (overlap(pl, box)) {
                  if (pl.vx > 0) pl.x = box.x - pl.w;
                  else if (pl.vx < 0) pl.x = box.x + box.w;
                  if (cfg.mode === "flappy") damagePlayer();
                }
              }
            }
          }

          pl.y += pl.vy;
          pl.grounded = false;
          if (pl.y > ROWS * TILE_SIZE) {
            damagePlayer();
          }

          // Moving platform collision
          for (const mp of sim.movingPlatforms) {
            if (overlap(pl, mp) && pl.vy >= 0 && pl.y + pl.h - pl.vy <= mp.y + 10) {
              pl.y = mp.y - pl.h;
              pl.vy = 0;
              pl.x += mp.vx;
              pl.grounded = true;
              pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
            }
          }
        }

        // Shared Tile Interactions (Walls, Lava, Bounce, Portal)
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const cell = activeGrid[r][c];
            if (cell === 0 || cell === 2 || cell === 3 || cell === 5 || cell === 8 || cell === 9)
              continue;
            const box = { x: c * TILE_SIZE, y: r * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
            if (!overlap(pl, box)) continue;

            if (!use3D && (cell === 1 || (cell === 12 && !allKeysCollected))) {
              if (pl.vy > 0) {
                pl.y = box.y - pl.h;
                pl.vy = 0;
                pl.grounded = true;
                pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
              } else if (pl.vy < 0) {
                pl.y = box.y + box.h;
                pl.vy = 0;
              }
            } else if (cell === 4) {
              damagePlayer();
            } else if (cell === 6) {
              if (use3D) {
                pl.x += Math.cos(pl.angle) * 14;
                pl.y += Math.sin(pl.angle) * 14;
              } else {
                pl.vy = -cfg.jumpForce * 1.38;
                pl.grounded = false;
                pl.jumpsLeft = cfg.enableDoubleJump ? 2 : 1;
              }
              spawnParticles(pl.x + 11, pl.y + 20, "#06b6d4", 8);
            } else if (cell === 7) {
              // LEVEL GOAL PORTAL REACHED!
              spawnParticles(pl.x + 11, pl.y + 11, "#10b981", 18);
              const nextLvlIdx = sim.levelIndex + 1;
              if (nextLvlIdx < cfg.levels.length) {
                const bonusScore = sim.score + 50;
                addCookieCoins(10, `cleared level ${sim.levelIndex + 1} in ${cfg.title}`);
                syncProgressToCloud({
                  levelReached: nextLvlIdx + 1,
                  score: bonusScore,
                });
                notifyToast(
                  `level ${sim.levelIndex + 1} complete! advancing to ${
                    cfg.levels[nextLvlIdx].name
                  } (+10 coins)`,
                  "success"
                );
                initSimulation(nextLvlIdx, bonusScore);
                break;
              } else {
                sim.status = "won";
                setGameStatus("won");
                if (!sim.rewardedWin) {
                  sim.rewardedWin = true;
                  sim.score += 100;
                  setLiveScore(sim.score);
                  addCookieCoins(25, `beat all levels of ${cfg.title}`);
                  recordGameActivity(cfg.title, 25, 1, sim.score);
                  syncProgressToCloud({
                    levelReached: cfg.levels.length,
                    score: sim.score,
                    completedGame: true,
                  });
                }
              }
            }
          }
        }

        // Collect Coins
        for (const coin of sim.coins) {
          if (!coin.taken && overlap(pl, coin)) {
            coin.taken = true;
            sim.score += 10;
            setLiveScore(sim.score);
            spawnParticles(coin.x + 8, coin.y + 8, "#eab308", 8);
            syncProgressToCloud({ score: sim.score, coinsAdded: 1 });
          }
        }

        // Collect Keys
        for (const k of sim.keysList) {
          if (!k.taken && overlap(pl, k)) {
            k.taken = true;
            sim.score += 20;
            setLiveScore(sim.score);
            spawnParticles(k.x + 10, k.y + 10, "#f59e0b", 12);
            notifyToast("golden key collected! locked gate opened", "info");
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
            spawnParticles(cp.x + 10, cp.y + 10, "#f43f5e", 12);
            notifyToast("checkpoint saved & +1 hp restored!", "success");
          }
        }

        // Update 2D Bullets
        for (const b of sim.bullets) {
          b.x += b.vx;
          b.y += b.vy;
          for (const en of sim.enemies) {
            if (en.alive && overlap(b, en)) {
              en.hp -= 1;
              b.x = 99999;
              if (en.hp <= 0) {
                en.alive = false;
                sim.score += en.isBoss ? 75 : 25;
                setLiveScore(sim.score);
                spawnParticles(en.x + 12, en.y + 12, en.isBoss ? "#ec4899" : "#a855f7", 14);
              } else {
                spawnParticles(en.x + 12, en.y + 12, "#facc15", 6);
              }
            }
          }
        }

        // Update Enemies (Patrol & Boss Chasers)
        for (const en of sim.enemies) {
          if (!en.alive) continue;
          if (en.isBoss && (use3D || cfg.mode === "topdown" || cfg.mode === "shooter")) {
            const ang = Math.atan2(pl.y - en.y, pl.x - en.x);
            en.x += Math.cos(ang) * 1.15;
            en.y += Math.sin(ang) * 1.15;
          } else {
            en.x += en.vx;
            const nextCol = Math.floor((en.x + (en.vx > 0 ? en.w : 0)) / TILE_SIZE);
            const row = Math.floor((en.y + 12) / TILE_SIZE);
            if (
              nextCol < 0 ||
              nextCol >= COLS ||
              (activeGrid[row] && activeGrid[row][nextCol] === 1)
            ) {
              en.vx *= -1;
            }
          }

          if (overlap(pl, en)) {
            if (
              !use3D &&
              cfg.mode === "platformer" &&
              pl.vy > 1 &&
              pl.y + pl.h - pl.vy <= en.y + 13
            ) {
              en.hp -= 1;
              pl.vy = -cfg.jumpForce * 0.82;
              if (en.hp <= 0) {
                en.alive = false;
                sim.score += en.isBoss ? 75 : 25;
              }
              setLiveScore(sim.score);
              spawnParticles(en.x + 12, en.y + 12, "#a855f7", 12);
            } else {
              damagePlayer();
            }
          }
        }

        if (cfg.customScript && cfg.customScript.trim() && !isForeignProjectRef.current) {
          try {
            const fn = new Function("ctx", "state", "player", cfg.customScript);
            fn(ctx, sim, pl);
          } catch {}
        }
      }

      // --- RENDER STAGE ---
      if (use3D && sim) {
        // ===================================================================
        // LIGHTWEIGHT FIRST-PERSON 3D RAYCASTER ENGINE (60FPS)
        // ===================================================================
        const W = canvas.width;
        const H = canvas.height;
        const pl = sim.player;
        const fov = Math.PI / 3;
        const numRays = 170;
        const stripW = W / numRays;
        const zBuffer = new Float32Array(numRays);

        // Sky & Floor Gradient
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

        // Raycast Walls
        for (let i = 0; i < numRays; i++) {
          const rayAngle = pl.angle - fov / 2 + (i / numRays) * fov;
          const sin = Math.sin(rayAngle);
          const cos = Math.cos(rayAngle);

          let dist = 0;
          let hitId = 0;
          let hitSide = 0;
          const step = 0.03;
          let rx = px;
          let ry = py;

          while (dist < 22) {
            rx += cos * step;
            ry += sin * step;
            dist += step;
            const c = Math.floor(rx);
            const r = Math.floor(ry);
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS) {
              hitId = 1;
              break;
            }
            const cell = activeGrid[r][c];
            if (cell === 1 || cell === 8 || (cell === 12 && !allKeysTaken)) {
              hitId = cell;
              const fracX = Math.abs(rx - Math.round(rx));
              const fracY = Math.abs(ry - Math.round(ry));
              hitSide = fracX < fracY ? 1 : 0;
              break;
            }
          }

          const perpDist = Math.max(0.15, dist * Math.cos(rayAngle - pl.angle));
          zBuffer[i] = perpDist;

          const wallH = Math.min(H * 1.4, (H * 0.92) / perpDist);
          const topY = (H - wallH) / 2;
          const shade = Math.max(0.18, 1 - perpDist / 16) * (hitSide ? 0.78 : 1);

          ctx.fillStyle = hitId === 12 ? "#f59e0b" : hitId === 8 ? "#6366f1" : lvlWall;
          ctx.globalAlpha = shade;
          ctx.fillRect(i * stripW, topY, stripW + 1, wallH);

          // Neon trim along top and bottom of 3D wall
          ctx.fillStyle = "#38bdf8";
          ctx.fillRect(i * stripW, topY, stripW + 1, 2);
          ctx.fillRect(i * stripW, topY + wallH - 2, stripW + 1, 2);
        }
        ctx.globalAlpha = 1;

        // Collect 3D Sprites (Coins, Enemies, Keys, Checkpoints, Exit Portals, Lava)
        const sprites: { x: number; y: number; color: string; kind: string; hp?: number }[] = [];
        for (const coin of sim.coins) {
          if (!coin.taken) {
            sprites.push({
              x: (coin.x + 8) / TILE_SIZE,
              y: (coin.y + 8) / TILE_SIZE,
              color: "#eab308",
              kind: "coin",
            });
          }
        }
        for (const k of sim.keysList) {
          if (!k.taken) {
            sprites.push({
              x: (k.x + 10) / TILE_SIZE,
              y: (k.y + 10) / TILE_SIZE,
              color: "#f59e0b",
              kind: "key",
            });
          }
        }
        for (const cp of sim.checkpoints) {
          if (!cp.used) {
            sprites.push({
              x: (cp.x + 10) / TILE_SIZE,
              y: (cp.y + 10) / TILE_SIZE,
              color: "#f43f5e",
              kind: "heart",
            });
          }
        }
        for (const en of sim.enemies) {
          if (en.alive) {
            sprites.push({
              x: (en.x + en.w / 2) / TILE_SIZE,
              y: (en.y + en.h / 2) / TILE_SIZE,
              color: en.isBoss ? "#ec4899" : "#a855f7",
              kind: en.isBoss ? "boss" : "enemy",
              hp: en.hp,
            });
          }
        }
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (activeGrid[r][c] === 7) {
              sprites.push({ x: c + 0.5, y: r + 0.5, color: "#10b981", kind: "portal" });
            } else if (activeGrid[r][c] === 4) {
              sprites.push({ x: c + 0.5, y: r + 0.5, color: "#ef4444", kind: "lava" });
            }
          }
        }

        sprites.sort(
          (a, b) =>
            Math.hypot(b.x - px, b.y - py) - Math.hypot(a.x - px, a.y - py)
        );

        for (const sp of sprites) {
          const sx = sp.x - px;
          const sy = sp.y - py;
          const dist = Math.hypot(sx, sy);
          if (dist < 0.25 || dist > 18) continue;

          let spriteAngle = Math.atan2(sy, sx) - pl.angle;
          while (spriteAngle < -Math.PI) spriteAngle += Math.PI * 2;
          while (spriteAngle > Math.PI) spriteAngle -= Math.PI * 2;
          if (Math.abs(spriteAngle) > fov * 0.7) continue;

          const screenX = (0.5 + spriteAngle / fov) * W;
          const rayIdx = Math.floor((screenX / W) * numRays);
          if (rayIdx >= 0 && rayIdx < numRays && zBuffer[rayIdx] < dist) continue;

          const size = Math.min(220, (H * 0.65) / dist);
          ctx.fillStyle = sp.color;
          if (sp.kind === "coin" || sp.kind === "key" || sp.kind === "heart") {
            ctx.beginPath();
            ctx.arc(screenX, H / 2 + size * 0.15, size * 0.26, 0, Math.PI * 2);
            ctx.fill();
          } else if (sp.kind === "portal") {
            ctx.strokeStyle = "#10b981";
            ctx.lineWidth = 4;
            ctx.strokeRect(screenX - size * 0.28, H / 2 - size * 0.45, size * 0.56, size * 0.9);
          } else if (sp.kind === "lava") {
            ctx.fillRect(screenX - size * 0.35, H / 2 + size * 0.35, size * 0.7, size * 0.18);
          } else {
            // 3D Enemy / Boss Billboard
            const boxW = sp.kind === "boss" ? size * 0.68 : size * 0.5;
            const boxH = sp.kind === "boss" ? size * 0.85 : size * 0.65;
            ctx.fillRect(screenX - boxW / 2, H / 2 - boxH / 2, boxW, boxH);
            ctx.fillStyle = "#fff";
            ctx.fillRect(screenX - boxW * 0.22, H / 2 - boxH * 0.2, boxW * 0.14, boxW * 0.14);
            ctx.fillRect(screenX + boxW * 0.08, H / 2 - boxH * 0.2, boxW * 0.14, boxW * 0.14);
          }
        }

        // Crosshair
        ctx.strokeStyle = "#4ade80";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(W / 2 - 10, H / 2);
        ctx.lineTo(W / 2 + 10, H / 2);
        ctx.moveTo(W / 2, H / 2 - 10);
        ctx.lineTo(W / 2, H / 2 + 10);
        ctx.stroke();

        // 3D First-Person Weapon Viewmodel + Muzzle Flash
        const bobX = Math.cos(pl.bobPhase) * 6;
        const bobY = Math.abs(Math.sin(pl.bobPhase)) * 6 + (pl.muzzleFlash > 0 ? 8 : 0);
        if (pl.muzzleFlash > 0) {
          ctx.fillStyle = "#38bdf8";
          ctx.beginPath();
          ctx.arc(W * 0.66 + bobX, H - 95 + bobY, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(W * 0.66 + bobX, H - 95 + bobY);
          ctx.lineTo(W / 2, H / 2);
          ctx.stroke();
        }
        ctx.fillStyle = "#1e293b";
        ctx.fillRect(W * 0.63 + bobX, H - 90 + bobY, 54, 95);
        ctx.fillStyle = cfg.playerColor;
        ctx.fillRect(W * 0.65 + bobX, H - 82 + bobY, 16, 65);

        // 3D Minimap Overlay (Top-Left)
        const mmScale = 5.5;
        ctx.fillStyle = "rgba(9, 13, 22, 0.82)";
        ctx.fillRect(10, 10, COLS * mmScale, ROWS * mmScale);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const id = activeGrid[r][c];
            if (id === 1) {
              ctx.fillStyle = lvlWall;
              ctx.fillRect(10 + c * mmScale, 10 + r * mmScale, mmScale, mmScale);
            } else if (id === 7) {
              ctx.fillStyle = "#10b981";
              ctx.fillRect(10 + c * mmScale, 10 + r * mmScale, mmScale, mmScale);
            }
          }
        }
        ctx.fillStyle = "#22c55e";
        ctx.fillRect(10 + px * mmScale - 2, 10 + py * mmScale - 2, 4, 4);
      } else {
        // ===================================================================
        // 2D TILE EDITOR & 2D ENGINE RENDERER
        // ===================================================================
        ctx.fillStyle = lvlBg;
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

        const allKeysTaken = sim ? sim.keysList.every((k) => k.taken) : false;

        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const id = activeGrid[r]?.[c] || 0;
            const x = c * TILE_SIZE;
            const y = r * TILE_SIZE;

            if (id === 1) {
              ctx.fillStyle = lvlWall;
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
            } else if ((id === 5 || id === 9) && !isPlayingRef.current) {
              ctx.fillStyle = id === 9 ? "#ec4899" : "#a855f7";
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
            } else if (id === 8 && !isPlayingRef.current) {
              ctx.fillStyle = "#6366f1";
              ctx.fillRect(x + 1, y + 2, TILE_SIZE - 2, 14);
            } else if (id === 10 && !isPlayingRef.current) {
              ctx.fillStyle = "#f43f5e";
              ctx.beginPath();
              ctx.arc(x + TILE_SIZE / 2, y + TILE_SIZE / 2, 9, 0, Math.PI * 2);
              ctx.fill();
            } else if (id === 11 && !isPlayingRef.current) {
              ctx.fillStyle = "#f59e0b";
              ctx.fillRect(x + 9, y + 9, 16, 16);
            } else if (id === 12 && (!isPlayingRef.current || !allKeysTaken)) {
              ctx.fillStyle = "#94a3b8";
              ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            }
          }
        }

        if (isPlayingRef.current && sim) {
          ctx.fillStyle = "#6366f1";
          for (const mp of sim.movingPlatforms) {
            ctx.fillRect(mp.x, mp.y, mp.w, mp.h);
          }

          ctx.fillStyle = "#eab308";
          for (const coin of sim.coins) {
            if (!coin.taken) {
              ctx.beginPath();
              ctx.arc(coin.x + 8, coin.y + 8, 7, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          ctx.fillStyle = "#f59e0b";
          for (const k of sim.keysList) {
            if (!k.taken) {
              ctx.fillRect(k.x, k.y, k.w, k.h);
            }
          }

          ctx.fillStyle = "#f43f5e";
          for (const cp of sim.checkpoints) {
            if (!cp.used) {
              ctx.beginPath();
              ctx.arc(cp.x + 10, cp.y + 10, 8, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          for (const en of sim.enemies) {
            if (en.alive) {
              ctx.fillStyle = en.isBoss ? "#ec4899" : "#a855f7";
              ctx.fillRect(en.x, en.y, en.w, en.h);
              if (en.isBoss && en.maxHp > 1) {
                ctx.fillStyle = "#ef4444";
                ctx.fillRect(en.x, en.y - 6, (en.w * en.hp) / en.maxHp, 4);
              }
            }
          }

          ctx.fillStyle = "#38bdf8";
          for (const b of sim.bullets) {
            if (b.x > 0 && b.x < COLS * TILE_SIZE) {
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

          if (sim.player.invulnFrames % 4 < 2) {
            ctx.fillStyle = cfg.playerColor;
            ctx.fillRect(sim.player.x, sim.player.y, sim.player.w, sim.player.h);
          }
        }
      }

      // Level Banner & Win/Loss Overlay
      if (isPlayingRef.current && sim) {
        if (sim.levelBannerFrames > 0 && sim.status === "playing") {
          ctx.fillStyle = "rgba(9, 13, 22, 0.78)";
          ctx.fillRect(canvas.width / 2 - 140, 14, 280, 32);
          ctx.fillStyle = "#38bdf8";
          ctx.font = "bold 13px Lexend, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            `${activeLvl?.name || `level ${sim.levelIndex + 1}`} (${sim.levelIndex + 1}/${
              cfg.levels.length
            })`,
            canvas.width / 2,
            34
          );
        }

        if (sim.status !== "playing") {
          ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = sim.status === "won" ? "#4ade80" : "#f87171";
          ctx.font = "bold 25px Lexend, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(
            sim.status === "won"
              ? `ALL ${cfg.levels.length} LEVELS COMPLETED! (+25 COINS)`
              : "GAME OVER — OUT OF HP",
            canvas.width / 2,
            canvas.height / 2 - 10
          );
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "14px Lexend, sans-serif";
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
  }, [visible, subTab, playingCustomHtmlGame, initSimulation, syncProgressToCloud]);

  const updateCurrentLevelGrid = (updater: (prevGrid: number[][]) => number[][]) => {
    setLevels((prevLevels) =>
      prevLevels.map((lvl, idx) =>
        idx === activeLevelIdx ? { ...lvl, grid: updater(lvl.grid) } : lvl
      )
    );
  };

  const handleCanvasPaint = (e: MouseEvent) => {
    if (isPlaying || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const col = Math.floor(((e.clientX - rect.left) * scaleX) / TILE_SIZE);
    const row = Math.floor(((e.clientY - rect.top) * scaleY) / TILE_SIZE);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;

    updateCurrentLevelGrid((prev) => {
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
    setRender3DInTest(preset === "fps3d");
    setLevels(makeDefaultLevels(preset));
    setActiveLevelIdx(0);
    if (preset === "platformer") {
      setGravity(0.55);
      setJumpForce(11.5);
      setMoveSpeed(4.2);
    } else if (preset === "fps3d" || preset === "topdown") {
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

  const handleAddLevel = () => {
    setIsPlaying(false);
    setLevels((prev) => {
      const nextNum = prev.length + 1;
      const newLvl: StudioGameLevel = {
        id: `lvl_${Date.now()}`,
        name: `level ${nextNum}: stage ${nextNum}`,
        grid: makePresetGrid(mode, prev.length),
        bgColor,
        wallColor,
      };
      const updated = [...prev, newLvl];
      setActiveLevelIdx(updated.length - 1);
      return updated;
    });
    notifyToast("added new level to your game!", "success");
  };

  const handleDuplicateLevel = () => {
    setIsPlaying(false);
    setLevels((prev) => {
      const src = prev[activeLevelIdx] || prev[0];
      const nextNum = prev.length + 1;
      const copy: StudioGameLevel = {
        id: `lvl_${Date.now()}`,
        name: `level ${nextNum} (copy)`,
        grid: src.grid.map((r) => [...r]),
        bgColor: src.bgColor || bgColor,
        wallColor: src.wallColor || wallColor,
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

  const getActiveAuthor = (): string => {
    return getCloudSyncState().username;
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

  // Handle uploading a custom index.html file for 1,000 Cookie Coins
  const handleHtmlFileSelect = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      notifyToast("html file too large (max 2MB)", "error");
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

  // Manage Blob URL for Live HTML File Upload Preview (debounced so typing in textarea is smooth & zero memory leaks)
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

  // Manage Blob URL for playing a published custom index.html game inside Studio
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

      if (!spendCookieCoins(CUSTOM_HTML_UPLOAD_COST)) {
        notifyToast(`insufficient cookie coins (${CUSTOM_HTML_UPLOAD_COST} required)`, "error");
        return;
      }
      setCoins(getCookieCoins());

      const newGame: StudioGameProject = {
        id: `htmlgame_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: cleanTitle,
        description:
          htmlDesc.trim() || `custom index.html game served by ${userStudio.name}`,
        author: getActiveAuthor(),
        studioName: userStudio.name,
        studioColor: userStudio.color,
        mode: "custom_html",
        grid: createEmptyGrid(),
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

      mergePublishedGame(newGame);
      try {
        broadcastRef.current?.postMessage({ type: "GAME_PUBLISHED", game: newGame });
      } catch {}

      await fetch("/api/studio/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: newGame }),
      }).catch(() => {});

      notifyToast(
        `published custom index.html game "${cleanTitle}" under ${userStudio.name}! (-1,000 coins)`,
        "success"
      );
      setSubTab("community");
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
        grid: levels[0].grid.map((r) => [...r]),
        levels: levels.map((l) => ({
          ...l,
          grid: l.grid.map((r) => [...r]),
        })),
        gravity,
        jumpForce,
        moveSpeed,
        maxHp,
        enableDoubleJump,
        enableDash,
        enableBlaster,
        playerColor,
        bgColor,
        wallColor,
        customScript,
        likes: 1,
        plays: 1,
        createdAt: new Date().toISOString(),
      };

      mergePublishedGame(newGame);
      setActiveGameId(newGame.id);
      try {
        broadcastRef.current?.postMessage({ type: "GAME_PUBLISHED", game: newGame });
      } catch {}

      await fetch("/api/studio/games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ game: newGame }),
      }).catch(() => {});

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

    // If this is a custom uploaded index.html game, serve that directly instead of the tile engine!
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
        ? g.levels.map((l) => ({ ...l, grid: l.grid.map((r) => [...r]) }))
        : [
            {
              id: "lvl_1",
              name: "level 1",
              grid: g.grid.map((r) => [...r]),
              bgColor: g.bgColor,
              wallColor: g.wallColor,
            },
          ];
    setLevels(loadedLevels);
    setActiveLevelIdx(0);
    setGravity(g.gravity);
    setJumpForce(g.jumpForce);
    setMoveSpeed(g.moveSpeed);
    setMaxHp(g.maxHp || 3);
    setEnableDoubleJump(g.enableDoubleJump ?? true);
    setEnableDash(g.enableDash ?? true);
    setEnableBlaster(g.enableBlaster ?? true);
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

  const cloudSyncInfo = getCloudSyncState();

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
            <i class="fa-solid fa-hammer"></i>
            <span>2d / 3d game engine</span>
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
            <span>upload index.html (1,000 🍪)</span>
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
                  { id: "fps3d", label: "first-person 3d", icon: "fa-cube" },
                  { id: "platformer", label: "platformers", icon: "fa-person-running" },
                  { id: "topdown", label: "top-down", icon: "fa-compass" },
                  { id: "shooter", label: "shooters", icon: "fa-jet-fighter" },
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
                no community games published yet
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "12.5px",
                  color: "var(--color-sublabel)",
                  maxWidth: "460px",
                }}
              >
                only real user-created games appear here. open the{" "}
                <strong>2d / 3d game engine</strong> (with multi-level progression & first-person 3d
                raycasting) or <strong>upload a custom index.html file</strong> to publish the first
                game!
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  class="apps-custom-btn"
                  onClick={() => setSubTab("editor")}
                >
                  <i class="fa-solid fa-hammer"></i>
                  <span>open 2d / 3d game engine</span>
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
                          title="Remix in Game Engine"
                          onClick={() => loadGameIntoEngine(g, false)}
                        >
                          <i class="fa-solid fa-code-branch"></i>
                        </button>
                        <button
                          type="button"
                          class="studio-tool-btn"
                          title="Like game"
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
                        <button
                          type="button"
                          class="studio-tool-btn"
                          style={{ flex: 1, justifyContent: "center" }}
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
                    <span>upload custom index.html (1,000 🍪)</span>
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
                    {userStudio.coinsEarned} 🍪
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
                  engine (+50 coins) or upload a custom index.html file (1,000 coins)!
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
              <span>upload index.html to studio (1,000 🍪)</span>
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

          {/* Live Sandbox Preview of the uploaded index.html */}
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

      {/* TAB 3: SOPHISTICATED MULTI-LEVEL 2D & FIRST-PERSON 3D GAME ENGINE */}
      {subTab === "editor" && (
        <>
          {playingCustomHtmlGame ? (
            /* SERVING UPLOADED CUSTOM INDEX.HTML GAME DIRECTLY */
            <div class="studio-stage-panel" style={{ width: "100%" }}>
              <div class="studio-stage-toolbar">
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <button
                    type="button"
                    class="studio-tool-btn"
                    onClick={() => {
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
            <div class="studio-workspace">
              {/* LEFT PANEL: 2D/3D Modes, Multi-Level Manager & 12 Tile Brushes */}
              <div class="studio-panel">
                <h3 class="studio-panel-title">
                  <span>1. engine dimension & mode</span>
                  <i class="fa-solid fa-cube"></i>
                </h3>
                <div class="studio-tool-grid">
                  {(
                    [
                      { id: "fps3d", label: "1st-person 3d", icon: "fa-cube" },
                      { id: "platformer", label: "2d platformer", icon: "fa-person-running" },
                      { id: "topdown", label: "2d dungeon", icon: "fa-compass" },
                      { id: "shooter", label: "arena shooter", icon: "fa-jet-fighter" },
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

                {/* MULTI-LEVEL MANAGER */}
                <h3 class="studio-panel-title" style={{ marginTop: "6px" }}>
                  <span>2. levels ({levels.length})</span>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      style={{ padding: "3px 7px", fontSize: "10.5px" }}
                      onClick={handleAddLevel}
                      title="Add New Level"
                    >
                      <i class="fa-solid fa-plus"></i> add
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      style={{ padding: "3px 7px", fontSize: "10.5px" }}
                      onClick={handleDuplicateLevel}
                      title="Duplicate Current Level"
                    >
                      <i class="fa-solid fa-copy"></i>
                    </button>
                    <button
                      type="button"
                      class="studio-tool-btn"
                      style={{ padding: "3px 7px", fontSize: "10.5px" }}
                      onClick={handleDeleteLevel}
                      title="Delete Current Level"
                    >
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </h3>

                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {levels.map((lvl, idx) => (
                    <button
                      key={lvl.id}
                      type="button"
                      class={`studio-tool-btn ${activeLevelIdx === idx ? "active" : ""}`}
                      style={{ padding: "5px 10px", fontSize: "11.5px" }}
                      onClick={() => {
                        setActiveLevelIdx(idx);
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
                  style={{ fontSize: "11.5px", padding: "5px 8px" }}
                  value={currentLevel?.name || ""}
                  onInput={(e) => {
                    const val = e.currentTarget.value;
                    setLevels((prev) =>
                      prev.map((l, i) => (i === activeLevelIdx ? { ...l, name: val } : l))
                    );
                  }}
                  placeholder="level name..."
                />

                <h3 class="studio-panel-title" style={{ marginTop: "6px" }}>
                  <span>3. paint entities & tiles</span>
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
                    updateCurrentLevelGrid(() => g);
                  }}
                >
                  <i class="fa-solid fa-trash-can"></i>
                  <span>clear level {activeLevelIdx + 1} grid</span>
                </button>
              </div>

              {/* CENTER PANEL: Interactive 2D / First-Person 3D Stage + CloudSync Telemetry */}
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
                          ? "stop playing"
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
                      title="Toggle First-Person 3D Raycaster View"
                    >
                      <i class="fa-solid fa-vr-cardboard"></i>
                      <span>{mode === "fps3d" || render3DInTest ? "3d view: on" : "3d view"}</span>
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
                    <span>
                      hp:{" "}
                      <strong style={{ color: "#f43f5e" }}>
                        {"❤️".repeat(Math.max(0, isPlaying ? liveHp : maxHp))}
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
                      onClick={() =>
                        openGameInBrowserTab({
                          id: activeGameId,
                          title: title || "preview game",
                          description,
                          author: getActiveAuthor(),
                          studioName: userStudio.name,
                          studioColor: userStudio.color,
                          mode,
                          grid: levels[0].grid,
                          levels,
                          gravity,
                          jumpForce,
                          moveSpeed,
                          maxHp,
                          enableDoubleJump,
                          enableDash,
                          enableBlaster,
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
                      if (isPlaying) {
                        mouseFireRef.current = true;
                        if (
                          (mode === "fps3d" || render3DInTest) &&
                          canvasRef.current &&
                          document.pointerLockElement !== canvasRef.current
                        ) {
                          canvasRef.current.requestPointerLock?.();
                        }
                        return;
                      }
                      isPaintingRef.current = true;
                      handleCanvasPaint(e);
                    }}
                    onMouseMove={(e) => {
                      if (isPlaying && (mode === "fps3d" || render3DInTest)) {
                        if (document.pointerLockElement === canvasRef.current || e.buttons === 1) {
                          mouseLookDeltaRef.current += e.movementX || 0;
                        }
                        return;
                      }
                      if (isPaintingRef.current) handleCanvasPaint(e);
                    }}
                    onMouseUp={() => {
                      isPaintingRef.current = false;
                      mouseFireRef.current = false;
                    }}
                    onMouseLeave={() => {
                      isPaintingRef.current = false;
                    }}
                  />
                </div>

                <div style={{ fontSize: "11.5px", color: "var(--color-sublabel)" }}>
                  {isPlaying
                    ? mode === "fps3d" || render3DInTest
                      ? "3D CONTROLS: W/S move · A/D strafe · Left/Right or Mouse turn · Click/SPACE shoot plasma blaster · reach emerald portal to advance level!"
                      : "2D CONTROLS: WASD/Arrows move · SPACE jump (2x jump enabled) · SHIFT dash · F/Click shoot blaster · touch hearts for checkpoints!"
                    : `editing "${currentLevel?.name}" — paint walls, coins, bosses, keys, moving platforms, or portals, then click play or toggle 3d view!`}
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
                      <strong>cloudsync player tracker:</strong> @{cloudSyncInfo.username} ·
                      unlocked level{" "}
                      <strong>
                        {myCloudProgress?.highestLevel || 1}/{levels.length}
                      </strong>{" "}
                      · best score: <strong>{myCloudProgress?.bestScore || 0}</strong> · coins:{" "}
                      <strong>{myCloudProgress?.totalCoinsCollected || 0}</strong> · clears:{" "}
                      <strong>{myCloudProgress?.completions || 0}</strong>
                    </span>
                  </div>

                  {myCloudProgress && myCloudProgress.highestLevel > 1 && (
                    <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                      <span style={{ color: "var(--color-sublabel)" }}>jump to unlocked:</span>
                      {levels.slice(0, myCloudProgress.highestLevel).map((l, idx) => (
                        <button
                          key={l.id}
                          type="button"
                          class="studio-tool-btn"
                          style={{ padding: "3px 8px", fontSize: "10.5px" }}
                          onClick={() => {
                            initSimulation(idx, 0);
                            setIsPlaying(true);
                          }}
                        >
                          play lvl {idx + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT PANEL: Physics, Abilities, Colors & Studio Publish */}
              <form class="studio-panel" onSubmit={handlePublishGame}>
                <h3 class="studio-panel-title">
                  <span>4. mechanics & physics</span>
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

                <div class="studio-field">
                  <label>
                    <span>player max hp (hearts)</span>
                    <span>{maxHp} ❤️</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    value={maxHp}
                    onInput={(e) => setMaxHp(parseInt(e.currentTarget.value, 10))}
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

                <div class="studio-tool-grid">
                  <button
                    type="button"
                    class={`studio-tool-btn ${enableDoubleJump ? "active" : ""}`}
                    onClick={() => setEnableDoubleJump((v) => !v)}
                  >
                    <i class="fa-solid fa-angles-up"></i>
                    <span>double jump</span>
                  </button>
                  <button
                    type="button"
                    class={`studio-tool-btn ${enableDash ? "active" : ""}`}
                    onClick={() => setEnableDash((v) => !v)}
                  >
                    <i class="fa-solid fa-wind"></i>
                    <span>shift dash</span>
                  </button>
                  <button
                    type="button"
                    class={`studio-tool-btn ${enableBlaster ? "active" : ""}`}
                    onClick={() => setEnableBlaster((v) => !v)}
                  >
                    <i class="fa-solid fa-crosshairs"></i>
                    <span>plasma blaster</span>
                  </button>
                  <button
                    type="button"
                    class={`studio-tool-btn ${render3DInTest ? "active" : ""}`}
                    onClick={() => setRender3DInTest((v) => !v)}
                  >
                    <i class="fa-solid fa-cube"></i>
                    <span>first-person 3d</span>
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                  <div class="studio-field">
                    <label>hero</label>
                    <input
                      type="color"
                      value={playerColor}
                      onInput={(e) => setPlayerColor(e.currentTarget.value)}
                      style={{ width: "100%", height: "28px", border: "none", borderRadius: "6px" }}
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
                      style={{ width: "100%", height: "28px", border: "none", borderRadius: "6px" }}
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
                      style={{ width: "100%", height: "28px", border: "none", borderRadius: "6px" }}
                    />
                  </div>
                </div>

                <h3 class="studio-panel-title" style={{ marginTop: "4px" }}>
                  <span>5. publish under {userStudio.name}</span>
                  <i class="fa-solid fa-cloud-arrow-up"></i>
                </h3>

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
                    {isPublishing
                      ? "publishing..."
                      : `publish ${levels.length}-level game (+50 coins)`}
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
