/**
 * Operation Cookie - Installable Add-on Apps Registry & State
 * Browse and install customization apps from Chat Add-ons -> Apps.
 */

import { checkContent } from "./contentFilter.ts";

export interface AddonAppDef {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  accent: string;
  status: "ready" | "coming-soon";
}

export interface FollowedStreamer {
  id: string;
  platform: "twitch" | "youtube";
  channel: string; // twitch login (e.g. "kaicenat") or youtube path (e.g. "@ishowspeed" or "channel/UC...")
  label: string;
  rawUrl: string;
  addedAt: number;
}

export const ADDON_APPS_CATALOG: AddonAppDef[] = [
  {
    id: "streamwatcher",
    name: "streamwatcher",
    tagline: "follow twitch & youtube streamers — auto-pops a draggable, resizable muted PiP when they go live",
    icon: "fa-tv",
    accent: "#a855f7",
    status: "ready",
  },
  {
    id: "addon_slot_2",
    name: "coming soon",
    tagline: "second operation cookie customization app — dropping next",
    icon: "fa-puzzle-piece",
    accent: "#38bdf8",
    status: "coming-soon",
  },
  {
    id: "addon_slot_3",
    name: "coming soon",
    tagline: "third operation cookie customization app — dropping next",
    icon: "fa-sparkles",
    accent: "#fbbf24",
    status: "coming-soon",
  },
];

const INSTALLED_ADDONS_KEY = "cookie_installed_addons_v1";
const OPEN_ADDONS_KEY = "cookie_open_addons_v1";
const FOLLOWED_STREAMERS_KEY = "cookie_streamwatcher_follows_v1";

function emitAddonsChanged() {
  try {
    window.dispatchEvent(new CustomEvent("cookie-addons-updated"));
  } catch {}
}

export function getInstalledAddonApps(): string[] {
  try {
    const raw = localStorage.getItem(INSTALLED_ADDONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export function isAddonAppInstalled(id: string): boolean {
  return getInstalledAddonApps().includes(id);
}

export function installAddonApp(id: string): void {
  const cur = getInstalledAddonApps();
  if (!cur.includes(id)) {
    try {
      localStorage.setItem(INSTALLED_ADDONS_KEY, JSON.stringify([...cur, id]));
    } catch {}
  }
  emitAddonsChanged();
  openAddonAppUi(id);
}

export function uninstallAddonApp(id: string): void {
  const next = getInstalledAddonApps().filter((x) => x !== id);
  try {
    localStorage.setItem(INSTALLED_ADDONS_KEY, JSON.stringify(next));
  } catch {}
  setAddonAppOpenState(id, false);
}

function getOpenAddonsMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_ADDONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getAddonAppOpenState(id: string): boolean {
  if (!isAddonAppInstalled(id)) return false;
  return Boolean(getOpenAddonsMap()[id]);
}

export function setAddonAppOpenState(id: string, open: boolean): void {
  const map = getOpenAddonsMap();
  map[id] = Boolean(open);
  try {
    localStorage.setItem(OPEN_ADDONS_KEY, JSON.stringify(map));
  } catch {}
  emitAddonsChanged();
}

export function openAddonAppUi(id: string): void {
  try {
    window.dispatchEvent(new CustomEvent("cookie-addon-open-ui", { detail: { id } }));
  } catch {}
}

export function getFollowedStreamers(): FollowedStreamer[] {
  try {
    const raw = localStorage.getItem(FOLLOWED_STREAMERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is FollowedStreamer =>
        Boolean(s && typeof s === "object" && (s.platform === "twitch" || s.platform === "youtube") && s.channel)
    );
  } catch {
    return [];
  }
}

export function parseFollowChannelUrl(
  rawInput: string
): { streamer?: FollowedStreamer; error?: string } {
  const raw = (rawInput || "").trim();
  if (!raw) return { error: "enter a twitch or youtube channel url" };

  const safety = checkContent(raw);
  if (safety.blocked) {
    return { error: safety.reason || "blocked by safety filter" };
  }

  // Shorthand twitch:username
  const twShort = /^twitch:([a-zA-Z0-9_]{2,32})$/i.exec(raw);
  if (twShort) {
    const ch = twShort[1].toLowerCase();
    return {
      streamer: {
        id: `twitch:${ch}`,
        platform: "twitch",
        channel: ch,
        label: `twitch.tv/${ch}`,
        rawUrl: `https://twitch.tv/${ch}`,
        addedAt: Date.now(),
      },
    };
  }

  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withProto);
  } catch {
    return { error: "paste a valid twitch.tv/channel or youtube.com/@channel url" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (host === "twitch.tv" || host === "m.twitch.tv") {
    const login = (parts[0] || "").toLowerCase();
    if (!login || !/^[a-z0-9_]{2,32}$/.test(login)) {
      return { error: "enter a twitch channel url (e.g. twitch.tv/kaicenat)" };
    }
    return {
      streamer: {
        id: `twitch:${login}`,
        platform: "twitch",
        channel: login,
        label: `twitch.tv/${login}`,
        rawUrl: `https://twitch.tv/${login}`,
        addedAt: Date.now(),
      },
    };
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    let channelPath = "";
    let label = "";
    if (parts[0]?.startsWith("@")) {
      channelPath = parts[0];
      label = `youtube.com/${parts[0]}`;
    } else if (
      (parts[0] === "channel" || parts[0] === "c" || parts[0] === "user") &&
      parts[1]
    ) {
      channelPath = `${parts[0]}/${parts[1]}`;
      label = `youtube.com/${parts[0]}/${parts[1]}`;
    }
    if (!channelPath) {
      return { error: "enter a youtube channel url (e.g. youtube.com/@handle)" };
    }
    return {
      streamer: {
        id: `youtube:${channelPath.toLowerCase()}`,
        platform: "youtube",
        channel: channelPath,
        label,
        rawUrl: `https://www.youtube.com/${channelPath}`,
        addedAt: Date.now(),
      },
    };
  }

  return { error: "only twitch and youtube channel urls are supported right now" };
}

export function followStreamer(rawInput: string): {
  added: boolean;
  streamer?: FollowedStreamer;
  error?: string;
} {
  const res = parseFollowChannelUrl(rawInput);
  if (res.error || !res.streamer) {
    return { added: false, error: res.error || "invalid channel url" };
  }
  const cur = getFollowedStreamers();
  if (cur.some((s) => s.id === res.streamer!.id)) {
    return { added: false, error: `already following ${res.streamer.label}` };
  }
  const next = [res.streamer, ...cur].slice(0, 20);
  try {
    localStorage.setItem(FOLLOWED_STREAMERS_KEY, JSON.stringify(next));
  } catch {}
  emitAddonsChanged();
  return { added: true, streamer: res.streamer };
}

export function unfollowStreamer(id: string): void {
  const next = getFollowedStreamers().filter((s) => s.id !== id);
  try {
    localStorage.setItem(FOLLOWED_STREAMERS_KEY, JSON.stringify(next));
  } catch {}
  emitAddonsChanged();
}

export function buildStreamEmbedUrl(
  platform: "twitch" | "youtube",
  channel: string,
  opts: { muted: boolean; videoId?: string }
): string {
  const parentHost =
    typeof window !== "undefined" && window.location.hostname
      ? window.location.hostname
      : "localhost";
  if (platform === "twitch") {
    const login = channel.replace(/^@/, "").toLowerCase();
    return `https://player.twitch.tv/?channel=${encodeURIComponent(login)}&parent=${encodeURIComponent(parentHost)}&muted=${opts.muted ? "true" : "false"}`;
  }
  if (opts.videoId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(opts.videoId)}?autoplay=1&mute=${opts.muted ? "1" : "0"}&enablejsapi=1&rel=0`;
  }
  return "";
}
