/**
 * Operation Cookie - Content Filter & OpenAI Moderation
 * Blocks adult/NSFW content, online gambling, malware/phishing, and severe harm
 * (hate speech, self-harm, severe violence/threats, sexual content) while explicitly
 * excluding casual swear words / profanity in chat.
 */

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
export async function moderateChatMessage(
  text: string,
  openAiKey?: string
): Promise<FilterResult> {
  if (!text || !text.trim()) return { blocked: false };

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

  // 3. Try server-side /api/chat/moderate endpoint
  try {
    const res = await fetch("/api/chat/moderate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, apiKey: openAiKey || undefined }),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.blocked === "boolean") {
        return data as FilterResult;
      }
    }
  } catch {}

  // 4. Direct client-side OpenAI Moderation API call if user configured an API key
  const key = (openAiKey || "").trim();
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
