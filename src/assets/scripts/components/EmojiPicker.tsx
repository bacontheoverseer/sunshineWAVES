import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

export interface EmojiEntry {
  emoji: string;
  name: string;
  keywords: string;
}

export interface EmojiCategory {
  id: string;
  label: string;
  icon: string;
  items: EmojiEntry[];
}

export const RECENT_EMOJIS_KEY = "cookie_chat_recent_emojis_v1";

const DEFAULT_RECENT_EMOJIS: EmojiEntry[] = [
  { emoji: "😭", name: "sob", keywords: "cry tears sad laugh" },
  { emoji: "😂", name: "joy", keywords: "laugh lol tears funny" },
  { emoji: "🔥", name: "fire", keywords: "lit hot flame" },
  { emoji: "💀", name: "skull", keywords: "dead ded laugh skeleton" },
  { emoji: "❤️", name: "heart", keywords: "love red" },
  { emoji: "👍", name: "thumbsup", keywords: "yes ok good nice" },
  { emoji: "✨", name: "sparkles", keywords: "stars shine magic" },
  { emoji: "💯", name: "100", keywords: "hundred perfect real" },
  { emoji: "🎉", name: "tada", keywords: "party celebrate congrats" },
  { emoji: "👀", name: "eyes", keywords: "look watch see" },
  { emoji: "🫡", name: "salute", keywords: "respect sir" },
  { emoji: "🫶", name: "heart_hands", keywords: "love care" },
];

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys & People",
    icon: "😀",
    items: [
      { emoji: "😀", name: "grinning", keywords: "smile happy" },
      { emoji: "😃", name: "smiley", keywords: "happy smile" },
      { emoji: "😄", name: "smile", keywords: "happy joy" },
      { emoji: "😁", name: "grin", keywords: "happy teeth" },
      { emoji: "😆", name: "laughing", keywords: "haha lol" },
      { emoji: "😅", name: "sweat_smile", keywords: "phew nervous lol" },
      { emoji: "😂", name: "joy", keywords: "laugh lol tears funny" },
      { emoji: "🤣", name: "rofl", keywords: "laugh floor lol" },
      { emoji: "🥲", name: "smiling_tear", keywords: "proud sad happy" },
      { emoji: "🥹", name: "holding_back_tears", keywords: "cute touched" },
      { emoji: "😊", name: "blush", keywords: "happy warm" },
      { emoji: "😇", name: "innocent", keywords: "angel halo" },
      { emoji: "🙂", name: "slight_smile", keywords: "ok fine" },
      { emoji: "🙃", name: "upside_down", keywords: "sarcasm silly" },
      { emoji: "😉", name: "wink", keywords: "flirt joke" },
      { emoji: "😌", name: "relieved", keywords: "calm chill" },
      { emoji: "😍", name: "heart_eyes", keywords: "love crush" },
      { emoji: "🥰", name: "smiling_face_with_hearts", keywords: "love adore" },
      { emoji: "😘", name: "kissing_heart", keywords: "kiss love" },
      { emoji: "😋", name: "yum", keywords: "tasty delicious" },
      { emoji: "😛", name: "stuck_out_tongue", keywords: "playful" },
      { emoji: "😝", name: "stuck_out_tongue_closed_eyes", keywords: "silly" },
      { emoji: "😜", name: "stuck_out_tongue_winking_eye", keywords: "crazy wink" },
      { emoji: "🤪", name: "zany_face", keywords: "wild goofy" },
      { emoji: "🤨", name: "raised_eyebrow", keywords: "sus doubt" },
      { emoji: "🧐", name: "monocle_face", keywords: "inspect hmm" },
      { emoji: "🤓", name: "nerd", keywords: "glasses smart um actually" },
      { emoji: "😎", name: "sunglasses", keywords: "cool shades" },
      { emoji: "🥸", name: "disguised_face", keywords: "incognito mustache" },
      { emoji: "🤩", name: "star_struck", keywords: "wow amazed" },
      { emoji: "🥳", name: "partying_face", keywords: "party birthday" },
      { emoji: "😏", name: "smirk", keywords: "smug sly" },
      { emoji: "😒", name: "unamused", keywords: "meh bruh" },
      { emoji: "😞", name: "disappointed", keywords: "sad" },
      { emoji: "😔", name: "pensive", keywords: "sad thoughtful" },
      { emoji: "😟", name: "worried", keywords: "nervous" },
      { emoji: "😕", name: "confused", keywords: "idk" },
      { emoji: "🙁", name: "slightly_frowning_face", keywords: "sad" },
      { emoji: "😣", name: "persevere", keywords: "struggle" },
      { emoji: "😖", name: "confounded", keywords: "ugh" },
      { emoji: "😫", name: "tired_face", keywords: "exhausted" },
      { emoji: "😩", name: "weary", keywords: "tired drama" },
      { emoji: "🥺", name: "pleading_face", keywords: "puppy eyes pls" },
      { emoji: "😢", name: "cry", keywords: "sad tear" },
      { emoji: "😭", name: "sob", keywords: "cry tears loud laugh" },
      { emoji: "😤", name: "triumph", keywords: "mad hmph" },
      { emoji: "😠", name: "angry", keywords: "mad" },
      { emoji: "😡", name: "rage", keywords: "furious mad red" },
      { emoji: "🤬", name: "cursing_face", keywords: "swear mad" },
      { emoji: "🤯", name: "exploding_head", keywords: "mindblown shocked" },
      { emoji: "😳", name: "flushed", keywords: "blush shy awkward" },
      { emoji: "🥵", name: "hot_face", keywords: "heat spicy" },
      { emoji: "🥶", name: "cold_face", keywords: "freeze ice" },
      { emoji: "😱", name: "scream", keywords: "omg shocked scared" },
      { emoji: "😨", name: "fearful", keywords: "scared" },
      { emoji: "😰", name: "cold_sweat", keywords: "anxious" },
      { emoji: "🤗", name: "hugging", keywords: "hug warm" },
      { emoji: "🤔", name: "thinking", keywords: "hmm wonder" },
      { emoji: "🫡", name: "salute", keywords: "respect yes sir" },
      { emoji: "🤭", name: "hand_over_mouth", keywords: "oops giggle" },
      { emoji: "🫣", name: "peeking", keywords: "shy look" },
      { emoji: "🤫", name: "shushing_face", keywords: "quiet shh secret" },
      { emoji: "🤥", name: "lying_face", keywords: "cap pinocchio" },
      { emoji: "😶", name: "no_mouth", keywords: "speechless" },
      { emoji: "🫥", name: "dotted_line_face", keywords: "invisible" },
      { emoji: "😐", name: "neutral_face", keywords: "deadpan stare" },
      { emoji: "😑", name: "expressionless", keywords: "done bruh" },
      { emoji: "😬", name: "grimacing", keywords: "yikes awkward" },
      { emoji: "🫠", name: "melting_face", keywords: "melt fine help" },
      { emoji: "🙄", name: "rolling_eyes", keywords: "whatever sigh" },
      { emoji: "😮", name: "open_mouth", keywords: "wow surprised" },
      { emoji: "😲", name: "astonished", keywords: "shocked omg" },
      { emoji: "🥱", name: "yawning_face", keywords: "bored sleepy" },
      { emoji: "😴", name: "sleeping", keywords: "zzz sleep tired" },
      { emoji: "🤤", name: "drooling_face", keywords: "hungry" },
      { emoji: "😵", name: "dizzy_face", keywords: "knocked out" },
      { emoji: "🤐", name: "zipper_mouth", keywords: "secret quiet" },
      { emoji: "🥴", name: "woozy_face", keywords: "drunk confused" },
      { emoji: "🤢", name: "nauseated_face", keywords: "gross sick" },
      { emoji: "🤮", name: "vomiting_face", keywords: "puke gross" },
      { emoji: "🤧", name: "sneezing_face", keywords: "sick tissue" },
      { emoji: "😷", name: "mask", keywords: "sick" },
      { emoji: "🤑", name: "money_mouth", keywords: "rich cash" },
      { emoji: "🤠", name: "cowboy", keywords: "yeehaw hat" },
      { emoji: "😈", name: "smiling_imp", keywords: "devil evil mischievous" },
      { emoji: "🤡", name: "clown", keywords: "bozo joke" },
      { emoji: "👻", name: "ghost", keywords: "boo spooky" },
      { emoji: "💀", name: "skull", keywords: "dead ded laugh skeleton" },
      { emoji: "👽", name: "alien", keywords: "ufo space" },
      { emoji: "🤖", name: "robot", keywords: "bot ai" },
      { emoji: "🗿", name: "moyai", keywords: "moai sigma bruh stone" },
    ],
  },
  {
    id: "gestures",
    label: "Hands & Body",
    icon: "👍",
    items: [
      { emoji: "👍", name: "thumbsup", keywords: "yes like good" },
      { emoji: "👎", name: "thumbsdown", keywords: "no dislike bad" },
      { emoji: "👌", name: "ok_hand", keywords: "perfect nice" },
      { emoji: "🤌", name: "pinched_fingers", keywords: "chef kiss italian" },
      { emoji: "🤏", name: "pinching_hand", keywords: "tiny small" },
      { emoji: "✌️", name: "v", keywords: "peace victory" },
      { emoji: "🤞", name: "crossed_fingers", keywords: "luck hope" },
      { emoji: "🫰", name: "finger_heart", keywords: "love snap" },
      { emoji: "🤟", name: "love_you_gesture", keywords: "rock love" },
      { emoji: "🤘", name: "metal", keywords: "rock on" },
      { emoji: "🤙", name: "call_me", keywords: "shaka chill" },
      { emoji: "👈", name: "point_left", keywords: "left" },
      { emoji: "👉", name: "point_right", keywords: "right" },
      { emoji: "👆", name: "point_up", keywords: "up this" },
      { emoji: "👇", name: "point_down", keywords: "down below" },
      { emoji: "☝️", name: "index_pointing_up", keywords: "um actually" },
      { emoji: "👋", name: "wave", keywords: "hi hello bye" },
      { emoji: "✋", name: "raised_hand", keywords: "stop highfive" },
      { emoji: "👏", name: "clap", keywords: "bravo applause" },
      { emoji: "🙌", name: "raised_hands", keywords: "yay hype" },
      { emoji: "🫶", name: "heart_hands", keywords: "love care" },
      { emoji: "🤝", name: "handshake", keywords: "deal agree" },
      { emoji: "🙏", name: "pray", keywords: "please thanks hope" },
      { emoji: "💪", name: "muscle", keywords: "strong flex gym" },
      { emoji: "👀", name: "eyes", keywords: "look watch see" },
      { emoji: "🧠", name: "brain", keywords: "smart iq big brain" },
    ],
  },
  {
    id: "hearts",
    label: "Hearts & Reactions",
    icon: "❤️",
    items: [
      { emoji: "❤️", name: "heart", keywords: "love red" },
      { emoji: "🧡", name: "orange_heart", keywords: "love orange" },
      { emoji: "💛", name: "yellow_heart", keywords: "love yellow" },
      { emoji: "💚", name: "green_heart", keywords: "love green" },
      { emoji: "💙", name: "blue_heart", keywords: "love blue" },
      { emoji: "🩵", name: "light_blue_heart", keywords: "love cyan" },
      { emoji: "💜", name: "purple_heart", keywords: "love purple" },
      { emoji: "🖤", name: "black_heart", keywords: "love dark" },
      { emoji: "🤍", name: "white_heart", keywords: "love pure" },
      { emoji: "🩷", name: "pink_heart", keywords: "love pink" },
      { emoji: "💔", name: "broken_heart", keywords: "sad heartbreak" },
      { emoji: "❤️‍🔥", name: "heart_on_fire", keywords: "passion fire love" },
      { emoji: "💖", name: "sparkling_heart", keywords: "love shine" },
      { emoji: "💗", name: "heartpulse", keywords: "love" },
      { emoji: "💘", name: "cupid", keywords: "love arrow" },
      { emoji: "✨", name: "sparkles", keywords: "shine magic stars" },
      { emoji: "🌟", name: "star2", keywords: "glow star" },
      { emoji: "⭐", name: "star", keywords: "favorite gold" },
      { emoji: "🔥", name: "fire", keywords: "lit hot flame" },
      { emoji: "💥", name: "boom", keywords: "explosion" },
      { emoji: "💯", name: "100", keywords: "hundred perfect real" },
      { emoji: "💤", name: "zzz", keywords: "sleep bored" },
      { emoji: "🎉", name: "tada", keywords: "party celebrate" },
      { emoji: "🎊", name: "confetti_ball", keywords: "party" },
      { emoji: "🏆", name: "trophy", keywords: "win champion gold" },
      { emoji: "🥇", name: "first_place", keywords: "win gold medal" },
      { emoji: "👑", name: "crown", keywords: "king queen royalty" },
      { emoji: "💎", name: "gem", keywords: "diamond rich" },
      { emoji: "✅", name: "white_check_mark", keywords: "yes check done" },
      { emoji: "❌", name: "x", keywords: "no wrong cancel" },
      { emoji: "⚠️", name: "warning", keywords: "alert caution" },
      { emoji: "❗", name: "exclamation", keywords: "important alert" },
      { emoji: "❓", name: "question", keywords: "what confused" },
    ],
  },
  {
    id: "gaming",
    label: "Games & Vibes",
    icon: "🎮",
    items: [
      { emoji: "🎮", name: "video_game", keywords: "controller gaming play" },
      { emoji: "🕹️", name: "joystick", keywords: "arcade game" },
      { emoji: "🎲", name: "game_die", keywords: "dice rng random" },
      { emoji: "♟️", name: "chess_pawn", keywords: "chess strategy" },
      { emoji: "🎯", name: "dart", keywords: "bullseye target aim" },
      { emoji: "⚡", name: "zap", keywords: "lightning fast energy" },
      { emoji: "🚀", name: "rocket", keywords: "launch fast moon" },
      { emoji: "🛸", name: "flying_saucer", keywords: "ufo space" },
      { emoji: "🎧", name: "headphones", keywords: "music audio chill" },
      { emoji: "🎵", name: "musical_note", keywords: "music song" },
      { emoji: "🎶", name: "notes", keywords: "music vibe" },
      { emoji: "💻", name: "laptop", keywords: "code pc computer" },
      { emoji: "⌨️", name: "keyboard", keywords: "type gaming" },
      { emoji: "📱", name: "iphone", keywords: "phone mobile" },
      { emoji: "☀️", name: "sunny", keywords: "sun sunshine bright" },
      { emoji: "🌊", name: "ocean", keywords: "wave water waves" },
      { emoji: "🌈", name: "rainbow", keywords: "color" },
      { emoji: "🌙", name: "crescent_moon", keywords: "night moon" },
      { emoji: "❄️", name: "snowflake", keywords: "cold snow ice" },
      { emoji: "🌸", name: "cherry_blossom", keywords: "flower pink spring" },
      { emoji: "🍀", name: "four_leaf_clover", keywords: "luck lucky" },
      { emoji: "🌹", name: "rose", keywords: "flower love" },
    ],
  },
  {
    id: "animals",
    label: "Animals & Food",
    icon: "🐱",
    items: [
      { emoji: "🐶", name: "dog", keywords: "puppy pet" },
      { emoji: "🐱", name: "cat", keywords: "kitty meow" },
      { emoji: "🦊", name: "fox", keywords: "animal" },
      { emoji: "🐻", name: "bear", keywords: "animal" },
      { emoji: "🐼", name: "panda", keywords: "bear cute" },
      { emoji: "🐸", name: "frog", keywords: "pepe ribbit" },
      { emoji: "🐵", name: "monkey_face", keywords: "monkey" },
      { emoji: "🐧", name: "penguin", keywords: "bird cold" },
      { emoji: "🦆", name: "duck", keywords: "quack bird" },
      { emoji: "🐝", name: "bee", keywords: "honey buzz" },
      { emoji: "🦋", name: "butterfly", keywords: "pretty" },
      { emoji: "🐙", name: "octopus", keywords: "sea" },
      { emoji: "🦈", name: "shark", keywords: "ocean" },
      { emoji: "🦖", name: "t_rex", keywords: "dino dinosaur" },
      { emoji: "🍕", name: "pizza", keywords: "food cheese slice" },
      { emoji: "🍔", name: "hamburger", keywords: "burger food" },
      { emoji: "🍟", name: "fries", keywords: "food" },
      { emoji: "🌮", name: "taco", keywords: "food" },
      { emoji: "🍣", name: "sushi", keywords: "food" },
      { emoji: "🍜", name: "ramen", keywords: "noodles food" },
      { emoji: "🍿", name: "popcorn", keywords: "movie drama" },
      { emoji: "🍩", name: "doughnut", keywords: "donut sweet" },
      { emoji: "🍪", name: "cookie", keywords: "sweet snack" },
      { emoji: "🎂", name: "birthday", keywords: "cake party" },
      { emoji: "☕", name: "coffee", keywords: "tea drink morning" },
      { emoji: "🧋", name: "bubble_tea", keywords: "boba drink" },
      { emoji: "🍓", name: "strawberry", keywords: "fruit berry" },
      { emoji: "🍉", name: "watermelon", keywords: "fruit summer" },
    ],
  },
];

const ALL_EMOJIS_BY_VALUE = new Map<string, EmojiEntry>();
for (const cat of EMOJI_CATEGORIES) {
  for (const item of cat.items) {
    if (!ALL_EMOJIS_BY_VALUE.has(item.emoji)) {
      ALL_EMOJIS_BY_VALUE.set(item.emoji, item);
    }
  }
}

function loadRecentEmojis(): EmojiEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_EMOJIS_KEY);
    if (!raw) return DEFAULT_RECENT_EMOJIS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_RECENT_EMOJIS;
    const mapped: EmojiEntry[] = [];
    for (const em of parsed) {
      if (typeof em !== "string" || !em.trim()) continue;
      mapped.push(
        ALL_EMOJIS_BY_VALUE.get(em) || {
          emoji: em,
          name: "recent",
          keywords: "",
        }
      );
    }
    return mapped.length > 0 ? mapped : DEFAULT_RECENT_EMOJIS;
  } catch {
    return DEFAULT_RECENT_EMOJIS;
  }
}

function saveRecentEmoji(emoji: string): EmojiEntry[] {
  try {
    const current = loadRecentEmojis().map((e) => e.emoji);
    const next = [emoji, ...current.filter((e) => e !== emoji)].slice(0, 18);
    localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(next));
  } catch {}
  return loadRecentEmojis();
}

const REG_INDICATOR_RE = /^(?:\p{Regional_Indicator}){2}$/u;
const KEYCAP_RE = /^[0-9#*]\uFE0F?\u20E3$/u;
const EXT_PICTO_RE = /\p{Extended_Pictographic}/u;
const WHITESPACE_RE = /^\s+$/;
const MAX_JUMBO_EMOJIS = 27;

/**
 * Returns the count of emojis if a chat message contains only emojis (and optional
 * whitespace) up to Discord's 27-emoji limit, or 0 for normal text/mixed messages.
 */
export function getJumboEmojiCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let segments: string[];
  try {
    const IntlAny = Intl as unknown as {
      Segmenter?: new (
        locale: string,
        opts: { granularity: string }
      ) => { segment: (input: string) => Iterable<{ segment: string }> };
    };
    if (IntlAny && typeof IntlAny.Segmenter === "function") {
      const segmenter = new IntlAny.Segmenter("en", { granularity: "grapheme" });
      segments = Array.from(segmenter.segment(trimmed), (s) => s.segment);
    } else {
      segments = Array.from(trimmed);
    }
  } catch {
    segments = Array.from(trimmed);
  }

  let emojiCount = 0;
  for (const seg of segments) {
    if (WHITESPACE_RE.test(seg)) continue;
    const isEmoji =
      EXT_PICTO_RE.test(seg) || REG_INDICATOR_RE.test(seg) || KEYCAP_RE.test(seg);
    if (!isEmoji) return 0;
    emojiCount += 1;
    if (emojiCount > MAX_JUMBO_EMOJIS) return 0;
  }

  return emojiCount;
}

interface EmojiPickerProps {
  pickerRef: { current: HTMLDivElement | null };
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

/** Discord-style searchable & categorized emoji picker popover. */
export default function EmojiPicker({
  pickerRef,
  onSelect,
  onClose,
}: EmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("recent");
  const [recentEmojis, setRecentEmojis] = useState<EmojiEntry[]>(loadRecentEmojis);
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);

  useEffect(() => {
    setRecentEmojis(loadRecentEmojis());
  }, []);

  const categories = useMemo<EmojiCategory[]>(() => {
    return [
      { id: "recent", label: "Frequently Used", icon: "🕒", items: recentEmojis },
      ...EMOJI_CATEGORIES,
    ];
  }, [recentEmojis]);

  const query = search.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!query) return [];
    const matches: EmojiEntry[] = [];
    const seen = new Set<string>();
    for (const cat of EMOJI_CATEGORIES) {
      for (const item of cat.items) {
        if (seen.has(item.emoji)) continue;
        if (
          item.name.toLowerCase().includes(query) ||
          item.keywords.toLowerCase().includes(query) ||
          item.emoji === query
        ) {
          seen.add(item.emoji);
          matches.push(item);
        }
      }
    }
    return matches;
  }, [query]);

  const handlePick = (item: EmojiEntry) => {
    setRecentEmojis(saveRecentEmoji(item.emoji));
    onSelect(item.emoji);
  };

  const visibleCategory =
    categories.find((c) => c.id === activeCat) || categories[0]!;

  return (
    <div class="chat-emoji-picker" ref={pickerRef}>
      <div class="chat-gif-picker-header">
        <input
          type="text"
          class="chat-gif-picker-search"
          placeholder="search emojis (e.g. sob, fire, skull)..."
          value={search}
          autoFocus
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="chat-gif-more-btn"
          onClick={onClose}
          title="Close emoji picker"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      {!query && (
        <div class="chat-emoji-tabs" role="tablist" aria-label="Emoji categories">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              class={`chat-emoji-tab${activeCat === cat.id ? " active" : ""}`}
              title={cat.label}
              onClick={() => setActiveCat(cat.id)}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      <div class="chat-emoji-grid-wrap">
        <div class="chat-emoji-section-label">
          {query ? `search results (${searchResults.length})` : visibleCategory.label}
        </div>
        {(query ? searchResults : visibleCategory.items).length === 0 ? (
          <div class="chat-gif-empty">
            {query ? `no emojis matching "${search.trim()}"` : "no recent emojis yet."}
          </div>
        ) : (
          <div class="chat-emoji-grid">
            {(query ? searchResults : visibleCategory.items).map((item) => (
              <button
                key={`${visibleCategory.id}-${item.emoji}-${item.name}`}
                type="button"
                class="chat-emoji-btn"
                title={`:${item.name}:`}
                onMouseEnter={() => setHovered(item)}
                onFocus={() => setHovered(item)}
                onClick={() => handlePick(item)}
              >
                {item.emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      <div class="chat-emoji-footer">
        {hovered ? (
          <>
            <span class="chat-emoji-preview-glyph">{hovered.emoji}</span>
            <span class="chat-emoji-preview-name">:{hovered.name}:</span>
          </>
        ) : (
          <span class="chat-emoji-preview-hint">
            pick an emoji · tip: emoji-only messages appear jumbo!
          </span>
        )}
      </div>
    </div>
  );
}
