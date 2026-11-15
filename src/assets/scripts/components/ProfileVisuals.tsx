import {
  ChatRole,
  ProfileCustomization,
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
  const dec = custom?.avatarDecoration && custom.avatarDecoration !== "none"
    ? custom.avatarDecoration
    : "";

  return (
    <div
      class={className}
      style={{
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
      {dec && <span class={`avatar-dec-ring dec-${dec}`} aria-hidden="true" />}
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

const PARTICLE_SEEDS = [
  { left: "7%", dur: "4.6s", delay: "-0.8s", drift: "24px", rot: "18deg", sz: "15px", top: "24%" },
  { left: "18%", dur: "5.4s", delay: "-2.1s", drift: "-18px", rot: "-24deg", sz: "11px", top: "58%" },
  { left: "29%", dur: "4.2s", delay: "-1.5s", drift: "30px", rot: "35deg", sz: "14px", top: "18%" },
  { left: "41%", dur: "6.0s", delay: "-3.4s", drift: "-26px", rot: "-12deg", sz: "12px", top: "72%" },
  { left: "54%", dur: "4.9s", delay: "-0.4s", drift: "20px", rot: "42deg", sz: "16px", top: "40%" },
  { left: "67%", dur: "5.6s", delay: "-2.9s", drift: "-22px", rot: "-30deg", sz: "11px", top: "82%" },
  { left: "79%", dur: "4.4s", delay: "-1.9s", drift: "28px", rot: "15deg", sz: "14px", top: "30%" },
  { left: "90%", dur: "5.1s", delay: "-3.8s", drift: "-20px", rot: "-40deg", sz: "13px", top: "64%" },
  { left: "14%", dur: "3.7s", delay: "-1.1s", drift: "16px", rot: "10deg", sz: "10px", top: "46%" },
  { left: "73%", dur: "3.9s", delay: "-2.6s", drift: "-15px", rot: "28deg", sz: "12px", top: "14%" },
];

const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#38bdf8", "#a855f7"];

export function ProfileEffectLayer({ effect }: { effect?: string }) {
  if (!effect || effect === "none" || effect === "lightning-border") return null;

  return (
    <div class="chat-profile-effect-layer" aria-hidden="true">
      {PARTICLE_SEEDS.map((s, idx) => {
        const styleVars: Record<string, string> = {
          left: s.left,
          "--dur": s.dur,
          "--delay": s.delay,
          "--drift": s.drift,
          "--rot": s.rot,
          "--sz": s.sz,
        };

        if (effect === "starlight-petals") {
          const isStar = idx % 3 === 1;
          return isStar ? (
            <span
              key={idx}
              class="chat-effect-particle star-sparkle"
              style={{ ...styleVars, top: s.top }}
            >
              ✦
            </span>
          ) : (
            <span key={idx} class="chat-effect-particle petal-white" style={styleVars} />
          );
        }

        if (effect === "sakura-fall") {
          return <span key={idx} class="chat-effect-particle petal-sakura" style={styleVars} />;
        }

        if (effect === "shooting-stars") {
          return (
            <span
              key={idx}
              class="chat-effect-particle star-sparkle"
              style={{ ...styleVars, top: s.top }}
            >
              {idx % 2 === 0 ? "✦" : "✧"}
            </span>
          );
        }

        if (effect === "confetti-pop") {
          return (
            <span
              key={idx}
              class="chat-effect-particle confetti-bit"
              style={{
                ...styleVars,
                backgroundColor: CONFETTI_COLORS[idx % CONFETTI_COLORS.length],
              }}
            />
          );
        }

        if (effect === "rain-drops") {
          return <span key={idx} class="chat-effect-particle rain-streak" style={styleVars} />;
        }

        if (effect === "fireflies") {
          return (
            <span
              key={idx}
              class="chat-effect-particle firefly-orb"
              style={{ ...styleVars, top: s.top }}
            />
          );
        }

        if (effect === "snowflakes") {
          return (
            <span key={idx} class="chat-effect-particle snow-flake" style={styleVars}>
              ❄
            </span>
          );
        }

        return null;
      })}
    </div>
  );
}
