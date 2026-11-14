import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { showHomeView } from "../state/store.ts";
import {
  COOKIE_MASTER_DAILY_COINS,
  CookieMasterState,
  canClaimDailyMasterCoins,
  claimDailyMasterCoins,
  formatDurationCompact,
  getCookieCoins,
  getCookieMasterState,
  getNextDailyClaimRemainingMs,
  setCookieMasterState,
  syncAdFreeDomClass,
} from "../core/cookieCoins.ts";

interface MasterConfig {
  configured: boolean;
  checkoutUrl: string;
  hasLicenseVerification: boolean;
  priceMonthly: number;
  dailyCoins: number;
}

const DEFAULT_CONFIG: MasterConfig = {
  configured: false,
  checkoutUrl: "",
  hasLicenseVerification: false,
  priceMonthly: 5,
  dailyCoins: COOKIE_MASTER_DAILY_COINS,
};

const REVERIFY_INTERVAL_MS = 12 * 60 * 60 * 1000;

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

let gumroadScriptPromise: Promise<void> | null = null;
function ensureGumroadOverlayScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (document.getElementById("sunshine-gumroad-js")) {
    return gumroadScriptPromise || Promise.resolve();
  }
  gumroadScriptPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = "sunshine-gumroad-js";
    script.src = "https://gumroad.com/js/gumroad.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  return gumroadScriptPromise;
}

function maskLicenseKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 4)}-${"•".repeat(6)}-${clean.slice(-4)}`;
}

export default function CookieMasterPage() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  const [coins, setCoins] = useState<number>(() => getCookieCoins());
  const [masterState, setMasterState] = useState<CookieMasterState | null>(() =>
    getCookieMasterState()
  );
  const [config, setConfig] = useState<MasterConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [licenseInput, setLicenseInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimRemainingMs, setClaimRemainingMs] = useState<number>(() =>
    getNextDailyClaimRemainingMs()
  );

  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverifiedRef = useRef(false);

  const refreshState = useCallback(() => {
    syncAdFreeDomClass();
    setCoins(getCookieCoins());
    setMasterState(getCookieMasterState());
    setClaimRemainingMs(getNextDailyClaimRemainingMs());
  }, []);

  const hide = useCallback(() => {
    if (!document.body.classList.contains("master-view")) return;
    setActive(false);

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setVisible(false);
      document.body.classList.remove("master-view");
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
    if (document.body.classList.contains("studio-view") && (window as any).hideStudioMenu) {
      (window as any).hideStudioMenu();
    }
    if (document.body.classList.contains("shop-view") && (window as any).hideShopMenu) {
      (window as any).hideShopMenu();
    }

    showHomeView();
    document.body.classList.add("master-view");
    setVisible(true);
    refreshState();

    requestAnimationFrame(() => {
      setActive(true);
    });
  }, [refreshState]);

  const toggle = useCallback(() => {
    if (document.body.classList.contains("master-view")) hide();
    else show();
  }, [show, hide]);

  useEffect(() => {
    (window as any).showMasterMenu = show;
    (window as any).hideMasterMenu = hide;
    (window as any).toggleMasterMenu = toggle;

    const masterBtn = document.getElementById("master-btn");
    const brand =
      document.getElementById("branding-container") ||
      document.getElementById("brand");

    const onMasterClick = (e: MouseEvent) => {
      e.preventDefault();
      toggle();
    };
    const onBrandClick = (e: MouseEvent) => {
      e.preventDefault();
      if (document.body.classList.contains("master-view")) hide();
    };

    if (masterBtn) masterBtn.addEventListener("click", onMasterClick);
    if (brand) brand.addEventListener("click", onBrandClick);

    window.addEventListener("cookie-coins-updated", refreshState);
    window.addEventListener("cookie-master-changed", refreshState);
    document.addEventListener("cloudsync-restored", refreshState);

    return () => {
      if (masterBtn) masterBtn.removeEventListener("click", onMasterClick);
      if (brand) brand.removeEventListener("click", onBrandClick);
      window.removeEventListener("cookie-coins-updated", refreshState);
      window.removeEventListener("cookie-master-changed", refreshState);
      document.removeEventListener("cloudsync-restored", refreshState);
    };
  }, [show, hide, toggle, refreshState]);

  // Fetch Gumroad config when the Cookie Master page opens
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetch("/api/cookie-master/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const next: MasterConfig = {
          configured: Boolean(data.configured),
          checkoutUrl: typeof data.checkoutUrl === "string" ? data.checkoutUrl : "",
          hasLicenseVerification: Boolean(data.hasLicenseVerification),
          priceMonthly: Number(data.priceMonthly) || 5,
          dailyCoins: Number(data.dailyCoins) || COOKIE_MASTER_DAILY_COINS,
        };
        setConfig(next);
        setConfigLoaded(true);
        if (next.configured && next.checkoutUrl) {
          void ensureGumroadOverlayScript();
        }
      })
      .catch(() => {
        if (!cancelled) setConfigLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Escape closes page and refresh daily claim timer every 30s while open
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    const timer = window.setInterval(() => {
      setClaimRemainingMs(getNextDailyClaimRemainingMs());
    }, 30000);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearInterval(timer);
    };
  }, [visible, hide]);

  // Background re-check for existing active license when stale (>12h)
  useEffect(() => {
    if (!visible || !config.hasLicenseVerification || reverifiedRef.current) return;
    const current = getCookieMasterState();
    if (!current?.active || !current.licenseKey) return;
    if (Date.now() - current.verifiedAt < REVERIFY_INTERVAL_MS) return;

    reverifiedRef.current = true;
    fetch("/api/cookie-master/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey: current.licenseKey, incrementUses: false }),
    })
      .then((r) => r.json().then((d) => ({ status: r.status, data: d })))
      .then(({ status, data }) => {
        if (status === 400 || status === 403) {
          setCookieMasterState(null);
          notifyToast(
            data?.error || "Your Cookie Master subscription is no longer active.",
            "info"
          );
        } else if (data?.success && data?.active) {
          setCookieMasterState({
            ...current,
            active: true,
            email: data.email || current.email,
            cancelledAt: data.cancelledAt || null,
            verifiedAt: Date.now(),
          });
        }
      })
      .catch(() => {});
  }, [visible, config.hasLicenseVerification]);

  const verifyAndActivate = async (keyToVerify: string, incrementUses: boolean) => {
    const trimmed = keyToVerify.trim();
    if (!trimmed) {
      notifyToast("paste your gumroad license key first", "error");
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch("/api/cookie-master/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey: trimmed, incrementUses }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.active) {
        notifyToast(
          data?.error || "could not verify that gumroad license key",
          "error"
        );
        return;
      }

      const prev = getCookieMasterState();
      setCookieMasterState({
        active: true,
        licenseKey: trimmed,
        email: typeof data.email === "string" ? data.email : prev?.email,
        verifiedAt: Date.now(),
        cancelledAt: data.cancelledAt || null,
        lastDailyClaimAt: prev?.lastDailyClaimAt || 0,
      });
      setLicenseInput("");
      notifyToast(
        "cookie master activated! ad-free mode & daily cookie coins unlocked",
        "success"
      );
    } catch {
      notifyToast("failed to reach verification server — try again", "error");
    } finally {
      setVerifying(false);
    }
  };

  const handleActivateSubmit = (e: Event) => {
    e.preventDefault();
    void verifyAndActivate(licenseInput, true);
  };

  const handleClaimDaily = () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const result = claimDailyMasterCoins();
      if (result.claimed) {
        setCoins(result.nextBalance);
        setClaimRemainingMs(result.remainingMs);
      } else {
        notifyToast(
          `daily coins ready in ${formatDurationCompact(result.remainingMs)}`,
          "info"
        );
      }
    } finally {
      setClaiming(false);
    }
  };

  const handleDeactivateDevice = () => {
    setCookieMasterState(null);
    notifyToast("cookie master removed from this browser session", "info");
  };

  if (!visible) return null;

  const isActiveMaster = Boolean(masterState?.active);
  const canClaimNow = canClaimDailyMasterCoins();
  const dailyCoinsAmount = config.dailyCoins || COOKIE_MASTER_DAILY_COINS;

  return (
    <section
      id="cookie-master-page"
      class={`studio-page${visible ? " is-visible" : ""}${active ? " is-active" : ""}`}
      aria-hidden={!visible}
      style={{ maxWidth: "980px" }}
    >
      {/* Top Bar */}
      <div class="studio-topbar" style={{ marginBottom: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <div class="studio-brand">
            <i class="fa-solid fa-crown" style={{ color: "#fbbf24" }}></i>
            <span>cookie master</span>
          </div>
          <span class="app-proxy-badge" style={{ fontSize: "11px" }}>
            ${config.priceMonthly} / month
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div
            class="studio-tab-btn active"
            style={{ cursor: "default", fontWeight: 600 }}
          >
            <i class="fa-solid fa-coins"></i>
            <span>{coins.toLocaleString()} coins</span>
          </div>

          <div
            class="studio-tab-btn"
            style={{
              cursor: "default",
              color: isActiveMaster ? "#4ade80" : "var(--color-sublabel)",
              borderColor: isActiveMaster ? "rgba(74, 222, 128, 0.35)" : undefined,
            }}
          >
            <i class={`fa-solid ${isActiveMaster ? "fa-circle-check" : "fa-circle-dot"}`}></i>
            <span>{isActiveMaster ? "active member" : "free tier"}</span>
          </div>

          <button
            type="button"
            class="studio-tab-btn"
            onClick={() => {
              hide();
              (window as any).showShopMenu?.();
            }}
          >
            <i class="fa-solid fa-cookie-bite"></i>
            <span>cookie shop</span>
          </button>
        </div>
      </div>

      {/* Product Hero Card (Native Operation Cookie Product Page + Gumroad Checkout) */}
      <div
        class="studio-panel"
        style={{
          padding: "24px",
          gap: "20px",
          background:
            "linear-gradient(145deg, var(--bg-surface-3) 0%, var(--bg-surface-2) 100%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <div
                class="app-icon-box"
                style={{
                  width: "44px",
                  height: "44px",
                  borderRadius: "12px",
                  fontSize: "20px",
                  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                }}
              >
                <i class="fa-solid fa-crown"></i>
              </div>
              <div>
                <h1
                  style={{
                    margin: 0,
                    fontSize: "22px",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    textTransform: "lowercase",
                    letterSpacing: "-0.01em",
                  }}
                >
                  cookie master pass
                </h1>
                <p
                  style={{
                    margin: "3px 0 0",
                    fontSize: "12.5px",
                    color: "var(--color-sublabel)",
                    textTransform: "lowercase",
                  }}
                >
                  monthly membership · ad-free operation cookie, daily coins & upcoming perks
                </p>
              </div>
            </div>

            <p
              style={{
                margin: "4px 0 0",
                fontSize: "13px",
                lineHeight: 1.5,
                color: "var(--color-sublabel)",
                textTransform: "lowercase",
                maxWidth: "560px",
              }}
            >
              upgrade your account with one simple monthly subscription. checkout runs securely
              through gumroad checkout, then paste your receipt license key right below to unlock
              cookie master immediately across CloudSync.
            </p>
          </div>

          <div
            style={{
              flex: "0 1 280px",
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              gap: "10px",
              padding: "16px",
              borderRadius: "13px",
              background: "var(--bg-surface-4)",
              border: "1px solid var(--bg-surface-10)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span
                style={{
                  fontSize: "28px",
                  fontWeight: 700,
                  color: "var(--text-primary)",
                }}
              >
                ${config.priceMonthly}
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 400,
                    color: "var(--color-sublabel)",
                    marginLeft: "4px",
                  }}
                >
                  / month
                </span>
              </span>
              <span class="app-proxy-badge">cancel anytime</span>
            </div>

            {config.configured && config.checkoutUrl ? (
              <a
                href={config.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-gumroad-single-product="true"
                class="apps-custom-btn"
                style={{
                  justifyContent: "center",
                  padding: "12px 16px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  textDecoration: "none",
                  textAlign: "center",
                }}
              >
                <i class="fa-solid fa-crown"></i>
                <span>
                  {isActiveMaster ? "manage / buy another pass" : "buy cookie master — $5/mo"}
                </span>
              </a>
            ) : (
              <button
                type="button"
                class="apps-custom-btn"
                style={{
                  justifyContent: "center",
                  padding: "12px 16px",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  opacity: configLoaded ? 0.85 : 0.65,
                }}
                onClick={() =>
                  notifyToast(
                    "Set GUMROAD_CHECKOUT_URL (and GUMROAD_PRODUCT_ID) on the server to open live Gumroad checkout.",
                    "info"
                  )
                }
              >
                <i class="fa-solid fa-crown"></i>
                <span>
                  {configLoaded ? "gumroad checkout not configured yet" : "loading checkout..."}
                </span>
              </button>
            )}

            <div
              style={{
                fontSize: "11px",
                color: "var(--color-sublabel)",
                textAlign: "center",
                textTransform: "lowercase",
              }}
            >
              powered by gumroad checkout · instant license key
            </div>
          </div>
        </div>

        {/* 3 Included Perks */}
        <div
          class="studio-community-grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
          }}
        >
          <article class="studio-game-card" style={{ padding: "15px", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                class="app-icon-box"
                style={{ width: "34px", height: "34px", borderRadius: "10px", fontSize: "15px" }}
              >
                <i class="fa-solid fa-shield-halved"></i>
              </div>
              <h3 class="app-card-title" style={{ fontSize: "14px" }}>
                ad-free operation cookie
              </h3>
            </div>
            <p class="app-card-desc">
              browse the homepage, play games, and switch themes with zero ads as long as your
              cookie master subscription stays active.
            </p>
          </article>

          <article class="studio-game-card" style={{ padding: "15px", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                class="app-icon-box"
                style={{ width: "34px", height: "34px", borderRadius: "10px", fontSize: "15px" }}
              >
                <i class="fa-solid fa-coins"></i>
              </div>
              <h3 class="app-card-title" style={{ fontSize: "14px" }}>
                daily cookie coins (+{dailyCoinsAmount.toLocaleString()})
              </h3>
            </div>
            <p class="app-card-desc">
              claim {dailyCoinsAmount.toLocaleString()} free cookie coins every 24 hours to trigger
              targeted trolls or stack extra rewards in cookie shop.
            </p>
          </article>

          <article class="studio-game-card" style={{ padding: "15px", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                class="app-icon-box"
                style={{ width: "34px", height: "34px", borderRadius: "10px", fontSize: "15px" }}
              >
                <i class="fa-solid fa-wand-magic-sparkles"></i>
              </div>
              <h3 class="app-card-title" style={{ fontSize: "14px" }}>
                soon to come
              </h3>
            </div>
            <p class="app-card-desc">
              early access to upcoming cookie master member drops, exclusive custom badges, and new
              features as they roll out.
            </p>
          </article>
        </div>
      </div>

      {/* Member Activation / Daily Coins Panel */}
      {isActiveMaster ? (
        <div
          class="studio-panel"
          style={{
            padding: "18px 20px",
            gap: "14px",
            borderColor: "rgba(74, 222, 128, 0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "14.5px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  textTransform: "lowercase",
                }}
              >
                <i class="fa-solid fa-circle-check" style={{ color: "#4ade80" }}></i>
                <span>cookie master is active on your account</span>
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--color-sublabel)",
                  textTransform: "lowercase",
                }}
              >
                license: {maskLicenseKey(masterState?.licenseKey || "")}
                {masterState?.email ? ` · ${masterState.email}` : ""}
                {masterState?.cancelledAt ? " · cancelled (active until period ends)" : ""}
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                class="apps-custom-btn"
                disabled={!canClaimNow || claiming}
                style={{
                  opacity: canClaimNow && !claiming ? 1 : 0.6,
                  cursor: canClaimNow && !claiming ? "pointer" : "not-allowed",
                }}
                onClick={handleClaimDaily}
              >
                <i class="fa-solid fa-gift"></i>
                <span>
                  {canClaimNow
                    ? `claim +${dailyCoinsAmount.toLocaleString()} daily coins`
                    : `next daily claim in ${formatDurationCompact(claimRemainingMs)}`}
                </span>
              </button>

              {config.hasLicenseVerification && masterState?.licenseKey && (
                <button
                  type="button"
                  class="studio-tab-btn"
                  disabled={verifying}
                  onClick={() => void verifyAndActivate(masterState.licenseKey, false)}
                >
                  <i class="fa-solid fa-rotate"></i>
                  <span>{verifying ? "checking..." : "re-verify"}</span>
                </button>
              )}

              <button
                type="button"
                class="studio-tab-btn"
                onClick={handleDeactivateDevice}
              >
                <i class="fa-solid fa-right-from-bracket"></i>
                <span>unlink key</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div class="apps-custom-launcher" style={{ padding: "16px 18px" }}>
          <div class="apps-custom-launcher-label">
            <i class="fa-solid fa-key"></i>
            <span>already checked out on gumroad? paste your license key to activate</span>
          </div>

          <form
            class="apps-custom-launcher-form"
            style={{ maxWidth: "460px" }}
            onSubmit={handleActivateSubmit}
          >
            <input
              type="text"
              class="apps-custom-input"
              placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
              value={licenseInput}
              onInput={(e) => setLicenseInput((e.target as HTMLInputElement).value)}
              disabled={verifying}
            />
            <button
              type="submit"
              class="apps-custom-btn"
              disabled={verifying}
              style={{
                opacity: verifying ? 0.65 : 1,
                cursor: verifying ? "wait" : "pointer",
              }}
            >
              <i class="fa-solid fa-bolt"></i>
              <span>{verifying ? "verifying..." : "activate pass"}</span>
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
