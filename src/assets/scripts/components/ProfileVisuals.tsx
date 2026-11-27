import { useState, useEffect } from "preact/hooks";
import {
  getSafeMediaProxySrc,
} from "../core/profileCustomization.ts";
import { isChromebookModeEnabled } from "../core/chromebookMode.ts";
import {
  findFrameLayers,
  findProfileEffectLayers,
} from "../core/collectibleCatalog.ts";
export {
  UserAvatar,
  RoleBadge,
  GoatBadge,
  MasterVerifiedBadge,
  getNameClasses,
  NameplateMediaLayer,
} from "./ProfileBadgeVisuals.tsx";

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

export function ProfileEffectLayer({
  effect,
  effectUrl,
  preview = false,
}: {
  effect?: string | undefined;
  effectUrl?: string | undefined;
  preview?: boolean;
}) {
  const mediaLayers = effectUrl
    ? findProfileEffectLayers(effectUrl)
        .map((u) => getSafeMediaProxySrc(u))
        .filter(Boolean)
    : [];

  // Play full-frame media effects briefly on open (2.6s), then settle to a subtle
  // resting ambient layer so profile text is always crisp and readable; only pulse
  // gently again every 35s if the card stays open.
  const [effectPhase, setEffectPhase] = useState<"intro" | "resting" | "pulse">("intro");

  useEffect(() => {
    if (preview || mediaLayers.length === 0) {
      setEffectPhase("intro");
      return;
    }
    setEffectPhase("intro");
    let pulseTimer: number | null = null;
    let settleTimer: number | null = null;

    const scheduleNextPulse = () => {
      pulseTimer = window.setTimeout(() => {
        setEffectPhase("pulse");
        settleTimer = window.setTimeout(() => {
          setEffectPhase("resting");
          scheduleNextPulse();
        }, 3200);
      }, 22000);
    };

    const introTimer = window.setTimeout(() => {
      setEffectPhase("resting");
      scheduleNextPulse();
    }, 3600);

    return () => {
      window.clearTimeout(introTimer);
      if (pulseTimer !== null) window.clearTimeout(pulseTimer);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, [effectUrl, preview, mediaLayers.length]);

  if (mediaLayers.length > 0) {
    const phaseClass = preview
      ? "is-preview"
      : effectPhase === "resting"
      ? "is-resting"
      : effectPhase === "pulse"
      ? "is-pulse"
      : "is-intro";
    return (
      <div
        class={`chat-profile-effect-layer chat-profile-effect-media ${phaseClass}`}
        aria-hidden="true"
      >
        {mediaLayers.map((src) => (
          <img
            key={src}
            src={src}
            alt=""
            class="chat-profile-effect-img"
            loading={isChromebookModeEnabled() ? "lazy" : undefined}
            decoding="async"
          />
        ))}
      </div>
    );
  }
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

/** Multi-layer animated Discord-style border frame rendered around a profile card. */
export function ProfileFrameLayer({
  frameId,
  frameUrl,
}: {
  frameId?: string | undefined;
  frameUrl?: string | undefined;
}) {
  if (frameUrl) {
    const src = getSafeMediaProxySrc(frameUrl);
    if (!src) return null;
    return (
      <div class="chat-profile-frame-layer" aria-hidden="true">
        <img
          src={src}
          alt=""
          class="chat-profile-frame-img frame-slot-f"
          loading={isChromebookModeEnabled() ? "lazy" : undefined}
          decoding="async"
        />
      </div>
    );
  }
  if (!frameId) return null;
  const layers = findFrameLayers(frameId);
  if (layers.length === 0) return null;
  return (
    <div class="chat-profile-frame-layer" aria-hidden="true">
      {layers.map(([slot, url]) => {
        const src = getSafeMediaProxySrc(url);
        if (!src) return null;
        return (
          <img
            key={`${slot}:${src}`}
            src={src}
            alt=""
            class={`chat-profile-frame-img frame-slot-${slot}`}
            loading={isChromebookModeEnabled() ? "lazy" : undefined}
            decoding="async"
          />
        );
      })}
    </div>
  );
}
