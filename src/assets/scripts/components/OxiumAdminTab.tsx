import { useState, useEffect, useCallback } from "preact/hooks";

interface OxiumLink {
  label: string;
  url: string;
}

interface OxiumPartnerAdmin {
  slug: string;
  name: string;
  tagline: string;
  accentColor: string;
  allowedOrigins: string[];
  links: OxiumLink[];
  ownerUsername?: string;
  contact?: string;
  status: "pending" | "approved" | "rejected";
  rejectReason?: string;
  createdAt?: number;
}

interface OxiumPromo {
  id: string;
  siteSlug: string;
  siteName?: string;
  title: string;
  message: string;
  linksUrl: string;
  active: boolean;
  createdAt: number;
}

interface OxiumAdminTabProps {
  adminKey: string;
  notify: (type: string, msg: string) => void;
}

export default function OxiumAdminTab({ adminKey, notify }: OxiumAdminTabProps) {
  const [partners, setPartners] = useState<OxiumPartnerAdmin[]>([]);
  const [promos, setPromos] = useState<OxiumPromo[]>([]);
  const [loading, setLoading] = useState(true);
  const [promoSiteSlug, setPromoSiteSlug] = useState("");
  const [promoTitle, setPromoTitle] = useState("Like Operation Cookie?");
  const [promoMessage, setPromoMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/oxium/partners", {
        headers: { "x-admin-key": adminKey },
      });
      const data = await res.json();
      if (data.success) {
        setPartners(Array.isArray(data.partners) ? data.partners : []);
        setPromos(Array.isArray(data.promos) ? data.promos : []);
      }
    } catch {
      notify("error", "failed to load oxium network data");
    } finally {
      setLoading(false);
    }
  }, [adminKey, notify]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updatePartnerStatus = async (slug: string, action: "approved" | "rejected" | "delete") => {
    let reason = "";
    if (action === "rejected") {
      reason = window.prompt("Optional rejection reason:") || "";
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/oxium/partners/${encodeURIComponent(slug)}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({ action, reason }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify("error", data.error || "status update failed");
        return;
      }
      notify("success", `${slug}: ${action}`);
      await loadData();
    } catch {
      notify("error", "network error updating partner");
    } finally {
      setBusy(false);
    }
  };

  const handlePromoAction = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/oxium/promos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify("error", data.error || "promo action failed");
        return;
      }
      if (payload.action === "create") {
        notify("success", `promo published & sent to ${data.delivered || 0} live users`);
        setPromoMessage("");
      } else if (payload.action === "broadcast") {
        notify("success", `promo pushed to ${data.count || 0} connected clients`);
      } else {
        notify("success", "promos updated");
      }
      await loadData();
    } catch {
      notify("error", "promo request failed");
    } finally {
      setBusy(false);
    }
  };

  const approvedPartners = partners.filter((p) => p.status === "approved");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div class="admin-item" style={{ padding: "14px", borderRadius: "12px", background: "var(--bg-surface-4)", border: "1px solid var(--bg-surface-10)" }}>
        <label>oxium network push &amp; promo notifications</label>
        <p style={{ marginBottom: "10px" }}>
          send clickable cross-site promos to Operation Cookie &amp; Oxium partner sites (e.g. &ldquo;Like Operation Cookie? Try out ExampleGame Site! Click here for links&rdquo;).
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
          <select
            class="admin-input"
            value={promoSiteSlug}
            onChange={(e) => {
              const s = (e.target as HTMLSelectElement).value;
              setPromoSiteSlug(s);
              const match = partners.find((p) => p.slug === s);
              if (match && !promoMessage.trim()) {
                setPromoMessage(`Try out ${match.name}! Click here for links.`);
              }
            }}
          >
            <option value="">-- pick featured partner site (optional) --</option>
            {approvedPartners.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name} (/{p.slug})
              </option>
            ))}
          </select>

          <input
            type="text"
            class="admin-input"
            placeholder="title (e.g. Like Operation Cookie?)"
            value={promoTitle}
            onInput={(e) => setPromoTitle((e.target as HTMLInputElement).value)}
          />
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="text"
            class="admin-input"
            style={{ flex: 1 }}
            placeholder="Try out ExampleGame Site! Click here for links."
            value={promoMessage}
            onInput={(e) => setPromoMessage((e.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="admin-btn-primary"
            disabled={busy}
            onClick={() =>
              handlePromoAction({
                action: "create",
                siteSlug: promoSiteSlug,
                title: promoTitle,
                message: promoMessage,
              })
            }
          >
            push promo
          </button>
        </div>

        {promos.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
            {promos.map((pr) => (
              <div
                key={pr.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  background: "var(--bg-body)",
                  border: "1px solid var(--bg-surface-10)",
                  fontSize: "12px",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong>{pr.title}</strong> — {pr.message}{" "}
                  <span style={{ opacity: 0.65 }}>({pr.active ? "active" : "paused"})</span>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <button
                    type="button"
                    class="admin-btn-secondary"
                    disabled={busy}
                    onClick={() => handlePromoAction({ action: "broadcast", id: pr.id })}
                  >
                    push now
                  </button>
                  <button
                    type="button"
                    class="admin-btn-secondary"
                    disabled={busy}
                    onClick={() => handlePromoAction({ action: "toggle", id: pr.id })}
                  >
                    {pr.active ? "pause" : "resume"}
                  </button>
                  <button
                    type="button"
                    class="admin-btn-danger"
                    disabled={busy}
                    onClick={() => handlePromoAction({ action: "delete", id: pr.id })}
                  >
                    del
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div class="admin-item">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <label style={{ margin: 0 }}>oxium partner site requests ({partners.length})</label>
          <button type="button" class="admin-btn-secondary" onClick={loadData}>
            refresh
          </button>
        </div>

        {loading ? (
          <p>loading oxium requests...</p>
        ) : partners.length === 0 ? (
          <p>no partner site requests submitted yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {partners.map((p) => (
              <div
                key={p.slug}
                style={{
                  padding: "12px",
                  borderRadius: "10px",
                  background: "var(--bg-surface-4)",
                  border: "1px solid var(--bg-surface-10)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "4px",
                        background: p.accentColor || "#6366f1",
                        display: "inline-block",
                      }}
                    />
                    <strong>{p.name}</strong>
                    <span style={{ opacity: 0.65, fontSize: "12px" }}>/{p.slug}</span>
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase" }}>
                    {p.status}
                  </span>
                </div>

                {p.tagline && <div style={{ fontSize: "12px", opacity: 0.85 }}>{p.tagline}</div>}
                <div style={{ fontSize: "11px", opacity: 0.7 }}>
                  owner: {p.ownerUsername || "guest"} • contact: {p.contact || "none"} • origins:{" "}
                  {p.allowedOrigins?.join(", ") || "none"} • links: {p.links?.length || 0}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                  {p.status !== "approved" && (
                    <button
                      type="button"
                      class="admin-btn-primary"
                      disabled={busy}
                      onClick={() => updatePartnerStatus(p.slug, "approved")}
                    >
                      approve
                    </button>
                  )}
                  {p.status !== "rejected" && (
                    <button
                      type="button"
                      class="admin-btn-secondary"
                      disabled={busy}
                      onClick={() => updatePartnerStatus(p.slug, "rejected")}
                    >
                      reject
                    </button>
                  )}
                  <a
                    href={`/oxium/auth?site=${encodeURIComponent(p.slug)}&preview=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="admin-btn-secondary"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                  >
                    preview auth
                  </a>
                  <a
                    href={`/oxium/links/${encodeURIComponent(p.slug)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="admin-btn-secondary"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                  >
                    links page
                  </a>
                  <button
                    type="button"
                    class="admin-btn-danger"
                    disabled={busy}
                    onClick={() => updatePartnerStatus(p.slug, "delete")}
                  >
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
