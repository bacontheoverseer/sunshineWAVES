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

interface TourStep {
  id: string;
  icon: string;
  title: string;
  description: string;
  selectors: string[];
  preferredSide: "bottom" | "top" | "center";
  padding?: number;
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

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    icon: "fa-cookie-bite",
    title: "welcome to operation cookie",
    description:
      "your all-in-one spot for private browsing, unblocked games, apps, community chat, and custom themes. here is a quick 30-second tour.",
    selectors: ["#branding-container"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "search",
    icon: "fa-magnifying-glass",
    title: "search & proxied tabs",
    description:
      "type any search query or website url here to open a private tab. manage open tabs and split-screen views from the sidebar on the left.",
    selectors: [".search-bar"],
    preferredSide: "bottom",
    padding: 10,
  },
  {
    id: "games-apps",
    icon: "fa-gamepad",
    title: "games & apps library",
    description:
      "jump into hundreds of games across multiple sources or launch popular web apps—all inside clean, customizable views.",
    selectors: ["#choi", "#apps-btn"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "studio-shop",
    icon: "fa-wand-magic-sparkles",
    title: "game studio & cookie shop",
    description:
      "create and share your own mini-games in game studio, earn cookie coins by playing, and unlock items in the shop.",
    selectors: ["#studio-btn", "#shop-btn"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "chat",
    icon: "fa-comments",
    title: "live chatroom, gifs & voice",
    description:
      "hang out with other players in chat, send klipy gifs, or hop into voice rooms right from the top bar.",
    selectors: ["#chat-btn"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "cloud-master",
    icon: "fa-crown",
    title: "cloud sync & cookie master",
    description:
      "sign in with cloud sync to carry your settings and coins across mirror links—or tap the crown for ad-free mode and daily bonus coins.",
    selectors: ["#master-btn", "#auth-container"],
    preferredSide: "bottom",
    padding: 8,
  },
  {
    id: "settings",
    icon: "fa-sliders",
    title: "themes, tab cloaking & legal",
    description:
      "open settings anytime to switch themes, pick a tab cloak (coursera, classroom, drive), set panic keys, or replay this tour.",
    selectors: ["#settings"],
    preferredSide: "bottom",
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

  if (document.querySelector("#settings-menu.open, .chat-modal.open, #new-tab-modal.is-visible")) {
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
  }, [markSeen]);

  const startTour = useCallback(
    (persistSeen: boolean) => {
      if (persistSeen) {
        markSeen();
      }
      setStepIndex(0);
      setIsOpen(true);
    },
    [markSeen],
  );

  // Auto-launch once for first-time users after cloak reveal completes.
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(TOUR_STORAGE_KEY) === "done";
    } catch {
      seen = false;
    }
    if (seen) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 24;
    let timerId: number | null = null;

    const tryAutoStart = () => {
      if (cancelled) return;
      if (isHomepageReady()) {
        startTour(true);
        return;
      }
      attempts += 1;
      if (attempts < maxAttempts) {
        timerId = window.setTimeout(tryAutoStart, 350);
      }
    };

    timerId = window.setTimeout(tryAutoStart, 900);

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
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

    const cardWidth = cardEl ? cardEl.offsetWidth : Math.min(348, vw - 24);
    const cardHeight = cardEl ? cardEl.offsetHeight : 196;
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

      if (belowTop + cardHeight <= vh - margin) {
        cardTop = belowTop;
      } else if (aboveTop >= margin) {
        cardTop = aboveTop;
      } else {
        cardTop = Math.max(margin, Math.min(vh - cardHeight - margin, (vh - cardHeight) / 2));
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
      aria-label="Operation Cookie welcome tour"
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
          fill="rgba(5, 7, 11, 0.72)"
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
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
              }
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div class="tour-card-header">
          <div class="tour-card-badge">
            <i class={`fa-solid ${currentStep.icon}`} aria-hidden="true" />
            <span>
              step {stepIndex + 1} / {TOUR_STEPS.length}
            </span>
          </div>
          <button
            type="button"
            class="tour-close-btn"
            onClick={closeTour}
            aria-label="close tour"
            title="skip tour"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <h3 class="tour-card-title">{currentStep.title}</h3>
        <p class="tour-card-body">{currentStep.description}</p>

        <div class="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((step, idx) => (
            <button
              key={step.id}
              type="button"
              class={`tour-dot${idx === stepIndex ? " active" : ""}`}
              onClick={() => setStepIndex(idx)}
              tabIndex={-1}
            />
          ))}
        </div>

        <div class="tour-card-actions">
          <button type="button" class="tour-skip-btn" onClick={closeTour}>
            skip tour
          </button>
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
