/**
 * Admin-Exclusive Visual Trolls & Extended Chaos Engine
 * All overlays, DOM transforms, listeners, and animation loops register cleanup
 * hooks so both automatic expiration and Admin "reset effects" restore cleanly.
 */

export type TrollCategory = "screen" | "alerts" | "physics" | "classic";

export interface AdminTrollDef {
  id: string;
  icon: string;
  title: string;
  desc: string;
  category: TrollCategory;
  exclusive?: boolean;
}

export const ADMIN_VISUAL_TROLLS: AdminTrollDef[] = [
  // --- Admin-Panel Exclusives: Screen & Display Chaos ---
  { id: "cracked-glass", icon: "fa-bolt", title: "cracked screen", desc: "shatters an authentic spiderweb glass crack across their monitor.", category: "screen", exclusive: true },
  { id: "crt-scanlines", icon: "fa-tv", title: "1998 crt monitor", desc: "applies retro RGB scanlines, phosphor glow & curved vignette.", category: "screen", exclusive: true },
  { id: "vhs-glitch", icon: "fa-wave-square", title: "vhs glitch tear", desc: "triggers horizontal RGB tearing bursts & rolling analog static.", category: "screen", exclusive: true },
  { id: "blackout-flashlight", icon: "fa-lightbulb", title: "power outage flashlight", desc: "turns the page pitch black except a spotlight following their cursor.", category: "screen", exclusive: true },
  { id: "drunk-vision", icon: "fa-champagne-glasses", title: "drunk double vision", desc: "slowly wobbles, skews, and blurs the entire viewport like a fever dream.", category: "screen", exclusive: true },
  { id: "deep-fried", icon: "fa-fire-flame-curved", title: "deep fried meme", desc: "cranks saturation & contrast to absurd deep-fried meme levels.", category: "screen", exclusive: true },
  { id: "color-cycle", icon: "fa-palette", title: "acid rgb trip", desc: "smoothly spins the entire page's colors through full rainbow hue.", category: "screen", exclusive: true },
  { id: "tiny-page", icon: "fa-compress", title: "35% miniature page", desc: "shrinks the entire site into a tiny corner postage stamp.", category: "screen", exclusive: true },
  { id: "tilt-horizon", icon: "fa-compass-drafting", title: "crooked 7° screen", desc: "subtly tilts the whole screen crooked so they tilt their head.", category: "screen", exclusive: true },
  { id: "mirror-world", icon: "fa-arrows-left-right", title: "horizontal mirror", desc: "flips the entire webpage backwards horizontally.", category: "screen", exclusive: true },
  { id: "potato-144p", icon: "fa-chess-board", title: "144p potato mode", desc: "blurs screen clarity & overlays a fake endless buffering spinner.", category: "screen", exclusive: true },
  { id: "radar-lock", icon: "fa-crosshairs", title: "hacker crosshair lock", desc: "locks a neon green tactical target reticle & telemetry onto their mouse.", category: "screen", exclusive: true },
  { id: "arctic-blizzard", icon: "fa-snowflake", title: "arctic blizzard", desc: "freezes icy frost around screen edges with blowing snow.", category: "screen", exclusive: true },
  { id: "lag-stutter", icon: "fa-hourglass-half", title: "2 fps lag simulator", desc: "freezes & stutters visual frames every second like terrible Wi-Fi.", category: "screen", exclusive: true },

  // --- Admin-Panel Exclusives: Fake OS, Alerts & Pranks ---
  { id: "fake-update", icon: "fa-arrows-spin", title: "windows 11 update", desc: "fullscreen 'Working on updates 27% complete — Don't turn off PC'.", category: "alerts", exclusive: true },
  { id: "chrome-crash", icon: "fa-face-dizzy", title: "chrome aw snap crash", desc: "authentic Chrome tab crash page with STATUS_COOKIE_OVERFLOW.", category: "alerts", exclusive: true },
  { id: "mac-beachball", icon: "fa-circle-notch", title: "frozen beachball cursor", desc: "replaces pointer with a frozen spinning rainbow loading beachball.", category: "alerts", exclusive: true },
  { id: "teacher-block", icon: "fa-shield-halved", title: "network admin block", desc: "convincing web-filter intercept screen citing Unapproved Cookies.", category: "alerts", exclusive: true },
  { id: "fake-webcam", icon: "fa-video", title: "fake webcam recording", desc: "pins a pulsing red REC CAM-01 & MIC live stream corner indicator.", category: "alerts", exclusive: true },
  { id: "virus-popups", icon: "fa-triangle-exclamation", title: "retro virus popups", desc: "spawns 5 cascading Win98 popup alerts ('42 Cookies in System32').", category: "alerts", exclusive: true },
  { id: "achievement-spam", icon: "fa-trophy", title: "achievement spam", desc: "fires a rapid flood of fake Xbox/Steam achievement unlocked toasts.", category: "alerts", exclusive: true },
  { id: "fake-captcha", icon: "fa-robot", title: "impossible cookie captcha", desc: "interactive 'Verify you are human' cookie grid that always fails once.", category: "alerts", exclusive: true },
  { id: "jumpscare-flash", icon: "fa-skull", title: "skull jumpscare flash", desc: "sudden 1.2s glowing skull red-pulse flash with impact shake.", category: "alerts", exclusive: true },

  // --- Admin-Panel Exclusives: Physics, Cursors & UI Chaos ---
  { id: "cookie-swarm", icon: "fa-cookie-bite", title: "100 bouncing cookies", desc: "drops dozens of spinning chocolate chip cookies bouncing across canvas.", category: "physics", exclusive: true },
  { id: "confetti-cannon", icon: "fa-gifts", title: "confetti overload", desc: "blasts 140 colorful tumbling confetti streamers across the screen.", category: "physics", exclusive: true },
  { id: "gravity-drop", icon: "fa-meteor", title: "zero-gravity collapse", desc: "drops page cards & buttons down cleanly to the bottom (auto-restores).", category: "physics", exclusive: true },
  { id: "runaway-ui", icon: "fa-person-running", title: "shy runaway buttons", desc: "makes buttons & links playfully dodge away whenever hovered.", category: "physics", exclusive: true },
  { id: "cursor-swarm", icon: "fa-computer-mouse", title: "12 decoy cursors", desc: "swarms 12 fake arrow pointers orbiting their real cursor.", category: "physics", exclusive: true },
  { id: "fake-bugs", icon: "fa-spider", title: "crawling screen bugs", desc: "spawns 6 realistic beetles scurrying across their screen glass.", category: "physics", exclusive: true },
  { id: "clippy-helper", icon: "fa-paperclip", title: "annoying clippy", desc: "pins a bouncing nagging paperclip giving sarcastic homework tips.", category: "physics", exclusive: true },

  // --- Classic Pranks & Shop Effects (all triggerable free in Admin) ---
  { id: "earthquake", icon: "fa-house-crack", title: "earthquake", desc: "violently shakes the viewport for 6 seconds.", category: "classic" },
  { id: "barrel-roll", icon: "fa-arrows-spin", title: "360° barrel roll", desc: "spins the whole webpage through a full 360° barrel roll.", category: "classic" },
  { id: "screen-flip", icon: "fa-rotate", title: "180° screen flip", desc: "turns the browser viewport upside down.", category: "classic" },
  { id: "bsod", icon: "fa-desktop", title: "fake windows bsod", desc: "flashes a convincing Windows blue screen of death.", category: "classic" },
  { id: "dvd-bounce", icon: "fa-compact-disc", title: "dvd screen bounce", desc: "bounces a neon COOKIE DVD logo & nudges the page on corner hits.", category: "classic" },
  { id: "disco", icon: "fa-wand-magic-sparkles", title: "rainbow rave flash", desc: "turns the screen into a fast rainbow strobe disco.", category: "classic" },
  { id: "eyelash", icon: "fa-feather", title: "monitor eyelash", desc: "places a realistic curved hair on their screen.", category: "classic" },
  { id: "dead-pixel", icon: "fa-circle-dot", title: "dead pixel", desc: "places a bright red hot pixel on their display.", category: "classic" },
  { id: "fake-battery", icon: "fa-battery-empty", title: "low battery alert", desc: "shows a critical 3% low battery warning.", category: "classic" },
  { id: "admin-monitor", icon: "fa-eye", title: "admin monitor banner", desc: "displays a live session recording banner.", category: "classic" },
  { id: "panic-doc", icon: "fa-file-lines", title: "google doc disguise", desc: "covers the screen with a fake history essay.", category: "classic" },
  { id: "ghost-cursor", icon: "fa-arrow-pointer", title: "ghost cursor", desc: "spawns an erratic possessed mouse pointer.", category: "classic" },
  { id: "flash-title", icon: "fa-bell", title: "flashing tab title", desc: "flashes warning alerts in the browser tab.", category: "classic" },
  { id: "invert-colors", icon: "fa-circle-half-stroke", title: "invert colors", desc: "inverts all colors across the page.", category: "classic" },
  { id: "matrix-rain", icon: "fa-terminal", title: "matrix rain", desc: "overlays falling green digital code rain.", category: "classic" },
  { id: "blur", icon: "fa-droplet", title: "screen blur", desc: "applies a heavy blur filter to the page.", category: "classic" },
];

const EXT_OVERLAY_IDS = [
  "cookie-cracked-glass",
  "cookie-crt-overlay",
  "cookie-vhs-glitch",
  "cookie-blackout-flashlight",
  "cookie-potato-badge",
  "cookie-radar-overlay",
  "cookie-frost-overlay",
  "cookie-lag-overlay",
  "cookie-fake-update",
  "cookie-chrome-crash",
  "cookie-mac-beachball",
  "cookie-teacher-block",
  "cookie-fake-webcam",
  "cookie-virus-container",
  "cookie-achievement-stack",
  "cookie-fake-captcha",
  "cookie-jumpscare-overlay",
  "cookie-cursor-swarm",
  "cookie-bugs-layer",
  "cookie-clippy-helper",
  "cookie-ext-canvas",
];

const EXT_HTML_CLASSES = [
  "cookie-chaos-crt",
  "cookie-chaos-drunk",
  "cookie-chaos-deepfried",
  "cookie-chaos-rgb",
  "cookie-chaos-mirror",
  "cookie-chaos-tilt",
  "cookie-chaos-potato",
  "cookie-chaos-no-cursor",
];

const activeTimeouts = new Set<number>();
const activeIntervals = new Set<number>();
const activeRafs = new Set<number>();
const activeCleanups = new Set<() => void>();

function trackTimeout(fn: () => void, ms: number): number {
  const id = window.setTimeout(() => {
    activeTimeouts.delete(id);
    fn();
  }, ms);
  activeTimeouts.add(id);
  return id;
}

function trackInterval(fn: () => void, ms: number): number {
  const id = window.setInterval(fn, ms);
  activeIntervals.add(id);
  return id;
}

function trackRaf(step: (t: number) => boolean): number {
  let id = 0;
  const loop = (t: number) => {
    activeRafs.delete(id);
    if (step(t)) {
      id = window.requestAnimationFrame(loop);
      activeRafs.add(id);
    }
  };
  id = window.requestAnimationFrame(loop);
  activeRafs.add(id);
  return id;
}

function trackCleanup(fn: () => void): () => void {
  const wrapped = () => {
    activeCleanups.delete(wrapped);
    fn();
  };
  activeCleanups.add(wrapped);
  return wrapped;
}

function ensureExtendedChaosStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("cookie-chaos-ext-styles")) return;
  const style = document.createElement("style");
  style.id = "cookie-chaos-ext-styles";
  style.textContent = `
    @keyframes cookieChaosDrunk {
      0%, 100% { transform: skew(0deg, 0deg) scale(1); filter: blur(0.6px); }
      25% { transform: skew(2.4deg, -1.2deg) scale(1.02) rotate(1.3deg); filter: blur(1.8px); }
      50% { transform: skew(-2deg, 1.5deg) scale(0.99) rotate(-1.6deg); filter: blur(1px); }
      75% { transform: skew(1.6deg, 1deg) scale(1.015) rotate(0.9deg); filter: blur(2.2px); }
    }
    @keyframes cookieChaosRgb {
      0% { filter: hue-rotate(0deg) saturate(1.4); }
      100% { filter: hue-rotate(360deg) saturate(1.4); }
    }
    @keyframes cookieChaosSpin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes cookieChaosJumpPulse {
      0%, 100% { transform: scale(1); opacity: 0.96; }
      50% { transform: scale(1.12); opacity: 1; }
    }
    @keyframes cookieVhsTear {
      0% { transform: translateX(0); opacity: 0.9; }
      20% { transform: translateX(-18px) skewX(6deg); }
      40% { transform: translateX(22px) skewX(-5deg); }
      60% { transform: translateX(-10px); }
      80% { transform: translateX(14px) skewX(4deg); }
      100% { transform: translateX(0); opacity: 0.85; }
    }
    html.cookie-chaos-crt {
      filter: contrast(1.18) saturate(1.2) brightness(0.94) !important;
    }
    html.cookie-chaos-drunk body {
      animation: cookieChaosDrunk 4.2s ease-in-out infinite !important;
    }
    html.cookie-chaos-deepfried {
      filter: contrast(2.6) saturate(3.8) sepia(0.22) brightness(1.08) !important;
    }
    html.cookie-chaos-rgb {
      animation: cookieChaosRgb 3s linear infinite !important;
    }
    html.cookie-chaos-mirror {
      transform: scaleX(-1) !important;
      transition: transform 0.35s ease !important;
    }
    html.cookie-chaos-tilt {
      transform: rotate(6.5deg) scale(0.92) !important;
      transition: transform 0.35s ease !important;
    }
    html.cookie-chaos-potato {
      filter: blur(2.4px) contrast(1.22) !important;
    }
    html.cookie-chaos-no-cursor,
    html.cookie-chaos-no-cursor * {
      cursor: none !important;
    }
    body.cookie-chaos-tiny {
      transform: scale(0.38) !important;
      transform-origin: top left !important;
      transition: transform 0.35s ease !important;
    }
  `;
  document.head.appendChild(style);
}

function toggleHtmlClassOrTimed(cls: string, durationMs: number): void {
  if (durationMs > 0) {
    document.documentElement.classList.add(cls);
    trackTimeout(() => document.documentElement.classList.remove(cls), durationMs);
  } else {
    document.documentElement.classList.toggle(cls);
  }
}

function bindDismissHandlers(
  el: HTMLElement,
  opts: { onDismiss?: () => void; closeOnEsc?: boolean; closeOnClick?: boolean },
): () => void {
  const cleanups: (() => void)[] = [];
  let dismissed = false;
  let untracked = () => {};
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    activeCleanups.delete(untracked);
    el.remove();
    for (const c of cleanups) c();
    opts.onDismiss?.();
  };
  untracked = trackCleanup(dismiss);
  if (opts.closeOnClick) {
    el.addEventListener("click", dismiss);
    cleanups.push(() => el.removeEventListener("click", dismiss));
  }
  if (opts.closeOnEsc) {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    cleanups.push(() => document.removeEventListener("keydown", onKey));
  }
  return dismiss;
}

function runFullscreenCanvasEffect(
  durationMs: number,
  drawFrame: (ctx: CanvasRenderingContext2D, w: number, h: number, elapsed: number) => boolean,
): void {
  document.getElementById("cookie-ext-canvas")?.remove();
  const canvas = document.createElement("canvas");
  canvas.id = "cookie-ext-canvas";
  canvas.style.cssText =
    "position:fixed;inset:0;z-index:2147483643;pointer-events:none;width:100vw;height:100vh;";
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize);

  const start = performance.now();
  let stopped = false;
  const teardown = trackCleanup(() => {
    stopped = true;
    window.removeEventListener("resize", resize);
    canvas.remove();
  });

  trackRaf((now) => {
    if (stopped || !document.getElementById("cookie-ext-canvas")) {
      teardown();
      return false;
    }
    const elapsed = now - start;
    if (elapsed >= durationMs) {
      teardown();
      return false;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return drawFrame(ctx, canvas.width, canvas.height, elapsed);
  });
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function applyExtendedChaosEffect(
  effect: string,
  data?: Record<string, unknown>,
  stingerFn?: () => void,
): boolean {
  ensureExtendedChaosStyles();
  const duration = typeof data?.duration === "number" ? data.duration : 0;

  switch (effect) {
    case "crt-scanlines": {
      const existing = document.getElementById("cookie-crt-overlay");
      if (existing && duration <= 0) {
        existing.remove();
        document.documentElement.classList.remove("cookie-chaos-crt");
        return true;
      }
      document.documentElement.classList.add("cookie-chaos-crt");
      const el = existing || document.createElement("div");
      el.id = "cookie-crt-overlay";
      el.style.cssText = [
        "position:fixed;inset:0;z-index:2147483644;pointer-events:none;",
        "background:repeating-linear-gradient(0deg,rgba(0,0,0,0.28) 0px,rgba(0,0,0,0.28) 1px,transparent 1px,transparent 3px),radial-gradient(ellipse at center,transparent 56%,rgba(0,0,0,0.68) 100%);",
        "box-shadow:inset 0 0 80px rgba(0,255,120,0.12);",
      ].join("");
      if (!existing) document.body.appendChild(el);
      if (duration > 0) {
        trackTimeout(() => {
          el.remove();
          document.documentElement.classList.remove("cookie-chaos-crt");
        }, duration);
      }
      return true;
    }

    case "deep-fried":
      toggleHtmlClassOrTimed("cookie-chaos-deepfried", duration);
      return true;

    case "color-cycle":
      toggleHtmlClassOrTimed("cookie-chaos-rgb", duration);
      return true;

    case "mirror-world":
      toggleHtmlClassOrTimed("cookie-chaos-mirror", duration);
      return true;

    case "tilt-horizon":
      toggleHtmlClassOrTimed("cookie-chaos-tilt", duration);
      return true;

    case "drunk-vision":
      toggleHtmlClassOrTimed("cookie-chaos-drunk", duration || 12000);
      return true;

    case "tiny-page": {
      if (duration > 0) {
        document.body.classList.add("cookie-chaos-tiny");
        trackTimeout(() => document.body.classList.remove("cookie-chaos-tiny"), duration);
      } else {
        document.body.classList.toggle("cookie-chaos-tiny");
      }
      return true;
    }

    case "potato-144p": {
      document.getElementById("cookie-potato-badge")?.remove();
      document.documentElement.classList.add("cookie-chaos-potato");
      const badge = document.createElement("div");
      badge.id = "cookie-potato-badge";
      badge.style.cssText =
        "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483645;pointer-events:none;background:rgba(0,0,0,0.82);color:#fff;padding:12px 18px;border-radius:12px;display:flex;align-items:center;gap:10px;font-family:system-ui,sans-serif;font-size:13px;border:1px solid rgba(255,255,255,0.2);";
      badge.innerHTML = `<span style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.25);border-top-color:#fff;border-radius:50%;display:inline-block;animation:cookieChaosSpin 0.8s linear infinite;"></span><span>Low Bandwidth Mode (144p) • Buffering...</span>`;
      document.body.appendChild(badge);
      trackTimeout(() => {
        badge.remove();
        document.documentElement.classList.remove("cookie-chaos-potato");
      }, duration || 12000);
      return true;
    }

    case "cracked-glass": {
      const existing = document.getElementById("cookie-cracked-glass");
      if (existing && duration <= 0) {
        existing.remove();
        return true;
      }
      const el = existing || document.createElement("div");
      el.id = "cookie-cracked-glass";
      el.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
      el.innerHTML = `
        <svg viewBox="0 0 1200 800" preserveAspectRatio="none" style="width:100%;height:100%;opacity:0.88;">
          <g stroke="rgba(255,255,255,0.82)" fill="none" stroke-linecap="round">
            <path d="M680 310 L420 120 L210 20 M680 310 L960 70 L1180 15 M680 310 L1140 430 M680 310 L910 780 M680 310 L520 790 M680 310 L110 640 M680 310 L25 320 M680 310 L650 5" stroke-width="2.1"/>
            <path d="M540 208 L595 145 M420 120 L355 210 M835 182 L880 285 M910 370 L995 315 M585 480 L470 515 M295 495 L235 415 M380 315 L310 245 M770 535 L850 520" stroke-width="1.3"/>
            <circle cx="680" cy="310" r="24" stroke-width="1.6"/>
            <circle cx="680" cy="310" r="68" stroke-width="1" stroke-dasharray="14 8"/>
            <circle cx="680" cy="310" r="145" stroke-width="0.9" stroke-dasharray="22 14"/>
          </g>
          <g stroke="rgba(0,0,0,0.55)" fill="none">
            <path d="M681 311 L421 121 L211 21 M681 311 L1141 431 M681 311 L111 641" stroke-width="1"/>
          </g>
        </svg>`;
      if (!existing) document.body.appendChild(el);
      if (duration > 0) trackTimeout(() => el.remove(), duration);
      return true;
    }

    case "vhs-glitch": {
      document.getElementById("cookie-vhs-glitch")?.remove();
      const el = document.createElement("div");
      el.id = "cookie-vhs-glitch";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483645;pointer-events:none;overflow:hidden;";
      const strip = document.createElement("div");
      strip.style.cssText =
        "position:absolute;left:0;right:0;height:44px;background:linear-gradient(90deg,rgba(255,0,100,0.28),rgba(0,255,220,0.28),rgba(255,255,255,0.22));mix-blend-mode:screen;animation:cookieVhsTear 0.25s infinite;";
      el.appendChild(strip);
      document.body.appendChild(el);
      const timer = trackInterval(() => {
        strip.style.top = `${Math.floor(Math.random() * 88)}vh`;
        strip.style.height = `${18 + Math.floor(Math.random() * 64)}px`;
        el.style.backdropFilter = Math.random() > 0.55 ? "hue-rotate(90deg) contrast(1.4)" : "";
      }, 280);
      trackTimeout(() => {
        window.clearInterval(timer);
        activeIntervals.delete(timer);
        el.remove();
      }, duration || 11000);
      return true;
    }

    case "blackout-flashlight": {
      document.getElementById("cookie-blackout-flashlight")?.remove();
      const mask = document.createElement("div");
      mask.id = "cookie-blackout-flashlight";
      mask.style.cssText =
        "position:fixed;inset:0;z-index:2147483645;pointer-events:none;background:radial-gradient(circle 135px at 50vw 50vh, rgba(0,0,0,0) 0%, rgba(2,3,8,0.97) 100%);";
      document.body.appendChild(mask);
      const onMove = (e: PointerEvent) => {
        mask.style.background = `radial-gradient(circle 135px at ${e.clientX}px ${e.clientY}px, rgba(0,0,0,0) 0%, rgba(2,3,8,0.97) 100%)`;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      const cleanup = trackCleanup(() => {
        window.removeEventListener("pointermove", onMove);
        mask.remove();
      });
      trackTimeout(cleanup, duration || 14000);
      return true;
    }

    case "radar-lock": {
      document.getElementById("cookie-radar-overlay")?.remove();
      const el = document.createElement("div");
      el.id = "cookie-radar-overlay";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483645;pointer-events:none;font-family:monospace;color:#22c55e;";
      el.innerHTML = `
        <div id="cookie-radar-reticle" style="position:fixed;left:50vw;top:50vh;width:72px;height:72px;margin:-36px 0 0 -36px;border:1.5px solid #22c55e;border-radius:50%;box-shadow:0 0 18px rgba(34,197,94,0.45);">
          <div style="position:absolute;left:50%;top:-10px;bottom:-10px;width:1px;background:rgba(34,197,94,0.65);"></div>
          <div style="position:absolute;top:50%;left:-10px;right:-10px;height:1px;background:rgba(34,197,94,0.65);"></div>
        </div>
        <div id="cookie-radar-hud" style="position:fixed;top:16px;right:16px;background:rgba(3,18,9,0.88);border:1px solid #22c55e;padding:8px 12px;border-radius:8px;font-size:11px;line-height:1.45;">
          TARGET LOCKED • LIVE TRACKING<br/><span id="cookie-radar-coords">X: 50%  Y: 50%</span>
        </div>`;
      document.body.appendChild(el);
      const ret = document.getElementById("cookie-radar-reticle");
      const coords = document.getElementById("cookie-radar-coords");
      const onMove = (e: PointerEvent) => {
        if (ret) {
          ret.style.left = `${e.clientX}px`;
          ret.style.top = `${e.clientY}px`;
        }
        if (coords) coords.textContent = `X: ${e.clientX}px  Y: ${e.clientY}px`;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      const cleanup = trackCleanup(() => {
        window.removeEventListener("pointermove", onMove);
        el.remove();
      });
      trackTimeout(cleanup, duration || 14000);
      return true;
    }

    case "arctic-blizzard": {
      document.getElementById("cookie-frost-overlay")?.remove();
      const frost = document.createElement("div");
      frost.id = "cookie-frost-overlay";
      frost.style.cssText =
        "position:fixed;inset:0;z-index:2147483642;pointer-events:none;box-shadow:inset 0 0 110px 36px rgba(186,230,253,0.75);background:radial-gradient(ellipse at center, transparent 58%, rgba(224,242,254,0.34) 100%);backdrop-filter:saturate(0.75);";
      document.body.appendChild(frost);
      const flakes = Array.from({ length: 120 }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: 1.5 + Math.random() * 4,
        vx: 4 + Math.random() * 6,
        vy: 2 + Math.random() * 4,
      }));
      const dur = duration || 12000;
      runFullscreenCanvasEffect(dur, (ctx, w, h) => {
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        for (const f of flakes) {
          f.x = (f.x + f.vx) % w;
          f.y = (f.y + f.vy) % h;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fill();
        }
        return true;
      });
      trackTimeout(() => frost.remove(), dur);
      return true;
    }

    case "lag-stutter": {
      document.getElementById("cookie-lag-overlay")?.remove();
      const el = document.createElement("div");
      el.id = "cookie-lag-overlay";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483644;pointer-events:none;display:flex;align-items:flex-end;justify-content:center;padding-bottom:24px;";
      const pill = document.createElement("div");
      pill.style.cssText =
        "background:rgba(15,15,20,0.88);color:#fca5a5;padding:7px 14px;border-radius:999px;font-family:monospace;font-size:12px;border:1px solid rgba(248,113,113,0.45);";
      pill.textContent = "Connection Unstable • 2 FPS";
      el.appendChild(pill);
      document.body.appendChild(el);
      const timer = trackInterval(() => {
        const freeze = Math.random() > 0.45;
        el.style.background = freeze ? "rgba(0,0,0,0.16)" : "transparent";
        el.style.backdropFilter = freeze ? "blur(3px) grayscale(0.4)" : "";
      }, 420);
      trackTimeout(() => {
        window.clearInterval(timer);
        activeIntervals.delete(timer);
        el.remove();
      }, duration || 11000);
      return true;
    }

    case "fake-update": {
      document.getElementById("cookie-fake-update")?.remove();
      const el = document.createElement("div");
      el.id = "cookie-fake-update";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#000000;color:#ffffff;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;user-select:none;";
      el.innerHTML = `
        <div style="width:48px;height:48px;border:4px solid rgba(255,255,255,0.2);border-top-color:#ffffff;border-radius:50%;animation:cookieChaosSpin 1s linear infinite;margin-bottom:28px;"></div>
        <div style="font-size:22px;font-weight:400;margin-bottom:8px;">Working on updates &nbsp;<span id="cookie-win-pct">27</span>% complete</div>
        <div style="font-size:15px;opacity:0.8;margin-bottom:28px;">Don&apos;t turn off your PC. This will take a while.</div>
        <div style="font-size:12px;opacity:0.45;">Your PC will restart several times (Click or press ESC to dismiss)</div>`;
      document.body.appendChild(el);
      let pct = 27;
      const timer = trackInterval(() => {
        pct = Math.min(99, pct + 1);
        const span = document.getElementById("cookie-win-pct");
        if (span) span.textContent = String(pct);
      }, 1800);
      const stop = () => {
        window.clearInterval(timer);
        activeIntervals.delete(timer);
      };
      const dismiss = bindDismissHandlers(el, { closeOnClick: true, closeOnEsc: true, onDismiss: stop });
      trackTimeout(dismiss, duration || 15000);
      return true;
    }

    case "chrome-crash": {
      document.getElementById("cookie-chrome-crash")?.remove();
      const el = document.createElement("div");
      el.id = "cookie-chrome-crash";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#202124;color:#e8eaed;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;";
      el.innerHTML = `
        <div style="max-width:520px;width:100%;">
          <div style="font-size:52px;margin-bottom:18px;opacity:0.8;">😵</div>
          <h1 style="margin:0 0 10px;font-size:24px;font-weight:500;">Aw, Snap!</h1>
          <p style="margin:0 0 18px;font-size:14px;color:#9aa0a6;line-height:1.5;">Something went wrong while displaying this webpage.</p>
          <p style="margin:0 0 26px;font-size:12px;color:#9aa0a6;font-family:monospace;">Error code: STATUS_COOKIE_OVERFLOW</p>
          <button type="button" id="cookie-fake-reload" style="background:#8ab4f8;color:#202124;border:none;border-radius:6px;padding:9px 20px;font-size:13px;font-weight:600;cursor:pointer;">Reload</button>
        </div>`;
      document.body.appendChild(el);
      const dismiss = bindDismissHandlers(el, { closeOnEsc: true });
      document.getElementById("cookie-fake-reload")?.addEventListener("click", dismiss);
      trackTimeout(dismiss, duration || 15000);
      return true;
    }

    case "mac-beachball": {
      document.getElementById("cookie-mac-beachball")?.remove();
      document.documentElement.classList.add("cookie-chaos-no-cursor");
      const ball = document.createElement("div");
      ball.id = "cookie-mac-beachball";
      ball.style.cssText =
        "position:fixed;left:50vw;top:50vh;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;z-index:2147483647;pointer-events:none;background:conic-gradient(#ef4444 0 60deg,#f59e0b 60deg 120deg,#eab308 120deg 180deg,#22c55e 180deg 240deg,#3b82f6 240deg 300deg,#a855f7 300deg 360deg);animation:cookieChaosSpin 0.55s linear infinite;box-shadow:0 2px 10px rgba(0,0,0,0.45);border:1.5px solid rgba(255,255,255,0.85);";
      document.body.appendChild(ball);
      const onMove = (e: PointerEvent) => {
        ball.style.left = `${e.clientX}px`;
        ball.style.top = `${e.clientY}px`;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      const cleanup = trackCleanup(() => {
        window.removeEventListener("pointermove", onMove);
        document.documentElement.classList.remove("cookie-chaos-no-cursor");
        ball.remove();
      });
      trackTimeout(cleanup, duration || 11000);
      return true;
    }

    case "teacher-block": {
      document.getElementById("cookie-teacher-block")?.remove();
      const adminName = escapeHtml(String(data?.from || "Administrator"));
      const el = document.createElement("div");
      el.id = "cookie-teacher-block";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;";
      el.innerHTML = `
        <div style="max-width:480px;width:100%;background:#1e293b;border:1px solid rgba(248,113,113,0.45);border-radius:18px;padding:28px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,0.6);">
          <div style="font-size:40px;margin-bottom:12px;">🛡️</div>
          <h2 style="margin:0 0 8px;font-size:20px;color:#fca5a5;">Blocked by Network Administrator</h2>
          <p style="margin:0 0 16px;font-size:13.5px;color:#cbd5e1;line-height:1.5;">
            This page has been locked by Classroom Monitor (${adminName}).<br/>Reason: <strong>Excessive Cookie &amp; Game Consumption</strong>.
          </p>
          <button type="button" id="cookie-block-dismiss" style="background:#334155;color:#e2e8f0;border:none;border-radius:10px;padding:8px 16px;font-size:12.5px;cursor:pointer;">Request Review (Dismiss)</button>
        </div>`;
      document.body.appendChild(el);
      const dismiss = bindDismissHandlers(el, { closeOnEsc: true });
      document.getElementById("cookie-block-dismiss")?.addEventListener("click", dismiss);
      trackTimeout(dismiss, duration || 14000);
      return true;
    }

    case "fake-webcam": {
      document.getElementById("cookie-fake-webcam")?.remove();
      const el = document.createElement("div");
      el.id = "cookie-fake-webcam";
      el.style.cssText =
        "position:fixed;top:16px;left:16px;z-index:2147483646;background:rgba(12,12,16,0.92);color:#f8fafc;border:1px solid rgba(239,68,68,0.6);border-radius:14px;padding:10px 14px;display:flex;align-items:center;gap:10px;font-family:monospace;font-size:12px;box-shadow:0 12px 32px rgba(0,0,0,0.6);cursor:pointer;";
      el.innerHTML = `<span style="width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 10px #ef4444;animation:pulse-dot-anim 0.8s infinite alternate;"></span><span>● REC &nbsp;CAM-01 + MIC ACTIVE (ADMIN STREAM)</span>`;
      document.body.appendChild(el);
      const dismiss = bindDismissHandlers(el, { closeOnClick: true });
      trackTimeout(dismiss, duration || 16000);
      return true;
    }

    case "virus-popups": {
      document.getElementById("cookie-virus-container")?.remove();
      const wrap = document.createElement("div");
      wrap.id = "cookie-virus-container";
      wrap.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
      document.body.appendChild(wrap);
      const alerts = [
        ["SYSTEM32 ALERT", "42 Unregistered Cookies found in C:\\Windows!"],
        ["MEMORY FULL", "Click OK to download +64GB Free DDR5 RAM."],
        ["CPU OVERHEAT", "Processor at 104°C because you minimized schoolwork."],
        ["WINDOWS DEFENDER", "Troll.Cookie.Agent.exe requested Admin privileges."],
        ["CHROME WARNING", "Your history essay tab misses you."],
      ];
      alerts.forEach(([title, body], idx) => {
        trackTimeout(() => {
          if (!document.getElementById("cookie-virus-container")) return;
          const win = document.createElement("div");
          win.style.cssText = `position:fixed;left:${12 + idx * 9}vw;top:${14 + idx * 8}vh;width:300px;background:#ece9d8;color:#111;border:2px solid #0054e3;border-radius:4px;font-family:Tahoma,sans-serif;box-shadow:6px 6px 20px rgba(0,0,0,0.55);pointer-events:auto;`;
          win.innerHTML = `
            <div style="background:linear-gradient(90deg,#0054e3,#3a8cf5);color:#fff;padding:4px 8px;font-size:12px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
              <span>⚠️ ${title}</span>
              <button type="button" style="background:#d9381e;color:#fff;border:1px solid #fff;font-size:10px;padding:0 5px;cursor:pointer;">X</button>
            </div>
            <div style="padding:14px 12px;font-size:12px;line-height:1.4;">${body}</div>
            <div style="padding:0 12px 10px;text-align:right;"><button type="button" style="padding:3px 14px;cursor:pointer;">OK</button></div>`;
          win.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => win.remove()));
          wrap.appendChild(win);
        }, idx * 240);
      });
      trackTimeout(() => wrap.remove(), duration || 18000);
      return true;
    }

    case "achievement-spam": {
      document.getElementById("cookie-achievement-stack")?.remove();
      const stack = document.createElement("div");
      stack.id = "cookie-achievement-stack";
      stack.style.cssText =
        "position:fixed;bottom:20px;right:20px;z-index:2147483646;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:310px;";
      document.body.appendChild(stack);
      const list = [
        ["Master Procrastinator (100G)", "Open games while teacher watches"],
        ["Cookie Overdose (50G)", "Targeted directly by the site owner"],
        ["Alt-Tab Reflexes (25G)", "Hover near the panic button twice"],
        ["Why Are You Still Reading (75G)", "An achievement just for wasting time"],
        ["Verified Goober (200G)", "Unlocked all admin visual trolls"],
      ];
      list.forEach(([t, d], idx) => {
        trackTimeout(() => {
          const card = document.createElement("div");
          card.style.cssText =
            "background:#111827;color:#f9fafb;border:1px solid rgba(251,191,36,0.55);border-radius:999px;padding:10px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 12px 28px rgba(0,0,0,0.5);font-family:system-ui,sans-serif;animation:slideInRight 0.22s ease-out;";
          card.innerHTML = `<span style="font-size:20px;">🏆</span><div><div style="font-size:12.5px;font-weight:700;color:#fde68a;">${t}</div><div style="font-size:11px;color:#9ca3af;">${d}</div></div>`;
          stack.appendChild(card);
        }, idx * 900);
      });
      trackTimeout(() => stack.remove(), duration || 11000);
      return true;
    }

    case "fake-captcha": {
      document.getElementById("cookie-fake-captcha")?.remove();
      const modal = document.createElement("div");
      modal.id = "cookie-fake-captcha";
      modal.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif;";
      modal.innerHTML = `
        <div style="width:320px;background:#fff;color:#111;border-radius:10px;overflow:hidden;box-shadow:0 20px 56px rgba(0,0,0,0.6);">
          <div style="background:#1a73e8;color:#fff;padding:14px 16px;">
            <div style="font-size:11px;opacity:0.9;">Security Check</div>
            <div style="font-size:16px;font-weight:700;">Select all squares with cookies</div>
          </div>
          <div id="cookie-captcha-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;padding:10px;background:#f8fafc;">
            ${Array.from({ length: 9 })
              .map(
                () =>
                  `<button type="button" style="height:76px;border:2px solid #cbd5e1;border-radius:6px;background:#fff;font-size:28px;cursor:pointer;">🍪</button>`,
              )
              .join("")}
          </div>
          <div id="cookie-captcha-msg" style="padding:0 12px 8px;font-size:11.5px;color:#dc2626;min-height:18px;"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px 12px;border-top:1px solid #e2e8f0;">
            <button type="button" id="cookie-captcha-skip" style="background:none;border:none;color:#64748b;font-size:11px;cursor:pointer;">dismiss (ESC)</button>
            <button type="button" id="cookie-captcha-verify" style="background:#1a73e8;color:#fff;border:none;border-radius:6px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;">VERIFY</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelectorAll<HTMLButtonElement>("#cookie-captcha-grid button").forEach((b) => {
        b.addEventListener("click", () => {
          const picked = b.dataset.picked === "1";
          b.dataset.picked = picked ? "0" : "1";
          b.style.borderColor = picked ? "#cbd5e1" : "#1a73e8";
          b.style.background = picked ? "#fff" : "#dbeafe";
        });
      });
      const dismiss = bindDismissHandlers(modal, { closeOnEsc: true });
      document.getElementById("cookie-captcha-skip")?.addEventListener("click", dismiss);
      let tries = 0;
      document.getElementById("cookie-captcha-verify")?.addEventListener("click", () => {
        tries += 1;
        const msg = document.getElementById("cookie-captcha-msg");
        if (tries >= 2) {
          dismiss();
        } else if (msg) {
          msg.textContent = "Suspiciously human. Try again once more.";
        }
      });
      trackTimeout(dismiss, duration || 20000);
      return true;
    }

    case "jumpscare-flash": {
      document.getElementById("cookie-jumpscare-overlay")?.remove();
      const el = document.createElement("div");
      el.id = "cookie-jumpscare-overlay";
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:radial-gradient(circle, rgba(220,38,38,0.45) 0%, rgba(5,0,0,0.96) 75%);display:flex;align-items:center;justify-content:center;animation:cookie-earthquake-shake 0.09s infinite;";
      el.innerHTML = `<div style="font-size:min(38vw,240px);line-height:1;filter:drop-shadow(0 0 36px #ef4444);animation:cookieChaosJumpPulse 0.25s infinite;">💀</div>`;
      document.body.appendChild(el);
      try { stingerFn?.(); } catch {}
      trackTimeout(() => el.remove(), duration || 1250);
      return true;
    }

    case "cookie-swarm": {
      const cookies = Array.from({ length: 75 }, () => ({
        x: Math.random() * window.innerWidth,
        y: -40 - Math.random() * 400,
        vx: (Math.random() - 0.5) * 7,
        vy: 1 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.14,
        size: 24 + Math.random() * 32,
      }));
      runFullscreenCanvasEffect(duration || 10000, (ctx, w, h) => {
        for (const c of cookies) {
          c.vy += 0.28;
          c.x += c.vx;
          c.y += c.vy;
          c.rot += c.vr;
          if (c.y + c.size * 0.5 >= h) {
            c.y = h - c.size * 0.5;
            c.vy *= -0.78;
          }
          if (c.x < 0 || c.x > w) c.vx *= -1;
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.rotate(c.rot);
          ctx.font = `${Math.round(c.size)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("🍪", 0, 0);
          ctx.restore();
        }
        return true;
      });
      return true;
    }

    case "confetti-cannon": {
      const colors = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#ffffff"];
      const w = window.innerWidth;
      const h = window.innerHeight;
      const pieces = Array.from({ length: 140 }, (_, i) => {
        const left = i % 2 === 0;
        return {
          x: left ? 20 : w - 20,
          y: h - 20,
          vx: (left ? 1 : -1) * (4 + Math.random() * 14),
          vy: -(12 + Math.random() * 14),
          size: 7 + Math.random() * 7,
          rot: Math.random() * 6.28,
          vr: (Math.random() - 0.5) * 0.25,
          color: colors[i % colors.length],
        };
      });
      runFullscreenCanvasEffect(duration || 7500, (ctx) => {
        for (const p of pieces) {
          p.vy += 0.35;
          p.vx *= 0.99;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }
        return true;
      });
      return true;
    }

    case "gravity-drop": {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".main-container, #bookmarks-container .bookmark, .top-bar > *, .game-card",
        ),
      ).filter((el) => !el.closest(".admin-menu, .admin-auth-popup, .admin-backdrop"));
      const saved = candidates.map((el) => ({
        el,
        transform: el.style.transform,
        transition: el.style.transition,
      }));
      for (const { el } of saved) {
        const rect = el.getBoundingClientRect();
        const dropY = Math.max(0, window.innerHeight - rect.bottom - 12);
        const tilt = (Math.random() - 0.5) * 28;
        el.style.transition = "transform 0.85s cubic-bezier(0.22, 1.35, 0.4, 1)";
        el.style.transform = `translate3d(${(Math.random() - 0.5) * 36}px, ${dropY}px, 0) rotate(${tilt}deg)`;
      }
      const restore = trackCleanup(() => {
        for (const item of saved) {
          item.el.style.transform = item.transform;
          item.el.style.transition = item.transition;
        }
      });
      trackTimeout(restore, duration || 8500);
      return true;
    }

    case "runaway-ui": {
      const shifted = new Map<HTMLElement, string>();
      const onOver = (e: MouseEvent) => {
        const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("button, a, .bookmark");
        if (!target || target.closest(".admin-menu, .admin-auth-popup, .admin-backdrop")) return;
        if (!shifted.has(target)) shifted.set(target, target.style.transform);
        const dx = (Math.random() > 0.5 ? 1 : -1) * (50 + Math.random() * 90);
        const dy = (Math.random() > 0.5 ? 1 : -1) * (24 + Math.random() * 60);
        target.style.transition = "transform 0.16s ease-out";
        target.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      document.addEventListener("mouseover", onOver, { passive: true });
      const cleanup = trackCleanup(() => {
        document.removeEventListener("mouseover", onOver);
        for (const [el, prev] of shifted) {
          el.style.transform = prev;
        }
        shifted.clear();
      });
      trackTimeout(cleanup, duration || 14000);
      return true;
    }

    case "cursor-swarm": {
      document.getElementById("cookie-cursor-swarm")?.remove();
      const wrap = document.createElement("div");
      wrap.id = "cookie-cursor-swarm";
      wrap.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
      const pointers = Array.from({ length: 12 }, (_, idx) => {
        const d = document.createElement("div");
        d.style.cssText = "position:fixed;left:50vw;top:50vh;width:20px;height:20px;";
        d.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><path d="M4 2L20 12L12 14L8 22L4 2Z" fill="white" stroke="black" stroke-width="1.8"/></svg>`;
        wrap.appendChild(d);
        return { el: d, angle: (idx / 12) * Math.PI * 2, dist: 38 + (idx % 3) * 30 };
      });
      document.body.appendChild(wrap);
      let mx = window.innerWidth / 2;
      let my = window.innerHeight / 2;
      const onMove = (e: PointerEvent) => {
        mx = e.clientX;
        my = e.clientY;
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      let alive = true;
      const cleanup = trackCleanup(() => {
        alive = false;
        window.removeEventListener("pointermove", onMove);
        wrap.remove();
      });
      const dur = duration || 14000;
      const start = performance.now();
      trackRaf((now) => {
        if (!alive || now - start >= dur || !document.getElementById("cookie-cursor-swarm")) {
          cleanup();
          return false;
        }
        for (const p of pointers) {
          p.angle += 0.06;
          const x = mx + Math.cos(p.angle) * p.dist;
          const y = my + Math.sin(p.angle) * p.dist;
          p.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        }
        return true;
      });
      return true;
    }

    case "fake-bugs": {
      document.getElementById("cookie-bugs-layer")?.remove();
      const wrap = document.createElement("div");
      wrap.id = "cookie-bugs-layer";
      wrap.style.cssText = "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
      const bugs = Array.from({ length: 6 }, () => {
        const el = document.createElement("div");
        el.style.cssText = "position:fixed;left:0;top:0;font-size:18px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4));";
        el.textContent = "🪲";
        wrap.appendChild(el);
        return {
          el,
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          ang: Math.random() * Math.PI * 2,
          speed: 2 + Math.random() * 2.2,
        };
      });
      document.body.appendChild(wrap);
      let alive = true;
      const cleanup = trackCleanup(() => {
        alive = false;
        wrap.remove();
      });
      const dur = duration || 16000;
      const start = performance.now();
      trackRaf((now) => {
        if (!alive || now - start >= dur || !document.getElementById("cookie-bugs-layer")) {
          cleanup();
          return false;
        }
        for (const b of bugs) {
          b.ang += (Math.random() - 0.5) * 0.25;
          b.x += Math.cos(b.ang) * b.speed;
          b.y += Math.sin(b.ang) * b.speed;
          if (b.x < 0 || b.x > window.innerWidth - 24) b.ang = Math.PI - b.ang;
          if (b.y < 0 || b.y > window.innerHeight - 24) b.ang = -b.ang;
          b.el.style.transform = `translate3d(${b.x}px, ${b.y}px, 0) rotate(${b.ang + Math.PI / 2}rad)`;
        }
        return true;
      });
      return true;
    }

    case "clippy-helper": {
      document.getElementById("cookie-clippy-helper")?.remove();
      const wrap = document.createElement("div");
      wrap.id = "cookie-clippy-helper";
      wrap.style.cssText =
        "position:fixed;bottom:22px;right:22px;z-index:2147483646;max-width:260px;font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:flex-end;gap:8px;";
      const quotes = [
        "It looks like you're avoiding classwork! Would you like help explaining to your teacher?",
        "I noticed your cookies per minute dropped below target. Need assistance?",
        "Pro tip: Looking busy works 40% better if you frown slightly at the monitor.",
        "Should I open your overdue assignments right now? Just blink twice!",
      ];
      let idx = 0;
      wrap.innerHTML = `
        <div style="background:#fef3c7;color:#1f2937;border:2px solid #92400e;border-radius:14px;padding:10px 12px;font-size:12px;line-height:1.4;box-shadow:0 12px 28px rgba(0,0,0,0.45);">
          <div id="cookie-clippy-text">${quotes[0]}</div>
          <div style="margin-top:6px;display:flex;justify-content:flex-end;"><button type="button" style="background:#92400e;color:#fff;border:none;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;">shoo</button></div>
        </div>
        <div style="font-size:44px;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.5));">📎</div>`;
      document.body.appendChild(wrap);
      const timer = trackInterval(() => {
        idx = (idx + 1) % quotes.length;
        const txt = document.getElementById("cookie-clippy-text");
        if (txt) txt.textContent = quotes[idx];
      }, 3200);
      const stop = () => {
        window.clearInterval(timer);
        activeIntervals.delete(timer);
      };
      const dismiss = bindDismissHandlers(wrap, { onDismiss: stop });
      wrap.querySelector("button")?.addEventListener("click", dismiss);
      trackTimeout(dismiss, duration || 18000);
      return true;
    }

    default:
      return false;
  }
}

export function clearExtendedChaosEffects(): void {
  for (const id of activeTimeouts) window.clearTimeout(id);
  activeTimeouts.clear();

  for (const id of activeIntervals) window.clearInterval(id);
  activeIntervals.clear();

  for (const id of activeRafs) window.cancelAnimationFrame(id);
  activeRafs.clear();

  for (const fn of Array.from(activeCleanups)) {
    try {
      fn();
    } catch {}
  }
  activeCleanups.clear();

  document.body.classList.remove("cookie-chaos-tiny");
  document.documentElement.classList.remove(...EXT_HTML_CLASSES);

  for (const id of EXT_OVERLAY_IDS) {
    document.getElementById(id)?.remove();
  }
}
