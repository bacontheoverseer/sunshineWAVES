import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import crypto from "crypto";
import net from "net";
import dns from "dns";
import { createServer, request } from "http";
import { Database } from "bun:sqlite";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import { LRUCache } from "lru-cache";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { server as wisp } from "@mercuryworkshop/wisp-js";
import { renderStandaloneLegalHtml } from "./src/assets/scripts/core/legalDocs.js";
import {
  OXIUM_PARTNERS_KV_KEY,
  OXIUM_SYNC_KV_KEY,
  OXIUM_PROMOS_KV_KEY,
  normalizeOxiumSlug,
  sanitizeOxiumLinks,
  sanitizeOxiumOrigins,
  sanitizeOxiumFeatures,
  sanitizeOxiumColor,
  sanitizeOxiumUrl,
  sanitizePartnerRecord,
  filterSafeCloudSyncExport,
  isOriginAllowedForSite,
  renderOxiumAuthHtml,
  renderOxiumLinksHtml,
  renderOxiumSdkScript,
  renderOxiumDocsHtml,
  renderOxiumDocsMarkdown,
} from "./src/assets/scripts/core/oxiumServer.js";

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
    maxSize: parseInt(process.env.FILE_CACHE_MAX_MB || "32", 10) * 1024 * 1024,
    ttl: 1000 * 60 * 20,
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
const pageCache = new LRUCache({ max: parseInt(process.env.PAGE_CACHE_MAX || "50", 10), ttl: 1000 * 60 * 5 });

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// Mochi proxy: tries MOCHI_HOST:MOCHI_PORT first, with an in-process SSRF-safe
// fallback for /!cover!/ and /!!/ when mochi is not running (e.g. single-container 512MB deploys).
const MOCHI_HOST = process.env.MOCHI_HOST || "127.0.0.1";
const MOCHI_PORT = parseInt(process.env.MOCHI_PORT || "4000", 10);
const MOCHI_XOR_KEY = Buffer.from("q7Zx!9pL", "utf8");
const MOCHI_FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const mochiCoverCache = CACHING_ENABLED
  ? new LRUCache({
      maxSize: Math.min(8, Math.max(2, parseInt(process.env.FILE_CACHE_MAX_MB || "8", 10))) * 1024 * 1024,
      ttl: 1000 * 60 * 60,
      ttlAutopurge: true,
      sizeCalculation: (entry) => (entry?.body?.length || 0) + 128,
    })
  : null;
let mochiDownUntil = 0;

function decodeMochiToken(token) {
  if (!token) return null;
  try {
    let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const buf = Buffer.from(b64, "base64");
    for (let i = 0; i < buf.length; i++) {
      buf[i] ^= MOCHI_XOR_KEY[i % MOCHI_XOR_KEY.length];
    }
    const decoded = decodeURIComponent(buf.toString("utf8"));
    if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
      return decoded;
    }
  } catch {}
  return null;
}

function decodeMochiTarget(reqUrl) {
  const isCover = reqUrl.startsWith("/!cover!/");
  const prefix = isCover ? "/!cover!/" : "/!!/";
  const rawTarget = reqUrl.slice(prefix.length);
  if (!rawTarget) return null;

  if (rawTarget.startsWith("http://") || rawTarget.startsWith("https://")) {
    return rawTarget;
  }

  const qIdx = rawTarget.indexOf("?");
  const pathOnly = (qIdx >= 0 ? rawTarget.slice(0, qIdx) : rawTarget).replace(/\/+$/, "");
  const outerQuery = qIdx >= 0 ? rawTarget.slice(qIdx) : "";
  const slashIdx = pathOnly.indexOf("/");
  const token = slashIdx >= 0 ? pathOnly.slice(0, slashIdx) : pathOnly;
  let remainder = slashIdx >= 0 ? pathOnly.slice(slashIdx + 1) : "";
  if (remainder.startsWith("!a!")) remainder = remainder.slice(3);

  const decodedBase = decodeMochiToken(token);
  if (decodedBase) {
    if (!remainder && !outerQuery) return decodedBase;
    try {
      let baseForJoin = decodedBase;
      const basePathNoQuery = baseForJoin.split("?")[0] || "";
      const lastSeg = basePathNoQuery.split("/").pop() || "";
      if (remainder && !baseForJoin.endsWith("/") && !lastSeg.includes(".")) {
        baseForJoin += "/";
      }
      const resolved = remainder ? new URL(remainder, baseForJoin).toString() : decodedBase;
      return outerQuery && !resolved.includes("?") ? `${resolved}${outerQuery}` : resolved;
    } catch {
      return decodedBase;
    }
  }

  try {
    const plain = decodeURIComponent(pathOnly);
    if (plain.startsWith("http://") || plain.startsWith("https://")) {
      return `${plain}${outerQuery}`;
    }
  } catch {}
  return null;
}

function isBlockedIp(ip) {
  if (!ip) return true;
  let addr = ip.toLowerCase().split("%")[0];
  if (addr.startsWith("::ffff:")) {
    const mapped = addr.slice(7);
    if (net.isIPv4(mapped)) {
      addr = mapped;
    } else if (mapped.includes(":")) {
      const parts = mapped.split(":");
      if (parts.length === 2) {
        const hi = parseInt(parts[0], 16);
        const lo = parseInt(parts[1], 16);
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          addr = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
        }
      }
    }
  }
  if (net.isIPv4(addr)) {
    const o = addr.split(".").map((n) => parseInt(n, 10));
    if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true;
    if (o[0] === 0) return true; // 0.0.0.0/8
    if (o[0] === 10) return true; // 10.0.0.0/8
    if (o[0] === 127) return true; // 127.0.0.0/8 loopback
    if (o[0] === 169 && o[1] === 254) return true; // 169.254.0.0/16 link-local / metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16.0.0/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168.0.0/16
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // 100.64.0.0/10 CGNAT
    if (o[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(addr)) {
    if (addr === "::" || addr === "::1") return true;
    const first = parseInt(addr.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    return false;
  }
  return true;
}

async function validatePublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return null;
  }
  if (net.isIP(host)) {
    return isBlockedIp(host) ? null : parsed;
  }
  try {
    const records = await dns.promises.lookup(host, { all: true });
    if (!records || records.length === 0) return null;
    if (records.some((r) => isBlockedIp(r.address))) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readLimitedResponseBuffer(upstreamRes, maxBytes) {
  const clHeader = parseInt(upstreamRes.headers.get("content-length") || "0", 10);
  if (clHeader > maxBytes) {
    try { await upstreamRes.body?.cancel(); } catch {}
    return null;
  }
  if (!upstreamRes.body) return Buffer.alloc(0);
  const reader = upstreamRes.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, total);
}

async function handleMochiFallback(req, res) {
  const isCover = req.url.startsWith("/!cover!/");
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    return res.status(502).json({ error: "make sure mochi is running!" });
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    return res.status(204).end();
  }

  const targetStr = decodeMochiTarget(req.url);
  if (!targetStr) {
    return res.status(400).json({ error: "invalid mochi target url" });
  }

  if (isCover && req.method === "GET" && mochiCoverCache) {
    const cached = mochiCoverCache.get(targetStr);
    if (cached) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      res.setHeader("Content-Type", cached.contentType || "application/octet-stream");
      res.setHeader("X-Cache", "HIT");
      return res.status(cached.status).send(cached.body);
    }
  }

  try {
    let currentUrl = await validatePublicHttpUrl(targetStr);
    if (!currentUrl) {
      return res.status(403).json({ error: "blocked target url" });
    }

    let upstreamRes = null;
    for (let hop = 0; hop < 5; hop++) {
      const origin = currentUrl.origin;
      upstreamRes = await fetch(currentUrl.toString(), {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": MOCHI_FALLBACK_UA,
          Accept: isCover
            ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
            : "*/*",
          Referer: `${origin}/`,
        },
      });
      if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
        const loc = upstreamRes.headers.get("location");
        try { await upstreamRes.body?.cancel(); } catch {}
        if (!loc) break;
        const nextUrl = new URL(loc, currentUrl);
        currentUrl = await validatePublicHttpUrl(nextUrl.toString());
        if (!currentUrl) {
          return res.status(403).json({ error: "blocked redirect target" });
        }
        upstreamRes = null;
        continue;
      }
      break;
    }

    if (!upstreamRes) {
      return res.status(502).json({ error: "too many redirects" });
    }

    let contentType = upstreamRes.headers.get("content-type") || "application/octet-stream";
    if (!isCover && /^text\/plain\b/i.test(contentType) && /\.html?$/i.test(currentUrl.pathname)) {
      contentType = "text/html; charset=utf-8";
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Cache-Control",
      isCover
        ? "public, max-age=86400, stale-while-revalidate=604800"
        : "public, max-age=600, stale-while-revalidate=86400",
    );

    if (req.method === "HEAD") {
      try { await upstreamRes.body?.cancel(); } catch {}
      return res.status(upstreamRes.status).end();
    }

    const maxBytes = isCover ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    const body = await readLimitedResponseBuffer(upstreamRes, maxBytes);
    if (!body) {
      return res.status(502).json({ error: "upstream response too large" });
    }

    if (isCover && upstreamRes.ok && body.length <= 512 * 1024 && mochiCoverCache) {
      mochiCoverCache.set(targetStr, { status: upstreamRes.status, contentType, body });
    }
    return res.status(upstreamRes.status).send(body);
  } catch (err) {
    console.error(`mochi fallback failed for ${targetStr}: ${err?.message || err}`);
    if (!res.headersSent) {
      return res.status(502).json({ error: "upstream fetch failed" });
    }
    res.destroy();
  }
}

app.use((req, res, next) => {
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return next();
  if (!req.url.startsWith("/!!/") && !req.url.startsWith("/!cover!/")) return next();

  if (Date.now() < mochiDownUntil && (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS")) {
    return void handleMochiFallback(req, res);
  }

  const options = {
    hostname: MOCHI_HOST,
    port: MOCHI_PORT,
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
    mochiDownUntil = Date.now() + 10000;
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return void handleMochiFallback(req, res);
    }
    console.error(`mochi forwarding failed: ${e.message}`);
    if (!res.headersSent)
      res.status(502).json({ error: "make sure mochi is running!" });
    else res.destroy();
  });

  req.on("error", () => proxyReq.destroy());
  req.pipe(proxyReq);
});

// Dev-only proxy: nuru
app.use((req, res, next) => {
  if (NODE_ENV !== "development") return next();
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') return next();

  let targetPort = 0;
  let label = "";

  if (req.url.startsWith("/w/")) {
    targetPort = 8080;
    label = "nuru";
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

const IMMUTABLE_CC = "public, max-age=31536000, immutable";
const NO_CACHE_CC = "public, max-age=0, must-revalidate";

if (NODE_ENV === "production") {
  const COMPRESSIBLE = /\.(js|css|mjs|json|svg|xml|wasm)$/i;
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
          res.setHeader(
            "Cache-Control",
            req.path.startsWith("/assets/data") ||
              req.path === "/b/all.js" ||
              req.path === "/b/s/jetty.all.js" ||
              req.path === "/b/s/jetty.sync.js"
              ? NO_CACHE_CC
              : IMMUTABLE_CC,
          );
          res.setHeader("Vary", "Accept-Encoding");
          res.setHeader("X-File-Cache", "HIT");
          return res.send(buf);
        }
      }
    }
    next();
  });
}

app.get("/b/all.js", (req, res) => {
  const fp = path.join(srcPath, "b", "all.js");
  if (sendCached(res, fp, "public, max-age=0, must-revalidate")) return;

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
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
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
app.use("/api/", express.json({ limit: "8mb" }));
app.use("/api/", express.urlencoded({ extended: true, limit: "1mb" }));

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
    req.path.startsWith("/assets/") ||
    req.path === "/oxium" ||
    req.path.startsWith("/oxium/") ||
    req.path === "/oxium.js"
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
const OWNER_USERNAMES = new Set(
  (process.env.OWNER_USERNAMES || "bacontheoverseer,bacon")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
const ENV_STAFF_MODS = (process.env.STAFF_MODERATORS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const liveClients = new Map();
const knownUsers = new Map(); // usernameLower -> { username, lastSeen, game, isPlayingGame, gameStartedAt }
const userProfiles = new Map(); // usernameLower -> { bio, statusText, customization, updatedAt }
const staffModerators = new Set(ENV_STAFF_MODS); // Set<usernameLower>
const goatUsers = new Set(); // Set<usernameLower> - golden GOAT title honorees
const chatTimeouts = new Map(); // usernameLower -> { until, reason, by, updatedAt }
const chatGroups = new Map(); // groupId -> { id, name, creator, members, createdAt }
let chatMetaLoadedFromDb = false;

const CLOUDSYNC_JWT_SECRET =
  process.env.JWT_SECRET || "dev_jwt_secret_cookie_super_safe_key_123";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_KEY ||
  ""
).trim();
const SUPABASE_KEY_IS_JWT = SUPABASE_SERVICE_ROLE_KEY.split(".").length === 3;
const USE_SUPABASE_CLOUDSYNC = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
if (SUPABASE_URL && !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[cloudsync] SUPABASE_URL is set without SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY; falling back to local SQLite"
  );
} else if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
  console.warn(
    "[cloudsync] Warning: SUPABASE_SERVICE_ROLE_KEY looks like a sb_publishable_ key! Use a sb_secret_ or legacy service_role key instead."
  );
}

function getCloudSyncDbFilePath() {
  if (process.env.CLOUDSYNC_DB_PATH) return process.env.CLOUDSYNC_DB_PATH;
  const csDir = path.join(__dirname, "cloudsync");
  if (!fs.existsSync(csDir)) {
    try {
      fs.mkdirSync(csDir, { recursive: true });
    } catch {}
  }
  return path.join(csDir, ".db");
}

let cloudSyncDbInitialized = false;
let sharedCloudSyncDb = null;
let sharedCloudSyncDbPath = "";

function getSharedCloudSyncDb() {
  const dbFile = getCloudSyncDbFilePath();
  if (!sharedCloudSyncDb || sharedCloudSyncDbPath !== dbFile) {
    try {
      sharedCloudSyncDb?.close();
    } catch {}
    sharedCloudSyncDb = new Database(dbFile);
    sharedCloudSyncDbPath = dbFile;
    sharedCloudSyncDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -4000;
      PRAGMA busy_timeout = 10000;
    `);
    if (!cloudSyncDbInitialized) {
      sharedCloudSyncDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          token_version INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sync_data (
          user_id INTEGER PRIMARY KEY,
          data_blob BLOB NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS sync_json (
          user_id INTEGER PRIMARY KEY,
          payload_json TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS app_kv (
          k TEXT PRIMARY KEY,
          v TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      `);
      cloudSyncDbInitialized = true;
    }
  }
  return sharedCloudSyncDb;
}

const RESERVED_SYSTEM_KV_USERNAME = "__sunshine_kv__";
const CHAT_META_KV_KEYS = [
  "staff_moderators_v1",
  "goat_users_v1",
  "user_profiles_v2",
  "chat_timeouts_v1",
  "chat_groups_v1",
  "chat_history_v1",
  OXIUM_PARTNERS_KV_KEY,
  OXIUM_SYNC_KV_KEY,
  OXIUM_PROMOS_KV_KEY,
];
let supabaseHasAppKvTable = null; // null = probe on first sync, true/false once probed
let supabaseKvSysUserId = null;
let supabaseMetaHydrated = false;
let supabaseMetaHydratePromise = null;
let isHydratingSupabaseKv = false;
const pendingSupabaseKvTimers = new Map();

function kvGetJson(key, fallback) {
  try {
    const db = getSharedCloudSyncDb();
    const row = db.query("SELECT v FROM app_kv WHERE k = ?").get(String(key));
    if (row && typeof row.v === "string") {
      return JSON.parse(row.v);
    }
  } catch {}
  return fallback;
}

function scheduleSupabaseKvSync(key) {
  if (!USE_SUPABASE_CLOUDSYNC || isHydratingSupabaseKv) return;
  const k = String(key);
  if (pendingSupabaseKvTimers.has(k)) {
    clearTimeout(pendingSupabaseKvTimers.get(k));
  }
  const delayMs = k === "staff_moderators_v1" || k === "goat_users_v1" ? 10 : 250;
  const timer = setTimeout(() => {
    pendingSupabaseKvTimers.delete(k);
    void persistKvKeyToSupabaseAsync(k).catch((e) => {
      console.warn("Supabase app_kv sync warning:", e?.message);
    });
  }, delayMs);
  pendingSupabaseKvTimers.set(k, timer);
}

function kvSetJson(key, value) {
  try {
    const db = getSharedCloudSyncDb();
    db.query("INSERT OR REPLACE INTO app_kv (k, v, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run(
      String(key),
      JSON.stringify(value)
    );
  } catch (e) {
    console.warn("kvSetJson warning:", e?.message);
  }
  scheduleSupabaseKvSync(key);
}

const VALID_AVATAR_DECORATIONS = new Set([
  "none", "angel-bloom", "cyber-ring", "flame-aura", "prism-spin", "glitch-ring",
  "sakura-orbit", "frost-pulse", "void-vortex", "gold-royal", "kitty-neon", "dragon-crest",
]);
const VALID_BANNER_STYLES = new Set([
  "solid", "animated-aurora", "animated-cybergrid", "animated-starfield",
  "animated-plasma", "animated-sunset", "animated-sakura", "animated-void", "animated-gold",
]);
const VALID_NAME_STYLES = new Set([
  "default", "gradient-sunset", "gradient-ocean", "gradient-crimson",
  "animated-rainbow", "animated-fire", "animated-cyber", "animated-galaxy", "animated-gold",
]);
const VALID_NAME_FONTS = new Set(["default", "mono", "serif", "rounded", "wide"]);
const VALID_NAMEPLATES = new Set([
  "none", "aurora-mist", "ember-sparks", "cyber-scan", "sakura-breeze",
  "starlight-shimmer", "nebula-flow", "crimson-velvet",
]);
const VALID_PROFILE_EFFECTS = new Set([
  "none", "starlight-petals", "sakura-fall", "shooting-stars",
  "confetti-pop", "rain-drops", "fireflies", "lightning-border", "snowflakes",
]);
const VALID_CARD_THEMES = new Set([
  "obsidian", "midnight-glass", "crimson-noir", "emerald-cyber", "sakura-velvet", "royal-gold",
]);
const VALID_BIO_STYLES = new Set(["frosted", "minimal", "neon-border", "accent-tint"]);
const VALID_PRESENCE_STATUS = new Set(["online", "idle", "dnd"]);
const VALID_AVATAR_EMOJIS = new Set([
  "", "🍪", "👑", "⚡", "🔥", "🎮", "👾", "💎", "🌟", "🚀", "🦊", "🐱", "🌙", "🎧", "💀", "🌸",
]);

function sanitizeHexColorServer(val, fallback) {
  if (typeof val === "string" && /^#[0-9a-f]{6}$/i.test(val.trim())) {
    return val.trim().toLowerCase();
  }
  return fallback;
}

function sanitizeCustomMediaUrlServer(val) {
  if (typeof val !== "string") return "";
  const s = val.trim();
  if (!s || s.length > 450000) return "";
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-zA-Z0-9+/=]+$/i.test(s)) {
    return s;
  }
  if (s.length > 1000) return "";
  try {
    const parsed = new URL(s);
    return parsed.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

function sanitizeProfileCustomizationServer(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const emoji = typeof src.avatarEmoji === "string" ? src.avatarEmoji.trim() : "";
  return {
    displayName: typeof src.displayName === "string" ? src.displayName.trim().slice(0, 32) : "",
    pronouns: typeof src.pronouns === "string" ? src.pronouns.trim().slice(0, 24) : "",
    customTag: typeof src.customTag === "string" ? src.customTag.trim().slice(0, 18) : "",
    avatarUrl: sanitizeCustomMediaUrlServer(src.avatarUrl),
    bannerUrl: sanitizeCustomMediaUrlServer(src.bannerUrl),
    decorationUrl: sanitizeCustomMediaUrlServer(src.decorationUrl),
    profileEffectUrl: sanitizeCustomMediaUrlServer(src.profileEffectUrl),
    nameplateUrl: sanitizeCustomMediaUrlServer(src.nameplateUrl),
    cardFrameUrl: sanitizeCustomMediaUrlServer(src.cardFrameUrl),
    cardFrameId:
      typeof src.cardFrameId === "string"
        ? src.cardFrameId.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)
        : "",
    avatarColor: sanitizeHexColorServer(src.avatarColor, ""),
    avatarSecondary: sanitizeHexColorServer(src.avatarSecondary, "#18181b"),
    cardBgColor: sanitizeHexColorServer(src.cardBgColor, ""),
    avatarEmoji: VALID_AVATAR_EMOJIS.has(emoji) ? emoji : "",
    avatarDecoration: VALID_AVATAR_DECORATIONS.has(src.avatarDecoration) ? src.avatarDecoration : "none",
    bannerStyle: VALID_BANNER_STYLES.has(src.bannerStyle) ? src.bannerStyle : "solid",
    nameStyle: VALID_NAME_STYLES.has(src.nameStyle) ? src.nameStyle : "default",
    nameFont: VALID_NAME_FONTS.has(src.nameFont) ? src.nameFont : "default",
    nameplate: VALID_NAMEPLATES.has(src.nameplate) ? src.nameplate : "none",
    profileEffect: VALID_PROFILE_EFFECTS.has(src.profileEffect) ? src.profileEffect : "none",
    cardTheme: VALID_CARD_THEMES.has(src.cardTheme) ? src.cardTheme : "obsidian",
    bioStyle: VALID_BIO_STYLES.has(src.bioStyle) ? src.bioStyle : "frosted",
    presenceStatus: VALID_PRESENCE_STATUS.has(src.presenceStatus) ? src.presenceStatus : "online",
  };
}

function applyChatMetaKvMap(kvMap) {
  const mods = kvMap.staff_moderators_v1;
  if (Array.isArray(mods)) {
    for (const u of mods) {
      const clean = String(u || "").trim().toLowerCase();
      if (clean && !OWNER_USERNAMES.has(clean)) staffModerators.add(clean);
    }
  }
  const goats = kvMap.goat_users_v1;
  if (Array.isArray(goats)) {
    for (const u of goats) {
      const clean = String(u || "").trim().toLowerCase();
      if (clean) goatUsers.add(clean);
    }
  }
  const profs = kvMap.user_profiles_v2;
  if (profs && typeof profs === "object") {
    for (const [k, v] of Object.entries(profs)) {
      if (k && v && typeof v === "object") {
        userProfiles.set(k.toLowerCase(), v);
      }
    }
  }
  const tms = kvMap.chat_timeouts_v1;
  if (tms && typeof tms === "object") {
    const now = Date.now();
    for (const [k, v] of Object.entries(tms)) {
      if (k && v && typeof v === "object") {
        if (v.until === -1 || Number(v.until) > now) {
          chatTimeouts.set(k.toLowerCase(), v);
        }
      }
    }
  }
  const hist = kvMap.chat_history_v1;
  if (Array.isArray(hist) && typeof chatHistory !== "undefined" && chatHistory.length === 0) {
    for (const m of hist.slice(-250)) {
      if (m && typeof m === "object" && m.id && m.author && m.channel) {
        chatHistory.push(m);
      }
    }
  }
  const grps = kvMap.chat_groups_v1;
  if (grps && typeof grps === "object") {
    for (const [gid, grp] of Object.entries(grps)) {
      if (gid && grp && typeof grp === "object" && Array.isArray(grp.members)) {
        const members = Array.from(
          new Set(
            grp.members
              .map((m) => String(m || "").trim().toLowerCase())
              .filter(Boolean)
          )
        );
        if (members.length > 0) {
          chatGroups.set(String(gid), {
            id: String(gid),
            name: String(grp.name || "group chat").trim().slice(0, 32) || "group chat",
            creator: String(grp.creator || members[0]).trim(),
            members,
            createdAt: Number(grp.createdAt) || Date.now(),
          });
        }
      }
    }
  }
}

function ensureChatMetaLoaded() {
  if (chatMetaLoadedFromDb) return;
  chatMetaLoadedFromDb = true;
  applyChatMetaKvMap({
    staff_moderators_v1: kvGetJson("staff_moderators_v1", []),
    goat_users_v1: kvGetJson("goat_users_v1", []),
    user_profiles_v2: kvGetJson("user_profiles_v2", {}),
    chat_timeouts_v1: kvGetJson("chat_timeouts_v1", {}),
    chat_history_v1: kvGetJson("chat_history_v1", []),
    chat_groups_v1: kvGetJson("chat_groups_v1", {}),
  });
}

async function getOrCreateSupabaseSystemKvUserId() {
  if (supabaseKvSysUserId) return supabaseKvSysUserId;
  const existing = await dbFindUserByUsername(RESERVED_SYSTEM_KV_USERNAME);
  if (existing?.id) {
    supabaseKvSysUserId = Number(existing.id);
    return supabaseKvSysUserId;
  }
  const created = await dbCreateUser(RESERVED_SYSTEM_KV_USERNAME, "!locked_system_kv_account!");
  if (created?.id) {
    supabaseKvSysUserId = Number(created.id);
    return supabaseKvSysUserId;
  }
  const refetched = await dbFindUserByUsername(RESERVED_SYSTEM_KV_USERNAME);
  if (refetched?.id) {
    supabaseKvSysUserId = Number(refetched.id);
    return supabaseKvSysUserId;
  }
  return null;
}

async function persistKvKeyToSupabaseAsync(key) {
  if (!USE_SUPABASE_CLOUDSYNC) return;
  const val = kvGetJson(key, null);
  if (val === null || val === undefined) return;
  if (supabaseHasAppKvTable !== false) {
    const res = await supabaseRest("app_kv?on_conflict=k", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        k: String(key),
        v: JSON.stringify(val),
        updated_at: new Date().toISOString(),
      }),
    });
    if (res.ok) {
      supabaseHasAppKvTable = true;
      return;
    }
    if (res.status === 404 || res.status === 400 || res.json?.code === "PGRST205") {
      supabaseHasAppKvTable = false;
    }
  }
  const sysId = await getOrCreateSupabaseSystemKvUserId();
  if (!sysId) return;
  const snapshot = {};
  for (const k of CHAT_META_KV_KEYS) {
    const localVal = kvGetJson(k, null);
    if (localVal !== null && localVal !== undefined) snapshot[k] = localVal;
  }
  snapshot[String(key)] = val;
  await dbUpsertSyncPayload(sysId, JSON.stringify({ kv: snapshot }), new Date().toISOString());
}

async function ensureChatMetaReadyAsync() {
  ensureChatMetaLoaded();
  if (!USE_SUPABASE_CLOUDSYNC || supabaseMetaHydrated) return;
  if (!supabaseMetaHydratePromise) {
    supabaseMetaHydratePromise = (async () => {
      try {
        let remoteKv = {};
        if (supabaseHasAppKvTable !== false) {
          const res = await supabaseRest("app_kv?select=k,v");
          if (res.ok && Array.isArray(res.json)) {
            supabaseHasAppKvTable = true;
            for (const row of res.json) {
              if (row?.k && typeof row.v === "string") {
                try {
                  remoteKv[row.k] = JSON.parse(row.v);
                } catch {}
              }
            }
          } else if (res.status === 404 || res.status === 400 || res.json?.code === "PGRST205") {
            supabaseHasAppKvTable = false;
          }
        }
        if (supabaseHasAppKvTable === false) {
          const sysUser = await dbFindUserByUsername(RESERVED_SYSTEM_KV_USERNAME);
          if (sysUser?.id) {
            supabaseKvSysUserId = Number(sysUser.id);
            const row = await dbGetSyncPayload(supabaseKvSysUserId);
            if (row?.payload_json) {
              try {
                const parsed = JSON.parse(String(row.payload_json));
                if (parsed?.kv && typeof parsed.kv === "object") {
                  remoteKv = parsed.kv;
                }
              } catch {}
            }
          }
        }
        if (Object.keys(remoteKv).length > 0) {
          isHydratingSupabaseKv = true;
          try {
            applyChatMetaKvMap(remoteKv);
            for (const k of CHAT_META_KV_KEYS) {
              if (remoteKv[k] !== undefined) kvSetJson(k, remoteKv[k]);
            }
          } finally {
            isHydratingSupabaseKv = false;
          }
        }
      } catch (e) {
        console.warn("Supabase chat meta hydrate warning:", e?.message);
      } finally {
        supabaseMetaHydrated = true;
      }
    })();
  }
  await supabaseMetaHydratePromise;
}

function getCanonicalOwnerUsers(csMap = getCloudSyncUsersMap()) {
  const registeredOwners = [];
  if (csMap.size > 0) {
    for (const o of OWNER_USERNAMES) {
      const rec = csMap.get(o);
      if (rec) registeredOwners.push(rec.username);
    }
    if (registeredOwners.length > 0) return registeredOwners;
  }
  return Array.from(OWNER_USERNAMES);
}

function getCanonicalStaffMods(csMap = getCloudSyncUsersMap()) {
  const seen = new Set();
  const out = [];
  for (const m of staffModerators) {
    const clean = String(m || "").trim().toLowerCase();
    if (!clean || OWNER_USERNAMES.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(csMap.get(clean)?.username || clean);
  }
  return out;
}

function persistChatGroups() {
  const out = {};
  let count = 0;
  for (const [k, v] of chatGroups.entries()) {
    out[k] = v;
    if (++count >= 300) break;
  }
  kvSetJson("chat_groups_v1", out);
}

function canAccessChatChannel(channel, usernameLower) {
  const ch = String(channel || "");
  if (ch.startsWith("dm:")) {
    if (!usernameLower) return false;
    const parts = ch
      .slice(3)
      .split(":")
      .map((p) => (p || "").trim().toLowerCase())
      .filter(Boolean);
    return parts.includes(usernameLower);
  }
  if (ch.startsWith("group:")) {
    if (!usernameLower) return false;
    const grp = chatGroups.get(ch);
    return Boolean(grp && Array.isArray(grp.members) && grp.members.includes(usernameLower));
  }
  return true;
}

function persistStaffMods() {
  kvSetJson("staff_moderators_v1", Array.from(staffModerators));
}

function persistGoatUsers() {
  kvSetJson("goat_users_v1", Array.from(goatUsers));
}

function getCanonicalGoatUsers(csMap = getCloudSyncUsersMap()) {
  return Array.from(goatUsers).map((u) => csMap.get(u)?.username || u);
}

function persistUserProfiles() {
  const out = {};
  let count = 0;
  for (const [k, v] of userProfiles.entries()) {
    out[k] = v;
    if (++count >= 1000) break;
  }
  kvSetJson("user_profiles_v2", out);
}

function persistChatTimeouts() {
  const out = {};
  const now = Date.now();
  for (const [k, v] of chatTimeouts.entries()) {
    if (v && (v.until === -1 || Number(v.until) > now)) {
      out[k] = v;
    }
  }
  kvSetJson("chat_timeouts_v1", out);
}

function persistChatHistory() {
  if (typeof chatHistory !== "undefined") {
    kvSetJson("chat_history_v1", chatHistory.slice(-250));
  }
}

function getUserChatRole(username) {
  ensureChatMetaLoaded();
  const key = String(username || "").trim().toLowerCase();
  if (!key) return "member";
  if (OWNER_USERNAMES.has(key)) return "owner";
  if (staffModerators.has(key)) return "mod";
  return "member";
}

function getActiveTimeout(username) {
  ensureChatMetaLoaded();
  const key = String(username || "").trim().toLowerCase();
  if (!key) return null;
  const entry = chatTimeouts.get(key);
  if (!entry) return null;
  if (entry.until !== -1 && Number(entry.until) <= Date.now()) {
    chatTimeouts.delete(key);
    persistChatTimeouts();
    return null;
  }
  return entry;
}

const sharedCloudSyncDbHandle = {
  query: (...args) => getSharedCloudSyncDb().query(...args),
  prepare: (...args) => getSharedCloudSyncDb().prepare(...args),
  exec: (...args) => getSharedCloudSyncDb().exec(...args),
  transaction: (...args) => getSharedCloudSyncDb().transaction(...args),
  close() {
    // Keep persistent WAL handle pooled to reduce SQLite open/close overhead on Raspberry Pi
  },
};

function openCloudSyncDb(_readonly = false) {
  try {
    getSharedCloudSyncDb();
  } catch (e) {
    console.warn("CloudSync DB init warning:", e.message);
  }
  return sharedCloudSyncDbHandle;
}

async function supabaseRest(restPath, options = {}) {
  const authHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
  if (SUPABASE_KEY_IS_JWT) {
    authHeaders.Authorization = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${restPath}`, {
    ...options,
    headers: {
      ...authHeaders,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {}
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function dbFindUserById(userId) {
  if (USE_SUPABASE_CLOUDSYNC) {
    const { ok, status, json, text } = await supabaseRest(
      `cloudsync_users?id=eq.${Number(userId)}&select=id,username,token_version&limit=1`
    );
    if (!ok) throw new Error(`Supabase select user failed (${status}): ${text}`);
    return Array.isArray(json) && json[0] ? json[0] : null;
  }
  const db = openCloudSyncDb(true);
  try {
    return (
      db
        .query("SELECT id, username, token_version FROM users WHERE id = ?")
        .get(Number(userId)) || null
    );
  } finally {
    db.close();
  }
}

async function dbFindUserByUsername(username) {
  const clean = String(username || "").trim();
  const lower = clean.toLowerCase();
  if (USE_SUPABASE_CLOUDSYNC) {
    const { ok, status, json, text } = await supabaseRest(
      `cloudsync_users?username_lower=eq.${encodeURIComponent(lower)}&select=id,username,password_hash,token_version&limit=1`
    );
    if (!ok) throw new Error(`Supabase select username failed (${status}): ${text}`);
    return Array.isArray(json) && json[0] ? json[0] : null;
  }
  const db = openCloudSyncDb(true);
  try {
    return (
      db
        .query(
          "SELECT id, username, password_hash, token_version FROM users WHERE LOWER(username) = LOWER(?)"
        )
        .get(clean) || null
    );
  } finally {
    db.close();
  }
}

async function dbCreateUser(username, passwordHash) {
  if (USE_SUPABASE_CLOUDSYNC) {
    const existing = await dbFindUserByUsername(username);
    if (existing) return { conflict: true };
    const { ok, status, json, text } = await supabaseRest("cloudsync_users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        username,
        username_lower: username.toLowerCase(),
        password_hash: passwordHash,
        token_version: 1,
      }),
    });
    if (status === 409 || json?.code === "23505") {
      return { conflict: true };
    }
    if (!ok) throw new Error(`Supabase create user failed (${status}): ${text}`);
    const created = Array.isArray(json) ? json[0] : json;
    return {
      conflict: false,
      id: Number(created.id),
      username: String(created.username),
    };
  }
  const db = openCloudSyncDb(false);
  try {
    const existing = db
      .query("SELECT id FROM users WHERE LOWER(username) = LOWER(?)")
      .get(username);
    if (existing) return { conflict: true };
    const result = db
      .query("INSERT INTO users (username, password_hash, token_version) VALUES (?, ?, 1)")
      .run(username, passwordHash);
    return {
      conflict: false,
      id: Number(result.lastInsertRowid),
      username,
    };
  } finally {
    db.close();
  }
}

async function dbDeleteUser(userId) {
  if (USE_SUPABASE_CLOUDSYNC) {
    await supabaseRest(`cloudsync_sync?user_id=eq.${Number(userId)}`, { method: "DELETE" });
    const { ok, status, text } = await supabaseRest(
      `cloudsync_users?id=eq.${Number(userId)}`,
      { method: "DELETE" }
    );
    if (!ok) throw new Error(`Supabase delete user failed (${status}): ${text}`);
    return;
  }
  const db = openCloudSyncDb(false);
  try {
    db.query("DELETE FROM sync_json WHERE user_id = ?").run(userId);
    db.query("DELETE FROM sync_data WHERE user_id = ?").run(userId);
    db.query("DELETE FROM users WHERE id = ?").run(userId);
  } finally {
    db.close();
  }
}

async function dbGetSyncMetaUpdatedAt(userId) {
  if (USE_SUPABASE_CLOUDSYNC) {
    const { ok, status, json, text } = await supabaseRest(
      `cloudsync_sync?user_id=eq.${Number(userId)}&select=updated_at&limit=1`
    );
    if (!ok) throw new Error(`Supabase meta failed (${status}): ${text}`);
    const row = Array.isArray(json) && json[0] ? json[0] : null;
    return row?.updated_at ? String(row.updated_at) : "";
  }
  const db = openCloudSyncDb(true);
  try {
    const row =
      db.query("SELECT updated_at FROM sync_json WHERE user_id = ?").get(userId) ||
      db.query("SELECT updated_at FROM sync_data WHERE user_id = ?").get(userId);
    return row?.updated_at ? String(row.updated_at) : "";
  } finally {
    db.close();
  }
}

async function dbGetSyncPayload(userId) {
  if (USE_SUPABASE_CLOUDSYNC) {
    const { ok, status, json, text } = await supabaseRest(
      `cloudsync_sync?user_id=eq.${Number(userId)}&select=payload_json,updated_at&limit=1`
    );
    if (!ok) throw new Error(`Supabase download failed (${status}): ${text}`);
    return Array.isArray(json) && json[0] ? json[0] : null;
  }
  const db = openCloudSyncDb(true);
  try {
    return (
      db
        .query("SELECT payload_json, updated_at FROM sync_json WHERE user_id = ?")
        .get(userId) || null
    );
  } finally {
    db.close();
  }
}

async function dbUpsertSyncPayload(userId, payloadJson, updatedAt) {
  if (USE_SUPABASE_CLOUDSYNC) {
    const { ok, status, text } = await supabaseRest("cloudsync_sync?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: Number(userId),
        payload_json: payloadJson,
        updated_at: updatedAt,
      }),
    });
    if (!ok) throw new Error(`Supabase upload failed (${status}): ${text}`);
    return;
  }
  const db = openCloudSyncDb(false);
  try {
    db.query(
      "INSERT OR REPLACE INTO sync_json (user_id, payload_json, updated_at) VALUES (?, ?, ?)"
    ).run(userId, payloadJson, updatedAt);
  } finally {
    db.close();
  }
}

async function dbListUsers() {
  if (USE_SUPABASE_CLOUDSYNC) {
    const { ok, status, json, text } = await supabaseRest(
      "cloudsync_users?select=id,username,created_at&order=id.asc"
    );
    if (!ok) throw new Error(`Supabase list users failed (${status}): ${text}`);
    return Array.isArray(json) ? json : [];
  }
  const db = openCloudSyncDb(true);
  try {
    return db
      .query("SELECT id, username, created_at FROM users ORDER BY id ASC")
      .all();
  } finally {
    db.close();
  }
}

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf-8");
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str) {
  const pad = 4 - (str.length % 4);
  const b64 = (str + (pad < 4 ? "=".repeat(pad) : ""))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf-8");
}

function signCloudSyncJwt(claims) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(claims));
  const sig = crypto
    .createHmac("sha256", CLOUDSYNC_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest();
  return `${header}.${payload}.${base64UrlEncode(sig)}`;
}

function verifyCloudSyncJwt(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = base64UrlEncode(
    crypto
      .createHmac("sha256", CLOUDSYNC_JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest()
  );
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (data.exp && Math.floor(Date.now() / 1000) > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function setCloudSyncAuthCookie(res, token, req) {
  const isHttps =
    req?.secure ||
    req?.headers?.["x-forwarded-proto"] === "https";
  const maxAge = 30 * 24 * 60 * 60;
  const cookieParts = [
    `token=${token}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAge}`,
    isHttps ? "SameSite=Strict; Secure" : "SameSite=Lax",
  ];
  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearCloudSyncAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax"
  );
}

async function getAuthenticatedCloudSyncUser(req) {
  const cookieToken = req.cookies?.token;
  const headerToken = req.headers["x-cloudsync-token"] ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : null);
  const headerClaims = verifyCloudSyncJwt(headerToken);
  const cookieClaims = verifyCloudSyncJwt(cookieToken);
  const claims =
    (headerClaims && !String(headerClaims.typ || "").startsWith("oxium_") ? headerClaims : null) ||
    (cookieClaims && !String(cookieClaims.typ || "").startsWith("oxium_") ? cookieClaims : null);
  if (!claims || !claims.id || !claims.username) return null;

  try {
    const row = await dbFindUserById(claims.id);
    if (!row) return null;
    if (String(row.username).toLowerCase() !== String(claims.username).toLowerCase()) {
      return null;
    }
    if (Number(row.token_version || 1) !== Number(claims.v || 1)) return null;
    return { id: Number(row.id), username: String(row.username) };
  } catch {
    // Transient Supabase / DB connectivity blip should not silently strip verified moderator auth
    return { id: Number(claims.id), username: String(claims.username) };
  }
}

// --- Native CloudSync Auth & Sync Endpoints (/api/auth/* & /api/sync/*) ---
app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (username.toLowerCase() === RESERVED_SYSTEM_KV_USERNAME) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "reserved username" });
    }

    if (username.length < 3 || username.length > 20) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "username must be 3-20 chars" });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "username must be alphanumeric" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "password too short (min 8 chars)" });
    }
    if (password.length > 128) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "password too long" });
    }

    const hashed = Bun.password.hashSync(password, {
      algorithm: "bcrypt",
      cost: 10,
    });
    const created = await dbCreateUser(username, hashed);
    if (created.conflict) {
      return res
        .status(409)
        .json({ success: false, user: null, error: "username taken!" });
    }
    const userId = created.id;

    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const token = signCloudSyncJwt({ id: userId, username, v: 1, exp });
    setCloudSyncAuthCookie(res, token, req);
    invalidateCloudSyncUsersCache();
    await getCloudSyncUsersMapAsync(true).catch(() => {});
    touchKnownUser(username);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");

    return res.status(201).json({
      success: true,
      token,
      user: { id: userId, username },
      error: null,
    });
  } catch (err) {
    console.error("CloudSync register error:", err);
    return res
      .status(500)
      .json({ success: false, user: null, error: "internal error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password || username.toLowerCase() === RESERVED_SYSTEM_KV_USERNAME) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "missing username or password" });
    }
    if (password.length > 128) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "password too long" });
    }

    const row = await dbFindUserByUsername(username);
    if (!row || !Bun.password.verifySync(password, String(row.password_hash))) {
      return res
        .status(401)
        .json({ success: false, user: null, error: "invalid credentials!" });
    }

    const userId = Number(row.id);
    const canonicalUsername = String(row.username);
    const tokenVersion = Number(row.token_version || 1);
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const token = signCloudSyncJwt({
      id: userId,
      username: canonicalUsername,
      v: tokenVersion,
      exp,
    });
    setCloudSyncAuthCookie(res, token, req);
    await getCloudSyncUsersMapAsync().catch(() => {});
    touchKnownUser(canonicalUsername);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");

    return res.status(200).json({
      success: true,
      token,
      user: { id: userId, username: canonicalUsername },
      error: null,
    });
  } catch (err) {
    console.error("CloudSync login error:", err);
    return res
      .status(500)
      .json({ success: false, user: null, error: "internal error" });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  clearCloudSyncAuthCookie(res);
  res.json({ success: true, user: null, error: null });
});

app.get("/api/auth/me", async (req, res) => {
  const user = await getAuthenticatedCloudSyncUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, user: null, error: "unauthorized" });
  }
  res.json({ success: true, user, error: null });
});

app.delete("/api/auth/me", async (req, res) => {
  const user = await getAuthenticatedCloudSyncUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, user: null, error: "unauthorized" });
  }
  try {
    await dbDeleteUser(user.id);
    knownUsers.delete(user.username.toLowerCase());
    invalidateCloudSyncUsersCache();
    await getCloudSyncUsersMapAsync(true).catch(() => {});
    clearCloudSyncAuthCookie(res);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    return res.json({ success: true, user: null, error: "account deleted!" });
  } catch {
    return res
      .status(500)
      .json({ success: false, user: null, error: "failed to delete account" });
  }
});

app.get("/api/sync/meta", async (req, res) => {
  const user = await getAuthenticatedCloudSyncUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, data: null, updated_at: null, error: "unauthorized" });
  }
  try {
    const updatedAt = await dbGetSyncMetaUpdatedAt(user.id);
    return res.json({
      success: true,
      data: null,
      updated_at: updatedAt,
      error: null,
    });
  } catch {
    return res.json({ success: true, data: null, updated_at: "", error: null });
  }
});

app.post("/api/sync/upload", async (req, res) => {
  const user = await getAuthenticatedCloudSyncUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, data: null, updated_at: null, error: "unauthorized" });
  }
  try {
    const payload = req.body || {};
    const updatedAt = new Date().toISOString();
    let finalPayload = payload;
    if (payload._delta) {
      const existingRow = await dbGetSyncPayload(user.id);
      let baseObj = { localStorage: {}, indexedDB: {} };
      if (existingRow?.payload_json) {
        try {
          baseObj = JSON.parse(String(existingRow.payload_json));
        } catch {}
      }
      if (payload.localStorage && typeof payload.localStorage === "object") {
        baseObj.localStorage = baseObj.localStorage || {};
        for (const [k, v] of Object.entries(payload.localStorage)) {
          if (v === null) delete baseObj.localStorage[k];
          else baseObj.localStorage[k] = v;
        }
      }
      if (payload.indexedDB && typeof payload.indexedDB === "object") {
        baseObj.indexedDB = { ...(baseObj.indexedDB || {}), ...payload.indexedDB };
      }
      finalPayload = baseObj;
    }

    await dbUpsertSyncPayload(user.id, JSON.stringify(finalPayload), updatedAt);
    return res.json({
      success: true,
      data: null,
      updated_at: updatedAt,
      error: null,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, data: null, updated_at: null, error: err.message });
  }
});

app.get("/api/sync/download", async (req, res) => {
  const user = await getAuthenticatedCloudSyncUser(req);
  if (!user) {
    return res
      .status(401)
      .json({ success: false, data: null, updated_at: null, error: "unauthorized" });
  }
  try {
    const row = await dbGetSyncPayload(user.id);
    if (!row || !row.payload_json) {
      return res.json({
        success: true,
        data: { localStorage: {}, indexedDB: {} },
        updated_at: "",
        error: null,
      });
    }
    return res.json({
      success: true,
      data: JSON.parse(String(row.payload_json)),
      updated_at: String(row.updated_at || ""),
      error: null,
    });
  } catch {
    return res.json({
      success: true,
      data: { localStorage: {}, indexedDB: {} },
      updated_at: "",
      error: null,
    });
  }
});

function isTemporaryGuestName(name) {
  if (!name) return true;
  const lower = String(name).trim().toLowerCase();
  if (!lower || lower === "guest") return true;
  return /^guest[-_][a-z0-9]+$/i.test(lower);
}

let cloudSyncUsersCache = { map: null, expiresAt: 0 };
let cloudSyncUsersRefreshPromise = null;
function invalidateCloudSyncUsersCache() {
  cloudSyncUsersCache = { map: null, expiresAt: 0 };
}

function buildCloudSyncUsersMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (r && r.username) {
      const clean = String(r.username).trim();
      if (!clean || clean.toLowerCase() === RESERVED_SYSTEM_KV_USERNAME) continue;
      map.set(clean.toLowerCase(), {
        id: Number(r.id),
        username: clean,
        createdAt: r.created_at || null,
      });
    }
  }
  return map;
}

async function getCloudSyncUsersMapAsync(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cloudSyncUsersCache.map && now < cloudSyncUsersCache.expiresAt) {
    return cloudSyncUsersCache.map;
  }
  if (cloudSyncUsersRefreshPromise && !forceRefresh) {
    return cloudSyncUsersRefreshPromise;
  }
  const promise = (async () => {
    try {
      const rows = await dbListUsers();
      const map = buildCloudSyncUsersMap(rows);
      cloudSyncUsersCache = { map, expiresAt: Date.now() + 15000 };
      return map;
    } catch (err) {
      if (USE_SUPABASE_CLOUDSYNC) {
        console.warn("[cloudsync] Supabase user list warning:", err.message);
      }
      return cloudSyncUsersCache.map || new Map();
    } finally {
      if (cloudSyncUsersRefreshPromise === promise) {
        cloudSyncUsersRefreshPromise = null;
      }
    }
  })();
  cloudSyncUsersRefreshPromise = promise;
  return promise;
}

function getCloudSyncUsersMap(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cloudSyncUsersCache.map && now < cloudSyncUsersCache.expiresAt) {
    return cloudSyncUsersCache.map;
  }
  if (USE_SUPABASE_CLOUDSYNC) {
    void getCloudSyncUsersMapAsync(forceRefresh);
    return cloudSyncUsersCache.map || new Map();
  }
  const map = new Map();
  try {
    const db = openCloudSyncDb(true);
    try {
      const rows = db
        .query("SELECT id, username, created_at FROM users ORDER BY id ASC")
        .all();
      const built = buildCloudSyncUsersMap(rows);
      cloudSyncUsersCache = { map: built, expiresAt: now + 15000 };
      return built;
    } finally {
      db.close();
    }
  } catch {
    // ignore if DB not initialized yet
  }
  return map;
}

async function getCloudSyncUserAsync(username) {
  if (!username) return null;
  const clean = String(username).trim().toLowerCase();
  if (!clean) return null;
  const csMap = await getCloudSyncUsersMapAsync();
  return csMap.get(clean) || null;
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
  ensureChatMetaLoaded();
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
    if (c.res?.writableEnded || c.res?.destroyed) continue;
    // Allow 75s so Chrome background-tab timer throttling (up to 60s) never drops live users offline
    if (now - (c.lastSeen || 0) > 75000) continue;
    const clean = String(c.username || "").trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (isTemporaryGuestName(clean) && !csMap.has(key)) continue;
    if (csMap.size > 0 && !csMap.has(key)) continue;

    const csRecord = csMap.get(key);
    const canonicalName = csRecord ? csRecord.username : clean;
    const prof = userProfiles.get(key) || {};
    const timeoutEntry = getActiveTimeout(key);
    const role = getUserChatRole(canonicalName);
    const existing = onlineByUsername.get(key);
    const cIdle = Boolean(c.isIdle);
    // Prefer an active (non-idle) session, or playing a game, or most recently seen
    const preferIncoming =
      !existing ||
      (Boolean(existing.isIdle) && !cIdle) ||
      (existing.isIdle === cIdle && ((c.isPlayingGame && !existing.isPlayingGame) || c.lastSeen >= existing.lastSeen));
    if (preferIncoming) {
      onlineByUsername.set(key, {
        id: c.id,
        username: canonicalName,
        online: true,
        isIdle: cIdle,
        page: c.page || "/",
        game: c.game || "browsing",
        isPlayingGame: Boolean(c.isPlayingGame),
        gameStartedAt: Number(c.gameStartedAt) || 0,
        lastSeen: c.lastSeen,
        bio: prof.bio || "",
        statusText: prof.statusText || "",
        customization: prof.customization || null,
        role,
        isGoat: goatUsers.has(key),
        isTimedOut: Boolean(timeoutEntry),
        timeoutUntil: timeoutEntry ? timeoutEntry.until : 0,
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
      const canonicalName = csRecord ? csRecord.username : u.username;
      const timeoutEntry = getActiveTimeout(key);
      offlineUsers.push({
        username: canonicalName,
        online: false,
        game: "",
        isPlayingGame: false,
        gameStartedAt: 0,
        lastSeen: u.lastSeen || 0,
        bio: prof.bio || "",
        statusText: prof.statusText || "",
        customization: prof.customization || null,
        role: getUserChatRole(canonicalName),
        isGoat: goatUsers.has(key),
        isTimedOut: Boolean(timeoutEntry),
        timeoutUntil: timeoutEntry ? timeoutEntry.until : 0,
        createdAt: csRecord?.createdAt || null,
      });
    }
  }

  const registeredUsers = Array.from(csMap.values()).map((u) => u.username);
  return {
    onlineUsers,
    offlineUsers,
    registeredUsers,
    staffMods: getCanonicalStaffMods(csMap),
    ownerUsers: getCanonicalOwnerUsers(csMap),
    goatUsers: getCanonicalGoatUsers(csMap),
  };
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

// Keep-alive heartbeat & low-RAM stale state cleanup every 15s
let heartbeatTick = 0;
setInterval(() => {
  const now = Date.now();
  heartbeatTick++;
  for (const [id, client] of liveClients.entries()) {
    if (client.res?.writableEnded || client.res?.destroyed || now - (client.lastSeen || 0) > 300000) {
      liveClients.delete(id);
      continue;
    }
    try {
      client.res.write(": keepalive\n\n");
    } catch {
      liveClients.delete(id);
    }
  }
  if (heartbeatTick % 4 === 0) {
    // Prune disconnected peers from voiceRooms & cap knownUsers
    for (const [roomId, peers] of voiceRooms.entries()) {
      for (const peerId of peers.keys()) {
        if (!liveClients.has(peerId)) peers.delete(peerId);
      }
      if (peers.size === 0) voiceRooms.delete(roomId);
    }
    if (knownUsers.size > 300) {
      for (const [uname, lastSeen] of knownUsers.entries()) {
        if (now - lastSeen > 24 * 60 * 60 * 1000) knownUsers.delete(uname);
      }
    }
    if (userProfiles.size > 1000) {
      for (const [uname] of userProfiles.entries()) {
        if (!knownUsers.has(uname)) userProfiles.delete(uname);
        if (userProfiles.size <= 1000) break;
      }
      persistUserProfiles();
    }
  }
  if (heartbeatTick % 20 === 0 && sharedCloudSyncDb) {
    try {
      sharedCloudSyncDb.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {}
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

app.get("/api/live/stream", async (req, res) => {
  const [authUser] = await Promise.all([
    getAuthenticatedCloudSyncUser(req),
    getCloudSyncUsersMapAsync().catch(() => null),
  ]);
  if (req.destroyed || req.socket?.destroyed) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const clientId = (req.query.id || Math.random().toString(36).substring(2, 10)).toString();
  const username = authUser
    ? authUser.username
    : (req.query.user || "Guest-" + clientId.substring(0, 4)).toString();
  const page = (req.query.page || "/").toString().slice(0, 200);
  const game = (req.query.game || "Browsing").toString().slice(0, 120);
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "127.0.0.1")
    .toString()
    .replace(/^::ffff:/, "");

  const clientRecord = {
    res,
    id: clientId,
    username,
    verifiedUsername: authUser ? authUser.username.toLowerCase() : null,
    ip,
    page,
    game,
    isPlayingGame: false,
    isIdle: req.query.idle === "1" || req.query.idle === "true",
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
  const { clientId, username, page, game, isPlayingGame, gameStartedAt, idle } = req.body || {};
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
    if (typeof idle === "boolean" && client.isIdle !== idle) {
      client.isIdle = idle;
      changed = true;
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

function isSafeExternalHttpUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
      return false;
    }
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      ) {
        return false;
      }
    }
    if (host === "::1" || host === "::" || /^(fe80|fc00|fd[0-9a-f]{2}):/i.test(host) || host.startsWith("::ffff:")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

app.get("/api/live/audio-proxy", async (req, res) => {
  try {
    const rawUrl = (req.query.url || "").toString().trim();
    if (!isSafeExternalHttpUrl(rawUrl)) {
      return res.status(400).send("Invalid or disallowed audio url");
    }
    let targetUrl = rawUrl;
    let upstream = await fetch(targetUrl, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "audio/*,*/*;q=0.9",
      },
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      const loc = upstream.headers.get("location");
      targetUrl = loc ? new URL(loc, rawUrl).toString() : "";
      if (!isSafeExternalHttpUrl(targetUrl)) {
        return res.status(400).send("Disallowed redirect target");
      }
      upstream = await fetch(targetUrl, { redirect: "error" });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).send("Upstream audio failed");
    }
    const contentLen = Number(upstream.headers.get("content-length") || 0);
    if (contentLen > 8 * 1024 * 1024) {
      return res.status(413).send("Audio too large");
    }
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) {
      return res.status(413).send("Audio too large");
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (err) {
    res.status(500).send("Audio proxy error");
  }
});

function pruneCachedSoundsInDir(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const entries = fs
      .readdirSync(dir)
      .filter((name) => /^(cached_|upload_)/i.test(name) && /\.(mp3|wav|ogg|m4a)$/i.test(name))
      .map((name) => {
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        return { full, size: st.size, mtimeMs: st.mtimeMs };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

    let totalBytes = entries.reduce((acc, e) => acc + e.size, 0);
    const MAX_FILES = 40;
    const MAX_BYTES = 50 * 1024 * 1024;
    let remaining = entries.length;
    for (const entry of entries) {
      if (remaining <= MAX_FILES && totalBytes <= MAX_BYTES) break;
      try {
        fs.unlinkSync(entry.full);
        totalBytes -= entry.size;
        remaining--;
      } catch {}
    }
  } catch {}
}

function writeSoundBufferToDirs(safeFilename, buffer) {
  const dir = path.join(publicPath, "assets", "sounds");
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, safeFilename), buffer);
    pruneCachedSoundsInDir(dir);
  } catch {}
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

const ALLOWED_SOUND_EXTS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".webm"]);

app.post("/api/admin/upload-sound", verifyAdmin, (req, res) => {
  try {
    const { name, filename, data } = req.body || {};
    if (!data || !filename) {
      return res.status(400).json({ success: false, error: "Missing sound file data" });
    }

    const ext = path.extname(String(filename)).toLowerCase() || ".mp3";
    if (!ALLOWED_SOUND_EXTS.has(ext)) {
      return res.status(400).json({ success: false, error: "Unsupported audio file extension" });
    }
    const baseClean = path.basename(String(filename), ext).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 32) || "sound";
    const safeFilename = `upload_${Date.now()}_${baseClean}${ext}`;

    const cleanBase64 = String(data).replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: "Sound file exceeds 5MB limit" });
    }
    writeSoundBufferToDirs(safeFilename, buffer);

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

app.get("/api/admin/myinstants-search", async (req, res) => {
  try {
    const query = (req.query.query || "").toString().trim();
    const results = [];
    const seenUrls = new Set();

    const addResult = (rawName, rawSoundUrl) => {
      if (!rawSoundUrl) return;
      const fullUrl = rawSoundUrl.startsWith("http")
        ? rawSoundUrl
        : `https://www.myinstants.com${rawSoundUrl.startsWith("/") ? "" : "/"}${rawSoundUrl}`;
      if (seenUrls.has(fullUrl)) return;
      seenUrls.add(fullUrl);
      const cleanName = decodeHtmlEntities(rawName || "myinstants sound");
      results.push({
        name: cleanName,
        url: `/api/live/audio-proxy?url=${encodeURIComponent(fullUrl)}`,
        rawUrl: fullUrl,
        source: "myinstants",
      });
    };

    // 1. Query MyInstants Official JSON REST API v1 first (fastest & most reliable)
    try {
      const apiUrl = query
        ? `https://www.myinstants.com/api/v1/instants/?format=json&name=${encodeURIComponent(query)}`
        : `https://www.myinstants.com/api/v1/instants/?format=json`;
      const apiRes = await fetch(apiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
        },
      });
      if (apiRes.ok) {
        const apiData = await apiRes.json();
        const items = Array.isArray(apiData?.results) ? apiData.results : [];
        for (const item of items) {
          if (results.length >= 40) break;
          if (item?.sound) {
            addResult(item.name || item.slug || "sound", item.sound);
          }
        }
      }
    } catch (e) {
      console.warn("MyInstants JSON API fallback notice:", e.message);
    }

    // 2. Also scrape HTML search page if we need more results
    if (results.length < 15) {
      try {
        const searchUrl = query
          ? `https://www.myinstants.com/en/search/?name=${encodeURIComponent(query)}`
          : `https://www.myinstants.com/en/index/us/`;
        const response = await fetch(searchUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (response.ok) {
          const html = await response.text();
          const btnRegex = /<button[^>]*onclick="play\('([^']+)'[^"]*"[^>]*>/gi;
          let match;
          while ((match = btnRegex.exec(html)) !== null && results.length < 40) {
            const tag = match[0];
            const soundPath = match[1];
            const titleMatch = tag.match(/title="Play\s+(.+?)\s+sound"/i) || tag.match(/title="([^"]+)"/i);
            const soundName = titleMatch ? titleMatch[1] : path.basename(soundPath, ".mp3").replace(/[-_]/g, " ");
            addResult(soundName, soundPath);
          }
        }
      } catch (e) {
        console.warn("MyInstants HTML scrape fallback notice:", e.message);
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error("MyInstants search error:", err);
    res.status(500).json({ success: false, error: err.message, results: [] });
  }
});

app.post("/api/admin/resolve-sound", async (req, res) => {
  try {
    const rawUrl = (req.body?.url || "").toString().trim();
    if (!rawUrl || !isSafeExternalHttpUrl(rawUrl)) {
      return res.status(400).json({ success: false, error: "Invalid or disallowed url" });
    }

    let resolvedMp3 = rawUrl;
    const parsedRaw = new URL(rawUrl);
    if ((parsedRaw.hostname === "myinstants.com" || parsedRaw.hostname.endsWith(".myinstants.com")) && !rawUrl.endsWith(".mp3")) {
      const pageRes = await fetch(rawUrl, {
        redirect: "error",
        headers: { "User-Agent": "Mozilla/5.0" },
      });
      const html = await pageRes.text();
      const match = html.match(/onclick="play\('(\/media\/sounds\/[^']+)'/);
      if (match) {
        resolvedMp3 = `https://www.myinstants.com${match[1]}`;
      }
    }

    if (!isSafeExternalHttpUrl(resolvedMp3)) {
      return res.status(400).json({ success: false, error: "Disallowed resolved audio URL" });
    }

    // Download and cache into /assets/sounds/ (only if safe external audio <= 5MB)
    try {
      const audioRes = await fetch(resolvedMp3, { redirect: "error", headers: { "User-Agent": "Mozilla/5.0" } });
      if (audioRes.ok) {
        const len = Number(audioRes.headers.get("content-length") || 0);
        if (len <= 5 * 1024 * 1024) {
          const buf = Buffer.from(await audioRes.arrayBuffer());
          if (buf.length <= 5 * 1024 * 1024) {
            const safeFilename = `cached_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`;
            writeSoundBufferToDirs(safeFilename, buf);
            return res.json({ success: true, url: `/assets/sounds/${safeFilename}` });
          }
        }
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

// --- CloudPlay: 2-Player Co-Op Party & Remote Keybind / Stream Engine ---
const cloudPlayParties = new Map(); // code (uppercase 6 chars) -> PartyObject

function generatePartyCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!cloudPlayParties.has(code)) return code;
  }
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function normalizePartyCode(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function broadcastToParty(party, payload, excludeClientId = null) {
  if (!party) return 0;
  const msg = `data: ${JSON.stringify({
    type: "cloudplay-event",
    code: party.code,
    ...payload,
  })}\n\n`;

  const targets = [party.host, party.guest].filter(Boolean);
  let sent = 0;
  for (const member of targets) {
    if (excludeClientId && member.clientId === excludeClientId) continue;
    for (const [cid, client] of liveClients.entries()) {
      const matchId = member.clientId && cid === member.clientId;
      const matchUser =
        member.username &&
        (client.username || "").toLowerCase() === member.username.toLowerCase();
      if (matchId || matchUser) {
        try {
          client.res.write(msg);
          sent++;
        } catch {}
      }
    }
  }
  return sent;
}

// Cleanup inactive CloudPlay parties older than 2 hours
setInterval(() => {
  const now = Date.now();
  for (const [code, party] of cloudPlayParties.entries()) {
    if (now - (party.lastActiveAt || party.createdAt || 0) > 2 * 60 * 60 * 1000) {
      cloudPlayParties.delete(code);
    }
  }
}, 60000);

app.post("/api/cloudplay/create", (req, res) => {
  try {
    const {
      clientId,
      username,
      gameTitle,
      gameUrl,
      hostRole = "wasd",
      guestRole = "arrows",
      remapGuestWasdToArrows = false,
    } = req.body || {};

    const cleanUser = String(username || "").trim();
    if (!cleanUser || isTemporaryGuestName(cleanUser)) {
      return res.status(401).json({
        success: false,
        error: "sign in to cloudsync first to create a cloudplay party",
      });
    }

    // Close any previous party hosted by this user
    for (const [oldCode, p] of cloudPlayParties.entries()) {
      if (p.host?.username?.toLowerCase() === cleanUser.toLowerCase()) {
        broadcastToParty(p, { eventType: "PARTY_CLOSED", reason: "host created a new party" });
        cloudPlayParties.delete(oldCode);
      }
    }

    const code = generatePartyCode();
    const party = {
      code,
      gameTitle: String(gameTitle || "2-player game").trim(),
      gameUrl: String(gameUrl || "").trim(),
      host: {
        clientId: String(clientId || ""),
        username: cleanUser,
        role: hostRole,
      },
      guest: null,
      settings: {
        hostRole: hostRole || "wasd",
        guestRole: guestRole || "arrows",
        remapGuestWasdToArrows: Boolean(remapGuestWasdToArrows),
      },
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    cloudPlayParties.set(code, party);
    res.json({ success: true, party });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/cloudplay/join", (req, res) => {
  try {
    const { code: rawCode, clientId, username } = req.body || {};
    const code = normalizePartyCode(rawCode);
    const cleanUser = String(username || "").trim();

    if (!code || code.length < 4) {
      return res.status(400).json({ success: false, error: "enter a valid 6-character party code" });
    }
    if (!cleanUser || isTemporaryGuestName(cleanUser)) {
      return res.status(401).json({
        success: false,
        error: "sign in to cloudsync first to join a cloudplay party",
      });
    }

    const party = cloudPlayParties.get(code);
    if (!party) {
      return res.status(404).json({
        success: false,
        error: `party "${code}" not found or has ended`,
      });
    }

    const isHostRejoining =
      party.host.username.toLowerCase() === cleanUser.toLowerCase() &&
      party.host.clientId === String(clientId || "");

    if (isHostRejoining) {
      party.lastActiveAt = Date.now();
      return res.json({ success: true, party, role: "host" });
    }

    // Max of 2 players in a party!
    if (
      party.guest &&
      party.guest.username.toLowerCase() !== cleanUser.toLowerCase() &&
      party.guest.clientId !== String(clientId || "")
    ) {
      return res.status(409).json({
        success: false,
        error: "this party is already full (max 2 players)",
      });
    }

    party.guest = {
      clientId: String(clientId || ""),
      username: cleanUser,
      role: party.settings.guestRole || "arrows",
      joinedAt: Date.now(),
    };
    party.lastActiveAt = Date.now();

    broadcastToParty(party, {
      eventType: "PARTY_UPDATED",
      party,
      joinedUser: cleanUser,
    });

    res.json({ success: true, party, role: "guest" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/cloudplay/party", (req, res) => {
  const code = normalizePartyCode(req.query.code);
  if (!code) {
    return res.status(400).json({ success: false, error: "missing party code" });
  }
  const party = cloudPlayParties.get(code);
  if (!party) {
    return res.status(404).json({ success: false, error: "party not found" });
  }
  res.json({ success: true, party });
});

app.post("/api/cloudplay/config", (req, res) => {
  try {
    const {
      code: rawCode,
      gameTitle,
      gameUrl,
      hostRole,
      guestRole,
      remapGuestWasdToArrows,
    } = req.body || {};
    const code = normalizePartyCode(rawCode);
    const party = cloudPlayParties.get(code);
    if (!party) {
      return res.status(404).json({ success: false, error: "party not found" });
    }

    if (typeof gameTitle === "string" && gameTitle.trim()) {
      party.gameTitle = gameTitle.trim();
    }
    if (typeof gameUrl === "string") {
      party.gameUrl = gameUrl.trim();
    }
    if (hostRole) {
      party.settings.hostRole = hostRole;
      party.host.role = hostRole;
    }
    if (guestRole) {
      party.settings.guestRole = guestRole;
      if (party.guest) party.guest.role = guestRole;
    }
    if (typeof remapGuestWasdToArrows === "boolean") {
      party.settings.remapGuestWasdToArrows = remapGuestWasdToArrows;
    }
    party.lastActiveAt = Date.now();

    broadcastToParty(party, {
      eventType: "PARTY_UPDATED",
      party,
    });

    res.json({ success: true, party });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/cloudplay/leave", (req, res) => {
  try {
    const { code: rawCode, clientId, username } = req.body || {};
    const code = normalizePartyCode(rawCode);
    const party = cloudPlayParties.get(code);
    if (!party) {
      return res.json({ success: true });
    }

    const isHost =
      (clientId && party.host.clientId === clientId) ||
      (username && party.host.username.toLowerCase() === String(username).toLowerCase());

    if (isHost) {
      broadcastToParty(party, {
        eventType: "PARTY_CLOSED",
        reason: `host @${party.host.username} ended the cloudplay party`,
      });
      cloudPlayParties.delete(code);
    } else if (party.guest) {
      const leftUser = party.guest.username;
      party.guest = null;
      party.lastActiveAt = Date.now();
      broadcastToParty(party, {
        eventType: "GUEST_LEFT",
        party,
        leftUser,
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/cloudplay/signal", (req, res) => {
  try {
    const { code: rawCode, fromClientId, signalType, data } = req.body || {};
    const code = normalizePartyCode(rawCode);
    const party = cloudPlayParties.get(code);
    if (!party) {
      return res.status(404).json({ success: false, error: "party not found" });
    }
    party.lastActiveAt = Date.now();

    const delivered = broadcastToParty(
      party,
      {
        eventType: "SIGNAL",
        signalType,
        fromClientId,
        data,
        party,
      },
      fromClientId
    );

    res.json({ success: true, delivered });
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

const KLIPY_API_KEY = (process.env.KLIPY_API_KEY || process.env.KLIPY_APP_KEY || "").trim();
const KLIPY_CONTENT_FILTER = (process.env.KLIPY_CONTENT_FILTER || "high").trim();

function isAllowedKlipyMediaUrl(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s || s.length > 1000) return false;
  try {
    const parsed = new URL(s);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "klipy.com" || host.endsWith(".klipy.com");
  } catch {
    return false;
  }
}

function pickKlipyVariantUrl(container) {
  if (!container || typeof container !== "object") return null;
  if (typeof container.webp?.url === "string" && isAllowedKlipyMediaUrl(container.webp.url)) {
    return { url: container.webp.url, width: Number(container.webp.width) || 0, height: Number(container.webp.height) || 0 };
  }
  if (typeof container.gif?.url === "string" && isAllowedKlipyMediaUrl(container.gif.url)) {
    return { url: container.gif.url, width: Number(container.gif.width) || 0, height: Number(container.gif.height) || 0 };
  }
  return null;
}

function normalizeKlipyItem(item) {
  if (!item || typeof item !== "object") return null;
  const f = item.file && typeof item.file === "object" ? item.file : null;
  const legacyFiles = item.files && typeof item.files === "object" ? item.files : null;

  const previewCandidate =
    pickKlipyVariantUrl(f?.sm) ||
    pickKlipyVariantUrl(f?.xs) ||
    pickKlipyVariantUrl(f?.md) ||
    pickKlipyVariantUrl(legacyFiles) ||
    (isAllowedKlipyMediaUrl(item.url) ? { url: item.url, width: Number(item.file_meta?.width) || 0, height: Number(item.file_meta?.height) || 0 } : null);

  const sendCandidate =
    pickKlipyVariantUrl(f?.md) ||
    pickKlipyVariantUrl(f?.sm) ||
    pickKlipyVariantUrl(f?.hd) ||
    pickKlipyVariantUrl(legacyFiles) ||
    previewCandidate;

  if (!previewCandidate || !sendCandidate) return null;

  return {
    id: String(item.id || item.slug || sendCandidate.url),
    title: String(item.title || item.slug || "GIF").slice(0, 120),
    previewUrl: previewCandidate.url,
    url: sendCandidate.url,
    width: sendCandidate.width || previewCandidate.width || 0,
    height: sendCandidate.height || previewCandidate.height || 0,
  };
}

app.get("/api/chat/gifs", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (!KLIPY_API_KEY) {
    return res.json({
      success: true,
      configured: false,
      items: [],
      hasNext: false,
    });
  }

  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const q = String(req.query?.q || "").trim().slice(0, 80);
    const page = Math.max(1, Math.min(25, parseInt(String(req.query?.page || "1"), 10) || 1));
    const perPage = Math.max(6, Math.min(24, parseInt(String(req.query?.perPage || "18"), 10) || 18));
    const customerId = String(authUser?.username || req.query?.customerId || "operation_cookie")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 48) || "operation_cookie";

    const endpoint = q ? "search" : "trending";
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      customer_id: customerId,
      content_filter: KLIPY_CONTENT_FILTER,
    });
    if (q) params.set("q", q);

    const klipyUrl = `https://api.klipy.com/api/v1/${encodeURIComponent(KLIPY_API_KEY)}/gifs/${endpoint}?${params.toString()}`;
    const apiRes = await fetch(klipyUrl, { headers: { Accept: "application/json" } });
    const json = await apiRes.json().catch(() => null);

    if (!apiRes.ok || !json) {
      return res.status(502).json({
        success: false,
        configured: true,
        items: [],
        error: json?.message || `KLIPY API error (${apiRes.status})`,
      });
    }

    const rawList = Array.isArray(json?.data?.data)
      ? json.data.data
      : Array.isArray(json?.data)
        ? json.data
        : [];
    const items = rawList.map(normalizeKlipyItem).filter(Boolean);
    const hasNext = Boolean(
      json?.data?.has_next ??
      (json?.data?.total && page * perPage < Number(json.data.total)) ??
      items.length >= perPage
    );

    return res.json({
      success: true,
      configured: true,
      items,
      page,
      hasNext,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      configured: true,
      items: [],
      error: err?.message || "Failed to load GIFs from KLIPY.",
    });
  }
});

const klipyMediaCache = new LRUCache({
  maxSize: 24 * 1024 * 1024,
  ttl: 1000 * 60 * 30,
  ttlAutopurge: true,
  sizeCalculation: (entry) => (entry?.body?.length || 0) + 128,
});

app.get("/api/chat/gif-proxy", async (req, res) => {
  const rawUrl = String(req.query?.url || "").trim();
  if (!isAllowedKlipyMediaUrl(rawUrl)) {
    return res.status(400).send("Invalid KLIPY URL");
  }

  const cached = klipyMediaCache.get(rawUrl);
  if (cached) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(cached.body);
  }

  try {
    let targetUrl = rawUrl;
    let upstream = null;
    for (let hops = 0; hops < 4; hops++) {
      upstream = await fetch(targetUrl, {
        redirect: "manual",
        headers: {
          "User-Agent": MOCHI_FALLBACK_UA,
          Accept: "image/webp,image/gif,image/*,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get("location");
        if (!loc) break;
        const resolved = new URL(loc, targetUrl).href;
        if (!isAllowedKlipyMediaUrl(resolved)) {
          return res.status(403).send("Disallowed redirect target");
        }
        targetUrl = resolved;
        continue;
      }
      break;
    }

    if (!upstream || !upstream.ok) {
      return res.status(502).send("Failed to fetch KLIPY media");
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      return res.status(415).send("Unsupported media type");
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    if (body.length === 0 || body.length > 10 * 1024 * 1024) {
      return res.status(413).send("GIF too large");
    }

    if (body.length <= 4 * 1024 * 1024) {
      klipyMediaCache.set(rawUrl, { body, contentType });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(body);
  } catch {
    return res.status(502).send("Failed to fetch KLIPY media");
  }
});

const chatImageProxyCache = new LRUCache({
  maxSize: 24 * 1024 * 1024,
  ttl: 1000 * 60 * 30,
  ttlAutopurge: true,
  sizeCalculation: (entry) => (entry?.body?.length || 0) + 128,
});

const ALLOWED_IMAGE_PROXY_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

app.get("/api/chat/image-proxy", async (req, res) => {
  const rawUrl = String(req.query?.url || "").trim();
  if (!rawUrl || rawUrl.length > 1000) {
    return res.status(400).send("Invalid image URL");
  }

  const cached = chatImageProxyCache.get(rawUrl);
  if (cached) {
    res.setHeader("Content-Type", cached.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(cached.body);
  }

  try {
    let targetUrl = rawUrl;
    let upstream = null;
    for (let hops = 0; hops < 4; hops++) {
      const validated = await validatePublicHttpUrl(targetUrl);
      if (!validated || validated.protocol !== "https:") {
        return res.status(403).send("Only public HTTPS image URLs are allowed");
      }
      upstream = await fetch(validated.href, {
        redirect: "manual",
        headers: {
          "User-Agent": MOCHI_FALLBACK_UA,
          Accept: "image/avif,image/webp,image/gif,image/png,image/jpeg,*/*;q=0.5",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        const loc = upstream.headers.get("location");
        if (!loc) break;
        targetUrl = new URL(loc, validated.href).href;
        continue;
      }
      break;
    }

    if (!upstream || !upstream.ok) {
      return res.status(502).send("Failed to fetch remote image");
    }

    const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_PROXY_MIMES.has(contentType)) {
      return res.status(415).send("Unsupported image type");
    }

    const body = await readLimitedResponseBuffer(upstream, 8 * 1024 * 1024);
    if (!body || body.length === 0) {
      return res.status(413).send("Image empty or exceeds 8MB limit");
    }

    if (body.length <= 4 * 1024 * 1024) {
      chatImageProxyCache.set(rawUrl, { body, contentType });
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(body);
  } catch {
    return res.status(502).send("Failed to fetch remote image");
  }
});

app.post("/api/chat/moderate", async (req, res) => {
  try {
    const { text } = req.body || {};
    const result = await moderateTextWithOpenAI(text);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, blocked: false, flagged: false, error: err.message });
  }
});

async function getModActor(req) {
  await ensureChatMetaReadyAsync();
  const keyHeader =
    req.headers["x-admin-key"] ||
    req.query?.adminKey ||
    (req.body && req.body.adminSecret) ||
    "";
  const hasAdminSecret = Boolean(keyHeader && keyHeader === ADMIN_SECRET);
  const authUser = await getAuthenticatedCloudSyncUser(req);
  const usernameLower = authUser ? authUser.username.toLowerCase() : "";
  const role = hasAdminSecret
    ? "owner"
    : authUser
      ? getUserChatRole(authUser.username)
      : "member";
  return {
    hasAdminSecret,
    authUser,
    username: hasAdminSecret && !authUser ? ADMIN_USERNAME : authUser?.username || "",
    usernameLower,
    role,
    isOwner: role === "owner",
    isMod: role === "owner" || role === "mod",
  };
}

app.get("/api/chat/state", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const [authUser, csMap] = await Promise.all([
    getAuthenticatedCloudSyncUser(req),
    getCloudSyncUsersMapAsync().catch(() => new Map()),
  ]);
  const verifiedUserKey = authUser ? authUser.username.toLowerCase() : "";
  if (authUser) touchKnownUser(authUser.username);

  const visibleMessages = chatHistory.filter((m) =>
    canAccessChatChannel(m.channel, verifiedUserKey)
  );

  const userGroups = [];
  if (verifiedUserKey) {
    for (const grp of chatGroups.values()) {
      if (grp && Array.isArray(grp.members) && grp.members.includes(verifiedUserKey)) {
        userGroups.push(grp);
      }
    }
    userGroups.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  const activeVoice = {};
  for (const [roomId, peers] of voiceRooms.entries()) {
    activeVoice[roomId] = Array.from(peers.values());
  }

  const presence = getPresenceSnapshot();
  const selfRole = authUser ? getUserChatRole(authUser.username) : "member";
  const selfTimeout = authUser ? getActiveTimeout(authUser.username) : null;

  res.json({
    success: true,
    messages: visibleMessages.slice(-200),
    groups: userGroups,
    voiceRooms: activeVoice,
    onlineUsers: presence.onlineUsers,
    offlineUsers: presence.offlineUsers,
    registeredUsers: presence.registeredUsers,
    staffMods: getCanonicalStaffMods(csMap),
    ownerUsers: getCanonicalOwnerUsers(csMap),
    goatUsers: presence.goatUsers,
    selfRole,
    selfTimeout,
  });
});

app.get("/api/chat/user-profile", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const rawTarget = (req.query.username || req.query.user || "").toString().trim();
  if (!rawTarget) {
    return res.status(400).json({ success: false, exists: false, error: "username is required" });
  }

  let csMap = await getCloudSyncUsersMapAsync();
  const key = rawTarget.toLowerCase();
  let csUser = csMap.get(key) || null;
  if (!csUser) {
    csMap = await getCloudSyncUsersMapAsync(true);
    csUser = csMap.get(key) || null;
  }

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
  const timeoutEntry = getActiveTimeout(key);

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
      username: canonicalName,
      createdAt: csUser ? csUser.createdAt : null,
      cloudSyncVerified: Boolean(csUser),
      bio: prof.bio || "",
      statusText: prof.statusText || "",
      customization: prof.customization || null,
      role: getUserChatRole(canonicalName),
      isGoat: goatUsers.has(key),
      isTimedOut: Boolean(timeoutEntry),
      timeoutUntil: timeoutEntry ? timeoutEntry.until : 0,
      timeoutReason: timeoutEntry ? timeoutEntry.reason || "" : "",
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
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync to update your profile" });
    }
    const { username, bio, statusText, customization } = req.body || {};
    const cleanUser = (username || authUser.username).toString().trim();
    const key = cleanUser.toLowerCase();
    if (authUser.username.toLowerCase() !== key) {
      return res.status(403).json({ success: false, error: "You can only edit your own profile" });
    }
    let csMap = await getCloudSyncUsersMapAsync();
    if (!csMap.has(key)) {
      csMap = await getCloudSyncUsersMapAsync(true);
    }
    if (csMap.size > 0 && !csMap.has(key)) {
      return res.status(404).json({ success: false, error: "User not found in CloudSync" });
    }

    const existing = userProfiles.get(key) || {};
    const cleanBio =
      bio !== undefined ? (bio || "").toString().trim().slice(0, 220) : (existing.bio || "");
    const cleanStatus =
      statusText !== undefined
        ? (statusText || "").toString().trim().slice(0, 60)
        : (existing.statusText || "");
    const nextCustomization =
      customization !== undefined
        ? sanitizeProfileCustomizationServer(customization)
        : (existing.customization || sanitizeProfileCustomizationServer({}));

    const textToModerate = [
      cleanStatus,
      cleanBio,
      nextCustomization.displayName,
      nextCustomization.pronouns,
      nextCustomization.customTag,
    ]
      .filter(Boolean)
      .join(" ");

    if (textToModerate) {
      const modCheck = await moderateTextWithOpenAI(textToModerate);
      if (modCheck.blocked || modCheck.flagged) {
        return res.status(400).json({
          success: false,
          error: modCheck.reason || "Profile customization text blocked by moderation",
        });
      }
    }

    const updated = {
      bio: cleanBio,
      statusText: cleanStatus,
      customization: nextCustomization,
      updatedAt: new Date().toISOString(),
    };
    userProfiles.set(key, updated);
    persistUserProfiles();

    // Update cached recent messages authored by this user so avatars/names reflect changes
    for (let i = 0; i < chatHistory.length; i++) {
      if (String(chatHistory[i]?.author || "").toLowerCase() === key) {
        chatHistory[i] = {
          ...chatHistory[i],
          role: getUserChatRole(authUser.username),
          customization: nextCustomization,
          ...(nextCustomization.avatarColor ? { avatarColor: nextCustomization.avatarColor } : {}),
        };
      }
    }
    persistChatHistory();

    const role = getUserChatRole(authUser.username);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    broadcastToClients(
      {
        type: "chat-event",
        event: "PROFILE_UPDATED",
        username: authUser.username,
        bio: cleanBio,
        statusText: cleanStatus,
        customization: nextCustomization,
        role,
      },
      "all",
    );
    res.json({ success: true, profile: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function broadcastChatPayload(channel, eventPayload, extraUsernames = []) {
  const ch = String(channel || "");
  if (ch.startsWith("dm:") || ch.startsWith("group:")) {
    let targetSet;
    if (ch.startsWith("dm:")) {
      targetSet = new Set(
        ch
          .slice(3)
          .split(":")
          .map((p) => (p || "").trim().toLowerCase())
          .filter(Boolean)
      );
    } else {
      const grp = chatGroups.get(ch);
      targetSet = new Set(
        Array.isArray(grp?.members)
          ? grp.members.map((m) => String(m || "").trim().toLowerCase()).filter(Boolean)
          : []
      );
    }
    for (const u of extraUsernames) {
      const clean = String(u || "").trim().toLowerCase();
      if (clean) targetSet.add(clean);
    }
    for (const [, client] of liveClients.entries()) {
      const verifiedU = client.verifiedUsername;
      if (verifiedU && targetSet.has(verifiedU)) {
        try {
          client.res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
        } catch {}
      }
    }
    return;
  }
  broadcastToClients(eventPayload, "all");
}

app.post("/api/chat/send", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const { message } = req.body || {};
    const cleanText = String(message?.text || "").trim().slice(0, 2000);
    const rawGifUrl = typeof message?.gifUrl === "string" ? message.gifUrl.trim() : "";
    const hasValidGif = Boolean(rawGifUrl && isAllowedKlipyMediaUrl(rawGifUrl));

    if (rawGifUrl && !hasValidGif) {
      return res.status(400).json({ success: false, error: "Only valid KLIPY HTTPS GIF URLs are allowed" });
    }
    if (!message || !message.author || !message.channel || (!cleanText && !hasValidGif)) {
      return res.status(400).json({ success: false, error: "Invalid message" });
    }

    const authorName = authUser ? authUser.username : String(message.author).trim().slice(0, 40);
    const authorKey = authorName.toLowerCase();

    const activeTimeout = getActiveTimeout(authorKey);
    if (activeTimeout) {
      const remMsg =
        activeTimeout.until === -1
          ? "You are muted in chat by staff"
          : `You are timed out in chat for ${Math.max(1, Math.ceil((Number(activeTimeout.until) - Date.now()) / 60000))}m`;
      return res.status(403).json({
        success: false,
        timedOut: true,
        until: activeTimeout.until,
        error: activeTimeout.reason ? `${remMsg}: ${activeTimeout.reason}` : remMsg,
      });
    }

    const authorProf = userProfiles.get(authorKey);
    const authorCustom = authorProf?.customization || null;
    const authorRole = getUserChatRole(authorName);

    let cleanReplyTo = null;
    if (message?.replyTo && typeof message.replyTo === "object") {
      const rid = String(message.replyTo.id || "").trim().slice(0, 80);
      const rauthor = String(message.replyTo.author || "").trim().slice(0, 40);
      if (rid && rauthor) {
        cleanReplyTo = {
          id: rid,
          author: rauthor,
          text: String(message.replyTo.text || "").trim().slice(0, 200),
          hasGif: Boolean(message.replyTo.hasGif),
        };
      }
    }

    const sanitizedMsg = {
      ...message,
      author: authorName,
      role: authorRole,
      ...(authorCustom
        ? {
            customization: authorCustom,
            ...(authorCustom.avatarColor ? { avatarColor: authorCustom.avatarColor } : {}),
          }
        : {}),
      text: cleanText,
      ...(hasValidGif
        ? {
            gifUrl: rawGifUrl,
            gifTitle: typeof message?.gifTitle === "string" ? message.gifTitle.trim().slice(0, 120) : "GIF",
          }
        : {}),
      ...(cleanReplyTo ? { replyTo: cleanReplyTo } : {}),
      channel: String(message.channel).trim().slice(0, 120),
    };
    if (!cleanReplyTo) delete sanitizedMsg.replyTo;

    // Enforce authenticated sender & CloudSync validation for private DMs
    if (sanitizedMsg.channel.startsWith("dm:")) {
      if (!authUser) {
        return res.status(401).json({ success: false, error: "Sign in to CloudSync to send private DMs" });
      }
      const parts = sanitizedMsg.channel.slice(3).split(":").map((p) => (p || "").trim().toLowerCase());
      if (!parts.includes(authUser.username.toLowerCase())) {
        return res.status(403).json({ success: false, error: "Cannot send DM into another user's channel" });
      }
      let csMap = await getCloudSyncUsersMapAsync();
      if (csMap.size > 0) {
        for (const cleanPart of parts) {
          if (!cleanPart || !csMap.has(cleanPart)) {
            csMap = await getCloudSyncUsersMapAsync(true);
            if (!cleanPart || !csMap.has(cleanPart)) {
              return res.status(404).json({
                success: false,
                error: `user "@${cleanPart}" does not exist in cloudsync`,
              });
            }
          }
        }
      }
    } else if (sanitizedMsg.channel.startsWith("group:")) {
      if (!authUser) {
        return res.status(401).json({ success: false, error: "Sign in to CloudSync to send group chat messages" });
      }
      const grp = chatGroups.get(sanitizedMsg.channel);
      if (!grp) {
        return res.status(404).json({ success: false, error: "Group chat not found" });
      }
      if (!grp.members.includes(authUser.username.toLowerCase())) {
        return res.status(403).json({ success: false, error: "You are not a member of this group chat" });
      }
    }

    touchKnownUser(sanitizedMsg.author);

    if (sanitizedMsg.text) {
      const mod = await moderateTextWithOpenAI(sanitizedMsg.text);
      if (mod.flagged) {
        return res.status(400).json({
          success: false,
          flagged: true,
          category: mod.category,
          error: mod.reason || "Message blocked by moderation",
        });
      }
    }

    chatHistory.push(sanitizedMsg);
    if (chatHistory.length > 500) chatHistory.shift();
    persistChatHistory();

    // Broadcast via SSE to connected clients
    const eventPayload = {
      type: "chat-event",
      event: "NEW_MESSAGE",
      message: sanitizedMsg,
    };

    broadcastChatPayload(sanitizedMsg.channel, eventPayload);

    res.json({ success: true, message: sanitizedMsg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/edit", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync to edit messages" });
    }

    const messageId = String(req.body?.messageId || "").trim();
    const cleanText = String(req.body?.text || "").trim().slice(0, 2000);
    if (!messageId) {
      return res.status(400).json({ success: false, error: "messageId required" });
    }

    const activeTimeout = getActiveTimeout(authUser.username);
    if (activeTimeout) {
      return res.status(403).json({
        success: false,
        timedOut: true,
        until: activeTimeout.until,
        error: "You cannot edit messages while timed out",
      });
    }

    const idx = chatHistory.findIndex((m) => m.id === messageId);
    if (idx < 0) {
      return res.status(404).json({ success: false, error: "Message not found" });
    }
    const targetMsg = chatHistory[idx];
    if (String(targetMsg.author || "").toLowerCase() !== authUser.username.toLowerCase()) {
      return res.status(403).json({ success: false, error: "You can only edit your own messages" });
    }
    if (!cleanText && !targetMsg.gifUrl) {
      return res.status(400).json({ success: false, error: "Edited message cannot be empty" });
    }

    if (cleanText) {
      const mod = await moderateTextWithOpenAI(cleanText);
      if (mod.flagged) {
        return res.status(400).json({
          success: false,
          flagged: true,
          category: mod.category,
          error: mod.reason || "Edited message blocked by moderation",
        });
      }
    }

    const editedAt = Date.now();
    chatHistory[idx] = {
      ...targetMsg,
      text: cleanText,
      edited: true,
      editedAt,
    };
    persistChatHistory();

    broadcastChatPayload(targetMsg.channel, {
      type: "chat-event",
      event: "MESSAGE_EDITED",
      messageId,
      channel: targetMsg.channel,
      text: cleanText,
      edited: true,
      editedAt,
    });

    res.json({ success: true, message: chatHistory[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/delete-chat", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const actor = await getModActor(req);
    const channel = String(req.body?.channel || "").trim().slice(0, 120);
    if (!channel) {
      return res.status(400).json({ success: false, error: "channel required" });
    }

    let extraBroadcastMembers = [];
    if (channel.startsWith("dm:")) {
      if (!actor.usernameLower) {
        return res.status(401).json({ success: false, error: "Sign in to CloudSync to delete a DM chat" });
      }
      const parts = channel
        .slice(3)
        .split(":")
        .map((p) => (p || "").trim().toLowerCase())
        .filter(Boolean);
      if (!parts.includes(actor.usernameLower)) {
        return res.status(403).json({ success: false, error: "You can only delete your own DM chats" });
      }
    } else if (channel.startsWith("group:")) {
      if (!actor.usernameLower) {
        return res.status(401).json({ success: false, error: "Sign in to CloudSync to delete a group chat" });
      }
      const grp = chatGroups.get(channel);
      if (!grp) {
        return res.status(404).json({ success: false, error: "Group chat not found" });
      }
      const isCreator = grp.creator.toLowerCase() === actor.usernameLower;
      if (!isCreator && !actor.isOwner) {
        return res.status(403).json({
          success: false,
          error: "Only the group creator or site owner can delete this group chat",
        });
      }
      extraBroadcastMembers = Array.isArray(grp.members) ? [...grp.members] : [];
      chatGroups.delete(channel);
      persistChatGroups();
    } else if (!actor.isMod) {
      return res.status(403).json({
        success: false,
        error: "Only owners or staff moderators can delete a public channel chat",
      });
    }

    let removed = 0;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i]?.channel === channel) {
        chatHistory.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) persistChatHistory();

    broadcastChatPayload(
      channel,
      {
        type: "chat-event",
        event: "CHANNEL_CLEARED",
        channel,
        deletedChat: true,
        by: actor.username || "staff",
      },
      extraBroadcastMembers
    );
    if (channel.startsWith("group:")) {
      broadcastChatPayload(
        channel,
        {
          type: "chat-event",
          event: "GROUP_DELETED",
          groupId: channel,
          by: actor.username || "staff",
        },
        extraBroadcastMembers
      );
    }

    res.json({ success: true, channel, removed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Group Chat Management & Emoji Reactions ---
app.post("/api/chat/groups/create", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync to create a group chat" });
    }
    const creatorLower = authUser.username.toLowerCase();
    const cleanName = String(req.body?.name || "").trim().slice(0, 32);
    if (!cleanName) {
      return res.status(400).json({ success: false, error: "Group name is required" });
    }
    const rawMembers = Array.isArray(req.body?.members) ? req.body.members : [];
    const memberSet = new Set([creatorLower]);
    for (const m of rawMembers) {
      const cleanM = String(m || "").trim().replace(/^@/, "").toLowerCase();
      if (cleanM) memberSet.add(cleanM);
      if (memberSet.size >= 20) break;
    }
    if (memberSet.size < 2) {
      return res.status(400).json({ success: false, error: "Add at least 1 other user to start a group chat" });
    }

    let csMap = await getCloudSyncUsersMapAsync();
    if (csMap.size > 0) {
      for (const m of memberSet) {
        if (!csMap.has(m)) {
          csMap = await getCloudSyncUsersMapAsync(true);
          if (!csMap.has(m)) {
            return res.status(404).json({
              success: false,
              error: `user "@${m}" does not exist in cloudsync`,
            });
          }
        }
      }
    }

    const groupId = `group:gc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const groupObj = {
      id: groupId,
      name: cleanName,
      creator: authUser.username,
      members: Array.from(memberSet),
      createdAt: Date.now(),
    };
    chatGroups.set(groupId, groupObj);
    persistChatGroups();

    broadcastChatPayload(groupId, {
      type: "chat-event",
      event: "GROUP_UPDATED",
      group: groupObj,
    });

    res.json({ success: true, group: groupObj });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/groups/members", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync first" });
    }
    const actorLower = authUser.username.toLowerCase();
    const isOwner = OWNER_USERNAMES.has(actorLower);
    const groupId = String(req.body?.groupId || "").trim();
    const action = String(req.body?.action || "").trim().toLowerCase();
    const targetUsername = String(req.body?.username || "").trim().replace(/^@/, "").toLowerCase();
    const nextName = String(req.body?.name || "").trim().slice(0, 32);

    const grp = chatGroups.get(groupId);
    if (!grp) {
      return res.status(404).json({ success: false, error: "Group chat not found" });
    }
    if (!grp.members.includes(actorLower) && !isOwner) {
      return res.status(403).json({ success: false, error: "You are not a member of this group chat" });
    }

    const previousMembers = [...grp.members];
    const isCreator = grp.creator.toLowerCase() === actorLower;

    if (action === "leave") {
      grp.members = grp.members.filter((m) => m !== actorLower);
      if (grp.members.length === 0) {
        chatGroups.delete(groupId);
        for (let i = chatHistory.length - 1; i >= 0; i--) {
          if (chatHistory[i]?.channel === groupId) chatHistory.splice(i, 1);
        }
        persistChatHistory();
        persistChatGroups();
        broadcastChatPayload(
          groupId,
          { type: "chat-event", event: "GROUP_DELETED", groupId, by: authUser.username },
          previousMembers
        );
        return res.json({ success: true, deleted: true, groupId });
      }
      if (grp.creator.toLowerCase() === actorLower && grp.members[0]) {
        grp.creator = grp.members[0];
      }
    } else if (action === "rename") {
      if (!nextName) return res.status(400).json({ success: false, error: "Group name required" });
      grp.name = nextName;
    } else if (action === "add") {
      if (!targetUsername) return res.status(400).json({ success: false, error: "username required" });
      if (grp.members.length >= 20) return res.status(400).json({ success: false, error: "Group limit is 20 members" });
      let csMap = await getCloudSyncUsersMapAsync();
      if (csMap.size > 0 && !csMap.has(targetUsername)) {
        csMap = await getCloudSyncUsersMapAsync(true);
        if (!csMap.has(targetUsername)) {
          return res.status(404).json({ success: false, error: `user "@${targetUsername}" does not exist in cloudsync` });
        }
      }
      if (!grp.members.includes(targetUsername)) {
        grp.members = [...grp.members, targetUsername];
      }
    } else if (action === "remove") {
      if (!targetUsername) return res.status(400).json({ success: false, error: "username required" });
      if (!isCreator && !isOwner) {
        return res.status(403).json({ success: false, error: "Only the group creator can remove members" });
      }
      if (targetUsername === grp.creator.toLowerCase()) {
        return res.status(400).json({ success: false, error: "Cannot remove group creator" });
      }
      grp.members = grp.members.filter((m) => m !== targetUsername);
    } else {
      return res.status(400).json({ success: false, error: "Unsupported group action" });
    }

    chatGroups.set(groupId, grp);
    persistChatGroups();

    broadcastChatPayload(
      groupId,
      { type: "chat-event", event: "GROUP_UPDATED", group: grp },
      previousMembers
    );
    res.json({ success: true, group: grp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/react", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync to react to messages" });
    }
    const actorLower = authUser.username.toLowerCase();
    const activeTimeout = getActiveTimeout(actorLower);
    if (activeTimeout) {
      return res.status(403).json({
        success: false,
        timedOut: true,
        until: activeTimeout.until,
        error: "You cannot react to messages while timed out",
      });
    }

    const messageId = String(req.body?.messageId || "").trim();
    const emoji = String(req.body?.emoji || "").trim().slice(0, 16);
    if (!messageId || !emoji) {
      return res.status(400).json({ success: false, error: "messageId and emoji are required" });
    }

    const idx = chatHistory.findIndex((m) => m.id === messageId);
    if (idx < 0) {
      return res.status(404).json({ success: false, error: "Message not found" });
    }
    const targetMsg = chatHistory[idx];
    if (!canAccessChatChannel(targetMsg.channel, actorLower)) {
      return res.status(403).json({ success: false, error: "You do not have access to react to this message" });
    }

    const nextReactions =
      targetMsg.reactions && typeof targetMsg.reactions === "object"
        ? { ...targetMsg.reactions }
        : {};
    const existingUsers = Array.isArray(nextReactions[emoji]) ? [...nextReactions[emoji]] : [];
    const userIdx = existingUsers.indexOf(actorLower);
    if (userIdx >= 0) {
      existingUsers.splice(userIdx, 1);
      if (existingUsers.length === 0) {
        delete nextReactions[emoji];
      } else {
        nextReactions[emoji] = existingUsers;
      }
    } else {
      if (Object.keys(nextReactions).length >= 24) {
        return res.status(400).json({ success: false, error: "Reaction limit reached on this message" });
      }
      existingUsers.push(actorLower);
      nextReactions[emoji] = existingUsers;
    }

    chatHistory[idx] = {
      ...targetMsg,
      reactions: nextReactions,
    };
    persistChatHistory();

    broadcastChatPayload(targetMsg.channel, {
      type: "chat-event",
      event: "MESSAGE_REACTED",
      messageId,
      channel: targetMsg.channel,
      reactions: nextReactions,
    });

    res.json({ success: true, messageId, reactions: nextReactions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Staff Moderator Selection & Chat Moderation Endpoints ---
app.get("/api/chat/staff", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const actor = await getModActor(req);
  const csMap = await getCloudSyncUsersMapAsync().catch(() => new Map());
  const registeredUsers = Array.from(csMap.values()).map((u) => u.username);

  const timeoutsList = [];
  if (actor.isMod) {
    for (const [uname, t] of chatTimeouts.entries()) {
      if (t && (t.until === -1 || Number(t.until) > Date.now())) {
        timeoutsList.push({
          username: csMap.get(uname)?.username || uname,
          until: t.until,
          reason: t.reason || "",
          by: t.by || "",
        });
      }
    }
  }

  res.json({
    success: true,
    owners: getCanonicalOwnerUsers(csMap),
    staffMods: getCanonicalStaffMods(csMap),
    goatUsers: getCanonicalGoatUsers(csMap),
    registeredUsers,
    timeouts: timeoutsList,
    actorRole: actor.role,
  });
});

app.post("/api/chat/staff", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const actor = await getModActor(req);
    if (!actor.isOwner) {
      return res.status(403).json({
        success: false,
        error: "Only the site owner can appoint or remove staff moderators",
      });
    }

    const rawUsername = String(req.body?.username || "").trim().replace(/^@/, "");
    const action = req.body?.action === "remove" ? "remove" : "add";
    if (!rawUsername || rawUsername.length > 40) {
      return res.status(400).json({ success: false, error: "Valid username required" });
    }

    const key = rawUsername.toLowerCase();
    if (OWNER_USERNAMES.has(key)) {
      return res.status(400).json({ success: false, error: `@${rawUsername} is already an owner` });
    }

    let csMap = await getCloudSyncUsersMapAsync();
    if (action === "add") {
      if (csMap.size > 0 && !csMap.has(key)) {
        csMap = await getCloudSyncUsersMapAsync(true);
      }
      if (csMap.size > 0 && !csMap.has(key) && !knownUsers.has(key)) {
        return res.status(404).json({
          success: false,
          error: `User "@${rawUsername}" not found in CloudSync`,
        });
      }
      staffModerators.add(key);
    } else {
      staffModerators.delete(key);
    }

    persistStaffMods();
    const nextRole = getUserChatRole(rawUsername);
    for (let i = 0; i < chatHistory.length; i++) {
      if (String(chatHistory[i]?.author || "").toLowerCase() === key) {
        chatHistory[i] = { ...chatHistory[i], role: nextRole };
      }
    }
    persistChatHistory();

    const canonicalMods = getCanonicalStaffMods(csMap);
    const canonicalOwners = getCanonicalOwnerUsers(csMap);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    broadcastToClients(
      {
        type: "chat-event",
        event: "STAFF_UPDATED",
        staffMods: canonicalMods,
        ownerUsers: canonicalOwners,
        targetUsername: csMap.get(key)?.username || rawUsername,
        role: nextRole,
      },
      "all"
    );

    res.json({
      success: true,
      staffMods: canonicalMods,
      targetUsername: csMap.get(key)?.username || rawUsername,
      role: nextRole,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Moderators & owners can grant or revoke the golden GOAT title for good feature/idea suggestions
app.post("/api/chat/mod/goat", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const actor = await getModActor(req);
    if (!actor.isMod) {
      return res.status(403).json({
        success: false,
        error: "Only staff moderators or site owners can award or remove the GOAT title",
      });
    }

    const rawUsername = String(req.body?.username || "").trim().replace(/^@/, "");
    if (!rawUsername || rawUsername.length > 40) {
      return res.status(400).json({ success: false, error: "Valid username required" });
    }

    const key = rawUsername.toLowerCase();
    let csMap = await getCloudSyncUsersMapAsync();
    if (csMap.size > 0 && !csMap.has(key)) {
      csMap = await getCloudSyncUsersMapAsync(true);
    }
    if (csMap.size > 0 && !csMap.has(key) && !knownUsers.has(key)) {
      return res.status(404).json({
        success: false,
        error: `User "@${rawUsername}" not found in CloudSync`,
      });
    }

    const shouldGrant =
      typeof req.body?.granted === "boolean"
        ? req.body.granted
        : req.body?.action === "remove"
        ? false
        : req.body?.action === "add"
        ? true
        : !goatUsers.has(key);

    if (shouldGrant) {
      goatUsers.add(key);
    } else {
      goatUsers.delete(key);
    }

    persistGoatUsers();

    const canonicalTarget = csMap.get(key)?.username || rawUsername;
    const canonicalGoats = getCanonicalGoatUsers(csMap);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    broadcastToClients(
      {
        type: "chat-event",
        event: "GOAT_UPDATED",
        goatUsers: canonicalGoats,
        targetUsername: canonicalTarget,
        granted: shouldGrant,
        by: actor.username,
      },
      "all"
    );

    res.json({
      success: true,
      goatUsers: canonicalGoats,
      targetUsername: canonicalTarget,
      granted: shouldGrant,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/mod/delete-message", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const actor = await getModActor(req);
    const messageId = String(req.body?.messageId || "").trim();
    if (!messageId) {
      return res.status(400).json({ success: false, error: "messageId required" });
    }

    const idx = chatHistory.findIndex((m) => m.id === messageId);
    const targetMsg = idx >= 0 ? chatHistory[idx] : null;
    const isAuthor =
      Boolean(targetMsg && actor.usernameLower && targetMsg.author?.toLowerCase() === actor.usernameLower);

    if (!actor.isMod && !isAuthor) {
      return res.status(403).json({
        success: false,
        error: "Only staff moderators or the message author can delete this message",
      });
    }
    if (targetMsg && (targetMsg.channel?.startsWith("dm:") || targetMsg.channel?.startsWith("group:")) && !isAuthor) {
      return res.status(403).json({ success: false, error: "Cannot delete private DM or group messages" });
    }

    if (idx >= 0) {
      chatHistory.splice(idx, 1);
      persistChatHistory();
    }

    broadcastChatPayload(targetMsg?.channel || "", {
      type: "chat-event",
      event: "MESSAGE_DELETED",
      messageId,
      channel: targetMsg?.channel || "",
      by: actor.username || "staff",
    });
    res.json({ success: true, messageId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/mod/clear-channel", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const actor = await getModActor(req);
    if (!actor.isMod) {
      return res.status(403).json({ success: false, error: "Staff moderator permissions required" });
    }
    const channel = String(req.body?.channel || "").trim();
    const targetUsername = String(req.body?.targetUsername || "").trim().replace(/^@/, "");
    const targetLower = targetUsername.toLowerCase();

    if (!channel && !targetLower) {
      return res.status(400).json({ success: false, error: "channel or targetUsername required" });
    }
    if (channel.startsWith("dm:") || channel.startsWith("group:")) {
      return res.status(403).json({ success: false, error: "Cannot purge DM or group channels" });
    }

    let removed = 0;
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      const m = chatHistory[i];
      if (!m || String(m.channel || "").startsWith("dm:") || String(m.channel || "").startsWith("group:")) continue;
      const matchesChan = !channel || m.channel === channel;
      const matchesUser = !targetLower || String(m.author || "").toLowerCase() === targetLower;
      if (matchesChan && matchesUser) {
        chatHistory.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) persistChatHistory();

    broadcastToClients(
      {
        type: "chat-event",
        event: "CHANNEL_CLEARED",
        channel,
        targetUsername,
        by: actor.username || "staff",
      },
      "all"
    );
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/mod/timeout", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const actor = await getModActor(req);
    if (!actor.isMod) {
      return res.status(403).json({ success: false, error: "Staff moderator permissions required" });
    }
    const targetUsername = String(req.body?.username || "").trim().replace(/^@/, "");
    const targetKey = targetUsername.toLowerCase();
    if (!targetKey) {
      return res.status(400).json({ success: false, error: "username required" });
    }
    if (OWNER_USERNAMES.has(targetKey)) {
      return res.status(403).json({ success: false, error: "Cannot timeout the site owner" });
    }
    if (staffModerators.has(targetKey) && !actor.isOwner) {
      return res.status(403).json({ success: false, error: "Only the owner can timeout another moderator" });
    }

    const durationMinutes = Number(req.body?.durationMinutes ?? 5);
    const reason = String(req.body?.reason || "").trim().slice(0, 140);

    let entry = null;
    if (durationMinutes === 0) {
      chatTimeouts.delete(targetKey);
    } else {
      const until = durationMinutes < 0 ? -1 : Date.now() + Math.min(43200, durationMinutes) * 60 * 1000;
      entry = {
        until,
        reason,
        by: actor.username || "staff",
        updatedAt: new Date().toISOString(),
      };
      chatTimeouts.set(targetKey, entry);
    }
    persistChatTimeouts();

    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    broadcastToClients(
      {
        type: "chat-event",
        event: "MOD_UPDATE",
        action: durationMinutes === 0 ? "unmute" : "timeout",
        username: targetUsername,
        until: entry ? entry.until : 0,
        reason,
        by: actor.username || "staff",
      },
      "all"
    );

    res.json({
      success: true,
      username: targetUsername,
      until: entry ? entry.until : 0,
      reason,
    });
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
const MAX_PUBLISHED_STUDIO_GAMES = 60;
const MAX_CUSTOM_HTML_BYTES = 2 * 1024 * 1024;

app.get("/api/studio/games", (_req, res) => {
  res.json({ success: true, games: publishedStudioGames });
});

app.post("/api/studio/games", async (req, res) => {
  try {
    const { game } = req.body || {};
    if (!game || !game.title || !game.author) {
      return res.status(400).json({ success: false, error: "Missing game title or author" });
    }
    if (
      typeof game.customHtmlContent === "string" &&
      Buffer.byteLength(game.customHtmlContent, "utf-8") > MAX_CUSTOM_HTML_BYTES
    ) {
      return res.status(413).json({
        success: false,
        error: "Custom HTML file exceeds 2MB server memory limit",
      });
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
      while (publishedStudioGames.length > MAX_PUBLISHED_STUDIO_GAMES) {
        publishedStudioGames.pop();
      }
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
  res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-pointer-lock allow-popups allow-forms");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(found.customHtmlContent);
});

// --- CloudSync Player Progress & Telemetry Tracking per Studio Game ---
const studioCloudProgress = new Map(); // gameId -> Map<usernameLower, ProgressRecord>
const MAX_PROGRESS_GAMES = 120;
const MAX_PROGRESS_PLAYERS_PER_GAME = 250;

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
      if (studioCloudProgress.size >= MAX_PROGRESS_GAMES) {
        const oldestKey = studioCloudProgress.keys().next().value;
        if (oldestKey) studioCloudProgress.delete(oldestKey);
      }
      studioCloudProgress.set(gameId, new Map());
    }
    const gameMap = studioCloudProgress.get(gameId);
    if (!gameMap.has(userKey) && gameMap.size >= MAX_PROGRESS_PLAYERS_PER_GAME) {
      const oldestUser = gameMap.keys().next().value;
      if (oldestUser) gameMap.delete(oldestUser);
    }
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

// --- Per-Game Playtime & Score Leaderboards API (Games Only — No Websites) ---
const gameLeaderboards = new Map(); // gameKey -> Map<usernameLower, { username, seconds, plays, highScore, lastPlayed }>

const SERVER_NON_GAME_PATTERNS = [
  /^https?:\/\//i,
  /^www\./i,
  /\.(com|org|net|edu|gov|mil|co|uk|ca|de|jp|fr|au|ru|ch|it|nl|se|no|es|me|tv|gg|ai|app|dev|xyz)(\/|$|\s)/i,
  /^(new tab|untitled|fetching data\.\.\.|fetching lesson\.\.\.|about:blank|operation cookie|browsing|global|cloudplay 2p party)$/i,
  /\b(duckduckgo|google|bing|yahoo|youtube|tiktok|discord|soundcloud|spotify|netflix|reddit|instagram|twitter|x\.com|snapchat|pinterest|crunchyroll|wikipedia|github|twitch)\b/i,
];

function isWebsiteNotGameServer(rawName) {
  const s = ((rawName || "") + "").trim().toLowerCase();
  if (!s || s.length > 80) return true;
  if (/\b(1v1\.lol|[a-z0-9-]+\.io)\b/i.test(s) && !/^https?:\/\//i.test(s)) {
    return false;
  }
  return SERVER_NON_GAME_PATTERNS.some((re) => re.test(s));
}

app.get("/api/games/leaderboard", (req, res) => {
  const gameKey = ((req.query.game || "") + "").trim().toLowerCase();
  if (!gameKey || isWebsiteNotGameServer(gameKey)) {
    return res.json({ success: true, game: gameKey, entries: [], activePlayers: [] });
  }
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
    const gameKey = ((game || "") + "").trim().toLowerCase();
    if (!gameKey || isWebsiteNotGameServer(gameKey)) {
      return res.json({ success: true, entries: [] });
    }
    const cleanUser = ((username || "guest") + "").trim();
    const userKey = cleanUser.toLowerCase();

    if (!gameLeaderboards.has(gameKey)) {
      if (gameLeaderboards.size >= 300) {
        const oldestKey = gameLeaderboards.keys().next().value;
        if (oldestKey) gameLeaderboards.delete(oldestKey);
      }
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

    const authUser = await getAuthenticatedCloudSyncUser(req);
    const payload = {
      type: "admin-chaos",
      trollEventId,
      action,
      data: {
        ...(data || {}),
        trollEventId,
        fromShopUser: authUser ? authUser.username : (sender || "Someone"),
      },
      timestamp: Date.now(),
    };

    const normTarget = (targetUsername || "").trim().toLowerCase().replace(/[-_]/g, "");
    const cloudUser = targetUsername ? await getCloudSyncUserAsync(targetUsername) : null;
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

// --- Cookie Master ($2/mo Subscription) & Ko-fi Checkout / Webhook Integration ---
const KOFI_USERNAME = (process.env.KOFI_USERNAME || "").trim().replace(/^@+/, "");
const KOFI_CHECKOUT_URL = (
  process.env.KOFI_CHECKOUT_URL ||
  process.env.KOFI_PRODUCT_URL ||
  (KOFI_USERNAME ? `https://ko-fi.com/${encodeURIComponent(KOFI_USERNAME)}/tiers` : "")
).trim();
const KOFI_VERIFICATION_TOKEN = (process.env.KOFI_VERIFICATION_TOKEN || "").trim();
const KOFI_TIER_NAME = (process.env.KOFI_TIER_NAME || "").trim();
const KOFI_SUB_DURATION_MS = 33 * 24 * 60 * 60 * 1000; // 31 days + 2 day renewal grace
const KOFI_SUBS_FILE = path.join(__dirname, "data", "kofi-subscriptions.json");

let kofiSubscriptionsCache = null;

function loadKofiSubscriptions() {
  if (Array.isArray(kofiSubscriptionsCache)) return kofiSubscriptionsCache;
  try {
    if (fs.existsSync(KOFI_SUBS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(KOFI_SUBS_FILE, "utf-8"));
      if (Array.isArray(parsed)) {
        kofiSubscriptionsCache = parsed;
        return kofiSubscriptionsCache;
      }
    }
  } catch (e) {
    console.warn("Ko-fi subscriptions load warning:", e.message);
  }
  kofiSubscriptionsCache = [];
  return kofiSubscriptionsCache;
}

function saveKofiSubscriptions(list) {
  kofiSubscriptionsCache = list;
  try {
    const dir = path.dirname(KOFI_SUBS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(KOFI_SUBS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (e) {
    console.warn("Ko-fi subscriptions save warning:", e.message);
  }
}

function extractPossibleUsername(text) {
  const clean = String(text || "").trim();
  if (!clean) return "";
  const atMatch = clean.match(/@([a-zA-Z0-9_.-]{2,32})/);
  if (atMatch?.[1]) return atMatch[1].toLowerCase();
  const singleWord = clean.match(/^([a-zA-Z0-9_.-]{2,32})$/);
  return singleWord?.[1] ? singleWord[1].toLowerCase() : "";
}

async function persistKofiSubscriptionRecord(record) {
  const list = loadKofiSubscriptions();
  const idx = list.findIndex(
    (r) => String(r.transactionId || "").toLowerCase() === record.transactionId.toLowerCase(),
  );
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...record };
  } else {
    list.push(record);
  }
  saveKofiSubscriptions(list);

  if (USE_SUPABASE_CLOUDSYNC) {
    try {
      const { ok, status, text } = await supabaseRest("kofi_subscriptions?on_conflict=transaction_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          transaction_id: record.transactionId,
          email_lower: record.emailLower,
          from_name_lower: record.fromNameLower,
          message_username_lower: record.messageUsernameLower,
          claimed_username_lower: record.claimedUsernameLower || "",
          tier_name: record.tierName,
          amount: Number(record.amount) || 2,
          verified_at: new Date(record.verifiedAt).toISOString(),
          expires_at: new Date(record.expiresAt).toISOString(),
        }),
      });
      if (!ok) {
        console.warn(`Supabase kofi_subscriptions upsert failed (${status}): ${text}`);
      }
    } catch (e) {
      console.warn("Supabase kofi_subscriptions upsert error:", e.message);
    }
  }
}

async function findActiveKofiSubscription({ query = "", username = "" }) {
  const qLower = String(query || "").trim().toLowerCase();
  const userLower = String(username || "").trim().toLowerCase();
  const now = Date.now();

  const matchesRecord = (r) => {
    const exp = typeof r.expiresAt === "number" ? r.expiresAt : Date.parse(r.expires_at || "") || 0;
    if (exp <= now) return false;
    const tx = String(r.transactionId || r.transaction_id || "").toLowerCase();
    const em = String(r.emailLower || r.email_lower || "").toLowerCase();
    const msgUser = String(r.messageUsernameLower || r.message_username_lower || "").toLowerCase();
    const fromUser = String(r.fromNameLower || r.from_name_lower || "").toLowerCase();
    const claimedUser = String(r.claimedUsernameLower || r.claimed_username_lower || "").toLowerCase();

    if (qLower && (tx === qLower || em === qLower)) return true;
    if (
      userLower &&
      (claimedUser === userLower || msgUser === userLower || fromUser === userLower)
    ) {
      return true;
    }
    return false;
  };

  if (USE_SUPABASE_CLOUDSYNC && (qLower || userLower)) {
    try {
      const quotePgVal = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      const filters = [];
      if (qLower) {
        const enc = encodeURIComponent(quotePgVal(qLower));
        filters.push(`transaction_id.ilike.${enc}`, `email_lower.eq.${enc}`);
      }
      if (userLower) {
        const encU = encodeURIComponent(quotePgVal(userLower));
        filters.push(
          `claimed_username_lower.eq.${encU}`,
          `message_username_lower.eq.${encU}`,
          `from_name_lower.eq.${encU}`,
        );
      }
      const { ok, json } = await supabaseRest(
        `kofi_subscriptions?or=(${filters.join(",")})&order=expires_at.desc&limit=5`,
      );
      if (ok && Array.isArray(json)) {
        const match = json.find(matchesRecord);
        if (match) {
          return {
            transactionId: String(match.transaction_id),
            emailLower: String(match.email_lower || ""),
            fromNameLower: String(match.from_name_lower || ""),
            messageUsernameLower: String(match.message_username_lower || ""),
            claimedUsernameLower: String(match.claimed_username_lower || ""),
            tierName: String(match.tier_name || "Cookie Master"),
            amount: Number(match.amount) || 2,
            verifiedAt: Date.parse(match.verified_at) || now,
            expiresAt: Date.parse(match.expires_at) || now + KOFI_SUB_DURATION_MS,
          };
        }
      }
    } catch {}
  }

  const localMatches = loadKofiSubscriptions()
    .filter(matchesRecord)
    .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
  return localMatches[0] || null;
}

app.get("/api/cookie-master/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({
    configured: Boolean(KOFI_CHECKOUT_URL),
    checkoutUrl: KOFI_CHECKOUT_URL,
    hasWebhookVerification: Boolean(KOFI_VERIFICATION_TOKEN),
    priceMonthly: 2,
    dailyCoins: 1000,
    tierName: KOFI_TIER_NAME || "Cookie Master",
  });
});

async function handleKofiWebhook(req, res) {
  try {
    const rawData = req.body?.data;
    const payload =
      typeof rawData === "string"
        ? JSON.parse(rawData)
        : rawData && typeof rawData === "object"
          ? rawData
          : req.body;

    if (!payload || typeof payload !== "object") {
      return res.status(400).send("Invalid Ko-fi webhook payload");
    }

    if (!KOFI_VERIFICATION_TOKEN) {
      return res.status(503).send("KOFI_VERIFICATION_TOKEN not configured");
    }

    if (payload.verification_token !== KOFI_VERIFICATION_TOKEN) {
      return res.status(401).send("Unauthorized: Invalid Ko-fi verification token");
    }

    const type = String(payload.type || "");
    const isSub = payload.is_subscription_payment === true || type === "Subscription";
    const amountNum = Number(payload.amount || 0);
    const tierName = String(payload.tier_name || "").trim();

    if (!isSub || amountNum < 1.75) {
      return res.status(200).send("Ignored non-subscription or lower-tier payment");
    }

    if (
      KOFI_TIER_NAME &&
      tierName &&
      tierName.toLowerCase() !== KOFI_TIER_NAME.toLowerCase()
    ) {
      return res.status(200).send("Ignored different Ko-fi tier");
    }

    const transactionId = String(payload.kofi_transaction_id || payload.message_id || "").trim();
    if (!transactionId) {
      return res.status(400).send("Missing Ko-fi transaction id");
    }

    const emailLower = String(payload.email || "").trim().toLowerCase();
    const fromNameLower = String(payload.from_name || "").trim().toLowerCase();
    const messageUsernameLower = extractPossibleUsername(payload.message);
    const now = Date.now();

    await persistKofiSubscriptionRecord({
      transactionId,
      emailLower,
      fromNameLower,
      messageUsernameLower,
      claimedUsernameLower: messageUsernameLower || "",
      tierName: tierName || "Cookie Master",
      amount: amountNum,
      verifiedAt: now,
      expiresAt: now + KOFI_SUB_DURATION_MS,
    });

    return res.status(200).send("Ko-fi Cookie Master subscription recorded");
  } catch (err) {
    console.error("Ko-fi webhook error:", err);
    return res.status(500).send("Webhook processing error");
  }
}

app.post("/api/kofi/webhook", handleKofiWebhook);
app.post("/api/cookie-master/webhook", handleKofiWebhook);

app.get("/api/cookie-master/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const tx = String(req.query?.tx || "").trim();
    const match = await findActiveKofiSubscription({
      query: tx,
      username: authUser?.username || "",
    });
    if (!match) {
      return res.json({ success: true, active: false });
    }
    return res.json({
      success: true,
      active: true,
      transactionId: match.transactionId,
      email: match.emailLower || "",
      tierName: match.tierName || "Cookie Master",
      expiresAt: match.expiresAt,
    });
  } catch (err) {
    return res.status(500).json({ success: false, active: false, error: err?.message });
  }
});

app.post("/api/cookie-master/verify", async (req, res) => {
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const query = String(req.body?.emailOrCode || req.body?.licenseKey || "").trim();
    if (!query && !authUser?.username) {
      return res.status(400).json({
        success: false,
        active: false,
        error: "Enter your Ko-fi email or transaction ID (or sign in to CloudSync).",
      });
    }

    if (!KOFI_VERIFICATION_TOKEN) {
      return res.status(503).json({
        success: false,
        active: false,
        error: "Server is missing KOFI_VERIFICATION_TOKEN.",
      });
    }

    const match = await findActiveKofiSubscription({
      query,
      username: authUser?.username || "",
    });

    if (!match) {
      return res.status(404).json({
        success: false,
        active: false,
        error:
          "No active Ko-fi Cookie Master membership found yet. Make sure your monthly $2 membership finished and wait a moment for Ko-fi webhook confirmation.",
      });
    }

    if (authUser?.username && match.transactionId) {
      await persistKofiSubscriptionRecord({
        ...match,
        claimedUsernameLower: authUser.username.toLowerCase(),
      }).catch(() => {});
    }

    return res.json({
      success: true,
      active: true,
      transactionId: match.transactionId,
      email: match.emailLower || "",
      tierName: match.tierName || "Cookie Master",
      expiresAt: match.expiresAt,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      active: false,
      error: err?.message || "Failed to verify Ko-fi membership.",
    });
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

const cachedTermsHtml = renderStandaloneLegalHtml("terms");
const cachedPrivacyHtml = renderStandaloneLegalHtml("privacy");

app.get(["/terms", "/terms-of-service"], (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(cachedTermsHtml);
});

app.get(["/privacy", "/privacy-policy"], (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(cachedPrivacyHtml);
});

// =========================================================================
// The Oxium Network (Multi-Site Auth, Sync, Import & Promo Links)
// =========================================================================

function getOxiumRequestOrigin(req) {
  const xfProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const proto = xfProto || req.protocol || "https";
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "").trim();
  return host ? `${proto}://${host}` : "https://operationcookie.com";
}

function getOxiumPartnersMap() {
  const raw = kvGetJson(OXIUM_PARTNERS_KV_KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function getOxiumSyncMap() {
  const raw = kvGetJson(OXIUM_SYNC_KV_KEY, {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function getOxiumPromosList() {
  const raw = kvGetJson(OXIUM_PROMOS_KV_KEY, []);
  return Array.isArray(raw) ? raw : [];
}

function getOxiumSiteUser(req) {
  const headerToken =
    req.headers["x-oxium-token"] ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : null);
  const claims = verifyCloudSyncJwt(headerToken);
  if (
    !claims ||
    claims.typ !== "oxium_site" ||
    !claims.id ||
    !claims.username ||
    !claims.siteId
  ) {
    return null;
  }
  return {
    id: Number(claims.id),
    username: String(claims.username),
    siteId: String(claims.siteId),
  };
}

function isOxiumPreviewAuthorized(req, site, cloudUser) {
  if (!site) return false;
  if (cloudUser && site.ownerUsername && cloudUser.username.toLowerCase() === site.ownerUsername.toLowerCase()) {
    return true;
  }
  const adminKey = req.headers["x-admin-key"] || req.query.adminKey;
  if (adminKey && adminKey === ADMIN_SECRET) return true;
  if (cloudUser && isUserAdminOrOwner(cloudUser.username)) return true;
  return false;
}

function isUserAdminOrOwner(username) {
  const lower = String(username || "").trim().toLowerCase();
  if (!lower) return false;
  if (lower === ADMIN_USERNAME.toLowerCase()) return true;
  const mods = Array.isArray(kvGetJson("staff_moderators_v1", []))
    ? kvGetJson("staff_moderators_v1", []).map((u) => String(u).toLowerCase())
    : [];
  return mods.includes(lower);
}

function checkOxiumSiteOriginAccess(req, site) {
  const reqOrigin = String(req.headers.origin || "").trim();
  if (!reqOrigin) return true;
  if (reqOrigin === getOxiumRequestOrigin(req)) return true;
  return isOriginAllowedForSite(reqOrigin, site);
}

function buildOxiumProfileSummary(username) {
  const profiles = kvGetJson("user_profiles_v2", {});
  const p = profiles && typeof profiles === "object"
    ? profiles[String(username || "").trim().toLowerCase()]
    : null;
  if (!p || typeof p !== "object") return null;
  return {
    displayName: String(p.displayName || username || "").slice(0, 40),
    avatarUrl: typeof p.avatarUrl === "string" ? p.avatarUrl : "",
    avatarDecoration: typeof p.avatarDecoration === "string" ? p.avatarDecoration : "none",
    bannerColor: typeof p.bannerColor === "string" ? p.bannerColor : "#6366f1",
  };
}

function sanitizeOxiumSyncDataPayload(rawObj) {
  if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) return {};
  const clean = {};
  const blockedKeyRe = /(auth_token|auth_user|token|secret|password|admin|cookie_admin|oxium_)/i;
  let count = 0;
  for (const [k, v] of Object.entries(rawObj)) {
    const cleanKey = String(k || "").trim().slice(0, 96);
    if (!cleanKey || blockedKeyRe.test(cleanKey)) continue;
    if (v === undefined || v === null) continue;
    const strVal = typeof v === "string" ? v : JSON.stringify(v);
    if (!strVal || strVal.length > 65536) continue;
    clean[cleanKey] = strVal;
    count++;
    if (count >= 64) break;
  }
  return clean;
}

async function resolveOxiumImportPayload(userId, sourceSlug, targetSiteSlug) {
  const cleanSource = normalizeOxiumSlug(sourceSlug);
  if (!cleanSource) return { source: "", data: {} };
  if (cleanSource === "operation-cookie") {
    const row = await dbGetSyncPayload(userId);
    return {
      source: "operation-cookie",
      data: row?.payload_json ? filterSafeCloudSyncExport(row.payload_json) : {},
    };
  }
  if (cleanSource === targetSiteSlug) {
    return { source: cleanSource, data: {} };
  }
  const syncMap = getOxiumSyncMap();
  const entry = syncMap[`${userId}:${cleanSource}`];
  return {
    source: cleanSource,
    data: entry?.data && typeof entry.data === "object" ? sanitizeOxiumSyncDataPayload(entry.data) : {},
  };
}

function setOxiumCorsHeaders(req, res) {
  const reqOrigin = String(req.headers.origin || "*").trim() || "*";
  res.setHeader("Access-Control-Allow-Origin", reqOrigin === "null" ? "*" : reqOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Oxium-Token, X-Oxium-Setup-Key, X-CloudSync-Token");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

function getOxiumSetupTokenUser(req) {
  const rawKey =
    req.headers["x-oxium-setup-key"] ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : null);
  const claims = verifyCloudSyncJwt(rawKey);
  if (!claims || claims.typ !== "oxium_setup" || !claims.id || !claims.username) {
    return null;
  }
  return {
    id: Number(claims.id),
    username: String(claims.username),
  };
}

async function handleOxiumPartnerRequestSubmission(req, res, { actorUser, isAgentEndpoint = false }) {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestedSlug = normalizeOxiumSlug(body.slug || body.name || "");
    if (!requestedSlug || requestedSlug.length < 2) {
      return res.status(400).json({ success: false, error: "Site name / slug must be at least 2 alphanumeric characters." });
    }
    const name = String(body.name || "").trim();
    if (!name || name.length < 2) {
      return res.status(400).json({ success: false, error: "Site name is required." });
    }
    const sanitizedOrigins = sanitizeOxiumOrigins(body.allowedOrigins || []);
    if (isAgentEndpoint && sanitizedOrigins.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one valid http/https origin in allowedOrigins is required.",
      });
    }
    if (!actorUser && !String(body.contact || "").trim()) {
      return res.status(400).json({
        success: false,
        error: isAgentEndpoint
          ? "Provide a valid X-Oxium-Setup-Key header or include a contact handle/email."
          : "Sign in to CloudSync or enter a contact handle/email.",
      });
    }
    const partners = getOxiumPartnersMap();
    const existing = partners[requestedSlug] || null;
    if (existing) {
      const sameOwner =
        actorUser &&
        existing.ownerUsername &&
        existing.ownerUsername.toLowerCase() === actorUser.username.toLowerCase();
      if (!sameOwner && !isUserAdminOrOwner(actorUser?.username)) {
        return res.status(409).json({
          success: false,
          error: `The slug "${requestedSlug}" is already registered on the Oxium Network.`,
        });
      }
    }
    const nextRecord = sanitizePartnerRecord(
      {
        ...body,
        slug: requestedSlug,
        ownerUsername: existing?.ownerUsername || actorUser?.username || "",
      },
      existing
    );
    if (!existing) {
      nextRecord.status = "pending";
      nextRecord.approvedAt = null;
      nextRecord.rejectReason = "";
    }
    partners[requestedSlug] = nextRecord;
    kvSetJson(OXIUM_PARTNERS_KV_KEY, partners);
    const oxiumOrigin = getOxiumRequestOrigin(req);
    res.json({
      success: true,
      status: nextRecord.status,
      partner: nextRecord,
      oxiumOrigin,
      embedSnippet: `<script src="${oxiumOrigin}/oxium.js" data-site="${nextRecord.slug}"></script>`,
      previewUrl: `${oxiumOrigin}/oxium/auth?site=${encodeURIComponent(nextRecord.slug)}&preview=1`,
      linksUrl: `${oxiumOrigin}/oxium/links/${encodeURIComponent(nextRecord.slug)}`,
      docsUrl: `${oxiumOrigin}/oxium/docs`,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e?.message || "Failed to submit Oxium request" });
  }
}

app.options("/api/oxium/*rest", (req, res) => {
  setOxiumCorsHeaders(req, res);
  res.status(204).end();
});

app.get("/oxium.js", (req, res) => {
  setOxiumCorsHeaders(req, res);
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=120");
  res.send(renderOxiumSdkScript({ oxiumOrigin: getOxiumRequestOrigin(req) }));
});

app.get(["/oxium", "/oxium/"], (_req, res) => {
  res.redirect(302, "/oxium/docs");
});

app.get(["/oxium/docs", "/oxium/docs/", "/oxium/docs.html", "/oxium/guide", "/oxium/guide/", "/oxium/docs.md"], (req, res) => {
  setOxiumCorsHeaders(req, res);
  const oxiumOrigin = getOxiumRequestOrigin(req);
  const accept = String(req.headers.accept || "").toLowerCase();
  const wantsMarkdown =
    req.path.endsWith(".md") ||
    String(req.query.format || "").toLowerCase() === "md" ||
    String(req.query.raw || "") === "1" ||
    (accept.includes("text/markdown") && !accept.includes("text/html"));
  if (wantsMarkdown) {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=120");
    return res.send(renderOxiumDocsMarkdown({ oxiumOrigin }));
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=120");
  res.send(renderOxiumDocsHtml({ oxiumOrigin }));
});

app.get(["/oxium/auth", "/oxium/login/:slug"], async (req, res) => {
  const slug = normalizeOxiumSlug(req.params.slug || req.query.site || "");
  if (!slug) {
    return res.status(400).send("Missing ?site=<slug> parameter.");
  }
  const partners = getOxiumPartnersMap();
  const site = partners[slug];
  if (!site) {
    return res.status(404).send("Oxium partner site not found.");
  }
  const cloudUser = await getAuthenticatedCloudSyncUser(req);
  const wantPreview = String(req.query.preview || "") === "1";
  const isApproved = site.status === "approved";
  const canPreview = wantPreview || isOxiumPreviewAuthorized(req, site, cloudUser);
  if (!isApproved && !canPreview) {
    return res.status(403).send("This Oxium partner integration is pending approval.");
  }
  const oxiumOrigin = getOxiumRequestOrigin(req);
  const rawTargetOrigin = String(req.query.origin || "").trim();
  const validTargetOrigin =
    rawTargetOrigin && (isOriginAllowedForSite(rawTargetOrigin, site) || (wantPreview && rawTargetOrigin === oxiumOrigin))
      ? rawTargetOrigin
      : "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(
    renderOxiumAuthHtml({
      site,
      oxiumOrigin,
      targetOrigin: validTargetOrigin,
      isPreview: !isApproved || wantPreview,
    })
  );
});

app.get(["/oxium/links", "/oxium/links/:slug"], (req, res) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const partners = Object.values(getOxiumPartnersMap());
  const selectedSlug = normalizeOxiumSlug(req.params.slug || req.query.site || "");
  res.send(
    renderOxiumLinksHtml({
      partners,
      selectedSlug,
      oxiumOrigin: getOxiumRequestOrigin(req),
    })
  );
});

app.post("/api/oxium/setup-key", async (req, res) => {
  const cloudUser = await getAuthenticatedCloudSyncUser(req);
  if (!cloudUser) {
    return res.status(401).json({ success: false, error: "Sign in to CloudSync to mint a scoped setup key." });
  }
  const ttlSeconds = 2 * 60 * 60;
  const setupKey = signCloudSyncJwt({
    typ: "oxium_setup",
    id: cloudUser.id,
    username: cloudUser.username,
    nonce: crypto.randomBytes(6).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  res.json({
    success: true,
    setupKey,
    expiresInSeconds: ttlSeconds,
    username: cloudUser.username,
  });
});

app.post("/api/oxium/request", async (req, res) => {
  const cloudUser = await getAuthenticatedCloudSyncUser(req);
  return handleOxiumPartnerRequestSubmission(req, res, {
    actorUser: cloudUser,
    isAgentEndpoint: false,
  });
});

app.post("/api/oxium/agent-request", async (req, res) => {
  setOxiumCorsHeaders(req, res);
  const setupUser = getOxiumSetupTokenUser(req);
  const cloudUser = setupUser ? null : await getAuthenticatedCloudSyncUser(req);
  return handleOxiumPartnerRequestSubmission(req, res, {
    actorUser: setupUser || cloudUser,
    isAgentEndpoint: true,
  });
});

app.get("/api/oxium/my-requests", async (req, res) => {
  const cloudUser = await getAuthenticatedCloudSyncUser(req);
  if (!cloudUser) {
    return res.status(401).json({ success: false, error: "Sign in to view your Oxium partner requests." });
  }
  const partners = Object.values(getOxiumPartnersMap())
    .filter(
      (p) =>
        p &&
        p.ownerUsername &&
        p.ownerUsername.toLowerCase() === cloudUser.username.toLowerCase()
    )
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  res.json({
    success: true,
    partners,
    oxiumOrigin: getOxiumRequestOrigin(req),
  });
});

app.post("/api/oxium/partner/update", async (req, res) => {
  const cloudUser = await getAuthenticatedCloudSyncUser(req);
  if (!cloudUser) {
    return res.status(401).json({ success: false, error: "Sign in required." });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const slug = normalizeOxiumSlug(body.slug || "");
  const partners = getOxiumPartnersMap();
  const existing = partners[slug];
  if (!existing) {
    return res.status(404).json({ success: false, error: "Partner site not found." });
  }
  const isOwner =
    existing.ownerUsername &&
    existing.ownerUsername.toLowerCase() === cloudUser.username.toLowerCase();
  if (!isOwner && !isUserAdminOrOwner(cloudUser.username)) {
    return res.status(403).json({ success: false, error: "You do not own this Oxium partner site." });
  }
  const updated = sanitizePartnerRecord(
    {
      ...existing,
      tagline: body.tagline !== undefined ? body.tagline : existing.tagline,
      description: body.description !== undefined ? body.description : existing.description,
      logoUrl: body.logoUrl !== undefined ? body.logoUrl : existing.logoUrl,
      bannerUrl: body.bannerUrl !== undefined ? body.bannerUrl : existing.bannerUrl,
      accentColor: body.accentColor !== undefined ? sanitizeOxiumColor(body.accentColor) : existing.accentColor,
      allowedOrigins: body.allowedOrigins !== undefined ? sanitizeOxiumOrigins(body.allowedOrigins) : existing.allowedOrigins,
      links: body.links !== undefined ? sanitizeOxiumLinks(body.links, body.allowedOrigins ?? existing.allowedOrigins) : existing.links,
      features: body.features !== undefined ? sanitizeOxiumFeatures(body.features) : existing.features,
      contact: body.contact !== undefined ? body.contact : existing.contact,
    },
    existing
  );
  partners[slug] = updated;
  kvSetJson(OXIUM_PARTNERS_KV_KEY, partners);
  res.json({ success: true, partner: updated });
});

app.get("/api/oxium/import-sources", async (req, res) => {
  const cloudUser = await getAuthenticatedCloudSyncUser(req);
  if (!cloudUser) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  const targetSlug = normalizeOxiumSlug(req.query.site || "");
  const sources = [];
  try {
    const ocRow = await dbGetSyncPayload(cloudUser.id);
    if (ocRow?.payload_json) {
      const safe = filterSafeCloudSyncExport(ocRow.payload_json);
      sources.push({
        slug: "operation-cookie",
        label: "Operation Cookie",
        itemCount: Object.keys(safe).length,
      });
    }
  } catch {}
  const partners = getOxiumPartnersMap();
  const syncMap = getOxiumSyncMap();
  for (const entry of Object.values(syncMap)) {
    if (!entry || Number(entry.userId) !== cloudUser.id) continue;
    const sSlug = normalizeOxiumSlug(entry.siteSlug);
    if (!sSlug || sSlug === targetSlug) continue;
    const itemCount = entry.data && typeof entry.data === "object" ? Object.keys(entry.data).length : 0;
    if (itemCount === 0) continue;
    sources.push({
      slug: sSlug,
      label: partners[sSlug]?.name || sSlug,
      itemCount,
    });
  }
  res.json({ success: true, sources });
});

app.post("/api/oxium/authorize", async (req, res) => {
  const cloudUser = await getAuthenticatedCloudSyncUser(req);
  if (!cloudUser) {
    return res.status(401).json({ success: false, error: "Please sign in first." });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const slug = normalizeOxiumSlug(body.siteSlug || "");
  const partners = getOxiumPartnersMap();
  const site = partners[slug];
  if (!site) {
    return res.status(404).json({ success: false, error: "Unknown Oxium site." });
  }
  const isApproved = site.status === "approved";
  const wantPreview = Boolean(body.preview);
  if (!isApproved && !(wantPreview && isOxiumPreviewAuthorized(req, site, cloudUser))) {
    return res.status(403).json({ success: false, error: "This site is not approved on the Oxium Network yet." });
  }
  const targetOrigin = String(body.targetOrigin || "").trim();
  const oxiumOrigin = getOxiumRequestOrigin(req);
  if (
    targetOrigin &&
    !isOriginAllowedForSite(targetOrigin, site) &&
    !(wantPreview && targetOrigin === oxiumOrigin)
  ) {
    return res.status(403).json({ success: false, error: "Target origin is not on this site's allowlist." });
  }
  const siteToken = signCloudSyncJwt({
    id: cloudUser.id,
    username: cloudUser.username,
    siteId: site.slug,
    typ: "oxium_site",
    v: 1,
  });
  let importedData = null;
  let importSource = "";
  if (body.importFromSite) {
    const resolved = await resolveOxiumImportPayload(
      cloudUser.id,
      body.importFromSite,
      site.slug
    );
    importSource = resolved.source;
    importedData = resolved.data;
  }
  res.json({
    success: true,
    siteToken,
    user: { id: cloudUser.id, username: cloudUser.username },
    profile: buildOxiumProfileSummary(cloudUser.username),
    importSource,
    importedData,
  });
});

app.get("/api/oxium/sync", (req, res) => {
  setOxiumCorsHeaders(req, res);
  const oxUser = getOxiumSiteUser(req);
  if (!oxUser) {
    return res.status(401).json({ success: false, error: "Missing or invalid Oxium site token." });
  }
  const requestedSite = normalizeOxiumSlug(req.query.site || oxUser.siteId);
  if (requestedSite !== oxUser.siteId) {
    return res.status(403).json({ success: false, error: "Token is scoped to a different Oxium site." });
  }
  const site = getOxiumPartnersMap()[oxUser.siteId];
  if (!site || site.status !== "approved") {
    return res.status(403).json({ success: false, error: "Oxium site is not active." });
  }
  if (!checkOxiumSiteOriginAccess(req, site)) {
    return res.status(403).json({ success: false, error: "Origin not allowlisted for this site." });
  }
  const syncMap = getOxiumSyncMap();
  const entry = syncMap[`${oxUser.id}:${oxUser.siteId}`] || null;
  res.json({
    success: true,
    siteSlug: oxUser.siteId,
    updatedAt: entry?.updatedAt || null,
    data: entry?.data || {},
  });
});

app.post("/api/oxium/sync", (req, res) => {
  setOxiumCorsHeaders(req, res);
  const oxUser = getOxiumSiteUser(req);
  if (!oxUser) {
    return res.status(401).json({ success: false, error: "Missing or invalid Oxium site token." });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedSite = normalizeOxiumSlug(body.siteSlug || oxUser.siteId);
  if (requestedSite !== oxUser.siteId) {
    return res.status(403).json({ success: false, error: "Token is scoped to a different Oxium site." });
  }
  const site = getOxiumPartnersMap()[oxUser.siteId];
  if (!site || site.status !== "approved") {
    return res.status(403).json({ success: false, error: "Oxium site is not active." });
  }
  if (!checkOxiumSiteOriginAccess(req, site)) {
    return res.status(403).json({ success: false, error: "Origin not allowlisted for this site." });
  }
  const syncMap = getOxiumSyncMap();
  const bucketKey = `${oxUser.id}:${oxUser.siteId}`;
  const prevData =
    syncMap[bucketKey]?.data && typeof syncMap[bucketKey].data === "object"
      ? syncMap[bucketKey].data
      : {};
  const incoming = sanitizeOxiumSyncDataPayload(body.data || {});
  const merged = body.replace === true ? incoming : { ...prevData, ...incoming };
  const updatedAt = Date.now();
  syncMap[bucketKey] = {
    userId: oxUser.id,
    siteSlug: oxUser.siteId,
    updatedAt,
    data: merged,
  };
  kvSetJson(OXIUM_SYNC_KV_KEY, syncMap);
  res.json({ success: true, siteSlug: oxUser.siteId, updatedAt, data: merged });
});

app.post("/api/oxium/import", async (req, res) => {
  setOxiumCorsHeaders(req, res);
  const oxUser = getOxiumSiteUser(req);
  if (!oxUser) {
    return res.status(401).json({ success: false, error: "Missing or invalid Oxium site token." });
  }
  const site = getOxiumPartnersMap()[oxUser.siteId];
  if (!site || site.status !== "approved") {
    return res.status(403).json({ success: false, error: "Oxium site is not active." });
  }
  if (!checkOxiumSiteOriginAccess(req, site)) {
    return res.status(403).json({ success: false, error: "Origin not allowlisted for this site." });
  }
  const fromSite = normalizeOxiumSlug(req.body?.fromSite || "operation-cookie");
  const resolved = await resolveOxiumImportPayload(oxUser.id, fromSite, oxUser.siteId);
  res.json({
    success: true,
    siteSlug: oxUser.siteId,
    importSource: resolved.source,
    data: resolved.data,
  });
});

app.get("/api/oxium/announcements", (req, res) => {
  setOxiumCorsHeaders(req, res);
  const oxiumOrigin = getOxiumRequestOrigin(req);
  const currentSite = normalizeOxiumSlug(req.query.site || "");
  const partners = getOxiumPartnersMap();
  const promos = getOxiumPromosList()
    .filter((p) => p && p.active !== false)
    .map((p) => {
      const targetSlug = normalizeOxiumSlug(p.siteSlug || "");
      return {
        id: String(p.id || ""),
        siteSlug: targetSlug,
        siteName: partners[targetSlug]?.name || p.siteName || targetSlug || "Oxium Partner",
        title: String(p.title || "Oxium Network").slice(0, 100),
        message: String(p.message || "").slice(0, 220),
        linksUrl:
          sanitizeOxiumUrl(p.linksUrl) ||
          (targetSlug ? `${oxiumOrigin}/oxium/links/${targetSlug}` : `${oxiumOrigin}/oxium/links`),
        createdAt: Number(p.createdAt || Date.now()),
      };
    })
    .filter((p) => !currentSite || p.siteSlug !== currentSite)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ success: true, promos });
});

app.get("/api/admin/oxium/partners", verifyAdmin, (req, res) => {
  const partners = Object.values(getOxiumPartnersMap()).sort(
    (a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)
  );
  const promos = getOxiumPromosList().sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)
  );
  res.json({
    success: true,
    partners,
    promos,
    oxiumOrigin: getOxiumRequestOrigin(req),
  });
});

app.post("/api/admin/oxium/partners/:slug/status", verifyAdmin, (req, res) => {
  const slug = normalizeOxiumSlug(req.params.slug || "");
  const partners = getOxiumPartnersMap();
  const existing = partners[slug];
  if (!existing) {
    return res.status(404).json({ success: false, error: "Partner not found." });
  }
  const action = String(req.body?.action || req.body?.status || "").toLowerCase();
  if (action === "delete") {
    delete partners[slug];
    kvSetJson(OXIUM_PARTNERS_KV_KEY, partners);
    return res.json({ success: true, deleted: slug });
  }
  if (action !== "approved" && action !== "approve" && action !== "rejected" && action !== "reject" && action !== "pending") {
    return res.status(400).json({ success: false, error: "Invalid status action." });
  }
  const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : action;
  existing.status = nextStatus;
  existing.updatedAt = Date.now();
  if (nextStatus === "approved") {
    existing.approvedAt = existing.approvedAt || Date.now();
    existing.rejectReason = "";
  } else if (nextStatus === "rejected") {
    existing.rejectReason = String(req.body?.reason || "").trim().slice(0, 200);
  }
  partners[slug] = existing;
  kvSetJson(OXIUM_PARTNERS_KV_KEY, partners);
  res.json({ success: true, partner: existing });
});

app.get("/api/admin/oxium/promos", verifyAdmin, (_req, res) => {
  res.json({ success: true, promos: getOxiumPromosList() });
});

app.post("/api/admin/oxium/promos", verifyAdmin, (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const action = String(body.action || "create").toLowerCase();
  let promos = getOxiumPromosList();
  const oxiumOrigin = getOxiumRequestOrigin(req);

  if (action === "delete") {
    const id = String(body.id || "").trim();
    promos = promos.filter((p) => String(p.id) !== id);
    kvSetJson(OXIUM_PROMOS_KV_KEY, promos);
    return res.json({ success: true, promos });
  }

  if (action === "toggle") {
    const id = String(body.id || "").trim();
    promos = promos.map((p) => (String(p.id) === id ? { ...p, active: !p.active } : p));
    kvSetJson(OXIUM_PROMOS_KV_KEY, promos);
    return res.json({ success: true, promos });
  }

  if (action === "broadcast") {
    const id = String(body.id || "").trim();
    const target = promos.find((p) => String(p.id) === id);
    if (!target) return res.status(404).json({ success: false, error: "Promo not found." });
    const count = broadcastToClients({ type: "oxium:promo", promo: target, timestamp: Date.now() }, "all");
    return res.json({ success: true, count, promo: target });
  }

  const siteSlug = normalizeOxiumSlug(body.siteSlug || "");
  const partners = getOxiumPartnersMap();
  const partnerName = partners[siteSlug]?.name || siteSlug || "Featured Site";
  const title = String(body.title || `Like Operation Cookie?`).trim().slice(0, 100);
  const message = String(body.message || `Try out ${partnerName}! Click here for links.`)
    .trim()
    .slice(0, 220);
  if (!message) {
    return res.status(400).json({ success: false, error: "Promo message is required." });
  }
  const promo = {
    id: `oxp_${Date.now().toString(36)}_${crypto.randomBytes(2).toString("hex")}`,
    siteSlug,
    siteName: partnerName,
    title,
    message,
    linksUrl:
      sanitizeOxiumUrl(body.linksUrl) ||
      (siteSlug ? `${oxiumOrigin}/oxium/links/${siteSlug}` : `${oxiumOrigin}/oxium/links`),
    active: body.active !== false,
    createdAt: Date.now(),
  };
  promos.unshift(promo);
  if (promos.length > 25) promos = promos.slice(0, 25);
  kvSetJson(OXIUM_PROMOS_KV_KEY, promos);
  let delivered = 0;
  if (promo.active && body.broadcast !== false) {
    delivered = broadcastToClients({ type: "oxium:promo", promo, timestamp: Date.now() }, "all");
  }
  res.json({ success: true, promo, promos, delivered });
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
  try {
    sharedCloudSyncDb?.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    sharedCloudSyncDb?.close();
    sharedCloudSyncDb = null;
  } catch {}
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
    `server listening on ${PORT}!! ~ caching: ${CACHING_ENABLED ? "yes" : "no"} ~ cloudsync: ${USE_SUPABASE_CLOUDSYNC ? "supabase" : "sqlite"}`,
  );
  void getCloudSyncUsersMapAsync().catch(() => {});
  void ensureChatMetaReadyAsync().catch(() => {});

  if (NODE_ENV === "development") {
    spawnServices();
  }
});
