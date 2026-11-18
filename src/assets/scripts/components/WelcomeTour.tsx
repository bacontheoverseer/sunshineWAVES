import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

const TOUR_STORAGE_KEY = "sunshine_onboarding_tour_v1";
const NON_HOME_CLASSES = [
  "browser-view",
  "games-view",
  "apps-view",
  "studio-view",
  "shop-view",
  "master-view",
];

interface TourHighlight {
  icon: string;
  label: string;
  detail: string;
}

interface TourAction {
  label: string;
  icon: string;
  run: () => void;
}

interface TourStep {
  id: string;
  category: string;
  icon: string;
  title: string;
  description: string;
  highlights: TourHighlight[];
  selectors: string[];
  preferredSide: "bottom" | "top" | "center";
  padding?: number;
  action?: TourAction;
}

interface SpotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LayoutBox {
  spot: SpotRect | null;
  cardLeft: number;
  cardTop: number;
  viewportWidth: number;
  viewportHeight: number;
}

function dispatchOpenSettings(): void {
  const w = window as { toggleSettingsMenu?: () => void };
  if (typeof w.toggleSettingsMenu === "function") {
    w.toggleSettingsMenu();
  } else {
    document.getElementById("settings")?.click();
  }
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    category: "overview",
    icon: "fa-cookie-bite",
    title: "welcome to operation cookie",
    description:
      "your all-in-one private workspace for proxied browsing, hundreds of games, community chat, voice lounges, and deep visual customization.",
    highlights: [
      {
        icon: "fa-globe",
        label: "private web proxy",
        detail: "scramjet & ultraviolet backends over libcurl or epoxy transports",
      },
      {
        icon: "fa-comments",
        label: "live community & voice",
        detail: "real-time channels, dms, group chats, gifs, images & webrtc voice rooms",
      },
      {
        icon: "fa-wand-magic-sparkles",
        label: "deep customization",
        detail: "12 site themes, animated profile cards, last.fm scrobbling & homepage decor",
      },
    ],
    selectors: ["#branding-container"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "search",
    category: "browsing",
    icon: "fa-magnifying-glass",
    title: "private search, tabs & split view",
    description:
      "type any search query or website url here to open a cloaked browsing session with multi-tab and split-screen support.",
    highlights: [
      {
        icon: "fa-compass",
        label: "7 search engines",
        detail: "switch duckduckgo, brave, startpage, mojeek, swisscows, google, or bing",
      },
      {
        icon: "fa-table-columns",
        label: "multi-tabs & split screen",
        detail: "open extra tabs from the sidebar and view two pages side by side",
      },
      {
        icon: "fa-bolt",
        label: "switchable proxy stack",
        detail: "swap scramjet/ultraviolet & epoxy/libcurl anytime inside settings",
      },
    ],
    selectors: [".search-bar"],
    preferredSide: "bottom",
    padding: 10,
  },
  {
    id: "bookmarks",
    category: "shortcuts",
    icon: "fa-bookmark",
    title: "custom bookmarks dock",
    description:
      "pin your favorite sites and tools right below the search bar for instant one-click access whenever you open a new homepage.",
    highlights: [
      {
        icon: "fa-plus",
        label: "quick add & edit",
        detail: "click + to add custom links or toggle edit mode to rename and remove",
      },
      {
        icon: "fa-cloud",
        label: "synced to your account",
        detail: "your saved shortcuts travel across mirror links with cloud sync",
      },
    ],
    selectors: ["#bookmarks-container"],
    preferredSide: "top",
    padding: 10,
  },
  {
    id: "games-apps",
    category: "entertainment",
    icon: "fa-gamepad",
    title: "games library & proxied apps",
    description:
      "browse hundreds of unblocked games across five catalog sources or launch popular web apps cleanly inside Operation Cookie.",
    highlights: [
      {
        icon: "fa-layer-group",
        label: "5 game sources",
        detail: "switch selenite, gn-math, edurocks, velara, and truffled in settings",
      },
      {
        icon: "fa-stopwatch",
        label: "live game activity & stats",
        detail: "track total playtime, top games, and currently-playing status on profiles",
      },
      {
        icon: "fa-table-cells-large",
        label: "one-click apps launcher",
        detail: "open proxied social, media, and utility apps from the top bar",
      },
    ],
    selectors: ["#choi", "#apps-btn"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "studio-shop",
    category: "studio & coins",
    icon: "fa-wand-magic-sparkles",
    title: "game studio & cookie coin shop",
    description:
      "build and share your own mini-games in Game Studio, earn Cookie Coins as you play, and unlock live shop effects.",
    highlights: [
      {
        icon: "fa-code",
        label: "community game studio",
        detail: "create custom playable games and showcase your creator studio profile",
      },
      {
        icon: "fa-cookie-bite",
        label: "cookie coin shop",
        detail: "spend coins on sound blasts, tts speech, and 1x screen trolls on friends",
      },
      {
        icon: "fa-trophy",
        label: "playtime & high scores",
        detail: "rack up sessions on leaderboards and earn coins automatically in games",
      },
    ],
    selectors: ["#studio-btn", "#shop-btn"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "chat-features",
    category: "community chat",
    icon: "fa-comments",
    title: "live chatroom, media & voice lounges",
    description:
      "hang out across public channels, start private DMs or custom group chats, share rich media, and talk live in voice rooms.",
    highlights: [
      {
        icon: "fa-hashtag",
        label: "channels, dms & group chats",
        detail: "#general, #games, #anime, #music, #tech, private dms, plus user groups",
      },
      {
        icon: "fa-camera",
        label: "images, camera & klipy gifs",
        detail: "upload photos/webp files, snap camera pics, send gifs, reply & react",
      },
      {
        icon: "fa-headset",
        label: "webrtc voice rooms",
        detail: "join general voice, gaming lounge, or music & chill right from chat",
      },
    ],
    selectors: ["#chat-btn"],
    preferredSide: "bottom",
    padding: 8,
    action: {
      label: "open chat",
      icon: "fa-comments",
      run: () => {
        window.setTimeout(() => {
          document.dispatchEvent(new CustomEvent("toggleChatModal"));
        }, 80);
      },
    },
  },
  {
    id: "profile-custom",
    category: "profile studio",
    icon: "fa-id-card",
    title: "custom profiles, collectibles & last.fm",
    description:
      "style your own profile card with animated collectibles, custom uploads, badges, and live music scrobbling synced to chat.",
    highlights: [
      {
        icon: "fa-images",
        label: "pfp, gif banners & cropping",
        detail: "upload custom avatars/banners, pick display names, pronouns, tags & bio theme",
      },
      {
        icon: "fa-star",
        label: "animated frames & effects",
        detail: "equip avatar decorations, particle card effects, glowing nameplates & fonts",
      },
      {
        icon: "fa-music",
        label: "last.fm live listening",
        detail: "link your last.fm username to show what track you're scrobbling live",
      },
    ],
    selectors: ["#auth-container"],
    preferredSide: "bottom",
    padding: 8,
    action: {
      label: "customize profile",
      icon: "fa-wand-magic-sparkles",
      run: () => {
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("openProfileCustomizer"));
        }, 80);
      },
    },
  },
  {
    id: "cloud-master",
    category: "sync & perks",
    icon: "fa-crown",
    title: "cloud sync & cookie master",
    description:
      "sign in once with Cloud Sync so your data follows you everywhere, or grab Cookie Master for ad-free perks.",
    highlights: [
      {
        icon: "fa-cloud-arrow-up",
        label: "cross-mirror cloud sync",
        detail: "sync settings, bookmarks, coins, and profile customizations across links",
      },
      {
        icon: "fa-crown",
        label: "cookie master perks",
        detail: "ad-free mode, daily bonus cookie coins & supporter crown status",
      },
    ],
    selectors: ["#master-btn"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "appearance-custom",
    category: "appearance",
    icon: "fa-palette",
    title: "12 themes, dark mode & homepage decor",
    description:
      "customize the whole look of Operation Cookie and place animated flair anywhere on your homepage.",
    highlights: [
      {
        icon: "fa-swatchbook",
        label: "12 built-in site themes",
        detail: "catppuccin, dracula, synthwave, tokyo night, nord, sakura & more",
      },
      {
        icon: "fa-wand-sparkles",
        label: "homepage decorations (beta)",
        detail: "drag, resize, rotate & layer up to 12 animated collectibles on home",
      },
      {
        icon: "fa-laptop",
        label: "dark mode & chromebook mode",
        detail: "low-light wallpaper mode or blur-free battery saver for school laptops",
      },
    ],
    selectors: ["#settings"],
    preferredSide: "bottom",
    padding: 8,
    action: {
      label: "open settings",
      icon: "fa-sliders",
      run: () => {
        window.setTimeout(dispatchOpenSettings, 80);
      },
    },
  },
  {
    id: "privacy-cloak",
    category: "cloaking & help",
    icon: "fa-shield-halved",
    title: "tab cloaking, oxium speed & tour replay",
    description:
      "keep your session discreet with instant tab cloaking, anti-close protection, and proxy optimization controls.",
    highlights: [
      {
        icon: "fa-mask",
        label: "site, link & focus cloaks",
        detail: "disguise as coursera, classroom, or drive, or wrap in about:blank / blob:",
      },
      {
        icon: "fa-lock",
        label: "prevent accidental close",
        detail: "enable the close confirmation guard and optimize network speed with oxium",
      },
      {
        icon: "fa-compass",
        label: "replay anytime",
        detail: "re-open this guide anytime in settings → preferences → replay tour",
      },
    ],
    selectors: [],
    preferredSide: "center",
    padding: 8,
  },
];

function isHomepageReady(): boolean {
  if (document.getElementById("root")) return false;
  if (document.getElementById("auth-gate-backdrop")) return false;

  const meow = document.querySelector(".meow") as HTMLElement | null;
  if (!meow || meow.style.display === "none") return false;

  const bodyClass = document.body.classList;
  for (const cls of NON_HOME_CLASSES) {
    if (bodyClass.contains(cls)) return false;
  }

  if (document.querySelector("#settings-menu.open, .chat-modal-overlay.open, #new-tab-modal.is-visible")) {
    return false;
  }

  return true;
}

function isElementVisible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function measureStepSpot(
  step: TourStep,
  rootRect: DOMRect,
  scaleX: number,
  scaleY: number,
): SpotRect | null {
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;
  let found = false;

  for (const selector of step.selectors) {
    const el = document.querySelector(selector);
    if (!el || !isElementVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const localLeft = (r.left - rootRect.left) * scaleX;
    const localTop = (r.top - rootRect.top) * scaleY;
    const localRight = (r.right - rootRect.left) * scaleX;
    const localBottom = (r.bottom - rootRect.top) * scaleY;

    if (localLeft < minLeft) minLeft = localLeft;
    if (localTop < minTop) minTop = localTop;
    if (localRight > maxRight) maxRight = localRight;
    if (localBottom > maxBottom) maxBottom = localBottom;
    found = true;
  }

  if (!found) return null;

  const pad = step.padding ?? 8;
  return {
    left: Math.max(4, minLeft - pad),
    top: Math.max(4, minTop - pad),
    width: Math.max(24, maxRight - minLeft + pad * 2),
    height: Math.max(24, maxBottom - minTop + pad * 2),
  };
}

export default function WelcomeTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [layout, setLayout] = useState<LayoutBox | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "done");
    } catch {
      // ignore storage quota / privacy mode errors
    }
  }, []);

  const closeTour = useCallback(() => {
    markSeen();
    setIsOpen(false);
    setLayout(null);
  }, [markSeen]);

  const startTour = useCallback(
    (persistSeen: boolean) => {
      if (persistSeen) {
        markSeen();
      }
      setLayout(null);
      setStepIndex(0);
      setIsOpen(true);
    },
    [markSeen],
  );

  // Auto-launch once for first-time users after cloak reveal & Cloud Sync gate complete.
  useEffect(() => {
    const hasSeen = () => {
      try {
        return localStorage.getItem(TOUR_STORAGE_KEY) === "done";
      } catch {
        return false;
      }
    };
    if (hasSeen()) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 24;
    let timerId: number | null = null;

    const tryAutoStart = () => {
      if (cancelled) return;
      if (hasSeen()) {
        cancelled = true;
        return;
      }
      if (isHomepageReady()) {
        cancelled = true;
        startTour(true);
        return;
      }
      const gated = Boolean(
        document.getElementById("root") || document.getElementById("auth-gate-backdrop"),
      );
      if (gated) {
        timerId = window.setTimeout(tryAutoStart, 600);
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        timerId = window.setTimeout(tryAutoStart, 350);
      }
    };

    const onAuthUnlock = () => {
      if (cancelled) return;
      if (timerId !== null) window.clearTimeout(timerId);
      timerId = window.setTimeout(tryAutoStart, 350);
    };

    timerId = window.setTimeout(tryAutoStart, 900);
    window.addEventListener("cloudsync-auth-changed", onAuthUnlock);
    document.addEventListener("cloudsync-restored", onAuthUnlock);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      window.removeEventListener("cloudsync-auth-changed", onAuthUnlock);
      document.removeEventListener("cloudsync-restored", onAuthUnlock);
    };
  }, [startTour]);

  // Allow replaying the tour from Settings or other UI controls.
  useEffect(() => {
    const handleStartEvent = () => {
      startTour(false);
    };
    document.addEventListener("startSunshineTour", handleStartEvent);
    return () => {
      document.removeEventListener("startSunshineTour", handleStartEvent);
    };
  }, [startTour]);

  const computeLayout = useCallback(() => {
    const overlayEl = overlayRef.current;
    const cardEl = cardRef.current;
    const step = TOUR_STEPS[stepIndex];
    if (!overlayEl || !step) return;

    const rootRect = overlayEl.getBoundingClientRect();
    const vw = overlayEl.clientWidth || window.innerWidth;
    const vh = overlayEl.clientHeight || window.innerHeight;
    const scaleX = rootRect.width > 0 ? vw / rootRect.width : 1;
    const scaleY = rootRect.height > 0 ? vh / rootRect.height : 1;

    const spot =
      step.preferredSide === "center"
        ? null
        : measureStepSpot(step, rootRect, scaleX, scaleY);

    const cardWidth = cardEl ? cardEl.offsetWidth : Math.min(416, vw - 24);
    const cardHeight = cardEl ? cardEl.offsetHeight : 320;
    const margin = 12;
    const gap = 14;

    let cardLeft = Math.max(margin, (vw - cardWidth) / 2);
    let cardTop = Math.max(margin, (vh - cardHeight) / 2);

    if (spot) {
      const spotCenterX = spot.left + spot.width / 2;
      cardLeft = spotCenterX - cardWidth / 2;
      cardLeft = Math.max(margin, Math.min(cardLeft, vw - cardWidth - margin));

      const belowTop = spot.top + spot.height + gap;
      const aboveTop = spot.top - cardHeight - gap;
      const fitsBelow = belowTop + cardHeight <= vh - margin;
      const fitsAbove = aboveTop >= margin;

      if (step.preferredSide === "top") {
        if (fitsAbove) {
          cardTop = aboveTop;
        } else if (fitsBelow) {
          cardTop = belowTop;
        } else {
          cardTop = Math.max(margin, Math.min(vh - cardHeight - margin, (vh - cardHeight) / 2));
        }
      } else if (fitsBelow) {
        cardTop = belowTop;
      } else if (fitsAbove) {
        cardTop = aboveTop;
      } else {
        const spaceBelow = vh - margin - belowTop;
        const spaceAbove = spot.top - gap - margin;
        cardTop =
          spaceBelow >= spaceAbove
            ? Math.max(margin, Math.min(belowTop, vh - cardHeight - margin))
            : margin;
      }
    }

    setLayout({
      spot,
      cardLeft,
      cardTop,
      viewportWidth: vw,
      viewportHeight: vh,
    });
  }, [stepIndex]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    computeLayout();
    const rafId = window.requestAnimationFrame(computeLayout);
    window.addEventListener("resize", computeLayout);
    window.addEventListener("scroll", computeLayout, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", computeLayout);
      window.removeEventListener("scroll", computeLayout, true);
    };
  }, [isOpen, stepIndex, computeLayout]);

  const handleNext = useCallback(() => {
    if (stepIndex >= TOUR_STEPS.length - 1) {
      closeTour();
    } else {
      setStepIndex((prev) => Math.min(TOUR_STEPS.length - 1, prev + 1));
    }
  }, [stepIndex, closeTour]);

  const handleBack = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleBack();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeTour, handleNext, handleBack]);

  const currentStep = TOUR_STEPS[stepIndex];
  if (!isOpen || !currentStep) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;
  const spot = layout?.spot ?? null;
  const vw = layout?.viewportWidth ?? window.innerWidth;
  const vh = layout?.viewportHeight ?? window.innerHeight;

  return (
    <div
      class="tour-overlay"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Operation Cookie feature tour"
    >
      <svg
        class="tour-backdrop-svg"
        viewBox={`0 0 ${vw} ${vh}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        onClick={closeTour}
      >
        <defs>
          <mask id="sunshine-tour-mask">
            <rect x="0" y="0" width={vw} height={vh} fill="white" />
            {spot && (
              <rect
                x={spot.left}
                y={spot.top}
                width={spot.width}
                height={spot.height}
                rx="14"
                ry="14"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width={vw}
          height={vh}
          fill="rgba(5, 7, 11, 0.74)"
          mask="url(#sunshine-tour-mask)"
        />
      </svg>

      {spot && (
        <div
          class="tour-spotlight-ring"
          aria-hidden="true"
          style={{
            left: `${spot.left}px`,
            top: `${spot.top}px`,
            width: `${spot.width}px`,
            height: `${spot.height}px`,
          }}
        />
      )}

      <div
        class="tour-card"
        ref={cardRef}
        style={
          layout
            ? {
                left: `${layout.cardLeft}px`,
                top: `${layout.cardTop}px`,
              }
            : {
                left: "12px",
                top: "12px",
                visibility: "hidden",
                transition: "none",
              }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div class="tour-card-header">
          <div class="tour-card-badge">
            <i class={`fa-solid ${currentStep.icon}`} aria-hidden="true" />
            <span>
              step {stepIndex + 1} / {TOUR_STEPS.length} · {currentStep.category}
            </span>
          </div>
          <button
            type="button"
            class="tour-close-btn"
            onClick={closeTour}
            aria-label="close tour"
            title="skip tour (esc)"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <h3 class="tour-card-title">{currentStep.title}</h3>
        <p class="tour-card-body">{currentStep.description}</p>

        {currentStep.highlights.length > 0 && (
          <ul class="tour-feature-list">
            {currentStep.highlights.map((item) => (
              <li key={item.label} class="tour-feature-item">
                <span class="tour-feature-icon" aria-hidden="true">
                  <i class={`fa-solid ${item.icon}`} />
                </span>
                <div class="tour-feature-copy">
                  <span class="tour-feature-label">{item.label}</span>
                  <span class="tour-feature-detail">{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div class="tour-dots" aria-label="tour steps">
          {TOUR_STEPS.map((step, idx) => (
            <button
              key={step.id}
              type="button"
              class={`tour-dot${idx === stepIndex ? " active" : ""}`}
              onClick={() => setStepIndex(idx)}
              title={`${idx + 1}. ${step.title}`}
              aria-label={`Jump to step ${idx + 1}: ${step.title}`}
            />
          ))}
        </div>

        <div class="tour-card-actions">
          <div class="tour-left-actions">
            <button type="button" class="tour-skip-btn" onClick={closeTour}>
              skip
            </button>
            {currentStep.action && (
              <button
                type="button"
                class="tour-try-btn"
                onClick={() => {
                  const act = currentStep.action;
                  closeTour();
                  act?.run();
                }}
              >
                <i class={`fa-solid ${currentStep.action.icon}`} aria-hidden="true" />
                <span>{currentStep.action.label}</span>
              </button>
            )}
          </div>
          <div class="tour-nav-btns">
            {!isFirst && (
              <button type="button" class="tour-btn-secondary" onClick={handleBack}>
                back
              </button>
            )}
            <button type="button" class="tour-btn-primary" onClick={handleNext}>
              {isLast ? "get started" : "next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
