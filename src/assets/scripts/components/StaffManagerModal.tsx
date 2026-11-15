import { useState, useEffect, useCallback } from "preact/hooks";

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
  const [owners, setOwners] = useState<string[]>([]);
  const [staffMods, setStaffMods] = useState<string[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<string[]>([]);
  const [timeouts, setTimeouts] = useState<TimeoutRecord[]>([]);
  const [actorRole, setActorRole] = useState<string>("member");
  const [search, setSearch] = useState("");
  const [manualUser, setManualUser] = useState("");
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const buildHeaders = useCallback(() => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (adminKey) {
      headers["x-admin-key"] = adminKey;
    }
    try {
      const token = localStorage.getItem("auth_token");
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {}
    return headers;
  }, [adminKey]);

  const loadStaff = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/staff", { headers: buildHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setOwners(Array.isArray(data.owners) ? data.owners : []);
        setStaffMods(Array.isArray(data.staffMods) ? data.staffMods : []);
        setRegisteredUsers(
          Array.isArray(data.registeredUsers) ? data.registeredUsers : []
        );
        setTimeouts(Array.isArray(data.timeouts) ? data.timeouts : []);
        setActorRole(data.actorRole || "member");
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [buildHeaders]);

  useEffect(() => {
    void loadStaff();
  }, [loadStaff]);

  const isOwner = actorRole === "owner";

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

  const modSet = new Set(staffMods.map((m) => m.toLowerCase()));
  const ownerSet = new Set(owners.map((o) => o.toLowerCase()));
  const q = search.trim().toLowerCase();

  const candidateUsers = registeredUsers
    .filter((u) => !ownerSet.has(u.toLowerCase()))
    .filter((u) => !q || u.toLowerCase().includes(q))
    .sort((a, b) => {
      const am = modSet.has(a.toLowerCase()) ? 0 : 1;
      const bm = modSet.has(b.toLowerCase()) ? 0 : 1;
      return am - bm || a.localeCompare(b);
    });

  if (loading) {
    return (
      <div style={{ fontSize: "12px", color: "var(--color-sublabel)", padding: "10px 0" }}>
        loading staff roster...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
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

      {/* Promote / Choose Staff Mod */}
      {isOwner && (
        <div>
          <div class="chat-profile-section-title" style={{ marginBottom: "5px" }}>
            choose staff moderators
          </div>
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
                  const isMod = modSet.has(u.toLowerCase());
                  return (
                    <div key={u} class="chat-staff-row">
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>@{u}</span>
                        {isMod && (
                          <span class="chat-role-badge mod">
                            <i class="fa-solid fa-shield-halved" /> mod
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        class="chat-gif-more-btn"
                        disabled={busyUser === u.toLowerCase()}
                        style={
                          isMod
                            ? { color: "#fca5a5", borderColor: "rgba(239, 68, 68, 0.35)" }
                            : undefined
                        }
                        onClick={() => void handleStaffAction(u, isMod ? "remove" : "add")}
                      >
                        {isMod ? "remove mod" : "make mod"}
                      </button>
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
        style={{ maxWidth: "460px", padding: "16px", gap: "12px" }}
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
