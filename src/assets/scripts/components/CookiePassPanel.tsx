import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { formatDurationCompact } from "../core/cookieCoins.ts";
import {
  GAME_PASS_LEVELS,
  GamePassProgress,
  PassReward,
  PassTrack,
  claimAllReadyPassRewards,
  claimDailyPassXp,
  claimPassReward,
  getGamePassProgress,
} from "../core/gamePass.ts";

interface CookiePassPanelProps {
  isActiveMaster: boolean;
  onPromptUpgrade?: () => void;
}

export default function CookiePassPanel({
  isActiveMaster,
  onPromptUpgrade,
}: CookiePassPanelProps) {
  const [progress, setProgress] = useState<GamePassProgress>(() => getGamePassProgress());
  const railRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setProgress(getGamePassProgress());
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener("cookie-pass-updated", refresh);
    window.addEventListener("cookie-coins-updated", refresh);
    window.addEventListener("cookie-master-changed", refresh);
    window.addEventListener("storage", refresh);
    document.addEventListener("cloudsync-restored", refresh);
    const timer = window.setInterval(refresh, 20000);
    return () => {
      window.removeEventListener("cookie-pass-updated", refresh);
      window.removeEventListener("cookie-coins-updated", refresh);
      window.removeEventListener("cookie-master-changed", refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("cloudsync-restored", refresh);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const scrollRail = (dir: -1 | 1) => {
    if (!railRef.current) return;
    railRef.current.scrollBy({ left: dir * 360, behavior: "smooth" });
  };

  const handleClaim = (level: number, track: PassTrack) => {
    if (track === "pro" && !isActiveMaster) {
      onPromptUpgrade?.();
      return;
    }
    const res = claimPassReward(level, track);
    if (res.claimed) {
      refresh();
    }
  };

  const handleClaimAll = () => {
    const res = claimAllReadyPassRewards();
    if (res.count > 0) refresh();
  };

  const handleDailyXp = () => {
    const res = claimDailyPassXp();
    if (res.claimed) refresh();
  };

  const claimedSet = new Set(progress.claimedIds);
  const xpMult = progress.effectiveXpMultiplier;

  const renderRewardCard = (level: number, track: PassTrack, reward: PassReward) => {
    const levelUnlocked = progress.level >= level;
    const isProLocked = track === "pro" && !isActiveMaster;
    const isClaimed = claimedSet.has(reward.id);
    const canClaim = levelUnlocked && !isProLocked && !isClaimed;
    const isCrate = Boolean(reward.crateRange);

    return (
      <div
        class={`cookie-pass-card is-${track} rarity-${reward.rarity}${
          canClaim ? " is-claimable" : ""
        }${isClaimed ? " is-claimed" : ""}${!levelUnlocked ? " is-locked" : ""}${
          isProLocked ? " is-pro-locked" : ""
        }`}
      >
        <div class="cookie-pass-card-top">
          <div
            class="cookie-pass-card-icon"
            style={{
              color: reward.accent,
              borderColor: `${reward.accent}44`,
              background: `${reward.accent}18`,
            }}
          >
            <i class={`fa-solid ${reward.icon}`} />
          </div>
          {track === "pro" && (
            <span class="cookie-pass-pro-pill">
              <i class="fa-solid fa-crown" /> pro
            </span>
          )}
          {track === "free" && <span class="cookie-pass-free-pill">free</span>}
        </div>

        <div class="cookie-pass-card-body">
          <div class="cookie-pass-card-title">{reward.title}</div>
          <div class="cookie-pass-card-sub">{reward.subtitle}</div>
        </div>

        <div class="cookie-pass-card-footer">
          {isClaimed ? (
            <div class="cookie-pass-status is-done">
              <i class="fa-solid fa-circle-check" />
              <span>{isCrate ? "opened" : "claimed"}</span>
            </div>
          ) : canClaim ? (
            <button
              type="button"
              class={`cookie-pass-btn ${track === "pro" ? "is-claim-pro" : "is-claim-free"}`}
              onClick={() => handleClaim(level, track)}
            >
              <i class={`fa-solid ${isCrate ? "fa-box-open" : "fa-gift"}`} />
              <span>{isCrate ? "open vault" : "claim"}</span>
            </button>
          ) : isProLocked ? (
            <button
              type="button"
              class="cookie-pass-btn is-upgrade"
              onClick={() => onPromptUpgrade?.()}
            >
              <i class="fa-solid fa-lock" />
              <span>{levelUnlocked ? "unlock pro" : `pro · lvl ${level}`}</span>
            </button>
          ) : (
            <div class="cookie-pass-status">
              <i class="fa-solid fa-lock" />
              <span>lvl {level}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div class="studio-panel cookie-pass-panel">
      {/* Header Row */}
      <div class="cookie-pass-header">
        <div class="cookie-pass-title-group">
          <div class="cookie-pass-badge-icon">
            <i class="fa-solid fa-gamepad" />
          </div>
          <div>
            <div class="cookie-pass-title-row">
              <h2 class="cookie-pass-title">cookie pass</h2>
              <span class="cookie-pass-season-pill">season {progress.season}</span>
              <span class="cookie-pass-lvl-pill">
                lvl {progress.level} / {progress.maxLevel}
              </span>
              {xpMult > 1 ? (
                <span class="cookie-pass-boost-pill">
                  <i class="fa-solid fa-bolt" /> {xpMult}x xp active
                </span>
              ) : (
                <span class="cookie-pass-free-status-pill">free track active</span>
              )}
              {progress.coinBoostRemainingMs > 0 && (
                <span
                  class="cookie-pass-boost-pill"
                  style={{
                    background: "rgba(249, 115, 22, 0.16)",
                    color: "#fdba74",
                    borderColor: "rgba(249, 115, 22, 0.38)",
                  }}
                >
                  <i class="fa-solid fa-coins" /> 2x coins ({formatDurationCompact(progress.coinBoostRemainingMs)})
                </span>
              )}
              {progress.xpBoostRemainingMs > 0 && (
                <span
                  class="cookie-pass-boost-pill"
                  style={{
                    background: "rgba(168, 85, 247, 0.16)",
                    color: "#d8b4fe",
                    borderColor: "rgba(168, 85, 247, 0.38)",
                  }}
                >
                  <i class="fa-solid fa-angles-up" /> 2x xp ({formatDurationCompact(progress.xpBoostRemainingMs)})
                </span>
              )}
              {progress.prankTokens > 0 && (
                <span
                  class="cookie-pass-boost-pill"
                  style={{
                    background: "rgba(34, 211, 238, 0.14)",
                    color: "#67e8f9",
                    borderColor: "rgba(34, 211, 238, 0.35)",
                  }}
                >
                  <i class="fa-solid fa-ticket" /> {progress.prankTokens} free prank token{progress.prankTokens === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p class="cookie-pass-subtitle">
              level up by chatting, playing games, and using operation cookie · unlock coin vaults, 2x boosters, free shop prank tokens &amp; pro days
            </p>
          </div>
        </div>

        <div class="cookie-pass-header-actions">
          <button
            type="button"
            class="studio-tab-btn"
            disabled={!progress.canClaimDailyXp}
            onClick={handleDailyXp}
            style={{
              opacity: progress.canClaimDailyXp ? 1 : 0.6,
              cursor: progress.canClaimDailyXp ? "pointer" : "not-allowed",
            }}
          >
            <i class="fa-solid fa-calendar-check" style={{ color: "#4ade80" }} />
            <span>
              {progress.canClaimDailyXp
                ? `daily check-in (+${Math.round(30 * xpMult)} xp)`
                : `daily xp in ${formatDurationCompact(progress.dailyXpRemainingMs)}`}
            </span>
          </button>

          {progress.readyClaimCount > 0 && (
            <button
              type="button"
              class="apps-custom-btn"
              onClick={handleClaimAll}
              style={{ padding: "8px 14px", fontSize: "12.5px" }}
            >
              <i class="fa-solid fa-gifts" />
              <span>claim all ({progress.readyClaimCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* XP Bar & Earning Sources */}
      <div class="cookie-pass-progress-box">
        <div class="cookie-pass-progress-meta">
          <span class="cookie-pass-xp-main">
            {progress.isMaxLevel
              ? `max level reached · ${progress.xp.toLocaleString()} total xp`
              : `${progress.xpIntoLevel.toLocaleString()} / ${progress.xpNeededForNext.toLocaleString()} xp to lvl ${progress.level + 1}`}
          </span>
          <span class="cookie-pass-xp-total">
            total: {progress.xp.toLocaleString()} xp
          </span>
        </div>
        <div class="cookie-pass-progress-track">
          <div
            class="cookie-pass-progress-fill"
            style={{ width: `${progress.levelPercent}%` }}
          />
        </div>

        <div class="cookie-pass-xp-sources">
          <div class="cookie-pass-source-chip">
            <i class="fa-solid fa-comments" style={{ color: "#60a5fa" }} />
            <span>chatting</span>
            <strong>+{Math.round(4 * xpMult)} xp / msg</strong>
            <span class="cookie-pass-source-earned">{progress.chatXp} xp</span>
          </div>
          <div class="cookie-pass-source-chip">
            <i class="fa-solid fa-gamepad" style={{ color: "#a855f7" }} />
            <span>playing games</span>
            <strong>+{Math.round(10 * xpMult)} xp / min</strong>
            <span class="cookie-pass-source-earned">{progress.gameXp} xp</span>
          </div>
          <div class="cookie-pass-source-chip">
            <i class="fa-solid fa-globe" style={{ color: "#34d399" }} />
            <span>using site</span>
            <strong>+{Math.round(5 * xpMult)} xp / 5m</strong>
            <span class="cookie-pass-source-earned">{progress.siteXp} xp</span>
          </div>
        </div>
      </div>

      {/* Dual-Track Horizontal Reward Rail */}
      <div class="cookie-pass-rail-wrap">
        <div class="cookie-pass-rail-controls">
          <div class="cookie-pass-track-legend">
            <span class="cookie-pass-legend-free">
              <i class="fa-solid fa-star" /> free tier (top)
            </span>
            <span class="cookie-pass-legend-pro">
              <i class="fa-solid fa-crown" /> pro tier · cookie master (bottom)
            </span>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              class="cookie-pass-scroll-btn"
              title="Scroll left"
              onClick={() => scrollRail(-1)}
            >
              <i class="fa-solid fa-chevron-left" />
            </button>
            <button
              type="button"
              class="cookie-pass-scroll-btn"
              title="Scroll right"
              onClick={() => scrollRail(1)}
            >
              <i class="fa-solid fa-chevron-right" />
            </button>
          </div>
        </div>

        <div class="cookie-pass-rail" ref={railRef}>
          {GAME_PASS_LEVELS.map((def, idx) => {
            const reached = progress.level >= def.level;
            const nextReached =
              idx < GAME_PASS_LEVELS.length - 1 && progress.level >= GAME_PASS_LEVELS[idx + 1].level;
            return (
              <div key={def.level} class="cookie-pass-col">
                {renderRewardCard(def.level, "free", def.free)}

                <div class="cookie-pass-node-row">
                  <div
                    class={`cookie-pass-connector left${
                      idx === 0 ? " is-hidden" : reached ? " is-filled" : ""
                    }`}
                  />
                  <div
                    class={`cookie-pass-node${reached ? " is-reached" : ""}${
                      progress.level === def.level ? " is-current" : ""
                    }`}
                    title={`Level ${def.level} (${def.xpRequired.toLocaleString()} XP)`}
                  >
                    {def.level}
                  </div>
                  <div
                    class={`cookie-pass-connector right${
                      idx === GAME_PASS_LEVELS.length - 1
                        ? " is-hidden"
                        : nextReached
                          ? " is-filled"
                          : ""
                    }`}
                  />
                </div>

                {renderRewardCard(def.level, "pro", def.pro)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
