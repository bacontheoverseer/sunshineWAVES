import { useState, useEffect, useCallback } from "preact/hooks";
import { createPortal } from "preact/compat";

interface OxiumLink {
  label: string;
  url: string;
}

interface OxiumPartner {
  slug: string;
  name: string;
  tagline: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  accentColor: string;
  themeMode?: "dark" | "midnight" | "light";
  allowedOrigins: string[];
  links: OxiumLink[];
  features: Record<string, boolean>;
  syncKeys?: string[];
  ownerUsername?: string;
  contact?: string;
  status: "pending" | "approved" | "rejected";
  rejectReason?: string;
  createdAt?: number;
  updatedAt?: number;
}

interface OxiumSettingsCardProps {
  active: boolean;
}

function slugifySiteName(input: string): string {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const t = localStorage.getItem("auth_token");
    if (t) headers.Authorization = `Bearer ${t}`;
  } catch {}
  return headers;
}

function parseLinksText(raw: string): OxiumLink[] {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipeIdx = line.indexOf("|");
      if (pipeIdx > 0) {
        return {
          label: line.slice(0, pipeIdx).trim() || "Play",
          url: line.slice(pipeIdx + 1).trim(),
        };
      }
      return { label: "Mirror Link", url: line };
    })
    .filter((l) => /^https?:\/\//i.test(l.url));
}

export default function OxiumSettingsCard({ active }: OxiumSettingsCardProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"request" | "mysites">("request");
  const [mySites, setMySites] = useState<OxiumPartner[]>([]);
  const [oxiumOrigin, setOxiumOrigin] = useState(() =>
    typeof window !== "undefined" ? window.location.origin : "https://operationcookie.com",
  );
  const [loadingSites, setLoadingSites] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [copiedSlug, setCopiedSlug] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [setupKey, setSetupKey] = useState("");
  const [mintingKey, setMintingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [editingSite, setEditingSite] = useState<OxiumPartner | null>(null);

  // Interactive live preview state
  const [previewScreen, setPreviewScreen] = useState<"auth" | "import" | "insite">("auth");
  const [previewAuthTab, setPreviewAuthTab] = useState<"signin" | "signup">("signin");
  const [previewUsername, setPreviewUsername] = useState("");
  const [previewPassword, setPreviewPassword] = useState("");
  const [previewImportSource, setPreviewImportSource] = useState("operation-cookie");
  const [previewNotify, setPreviewNotify] = useState(true);
  const [previewDoneNote, setPreviewDoneNote] = useState("");

  // Manual Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState("");
  const [originsText, setOriginsText] = useState("");
  const [linksText, setLinksText] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [accentColor, setAccentColor] = useState("#c4c4c4");
  const [themeMode, setThemeMode] = useState<"dark" | "midnight" | "light">("dark");
  const [syncKeysText, setSyncKeysText] = useState("");
  const [contact, setContact] = useState("");
  const [featBookmarks, setFeatBookmarks] = useState(true);
  const [featSaves, setFeatSaves] = useState(true);
  const [featSettings, setFeatSettings] = useState(true);
  const [featImport, setFeatImport] = useState(true);

  const loadMySites = useCallback(async () => {
    setLoadingSites(true);
    try {
      const res = await fetch("/api/oxium/my-requests", {
        headers: getAuthHeaders(),
        credentials: "same-origin",
      });
      if (!res.ok) {
        setMySites([]);
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.partners)) setMySites(data.partners);
      if (data.oxiumOrigin) setOxiumOrigin(data.oxiumOrigin);
    } catch {
      // Ignore unauthenticated errors silently
    } finally {
      setLoadingSites(false);
    }
  }, []);

  useEffect(() => {
    if (active || modalOpen) {
      void loadMySites();
    }
  }, [active, modalOpen, loadMySites]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugTouched) {
      setSlug(slugifySiteName(val));
    }
  };

  const resetForm = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setTagline("");
    setOriginsText("");
    setLinksText("");
    setLogoUrl("");
    setBannerUrl("");
    setAccentColor("#c4c4c4");
    setThemeMode("dark");
    setSyncKeysText("");
    setContact("");
    setFeatBookmarks(true);
    setFeatSaves(true);
    setFeatSettings(true);
    setFeatImport(true);
  };

  const docsUrl = `${oxiumOrigin.replace(/\/+$/, "")}/oxium/docs`;
  const agentPromptText = `Pull full instructions from ${docsUrl} to install Oxium in the current folder.`;

  const copyTextSafe = async (text: string, onDone: () => void) => {
    try {
      await navigator.clipboard.writeText(text);
      onDone();
    } catch {
      onDone();
    }
  };

  const handleMintSetupKey = async () => {
    setMintingKey(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/oxium/setup-key", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok || !data.success || !data.setupKey) {
        setStatusMsg({
          text: data.error || "sign in to cloudsync first to generate a scoped setup key.",
          ok: false,
        });
        return;
      }
      setSetupKey(data.setupKey);
      setStatusMsg({
        text: `minted 2h scoped setup key for @${data.username}. share only with your setup agent.`,
        ok: true,
      });
    } catch {
      setStatusMsg({ text: "could not generate setup key.", ok: false });
    } finally {
      setMintingKey(false);
    }
  };

  const handleSubmitRequest = async (e: Event) => {
    e.preventDefault();
    setStatusMsg(null);
    const cleanName = name.trim();
    const cleanSlug = slugifySiteName(slug || cleanName);
    if (cleanName.length < 2 || cleanSlug.length < 2) {
      setStatusMsg({ text: "please enter a valid site name and slug.", ok: false });
      return;
    }
    setSubmitting(true);
    try {
      const origins = originsText
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const links = parseLinksText(linksText);
      const syncKeys = syncKeysText
        .split(/[\r\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch("/api/oxium/request", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "same-origin",
        body: JSON.stringify({
          name: cleanName,
          slug: cleanSlug,
          tagline: tagline.trim(),
          logoUrl: logoUrl.trim(),
          bannerUrl: bannerUrl.trim(),
          accentColor,
          themeMode,
          allowedOrigins: origins,
          links,
          syncKeys,
          contact: contact.trim(),
          features: {
            bookmarks: featBookmarks,
            saves: featSaves,
            settings: featSettings,
            import: featImport,
            announcements: true,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusMsg({ text: data.error || "could not submit request.", ok: false });
        return;
      }
      if (data.oxiumOrigin) setOxiumOrigin(data.oxiumOrigin);
      setStatusMsg({
        text: `submitted ${data.partner?.name || cleanName} (${data.partner?.status || "pending"}).`,
        ok: true,
      });
      resetForm();
      await loadMySites();
      setModalTab("mysites");
    } catch {
      setStatusMsg({ text: "network error submitting request.", ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSiteEdit = async (e: Event) => {
    e.preventDefault();
    if (!editingSite) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/oxium/partner/update", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "same-origin",
        body: JSON.stringify({
          slug: editingSite.slug,
          tagline: editingSite.tagline,
          accentColor: editingSite.accentColor,
          logoUrl: editingSite.logoUrl,
          allowedOrigins: editingSite.allowedOrigins,
          links: editingSite.links,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setStatusMsg({ text: data.error || "update failed.", ok: false });
        return;
      }
      setEditingSite(null);
      setStatusMsg({ text: "updated partner site settings.", ok: true });
      await loadMySites();
    } catch {
      setStatusMsg({ text: "network error saving changes.", ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  const parsedLinks = parseLinksText(linksText);
  const displayName = name.trim() || "nebula arcade";
  const displaySlug = slug || "nebula-arcade";
  const displayTagline = tagline.trim() || "fast unblocked games with synced saves";
  const effectivePreviewUser = (previewUsername.trim() || "player").toLowerCase();

  const activeFeatureTags = [
    featBookmarks ? "bookmarks" : null,
    featSaves ? "saves" : null,
    featSettings ? "settings" : null,
    featImport ? "import" : null,
  ].filter(Boolean) as string[];

  const accentTextColor = (() => {
    const m = accentColor.replace("#", "");
    if (m.length !== 6) return "#000000";
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? "#000000" : "#ffffff";
  })();

  const modalNode =
    modalOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            id="oxium-portal-backdrop"
            class="oxp-backdrop"
            onClick={() => setModalOpen(false)}
          >
            <div
              id="oxium-portal-modal"
              class="oxp-modal"
              onClick={(e: Event) => e.stopPropagation()}
            >
              <div class="oxp-header">
                <div class="oxp-header-left">
                  <div>
                    <h2 class="oxp-title">oxium network</h2>
                    <div class="oxp-sub">one solution for building unblocked games websites</div>
                  </div>
                </div>

                <div class="oxp-header-tabs">
                  <button
                    type="button"
                    class={`oxp-tab-btn${modalTab === "request" ? " active" : ""}`}
                    onClick={() => setModalTab("request")}
                  >
                    request setup
                  </button>
                  <button
                    type="button"
                    class={`oxp-tab-btn${modalTab === "mysites" ? " active" : ""}`}
                    onClick={() => {
                      setModalTab("mysites");
                      void loadMySites();
                    }}
                  >
                    my sites ({mySites.length})
                  </button>
                  <a
                    href="/oxium/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="oxp-tab-btn"
                  >
                    docs
                  </a>
                  <button
                    type="button"
                    class="oxp-close-btn"
                    aria-label="Close Oxium"
                    onClick={() => setModalOpen(false)}
                  >
                    <i class="fa-solid fa-xmark" />
                  </button>
                </div>
              </div>

              {statusMsg && (
                <div class={`oxp-banner ${statusMsg.ok ? "ok" : "err"}`}>
                  {statusMsg.text}
                </div>
              )}

              <div class="oxp-scroll-body">
                {modalTab === "request" && (
                  <>
                    {/* PRIMARY OPTION: AI AGENT SETUP */}
                    <div class="oxp-agent-hero">
                      <div class="oxp-agent-hero-top">
                        <div>
                          <h3 class="oxp-agent-heading">Have an AI Agent? Have them set it up.</h3>
                          <p class="oxp-agent-desc">
                            recommended: paste this prompt into your coding agent inside your site folder. it pulls the setup spec, submits your site request securely, installs <code>oxium.js</code>, and wires save syncing.
                          </p>
                        </div>
                        <a
                          href="/oxium/docs"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="oxp-docs-link"
                        >
                          <span>full instructions</span>
                          <i class="fa-solid fa-arrow-up-right-from-square" />
                        </a>
                      </div>

                      <div class="oxp-prompt-box">
                        <code id="oxium-agent-prompt-text">{agentPromptText}</code>
                        <button
                          type="button"
                          id="oxium-copy-agent-prompt-btn"
                          class="oxp-copy-prompt-btn"
                          onClick={() =>
                            copyTextSafe(agentPromptText, () => {
                              setCopiedPrompt(true);
                              setTimeout(() => setCopiedPrompt(false), 1800);
                            })
                          }
                        >
                          {copiedPrompt ? "copied" : "copy prompt"}
                        </button>
                      </div>

                      <div class="oxp-agent-key-row">
                        <span class="oxp-key-hint">
                          optional: generate a 2h scoped setup key to link the agent request to your account without sharing your login token.
                        </span>
                        <div class="oxp-key-actions">
                          <button
                            type="button"
                            class="oxp-tab-btn"
                            disabled={mintingKey}
                            onClick={handleMintSetupKey}
                          >
                            {mintingKey ? "minting..." : "generate setup key"}
                          </button>
                          {setupKey && (
                            <button
                              type="button"
                              class="oxp-tab-btn active"
                              onClick={() =>
                                copyTextSafe(setupKey, () => {
                                  setCopiedKey(true);
                                  setTimeout(() => setCopiedKey(false), 1800);
                                })
                              }
                            >
                              {copiedKey ? "key copied" : "copy key"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div class="oxp-divider">
                      <span>or request &amp; customize manually</span>
                    </div>

                    {/* MANUAL FORM + INTERACTIVE LIVE PREVIEW */}
                    <form class="oxp-grid" onSubmit={handleSubmitRequest}>
                      <div class="oxp-form-col">
                        <div class="oxp-row two">
                          <div class="oxp-field">
                            <span class="oxp-label">site name *</span>
                            <input
                              type="text"
                              id="oxium-site-name"
                              class="oxp-input"
                              placeholder="nebula arcade"
                              value={name}
                              onInput={(e) => handleNameChange((e.target as HTMLInputElement).value)}
                              required
                            />
                          </div>
                          <div class="oxp-field">
                            <span class="oxp-label">site slug *</span>
                            <input
                              type="text"
                              id="oxium-site-slug"
                              class="oxp-input"
                              placeholder="nebula-arcade"
                              value={slug}
                              onInput={(e) => {
                                setSlugTouched(true);
                                setSlug(slugifySiteName((e.target as HTMLInputElement).value));
                              }}
                              required
                            />
                          </div>
                        </div>

                        <div class="oxp-field">
                          <span class="oxp-label">login tagline</span>
                          <input
                            type="text"
                            id="oxium-site-tagline"
                            class="oxp-input"
                            placeholder="fast unblocked games with synced saves"
                            value={tagline}
                            onInput={(e) => setTagline((e.target as HTMLInputElement).value)}
                          />
                        </div>

                        <div class="oxp-row two">
                          <div class="oxp-field">
                            <span class="oxp-label">allowed origins (one per line)</span>
                            <textarea
                              id="oxium-site-origins"
                              class="oxp-textarea"
                              rows={2}
                              placeholder="https://yoursite.com&#10;https://mirror.yoursite.org"
                              value={originsText}
                              onInput={(e) => setOriginsText((e.target as HTMLTextAreaElement).value)}
                            />
                          </div>
                          <div class="oxp-field">
                            <span class="oxp-label">mirror links (label | https://url)</span>
                            <textarea
                              id="oxium-site-links"
                              class="oxp-textarea"
                              rows={2}
                              placeholder="main | https://yoursite.com&#10;mirror | https://mirror.yoursite.org"
                              value={linksText}
                              onInput={(e) => setLinksText((e.target as HTMLTextAreaElement).value)}
                            />
                          </div>
                        </div>

                        <div class="oxp-row two">
                          <div class="oxp-field">
                            <span class="oxp-label">logo url (optional)</span>
                            <input
                              type="url"
                              class="oxp-input"
                              placeholder="https://.../logo.png"
                              value={logoUrl}
                              onInput={(e) => setLogoUrl((e.target as HTMLInputElement).value)}
                            />
                          </div>
                          <div class="oxp-field">
                            <span class="oxp-label">banner url (optional)</span>
                            <input
                              type="url"
                              class="oxp-input"
                              placeholder="https://.../banner.jpg"
                              value={bannerUrl}
                              onInput={(e) => setBannerUrl((e.target as HTMLInputElement).value)}
                            />
                          </div>
                        </div>

                        <div class="oxp-row three">
                          <div class="oxp-field">
                            <span class="oxp-label">button / brand accent</span>
                            <div class="oxp-color-row">
                              <input
                                type="color"
                                value={accentColor}
                                onInput={(e) => setAccentColor((e.target as HTMLInputElement).value)}
                              />
                              <input
                                type="text"
                                class="oxp-input"
                                value={accentColor}
                                onInput={(e) => setAccentColor((e.target as HTMLInputElement).value)}
                              />
                            </div>
                          </div>
                          <div class="oxp-field">
                            <span class="oxp-label">login surface</span>
                            <select
                              class="oxp-input"
                              value={themeMode}
                              onChange={(e) =>
                                setThemeMode(
                                  (e.target as HTMLSelectElement).value as "dark" | "midnight" | "light",
                                )
                              }
                            >
                              <option value="dark">dark matte</option>
                              <option value="midnight">pure black</option>
                              <option value="light">light paper</option>
                            </select>
                          </div>
                          <div class="oxp-field">
                            <span class="oxp-label">contact (discord / email)</span>
                            <input
                              type="text"
                              class="oxp-input"
                              placeholder="@handle or email"
                              value={contact}
                              onInput={(e) => setContact((e.target as HTMLInputElement).value)}
                            />
                          </div>
                        </div>

                        <div class="oxp-field">
                          <span class="oxp-label">localStorage sync keys (optional)</span>
                          <input
                            type="text"
                            class="oxp-input"
                            placeholder="favorites, saves, theme"
                            value={syncKeysText}
                            onInput={(e) => setSyncKeysText((e.target as HTMLInputElement).value)}
                          />
                        </div>

                        <div class="oxp-checks">
                          <label class="oxp-check">
                            <input
                              type="checkbox"
                              checked={featBookmarks}
                              onChange={(e) => setFeatBookmarks((e.target as HTMLInputElement).checked)}
                            />
                            <span>bookmarks</span>
                          </label>
                          <label class="oxp-check">
                            <input
                              type="checkbox"
                              checked={featSaves}
                              onChange={(e) => setFeatSaves((e.target as HTMLInputElement).checked)}
                            />
                            <span>game saves</span>
                          </label>
                          <label class="oxp-check">
                            <input
                              type="checkbox"
                              checked={featSettings}
                              onChange={(e) => setFeatSettings((e.target as HTMLInputElement).checked)}
                            />
                            <span>settings</span>
                          </label>
                          <label class="oxp-check">
                            <input
                              type="checkbox"
                              checked={featImport}
                              onChange={(e) => setFeatImport((e.target as HTMLInputElement).checked)}
                            />
                            <span>cross-site import</span>
                          </label>
                        </div>

                        <button
                          type="submit"
                          id="oxium-submit-request-btn"
                          class="oxp-submit-btn"
                          disabled={submitting}
                        >
                          {submitting ? "submitting request..." : "submit partner request"}
                        </button>
                      </div>

                      {/* INTERACTIVE LOGIN & WIDGET PREVIEW */}
                      <div class="oxp-preview-col">
                        <div class="oxp-preview-toolbar">
                          <div class="oxp-preview-screens">
                            <button
                              type="button"
                              class={`oxp-mini-pill${previewScreen === "auth" ? " active" : ""}`}
                              onClick={() => {
                                setPreviewDoneNote("");
                                setPreviewScreen("auth");
                              }}
                            >
                              login page
                            </button>
                            <button
                              type="button"
                              class={`oxp-mini-pill${previewScreen === "import" ? " active" : ""}`}
                              onClick={() => {
                                setPreviewDoneNote("");
                                setPreviewScreen("import");
                              }}
                            >
                              import data
                            </button>
                            <button
                              type="button"
                              class={`oxp-mini-pill${previewScreen === "insite" ? " active" : ""}`}
                              onClick={() => setPreviewScreen("insite")}
                            >
                              on-site widget
                            </button>
                          </div>
                          <div class="oxp-theme-dots" title="Preview surface theme">
                            {(["dark", "midnight", "light"] as const).map((tm) => (
                              <button
                                key={tm}
                                type="button"
                                class={`oxp-theme-dot ${tm}${themeMode === tm ? " active" : ""}`}
                                onClick={() => setThemeMode(tm)}
                                aria-label={`Preview ${tm}`}
                              />
                            ))}
                          </div>
                        </div>

                        <div
                          class={`oxp-browser ${themeMode}`}
                          style={
                            {
                              "--ox-accent": accentColor,
                              "--ox-accent-text": accentTextColor,
                            } as any
                          }
                        >
                          <div class="oxp-browser-bar">
                            <i class="fa-solid fa-lock" />
                            <span class="oxp-url-text">
                              {previewScreen === "insite"
                                ? `${displaySlug}.com`
                                : `operationcookie.com/oxium/auth?site=${displaySlug}`}
                            </span>
                            <span class="oxp-url-badge">
                              {parsedLinks.length > 0 ? `${parsedLinks.length} links` : "interactive"}
                            </span>
                          </div>

                          {previewScreen === "auth" && (
                            <div class="oxp-stage-auth">
                              <div
                                class="oxp-stage-hero"
                                style={
                                  bannerUrl
                                    ? {
                                        backgroundImage: `linear-gradient(180deg, rgba(5,5,5,0.2), rgba(5,5,5,0.88)), url(${bannerUrl})`,
                                      }
                                    : undefined
                                }
                              >
                                <span class="oxp-chip">oxium sso</span>
                                {parsedLinks.length > 0 && (
                                  <span class="oxp-chip">
                                    {parsedLinks[0].label}
                                  </span>
                                )}
                              </div>

                              <div class="oxp-stage-card">
                                <div class="oxp-stage-brand">
                                  {logoUrl ? (
                                    <img src={logoUrl} alt="" class="oxp-stage-logo" />
                                  ) : (
                                    <div class="oxp-stage-logo-fallback">
                                      {displayName.slice(0, 1).toUpperCase()}
                                    </div>
                                  )}
                                  <div class="oxp-stage-brand-meta">
                                    <div class="oxp-stage-title">{displayName}</div>
                                    <div class="oxp-stage-tag">{displayTagline}</div>
                                  </div>
                                </div>

                                <div class="oxp-auth-switch">
                                  <button
                                    type="button"
                                    class={previewAuthTab === "signin" ? "active" : ""}
                                    onClick={() => setPreviewAuthTab("signin")}
                                  >
                                    sign in
                                  </button>
                                  <button
                                    type="button"
                                    class={previewAuthTab === "signup" ? "active" : ""}
                                    onClick={() => setPreviewAuthTab("signup")}
                                  >
                                    sign up
                                  </button>
                                </div>

                                <input
                                  type="text"
                                  class="oxp-prev-input"
                                  placeholder={
                                    previewAuthTab === "signin"
                                      ? "oxium username (try typing...)"
                                      : "pick a username (3-20 chars)"
                                  }
                                  value={previewUsername}
                                  onInput={(e) =>
                                    setPreviewUsername((e.target as HTMLInputElement).value)
                                  }
                                />
                                <input
                                  type="password"
                                  class="oxp-prev-input"
                                  placeholder={
                                    previewAuthTab === "signin" ? "password" : "password (8+ chars)"
                                  }
                                  value={previewPassword}
                                  onInput={(e) =>
                                    setPreviewPassword((e.target as HTMLInputElement).value)
                                  }
                                />

                                <button
                                  type="button"
                                  class="oxp-prev-cta"
                                  onClick={() => setPreviewScreen("import")}
                                >
                                  {previewAuthTab === "signin"
                                    ? `sign in to ${displayName}`
                                    : `create account for ${displayName}`}
                                </button>

                                {activeFeatureTags.length > 0 && (
                                  <div class="oxp-stage-footer-note">
                                    syncs: {activeFeatureTags.join(" · ")}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {previewScreen === "import" && (
                            <div class="oxp-stage-import">
                              <div class="oxp-user-row">
                                <div class="oxp-user-av">
                                  {effectivePreviewUser.slice(0, 1)}
                                </div>
                                <div class="oxp-user-meta">
                                  <strong>@{effectivePreviewUser}</strong>
                                  <span>signed into oxium network</span>
                                </div>
                                <button
                                  type="button"
                                  class="oxp-mini-pill"
                                  onClick={() => setPreviewScreen("auth")}
                                >
                                  switch
                                </button>
                              </div>

                              <div class="oxp-prev-block">
                                <span class="oxp-label">import saves &amp; settings from</span>
                                <select
                                  class="oxp-prev-select"
                                  value={previewImportSource}
                                  onChange={(e) =>
                                    setPreviewImportSource((e.target as HTMLSelectElement).value)
                                  }
                                >
                                  <option value="operation-cookie">operation cookie (18 items)</option>
                                  <option value="none">start fresh (no import)</option>
                                </select>
                                <span class="oxp-stage-footer-note">
                                  tokens &amp; passwords are always stripped automatically
                                </span>
                              </div>

                              <label class="oxp-check">
                                <input
                                  type="checkbox"
                                  checked={previewNotify}
                                  onChange={(e) =>
                                    setPreviewNotify((e.target as HTMLInputElement).checked)
                                  }
                                />
                                <span>notify me about new mirrors &amp; sites</span>
                              </label>

                              <button
                                type="button"
                                class="oxp-prev-cta"
                                onClick={() => {
                                  setPreviewDoneNote(
                                    previewImportSource === "none"
                                      ? `authorized @${effectivePreviewUser} on ${displayName}`
                                      : `authorized + imported 18 items from operation cookie`,
                                  );
                                  setPreviewScreen("insite");
                                }}
                              >
                                continue to {displayName}
                              </button>
                            </div>
                          )}

                          {previewScreen === "insite" && (
                            <div class="oxp-stage-insite">
                              <div class="oxp-insite-top">
                                <span>{displayName}</span>
                                <span class="oxp-insite-nav">
                                  {parsedLinks.length > 0 ? parsedLinks[0].label : "games · search"}
                                </span>
                              </div>

                              {previewDoneNote && (
                                <div class="oxp-prev-status">{previewDoneNote}</div>
                              )}

                              <div class="oxp-push-toast">
                                <div class="oxp-push-t1">like operation cookie?</div>
                                <div class="oxp-push-t2">
                                  try out {displayName}. click here for links.
                                </div>
                                <span class="oxp-push-btn">click here for links</span>
                              </div>

                              <button
                                type="button"
                                class="oxp-bottom-widget"
                                onClick={() => setPreviewScreen("auth")}
                              >
                                <span class="oxp-w-dot" />
                                <span>@{effectivePreviewUser} · synced</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </form>
                  </>
                )}

                {modalTab === "mysites" && (
                  <div class="oxp-mysites">
                    {loadingSites ? (
                      <div class="oxp-card"><p>loading your oxium partner requests...</p></div>
                    ) : mySites.length === 0 ? (
                      <div class="oxp-card">
                        <h4>no partner requests yet</h4>
                        <p>
                          use the ai agent setup option or manual form in request setup to register a games website.
                        </p>
                      </div>
                    ) : (
                      mySites.map((site) => {
                        const snippet = `<script src="${oxiumOrigin}/oxium.js" data-site="${site.slug}"></script>`;
                        const isEditing = editingSite?.slug === site.slug;
                        return (
                          <div key={site.slug} class="oxp-card">
                            <div class="oxp-site-top">
                              <div>
                                <h4>{site.name}</h4>
                                <span class="oxp-site-slug">/{site.slug}</span>
                              </div>
                              <span class={`oxp-status-pill ${site.status}`}>
                                {site.status}
                              </span>
                            </div>

                            {site.tagline && <p class="oxp-site-tag">{site.tagline}</p>}
                            {site.status === "rejected" && site.rejectReason && (
                              <p class="oxp-reject-note">reason: {site.rejectReason}</p>
                            )}

                            <div class="oxp-snippet-box">
                              <code>{snippet}</code>
                              <button
                                type="button"
                                class="oxp-tab-btn"
                                onClick={() =>
                                  copyTextSafe(snippet, () => {
                                    setCopiedSlug(site.slug);
                                    setTimeout(() => setCopiedSlug(""), 1800);
                                  })
                                }
                              >
                                {copiedSlug === site.slug ? "copied" : "copy"}
                              </button>
                            </div>

                            <div class="oxp-site-actions">
                              <a
                                href={`/oxium/auth?site=${encodeURIComponent(site.slug)}&preview=1`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="oxp-tab-btn"
                              >
                                preview login
                              </a>
                              <a
                                href={`/oxium/links/${encodeURIComponent(site.slug)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="oxp-tab-btn"
                              >
                                links page
                              </a>
                              <button
                                type="button"
                                class="oxp-tab-btn"
                                onClick={() =>
                                  setEditingSite(
                                    isEditing ? null : { ...site, links: [...site.links] },
                                  )
                                }
                              >
                                {isEditing ? "cancel" : "edit links"}
                              </button>
                            </div>

                            {isEditing && editingSite && (
                              <form class="oxp-edit-inline" onSubmit={handleSaveSiteEdit}>
                                <div class="oxp-field">
                                  <span class="oxp-label">tagline</span>
                                  <input
                                    type="text"
                                    class="oxp-input"
                                    value={editingSite.tagline}
                                    onInput={(e) =>
                                      setEditingSite({
                                        ...editingSite,
                                        tagline: (e.target as HTMLInputElement).value,
                                      })
                                    }
                                  />
                                </div>
                                <div class="oxp-field">
                                  <span class="oxp-label">links (label | https://url per line)</span>
                                  <textarea
                                    class="oxp-textarea"
                                    rows={2}
                                    value={editingSite.links
                                      .map((l) => `${l.label} | ${l.url}`)
                                      .join("\n")}
                                    onInput={(e) =>
                                      setEditingSite({
                                        ...editingSite,
                                        links: parseLinksText(
                                          (e.target as HTMLTextAreaElement).value,
                                        ),
                                      })
                                    }
                                  />
                                </div>
                                <button type="submit" class="oxp-submit-btn" disabled={submitting}>
                                  save changes
                                </button>
                              </form>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div class="settings-item oxium-settings-item">
      <label>Oxium</label>
      <p>one solution for building unblocked games websites</p>

      <div class="oxium-settings-actions">
        <button
          type="button"
          id="open-oxium-request-btn"
          class="legal-pill-btn oxium-primary-pill"
          onClick={() => {
            setStatusMsg(null);
            setModalTab("request");
            setModalOpen(true);
          }}
        >
          <i class="fa-solid fa-cubes" />
          <span>setup &amp; request integration</span>
        </button>

        <a
          href="/oxium/docs"
          target="_blank"
          rel="noopener noreferrer"
          class="legal-pill-btn"
        >
          <i class="fa-solid fa-book" />
          <span>docs</span>
        </a>

        {mySites.length > 0 && (
          <button
            type="button"
            class="legal-pill-btn"
            onClick={() => {
              setStatusMsg(null);
              setModalTab("mysites");
              setModalOpen(true);
            }}
          >
            <i class="fa-solid fa-layer-group" />
            <span>my sites ({mySites.length})</span>
          </button>
        )}

        <a
          href="/oxium/links"
          target="_blank"
          rel="noopener noreferrer"
          class="legal-pill-btn"
        >
          <i class="fa-solid fa-arrow-up-right-from-square" />
          <span>network links</span>
        </a>
      </div>

      {modalNode}
    </div>
  );
}
