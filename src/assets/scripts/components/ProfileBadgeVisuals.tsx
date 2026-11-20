import {
  type ChatRole,
  type ProfileCustomization,
  getSafeMediaProxySrc,
} from "../core/profileCustomization.ts";
import { isChromebookModeEnabled } from "../core/chromebookMode.ts";

interface UserAvatarProps {
  username: string;
  custom?: ProfileCustomization | null | undefined;
  fallbackColor?: string | undefined;
  className?: string | undefined;
  opacity?: number | undefined;
  title?: string | undefined;
  onClick?: (() => void) | undefined;
  children?: preact.ComponentChildren;
}

export function UserAvatar({
  username,
  custom,
  fallbackColor = "#4338ca",
  className = "chat-entry-avatar",
  opacity,
  title,
  onClick,
  children,
}: UserAvatarProps) {
  const bg1 = custom?.avatarColor || fallbackColor;
  const bg2 = custom?.avatarSecondary || "#18181b";
  const mediaSrc = custom?.avatarUrl ? getSafeMediaProxySrc(custom.avatarUrl) : "";
  const decUrl = custom?.decorationUrl ? getSafeMediaProxySrc(custom.decorationUrl) : "";
  const dec =
    custom?.avatarDecoration && custom.avatarDecoration !== "none"
      ? custom.avatarDecoration
      : "";

  return (
    <div
      class={className}
      style={{
        position: "relative",
        background: `linear-gradient(135deg, ${bg1}, ${bg2})`,
        ...(opacity !== undefined ? { opacity } : {}),
        ...(onClick ? { cursor: "pointer" } : {}),
      }}
      title={title}
      onClick={onClick}
    >
      <div class="chat-avatar-inner">
        {mediaSrc ? (
          <img
            src={mediaSrc}
            alt={username}
            loading={isChromebookModeEnabled() ? "lazy" : undefined}
            decoding="async"
          />
        ) : custom?.avatarEmoji ? (
          <span>{custom.avatarEmoji}</span>
        ) : (
          <span>{username.slice(0, 1).toLowerCase()}</span>
        )}
      </div>
      {decUrl ? (
        <img
          src={decUrl}
          alt=""
          class="avatar-dec-img"
          aria-hidden="true"
          loading={isChromebookModeEnabled() ? "lazy" : undefined}
          decoding="async"
        />
      ) : dec ? (
        <span class={`avatar-dec-ring dec-${dec}`} aria-hidden="true" />
      ) : null}
      {children}
    </div>
  );
}

export function RoleBadge({ role }: { role?: ChatRole | undefined }) {
  if (role === "owner") {
    return (
      <span class="chat-role-badge owner icon-only" title="Site Owner" aria-label="Site Owner">
        <i class="fa-solid fa-crown" />
      </span>
    );
  }
  if (role === "mod") {
    return (
      <span class="chat-role-badge mod icon-only" title="Chat Staff Moderator" aria-label="Moderator">
        <i class="fa-solid fa-shield-halved" />
      </span>
    );
  }
  return null;
}

/** Golden title badge awarded by mods/owners to helpful idea contributors. */
export function GoatBadge({ isGoat }: { isGoat?: boolean | undefined }) {
  if (!isGoat) return null;
  return (
    <span
      class="chat-role-badge goat icon-only"
      title="GOAT — Awarded by staff for suggesting a great feature or idea"
      aria-label="GOAT"
    >
      <i class="fa-solid fa-trophy" />
    </span>
  );
}

/** Gold spiky verified seal for active Cookie Master members. */
export function MasterVerifiedBadge({ isCookieMaster }: { isCookieMaster?: boolean | undefined }) {
  if (!isCookieMaster) return null;
  return (
    <span class="chat-master-verified" title="Cookie Master" aria-label="Cookie Master">
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="currentColor"
          d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"
        />
      </svg>
    </span>
  );
}

export function getNameClasses(custom?: ProfileCustomization | null): string {
  const parts: string[] = [];
  if (custom?.nameStyle && custom.nameStyle !== "default") {
    parts.push(`name-${custom.nameStyle}`);
  }
  if (custom?.nameFont && custom.nameFont !== "default") {
    parts.push(`name-font-${custom.nameFont}`);
  }
  return parts.join(" ");
}

/** Animated Discord-style nameplate strip layered behind sidebar rows / preview rows. */
export function NameplateMediaLayer({
  url,
}: {
  url?: string | undefined;
}) {
  if (!url) return null;
  const src = getSafeMediaProxySrc(url);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      class="chat-nameplate-media"
      aria-hidden="true"
      loading={isChromebookModeEnabled() ? "lazy" : undefined}
      decoding="async"
    />
  );
}
