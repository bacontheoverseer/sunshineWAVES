import { useCallback, useEffect, useState } from "preact/hooks";
import { getCookieCoins, isCookieMasterActive } from "../core/cookieCoins.ts";
import { isChromebookModeEnabled } from "../core/chromebookMode.ts";
import {
  type ProfileCustomization,
  getSafeMediaProxySrc,
  loadLocalProfileCustomization,
  sanitizeCustomization,
  saveLocalProfileCustomization,
} from "../core/profileCustomization.ts";
import {
  NameplateMediaLayer,
  UserAvatar,
  getNameClasses,
} from "./ProfileBadgeVisuals.tsx";

function readAuthUsername(): string {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return "";
    const user = JSON.parse(raw) as { username?: unknown };
    return typeof user?.username === "string" ? user.username.trim() : "";
  } catch {
    return "";
  }
}

export default function TopBar() {
  const [coins, setCoins] = useState<number>(() => getCookieCoins());
  const [masterActive, setMasterActive] = useState<boolean>(() =>
    isCookieMasterActive()
  );
  const [username, setUsername] = useState<string>(() => readAuthUsername());
  const [custom, setCustom] = useState<ProfileCustomization | null>(() => {
    const uname = readAuthUsername();
    return uname ? loadLocalProfileCustomization(uname) : null;
  });

  const syncProfile = useCallback(async (targetUser: string, fetchRemote: boolean) => {
    if (!targetUser) {
      setCustom(null);
      return;
    }
    const cached = loadLocalProfileCustomization(targetUser);
    if (cached) setCustom(cached);
    if (!fetchRemote) return;
    try {
      const res = await fetch(
        `/api/chat/user-profile?username=${encodeURIComponent(targetUser)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.profile?.customization) {
        const clean = sanitizeCustomization(data.profile.customization, targetUser);
        saveLocalProfileCustomization(targetUser, clean);
        setCustom(clean);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const initialUser = readAuthUsername();
    if (initialUser) {
      void syncProfile(initialUser, true);
    }

    const onCoins = () => setCoins(getCookieCoins());
    const onMasterChanged = () => setMasterActive(isCookieMasterActive());
    const onAuthChanged = (e: Event) => {
      const detail = (e as CustomEvent<{ username?: unknown } | null>).detail;
      const nextUser =
        detail === null
          ? ""
          : typeof detail?.username === "string"
            ? detail.username.trim()
            : readAuthUsername();
      setUsername(nextUser);
      void syncProfile(nextUser, true);
    };
    const onCloudRestored = () => {
      setMasterActive(isCookieMasterActive());
      const nextUser = readAuthUsername();
      setUsername(nextUser);
      void syncProfile(nextUser, true);
    };
    const onProfileUpdated = (e: Event) => {
      const detail = (
        e as CustomEvent<{ username?: string; customization?: ProfileCustomization }>
      ).detail;
      const active = readAuthUsername();
      if (!active || !detail?.username) return;
      if (detail.username.toLowerCase() !== active.toLowerCase()) return;
      if (detail.customization) {
        const clean = sanitizeCustomization(detail.customization, active);
        saveLocalProfileCustomization(active, clean);
        setCustom(clean);
      }
    };
    const onSseChat = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          event?: string;
          type?: string;
          username?: string;
          customization?: ProfileCustomization;
        }>
      ).detail;
      if (!detail || (detail.event || detail.type) !== "PROFILE_UPDATED") return;
      const active = readAuthUsername();
      if (!active || !detail.username) return;
      if (detail.username.toLowerCase() !== active.toLowerCase()) return;
      if (detail.customization) {
        const clean = sanitizeCustomization(detail.customization, active);
        saveLocalProfileCustomization(active, clean);
        setCustom(clean);
      }
    };
    const onStorage = (e: StorageEvent) => {
      setCoins(getCookieCoins());
      if (
        !e.key ||
        e.key === "auth_user" ||
        e.key.startsWith("cookie_profile_custom_v1:")
      ) {
        const nextUser = readAuthUsername();
        setUsername(nextUser);
        void syncProfile(nextUser, false);
      }
    };

    window.addEventListener("cookie-coins-updated", onCoins);
    window.addEventListener("storage", onStorage);
    window.addEventListener("cookie-master-changed", onMasterChanged);
    document.addEventListener("cloudsync-restored", onCloudRestored);
    window.addEventListener("cloudsync-auth-changed", onAuthChanged);
    window.addEventListener("sunshine-profile-customization-updated", onProfileUpdated);
    window.addEventListener("sunshine-chat-event", onSseChat);
    return () => {
      window.removeEventListener("cookie-coins-updated", onCoins);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("cookie-master-changed", onMasterChanged);
      document.removeEventListener("cloudsync-restored", onCloudRestored);
      window.removeEventListener("cloudsync-auth-changed", onAuthChanged);
      window.removeEventListener("sunshine-profile-customization-updated", onProfileUpdated);
      window.removeEventListener("sunshine-chat-event", onSseChat);
    };
  }, [syncProfile]);

  const displayName = username ? custom?.displayName?.trim() || username : "cloud sync";
  const nameplateClass =
    custom?.nameplate && custom.nameplate !== "none"
      ? `nameplate-${custom.nameplate}`
      : "";
  const hasNameplateUrl = Boolean(custom?.nameplateUrl);
  const bannerImgSrc =
    !hasNameplateUrl && custom?.bannerUrl
      ? getSafeMediaProxySrc(custom.bannerUrl)
      : "";
  const fallbackBgStyle =
    !hasNameplateUrl && !nameplateClass && !bannerImgSrc && custom
      ? {
          background: `linear-gradient(115deg, ${custom.bannerColor || "#4338ca"}, ${custom.bannerSecondary || "#18181b"})`,
        }
      : undefined;

  return (
    <>
      <div id="top-left-stuff">
        <div id="branding-container" class="icon-btn">
          <img
            src="/sunshinelogo.png"
            style={{ width: "20px", height: "20px", marginRight: "8px" }}
          />
          <span id="brand">Operation Cookie</span>
        </div>
        <a
          href="#"
          id="master-btn"
          class="icon-btn"
          title="Cookie Master — $2/mo Ad-Free & Daily Cookie Coins"
        >
          <i
            class="fa-solid fa-crown"
            style={{ color: masterActive ? "#fbbf24" : undefined }}
          ></i>
        </a>
        <a
          href="#"
          id="chat-btn"
          class="icon-btn"
          title="Chatroom"
          onClick={(e) => {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent("toggleChatModal"));
          }}
        >
          <i class="fa-solid fa-comments"></i>
        </a>
        <a href="#" id="choi" class="icon-btn" title="Games">
          <i class="fa-solid fa-gamepad"></i>
        </a>
        <a
          href="#"
          id="apps-btn"
          class="icon-btn"
          title="Apps (Proxy)"
          onClick={(e) => {
            e.preventDefault();
            const w = window as unknown as {
              toggleAppsMenu?: () => void;
              __pendingTopNav?: string;
            };
            if (typeof w.toggleAppsMenu === "function") {
              w.toggleAppsMenu();
            } else {
              w.__pendingTopNav = w.__pendingTopNav === "apps" ? undefined : "apps";
              window.dispatchEvent(new CustomEvent("sunshine:toggle-apps"));
            }
          }}
        >
          <i class="fa-solid fa-table-cells-large"></i>
        </a>
        <a
          href="#"
          id="studio-btn"
          class="text-icon-btn"
          title="Game Studio — Play & Create Community Games"
          style={{ fontSize: "13px", padding: "10px 14px" }}
        >
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <span>game studio</span>
        </a>
        <a
          href="#"
          id="shop-btn"
          class="text-icon-btn"
          title="Cookie Shop — Spend Cookie Coins on 1x Targeted Trolls"
          style={{ fontSize: "13px", padding: "10px 14px" }}
        >
          <i class="fa-solid fa-cookie-bite"></i>
          <span>shop · {coins}</span>
        </a>
      </div>
      <div id="top-right-stuff">
        <div
          id="auth-container"
          class={`text-icon-btn${username ? " is-profile-pill" : ""}`}
          title={username ? `${displayName} (@${username})` : "Cloud Sync Login"}
          onClick={() =>
            document.dispatchEvent(new CustomEvent("toggleAuthModal"))
          }
        >
          {username ? (
            <>
              <div
                class={`top-auth-pill-bg${nameplateClass ? ` ${nameplateClass}` : ""}${hasNameplateUrl ? " has-media-nameplate" : ""}`}
                style={fallbackBgStyle}
                aria-hidden="true"
              >
                <NameplateMediaLayer url={custom?.nameplateUrl} />
                {bannerImgSrc ? (
                  <img
                    src={bannerImgSrc}
                    alt=""
                    class="top-auth-banner-img"
                    loading={isChromebookModeEnabled() ? "lazy" : undefined}
                    decoding="async"
                  />
                ) : null}
                <span class="top-auth-pill-scrim" />
              </div>
              <div class="top-auth-avatar-wrap">
                <UserAvatar
                  username={username}
                  custom={custom}
                  className="top-auth-avatar"
                />
              </div>
              <span
                id="auth-status"
                class={`top-auth-name ${getNameClasses(custom)}`}
              >
                {displayName}
              </span>
            </>
          ) : (
            <>
              <i class="fa-solid fa-cloud"></i>
              <span id="auth-status">cloud sync</span>
            </>
          )}
        </div>
        <a href="#" id="settings" class="icon-btn">
          <i class="settings fa-solid fa-gear"></i>
        </a>
      </div>
    </>
  );
}
