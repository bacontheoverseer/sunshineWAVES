export const OXIUM_PARTNERS_KV_KEY = "oxium_partners_v1";
export const OXIUM_SYNC_KV_KEY = "oxium_sync_v1";
export const OXIUM_PROMOS_KV_KEY = "oxium_promos_v1";

const VALID_FEATURES = new Set(["profile", "bookmarks", "saves", "settings"]);

export function escapeHtml(input) {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

export function normalizeOxiumSlug(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function sanitizeOxiumColor(raw, fallback = "#6366f1") {
  const clean = String(raw || "").trim();
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(clean) ? clean : fallback;
}

export function sanitizeOxiumUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const parsed = new URL(s);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.toString().slice(0, 400);
  } catch {
    return "";
  }
}

export function sanitizeOxiumOrigins(rawInput) {
  const list = Array.isArray(rawInput)
    ? rawInput
    : String(rawInput || "")
        .split(/[\n,]+/)
        .map((s) => s.trim());
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item) continue;
    try {
      const candidate = /^https?:\/\//i.test(item) ? item : `https://${item}`;
      const u = new URL(candidate);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!seen.has(u.origin)) {
        seen.add(u.origin);
        out.push(u.origin);
      }
      if (out.length >= 16) break;
    } catch {}
  }
  return out;
}

export function sanitizeOxiumLinks(rawLinks, fallbackOrigins = []) {
  const out = [];
  const seen = new Set();
  const pushLink = (label, url) => {
    const safeUrl = sanitizeOxiumUrl(url);
    if (!safeUrl || seen.has(safeUrl)) return;
    seen.add(safeUrl);
    const cleanLabel =
      String(label || "").trim().slice(0, 48) ||
      (() => {
        try {
          return new URL(safeUrl).hostname;
        } catch {
          return "mirror link";
        }
      })();
    out.push({ label: cleanLabel, url: safeUrl });
  };

  if (Array.isArray(rawLinks)) {
    for (const item of rawLinks) {
      if (typeof item === "string") pushLink("", item);
      else if (item && typeof item === "object") pushLink(item.label, item.url);
      if (out.length >= 10) break;
    }
  } else if (typeof rawLinks === "string") {
    for (const line of rawLinks.split(/[\n,]+/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const pipeIdx = trimmed.indexOf("|");
      if (pipeIdx > 0) {
        pushLink(trimmed.slice(0, pipeIdx), trimmed.slice(pipeIdx + 1));
      } else {
        pushLink("", trimmed);
      }
      if (out.length >= 10) break;
    }
  }

  if (out.length === 0 && Array.isArray(fallbackOrigins)) {
    for (const orig of fallbackOrigins.slice(0, 5)) {
      pushLink("", orig);
    }
  }
  return out;
}

export function sanitizeOxiumFeatures(raw) {
  const arr = Array.isArray(raw) ? raw : ["profile", "bookmarks", "saves"];
  const clean = [];
  for (const f of arr) {
    const k = String(f || "").trim().toLowerCase();
    if (VALID_FEATURES.has(k) && !clean.includes(k)) clean.push(k);
  }
  return clean.length > 0 ? clean : ["profile", "saves"];
}

export function sanitizeOxiumSyncKeys(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : String(raw || "")
        .split(/[\n,]+/)
        .map((s) => s.trim());
  const out = [];
  for (const item of arr) {
    const clean = String(item || "").trim().slice(0, 64);
    if (clean && /^[a-zA-Z0-9._:-]+$/.test(clean) && !out.includes(clean)) {
      out.push(clean);
    }
    if (out.length >= 24) break;
  }
  return out;
}

export function sanitizePartnerRecord(raw, existing = null) {
  const slug =
    normalizeOxiumSlug(raw?.slug || existing?.slug || raw?.name) ||
    `site-${Date.now().toString(36)}`;
  const allowedOrigins = sanitizeOxiumOrigins(
    raw?.allowedOrigins ?? existing?.allowedOrigins ?? [],
  );
  const links = sanitizeOxiumLinks(
    raw?.links ?? existing?.links ?? [],
    allowedOrigins,
  );
  return {
    slug,
    name: String(raw?.name ?? existing?.name ?? slug).trim().slice(0, 56),
    tagline: String(raw?.tagline ?? existing?.tagline ?? "")
      .trim()
      .slice(0, 140),
    description: String(raw?.description ?? existing?.description ?? "")
      .trim()
      .slice(0, 400),
    logoUrl: sanitizeOxiumUrl(raw?.logoUrl ?? existing?.logoUrl ?? ""),
    bannerUrl: sanitizeOxiumUrl(raw?.bannerUrl ?? existing?.bannerUrl ?? ""),
    accentColor: sanitizeOxiumColor(
      raw?.accentColor ?? existing?.accentColor ?? "#6366f1",
    ),
    themeMode:
      raw?.themeMode === "light" || raw?.themeMode === "midnight"
        ? raw.themeMode
        : existing?.themeMode || "dark",
    allowedOrigins,
    links,
    features: sanitizeOxiumFeatures(raw?.features ?? existing?.features),
    syncKeys: sanitizeOxiumSyncKeys(raw?.syncKeys ?? existing?.syncKeys),
    ownerUsername: String(
      existing?.ownerUsername || raw?.ownerUsername || "",
    )
      .trim()
      .slice(0, 40),
    contact: String(raw?.contact ?? existing?.contact ?? "")
      .trim()
      .slice(0, 120),
    status: existing?.status || "pending",
    rejectReason: String(existing?.rejectReason || "").slice(0, 200),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    approvedAt: existing?.approvedAt || null,
  };
}

/** Filters CloudSync main payload down to non-sensitive portable user data only. */
export function filterSafeCloudSyncExport(payloadJson) {
  if (!payloadJson || typeof payloadJson !== "string") return {};
  try {
    const parsed = JSON.parse(payloadJson);
    const ls = parsed?.localStorage && typeof parsed.localStorage === "object"
      ? parsed.localStorage
      : parsed && typeof parsed === "object"
        ? parsed
        : {};
    const safeData = {};
    const sensitiveRe = /(auth_token|auth_user|token|secret|password|admin|cookie_admin|key)/i;
    let count = 0;
    for (const [k, v] of Object.entries(ls)) {
      if (sensitiveRe.test(k)) continue;
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
      const strVal = String(v);
      if (strVal.length > 65536) continue;
      safeData[k] = strVal;
      count++;
      if (count >= 64) break;
    }
    return safeData;
  } catch {
    return {};
  }
}

export function isOriginAllowedForSite(originHeader, site) {
  if (!site || !Array.isArray(site.allowedOrigins) || site.allowedOrigins.length === 0) {
    return false;
  }
  const cleanOrigin = String(originHeader || "").trim();
  if (!cleanOrigin) return false;
  return site.allowedOrigins.includes(cleanOrigin);
}

/** Renders standalone HTML for `/oxium/auth` (custom branded login, signup & cross-site import). */
export function renderOxiumAuthHtml({
  site,
  oxiumOrigin,
  targetOrigin = "",
  isPreview = false,
}) {
  const safeName = escapeHtml(site.name || site.slug);
  const safeTagline = escapeHtml(
    site.tagline || "sign in seamlessly with your oxium network account",
  );
  const safeAccent = sanitizeOxiumColor(site.accentColor, "#c4c4c4");
  const isLightAccent = (() => {
    const h = safeAccent.replace("#", "");
    if (h.length !== 6) return false;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62;
  })();
  const accentBtnText = isLightAccent ? "#000000" : "#ffffff";
  const safeLogo = escapeHtml(site.logoUrl || "/sunshinelogo.png");
  const safeBanner = escapeHtml(site.bannerUrl || "");
  const safeSlug = escapeHtml(site.slug);
  const safeLinks = Array.isArray(site.links) ? site.links : [];
  const clientConfig = JSON.stringify({
    slug: site.slug,
    name: site.name,
    oxiumOrigin,
    targetOrigin,
    isPreview: Boolean(isPreview),
    features: site.features || ["profile", "saves"],
    syncKeys: site.syncKeys || [],
  }).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Sign in to ${site.name ? escapeHtml(site.name) : safeSlug} — Oxium Network</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; font-family: 'Lexend', system-ui, sans-serif; }
  html, body { margin: 0; min-height: 100%; background: #050505; color: #ebebeb; }
  body {
    display: flex; align-items: center; justify-content: center; padding: 20px;
    background-image: ${
      safeBanner
        ? `linear-gradient(180deg, rgba(5,5,5,0.72), rgba(5,5,5,0.94)), url("${safeBanner}")`
        : `none`
    };
    background-size: cover; background-position: center; background-attachment: fixed;
  }
  .ox-card {
    width: 100%; max-width: 430px; border-radius: 16px;
    background: #0e0e0e;
    border: 1px solid #262626;
    box-shadow: 0 24px 64px rgba(0,0,0,0.65);
    overflow: hidden;
  }
  .ox-head {
    padding: 22px 24px 16px; text-align: center;
    background: #141414;
    border-bottom: 1px solid #222222;
  }
  .ox-logo {
    width: 52px; height: 52px; border-radius: 14px; object-fit: cover;
    border: 1px solid #2b2b2b; background: #1a1a1a;
    margin: 0 auto 10px; display: block;
  }
  .ox-title { margin: 0; font-size: 19px; font-weight: 500; color: #fff; }
  .ox-sub { margin: 5px 0 0; font-size: 12px; color: #8c8c8c; line-height: 1.45; }
  .ox-preview-tag {
    display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 500; background: #1f1f1f; color: #ebebeb; border: 1px solid #333;
  }
  .ox-body { padding: 18px 22px 20px; display: flex; flex-direction: column; gap: 13px; }
  .ox-tabs { display: flex; gap: 4px; background: #141414; padding: 4px; border-radius: 12px; border: 1px solid #222; }
  .ox-tab {
    flex: 1; padding: 7px; border: none; border-radius: 9px; cursor: pointer;
    background: transparent; color: #8c8c8c; font-size: 12.5px; font-weight: 400;
  }
  .ox-tab.active { background: ${safeAccent}; color: ${accentBtnText}; font-weight: 500; }
  .ox-field { display: flex; flex-direction: column; gap: 5px; }
  .ox-field label { font-size: 11.5px; color: #a5a5a5; text-transform: lowercase; }
  .ox-input, .ox-select {
    width: 100%; padding: 10px 12px; border-radius: 12px; font-size: 13px;
    background: #181818; border: 1px solid #262626;
    color: #ebebeb; outline: none;
  }
  .ox-input:focus, .ox-select:focus { border-color: #4a4a4a; background: #1f1f1f; }
  .ox-select option { background: #141414; color: #ebebeb; }
  .ox-btn {
    width: 100%; padding: 11px 16px; border: none; border-radius: 13px;
    background: ${safeAccent}; color: ${accentBtnText}; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: filter 0.12s ease;
  }
  .ox-btn:hover { filter: brightness(1.06); }
  .ox-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .ox-btn-ghost {
    width: 100%; padding: 9px 14px; border-radius: 12px; cursor: pointer;
    background: #1a1a1a; border: 1px solid #282828;
    color: #cccccc; font-size: 12px;
  }
  .ox-session-box {
    display: flex; align-items: center; gap: 12px; padding: 11px;
    border-radius: 13px; background: #141414; border: 1px solid #242424;
  }
  .ox-avatar {
    width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: ${safeAccent}; color: #fff; font-weight: 700; font-size: 16px; overflow: hidden; flex-shrink: 0;
  }
  .ox-avatar img { width: 100%; height: 100%; object-fit: cover; }
  .ox-check-row {
    display: flex; align-items: flex-start; gap: 9px; font-size: 12px; color: #cbd5e1;
    background: rgba(255,255,255,0.03); padding: 10px 12px; border-radius: 11px;
    border: 1px solid rgba(255,255,255,0.07); cursor: pointer;
  }
  .ox-check-row input { margin-top: 2px; accent-color: ${safeAccent}; }
  .ox-err { font-size: 12.5px; color: #fda4af; min-height: 16px; text-align: center; }
  .ox-ok { font-size: 12.5px; color: #86efac; text-align: center; }
  .ox-foot {
    padding: 12px 24px 16px; border-top: 1px solid rgba(255,255,255,0.07);
    display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #94a3b8;
  }
  .ox-foot a { color: #cbd5e1; text-decoration: none; }
  .ox-foot a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="ox-card">
    <div class="ox-head">
      <img class="ox-logo" src="${safeLogo}" alt="${safeName}" onerror="this.src='/sunshinelogo.png'" />
      <h1 class="ox-title">sign in to ${safeName}</h1>
      <p class="ox-sub">${safeTagline}</p>
      ${isPreview ? `<span class="ox-preview-tag">preview mode · ${escapeHtml(site.status)}</span>` : ""}
    </div>

    <div class="ox-body" id="ox-root">
      <div id="ox-signed-in" style="display:none; flex-direction:column; gap:12px;">
        <div class="ox-session-box">
          <div class="ox-avatar" id="ox-av">?</div>
          <div style="min-width:0; flex:1;">
            <div style="font-size:14px; font-weight:600; color:#fff;" id="ox-uname"></div>
            <div style="font-size:11.5px; color:#94a3b8;">connected with oxium network</div>
          </div>
        </div>

        <div class="ox-field">
          <label>import saved data from another oxium site (optional)</label>
          <select class="ox-select" id="ox-import-select">
            <option value="">don't import — start fresh</option>
          </select>
        </div>

        <label class="ox-check-row">
          <input type="checkbox" id="ox-notify-optin" />
          <span>enable oxium notifications for new games &amp; working unblocked links</span>
        </label>

        <button class="ox-btn" id="ox-continue-btn" type="button">continue to ${safeName}</button>
        <button class="ox-btn-ghost" id="ox-switch-btn" type="button">use a different oxium account</button>
      </div>

      <div id="ox-auth-forms" style="display:none; flex-direction:column; gap:12px;">
        <div class="ox-tabs">
          <button type="button" class="ox-tab active" data-mode="login">log in</button>
          <button type="button" class="ox-tab" data-mode="register">create account</button>
        </div>
        <div class="ox-field">
          <label>oxium / operation cookie username</label>
          <input class="ox-input" id="ox-u-in" autocomplete="username" placeholder="username" />
        </div>
        <div class="ox-field">
          <label>password</label>
          <input class="ox-input" id="ox-p-in" type="password" autocomplete="current-password" placeholder="password" />
        </div>
        <button class="ox-btn" id="ox-submit-btn" type="button">sign in &amp; continue</button>
      </div>

      <div class="ox-err" id="ox-msg"></div>
    </div>

    <div class="ox-foot">
      <span>powered by <strong>oxium</strong> · operation cookie</span>
      <a href="/oxium/links/${safeSlug}" target="_blank" rel="noopener">${safeLinks.length > 0 ? "site links &amp; mirrors" : "oxium directory"}</a>
    </div>
  </div>

<script>
(() => {
  const CFG = ${clientConfig};
  let authMode = "login";
  let sessionUser = null;
  let sessionToken = localStorage.getItem("auth_token") || "";

  const $ = (id) => document.getElementById(id);
  const msgEl = $("ox-msg");
  const signedInEl = $("ox-signed-in");
  const formsEl = $("ox-auth-forms");
  const importSel = $("ox-import-select");

  function setMsg(text, ok) {
    msgEl.className = ok ? "ox-ok" : "ox-err";
    msgEl.textContent = text || "";
  }

  function authHeaders() {
    const h = { "Content-Type": "application/json" };
    if (sessionToken) h.Authorization = "Bearer " + sessionToken;
    return h;
  }

  async function loadImportSources() {
    importSel.innerHTML = '<option value="">don\\'t import — start fresh</option>';
    try {
      const res = await fetch("/api/oxium/import-sources?site=" + encodeURIComponent(CFG.slug), {
        headers: authHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.sources)) return;
      for (const s of data.sources) {
        const opt = document.createElement("option");
        opt.value = s.slug;
        opt.textContent = s.label + " (" + s.itemCount + " items)";
        importSel.appendChild(opt);
      }
    } catch {}
  }

  function showSignedIn(user) {
    sessionUser = user;
    formsEl.style.display = "none";
    signedInEl.style.display = "flex";
    $("ox-uname").textContent = "@" + user.username;
    $("ox-av").textContent = (user.username || "?").slice(0, 1).toLowerCase();
    void loadImportSources();
  }

  function showForms() {
    sessionUser = null;
    signedInEl.style.display = "none";
    formsEl.style.display = "flex";
  }

  async function checkExistingSession() {
    try {
      const res = await fetch("/api/auth/me", {
        headers: sessionToken ? { Authorization: "Bearer " + sessionToken } : {},
        credentials: "same-origin",
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.user?.username) {
          showSignedIn(data.user);
          return;
        }
      }
    } catch {}
    showForms();
  }

  document.querySelectorAll(".ox-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      authMode = btn.dataset.mode === "register" ? "register" : "login";
      document.querySelectorAll(".ox-tab").forEach((b) => b.classList.toggle("active", b === btn));
      $("ox-submit-btn").textContent = authMode === "register" ? "create oxium account" : "sign in & continue";
      setMsg("");
    });
  });

  $("ox-switch-btn").addEventListener("click", () => {
    setMsg("");
    showForms();
  });

  $("ox-submit-btn").addEventListener("click", async () => {
    const username = ($("ox-u-in").value || "").trim();
    const password = $("ox-p-in").value || "";
    if (!username || !password) return setMsg("enter username and password");
    $("ox-submit-btn").disabled = true;
    setMsg("");
    try {
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.user) {
        setMsg(data.error || "authentication failed");
      } else {
        if (data.token) {
          sessionToken = data.token;
          localStorage.setItem("auth_token", data.token);
          localStorage.setItem("auth_user", JSON.stringify(data.user));
        }
        showSignedIn(data.user);
      }
    } catch {
      setMsg("network error signing in");
    } finally {
      $("ox-submit-btn").disabled = false;
    }
  });

  $("ox-continue-btn").addEventListener("click", async () => {
    $("ox-continue-btn").disabled = true;
    setMsg("");
    try {
      if ($("ox-notify-optin").checked && "Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission().catch(() => {});
      }
      const res = await fetch("/api/oxium/authorize", {
        method: "POST",
        headers: authHeaders(),
        credentials: "same-origin",
        body: JSON.stringify({
          siteSlug: CFG.slug,
          targetOrigin: CFG.targetOrigin,
          importFromSite: importSel.value || "",
          preview: CFG.isPreview,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMsg(data.error || "could not authorize site");
        return;
      }
      if (window.opener && CFG.targetOrigin) {
        window.opener.postMessage({
          type: "oxium:auth-success",
          siteSlug: CFG.slug,
          siteToken: data.siteToken,
          user: data.user,
          profile: data.profile || null,
          importedData: data.importedData || null,
          importSource: data.importSource || "",
        }, CFG.targetOrigin);
        setMsg("signed in! returning to " + CFG.name + "...", true);
        setTimeout(() => window.close(), 350);
      } else {
        setMsg("authorized @" + data.user.username + " for " + CFG.name + "!", true);
      }
    } catch {
      setMsg("authorization request failed");
    } finally {
      $("ox-continue-btn").disabled = false;
    }
  });

  void checkExistingSession();
})();
</script>
</body>
</html>`;
}

/** Renders `/oxium/links` & `/oxium/links/:slug` live directory & mirror links page. */
export function renderOxiumLinksHtml({ partners, selectedSlug, oxiumOrigin }) {
  const approved = (Array.isArray(partners) ? partners : []).filter(
    (p) => p && p.status === "approved",
  );
  const featured = selectedSlug
    ? approved.find((p) => p.slug === selectedSlug) || null
    : null;

  const cardsHtml =
    approved.length === 0
      ? `<div class="empty">no partner sites approved yet — request integration in operation cookie settings &rarr; advanced &rarr; oxium.</div>`
      : approved
          .map((p) => {
            const accent = sanitizeOxiumColor(p.accentColor, "#6366f1");
            const linksList = (p.links || [])
              .map(
                (l) =>
                  `<a class="mirror-btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)} &rarr;</a>`,
              )
              .join("");
            return `<div class="site-card${featured && featured.slug === p.slug ? " is-featured" : ""}" style="--accent:${accent}">
              <div class="site-head">
                <img src="${escapeHtml(p.logoUrl || "/sunshinelogo.png")}" onerror="this.src='/sunshinelogo.png'" alt="" />
                <div>
                  <h2>${escapeHtml(p.name)}</h2>
                  <p>${escapeHtml(p.tagline || p.description || "oxium network partner site")}</p>
                </div>
              </div>
              <div class="mirrors">${linksList || `<span class="no-links">no mirror links posted yet</span>`}</div>
            </div>`;
          })
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Oxium Network — Links &amp; Partner Sites</title>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; font-family: 'Lexend', system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; background: #050505; color: #ebebeb; padding: 36px 20px; }
  .wrap { max-width: 800px; margin: 0 auto; }
  .hero { text-align: center; margin-bottom: 26px; }
  .hero h1 { margin: 0; font-size: 24px; font-weight: 400; color: #ffffff; }
  .hero p { margin: 7px 0 0; color: #8c8c8c; font-size: 13px; }
  .grid { display: grid; gap: 14px; }
  .site-card {
    background: #0e0e0e; border: 1px solid #222222;
    border-radius: 15px; padding: 18px 20px;
  }
  .site-card.is-featured { border-color: #ffffff44; }
  .site-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  .site-head img { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; background: #1a1a1a; }
  .site-head h2 { margin: 0; font-size: 16px; font-weight: 500; color: #fff; }
  .site-head p { margin: 3px 0 0; font-size: 12px; color: #8c8c8c; }
  .mirrors { display: flex; flex-wrap: wrap; gap: 8px; }
  .mirror-btn {
    padding: 8px 13px; border-radius: 11px; background: #c4c4c4; color: #000000;
    text-decoration: none; font-size: 12px; font-weight: 500;
  }
  .mirror-btn:hover { background: #ffffff; }
  .empty, .no-links { color: #8c8c8c; font-size: 12.5px; text-align: center; padding: 14px; }
  .back { display: inline-block; margin-top: 22px; color: #8c8c8c; text-decoration: none; font-size: 12.5px; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>oxium network links</h1>
      <p>verified unblocked games sites powered by operation cookie · cross-site accounts &amp; save sync</p>
    </div>
    <div class="grid">${cardsHtml}</div>
    <a class="back" href="${escapeHtml(oxiumOrigin)}">&larr; back to operation cookie</a>
  </div>
</body>
</html>`;
}

/** Generates `/oxium.js` embeddable partner SDK script. */
export function renderOxiumSdkScript({ oxiumOrigin }) {
  const originLit = JSON.stringify(oxiumOrigin);
  return `(function(){
  if (window.Oxium && window.Oxium.__loaded) return;
  var OXIUM_ORIGIN = ${originLit};
  var scriptEl = document.currentScript;
  var siteSlug = (scriptEl && scriptEl.getAttribute("data-site")) || window.OXIUM_SITE || "";
  if (!siteSlug && scriptEl && scriptEl.src) {
    try { siteSlug = new URL(scriptEl.src).searchParams.get("site") || ""; } catch (e) {}
  }
  var autoWidget = !(scriptEl && scriptEl.getAttribute("data-no-widget") === "1");
  var mountSelector = scriptEl && scriptEl.getAttribute("data-mount");
  var TOKEN_KEY = "oxium_site_token:" + siteSlug;
  var USER_KEY = "oxium_site_user:" + siteSlug;
  var DISMISS_KEY = "oxium_promo_dismissed_v1";

  var listeners = { auth: [], promo: [] };

  function emit(kind, payload) {
    var list = listeners[kind] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) {}
    }
  }

  function getSession() {
    try {
      var tok = localStorage.getItem(TOKEN_KEY) || "";
      var rawUser = localStorage.getItem(USER_KEY);
      var user = rawUser ? JSON.parse(rawUser) : null;
      return tok && user ? { token: tok, user: user } : null;
    } catch (e) { return null; }
  }

  function logout() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {}
    emit("auth", null);
    renderWidget();
  }

  function collectSyncKeys(keys) {
    var out = {};
    if (!Array.isArray(keys)) return out;
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i] || "");
      if (!k || k.indexOf("oxium_") === 0) continue;
      try {
        var val = localStorage.getItem(k);
        if (val !== null) out[k] = val;
      } catch (e) {}
    }
    return out;
  }

  function applyImportedData(dataObj) {
    if (!dataObj || typeof dataObj !== "object") return 0;
    var applied = 0;
    for (var k in dataObj) {
      if (!Object.prototype.hasOwnProperty.call(dataObj, k)) continue;
      if (/(auth_token|auth_user|password|secret|oxium_)/i.test(k)) continue;
      try {
        localStorage.setItem(k, String(dataObj[k]));
        applied++;
      } catch (e) {}
    }
    return applied;
  }

  function syncPush(customData) {
    var sess = getSession();
    if (!sess) return Promise.resolve({ ok: false, error: "not logged in" });
    return fetch(OXIUM_ORIGIN + "/api/oxium/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + sess.token
      },
      body: JSON.stringify({ siteSlug: siteSlug, data: customData || {} })
    }).then(function(r){ return r.json(); });
  }

  function syncPull() {
    var sess = getSession();
    if (!sess) return Promise.resolve({ ok: false, error: "not logged in" });
    return fetch(OXIUM_ORIGIN + "/api/oxium/sync?site=" + encodeURIComponent(siteSlug), {
      headers: { "Authorization": "Bearer " + sess.token }
    }).then(function(r){ return r.json(); });
  }

  function openAuth() {
    if (!siteSlug) return null;
    var url = OXIUM_ORIGIN + "/oxium/auth?site=" + encodeURIComponent(siteSlug) +
      "&origin=" + encodeURIComponent(window.location.origin);
    var w = 480, h = 640;
    var left = Math.max(0, (window.screen.width - w) / 2);
    var top = Math.max(0, (window.screen.height - h) / 2);
    return window.open(url, "oxium_auth", "width=" + w + ",height=" + h + ",left=" + left + ",top=" + top);
  }

  window.addEventListener("message", function(evt) {
    if (evt.origin !== OXIUM_ORIGIN) return;
    var d = evt.data;
    if (!d || d.type !== "oxium:auth-success" || d.siteSlug !== siteSlug) return;
    try {
      if (d.siteToken) localStorage.setItem(TOKEN_KEY, d.siteToken);
      if (d.user) localStorage.setItem(USER_KEY, JSON.stringify(d.user));
    } catch (e) {}
    if (d.importedData) applyImportedData(d.importedData);
    emit("auth", d);
    renderWidget();
  });

  var widgetHost = null;
  function renderWidget() {
    if (!autoWidget && !mountSelector) return;
    if (!document.body) return;
    if (!widgetHost) {
      widgetHost = document.createElement("div");
      widgetHost.id = "oxium-auth-widget";
      if (!mountSelector) {
        widgetHost.style.cssText = "position:fixed;bottom:14px;right:14px;z-index:99999;font-family:system-ui,sans-serif;";
      }
      var target = mountSelector ? document.querySelector(mountSelector) : document.body;
      (target || document.body).appendChild(widgetHost);
    }
    var sess = getSession();
    widgetHost.innerHTML = "";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText = "display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;border:1px solid rgba(255,255,255,0.16);background:rgba(15,18,28,0.92);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,0.4);";
    btn.textContent = sess ? "@" + sess.user.username + " · oxium" : "sign in with oxium";
    btn.onclick = function() {
      if (sess) {
        if (confirm("Signed in via Oxium as @" + sess.user.username + ". Sync & open Oxium account options? (Cancel to log out)")) {
          openAuth();
        } else {
          logout();
        }
      } else {
        openAuth();
      }
    };
    widgetHost.appendChild(btn);
  }

  function showPromoToast(promo) {
    if (!promo || !promo.id || !document.body) return;
    try {
      var last = localStorage.getItem(DISMISS_KEY);
      if (last === promo.id) return;
    } catch (e) {}
    var existing = document.getElementById("oxium-promo-toast");
    if (existing) existing.remove();
    var box = document.createElement("div");
    box.id = "oxium-promo-toast";
    box.style.cssText = "position:fixed;top:16px;right:16px;z-index:99999;max-width:320px;padding:13px 15px;border-radius:16px;background:rgba(15,18,28,0.96);border:1px solid rgba(99,102,241,0.5);color:#f8fafc;font-family:system-ui,sans-serif;box-shadow:0 18px 42px rgba(0,0,0,0.55);";
    var titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:13px;font-weight:700;margin-bottom:4px;padding-right:18px;";
    titleEl.textContent = promo.title || "Oxium Network";
    var bodyEl = document.createElement("div");
    bodyEl.style.cssText = "font-size:12px;color:#cbd5e1;line-height:1.4;margin-bottom:9px;";
    bodyEl.textContent = promo.body || "";
    var row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";
    var link = document.createElement("a");
    link.href = promo.linksUrl || (OXIUM_ORIGIN + "/oxium/links");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = promo.ctaText || "click here for links";
    link.style.cssText = "padding:6px 12px;border-radius:9px;background:#6366f1;color:#fff;font-size:11.5px;font-weight:600;text-decoration:none;";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "dismiss";
    close.style.cssText = "background:transparent;border:none;color:#94a3b8;font-size:11px;cursor:pointer;";
    close.onclick = function() {
      try { localStorage.setItem(DISMISS_KEY, promo.id); } catch (e) {}
      box.remove();
    };
    row.appendChild(link);
    row.appendChild(close);
    box.appendChild(titleEl);
    box.appendChild(bodyEl);
    box.appendChild(row);
    document.body.appendChild(box);
    emit("promo", promo);
  }

  function pollAnnouncements() {
    fetch(OXIUM_ORIGIN + "/api/oxium/announcements?site=" + encodeURIComponent(siteSlug))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(data){
        if (data && Array.isArray(data.promos) && data.promos.length > 0) {
          showPromoToast(data.promos[0]);
        }
      })
      .catch(function(){});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function(){ renderWidget(); pollAnnouncements(); });
  } else {
    renderWidget();
    pollAnnouncements();
  }

  window.Oxium = {
    __loaded: true,
    siteSlug: siteSlug,
    origin: OXIUM_ORIGIN,
    openAuth: openAuth,
    login: openAuth,
    logout: logout,
    getSession: getSession,
    getUser: function(){ var s = getSession(); return s ? s.user : null; },
    syncPush: syncPush,
    syncPull: syncPull,
    collectSyncKeys: collectSyncKeys,
    applyImportedData: applyImportedData,
    onAuth: function(cb){ if (typeof cb === "function") listeners.auth.push(cb); },
    onPromo: function(cb){ if (typeof cb === "function") listeners.promo.push(cb); }
  };
})();`;
}

/** Plain Markdown specification & step-by-step AI Agent setup guide for `/oxium/docs.md`. */
export function renderOxiumDocsMarkdown({ oxiumOrigin }) {
  const origin = String(oxiumOrigin || "https://operationcookie.com").replace(/\/+$/, "");
  return `# The Oxium Network — Full Integration & AI Agent Setup Guide

> **Oxium Host Origin:** \`${origin}\`  
> **Primary Motto:** *one solution for building unblocked games websites*

The Oxium Network lets registered unblocked games websites embed a custom-branded Operation Cookie SSO login/signup popup, sync user game saves/bookmarks/settings per site, import safe non-credential user data across approved partner sites, display cross-network promo notifications, and publish a mirror-link directory.

---

## Quick Autonomous Checklist for AI Agents

If a user asked you to *"install Oxium in the current folder"*, follow these steps in order:

1. **Inspect the Current Workspace**
   - Identify the site's framework (Static HTML, Vite, React/Next.js, Preact, Astro, etc.) and locate its shared HTML entry file(s) or root layout component.
   - Check how the website saves user data in \`localStorage\` (favorites/bookmarks, game save keys, highscores, theme/cloak preferences). **Never** include auth tokens, passwords, admin secrets, or API keys in sync key lists.
   - Determine the site's human-readable name (e.g. \`Nebula Arcade\`), URL-safe lowercase slug (\`[a-z0-9-]+\`, 2–40 chars), production domain(s) / mirror origins (\`https://...\`), accent hex color (\`#rrggbb\`), and optional logo/banner URLs.
   - Ask the user for any missing details (such as their public domain/mirror URLs, contact handle, or an optional **Scoped Oxium Setup Key** generated from Operation Cookie -> \`Settings -> Advanced -> Oxium\`).

2. **Register / Request Integration via Secure Endpoint**
   - Submit \`POST ${origin}/api/oxium/agent-request\` with JSON body (schema below).
   - If the user gave you an \`oxium_setup\` key, send it in the \`X-Oxium-Setup-Key: <token>\` header (never ask for their Operation Cookie password or main \`auth_token\`).
   - Submissions are created with \`status: "pending"\` until approved by an Operation Cookie administrator. While pending, the owner or admin can still test \`${origin}/oxium/auth?site=SLUG&preview=1\`.

3. **Install the Oxium Script Tag**
   - Add the following script to every HTML page (or root layout \`<head>\` / end of \`<body>\`):
     \`\`\`html
     <script
       src="${origin}/oxium.js"
       data-site="YOUR_SITE_SLUG"
       data-sync-keys="favorites,theme,saves"
       defer
     ></script>
     \`\`\`
   - Optional data attributes:
     - \`data-site\` *(required)*: your approved slug.
     - \`data-sync-keys\`: comma-separated \`localStorage\` keys to auto-sync after login and expose via \`Oxium.collectSyncKeys()\`.
     - \`data-no-widget="true"\`: suppress the default floating bottom-right **"sign in with oxium"** button if you are wiring your own custom login button using \`window.Oxium.openAuth()\`.

4. **Wire Framework Hooks & Security Headers**
   - Hook \`window.Oxium?.onAuth((session) => { ... })\` to reflect signed-in user UI and persist synced state when games save progress.
   - If the site sets a strict \`Content-Security-Policy\`:
     - Add \`${origin}\` to \`script-src\` and \`connect-src\`.
     - Ensure popup windows to \`${origin}/oxium/auth\` are not blocked by \`Cross-Origin-Opener-Policy: same-origin\` (use \`same-origin-allow-popups\` if COOP is configured).

5. **Verify Installation**
   - Test locally or on preview origin listed in \`allowedOrigins\`.
   - Confirm \`window.Oxium.__loaded === true\` in browser DevTools, preview \`${origin}/oxium/auth?site=SLUG&preview=1\`, and check \`${origin}/oxium/links/SLUG\`.

---

## Secure Registration Endpoint Reference

### Option A (Owner CloudSync UI): \`POST ${origin}/api/oxium/setup-key\`
Authenticated Operation Cookie users can mint a 2-hour, least-privilege \`oxium_setup\` JWT scoped **only** to submitting partner site requests under their username. It cannot access CloudSync saves, chats, profiles, or admin routes.

### Option B (AI Agent / CLI Registration): \`POST ${origin}/api/oxium/agent-request\`
- **CORS:** Enabled (\`Access-Control-Allow-Origin: *\`, allows \`Content-Type\`, \`Authorization\`, \`X-Oxium-Setup-Key\`).
- **Headers:**
  - \`Content-Type: application/json\`
  - \`X-Oxium-Setup-Key: <scoped-token>\` *(recommended if provided by user)*
- **JSON Request Body:**
\`\`\`json
{
  "name": "Nebula Arcade",
  "slug": "nebula-arcade",
  "tagline": "Fast unblocked games with synced saves & themes",
  "description": "400+ HTML5 & Flash games with cross-site Oxium saves",
  "allowedOrigins": [
    "https://nebulaarcade.com",
    "https://mirror.nebulaarcade.org"
  ],
  "links": [
    { "label": "Main Site", "url": "https://nebulaarcade.com" },
    { "label": "School Mirror", "url": "https://mirror.nebulaarcade.org" }
  ],
  "logoUrl": "https://nebulaarcade.com/logo.png",
  "bannerUrl": "https://nebulaarcade.com/banner.jpg",
  "accentColor": "#6366f1",
  "themeMode": "dark",
  "features": {
    "bookmarks": true,
    "saves": true,
    "settings": true,
    "import": true,
    "announcements": true
  },
  "syncKeys": ["favorites", "highscores", "theme"],
  "contact": "@owner_discord or owner@nebulaarcade.com"
}
\`\`\`

- **Field Validation & Security Rules:**
  - \`name\`: 2–56 characters (required).
  - \`slug\`: lowercase \`[a-z0-9-]+\`, 2–40 chars (derived from \`name\` if omitted). Slugs already owned by a different verified account return \`409 Conflict\`.
  - \`allowedOrigins\`: array of exact origins (\`https://host\` or \`http://localhost:port\`, no path/query). Only origins in this allowlist can receive popup \`postMessage\` auth tokens or call \`/api/oxium/sync\`. At least 1 origin is required for unauthenticated agent submissions.
  - \`links\`: array of \`{ label, url }\` using \`http://\` or \`https://\` URLs.
  - \`accentColor\`: hex \`#rrggbb\` (default \`#6366f1\`).
  - \`themeMode\`: \`"dark"\` | \`"midnight"\` | \`"light"\`.
  - \`contact\`: required (up to 120 chars) if calling without \`X-Oxium-Setup-Key\`.
  - Requests ALWAYS enter \`"pending"\` status unless updating an existing site owned by the same authenticated key.

- **cURL Example:**
\`\`\`bash
curl -X POST "${origin}/api/oxium/agent-request" \\
  -H "Content-Type: application/json" \\
  -H "X-Oxium-Setup-Key: YOUR_SCOPED_KEY_IF_PROVIDED" \\
  -d '{
    "name": "Nebula Arcade",
    "slug": "nebula-arcade",
    "tagline": "Fast unblocked games with synced saves",
    "allowedOrigins": ["https://nebulaarcade.com", "http://localhost:5173"],
    "links": [{ "label": "Main Site", "url": "https://nebulaarcade.com" }],
    "accentColor": "#6366f1",
    "syncKeys": ["favorites", "saves"],
    "contact": "discord:@you"
  }'
\`\`\`

- **Success Response (\`200 OK\`):**
\`\`\`json
{
  "success": true,
  "status": "pending",
  "partner": { "slug": "nebula-arcade", "name": "Nebula Arcade", "status": "pending" },
  "embedSnippet": "<script src=\\"${origin}/oxium.js\\" data-site=\\"nebula-arcade\\"></script>",
  "previewUrl": "${origin}/oxium/auth?site=nebula-arcade&preview=1",
  "linksUrl": "${origin}/oxium/links/nebula-arcade",
  "docsUrl": "${origin}/oxium/docs"
}
\`\`\`

---

## \`window.Oxium\` Client SDK Reference

Once \`${origin}/oxium.js\` loads, \`window.Oxium\` exposes:

| Method | Description |
| --- | --- |
| \`Oxium.openAuth()\` / \`Oxium.login()\` | Opens the branded Oxium popup auth & import window for \`data-site\`. |
| \`Oxium.logout()\` | Clears the site-scoped Oxium session (\`oxium_session_<slug>\`). |
| \`Oxium.getSession()\` | Returns \`{ token, user: { id, username }, profile, savedAt }\` or \`null\`. |
| \`Oxium.getUser()\` | Returns \`{ id, username }\` or \`null\`. |
| \`Oxium.syncPush(dataObj)\` | Saves up to 64 safe key-value strings to \`POST ${origin}/api/oxium/sync\`. |
| \`Oxium.syncPull()\` | Fetches saved site bucket from \`GET ${origin}/api/oxium/sync?site=SLUG\`. |
| \`Oxium.collectSyncKeys(keys)\` | Reads safe \`localStorage\` keys (automatically strips secret/token keys). |
| \`Oxium.applyImportedData(obj)\` | Writes imported safe keys from Operation Cookie or partner sites into \`localStorage\`. |
| \`Oxium.onAuth(cb)\` | Fires \`cb(session)\` immediately if signed in and after popup login/import. |
| \`Oxium.onPromo(cb)\` | Fires \`cb(promo)\` when an active Oxium network announcement is fetched. |

### Framework Recipe: Custom Button + Auto Sync
\`\`\`html
<button id="my-login-btn" onclick="window.Oxium && window.Oxium.openAuth()">
  Sign in with Oxium
</button>
<script src="${origin}/oxium.js" data-site="nebula-arcade" data-sync-keys="favorites,theme,saves" data-no-widget="true"></script>
<script>
  window.addEventListener("load", function () {
    if (!window.Oxium) return;
    window.Oxium.onAuth(function (sess) {
      document.getElementById("my-login-btn").textContent = "@" + sess.user.username;
      // Optional: pull cloud saves from Nebula Arcade bucket
      window.Oxium.syncPull().then(function (res) {
        if (res && res.success && res.data) {
          window.Oxium.applyImportedData(res.data);
        }
      });
    });
  });
</script>
\`\`\`

---

## Security & Data Isolation Model

- **Site-Scoped JWTs:** After popup authorization, partner sites receive a JWT with \`typ: "oxium_site"\` and \`siteId: "<slug>"\`. It **only** grants access to \`/api/oxium/sync\` and \`/api/oxium/import\` for that specific \`siteId\`, and is rejected with \`401\` on all Operation Cookie CloudSync, Chat, and Admin routes.
- **Credential Stripping:** When importing from Operation Cookie or another Oxium site, server-side and client-side filters strip any key matching \`/(auth_token|auth_user|token|secret|password|admin|cookie_admin|oxium_|key)/i\` and skip values over 64 KB.
- **Origin Allowlist:** \`/oxium/auth\` only dispatches \`window.opener.postMessage(..., targetOrigin)\` when \`targetOrigin\` matches \`allowedOrigins\`. \`/api/oxium/sync\` also checks request \`Origin\` against \`allowedOrigins\`.
`;
}

/** Interactive developer & AI agent documentation portal for `/oxium/docs`. */
export function renderOxiumDocsHtml({ oxiumOrigin }) {
  const origin = String(oxiumOrigin || "https://operationcookie.com").replace(/\/+$/, "");
  const safeOrigin = escapeHtml(origin);
  const agentPrompt = `Pull full instructions from ${origin}/oxium/docs to install Oxium in the current folder.`;
  const scriptExample = `<script\n  src="${origin}/oxium.js"\n  data-site="YOUR_SITE_SLUG"\n  data-sync-keys="favorites,theme,saves"\n  defer\n></script>`;
  const curlExample = `curl -X POST "${origin}/api/oxium/agent-request" \\
  -H "Content-Type: application/json" \\
  -H "X-Oxium-Setup-Key: OPTIONAL_SCOPED_KEY" \\
  -d '{
    "name": "Nebula Arcade",
    "slug": "nebula-arcade",
    "tagline": "Fast unblocked games with synced saves",
    "allowedOrigins": ["https://nebulaarcade.com", "http://localhost:5173"],
    "links": [{ "label": "Main Site", "url": "https://nebulaarcade.com" }],
    "accentColor": "#6366f1",
    "themeMode": "dark",
    "syncKeys": ["favorites", "saves"],
    "contact": "discord:@you"
  }'`;
  const sdkHookExample = `<button id="oxium-signin-btn" type="button">Sign in with Oxium</button>
<script>
  document.getElementById("oxium-signin-btn").addEventListener("click", function () {
    window.Oxium && window.Oxium.openAuth();
  });
  window.addEventListener("load", function () {
    if (!window.Oxium) return;
    window.Oxium.onAuth(function (session) {
      document.getElementById("oxium-signin-btn").textContent = "@" + session.user.username;
      window.Oxium.syncPull().then(function (res) {
        if (res && res.success && res.data) {
          window.Oxium.applyImportedData(res.data);
        }
      });
    });
  });
</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>oxium network docs — operation cookie</title>
<link rel="icon" type="image/x-icon" href="/sunshinelogo.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; font-family: 'Lexend', system-ui, sans-serif; }
  html, body { margin: 0; min-height: 100%; background: #050505; color: #ebebeb; }
  ::selection { background: #ffffff; color: #000000; }
  .layout { max-width: 1040px; margin: 0 auto; padding: 32px 20px 64px; display: grid; grid-template-columns: 210px 1fr; gap: 22px; }
  @media (max-width: 820px) { .layout { grid-template-columns: 1fr; } .sidebar { position: static !important; } }
  .sidebar { position: sticky; top: 24px; align-self: start; background: #0e0e0e; border: 1px solid #222222; border-radius: 15px; padding: 14px; display: flex; flex-direction: column; gap: 4px; }
  .sidebar-title { font-size: 13px; font-weight: 500; color: #ffffff; margin: 2px 6px 8px; }
  .nav-link { text-decoration: none; color: #8c8c8c; font-size: 12px; padding: 7px 9px; border-radius: 10px; transition: background-color 0.12s, color 0.12s; }
  .nav-link:hover { background: #1a1a1a; color: #ffffff; }
  .main { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  .hero { padding: 22px; border-radius: 15px; background: #0e0e0e; border: 1px solid #262626; }
  .hero-sub { font-size: 11.5px; color: #727272; margin-bottom: 6px; }
  .hero h1 { margin: 0 0 8px; font-size: 22px; font-weight: 400; color: #ffffff; }
  .hero p { margin: 0 0 16px; font-size: 12.5px; color: #a6a6a6; line-height: 1.55; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .btn-primary, .btn-secondary { display: inline-flex; align-items: center; gap: 6px; padding: 9px 14px; border-radius: 12px; font-size: 12px; font-weight: 400; cursor: pointer; text-decoration: none; border: none; transition: background-color 0.12s; }
  .btn-primary { background: #c4c4c4; color: #000000; }
  .btn-primary:hover { background: #ffffff; }
  .btn-secondary { background: #1a1a1a; color: #d8d8d8; border: 1px solid #282828; }
  .btn-secondary:hover { background: #262626; color: #ffffff; }
  .section { padding: 20px 22px; border-radius: 15px; background: #0e0e0e; border: 1px solid #222222; }
  .section h2 { margin: 0 0 10px; font-size: 16px; font-weight: 400; color: #ffffff; }
  .section h3 { margin: 16px 0 8px; font-size: 13px; font-weight: 500; color: #d8d8d8; }
  .section p, .section li { font-size: 12.5px; line-height: 1.6; color: #a6a6a6; }
  .section ol, .section ul { padding-left: 18px; margin: 8px 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; background: #1a1a1a; padding: 2px 6px; border-radius: 6px; color: #ebebeb; }
  .code-wrap { position: relative; margin: 10px 0; }
  pre { margin: 0; padding: 13px 14px; border-radius: 12px; background: #060606; border: 1px solid #222222; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; line-height: 1.5; color: #d8d8d8; }
  .copy-btn { position: absolute; top: 8px; right: 8px; background: #1f1f1f; color: #d8d8d8; border: 1px solid #303030; border-radius: 8px; padding: 4px 10px; font-size: 11px; cursor: pointer; }
  .copy-btn:hover { background: #ffffff; color: #000000; border-color: #ffffff; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
  th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid #1d1d1d; vertical-align: top; color: #a6a6a6; }
  th { color: #ebebeb; font-weight: 500; }
</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-title">oxium docs</div>
      <a class="nav-link" href="#agent-setup">1. ai agent setup</a>
      <a class="nav-link" href="#endpoint">2. form endpoint</a>
      <a class="nav-link" href="#script-install">3. embed oxium.js</a>
      <a class="nav-link" href="#sdk-api">4. sdk reference</a>
      <a class="nav-link" href="#security">5. security model</a>
      <a class="nav-link" href="/oxium/docs.md" target="_blank">raw markdown (.md)</a>
      <a class="nav-link" href="/oxium/links" target="_blank">network links</a>
    </aside>

    <main class="main">
      <section class="hero">
        <div class="hero-sub">operation cookie · oxium network</div>
        <h1>the oxium network integration guide</h1>
        <p>one solution for building unblocked games websites — custom-branded popup login, safe cross-site save &amp; bookmark imports, per-site cloud sync, and network push alerts hosted on <code>${safeOrigin}</code>.</p>
        <div class="hero-actions">
          <button type="button" class="btn-primary" id="copy-prompt-top">copy ai agent prompt</button>
          <a class="btn-secondary" href="/oxium/docs.md" target="_blank" rel="noopener">raw markdown (.md)</a>
          <a class="btn-secondary" href="/">back to operation cookie</a>
        </div>
      </section>

      <section class="section" id="agent-setup">
        <h2>1. ai agent autonomous workflow</h2>
        <p>give this prompt to any ai coding agent inside your website project folder:</p>
        <div class="code-wrap">
          <pre id="agent-prompt-pre">${escapeHtml(agentPrompt)}</pre>
          <button type="button" class="copy-btn" data-copy="agent-prompt-pre">copy</button>
        </div>
        <ol>
          <li><strong>inspect the workspace folder:</strong> identify the framework (static html, vite, react, next.js, preact, astro), root html/layout files, domain/mirror urls, and existing <code>localStorage</code> save/bookmark keys. never include auth tokens, passwords, or secrets in <code>syncKeys</code>.</li>
          <li><strong>gather missing details safely:</strong> if production origins, a contact handle, or an optional scoped <code>X-Oxium-Setup-Key</code> (minted inside operation cookie under <em>settings &rarr; advanced &rarr; oxium</em>) are missing, ask the site owner once.</li>
          <li><strong>register via <code>POST ${safeOrigin}/api/oxium/agent-request</code>:</strong> submits site metadata, allowed origins, mirror links, branding, and sync features into admin review (<code>pending</code> status).</li>
          <li><strong>embed <code>/oxium.js</code> &amp; wire sdk callbacks:</strong> add <code>&lt;script src="${safeOrigin}/oxium.js" data-site="YOUR_SLUG"&gt;&lt;/script&gt;</code>, optionally attach <code>Oxium.onAuth</code> / <code>Oxium.syncPush</code> / <code>Oxium.syncPull</code>, and ensure csp/coop headers allow popup login cleanly.</li>
          <li><strong>verify:</strong> confirm <code>window.Oxium.__loaded === true</code>, preview <code>${safeOrigin}/oxium/auth?site=SLUG&amp;preview=1</code>, and check <code>${safeOrigin}/oxium/links/SLUG</code>.</li>
        </ol>
      </section>

      <section class="section" id="endpoint">
        <h2>2. secure registration endpoint</h2>
        <p>agents and setup scripts hit <code>POST ${safeOrigin}/api/oxium/agent-request</code>. cors is open so setup scripts can submit requests cleanly.</p>
        <h3>least-privilege key model</h3>
        <ul>
          <li><strong>scoped setup key (recommended):</strong> users mint a 2-hour <code>X-Oxium-Setup-Key</code> inside operation cookie (<em>settings &rarr; advanced &rarr; oxium</em>). this <code>oxium_setup</code> jwt can only submit partner requests for that account and is rejected with <code>401</code> on cloudsync, chat, and admin routes.</li>
          <li><strong>public submission (no token):</strong> requires valid <code>name</code>, <code>slug</code>, at least one <code>http/https</code> origin in <code>allowedOrigins</code>, and a <code>contact</code> handle. cannot overwrite any slug owned by another user and always starts in <code>pending</code> review.</li>
        </ul>
        <div class="code-wrap">
          <pre id="curl-pre">${escapeHtml(curlExample)}</pre>
          <button type="button" class="copy-btn" data-copy="curl-pre">copy</button>
        </div>
        <h3>endpoints</h3>
        <table>
          <thead><tr><th>endpoint</th><th>method</th><th>purpose</th></tr></thead>
          <tbody>
            <tr><td><code>/api/oxium/setup-key</code></td><td>POST</td><td>cloudsync user mints a 2h scoped ai setup key</td></tr>
            <tr><td><code>/api/oxium/agent-request</code></td><td>POST</td><td>ai agent / cli submits a partner site request securely</td></tr>
            <tr><td><code>/oxium/auth?site=SLUG</code></td><td>GET</td><td>branded sso popup login, signup &amp; cross-site importer</td></tr>
            <tr><td><code>/api/oxium/sync</code></td><td>GET / POST</td><td>read or save user bucket using scoped <code>oxium_site</code> bearer token</td></tr>
            <tr><td><code>/api/oxium/import</code></td><td>POST</td><td>pull safe data from operation cookie or another oxium site</td></tr>
            <tr><td><code>/api/oxium/announcements</code></td><td>GET</td><td>fetch active oxium promo &amp; push notifications</td></tr>
            <tr><td><code>/oxium/links/SLUG</code></td><td>GET</td><td>public verified mirror &amp; play links directory</td></tr>
          </tbody>
        </table>
      </section>

      <section class="section" id="script-install">
        <h2>3. embed oxium.js across your website</h2>
        <p>include this tag once per page or inside your shared root layout. add <code>data-no-widget="true"</code> if you wire your own login button with <code>Oxium.openAuth()</code>.</p>
        <div class="code-wrap">
          <pre id="script-pre">${escapeHtml(scriptExample)}</pre>
          <button type="button" class="copy-btn" data-copy="script-pre">copy</button>
        </div>
        <h3>custom login button + cloud sync hook</h3>
        <div class="code-wrap">
          <pre id="sdk-hook-pre">${escapeHtml(sdkHookExample)}</pre>
          <button type="button" class="copy-btn" data-copy="sdk-hook-pre">copy</button>
        </div>
      </section>

      <section class="section" id="sdk-api">
        <h2>4. client sdk reference</h2>
        <table>
          <thead><tr><th>method</th><th>behavior</th></tr></thead>
          <tbody>
            <tr><td><code>Oxium.openAuth()</code></td><td>opens centered branded popup at <code>/oxium/auth?site=...&amp;origin=...</code></td></tr>
            <tr><td><code>Oxium.getSession()</code></td><td>returns active <code>{ token, user, profile }</code> or <code>null</code></td></tr>
            <tr><td><code>Oxium.syncPush(data)</code></td><td>merges up to 64 safe keys (max 64kb each) into site sync bucket</td></tr>
            <tr><td><code>Oxium.syncPull()</code></td><td>fetches latest cloud bucket for the logged-in user on this site</td></tr>
            <tr><td><code>Oxium.applyImportedData(obj)</code></td><td>applies non-sensitive imported saves/bookmarks to <code>localStorage</code></td></tr>
            <tr><td><code>Oxium.onAuth(cb)</code></td><td>subscribes to login, import, and restored-session events</td></tr>
            <tr><td><code>Oxium.onPromo(cb)</code></td><td>fires when network promo toast data arrives</td></tr>
          </tbody>
        </table>
      </section>

      <section class="section" id="security">
        <h2>5. security &amp; isolation</h2>
        <ul>
          <li><strong>strict token scoping:</strong> tokens carry explicit <code>typ</code> claims (<code>oxium_site</code> vs <code>oxium_setup</code> vs user sessions). partner sites never see operation cookie passwords or cloudsync tokens.</li>
          <li><strong>origin allowlists:</strong> popup <code>postMessage</code> delivery and <code>/api/oxium/sync</code> verify the calling origin against your registered <code>allowedOrigins</code>.</li>
          <li><strong>automatic secret scrubbing:</strong> cross-site imports automatically drop keys matching <code>/(auth_token|auth_user|token|secret|password|admin|cookie_admin|oxium_|key)/i</code> server-side and client-side.</li>
          <li><strong>admin approval gate:</strong> all requests enter <code>pending</code> status until approved by an operation cookie admin.</li>
        </ul>
      </section>
    </main>
  </div>
  <script>
    function copyFromText(text, btn) {
      navigator.clipboard.writeText(text).then(function () {
        var prev = btn.textContent;
        btn.textContent = "copied!";
        setTimeout(function () { btn.textContent = prev; }, 1600);
      });
    }
    document.getElementById("copy-prompt-top").addEventListener("click", function () {
      copyFromText(document.getElementById("agent-prompt-pre").textContent, this);
    });
    document.querySelectorAll(".copy-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-copy"));
        if (target) copyFromText(target.textContent, btn);
      });
    });
  </script>
</body>
</html>`;
}

