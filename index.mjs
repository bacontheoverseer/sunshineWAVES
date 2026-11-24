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
import aivenDb, { isAivenConfigured } from "./db.js";
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
  if (!res.getHeader("Cache-Control")) {
    res.setHeader("Cache-Control", cacheControl);
  }
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
  skip: (req) => String(req.path || "").startsWith("/chat/media/"),
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
  socket.on("error", () => {
    try { socket.destroy(); } catch {}
  });
  if (req.url && req.url.startsWith("/w/")) {
    try {
      wisp.routeRequest(req, socket, head);
    } catch {
      try { socket.end(); } catch {}
    }
  } else {
    try { socket.end(); } catch {}
  }
});
const pageCache = new LRUCache({ max: parseInt(process.env.PAGE_CACHE_MAX || "50", 10), ttl: 1000 * 60 * 5 });

app.use((req, res, next) => {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const isTrustworthyOrigin =
    req.secure ||
    proto === "https" ||
    req.hostname === "localhost" ||
    req.hostname === "127.0.0.1";
  if (isTrustworthyOrigin) {
    if (!req.path.startsWith("/p/")) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    }
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  }
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

// Server-side SSRF-safe HTTP rewriting proxy (`/p/<token>/`) so plain HTTP origins
// (where browsers block Service Workers) can still search and browse websites cleanly.
function encodeMochiToken(rawUrl) {
  const buf = Buffer.from(encodeURIComponent(String(rawUrl)), "utf8");
  for (let i = 0; i < buf.length; i++) {
    buf[i] ^= MOCHI_XOR_KEY[i % MOCHI_XOR_KEY.length];
  }
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHttpProxyUrl(rawRef, baseUrl) {
  if (!rawRef || typeof rawRef !== "string") return rawRef;
  const trimmed = rawRef.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/p/") ||
    trimmed.startsWith("/!!/") ||
    /^(?:data|blob|javascript|mailto|tel|sms|about):/i.test(trimmed)
  ) {
    return rawRef;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return rawRef;
    }
    return `/p/${encodeMochiToken(resolved.href)}/`;
  } catch {
    return rawRef;
  }
}

function decodeHttpProxyTarget(reqUrl) {
  const qIdx = reqUrl.indexOf("?");
  const rawPath = qIdx >= 0 ? reqUrl.slice(0, qIdx) : reqUrl;
  const searchPart = qIdx >= 0 ? reqUrl.slice(qIdx) : "";
  const cleanPath = rawPath.replace(/^\/+/, "");
  if (!cleanPath) return null;

  const slashIdx = cleanPath.indexOf("/");
  const token = slashIdx === -1 ? cleanPath : cleanPath.slice(0, slashIdx);
  const subPath = slashIdx === -1 ? "" : cleanPath.slice(slashIdx + 1);

  let baseDecoded = decodeMochiToken(token);
  if (!baseDecoded) {
    try {
      const candidate = decodeURIComponent(token);
      if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
        baseDecoded = candidate;
      }
    } catch {}
  }
  if (!baseDecoded) return null;

  try {
    let baseForResolution = baseDecoded;
    if (subPath && !subPath.startsWith("/")) {
      try {
        const parsedBase = new URL(baseDecoded);
        if (!parsedBase.pathname.endsWith("/")) {
          const lastSeg = parsedBase.pathname.split("/").pop() || "";
          if (!lastSeg.includes(".")) {
            parsedBase.pathname += "/";
            baseForResolution = parsedBase.href;
          }
        }
      } catch {}
    }
    const targetObj = subPath
      ? new URL(subPath, baseForResolution)
      : new URL(baseDecoded);
    if (searchPart) {
      if (subPath) {
        return new URL(subPath + searchPart, baseForResolution).href;
      }
      const incomingParams = new URLSearchParams(searchPart.slice(1));
      for (const key of new Set(incomingParams.keys())) {
        targetObj.searchParams.delete(key);
        for (const val of incomingParams.getAll(key)) {
          targetObj.searchParams.append(key, val);
        }
      }
    }
    return targetObj.href;
  } catch {
    return baseDecoded;
  }
}

function rewriteCssUrls(cssText, baseUrl) {
  if (!cssText) return cssText;
  let out = cssText.replace(
    /@import\s+(["'])([^"']+)\1/gi,
    (_m, q, ref) => `@import ${q}${toHttpProxyUrl(ref, baseUrl)}${q}`
  );
  out = out.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s"']+))\s*\)/gi,
    (m, dq, sq, uq) => {
      const ref = dq ?? sq ?? uq ?? "";
      const rewritten = toHttpProxyUrl(ref, baseUrl);
      if (rewritten === ref) return m;
      return `url("${rewritten}")`;
    }
  );
  return out;
}

function buildHttpProxyClientShim(realUrl) {
  const escapedUrl = JSON.stringify(String(realUrl)).replace(/</g, "\\u003c");
  return `<script data-sunshine-http-proxy="1">(function(){
var R=${escapedUrl},K="q7Zx!9pL";
function enc(u){
if(!u)return u;var s=String(u).trim();
if(!s||s.charAt(0)==="#"||s.indexOf("/p/")===0||s.indexOf("/!!/")===0||/^(?:data|blob|javascript|mailto|tel|sms|about):/i.test(s))return u;
try{
var ab=new URL(s,R);if(ab.protocol!=="http:"&&ab.protocol!=="https:")return u;
var p=encodeURIComponent(ab.href),bytes=new TextEncoder().encode(p),out=new Uint8Array(bytes.length);
for(var i=0;i<bytes.length;i++)out[i]=bytes[i]^K.charCodeAt(i%K.length);
var bin="";for(var j=0;j<out.length;j++)bin+=String.fromCharCode(out[j]);
return "/p/"+btoa(bin).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")+"/";
}catch(e){return u;}
}
var ofetch=window.fetch;
if(typeof ofetch==="function"){
window.fetch=function(input,init){
try{
if(typeof input==="string")input=enc(input);
else if(input&&typeof input==="object"&&input.url)input=new Request(enc(input.url),input);
}catch(e){}
return ofetch.call(this,input,init);
};
}
var oxhr=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
var args=[].slice.call(arguments);
try{if(typeof u==="string")args[1]=enc(u);}catch(e){}
return oxhr.apply(this,args);
};
var oopen=window.open;
window.open=function(u,t,f){return oopen.call(this,typeof u==="string"?enc(u):u,t,f);};
if(window.history){
var ops=history.pushState,ors=history.replaceState;
history.pushState=function(s,t,u){
try{if(u)R=new URL(String(u),R).href;return ops.call(this,s,t,u?enc(R):u);}catch(e){return ops.apply(this,arguments);}
};
history.replaceState=function(s,t,u){
try{if(u)R=new URL(String(u),R).href;return ors.call(this,s,t,u?enc(R):u);}catch(e){return ors.apply(this,arguments);}
};
}
document.addEventListener("click",function(ev){
var a=ev.target&&ev.target.closest?ev.target.closest("a[href]"):null;
if(!a)return;
var h=a.getAttribute("href");
if(!h||h.charAt(0)==="#"||h.indexOf("/p/")===0||/^(?:javascript|mailto|tel|data|blob):/i.test(h))return;
var next=enc(h);if(next&&next!==h)a.setAttribute("href",next);
},true);
document.addEventListener("submit",function(ev){
var f=ev.target;if(!f||f.tagName!=="FORM")return;
var rawAct=f.getAttribute("action")||R;
var act=rawAct.indexOf("/p/")===0?rawAct:enc(rawAct);
var method=(f.getAttribute("method")||"GET").toUpperCase();
if(method==="GET"){
ev.preventDefault();
try{
var baseTarget=rawAct.indexOf("/p/")===0?R:new URL(rawAct,R).href;
var u=new URL(baseTarget);
var fd=new FormData(f);
fd.forEach(function(v,k){if(typeof v==="string")u.searchParams.append(k,v);});
var dest=enc(u.href);
if(f.target==="_blank")window.open(dest,"_blank");else window.location.assign(dest);
}catch(e){}
}else if(act){f.setAttribute("action",act);}
},true);
})();</script>`;
}

function rewriteHtmlForHttpProxy(html, baseUrl) {
  let out = html
    .replace(/<meta[^>]+http-equiv\s*=\s*(?:"(?:content-security-policy|x-frame-options)"|'(?:content-security-policy|x-frame-options)'|(?:content-security-policy|x-frame-options))[^>]*>/gi, "");

  out = out.replace(
    /(<meta[^>]+http-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*content\s*=\s*)(["'])([^"']+)\2/gi,
    (_m, pre, q, content) => {
      const updated = content.replace(/url\s*=\s*(['"]?)([^;'"]+)\1/i, (_uM, uq, ref) => {
        return `url=${uq}${toHttpProxyUrl(ref, baseUrl)}${uq}`;
      });
      return `${pre}${q}${updated}${q}`;
    }
  );

  const rewriteUrlAttr = (m, pre, dq, sq, uq) => {
    const val = dq ?? sq ?? uq ?? "";
    const quote = sq !== undefined ? "'" : '"';
    const rewritten = toHttpProxyUrl(val, baseUrl);
    if (rewritten === val) return m;
    return `${pre}${quote}${rewritten}${quote}`;
  };

  out = out.replace(
    /<([a-zA-Z][a-zA-Z0-9:-]*)(\s+[^<>]*?)>/g,
    (tagMatch, tagName, attrs) => {
      const lowerTag = tagName.toLowerCase();
      if (lowerTag === "style") return tagMatch;
      let updated = attrs.replace(
        lowerTag === "script"
          ? /(\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
          : /(\s(?:href|src|action|poster|data-src)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
        rewriteUrlAttr
      );
      if (lowerTag !== "script") {
        updated = updated.replace(
          /(\ssrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
          (_m, pre, dq, sq) => {
            const val = dq ?? sq ?? "";
            const quote = dq !== undefined ? '"' : "'";
            const rewritten = val
              .split(",")
              .map((part) => {
                const t = part.trim();
                if (!t) return "";
                const sp = t.split(/\s+/);
                sp[0] = toHttpProxyUrl(sp[0], baseUrl);
                return sp.join(" ");
              })
              .filter(Boolean)
              .join(", ");
            return `${pre}${quote}${rewritten}${quote}`;
          }
        );
      }
      return `<${tagName}${updated}>`;
    }
  );

  out = out.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_m, open, css, close) => `${open}${rewriteCssUrls(css, baseUrl)}${close}`
  );

  out = out.replace(
    /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi,
    (_m, pre, dq, sq) => {
      const val = dq ?? sq ?? "";
      const quote = dq !== undefined ? '"' : "'";
      return `${pre}${quote}${rewriteCssUrls(val, baseUrl)}${quote}`;
    }
  );

  const shim = buildHttpProxyClientShim(baseUrl);
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (tag) => `${tag}${shim}`);
  } else if (/<html\b[^>]*>/i.test(out)) {
    out = out.replace(/<html\b[^>]*>/i, (tag) => `${tag}${shim}`);
  } else {
    out = `${shim}${out}`;
  }
  return out;
}

const HTTP_PROXY_STRIPPED_RESP_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "strict-transport-security",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "set-cookie",
]);

const HTTP_PROXY_ALLOWED_REQ_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "user-agent",
  "range",
];

async function handleHttpProxy(req, res) {
  const targetStr = decodeHttpProxyTarget(req.url);
  if (!targetStr) {
    return res.status(400).send("Invalid HTTP proxy target URL.");
  }

  const validated = await validatePublicHttpUrl(targetStr);
  if (!validated) {
    return res.status(403).send("Blocked proxy target.");
  }

  const method = String(req.method || "GET").toUpperCase();
  const headers = {
    "accept-encoding": "identity",
    "user-agent": req.headers["user-agent"] || MOCHI_FALLBACK_UA,
  };
  for (const name of HTTP_PROXY_ALLOWED_REQ_HEADERS) {
    const val = req.headers[name];
    if (typeof val === "string" && val.trim()) {
      headers[name] = val;
    }
  }
  headers["referer"] = validated.origin + "/";

  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const reqBody =
    hasBody && Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : undefined;

  let currentUrl = validated.toString();
  let upstreamRes = null;
  try {
    for (let hop = 0; hop <= 5; hop++) {
      upstreamRes = await fetch(currentUrl, {
        method,
        headers,
        body: hop === 0 ? reqBody : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });

      const isRedirect =
        upstreamRes.status >= 300 &&
        upstreamRes.status < 400 &&
        upstreamRes.headers.get("location");
      if (!isRedirect) break;

      const loc = upstreamRes.headers.get("location");
      const nextUrl = new URL(loc, currentUrl).toString();
      const safeNext = await validatePublicHttpUrl(nextUrl);
      if (!safeNext) {
        return res.status(403).send("Blocked redirect target.");
      }
      const safeNextUrl = safeNext.toString();

      if (upstreamRes.status === 307 || upstreamRes.status === 308 || hasBody) {
        res.status(upstreamRes.status);
        res.setHeader("Location", toHttpProxyUrl(safeNextUrl, currentUrl));
        return res.end();
      }
      // For standard GET/HEAD redirects, return rewritten Location when browser-facing
      // HTML navigation is active, updating URL history automatically.
      const acceptHdr = String(req.headers["accept"] || "");
      if (method === "GET" && acceptHdr.includes("text/html")) {
        res.status(upstreamRes.status);
        res.setHeader("Location", toHttpProxyUrl(safeNextUrl, currentUrl));
        return res.end();
      }
      currentUrl = safeNextUrl;
    }

    if (!upstreamRes) {
      return res.status(502).send("No response from upstream target.");
    }

    const contentType = upstreamRes.headers.get("content-type") || "application/octet-stream";
    for (const [k, v] of upstreamRes.headers.entries()) {
      const lower = k.toLowerCase();
      if (HTTP_PROXY_STRIPPED_RESP_HEADERS.has(lower)) continue;
      if (lower === "location") {
        res.setHeader("location", toHttpProxyUrl(v, currentUrl));
        continue;
      }
      res.setHeader(k, v);
    }
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", contentType);

    const maxBytes = 12 * 1024 * 1024;
    const rawBuf = method === "HEAD" ? Buffer.alloc(0) : await readLimitedResponseBuffer(upstreamRes, maxBytes);
    if (!rawBuf) {
      return res.status(502).send("Upstream response exceeded size limit.");
    }

    const lowerType = contentType.toLowerCase();
    if (lowerType.includes("text/html") || lowerType.includes("application/xhtml+xml")) {
      const rewrittenHtml = rewriteHtmlForHttpProxy(rawBuf.toString("utf8"), currentUrl);
      return res.status(upstreamRes.status).send(rewrittenHtml);
    }
    if (lowerType.includes("text/css")) {
      const rewrittenCss = rewriteCssUrls(rawBuf.toString("utf8"), currentUrl);
      return res.status(upstreamRes.status).send(rewrittenCss);
    }
    return res.status(upstreamRes.status).send(rawBuf);
  } catch (err) {
    if (!res.headersSent) {
      return res.status(502).send(`HTTP proxy error: ${err?.message || "Upstream unreachable"}`);
    }
    res.destroy();
  }
}

app.use("/p", express.raw({ type: "*/*", limit: "4mb" }), handleHttpProxy);

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
const SW_SCRIPT_PATH_RE = /^\/b\/(?:sw\.js|[a-f0-9]{10}\.js)$/;

app.use("/b", (req, res, next) => {
  const cleanUrlPath = (req.originalUrl || "").split("?")[0];
  if (SW_SCRIPT_PATH_RE.test(req.path) || SW_SCRIPT_PATH_RE.test(cleanUrlPath)) {
    res.setHeader("Service-Worker-Allowed", "/");
    res.setHeader("Cache-Control", NO_CACHE_CC);
  } else if (
    cleanUrlPath === "/b/s/jetty.all.js" ||
    cleanUrlPath === "/b/s/jetty.sync.js" ||
    cleanUrlPath === "/b/all.js"
  ) {
    res.setHeader("Cache-Control", NO_CACHE_CC);
  }
  next();
});

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
            SW_SCRIPT_PATH_RE.test(req.path) ||
              req.path.startsWith("/assets/data") ||
              req.path === "/b/all.js" ||
              req.path === "/b/s/jetty.all.js" ||
              req.path === "/b/s/jetty.sync.js"
              ? NO_CACHE_CC
              : IMMUTABLE_CC,
          );
          if (SW_SCRIPT_PATH_RE.test(req.path)) {
            res.setHeader("Service-Worker-Allowed", "/");
          }
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
    hsts: false,
  }),
);
app.use((req, res, next) => {
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (req.secure || proto === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  next();
});

app.use("/api/", apiLimiter);
app.use(
  "/api/",
  express.json({
    limit: "12mb",
    verify: (req, _res, buf) => {
      if (
        req.originalUrl?.startsWith("/api/cookie-master/webhook") ||
        req.originalUrl?.startsWith("/api/stripe/webhook")
      ) {
        req.rawBody = buf;
      }
    },
  }),
);
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
const ADMIN_SECRET = (process.env.ADMIN_SECRET || "cookie_admin_chaos_master_key_99").trim();
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "bacon").trim();
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
const httpHeartbeats = new Map(); // clientId -> { id, instanceId, username, verifiedUsername, page, game, isPlayingGame, gameStartedAt, isIdle, lastSeen }
const LIVE_SSE_PRESENCE_TTL_MS = 360000; // Covers Chrome 5-min background throttling; req.on("close") & /offline still clear closed tabs immediately
const HTTP_HEARTBEAT_PRESENCE_TTL_MS = 65000; // Keeps HTTP-heartbeating tabs online across throttled timers or SSE reconnects
const knownUsers = new Map(); // usernameLower -> { username, lastSeen, game, isPlayingGame, gameStartedAt }
const userProfiles = new Map(); // usernameLower -> { bio, statusText, customization, updatedAt }
const staffModerators = new Set(ENV_STAFF_MODS); // Set<usernameLower>
const goatUsers = new Set(); // Set<usernameLower> - golden GOAT title honorees
const chatTimeouts = new Map(); // usernameLower -> { until, reason, by, updatedAt }
const chatGroups = new Map(); // groupId -> { id, name, creator, members, createdAt }
const DEFAULT_CHAT_CHANNELS = [
  { id: "rules", name: "rules", icon: "fa-book", categoryId: "info", categoryLabel: "info", visibility: "all", writeAccess: "staff" },
  { id: "announcements", name: "announcements", icon: "fa-bullhorn", categoryId: "info", categoryLabel: "info", visibility: "all", writeAccess: "staff" },
  { id: "updates", name: "updates", icon: "fa-sparkles", categoryId: "info", categoryLabel: "info", visibility: "all", writeAccess: "all" },
  { id: "staff-chat", name: "staff-chat", icon: "fa-user-shield", categoryId: "staff", categoryLabel: "staff", visibility: "staff", writeAccess: "staff" },
  { id: "general", name: "general", icon: "fa-hashtag", categoryId: "social", categoryLabel: "social", visibility: "all", writeAccess: "all" },
  { id: "introductions", name: "introductions", icon: "fa-hashtag", categoryId: "social", categoryLabel: "social", visibility: "all", writeAccess: "all" },
  { id: "off-topic", name: "off-topic", icon: "fa-hashtag", categoryId: "social", categoryLabel: "social", visibility: "all", writeAccess: "all" },
  { id: "games", name: "games", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "anime", name: "anime", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "music", name: "music", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "tech", name: "tech", icon: "fa-hashtag", categoryId: "interests", categoryLabel: "interests", visibility: "all", writeAccess: "all" },
  { id: "help", name: "help", icon: "fa-hashtag", categoryId: "support", categoryLabel: "support", visibility: "all", writeAccess: "all" },
];
const chatChannels = DEFAULT_CHAT_CHANNELS.map((c) => ({ ...c }));
const chatBackgrounds = new Map(); // channelId -> image/gif URL (/api/chat/media/... or https://)
const staffActionLogs = []; // Array<{ id, timestamp, action, actor, actorRole, targetUsername, channel, details }>
const staffUserNotes = new Map(); // usernameLower -> Array<{ id, targetUsername, author, authorRole, note, category, createdAt }>
const deletedStaffNoteIds = new Set(); // Set<noteId>
const deletedChatMessageIds = new Set(); // Set<messageId>
const bannedDevices = []; // Array<{ id, fingerprint_id, storage_token, banned_username, banned_reason, high_confidence_spam, created_at }>
const shadowbannedUsers = new Set(); // Set<usernameLower>
const userDeviceMap = new Map(); // usernameLower -> { fingerprint_id, storage_token, updatedAt }
const userCreatedAtMap = new Map(); // usernameLower -> timestampMs
const userLastMessageTrack = new Map(); // usernameLower -> { lastSentAt, recentTexts: Array<{ norm, at }>, recentDmTargets: Map<targetLower, number> }
const TURNSTILE_SITE_KEY = (process.env.TURNSTILE_SITE_KEY || process.env.CF_TURNSTILE_SITE_KEY || "").trim();
const TURNSTILE_SECRET_KEY = (process.env.TURNSTILE_SECRET_KEY || process.env.CF_TURNSTILE_SECRET_KEY || "").trim();
const ACCOUNT_CHAT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes before global chat or DMs
const ACCOUNT_ADMIN_DM_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes before DMing admins (@bacontheoverseer) or mass-messaging
const CHAT_SLOWMODE_MS = 3000; // 3-second slowmode per user
const CHAT_DUPLICATE_WINDOW_MS = 30000; // 30-second duplicate message window
const MAX_STAFF_ACTION_LOGS = 500;
const MAX_NOTES_PER_USER = 50;
let chatMetaLoadedFromDb = false;

const CLOUDSYNC_JWT_SECRET =
  process.env.JWT_SECRET || "dev_jwt_secret_cookie_super_safe_key_123";
const USE_SUPABASE_CLOUDSYNC = isAivenConfigured;

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
    cloudSyncDbInitialized = false;
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
        CREATE TABLE IF NOT EXISTS chat_media (
          id TEXT PRIMARY KEY,
          author TEXT,
          mime TEXT NOT NULL,
          data_b64 TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS banned_devices (
          id TEXT PRIMARY KEY,
          fingerprint_id TEXT DEFAULT '',
          storage_token TEXT DEFAULT '',
          banned_username TEXT DEFAULT '',
          banned_reason TEXT DEFAULT '',
          high_confidence_spam INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_chat_media_created ON chat_media(created_at);
        CREATE INDEX IF NOT EXISTS idx_banned_devices_fp ON banned_devices(fingerprint_id);
        CREATE INDEX IF NOT EXISTS idx_banned_devices_token ON banned_devices(storage_token);
      `);
      try {
        sharedCloudSyncDb.exec("ALTER TABLE users ADD COLUMN last_fingerprint_id TEXT DEFAULT ''");
      } catch {}
      try {
        sharedCloudSyncDb.exec("ALTER TABLE users ADD COLUMN last_storage_token TEXT DEFAULT ''");
      } catch {}
      try {
        sharedCloudSyncDb.exec("ALTER TABLE users ADD COLUMN is_shadowbanned INTEGER DEFAULT 0");
      } catch {}
      cloudSyncDbInitialized = true;
    }
  }
  return sharedCloudSyncDb;
}

const RESERVED_SYSTEM_KV_USERNAME = "__sunshine_kv__";
const RESERVED_MEDIA_SHARD_PREFIX = "__sunshine_media_";
function isReservedSystemUsername(username) {
  const k = String(username || "").trim().toLowerCase();
  return k === RESERVED_SYSTEM_KV_USERNAME || k.startsWith(RESERVED_MEDIA_SHARD_PREFIX);
}
const STUDIO_GAMES_KV_KEY = "studio_games_v1";
const STUDIO_PROFILES_KV_KEY = "studio_profiles_v1";
const publishedStudioGames = [];
const MAX_PUBLISHED_STUDIO_GAMES = 60;
const MAX_CUSTOM_HTML_BYTES = 5 * 1024 * 1024;
const customStudios = [];
let studioGamesRemoteSyncedAt = 0;
let studioStudiosRemoteSyncedAt = 0;
const CHAT_META_KV_KEYS = [
  "staff_moderators_v1",
  "goat_users_v1",
  "user_profiles_v2",
  "chat_timeouts_v1",
  "chat_groups_v1",
  "chat_channels_v1",
  "chat_backgrounds_v1",
  "chat_history_v1",
  "staff_action_logs_v1",
  "staff_user_notes_v1",
  "staff_user_notes_deleted_v1",
  "banned_devices_v1",
  "shadowbanned_users_v1",
  "user_device_map_v1",
  "user_created_at_v1",
  "pending_coin_grants_v1",
  "coin_claim_cooldowns_v1",
  STUDIO_GAMES_KV_KEY,
  STUDIO_PROFILES_KV_KEY,
  OXIUM_PARTNERS_KV_KEY,
  OXIUM_SYNC_KV_KEY,
  OXIUM_PROMOS_KV_KEY,
];

function mergeStudioGamesLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || !raw.id || !raw.title) continue;
      const id = String(raw.id).trim();
      if (!id) continue;
      const incoming = {
        ...raw,
        id,
        title: String(raw.title).trim().slice(0, 80),
        author: String(raw.author || "creator").trim().slice(0, 60),
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
        plays: Number(raw.plays) || 0,
        likes: Number(raw.likes) || 0,
      };
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, incoming);
      } else {
        const prevTs = Date.parse(prev.updatedAt || prev.createdAt || "") || 0;
        const nextTs = Date.parse(incoming.updatedAt || incoming.createdAt || "") || 0;
        const winner = nextTs >= prevTs ? incoming : prev;
        byId.set(id, {
          ...winner,
          plays: Math.max(Number(prev.plays) || 0, Number(incoming.plays) || 0),
          likes: Math.max(Number(prev.likes) || 0, Number(incoming.likes) || 0),
        });
      }
    }
  }
  return Array.from(byId.values())
    .sort(
      (a, b) =>
        (Date.parse(b.updatedAt || b.createdAt || "") || 0) -
        (Date.parse(a.updatedAt || a.createdAt || "") || 0)
    )
    .slice(0, MAX_PUBLISHED_STUDIO_GAMES);
}

function mergeStudioProfilesLists(...lists) {
  const byKey = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || !raw.name || !raw.owner) continue;
      const key = String(raw.owner).trim().toLowerCase();
      if (!key) continue;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, raw);
      } else {
        const prevTs = Date.parse(prev.updatedAt || prev.createdAt || "") || 0;
        const nextTs = Date.parse(raw.updatedAt || raw.createdAt || "") || 0;
        byKey.set(key, nextTs >= prevTs ? { ...prev, ...raw } : { ...raw, ...prev });
      }
    }
  }
  return Array.from(byKey.values()).slice(0, 500);
}
let supabaseHasAppKvTable = null; // null = probe on first sync, true/false once probed
let supabaseKvSysUserId = null;
let hasLoadedRemoteKvSuccessfully = !USE_SUPABASE_CLOUDSYNC;
let supabaseMetaHydrated = false;
let supabaseMetaHydratePromise = null;
let isHydratingSupabaseKv = false;
let localProfileRecoveryDone = false;
let supabaseProfilesBackfillStarted = false;
let lastRemoteUserProfilesSnapshot = {};
const locallyDirtyProfileKeys = new Set();
const deletedProfileKeys = new Set();
const clearedLastfmKeys = new Set();
const singleProfileSyncRecoveryChecked = new Map(); // usernameLower -> ts
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
  const delayMs =
    k === "staff_moderators_v1" ||
    k === "goat_users_v1" ||
    k === "staff_action_logs_v1" ||
    k === "staff_user_notes_v1"
      ? 10
      : 250;
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
const VALID_MSG_PILL_STYLES = new Set([
  "default", "midnight", "frosted", "tinted", "neon", "rose", "emerald", "gold", "sunset", "cyber",
]);
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

function sanitizeLastfmUsernameServer(raw) {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  const urlMatch = /^https?:\/\/(?:www\.)?last\.fm\/user\/([^/?#]+)/i.exec(s);
  if (urlMatch) s = urlMatch[1];
  s = s.replace(/^@+/, "");
  return s.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 32);
}

function sanitizeProfileCustomizationServer(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const emoji = typeof src.avatarEmoji === "string" ? src.avatarEmoji.trim() : "";
  return {
    displayName: typeof src.displayName === "string" ? src.displayName.trim().slice(0, 32) : "",
    pronouns: typeof src.pronouns === "string" ? src.pronouns.trim().slice(0, 24) : "",
    customTag: typeof src.customTag === "string" ? src.customTag.trim().slice(0, 18) : "",
    lastfmUsername: sanitizeLastfmUsernameServer(src.lastfmUsername),
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
    msgPillStyle: VALID_MSG_PILL_STYLES.has(src.msgPillStyle) ? src.msgPillStyle : "default",
    presenceStatus: VALID_PRESENCE_STATUS.has(src.presenceStatus) ? src.presenceStatus : "online",
  };
}

const DEFAULT_CUSTOM_SENTINELS = {
  avatarSecondary: "#18181b",
  avatarDecoration: "none",
  bannerStyle: "solid",
  nameStyle: "default",
  nameFont: "default",
  nameplate: "none",
  profileEffect: "none",
  cardTheme: "obsidian",
  bioStyle: "frosted",
  msgPillStyle: "default",
  presenceStatus: "online",
};

function hasMeaningfulCustomization(raw) {
  if (!raw || typeof raw !== "object") return false;
  const c = sanitizeProfileCustomizationServer(raw);
  if (
    c.displayName ||
    c.pronouns ||
    c.customTag ||
    c.lastfmUsername ||
    c.avatarUrl ||
    c.bannerUrl ||
    c.decorationUrl ||
    c.profileEffectUrl ||
    c.nameplateUrl ||
    c.cardFrameUrl ||
    c.cardFrameId ||
    c.avatarColor ||
    c.cardBgColor ||
    c.avatarEmoji
  ) {
    return true;
  }
  for (const [k, def] of Object.entries(DEFAULT_CUSTOM_SENTINELS)) {
    if (c[k] && c[k] !== def) return true;
  }
  return false;
}

function mergeCustomizationObjects(baseRaw, incomingRaw) {
  const base = sanitizeProfileCustomizationServer(baseRaw);
  const inc = sanitizeProfileCustomizationServer(incomingRaw);
  const out = { ...base };
  for (const [k, val] of Object.entries(inc)) {
    const def = DEFAULT_CUSTOM_SENTINELS[k] ?? "";
    const incHasValue = val !== undefined && val !== null && val !== "" && val !== def;
    const baseHasValue = out[k] !== undefined && out[k] !== null && out[k] !== "" && out[k] !== def;
    if (incHasValue || !baseHasValue) {
      out[k] = val;
    }
  }
  return out;
}

function mergeSingleUserProfileEntry(existing, incoming, { preferIncoming = false } = {}) {
  if (!existing || typeof existing !== "object") return incoming;
  if (!incoming || typeof incoming !== "object") return existing;
  const exTs = Date.parse(existing.updatedAt || "") || 0;
  const incTs = Date.parse(incoming.updatedAt || "") || 0;
  const pickIncomingPrimary = preferIncoming ? true : incTs >= exTs;
  const primary = pickIncomingPrimary ? incoming : existing;
  const secondary = pickIncomingPrimary ? existing : incoming;
  const mergedCustom = mergeCustomizationObjects(secondary.customization, primary.customization);
  const bio =
    typeof primary.bio === "string" && primary.bio.trim()
      ? primary.bio
      : typeof secondary.bio === "string"
        ? secondary.bio
        : "";
  const statusText =
    typeof primary.statusText === "string" && primary.statusText.trim()
      ? primary.statusText
      : typeof secondary.statusText === "string"
        ? secondary.statusText
        : "";
  const newestTs = Math.max(exTs, incTs);
  return {
    bio,
    statusText,
    customization: mergedCustom,
    updatedAt: newestTs > 0 ? new Date(newestTs).toISOString() : primary.updatedAt || secondary.updatedAt || new Date().toISOString(),
  };
}

function mergeUserProfilesDict(
  remoteObj,
  localObj,
  { deletedKeys = new Set(), dirtyKeys = new Set(), clearedLastfm = new Set() } = {},
) {
  const out = {};
  if (remoteObj && typeof remoteObj === "object" && !Array.isArray(remoteObj)) {
    for (const [k, v] of Object.entries(remoteObj)) {
      const lower = String(k || "").trim().toLowerCase();
      if (!lower || deletedKeys.has(lower) || !v || typeof v !== "object") continue;
      out[lower] = v;
    }
  }
  if (localObj && typeof localObj === "object" && !Array.isArray(localObj)) {
    for (const [k, v] of Object.entries(localObj)) {
      const lower = String(k || "").trim().toLowerCase();
      if (!lower || deletedKeys.has(lower) || !v || typeof v !== "object") continue;
      const merged = mergeSingleUserProfileEntry(out[lower], v, {
        preferIncoming: dirtyKeys.has(lower),
      });
      if (clearedLastfm.has(lower) && merged?.customization) {
        merged.customization.lastfmUsername = "";
      }
      out[lower] = merged;
    }
  }
  return out;
}

function mergeKvValueBeforeRemoteWrite(key, remoteVal, localVal) {
  if (remoteVal === null || remoteVal === undefined) return localVal;
  const k = String(key);
  if (k === "user_profiles_v2") {
    const deletedSet = new Set([...getDeletedUsersSet(), ...deletedProfileKeys]);
    return mergeUserProfilesDict(remoteVal, localVal, {
      deletedKeys: deletedSet,
      dirtyKeys: locallyDirtyProfileKeys,
      clearedLastfm: clearedLastfmKeys,
    });
  }
  if (k === STUDIO_GAMES_KV_KEY) {
    return mergeStudioGamesLists(Array.isArray(remoteVal) ? remoteVal : [], Array.isArray(localVal) ? localVal : []);
  }
  if (k === STUDIO_PROFILES_KV_KEY) {
    return mergeStudioProfilesLists(Array.isArray(remoteVal) ? remoteVal : [], Array.isArray(localVal) ? localVal : []);
  }
  if (k === "chat_groups_v1" && typeof remoteVal === "object" && typeof localVal === "object") {
    return { ...remoteVal, ...localVal };
  }
  if (k === "chat_timeouts_v1" && typeof remoteVal === "object" && typeof localVal === "object") {
    const now = Date.now();
    const merged = { ...remoteVal, ...localVal };
    for (const [uk, tv] of Object.entries(merged)) {
      if (!tv || (tv.until !== -1 && Number(tv.until) <= now)) delete merged[uk];
    }
    return merged;
  }
  if (k === "chat_history_v1" && Array.isArray(remoteVal) && Array.isArray(localVal)) {
    const byId = new Map();
    for (const m of [...remoteVal, ...localVal]) {
      if (!m || !m.id) continue;
      const prev = byId.get(m.id);
      if (!prev || Number(m.editedAt || 0) >= Number(prev.editedAt || 0)) byId.set(m.id, m);
    }
    return Array.from(byId.values())
      .sort((a, b) => (Date.parse(a.timestamp || "") || 0) - (Date.parse(b.timestamp || "") || 0))
      .slice(-250);
  }
  if ((k === "staff_moderators_v1" || k === "goat_users_v1" || k === "deleted_users_v1") && Array.isArray(remoteVal) && Array.isArray(localVal)) {
    return Array.from(new Set([...remoteVal, ...localVal].map((s) => String(s || "").trim().toLowerCase()).filter(Boolean)));
  }
  if (k === "staff_user_notes_deleted_v1" && Array.isArray(remoteVal) && Array.isArray(localVal)) {
    return Array.from(new Set([...remoteVal, ...localVal].map((s) => String(s || "").trim()).filter(Boolean))).slice(-300);
  }
  if (k === "staff_action_logs_v1" && Array.isArray(remoteVal) && Array.isArray(localVal)) {
    const byId = new Map();
    for (const item of [...remoteVal, ...localVal]) {
      if (!item || !item.id) continue;
      byId.set(String(item.id), item);
    }
    return Array.from(byId.values())
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
      .slice(-MAX_STAFF_ACTION_LOGS);
  }
  if (k === "staff_user_notes_v1" && typeof remoteVal === "object" && typeof localVal === "object") {
    const merged = {};
    const keys = new Set([...Object.keys(remoteVal || {}), ...Object.keys(localVal || {})]);
    for (const uk of keys) {
      const rArr = Array.isArray(remoteVal?.[uk]) ? remoteVal[uk] : [];
      const lArr = Array.isArray(localVal?.[uk]) ? localVal[uk] : [];
      const byId = new Map();
      for (const n of [...rArr, ...lArr]) {
        if (!n || !n.id || deletedStaffNoteIds.has(String(n.id))) continue;
        byId.set(String(n.id), n);
      }
      const list = Array.from(byId.values())
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .slice(0, MAX_NOTES_PER_USER);
      if (list.length > 0) merged[uk] = list;
    }
    return merged;
  }
  if (remoteVal && typeof remoteVal === "object" && !Array.isArray(remoteVal) && localVal && typeof localVal === "object" && !Array.isArray(localVal)) {
    return { ...remoteVal, ...localVal };
  }
  return localVal;
}

function extractCustomizationFromSyncPayload(username, payloadJsonOrObj) {
  const lower = String(username || "").trim().toLowerCase();
  if (!lower || !payloadJsonOrObj) return null;
  let parsedPayload = payloadJsonOrObj;
  if (typeof payloadJsonOrObj === "string") {
    try {
      parsedPayload = JSON.parse(payloadJsonOrObj);
    } catch {
      return null;
    }
  }
  const ls = parsedPayload?.localStorage && typeof parsedPayload.localStorage === "object"
    ? parsedPayload.localStorage
    : parsedPayload;
  if (!ls || typeof ls !== "object") return null;

  const exactKey = `cookie_profile_custom_v1:${lower}`;
  let rawVal = ls[exactKey];
  if (!rawVal) {
    for (const [k, v] of Object.entries(ls)) {
      if (typeof k === "string" && k.toLowerCase() === exactKey && v) {
        rawVal = v;
        break;
      }
    }
  }
  if (!rawVal) return null;
  let parsedCustom = rawVal;
  if (typeof rawVal === "string") {
    try {
      parsedCustom = JSON.parse(rawVal);
    } catch {
      return null;
    }
  }
  if (!parsedCustom || typeof parsedCustom !== "object") return null;
  const sanitized = sanitizeProfileCustomizationServer(parsedCustom);
  return hasMeaningfulCustomization(sanitized) ? sanitized : null;
}

function recoverUserProfileFromSyncPayload(username, payloadJsonOrObj, updatedAt = "") {
  const clean = String(username || "").trim();
  const key = clean.toLowerCase();
  if (!clean || isReservedSystemUsername(clean) || isTemporaryGuestName(clean) || getDeletedUsersSet().has(key) || deletedProfileKeys.has(key)) {
    return false;
  }
  const custom = extractCustomizationFromSyncPayload(clean, payloadJsonOrObj);
  if (!custom) return false;
  const existing = userProfiles.get(key);
  if (existing && hasMeaningfulCustomization(existing.customization)) {
    // Only fill missing sub-fields if recovered backup is newer or fills missing media
    const merged = mergeSingleUserProfileEntry(
      existing,
      { bio: existing.bio || "", statusText: existing.statusText || "", customization: custom, updatedAt: updatedAt || existing.updatedAt || "" },
      { preferIncoming: false }
    );
    if (JSON.stringify(merged.customization) === JSON.stringify(existing.customization)) {
      return false;
    }
    userProfiles.set(key, merged);
    locallyDirtyProfileKeys.add(key);
    return true;
  }
  userProfiles.set(key, {
    bio: existing?.bio || "",
    statusText: existing?.statusText || "",
    customization: custom,
    updatedAt: updatedAt || existing?.updatedAt || new Date().toISOString(),
  });
  locallyDirtyProfileKeys.add(key);
  return true;
}

function recoverProfilesFromChatHistory(messages = (typeof chatHistory !== "undefined" ? chatHistory : [])) {
  let recoveredCount = 0;
  const deleted = getDeletedUsersSet();
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const author = String(msg?.author || "").trim();
      const key = author.toLowerCase();
      if (!author || isTemporaryGuestName(author) || deleted.has(key) || deletedProfileKeys.has(key)) continue;
      if (msg?.customization && hasMeaningfulCustomization(msg.customization)) {
        const sanitized = sanitizeProfileCustomizationServer(msg.customization);
        const existing = userProfiles.get(key);
        if (!existing || !hasMeaningfulCustomization(existing.customization)) {
          userProfiles.set(key, {
            bio: existing?.bio || "",
            statusText: existing?.statusText || "",
            customization: sanitized,
            updatedAt: existing?.updatedAt || msg.timestamp || new Date().toISOString(),
          });
          locallyDirtyProfileKeys.add(key);
          recoveredCount++;
        }
      }
    }
  }
  return recoveredCount;
}

function recoverProfilesFromLocalSqliteAndHistory() {
  if (localProfileRecoveryDone) return 0;
  localProfileRecoveryDone = true;
  const deleted = getDeletedUsersSet();

  // 1. Recover any non-default profile customizations stored on recent chat messages
  let recoveredCount = recoverProfilesFromChatHistory();

  // 2. Recover saved cookie_profile_custom_v1:* blobs from local SQLite sync_json & legacy app_kv backups
  try {
    const db = openCloudSyncDb(true);
    try {
      const syncRows = db
        .query("SELECT u.username, sj.payload_json, sj.updated_at FROM sync_json sj JOIN users u ON u.id = sj.user_id")
        .all();
      for (const sr of syncRows || []) {
        if (sr?.username && sr?.payload_json) {
          if (recoverUserProfileFromSyncPayload(sr.username, sr.payload_json, sr.updated_at || "")) {
            recoveredCount++;
          }
        }
      }
      const backupKvRows = db
        .query("SELECT k, v FROM app_kv WHERE k LIKE 'user_profiles%'")
        .all();
      for (const bkv of backupKvRows || []) {
        if (!bkv?.v || typeof bkv.v !== "string") continue;
        try {
          const parsed = JSON.parse(bkv.v);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            for (const [pk, pv] of Object.entries(parsed)) {
              const lower = String(pk || "").trim().toLowerCase();
              if (!lower || deleted.has(lower) || deletedProfileKeys.has(lower) || !pv || typeof pv !== "object") continue;
              const merged = mergeSingleUserProfileEntry(userProfiles.get(lower), pv, { preferIncoming: false });
              if (!userProfiles.has(lower) || (!hasMeaningfulCustomization(userProfiles.get(lower)?.customization) && hasMeaningfulCustomization(merged?.customization))) {
                userProfiles.set(lower, merged);
                locallyDirtyProfileKeys.add(lower);
                recoveredCount++;
              }
            }
          }
        } catch {}
      }
    } finally {
      db.close();
    }
  } catch {}

  if (recoveredCount > 0) {
    persistUserProfilesLocalOnly();
  }
  return recoveredCount;
}

async function recoverMissingProfilesFromSupabaseSyncAsync() {
  // Egress guard: once remote user_profiles_v2 is hydrated in RAM, only run batch recovery if userProfiles is completely empty
  if (
    !USE_SUPABASE_CLOUDSYNC ||
    !hasLoadedRemoteKvSuccessfully ||
    isSupabaseDegraded() ||
    supabaseProfilesBackfillStarted ||
    userProfiles.size > 0
  ) {
    supabaseProfilesBackfillStarted = true;
    return 0;
  }
  supabaseProfilesBackfillStarted = true;
  try {
    const csMap = await getCloudSyncUsersMapAsync().catch(() => new Map());
    const deleted = getDeletedUsersSet();
    const candidates = [];
    for (const [k, rec] of csMap.entries()) {
      const uid = Number(rec?.id) || 0;
      if (uid <= 0 || deleted.has(k) || deletedProfileKeys.has(k)) continue;
      const existing = userProfiles.get(k);
      if (!existing || !hasMeaningfulCustomization(existing.customization)) {
        candidates.push({ id: uid, username: rec.username, key: k });
      }
    }
    if (candidates.length === 0) return 0;

    let recovered = 0;
    const uncachedCandidates = [];
    for (const c of candidates) {
      const cachedBlob = cloudSyncBlobCache.get(Number(c.id));
      if (cachedBlob && cachedBlob.payload_json) {
        if (recoverUserProfileFromSyncPayload(c.username, cachedBlob.payload_json, cachedBlob.updated_at || "")) {
          recovered++;
        }
      } else {
        uncachedCandidates.push(c);
      }
    }

    const batchSize = 5; // Small chunks so Postgres never allocates large concurrent TOAST buffers
    const maxBatches = 8; // Up to 40 uncached missing profiles per startup
    for (let i = 0; i < uncachedCandidates.length && i < batchSize * maxBatches; i += batchSize) {
      if (isSupabaseDegraded()) break;
      const batch = uncachedCandidates.slice(i, i + batchSize);
      const idToUser = new Map(batch.map((c) => [c.id, c.username]));
      const batchIds = batch.map((c) => Number(c.id));
      const res = await aivenDb
        .query(
          "SELECT user_id, payload_json, updated_at FROM public.cloudsync_sync WHERE user_id = ANY($1::bigint[]) LIMIT 5",
          [batchIds]
        )
        .catch(() => null);
      if (!res || !Array.isArray(res.rows)) break;
      for (const row of res.rows) {
        const uid = Number(row?.user_id);
        const uname = idToUser.get(uid);
        if (row?.payload_json && uid > 0) {
          cloudSyncBlobCache.set(uid, {
            payload_json: String(row.payload_json),
            updated_at: row.updated_at ? String(row.updated_at) : null,
          });
        }
        if (uname && row?.payload_json) {
          if (recoverUserProfileFromSyncPayload(uname, row.payload_json, row.updated_at || "")) {
            recovered++;
          }
        }
      }
    }
    if (recovered > 0) {
      console.log(`[profiles] Recovered ${recovered} user profile customization(s) from cloudsync_sync`);
      persistUserProfiles();
      broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    }
    return recovered;
  } catch {
    return 0;
  }
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
    const deleted = getDeletedUsersSet();
    for (const [k, v] of Object.entries(profs)) {
      const lower = String(k || "").trim().toLowerCase();
      if (!lower || deleted.has(lower) || deletedProfileKeys.has(lower) || !v || typeof v !== "object") continue;
      lastRemoteUserProfilesSnapshot[lower] = v;
      userProfiles.set(
        lower,
        mergeSingleUserProfileEntry(userProfiles.get(lower), v, { preferIncoming: false })
      );
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
  if (Array.isArray(hist) && typeof chatHistory !== "undefined") {
    const byId = new Map();
    for (const m of [...hist, ...chatHistory]) {
      if (!m || typeof m !== "object" || !m.id || !m.author || !m.channel) continue;
      const idStr = String(m.id);
      if (deletedChatMessageIds.has(idStr)) continue;
      byId.set(idStr, m);
    }
    const merged = trimChatHistoryPerChannel(Array.from(byId.values()));
    chatHistory.splice(0, chatHistory.length, ...merged);
  }
  if (Array.isArray(hist)) {
    recoverProfilesFromChatHistory(hist);
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
  const storedChannels = kvMap.chat_channels_v1;
  if (Array.isArray(storedChannels) && storedChannels.length > 0) {
    const sanitized = storedChannels
      .filter((c) => c && typeof c === "object" && c.id && c.name)
      .map((c) => ({
        id: String(c.id).trim().slice(0, 40),
        name: String(c.name).trim().slice(0, 32),
        icon: String(c.icon || "fa-hashtag").trim().slice(0, 40) || "fa-hashtag",
        categoryId: String(c.categoryId || "social").trim().slice(0, 32) || "social",
        categoryLabel: String(c.categoryLabel || c.categoryId || "social").trim().slice(0, 32) || "social",
        visibility: c.visibility === "staff" ? "staff" : "all",
        writeAccess: c.writeAccess === "staff" ? "staff" : "all",
        ...(c.createdAt ? { createdAt: Number(c.createdAt) } : {}),
        ...(c.updatedAt ? { updatedAt: Number(c.updatedAt) } : {}),
        ...(c.updatedBy ? { updatedBy: String(c.updatedBy) } : {}),
      }));
    if (sanitized.length > 0) {
      chatChannels.splice(0, chatChannels.length, ...sanitized);
      if (!chatChannels.some((c) => c.id === "staff-chat")) {
        chatChannels.splice(3, 0, {
          id: "staff-chat",
          name: "staff-chat",
          icon: "fa-user-shield",
          categoryId: "staff",
          categoryLabel: "staff",
          visibility: "staff",
          writeAccess: "staff",
        });
      }
    }
  }
  const storedBackgrounds = kvMap.chat_backgrounds_v1;
  if (storedBackgrounds && typeof storedBackgrounds === "object") {
    for (const [chId, rawUrl] of Object.entries(storedBackgrounds)) {
      const cleanCh = String(chId || "").trim().slice(0, 120);
      const cleanUrl = typeof rawUrl === "string" ? rawUrl.trim().slice(0, 1200) : "";
      if (cleanCh && cleanUrl) {
        chatBackgrounds.set(cleanCh, cleanUrl);
      }
    }
  }
  const sGames = kvMap[STUDIO_GAMES_KV_KEY];
  if (Array.isArray(sGames)) {
    const mergedGames = mergeStudioGamesLists(publishedStudioGames, sGames);
    publishedStudioGames.splice(0, publishedStudioGames.length, ...mergedGames);
  }
  const sStudios = kvMap[STUDIO_PROFILES_KV_KEY];
  if (Array.isArray(sStudios)) {
    const mergedStudios = mergeStudioProfilesLists(customStudios, sStudios);
    customStudios.splice(0, customStudios.length, ...mergedStudios);
  }
  const delNoteIds = kvMap.staff_user_notes_deleted_v1;
  if (Array.isArray(delNoteIds)) {
    for (const nid of delNoteIds) {
      const cleanId = String(nid || "").trim();
      if (cleanId) deletedStaffNoteIds.add(cleanId);
    }
  }
  const sLogs = kvMap.staff_action_logs_v1;
  if (Array.isArray(sLogs)) {
    const byId = new Map();
    for (const item of [...staffActionLogs, ...sLogs]) {
      if (!item || typeof item !== "object" || !item.id || !item.action) continue;
      byId.set(String(item.id), item);
    }
    const mergedLogs = Array.from(byId.values())
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
      .slice(-MAX_STAFF_ACTION_LOGS);
    staffActionLogs.splice(0, staffActionLogs.length, ...mergedLogs);
  }
  const sNotes = kvMap.staff_user_notes_v1;
  if (sNotes && typeof sNotes === "object") {
    for (const [rawKey, list] of Object.entries(sNotes)) {
      const uk = String(rawKey || "").trim().toLowerCase();
      if (!uk || !Array.isArray(list)) continue;
      const existing = staffUserNotes.get(uk) || [];
      const byId = new Map();
      for (const n of [...existing, ...list]) {
        if (!n || typeof n !== "object" || !n.id || !n.note) continue;
        if (deletedStaffNoteIds.has(String(n.id))) continue;
        byId.set(String(n.id), n);
      }
      const nextList = Array.from(byId.values())
        .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
        .slice(0, MAX_NOTES_PER_USER);
      if (nextList.length > 0) staffUserNotes.set(uk, nextList);
      else staffUserNotes.delete(uk);
    }
  }
  const sBannedDevs = kvMap.banned_devices_v1;
  if (Array.isArray(sBannedDevs)) {
    const byId = new Map();
    for (const item of [...bannedDevices, ...sBannedDevs]) {
      if (!item || typeof item !== "object") continue;
      const fp = String(item.fingerprint_id || "").trim();
      const st = String(item.storage_token || "").trim();
      if (!fp && !st) continue;
      const id = String(item.id || `${fp}:${st}`);
      byId.set(id, {
        id,
        fingerprint_id: fp,
        storage_token: st,
        banned_username: String(item.banned_username || "").trim(),
        banned_reason: String(item.banned_reason || "").trim(),
        high_confidence_spam: Boolean(item.high_confidence_spam),
        created_at: item.created_at || new Date().toISOString(),
      });
    }
    bannedDevices.splice(0, bannedDevices.length, ...Array.from(byId.values()).slice(-1000));
  }
  const sShadow = kvMap.shadowbanned_users_v1;
  if (Array.isArray(sShadow)) {
    for (const u of sShadow) {
      const clean = String(u || "").trim().toLowerCase();
      if (clean && !OWNER_USERNAMES.has(clean)) shadowbannedUsers.add(clean);
    }
  }
  const sDevMap = kvMap.user_device_map_v1;
  if (sDevMap && typeof sDevMap === "object") {
    for (const [uk, val] of Object.entries(sDevMap)) {
      const cleanK = String(uk || "").trim().toLowerCase();
      if (!cleanK || !val || typeof val !== "object") continue;
      userDeviceMap.set(cleanK, {
        fingerprint_id: String(val.fingerprint_id || "").trim().slice(0, 120),
        storage_token: String(val.storage_token || "").trim().slice(0, 120),
        updatedAt: Number(val.updatedAt) || Date.now(),
      });
    }
  }
  const sCreatedMap = kvMap.user_created_at_v1;
  if (sCreatedMap && typeof sCreatedMap === "object") {
    for (const [uk, ts] of Object.entries(sCreatedMap)) {
      const cleanK = String(uk || "").trim().toLowerCase();
      const numTs = Number(ts) || 0;
      if (cleanK && numTs > 0) userCreatedAtMap.set(cleanK, numTs);
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
    chat_channels_v1: kvGetJson("chat_channels_v1", []),
    chat_backgrounds_v1: kvGetJson("chat_backgrounds_v1", {}),
    staff_action_logs_v1: kvGetJson("staff_action_logs_v1", []),
    staff_user_notes_v1: kvGetJson("staff_user_notes_v1", {}),
    staff_user_notes_deleted_v1: kvGetJson("staff_user_notes_deleted_v1", []),
    banned_devices_v1: kvGetJson("banned_devices_v1", []),
    shadowbanned_users_v1: kvGetJson("shadowbanned_users_v1", []),
    user_device_map_v1: kvGetJson("user_device_map_v1", {}),
    user_created_at_v1: kvGetJson("user_created_at_v1", {}),
    [STUDIO_GAMES_KV_KEY]: kvGetJson(STUDIO_GAMES_KV_KEY, []),
    [STUDIO_PROFILES_KV_KEY]: kvGetJson(STUDIO_PROFILES_KV_KEY, []),
  });
  try {
    const db = openCloudSyncDb(true);
    const localBans = db
      .query(
        "SELECT id, fingerprint_id, storage_token, banned_username, banned_reason, high_confidence_spam, created_at FROM banned_devices"
      )
      .all();
    for (const b of localBans || []) {
      const fp = String(b?.fingerprint_id || "").trim();
      const st = String(b?.storage_token || "").trim();
      if (!fp && !st) continue;
      if (!bannedDevices.some((x) => x.fingerprint_id === fp && x.storage_token === st)) {
        bannedDevices.push({
          id: String(b.id || `${fp}:${st}`),
          fingerprint_id: fp,
          storage_token: st,
          banned_username: String(b.banned_username || ""),
          banned_reason: String(b.banned_reason || ""),
          high_confidence_spam: Boolean(b.high_confidence_spam),
          created_at: b.created_at || new Date().toISOString(),
        });
      }
    }
    const localUsers = db
      .query(
        "SELECT username, last_fingerprint_id, last_storage_token, is_shadowbanned, created_at FROM users"
      )
      .all();
    for (const u of localUsers || []) {
      const uk = String(u?.username || "").trim().toLowerCase();
      if (!uk) continue;
      if (u.is_shadowbanned && !OWNER_USERNAMES.has(uk)) shadowbannedUsers.add(uk);
      const fp = String(u.last_fingerprint_id || "").trim();
      const st = String(u.last_storage_token || "").trim();
      if ((fp || st) && !userDeviceMap.has(uk)) {
        userDeviceMap.set(uk, { fingerprint_id: fp, storage_token: st, updatedAt: Date.now() });
      }
      if (u.created_at && !userCreatedAtMap.has(uk)) {
        const parsed = Date.parse(String(u.created_at));
        if (Number.isFinite(parsed) && parsed > 0) userCreatedAtMap.set(uk, parsed);
      }
    }
  } catch {}
  recoverProfilesFromLocalSqliteAndHistory();
}

function persistBannedDevices() {
  kvSetJson("banned_devices_v1", bannedDevices.slice(-1000));
}

function persistShadowbannedUsers() {
  kvSetJson("shadowbanned_users_v1", Array.from(shadowbannedUsers));
}

function persistUserDeviceMap() {
  const out = {};
  let count = 0;
  for (const [k, v] of userDeviceMap.entries()) {
    out[k] = v;
    if (++count >= 5000) break;
  }
  kvSetJson("user_device_map_v1", out);
}

function persistUserCreatedAtMap() {
  const out = {};
  let count = 0;
  for (const [k, v] of userCreatedAtMap.entries()) {
    out[k] = v;
    if (++count >= 5000) break;
  }
  kvSetJson("user_created_at_v1", out);
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamailblock.com",
  "sharklasers.com",
  "grr.la",
  "pokemail.net",
  "spam4.me",
  "10minutemail.com",
  "10minutemail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "trashmail.com",
  "getnada.com",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "throwawaymail.com",
  "mailnesia.com",
  "mohmal.com",
]);

function isDisposableEmailDomain(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return false;
  const domainPart = raw.includes("@") ? raw.split("@").pop() || "" : raw;
  for (const dom of DISPOSABLE_EMAIL_DOMAINS) {
    if (domainPart === dom || domainPart.endsWith(`.${dom}`) || raw.includes(dom)) {
      return true;
    }
  }
  return false;
}

async function verifyTurnstileToken(token, remoteIp = "") {
  const cleanToken = String(token || "").trim();
  if (cleanToken === "INVALID_TURNSTILE_TEST_TOKEN") return false;
  if (!TURNSTILE_SECRET_KEY) return true;
  if (!cleanToken) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", TURNSTILE_SECRET_KEY);
    form.set("response", cleanToken);
    if (remoteIp) form.set("remoteip", String(remoteIp));
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await res.json().catch(() => null);
    return Boolean(data && data.success);
  } catch {
    return true;
  }
}

const SPAM_LEET_MAP = {
  "@": "a",
  "4": "a",
  "3": "e",
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "$": "s",
  "5": "s",
  "7": "t",
  "+": "t",
};

function normalizeSpamText(rawText) {
  const lower = String(rawText || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let mapped = "";
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    mapped += SPAM_LEET_MAP[ch] || ch;
  }
  const wordsOnly = mapped
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
  const compact = wordsOnly.replace(/\s+/g, "");
  return { lower, wordsOnly, compact };
}

const SPAM_REGEX_BLOCKLIST = [
  /\b(op|operation)\s*cookie\s*(sucks|is\s*trash|is\s*bad|is\s*ass|is\s*garbage)\b/i,
  /opcookiesucks|operationcookiesucks/i,
  /\bgamm?a\s*(is\s*better|on\s*top|wins|>\s*cookie|beats\s*cookie)\b/i,
  /gamm?aisbetter|gamm?aontop/i,
  /\b(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/i,
  /\bdiscord(?:\.gg|app\.com\/invite)\/[a-z0-9-]+/i,
  /\b[a-z0-9-]{2,}\.(?:xyz|gg|site|online|click|top|buzz|club|fun|icu|tk|ml|ga|cf)(?:\/[^\s]*)?\b/i,
];

function matchesSpamFilter(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;
  const { lower, wordsOnly, compact } = normalizeSpamText(text);
  for (const rx of SPAM_REGEX_BLOCKLIST) {
    if (rx.test(text) || rx.test(lower) || rx.test(wordsOnly) || rx.test(compact)) {
      return rx.source;
    }
  }
  return null;
}

function detectTextSpamViolation(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;
  if (/(.)\1{11,}/u.test(text)) {
    return "AutoMod: Please don't flood chat with repeated characters.";
  }
  if (/\b(\S+)(?:\s+\1){5,}/i.test(text)) {
    return "AutoMod: Please don't spam repeated words.";
  }
  const newlineCount = (text.match(/\n/g) || []).length;
  if (newlineCount >= 8) {
    return "AutoMod: Too many line breaks in one message.";
  }
  const tokens = text.split(/\s+/);
  for (const tok of tokens) {
    if (tok.length >= 55 && !/^https?:\/\//i.test(tok)) {
      return "AutoMod: Please don't send wall-of-text character floods.";
    }
  }
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 26) {
    const uppers = letters.replace(/[^A-Z]/g, "").length;
    if (uppers / letters.length >= 0.85) {
      return "AutoMod: Please turn off CAPS LOCK (excessive all-caps spam).";
    }
  }
  return null;
}

function recordUserDeviceSignature(username, { fingerprint_id = "", storage_token = "" } = {}) {
  const cleanUser = String(username || "").trim();
  const uk = cleanUser.toLowerCase();
  const fp = String(fingerprint_id || "").trim().slice(0, 120);
  const st = String(storage_token || "").trim().slice(0, 120);
  if (!uk || (!fp && !st)) return;
  const prev = userDeviceMap.get(uk) || { fingerprint_id: "", storage_token: "", updatedAt: 0 };
  const next = {
    fingerprint_id: fp || prev.fingerprint_id,
    storage_token: st || prev.storage_token,
    updatedAt: Date.now(),
  };
  userDeviceMap.set(uk, next);
  persistUserDeviceMap();

  try {
    const db = openCloudSyncDb(false);
    db.query(
      "UPDATE users SET last_fingerprint_id = CASE WHEN ? != '' THEN ? ELSE last_fingerprint_id END, last_storage_token = CASE WHEN ? != '' THEN ? ELSE last_storage_token END WHERE LOWER(username) = LOWER(?)"
    ).run(next.fingerprint_id, next.fingerprint_id, next.storage_token, next.storage_token, cleanUser);
  } catch {}

  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    void aivenDb
      .query(
        `UPDATE public.cloudsync_users
         SET last_fingerprint_id = CASE WHEN $1 <> '' THEN $1 ELSE last_fingerprint_id END,
             last_storage_token = CASE WHEN $2 <> '' THEN $2 ELSE last_storage_token END
         WHERE username_lower = $3`,
        [next.fingerprint_id || "", next.storage_token || "", uk]
      )
      .catch(() => {});
  }
}

function checkDeviceBanForSignup({ fingerprint_id = "", storage_token = "", highConfidenceSpam = false } = {}) {
  ensureChatMetaLoaded();
  const fp = String(fingerprint_id || "").trim();
  const st = String(storage_token || "").trim();
  if (!fp && !st) {
    return { hardBlocked: false, shadowban: false, matchedEntry: null };
  }
  if (st) {
    const tokenMatch = bannedDevices.find((b) => b.storage_token && b.storage_token === st);
    if (tokenMatch) {
      return { hardBlocked: true, shadowban: false, matchedEntry: tokenMatch };
    }
  }
  if (fp) {
    const fpMatches = bannedDevices.filter((b) => b.fingerprint_id && b.fingerprint_id === fp);
    if (fpMatches.length > 0) {
      const spamFlagged = fpMatches.find((b) => b.high_confidence_spam) || (highConfidenceSpam ? fpMatches[0] : null);
      if (spamFlagged || highConfidenceSpam) {
        return { hardBlocked: true, shadowban: false, matchedEntry: spamFlagged || fpMatches[0] };
      }
      return { hardBlocked: false, shadowban: true, matchedEntry: fpMatches[0] };
    }
  }
  return { hardBlocked: false, shadowban: false, matchedEntry: null };
}

function isAccountShadowbanned(username) {
  ensureChatMetaLoaded();
  const uk = String(username || "").trim().toLowerCase();
  if (!uk || OWNER_USERNAMES.has(uk) || staffModerators.has(uk)) return false;
  return shadowbannedUsers.has(uk);
}

function setAccountShadowbanned(
  username,
  shadowbanned = true,
  { reason = "", recordDevice = false, highConfidenceSpam = false } = {}
) {
  ensureChatMetaLoaded();
  const cleanUser = String(username || "").trim();
  const uk = cleanUser.toLowerCase();
  if (!uk || OWNER_USERNAMES.has(uk)) return;
  if (shadowbanned) {
    shadowbannedUsers.add(uk);
  } else {
    shadowbannedUsers.delete(uk);
  }
  persistShadowbannedUsers();

  try {
    const db = openCloudSyncDb(false);
    db.query("UPDATE users SET is_shadowbanned = ? WHERE LOWER(username) = LOWER(?)").run(
      shadowbanned ? 1 : 0,
      cleanUser
    );
  } catch {}

  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    void aivenDb
      .query("UPDATE public.cloudsync_users SET is_shadowbanned = $1 WHERE username_lower = $2", [
        Boolean(shadowbanned),
        uk,
      ])
      .catch(() => {});
  }

  if (shadowbanned && recordDevice) {
    const sig = userDeviceMap.get(uk);
    if (sig && (sig.fingerprint_id || sig.storage_token)) {
      addBannedDeviceRecord({
        fingerprint_id: sig.fingerprint_id,
        storage_token: sig.storage_token,
        banned_username: cleanUser,
        banned_reason: reason || "auto-shadowban spam filter",
        high_confidence_spam: Boolean(highConfidenceSpam),
      });
    }
  }
}

function addBannedDeviceRecord({
  fingerprint_id = "",
  storage_token = "",
  banned_username = "",
  banned_reason = "",
  high_confidence_spam = false,
} = {}) {
  ensureChatMetaLoaded();
  const fp = String(fingerprint_id || "").trim().slice(0, 120);
  const st = String(storage_token || "").trim().slice(0, 120);
  if (!fp && !st) return null;
  const id = `bdev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    id,
    fingerprint_id: fp,
    storage_token: st,
    banned_username: String(banned_username || "").trim(),
    banned_reason: String(banned_reason || "banned by staff").trim().slice(0, 200),
    high_confidence_spam: Boolean(high_confidence_spam),
    created_at: new Date().toISOString(),
  };
  const existingIdx = bannedDevices.findIndex(
    (b) =>
      (st && b.storage_token === st) ||
      (fp && !st && b.fingerprint_id === fp && !b.storage_token)
  );
  if (existingIdx >= 0) {
    bannedDevices[existingIdx] = {
      ...bannedDevices[existingIdx],
      ...entry,
      id: bannedDevices[existingIdx].id,
    };
  } else {
    bannedDevices.push(entry);
  }
  persistBannedDevices();

  try {
    const db = openCloudSyncDb(false);
    db.query(
      "INSERT OR REPLACE INTO banned_devices (id, fingerprint_id, storage_token, banned_username, banned_reason, high_confidence_spam, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      entry.id,
      entry.fingerprint_id,
      entry.storage_token,
      entry.banned_username,
      entry.banned_reason,
      entry.high_confidence_spam ? 1 : 0,
      entry.created_at
    );
  } catch {}

  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    void aivenDb
      .query(
        `INSERT INTO public.banned_devices
         (fingerprint_id, storage_token, banned_username, banned_reason, high_confidence_spam, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.fingerprint_id,
          entry.storage_token,
          entry.banned_username,
          entry.banned_reason,
          Boolean(entry.high_confidence_spam),
          entry.created_at,
        ]
      )
      .catch(() => {});
  }
  return entry;
}

function wipeUserChatAndMentions(targetUsername) {
  const clean = String(targetUsername || "").trim().replace(/^@/, "");
  const uk = clean.toLowerCase();
  if (!uk || OWNER_USERNAMES.has(uk)) return 0;

  const escaped = uk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionRe = new RegExp(`(^|[^a-zA-Z0-9_])@${escaped}(?=$|[^a-zA-Z0-9_])`, "gi");
  let changed = 0;

  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const m = chatHistory[i];
    if (!m) continue;
    if (String(m.author || "").trim().toLowerCase() === uk) {
      if (m.id) deletedChatMessageIds.add(String(m.id));
      chatHistory.splice(i, 1);
      changed++;
      continue;
    }

    let msgModified = false;
    if (m.replyTo && String(m.replyTo.author || "").trim().toLowerCase() === uk) {
      delete m.replyTo;
      msgModified = true;
    }
    if (Array.isArray(m.mentions)) {
      const nextMentions = m.mentions.filter(
        (u) => String(u || "").trim().replace(/^@/, "").toLowerCase() !== uk
      );
      if (nextMentions.length !== m.mentions.length) {
        m.mentions = nextMentions;
        msgModified = true;
      }
    }
    if (m.reactions && typeof m.reactions === "object") {
      for (const [emoji, users] of Object.entries(m.reactions)) {
        if (Array.isArray(users)) {
          const filtered = users.filter((u) => String(u || "").trim().toLowerCase() !== uk);
          if (filtered.length !== users.length) {
            if (filtered.length === 0) delete m.reactions[emoji];
            else m.reactions[emoji] = filtered;
            msgModified = true;
          }
        }
      }
    }
    if (typeof m.text === "string" && mentionRe.test(m.text)) {
      mentionRe.lastIndex = 0;
      const cleanedText = m.text
        .replace(mentionRe, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      const hasMedia = Boolean(
        m.image || m.media || m.attachment || m.sticker || m.embed || m.file
      );
      if (!cleanedText && !hasMedia) {
        if (m.id) deletedChatMessageIds.add(String(m.id));
        chatHistory.splice(i, 1);
        changed++;
        continue;
      }
      m.text = cleanedText;
      msgModified = true;
    }
    if (msgModified) changed++;
  }

  if (changed > 0) {
    persistChatHistory();
  }

  knownUsers.delete(uk);
  for (const [hid, hb] of httpHeartbeats.entries()) {
    const hu = String(hb?.verifiedUsername || hb?.username || "").trim().toLowerCase();
    if (hu === uk) {
      httpHeartbeats.delete(hid);
    }
  }
  if (cloudSyncUsersCache.map) {
    cloudSyncUsersCache.map.delete(uk);
  }
  invalidateCloudSyncUsersCache();

  broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
  broadcastToClients(
    {
      type: "chat-event",
      event: "USER_WIPED",
      targetUsername: clean,
    },
    "all"
  );
  return changed;
}

async function banUserAndDevice(
  targetUsername,
  { reason = "device banned by staff", highConfidenceSpam = true } = {}
) {
  ensureChatMetaLoaded();
  const clean = String(targetUsername || "").trim().replace(/^@/, "");
  const uk = clean.toLowerCase();
  if (!uk || OWNER_USERNAMES.has(uk)) return { bannedDevice: null };

  const sig = userDeviceMap.get(uk) || { fingerprint_id: "", storage_token: "" };
  let bannedDevice = null;
  if (sig.fingerprint_id || sig.storage_token) {
    bannedDevice = addBannedDeviceRecord({
      fingerprint_id: sig.fingerprint_id,
      storage_token: sig.storage_token,
      banned_username: clean,
      banned_reason: reason,
      high_confidence_spam: highConfidenceSpam,
    });
  }

  setAccountShadowbanned(clean, true, { reason, recordDevice: false });

  let nextTokenVer = 2;
  try {
    const db = openCloudSyncDb(false);
    const localRow = db
      .query("SELECT id, token_version FROM users WHERE LOWER(username) = LOWER(?)")
      .get(clean);
    if (localRow) {
      nextTokenVer = (Number(localRow.token_version) || 1) + 1;
      db.query("UPDATE users SET token_version = ?, is_shadowbanned = 1 WHERE id = ?").run(
        nextTokenVer,
        localRow.id
      );
      evictCloudSyncUserRecord({ userId: localRow.id, username: clean });
    } else {
      evictCloudSyncUserRecord({ username: clean });
    }
  } catch {}

  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const row = await dbFindUserByUsername(clean);
      if (row?.id) {
        nextTokenVer = Math.max(nextTokenVer, (Number(row.token_version) || 1) + 1);
        await aivenDb.query(
          "UPDATE public.cloudsync_users SET token_version = $1, is_shadowbanned = TRUE WHERE id = $2",
          [nextTokenVer, Number(row.id)]
        );
        evictCloudSyncUserRecord({ userId: row.id, username: clean });
      }
    } catch {}
  }

  for (const [cid, client] of liveClients.entries()) {
    const cu = String(client?.verifiedUsername || client?.username || "").trim().toLowerCase();
    if (cu === uk) {
      try {
        client.res.end();
      } catch {}
      liveClients.delete(cid);
    }
  }

  const wipedCount = wipeUserChatAndMentions(clean);

  // Also shadowban & invalidate any other non-staff alt accounts sharing this exact storage_token or fingerprint_id
  const linkedAlts = new Set();
  if (sig.storage_token || sig.fingerprint_id) {
    for (const [altKey, altSig] of userDeviceMap.entries()) {
      if (!altKey || altKey === uk || OWNER_USERNAMES.has(altKey) || staffModerators.has(altKey)) continue;
      const matchesToken = sig.storage_token && altSig?.storage_token === sig.storage_token;
      const matchesFp = highConfidenceSpam && sig.fingerprint_id && altSig?.fingerprint_id === sig.fingerprint_id;
      if (matchesToken || matchesFp) linkedAlts.add(altKey);
    }
    if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
      try {
        const clauses = [];
        const params = [];
        if (sig.storage_token) {
          params.push(sig.storage_token);
          clauses.push(`last_storage_token = $${params.length}`);
        }
        if (highConfidenceSpam && sig.fingerprint_id) {
          params.push(sig.fingerprint_id);
          clauses.push(`last_fingerprint_id = $${params.length}`);
        }
        if (clauses.length > 0) {
          const altRes = await aivenDb.query(
            `SELECT id, username, token_version FROM public.cloudsync_users WHERE ${clauses.join(" OR ")} LIMIT 50`,
            params
          );
          for (const r of altRes.rows || []) {
            const altName = String(r.username || "").trim();
            const altKey = altName.toLowerCase();
            if (!altKey || altKey === uk || OWNER_USERNAMES.has(altKey) || staffModerators.has(altKey)) continue;
            linkedAlts.add(altName);
            const altNextVer = (Number(r.token_version) || 1) + 1;
            await aivenDb
              .query("UPDATE public.cloudsync_users SET token_version = $1, is_shadowbanned = TRUE WHERE id = $2", [
                altNextVer,
                Number(r.id),
              ])
              .catch(() => {});
            evictCloudSyncUserRecord({ userId: r.id, username: altName });
          }
        }
      } catch {}
    }
    for (const altName of linkedAlts) {
      setAccountShadowbanned(altName, true, { reason: `linked alt of banned user @${clean}`, recordDevice: false });
      const altKey = String(altName).toLowerCase();
      for (const [cid, client] of liveClients.entries()) {
        const cu = String(client?.verifiedUsername || client?.username || "").trim().toLowerCase();
        if (cu === altKey) {
          try {
            client.res.end();
          } catch {}
          liveClients.delete(cid);
        }
      }
      wipeUserChatAndMentions(altName);
    }
  }

  return { bannedDevice, signature: sig, wipedCount, linkedAlts: Array.from(linkedAlts) };
}

function getUserAccountCreatedAtMs(username) {
  ensureChatMetaLoaded();
  const clean = String(username || "").trim().replace(/^@/, "");
  const uk = clean.toLowerCase();
  if (!uk) return 0;
  if (userCreatedAtMap.has(uk)) {
    return Number(userCreatedAtMap.get(uk)) || 0;
  }
  const csMap = getCloudSyncUsersMap();
  const csRec = csMap.get(uk);
  if (csRec?.createdAt) {
    const parsed = typeof csRec.createdAt === "number" ? csRec.createdAt : Date.parse(String(csRec.createdAt));
    if (Number.isFinite(parsed) && parsed > 0) {
      userCreatedAtMap.set(uk, parsed);
      return parsed;
    }
  }
  const byName = cloudSyncUserByNameCache.get(uk);
  if (byName?.created_at) {
    const parsed = typeof byName.created_at === "number" ? byName.created_at : Date.parse(String(byName.created_at));
    if (Number.isFinite(parsed) && parsed > 0) {
      userCreatedAtMap.set(uk, parsed);
      return parsed;
    }
  }
  try {
    const db = openCloudSyncDb(true);
    const row = db.query("SELECT created_at FROM users WHERE LOWER(username) = LOWER(?)").get(clean);
    if (row?.created_at) {
      const parsed = Date.parse(String(row.created_at));
      if (Number.isFinite(parsed) && parsed > 0) {
        userCreatedAtMap.set(uk, parsed);
        return parsed;
      }
    }
  } catch {}
  return 0;
}

async function getOrCreateReservedSystemUserId(username) {
  const existing = await dbFindUserByUsername(username);
  if (existing?.id) {
    return Number(existing.id);
  }
  const created = await dbCreateUser(username, "!locked_system_kv_account!");
  if (created?.id) {
    return Number(created.id);
  }
  const refetched = await dbFindUserByUsername(username);
  return refetched?.id ? Number(refetched.id) : null;
}

async function getOrCreateSupabaseSystemKvUserId() {
  if (supabaseKvSysUserId) return supabaseKvSysUserId;
  const resolved = await getOrCreateReservedSystemUserId(RESERVED_SYSTEM_KV_USERNAME);
  if (resolved) supabaseKvSysUserId = resolved;
  return resolved;
}

async function persistKvKeyToSupabaseAsync(key, { timeoutMs = 15000 } = {}) {
  if (!USE_SUPABASE_CLOUDSYNC || isSupabaseDegraded()) return { ok: false };
  const k = String(key);
  let val = kvGetJson(k, null);
  if (val === null || val === undefined) return { ok: false };

  // Never overwrite remote Supabase app_kv before initial remote load succeeds!
  // Once startup hydration has loaded app_kv into RAM (hasLoadedRemoteKvSuccessfully === true),
  // RAM is the single source of truth on the server—so we NEVER re-download app_kv from Supabase on writes (zero GET egress).
  if (!hasLoadedRemoteKvSuccessfully) {
    await ensureChatMetaReadyAsync();
  }
  if (!hasLoadedRemoteKvSuccessfully) {
    const remoteVal = await fetchSupabaseKvKeyAsync(k, { timeoutMs: Math.min(timeoutMs, 12000) });
    if (remoteVal === undefined) {
      if (!hasLoadedRemoteKvSuccessfully) {
        console.warn(`[kv] Blocked Supabase write to "${k}" until remote app_kv loads safely`);
        return { ok: false, blocked: "remote_kv_not_loaded" };
      }
    } else if (remoteVal !== null) {
      val = mergeKvValueBeforeRemoteWrite(k, remoteVal, val);
      isHydratingSupabaseKv = true;
      try {
        applyChatMetaKvMap({ [k]: val });
        localKvSetJson(k, val);
      } finally {
        isHydratingSupabaseKv = false;
      }
    }
  }

  if (isSupabaseDegraded()) return { ok: false };
  if (supabaseHasAppKvTable !== false) {
    try {
      await aivenDb.query(
        "INSERT INTO public.app_kv (k, v, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at",
        [k, JSON.stringify(val)],
      );
      supabaseHasAppKvTable = true;
      if (k === "user_profiles_v2") {
        lastRemoteUserProfilesSnapshot = val && typeof val === "object" ? { ...val } : {};
        locallyDirtyProfileKeys.clear();
        clearedLastfmKeys.clear();
      }
      return { ok: true };
    } catch (err) {
      if (err?.code === "42P01") {
        supabaseHasAppKvTable = false;
      } else {
        markSupabaseDegraded(err?.message || "Aiven app_kv write error");
        return { ok: false };
      }
    }
  }
  if (isSupabaseDegraded()) return { ok: false };
  const sysId = await getOrCreateSupabaseSystemKvUserId();
  if (!sysId) return { ok: false };
  const snapshot = {};
  for (const ck of CHAT_META_KV_KEYS) {
    const localVal = kvGetJson(ck, null);
    if (localVal !== null && localVal !== undefined) snapshot[ck] = localVal;
  }
  snapshot[k] = val;
  await dbUpsertSyncPayload(sysId, JSON.stringify({ kv: snapshot }), new Date().toISOString());
  if (!isSupabaseDegraded() && k === "user_profiles_v2") {
    lastRemoteUserProfilesSnapshot = val && typeof val === "object" ? { ...val } : {};
    locallyDirtyProfileKeys.clear();
    clearedLastfmKeys.clear();
  }
  return { ok: !isSupabaseDegraded() };
}

async function ensureChatMetaReadyAsync() {
  ensureChatMetaLoaded();
  if (!USE_SUPABASE_CLOUDSYNC || hasLoadedRemoteKvSuccessfully || isSupabaseDegraded()) return;
  if (!supabaseMetaHydratePromise) {
    supabaseMetaHydratePromise = (async () => {
      let fetchSucceeded = false;
      try {
        let remoteKv = {};
        if (supabaseHasAppKvTable !== false && !isSupabaseDegraded()) {
          try {
            // Paginate app_kv in small keyset chunks (LIMIT 50) to avoid giant Postgres result buffers on boot
            const KV_BOOT_CHUNK = 50;
            let lastKey = "";
            for (let page = 0; page < 40; page++) {
              const res = await aivenDb.query(
                "SELECT k, v FROM public.app_kv WHERE k NOT LIKE 'chat_media_%' AND k > $1 ORDER BY k ASC LIMIT $2",
                [lastKey, KV_BOOT_CHUNK]
              );
              const rows = res.rows || [];
              for (const row of rows) {
                if (row?.k && !String(row.k).startsWith("chat_media_") && typeof row.v === "string") {
                  try {
                    remoteKv[row.k] = JSON.parse(row.v);
                  } catch {}
                }
                if (row?.k) lastKey = String(row.k);
              }
              if (rows.length < KV_BOOT_CHUNK) break;
            }
            supabaseHasAppKvTable = true;
            fetchSucceeded = true;
          } catch (err) {
            if (err?.code === "42P01") {
              supabaseHasAppKvTable = false;
            } else {
              markSupabaseDegraded(err?.message || "Aiven app_kv load error");
            }
          }
        }
        if (supabaseHasAppKvTable === false && !isSupabaseDegraded()) {
          const sysUser = await dbFindUserByUsername(RESERVED_SYSTEM_KV_USERNAME);
          if (sysUser?.id) {
            supabaseKvSysUserId = Number(sysUser.id);
            const row = await dbGetSyncPayload(supabaseKvSysUserId);
            if (!isSupabaseDegraded()) fetchSucceeded = true;
            if (row?.payload_json) {
              try {
                const parsed = JSON.parse(String(row.payload_json));
                if (parsed?.kv && typeof parsed.kv === "object") {
                  remoteKv = parsed.kv;
                }
              } catch {}
            }
          } else if (!isSupabaseDegraded()) {
            // Table fallback responded cleanly with no system KV record yet
            fetchSucceeded = true;
          }
        }
        if (fetchSucceeded && Object.keys(remoteKv).length > 0) {
          isHydratingSupabaseKv = true;
          try {
            applyChatMetaKvMap(remoteKv);
            for (const k of CHAT_META_KV_KEYS) {
              if (k === STUDIO_GAMES_KV_KEY) {
                if (publishedStudioGames.length > 0) localKvSetJson(STUDIO_GAMES_KV_KEY, publishedStudioGames);
                continue;
              }
              if (k === STUDIO_PROFILES_KV_KEY) {
                if (customStudios.length > 0) localKvSetJson(STUDIO_PROFILES_KV_KEY, customStudios);
                continue;
              }
              if (k === "user_profiles_v2") {
                localKvSetJson("user_profiles_v2", buildUserProfilesObject());
                continue;
              }
              if (remoteKv[k] !== undefined) localKvSetJson(k, remoteKv[k]);
            }
          } finally {
            isHydratingSupabaseKv = false;
          }
        }
        if (fetchSucceeded) {
          hasLoadedRemoteKvSuccessfully = true;
          supabaseMetaHydrated = true;
          studioGamesRemoteSyncedAt = Date.now();
          studioStudiosRemoteSyncedAt = Date.now();
          // Hydrate banned_devices, user signatures, and active subscriptions sequentially in LIMIT 50 chunks
          // to keep Postgres RAM and concurrent connection usage minimal on boot
          try {
            const BOOT_PAGE_SIZE = 50;
            const bdRows = [];
            for (let offset = 0; offset < 1000; offset += BOOT_PAGE_SIZE) {
              const r = await aivenDb.query(
                "SELECT id, fingerprint_id, storage_token, banned_username, banned_reason, high_confidence_spam, created_at FROM public.banned_devices ORDER BY id DESC LIMIT $1 OFFSET $2",
                [BOOT_PAGE_SIZE, offset]
              );
              const batch = r.rows || [];
              bdRows.push(...batch);
              if (batch.length < BOOT_PAGE_SIZE) break;
            }

            const userSigRows = [];
            for (let offset = 0; offset < 2000; offset += BOOT_PAGE_SIZE) {
              const r = await aivenDb.query(
                "SELECT username, last_fingerprint_id, last_storage_token, is_shadowbanned FROM public.cloudsync_users WHERE is_shadowbanned = TRUE OR last_fingerprint_id <> '' OR last_storage_token <> '' ORDER BY id DESC LIMIT $1 OFFSET $2",
                [BOOT_PAGE_SIZE, offset]
              );
              const batch = r.rows || [];
              userSigRows.push(...batch);
              if (batch.length < BOOT_PAGE_SIZE) break;
            }

            const cmSubRows = [];
            for (let offset = 0; offset < 500; offset += BOOT_PAGE_SIZE) {
              const r = await aivenDb
                .query(
                  "SELECT subscription_id, checkout_session_id, invoice_id, customer_id, email_lower, user_name_lower, custom_username_lower, claimed_username_lower, price_id, product_id, tier_name, status, managed_payments, customer_portal_url, amount, verified_at, expires_at, cancelled_at FROM public.stripe_subscriptions WHERE expires_at > NOW() ORDER BY expires_at DESC LIMIT $1 OFFSET $2",
                  [BOOT_PAGE_SIZE, offset]
                )
                .catch(() => ({ rows: [] }));
              const batch = r.rows || [];
              cmSubRows.push(...batch);
              if (batch.length < BOOT_PAGE_SIZE) break;
            }

            const bdRes = { rows: bdRows };
            const userSigRes = { rows: userSigRows };
            const cmSubsRes = { rows: cmSubRows };
            if (Array.isArray(cmSubsRes?.rows) && cmSubsRes.rows.length > 0) {
              const existingSubs = loadStripeSubscriptions();
              const byId = new Map(existingSubs.map((s) => [s.subscriptionId, s]));
              for (const row of cmSubsRes.rows) {
                const hydrated = hydrateStripeRow(row);
                byId.set(hydrated.subscriptionId, hydrated);
              }
              saveStripeSubscriptions(Array.from(byId.values()));
            }
            for (const row of bdRes.rows || []) {
              const fp = String(row.fingerprint_id || "").trim();
              const st = String(row.storage_token || "").trim();
              if (!fp && !st) continue;
              const exists = bannedDevices.some(
                (b) => (st && b.storage_token === st) || (fp && b.fingerprint_id === fp && b.banned_username === row.banned_username)
              );
              if (!exists) {
                bannedDevices.push({
                  id: `pg_${row.id}`,
                  fingerprint_id: fp,
                  storage_token: st,
                  banned_username: String(row.banned_username || ""),
                  banned_reason: String(row.banned_reason || "banned by staff"),
                  high_confidence_spam: Boolean(row.high_confidence_spam),
                  created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ""),
                });
              }
            }
            for (const u of userSigRes.rows || []) {
              const uk = String(u.username || "").trim().toLowerCase();
              if (!uk || OWNER_USERNAMES.has(uk)) continue;
              if (u.is_shadowbanned && !staffModerators.has(uk)) {
                shadowbannedUsers.add(uk);
              }
              const fp = String(u.last_fingerprint_id || "").trim();
              const st = String(u.last_storage_token || "").trim();
              if (fp || st) {
                const prev = userDeviceMap.get(uk) || {};
                userDeviceMap.set(uk, {
                  fingerprint_id: fp || prev.fingerprint_id || "",
                  storage_token: st || prev.storage_token || "",
                  updatedAt: prev.updatedAt || Date.now(),
                });
              }
            }
          } catch (e) {
            console.warn("Aiven anti-spam SQL hydrate warning:", e?.message);
          }
          if (locallyDirtyProfileKeys.size > 0) {
            scheduleSupabaseKvSync("user_profiles_v2");
          }
          void recoverMissingProfilesFromSupabaseSyncAsync().catch(() => {});
        }
      } catch (e) {
        console.warn("Supabase chat meta hydrate warning:", e?.message);
      } finally {
        if (!fetchSucceeded) {
          supabaseMetaHydratePromise = null;
        }
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

function persistChatChannels() {
  kvSetJson("chat_channels_v1", chatChannels.slice(0, 100));
}

function persistChatBackgrounds() {
  const out = {};
  let count = 0;
  for (const [k, v] of chatBackgrounds.entries()) {
    if (k && v) {
      out[k] = v;
      if (++count >= 500) break;
    }
  }
  kvSetJson("chat_backgrounds_v1", out);
}

function isStaffRoleUser(usernameOrLower) {
  const clean = String(usernameOrLower || "").trim().toLowerCase();
  if (!clean) return false;
  const role = getUserChatRole(clean);
  return role === "owner" || role === "mod";
}

function getChatChannelConfig(channelId) {
  const ch = String(channelId || "").trim();
  if (!ch) return null;
  return chatChannels.find((c) => c.id === ch) || null;
}

function getVisibleChatChannels(usernameLower) {
  const staff = isStaffRoleUser(usernameLower);
  return chatChannels.filter((c) => c.visibility !== "staff" || staff);
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
  const chCfg = getChatChannelConfig(ch);
  if (chCfg && chCfg.visibility === "staff") {
    return isStaffRoleUser(usernameLower);
  }
  if (ch === "staff-chat") {
    return isStaffRoleUser(usernameLower);
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

function buildUserProfilesObject() {
  const out = {};
  let count = 0;
  for (const [k, v] of userProfiles.entries()) {
    out[k] = v;
    if (++count >= 10000) break;
  }
  return out;
}

function persistUserProfilesLocalOnly() {
  localKvSetJson("user_profiles_v2", buildUserProfilesObject());
}

function persistUserProfiles({ updatedKey = "", deletedKey = "" } = {}) {
  if (updatedKey) {
    const clean = String(updatedKey).trim().toLowerCase();
    if (clean) {
      locallyDirtyProfileKeys.add(clean);
      deletedProfileKeys.delete(clean);
    }
  }
  if (deletedKey) {
    const clean = String(deletedKey).trim().toLowerCase();
    if (clean) {
      deletedProfileKeys.add(clean);
      locallyDirtyProfileKeys.delete(clean);
    }
  }
  kvSetJson("user_profiles_v2", buildUserProfilesObject());
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

function persistStaffActionLogs() {
  kvSetJson("staff_action_logs_v1", staffActionLogs.slice(-MAX_STAFF_ACTION_LOGS));
}

function persistStaffUserNotes({ includeTombstones = false } = {}) {
  const out = {};
  for (const [k, list] of staffUserNotes.entries()) {
    if (Array.isArray(list) && list.length > 0) {
      out[k] = list.slice(0, MAX_NOTES_PER_USER);
    }
  }
  kvSetJson("staff_user_notes_v1", out);
  if (includeTombstones) {
    kvSetJson("staff_user_notes_deleted_v1", Array.from(deletedStaffNoteIds).slice(-300));
  }
}

function recordStaffAction({
  action,
  actor = null,
  targetUsername = "",
  channel = "",
  details = "",
}) {
  ensureChatMetaLoaded();
  const entry = {
    id: `slog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    action: String(action || "mod_action").trim().slice(0, 48),
    actor: String(actor?.username || "staff").trim().slice(0, 40) || "staff",
    actorRole: String(actor?.role || "mod").trim().slice(0, 20) || "mod",
    targetUsername: String(targetUsername || "").trim().replace(/^@/, "").slice(0, 40),
    channel: String(channel || "").trim().slice(0, 40),
    details: String(details || "").trim().slice(0, 240),
  };
  staffActionLogs.push(entry);
  if (staffActionLogs.length > MAX_STAFF_ACTION_LOGS) {
    staffActionLogs.splice(0, staffActionLogs.length - MAX_STAFF_ACTION_LOGS);
  }
  persistStaffActionLogs();
  return entry;
}

function getStaffLogsForUser(usernameLower, limit = 60) {
  ensureChatMetaLoaded();
  const cleanKey = String(usernameLower || "").trim().replace(/^@/, "").toLowerCase();
  if (!cleanKey) return [];
  const matches = [];
  for (let i = staffActionLogs.length - 1; i >= 0; i--) {
    const log = staffActionLogs[i];
    if (String(log?.targetUsername || "").toLowerCase() === cleanKey) {
      matches.push(log);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

function getStaffNotesForUser(usernameLower) {
  ensureChatMetaLoaded();
  const cleanKey = String(usernameLower || "").trim().replace(/^@/, "").toLowerCase();
  if (!cleanKey) return [];
  const list = staffUserNotes.get(cleanKey);
  return Array.isArray(list) ? list : [];
}

function getAllStaffNotesList(limit = 100) {
  ensureChatMetaLoaded();
  const combined = [];
  for (const list of staffUserNotes.values()) {
    if (Array.isArray(list)) combined.push(...list);
  }
  combined.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  return combined.slice(0, limit);
}

function extractChatMessageTs(m) {
  if (!m || typeof m !== "object") return 0;
  const direct = Number(m.createdAt) || 0;
  if (direct > 0) return direct;
  const idMatch = /^msg_(\d{10,15})_/.exec(String(m.id || ""));
  if (idMatch) return Number(idMatch[1]) || 0;
  return 0;
}

function isPinnedHistoryChannel(channelId) {
  const ch = String(channelId || "").trim().toLowerCase();
  if (!ch) return false;
  if (ch === "announcements" || ch === "updates" || ch === "rules" || ch === "staff-chat") {
    return true;
  }
  const cfg = typeof chatChannels !== "undefined" ? chatChannels.find((c) => c.id === ch) : null;
  if (cfg && (cfg.writeAccess === "staff" || cfg.categoryId === "info")) {
    return true;
  }
  return false;
}

function trimChatHistoryPerChannel(list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const sorted = [...list].sort((a, b) => extractChatMessageTs(a) - extractChatMessageTs(b));
  const perChannelCounts = new Map();
  const keptReversed = [];
  let normalCount = 0;

  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i];
    if (!m || !m.id || !m.channel) continue;
    const ch = String(m.channel);
    const pinned = isPinnedHistoryChannel(ch);
    const chLimit = pinned ? 150 : 90;
    const curChCount = perChannelCounts.get(ch) || 0;
    if (curChCount >= chLimit) continue;
    if (!pinned && normalCount >= 480) continue;
    perChannelCounts.set(ch, curChCount + 1);
    if (!pinned) normalCount++;
    keptReversed.push(m);
  }

  return keptReversed.reverse();
}

function persistChatHistory() {
  if (typeof chatHistory !== "undefined") {
    const trimmed = trimChatHistoryPerChannel(chatHistory);
    if (trimmed.length !== chatHistory.length) {
      chatHistory.splice(0, chatHistory.length, ...trimmed);
    }
    kvSetJson("chat_history_v1", trimmed);
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

const USERS_DIR_PAGE_SIZE = 50; // Strict limit=50 per paginated Supabase query
const USERS_CACHE_TTL_MS = 10 * 60_000; // 10-minute in-memory cache TTL to slash Supabase GET egress
const SUPABASE_DEGRADED_COOLDOWN_MS = 25_000; // 25s circuit-breaker cooldown (15-30s backoff)
const USERS_DIR_KV_KEY = "registered_users_cache_v1";
const USERS_COUNT_KV_KEY = "registered_users_count_v1";
const DELETED_USERS_KV_KEY = "deleted_users_v1";
let supabaseDegradedUntil = 0;

// In-memory LRU caches for Supabase reads (slashing outbound GET egress to near zero after startup)
const cloudSyncUserByIdCache = new LRUCache({ max: 2000, ttl: 1000 * 60 * 10 }); // 10-minute TTL
const cloudSyncUserByNameCache = new LRUCache({ max: 2000, ttl: 1000 * 60 * 10 }); // 10-minute TTL
const cloudSyncBlobCache = new LRUCache({ max: 500, ttl: 1000 * 60 * 10 }); // 10-minute TTL for cloudsync_sync (cloudsync_blobs) payloads
const cloudSyncMetaCache = new LRUCache({ max: 1000, ttl: 1000 * 60 * 10 }); // 10-minute TTL for cloudsync_sync updated_at timestamps
const chatMediaShardItemsCache = new LRUCache({ max: 64, ttl: 1000 * 60 * 30 }); // 30-minute TTL for sharded chat media items
const stripeSubscriptionLookupCache = new LRUCache({ max: 500, ttl: 1000 * 60 * 10 }); // 10-minute TTL for stripe_subscriptions lookups

function cacheCloudSyncUserRecord(row) {
  if (!row || !row.username) return;
  const numId = Number(row.id) || 0;
  const cleanName = String(row.username).trim();
  const lower = cleanName.toLowerCase();
  if (!cleanName || !lower) return;
  const prevByName = cloudSyncUserByNameCache.get(lower);
  const prevById = numId > 0 ? cloudSyncUserByIdCache.get(numId) : null;
  if (prevById && prevById.username && String(prevById.username).toLowerCase() !== lower) {
    cloudSyncUserByNameCache.delete(String(prevById.username).toLowerCase());
  }
  const merged = {
    id: numId || Number(prevByName?.id || prevById?.id || 0),
    username: cleanName,
    token_version: Number(row.token_version ?? prevByName?.token_version ?? prevById?.token_version ?? 1),
    password_hash: row.password_hash ?? prevByName?.password_hash ?? prevById?.password_hash ?? undefined,
    created_at: row.created_at ?? row.createdAt ?? prevByName?.created_at ?? prevById?.created_at ?? null,
  };
  if (merged.id > 0) {
    cloudSyncUserByIdCache.set(merged.id, merged);
  }
  cloudSyncUserByNameCache.set(lower, merged);
}

function evictCloudSyncUserRecord({ userId = 0, username = "" } = {}) {
  const numId = Number(userId) || 0;
  const lower = String(username || "").trim().toLowerCase();
  if (numId > 0) {
    const existing = cloudSyncUserByIdCache.get(numId);
    if (existing?.username) {
      cloudSyncUserByNameCache.delete(String(existing.username).toLowerCase());
    }
    cloudSyncUserByIdCache.delete(numId);
  }
  if (lower) {
    const existing = cloudSyncUserByNameCache.get(lower);
    if (existing?.id) {
      cloudSyncUserByIdCache.delete(Number(existing.id));
    }
    cloudSyncUserByNameCache.delete(lower);
  }
}

function markSupabaseDegraded(reason = "") {
  const until = Date.now() + SUPABASE_DEGRADED_COOLDOWN_MS;
  if (until > supabaseDegradedUntil) {
    supabaseDegradedUntil = until;
  }
  if (reason) {
    console.warn(`[cloudsync] Supabase degraded (cooldown 25s): ${reason}`);
  }
}

function isSupabaseDegraded() {
  return Date.now() < supabaseDegradedUntil;
}

function localKvSetJson(key, value) {
  try {
    const db = getSharedCloudSyncDb();
    db.query("INSERT OR REPLACE INTO app_kv (k, v, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)").run(
      String(key),
      JSON.stringify(value)
    );
  } catch {}
}

function getDeletedUsersSet() {
  const arr = kvGetJson(DELETED_USERS_KV_KEY, []);
  const set = new Set();
  if (Array.isArray(arr)) {
    for (const u of arr) {
      const k = String(u || "").trim().toLowerCase();
      if (k) set.add(k);
    }
  }
  return set;
}

function recordDeletedUsername(username) {
  const k = String(username || "").trim().toLowerCase();
  if (!k) return;
  const set = getDeletedUsersSet();
  set.add(k);
  kvSetJson(DELETED_USERS_KV_KEY, Array.from(set).slice(-500));
  const cached = kvGetJson(USERS_DIR_KV_KEY, []);
  if (Array.isArray(cached)) {
    localKvSetJson(
      USERS_DIR_KV_KEY,
      cached.filter((r) => String(r?.username || "").trim().toLowerCase() !== k),
    );
  }
}

function unmarkDeletedUsername(username) {
  const k = String(username || "").trim().toLowerCase();
  if (!k) return;
  const set = getDeletedUsersSet();
  if (set.delete(k)) {
    kvSetJson(DELETED_USERS_KV_KEY, Array.from(set));
  }
}

function mirrorLocalUserRecord({ id = 0, username, passwordHash = "", tokenVersion = 1 }) {
  const clean = String(username || "").trim();
  const numId = Number(id) || 0;
  if (!clean || isReservedSystemUsername(clean)) return null;
  const db = openCloudSyncDb(false);
  try {
    const existing = db
      .query("SELECT id, username, password_hash, token_version FROM users WHERE LOWER(username) = LOWER(?)")
      .get(clean);
    if (existing) {
      if (passwordHash && existing.password_hash !== passwordHash) {
        db.query("UPDATE users SET username = ?, password_hash = ?, token_version = ? WHERE id = ?").run(
          clean,
          passwordHash,
          Number(tokenVersion || existing.token_version || 1),
          existing.id,
        );
      }
      return Number(existing.id);
    }
    if (!passwordHash) return null;
    if (numId > 0) {
      const byId = db.query("SELECT id FROM users WHERE id = ?").get(numId);
      if (!byId) {
        db.query("INSERT INTO users (id, username, password_hash, token_version) VALUES (?, ?, ?, ?)").run(
          numId,
          clean,
          passwordHash,
          Number(tokenVersion || 1),
        );
        return numId;
      }
    }
    const res = db
      .query("INSERT INTO users (username, password_hash, token_version) VALUES (?, ?, ?)")
      .run(clean, passwordHash, Number(tokenVersion || 1));
    return Number(res.lastInsertRowid);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

// Maps stale/old lowercase usernames (from local SQLite or pre-rename cache) -> latest canonical { id, username }
const staleUsernameAliases = new Map();

function saveRegisteredUsersDirCache(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const deleted = getDeletedUsersSet();
  const byKey = new Map();
  const incomingById = new Map();
  const incomingKeys = new Set();

  for (const r of rows) {
    const clean = String(r?.username || "").trim();
    const k = clean.toLowerCase();
    const id = Number(r?.id) || 0;
    if (!clean || isReservedSystemUsername(clean) || deleted.has(k) || isTemporaryGuestName(clean)) continue;
    incomingKeys.add(k);
    if (id > 0) incomingById.set(id, { id, username: clean, created_at: r.created_at || null });
    // Clear any prior alias if this exact username is now active in Supabase
    staleUsernameAliases.delete(k);
  }

  const prev = kvGetJson(USERS_DIR_KV_KEY, []);
  if (Array.isArray(prev)) {
    for (const r of prev) {
      const clean = String(r?.username || "").trim();
      const k = clean.toLowerCase();
      const id = Number(r?.id) || 0;
      if (!clean || isReservedSystemUsername(clean) || deleted.has(k) || isTemporaryGuestName(clean)) continue;
      if (id > 0 && incomingById.has(id)) {
        const fresh = incomingById.get(id);
        if (fresh.username.toLowerCase() !== k && !incomingKeys.has(k)) {
          continue;
        }
      }
      byKey.set(k, { id, username: clean, created_at: r.created_at || null });
    }
  }

  // Deduplicate by both id and username_lower: incoming Supabase rows always overwrite matching id/key entries
  for (const r of rows) {
    const clean = String(r?.username || "").trim();
    const k = clean.toLowerCase();
    const id = Number(r?.id) || 0;
    if (!clean || isReservedSystemUsername(clean) || deleted.has(k) || isTemporaryGuestName(clean)) continue;
    if (id > 0) {
      for (const [existingKey, existingRec] of byKey.entries()) {
        if (existingKey !== k && existingRec.id === id && !incomingKeys.has(existingKey)) {
          staleUsernameAliases.set(existingKey, { id, username: clean });
          byKey.delete(existingKey);
        }
      }
    }
    byKey.set(k, {
      id: id || byKey.get(k)?.id || 0,
      username: clean,
      created_at: r.created_at || byKey.get(k)?.created_at || null,
    });
  }

  const merged = Array.from(byKey.values());
  localKvSetJson(USERS_DIR_KV_KEY, merged);
}

function collectFallbackUserRows(primaryRows = []) {
  ensureChatMetaLoaded();
  const deleted = getDeletedUsersSet();
  const byKey = new Map();
  const byId = new Map();
  const primaryKeys = new Set();
  const primaryById = new Map();

  for (const r of primaryRows || []) {
    const clean = String(r?.username || "").trim();
    const k = clean.toLowerCase();
    const id = Number(r?.id) || 0;
    if (!clean || isReservedSystemUsername(clean) || deleted.has(k) || isTemporaryGuestName(clean)) continue;
    primaryKeys.add(k);
    if (id > 0) primaryById.set(id, { id, username: clean, created_at: r.created_at || null });
  }

  const addRow = (id, username, createdAt = null, { isPrimary = false } = {}) => {
    const clean = String(username || "").trim();
    const k = clean.toLowerCase();
    const numId = Number(id) || 0;
    if (!clean || isReservedSystemUsername(clean) || deleted.has(k) || isTemporaryGuestName(clean)) {
      return;
    }
    if (!isPrimary && staleUsernameAliases.has(k)) {
      return;
    }
    if (!isPrimary && numId > 0 && primaryById.has(numId)) {
      const fresh = primaryById.get(numId);
      if (fresh.username.toLowerCase() !== k && !primaryKeys.has(k)) {
        return;
      }
    }
    if (!isPrimary && numId > 0 && byId.has(numId)) {
      const existing = byId.get(numId);
      if (existing.username.toLowerCase() !== k && !primaryKeys.has(k)) {
        return;
      }
    }
    const existingByKey = byKey.get(k);
    if (!existingByKey || (isPrimary && numId > 0 && !existingByKey.id)) {
      const rec = { id: numId, username: clean, created_at: createdAt || existingByKey?.created_at || null };
      byKey.set(k, rec);
      if (numId > 0) byId.set(numId, rec);
    }
  };

  // 1. Live Supabase rows take strict precedence
  for (const r of primaryRows || []) {
    addRow(r?.id, r?.username, r?.created_at, { isPrimary: true });
  }

  // 2. Cached Supabase directory (preserved for partial/outage continuity, deduplicated by id & username_lower)
  const cachedDir = kvGetJson(USERS_DIR_KV_KEY, []);
  if (Array.isArray(cachedDir)) {
    for (const r of cachedDir) addRow(r?.id, r?.username, r?.created_at);
  }

  // 3. Local SQLite users table (deduplicated against Supabase id & username_lower so stale local usernames never duplicate)
  try {
    const db = openCloudSyncDb(true);
    const localRows = db.query("SELECT id, username, created_at FROM users ORDER BY id ASC").all();
    for (const r of localRows || []) {
      const clean = String(r?.username || "").trim();
      const k = clean.toLowerCase();
      const localId = Number(r?.id) || 0;
      if (!clean || deleted.has(k)) continue;
      // When Supabase directory succeeded, skip stale pre-Supabase SQLite rows whose id is canonicalized in Supabase
      if (localId > 0 && primaryById.has(localId)) {
        const fresh = primaryById.get(localId);
        if (fresh.username.toLowerCase() !== k && !primaryKeys.has(k)) {
          continue;
        }
      }
      // If running with Supabase primary rows and this local SQLite user isn't in Supabase/cache, only include when degraded/local
      if (USE_SUPABASE_CLOUDSYNC && (primaryRows || []).length > 0 && !isSupabaseDegraded() && !byKey.has(k)) {
        continue;
      }
      addRow(localId, clean, r?.created_at);
    }
  } catch {}

  // 4. Only synthesize accounts from chat metadata / OWNER_USERNAMES when in local SQLite mode or empty Supabase outage
  if (!USE_SUPABASE_CLOUDSYNC || ((primaryRows || []).length === 0 && byKey.size === 0)) {
    for (const k of userProfiles.keys()) addRow(0, k);
    for (const k of OWNER_USERNAMES) addRow(0, k);
    for (const k of staffModerators) addRow(0, k);
    for (const k of goatUsers) addRow(0, k);
    for (const msg of chatHistory || []) {
      if (msg?.author) addRow(0, msg.author, msg.timestamp || null);
    }
  }
  return Array.from(byKey.values());
}

async function dbFindUserById(userId) {
  const numId = Number(userId) || 0;
  if (numId <= 0) return null;
  const cached = cloudSyncUserByIdCache.get(numId);
  if (cached && cached.username) {
    return cached;
  }
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const res = await aivenDb.query(
        "SELECT id, username, token_version FROM public.cloudsync_users WHERE id = $1 LIMIT 1",
        [numId],
      );
      const row = res.rows?.[0] || null;
      if (row) cacheCloudSyncUserRecord(row);
      return row;
    } catch (err) {
      markSupabaseDegraded(err?.message);
    }
  }
  const db = openCloudSyncDb(true);
  try {
    const localRow =
      db
        .query("SELECT id, username, token_version FROM users WHERE id = ?")
        .get(numId) || null;
    if (localRow) cacheCloudSyncUserRecord(localRow);
    return localRow;
  } finally {
    db.close();
  }
}

async function dbFindUserByUsername(username, { includePasswordHash = false } = {}) {
  const clean = String(username || "").trim();
  const lower = clean.toLowerCase();
  if (!clean) return null;
  const cached = cloudSyncUserByNameCache.get(lower);
  if (cached && cached.username && (!includePasswordHash || cached.password_hash)) {
    return cached;
  }
  if (!includePasswordHash && cloudSyncUsersCache.map && cloudSyncUsersCache.map.has(lower)) {
    const dirRec = cloudSyncUsersCache.map.get(lower);
    if (dirRec && Number(dirRec.id) > 0) {
      const byId = cloudSyncUserByIdCache.get(Number(dirRec.id));
      if (byId) return byId;
      const hydrated = {
        id: Number(dirRec.id),
        username: dirRec.username,
        token_version: 1,
        created_at: dirRec.createdAt || null,
      };
      cacheCloudSyncUserRecord(hydrated);
      return hydrated;
    }
  }
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const selectCols = includePasswordHash
        ? "id, username, password_hash, token_version, created_at"
        : "id, username, token_version, created_at";
      const res = await aivenDb.query(
        `SELECT ${selectCols} FROM public.cloudsync_users WHERE username_lower = $1 OR LOWER(username) = $1 LIMIT 1`,
        [lower],
      );
      const row = res.rows?.[0] || null;
      if (row) {
        cacheCloudSyncUserRecord(row);
        mirrorLocalUserRecord({
          id: row.id,
          username: row.username,
          passwordHash: row.password_hash,
          tokenVersion: row.token_version,
        });
        return row;
      }
    } catch (err) {
      markSupabaseDegraded(err?.message);
    }
  }
  const db = openCloudSyncDb(true);
  try {
    const localRow =
      db
        .query(
          "SELECT id, username, password_hash, token_version FROM users WHERE LOWER(username) = LOWER(?)"
        )
        .get(clean) || null;
    if (localRow) cacheCloudSyncUserRecord(localRow);
    return localRow;
  } finally {
    db.close();
  }
}

async function dbCreateUser(username, passwordHash) {
  unmarkDeletedUsername(username);
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const existing = await dbFindUserByUsername(username);
      if (existing) return { conflict: true };
      const res = await aivenDb.query(
        "INSERT INTO public.cloudsync_users (username, username_lower, password_hash, token_version) VALUES ($1, $2, $3, 1) RETURNING id, username, created_at",
        [username, username.toLowerCase(), passwordHash],
      );
      const created = res.rows?.[0];
      cacheCloudSyncUserRecord({
        id: Number(created.id),
        username: String(created.username),
        password_hash: passwordHash,
        token_version: 1,
        created_at: created.created_at || new Date().toISOString(),
      });
      mirrorLocalUserRecord({ username: created.username, passwordHash, tokenVersion: 1 });
      return {
        conflict: false,
        id: Number(created.id),
        username: String(created.username),
      };
    } catch (err) {
      if (err?.code === "23505") {
        return { conflict: true };
      }
      markSupabaseDegraded(err?.message);
    }
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
    const newId = Number(result.lastInsertRowid);
    cacheCloudSyncUserRecord({
      id: newId,
      username,
      password_hash: passwordHash,
      token_version: 1,
    });
    return {
      conflict: false,
      id: newId,
      username,
    };
  } finally {
    db.close();
  }
}

async function dbDeleteUser(userId, username = "") {
  const numId = Number(userId) || 0;
  evictCloudSyncUserRecord({ userId: numId, username });
  if (numId > 0) {
    cloudSyncBlobCache.delete(numId);
    cloudSyncMetaCache.delete(numId);
  }
  if (username) recordDeletedUsername(username);
  if (USE_SUPABASE_CLOUDSYNC) {
    try {
      await aivenDb.query("DELETE FROM public.cloudsync_sync WHERE user_id = $1", [numId]);
      await aivenDb.query("DELETE FROM public.cloudsync_users WHERE id = $1", [numId]);
    } catch (err) {
      console.warn("[cloudsync] Aiven dbDeleteUser warning:", err?.message);
    }
  }
  const db = openCloudSyncDb(false);
  try {
    if (username) {
      const localRow = db.query("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username);
      if (localRow?.id) {
        db.query("DELETE FROM sync_json WHERE user_id = ?").run(localRow.id);
        db.query("DELETE FROM sync_data WHERE user_id = ?").run(localRow.id);
        db.query("DELETE FROM users WHERE id = ?").run(localRow.id);
      }
    }
    db.query("DELETE FROM sync_json WHERE user_id = ?").run(userId);
    db.query("DELETE FROM sync_data WHERE user_id = ?").run(userId);
    db.query("DELETE FROM users WHERE id = ?").run(userId);
  } finally {
    db.close();
  }
}

async function dbGetSyncMetaUpdatedAt(userId, username = "") {
  const numId = Number(userId) || 0;
  if (numId > 0) {
    const cachedBlob = cloudSyncBlobCache.get(numId);
    if (cachedBlob && cachedBlob.updated_at !== undefined) {
      return String(cachedBlob.updated_at || "");
    }
    const cachedMeta = cloudSyncMetaCache.get(numId);
    if (cachedMeta !== undefined) {
      return String(cachedMeta || "");
    }
  }
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const res = await aivenDb.query(
        "SELECT updated_at FROM public.cloudsync_sync WHERE user_id = $1 LIMIT 1",
        [numId],
      );
      const row = res.rows?.[0] || null;
      const updated = row?.updated_at
        ? row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : String(row.updated_at)
        : "";
      if (numId > 0) cloudSyncMetaCache.set(numId, updated);
      if (updated) return updated;
    } catch (err) {
      markSupabaseDegraded(err?.message);
    }
  }
  const db = openCloudSyncDb(true);
  try {
    let targetId = userId;
    if (username) {
      const localRow = db.query("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username);
      if (localRow?.id) targetId = Number(localRow.id);
    }
    const row =
      db.query("SELECT updated_at FROM sync_json WHERE user_id = ?").get(targetId) ||
      db.query("SELECT updated_at FROM sync_data WHERE user_id = ?").get(targetId);
    const updated = row?.updated_at ? String(row.updated_at) : "";
    if (numId > 0 && updated) cloudSyncMetaCache.set(numId, updated);
    return updated;
  } finally {
    db.close();
  }
}

async function dbGetSyncPayload(userId, username = "") {
  const numId = Number(userId) || 0;
  if (numId > 0) {
    const cachedBlob = cloudSyncBlobCache.get(numId);
    if (cachedBlob !== undefined) {
      return cachedBlob;
    }
  }
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const res = await aivenDb.query(
        "SELECT payload_json, updated_at FROM public.cloudsync_sync WHERE user_id = $1 LIMIT 1",
        [numId],
      );
      const rawRow = res.rows?.[0] || null;
      const remoteRow = rawRow
        ? {
            payload_json: rawRow.payload_json,
            updated_at:
              rawRow.updated_at instanceof Date
                ? rawRow.updated_at.toISOString()
                : String(rawRow.updated_at || ""),
          }
        : null;
      if (numId > 0) {
        cloudSyncBlobCache.set(numId, remoteRow);
        cloudSyncMetaCache.set(numId, remoteRow?.updated_at ? String(remoteRow.updated_at) : "");
      }
      if (remoteRow) return remoteRow;
    } catch (err) {
      markSupabaseDegraded(err?.message);
    }
  }
  const db = openCloudSyncDb(true);
  try {
    let targetId = userId;
    if (username) {
      const localRow = db.query("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username);
      if (localRow?.id) targetId = Number(localRow.id);
    }
    const localRow =
      db
        .query("SELECT payload_json, updated_at FROM sync_json WHERE user_id = ?")
        .get(targetId) || null;
    if (numId > 0 && localRow) {
      cloudSyncBlobCache.set(numId, localRow);
      cloudSyncMetaCache.set(numId, localRow.updated_at ? String(localRow.updated_at) : "");
    }
    return localRow;
  } finally {
    db.close();
  }
}

async function dbUpsertSyncPayload(userId, payloadJson, updatedAt, username = "") {
  const numId = Number(userId) || 0;
  if (numId > 0) {
    const rowObj = { payload_json: payloadJson, updated_at: updatedAt };
    cloudSyncBlobCache.set(numId, rowObj);
    cloudSyncMetaCache.set(numId, String(updatedAt || ""));
  }
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      await aivenDb.query(
        "INSERT INTO public.cloudsync_sync (user_id, payload_json, updated_at) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at",
        [numId, payloadJson, updatedAt],
      );
    } catch (err) {
      markSupabaseDegraded(err?.message);
    }
  }
  const db = openCloudSyncDb(false);
  try {
    let targetId = userId;
    if (username) {
      const localRow = db.query("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username);
      if (localRow?.id) targetId = Number(localRow.id);
    }
    const localExists = db.query("SELECT id FROM users WHERE id = ?").get(targetId);
    if (localExists) {
      db.query(
        "INSERT OR REPLACE INTO sync_json (user_id, payload_json, updated_at) VALUES (?, ?, ?)"
      ).run(targetId, payloadJson, updatedAt);
    }
  } finally {
    db.close();
  }
}

function getFallbackUsersCount(fallbackRows = null) {
  const savedKv = kvGetJson(USERS_COUNT_KV_KEY, null);
  const kvCount = Number(savedKv?.count || 0);
  const rowsCount = Array.isArray(fallbackRows) ? fallbackRows.length : collectFallbackUserRows([]).length;
  return Math.max(0, kvCount, rowsCount);
}

// Exact Postgres count query on Aiven
async function dbCountUsers() {
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const res = await aivenDb.query(
        "SELECT COUNT(*)::int AS c FROM public.cloudsync_users WHERE username NOT LIKE '__sunshine_%'",
      );
      const exactCount = Math.max(0, Number(res.rows?.[0]?.c || 0));
      localKvSetJson(USERS_COUNT_KV_KEY, { count: exactCount, updatedAt: Date.now() });
      return exactCount;
    } catch (err) {
      markSupabaseDegraded(err?.message);
    }
  }
  return getFallbackUsersCount();
}

// Paginated user directory fetch (capped at 50 rows for external pagination, up to maxLimit for internal RAM directory seed)
async function dbListUsers({ limit = USERS_DIR_PAGE_SIZE, offset = 0, maxLimit = USERS_DIR_PAGE_SIZE } = {}) {
  const safeMax = Math.max(USERS_DIR_PAGE_SIZE, Number(maxLimit) || USERS_DIR_PAGE_SIZE);
  const safeLimit = Math.min(Math.max(1, Number(limit) || USERS_DIR_PAGE_SIZE), safeMax);
  const safeOffset = Math.max(0, Number(offset) || 0);
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    try {
      const res = await aivenDb.query(
        "SELECT id, username, created_at FROM public.cloudsync_users WHERE username NOT LIKE '__sunshine_%' ORDER BY id DESC LIMIT $1 OFFSET $2",
        [safeLimit, safeOffset],
      );
      const batch = (res.rows || []).map((r) => ({
        id: Number(r.id),
        username: String(r.username),
        created_at:
          r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at ? String(r.created_at) : null,
      }));
      for (const r of batch) {
        if (r && r.username) cacheCloudSyncUserRecord(r);
      }
      saveRegisteredUsersDirCache(batch);
      return safeOffset === 0 ? collectFallbackUserRows(batch) : batch;
    } catch (err) {
      markSupabaseDegraded(err?.message);
    }
  }
  if (safeOffset > 0) {
    const fallbackAll = collectFallbackUserRows([]);
    return fallbackAll.slice(safeOffset, safeOffset + safeLimit);
  }
  return collectFallbackUserRows([]);
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

async function getAuthenticatedCloudSyncUser(req, { allowUnmirroredJwt = false } = {}) {
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
  const claimsUsername = String(claims.username).trim();
  const claimsLower = claimsUsername.toLowerCase();
  if (!claimsUsername || isReservedSystemUsername(claimsUsername)) return null;
  if (getDeletedUsersSet().has(claimsLower)) return null;

  try {
    const byIdRow = await dbFindUserById(claims.id);
    let row = byIdRow && String(byIdRow.username).toLowerCase() === claimsLower ? byIdRow : null;
    if (!row && claimsUsername) {
      row = await dbFindUserByUsername(claimsUsername);
    }
    if (!row) {
      const authedFallback = { id: Number(claims.id), username: claimsUsername };
      upsertUserInCaches(authedFallback);
      return authedFallback;
    }
    if (String(row.username).toLowerCase() !== claimsLower) {
      return null;
    }
    if (row.id === Number(claims.id) && Number(row.token_version || 1) !== Number(claims.v || 1)) {
      return null;
    }
    const authed = { id: Number(row.id), username: String(row.username) };
    upsertUserInCaches(authed);
    return authed;
  } catch {
    // Transient Supabase / DB connectivity blip should not silently strip verified moderator auth
    const authedFallback = { id: Number(claims.id), username: claimsUsername };
    upsertUserInCaches(authedFallback);
    return authedFallback;
  }
}

// --- Native CloudSync Auth & Sync Endpoints (/api/auth/* & /api/sync/*) ---
app.get("/api/auth/turnstile-config", (_req, res) => {
  res.json({
    success: true,
    enabled: Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY),
    siteKey: TURNSTILE_SITE_KEY || "",
  });
});

app.post(["/api/auth/register", "/api/auth/signup", "/signup"], async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const email = String(req.body?.email || "").trim();
    const fingerprintId = String(req.body?.fingerprint_id || req.body?.fingerprintId || "").trim().slice(0, 120);
    const storageToken = String(req.body?.storage_token || req.body?.storageToken || "").trim().slice(0, 120);
    const turnstileToken = String(
      req.body?.["cf-turnstile-response"] ||
        req.body?.cf_turnstile_response ||
        req.body?.turnstileToken ||
        ""
    ).trim();

    if (isDisposableEmailDomain(email) || isDisposableEmailDomain(username)) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "disposable or burner email domains are not allowed" });
    }

    const turnstileOk = await verifyTurnstileToken(
      turnstileToken,
      req.headers["cf-connecting-ip"] || req.ip || ""
    );
    if (!turnstileOk) {
      return res
        .status(403)
        .json({ success: false, user: null, error: "security verification failed — please refresh and try again" });
    }

    const spamUsernameMatch = matchesSpamFilter(username);
    const banCheck = checkDeviceBanForSignup({
      fingerprint_id: fingerprintId,
      storage_token: storageToken,
      highConfidenceSpam: Boolean(spamUsernameMatch || req.body?.high_confidence_spam),
    });
    if (banCheck.hardBlocked) {
      return res
        .status(403)
        .json({ success: false, user: null, error: "Registration temporarily unavailable" });
    }

    if (isReservedSystemUsername(username)) {
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
    const nowMs = Date.now();
    const createdIso = new Date(nowMs).toISOString();
    userCreatedAtMap.set(username.toLowerCase(), nowMs);
    persistUserCreatedAtMap();

    if (fingerprintId || storageToken) {
      recordUserDeviceSignature(username, {
        fingerprint_id: fingerprintId,
        storage_token: storageToken,
      });
    }
    if (banCheck.shadowban || spamUsernameMatch) {
      setAccountShadowbanned(username, true, {
        reason: banCheck.shadowban
          ? "signup matched banned device fingerprint (Chromebook hybrid shadowban)"
          : "signup username matched spam filter",
        recordDevice: Boolean(spamUsernameMatch),
        highConfidenceSpam: Boolean(spamUsernameMatch),
      });
    }

    const exp = Math.floor(nowMs / 1000) + 30 * 24 * 60 * 60;
    const token = signCloudSyncJwt({ id: userId, username, v: 1, exp });
    setCloudSyncAuthCookie(res, token, req);
    upsertUserInCaches({ id: userId, username, created_at: createdIso }, 1);
    touchKnownUser(username);
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");

    return res.status(201).json({
      success: true,
      token,
      user: { id: userId, username, createdAt: createdIso },
      error: null,
    });
  } catch (err) {
    console.error("CloudSync register error:", err);
    return res
      .status(500)
      .json({ success: false, user: null, error: "internal error" });
  }
});

app.post(["/api/auth/login", "/login"], async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const fingerprintId = String(req.body?.fingerprint_id || req.body?.fingerprintId || "").trim().slice(0, 120);
    const storageToken = String(req.body?.storage_token || req.body?.storageToken || "").trim().slice(0, 120);
    const turnstileToken = String(
      req.body?.["cf-turnstile-response"] ||
        req.body?.cf_turnstile_response ||
        req.body?.turnstileToken ||
        ""
    ).trim();
    if (!username || !password || isReservedSystemUsername(username)) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "missing username or password" });
    }
    if (password.length > 128) {
      return res
        .status(400)
        .json({ success: false, user: null, error: "password too long" });
    }

    const turnstileOk = await verifyTurnstileToken(
      turnstileToken,
      req.headers["cf-connecting-ip"] || req.ip || ""
    );
    if (!turnstileOk) {
      return res
        .status(403)
        .json({ success: false, user: null, error: "security verification failed — please complete the check and try again" });
    }

    const row = await dbFindUserByUsername(username, { includePasswordHash: true });
    if (!row || !Bun.password.verifySync(password, String(row.password_hash))) {
      return res
        .status(401)
        .json({ success: false, user: null, error: "invalid credentials!" });
    }

    const userId = Number(row.id);
    const canonicalUsername = String(row.username);
    const tokenVersion = Number(row.token_version || 1);
    if (fingerprintId || storageToken) {
      recordUserDeviceSignature(canonicalUsername, {
        fingerprint_id: fingerprintId,
        storage_token: storageToken,
      });
      const loginBanCheck = checkDeviceBanForSignup({
        fingerprint_id: fingerprintId,
        storage_token: storageToken,
      });
      if ((loginBanCheck.hardBlocked || loginBanCheck.shadowban) && !isStaffRoleUser(canonicalUsername)) {
        setAccountShadowbanned(canonicalUsername, true, {
          reason: loginBanCheck.hardBlocked
            ? "logged in from banned device"
            : "logged in from banned device fingerprint",
          recordDevice: false,
        });
      }
    }
    const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const token = signCloudSyncJwt({
      id: userId,
      username: canonicalUsername,
      v: tokenVersion,
      exp,
    });
    setCloudSyncAuthCookie(res, token, req);
    upsertUserInCaches({ id: userId, username: canonicalUsername });
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
    await dbDeleteUser(user.id, user.username);
    knownUsers.delete(user.username.toLowerCase());
    userProfiles.delete(user.username.toLowerCase());
    persistUserProfiles({ deletedKey: user.username.toLowerCase() });
    removeUserFromCaches(user.username);
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
    const updatedAt = await dbGetSyncMetaUpdatedAt(user.id, user.username);
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
      const existingRow = await dbGetSyncPayload(user.id, user.username);
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

    await dbUpsertSyncPayload(user.id, JSON.stringify(finalPayload), updatedAt, user.username);
    if (recoverUserProfileFromSyncPayload(user.username, finalPayload, updatedAt)) {
      persistUserProfiles({ updatedKey: user.username.toLowerCase() });
    }
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
    const row = await dbGetSyncPayload(user.id, user.username);
    if (!row || !row.payload_json) {
      return res.json({
        success: true,
        data: { localStorage: {}, indexedDB: {} },
        updated_at: "",
        error: null,
      });
    }
    const parsedData = JSON.parse(String(row.payload_json));
    const rowUpdatedAt = String(row.updated_at || "");
    if (recoverUserProfileFromSyncPayload(user.username, parsedData, rowUpdatedAt)) {
      persistUserProfiles({ updatedKey: user.username.toLowerCase() });
    }
    return res.json({
      success: true,
      data: parsedData,
      updated_at: rowUpdatedAt,
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
let cloudSyncCountCache = { count: null, expiresAt: 0, refreshPromise: null };
let usersPageCache = new Map(); // cacheKey -> { data, expiresAt }
const usersPageInFlight = new Map(); // cacheKey -> Promise
const missingUserLookupCache = new Map(); // usernameLower -> expiresAt
const singleUserLookupInFlight = new Map(); // usernameLower -> Promise
let cloudSyncUsersLoaded = !USE_SUPABASE_CLOUDSYNC;
let cloudSyncDirectorySyncedAt = !USE_SUPABASE_CLOUDSYNC ? Date.now() : 0;
let cloudSyncUsersRefreshPromise = null;
function invalidateCloudSyncUsersCache() {
  // Keep previous map as fallback while marking expired so synchronous callers never flash empty user lists
  cloudSyncUsersCache.expiresAt = 0;
  cloudSyncCountCache.expiresAt = 0;
  cloudSyncDirectorySyncedAt = !USE_SUPABASE_CLOUDSYNC ? Date.now() : 0;
  usersPageCache.clear();
}

function buildCloudSyncUsersMap(rows) {
  const map = new Map();
  const keyById = new Map();
  const deleted = getDeletedUsersSet();
  for (const r of rows || []) {
    if (r && r.username) {
      const clean = String(r.username).trim();
      const k = clean.toLowerCase();
      if (
        !clean ||
        isReservedSystemUsername(clean) ||
        deleted.has(k) ||
        shadowbannedUsers.has(k) ||
        staleUsernameAliases.has(k)
      ) {
        continue;
      }
      const numId = Number(r.id) || 0;
      if (numId > 0 && keyById.has(numId) && keyById.get(numId) !== k) {
        continue;
      }
      map.set(k, {
        id: numId,
        username: clean,
        createdAt: r.created_at || null,
      });
      if (numId > 0) keyById.set(numId, k);
    }
  }
  return map;
}

function upsertUserInCaches(row, countDelta = 0) {
  const clean = String(row?.username || "").trim();
  const key = clean.toLowerCase();
  const numId = Number(row?.id) || 0;
  if (!clean || isReservedSystemUsername(clean) || isTemporaryGuestName(clean)) return;
  cacheCloudSyncUserRecord(row);
  missingUserLookupCache.delete(key);
  staleUsernameAliases.delete(key);
  saveRegisteredUsersDirCache([{ id: numId, username: clean, created_at: row.created_at || null }]);
  const map = cloudSyncUsersCache.map || buildCloudSyncUsersMap(collectFallbackUserRows([]));
  // Deduplicate by positive user id if user renamed
  if (numId > 0) {
    for (const [existingKey, existingRec] of map.entries()) {
      if (existingKey !== key && existingRec.id === numId) {
        staleUsernameAliases.set(existingKey, { id: numId, username: clean });
        map.delete(existingKey);
        knownUsers.delete(existingKey);
      }
    }
  }
  const isNew = !map.has(key);
  map.set(key, {
    id: numId || map.get(key)?.id || 0,
    username: clean,
    createdAt: row.created_at || map.get(key)?.createdAt || null,
  });
  cloudSyncUsersCache.map = map;
  // Only extend cache expiry if the baseline 50-user directory has already synced (or local SQLite mode),
  // so logging in or opening SSE on startup never skips loading the 50 baseline offline users!
  if (!USE_SUPABASE_CLOUDSYNC || cloudSyncDirectorySyncedAt > 0) {
    if (!cloudSyncUsersCache.expiresAt) {
      cloudSyncUsersCache.expiresAt = Date.now() + USERS_CACHE_TTL_MS;
    }
    cloudSyncUsersLoaded = true;
  }
  if (countDelta > 0 && isNew) {
    const base = cloudSyncCountCache.count ?? map.size - 1;
    cloudSyncCountCache.count = Math.max(map.size, base + countDelta);
    localKvSetJson(USERS_COUNT_KV_KEY, { count: cloudSyncCountCache.count, updatedAt: Date.now() });
    usersPageCache.clear();
  }
}

function removeUserFromCaches(username) {
  const key = String(username || "").trim().toLowerCase();
  if (!key) return;
  evictCloudSyncUserRecord({ username: key });
  if (cloudSyncUsersCache.map) {
    cloudSyncUsersCache.map.delete(key);
  }
  const base = cloudSyncCountCache.count ?? (cloudSyncUsersCache.map ? cloudSyncUsersCache.map.size + 1 : 0);
  if (base > 0) {
    cloudSyncCountCache.count = Math.max(0, base - 1);
    localKvSetJson(USERS_COUNT_KV_KEY, { count: cloudSyncCountCache.count, updatedAt: Date.now() });
  }
  usersPageCache.clear();
}

function getCloudSyncUsersCountSync(csMap = null) {
  const mapSize = csMap ? csMap.size : cloudSyncUsersCache.map?.size || 0;
  const cached = Number(cloudSyncCountCache.count);
  if (Number.isFinite(cached) && cached >= 0) {
    return Math.max(cached, mapSize);
  }
  return Math.max(getFallbackUsersCount(), mapSize);
}

async function getCloudSyncUsersCountAsync(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cloudSyncCountCache.count !== null && now < cloudSyncCountCache.expiresAt) {
    return cloudSyncCountCache.count;
  }
  if (cloudSyncCountCache.refreshPromise) {
    return cloudSyncCountCache.refreshPromise;
  }
  if (USE_SUPABASE_CLOUDSYNC && isSupabaseDegraded()) {
    const fallback = cloudSyncCountCache.count !== null ? cloudSyncCountCache.count : getFallbackUsersCount();
    cloudSyncCountCache.count = fallback;
    cloudSyncCountCache.expiresAt = Math.max(cloudSyncCountCache.expiresAt, supabaseDegradedUntil);
    return fallback;
  }
  const promise = (async () => {
    try {
      const count = await dbCountUsers();
      cloudSyncCountCache.count = count;
      cloudSyncCountCache.expiresAt = Date.now() + (isSupabaseDegraded() ? SUPABASE_DEGRADED_COOLDOWN_MS : USERS_CACHE_TTL_MS);
      return count;
    } catch (err) {
      markSupabaseDegraded(err?.message || "user count failed");
      const fallback = cloudSyncCountCache.count !== null ? cloudSyncCountCache.count : getFallbackUsersCount();
      cloudSyncCountCache.count = fallback;
      cloudSyncCountCache.expiresAt = Date.now() + SUPABASE_DEGRADED_COOLDOWN_MS;
      return fallback;
    } finally {
      if (cloudSyncCountCache.refreshPromise === promise) {
        cloudSyncCountCache.refreshPromise = null;
      }
    }
  })();
  cloudSyncCountCache.refreshPromise = promise;
  return promise;
}

async function getCloudSyncUsersMapAsync(forceRefresh = false) {
  const now = Date.now();
  const baselineReady = !USE_SUPABASE_CLOUDSYNC || cloudSyncDirectorySyncedAt > 0;
  if (!forceRefresh && cloudSyncUsersCache.map && baselineReady && now < cloudSyncUsersCache.expiresAt) {
    return cloudSyncUsersCache.map;
  }
  // Unconditionally deduplicate concurrent refreshes (even if forceRefresh is true)
  if (cloudSyncUsersRefreshPromise) {
    return cloudSyncUsersRefreshPromise;
  }
  if (USE_SUPABASE_CLOUDSYNC && isSupabaseDegraded()) {
    const map = cloudSyncUsersCache.map || buildCloudSyncUsersMap(collectFallbackUserRows([]));
    cloudSyncUsersCache = { map, expiresAt: Math.max(cloudSyncUsersCache.expiresAt, supabaseDegradedUntil) };
    cloudSyncUsersLoaded = true;
    return map;
  }
  const promise = (async () => {
    try {
      const [rows] = await Promise.all([
        dbListUsers({ limit: 1000, offset: 0, maxLimit: 1000 }),
        getCloudSyncUsersCountAsync(forceRefresh),
      ]);
      const map = buildCloudSyncUsersMap(rows);
      // Keep valid live point-looked-up users unless deleted
      if (cloudSyncUsersCache.map) {
        const deleted = getDeletedUsersSet();
        for (const [k, rec] of cloudSyncUsersCache.map.entries()) {
          if (map.has(k) || deleted.has(k) || shadowbannedUsers.has(k) || staleUsernameAliases.has(k)) continue;
          map.set(k, rec);
        }
      }
      if (!USE_SUPABASE_CLOUDSYNC || !isSupabaseDegraded()) {
        cloudSyncDirectorySyncedAt = Date.now();
      }
      cloudSyncUsersCache = {
        map,
        expiresAt: Date.now() + (isSupabaseDegraded() ? SUPABASE_DEGRADED_COOLDOWN_MS : USERS_CACHE_TTL_MS),
      };
      cloudSyncUsersLoaded = true;
      return map;
    } catch (err) {
      markSupabaseDegraded(err?.message || "user list failed");
      const fallback = cloudSyncUsersCache.map || buildCloudSyncUsersMap(collectFallbackUserRows([]));
      cloudSyncUsersCache = { map: fallback, expiresAt: Date.now() + SUPABASE_DEGRADED_COOLDOWN_MS };
      cloudSyncUsersLoaded = true;
      return fallback;
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
  const baselineReady = !USE_SUPABASE_CLOUDSYNC || cloudSyncDirectorySyncedAt > 0;
  if (!forceRefresh && cloudSyncUsersCache.map && baselineReady && now < cloudSyncUsersCache.expiresAt) {
    return cloudSyncUsersCache.map;
  }
  if (USE_SUPABASE_CLOUDSYNC && !isSupabaseDegraded()) {
    void getCloudSyncUsersMapAsync(false);
    if (cloudSyncUsersCache.map) return cloudSyncUsersCache.map;
  }
  try {
    const built = buildCloudSyncUsersMap(collectFallbackUserRows([]));
    if (built.size > 0 || !USE_SUPABASE_CLOUDSYNC || isSupabaseDegraded()) {
      cloudSyncUsersCache = {
        map: built,
        expiresAt:
          !USE_SUPABASE_CLOUDSYNC || isSupabaseDegraded()
            ? now + (isSupabaseDegraded() ? SUPABASE_DEGRADED_COOLDOWN_MS : USERS_CACHE_TTL_MS)
            : 0,
      };
      if (!USE_SUPABASE_CLOUDSYNC || isSupabaseDegraded()) {
        cloudSyncUsersLoaded = true;
      }
      return built;
    }
  } catch {
    // ignore if DB not initialized yet
  }
  return cloudSyncUsersCache.map || new Map();
}

// Single-row indexed lookup for an uncached @username (replaces full-table rescans!)
function findKnownOrDisplayNameUser(rawInput, csMap) {
  const clean = String(rawInput || "").trim().replace(/^@/, "");
  const key = clean.toLowerCase();
  if (!clean || isReservedSystemUsername(clean) || isTemporaryGuestName(clean) || getDeletedUsersSet().has(key)) {
    return null;
  }
  if (csMap && csMap.has(key)) {
    return csMap.get(key);
  }
  const byNameCached = cloudSyncUserByNameCache.get(key);
  if (byNameCached && byNameCached.username) {
    return {
      id: Number(byNameCached.id) || 0,
      username: String(byNameCached.username).trim(),
      createdAt: byNameCached.created_at || null,
    };
  }
  // Check active live SSE clients & HTTP heartbeats
  for (const c of liveClients.values()) {
    const u = String(c?.verifiedUsername || c?.username || "").trim();
    if (u && u.toLowerCase() === key && !isTemporaryGuestName(u)) {
      return { id: Number(c?.userId) || 0, username: u, createdAt: null };
    }
  }
  for (const hb of httpHeartbeats.values()) {
    const u = String(hb?.verifiedUsername || hb?.username || "").trim();
    if (u && u.toLowerCase() === key && !isTemporaryGuestName(u)) {
      return { id: Number(hb?.userId) || 0, username: u, createdAt: null };
    }
  }
  // Check knownUsers, userProfiles, staff/owners/goats, and chatHistory
  if (knownUsers.has(key)) {
    const ku = knownUsers.get(key);
    return { id: 0, username: ku?.username || clean, createdAt: null };
  }
  if (userProfiles.has(key) || OWNER_USERNAMES.has(key) || staffModerators.has(key) || goatUsers.has(key)) {
    return { id: 0, username: clean, createdAt: null };
  }
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    const author = String(chatHistory[i]?.author || "").trim();
    if (author && author.toLowerCase() === key && !isTemporaryGuestName(author)) {
      return { id: 0, username: author, createdAt: null };
    }
  }
  // Check if the query matches a user's custom displayName in userProfiles
  for (const [profKey, prof] of userProfiles.entries()) {
    const dName = String(prof?.customization?.displayName || "").trim();
    if (dName && dName.toLowerCase() === key && !getDeletedUsersSet().has(profKey)) {
      if (csMap && csMap.has(profKey)) return csMap.get(profKey);
      const ku = knownUsers.get(profKey);
      return { id: 0, username: ku?.username || profKey, createdAt: null };
    }
  }
  return null;
}

async function ensureCloudSyncUserInMap(username) {
  const csMap = await getCloudSyncUsersMapAsync().catch(() => getCloudSyncUsersMap());
  const clean = String(username || "").trim().replace(/^@/, "");
  const key = clean.toLowerCase();
  if (!clean || isReservedSystemUsername(clean) || isTemporaryGuestName(clean) || getDeletedUsersSet().has(key)) {
    return { csMap, user: null };
  }
  if (csMap.has(key)) {
    return { csMap, user: csMap.get(key) };
  }
  const now = Date.now();
  if (now < (missingUserLookupCache.get(key) || 0)) {
    const fallbackKnown = findKnownOrDisplayNameUser(clean, csMap);
    if (fallbackKnown) {
      csMap.set(fallbackKnown.username.toLowerCase(), fallbackKnown);
      return { csMap, user: fallbackKnown };
    }
    return { csMap, user: null };
  }
  if (singleUserLookupInFlight.has(key)) {
    await singleUserLookupInFlight.get(key);
    const updatedMap = getCloudSyncUsersMap();
    const resolved = updatedMap.get(key) || findKnownOrDisplayNameUser(clean, updatedMap);
    return { csMap: updatedMap, user: resolved || null };
  }
  const lookupPromise = (async () => {
    try {
      const row = await dbFindUserByUsername(clean);
      if (row && row.username) {
        upsertUserInCaches({ id: row.id, username: row.username });
        return row;
      }
      const fallbackKnown = findKnownOrDisplayNameUser(clean, csMap);
      if (fallbackKnown) {
        upsertUserInCaches({ id: fallbackKnown.id || 0, username: fallbackKnown.username });
        return fallbackKnown;
      }
      if (!isSupabaseDegraded()) {
        missingUserLookupCache.set(key, Date.now() + 5_000);
      }
      return null;
    } catch {
      return findKnownOrDisplayNameUser(clean, csMap);
    } finally {
      singleUserLookupInFlight.delete(key);
    }
  })();
  singleUserLookupInFlight.set(key, lookupPromise);
  const foundRow = await lookupPromise;
  const latestMap = getCloudSyncUsersMap();
  if (foundRow && foundRow.username) {
    const foundKey = String(foundRow.username).trim().toLowerCase();
    if (!latestMap.has(foundKey)) {
      latestMap.set(foundKey, {
        id: Number(foundRow.id) || 0,
        username: String(foundRow.username).trim(),
        createdAt: foundRow.created_at || foundRow.createdAt || null,
      });
    }
    return { csMap: latestMap, user: latestMap.get(foundKey) || null };
  }
  return { csMap: latestMap, user: latestMap.get(key) || null };
}

async function getCloudSyncUserAsync(username) {
  if (!username) return null;
  const clean = String(username).trim();
  if (!clean) return null;
  const { user } = await ensureCloudSyncUserInMap(clean);
  return user || null;
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
  const rawClean = String(username).trim();
  if (!rawClean) return;
  const rawKey = rawClean.toLowerCase();
  const alias = staleUsernameAliases.get(rawKey);
  const clean = alias ? alias.username : rawClean;
  const key = clean.toLowerCase();
  const csMap = getCloudSyncUsersMap();
  if (isTemporaryGuestName(clean) && !csMap.has(key)) return;
  if (cloudSyncUsersLoaded && csMap.size > 0 && !csMap.has(key) && !extra.verified) return;

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
  const csById = new Map();
  for (const rec of csMap.values()) {
    const uid = Number(rec?.id) || 0;
    if (uid > 0 && !csById.has(uid)) csById.set(uid, rec);
  }
  const now = Date.now();
  const usersLoaded = Boolean(!USE_SUPABASE_CLOUDSYNC || cloudSyncUsersLoaded);
  const deletedSet = getDeletedUsersSet();

  // Prune stale, deleted, shadowbanned, aliased, or non-CloudSync entries once directory is loaded
  for (const [k] of knownUsers.entries()) {
    if (
      deletedSet.has(k) ||
      shadowbannedUsers.has(k) ||
      staleUsernameAliases.has(k) ||
      (usersLoaded && ((csMap.size > 0 && !csMap.has(k)) || (isTemporaryGuestName(k) && !csMap.has(k))))
    ) {
      knownUsers.delete(k);
    }
  }

  // Ensure every registered CloudSync user is in knownUsers (keeping canonical username)
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

  const onlineByAccount = new Map();
  const onlineUsernameKeys = new Set();
  const considerOnlineSession = (c, maxAgeMs) => {
    if (!c || now - (c.lastSeen || 0) > maxAgeMs) return;
    const rawClean = String(c.username || "").trim();
    if (!rawClean) return;
    const rawKey = rawClean.toLowerCase();
    if (deletedSet.has(rawKey) || shadowbannedUsers.has(rawKey)) return;

    const alias = staleUsernameAliases.get(rawKey);
    const sessionUserId = Number(c.userId) || 0;
    // Only remap via userId when rawKey is absent from csMap (renamed/stale tab) or already matches that id
    let csRecord = alias ? csMap.get(alias.username.toLowerCase()) || alias : csMap.get(rawKey) || null;
    if (!csRecord && sessionUserId > 0 && csById.has(sessionUserId)) {
      csRecord = csById.get(sessionUserId);
    }
    const key = csRecord ? csRecord.username.toLowerCase() : rawKey;
    if (deletedSet.has(key) || shadowbannedUsers.has(key)) return;

    const hasVerifiedSession = Boolean(
      c.verifiedUsername && (c.verifiedUsername === rawKey || c.verifiedUsername === key)
    );
    if (isTemporaryGuestName(rawClean) && !csMap.has(key) && !hasVerifiedSession) return;
    if (usersLoaded && csMap.size > 0 && !csMap.has(key)) {
      const allowDegraded = isSupabaseDegraded() && !isTemporaryGuestName(rawClean);
      if (!hasVerifiedSession && !allowDegraded) {
        return;
      }
    }

    const canonicalName = csRecord ? csRecord.username : rawClean;
    const canonicalKey = canonicalName.toLowerCase();
    const resolvedId = Number(csRecord?.id || sessionUserId || 0);
    const dedupKey = resolvedId > 0 ? `id:${resolvedId}` : `name:${canonicalKey}`;
    onlineUsernameKeys.add(canonicalKey);
    onlineUsernameKeys.add(rawKey);

    const prof = userProfiles.get(canonicalKey) || userProfiles.get(rawKey) || {};
    const timeoutEntry = getActiveTimeout(canonicalKey) || getActiveTimeout(rawKey);
    const role = getUserChatRole(canonicalName);
    const existing = onlineByAccount.get(dedupKey);
    const cIdle = Boolean(c.isIdle) || prof?.customization?.presenceStatus === "idle";
    const cPlayingGame = !cIdle && Boolean(c.isPlayingGame);
    const incomingMatchesCanonical = rawKey === canonicalKey;
    const existingMatchesCanonical = existing ? existing.username.toLowerCase() === canonicalKey : false;
    // Prefer latest canonical username session, then active (non-idle), playing game, or most recent heartbeat
    const preferIncoming =
      !existing ||
      (incomingMatchesCanonical && !existingMatchesCanonical) ||
      (incomingMatchesCanonical === existingMatchesCanonical &&
        ((Boolean(existing.isIdle) && !cIdle) ||
          (existing.isIdle === cIdle && ((cPlayingGame && !existing.isPlayingGame) || c.lastSeen >= existing.lastSeen))));
    if (preferIncoming) {
      onlineByAccount.set(dedupKey, {
        id: c.id,
        userId: resolvedId || undefined,
        username: canonicalName,
        online: true,
        isIdle: cIdle,
        page: c.page || "/",
        game: cPlayingGame ? (c.game || "browsing") : "browsing",
        isPlayingGame: cPlayingGame,
        gameStartedAt: cPlayingGame ? (Number(c.gameStartedAt) || 0) : 0,
        lastSeen: c.lastSeen,
        bio: prof.bio || "",
        statusText: prof.statusText || "",
        customization: prof.customization || null,
        role,
        isGoat: goatUsers.has(canonicalKey),
        isTimedOut: Boolean(timeoutEntry),
        timeoutUntil: timeoutEntry ? timeoutEntry.until : 0,
        createdAt: csRecord?.createdAt || null,
      });
    }
  };

  for (const c of liveClients.values()) {
    if (c.res?.writableEnded || c.res?.destroyed) continue;
    considerOnlineSession(c, LIVE_SSE_PRESENCE_TTL_MS);
  }
  for (const hb of httpHeartbeats.values()) {
    considerOnlineSession(hb, HTTP_HEARTBEAT_PRESENCE_TTL_MS);
  }

  const onlineUsers = Array.from(onlineByAccount.values());
  const offlineUsers = [];
  const seenOfflineKeys = new Set();
  for (const [key, u] of knownUsers.entries()) {
    if (deletedSet.has(key) || shadowbannedUsers.has(key) || staleUsernameAliases.has(key)) continue;
    const csRecord = csMap.get(key);
    if (csRecord?.id > 0 && onlineByAccount.has(`id:${csRecord.id}`)) continue;
    if (onlineUsernameKeys.has(key) || onlineByAccount.has(`name:${key}`)) continue;
    const prof = userProfiles.get(key) || {};
    const canonicalName = csRecord ? csRecord.username : u.username;
    const canonicalKey = canonicalName.toLowerCase();
    if (onlineUsernameKeys.has(canonicalKey) || seenOfflineKeys.has(canonicalKey)) continue;
    seenOfflineKeys.add(canonicalKey);
    const timeoutEntry = getActiveTimeout(canonicalKey);
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
      isGoat: goatUsers.has(canonicalKey),
      isTimedOut: Boolean(timeoutEntry),
      timeoutUntil: timeoutEntry ? timeoutEntry.until : 0,
      createdAt: csRecord?.createdAt || null,
    });
  }

  const registeredUsers = Array.from(csMap.values()).map((u) => u.username);
  return {
    snapshotAt: now,
    usersLoaded,
    totalUsersCount: getCloudSyncUsersCountSync(csMap),
    onlineUsers,
    offlineUsers,
    registeredUsers,
    staffMods: getCanonicalStaffMods(csMap),
    ownerUsers: getCanonicalOwnerUsers(csMap),
    goatUsers: getCanonicalGoatUsers(csMap),
    cookieMasterUsers: getActiveCookieMasterUsersList(),
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

function broadcastToClients(actionPayload, target = "all", options = {}) {
  const { excludeClientId = null } = options || {};
  const payloadStr = `data: ${JSON.stringify(actionPayload)}\n\n`;
  let delivered = 0;
  let targetUserLower = "";
  if (target && target !== "all") {
    targetUserLower = String(target).trim().toLowerCase();
    const matchedLive = liveClients.get(target);
    if (matchedLive?.username && String(matchedLive.username).toLowerCase() !== "anonymous") {
      targetUserLower = String(matchedLive.username).trim().toLowerCase();
    } else if (typeof httpHeartbeats !== "undefined" && httpHeartbeats.has(target)) {
      const hb = httpHeartbeats.get(target);
      if (hb?.username && String(hb.username).toLowerCase() !== "anonymous") {
        targetUserLower = String(hb.username).trim().toLowerCase();
      }
    }
  }
  for (const [id, client] of liveClients.entries()) {
    if (excludeClientId && id === excludeClientId && target === "all") continue;
    const clientUserLower = String(client.username || "").trim().toLowerCase();
    if (
      target === "all" ||
      target === id ||
      (targetUserLower && clientUserLower && clientUserLower !== "anonymous" && clientUserLower === targetUserLower)
    ) {
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
let lastBroadcastOnlineKey = "";
setInterval(() => {
  try {
    const now = Date.now();
    heartbeatTick++;
    let prunedAny = false;
    for (const [id, client] of liveClients.entries()) {
      if (
        client.res?.writableEnded ||
        client.res?.destroyed ||
        now - (client.lastSeen || 0) > Math.max(LIVE_SSE_PRESENCE_TTL_MS + 60000, 420000)
      ) {
        liveClients.delete(id);
        prunedAny = true;
        continue;
      }
      try {
        client.res.write(": keepalive\n\n");
      } catch {
        liveClients.delete(id);
        prunedAny = true;
      }
    }
    for (const [id, hb] of httpHeartbeats.entries()) {
      if (!hb || now - (hb.lastSeen || 0) > HTTP_HEARTBEAT_PRESENCE_TTL_MS) {
        httpHeartbeats.delete(id);
        prunedAny = true;
      }
    }
    if (liveClients.size > 0 || httpHeartbeats.size > 0 || prunedAny) {
      const snap = getPresenceSnapshot();
      const onlineSig = snap.onlineUsers
        .map((u) => `${u.username.toLowerCase()}:${u.isIdle ? 1 : 0}:${u.game || ""}`)
        .sort()
        .join("|");
      const nextKey = `${onlineSig}::${snap.usersLoaded ? snap.registeredUsers.length : "pending"}`;
      if (prunedAny || nextKey !== lastBroadcastOnlineKey) {
        lastBroadcastOnlineKey = nextKey;
        if (liveClients.size > 0) {
          broadcastToClients({ type: "presence-event", ...snap }, "all");
        }
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
        for (const [uname, entry] of knownUsers.entries()) {
          const ts = Number(entry?.lastSeen || 0);
          if (ts > 0 && now - ts > 24 * 60 * 60 * 1000) knownUsers.delete(uname);
        }
      }
      for (const [uname, info] of activeUsers.entries()) {
        if (!info || now - Number(info.lastSeen || 0) > ACTIVE_USER_TTL_MS) {
          activeUsers.delete(uname);
        }
      }
    }
    if (heartbeatTick % 20 === 0 && sharedCloudSyncDb) {
      try {
        sharedCloudSyncDb.exec("PRAGMA wal_checkpoint(PASSIVE);");
      } catch {}
    }
  } catch (err) {
    console.warn("Keepalive interval warning:", err?.message || err);
  }
}, 15000);

app.post("/api/admin/verify", (req, res) => {
  const authHeader = req.headers.authorization;
  const bearerKey = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const key = String(req.headers["x-admin-key"] || bearerKey || (req.body && req.body.adminSecret) || "").trim();
  if (!key || key !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, error: "Invalid Admin Secret" });
  }
  res.json({ success: true, username: ADMIN_USERNAME });
});

app.get("/api/live/stream", async (req, res) => {
  const [authUser] = await Promise.all([
    getAuthenticatedCloudSyncUser(req, { allowUnmirroredJwt: USE_SUPABASE_CLOUDSYNC }),
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

  if (authUser) {
    upsertUserInCaches({ id: authUser.id, username: authUser.username });
  }
  const clientId = (req.query.id || Math.random().toString(36).substring(2, 10)).toString();
  const instanceId = String(req.query.instance || "").trim().slice(0, 64);
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
    instanceId,
    userId: authUser ? Number(authUser.id) || 0 : 0,
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
  touchKnownUser(username, {
    game,
    isPlayingGame: false,
    gameStartedAt: 0,
    verified: Boolean(authUser),
  });

  const cleanupSseClient = () => {
    if (liveClients.get(clientId) === clientRecord) {
      liveClients.delete(clientId);
      const activeHb = httpHeartbeats.get(clientId);
      if (
        !activeHb ||
        (instanceId && activeHb.instanceId === instanceId && Date.now() - (activeHb.lastSeen || 0) > 15000) ||
        Date.now() - (activeHb.lastSeen || 0) > HTTP_HEARTBEAT_PRESENCE_TTL_MS
      ) {
        httpHeartbeats.delete(clientId);
      }
      touchKnownUser(clientRecord.username, {
        isPlayingGame: false,
        gameStartedAt: 0,
        verified: Boolean(clientRecord.verifiedUsername),
      });
      broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    }
  };

  req.on("error", cleanupSseClient);
  res.on("error", cleanupSseClient);
  req.on("close", cleanupSseClient);

  // Initial handshake
  res.write(`data: ${JSON.stringify({ type: "connected", clientId, username })}\n\n`);
  broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
});

app.post("/api/live/heartbeat", async (req, res) => {
  const [authUser] = await Promise.all([
    getAuthenticatedCloudSyncUser(req, { allowUnmirroredJwt: USE_SUPABASE_CLOUDSYNC }).catch(() => null),
    USE_SUPABASE_CLOUDSYNC && !cloudSyncUsersLoaded
      ? getCloudSyncUsersMapAsync().catch(() => null)
      : Promise.resolve(null),
  ]);
  const { clientId, instanceId, username, page, game, isPlayingGame, gameStartedAt, idle } = req.body || {};
  const now = Date.now();
  const cleanInstance = String(instanceId || "").trim().slice(0, 64);
  const rawUser = String(username || "").trim();
  const effectiveUser = authUser ? authUser.username : rawUser;
  const verifiedLower = authUser ? authUser.username.toLowerCase() : null;
  const authUserId = authUser ? Number(authUser.id) || 0 : 0;
  if (authUser) {
    upsertUserInCaches({ id: authUser.id, username: authUser.username });
  }
  let changed = false;

  if (clientId && liveClients.has(clientId)) {
    const client = liveClients.get(clientId);
    if (cleanInstance) client.instanceId = cleanInstance;
    if (authUserId > 0) client.userId = authUserId;
    if (verifiedLower && client.verifiedUsername !== verifiedLower) {
      client.verifiedUsername = verifiedLower;
      changed = true;
    } else if (!authUser && isTemporaryGuestName(rawUser) && client.verifiedUsername) {
      client.verifiedUsername = null;
      client.userId = 0;
      changed = true;
    }
    if (effectiveUser && client.username !== effectiveUser) {
      client.username = effectiveUser;
      changed = true;
    }
    if (page) client.page = page;
    if (typeof game === "string" && client.game !== game) {
      client.game = game;
      changed = true;
    }
    if (typeof isPlayingGame === "boolean") {
      if (client.isPlayingGame !== isPlayingGame) changed = true;
      client.isPlayingGame = isPlayingGame;
    }
    if (typeof gameStartedAt === "number") {
      client.gameStartedAt = gameStartedAt;
    }
    if (typeof idle === "boolean" && client.isIdle !== idle) {
      client.isIdle = idle;
      changed = true;
    }
    if (now - (client.lastSeen || 0) > LIVE_SSE_PRESENCE_TTL_MS - 15000) {
      changed = true;
    }
    client.lastSeen = now;
    touchKnownUser(client.username, {
      game: client.game,
      isPlayingGame: client.isPlayingGame,
      gameStartedAt: client.gameStartedAt,
      verified: Boolean(client.verifiedUsername),
    });
  } else if (effectiveUser) {
    touchKnownUser(effectiveUser, {
      game: game || "browsing",
      isPlayingGame: Boolean(isPlayingGame),
      gameStartedAt: Number(gameStartedAt) || 0,
      verified: Boolean(verifiedLower),
    });
    changed = true;
  }

  if (clientId && effectiveUser) {
    const prevHb = httpHeartbeats.get(clientId);
    if (
      !prevHb ||
      prevHb.username !== effectiveUser ||
      prevHb.isIdle !== Boolean(idle) ||
      prevHb.game !== (typeof game === "string" ? game : "browsing")
    ) {
      changed = true;
    }
    httpHeartbeats.set(clientId, {
      id: String(clientId),
      instanceId: cleanInstance || prevHb?.instanceId || "",
      userId: authUserId || (isTemporaryGuestName(rawUser) ? 0 : prevHb?.userId || 0),
      username: effectiveUser,
      verifiedUsername: verifiedLower,
      page: typeof page === "string" ? page.slice(0, 200) : "/",
      game: typeof game === "string" ? game.slice(0, 120) : "browsing",
      isPlayingGame: Boolean(isPlayingGame),
      gameStartedAt: Number(gameStartedAt) || 0,
      isIdle: Boolean(idle),
      lastSeen: now,
    });
  }

  if (changed) {
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
  }
  res.json({ success: true });
});

app.post("/api/live/offline", (req, res) => {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const clientId = String(body?.clientId || req.query?.id || "").trim();
    const instanceId = String(body?.instanceId || req.query?.instance || "").trim();
    if (clientId) {
      let hadAny = false;
      const rec = liveClients.get(clientId);
      const hbRec = httpHeartbeats.get(clientId);
      const recMatches = !instanceId || !rec?.instanceId || rec.instanceId === instanceId;
      const hbMatches = !instanceId || !hbRec?.instanceId || hbRec.instanceId === instanceId;
      if (rec && recMatches) {
        if (rec.username) {
          touchKnownUser(rec.username, {
            isPlayingGame: false,
            gameStartedAt: 0,
            verified: Boolean(rec.verifiedUsername),
          });
        }
        liveClients.delete(clientId);
        hadAny = true;
      }
      if (hbRec && hbMatches) {
        httpHeartbeats.delete(clientId);
        hadAny = true;
      }
      if (hadAny) {
        broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
      }
    }
  } catch {}
  res.json({ success: true });
});

app.get("/api/admin/clients", verifyAdmin, (_req, res) => {
  const now = Date.now();
  const byId = new Map();
  for (const hb of httpHeartbeats.values()) {
    if (!hb || now - (hb.lastSeen || 0) > HTTP_HEARTBEAT_PRESENCE_TTL_MS) continue;
    byId.set(hb.id, {
      id: hb.id,
      username: hb.username,
      ip: "http-heartbeat",
      page: hb.page,
      game: hb.game,
      connectedAt: hb.lastSeen,
      lastSeen: hb.lastSeen,
    });
  }
  for (const c of liveClients.values()) {
    if (c.res?.writableEnded || c.res?.destroyed) continue;
    byId.set(c.id, {
      id: c.id,
      username: c.username,
      ip: c.ip,
      page: c.page,
      game: c.game,
      connectedAt: c.connectedAt,
      lastSeen: c.lastSeen,
    });
  }
  const clients = Array.from(byId.values());
  res.json({ success: true, count: clients.length, clients });
});

app.post("/api/admin/trigger", verifyAdmin, (req, res) => {
  const { target = "all", action, data, adminClientId = null } = req.body || {};
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

  const excludeId =
    target === "all" && action !== "killswitch" && action !== "clear-effects"
      ? adminClientId
      : null;
  const count = broadcastToClients(payload, target, { excludeClientId: excludeId });
  if (target && target !== "all") {
    const clientMatch = liveClients.get(target) || httpHeartbeats.get(target);
    const targetName = String(clientMatch?.username || "").trim();
    if (targetName && targetName.toLowerCase() !== "anonymous") {
      recordStaffAction({
        action: `admin_${String(action).trim().slice(0, 32)}`,
        actor: { username: ADMIN_USERNAME, role: "owner" },
        targetUsername: targetName,
        details: data?.message
          ? String(data.message).slice(0, 120)
          : data?.sound
          ? `sound: ${String(data.sound).slice(0, 80)}`
          : `admin effect (${count} session)`,
      });
    }
  }
  res.json({ success: true, count, target, action });
});

function getPendingCoinGrantsObj() {
  const raw = kvGetJson("pending_coin_grants_v1", {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function savePendingCoinGrantsObj(obj) {
  kvSetJson("pending_coin_grants_v1", obj);
}

function deliverCoinGrant({
  username = "",
  targetClientId = "",
  amount = 0,
  from = "admin",
  reason = "",
}) {
  const cleanAmount = Math.max(1, Math.min(10000000, Math.floor(Number(amount) || 0)));
  const grantId = `grant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cleanFrom = String(from || "admin").trim().slice(0, 40);
  const cleanReason = String(reason || "").trim().slice(0, 120);
  const cleanUser = String(username || "").trim().replace(/^@/, "");
  const userKey = cleanUser.toLowerCase();

  const payload = {
    type: "cookie-coins:grant",
    grantId,
    amount: cleanAmount,
    from: cleanFrom,
    reason: cleanReason || `gift from @${cleanFrom}`,
    targetUsername: cleanUser || undefined,
    timestamp: Date.now(),
  };

  if (!userKey && targetClientId === "all") {
    const delivered = broadcastToClients(payload, "all");
    return { grantId, amount: cleanAmount, delivered, queued: false };
  }

  let delivered = 0;
  if (targetClientId && targetClientId !== "all") {
    delivered += broadcastToClients(payload, targetClientId);
  }
  if (userKey) {
    for (const [cid, c] of liveClients.entries()) {
      if (cid === targetClientId) continue;
      const cu = String(c?.verifiedUsername || c?.username || "").trim().toLowerCase();
      if (cu === userKey) {
        delivered += broadcastToClients(payload, cid);
      }
    }
    if (delivered === 0) {
      const map = getPendingCoinGrantsObj();
      const existing = Array.isArray(map[userKey]) ? map[userKey] : [];
      existing.push({
        grantId,
        amount: cleanAmount,
        from: cleanFrom,
        reason: payload.reason,
        createdAt: Date.now(),
      });
      map[userKey] = existing.slice(-40);
      savePendingCoinGrantsObj(map);
      return { grantId, amount: cleanAmount, delivered: 0, queued: true };
    }
  }
  return { grantId, amount: cleanAmount, delivered, queued: false };
}

app.post("/api/admin/give-coins", verifyAdmin, async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const rawTarget = String(req.body?.target || "all").trim();
    const rawUsername = String(req.body?.username || "").trim().replace(/^@/, "");
    const amount = Math.floor(Number(req.body?.amount) || 0);
    const reason = String(req.body?.reason || "admin treasury gift").trim().slice(0, 120);

    if (!Number.isFinite(amount) || amount < 1 || amount > 10000000) {
      return res.status(400).json({ success: false, error: "Amount must be between 1 and 10,000,000" });
    }

    let resolvedUsername = rawUsername;
    let targetClientId = rawTarget;
    if (!resolvedUsername && rawTarget !== "all") {
      const clientMatch = liveClients.get(rawTarget) || httpHeartbeats.get(rawTarget);
      if (clientMatch?.username && String(clientMatch.username).toLowerCase() !== "anonymous") {
        resolvedUsername = String(clientMatch.username).trim();
      }
    }

    const result = deliverCoinGrant({
      username: resolvedUsername,
      targetClientId: resolvedUsername ? (rawTarget !== "all" ? rawTarget : "") : targetClientId,
      amount,
      from: ADMIN_USERNAME,
      reason,
    });

    const targetLabel = resolvedUsername ? `@${resolvedUsername}` : rawTarget === "all" ? "everyone online" : rawTarget;
    recordStaffAction({
      action: "admin_give_coins",
      actor: { username: ADMIN_USERNAME, role: "owner" },
      targetUsername: resolvedUsername || "all",
      details: `granted ${amount.toLocaleString()} coins to ${targetLabel}${reason ? ` (${reason})` : ""}`,
    });

    res.json({
      success: true,
      ...result,
      targetLabel,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || "Failed to grant coins" });
  }
});

app.post("/api/coins/claim-pending", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser?.username) {
      return res.json({ success: true, grants: [] });
    }
    const userKey = authUser.username.toLowerCase();
    const claimedSet = new Set(
      Array.isArray(req.body?.claimedIds) ? req.body.claimedIds.map((x) => String(x)) : []
    );
    const map = getPendingCoinGrantsObj();
    const list = Array.isArray(map[userKey]) ? map[userKey] : [];
    if (list.length === 0) {
      return res.json({ success: true, grants: [] });
    }
    delete map[userKey];
    savePendingCoinGrantsObj(map);
    const fresh = list.filter((g) => g && g.grantId && !claimedSet.has(String(g.grantId)));
    return res.json({ success: true, grants: fresh });
  } catch (err) {
    return res.status(500).json({ success: false, grants: [], error: err?.message });
  }
});

const chatGiftLastSentAt = new Map(); // senderKey -> timestampMs
const buyMasterLastAt = new Map(); // userKey -> timestampMs

function getCoinClaimCooldownsObj() {
  const raw = kvGetJson("coin_claim_cooldowns_v1", {});
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function saveCoinClaimCooldownsObj(obj) {
  kvSetJson("coin_claim_cooldowns_v1", obj);
}

app.post("/api/coins/claim-reward", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const rewardType = String(req.body?.rewardType || "").trim().toLowerCase();
    const fp = String(req.body?.fingerprint_id || req.body?.storage_token || "").trim().slice(0, 80);
    const clientIp = String(req.headers["cf-connecting-ip"] || req.ip || "anon").trim().slice(0, 64);
    const actorKey = authUser?.username
      ? `u:${authUser.username.toLowerCase()}`
      : fp
        ? `d:${fp}`
        : `ip:${clientIp}`;

    const now = Date.now();
    const map = getCoinClaimCooldownsObj();
    const rec = map[actorKey] && typeof map[actorKey] === "object" ? { ...map[actorKey] } : {};

    if (rewardType === "hourly_jar") {
      const INTERVAL = 60 * 60 * 1000;
      const last = Number(rec.hourlyAt || 0);
      if (last > 0 && now - last < INTERVAL) {
        return res.status(429).json({
          success: false,
          remainingMs: INTERVAL - (now - last),
          error: "Hourly cookie jar is still on cooldown",
        });
      }
      rec.hourlyAt = now;
      map[actorKey] = rec;
      saveCoinClaimCooldownsObj(map);
      return res.json({ success: true, amount: 75, nextAt: now + INTERVAL });
    }

    if (rewardType === "daily_streak") {
      const INTERVAL = 24 * 60 * 60 * 1000;
      const last = Number(rec.streakAt || 0);
      if (last > 0 && now - last < INTERVAL) {
        return res.status(429).json({
          success: false,
          remainingMs: INTERVAL - (now - last),
          error: "Daily check-in already claimed",
        });
      }
      let streak = Math.max(0, Number(rec.streakCount || 0));
      if (last > 0 && now - last > 48 * 60 * 60 * 1000) streak = 0;
      const rewards = [100, 150, 225, 325, 500];
      const amount = rewards[Math.min(rewards.length - 1, streak)];
      rec.streakAt = now;
      rec.streakCount = streak + 1;
      map[actorKey] = rec;
      saveCoinClaimCooldownsObj(map);
      return res.json({ success: true, amount, streak: rec.streakCount, nextAt: now + INTERVAL });
    }

    if (rewardType === "daily_master") {
      const INTERVAL = 24 * 60 * 60 * 1000;
      const last = Number(rec.masterDailyAt || 0);
      if (last > 0 && now - last < INTERVAL) {
        return res.status(429).json({
          success: false,
          remainingMs: INTERVAL - (now - last),
          error: "Daily Cookie Master coins already claimed",
        });
      }
      rec.masterDailyAt = now;
      map[actorKey] = rec;
      saveCoinClaimCooldownsObj(map);
      return res.json({ success: true, amount: 1000, nextAt: now + INTERVAL });
    }

    if (rewardType === "clicker_burst") {
      const WINDOW_MS = 30 * 60 * 1000;
      const MAX_BURSTS = 8;
      let winStart = Number(rec.clickerWinStart || 0);
      let used = Math.max(0, Number(rec.clickerUsed || 0));
      const lastBurst = Number(rec.clickerLastAt || 0);
      if (lastBurst > 0 && now - lastBurst < 1200) {
        return res.status(429).json({ success: false, remainingMs: 1200, error: "Slow down!" });
      }
      if (!winStart || now - winStart >= WINDOW_MS) {
        winStart = now;
        used = 0;
      }
      if (used >= MAX_BURSTS) {
        return res.status(429).json({
          success: false,
          remainingMs: Math.max(1000, winStart + WINDOW_MS - now),
          error: "Cookie clicker is recharging",
        });
      }
      rec.clickerWinStart = winStart;
      rec.clickerUsed = used + 1;
      rec.clickerLastAt = now;
      map[actorKey] = rec;
      saveCoinClaimCooldownsObj(map);
      return res.json({
        success: true,
        amount: 10,
        remainingBursts: Math.max(0, MAX_BURSTS - rec.clickerUsed),
        resetInMs: Math.max(0, winStart + WINDOW_MS - now),
      });
    }

    return res.status(400).json({ success: false, error: "Invalid rewardType" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || "Failed to claim reward" });
  }
});

app.post("/api/chat/gift", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser?.username) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync to send gifts" });
    }
    const senderName = authUser.username;
    const senderKey = senderName.toLowerCase();
    const isOwnerSender = OWNER_USERNAMES.has(senderKey);

    if (!isOwnerSender && isAccountShadowbanned(senderKey)) {
      return res.status(403).json({ success: false, error: "Unable to send gifts right now" });
    }

    const lastGiftAt = chatGiftLastSentAt.get(senderKey) || 0;
    if (!isOwnerSender && Date.now() - lastGiftAt < 3000) {
      return res.status(429).json({ success: false, error: "Please wait a moment before sending another gift" });
    }
    chatGiftLastSentAt.set(senderKey, Date.now());

    const recipientRaw = String(req.body?.recipient || "").trim().replace(/^@/, "");
    const recipientKey = recipientRaw.toLowerCase();
    if (!recipientKey) {
      return res.status(400).json({ success: false, error: "Please choose a recipient username" });
    }
    if (!isOwnerSender && recipientKey === senderKey) {
      return res.status(400).json({ success: false, error: "You cannot send a gift to yourself" });
    }

    const giftType = String(req.body?.giftType || "coins").trim().toLowerCase();
    const channel = String(req.body?.channel || "general").trim();
    const note = String(req.body?.note || "").trim().slice(0, 120);

    const csMap = await getCloudSyncUsersMapAsync().catch(() => new Map());
    const recipientRec = csMap.get(recipientKey) || (await dbFindUserByUsername(recipientRaw).catch(() => null));
    const canonicalRecipient = recipientRec?.username || recipientRaw;

    if (giftType === "cookie_master") {
      const now = Date.now();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const existingSub = await findActiveStripeSubscription({ username: canonicalRecipient }).catch(() => null);
      const baseExpiry = existingSub && existingSub.expiresAt > now ? existingSub.expiresAt : now;
      const nextExpiresAt = baseExpiry + THIRTY_DAYS_MS;
      const giftSubId = `gift_cm_${now}_${Math.random().toString(36).slice(2, 8)}`;

      await persistStripeSubscriptionRecord({
        subscriptionId: giftSubId,
        checkoutSessionId: giftSubId,
        invoiceId: giftSubId,
        customerId: `gift_from_${senderKey}`,
        emailLower: "",
        userNameLower: canonicalRecipient.toLowerCase(),
        customUsernameLower: canonicalRecipient.toLowerCase(),
        claimedUsernameLower: canonicalRecipient.toLowerCase(),
        priceId: "gift_1_month",
        productId: "cookie_master_gift",
        tierName: "Cookie Master (Gifted)",
        status: "active",
        managedPayments: false,
        customerPortalUrl: "",
        amount: 2,
        verifiedAt: now,
        expiresAt: nextExpiresAt,
        cancelledAt: null,
      });

      const grantPayload = {
        type: "cookie-master:grant",
        subscriptionId: giftSubId,
        expiresAt: nextExpiresAt,
        from: senderName,
        note,
        targetUsername: canonicalRecipient,
        timestamp: now,
      };
      for (const [cid, c] of liveClients.entries()) {
        const cu = String(c?.verifiedUsername || c?.username || "").trim().toLowerCase();
        if (cu === canonicalRecipient.toLowerCase()) {
          broadcastToClients(grantPayload, cid);
        }
      }

      if (canAccessChatChannel(channel, senderKey)) {
        const authorProf = userProfiles.get(senderKey);
        const giftMsg = {
          id: `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
          channel,
          author: senderName,
          role: getUserChatRole(senderName),
          text: "",
          gift: {
            type: "cookie_master",
            from: senderName,
            to: canonicalRecipient,
            note,
          },
          timestamp: new Date(now).toISOString(),
          customization: authorProf?.customization || null,
          isGoat: goatUsers.has(senderKey),
        };
        chatHistory.push(giftMsg);
        persistChatHistory();
        broadcastChatPayload(channel, { type: "chat-event", event: "NEW_MESSAGE", message: giftMsg });
      }

      return res.json({
        success: true,
        giftType: "cookie_master",
        recipient: canonicalRecipient,
        expiresAt: nextExpiresAt,
      });
    }

    // Default: Cookie Coins gift
    const amount = Math.floor(Number(req.body?.amount) || 0);
    const minAmount = isOwnerSender ? 1 : 10;
    const maxAmount = isOwnerSender ? 1000000000 : 1000000;
    if (!Number.isFinite(amount) || amount < minAmount || amount > maxAmount) {
      return res.status(400).json({
        success: false,
        error: isOwnerSender
          ? "Gift amount must be at least 1 coin"
          : "Gift amount must be between 10 and 1,000,000 coins",
      });
    }

    const delivery = deliverCoinGrant({
      username: canonicalRecipient,
      amount,
      from: senderName,
      reason: note || `gift from @${senderName}`,
    });

    if (canAccessChatChannel(channel, senderKey)) {
      const now = Date.now();
      const authorProf = userProfiles.get(senderKey);
      const giftMsg = {
        id: `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
        channel,
        author: senderName,
        role: getUserChatRole(senderName),
        text: "",
        gift: {
          type: "coins",
          from: senderName,
          to: canonicalRecipient,
          amount,
          note,
        },
        timestamp: new Date(now).toISOString(),
        customization: authorProf?.customization || null,
        isGoat: goatUsers.has(senderKey),
      };
      chatHistory.push(giftMsg);
      persistChatHistory();
      broadcastChatPayload(channel, { type: "chat-event", event: "NEW_MESSAGE", message: giftMsg });
    }

    return res.json({
      success: true,
      giftType: "coins",
      recipient: canonicalRecipient,
      amount,
      delivered: delivery.delivered,
      queued: delivery.queued,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || "Failed to send gift" });
  }
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

app.get("/api/admin/myinstants-search", verifyAdmin, async (req, res) => {
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

app.post("/api/admin/resolve-sound", verifyAdmin, async (req, res) => {
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

const LASTFM_API_KEY = (process.env.LASTFM_API_KEY || process.env.LASTFM_APP_KEY || "").trim();
const LASTFM_API_BASE = (process.env.LASTFM_API_BASE || "https://ws.audioscrobbler.com/2.0/").trim();
const LASTFM_DEFAULT_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f";
const lastfmRecentCache = new LRUCache({ max: 500, ttl: 20 * 1000 });
const lastfmInflightFetches = new Map();
const lastfmForceCooldown = new LRUCache({ max: 500, ttl: 5 * 1000 });

function sanitizeLastfmLinkUrl(rawUrl, fallbackUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return fallbackUrl;
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      (host === "last.fm" || host.endsWith(".last.fm"))
    ) {
      parsed.protocol = "https:";
      return parsed.href;
    }
  } catch {}
  return fallbackUrl;
}

function pickLastfmAlbumArt(images) {
  if (!Array.isArray(images)) return "";
  const rank = { extralarge: 4, mega: 4, large: 3, medium: 2, small: 1 };
  const sorted = [...images]
    .filter((img) => img && typeof img["#text"] === "string" && img["#text"].trim())
    .sort((a, b) => (rank[String(b.size || "").toLowerCase()] || 0) - (rank[String(a.size || "").toLowerCase()] || 0));
  for (const img of sorted) {
    try {
      const parsed = new URL(img["#text"].trim());
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      parsed.protocol = "https:";
      if (parsed.href.includes(LASTFM_DEFAULT_PLACEHOLDER_HASH)) continue;
      return parsed.href;
    } catch {}
  }
  return "";
}

async function fetchLastfmRecentTrackAsync(rawUsername, { force = false } = {}) {
  const username = sanitizeLastfmUsernameServer(rawUsername);
  if (!username) return null;
  const profileUrl = `https://www.last.fm/user/${encodeURIComponent(username)}`;

  if (!LASTFM_API_KEY) {
    return {
      username,
      configured: false,
      found: false,
      nowPlaying: false,
      track: null,
      profileUrl,
      fetchedAt: Date.now(),
    };
  }

  const cacheKey = username.toLowerCase();
  const cached = lastfmRecentCache.get(cacheKey);
  if (cached && (!force || lastfmForceCooldown.get(cacheKey))) {
    return cached;
  }

  if (lastfmInflightFetches.has(cacheKey)) {
    return lastfmInflightFetches.get(cacheKey);
  }

  const reqPromise = (async () => {
    try {
      const base = LASTFM_API_BASE.replace(/\/+$/, "") + "/";
      const endpoint = `${base}?method=user.getrecenttracks&user=${encodeURIComponent(
        username,
      )}&api_key=${encodeURIComponent(LASTFM_API_KEY)}&format=json&limit=1`;
      const upstream = await fetch(endpoint, {
        headers: {
          "User-Agent": "sunshineWAVES/1.0 (lastfm-profile-widget)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(6000),
      });
      const data = await upstream.json().catch(() => null);

      if (data && typeof data.error === "number") {
        const errCode = data.error;
        const result = {
          username,
          configured: errCode !== 10 && errCode !== 26,
          found: errCode !== 6,
          privateProfile: errCode === 17,
          nowPlaying: false,
          track: null,
          profileUrl,
          fetchedAt: Date.now(),
          error:
            errCode === 6
              ? "Last.fm user not found"
              : errCode === 17
                ? "Recent tracks are private on Last.fm"
                : errCode === 10 || errCode === 26
                  ? "Server Last.fm API key was rejected"
                  : String(data.message || "Last.fm lookup failed"),
        };
        lastfmRecentCache.set(cacheKey, result);
        if (force) lastfmForceCooldown.set(cacheKey, true);
        return result;
      }

      if (!upstream.ok || !data?.recenttracks) {
        if (cached) return cached;
        return {
          username,
          configured: true,
          found: false,
          nowPlaying: false,
          track: null,
          profileUrl,
          fetchedAt: Date.now(),
          error: "Could not reach Last.fm right now",
        };
      }

      const rawTracks = data.recenttracks.track;
      const list = Array.isArray(rawTracks) ? rawTracks : rawTracks ? [rawTracks] : [];
      const activeTrack =
        list.find(
          (t) =>
            t &&
            (t["@attr"]?.nowplaying === "true" || t["@attr"]?.nowplaying === true),
        ) || list[0];

      if (!activeTrack || !activeTrack.name) {
        const emptyResult = {
          username,
          configured: true,
          found: true,
          nowPlaying: false,
          track: null,
          profileUrl,
          fetchedAt: Date.now(),
        };
        lastfmRecentCache.set(cacheKey, emptyResult);
        if (force) lastfmForceCooldown.set(cacheKey, true);
        return emptyResult;
      }

      const nowPlaying = Boolean(
        activeTrack["@attr"]?.nowplaying === "true" ||
          activeTrack["@attr"]?.nowplaying === true,
      );
      const scrobbledUts = Number(activeTrack.date?.uts || 0);
      const track = {
        name: String(activeTrack.name || "").trim().slice(0, 180),
        artist: String(
          activeTrack.artist?.["#text"] ||
            activeTrack.artist?.name ||
            (typeof activeTrack.artist === "string" ? activeTrack.artist : "") ||
            "",
        )
          .trim()
          .slice(0, 140),
        album: String(activeTrack.album?.["#text"] || activeTrack.album?.name || "")
          .trim()
          .slice(0, 140),
        albumArt: pickLastfmAlbumArt(activeTrack.image),
        url: sanitizeLastfmLinkUrl(activeTrack.url, profileUrl),
        nowPlaying,
        scrobbledAt: nowPlaying ? 0 : scrobbledUts > 0 ? scrobbledUts * 1000 : 0,
      };

      const result = {
        username,
        configured: true,
        found: true,
        nowPlaying,
        track,
        profileUrl,
        fetchedAt: Date.now(),
      };
      lastfmRecentCache.set(cacheKey, result);
      if (force) lastfmForceCooldown.set(cacheKey, true);
      return result;
    } catch {
      if (cached) return cached;
      return {
        username,
        configured: true,
        found: false,
        nowPlaying: false,
        track: null,
        profileUrl,
        fetchedAt: Date.now(),
        error: "Could not reach Last.fm right now",
      };
    } finally {
      lastfmInflightFetches.delete(cacheKey);
    }
  })();

  lastfmInflightFetches.set(cacheKey, reqPromise);
  return reqPromise;
}

app.get("/api/chat/lastfm", async (req, res) => {
  await ensureChatMetaReadyAsync();
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const directLastfm = req.query?.lastfmUser !== undefined ? String(req.query.lastfmUser || "") : "";
  const targetUser = req.query?.username !== undefined ? String(req.query.username || "") : "";
  const force = req.query?.force === "1" || req.query?.force === "true";

  let lastfmHandle = "";
  if (directLastfm) {
    lastfmHandle = sanitizeLastfmUsernameServer(directLastfm);
    if (!lastfmHandle) {
      return res.status(400).json({ success: false, error: "Invalid Last.fm username" });
    }
  } else if (targetUser.trim()) {
    const prof = userProfiles.get(targetUser.trim().toLowerCase());
    lastfmHandle = sanitizeLastfmUsernameServer(prof?.customization?.lastfmUsername);
    if (!lastfmHandle) {
      return res.json({
        success: true,
        configured: Boolean(LASTFM_API_KEY),
        linked: false,
        lastfm: null,
      });
    }
  } else {
    return res.status(400).json({ success: false, error: "username or lastfmUser is required" });
  }

  const lastfm = await fetchLastfmRecentTrackAsync(lastfmHandle, { force });
  return res.json({
    success: true,
    configured: Boolean(LASTFM_API_KEY),
    linked: true,
    lastfm,
  });
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

const CHAT_MEDIA_MAX_BYTES = 2.5 * 1024 * 1024;
const CHAT_UPLOAD_ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const chatUploadedMediaCache = new LRUCache({
  max: 180,
  maxSize: 40 * 1024 * 1024,
  ttl: 1000 * 60 * 60 * 6,
  ttlAutopurge: true,
  sizeCalculation: (entry) => (entry?.body?.length || 0) + 128,
});

const CHAT_MEDIA_SHARD_COUNT = 32;
const CHAT_MEDIA_SHARD_MAX_ITEMS = 6;
const CHAT_MEDIA_SHARD_MAX_JSON_BYTES = 1100 * 1024;
const chatMediaShardUserIds = new Map();
const chatMediaShardQueues = new Map();

function getChatMediaShardName(id) {
  let hash = 0;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `${RESERVED_MEDIA_SHARD_PREFIX}${hash % CHAT_MEDIA_SHARD_COUNT}`;
}

async function withChatMediaShardLock(shardName, fn) {
  const prev = chatMediaShardQueues.get(shardName) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chatMediaShardQueues.set(shardName, next);
  try {
    return await next;
  } finally {
    if (chatMediaShardQueues.get(shardName) === next) {
      chatMediaShardQueues.delete(shardName);
    }
  }
}

async function getChatMediaShardUserId(shardName, { createIfMissing = false } = {}) {
  if (!USE_SUPABASE_CLOUDSYNC) return null;
  if (chatMediaShardUserIds.has(shardName)) {
    return chatMediaShardUserIds.get(shardName);
  }
  const lower = String(shardName || "").trim().toLowerCase();
  if (!lower) return null;
  try {
    const sel = await aivenDb.query(
      "SELECT id FROM public.cloudsync_users WHERE username_lower = $1 LIMIT 1",
      [lower],
    );
    const existingId = Number(sel.rows?.[0]?.id || 0) || null;
    if (existingId) {
      chatMediaShardUserIds.set(shardName, existingId);
      return existingId;
    }
    if (!createIfMissing) return null;

    const cre = await aivenDb.query(
      "INSERT INTO public.cloudsync_users (username, username_lower, password_hash, token_version) VALUES ($1, $2, $3, 1) ON CONFLICT (username_lower) DO UPDATE SET username = EXCLUDED.username RETURNING id",
      [shardName, lower, "!locked_system_kv_account!"],
    );
    const createdId = Number(cre.rows?.[0]?.id) || null;
    if (createdId) {
      chatMediaShardUserIds.set(shardName, createdId);
      return createdId;
    }
    return null;
  } catch (err) {
    console.warn("Aiven chat_media shard lookup warning:", err?.message);
    return null;
  }
}

async function persistChatMediaRemoteAsync(id, entry) {
  if (!USE_SUPABASE_CLOUDSYNC) return false;
  try {
    await ensureChatMetaReadyAsync();
  } catch {}

  if (supabaseHasAppKvTable !== false) {
    try {
      await aivenDb.query(
        "INSERT INTO public.app_kv (k, v, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at",
        [`chat_media_${id}`, JSON.stringify(entry)],
      );
      supabaseHasAppKvTable = true;
      return true;
    } catch (err) {
      if (err?.code === "42P01") {
        supabaseHasAppKvTable = false;
      } else {
        console.warn("Aiven app_kv chat_media write warning:", err?.message);
      }
    }
  }

  // Fallback to cloudsync_sync shards if app_kv is unavailable
  const shardName = getChatMediaShardName(id);
  return await withChatMediaShardLock(shardName, async () => {
    try {
      const uid = await getChatMediaShardUserId(shardName, { createIfMissing: true });
      if (!uid) return false;
      let items = chatMediaShardItemsCache.get(shardName);
      if (!Array.isArray(items)) {
        const existingRes = await aivenDb.query(
          "SELECT payload_json FROM public.cloudsync_sync WHERE user_id = $1 LIMIT 1",
          [uid],
        );
        items = [];
        const existingPayload = existingRes.rows?.[0]?.payload_json || null;
        if (existingPayload) {
          try {
            const parsed = JSON.parse(String(existingPayload));
            if (Array.isArray(parsed?.items)) items = parsed.items;
          } catch {}
        }
      }
      const filtered = items.filter((it) => it && it.id !== id);
      const nextItems = [{ id, ...entry }, ...filtered].slice(0, CHAT_MEDIA_SHARD_MAX_ITEMS);
      let serialized = JSON.stringify({ items: nextItems });
      while (nextItems.length > 1 && serialized.length > CHAT_MEDIA_SHARD_MAX_JSON_BYTES) {
        nextItems.pop();
        serialized = JSON.stringify({ items: nextItems });
      }
      await aivenDb.query(
        "INSERT INTO public.cloudsync_sync (user_id, payload_json, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id) DO UPDATE SET payload_json = EXCLUDED.payload_json, updated_at = EXCLUDED.updated_at",
        [uid, serialized],
      );
      chatMediaShardItemsCache.set(shardName, nextItems);
      return true;
    } catch (err) {
      console.warn("Aiven sharded chat_media write warning:", err?.message);
      return false;
    }
  });
}

async function loadChatMediaRemoteAsync(id) {
  if (!USE_SUPABASE_CLOUDSYNC) return null;
  try {
    await ensureChatMetaReadyAsync();
  } catch {}

  if (supabaseHasAppKvTable !== false) {
    try {
      const res = await aivenDb.query(
        "SELECT v FROM public.app_kv WHERE k = $1 LIMIT 1",
        [`chat_media_${id}`],
      );
      const valStr = res.rows?.[0]?.v;
      if (valStr) {
        const parsed = JSON.parse(valStr);
        if (parsed?.dataB64 && CHAT_UPLOAD_ALLOWED_MIMES.has(parsed.mime)) {
          return parsed;
        }
      }
    } catch (err) {
      if (err?.code === "42P01") {
        supabaseHasAppKvTable = false;
      }
    }
  }

  try {
    const shardName = getChatMediaShardName(id);
    let shardItems = chatMediaShardItemsCache.get(shardName);
    if (!Array.isArray(shardItems)) {
      const uid = await getChatMediaShardUserId(shardName, { createIfMissing: false });
      if (!uid) return null;
      const rowRes = await aivenDb.query(
        "SELECT payload_json FROM public.cloudsync_sync WHERE user_id = $1 LIMIT 1",
        [uid],
      );
      const payloadJson = rowRes.rows?.[0]?.payload_json || null;
      if (!payloadJson) return null;
      const parsed = JSON.parse(String(payloadJson));
      if (!Array.isArray(parsed?.items)) return null;
      shardItems = parsed.items;
      chatMediaShardItemsCache.set(shardName, shardItems);
    }
    const found = shardItems.find((it) => it && it.id === id);
    if (found?.dataB64 && CHAT_UPLOAD_ALLOWED_MIMES.has(found.mime)) {
      return found;
    }
  } catch {}
  return null;
}

function sendChatMediaResponse(res, mime, body) {
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  return res.send(body);
}

function detectUploadedImageMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function isAllowedChatImageUrl(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return false;
  if (/^\/api\/chat\/media\/cimg_[a-zA-Z0-9_-]{4,64}(?:\?[^#]*)?$/.test(s)) {
    return true;
  }
  if (s.length <= 450 * 1024 && /^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) {
    return true;
  }
  return false;
}

async function moderateImageWithOpenAI(dataUrl) {
  const apiKey = OPENAI_MODERATION_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-")) {
    return { blocked: false, flagged: false };
  }
  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: [{ type: "image_url", image_url: { url: dataUrl } }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { blocked: false, flagged: false };
    const data = await response.json();
    const result = data?.results?.[0];
    if (result?.categories) {
      const strictCategories = [
        "sexual",
        "sexual/minors",
        "self-harm",
        "self-harm/intent",
        "self-harm/instructions",
        "violence/graphic",
        "illicit/violent",
      ];
      const triggered = strictCategories.filter((cat) => result.categories[cat] === true);
      if (triggered.length > 0) {
        return {
          blocked: true,
          flagged: true,
          category: triggered[0],
          reason: `image blocked by moderation (${triggered.join(", ")}).`,
        };
      }
    }
  } catch (err) {
    console.warn("Image moderation request skipped:", err?.message);
  }
  return { blocked: false, flagged: false };
}

app.post("/api/chat/upload-image", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync to upload images" });
    }
    const authorKey = authUser.username.toLowerCase();
    const activeTimeout = getActiveTimeout(authorKey);
    if (activeTimeout) {
      return res.status(403).json({
        success: false,
        timedOut: true,
        until: activeTimeout.until,
        error: "You cannot upload images while timed out",
      });
    }

    const rawDataUrl = String(req.body?.dataUrl || "").trim();
    const match = /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(rawDataUrl);
    if (!match) {
      return res.status(400).json({ success: false, error: "Only JPEG, PNG, WebP, or GIF image uploads are supported" });
    }

    const cleanB64 = match[2].replace(/\s+/g, "");
    const buf = Buffer.from(cleanB64, "base64");
    if (!buf || buf.length === 0 || buf.length > CHAT_MEDIA_MAX_BYTES) {
      return res.status(413).json({ success: false, error: "Image exceeds 2.5MB upload limit" });
    }

    const detectedMime = detectUploadedImageMime(buf);
    if (!detectedMime || !CHAT_UPLOAD_ALLOWED_MIMES.has(detectedMime)) {
      return res.status(415).json({ success: false, error: "Unrecognized or unsupported image format" });
    }

    const normalizedDataUrl = `data:${detectedMime};base64,${cleanB64}`;
    const modCheck = await moderateImageWithOpenAI(normalizedDataUrl);
    if (modCheck.flagged) {
      return res.status(400).json({
        success: false,
        flagged: true,
        category: modCheck.category,
        error: modCheck.reason || "Image blocked by moderation",
      });
    }

    const id = `cimg_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    chatUploadedMediaCache.set(id, { body: buf, mime: detectedMime });

    try {
      const db = getSharedCloudSyncDb();
      db.query(
        "INSERT OR REPLACE INTO chat_media (id, author, mime, data_b64, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
      ).run(id, authUser.username, detectedMime, cleanB64);
      db.query(
        "DELETE FROM chat_media WHERE id NOT IN (SELECT id FROM chat_media ORDER BY created_at DESC LIMIT 500)",
      ).run();
    } catch (e) {
      console.warn("SQLite chat_media store warning:", e?.message);
    }

    const mediaEntry = {
      mime: detectedMime,
      dataB64: cleanB64,
      author: authUser.username,
      createdAt: Date.now(),
    };
    let persistedRemotely = await persistChatMediaRemoteAsync(id, mediaEntry);
    if (!persistedRemotely && USE_SUPABASE_CLOUDSYNC) {
      await new Promise((r) => setTimeout(r, 250));
      persistedRemotely = await persistChatMediaRemoteAsync(id, mediaEntry);
    }

    const imageName = typeof req.body?.filename === "string"
      ? req.body.filename.trim().slice(0, 80)
      : "image";
    const resolvedImageUrl =
      USE_SUPABASE_CLOUDSYNC && !persistedRemotely && normalizedDataUrl.length <= 450 * 1024
        ? normalizedDataUrl
        : `/api/chat/media/${id}`;
    res.json({
      success: true,
      id,
      imageUrl: resolvedImageUrl,
      imageName,
      mime: detectedMime,
      bytes: buf.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || "Image upload failed" });
  }
});

app.get("/api/chat/media/:id", async (req, res) => {
  const id = String(req.params?.id || "").trim();
  if (!/^cimg_[a-zA-Z0-9_-]{4,64}$/.test(id)) {
    return res.status(400).send("Invalid media id");
  }

  const cached = chatUploadedMediaCache.get(id);
  if (cached) {
    return sendChatMediaResponse(res, cached.mime, cached.body);
  }

  try {
    const db = getSharedCloudSyncDb();
    const row = db.query("SELECT mime, data_b64 FROM chat_media WHERE id = ?").get(id);
    if (row?.data_b64 && CHAT_UPLOAD_ALLOWED_MIMES.has(row.mime)) {
      const body = Buffer.from(row.data_b64, "base64");
      chatUploadedMediaCache.set(id, { body, mime: row.mime });
      return sendChatMediaResponse(res, row.mime, body);
    }
  } catch {}

  const remoteMedia = await loadChatMediaRemoteAsync(id);
  if (remoteMedia?.dataB64 && CHAT_UPLOAD_ALLOWED_MIMES.has(remoteMedia.mime)) {
    const body = Buffer.from(remoteMedia.dataB64, "base64");
    chatUploadedMediaCache.set(id, { body, mime: remoteMedia.mime });
    try {
      getSharedCloudSyncDb()
        .query(
          "INSERT OR REPLACE INTO chat_media (id, author, mime, data_b64, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
        )
        .run(id, String(remoteMedia.author || ""), remoteMedia.mime, remoteMedia.dataB64);
    } catch {}
    return sendChatMediaResponse(res, remoteMedia.mime, body);
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(404).send("Media not found");
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
  const stateMessages = trimChatHistoryPerChannel(visibleMessages);

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

  const visibleBackgrounds = {};
  for (const [chId, bgUrl] of chatBackgrounds.entries()) {
    if (bgUrl && canAccessChatChannel(chId, verifiedUserKey)) {
      visibleBackgrounds[chId] = bgUrl;
    }
  }

  const presence = getPresenceSnapshot();
  const selfRole = authUser ? getUserChatRole(authUser.username) : "member";
  const selfTimeout = authUser ? getActiveTimeout(authUser.username) : null;

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({
    success: true,
    messages: stateMessages,
    hasMoreMessages: visibleMessages.length > stateMessages.length,
    presenceAt: presence.snapshotAt,
    usersLoaded: presence.usersLoaded,
    totalUsersCount: presence.totalUsersCount,
    channels: getVisibleChatChannels(verifiedUserKey),
    chatBackgrounds: visibleBackgrounds,
    groups: userGroups,
    voiceRooms: activeVoice,
    onlineUsers: presence.onlineUsers,
    offlineUsers: presence.offlineUsers,
    registeredUsers: presence.registeredUsers,
    staffMods: getCanonicalStaffMods(csMap),
    ownerUsers: getCanonicalOwnerUsers(csMap),
    goatUsers: presence.goatUsers,
    cookieMasterUsers: presence.cookieMasterUsers || [],
    selfRole,
    selfTimeout,
    selfCreatedAt: authUser ? getUserAccountCreatedAtMs(authUser.username) : 0,
  });
});

// Lightweight exact user count endpoint (HEAD count=exact, 60s server cache, 25s degraded fallback)
app.get("/api/users/count", async (_req, res) => {
  const count = await getCloudSyncUsersCountAsync().catch(() => getCloudSyncUsersCountSync());
  res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
  res.json({
    success: true,
    count,
    cachedUntil: cloudSyncCountCache.expiresAt || Date.now() + USERS_CACHE_TTL_MS,
  });
});

// Paginated user directory endpoint (strict max limit=50, 60s per-page cache)
app.get(["/api/users", "/api/cloudsync/users"], async (req, res) => {
  const limit = Math.min(Math.max(1, Number(req.query.limit) || USERS_DIR_PAGE_SIZE), USERS_DIR_PAGE_SIZE);
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset =
    req.query.offset !== undefined
      ? Math.max(0, Number(req.query.offset) || 0)
      : (page - 1) * limit;
  const cacheKey = `${limit}:${offset}`;
  const now = Date.now();
  const cachedPage = usersPageCache.get(cacheKey);
  if (cachedPage && now < cachedPage.expiresAt) {
    res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
    return res.json(cachedPage.data);
  }
  let pagePromise = usersPageInFlight.get(cacheKey);
  if (!pagePromise) {
    pagePromise = (async () => {
      try {
        const [totalCount, rows] = await Promise.all([
          getCloudSyncUsersCountAsync().catch(() => getCloudSyncUsersCountSync()),
          offset === 0 && cloudSyncUsersCache.map && Date.now() < cloudSyncUsersCache.expiresAt
            ? Promise.resolve(Array.from(cloudSyncUsersCache.map.values()).slice(0, limit))
            : isSupabaseDegraded() && cachedPage
              ? Promise.resolve(cachedPage.data.users)
              : dbListUsers({ limit, offset }).catch(() => cachedPage?.data?.users || []),
        ]);
        const users = (rows || []).map((r) => ({
          id: Number(r.id) || 0,
          username: String(r.username || "").trim(),
          createdAt: r.created_at || r.createdAt || null,
        })).filter(
          (u) =>
            u.username &&
            !isReservedSystemUsername(u.username) &&
            !shadowbannedUsers.has(u.username.toLowerCase())
        );
        const payload = {
          success: true,
          users,
          totalCount,
          page,
          limit,
          offset,
          hasMore: offset + users.length < totalCount,
        };
        if (usersPageCache.size > 100) usersPageCache.clear();
        usersPageCache.set(cacheKey, {
          data: payload,
          expiresAt: Date.now() + (isSupabaseDegraded() ? SUPABASE_DEGRADED_COOLDOWN_MS : USERS_CACHE_TTL_MS),
        });
        return payload;
      } finally {
        usersPageInFlight.delete(cacheKey);
      }
    })();
    usersPageInFlight.set(cacheKey, pagePromise);
  }
  const payload = await pagePromise;
  res.setHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
  return res.json(payload);
});

app.get("/api/chat/user-profile", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const actor = await getModActor(req);
  const rawTarget = (req.query.username || req.query.user || "").toString().trim();
  if (!rawTarget) {
    return res.status(400).json({ success: false, exists: false, error: "username is required" });
  }

  const key = rawTarget.toLowerCase();
  const { csMap, user: csUser } = await ensureCloudSyncUserInMap(rawTarget);

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
  const canonicalKey = canonicalName.toLowerCase();
  let prof = userProfiles.get(canonicalKey) || userProfiles.get(key) || {};
  // Egress guard: once app_kv (user_profiles_v2) is hydrated in RAM, only check an already-cached cloudsync_sync blob
  // in RAM (or run if remote KV has not hydrated yet) — never trigger a live Supabase save-file download on profile clicks!
  if (
    (!prof || !hasMeaningfulCustomization(prof.customization)) &&
    csUser?.id > 0 &&
    !isSupabaseDegraded()
  ) {
    const cachedSyncRow = cloudSyncBlobCache.get(Number(csUser.id));
    if (cachedSyncRow?.payload_json) {
      if (
        recoverUserProfileFromSyncPayload(
          canonicalName,
          cachedSyncRow.payload_json,
          cachedSyncRow.updated_at || ""
        )
      ) {
        persistUserProfiles({ updatedKey: key });
        prof = userProfiles.get(key) || {};
      }
    } else if (!hasLoadedRemoteKvSuccessfully) {
      const nowTs = Date.now();
      const lastChecked = Number(singleProfileSyncRecoveryChecked.get(key) || 0);
      if (nowTs - lastChecked > 60_000) {
        singleProfileSyncRecoveryChecked.set(key, nowTs);
        try {
          const syncRow = await dbGetSyncPayload(csUser.id, canonicalName);
          if (
            syncRow?.payload_json &&
            recoverUserProfileFromSyncPayload(canonicalName, syncRow.payload_json, syncRow.updated_at || "")
          ) {
            persistUserProfiles({ updatedKey: key });
            prof = userProfiles.get(key) || {};
          }
        } catch {}
      }
    }
  }
  const presence = getPresenceSnapshot();
  const onlineEntry = presence.onlineUsers.find((u) => u.username.toLowerCase() === key);
  const offlineEntry = presence.offlineUsers.find((u) => u.username.toLowerCase() === key);
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

  await Promise.all([
    getMergedStudioGamesAsync().catch(() => publishedStudioGames),
    getMergedStudiosAsync().catch(() => customStudios),
  ]);
  const userStudio =
    customStudios.find((s) => (s.owner || "").toLowerCase() === key) || null;
  const userPublishedGames = publishedStudioGames.filter(
    (g) => (g.author || "").toLowerCase() === key
  );
  const linkedLastfmUser = sanitizeLastfmUsernameServer(prof?.customization?.lastfmUsername);
  const lastfmState = linkedLastfmUser
    ? await fetchLastfmRecentTrackAsync(linkedLastfmUser).catch(() => null)
    : null;

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
      lastfmConfigured: Boolean(LASTFM_API_KEY),
      lastfm: lastfmState,
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
      ...(actor.isMod
        ? {
            isShadowbanned: isAccountShadowbanned(canonicalKey),
            staffNotes: getStaffNotesForUser(key),
            staffLogs: getStaffLogsForUser(key, 60),
          }
        : {}),
    },
  });
});

app.post("/api/chat/user-profile", async (req, res) => {
  await ensureChatMetaReadyAsync();
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
    const { csMap } = await ensureCloudSyncUserInMap(cleanUser);
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
      nextCustomization.lastfmUsername,
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

    if (nextCustomization.lastfmUsername) {
      clearedLastfmKeys.delete(key);
    } else {
      clearedLastfmKeys.add(key);
    }

    const updated = {
      bio: cleanBio,
      statusText: cleanStatus,
      customization: nextCustomization,
      updatedAt: new Date().toISOString(),
    };
    userProfiles.set(key, updated);
    persistUserProfiles({ updatedKey: key });
    await flushKvKeyToSqliteAndSupabaseAsync("user_profiles_v2", buildUserProfilesObject(), {
      awaitRemote: true,
      timeoutMs: 12000,
    });

    const lastfmState = nextCustomization.lastfmUsername
      ? await fetchLastfmRecentTrackAsync(nextCustomization.lastfmUsername, { force: true }).catch(() => null)
      : null;

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
        lastfm: lastfmState,
        role,
      },
      "all",
    );
    res.json({
      success: true,
      profile: {
        ...updated,
        lastfmConfigured: Boolean(LASTFM_API_KEY),
        lastfm: lastfmState,
      },
    });
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
  const chCfg = getChatChannelConfig(ch);
  if ((chCfg && chCfg.visibility === "staff") || ch === "staff-chat") {
    for (const [, client] of liveClients.entries()) {
      const verifiedU = client.verifiedUsername;
      if (verifiedU && isStaffRoleUser(verifiedU)) {
        try {
          client.res.write(`data: ${JSON.stringify(eventPayload)}\n\n`);
        } catch {}
      }
    }
    return;
  }
  broadcastToClients(eventPayload, "all");
}

const chatTypingRateLimit = new Map(); // usernameLower -> lastBroadcastMs (strictly in-memory, zero DB writes)

app.post("/api/chat/typing", (req, res) => {
  try {
    const cookieToken = req.cookies?.token;
    const headerToken =
      req.headers["x-cloudsync-token"] ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7).trim()
        : null);
    const claims = verifyCloudSyncJwt(headerToken) || verifyCloudSyncJwt(cookieToken);
    const username = String(claims?.username || "").trim();
    if (!username || isReservedSystemUsername(username)) {
      return res.status(200).json({ success: true });
    }

    const authorKey = username.toLowerCase();
    const channel = String(req.body?.channel || "").trim().slice(0, 120);
    const isTyping = Boolean(req.body?.isTyping);
    if (!channel) {
      return res.status(200).json({ success: true });
    }

    if (
      !canAccessChatChannel(channel, authorKey) ||
      isAccountShadowbanned(authorKey) ||
      getActiveTimeout(authorKey)
    ) {
      return res.status(200).json({ success: true });
    }

    const now = Date.now();
    if (isTyping) {
      const lastAt = chatTypingRateLimit.get(authorKey) || 0;
      if (now - lastAt < 1200) {
        return res.status(200).json({ success: true });
      }
      chatTypingRateLimit.set(authorKey, now);
      if (chatTypingRateLimit.size > 2000) {
        for (const [k, ts] of chatTypingRateLimit.entries()) {
          if (now - ts > 15000) chatTypingRateLimit.delete(k);
        }
      }
    } else {
      chatTypingRateLimit.delete(authorKey);
    }

    broadcastChatPayload(channel, {
      type: "chat-event",
      event: "USER_TYPING",
      channel,
      username,
      isTyping,
      timestamp: now,
    });

    return res.status(200).json({ success: true });
  } catch {
    return res.status(200).json({ success: true });
  }
});

const PARTNER_BLOCKED_RE =
  /\b(pornhub|xvideos|xnxx|xhamster|redtube|youporn|brazzers|onlyfans|chaturbate|stripchat|cam4|bongacams|livejasmin|myfreecams|spankbang|eporner|rule34|nhentai|hanime|hentaihaven|e621|gelbooru|danbooru|fakku|hitomi|erome|fapello|coomer|kemono|bestgore|liveleak|kaotic|crazyshit|theync|grabify|iplogger|2no\.co|blasze|canarytokens|yip\.su|porn|nsfw|hentai|xxx|nude|nudes|sexting|camgirl|escort|milf|bdsm|fetish|gore|beheading|suicide|selfharm)\b/i;

function checkPartnerContentSafety(textOrUrl) {
  const s = String(textOrUrl || "").trim();
  if (!s) return { blocked: false, reason: "" };
  if (PARTNER_BLOCKED_RE.test(s)) {
    return { blocked: true, reason: "Blocked by safety filter (inappropriate or unsafe content)" };
  }
  return { blocked: false, reason: "" };
}

let spotifyTokenCache = { token: "", expiresAt: 0 };

async function getSpotifyAppToken() {
  const clientId = String(process.env.SPOTIFY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) return "";
  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt - 30000) {
    return spotifyTokenCache.token;
  }
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) return "";
  const data = await res.json().catch(() => null);
  if (!data?.access_token) return "";
  spotifyTokenCache = {
    token: String(data.access_token),
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return spotifyTokenCache.token;
}

async function searchItunesSnippets(query, limit = 10) {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=${Math.min(12, Math.max(1, limit))}&term=${encodeURIComponent(query)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!r.ok) return [];
  const data = await r.json().catch(() => null);
  const items = Array.isArray(data?.results) ? data.results : [];
  return items
    .filter((t) => t && t.trackName && t.previewUrl)
    .map((t) => ({
      id: `itunes_${t.trackId || Math.random().toString(36).slice(2, 8)}`,
      title: String(t.trackName || "").trim().slice(0, 100),
      artist: String(t.artistName || "Unknown Artist").trim().slice(0, 80),
      album: String(t.collectionName || "").trim().slice(0, 100),
      artworkUrl: String(t.artworkUrl100 || "").replace("100x100bb", "300x300bb"),
      previewUrl: String(t.previewUrl || ""),
      spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(`${t.trackName} ${t.artistName}`)}`,
      durationSec: 30,
    }));
}

app.get("/api/chat/partners/music", async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim().slice(0, 160);
    if (!q) {
      return res.json({ success: true, tracks: [] });
    }

    // Direct Spotify track URL via free Spotify oEmbed + 30s preview lookup
    if (/^https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+/i.test(q)) {
      const oembedRes = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(q)}`,
        { signal: AbortSignal.timeout(6000) }
      ).catch(() => null);
      if (oembedRes && oembedRes.ok) {
        const meta = await oembedRes.json().catch(() => null);
        const title = String(meta?.title || "Spotify Track").trim().slice(0, 100);
        const previews = await searchItunesSnippets(title, 1).catch(() => []);
        const match = previews[0];
        return res.json({
          success: true,
          tracks: [
            {
              id: `sp_${Date.now()}`,
              title: match?.title || title,
              artist: match?.artist || "Spotify",
              album: match?.album || "",
              artworkUrl: String(meta?.thumbnail_url || match?.artworkUrl || ""),
              previewUrl: match?.previewUrl || "",
              spotifyUrl: q,
              durationSec: 30,
            },
          ],
        });
      }
    }

    // Try Spotify Web API if credentials are configured
    const spToken = await getSpotifyAppToken().catch(() => "");
    if (spToken) {
      const spRes = await fetch(
        `https://api.spotify.com/v1/search?type=track&limit=8&q=${encodeURIComponent(q)}`,
        {
          headers: { Authorization: `Bearer ${spToken}` },
          signal: AbortSignal.timeout(7000),
        }
      ).catch(() => null);
      if (spRes && spRes.ok) {
        const spData = await spRes.json().catch(() => null);
        const rawTracks = Array.isArray(spData?.tracks?.items) ? spData.tracks.items : [];
        const tracks = await Promise.all(
          rawTracks.map(async (t) => {
            const title = String(t?.name || "").trim().slice(0, 100);
            const artist = Array.isArray(t?.artists)
              ? t.artists.map((a) => a?.name).filter(Boolean).join(", ").slice(0, 80)
              : "Unknown Artist";
            let previewUrl = String(t?.preview_url || "").trim();
            if (!previewUrl && title) {
              const fallback = await searchItunesSnippets(`${title} ${artist}`, 1).catch(() => []);
              previewUrl = fallback[0]?.previewUrl || "";
            }
            return {
              id: `sp_${t.id}`,
              title,
              artist,
              album: String(t?.album?.name || "").trim().slice(0, 100),
              artworkUrl: String(t?.album?.images?.[1]?.url || t?.album?.images?.[0]?.url || ""),
              previewUrl,
              spotifyUrl: String(t?.external_urls?.spotify || ""),
              durationSec: 30,
            };
          })
        );
        const usable = tracks.filter((t) => t.title && (t.previewUrl || t.spotifyUrl));
        if (usable.length > 0) {
          return res.json({ success: true, tracks: usable });
        }
      }
    }

    // Zero-key free music snippet search (30s playable previews + album art + Spotify link)
    const tracks = await searchItunesSnippets(q, 10);
    return res.json({ success: true, tracks });
  } catch (err) {
    return res.status(502).json({ success: false, tracks: [], error: err?.message || "Music search failed" });
  }
});

app.post("/api/chat/partners/embed-preview", async (req, res) => {
  try {
    let rawUrl = String(req.body?.url || "").trim();
    if (!rawUrl) {
      return res.status(400).json({ success: false, error: "Enter a URL to embed" });
    }
    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }
    if (!isSafeExternalHttpUrl(rawUrl)) {
      return res.status(400).json({ success: false, error: "Only safe public HTTPS/HTTP URLs are allowed" });
    }
    const safety = checkPartnerContentSafety(rawUrl);
    if (safety.blocked) {
      return res.status(403).json({ success: false, error: safety.reason });
    }

    const parsedUrl = new URL(rawUrl);
    const domain = parsedUrl.hostname.replace(/^www\./i, "");
    let title = domain;
    let description = "";
    let imageUrl = "";
    let siteName = domain;

    try {
      const pageRes = await fetch(rawUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OperationCookieEmbed/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(6000),
      });
      if (pageRes.ok) {
        const ct = String(pageRes.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("text/html")) {
          const html = (await pageRes.text()).slice(0, 120000);
          const pickMeta = (prop) => {
            const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
            const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, "i");
            return (html.match(re1)?.[1] || html.match(re2)?.[1] || "").trim();
          };
          const ogTitle = pickMeta("og:title") || pickMeta("twitter:title") || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "").trim();
          const ogDesc = pickMeta("og:description") || pickMeta("twitter:description") || pickMeta("description");
          const ogImg = pickMeta("og:image") || pickMeta("twitter:image");
          const ogSite = pickMeta("og:site_name");
          if (ogTitle) title = ogTitle.replace(/\s+/g, " ").slice(0, 120);
          if (ogDesc) description = ogDesc.replace(/\s+/g, " ").slice(0, 220);
          if (ogSite) siteName = ogSite.replace(/\s+/g, " ").slice(0, 60);
          if (ogImg) {
            try {
              const resolved = new URL(ogImg, parsedUrl.href).href;
              if (isSafeExternalHttpUrl(resolved)) imageUrl = resolved;
            } catch {}
          }
        }
      }
    } catch {}

    const metaSafety = checkPartnerContentSafety(`${title} ${description} ${siteName}`);
    if (metaSafety.blocked) {
      return res.status(403).json({ success: false, error: metaSafety.reason });
    }
    const modCheck = await moderateTextWithOpenAI(`${title} ${description}`);
    if (modCheck.blocked) {
      return res.status(403).json({ success: false, error: modCheck.reason || "Blocked by safety filter" });
    }

    return res.json({
      success: true,
      embed: {
        url: parsedUrl.href,
        title,
        description,
        imageUrl,
        siteName,
        domain,
      },
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err?.message || "Invalid URL" });
  }
});

function sanitizePartnerCard(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = String(raw.type || "").trim().toLowerCase();
  if (type === "music") {
    const title = String(raw.title || "").trim().slice(0, 120);
    const artist = String(raw.artist || "").trim().slice(0, 80);
    const previewUrl = String(raw.previewUrl || "").trim().slice(0, 500);
    const spotifyUrl = String(raw.spotifyUrl || "").trim().slice(0, 500);
    const artworkUrl = String(raw.artworkUrl || "").trim().slice(0, 500);
    if (!title || (!previewUrl && !spotifyUrl)) return null;
    if (previewUrl && !isSafeExternalHttpUrl(previewUrl)) return null;
    if (spotifyUrl && !isSafeExternalHttpUrl(spotifyUrl)) return null;
    return {
      type: "music",
      title,
      artist: artist || "Unknown Artist",
      album: String(raw.album || "").trim().slice(0, 100),
      artworkUrl: artworkUrl && isSafeExternalHttpUrl(artworkUrl) ? artworkUrl : "",
      previewUrl,
      spotifyUrl,
      durationSec: 30,
    };
  }
  if (type === "embed") {
    const url = String(raw.url || "").trim().slice(0, 500);
    if (!url || !isSafeExternalHttpUrl(url)) return null;
    let domain = "";
    try {
      domain = new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return null;
    }
    const title = String(raw.title || domain).trim().slice(0, 120);
    const description = String(raw.description || "").trim().slice(0, 220);
    const siteName = String(raw.siteName || domain).trim().slice(0, 60);
    const imageUrl = String(raw.imageUrl || "").trim().slice(0, 500);
    if (checkPartnerContentSafety(`${url} ${title} ${description} ${siteName}`).blocked) {
      return { _blocked: true };
    }
    return {
      type: "embed",
      url,
      title,
      description,
      siteName,
      domain,
      imageUrl: imageUrl && isSafeExternalHttpUrl(imageUrl) ? imageUrl : "",
    };
  }
  if (type === "drawing") {
    const imageUrl = String(raw.imageUrl || "").trim().slice(0, 500);
    if (!imageUrl || !isAllowedChatImageUrl(imageUrl)) return null;
    return {
      type: "drawing",
      imageUrl,
      title: String(raw.title || "sketch").trim().slice(0, 80),
    };
  }
  return null;
}

app.post("/api/chat/send", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const { message } = req.body || {};
    const cleanText = String(message?.text || "").trim().slice(0, 2000);
    const rawGifUrl = typeof message?.gifUrl === "string" ? message.gifUrl.trim() : "";
    const hasValidGif = Boolean(rawGifUrl && isAllowedKlipyMediaUrl(rawGifUrl));
    const rawImageUrl = typeof message?.imageUrl === "string" ? message.imageUrl.trim() : "";
    const hasValidImage = Boolean(rawImageUrl && isAllowedChatImageUrl(rawImageUrl));
    const parsedPartnerCard = sanitizePartnerCard(message?.partnerCard);
    if (parsedPartnerCard?._blocked) {
      return res.status(403).json({
        success: false,
        error: "Embed blocked by safety filter (inappropriate or unsafe content)",
      });
    }
    const cleanPartnerCard = parsedPartnerCard || null;

    if (rawGifUrl && !hasValidGif) {
      return res.status(400).json({ success: false, error: "Only valid KLIPY HTTPS GIF URLs are allowed" });
    }
    if (rawImageUrl && !hasValidImage) {
      return res.status(400).json({ success: false, error: "Invalid chat image URL" });
    }
    if (!message || !message.author || !message.channel || (!cleanText && !hasValidGif && !hasValidImage && !cleanPartnerCard)) {
      return res.status(400).json({ success: false, error: "Invalid message" });
    }

    const authorName = authUser ? authUser.username : String(message.author).trim().slice(0, 40);
    const authorKey = authorName.toLowerCase();
    const isStaffSender = Boolean(authUser && isStaffRoleUser(authUser.username));

    const fingerprintId = String(req.body?.fingerprint_id || req.body?.fingerprintId || "").trim().slice(0, 120);
    const storageToken = String(req.body?.storage_token || req.body?.storageToken || "").trim().slice(0, 120);
    if (authUser && (fingerprintId || storageToken)) {
      recordUserDeviceSignature(authorName, {
        fingerprint_id: fingerprintId,
        storage_token: storageToken,
      });
    }

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

    const nowMs = Date.now();
    const createdAtMs = getUserAccountCreatedAtMs(authorName);
    if (!isStaffSender && createdAtMs > 0 && nowMs - createdAtMs < ACCOUNT_CHAT_COOLDOWN_MS) {
      const remMs = Math.max(1000, ACCOUNT_CHAT_COOLDOWN_MS - (nowMs - createdAtMs));
      const totalSec = Math.ceil(remMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return res.status(403).json({
        success: false,
        probationRemainingMs: remMs,
        error: `New accounts must wait ${mins}m ${secs}s before chatting`,
      });
    }

    let track = userLastMessageTrack.get(authorKey);
    if (!track) {
      track = {
        lastSentAt: 0,
        recentTexts: [],
        recentTimestamps: [],
        spamStrikes: [],
        recentDmTargets: new Map(),
      };
      userLastMessageTrack.set(authorKey, track);
    }
    if (!Array.isArray(track.recentTimestamps)) track.recentTimestamps = [];
    if (!Array.isArray(track.spamStrikes)) track.spamStrikes = [];
    if (!isStaffSender && track.lastSentAt > 0 && nowMs - track.lastSentAt < CHAT_SLOWMODE_MS) {
      const waitMs = CHAT_SLOWMODE_MS - (nowMs - track.lastSentAt);
      return res.status(429).json({
        success: false,
        slowmodeRemainingMs: waitMs,
        error: `Slowmode active: please wait ${Math.max(1, Math.ceil(waitMs / 1000))}s before sending another message`,
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
          hasImage: Boolean(message.replyTo.hasImage),
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
      ...(hasValidImage
        ? {
            imageUrl: rawImageUrl,
            imageName: typeof message?.imageName === "string" ? message.imageName.trim().slice(0, 80) : "image",
          }
        : {}),
      ...(cleanPartnerCard ? { partnerCard: cleanPartnerCard } : {}),
      ...(cleanReplyTo ? { replyTo: cleanReplyTo } : {}),
      channel: String(message.channel).trim().slice(0, 120),
      createdAt: Number(message?.createdAt) > 0 ? Number(message.createdAt) : nowMs,
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
      const dmTarget = parts.find((p) => p && p !== authorKey) || "";
      if (!isStaffSender && dmTarget) {
        const isTargetAdmin =
          dmTarget === "bacontheoverseer" ||
          OWNER_USERNAMES.has(dmTarget) ||
          staffModerators.has(dmTarget);
        const unverifiedEmail = authorProf?.emailVerified === false;
        const youngerThan15Min = createdAtMs > 0 && nowMs - createdAtMs < ACCOUNT_ADMIN_DM_COOLDOWN_MS;
        if (isTargetAdmin && (youngerThan15Min || unverifiedEmail)) {
          return res.status(403).json({
            success: false,
            error: "Accounts must be at least 15 minutes old before initiating DMs with admins",
          });
        }
        track.recentDmTargets.set(dmTarget, nowMs);
        for (const [tKey, tAt] of track.recentDmTargets.entries()) {
          if (nowMs - tAt > 10 * 60 * 1000) track.recentDmTargets.delete(tKey);
        }
        if ((youngerThan15Min && track.recentDmTargets.size > 2) || track.recentDmTargets.size > 6) {
          return res.status(429).json({
            success: false,
            error: "Mass-messaging protection active: please wait before starting new DMs with multiple users",
          });
        }
      }
      const initialMap = await getCloudSyncUsersMapAsync();
      if (initialMap.size > 0) {
        for (const cleanPart of parts) {
          if (!cleanPart) {
            return res.status(404).json({
              success: false,
              error: `user "@${cleanPart}" does not exist in cloudsync`,
            });
          }
          if (!initialMap.has(cleanPart)) {
            const { user: lookedUp } = await ensureCloudSyncUserInMap(cleanPart);
            if (!lookedUp) {
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
    } else if (!sanitizedMsg.channel.startsWith("voice:")) {
      const chCfg = getChatChannelConfig(sanitizedMsg.channel);
      const isStaffSender = Boolean(authUser && isStaffRoleUser(authUser.username));
      if ((chCfg && chCfg.visibility === "staff") || sanitizedMsg.channel === "staff-chat") {
        if (!isStaffSender) {
          return res.status(403).json({ success: false, error: "This channel is only visible to owners and mods" });
        }
      }
      if (chCfg && chCfg.writeAccess === "staff" && !isStaffSender) {
        return res.status(403).json({ success: false, error: `Only owners and mods can post in #${chCfg.name}` });
      }
    }

    touchKnownUser(sanitizedMsg.author);

    // ── SPAM AUTOMOD EVERYWHERE (Public Channels, Private DMs, and Group Chats) ──
    track.recentTimestamps = track.recentTimestamps.filter((t) => nowMs - t < 8000);
    const isBurstFlood = !isStaffSender && track.recentTimestamps.length >= 4;
    track.recentTimestamps.push(nowMs);
    track.lastSentAt = nowMs;

    // Duplicate / near-identical message or media check within 45s window (applies in DMs & all channels)
    const mediaSig = hasValidGif
      ? `gif:${rawGifUrl}`
      : hasValidImage
      ? `img:${rawImageUrl.slice(0, 120)}`
      : cleanPartnerCard
      ? `card:${cleanPartnerCard.type}:${cleanPartnerCard.title || cleanPartnerCard.url || ""}`
      : "";
    const normDup = cleanText
      ? normalizeSpamText(cleanText).compact || cleanText.toLowerCase().trim()
      : mediaSig;
    track.recentTexts = track.recentTexts.filter((item) => nowMs - item.at < 45000);
    const duplicateHits = normDup
      ? track.recentTexts.filter(
          (item) =>
            item.norm === normDup ||
            (!mediaSig &&
              normDup.length >= 5 &&
              item.norm.length >= 5 &&
              (item.norm.includes(normDup) || normDup.includes(item.norm)) &&
              Math.abs(item.norm.length - normDup.length) <= 3)
        ).length
      : 0;
    const isDuplicateMsg =
      !isStaffSender &&
      Boolean(normDup) &&
      (mediaSig ? duplicateHits >= 2 : duplicateHits >= 1);
    if (normDup) {
      track.recentTexts.push({ norm: normDup, at: nowMs });
    }

    const textFloodReason = !isStaffSender && sanitizedMsg.text ? detectTextSpamViolation(sanitizedMsg.text) : null;
    const spamPatternMatched = !isStaffSender && sanitizedMsg.text ? matchesSpamFilter(sanitizedMsg.text) : null;

    if (isBurstFlood || isDuplicateMsg || textFloodReason || spamPatternMatched) {
      track.spamStrikes = track.spamStrikes.filter((t) => nowMs - t < 120000);
      track.spamStrikes.push(nowMs);

      const isHighConfidenceRaid =
        Boolean(spamPatternMatched) &&
        /cookie|gamma/i.test(String(spamPatternMatched));
      if (isHighConfidenceRaid && !isAccountShadowbanned(authorKey)) {
        setAccountShadowbanned(authorName, true, {
          reason: `auto-shadowban triggered by raid spam filter (${spamPatternMatched})`,
          recordDevice: true,
          highConfidenceSpam: true,
        });
      }

      if (track.spamStrikes.length >= 3) {
        const until = nowMs + 2 * 60 * 1000;
        const timeoutObj = {
          username: authorName,
          until,
          reason: "AutoMod: repeated spam in chat or DMs",
          by: "AutoMod",
        };
        chatTimeouts.set(authorKey, timeoutObj);
        persistChatTimeouts();
        broadcastToClients(
          {
            type: "chat-event",
            event: "MOD_UPDATE",
            targetUsername: authorName,
            timeout: timeoutObj,
          },
          "all"
        );
        return res.status(403).json({
          success: false,
          timedOut: true,
          until,
          error: "AutoMod: You have been timed out for 2 minutes due to repeated spam.",
        });
      }

      const automodReason =
        textFloodReason ||
        (isBurstFlood
          ? "AutoMod: Slow down! You are sending messages too quickly."
          : isDuplicateMsg
          ? "AutoMod: Please don't spam duplicate messages."
          : "AutoMod: External links, invites, or promotional spam are not allowed.");
      return res.status(429).json({
        success: false,
        automod: true,
        error: automodReason,
      });
    }

    // Device-ban & silent shadowban check
    const sendDeviceBan = !isStaffSender
      ? checkDeviceBanForSignup({
          fingerprint_id: fingerprintId || userDeviceMap.get(authorKey)?.fingerprint_id || "",
          storage_token: storageToken || userDeviceMap.get(authorKey)?.storage_token || "",
        })
      : { hardBlocked: false, shadowban: false };
    const isDeviceBannedSender = Boolean(sendDeviceBan.hardBlocked || sendDeviceBan.shadowban);
    const isShadowbanned = !isStaffSender && (isAccountShadowbanned(authorKey) || isDeviceBannedSender);
    if (isShadowbanned) {
      if (isDeviceBannedSender && !isAccountShadowbanned(authorKey)) {
        setAccountShadowbanned(authorName, true, {
          reason: "auto-shadowban triggered by banned device signature on chat send",
          recordDevice: false,
          highConfidenceSpam: false,
        });
      }
      return res.status(200).json({ success: true, message: sanitizedMsg });
    }

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
    if (!cleanText && !targetMsg.gifUrl && !targetMsg.imageUrl) {
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
        if (chatHistory[i]?.id) deletedChatMessageIds.add(String(chatHistory[i].id));
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
app.post("/api/chat/channels/create", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const authUser = await getAuthenticatedCloudSyncUser(req);
  if (!authUser || !isStaffRoleUser(authUser.username)) {
    return res.status(403).json({ success: false, error: "Only owners and mods can create channels" });
  }
  const body = req.body || {};
  const rawName = String(body.name || "").trim().toLowerCase().slice(0, 32);
  if (rawName.length < 2) {
    return res.status(400).json({ success: false, error: "Channel name must be at least 2 characters" });
  }
  const baseSlug = rawName.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "channel";
  let slug = baseSlug;
  let suffix = 2;
  while (chatChannels.some((c) => c.id === slug)) {
    slug = `${baseSlug.slice(0, 28)}-${suffix++}`;
  }
  const categoryLabel = String(body.categoryLabel || body.categoryId || "social").trim().toLowerCase().slice(0, 24) || "social";
  const categoryId = categoryLabel.replace(/[^a-z0-9-]+/g, "-") || "social";
  const icon = String(body.icon || "fa-hashtag").trim().slice(0, 40) || "fa-hashtag";
  const visibility = body.visibility === "staff" ? "staff" : "all";
  const writeAccess = body.writeAccess === "staff" ? "staff" : "all";

  const created = {
    id: slug,
    name: rawName,
    icon,
    categoryId,
    categoryLabel,
    visibility,
    writeAccess,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    updatedBy: authUser.username,
  };
  chatChannels.push(created);
  persistChatChannels();
  broadcastToClients({ type: "chat-event", event: "CHANNELS_UPDATED" }, "all");
  res.json({ success: true, channel: created });
});

app.post("/api/chat/channels/edit", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const authUser = await getAuthenticatedCloudSyncUser(req);
  if (!authUser || !isStaffRoleUser(authUser.username)) {
    return res.status(403).json({ success: false, error: "Only owners and mods can edit channels" });
  }
  const body = req.body || {};
  const targetId = String(body.id || "").trim();
  const existing = chatChannels.find((c) => c.id === targetId);
  if (!existing) {
    return res.status(404).json({ success: false, error: "Channel not found" });
  }
  if (typeof body.name === "string") {
    const cleanName = body.name.trim().toLowerCase().slice(0, 32);
    if (cleanName.length >= 2) existing.name = cleanName;
  }
  if (typeof body.categoryLabel === "string" && body.categoryLabel.trim()) {
    const catLabel = body.categoryLabel.trim().toLowerCase().slice(0, 24);
    existing.categoryLabel = catLabel;
    existing.categoryId = catLabel.replace(/[^a-z0-9-]+/g, "-") || existing.categoryId;
  }
  if (typeof body.icon === "string" && body.icon.trim()) {
    existing.icon = body.icon.trim().slice(0, 40);
  }
  if (body.visibility === "staff" || body.visibility === "all") {
    existing.visibility = body.visibility;
  }
  if (body.writeAccess === "staff" || body.writeAccess === "all") {
    existing.writeAccess = body.writeAccess;
  }
  if (typeof body.backgroundUrl === "string") {
    const rawBg = body.backgroundUrl.trim();
    if (!rawBg) {
      chatBackgrounds.delete(existing.id);
      persistChatBackgrounds();
      broadcastChatPayload(existing.id, { type: "chat-event", event: "CHAT_BG_UPDATED", channel: existing.id, backgroundUrl: "" });
    } else if (isAllowedChatImageUrl(rawBg)) {
      chatBackgrounds.set(existing.id, rawBg);
      persistChatBackgrounds();
      broadcastChatPayload(existing.id, { type: "chat-event", event: "CHAT_BG_UPDATED", channel: existing.id, backgroundUrl: rawBg });
    }
  }
  existing.updatedAt = Date.now();
  existing.updatedBy = authUser.username;
  persistChatChannels();
  broadcastToClients({ type: "chat-event", event: "CHANNELS_UPDATED" }, "all");
  res.json({ success: true, channel: existing, backgroundUrl: chatBackgrounds.get(existing.id) || "" });
});

app.post("/api/chat/background", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const authUser = await getAuthenticatedCloudSyncUser(req);
  if (!authUser) {
    return res.status(401).json({ success: false, error: "Sign in to edit chat backgrounds" });
  }
  const channel = String(req.body?.channel || "").trim();
  const rawBg = typeof req.body?.backgroundUrl === "string" ? req.body.backgroundUrl.trim() : "";
  if (!channel) {
    return res.status(400).json({ success: false, error: "Missing channel" });
  }

  const userKey = authUser.username.toLowerCase();
  if (channel.startsWith("dm:")) {
    if (!canAccessChatChannel(channel, userKey)) {
      return res.status(403).json({ success: false, error: "You are not a participant in this DM" });
    }
  } else if (channel.startsWith("group:")) {
    if (!canAccessChatChannel(channel, userKey)) {
      return res.status(403).json({ success: false, error: "You are not a member of this group chat" });
    }
  } else {
    if (!isStaffRoleUser(authUser.username)) {
      return res.status(403).json({ success: false, error: "Only owners and mods can edit main channel backgrounds" });
    }
    if (!getChatChannelConfig(channel)) {
      return res.status(404).json({ success: false, error: "Channel not found" });
    }
  }

  if (rawBg && !isAllowedChatImageUrl(rawBg)) {
    return res.status(400).json({ success: false, error: "Invalid background image or GIF URL" });
  }

  if (rawBg) {
    chatBackgrounds.set(channel, rawBg);
  } else {
    chatBackgrounds.delete(channel);
  }
  persistChatBackgrounds();
  broadcastChatPayload(channel, {
    type: "chat-event",
    event: "CHAT_BG_UPDATED",
    channel,
    backgroundUrl: rawBg,
  });
  res.json({ success: true, channel, backgroundUrl: rawBg });
});

app.post("/api/chat/channels/delete", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const authUser = await getAuthenticatedCloudSyncUser(req);
  if (!authUser || !isStaffRoleUser(authUser.username)) {
    return res.status(403).json({ success: false, error: "Only owners and mods can delete channels" });
  }
  const targetId = String(req.body?.id || "").trim();
  if (!targetId || targetId === "general") {
    return res.status(400).json({ success: false, error: "Cannot delete the #general channel" });
  }
  const idx = chatChannels.findIndex((c) => c.id === targetId);
  if (idx === -1) {
    return res.status(404).json({ success: false, error: "Channel not found" });
  }
  chatChannels.splice(idx, 1);
  persistChatChannels();
  broadcastToClients({ type: "chat-event", event: "CHANNELS_UPDATED" }, "all");
  res.json({ success: true });
});

app.post(["/api/chat/mod/ban-device", "/api/admin/ban-user"], async (req, res) => {
  await ensureChatMetaReadyAsync();
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
      return res.status(403).json({ success: false, error: "Cannot ban the site owner" });
    }
    if (staffModerators.has(targetKey) && !actor.isOwner) {
      return res.status(403).json({ success: false, error: "Only the owner can ban another moderator" });
    }

    const unban = req.body?.action === "unban" || req.body?.shadowbanned === false;
    const reason = String(req.body?.reason || "device & shadowban by staff").trim().slice(0, 160);
    if (unban) {
      setAccountShadowbanned(targetUsername, false);
      const sig = userDeviceMap.get(targetKey);
      if (sig) {
        for (let i = bannedDevices.length - 1; i >= 0; i--) {
          const b = bannedDevices[i];
          if (
            b.banned_username.toLowerCase() === targetKey ||
            (sig.storage_token && b.storage_token === sig.storage_token)
          ) {
            bannedDevices.splice(i, 1);
          }
        }
        persistBannedDevices();
      }
      recordStaffAction({
        action: "unban_device",
        actor,
        targetUsername,
        details: "removed shadowban & device ban",
      });
      invalidateCloudSyncUsersCache();
      broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
      return res.json({
        success: true,
        username: targetUsername,
        isShadowbanned: false,
      });
    }

    const result = await banUserAndDevice(targetUsername, {
      reason,
      highConfidenceSpam: req.body?.highConfidenceSpam !== false,
    });
    recordStaffAction({
      action: "ban_device",
      actor,
      targetUsername,
      details: reason,
    });
    res.json({
      success: true,
      username: targetUsername,
      isShadowbanned: true,
      bannedDevice: result.bannedDevice,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/chat/groups/create", async (req, res) => {
  ensureChatMetaLoaded();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    if (!authUser) {
      return res.status(401).json({ success: false, error: "Sign in to CloudSync to create a group chat" });
    }
    const creatorLower = authUser.username.toLowerCase();
    const isStaffCreator = isStaffRoleUser(authUser.username);
    const fingerprintId = String(req.body?.fingerprint_id || req.body?.fingerprintId || "").trim().slice(0, 120);
    const storageToken = String(req.body?.storage_token || req.body?.storageToken || "").trim().slice(0, 120);
    if (fingerprintId || storageToken) {
      recordUserDeviceSignature(authUser.username, {
        fingerprint_id: fingerprintId,
        storage_token: storageToken,
      });
    }
    const createdAtMs = getUserAccountCreatedAtMs(authUser.username);
    if (!isStaffCreator && createdAtMs > 0 && Date.now() - createdAtMs < ACCOUNT_CHAT_COOLDOWN_MS) {
      const remSec = Math.ceil((ACCOUNT_CHAT_COOLDOWN_MS - (Date.now() - createdAtMs)) / 1000);
      return res.status(403).json({
        success: false,
        error: `New accounts must wait ${Math.floor(remSec / 60)}m ${remSec % 60}s before chatting`,
      });
    }
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

    const initialMap = await getCloudSyncUsersMapAsync();
    if (initialMap.size > 0) {
      for (const m of memberSet) {
        if (!initialMap.has(m)) {
          const { user: lookedUp } = await ensureCloudSyncUserInMap(m);
          if (!lookedUp) {
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
      const initialMap = await getCloudSyncUsersMapAsync();
      if (initialMap.size > 0 && !initialMap.has(targetUsername)) {
        const { user: lookedUp } = await ensureCloudSyncUserInMap(targetUsername);
        if (!lookedUp) {
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
    totalUsersCount: getCloudSyncUsersCountSync(csMap),
    timeouts: timeoutsList,
    actorRole: actor.role,
    ...(actor.isMod
      ? {
          recentLogs: staffActionLogs.slice(-80).reverse(),
          recentNotes: getAllStaffNotesList(100),
        }
      : {}),
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
        ({ csMap } = await ensureCloudSyncUserInMap(rawUsername));
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
    const resolvedTarget = csMap.get(key)?.username || rawUsername;
    recordStaffAction({
      action: action === "add" ? "promote_mod" : "remove_mod",
      actor,
      targetUsername: resolvedTarget,
      details: action === "add" ? "promoted to staff moderator" : "removed from staff",
    });
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
    broadcastToClients(
      {
        type: "chat-event",
        event: "STAFF_UPDATED",
        staffMods: canonicalMods,
        ownerUsers: canonicalOwners,
        targetUsername: resolvedTarget,
        role: nextRole,
      },
      "all"
    );

    res.json({
      success: true,
      staffMods: canonicalMods,
      targetUsername: resolvedTarget,
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
      ({ csMap } = await ensureCloudSyncUserInMap(rawUsername));
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
    recordStaffAction({
      action: shouldGrant ? "award_goat" : "remove_goat",
      actor,
      targetUsername: canonicalTarget,
      details: shouldGrant ? "awarded golden GOAT title" : "removed GOAT title",
    });
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
      if (chatHistory[idx]?.id) deletedChatMessageIds.add(String(chatHistory[idx].id));
      chatHistory.splice(idx, 1);
      persistChatHistory();
    }
    if (actor.isMod && targetMsg && (!isAuthor || actor.hasAdminSecret)) {
      const snippet = targetMsg.text
        ? String(targetMsg.text).slice(0, 90)
        : targetMsg.imageUrl
        ? "[image attachment]"
        : targetMsg.gifUrl
        ? "[gif]"
        : "[message]";
      recordStaffAction({
        action: "delete_message",
        actor,
        targetUsername: targetMsg.author || "",
        channel: targetMsg.channel || "",
        details: snippet,
      });
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

    recordStaffAction({
      action: "purge_messages",
      actor,
      targetUsername,
      channel,
      details: `cleared ${removed} message(s)${channel ? ` in #${channel}` : ""}`,
    });

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

    const durationLabel =
      durationMinutes === 0
        ? "unmuted user"
        : durationMinutes < 0 || durationMinutes >= 525600
        ? "permanent mute"
        : durationMinutes >= 60
        ? `muted ${Math.round(durationMinutes / 60)}h`
        : `muted ${durationMinutes}m`;
    recordStaffAction({
      action: durationMinutes === 0 ? "unmute" : "timeout",
      actor,
      targetUsername,
      details: reason ? `${durationLabel} · ${reason}` : durationLabel,
    });

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
      userLogs: getStaffLogsForUser(targetKey, 60),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Staff-only audit logs and private moderation notes on users (never exposed to non-staff)
const ALLOWED_STAFF_NOTE_CATEGORIES = new Set(["general", "warning", "watch", "positive"]);

app.get("/api/chat/mod/logs", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const actor = await getModActor(req);
  if (!actor.isMod) {
    return res.status(403).json({ success: false, error: "Staff or admin access required" });
  }
  const filterUser = String(req.query.username || "").trim().replace(/^@/, "").toLowerCase();
  const limitRaw = parseInt(String(req.query.limit || "100"), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(250, Math.max(1, limitRaw)) : 100;
  const logs = filterUser
    ? getStaffLogsForUser(filterUser, limit)
    : staffActionLogs.slice(-limit).reverse();
  res.json({ success: true, logs });
});

app.get("/api/chat/mod/notes", async (req, res) => {
  await ensureChatMetaReadyAsync();
  const actor = await getModActor(req);
  if (!actor.isMod) {
    return res.status(403).json({ success: false, error: "Staff or admin access required" });
  }
  const rawUser = String(req.query.username || "").trim().replace(/^@/, "");
  if (rawUser) {
    const key = rawUser.toLowerCase();
    return res.json({
      success: true,
      username: rawUser,
      notes: getStaffNotesForUser(key),
    });
  }
  res.json({
    success: true,
    recentNotes: getAllStaffNotesList(120),
  });
});

app.post("/api/chat/mod/notes", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const actor = await getModActor(req);
    if (!actor.isMod) {
      return res.status(403).json({ success: false, error: "Staff or admin access required" });
    }
    const rawUsername = String(req.body?.username || "").trim().replace(/^@/, "");
    const noteText = String(req.body?.note || "").trim().slice(0, 400);
    const rawCat = String(req.body?.category || "general").trim().toLowerCase();
    const category = ALLOWED_STAFF_NOTE_CATEGORIES.has(rawCat) ? rawCat : "general";

    if (!rawUsername || rawUsername.length > 40) {
      return res.status(400).json({ success: false, error: "Valid target username is required" });
    }
    if (!noteText) {
      return res.status(400).json({ success: false, error: "Note text cannot be empty" });
    }

    const key = rawUsername.toLowerCase();
    let csMap = await getCloudSyncUsersMapAsync();
    if (csMap.size > 0 && !csMap.has(key)) {
      ({ csMap } = await ensureCloudSyncUserInMap(rawUsername));
    }
    if (csMap.size > 0 && !csMap.has(key) && !knownUsers.has(key)) {
      return res.status(404).json({
        success: false,
        error: `User "@${rawUsername}" not found in CloudSync`,
      });
    }

    const canonicalTarget = csMap.get(key)?.username || rawUsername;
    const entry = {
      id: `snote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      targetUsername: canonicalTarget,
      author: actor.username || "staff",
      authorRole: actor.role || "mod",
      note: noteText,
      category,
      createdAt: Date.now(),
    };
    const existing = staffUserNotes.get(key) || [];
    const nextList = [entry, ...existing].slice(0, MAX_NOTES_PER_USER);
    staffUserNotes.set(key, nextList);
    persistStaffUserNotes();

    recordStaffAction({
      action: "note_added",
      actor,
      targetUsername: canonicalTarget,
      details: `[${category}] ${noteText.slice(0, 120)}`,
    });

    res.status(201).json({
      success: true,
      note: entry,
      notes: nextList,
      userLogs: getStaffLogsForUser(key, 60),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/chat/mod/notes/:noteId", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const actor = await getModActor(req);
    if (!actor.isMod) {
      return res.status(403).json({ success: false, error: "Staff or admin access required" });
    }
    const noteId = String(req.params.noteId || "").trim();
    if (!noteId) {
      return res.status(400).json({ success: false, error: "noteId required" });
    }

    let foundKey = "";
    let removedEntry = null;
    const hintKey = String(req.query.username || req.body?.username || "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    const keysToScan = hintKey ? [hintKey] : Array.from(staffUserNotes.keys());

    for (const uk of keysToScan) {
      const list = staffUserNotes.get(uk);
      if (!Array.isArray(list)) continue;
      const idx = list.findIndex((n) => n && n.id === noteId);
      if (idx >= 0) {
        foundKey = uk;
        removedEntry = list[idx];
        const nextList = list.filter((n) => n && n.id !== noteId);
        if (nextList.length > 0) staffUserNotes.set(uk, nextList);
        else staffUserNotes.delete(uk);
        break;
      }
    }

    if (!removedEntry) {
      return res.status(404).json({ success: false, error: "Staff note not found" });
    }

    deletedStaffNoteIds.add(noteId);
    persistStaffUserNotes({ includeTombstones: true });

    recordStaffAction({
      action: "note_deleted",
      actor,
      targetUsername: removedEntry.targetUsername || foundKey,
      details: `removed [${removedEntry.category || "general"}] note`,
    });

    res.json({
      success: true,
      noteId,
      notes: getStaffNotesForUser(foundKey),
      userLogs: getStaffLogsForUser(foundKey, 60),
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

// --- Game Studio Published Games API (shared SQLite app_kv + Aiven app_kv) ---
async function fetchSupabaseKvKeyAsync(key, { timeoutMs = 15000 } = {}) {
  if (!USE_SUPABASE_CLOUDSYNC || isSupabaseDegraded()) return undefined;
  try {
    if (supabaseHasAppKvTable !== false) {
      try {
        const res = await aivenDb.query(
          "SELECT v FROM public.app_kv WHERE k = $1 LIMIT 1",
          [String(key)],
        );
        supabaseHasAppKvTable = true;
        const row = res.rows?.[0];
        if (row && typeof row.v === "string") {
          try {
            return JSON.parse(row.v);
          } catch {}
        }
        return null;
      } catch (err) {
        if (err?.code === "42P01") {
          supabaseHasAppKvTable = false;
        } else {
          throw err;
        }
      }
    }
    if (supabaseHasAppKvTable === false && !isSupabaseDegraded()) {
      const sysId = supabaseKvSysUserId || (await getOrCreateSupabaseSystemKvUserId());
      if (sysId) {
        const row = await dbGetSyncPayload(sysId);
        if (row?.payload_json) {
          try {
            const parsed = JSON.parse(String(row.payload_json));
            if (parsed?.kv && parsed.kv[key] !== undefined) {
              return parsed.kv[key];
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn(`[studio] Aiven ${key} fetch warning:`, err?.message);
  }
  return undefined;
}

async function flushKvKeyToSqliteAndSupabaseAsync(key, value, { awaitRemote = false, timeoutMs = 25000 } = {}) {
  localKvSetJson(key, value);
  if (pendingSupabaseKvTimers.has(String(key))) {
    clearTimeout(pendingSupabaseKvTimers.get(String(key)));
    pendingSupabaseKvTimers.delete(String(key));
  }
  if (!USE_SUPABASE_CLOUDSYNC || isSupabaseDegraded()) {
    return { persistedRemote: false };
  }
  if (awaitRemote) {
    const r = await persistKvKeyToSupabaseAsync(key, { timeoutMs }).catch(() => ({ ok: false }));
    return { persistedRemote: Boolean(r?.ok) };
  }
  scheduleSupabaseKvSync(key);
  return { persistedRemote: false };
}

let studioGamesRemoteRefreshPromise = null;
async function getMergedStudioGamesAsync({ forceRemote = false } = {}) {
  await ensureChatMetaReadyAsync();
  const localGames = kvGetJson(STUDIO_GAMES_KV_KEY, []);
  let remoteGames;
  // Egress optimization: once app_kv is loaded on startup (hasLoadedRemoteKvSuccessfully === true),
  // serve all studio games directly from RAM (publishedStudioGames) without re-downloading multi-MB HTML game blobs from Supabase.
  if (
    USE_SUPABASE_CLOUDSYNC &&
    !isSupabaseDegraded() &&
    !hasLoadedRemoteKvSuccessfully &&
    (forceRemote || Date.now() - studioGamesRemoteSyncedAt > 8000)
  ) {
    if (!studioGamesRemoteRefreshPromise) {
      studioGamesRemoteRefreshPromise = fetchSupabaseKvKeyAsync(STUDIO_GAMES_KV_KEY, { timeoutMs: 15000 })
        .then((val) => {
          if (val !== undefined) studioGamesRemoteSyncedAt = Date.now();
          return Array.isArray(val) ? val : [];
        })
        .catch(() => undefined)
        .finally(() => {
          studioGamesRemoteRefreshPromise = null;
        });
    }
    remoteGames = await studioGamesRemoteRefreshPromise;
  }
  const merged = mergeStudioGamesLists(
    publishedStudioGames,
    Array.isArray(localGames) ? localGames : [],
    Array.isArray(remoteGames) ? remoteGames : []
  );
  publishedStudioGames.splice(0, publishedStudioGames.length, ...merged);
  if (merged.length > 0 && Array.isArray(remoteGames)) {
    localKvSetJson(STUDIO_GAMES_KV_KEY, merged);
    if (merged.length > remoteGames.length) {
      scheduleSupabaseKvSync(STUDIO_GAMES_KV_KEY);
    }
  }
  return publishedStudioGames;
}

app.get(["/api/studio/games", "/api/games/community", "/api/creator/games"], async (req, res) => {
  const forceRemote = req.query.fresh === "1" || req.query.refresh === "1";
  const games = await getMergedStudioGamesAsync({ forceRemote }).catch(() => publishedStudioGames);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({ success: true, games });
});

app.post(["/api/studio/games", "/api/games/community", "/api/creator/games"], async (req, res) => {
  try {
    const { game } = req.body || {};
    if (!game || !String(game.title || "").trim() || !String(game.author || "").trim()) {
      return res.status(400).json({ success: false, error: "Missing game title or author" });
    }
    if (
      typeof game.customHtmlContent === "string" &&
      Buffer.byteLength(game.customHtmlContent, "utf-8") > MAX_CUSTOM_HTML_BYTES
    ) {
      return res.status(413).json({
        success: false,
        error: "Custom HTML file exceeds 5MB server limit",
      });
    }
    const cleanTitle = String(game.title).trim().slice(0, 80);
    const cleanDesc = String(game.description || "").trim().slice(0, 240);
    const modCheck = await moderateTextWithOpenAI(`${cleanTitle} ${cleanDesc}`);
    if (modCheck.blocked) {
      return res.status(400).json({
        success: false,
        error: modCheck.reason || "Game title or description blocked by moderation",
      });
    }

    const [authUser] = await Promise.all([
      getAuthenticatedCloudSyncUser(req).catch(() => null),
      getMergedStudioGamesAsync().catch(() => publishedStudioGames),
    ]);

    const nowIso = new Date().toISOString();
    const entryId = String(game.id || "").trim() || `game_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const existing = publishedStudioGames.find((g) => g.id === entryId);
    const entry = {
      ...game,
      id: entryId,
      title: cleanTitle,
      description: cleanDesc,
      author: authUser?.username || existing?.author || String(game.author).trim().slice(0, 60),
      createdAt: existing?.createdAt || game.createdAt || nowIso,
      updatedAt: nowIso,
      plays: Math.max(Number(existing?.plays) || 0, Number(game.plays) || 0),
      likes: Math.max(Number(existing?.likes) || 0, Number(game.likes) || 0),
    };

    const merged = mergeStudioGamesLists([entry], publishedStudioGames);
    publishedStudioGames.splice(0, publishedStudioGames.length, ...merged);
    studioGamesRemoteSyncedAt = Date.now();

    const syncResult = await flushKvKeyToSqliteAndSupabaseAsync(
      STUDIO_GAMES_KV_KEY,
      publishedStudioGames,
      { awaitRemote: true, timeoutMs: 25000 }
    );

    broadcastToClients({ type: "studio-event", event: "GAME_PUBLISHED", game: entry }, "all");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      success: true,
      game: entry,
      persistedRemote: syncResult.persistedRemote,
      totalGames: publishedStudioGames.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/studio/games/:id/stat", async (req, res) => {
  await getMergedStudioGamesAsync().catch(() => publishedStudioGames);
  const { id } = req.params;
  const { field } = req.body || {};
  const found = publishedStudioGames.find((g) => g.id === id);
  if (!found) {
    return res.status(404).json({ success: false, game: null, error: "Game not found" });
  }

  let liked = false;
  let rewardCoins = 0;

  if (field === "likes") {
    const authUser = await getAuthenticatedCloudSyncUser(req).catch(() => null);
    const reqIp = String(req.headers["cf-connecting-ip"] || req.ip || "").trim();
    const actorKey = authUser?.username
      ? `u:${authUser.username.toLowerCase()}`
      : reqIp
        ? `ip:${reqIp}`
        : "";
    if (!actorKey) {
      return res.status(401).json({ success: false, error: "Sign in to like games" });
    }
    if (!Array.isArray(found.likedBy)) found.likedBy = [];
    if (!Array.isArray(found.rewardedLikesBy)) found.rewardedLikesBy = [];

    const existingIdx = found.likedBy.indexOf(actorKey);
    if (existingIdx >= 0) {
      found.likedBy.splice(existingIdx, 1);
      found.likes = Math.max(0, (Number(found.likes) || 0) - 1);
      liked = false;
    } else {
      found.likedBy.push(actorKey);
      found.likes = Math.max(found.likedBy.length, (Number(found.likes) || 0) + 1);
      liked = true;
      if (!found.rewardedLikesBy.includes(actorKey)) {
        found.rewardedLikesBy.push(actorKey);
        rewardCoins = 2;
      }
    }
  } else if (field === "plays") {
    found.plays = (found.plays || 0) + 1;
  }

  found.updatedAt = new Date().toISOString();
  localKvSetJson(STUDIO_GAMES_KV_KEY, publishedStudioGames);
  scheduleSupabaseKvSync(STUDIO_GAMES_KV_KEY);
  return res.json({ success: true, game: found, liked, rewardCoins });
});

// Serve custom uploaded index.html studio game with CloudSync Player Tracking SDK bridge
app.get("/api/studio/games/:id/play.html", async (req, res) => {
  await getMergedStudioGamesAsync().catch(() => publishedStudioGames);
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

// --- Custom User Game Studios API (shared SQLite + Supabase app_kv) ---
async function getMergedStudiosAsync() {
  await ensureChatMetaReadyAsync();
  const localStudios = kvGetJson(STUDIO_PROFILES_KV_KEY, []);
  const now = Date.now();
  let remoteStudios;
  // Egress optimization: once app_kv is loaded on startup (hasLoadedRemoteKvSuccessfully === true),
  // serve custom studios directly from RAM (customStudios) without polling Supabase every 15s.
  if (
    USE_SUPABASE_CLOUDSYNC &&
    !isSupabaseDegraded() &&
    !hasLoadedRemoteKvSuccessfully &&
    now - studioStudiosRemoteSyncedAt > 15000
  ) {
    const val = await fetchSupabaseKvKeyAsync(STUDIO_PROFILES_KV_KEY, { timeoutMs: 8000 });
    if (val !== undefined) {
      studioStudiosRemoteSyncedAt = now;
      remoteStudios = Array.isArray(val) ? val : [];
    }
  }
  const merged = mergeStudioProfilesLists(
    customStudios,
    Array.isArray(localStudios) ? localStudios : [],
    Array.isArray(remoteStudios) ? remoteStudios : []
  );
  customStudios.splice(0, customStudios.length, ...merged);
  if (merged.length > 0 && Array.isArray(remoteStudios)) {
    localKvSetJson(STUDIO_PROFILES_KV_KEY, merged);
  }
  return customStudios;
}

app.get("/api/studio/studios", async (_req, res) => {
  const studios = await getMergedStudiosAsync().catch(() => customStudios);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({ success: true, studios });
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
    await getMergedStudiosAsync().catch(() => customStudios);
    const updated = { ...studio, updatedAt: new Date().toISOString() };
    const merged = mergeStudioProfilesLists([updated], customStudios);
    customStudios.splice(0, customStudios.length, ...merged);
    studioStudiosRemoteSyncedAt = Date.now();
    await flushKvKeyToSqliteAndSupabaseAsync(STUDIO_PROFILES_KV_KEY, customStudios, {
      awaitRemote: true,
      timeoutMs: 12000,
    });
    const saved =
      customStudios.find(
        (s) => s.id === updated.id || s.owner.toLowerCase() === String(updated.owner).toLowerCase()
      ) || updated;
    res.json({ success: true, studio: saved });
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

const THREEKHO_MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".swf": "application/x-shockwave-flash",
  ".unityweb": "application/octet-stream",
  ".data": "application/octet-stream",
  ".mem": "application/octet-stream",
};

// Proxy 3kh0-assets raw files from GitLab with proper MIME types so games run natively
app.use("/api/3kh0", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }
  const rawPath = String(req.path || "").replace(/^\/+/, "");
  if (!rawPath || rawPath.includes("..") || rawPath.includes("\\")) {
    return res.status(400).send("Invalid asset path");
  }
  const finalPath = rawPath.endsWith("/") ? `${rawPath}index.html` : rawPath;
  const upstreamUrl = `https://gitlab.com/3kh0/3kh0-assets/-/raw/main/${finalPath}`;
  try {
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OperationCookie/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send("Asset not found");
    }
    const ext = path.extname(finalPath).toLowerCase();
    const mime = THREEKHO_MIME_BY_EXT[ext] || upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (req.method === "HEAD") {
      return res.status(200).end();
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(502).send(err?.message || "Failed to fetch 3kh0 asset");
  }
});

// CCPorted games catalog (cached in memory for 6h) & MIME-fixing asset proxy
let ccportedGamesCache = { data: null, fetchedAt: 0 };
let ccportedGamesInFlight = null;
const CCPORTED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function fetchCcportedGamesCatalog() {
  if (
    Array.isArray(ccportedGamesCache.data) &&
    ccportedGamesCache.data.length > 0 &&
    Date.now() - ccportedGamesCache.fetchedAt < CCPORTED_CACHE_TTL_MS
  ) {
    return ccportedGamesCache.data;
  }
  if (ccportedGamesInFlight) return ccportedGamesInFlight;

  ccportedGamesInFlight = (async () => {
    const dirRes = await fetch("https://api.github.com/repos/ccported/games/contents", {
      headers: {
        "User-Agent": "OperationCookie/1.0",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!dirRes.ok) {
      throw new Error(`GitHub contents error: ${dirRes.status}`);
    }
    const items = await dirRes.json();
    const dirs = Array.isArray(items)
      ? items
          .filter((x) => x && x.type === "dir" && typeof x.name === "string" && x.name.startsWith("game_"))
          .map((x) => x.name)
      : [];

    const out = [];
    const BATCH = 18;
    for (let i = 0; i < dirs.length; i += BATCH) {
      const slice = dirs.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        slice.map(async (dir) => {
          const metaUrl = `https://cdn.jsdelivr.net/gh/ccported/games@main/${encodeURIComponent(dir)}/ccported_game_data.json`;
          const r = await fetch(metaUrl, { signal: AbortSignal.timeout(6000) });
          if (!r.ok) return null;
          const meta = await r.json();
          const name = String(meta?.name || "").trim();
          if (!name) return null;
          const thumbPath = String(meta?.thumb_path || "/thumb.jpg").trim();
          const tags = Array.isArray(meta?.tags) ? meta.tags.map((t) => String(t).trim()).filter(Boolean) : [];
          return {
            id: dir,
            name,
            thumb: thumbPath.startsWith("/") ? thumbPath : `/${thumbPath}`,
            category: tags[0] || "",
          };
        })
      );
      for (const res of results) {
        if (res.status === "fulfilled" && res.value) {
          out.push(res.value);
        }
      }
    }

    out.sort((a, b) => a.name.localeCompare(b.name));
    if (out.length > 0) {
      ccportedGamesCache = { data: out, fetchedAt: Date.now() };
    }
    return out;
  })().finally(() => {
    ccportedGamesInFlight = null;
  });

  return ccportedGamesInFlight;
}

app.get("/api/ccported/games.json", async (_req, res) => {
  try {
    const games = await fetchCcportedGamesCatalog();
    res.setHeader("Cache-Control", "public, max-age=1800");
    return res.json(games);
  } catch (err) {
    if (Array.isArray(ccportedGamesCache.data) && ccportedGamesCache.data.length > 0) {
      return res.json(ccportedGamesCache.data);
    }
    return res.status(502).json({ error: err?.message || "Failed to fetch CCPorted catalog" });
  }
});

app.use("/api/ccported", async (req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).end();
  }
  const rawPath = String(req.path || "").replace(/^\/+/, "");
  if (!rawPath || rawPath.includes("..") || rawPath.includes("\\")) {
    return res.status(400).send("Invalid asset path");
  }
  const finalPath = rawPath.endsWith("/") ? `${rawPath}index.html` : rawPath;
  const cdnUrl = `https://cdn.jsdelivr.net/gh/ccported/games@main/${finalPath}`;
  const rawFallbackUrl = `https://raw.githubusercontent.com/ccported/games/main/${finalPath}`;
  try {
    let upstream = await fetch(cdnUrl, {
      method: req.method,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; OperationCookie/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      upstream = await fetch(rawFallbackUrl, {
        method: req.method,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OperationCookie/1.0)" },
        signal: AbortSignal.timeout(15000),
      });
    }
    if (!upstream.ok) {
      return res.status(upstream.status).send("Asset not found");
    }
    const ext = path.extname(finalPath).toLowerCase();
    const mime =
      THREEKHO_MIME_BY_EXT[ext] ||
      upstream.headers.get("content-type") ||
      "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (req.method === "HEAD") {
      return res.status(200).end();
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buf);
  } catch (err) {
    return res.status(502).send(err?.message || "Failed to fetch CCPorted asset");
  }
});

// EasyFun.gg Android cloud games catalog (cached in memory for 30m)
const EASYFUN_FALLBACK_GAMES = [
  { id: "roblox", name: "Roblox", playUrl: "https://www.easyfun.gg/cloud-games/roblox.html", cover: "https://res.ldrescdn.com/rms/ldplayer/process/img/251c47ffa26347b7860aedc9c02511211724903692.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "cookierun-kingdom-cloud-online", name: "CookieRun: Kingdom", playUrl: "https://www.easyfun.gg/cloud-games/cookierun-kingdom-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/h0q62mee82s-1757931773.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "brawl-stars", name: "Brawl Stars", playUrl: "https://www.easyfun.gg/cloud-games/brawl-stars.html", cover: "https://res.ldrescdn.com/rms/upload/easyfun/admin/o6kf58bo7vb-1757925491.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "genshin-impact", name: "Genshin Impact", playUrl: "https://www.easyfun.gg/cloud-games/genshin-impact.html", cover: "https://res.ldrescdn.com/rms/upload/easyfun/admin/5vohoce9bsm-1757925457.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "honkai-star-rail", name: "Honkai: Star Rail", playUrl: "https://www.easyfun.gg/cloud-games/honkai-star-rail.html", cover: "https://res.ldrescdn.com/rms/upload/easyfun/admin/wfc93tdzwv-1757925441.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "clash-of-clans", name: "Clash of Clans", playUrl: "https://www.easyfun.gg/cloud-games/clash-of-clans.html", cover: "https://res.ldrescdn.com/rms/upload/easyfun/admin/760u9rnjitw-1757925476.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "clash-royale-cloud-online", name: "Clash Royale", playUrl: "https://www.easyfun.gg/cloud-games/clash-royale-cloud-online.html", cover: "https://res.ldplayer.net/rms/ldplayer/process/img/41246ab53d5544168ac391832883550a1719158138.webp?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "among-us", name: "Among Us", playUrl: "https://www.easyfun.gg/cloud-games/among-us.html", cover: "https://res.ldrescdn.com/rms/ldplayer/process/img/5e941c7cf3ee4814954a446071ea255d1728448132.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "free-fire", name: "Free Fire", playUrl: "https://www.easyfun.gg/cloud-games/free-fire.html", cover: "https://res.ldrescdn.com/rms/ldplayer/process/img/b8e2aca38996414ab40a6960bcb9463b1728458849.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "free-fire-max-cloud-online", name: "Free Fire MAX", playUrl: "https://www.easyfun.gg/cloud-games/free-fire-max-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/7w7a86n8d4e-1757932101.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "squad-busters", name: "Squad Busters", playUrl: "https://www.easyfun.gg/cloud-games/squad-busters.html", cover: "https://res.ldrescdn.com/rms/upload/en/blx2ezb2vro-1757932256.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "solo-leveling-arise-cloud-online", name: "Solo Leveling:Arise", playUrl: "https://www.easyfun.gg/cloud-games/solo-leveling-arise-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/va2ubd8lh5-1757939462.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "asphalt-8-car-racing-game-cloud-online", name: "Asphalt 8: Airborne", playUrl: "https://www.easyfun.gg/cloud-games/asphalt-8-car-racing-game-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/bpqiauxrc3t-1757940251.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "eggy-party-trendy-party-game-cloud-online", name: "Eggy Party: Trendy Party Game", playUrl: "https://www.easyfun.gg/cloud-games/eggy-party-trendy-party-game-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/otxktpek10b-1754024972.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "soul-knight-cloud-online", name: "Soul Knight", playUrl: "https://www.easyfun.gg/cloud-games/soul-knight-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/311lv185ud-1747207976.png?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "purble-place-cloud-online", name: "Purble Place (original)", playUrl: "https://www.easyfun.gg/cloud-games/purble-place-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/lsbb34kt2s9-1757939381.webp?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "epic-seven-cloud-online", name: "Epic Seven", playUrl: "https://www.easyfun.gg/cloud-games/epic-seven-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/bzbl4rmfied-1757940172.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
  { id: "last-war-survival-game-cloud-online", name: "Last War:Survival Game", playUrl: "https://www.easyfun.gg/cloud-games/last-war-survival-game-cloud-online.html", cover: "https://res.ldrescdn.com/rms/upload/en/rnr7nbtrvr-1757939702.jpg?x-oss-process=image/format,webp/quality,Q_75/resize,w_384" },
];

let easyfunGamesCache = { data: null, fetchedAt: 0 };
let easyfunGamesInFlight = null;
const EASYFUN_CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchEasyfunGamesCatalog() {
  if (
    Array.isArray(easyfunGamesCache.data) &&
    easyfunGamesCache.data.length > 0 &&
    Date.now() - easyfunGamesCache.fetchedAt < EASYFUN_CACHE_TTL_MS
  ) {
    return easyfunGamesCache.data;
  }
  if (easyfunGamesInFlight) return easyfunGamesInFlight;

  easyfunGamesInFlight = (async () => {
    const r = await fetch("https://www.easyfun.gg/cloud-games.html", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      throw new Error(`easyfun.gg responded ${r.status}`);
    }
    const html = await r.text();
    const cardRe = /<a[^>]+href="(\/cloud-games\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
    const byHref = new Map();
    let m;
    while ((m = cardRe.exec(html)) !== null) {
      const href = m[1];
      const inner = m[2];
      const rawSrc = inner.match(/\bsrc="(https:\/\/[^"]+)"/i)?.[1] || "";
      const alt = (inner.match(/\balt="([^"]+)"/i)?.[1] || "").replace(/\s+online$/i, "").trim();
      const heading = (
        inner.match(/<(?:h[1-6]|p|span|div)[^>]*>([^<]{2,64})<\/(?:h[1-6]|p|span|div)>/i)?.[1] || ""
      ).trim();
      const name = heading || alt;
      if (!name) continue;
      const isHero = inner.includes("1200/400") || inner.includes('width="1200"');
      const cover = rawSrc.replace(/resize,w_\d+/i, "resize,w_384");
      const slug = href.replace(/^\/cloud-games\//, "").replace(/\.html$/i, "");
      const prev = byHref.get(href);
      if (!prev || (prev.isHero && !isHero) || (!prev.cover && cover)) {
        byHref.set(href, {
          id: slug,
          name,
          playUrl: `https://www.easyfun.gg${href}`,
          cover,
          isHero,
        });
      }
    }

    const out = Array.from(byHref.values())
      .map(({ id, name, playUrl, cover }) => ({ id, name, playUrl, cover }))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (out.length > 0) {
      easyfunGamesCache = { data: out, fetchedAt: Date.now() };
    }
    return out;
  })().finally(() => {
    easyfunGamesInFlight = null;
  });

  return easyfunGamesInFlight;
}

app.get("/api/easyfun/games.json", async (_req, res) => {
  try {
    const games = await fetchEasyfunGamesCatalog();
    res.setHeader("Cache-Control", "public, max-age=900");
    return res.json(games.length > 0 ? games : EASYFUN_FALLBACK_GAMES);
  } catch {
    res.setHeader("Cache-Control", "public, max-age=300");
    if (Array.isArray(easyfunGamesCache.data) && easyfunGamesCache.data.length > 0) {
      return res.json(easyfunGamesCache.data);
    }
    return res.json(EASYFUN_FALLBACK_GAMES);
  }
});

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

    const normTarget = (targetUsername || "").trim().toLowerCase();
    const cloudUser = targetUsername ? await getCloudSyncUserAsync(targetUsername) : null;
    let delivered = 0;
    const matchedClients = [];
    for (const [id, client] of liveClients.entries()) {
      const matchId = targetClientId && id === targetClientId;
      const clientNorm = (client.username || "").trim().toLowerCase();
      const matchUser = normTarget && clientNorm === normTarget;
      if (matchId || matchUser) {
        matchedClients.push({ id, client, matchId });
      }
    }
    if (matchedClients.length > 0) {
      matchedClients.sort((a, b) => {
        if (a.matchId !== b.matchId) return a.matchId ? -1 : 1;
        return (b.client.lastSeen || 0) - (a.client.lastSeen || 0);
      });
      for (const entry of matchedClients) {
        try {
          entry.client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
          delivered++;
          break;
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

// --- Cookie Master ($2/mo Subscription) & Stripe Managed Payments Integration ---
const STRIPE_SECRET_KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_PRICE_ID = (process.env.STRIPE_PRICE_ID || "").trim();
const STRIPE_PRODUCT_ID = (process.env.STRIPE_PRODUCT_ID || "").trim();
const STRIPE_WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_API_VERSION = (process.env.STRIPE_API_VERSION || "").trim();
const STRIPE_TIER_NAME = (process.env.STRIPE_TIER_NAME || "").trim();
const STRIPE_PORTAL_URL = (
  process.env.STRIPE_PORTAL_URL ||
  process.env.STRIPE_BILLING_URL ||
  ""
).trim();
const STRIPE_CHECKOUT_URL = (() => {
  const raw = (
    process.env.STRIPE_PAYMENT_LINK_URL ||
    process.env.STRIPE_CHECKOUT_URL ||
    ""
  ).trim();
  if (!raw) return "";
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
    return new URL(withScheme).toString();
  } catch {
    return raw;
  }
})();
const STRIPE_TEST_MODE =
  STRIPE_SECRET_KEY.startsWith("sk_test_") ||
  String(process.env.STRIPE_TEST_MODE || "").trim().toLowerCase() !== "false";
const STRIPE_SUB_DURATION_MS = 33 * 24 * 60 * 60 * 1000; // 31 days + 2 day renewal grace
const STRIPE_RENEWAL_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const STRIPE_SUBS_FILE = path.resolve(
  process.env.COOKIE_MASTER_SUBS_PATH || path.join(__dirname, "data", "stripe-subscriptions.json"),
);
const STRIPE_KV_KEY = "stripe_subscriptions_v1";
const STRIPE_INACTIVE_STATUSES = new Set([
  "canceled",
  "expired",
  "unpaid",
  "refunded",
  "disputed",
  "paused",
  "incomplete",
  "incomplete_expired",
]);

let stripeSubscriptionsCache = null;
let supabaseHasStripeTable = null;

function getSafeRequestOrigin(req) {
  const protoRaw = String(req.get("x-forwarded-proto") || req.protocol || "https")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const proto = protoRaw === "http" ? "http" : "https";
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  if (!host) return "";
  try {
    const u = new URL(`${proto}://${host}`);
    return u.origin;
  } catch {
    return "";
  }
}

function loadStripeSubscriptions() {
  if (Array.isArray(stripeSubscriptionsCache)) return stripeSubscriptionsCache;
  const byId = new Map();
  const mergeList = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const id = String(item.subscriptionId || item.checkoutSessionId || item.transactionId || "").trim();
      if (!id) continue;
      byId.set(id.toLowerCase(), { ...byId.get(id.toLowerCase()), ...item, subscriptionId: id });
    }
  };
  for (const key of [STRIPE_KV_KEY, "lemonsqueezy_subscriptions_v1"]) {
    try {
      const kvArr = kvGetJson(key, null);
      mergeList(kvArr);
    } catch (e) {
      console.warn("Stripe KV load warning:", e?.message);
    }
  }
  try {
    if (fs.existsSync(STRIPE_SUBS_FILE)) {
      mergeList(JSON.parse(fs.readFileSync(STRIPE_SUBS_FILE, "utf-8")));
    }
  } catch (e) {
    console.warn("Stripe subscriptions load warning:", e?.message);
  }
  stripeSubscriptionsCache = Array.from(byId.values());
  return stripeSubscriptionsCache;
}

function getActiveCookieMasterUsersList() {
  const now = Date.now();
  const seen = new Set();
  const out = [];
  try {
    const subs = loadStripeSubscriptions();
    for (const s of subs) {
      if (!isStripeRecordActive(s, now)) continue;
      for (const candidate of [s.claimedUsernameLower, s.customUsernameLower, s.userNameLower]) {
        const clean = String(candidate || "").trim().toLowerCase();
        if (clean && !seen.has(clean)) {
          seen.add(clean);
          out.push(clean);
        }
      }
    }
  } catch {}
  return out;
}

function saveStripeSubscriptions(list) {
  stripeSubscriptionsCache = list;
  try {
    kvSetJson(STRIPE_KV_KEY, list);
  } catch (e) {
    console.warn("Stripe KV save warning:", e?.message);
  }
  try {
    const dir = path.dirname(STRIPE_SUBS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STRIPE_SUBS_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (e) {
    console.warn("Stripe subscriptions file save warning:", e?.message);
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

function isStripeRecordActive(r, now = Date.now()) {
  if (!r || typeof r !== "object") return false;
  const status = String(r.status || "active").trim().toLowerCase();
  if (STRIPE_INACTIVE_STATUSES.has(status)) return false;
  const exp = typeof r.expiresAt === "number" ? r.expiresAt : Date.parse(r.expires_at || "") || 0;
  return exp > now;
}

function computeStripeSubExpiresAt(subObj, now = Date.now()) {
  const status = String(subObj?.status || "active").trim().toLowerCase();
  if (STRIPE_INACTIVE_STATUSES.has(status)) {
    return now;
  }
  const firstItem = Array.isArray(subObj?.items?.data) ? subObj.items.data[0] : null;
  const periodEndSec = Number(subObj?.current_period_end || firstItem?.current_period_end || 0);
  const trialEndSec = Number(subObj?.trial_end || 0);
  const cancelAtSec = Number(subObj?.cancel_at || 0);
  const periodEndMs = periodEndSec > 0 ? periodEndSec * 1000 : 0;
  const trialEndMs = trialEndSec > 0 ? trialEndSec * 1000 : 0;
  const cancelAtMs = cancelAtSec > 0 ? cancelAtSec * 1000 : 0;

  if (subObj?.cancel_at_period_end) {
    const endTarget = Math.max(periodEndMs, cancelAtMs, trialEndMs);
    return endTarget > now ? endTarget : now + STRIPE_SUB_DURATION_MS;
  }

  const target = Math.max(
    periodEndMs ? periodEndMs + STRIPE_RENEWAL_GRACE_MS : 0,
    trialEndMs ? trialEndMs + STRIPE_RENEWAL_GRACE_MS : 0,
  );
  return target > now ? target : now + STRIPE_SUB_DURATION_MS;
}

function matchesStripeProductFilters({ priceId = "", productId = "" } = {}) {
  const cleanPrice = String(priceId || "").trim();
  const cleanProduct = String(productId || "").trim();
  if (STRIPE_PRICE_ID && cleanPrice && cleanPrice !== STRIPE_PRICE_ID) {
    return false;
  }
  if (STRIPE_PRODUCT_ID && cleanProduct && cleanProduct !== STRIPE_PRODUCT_ID) {
    return false;
  }
  return true;
}

async function persistStripeSubscriptionRecord(record) {
  const list = loadStripeSubscriptions();
  const subKey = String(record.subscriptionId || "").toLowerCase();
  const sessKey = String(record.checkoutSessionId || "").toLowerCase();
  const idx = list.findIndex((r) => {
    const existingSub = String(r.subscriptionId || "").toLowerCase();
    const existingSess = String(r.checkoutSessionId || "").toLowerCase();
    if (subKey && existingSub === subKey) return true;
    if (sessKey && existingSess === sessKey && existingSub.startsWith("cs_")) return true;
    return false;
  });
  const existing = idx >= 0 ? list[idx] : {};
  const merged = {
    ...existing,
    ...record,
    checkoutSessionId: record.checkoutSessionId || existing.checkoutSessionId || "",
    invoiceId: record.invoiceId || existing.invoiceId || "",
    customerId: record.customerId || existing.customerId || "",
    emailLower: record.emailLower || existing.emailLower || "",
    userNameLower: record.userNameLower || existing.userNameLower || "",
    customUsernameLower: record.customUsernameLower || existing.customUsernameLower || "",
    claimedUsernameLower: record.claimedUsernameLower || existing.claimedUsernameLower || "",
    customerPortalUrl: record.customerPortalUrl || existing.customerPortalUrl || "",
    priceId: record.priceId || existing.priceId || "",
    productId: record.productId || existing.productId || "",
    managedPayments:
      record.managedPayments !== undefined
        ? Boolean(record.managedPayments)
        : existing.managedPayments ?? true,
    cancelledAt:
      record.cancelledAt !== undefined ? record.cancelledAt : existing.cancelledAt ?? null,
  };
  if (idx >= 0) {
    list[idx] = merged;
  } else {
    list.push(merged);
  }
  saveStripeSubscriptions(list);
  stripeSubscriptionLookupCache.clear();
  try {
    broadcastToClients({ type: "presence-event", ...getPresenceSnapshot() }, "all");
  } catch {}

  if (USE_SUPABASE_CLOUDSYNC && supabaseHasStripeTable !== false) {
    try {
      await aivenDb.query(
        `INSERT INTO public.stripe_subscriptions (
          subscription_id, checkout_session_id, invoice_id, customer_id,
          email_lower, user_name_lower, custom_username_lower, claimed_username_lower,
          price_id, product_id, tier_name, status, managed_payments,
          customer_portal_url, amount, verified_at, expires_at, cancelled_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
        ON CONFLICT (subscription_id) DO UPDATE SET
          checkout_session_id = EXCLUDED.checkout_session_id,
          invoice_id = EXCLUDED.invoice_id,
          customer_id = EXCLUDED.customer_id,
          email_lower = EXCLUDED.email_lower,
          user_name_lower = EXCLUDED.user_name_lower,
          custom_username_lower = EXCLUDED.custom_username_lower,
          claimed_username_lower = EXCLUDED.claimed_username_lower,
          price_id = EXCLUDED.price_id,
          product_id = EXCLUDED.product_id,
          tier_name = EXCLUDED.tier_name,
          status = EXCLUDED.status,
          managed_payments = EXCLUDED.managed_payments,
          customer_portal_url = EXCLUDED.customer_portal_url,
          amount = EXCLUDED.amount,
          verified_at = EXCLUDED.verified_at,
          expires_at = EXCLUDED.expires_at,
          cancelled_at = EXCLUDED.cancelled_at`,
        [
          merged.subscriptionId,
          merged.checkoutSessionId || "",
          merged.invoiceId || "",
          merged.customerId || "",
          merged.emailLower || "",
          merged.userNameLower || "",
          merged.customUsernameLower || "",
          merged.claimedUsernameLower || "",
          merged.priceId || "",
          merged.productId || "",
          merged.tierName || "Cookie Master",
          merged.status || "active",
          Boolean(merged.managedPayments),
          merged.customerPortalUrl || "",
          Number(merged.amount) || 2,
          new Date(merged.verifiedAt || Date.now()).toISOString(),
          new Date(merged.expiresAt || Date.now()).toISOString(),
          merged.cancelledAt ? new Date(merged.cancelledAt).toISOString() : null,
        ],
      );
      supabaseHasStripeTable = true;
    } catch (e) {
      if (e?.code === "42P01") {
        supabaseHasStripeTable = false;
      } else {
        console.warn("Aiven stripe_subscriptions upsert error:", e?.message);
      }
    }
  }
  return merged;
}

function hydrateStripeRow(match, now = Date.now()) {
  return {
    subscriptionId: String(match.subscription_id),
    checkoutSessionId: String(match.checkout_session_id || ""),
    invoiceId: String(match.invoice_id || ""),
    customerId: String(match.customer_id || ""),
    emailLower: String(match.email_lower || ""),
    userNameLower: String(match.user_name_lower || ""),
    customUsernameLower: String(match.custom_username_lower || ""),
    claimedUsernameLower: String(match.claimed_username_lower || ""),
    priceId: String(match.price_id || ""),
    productId: String(match.product_id || ""),
    tierName: String(match.tier_name || "Cookie Master"),
    status: String(match.status || "active"),
    managedPayments: match.managed_payments !== false,
    customerPortalUrl: String(match.customer_portal_url || ""),
    amount: Number(match.amount) || 2,
    verifiedAt: Date.parse(match.verified_at) || now,
    expiresAt: Date.parse(match.expires_at) || now + STRIPE_SUB_DURATION_MS,
    cancelledAt: match.cancelled_at ? Date.parse(match.cancelled_at) || null : null,
  };
}

async function findActiveStripeSubscription({ query = "", username = "" }) {
  const qLower = String(query || "").trim().toLowerCase();
  const userLower = String(username || "").trim().toLowerCase();
  const now = Date.now();

  const matchesRecord = (r) => {
    if (!isStripeRecordActive(r, now)) return false;
    const subId = String(r.subscriptionId || r.subscription_id || "").toLowerCase();
    const sessId = String(r.checkoutSessionId || r.checkout_session_id || "").toLowerCase();
    const cusId = String(r.customerId || r.customer_id || "").toLowerCase();
    const em = String(r.emailLower || r.email_lower || "").toLowerCase();
    const customUser = String(r.customUsernameLower || r.custom_username_lower || "").toLowerCase();
    const nameUser = String(r.userNameLower || r.user_name_lower || "").toLowerCase();
    const claimedUser = String(r.claimedUsernameLower || r.claimed_username_lower || "").toLowerCase();

    if (qLower && (subId === qLower || sessId === qLower || cusId === qLower || em === qLower)) {
      return true;
    }
    if (
      userLower &&
      (claimedUser === userLower || customUser === userLower || nameUser === userLower)
    ) {
      return true;
    }
    return false;
  };

  const stripeCacheKey = `${qLower}|${userLower}`;
  if (qLower || userLower) {
    const cachedSub = stripeSubscriptionLookupCache.get(stripeCacheKey);
    if (cachedSub !== undefined) {
      return cachedSub && isStripeRecordActive(cachedSub, now) ? cachedSub : null;
    }
  }

  if (USE_SUPABASE_CLOUDSYNC && supabaseHasStripeTable !== false && (qLower || userLower)) {
    try {
      const clauses = [];
      const params = [];
      if (qLower) {
        params.push(qLower);
        const idx = params.length;
        clauses.push(
          `LOWER(subscription_id) = $${idx}`,
          `LOWER(checkout_session_id) = $${idx}`,
          `LOWER(customer_id) = $${idx}`,
          `email_lower = $${idx}`,
        );
      }
      if (userLower) {
        params.push(userLower);
        const idx = params.length;
        clauses.push(
          `claimed_username_lower = $${idx}`,
          `custom_username_lower = $${idx}`,
          `user_name_lower = $${idx}`,
        );
      }
      const res = await aivenDb.query(
        `SELECT subscription_id, checkout_session_id, invoice_id, customer_id, email_lower, user_name_lower, custom_username_lower, claimed_username_lower, price_id, product_id, tier_name, status, managed_payments, customer_portal_url, amount, verified_at, expires_at, cancelled_at FROM public.stripe_subscriptions WHERE ${clauses.join(" OR ")} ORDER BY expires_at DESC LIMIT 8`,
        params,
      );
      supabaseHasStripeTable = true;
      const match = (res.rows || []).find(matchesRecord);
      const hydrated = match ? hydrateStripeRow(match, now) : null;
      stripeSubscriptionLookupCache.set(stripeCacheKey, hydrated);
      if (hydrated) return hydrated;
    } catch (e) {
      if (e?.code === "42P01") {
        supabaseHasStripeTable = false;
      }
    }
  }

  const localMatches = loadStripeSubscriptions()
    .filter(matchesRecord)
    .sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
  const foundLocal = localMatches[0] || null;
  if (qLower || userLower) {
    stripeSubscriptionLookupCache.set(stripeCacheKey, foundLocal);
  }
  return foundLocal;
}

async function callStripeApi(apiPath, { method = "GET", params = null, stripeVersion = STRIPE_API_VERSION } = {}) {
  if (!STRIPE_SECRET_KEY) return { ok: false, status: 503, data: null, error: "STRIPE_SECRET_KEY not set" };
  try {
    const headers = {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    };
    if (stripeVersion) {
      headers["Stripe-Version"] = stripeVersion;
    }
    const init = { method, headers };
    if (params && method !== "GET" && method !== "HEAD") {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params).toString();
    }
    const res = await fetch(`https://api.stripe.com/v1${apiPath}`, init);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: data?.error?.message || `Stripe API error (${res.status})`,
      };
    }
    return { ok: true, status: res.status, data, error: "" };
  } catch (e) {
    return { ok: false, status: 500, data: null, error: e?.message || "Stripe API request failed" };
  }
}

async function createStripeManagedCheckoutSession({ origin, username = "" }) {
  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_ID || !origin) {
    return {
      ok: false,
      error: "Stripe Checkout requires STRIPE_SECRET_KEY and STRIPE_PRICE_ID.",
    };
  }

  const buildParams = (withManagedPayments) => {
    const p = new URLSearchParams();
    p.set("mode", "subscription");
    p.set("line_items[0][price]", STRIPE_PRICE_ID);
    p.set("line_items[0][quantity]", "1");
    p.set("success_url", `${origin}/?cookie_master=success&session_id={CHECKOUT_SESSION_ID}`);
    p.set("cancel_url", `${origin}/?cookie_master=cancelled`);
    if (withManagedPayments) {
      p.set("managed_payments[enabled]", "true");
    }
    const cleanUser = String(username || "").trim();
    if (cleanUser && cleanUser !== "guest") {
      p.set("client_reference_id", cleanUser);
      p.set("metadata[username]", cleanUser);
      p.set("subscription_data[metadata][username]", cleanUser);
    }
    return p;
  };

  let result = await callStripeApi("/checkout/sessions", {
    method: "POST",
    params: buildParams(true),
  });

  // If account's default API version predates managed_payments, retry with a version that supports it
  if (
    !result.ok &&
    !STRIPE_API_VERSION &&
    /managed_payments|unknown parameter/i.test(result.error || "")
  ) {
    result = await callStripeApi("/checkout/sessions", {
      method: "POST",
      params: buildParams(true),
      stripeVersion: "2026-04-22.dahlia",
    });
  }

  if (!result.ok || !result.data?.url) {
    return {
      ok: false,
      error: result.error || "Failed to create Stripe Managed Payments Checkout Session.",
    };
  }

  return {
    ok: true,
    checkoutUrl: String(result.data.url),
    sessionId: String(result.data.id || ""),
  };
}

async function resolveStripeCustomerDetails(customerRef) {
  if (!customerRef) return { customerId: "", emailLower: "", userNameLower: "" };
  if (typeof customerRef === "object") {
    return {
      customerId: String(customerRef.id || "").trim(),
      emailLower: String(customerRef.email || "").trim().toLowerCase(),
      userNameLower: String(customerRef.name || "").trim().toLowerCase(),
    };
  }
  const customerId = String(customerRef).trim();
  if (!customerId || !STRIPE_SECRET_KEY) {
    return { customerId, emailLower: "", userNameLower: "" };
  }
  const res = await callStripeApi(`/customers/${encodeURIComponent(customerId)}`);
  if (!res.ok || !res.data || res.data.deleted) {
    return { customerId, emailLower: "", userNameLower: "" };
  }
  return {
    customerId,
    emailLower: String(res.data.email || "").trim().toLowerCase(),
    userNameLower: String(res.data.name || "").trim().toLowerCase(),
  };
}

async function upsertStripeSubscriptionFromApiObj(subObj, extra = {}) {
  if (!subObj || typeof subObj !== "object") return null;
  const subId = String(subObj.id || extra.subscriptionId || "").trim();
  if (!subId) return null;

  const firstItem = Array.isArray(subObj.items?.data) ? subObj.items.data[0] : null;
  const priceObj = firstItem?.price || subObj.plan || {};
  const priceId = String(priceObj?.id || extra.priceId || "").trim();
  const productId = String(
    typeof priceObj?.product === "object" ? priceObj.product?.id : priceObj?.product || extra.productId || "",
  ).trim();
  if (!matchesStripeProductFilters({ priceId, productId })) return null;

  const custInfo = await resolveStripeCustomerDetails(subObj.customer);
  const meta = subObj.metadata && typeof subObj.metadata === "object" ? subObj.metadata : {};
  const customUser = extractPossibleUsername(
    extra.customUsername || meta.username || meta.user || meta.cloudsync_username || "",
  );
  const claimedLower = extra.claimedUsername
    ? String(extra.claimedUsername).trim().toLowerCase()
    : "";

  const now = Date.now();
  const rawStatus = String(subObj.status || "active").trim().toLowerCase();
  const normalizedStatus = subObj.cancel_at_period_end && rawStatus === "active" ? "cancelled" : rawStatus;
  const expiresAt = computeStripeSubExpiresAt(subObj, now);
  const unitCents = Number(priceObj?.unit_amount || 0);

  const record = await persistStripeSubscriptionRecord({
    subscriptionId: subId,
    checkoutSessionId: extra.checkoutSessionId || "",
    invoiceId:
      typeof subObj.latest_invoice === "string"
        ? subObj.latest_invoice
        : String(subObj.latest_invoice?.id || extra.invoiceId || ""),
    customerId: custInfo.customerId || extra.customerId || "",
    emailLower: (extra.emailLower || custInfo.emailLower || "").trim().toLowerCase(),
    userNameLower: (extra.userNameLower || custInfo.userNameLower || "").trim().toLowerCase(),
    customUsernameLower: customUser || claimedLower,
    claimedUsernameLower: claimedLower || customUser,
    priceId,
    productId,
    tierName: String(
      priceObj?.nickname || STRIPE_TIER_NAME || "Cookie Master",
    ),
    status: normalizedStatus,
    managedPayments: Boolean(subObj?.managed_payments?.enabled ?? extra.managedPayments ?? true),
    amount: Number(extra.amount) || (unitCents > 0 ? Number((unitCents / 100).toFixed(2)) : 2),
    verifiedAt: now,
    expiresAt,
    cancelledAt: subObj.canceled_at
      ? subObj.canceled_at * 1000
      : subObj.cancel_at_period_end
        ? now
        : null,
  });

  return isStripeRecordActive(record, now) ? record : null;
}

async function upsertStripeCheckoutSessionObj(sessionObj, extra = {}) {
  if (!sessionObj || typeof sessionObj !== "object") return null;
  const paidOrComplete =
    sessionObj.payment_status === "paid" ||
    sessionObj.payment_status === "no_payment_required" ||
    sessionObj.status === "complete";
  if (!paidOrComplete) return null;

  const sessionId = String(sessionObj.id || "").trim();
  const customUser = extractPossibleUsername(
    sessionObj.client_reference_id ||
      sessionObj.metadata?.username ||
      sessionObj.metadata?.user ||
      extra.claimUsername ||
      "",
  );
  const emailLower = String(
    sessionObj.customer_details?.email || sessionObj.customer_email || "",
  )
    .trim()
    .toLowerCase();
  const userNameLower = String(sessionObj.customer_details?.name || "").trim().toLowerCase();
  const amountTotal = Number(sessionObj.amount_total || 0);
  const amount = amountTotal > 0 ? Number((amountTotal / 100).toFixed(2)) : 2;
  const managedPayments = Boolean(sessionObj?.managed_payments?.enabled ?? true);

  if (sessionObj.subscription) {
    if (typeof sessionObj.subscription === "object") {
      return await upsertStripeSubscriptionFromApiObj(sessionObj.subscription, {
        checkoutSessionId: sessionId,
        customUsername: customUser,
        claimedUsername: extra.claimUsername || customUser,
        emailLower,
        userNameLower,
        amount,
        managedPayments,
      });
    }
    if (STRIPE_SECRET_KEY) {
      const subRes = await callStripeApi(
        `/subscriptions/${encodeURIComponent(String(sessionObj.subscription))}?expand[]=items.data.price&expand[]=customer`,
      );
      if (subRes.ok && subRes.data) {
        return await upsertStripeSubscriptionFromApiObj(subRes.data, {
          checkoutSessionId: sessionId,
          customUsername: customUser,
          claimedUsername: extra.claimUsername || customUser,
          emailLower,
          userNameLower,
          amount,
          managedPayments,
        });
      }
    }
  }

  const now = Date.now();
  const subId = sessionObj.subscription
    ? String(sessionObj.subscription)
    : sessionId;
  if (!subId) return null;

  const record = await persistStripeSubscriptionRecord({
    subscriptionId: subId,
    checkoutSessionId: sessionId,
    invoiceId: typeof sessionObj.invoice === "string" ? sessionObj.invoice : "",
    customerId: typeof sessionObj.customer === "string" ? sessionObj.customer : String(sessionObj.customer?.id || ""),
    emailLower,
    userNameLower,
    customUsernameLower: customUser,
    claimedUsernameLower: (extra.claimUsername || customUser || "").toLowerCase(),
    priceId: STRIPE_PRICE_ID,
    productId: STRIPE_PRODUCT_ID,
    tierName: STRIPE_TIER_NAME || "Cookie Master",
    status: "active",
    managedPayments,
    amount,
    verifiedAt: now,
    expiresAt: now + STRIPE_SUB_DURATION_MS,
    cancelledAt: null,
  });
  return isStripeRecordActive(record, now) ? record : null;
}

async function lookupStripeSubscriptionRemote({ query = "", claimUsername = "" }) {
  const clean = String(query || "").trim();
  if (!clean || !STRIPE_SECRET_KEY) return null;

  if (clean.startsWith("cs_")) {
    const res = await callStripeApi(
      `/checkout/sessions/${encodeURIComponent(clean)}?expand[]=subscription&expand[]=customer`,
    );
    if (res.ok && res.data) {
      return await upsertStripeCheckoutSessionObj(res.data, { claimUsername });
    }
    return null;
  }

  if (clean.startsWith("sub_")) {
    const res = await callStripeApi(
      `/subscriptions/${encodeURIComponent(clean)}?expand[]=items.data.price&expand[]=customer`,
    );
    if (res.ok && res.data) {
      return await upsertStripeSubscriptionFromApiObj(res.data, {
        claimedUsername: claimUsername,
      });
    }
    return null;
  }

  if (clean.startsWith("cus_")) {
    const subsRes = await callStripeApi(
      `/subscriptions?customer=${encodeURIComponent(clean)}&status=all&limit=10&expand[]=data.items.data.price`,
    );
    const rows = Array.isArray(subsRes.data?.data) ? subsRes.data.data : [];
    for (const row of rows) {
      const saved = await upsertStripeSubscriptionFromApiObj(row, {
        claimedUsername: claimUsername,
      });
      if (saved) return saved;
    }
    return null;
  }

  if (clean.includes("@")) {
    const custRes = await callStripeApi(
      `/customers?email=${encodeURIComponent(clean.toLowerCase())}&limit=5`,
    );
    const customers = Array.isArray(custRes.data?.data) ? custRes.data.data : [];
    for (const c of customers) {
      const subsRes = await callStripeApi(
        `/subscriptions?customer=${encodeURIComponent(c.id)}&status=all&limit=10&expand[]=data.items.data.price`,
      );
      const rows = Array.isArray(subsRes.data?.data) ? subsRes.data.data : [];
      for (const row of rows) {
        const saved = await upsertStripeSubscriptionFromApiObj(row, {
          claimedUsername: claimUsername,
          emailLower: c.email || clean,
          userNameLower: c.name || "",
        });
        if (saved) return saved;
      }
    }
  }

  return null;
}

function isValidStripeSignature(req) {
  if (!STRIPE_WEBHOOK_SECRET) return false;
  const sigHeader = String(req.get("Stripe-Signature") || "").trim();
  if (!sigHeader) return false;

  let timestamp = "";
  const v1Signatures = [];
  for (const part of sigHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") timestamp = v;
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) v1Signatures.push(v.toLowerCase());
  }
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || tsNum <= 0 || v1Signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) return false;

  const rawBuf = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}), "utf8");
  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), rawBuf]);
  const expectedDigest = crypto
    .createHmac("sha256", STRIPE_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest();

  return v1Signatures.some((sigHex) => {
    const incomingDigest = Buffer.from(sigHex, "hex");
    return (
      expectedDigest.length === incomingDigest.length &&
      crypto.timingSafeEqual(expectedDigest, incomingDigest)
    );
  });
}

app.get("/api/cookie-master/config", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const supportsSessionCheckout = Boolean(STRIPE_SECRET_KEY && STRIPE_PRICE_ID);
  res.json({
    configured: supportsSessionCheckout || Boolean(STRIPE_CHECKOUT_URL),
    provider: "stripe_managed_payments",
    supportsSessionCheckout,
    checkoutUrl: STRIPE_CHECKOUT_URL,
    billingUrl: STRIPE_PORTAL_URL,
    hasWebhookVerification: Boolean(STRIPE_WEBHOOK_SECRET),
    hasApiKey: Boolean(STRIPE_SECRET_KEY),
    testMode: STRIPE_TEST_MODE,
    priceMonthly: 2,
    dailyCoins: 1000,
    tierName: STRIPE_TIER_NAME || "Cookie Master",
  });
});

app.get("/api/cookie-master/checkout", async (req, res) => {
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const origin = getSafeRequestOrigin(req);
    if (STRIPE_SECRET_KEY && STRIPE_PRICE_ID && origin) {
      const session = await createStripeManagedCheckoutSession({
        origin,
        username: authUser?.username || "",
      });
      if (session.ok && session.checkoutUrl) {
        return res.redirect(303, session.checkoutUrl);
      }
      return res
        .status(502)
        .type("text/plain")
        .send(session.error || "Could not start Stripe Managed Payments checkout.");
    }

    if (STRIPE_CHECKOUT_URL) {
      const u = new URL(STRIPE_CHECKOUT_URL);
      if (authUser?.username) {
        u.searchParams.set("client_reference_id", authUser.username);
      }
      return res.redirect(303, u.toString());
    }

    return res
      .status(503)
      .type("text/plain")
      .send("Stripe Managed Payments is not configured yet (set STRIPE_SECRET_KEY & STRIPE_PRICE_ID or STRIPE_PAYMENT_LINK_URL).");
  } catch (err) {
    return res
      .status(500)
      .type("text/plain")
      .send(err?.message || "Failed to start Stripe checkout.");
  }
});

app.post("/api/cookie-master/checkout", async (req, res) => {
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const origin = getSafeRequestOrigin(req);
    if (STRIPE_SECRET_KEY && STRIPE_PRICE_ID && origin) {
      const session = await createStripeManagedCheckoutSession({
        origin,
        username: authUser?.username || "",
      });
      if (session.ok && session.checkoutUrl) {
        return res.json({
          success: true,
          checkoutUrl: session.checkoutUrl,
          sessionId: session.sessionId,
        });
      }
      return res.status(502).json({
        success: false,
        error: session.error || "Failed to create Stripe Managed Payments checkout session.",
      });
    }

    if (STRIPE_CHECKOUT_URL) {
      const u = new URL(STRIPE_CHECKOUT_URL);
      if (authUser?.username) {
        u.searchParams.set("client_reference_id", authUser.username);
      }
      return res.json({ success: true, checkoutUrl: u.toString(), sessionId: "" });
    }

    return res.status(503).json({
      success: false,
      error: "Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID (or STRIPE_PAYMENT_LINK_URL) on the server.",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err?.message || "Failed to create Stripe checkout session.",
    });
  }
});

async function handleStripeWebhook(req, res) {
  try {
    if (!STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send("STRIPE_WEBHOOK_SECRET not configured");
    }
    if (!isValidStripeSignature(req)) {
      return res.status(401).send("Unauthorized: Invalid Stripe-Signature");
    }

    const payload =
      req.body && typeof req.body === "object"
        ? req.body
        : Buffer.isBuffer(req.rawBody)
          ? JSON.parse(req.rawBody.toString("utf8"))
          : null;
    if (!payload || typeof payload !== "object" || !payload.type || !payload.data?.object) {
      return res.status(400).send("Invalid Stripe webhook payload");
    }

    const eventType = String(payload.type || "").trim();
    const obj = payload.data.object || {};
    const now = Date.now();

    if (
      eventType === "checkout.session.completed" ||
      eventType === "checkout.session.async_payment_succeeded"
    ) {
      await upsertStripeCheckoutSessionObj(obj);
      return res.status(200).send(`Recorded Stripe ${eventType}`);
    }

    if (eventType === "checkout.session.async_payment_failed") {
      const subId = obj.subscription ? String(obj.subscription) : String(obj.id || "");
      if (subId) {
        const existing = loadStripeSubscriptions().find(
          (r) => String(r.subscriptionId || "") === subId,
        );
        if (existing) {
          await persistStripeSubscriptionRecord({
            ...existing,
            status: "past_due",
            expiresAt: Math.min(existing.expiresAt || now, now + STRIPE_RENEWAL_GRACE_MS),
          });
        }
      }
      return res.status(200).send(`Processed Stripe ${eventType}`);
    }

    if (
      eventType === "customer.subscription.created" ||
      eventType === "customer.subscription.updated" ||
      eventType === "customer.subscription.deleted" ||
      eventType === "customer.subscription.paused" ||
      eventType === "customer.subscription.resumed"
    ) {
      await upsertStripeSubscriptionFromApiObj(obj);
      return res.status(200).send(`Recorded Stripe ${eventType}`);
    }

    if (
      eventType === "invoice.paid" ||
      eventType === "invoice.payment_succeeded" ||
      eventType === "invoice.payment_failed"
    ) {
      const subRef =
        obj.subscription ||
        obj.parent?.subscription_details?.subscription ||
        "";
      const subId = typeof subRef === "string" ? subRef : String(subRef?.id || "");
      const isPaid = eventType !== "invoice.payment_failed";
      if (subId && STRIPE_SECRET_KEY) {
        const subRes = await callStripeApi(
          `/subscriptions/${encodeURIComponent(subId)}?expand[]=items.data.price&expand[]=customer`,
        );
        if (subRes.ok && subRes.data) {
          await upsertStripeSubscriptionFromApiObj(subRes.data, {
            invoiceId: String(obj.id || ""),
          });
          return res.status(200).send(`Synced Stripe ${eventType}`);
        }
      }
      if (subId) {
        const existing = loadStripeSubscriptions().find(
          (r) => String(r.subscriptionId || "") === subId,
        );
        const amountCents = Number(obj.amount_paid ?? obj.amount_due ?? 0);
        const custId = typeof obj.customer === "string" ? obj.customer : String(obj.customer?.id || "");
        await persistStripeSubscriptionRecord({
          ...(existing || {}),
          subscriptionId: subId,
          invoiceId: String(obj.id || existing?.invoiceId || ""),
          customerId: custId || existing?.customerId || "",
          emailLower: String(obj.customer_email || existing?.emailLower || "").trim().toLowerCase(),
          userNameLower: String(obj.customer_name || existing?.userNameLower || "").trim().toLowerCase(),
          tierName: existing?.tierName || STRIPE_TIER_NAME || "Cookie Master",
          status: isPaid ? "active" : "past_due",
          amount: amountCents > 0 ? Number((amountCents / 100).toFixed(2)) : existing?.amount || 2,
          verifiedAt: now,
          expiresAt: isPaid
            ? now + STRIPE_SUB_DURATION_MS
            : Math.max(existing?.expiresAt || 0, now + STRIPE_RENEWAL_GRACE_MS),
        });
      }
      return res.status(200).send(`Recorded Stripe ${eventType}`);
    }

    if (eventType === "charge.refunded" || eventType === "charge.dispute.created") {
      const custId = typeof obj.customer === "string" ? obj.customer : String(obj.customer?.id || "");
      const invId = typeof obj.invoice === "string" ? obj.invoice : String(obj.invoice?.id || "");
      const statusLabel = eventType === "charge.dispute.created" ? "disputed" : "refunded";
      for (const rec of loadStripeSubscriptions()) {
        if (
          (custId && String(rec.customerId || "") === custId) ||
          (invId && String(rec.invoiceId || "") === invId)
        ) {
          await persistStripeSubscriptionRecord({
            ...rec,
            status: statusLabel,
            expiresAt: now,
          });
        }
      }
      return res.status(200).send(`Processed Stripe ${eventType}`);
    }

    return res.status(200).send(`Ignored Stripe event: ${eventType || "unknown"}`);
  } catch (err) {
    console.error("Stripe webhook error:", err);
    return res.status(500).send("Webhook processing error");
  }
}

app.post("/api/stripe/webhook", handleStripeWebhook);
app.post("/api/cookie-master/webhook", handleStripeWebhook);

app.get("/api/cookie-master/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const tx = String(req.query?.tx || req.query?.session_id || "").trim();
    let match = await findActiveStripeSubscription({
      query: tx,
      username: authUser?.username || "",
    });
    if (!match && tx) {
      match = await lookupStripeSubscriptionRemote({
        query: tx,
        claimUsername: authUser?.username || "",
      });
    }
    if (!match) {
      return res.json({ success: true, active: false });
    }
    return res.json({
      success: true,
      active: true,
      subscriptionId: match.subscriptionId,
      transactionId: match.subscriptionId,
      checkoutSessionId: match.checkoutSessionId || "",
      customerId: match.customerId || "",
      email: match.emailLower || "",
      tierName: match.tierName || "Cookie Master",
      status: match.status || "active",
      managedPayments: match.managedPayments !== false,
      expiresAt: match.expiresAt,
      cancelledAt: match.cancelledAt ? new Date(match.cancelledAt).toISOString() : null,
      canManageBilling: Boolean(
        STRIPE_PORTAL_URL ||
          match.customerPortalUrl ||
          (STRIPE_SECRET_KEY && String(match.customerId || "").startsWith("cus_")),
      ),
    });
  } catch (err) {
    return res.status(500).json({ success: false, active: false, error: err?.message });
  }
});

app.post("/api/cookie-master/buy-with-coins", async (req, res) => {
  await ensureChatMetaReadyAsync();
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const rateKey = authUser?.username ? authUser.username.toLowerCase() : String(req.ip || "anon");
    const prevBuyAt = buyMasterLastAt.get(rateKey) || 0;
    if (Date.now() - prevBuyAt < 5000) {
      return res.status(429).json({ success: false, error: "Please wait a moment before purchasing again" });
    }
    buyMasterLastAt.set(rateKey, Date.now());
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const subId = `coins_cm_${now}_${Math.random().toString(36).slice(2, 8)}`;

    if (authUser?.username) {
      const userLower = authUser.username.toLowerCase();
      const existing = await findActiveStripeSubscription({ username: authUser.username }).catch(() => null);
      const baseExpiry = existing && existing.expiresAt > now ? existing.expiresAt : now;
      const nextExpiresAt = baseExpiry + THIRTY_DAYS_MS;

      await persistStripeSubscriptionRecord({
        subscriptionId: subId,
        checkoutSessionId: subId,
        invoiceId: subId,
        customerId: `coins_${userLower}`,
        emailLower: "",
        userNameLower: userLower,
        customUsernameLower: userLower,
        claimedUsernameLower: userLower,
        priceId: "coins_5000_monthly",
        productId: "cookie_master_coins",
        tierName: "Cookie Master (Coins)",
        status: "active",
        managedPayments: false,
        customerPortalUrl: "",
        amount: 5000,
        verifiedAt: now,
        expiresAt: nextExpiresAt,
        cancelledAt: null,
      });

      return res.json({
        success: true,
        active: true,
        subscriptionId: subId,
        expiresAt: nextExpiresAt,
      });
    }

    return res.json({
      success: true,
      active: true,
      subscriptionId: subId,
      expiresAt: now + THIRTY_DAYS_MS,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || "Failed to activate Cookie Master" });
  }
});

app.post("/api/cookie-master/verify", async (req, res) => {
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const query = String(
      req.body?.emailOrCode ||
        req.body?.sessionId ||
        req.body?.subscriptionId ||
        "",
    ).trim();
    if (!query && !authUser?.username) {
      return res.status(400).json({
        success: false,
        active: false,
        error: "Enter your Stripe billing email, Subscription ID (sub_...), or Checkout Session ID (cs_...), or sign in to CloudSync.",
      });
    }

    let match = await findActiveStripeSubscription({
      query,
      username: authUser?.username || "",
    });
    if (!match && query) {
      match = await lookupStripeSubscriptionRemote({
        query,
        claimUsername: authUser?.username || "",
      });
    }

    if (!match) {
      if (!STRIPE_WEBHOOK_SECRET && !STRIPE_SECRET_KEY) {
        return res.status(503).json({
          success: false,
          active: false,
          error: "Server is missing STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY.",
        });
      }
      return res.status(404).json({
        success: false,
        active: false,
        error:
          "No active Stripe Managed Payments Cookie Master subscription found yet. Complete checkout and wait a moment for confirmation.",
      });
    }

    if (authUser?.username && match.subscriptionId) {
      await persistStripeSubscriptionRecord({
        ...match,
        claimedUsernameLower: authUser.username.toLowerCase(),
      }).catch(() => {});
    }

    return res.json({
      success: true,
      active: true,
      subscriptionId: match.subscriptionId,
      transactionId: match.subscriptionId,
      checkoutSessionId: match.checkoutSessionId || "",
      customerId: match.customerId || "",
      email: match.emailLower || "",
      tierName: match.tierName || "Cookie Master",
      status: match.status || "active",
      managedPayments: match.managedPayments !== false,
      expiresAt: match.expiresAt,
      cancelledAt: match.cancelledAt ? new Date(match.cancelledAt).toISOString() : null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      active: false,
      error: err?.message || "Failed to verify Stripe Managed Payments membership.",
    });
  }
});

app.post("/api/cookie-master/portal", async (req, res) => {
  try {
    const authUser = await getAuthenticatedCloudSyncUser(req);
    const subHint = String(req.body?.subscriptionId || req.body?.tx || "").trim();
    const match = await findActiveStripeSubscription({
      query: subHint,
      username: authUser?.username || "",
    });

    const callerOwnsRecord =
      Boolean(match) &&
      (!match.claimedUsernameLower ||
        (authUser?.username && authUser.username.toLowerCase() === match.claimedUsernameLower));

    let portalUrl = STRIPE_PORTAL_URL;
    if (callerOwnsRecord && match) {
      if (STRIPE_SECRET_KEY && String(match.customerId || "").startsWith("cus_")) {
        const origin = getSafeRequestOrigin(req);
        const portalParams = new URLSearchParams();
        portalParams.set("customer", match.customerId);
        if (origin) portalParams.set("return_url", `${origin}/`);
        const portalRes = await callStripeApi("/billing_portal/sessions", {
          method: "POST",
          params: portalParams,
        });
        const freshUrl = String(portalRes.data?.url || "").trim();
        if (portalRes.ok && freshUrl.startsWith("https://")) {
          portalUrl = freshUrl;
        }
      } else if (match.customerPortalUrl && String(match.customerPortalUrl).startsWith("https://")) {
        portalUrl = match.customerPortalUrl;
      }
    }

    if (!portalUrl) {
      return res.status(404).json({
        success: false,
        error: "Stripe Customer Portal is not configured yet (set STRIPE_SECRET_KEY or STRIPE_PORTAL_URL).",
      });
    }

    return res.json({ success: true, portalUrl });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err?.message || "Failed to get Stripe Customer Portal link.",
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
process.on("unhandledRejection", (reason) => {
  console.warn("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (kept alive):", err);
});

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
