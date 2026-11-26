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

export const ADDON_APPS_CATALOG: AddonAppDef[] = [
  {
    id: "streamwatcher",
    name: "streamwatcher",
    tagline: "watch any live stream in a draggable, resizable rounded PiP overlay on every page",
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
  setAddonAppOpenState(id, true);
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

export function toggleAddonAppOpen(id: string): boolean {
  const next = !getAddonAppOpenState(id);
  setAddonAppOpenState(id, next);
  return next;
}

export interface ParsedStreamTarget {
  embedUrl: string;
  label: string;
  platform: "twitch" | "youtube" | "kick" | "web";
  error?: string;
}

export function parseStreamEmbedUrl(rawInput: string): ParsedStreamTarget | null {
  const raw = (rawInput || "").trim();
  if (!raw) return null;

  const safety = checkContent(raw);
  if (safety.blocked) {
    return {
      embedUrl: "",
      label: "",
      platform: "web",
      error: safety.reason || "blocked by safety filter",
    };
  }

  const parentHost =
    typeof window !== "undefined" && window.location.hostname
      ? window.location.hostname
      : "localhost";

  // Shorthand twitch:channel
  const twitchShort = /^twitch:([a-zA-Z0-9_]{2,32})$/i.exec(raw);
  if (twitchShort) {
    const ch = twitchShort[1].toLowerCase();
    return {
      embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(ch)}&parent=${encodeURIComponent(parentHost)}&muted=false`,
      label: `twitch.tv/${ch}`,
      platform: "twitch",
    };
  }

  // Shorthand kick:channel
  const kickShort = /^kick:([a-zA-Z0-9_-]{2,32})$/i.exec(raw);
  if (kickShort) {
    const ch = kickShort[1].toLowerCase();
    return {
      embedUrl: `https://player.kick.com/${encodeURIComponent(ch)}`,
      label: `kick.com/${ch}`,
      platform: "kick",
    };
  }

  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withProto);
  } catch {
    return {
      embedUrl: "",
      label: "",
      platform: "web",
      error: "enter a valid twitch, youtube, kick, or stream url",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      embedUrl: "",
      label: "",
      platform: "web",
      error: "only https stream urls are supported",
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const pathParts = parsed.pathname.split("/").filter(Boolean);

  // Twitch URLs
  if (host === "twitch.tv" || host === "m.twitch.tv" || host === "player.twitch.tv") {
    const ch = parsed.searchParams.get("channel") || pathParts[0] || "";
    if (!ch || !/^[a-zA-Z0-9_]{2,32}$/.test(ch)) {
      return {
        embedUrl: "",
        label: "",
        platform: "twitch",
        error: "enter a twitch channel url (e.g. twitch.tv/channel)",
      };
    }
    return {
      embedUrl: `https://player.twitch.tv/?channel=${encodeURIComponent(ch.toLowerCase())}&parent=${encodeURIComponent(parentHost)}&muted=false`,
      label: `twitch.tv/${ch.toLowerCase()}`,
      platform: "twitch",
    };
  }

  // YouTube live / watch / shorts / youtu.be
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "youtu.be" ||
    host === "youtube-nocookie.com"
  ) {
    let vid = "";
    if (host === "youtu.be") {
      vid = pathParts[0] || "";
    } else if (pathParts[0] === "watch") {
      vid = parsed.searchParams.get("v") || "";
    } else if (pathParts[0] === "live" || pathParts[0] === "embed" || pathParts[0] === "shorts") {
      vid = pathParts[1] || "";
    }
    if (vid && /^[a-zA-Z0-9_-]{6,20}$/.test(vid)) {
      return {
        embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(vid)}?autoplay=1&rel=0`,
        label: `youtube · ${vid}`,
        platform: "youtube",
      };
    }
    return {
      embedUrl: "",
      label: "",
      platform: "youtube",
      error: "paste a youtube live or video link (e.g. youtube.com/watch?v=... or youtube.com/live/...)",
    };
  }

  // Kick URLs
  if (host === "kick.com" || host === "player.kick.com") {
    const ch = pathParts[0] || "";
    if (!ch || !/^[a-zA-Z0-9_-]{2,32}$/.test(ch)) {
      return {
        embedUrl: "",
        label: "",
        platform: "kick",
        error: "enter a kick channel url (e.g. kick.com/channel)",
      };
    }
    return {
      embedUrl: `https://player.kick.com/${encodeURIComponent(ch.toLowerCase())}`,
      label: `kick.com/${ch.toLowerCase()}`,
      platform: "kick",
    };
  }

  // Generic HTTPS embed/stream URL
  return {
    embedUrl: parsed.toString(),
    label: host,
    platform: "web",
  };
}
