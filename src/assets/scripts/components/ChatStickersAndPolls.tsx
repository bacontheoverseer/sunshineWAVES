import { useEffect, useState } from "preact/hooks";

export interface ChatStickerItem {
  id: string;
  name: string;
  tags: string;
  url: string;
  pack: string;
}

export interface ChatStickerPack {
  id: string;
  name: string;
  source: string;
  stickers: ChatStickerItem[];
}

export interface ChatPollOption {
  id: string;
  text: string;
  votes: string[];
}

export interface ChatPollData {
  question: string;
  options: ChatPollOption[];
  createdAt?: number;
}

let cachedPacks: ChatStickerPack[] | null = null;

export function ChatStickerPicker({
  pickerRef,
  onSelect,
  onClose,
}: {
  pickerRef: any;
  onSelect: (sticker: ChatStickerItem) => void;
  onClose: () => void;
}) {
  const [packs, setPacks] = useState<ChatStickerPack[]>(() => cachedPacks || []);
  const [loading, setLoading] = useState(!cachedPacks);
  const [query, setQuery] = useState("");
  const [activePackId, setActivePackId] = useState<string>("all");

  useEffect(() => {
    if (cachedPacks && cachedPacks.length > 0) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/chat/stickers")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const list = Array.isArray(data?.packs) ? (data.packs as ChatStickerPack[]) : [];
        if (list.length > 0) cachedPacks = list;
        setPacks(list);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const visibleStickers: ChatStickerItem[] = [];
  for (const p of packs) {
    if (activePackId !== "all" && p.id !== activePackId) continue;
    for (const s of p.stickers) {
      if (
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.tags.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q)
      ) {
        visibleStickers.push(s);
      }
    }
  }

  return (
    <div class="chat-sticker-picker" ref={pickerRef}>
      <div class="chat-sticker-top">
        <input
          type="text"
          class="chat-sticker-search"
          placeholder="search stickers..."
          value={query}
          autoFocus
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="chat-sticker-close"
          onClick={onClose}
          title="Close stickers"
        >
          <i class="fa-solid fa-xmark" />
        </button>
      </div>

      {packs.length > 0 && (
        <div class="chat-sticker-tabs">
          <button
            type="button"
            class={`chat-sticker-tab${activePackId === "all" ? " active" : ""}`}
            onClick={() => setActivePackId("all")}
          >
            all
          </button>
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              class={`chat-sticker-tab${activePackId === p.id ? " active" : ""}`}
              onClick={() => setActivePackId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div class="chat-sticker-grid">
        {loading ? (
          <div class="chat-sticker-empty">
            <i class="fa-solid fa-spinner fa-spin" /> loading stickers...
          </div>
        ) : visibleStickers.length === 0 ? (
          <div class="chat-sticker-empty">no stickers found</div>
        ) : (
          visibleStickers.slice(0, 96).map((s) => (
            <button
              key={s.id}
              type="button"
              class="chat-sticker-cell"
              title={s.name}
              onClick={() => {
                onSelect(s);
                onClose();
              }}
            >
              <img src={s.url} alt={s.name} loading="lazy" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function ChatPollCreator({
  popoverRef,
  disabled,
  onCreatePoll,
  onClose,
}: {
  popoverRef: any;
  disabled?: boolean;
  onCreatePoll: (poll: ChatPollData) => Promise<void>;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [submitting, setSubmitting] = useState(false);

  const validOptions = options.map((o) => o.trim()).filter(Boolean);
  const canSubmit = question.trim().length >= 2 && validOptions.length >= 2 && !disabled && !submitting;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onCreatePoll({
        question: question.trim().slice(0, 140),
        options: validOptions.slice(0, 5).map((text, i) => ({
          id: `opt_${i}`,
          text: text.slice(0, 70),
          votes: [],
        })),
        createdAt: Date.now(),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form class="chat-poll-creator" ref={popoverRef} onSubmit={handleSubmit}>
      <div class="chat-poll-creator-head">
        <span>new poll</span>
        <button type="button" class="chat-sticker-close" onClick={onClose} title="Close">
          <i class="fa-solid fa-xmark" />
        </button>
      </div>

      <input
        type="text"
        class="chat-poll-input"
        placeholder="ask a question..."
        maxLength={140}
        value={question}
        autoFocus
        onInput={(e) => setQuestion((e.target as HTMLInputElement).value)}
      />

      <div class="chat-poll-opt-list">
        {options.map((opt, idx) => (
          <div key={idx} class="chat-poll-opt-row">
            <input
              type="text"
              class="chat-poll-input"
              placeholder={`option ${idx + 1}`}
              maxLength={70}
              value={opt}
              onInput={(e) => {
                const next = [...options];
                next[idx] = (e.target as HTMLInputElement).value;
                setOptions(next);
              }}
            />
            {options.length > 2 && (
              <button
                type="button"
                class="chat-sticker-close"
                title="Remove option"
                onClick={() => setOptions(options.filter((_, i) => i !== idx))}
              >
                <i class="fa-solid fa-minus" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div class="chat-poll-creator-foot">
        {options.length < 5 ? (
          <button
            type="button"
            class="chat-poll-add-opt"
            onClick={() => setOptions([...options, ""])}
          >
            <i class="fa-solid fa-plus" /> add option
          </button>
        ) : (
          <span />
        )}
        <button type="submit" class="chat-poll-submit" disabled={!canSubmit}>
          {submitting ? "posting..." : "post poll"}
        </button>
      </div>
    </form>
  );
}

export function ChatPollCard({
  poll,
  currentUserLower,
  disabled,
  onVote,
  onOpenUserProfile,
}: {
  poll: ChatPollData;
  currentUserLower: string;
  disabled?: boolean;
  onVote: (optionId: string) => void;
  onOpenUserProfile?: (username: string) => void;
}) {
  const [showVoters, setShowVoters] = useState(false);
  const totalVotes = poll.options.reduce(
    (sum, o) => sum + (Array.isArray(o.votes) ? o.votes.length : 0),
    0
  );

  return (
    <div class="chat-poll-card">
      <div class="chat-poll-question">
        <i class="fa-solid fa-square-poll-horizontal" />
        <span>{poll.question}</span>
      </div>
      <div class="chat-poll-options">
        {poll.options.map((opt) => {
          const votes = Array.isArray(opt.votes) ? opt.votes : [];
          const count = votes.length;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const voted = Boolean(currentUserLower && votes.includes(currentUserLower));
          return (
            <button
              key={opt.id}
              type="button"
              class={`chat-poll-opt-btn${voted ? " is-voted" : ""}`}
              disabled={disabled}
              onClick={() => onVote(opt.id)}
            >
              <span class="chat-poll-opt-fill" style={{ width: `${pct}%` }} />
              <span class="chat-poll-opt-label">
                {voted && <i class="fa-solid fa-check" />}
                <span>{opt.text}</span>
              </span>
              <span class="chat-poll-opt-stats">
                {count} · {pct}%
              </span>
            </button>
          );
        })}
      </div>
      <div class="chat-poll-footer">
        <button
          type="button"
          class="chat-poll-votes-trigger"
          title="View who voted and what they picked"
          onClick={(e) => {
            e.stopPropagation();
            setShowVoters(true);
          }}
        >
          {totalVotes} {totalVotes === 1 ? "vote" : "votes"}
        </button>
        <span> · click an option to vote</span>
      </div>

      {showVoters && (
        <div
          class="chat-poll-voters-backdrop"
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) setShowVoters(false);
          }}
        >
          <div class="chat-poll-voters-modal" onClick={(e) => e.stopPropagation()}>
            <div class="chat-poll-voters-head">
              <div class="chat-poll-voters-title-wrap">
                <div class="chat-poll-voters-title">
                  <i class="fa-solid fa-square-poll-horizontal" /> {poll.question}
                </div>
                <div class="chat-poll-voters-sub">
                  {totalVotes} total {totalVotes === 1 ? "vote" : "votes"}
                </div>
              </div>
              <button
                type="button"
                class="chat-poll-voters-close"
                aria-label="Close poll votes"
                onClick={() => setShowVoters(false)}
              >
                <i class="fa-solid fa-xmark" />
              </button>
            </div>

            <div class="chat-poll-voters-body">
              {poll.options.map((opt) => {
                const votes = Array.isArray(opt.votes) ? opt.votes : [];
                const pct = totalVotes > 0 ? Math.round((votes.length / totalVotes) * 100) : 0;
                return (
                  <div key={opt.id} class="chat-poll-voters-group">
                    <div class="chat-poll-voters-opt-head">
                      <span class="chat-poll-voters-opt-name">{opt.text}</span>
                      <span class="chat-poll-voters-opt-meta">
                        {votes.length} ({pct}%)
                      </span>
                    </div>
                    {votes.length === 0 ? (
                      <div class="chat-poll-voters-empty">no votes yet</div>
                    ) : (
                      <div class="chat-poll-voters-chips">
                        {votes.map((voter) => (
                          <button
                            key={voter}
                            type="button"
                            class="chat-poll-voter-chip"
                            onClick={() => {
                              if (onOpenUserProfile) {
                                setShowVoters(false);
                                onOpenUserProfile(voter);
                              }
                            }}
                          >
                            @{voter}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
