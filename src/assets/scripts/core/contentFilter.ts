/**
 * Operation Cookie - Content Filter
 * Blocks adult/NSFW content, online gambling, and malware/phishing.
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
  "hentai",
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

export interface FilterResult {
  blocked: boolean;
  category?: "adult" | "gambling" | "malware";
  reason?: string;
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
    // Word boundary check or substring for domains
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
