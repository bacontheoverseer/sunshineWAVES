import { useState, useEffect, useCallback } from "preact/hooks";

export type StaffNoteCategory = "general" | "warning" | "watch" | "positive";

export interface StaffActionLogRecord {
  id: string;
  timestamp: number;
  action: string;
  actor: string;
  actorRole?: string;
  targetUsername?: string;
  channel?: string;
  details?: string;
}

export interface StaffNoteRecord {
  id: string;
  targetUsername: string;
  author: string;
  authorRole?: string;
  note: string;
  category: StaffNoteCategory | string;
  createdAt: number;
}

export const STAFF_NOTE_CATEGORIES: {
  id: StaffNoteCategory;
  label: string;
  icon: string;
}[] = [
  { id: "general", label: "note", icon: "fa-note-sticky" },
  { id: "warning", label: "warning", icon: "fa-triangle-exclamation" },
  { id: "watch", label: "watch", icon: "fa-eye" },
  { id: "positive", label: "good", icon: "fa-circle-check" },
];

export function buildModAuthHeaders(adminKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let resolvedAdminKey = adminKey || "";
  if (!resolvedAdminKey) {
    try {
      resolvedAdminKey = sessionStorage.getItem("sunshine_admin_key") || "";
    } catch {}
  }
  if (resolvedAdminKey) {
    headers["x-admin-key"] = resolvedAdminKey;
  }
  try {
    const token = localStorage.getItem("auth_token");
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {}
  return headers;
}

const ACTION_META_MAP: Record<
  string,
  { label: string; tone: "danger" | "warn" | "success" | "info" }
> = {
  timeout: { label: "timed out", tone: "danger" },
  unmute: { label: "unmuted", tone: "success" },
  delete_message: { label: "deleted msg", tone: "warn" },
  purge_messages: { label: "purged msgs", tone: "danger" },
  award_goat: { label: "awarded GOAT", tone: "success" },
  remove_goat: { label: "removed GOAT", tone: "warn" },
  promote_mod: { label: "made mod", tone: "info" },
  remove_mod: { label: "removed mod", tone: "warn" },
  note_added: { label: "added note", tone: "info" },
  note_deleted: { label: "removed note", tone: "warn" },
  ban_device: { label: "device banned", tone: "danger" },
  unban_device: { label: "unbanned device", tone: "success" },
};

export function formatStaffLogActionMeta(action: string): {
  label: string;
  tone: "danger" | "warn" | "success" | "info";
} {
  if (ACTION_META_MAP[action]) return ACTION_META_MAP[action];
  if (action.startsWith("admin_")) {
    return { label: action.replace(/^admin_/, "admin: "), tone: "info" };
  }
  return { label: action.replace(/_/g, " "), tone: "info" };
}

export function formatStaffTimestamp(ts: number): string {
  const num = Number(ts) || 0;
  if (!num) return "";
  try {
    return new Date(num).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

interface TimeoutRecord {
  username: string;
  until: number;
  reason?: string;
  by?: string;
}

interface StaffManagerContentProps {
  adminKey?: string | undefined;
  onChanged?: (() => void) | undefined;
  notify?: ((type: "success" | "error" | "info", msg: string) => void) | undefined;
}

export function StaffManagerContent({
  adminKey,
  onChanged,
  notify,
}: StaffManagerContentProps) {
  const [activeSubTab, setActiveSubTab] = useState<"roster" | "logs" | "notes">("roster");
  const [owners, setOwners] = useState<string[]>([]);
  const [staffMods, setStaffMods] = useState<string[]>([]);
  const [goatUsers, setGoatUsers] = useState<string[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<string[]>([]);
  const [timeouts, setTimeouts] = useState<TimeoutRecord[]>([]);
  const [recentLogs, setRecentLogs] = useState<StaffActionLogRecord[]>([]);
  const [recentNotes, setRecentNotes] = useState<StaffNoteRecord[]>([]);
  const [logUserFilter, setLogUserFilter] = useState("");
  const [noteUserFilter, setNoteUserFilter] = useState("");
  const [noteTargetInput, setNoteTargetInput] = useState("");
  const [noteCategory, setNoteCategory] = useState<StaffNoteCategory>("general");
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [actorRole, setActorRole] = useState<string>("member");
  const [search, setSearch] = useState("");
  const [manualUser, setManualUser] = useState("");
  const [manualGoatUser, setManualGoatUser] = useState("");
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const buildHeaders = useCallback(() => buildModAuthHeaders(adminKey), [adminKey]);

  const loadStaff = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/staff", { headers: buildHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        const dedupeList = (arr: unknown): string[] => {
          if (!Array.isArray(arr)) return [];
          const seen = new Set<string>();
          const out: string[] = [];
          for (const item of arr) {
            const s = String(item || "").trim();
            const k = s.toLowerCase();
            if (!s || seen.has(k)) continue;
            seen.add(k);
            out.push(s);
          }
          return out;
        };
        const cleanOwners = dedupeList(data.owners);
        const ownerKeys = new Set(cleanOwners.map((o) => o.toLowerCase()));
        setOwners(cleanOwners);
        setStaffMods(
          dedupeList(data.staffMods).filter((m) => !ownerKeys.has(m.toLowerCase()))
        );
        setGoatUsers(dedupeList(data.goatUsers));
        setRegisteredUsers(dedupeList(data.registeredUsers));
        setTimeouts(Array.isArray(data.timeouts) ? data.timeouts : []);
        setActorRole(data.actorRole || "member");
        if (Array.isArray(data.recentLogs)) {
          setRecentLogs(data.recentLogs);
        }
        if (Array.isArray(data.recentNotes)) {
          setRecentNotes(data.recentNotes);
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [buildHeaders]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const isOwner = actorRole === "owner";
  const isMod = isOwner || actorRole === "mod";

  const handleStaffAction = async (username: string, action: "add" | "remove") => {
    const clean = username.trim().replace(/^@/, "");
    if (!clean || busyUser) return;
    setBusyUser(clean.toLowerCase());
    try {
      const res = await fetch("/api/chat/staff", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ username: clean, action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notify?.("error", data?.error || "could not update moderator");
        return;
      }
      setStaffMods(Array.isArray(data.staffMods) ? data.staffMods : []);
      setManualUser("");
      notify?.(
        "success",
        action === "add"
          ? `promoted @${data.targetUsername || clean} to staff moderator`
          : `removed @${data.targetUsername || clean} from staff`
      );
      await loadStaff();
      onChanged?.();
    } catch {
      notify?.("error", "request failed");
    } finally {
      setBusyUser(null);
    }
  };

  const handleTimeoutAction = async (
    username: string,
    durationMinutes: number,
    reason = ""
  ) => {
    const clean = username.trim().replace(/^@/, "");
    if (!clean || busyUser) return;
    setBusyUser(clean.toLowerCase());
    try {
      const res = await fetch("/api/chat/mod/timeout", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ username: clean, durationMinutes, reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notify?.("error", data?.error || "failed to update chat timeout");
        return;
      }
      await loadStaff();
      notify?.(
        "success",
        durationMinutes === 0
          ? `unmuted @${clean}`
          : durationMinutes < 0
          ? `muted @${clean} indefinitely`
          : `timed out @${clean} for ${durationMinutes}m`
      );
      onChanged?.();
    } catch {
      notify?.("error", "request failed");
    } finally {
      setBusyUser(null);
    }
  };

  const handleGoatAction = async (username: string, granted: boolean) => {
    const clean = username.trim().replace(/^@/, "");
    if (!clean || busyUser) return;
    setBusyUser(clean.toLowerCase());
    try {
      const res = await fetch("/api/chat/mod/goat", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({ username: clean, granted }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notify?.("error", data?.error || "could not update GOAT title");
        return;
      }
      setGoatUsers(Array.isArray(data.goatUsers) ? data.goatUsers : []);
      setManualGoatUser("");
      notify?.(
        "success",
        granted
          ? `awarded golden GOAT title to @${data.targetUsername || clean}`
          : `removed GOAT title from @${data.targetUsername || clean}`
      );
      await loadStaff();
      onChanged?.();
    } catch {
      notify?.("error", "request failed");
    } finally {
      setBusyUser(null);
    }
  };

  const handleAddNote = async (e: Event) => {
    e.preventDefault();
    const target = noteTargetInput.trim().replace(/^@/, "");
    const cleanNote = noteDraft.trim();
    if (!target || !cleanNote || savingNote) return;
    setSavingNote(true);
    try {
      const res = await fetch("/api/chat/mod/notes", {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify({
          username: target,
          note: cleanNote,
          category: noteCategory,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notify?.("error", data?.error || "failed to save staff note");
        return;
      }
      setNoteDraft("");
      setNoteUserFilter(data.note?.targetUsername || target);
      notify?.("success", `saved private staff note on @${data.note?.targetUsername || target}`);
      await loadStaff();
      onChanged?.();
    } catch {
      notify?.("error", "request failed");
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId: string, username: string) => {
    if (!noteId || busyUser) return;
    setBusyUser(noteId);
    try {
      const res = await fetch(
        `/api/chat/mod/notes/${encodeURIComponent(noteId)}?username=${encodeURIComponent(username)}`,
        {
          method: "DELETE",
          headers: buildHeaders(),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notify?.("error", data?.error || "could not delete staff note");
        return;
      }
      notify?.("success", `removed staff note on @${username}`);
      await loadStaff();
      onChanged?.();
    } catch {
      notify?.("error", "request failed");
    } finally {
      setBusyUser(null);
    }
  };

  const inspectUserAudit = (username: string, tab: "logs" | "notes") => {
    const clean = username.trim().replace(/^@/, "");
    if (!clean) return;
    setLogUserFilter(clean);
    setNoteUserFilter(clean);
    setNoteTargetInput(clean);
    setActiveSubTab(tab);
  };

  const modSet = new Set(staffMods.map((m) => m.toLowerCase()));
  const ownerSet = new Set(owners.map((o) => o.toLowerCase()));
  const goatSet = new Set(goatUsers.map((g) => g.toLowerCase()));
  const q = search.trim().toLowerCase();

  const candidateUsers = registeredUsers
    .filter((u) => isMod || !ownerSet.has(u.toLowerCase()))
    .filter((u) => !q || u.toLowerCase().includes(q))
    .sort((a, b) => {
      const ag = goatSet.has(a.toLowerCase()) ? 0 : 1;
      const bg = goatSet.has(b.toLowerCase()) ? 0 : 1;
      const am = modSet.has(a.toLowerCase()) ? 0 : 1;
      const bm = modSet.has(b.toLowerCase()) ? 0 : 1;
      return ag - bg || am - bm || a.localeCompare(b);
    });

  if (loading) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-sublabel)", padding: "10px 0" }}>
        loading staff roster...
      </div>
    );
  }

  const filteredLogs = recentLogs.filter((entry) => {
    const qLog = logUserFilter.trim().replace(/^@/, "").toLowerCase();
    if (!qLog) return true;
    return (
      String(entry.targetUsername || "").toLowerCase().includes(qLog) ||
      String(entry.actor || "").toLowerCase().includes(qLog) ||
      String(entry.action || "").toLowerCase().includes(qLog) ||
      String(entry.details || "").toLowerCase().includes(qLog)
    );
  });

  const filteredNotes = recentNotes.filter((n) => {
    const qNote = noteUserFilter.trim().replace(/^@/, "").toLowerCase();
    if (!qNote) return true;
    return (
      String(n.targetUsername || "").toLowerCase().includes(qNote) ||
      String(n.author || "").toLowerCase().includes(qNote) ||
      String(n.note || "").toLowerCase().includes(qNote)
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {isMod && (
        <div class="chat-staff-tabs">
          <button
            type="button"
            class={`chat-staff-tab ${activeSubTab === "roster" ? "active" : ""}`}
            onClick={() => setActiveSubTab("roster")}
          >
            <i class="fa-solid fa-users-gear" /> roster &amp; mutes
          </button>
          <button
            type="button"
            class={`chat-staff-tab ${activeSubTab === "logs" ? "active" : ""}`}
            onClick={() => {
              setActiveSubTab("logs");
              void loadStaff();
            }}
          >
            <i class="fa-solid fa-clock-rotate-left" /> action log ({recentLogs.length})
          </button>
          <button
            type="button"
            class={`chat-staff-tab ${activeSubTab === "notes" ? "active" : ""}`}
            onClick={() => {
              setActiveSubTab("notes");
              void loadStaff();
            }}
          >
            <i class="fa-solid fa-lock" /> staff notes ({recentNotes.length})
          </button>
        </div>
      )}

      {(!isMod || activeSubTab === "roster") && (
        <>
          {/* Current Owners & Staff Mods */}
      <div>
        <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
          owners ({owners.length}) & chosen staff moderators ({staffMods.length})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {owners.map((o) => (
            <span key={o} class="chat-role-badge owner" style={{ padding: "4px 9px", fontSize: "11px" }}>
              <i class="fa-solid fa-crown" /> @{o}
            </span>
          ))}
          {staffMods.map((m) => (
            <span
              key={m}
              class="chat-role-badge mod"
              style={{ padding: "4px 9px", fontSize: "11px", gap: "6px" }}
            >
              <i class="fa-solid fa-shield-halved" /> @{m}
              {isOwner && (
                <button
                  type="button"
                  title={`Remove @${m} from staff`}
                  onClick={() => void handleStaffAction(m, "remove")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#fca5a5",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "11px",
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {staffMods.length === 0 && (
            <span style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
              no staff moderators chosen yet.
            </span>
          )}
        </div>
      </div>

      {/* Golden GOAT Honorees */}
      <div>
        <div class="chat-profile-section-title" style={{ marginBottom: "5px", color: "#fde047" }}>
          golden GOAT titles ({goatUsers.length}) · great idea contributors
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {goatUsers.map((g) => (
            <span
              key={g}
              class="chat-role-badge goat"
              style={{ padding: "4px 9px", fontSize: "11px", gap: "6px" }}
            >
              <i class="fa-solid fa-trophy" /> @{g}
              {isMod && (
                <button
                  type="button"
                  title={`Remove GOAT title from @${g}`}
                  onClick={() => void handleGoatAction(g, false)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#fef08a",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: "11px",
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
          {goatUsers.length === 0 && (
            <span style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
              no GOAT titles awarded yet — reward someone with a great idea!
            </span>
          )}
        </div>
      </div>

      {/* Award GOAT / Promote Staff Mod */}
      {isMod && (
        <div>
          <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
            {isOwner ? "award GOAT title & choose staff moderators" : "award golden GOAT title"}
          </div>
          <form
            style={{ display: "flex", gap: "6px", marginBottom: "8px" }}
            onSubmit={(e) => {
              e.preventDefault();
              void handleGoatAction(manualGoatUser, true);
            }}
          >
            <input
              type="text"
              class="chat-mod-input"
              placeholder="type username to award GOAT title..."
              value={manualGoatUser}
              onInput={(e) => setManualGoatUser((e.target as HTMLInputElement).value)}
            />
            <button
              type="submit"
              class="chat-auth-login-btn"
              disabled={!manualGoatUser.trim() || Boolean(busyUser)}
              style={{
                padding: "6px 12px",
                flexShrink: 0,
                background: "linear-gradient(115deg, rgba(202, 138, 4, 0.85), rgba(234, 179, 8, 0.9))",
                color: "#18181b",
                fontWeight: 700,
              }}
            >
              award GOAT
            </button>
          </form>

          {isOwner && (
            <form
              style={{ display: "flex", gap: "6px", marginBottom: "8px" }}
              onSubmit={(e) => {
                e.preventDefault();
                void handleStaffAction(manualUser, "add");
              }}
            >
              <input
                type="text"
                class="chat-mod-input"
                placeholder="type cloudsync username to promote..."
                value={manualUser}
                onInput={(e) => setManualUser((e.target as HTMLInputElement).value)}
              />
              <button
                type="submit"
                class="chat-auth-login-btn"
                disabled={!manualUser.trim() || Boolean(busyUser)}
                style={{ padding: "6px 12px", flexShrink: 0 }}
              >
                promote mod
              </button>
            </form>
          )}

          {registeredUsers.length > 0 && (
            <>
              <input
                type="text"
                class="chat-mod-input"
                placeholder="filter registered users..."
                value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                style={{ marginBottom: "6px" }}
              />
              <div class="chat-staff-modal-list">
                {candidateUsers.slice(0, 40).map((u) => {
                  const lower = u.toLowerCase();
                  const isRowOwner = ownerSet.has(lower);
                  const isModUser = modSet.has(lower);
                  const isGoatUser = goatSet.has(lower);
                  return (
                    <div key={u} class="chat-staff-row">
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span>@{u}</span>
                        {isRowOwner && (
                          <span class="chat-role-badge owner">
                            <i class="fa-solid fa-crown" /> owner
                          </span>
                        )}
                        {isModUser && (
                          <span class="chat-role-badge mod">
                            <i class="fa-solid fa-shield-halved" /> mod
                          </span>
                        )}
                        {isGoatUser && (
                          <span class="chat-role-badge goat">
                            <i class="fa-solid fa-trophy" /> GOAT
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "5px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          class="chat-gif-more-btn"
                          title={`View @${u}'s staff notes & action log`}
                          onClick={() => inspectUserAudit(u, "notes")}
                        >
                          <i class="fa-solid fa-lock" /> notes
                        </button>
                        <button
                          type="button"
                          class="chat-gif-more-btn"
                          title={`View @${u}'s staff action log`}
                          onClick={() => inspectUserAudit(u, "logs")}
                        >
                          log
                        </button>
                        <button
                          type="button"
                          class="chat-gif-more-btn"
                          disabled={busyUser === lower}
                          style={
                            isGoatUser
                              ? { color: "#fca5a5", borderColor: "rgba(239, 68, 68, 0.35)" }
                              : { color: "#fde047", borderColor: "rgba(250, 204, 21, 0.45)" }
                          }
                          onClick={() => void handleGoatAction(u, !isGoatUser)}
                        >
                          {isGoatUser ? "remove GOAT" : "award GOAT"}
                        </button>
                        {isOwner && !isRowOwner && (
                          <button
                            type="button"
                            class="chat-gif-more-btn"
                            disabled={busyUser === lower}
                            style={
                              isModUser
                                ? { color: "#fca5a5", borderColor: "rgba(239, 68, 68, 0.35)" }
                                : undefined
                            }
                            onClick={() => void handleStaffAction(u, isModUser ? "remove" : "add")}
                          >
                            {isModUser ? "remove mod" : "make mod"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Active Timeouts */}
      <div>
        <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
          active chat timeouts ({timeouts.length})
        </div>
        {timeouts.length === 0 ? (
          <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
            no users are currently timed out.
          </div>
        ) : (
          <div class="chat-staff-modal-list">
            {timeouts.map((t) => (
              <div key={t.username} class="chat-staff-row">
                <div>
                  <div style={{ fontWeight: 600 }}>@{t.username}</div>
                  <div style={{ fontSize: "10.5px", color: "var(--color-sublabel)" }}>
                    {t.until === -1
                      ? "indefinite mute"
                      : `${Math.max(1, Math.ceil((t.until - Date.now()) / 60000))}m left`}
                    {t.reason ? ` · ${t.reason}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  class="chat-gif-more-btn"
                  onClick={() => void handleTimeoutAction(t.username, 0)}
                >
                  unmute
                </button>
              </div>
            ))}
          </div>
        )}
          </div>
        </>
      )}

      {/* Staff Action Log Tab (Admins & Staff Only) */}
      {isMod && activeSubTab === "logs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input
              type="text"
              class="chat-mod-input"
              placeholder="filter log by user, staff actor, or action..."
              value={logUserFilter}
              onInput={(e) => setLogUserFilter((e.target as HTMLInputElement).value)}
            />
            {logUserFilter && (
              <button
                type="button"
                class="chat-gif-more-btn"
                onClick={() => setLogUserFilter("")}
              >
                clear
              </button>
            )}
          </div>
          {filteredLogs.length === 0 ? (
            <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
              no matching staff actions logged yet.
            </div>
          ) : (
            <div class="chat-staff-log-list">
              {filteredLogs.map((log) => {
                const meta = formatStaffLogActionMeta(log.action);
                return (
                  <div key={log.id} class="chat-staff-log-item">
                    <div class="chat-staff-log-top">
                      <span class={`chat-action-badge ${meta.tone}`}>{meta.label}</span>
                      {log.targetUsername && (
                        <span class="chat-staff-log-target">@{log.targetUsername}</span>
                      )}
                      {log.channel && (
                        <span class="chat-staff-log-channel">#{log.channel}</span>
                      )}
                      <span class="chat-staff-log-time">{formatStaffTimestamp(log.timestamp)}</span>
                    </div>
                    <div class="chat-staff-log-meta">
                      <span>by @{log.actor}</span>
                      {log.details ? <span> · {log.details}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Staff-Only Private User Notes Tab */}
      {isMod && activeSubTab === "notes" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div class="chat-staff-private-banner">
            <i class="fa-solid fa-lock" /> only admins &amp; staff can see these notes on users
          </div>
          <form
            onSubmit={handleAddNote}
            style={{ display: "flex", flexDirection: "column", gap: "6px" }}
          >
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <input
                type="text"
                class="chat-mod-input"
                placeholder="target @username..."
                value={noteTargetInput}
                onInput={(e) => setNoteTargetInput((e.target as HTMLInputElement).value)}
                list="staff-registered-users-datalist"
                style={{ flex: "1 1 150px" }}
              />
              <datalist id="staff-registered-users-datalist">
                {registeredUsers.slice(0, 100).map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
              <div style={{ display: "flex", gap: "4px" }}>
                {STAFF_NOTE_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    class={`chat-note-cat-btn cat-${cat.id} ${noteCategory === cat.id ? "active" : ""}`}
                    onClick={() => setNoteCategory(cat.id)}
                  >
                    <i class={`fa-solid ${cat.icon}`} /> {cat.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                class="chat-mod-input"
                placeholder="write private staff-only note on this user..."
                maxLength={400}
                value={noteDraft}
                onInput={(e) => setNoteDraft((e.target as HTMLInputElement).value)}
              />
              <button
                type="submit"
                class="chat-auth-login-btn"
                disabled={savingNote || !noteTargetInput.trim() || !noteDraft.trim()}
                style={{ padding: "6px 12px", flexShrink: 0 }}
              >
                {savingNote ? "saving..." : "add note"}
              </button>
            </div>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <input
              type="text"
              class="chat-mod-input"
              placeholder="filter notes by user, author, or text..."
              value={noteUserFilter}
              onInput={(e) => setNoteUserFilter((e.target as HTMLInputElement).value)}
            />
            {noteUserFilter && (
              <button
                type="button"
                class="chat-gif-more-btn"
                onClick={() => setNoteUserFilter("")}
              >
                clear
              </button>
            )}
          </div>

          {filteredNotes.length === 0 ? (
            <div style={{ fontSize: "11px", color: "var(--color-sublabel)" }}>
              no matching staff-only notes yet.
            </div>
          ) : (
            <div class="chat-staff-log-list">
              {filteredNotes.map((n) => (
                <div key={n.id} class={`chat-staff-note-card cat-${n.category || "general"}`}>
                  <div class="chat-staff-note-head">
                    <span class={`chat-note-cat-pill cat-${n.category || "general"}`}>
                      {n.category || "general"}
                    </span>
                    <span class="chat-staff-log-target">@{n.targetUsername}</span>
                    <span class="chat-staff-log-time">
                      by @{n.author} · {formatStaffTimestamp(n.createdAt)}
                    </span>
                    <button
                      type="button"
                      class="chat-staff-note-del"
                      title="Delete staff note"
                      disabled={busyUser === n.id}
                      onClick={() => void handleDeleteNote(n.id, n.targetUsername)}
                    >
                      ×
                    </button>
                  </div>
                  <div class="chat-staff-note-body">{n.note}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function StaffManagerModal({
  onClose,
  onChanged,
  notify,
}: {
  onClose: () => void;
  onChanged?: (() => void) | undefined;
  notify?: ((type: "success" | "error" | "info", msg: string) => void) | undefined;
}) {
  return (
    <div
      class="chat-profile-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        class="chat-profile-card"
        style={{
          maxWidth: "520px",
          maxHeight: "86vh",
          overflowY: "auto",
          padding: "16px",
          gap: "12px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <i class="fa-solid fa-shield-halved" style={{ color: "#5eead4" }} />
            <span style={{ fontWeight: 700, fontSize: "14px", textTransform: "lowercase" }}>
              chat staff &amp; moderation
            </span>
          </div>
          <button
            type="button"
            class="chat-header-btn"
            onClick={onClose}
            title="Close staff manager"
          >
            <i class="fa-solid fa-xmark" />
          </button>
        </div>

        <StaffManagerContent onChanged={onChanged} notify={notify} />
      </div>
    </div>
  );
}
