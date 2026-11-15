import { useMemo, useState } from "preact/hooks";

export interface ChatGroupDef {
  id: string;
  name: string;
  creator: string;
  members: string[];
  createdAt: number;
}

interface GroupChatModalProps {
  mode: "create" | "members";
  currentUser: string;
  knownUsernames: string[];
  existingGroup?: ChatGroupDef | null | undefined;
  isSiteOwner?: boolean | undefined;
  onGroupSaved: (group: ChatGroupDef) => void;
  onGroupRemoved: (groupId: string) => void;
  onClose: () => void;
  notify: (msg: string, type?: "success" | "error" | "info") => void;
}

/** Modal for creating a group chat or managing its members & name. */
export default function GroupChatModal({
  mode,
  currentUser,
  knownUsernames,
  existingGroup,
  isSiteOwner,
  onGroupSaved,
  onGroupRemoved,
  onClose,
  notify,
}: GroupChatModalProps) {
  const [groupName, setGroupName] = useState(
    mode === "members" && existingGroup ? existingGroup.name : ""
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState("");
  const [busy, setBusy] = useState(false);

  const selfLower = currentUser.trim().toLowerCase();

  const availableCandidates = useMemo(() => {
    const taken = new Set<string>([selfLower]);
    if (mode === "members" && existingGroup) {
      for (const m of existingGroup.members) taken.add(m.toLowerCase());
    } else {
      for (const s of selected) taken.add(s.toLowerCase());
    }
    const q = memberInput.trim().replace(/^@/, "").toLowerCase();
    return Array.from(new Set(knownUsernames.map((u) => u.trim()).filter(Boolean)))
      .filter((u) => !taken.has(u.toLowerCase()))
      .filter((u) => !q || u.toLowerCase().includes(q))
      .slice(0, 18);
  }, [knownUsernames, selfLower, mode, existingGroup, selected, memberInput]);

  const getToken = () => {
    try {
      return localStorage.getItem("auth_token") || "";
    } catch {
      return "";
    }
  };

  const handleCreate = async (e: Event) => {
    e.preventDefault();
    const cleanName = groupName.trim();
    if (!cleanName) {
      notify("enter a group name", "error");
      return;
    }
    const members = [...selected];
    const typed = memberInput.trim().replace(/^@/, "");
    if (typed && !members.some((m) => m.toLowerCase() === typed.toLowerCase())) {
      members.push(typed);
    }
    if (members.length === 0) {
      notify("pick or type at least 1 friend to add", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/chat/groups/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({ name: cleanName, members }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.group) {
        notify(data?.error || "could not create group chat", "error");
        return;
      }
      onGroupSaved(data.group);
      notify(`created group "${data.group.name}"`, "success");
    } catch {
      notify("network error creating group chat", "error");
    } finally {
      setBusy(false);
    }
  };

  const handleMemberAction = async (
    action: "add" | "remove" | "leave" | "rename",
    username?: string
  ) => {
    if (!existingGroup) return;
    setBusy(true);
    try {
      const res = await fetch("/api/chat/groups/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({
          groupId: existingGroup.id,
          action,
          ...(username ? { username } : {}),
          ...(action === "rename" ? { name: groupName.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        notify(data?.error || "could not update group", "error");
        return;
      }
      if (action === "leave" || data.deleted) {
        onGroupRemoved(existingGroup.id);
        notify(`left "${existingGroup.name}"`, "info");
        return;
      }
      if (data.group) {
        onGroupSaved(data.group);
        if (action === "add") setMemberInput("");
        notify("group updated", "success");
      }
    } catch {
      notify("failed to update group", "error");
    } finally {
      setBusy(false);
    }
  };

  const canKick =
    mode === "members" &&
    existingGroup &&
    (existingGroup.creator.toLowerCase() === selfLower || Boolean(isSiteOwner));

  return (
    <div
      class="chat-profile-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="chat-group-modal" onClick={(e) => e.stopPropagation()}>
        <div class="chat-crop-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <i class="fa-solid fa-user-group" style={{ color: "#93c5fd" }} />
            <span>
              {mode === "create"
                ? "create group chat"
                : `${existingGroup?.name || "group"} (${existingGroup?.members.length || 0} members)`}
            </span>
          </div>
          <button
            type="button"
            class="chat-header-btn"
            onClick={onClose}
            title="Close"
          >
            <i class="fa-solid fa-xmark" />
          </button>
        </div>

        {mode === "create" ? (
          <form class="chat-group-form" onSubmit={handleCreate}>
            <label class="chat-group-label">group name</label>
            <input
              type="text"
              class="chat-mod-input"
              placeholder="e.g. squad hangout"
              maxLength={32}
              value={groupName}
              autoFocus
              onInput={(e) => setGroupName((e.target as HTMLInputElement).value)}
            />

            <label class="chat-group-label" style={{ marginTop: "6px" }}>
              add members ({selected.length + 1} total incl. you)
            </label>
            <div style={{ display: "flex", gap: "6px" }}>
              <input
                type="text"
                class="chat-mod-input"
                placeholder="search or type @username..."
                value={memberInput}
                onInput={(e) => setMemberInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && memberInput.trim()) {
                    e.preventDefault();
                    const clean = memberInput.trim().replace(/^@/, "");
                    if (
                      clean &&
                      clean.toLowerCase() !== selfLower &&
                      !selected.some((s) => s.toLowerCase() === clean.toLowerCase())
                    ) {
                      setSelected((prev) => [...prev, clean]);
                    }
                    setMemberInput("");
                  }
                }}
              />
              <button
                type="button"
                class="chat-gif-more-btn"
                onClick={() => {
                  const clean = memberInput.trim().replace(/^@/, "");
                  if (
                    clean &&
                    clean.toLowerCase() !== selfLower &&
                    !selected.some((s) => s.toLowerCase() === clean.toLowerCase())
                  ) {
                    setSelected((prev) => [...prev, clean]);
                  }
                  setMemberInput("");
                }}
              >
                + add
              </button>
            </div>

            {selected.length > 0 && (
              <div class="chat-group-chips">
                {selected.map((u) => (
                  <button
                    key={u}
                    type="button"
                    class="chat-group-chip is-selected"
                    onClick={() =>
                      setSelected((prev) =>
                        prev.filter((x) => x.toLowerCase() !== u.toLowerCase())
                      )
                    }
                    title={`Remove @${u}`}
                  >
                    @{u} <i class="fa-solid fa-xmark" />
                  </button>
                ))}
              </div>
            )}

            {availableCandidates.length > 0 && (
              <div class="chat-group-chips-scroll">
                {availableCandidates.map((u) => (
                  <button
                    key={u}
                    type="button"
                    class="chat-group-chip"
                    onClick={() => setSelected((prev) => [...prev, u])}
                  >
                    + @{u}
                  </button>
                ))}
              </div>
            )}

            <div class="chat-crop-actions" style={{ marginTop: "6px" }}>
              <button type="button" class="chat-gif-more-btn" onClick={onClose}>
                cancel
              </button>
              <button
                type="submit"
                class="chat-header-btn"
                disabled={busy}
                style={{
                  backgroundColor: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-text)",
                  fontWeight: 600,
                }}
              >
                {busy ? "creating..." : "create group chat"}
              </button>
            </div>
          </form>
        ) : (
          existingGroup && (
            <div class="chat-group-form">
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                <input
                  type="text"
                  class="chat-mod-input"
                  maxLength={32}
                  value={groupName}
                  onInput={(e) => setGroupName((e.target as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="chat-gif-more-btn"
                  disabled={busy || !groupName.trim()}
                  onClick={() => void handleMemberAction("rename")}
                >
                  rename
                </button>
              </div>

              <label class="chat-group-label" style={{ marginTop: "6px" }}>
                add member
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  type="text"
                  class="chat-mod-input"
                  placeholder="username to add..."
                  value={memberInput}
                  onInput={(e) => setMemberInput((e.target as HTMLInputElement).value)}
                />
                <button
                  type="button"
                  class="chat-gif-more-btn"
                  disabled={busy || !memberInput.trim()}
                  onClick={() =>
                    void handleMemberAction("add", memberInput.trim().replace(/^@/, ""))
                  }
                >
                  + add
                </button>
              </div>

              {availableCandidates.length > 0 && (
                <div class="chat-group-chips-scroll">
                  {availableCandidates.slice(0, 10).map((u) => (
                    <button
                      key={u}
                      type="button"
                      class="chat-group-chip"
                      disabled={busy}
                      onClick={() => void handleMemberAction("add", u)}
                    >
                      + @{u}
                    </button>
                  ))}
                </div>
              )}

              <label class="chat-group-label" style={{ marginTop: "6px" }}>
                members
              </label>
              <div class="chat-group-member-list">
                {existingGroup.members.map((m) => {
                  const isCreator =
                    m.toLowerCase() === existingGroup.creator.toLowerCase();
                  return (
                    <div key={m} class="chat-group-member-row">
                      <span>
                        @{m}{" "}
                        {isCreator && (
                          <span class="chat-role-badge mod" style={{ marginLeft: "4px" }}>
                            host
                          </span>
                        )}
                      </span>
                      {canKick && !isCreator && (
                        <button
                          type="button"
                          class="chat-gif-more-btn"
                          style={{ color: "#f87171" }}
                          disabled={busy}
                          onClick={() => void handleMemberAction("remove", m)}
                        >
                          remove
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div class="chat-crop-actions" style={{ marginTop: "6px" }}>
                <button
                  type="button"
                  class="chat-header-btn danger"
                  disabled={busy}
                  onClick={() => void handleMemberAction("leave")}
                >
                  <i class="fa-solid fa-right-from-bracket" />
                  <span>leave group</span>
                </button>
                <button type="button" class="chat-gif-more-btn" onClick={onClose}>
                  done
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
