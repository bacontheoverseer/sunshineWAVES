import {
  type ChatRole,
  type ProfileCustomization,
  getSafeMediaProxySrc,
} from "../core/profileCustomization.ts";

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
          <img src={mediaSrc} alt={username} decoding="async" />
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
      <span class="chat-role-badge owner" title="Site Owner">
        <i class="fa-solid fa-crown" /> owner
      </span>
    );
  }
  if (role === "mod") {
    return (
      <span class="chat-role-badge mod" title="Chat Staff Moderator">
        <i class="fa-solid fa-shield-halved" /> mod
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
      class="chat-role-badge goat"
      title="GOAT — Awarded by staff for suggesting a great feature or idea"
    >
      <i class="fa-solid fa-trophy" /> GOAT
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
      decoding="async"
    />
  );
}
