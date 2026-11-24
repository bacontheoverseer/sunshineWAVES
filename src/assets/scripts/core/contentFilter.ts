/**
 * Operation Cookie - Content Filter & OpenAI Moderation
 * Blocks adult/NSFW content, online gambling, malware/phishing, and severe harm
 * (hate speech, self-harm, severe violence/threats, sexual content) while explicitly
 * excluding casual swear words / profanity in chat.
 */

// Supply your OpenAI API key here in the code (or in index.mjs / OPENAI_API_KEY env var):
const OPENAI_MODERATION_API_KEY = "YOUR_OPENAI_API_KEY_HERE";

// Blocked domain signatures (pornography & adult entertainment)
const ADULT_PATTERNS = [
  "pornhub",
  "xvideos",
  "xnxx",
  "redtube",
  "xhamster",
  "youporn",
  "onlyfans",
  "chaturbate",
  "stripchat",
  "bongacams",
  "cam4",
  "livejasmin",
  "beeg",
  "spankbang",
  "hentai",
  "rule34",
  "nhentai",
  "e-hentai",
  "brazzers",
  "erome",
  "fapello",
  "porndig",
  "heavy-r",
  "motherless",
  "tblop",
  "eporner",
  "tube8",
  "daftsex",
  "xcafe",
  "hqporner",
  "tnaflix",
  "porn",
  "xxx",
  "nsfw",
  "nude",
];

// Blocked domain signatures (gambling, casinos, betting, skin gambling)
const GAMBLING_PATTERNS = [
  "stake.com",
  "roobet",
  "bet365",
  "1xbet",
  "bovada",
  "draftkings",
  "fanduel",
  "betfair",
  "pokerstars",
  "888casino",
  "betway",
  "williamhill",
  "betonline",
  "csgoroll",
  "csgoluck",
  "clash.gg",
  "hellcase",
  "key-drop",
  "gamdom",
  "rollbit",
  "duelbits",
  "bc.game",
  "hypedrop",
  "betmgm",
  "caesars",
  "ignitioncasino",
  "sportsbook",
  "onlinecasino",
  "casino",
  "gambling",
  "poker",
  "roulette",
  "slotmachine",
  "sportsbetting",
];

// Blocked domain signatures (IP loggers, phishing, scam gift generators, malware)
const MALWARE_PATTERNS = [
  "grabify",
  "iplogger",
  "2no.co",
  "yip.su",
  "free-robux",
  "freerobux",
  "free-nitro",
  "discord-nitro.gift",
  "discordgift",
  "steamcommuniity",
  "steamcomminuty",
  "steampromotion",
  "gift-discord",
  "trojan-download",
  "ransomware-drop",
  "phishing-site",
  "infostealer",
];

// OpenAI Moderation severe harm categories (excludes casual swear words like f*ck, sh*t, damn, etc.)
const OPENAI_SEVERE_HARM_RULES: {
  category: string;
  reason: string;
  patterns: RegExp[];
}[] = [
  {
    category: "self-harm",
    reason: "OpenAI Moderation: Self-harm or suicide encouragement is strictly prohibited.",
    patterns: [
      /\b(kys|kill\s+your\s*self|commit\s+suicide|slit\s+your\s+wrists|hang\s+your\s*self|end\s+your\s+life)\b/i,
    ],
  },
  {
    category: "hate",
    reason: "OpenAI Moderation: Hate speech and discriminatory slurs are not permitted.",
    patterns: [
      /\b(n+i+g+g+(a|e+r)|f+a+g+g+o+t|k+i+k+e|c+h+i+n+k|t+r+a+n+n+y|w+e+t+b+a+c+k|g+o+o+k|s+p+i+c+s?)\b/i,
    ],
  },
  {
    category: "violence/threatening",
    reason: "OpenAI Moderation: Credible violent threats, doxxing, or swatting are not permitted.",
    patterns: [
      /\b(i\s+will\s+(kill|murder|shoot|stab|swat|doxx?)\s+you|shoot\s+up\s+the\s+school|bomb\s+threat|doxxing\s+you)\b/i,
    ],
  },
  {
    category: "sexual/minors",
    reason: "OpenAI Moderation: Severe sexual exploitation content is strictly prohibited.",
    patterns: [/\b(child\s+porn|csam|loli\s+hentai|cp\s+links?)\b/i],
  },
];

export interface FilterResult {
  blocked: boolean;
  category?: string;
  reason?: string;
  provider?: string;
}

/**
 * Checks a URL or search query against the safety filter.
 */
export function checkContent(input: string): FilterResult {
  if (!input || !input.trim()) return { blocked: false };
  const clean = input.toLowerCase().trim();

  // 1. Check Malware / Phishing
  for (const pattern of MALWARE_PATTERNS) {
    if (clean.includes(pattern)) {
      return {
        blocked: true,
        category: "malware",
        reason: "Malware, IP-logger, or phishing links are not permitted.",
      };
    }
  }

  // 2. Check Adult / Pornography
  for (const pattern of ADULT_PATTERNS) {
    const regex = new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i");
    if (regex.test(clean) || clean.includes(`${pattern}.`)) {
      return {
        blocked: true,
        category: "adult",
        reason: "Adult or explicit content is not permitted.",
      };
    }
  }

  // 3. Check Gambling / Betting
  for (const pattern of GAMBLING_PATTERNS) {
    const regex = new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i");
    if (regex.test(clean) || clean.includes(`${pattern}.`)) {
      return {
        blocked: true,
        category: "gambling",
        reason: "Online gambling, betting, or casino content is not permitted.",
      };
    }
  }

  return { blocked: false };
}

/**
 * Moderates chat messages using OpenAI Moderation (omni-moderation-latest) + local classifier.
 * Explicitly allows casual swear words (fuck, shit, bitch, ass, damn, hell, etc.) while
 * blocking hate speech, self-harm, violent threats, sexual content, gambling, and malware.
 */
const clientRecentMessages: Array<{ norm: string; at: number }> = [];
const clientRecentSendTimes: number[] = [];

export function checkSpamAutomod(rawText: string): FilterResult {
  const text = (rawText || "").trim();
  if (!text) return { blocked: false };

  const now = Date.now();
  while (clientRecentSendTimes.length > 0 && now - clientRecentSendTimes[0] >= 7500) {
    clientRecentSendTimes.shift();
  }
  if (clientRecentSendTimes.length >= 4) {
    return {
      blocked: true,
      category: "spam-flood",
      reason: "AutoMod: Slow down! You are sending messages too quickly.",
    };
  }

  if (/(.)\1{11,}/u.test(text)) {
    return {
      blocked: true,
      category: "spam-chars",
      reason: "AutoMod: Please don't flood chat with repeated characters.",
    };
  }
  if (/\b(\S+)(?:\s+\1){5,}/i.test(text)) {
    return {
      blocked: true,
      category: "spam-words",
      reason: "AutoMod: Please don't spam repeated words.",
    };
  }
  if ((text.match(/\n/g) || []).length >= 8) {
    return {
      blocked: true,
      category: "spam-newlines",
      reason: "AutoMod: Too many line breaks in one message.",
    };
  }
  for (const tok of text.split(/\s+/)) {
    if (tok.length >= 55 && !/^https?:\/\//i.test(tok)) {
      return {
        blocked: true,
        category: "spam-wall",
        reason: "AutoMod: Please don't send wall-of-text character floods.",
      };
    }
  }
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 26) {
    const uppers = letters.replace(/[^A-Z]/g, "").length;
    if (uppers / letters.length >= 0.85) {
      return {
        blocked: true,
        category: "spam-caps",
        reason: "AutoMod: Please turn off CAPS LOCK (excessive all-caps spam).",
      };
    }
  }
  if (
    /\bdiscord(?:\.gg|app\.com\/invite)\/[a-z0-9-]+/i.test(text) ||
    /\b[a-z0-9-]{2,}\.(?:xyz|gg|site|online|click|top|buzz|club|fun|icu|tk|ml|ga|cf)(?:\/[^\s]*)?\b/i.test(text)
  ) {
    return {
      blocked: true,
      category: "spam-link",
      reason: "AutoMod: External invite or promotional spam links are not allowed.",
    };
  }

  const norm = text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  while (clientRecentMessages.length > 0 && now - clientRecentMessages[0].at >= 40000) {
    clientRecentMessages.shift();
  }
  if (
    norm.length >= 2 &&
    clientRecentMessages.some(
      (m) =>
        m.norm === norm ||
        (norm.length >= 6 &&
          m.norm.length >= 6 &&
          (m.norm.includes(norm) || norm.includes(m.norm)) &&
          Math.abs(m.norm.length - norm.length) <= 3)
    )
  ) {
    return {
      blocked: true,
      category: "spam-duplicate",
      reason: "AutoMod: Please don't spam duplicate messages.",
    };
  }

  clientRecentSendTimes.push(now);
  if (norm) clientRecentMessages.push({ norm, at: now });
  return { blocked: false };
}

export async function moderateChatMessage(text: string): Promise<FilterResult> {
  if (!text || !text.trim()) return { blocked: false };

  // 0. Fast local Spam AutoMod check (applies in public channels, private DMs, group chats, & Game Space)
  const spamCheck = checkSpamAutomod(text);
  if (spamCheck.blocked) {
    return { ...spamCheck, provider: "automod-spam" };
  }

  // 1. Fast local check for Adult / Gambling / Malware links
  const baseCheck = checkContent(text);
  if (baseCheck.blocked) {
    return { ...baseCheck, provider: "openai-local-guard" };
  }

  // 2. Fast local check for OpenAI severe harm categories (excluding swear words)
  for (const rule of OPENAI_SEVERE_HARM_RULES) {
    for (const rx of rule.patterns) {
      if (rx.test(text)) {
        return {
          blocked: true,
          category: rule.category,
          reason: rule.reason,
          provider: "openai-moderation-policy",
        };
      }
    }
  }

  // 3. Try server-side /api/chat/moderate endpoint (uses server's OPENAI_MODERATION_API_KEY)
  try {
    const res = await fetch("/api/chat/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.blocked === "boolean") {
        return data as FilterResult;
      }
      if (typeof data?.flagged === "boolean") {
        return { blocked: data.flagged, category: data.category, reason: data.reason };
      }
    }
  } catch {}

  // 4. Fallback client-side OpenAI Moderation API call if OPENAI_MODERATION_API_KEY is set in code
  const key = OPENAI_MODERATION_API_KEY.trim();
  if (key.startsWith("sk-")) {
    try {
      const res = await fetch("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: text,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const result = data?.results?.[0];
        if (result) {
          const cats = result.categories || {};
          const scores = result.category_scores || {};
          // Exclude general 'harassment' unless score > 0.88 so casual swear words aren't flagged
          const strictCategories = [
            "sexual",
            "sexual/minors",
            "hate",
            "hate/threatening",
            "harassment/threatening",
            "self-harm",
            "self-harm/intent",
            "self-harm/instructions",
            "violence",
            "violence/graphic",
            "illicit/violent",
          ];
          for (const cat of strictCategories) {
            if (cats[cat] || (typeof scores[cat] === "number" && scores[cat] > 0.65)) {
              return {
                blocked: true,
                category: cat,
                reason: `Flagged by OpenAI Moderation (${cat}). Swearing is allowed, but harmful content is blocked.`,
                provider: "openai-omni-moderation",
              };
            }
          }
          if (typeof scores["harassment"] === "number" && scores["harassment"] > 0.88) {
            return {
              blocked: true,
              category: "harassment",
              reason: "Flagged by OpenAI Moderation for severe targeted harassment.",
              provider: "openai-omni-moderation",
            };
          }
        }
      }
    } catch {}
  }

  return { blocked: false, provider: "openai-moderation" };
}
