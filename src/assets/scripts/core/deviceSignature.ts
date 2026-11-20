import FingerprintJS from "@fingerprintjs/fingerprintjs";

export const DEVICE_STORAGE_TOKEN_KEY = "sunshine_device_storage_token_v1";
export const DEVICE_IDB_NAME = "sunshine_device_sig_db";
const DEVICE_IDB_STORE = "tokens";
const DEVICE_IDB_KEY = "device_token";

export interface DeviceSignature {
  fingerprint_id: string;
  storage_token: string;
}

let cachedSignaturePromise: Promise<DeviceSignature> | null = null;
let cachedVisitorId: string | null = null;
let cachedStorageToken: string | null = null;

function generateUuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function readIdbToken(): Promise<string | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: string | null) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    const timer = window.setTimeout(() => finish(null), 1200);
    try {
      const req = indexedDB.open(DEVICE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DEVICE_IDB_STORE)) {
          db.createObjectStore(DEVICE_IDB_STORE);
        }
      };
      req.onerror = () => {
        window.clearTimeout(timer);
        finish(null);
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(DEVICE_IDB_STORE, "readonly");
          const store = tx.objectStore(DEVICE_IDB_STORE);
          const getReq = store.get(DEVICE_IDB_KEY);
          getReq.onsuccess = () => {
            window.clearTimeout(timer);
            const val = typeof getReq.result === "string" && getReq.result.trim() ? getReq.result.trim() : null;
            try {
              db.close();
            } catch {}
            finish(val);
          };
          getReq.onerror = () => {
            window.clearTimeout(timer);
            try {
              db.close();
            } catch {}
            finish(null);
          };
        } catch {
          window.clearTimeout(timer);
          try {
            db.close();
          } catch {}
          finish(null);
        }
      };
    } catch {
      window.clearTimeout(timer);
      finish(null);
    }
  });
}

function writeIdbToken(token: string): Promise<void> {
  if (typeof indexedDB === "undefined" || !token) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = window.setTimeout(finish, 1200);
    try {
      const req = indexedDB.open(DEVICE_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DEVICE_IDB_STORE)) {
          db.createObjectStore(DEVICE_IDB_STORE);
        }
      };
      req.onerror = () => {
        window.clearTimeout(timer);
        finish();
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(DEVICE_IDB_STORE, "readwrite");
          const store = tx.objectStore(DEVICE_IDB_STORE);
          store.put(token, DEVICE_IDB_KEY);
          tx.oncomplete = () => {
            window.clearTimeout(timer);
            try {
              db.close();
            } catch {}
            finish();
          };
          tx.onerror = () => {
            window.clearTimeout(timer);
            try {
              db.close();
            } catch {}
            finish();
          };
        } catch {
          window.clearTimeout(timer);
          try {
            db.close();
          } catch {}
          finish();
        }
      };
    } catch {
      window.clearTimeout(timer);
      finish();
    }
  });
}

async function resolvePersistentStorageToken(): Promise<string> {
  let lsToken: string | null = null;
  let ssToken: string | null = null;
  try {
    lsToken = localStorage.getItem(DEVICE_STORAGE_TOKEN_KEY)?.trim() || null;
  } catch {}
  try {
    ssToken = sessionStorage.getItem(DEVICE_STORAGE_TOKEN_KEY)?.trim() || null;
  } catch {}
  const idbToken = await readIdbToken();

  const resolved = lsToken || ssToken || idbToken || cachedStorageToken || generateUuidV4();
  cachedStorageToken = resolved;

  try {
    if (localStorage.getItem(DEVICE_STORAGE_TOKEN_KEY) !== resolved) {
      localStorage.setItem(DEVICE_STORAGE_TOKEN_KEY, resolved);
    }
  } catch {}
  try {
    if (sessionStorage.getItem(DEVICE_STORAGE_TOKEN_KEY) !== resolved) {
      sessionStorage.setItem(DEVICE_STORAGE_TOKEN_KEY, resolved);
    }
  } catch {}
  if (idbToken !== resolved) {
    void writeIdbToken(resolved);
  }
  return resolved;
}

function computeFallbackFingerprint(): string {
  const parts = [
    navigator.userAgent || "",
    navigator.language || "",
    String(navigator.hardwareConcurrency || 0),
    String((navigator as unknown as { deviceMemory?: number }).deviceMemory || 0),
    `${screen?.width || 0}x${screen?.height || 0}x${screen?.colorDepth || 0}`,
    Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || "",
  ];
  const raw = parts.join("|");
  let h1 = 0xdeadbeef ^ raw.length;
  let h2 = 0x41c6ce57 ^ raw.length;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `fp_${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

async function resolveVisitorId(): Promise<string> {
  if (cachedVisitorId) return cachedVisitorId;
  try {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    if (result?.visitorId) {
      cachedVisitorId = result.visitorId;
      return cachedVisitorId;
    }
  } catch {}
  cachedVisitorId = computeFallbackFingerprint();
  return cachedVisitorId;
}

export async function getDeviceSignature(): Promise<DeviceSignature> {
  if (!cachedSignaturePromise) {
    cachedSignaturePromise = (async () => {
      const [fingerprint_id, storage_token] = await Promise.all([
        resolveVisitorId(),
        resolvePersistentStorageToken(),
      ]);
      return { fingerprint_id, storage_token };
    })();
  }
  const sig = await cachedSignaturePromise;
  // Re-heal storage token across localStorage/sessionStorage/IndexedDB if any single store was cleared
  const freshToken = await resolvePersistentStorageToken();
  return {
    fingerprint_id: sig.fingerprint_id,
    storage_token: freshToken,
  };
}
