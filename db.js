import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const { Pool } = pg;

const rawUrl = (process.env.AIVEN_DATABASE_URL || "").trim();
export const isAivenConfigured = Boolean(rawUrl);

function buildPoolConfig(connectionUrl) {
  if (!connectionUrl) {
    return {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }
  try {
    const parsed = new URL(connectionUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, "") || "defaultdb",
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    };
  } catch {
    return {
      connectionString: connectionUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    };
  }
}

export const pool = isAivenConfigured ? new Pool(buildPoolConfig(rawUrl)) : null;

if (pool) {
  pool.on("error", (err) => {
    console.warn("[aiven-db] Idle client error (handled):", err?.message || err);
  });

  // Lightweight background keep-alive every 3 hours so Aiven Free does not power off during quiet periods
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
  const keepAliveTimer = setInterval(async () => {
    try {
      await pool.query("SELECT 1;");
    } catch (err) {
      console.warn("[aiven-db] Keep-alive query warning:", err?.message || err);
    }
  }, THREE_HOURS_MS);
  if (typeof keepAliveTimer.unref === "function") {
    keepAliveTimer.unref();
  }
}

export async function query(text, params = []) {
  if (!pool) {
    throw new Error("AIVEN_DATABASE_URL is not configured");
  }
  return pool.query(text, params);
}

export default {
  pool,
  query,
  isAivenConfigured,
};
