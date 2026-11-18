import { useEffect, useState } from "preact/hooks";
import {
  LastfmProfileState,
  getSafeMediaProxySrc,
  sanitizeLastfmUsername,
} from "../core/profileCustomization.ts";

interface LastfmListeningCardProps {
  lastfmUsername?: string | undefined;
  lastfm?: LastfmProfileState | null | undefined;
  loading?: boolean | undefined;
  compact?: boolean | undefined;
  nowMs?: number | undefined;
  refreshing?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
}

function formatScrobbleAge(tsMs: number, nowMs: number): string {
  if (!tsMs || !Number.isFinite(tsMs)) return "recently";
  const diffSec = Math.max(0, Math.floor((nowMs - tsMs) / 1000));
  if (diffSec < 60) return "just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function LastfmListeningCard({
  lastfmUsername,
  lastfm,
  loading = false,
  compact = false,
  nowMs = Date.now(),
  refreshing = false,
  onRefresh,
}: LastfmListeningCardProps) {
  const handle = sanitizeLastfmUsername(lastfm?.username || lastfmUsername || "");
  const track = lastfm?.track || null;
  const artRaw = track?.albumArt || "";
  const [artBroken, setArtBroken] = useState(false);

  useEffect(() => {
    setArtBroken(false);
  }, [artRaw]);

  if (!handle) return null;

  const profileUrl = lastfm?.profileUrl || `https://www.last.fm/user/${encodeURIComponent(handle)}`;
  const artSrc = !artBroken && artRaw ? getSafeMediaProxySrc(artRaw) : "";
  const isNow = Boolean(track?.nowPlaying || lastfm?.nowPlaying);

  return (
    <div
      class={`chat-profile-lastfm-box ${isNow ? "is-now-playing" : ""} ${
        compact ? "is-compact" : ""
      }`}
    >
      <div class="chat-profile-lastfm-head">
        <div class="chat-profile-lastfm-status">
          {isNow ? (
            <>
              <span class="chat-lastfm-eq" aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
              </span>
              <span>listening now on last.fm</span>
            </>
          ) : (
            <>
              <i class="fa-brands fa-lastfm" aria-hidden="true"></i>
              <span>
                {track
                  ? `last played · ${formatScrobbleAge(track.scrobbledAt, nowMs)}`
                  : "last.fm"}
              </span>
            </>
          )}
        </div>

        <div class="chat-profile-lastfm-controls">
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="chat-profile-lastfm-user-link"
            title={`Open ${handle} on Last.fm`}
          >
            @{handle}
          </a>
          {onRefresh && (
            <button
              type="button"
              class={`chat-profile-lastfm-refresh ${refreshing ? "is-spinning" : ""}`}
              title="Refresh Last.fm listening status"
              aria-label="Refresh Last.fm"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <i class="fa-solid fa-arrows-rotate"></i>
            </button>
          )}
        </div>
      </div>

      {track ? (
        <div class="chat-profile-lastfm-track">
          <div class="chat-profile-lastfm-art-wrap">
            {artSrc ? (
              <img
                src={artSrc}
                alt={track.album || track.name}
                class="chat-profile-lastfm-art"
                loading="lazy"
                decoding="async"
                onError={() => setArtBroken(true)}
              />
            ) : (
              <div class="chat-profile-lastfm-art-fallback" aria-hidden="true">
                <i class={`fa-solid ${isNow ? "fa-compact-disc" : "fa-music"}`}></i>
              </div>
            )}
          </div>
          <div class="chat-profile-lastfm-meta">
            <a
              href={track.url || profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="chat-profile-lastfm-title"
              title={track.name}
            >
              {track.name}
            </a>
            <div class="chat-profile-lastfm-artist" title={track.artist}>
              {track.artist || "unknown artist"}
              {track.album ? ` · ${track.album}` : ""}
            </div>
          </div>
        </div>
      ) : (
        <div class="chat-profile-lastfm-empty">
          {loading
            ? "checking last.fm scrobbles..."
            : lastfm && lastfm.configured === false
            ? "scrobble preview unavailable until server LASTFM_API_KEY is set"
            : lastfm?.error || "no recent tracks scrobbled yet."}
        </div>
      )}
    </div>
  );
}
