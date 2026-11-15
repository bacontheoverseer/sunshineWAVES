import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import {
  type ProfileCustomization,
  loadLocalProfileCustomization,
  sanitizeCustomization,
  saveLocalProfileCustomization,
} from "../core/profileCustomization.ts";
import { ProfileFrameLayer } from "./ProfileVisuals.tsx";

const SETTING_KEY = "homepageProfileTheme";

function getActiveUsername(): string {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { username?: unknown };
    return typeof parsed?.username === "string" ? parsed.username.trim() : "";
  } catch {
    return "";
  }
}

export default function HomeProfileCard({
  children,
}: {
  children: ComponentChildren;
}) {
  const [enabled, setEnabled] = useState(
    () => localStorage.getItem(SETTING_KEY) !== "false",
  );
  const [custom, setCustom] = useState<ProfileCustomization | null>(() => {
    if (localStorage.getItem(SETTING_KEY) === "false") return null;
    const uname = getActiveUsername();
    return uname ? loadLocalProfileCustomization(uname) : null;
  });

  const syncFromProfile = useCallback(async (fetchRemote: boolean) => {
    const isEnabled = localStorage.getItem(SETTING_KEY) !== "false";
    setEnabled(isEnabled);
    if (!isEnabled) {
      setCustom(null);
      return;
    }

    const uname = getActiveUsername();
    if (!uname) {
      setCustom(null);
      return;
    }

    const local = loadLocalProfileCustomization(uname);
    if (local) setCustom(local);

    if (!fetchRemote) return;
    try {
      const res = await fetch(
        `/api/chat/user-profile?username=${encodeURIComponent(uname)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data?.profile?.customization) {
        const clean = sanitizeCustomization(data.profile.customization, uname);
        saveLocalProfileCustomization(uname, clean);
        setCustom(clean);
      }
    } catch {}
  }, []);

  useEffect(() => {
    void syncFromProfile(true);

    const onThemeToggle = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "boolean") {
        setEnabled(detail);
        if (!detail) setCustom(null);
        else void syncFromProfile(true);
      } else {
        void syncFromProfile(true);
      }
    };

    const onProfileUpdated = (e: Event) => {
      if (localStorage.getItem(SETTING_KEY) === "false") return;
      const detail = (e as CustomEvent<{
        username?: string;
        customization?: ProfileCustomization;
      }>).detail;
      const uname = getActiveUsername();
      if (!uname || !detail?.username) return;
      if (detail.username.toLowerCase() !== uname.toLowerCase()) return;
      if (detail.customization) {
        const clean = sanitizeCustomization(detail.customization, uname);
        saveLocalProfileCustomization(uname, clean);
        setCustom(clean);
      }
    };

    const onSseChat = (e: Event) => {
      if (localStorage.getItem(SETTING_KEY) === "false") return;
      const detail = (e as CustomEvent<{
        event?: string;
        type?: string;
        username?: string;
        customization?: ProfileCustomization;
      }>).detail;
      if (!detail || (detail.event || detail.type) !== "PROFILE_UPDATED") return;
      const uname = getActiveUsername();
      if (!uname || !detail.username) return;
      if (detail.username.toLowerCase() !== uname.toLowerCase()) return;
      if (detail.customization) {
        const clean = sanitizeCustomization(detail.customization, uname);
        saveLocalProfileCustomization(uname, clean);
        setCustom(clean);
      }
    };

    const onAuthOrCloud = () => {
      void syncFromProfile(true);
    };

    const onStorage = (e: StorageEvent) => {
      if (
        !e.key ||
        e.key === SETTING_KEY ||
        e.key === "auth_user" ||
        e.key.startsWith("cookie_profile_custom_v1:")
      ) {
        void syncFromProfile(false);
      }
    };

    window.addEventListener("homepageProfileThemeUpdated", onThemeToggle);
    document.addEventListener("homepageProfileThemeUpdated", onThemeToggle);
    window.addEventListener("sunshine-profile-customization-updated", onProfileUpdated);
    window.addEventListener("sunshine-chat-event", onSseChat);
    window.addEventListener("cloudsync-auth-changed", onAuthOrCloud);
    document.addEventListener("cloudsync-restored", onAuthOrCloud);
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("homepageProfileThemeUpdated", onThemeToggle);
      document.removeEventListener("homepageProfileThemeUpdated", onThemeToggle);
      window.removeEventListener("sunshine-profile-customization-updated", onProfileUpdated);
      window.removeEventListener("sunshine-chat-event", onSseChat);
      window.removeEventListener("cloudsync-auth-changed", onAuthOrCloud);
      document.removeEventListener("cloudsync-restored", onAuthOrCloud);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncFromProfile]);

  const activeCustom = enabled ? custom : null;
  const themeClass = activeCustom
    ? `has-profile-theme theme-${activeCustom.cardTheme || "obsidian"}`
    : "";

  return (
    <div
      class={`main-container${themeClass ? ` ${themeClass}` : ""}`}
      style={
        activeCustom?.cardBgColor
          ? { background: activeCustom.cardBgColor }
          : undefined
      }
    >
      {activeCustom && (
        <ProfileFrameLayer
          frameId={activeCustom.cardFrameId}
          frameUrl={activeCustom.cardFrameUrl}
        />
      )}
      {children}
    </div>
  );
}
