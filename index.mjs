import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import { createServer, request } from "http";
import { Database } from "bun:sqlite";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import { LRUCache } from "lru-cache";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { server as wisp } from "@mercuryworkshop/wisp-js";

let shuttingDown = false;

const baremuxPath = path.join(process.cwd(), "node_modules", "@mercuryworkshop", "bare-mux", "dist");
const epoxyPath = path.join(process.cwd(), "node_modules", "@mercuryworkshop", "epoxy-transport", "dist");
const libcurlPath = path.join(process.cwd(), "node_modules", "@mercuryworkshop", "libcurl-transport", "dist");

const PORT = parseInt(process.env.PORT || "3000", 10);
const NODE_ENV = process.env.NODE_ENV || "development";
const packageJsonPath = path.resolve("package.json");

const CACHING_ENABLED = NODE_ENV === "production";
const fileCache = CACHING_ENABLED
  ? new LRUCache({
    maxSize: parseInt(process.env.FILE_CACHE_MAX_MB || "64", 10) * 1024 * 1024,
    ttl: 1000 * 60 * 30,
    ttlAutopurge: true,
    sizeCalculation: (buf) => buf.length,
  })
  : null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

function cachedRead(absPath) {
  if (!CACHING_ENABLED) {
    try {
      return fs.readFileSync(absPath);
    } catch {
      return null;
    }
  }
  let buf = fileCache.get(absPath);
  if (buf) return buf;
  try {
    buf = fs.readFileSync(absPath);
    fileCache.set(absPath, buf);
    return buf;
  } catch {
    return null;
  }
}

function sendCached(res, absPath, cacheControl, extraHeaders) {
  const buf = cachedRead(absPath);
  if (!buf) return false;
  const ext = path.extname(absPath).toLowerCase();
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", cacheControl);
  if (extraHeaders)
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.setHeader("X-File-Cache", "HIT");
  res.send(buf);
  return true;
}

function cachedStatic(
  root,
  cacheControl = "public, max-age=31536000, immutable",
  opts = {},
) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let relative;
    try {
      relative = decodeURIComponent(req.path).replace(/\\/g, "/");
    } catch {
      return next();
    }
    if (relative.includes("..")) return next();
    const absPath = path.join(root, relative);
    if (opts.noIndex && relative === "/") return next();
    if (sendCached(res, absPath, cacheControl)) return;
    if (!opts.noIndex) {
      const indexPath = path.join(absPath, "index.html");
      if (sendCached(res, indexPath, cacheControl)) return;
    }
    next();
  };
}

const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too many requests, please try again later!" },
});

let location = "unknown";
let packageData = null;

try {
  packageData = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
} catch { }

const geoCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
const geoTimeout = geoCtrl ? setTimeout(() => geoCtrl.abort(), 5000) : null;
fetch("https://get.geojs.io/v1/ip/geo.json", geoCtrl ? { signal: geoCtrl.signal } : {})
  .then((res) => res.json())
  .then((data) => {
    if (data && data.country_code && data.region) {
      location = `${data.country_code}, ${data.region}`;
    }
  })
  .catch(() => { })
  .finally(() => { if (geoTimeout) clearTimeout(geoTimeout); });

const __dirname = process.cwd();
const srcPath = path.join(
  __dirname,
  NODE_ENV === "production" ? "dist" : "src",
);
const publicPath = path.join(__dirname, "public");
const buildFingerprint = (() => {
  const fallback = packageData?.version || "unknown";

  for (const dir of ["dist", "src"]) {
    try {
      const metaPath = path.join(__dirname, dir, "build-meta.json");
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
      if (typeof meta.build === "string" && meta.build.length > 0) {
        return meta.build;
      }
    } catch { }
  }

  try {
    const indexHtml = fs.readFileSync(path.join(__dirname, "src", "index.html"));
    return new Bun.CryptoHasher("sha1").update(indexHtml).digest("hex").slice(0, 8);
  } catch {
    return fallback;
  }
})();

const app = express();
app.set("trust proxy", 1);
const server = createServer(app);
const connections = new Set();
server.on("connection", (conn) => {
  connections.add(conn);
  conn.on("close", () => connections.delete(conn));
});

server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/w/")) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});
const pageCache = new LRUCache({ max: parseInt(process.env.PAGE_CACHE_MAX || "100", 10), ttl: 1000 * 60 * 5 });

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// Mochi proxy: always active (platforms without Caddy need this)
app.use((req, res, next) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return next();
  if (!req.url.startsWith("/!!/") && !req.url.startsWith("/!cover!/")) return next();

  const options = {
    hostname: "127.0.0.1",
    port: 4000,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = request(options, (proxyRes) => {
    proxyRes.on("error", () => res.destroy());
    res.on("error", () => proxyRes.destroy());
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    console.error(`mochi forwarding failed: ${e.message}`);
    if (!res.headersSent)
      res.status(502).json({ error: "make sure mochi is running!" });
    else res.destroy();
  });

  req.on("error", () => proxyReq.destroy());
  req.pipe(proxyReq);
});

// Dev-only proxy: nuru + cloudsync
app.use((req, res, next) => {
  if (NODE_ENV !== "development") return next();
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return next();

  let targetPort = 0;
  let label = "";

  if (req.url.startsWith("/w/")) {
    targetPort = 8080;
    label = "nuru";
  } else if (
    req.url.startsWith("/api/auth") ||
    req.url.startsWith("/api/sync")
  ) {
    targetPort = 5000;
    label = "cloudsync";
  }

  if (!targetPort) return next();

  const options = {
    hostname: "127.0.0.1",
    port: targetPort,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = request(options, (proxyRes) => {
    proxyRes.on("error", () => res.destroy());
    res.on("error", () => proxyRes.destroy());
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e) => {
    console.error(`${label} forwarding failed: ${e.message}`);
    if (!res.headersSent)
      res.status(502).json({ error: `make sure ${label} is running!` });
    else res.destroy();
  });

  req.on("error", () => proxyReq.destroy());
  req.pipe(proxyReq);
});

const bMap = {
  1: path.join(baremuxPath, "index.js"),
  2: path.join(publicPath, "b/s/jetty.all.js"),
  3: path.join(publicPath, "b/u/bunbun.js"),
  4: path.join(publicPath, "b/u/concon.js"),
};

const bCache = {};
for (const [id, filePath] of Object.entries(bMap)) {
  try {
    bCache[id] = fs.readFileSync(filePath);
  } catch { }
}

app.get("/b/all.js", (req, res) => {
  const fp = path.join(srcPath, "b", "all.js");
  if (sendCached(res, fp, "public, max-age=31536000, immutable")) return;

  const rawPieces = Object.values(bCache).filter(Boolean);
  if (rawPieces.length === 0) return res.status(404).send("bundle not found");
  const pieces = rawPieces.map((buf) => {
    let code = buf.toString("utf-8");
    code = code.replace(/\r\n/g, "\n");
    code = code.replace(/^\/\/# sourceMappingURL=.*$/gm, "").trim();
    return Buffer.from(code, "utf-8");
  });
  const sep = Buffer.from(";\n");
  const body = Buffer.concat(pieces.map((b, i) => i === 0 ? b : Buffer.concat([sep, b])));
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", CACHING_ENABLED
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate");
  res.send(body);
});

app.get("/b", (req, res) => {
  const buf = bCache[req.query.id];
  if (!buf) return res.status(404).send("file not found :(");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(buf);
});

let vite = null;
if (NODE_ENV === "development") {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom",
  });
  app.use(vite.middlewares);
}

if (NODE_ENV === "development") {
  app.use((req, res, next) => {
    let filePath = path.join(srcPath, req.path);
    if (req.path.endsWith('.js') && !fs.existsSync(filePath)) {
      const tsPath = filePath.slice(0, -3) + '.ts';
      if (!fs.existsSync(tsPath)) {
        const tsxPath = filePath.slice(0, -3) + '.tsx';
        if (fs.existsSync(tsxPath)) filePath = tsxPath;
      } else {
        filePath = tsPath;
      }
    }
    if ((filePath.endsWith('.ts') || filePath.endsWith('.tsx')) && fs.existsSync(filePath)) {
      try {
        const code = fs.readFileSync(filePath, 'utf-8');
        const result = new Bun.Transpiler({ loader: filePath.endsWith('.tsx') ? 'tsx' : 'ts' }).transformSync(code);
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.send(result);
      } catch (e) {
        console.error('TS transpile error:', e.message);
        if (!res.headersSent) res.status(500).send(`Error: ${e.message}`);
      }
    } else {
      next();
    }
  });
}

const IMMUTABLE_CC = "public, max-age=31536000, immutable";
const NO_CACHE_CC = "public, max-age=0, must-revalidate";

app.use(
  compression({
    filter: (req, res) => {
      if (req.path === "/api/live/stream" || req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
    level: 2,
    threshold: "2kb",
  }),
);

if (CACHING_ENABLED) {
  app.use("/bmux/", cachedStatic(baremuxPath, IMMUTABLE_CC));
  app.use("/epoxy/", cachedStatic(epoxyPath, IMMUTABLE_CC));
  app.use("/libcurl/", cachedStatic(libcurlPath, IMMUTABLE_CC));
  app.use("/s/", cachedStatic(path.join(__dirname, "scramjet"), IMMUTABLE_CC));
  app.use(
    "/assets/data",
    cachedStatic(path.join(publicPath, "assets", "data"), NO_CACHE_CC),
  );
  app.use(
    "/assets",
    cachedStatic(path.join(publicPath, "assets"), IMMUTABLE_CC),
  );
  app.use("/custom-sounds", express.static(path.join(publicPath, "custom-sounds"), { maxAge: 0 }));
  app.use("/b", cachedStatic(path.join(publicPath, "b"), IMMUTABLE_CC));
  app.use(cachedStatic(srcPath, IMMUTABLE_CC, { noIndex: true }));
} else {
  const staticOpts = { maxAge: 0, etag: true };
  app.use("/bmux/", express.static(baremuxPath, staticOpts));
  app.use("/epoxy/", express.static(epoxyPath, staticOpts));
  app.use("/libcurl/", express.static(libcurlPath, staticOpts));
  app.use("/s/", express.static(path.join(__dirname, "scramjet"), staticOpts));
  app.use(
    "/assets/data",
    express.static(path.join(publicPath, "assets", "data"), staticOpts),
  );
  app.use(
    "/assets",
    express.static(path.join(publicPath, "assets"), staticOpts),
  );
  app.use("/custom-sounds", express.static(path.join(publicPath, "custom-sounds"), { maxAge: 0 }));
  app.use("/b", express.static(path.join(publicPath, "b"), staticOpts));
  app.use(express.static(srcPath, { ...staticOpts, index: false }));
}
app.use("/api/", cookieParser());
app.use(
  helmet({
    contentSecurityPolicy: false,
    xPoweredBy: false,
    frameguard: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  }),
);

app.use("/api/", apiLimiter);
app.use("/api/", express.json({ limit: "30mb" }));

app.use((req, res, next) => {
  if (!CACHING_ENABLED || req.method !== "GET") return next();
  if (
    req.path === "/" ||
    req.path.endsWith(".html") ||
    req.path.startsWith("/api/") ||
    req.url.startsWith("/!!/") ||
    req.url.startsWith("/!cover!/") ||
    req.path.startsWith("/b") ||
    req.path.startsWith("/bmux/") ||
    req.path.startsWith("/epoxy/") ||
    req.path.startsWith("/libcurl/") ||
    req.path.startsWith("/s/") ||
    req.path.startsWith("/assets/")
  )
    return next();
  const key = req.originalUrl;
  const val = pageCache.get(key);
  if (val) {
    if (val.headers) {
      for (const [k, v] of Object.entries(val.headers)) {
        if (v) res.setHeader(k, v);
      }
    }
    res.setHeader("X-Cache", "HIT");
    return res.send(val.body);
  }
  const originalSend = res.send;
  res.send = (body) => {
    if (res.statusCode === 200) {
      pageCache.set(key, {
        body,
        headers: {
          "Content-Type": res.getHeader("Content-Type"),
          "Content-Encoding": res.getHeader("Content-Encoding"),
          "Cache-Control": res.getHeader("Cache-Control"),
          Vary: res.getHeader("Vary"),
        },
      });
      res.setHeader("X-Cache", "MISS");
    }
    originalSend.call(res, body);
  };
  next();
});

if (NODE_ENV === "production") {
  const COMPRESSIBLE = /\.(js|css|html|mjs|json|svg|xml)$/i;
  const ENCODING_MAP = [
    { ext: ".br", encoding: "br" },
    { ext: ".gz", encoding: "gzip" },
  ];

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!COMPRESSIBLE.test(req.path)) return next();
    if (
      req.path.startsWith("/api/") ||
      req.url.startsWith("/!!/") ||
      req.url.startsWith("/!cover!/")
    )
      return next();

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path).replace(/\\/g, "/");
    } catch {
      return next();
    }
    if (decodedPath.includes("..")) return next();

    const accept = req.headers["accept-encoding"] || "";
    for (const { ext, encoding } of ENCODING_MAP) {
      if (!accept.includes(encoding)) continue;

      const candidates = [
        path.join(srcPath, decodedPath + ext),
        path.join(publicPath, decodedPath + ext),
      ];

      for (const filePath of candidates) {
        const buf = cachedRead(filePath);
        if (buf) {
          const fileExt = path.extname(req.path).toLowerCase();
          res.setHeader("Content-Encoding", encoding);
          res.setHeader(
            "Content-Type",
            MIME_TYPES[fileExt] || "application/octet-stream",
          );
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.setHeader("Vary", "Accept-Encoding");
          res.setHeader("X-File-Cache", "HIT");
          return res.send(buf);
        }
      }
    }
    next();
  });
}

app.get("/api/stuff", (_req, res) => {
  if (!packageData) return res.status(500).json({ error: "stuff error" });
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({
    version: packageData.version,
    build: buildFingerprint,
    location,
  });
});

// --- Sunshine Live Client & Chaos Admin Engine ---
const ADMIN_SECRET = process.env.ADMIN_SECRET || "cookie_admin_chaos_master_key_99";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "bacon";

const liveClients = new Map();
const knownUsers = new Map(); // usernameLower -> { username, lastSeen, game, isPlayingGame, gameStartedAt }
const userProfiles = new Map(); // usernameLower -> { bio, statusText, updatedAt }

function isTemporaryGuestName(name) {
  if (!name) return true;
  const lower = String(name).trim().toLowerCase();
  if (!lower || lower === "guest") return true;
  return /^guest[-_][a-z0-9]+$/i.test(lower);
}

function getCloudSyncUsersMap() {
  const map = new Map();
  const candidates = [
    process.env.CLOUDSYNC_DB_PATH,
    path.join(__dirname, "cloudsync", ".db"),
    path.join(__dirname, ".db"),
  ].filter(Boolean);

  for (const dbFile of candidates) {
    try {
      if (!fs.existsSync(dbFile)) continue;
      const db = new Database(dbFile, { readonly: true });
      try {
        const rows = db
          .query("SELECT id, username, created_at FROM users ORDER BY id ASC")
          .all();
        for (const r of rows) {
          if (r && r.username) {
            const clean = String(r.username).trim();
            map.set(clean.toLowerCase(), {
              id: Number(r.id),
              username: clean,
              createdAt: r.created_at || null,
            });
          }
        }
      } finally {
        db.close();
      }
      if (map.size > 0) break;
    } catch {
      // ignore if DB not initialized yet
    }
  }
  return map;
}

function getCloudSyncUser(username) {
  if (!username) return null;
  const clean = String(username).trim().toLowerCase();
  if (!clean) return null;
  const csMap = getCloudSyncUsersMap();
  return csMap.get(clean) || null;
}

function touchKnownUser(username, extra = {}) {
  if (!username) return;
  const clean = String(username).trim();
  if (!clean) return;
  const key = clean.toLowerCase();
  const csMap = getCloudSyncUsersMap();
  if (isTemporaryGuestName(clean) && !csMap.has(key)) return;
  if (csMap.size > 0 && !csMap.has(key)) return;

  const csRecord = csMap.get(key);
  const canonicalName = csRecord ? csRecord.username : clean;
  const prev = knownUsers.get(key) || {
    username: canonicalName,
    lastSeen: Date.now(),
    game: "browsing",
    isPlayingGame: false,
    gameStartedAt: 0,
  };
  prev.username = canonicalName;
  prev.lastSeen = Date.now();
  if (typeof extra.game === "string") prev.game = extra.game;
  if (typeof extra.isPlayingGame === "boolean") prev.isPlayingGame = extra.isPlayingGame;
  if (typeof extra.gameStartedAt === "number") prev.gameStartedAt = extra.gameStartedAt;
  knownUsers.set(key, prev);
}

function getPresenceSnapshot() {
  const csMap = getCloudSyncUsersMap();
  const now = Date.now();

  // Remove any non-CloudSync or temporary guest entries from knownUsers
  for (const [k] of knownUsers.entries()) {
    if ((csMap.size > 0 && !csMap.has(k)) || (isTemporaryGuestName(k) && !csMap.has(k))) {
      knownUsers.delete(k);
    }
  }

  // Ensure every registered CloudSync user is in knownUsers
  for (const [k, csUser] of csMap.entries()) {
    if (!knownUsers.has(k)) {
      knownUsers.set(k, {
        username: csUser.username,
        lastSeen: 0,
        game: "browsing",
        isPlayingGame: false,
        gameStartedAt: 0,
      });
    } else {
      knownUsers.get(k).username = csUser.username;
    }
  }

  const onlineByUsername = new Map();
  for (const c of liveClients.values()) {
    if (now - (c.lastSeen || 0) > 25000) continue;
    const clean = String(c.username || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (isTemporaryGuestName(clean) && !csMap.has(key)) continue;
    if (csMap.size > 0 && !csMap.has(key)) continue;

    const csRecord = csMap.get(key);
    const canonicalName = csRecord ? csRecord.username : clean;
    const prof = userProfiles.get(key) || {};
    const existing = onlineByUsername.get(key);
    // Prefer the session that is actively playing a game or most recently seen
    if (!existing || (c.isPlayingGame && !existing.isPlayingGame) || c.lastSeen >= existing.lastSeen) {
      onlineByUsername.set(key, {
        id: c.id,
        username: canonicalName,
        online: true,
        page: c.page || "/",
        game: c.game || "browsing",
        isPlayingGame: Boolean(c.isPlayingGame),
        gameStartedAt: Number(c.gameStartedAt) || 0,
        lastSeen: c.lastSeen,
        bio: prof.bio || "",
        statusText: prof.statusText || "",
        createdAt: csRecord?.createdAt || null,
      });
    }
  }

  const onlineUsers = Array.from(onlineByUsername.values());
  const offlineUsers = [];
  for (const [key, u] of knownUsers.entries()) {
    if (!onlineByUsername.has(key)) {
      const csRecord = csMap.get(key);
      const prof = userProfiles.get(key) || {};
      offlineUsers.push({
        username: csRecord ? csRecord.username : u.username,
        online: false,
        game: "",
        isPlayingGame: false,
        gameStartedAt: 0,
        lastSeen: u.lastSeen || 0,
        bio: prof.bio || "",
        statusText: prof.statusText || "",
        createdAt: csRecord?.createdAt || null,
      });
    }
  }

  const registeredUsers = Array.from(csMap.values()).map((u) => u.username);
  return { onlineUsers, offlineUsers, registeredUsers };
}

function verifyAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearerKey = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const key = req.headers["x-admin-key"] || bearerKey || req.query.adminKey || (req.body && req.body.adminSecret);
  if (!key || key !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: "Unauthorized: Invalid Admin Secret" });
  }
  next();
}

function broadcastToClients(actionPayload, target = "all") {
  const payloadStr = `data: ${JSON.stringify(actionPayload)}\n\n`;
  let delivered = 0;
  for (const [id, client] of liveClients.entries()) {
    if (target === "all" || target === id || client.username === target) {
      try {
        client.res.write(payloadStr);
        delivered++;
      } catch {
        liveClients.delete(id);
      }
    }
  }
  return delivered;
}

// Keep-alive heartbeat comment every 15s
setInterval(() => {
  for (const [id, client] of liveClients.entries()) {
    try {
      client.res.write(": keepalive\n\n");
    } catch {
      liveClients.delete(id);
    }
  }
}, 15000);

app.post("/api/admin/verify", (req, res) => {
  const authHeader = req.headers.authorization;
  const bearerKey = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const key = req.headers["x-admin-key"] || bearerKey || (req.body && req.body.adminSecret);
  if (!key || key !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: "Invalid Admin Secret" });
  }
  res.json({ success: true, username: ADMIN_USERNAME });
});

app.get("/api/live/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const clientId = (req.query.id || Math.random().toString(36).substring(2, 10)).toString();
  const username = (req.query.user || "Guest-" + clientId.substring(0, 4)).toString();
  const page = (req.query.page || "/").toString();
  const game = (req.query.game || "Browsing").toString();
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1")
    .toString()
    .replace(/^::ffff:/, "");

  const clientRecord = {
    res,
    id: clientId,
    username,
    ip,
    page,
    game,
    isPlayingGame: false,
    gameStartedAt: 0,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
  };

  liveClients.set(clientId, clientRecord);
  touchKnownUser(username, { game, isPlayingGame: false, gameStartedAt: 0 });

  // Initial handshake
  res.write(`data: ${JSON.stringify({ type: "connected", clientId, username })}\n\n`);
  broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");

  req.on("close", () => {
    const rec = liveClients.get(clientId);
    if (rec?.username) {
      touchKnownUser(rec.username, { isPlayingGame: false, gameStartedAt: 0 });
    }
    liveClients.delete(clientId);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
  });
});

app.post("/api/live/heartbeat", (req, res) => {
  const { clientId, username, page, game, isPlayingGame, gameStartedAt } = req.body || {};
  let changed = false;
  if (clientId && liveClients.has(clientId)) {
    const client = liveClients.get(clientId);
    if (username && client.username !== username) {
      client.username = username;
      changed = true;
    }
    if (page) client.page = page;
    if (typeof game === "string" && client.game !== game) {
      client.game = game;
      changed = true;
    }
    if (typeof isPlayingGame === "boolean") {
      client.isPlayingGame = isPlayingGame;
    }
    if (typeof gameStartedAt === "number") {
      client.gameStartedAt = gameStartedAt;
    }
    client.lastSeen = Date.now();
    touchKnownUser(client.username, {
      game: client.game,
      isPlayingGame: client.isPlayingGame,
      gameStartedAt: client.gameStartedAt,
    });
  } else if (username) {
    touchKnownUser(username, {
      game: game || "browsing",
      isPlayingGame: Boolean(isPlayingGame),
      gameStartedAt: Number(gameStartedAt) || 0,
    });
    changed = true;
  }
  if (changed) {
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
  }
  res.json({ success: true });
});

app.get("/api/admin/clients", verifyAdmin, (_req, res) => {
  const clients = Array.from(liveClients.values()).map((c) => ({
    id: c.id,
    username: c.username,
    ip: c.ip,
    page: c.page,
    game: c.game,
    connectedAt: c.connectedAt,
    lastSeen: c.lastSeen,
  }));
  res.json({ success: true, count: clients.length, clients });
});

app.post("/api/admin/trigger", verifyAdmin, (req, res) => {
  const { target = "all", action, data } = req.body || {};
  if (!action) {
    return res.status(400).json({ success: false, error: "Action is required" });
  }

  const payload = {
    type: "admin-chaos",
    action,
    data: data || {},
    from: ADMIN_USERNAME,
    timestamp: Date.now(),
  };

  const count = broadcastToClients(payload, target);
  res.json({ success: true, count, target, action });
});

app.get("/api/live/audio-proxy", async (req, res) => {
  try {
    const rawUrl = (req.query.url || "").toString().trim();
    if (!rawUrl || (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://"))) {
      return res.status(400).send("Invalid audio url");
    }
    const upstream = await fetch(rawUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "audio/*,*/*;q=0.9",
      },
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send("Upstream audio failed");
    }
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (err) {
    res.status(500).send("Audio proxy error");
  }
});

app.post("/api/admin/upload-sound", verifyAdmin, (req, res) => {
  try {
    const { name, filename, data } = req.body || {};
    if (!data || !filename) {
      return res.status(400).json({ success: false, error: "Missing sound file data" });
    }

    const soundDir = path.join(publicPath, "assets", "sounds");
    if (!fs.existsSync(soundDir)) {
      fs.mkdirSync(soundDir, { recursive: true });
    }

    const ext = path.extname(filename).toLowerCase() || ".mp3";
    const baseClean = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 32);
    const safeFilename = `upload_${Date.now()}_${baseClean}${ext}`;
    const targetPath = path.join(soundDir, safeFilename);

    const cleanBase64 = data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    fs.writeFileSync(targetPath, buffer);

    const soundUrl = `/assets/sounds/${safeFilename}`;
    res.json({
      success: true,
      url: soundUrl,
      name: name || baseClean.replace(/_/g, " "),
      filename: safeFilename,
    });
  } catch (err) {
    console.error("Upload sound error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/admin/myinstants-search", verifyAdmin, async (req, res) => {
  try {
    const query = (req.query.query || "").toString().trim();
    if (!query) {
      return res.json({ success: true, results: [] });
    }

    const searchUrl = `https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: "MyInstants returned " + response.status });
    }

    const html = await response.text();
    const regex = /<button class="small-button" onclick="play\('([^']+)'[^>]*title="Play ([^"]+) sound"/g;
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 30) {
      const soundPath = match[1];
      const soundName = match[2].trim();
      const fullUrl = soundPath.startsWith("http") ? soundPath : `https://www.myinstants.com${soundPath}`;
      results.push({
        name: soundName,
        url: `/api/live/audio-proxy?url=${encodeURIComponent(fullUrl)}`,
        rawUrl: fullUrl,
        source: "myinstants",
      });
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("MyInstants search error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/admin/resolve-sound", verifyAdmin, async (req, res) => {
  try {
    const rawUrl = (req.body?.url || "").toString().trim();
    if (!rawUrl) {
      return res.status(400).json({ success: false, error: "Missing url" });
    }

    let resolvedMp3 = rawUrl;

    if (rawUrl.includes("myinstants.com/") && !rawUrl.endsWith(".mp3")) {
      const pageRes = await fetch(rawUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const html = await pageRes.text();
      const match = html.match(/onclick="play\('(\/media\/sounds\/[^']+)'/);
      if (match) {
        resolvedMp3 = `https://www.myinstants.com${match[1]}`;
      }
    }

    // Download and cache into /assets/sounds/ so it works 100% same-origin
    try {
      const soundDir = path.join(publicPath, "assets", "sounds");
      if (!fs.existsSync(soundDir)) fs.mkdirSync(soundDir, { recursive: true });
      const audioRes = await fetch(resolvedMp3, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (audioRes.ok) {
        const buf = Buffer.from(await audioRes.arrayBuffer());
        const safeFilename = `cached_${Date.now()}.mp3`;
        fs.writeFileSync(path.join(soundDir, safeFilename), buf);
        return res.json({ success: true, url: `/assets/sounds/${safeFilename}` });
      }
    } catch {}

    const proxied = resolvedMp3.startsWith("http")
      ? `/api/live/audio-proxy?url=${encodeURIComponent(resolvedMp3)}`
      : resolvedMp3;
    res.json({ success: true, url: proxied });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Chat, Direct Messaging, OpenAI Moderation (Excluding Swears), & Voice Signaling ---
// Supply your OpenAI API key here in the code (or via OPENAI_API_KEY in .env):
const OPENAI_MODERATION_API_KEY = process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY_HERE";

const chatHistory = [];
const voiceRooms = new Map(); // roomId -> Map<peerId, { peerId, username, muted, deafened }>

// Severe harm patterns (hate slurs, self-harm, sexual minors, severe threats) — normal swear words are explicitly allowed
const SEVERE_MODERATION_RULES = [
  {
    category: "self-harm",
    regex: /\b(kys|kill\s+your\s*self|commit\s+suicide|slit\s+your\s+wrists|go\s+hang\s+yourself)\b/i,
    reason: "flagged by moderation: self-harm encouragement is not allowed.",
  },
  {
    category: "hate",
    regex: /\b(n[i1!]gg[ae3]r|f[a@]gg[o0]t|k[i1!]ke|ch[i1!]nk|tr[a@]nn(y|ie)|ret[a@]rd)\b/i,
    reason: "flagged by moderation: hate speech and slurs are not allowed.",
  },
  {
    category: "violence/threatening",
    regex: /\b(i\s+will\s+(kill|murder|shoot|stab|swat|doxx?)\s+you|school\s+shoot(er|ing)|bomb\s+threat)\b/i,
    reason: "flagged by moderation: violent threats and doxxing are not allowed.",
  },
  {
    category: "sexual/minors",
    regex: /\b(child\s+p[o0]rn|cp\s+link|loli\s+hentai|underage\s+nsfw|pedo(phile)?)\b/i,
    reason: "flagged by moderation: severe sexual content violation.",
  },
];

async function moderateTextWithOpenAI(text) {
  const clean = (text || "").trim();
  if (!clean) return { blocked: false, flagged: false };

  // 1. Check local severe moderation rules first (never blocks normal swear words)
  for (const rule of SEVERE_MODERATION_RULES) {
    if (rule.regex.test(clean)) {
      return {
        blocked: true,
        flagged: true,
        category: rule.category,
        reason: rule.reason,
        provider: "local-moderation",
      };
    }
  }

  // 2. Call OpenAI omni-moderation-latest using the key configured in code
  const apiKey = OPENAI_MODERATION_API_KEY;
  if (apiKey && apiKey.startsWith("sk-")) {
    try {
      const response = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: clean,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const result = data?.results?.[0];
        if (result && result.categories) {
          // Check strict harm categories while excluding casual profanity/swearing
          const strictCategories = [
            "sexual",
            "sexual/minors",
            "hate",
            "hate/threatening",
            "harassment/threatening",
            "self-harm",
            "self-harm/intent",
            "self-harm/instructions",
            "violence",
            "violence/graphic",
            "illicit/violent",
          ];
          const triggered = strictCategories.filter((cat) => result.categories[cat] === true);
          if (triggered.length > 0) {
            return {
              blocked: true,
              flagged: true,
              category: triggered[0],
              reason: `flagged by openai moderation (${triggered.join(", ")}).`,
              provider: "openai",
            };
          }
        }
      }
    } catch (err) {
      console.warn("OpenAI moderation request failed, using local rules:", err.message);
    }
  }

  return { blocked: false, flagged: false, provider: apiKey.startsWith("sk-") ? "openai" : "local-moderation" };
}

app.post("/api/chat/moderate", async (req, res) => {
  try {
    const { text } = req.body || {};
    const result = await moderateTextWithOpenAI(text);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, blocked: false, flagged: false, error: err.message });
  }
});

app.get("/api/chat/state", (req, res) => {
  const rawUser = (req.query.user || req.query.username || "").toString();
  const user = rawUser.toLowerCase();
  if (rawUser) touchKnownUser(rawUser);

  const visibleMessages = chatHistory.filter((m) => {
    if (!m.channel.startsWith("dm:")) return true;
    if (!user) return false;
    const parts = m.channel.split(":");
    return parts.includes(user);
  });

  const activeVoice = {};
  for (const [roomId, peers] of voiceRooms.entries()) {
    activeVoice[roomId] = Array.from(peers.values());
  }

  const presence = getPresenceSnapshot();

  res.json({
    success: true,
    messages: visibleMessages.slice(-200),
    voiceRooms: activeVoice,
    onlineUsers: presence.onlineUsers,
    offlineUsers: presence.offlineUsers,
    registeredUsers: presence.registeredUsers,
  });
});

app.get("/api/chat/user-profile", (req, res) => {
  const rawTarget = (req.query.username || req.query.user || "").toString().trim();
  if (!rawTarget) {
    return res.status(400).json({ success: false, exists: false, error: "username is required" });
  }

  const csMap = getCloudSyncUsersMap();
  const key = rawTarget.toLowerCase();
  const csUser = csMap.get(key) || null;

  // Cross-check against CloudSync database
  if (csMap.size > 0 && !csUser) {
    return res.json({
      success: true,
      exists: false,
      error: `user "@${rawTarget}" does not exist in cloudsync`,
    });
  }
  if (!csUser && isTemporaryGuestName(rawTarget)) {
    return res.json({
      success: true,
      exists: false,
      error: `user "@${rawTarget}" is not a registered cloudsync user`,
    });
  }

  const canonicalName = csUser ? csUser.username : rawTarget;
  const presence = getPresenceSnapshot();
  const onlineEntry = presence.onlineUsers.find((u) => u.username.toLowerCase() === key);
  const offlineEntry = presence.offlineUsers.find((u) => u.username.toLowerCase() === key);
  const prof = userProfiles.get(key) || {};

  // Gather per-game leaderboard stats for this user
  let totalSeconds = 0;
  let totalPlays = 0;
  const topGames = [];
  for (const [gameKey, board] of gameLeaderboards.entries()) {
    const entry = board.get(key);
    if (entry && (entry.seconds > 0 || entry.plays > 0)) {
      totalSeconds += Number(entry.seconds) || 0;
      totalPlays += Number(entry.plays) || 0;
      topGames.push({
        game: gameKey,
        seconds: Number(entry.seconds) || 0,
        plays: Number(entry.plays) || 0,
        highScore: Number(entry.highScore) || 0,
        lastPlayed: entry.lastPlayed,
      });
    }
  }
  topGames.sort((a, b) => b.seconds - a.seconds || b.plays - a.plays);

  const userStudio =
    customStudios.find((s) => (s.owner || "").toLowerCase() === key) || null;
  const userPublishedGames = publishedStudioGames.filter(
    (g) => (g.author || "").toLowerCase() === key
  );

  res.json({
    success: true,
    exists: true,
    profile: {
      id: csUser ? csUser.id : null,
      username: canonicalName,
      createdAt: csUser ? csUser.createdAt : null,
      cloudSyncVerified: Boolean(csUser),
      bio: prof.bio || "",
      statusText: prof.statusText || "",
      online: Boolean(onlineEntry),
      game: onlineEntry ? onlineEntry.game || "browsing" : "",
      isPlayingGame: Boolean(onlineEntry?.isPlayingGame),
      gameStartedAt: Number(onlineEntry?.gameStartedAt) || 0,
      lastSeen: onlineEntry?.lastSeen || offlineEntry?.lastSeen || 0,
      stats: {
        totalSeconds,
        totalPlays,
        gamesPlayedCount: topGames.length,
        topGames: topGames.slice(0, 6),
      },
      studio: userStudio
        ? {
            name: userStudio.name,
            tagline: userStudio.tagline,
            color: userStudio.color,
            icon: userStudio.icon,
          }
        : null,
      publishedGamesCount: userPublishedGames.length,
    },
  });
});

app.post("/api/chat/user-profile", async (req, res) => {
  try {
    const { username, bio, statusText } = req.body || {};
    const cleanUser = (username || "").toString().trim();
    if (!cleanUser) {
      return res.status(400).json({ success: false, error: "Missing username" });
    }
    const csMap = getCloudSyncUsersMap();
    const key = cleanUser.toLowerCase();
    if (csMap.size > 0 && !csMap.has(key)) {
      return res.status(404).json({ success: false, error: "User not found in CloudSync" });
    }

    const cleanBio = (bio || "").toString().trim().slice(0, 220);
    const cleanStatus = (statusText || "").toString().trim().slice(0, 60);

    const modCheck = await moderateTextWithOpenAI(`${cleanStatus} ${cleanBio}`);
    if (modCheck.blocked || modCheck.flagged) {
      return res.status(400).json({
        success: false,
        error: modCheck.reason || "Profile bio/status blocked by moderation",
      });
    }

    const updated = {
      bio: cleanBio,
      statusText: cleanStatus,
      updatedAt: new Date().toISOString(),
    };
    userProfiles.set(key, updated);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    res.json({ success: true, profile: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/send", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || !message.text || !message.author || !message.channel) {
      return res.status(400).json({ success: false, error: "Invalid message" });
    }

    // Validate DM recipients against the CloudSync database
    if (message.channel.startsWith("dm:")) {
      const csMap = getCloudSyncUsersMap();
      if (csMap.size > 0) {
        const parts = message.channel.slice(3).split(":");
        for (const p of parts) {
          const cleanPart = (p || "").trim().toLowerCase();
          if (!cleanPart || !csMap.has(cleanPart)) {
            return res.status(404).json({
              success: false,
              error: `user "@${p}" does not exist in cloudsync`,
            });
          }
        }
      }
    }

    touchKnownUser(message.author);

    const mod = await moderateTextWithOpenAI(message.text);
    if (mod.flagged) {
      return res.status(400).json({
        success: false,
        flagged: true,
        category: mod.category,
        error: mod.reason || "Message blocked by moderation",
      });
    }

    chatHistory.push(message);
    if (chatHistory.length > 500) chatHistory.shift();

    // Broadcast via SSE to connected clients
    const eventPayload = {
      type: "chat-event",
      event: "NEW_MESSAGE",
      message,
    };

    if (message.channel.startsWith("dm:")) {
      const parts = message.channel.split(":");
      for (const [, client] of liveClients.entries()) {
        const u = (client.username || "").toLowerCase();
        if (parts.includes(u)) {
          try {
            client.res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
          } catch {}
        }
      }
    } else {
      broadcastToClients(eventPayload, "all");
    }

    res.json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/voice/signal", (req, res) => {
  try {
    const body = req.body || {};
    const sigType = body.signalType || body.type;
    const clientId = body.fromClientId || body.peerId || body.clientId;
    const targetClientId = body.targetClientId || body.targetPeerId || null;
    const sdpOrCandidate = body.sdpOrCandidate || body.payload || null;
    const { roomId, username, avatarColor, muted, deafened, speaking } = body;

    if (!sigType || !clientId) {
      return res.status(400).json({ success: false, error: "Missing voice signal params" });
    }

    if (sigType === "VOICE_JOIN" && roomId) {
      for (const [, peers] of voiceRooms.entries()) {
        peers.delete(clientId);
      }
      if (!voiceRooms.has(roomId)) {
        voiceRooms.set(roomId, new Map());
      }
      voiceRooms.get(roomId).set(clientId, {
        clientId,
        peerId: clientId,
        username: username || "User",
        avatarColor: avatarColor || "#3b82f6",
        muted: !!muted,
        deafened: !!deafened,
      });
    } else if (sigType === "VOICE_LEAVE") {
      for (const [rId, peers] of voiceRooms.entries()) {
        peers.delete(clientId);
        if (peers.size === 0) voiceRooms.delete(rId);
      }
    } else if (sigType === "VOICE_STATE" && roomId && voiceRooms.has(roomId)) {
      const peer = voiceRooms.get(roomId).get(clientId);
      if (peer) {
        if (typeof muted === "boolean") peer.muted = muted;
        if (typeof deafened === "boolean") peer.deafened = deafened;
      }
    }

    const activeVoice = {};
    for (const [rId, peers] of voiceRooms.entries()) {
      activeVoice[rId] = Array.from(peers.values());
    }

    const signalEvent = {
      type: "voice-event",
      signalType: sigType,
      roomId,
      fromClientId: clientId,
      peerId: clientId,
      username,
      avatarColor,
      targetClientId,
      targetPeerId: targetClientId,
      sdpOrCandidate,
      payload: sdpOrCandidate,
      muted: typeof muted === "boolean" ? muted : undefined,
      deafened: typeof deafened === "boolean" ? deafened : undefined,
      speaking: typeof speaking === "boolean" ? speaking : undefined,
      participants: roomId ? activeVoice[roomId] || [] : [],
      voiceRooms: activeVoice,
    };

    if (targetClientId) {
      broadcastToClients(signalEvent, targetClientId);
    } else {
      broadcastToClients(signalEvent, "all");
    }

    res.json({ success: true, voiceRooms: activeVoice });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Game Studio Published Games API ---
const publishedStudioGames = [];

app.get("/api/studio/games", (_req, res) => {
  res.json({ success: true, games: publishedStudioGames });
});

app.post("/api/studio/games", async (req, res) => {
  try {
    const { game } = req.body || {};
    if (!game || !game.title || !game.author) {
      return res.status(400).json({ success: false, error: "Missing game title or author" });
    }
    const modCheck = await moderateTextWithOpenAI(`${game.title} ${game.description || ""}`);
    if (modCheck.blocked) {
      return res.status(400).json({
        success: false,
        error: modCheck.reason || "Game title or description blocked by moderation",
      });
    }
    const entry = {
      ...game,
      id: game.id || `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: game.createdAt || new Date().toISOString(),
      plays: Number(game.plays) || 0,
      likes: Number(game.likes) || 0,
    };
    const existingIdx = publishedStudioGames.findIndex((g) => g.id === entry.id);
    if (existingIdx >= 0) {
      publishedStudioGames[existingIdx] = entry;
    } else {
      publishedStudioGames.unshift(entry);
    }
    broadcastToClients({ type: "studio-event", event: "GAME_PUBLISHED", game: entry }, "all");
    res.json({ success: true, game: entry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/studio/games/:id/stat", (req, res) => {
  const { id } = req.params;
  const { field } = req.body || {};
  const found = publishedStudioGames.find((g) => g.id === id);
  if (found) {
    if (field === "likes") found.likes = (found.likes || 0) + 1;
    if (field === "plays") found.plays = (found.plays || 0) + 1;
  }
  res.json({ success: true, game: found || null });
});

// Serve custom uploaded index.html studio game with CloudSync Player Tracking SDK bridge
app.get("/api/studio/games/:id/play.html", (req, res) => {
  const { id } = req.params;
  const found = publishedStudioGames.find((g) => g.id === id);
  if (!found || !found.customHtmlContent) {
    return res.status(404).send("Custom HTML game not found");
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(found.customHtmlContent);
});

// --- CloudSync Player Progress & Telemetry Tracking per Studio Game ---
const studioCloudProgress = new Map(); // gameId -> Map<usernameLower, ProgressRecord>

app.get("/api/studio/progress", (req, res) => {
  const gameId = ((req.query.gameId || "") + "").trim();
  const username = ((req.query.user || "") + "").trim().toLowerCase();
  if (!gameId) {
    return res.json({ success: true, players: [], myProgress: null });
  }
  const gameMap = studioCloudProgress.get(gameId);
  const players = gameMap
    ? Array.from(gameMap.values()).sort(
        (a, b) =>
          b.highestLevel - a.highestLevel ||
          b.bestScore - a.bestScore ||
          b.completions - a.completions
      )
    : [];
  const myProgress = username && gameMap ? gameMap.get(username) || null : null;
  res.json({ success: true, gameId, players: players.slice(0, 100), myProgress });
});

app.post("/api/studio/progress", (req, res) => {
  try {
    const {
      gameId,
      gameTitle,
      username,
      cloudSynced,
      levelReached,
      score,
      coinsAdded,
      deathsAdded,
      completedGame,
      customData,
    } = req.body || {};
    if (!gameId || !username) {
      return res.status(400).json({ success: false, error: "Missing gameId or username" });
    }
    const cleanUser = String(username).trim();
    const userKey = cleanUser.toLowerCase();

    if (!studioCloudProgress.has(gameId)) {
      studioCloudProgress.set(gameId, new Map());
    }
    const gameMap = studioCloudProgress.get(gameId);
    const prev = gameMap.get(userKey) || {
      username: cleanUser,
      cloudSynced: Boolean(cloudSynced),
      currentLevel: 1,
      highestLevel: 1,
      bestScore: 0,
      totalCoinsCollected: 0,
      deaths: 0,
      completions: 0,
      customData: {},
      lastUpdated: new Date().toISOString(),
    };

    prev.username = cleanUser;
    prev.cloudSynced = Boolean(cloudSynced) || prev.cloudSynced;
    if (typeof levelReached === "number" && levelReached >= 1) {
      prev.currentLevel = levelReached;
      if (levelReached > prev.highestLevel) prev.highestLevel = levelReached;
    }
    if (typeof score === "number" && score > prev.bestScore) {
      prev.bestScore = score;
    }
    if (typeof coinsAdded === "number" && coinsAdded > 0) {
      prev.totalCoinsCollected += coinsAdded;
    }
    if (typeof deathsAdded === "number" && deathsAdded > 0) {
      prev.deaths += deathsAdded;
    }
    if (completedGame) {
      prev.completions += 1;
    }
    if (customData && typeof customData === "object") {
      prev.customData = { ...prev.customData, ...customData };
    }
    prev.lastUpdated = new Date().toISOString();
    gameMap.set(userKey, prev);

    // Also update the game's leaderboard score if provided
    if (gameTitle && typeof score === "number") {
      const gKey = String(gameTitle).trim().toLowerCase();
      if (!gameLeaderboards.has(gKey)) gameLeaderboards.set(gKey, new Map());
      const lb = gameLeaderboards.get(gKey);
      const lbEntry = lb.get(userKey) || {
        username: cleanUser,
        seconds: 1,
        plays: 1,
        highScore: 0,
        lastPlayed: new Date().toISOString(),
      };
      if (score > lbEntry.highScore) lbEntry.highScore = score;
      lbEntry.lastPlayed = new Date().toISOString();
      lb.set(userKey, lbEntry);
    }

    const players = Array.from(gameMap.values()).sort(
      (a, b) =>
        b.highestLevel - a.highestLevel ||
        b.bestScore - a.bestScore ||
        b.completions - a.completions
    );

    res.json({ success: true, myProgress: prev, players: players.slice(0, 100) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Custom User Game Studios API ---
const customStudios = [];

app.get("/api/studio/studios", (_req, res) => {
  res.json({ success: true, studios: customStudios });
});

app.post("/api/studio/studios", async (req, res) => {
  try {
    const { studio } = req.body || {};
    if (!studio || !studio.name || !studio.owner) {
      return res.status(400).json({ success: false, error: "Missing studio name or owner" });
    }
    const modCheck = await moderateTextWithOpenAI(`${studio.name} ${studio.tagline || ""}`);
    if (modCheck.blocked) {
      return res.status(400).json({
        success: false,
        error: modCheck.reason || "Studio name blocked by moderation",
      });
    }
    const idx = customStudios.findIndex(
      (s) => s.id === studio.id || s.owner.toLowerCase() === studio.owner.toLowerCase()
    );
    if (idx >= 0) {
      customStudios[idx] = { ...customStudios[idx], ...studio };
      return res.json({ success: true, studio: customStudios[idx] });
    }
    customStudios.unshift(studio);
    res.json({ success: true, studio });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Per-Game Playtime & Score Leaderboards API ---
const gameLeaderboards = new Map(); // gameKey -> Map<usernameLower, { username, seconds, plays, highScore, lastPlayed }>

app.get("/api/games/leaderboard", (req, res) => {
  const gameKey = ((req.query.game || "global") + "").trim().toLowerCase();
  const board = gameLeaderboards.get(gameKey);
  const entries = board
    ? Array.from(board.values()).sort((a, b) => b.seconds - a.seconds || b.plays - a.plays)
    : [];
  const activePlayers = Array.from(liveClients.values())
    .filter((c) => (c.game || "").toLowerCase() === gameKey)
    .map((c) => c.username);
  res.json({ success: true, game: gameKey, entries: entries.slice(0, 50), activePlayers });
});

app.post("/api/games/leaderboard", (req, res) => {
  try {
    const { game, username, addSeconds, addPlay, score } = req.body || {};
    const gameKey = ((game || "global") + "").trim().toLowerCase();
    const cleanUser = ((username || "guest") + "").trim();
    const userKey = cleanUser.toLowerCase();

    if (!gameLeaderboards.has(gameKey)) {
      gameLeaderboards.set(gameKey, new Map());
    }
    const board = gameLeaderboards.get(gameKey);
    const current = board.get(userKey) || {
      username: cleanUser,
      seconds: 0,
      plays: 0,
      highScore: 0,
      lastPlayed: new Date().toISOString(),
    };
    current.username = cleanUser;
    current.seconds += Math.max(0, Number(addSeconds) || 0);
    current.plays += Math.max(0, Number(addPlay) || 0);
    if (typeof score === "number" && score > current.highScore) {
      current.highScore = score;
    }
    current.lastPlayed = new Date().toISOString();
    board.set(userKey, current);

    const entries = Array.from(board.values()).sort(
      (a, b) => b.seconds - a.seconds || b.plays - a.plays
    );
    res.json({ success: true, entries: entries.slice(0, 50) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Cookie Coins Shop: One-Time Targeted User Troll API ---
app.post("/api/shop/troll", async (req, res) => {
  try {
    const { trollEventId, targetClientId, targetUsername, action, data, sender } = req.body || {};
    if (!action || (!targetClientId && !targetUsername)) {
      return res.status(400).json({ success: false, error: "Missing target user or troll action" });
    }
    if (action === "tts" && data?.text) {
      const mod = await moderateTextWithOpenAI(data.text);
      if (mod.blocked) {
        return res.status(400).json({
          success: false,
          error: mod.reason || "TTS message blocked by moderation",
        });
      }
    }

    const payload = {
      type: "admin-chaos",
      trollEventId,
      action,
      data: { ...(data || {}), trollEventId, fromShopUser: sender || "Someone" },
      timestamp: Date.now(),
    };

    const normTarget = (targetUsername || "").trim().toLowerCase().replace(/[-_]/g, "");
    const cloudUser = targetUsername ? getCloudSyncUser(targetUsername) : null;
    let delivered = 0;
    for (const [id, client] of liveClients.entries()) {
      const matchId = targetClientId && id === targetClientId;
      const clientNorm = (client.username || "").trim().toLowerCase().replace(/[-_]/g, "");
      const matchUser = normTarget && clientNorm === normTarget;
      if (matchId || matchUser) {
        try {
          client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
          delivered++;
        } catch {}
      }
    }

    res.json({
      success: true,
      delivered,
      userExists: Boolean(cloudUser) || delivered > 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function getBuiltModuleEntryPath() {
  if (NODE_ENV !== "production") return null;
  try {
    const html = fs.readFileSync(path.join(srcPath, "index.html"), "utf-8");
    const m = html.match(
      /<script\s+[^>]*type=["']module["'][^>]*\ssrc=["']([^"']+)["'][^>]*>/i,
    );
    return m?.[1] || null;
  } catch {
    return null;
  }
}

const builtModuleEntryPath = getBuiltModuleEntryPath();
const EARLY_HINTS_LINKS = [
  "</assets/fonts/Lexend-Regular.woff2>; rel=preload; as=font; crossorigin",
  ...(NODE_ENV === "development"
    ? ["</assets/scripts/entry.jsx>; rel=modulepreload"]
    : builtModuleEntryPath
      ? [`<${builtModuleEntryPath}>; rel=modulepreload`]
      : []),
  "</b/all.js>; rel=preload; as=script",
  "<https://fonts.googleapis.com>; rel=preconnect",
  "<https://fonts.gstatic.com>; rel=preconnect; crossorigin",
];
const LINK_HEADER = EARLY_HINTS_LINKS.join(", ");

app.get("/", async (req, res) => {
  const fp = path.join(srcPath, "index.html");
  if (typeof res.writeEarlyHints === "function") {
    res.writeEarlyHints({ link: EARLY_HINTS_LINKS });
  }
  res.setHeader("Link", LINK_HEADER);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (vite) {
    try {
      let html = fs.readFileSync(fp, "utf-8");
      html = await vite.transformIndexHtml(req.originalUrl || "/", html);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).end(html);
    } catch (err) {
      console.error("vite transform error:", err.message);
      return res.sendFile(fp);
    }
  }
  if (CACHING_ENABLED) {
    const buf = cachedRead(fp);
    if (buf) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-File-Cache", "HIT");
      return res.send(buf);
    }
  }
  res.sendFile(fp);
});

app.use((_req, res) => {
  const fp = path.join(srcPath, "404.html");
  if (CACHING_ENABLED) {
    const buf = cachedRead(fp);
    if (buf) {
      res.status(404);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-File-Cache", "HIT");
      return res.send(buf);
    }
  }
  res.status(404).sendFile(fp);
});


server.keepAliveTimeout = 60000;
server.headersTimeout = 61000;

const DEV_SERVICES = [
  {
    name: "nuru",
    dir: "nuru",
    port: 8080,
    args: ["--", "config.toml", "--format", "toml"],
  },
  { name: "mochi", dir: "mochi", port: 4000 },
  { name: "cloudsync", dir: "cloudsync", port: 5000 },
];

const serviceStatus = {};
const serviceProcs = [];
let statusLineCount = 0;

function colorize(status) {
  if (status === "good") return "\x1b[32mgood\x1b[0m";
  if (status === "starting...") return "\x1b[33mstarting...\x1b[0m";
  if (status === "compiling...") return "\x1b[33mcompiling...\x1b[0m";
  return `\x1b[31m${status}\x1b[0m`;
}

function printStatus() {
  if (statusLineCount > 0) {
    process.stdout.write(`\x1b[${statusLineCount}A\x1b[0J`);
  }
  const lines = [];
  lines.push("");
  lines.push("services:");
  for (const svc of DEV_SERVICES) {
    lines.push(
      ` ${svc.name.padEnd(9)} ~ ${colorize(serviceStatus[svc.name])}`,
    );
  }
  lines.push("");
  process.stdout.write(lines.join("\n"));
  statusLineCount = lines.length - 1;
}

async function checkPort(port) {
  try {
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(sock) { sock.end(); },
      },
      timeout: 400,
    });
    return true;
  } catch {
    return false;
  }
}

async function pollService(svc) {
  while (
    serviceStatus[svc.name] === "starting..." ||
    serviceStatus[svc.name] === "compiling..."
  ) {
    const up = await checkPort(svc.port);
    if (up) {
      serviceStatus[svc.name] = "good";
      printStatus();
      return;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
}

function spawnServices() {
  for (const svc of DEV_SERVICES) {
    serviceStatus[svc.name] = "starting...";
  }
  printStatus();

  for (const svc of DEV_SERVICES) {
    let child;
    try {
      const cargoArgs = ["run", ...(svc.args || [])];
      const isWin = process.platform === "win32";
      const cmd = isWin ? ["cmd.exe", "/c", "cargo", ...cargoArgs] : ["cargo", ...cargoArgs];
      child = Bun.spawn(cmd, {
        cwd: path.join(__dirname, svc.dir),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      serviceStatus[svc.name] = `error: ${err.message}`;
      printStatus();
      continue;
    }

    serviceProcs.push(child);

    (async () => {
      try {
        const decoder = new TextDecoder();
        for await (const chunk of child.stdout) {
          const text = decoder.decode(chunk, { stream: true });
          if (
            serviceStatus[svc.name] !== "good" &&
            (text.toLowerCase().includes("listening") ||
              text.toLowerCase().includes("started"))
          ) {
            serviceStatus[svc.name] = "good";
            printStatus();
          }
        }
      } catch { }
    })();

    (async () => {
      try {
        const decoder = new TextDecoder();
        for await (const chunk of child.stderr) {
          const text = decoder.decode(chunk, { stream: true });
          const lower = text.toLowerCase();
          if (
            serviceStatus[svc.name] !== "good" &&
            (lower.includes("listening") ||
              lower.includes("started") ||
              lower.includes("running") ||
              lower.includes("ready"))
          ) {
            serviceStatus[svc.name] = "good";
            printStatus();
          } else if (
            serviceStatus[svc.name] === "starting..." &&
            lower.includes("compiling")
          ) {
            serviceStatus[svc.name] = "compiling...";
            printStatus();
          }
        }
      } catch { }
    })();

    child.exited
      .then((exitCode) => {
        if (serviceStatus[svc.name] === "good") {
          serviceStatus[svc.name] = `stopped (${exitCode})`;
        } else {
          serviceStatus[svc.name] = `exited (${exitCode})`;
        }
        printStatus();
      })
      .catch(() => { });

    pollService(svc);
  }
}

function killServices() {
  for (const child of serviceProcs) {
    try {
      if (process.platform === "win32") {
        Bun.spawnSync(["taskkill", "/pid", String(child.pid), "/f", "/t"], {
          stdio: ["ignore", "ignore", "ignore"],
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch { }
  }
  setTimeout(() => {
    for (const child of serviceProcs) {
      try { child.kill("SIGKILL"); } catch { }
    }
  }, 2000);
}

async function gracefulShutdown() {
  if (shuttingDown) process.exit(0);
  shuttingDown = true;
  console.log("\nshutting down...");
  killServices();
  await vite?.close().catch(() => { });
  for (const conn of connections) conn.destroy();
  connections.clear();
  server.close(() => {
    console.log("port 3000 released! goodbye :(");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
process.on("exit", killServices);

server.listen(PORT, () => {
  console.log(
    `server listening on ${PORT}!! ~ caching: ${CACHING_ENABLED ? "yes" : "no"}`,
  );

  if (NODE_ENV === "development") {
    spawnServices();
  }
});
