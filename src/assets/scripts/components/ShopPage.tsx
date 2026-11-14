import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { showHomeView } from "../state/store.ts";
import {
  getCookieCoins,
  spendCookieCoins,
  getActiveUser,
} from "../core/cookieCoins.ts";
import { getClientId, executeTrollAction } from "../core/liveClient.ts";
import { moderateChatMessage } from "../core/contentFilter.ts";

interface ShopTrollItem {
  id: string;
  name: string;
  desc: string;
  cost: number;
  category: "sound" | "visual" | "voice";
  icon: string;
  action: "sfx" | "effect" | "tts";
  data: Record<string, unknown>;
}

interface OnlineTargetUser {
  id: string;
  username: string;
  page?: string;
  game?: string;
}

const SHOP_ITEMS: ShopTrollItem[] = [
  {
    id: "vine-boom",
    name: "vine boom blast",
    desc: "blasts a loud vine boom bass drop through the target user's speakers (1x)",
    cost: 20,
    category: "sound",
    icon: "fa-volume-high",
    action: "sfx",
    data: { url: "/assets/sounds/vine-boom.mp3", sound: "vine-boom", volume: 1.0 },
  },
  {
    id: "metal-pipe",
    name: "metal pipe crash",
    desc: "drops a deafening falling metal pipe sound on the target user (1x)",
    cost: 25,
    category: "sound",
    icon: "fa-hammer",
    action: "sfx",
    data: { url: "/assets/sounds/metal-pipe.mp3", sound: "metal-pipe", volume: 1.0 },
  },
  {
    id: "fbi-open-up",
    name: "fbi open up",
    desc: "plays door knocking + fbi open up raid audio on the target user (1x)",
    cost: 35,
    category: "sound",
    icon: "fa-shield-halved",
    action: "sfx",
    data: { url: "/assets/sounds/fbi-open-up.mp3", sound: "door-knock", volume: 1.0 },
  },
  {
    id: "airhorn",
    name: "mlg airhorn",
    desc: "blasts an instant airhorn jumpscare on the target's speakers (1x)",
    cost: 30,
    category: "sound",
    icon: "fa-bullhorn",
    action: "sfx",
    data: { url: "/assets/sounds/airhorn.mp3", sound: "screamer", volume: 1.0 },
  },
  {
    id: "emotional-damage",
    name: "emotional damage",
    desc: "plays the iconic emotional damage meme audio on the target user (1x)",
    cost: 25,
    category: "sound",
    icon: "fa-face-grin-squint-tears",
    action: "sfx",
    data: { url: "/assets/sounds/emotional-damage.mp3", sound: "bruh", volume: 1.0 },
  },
  {
    id: "fart-reverb",
    name: "reverb fart",
    desc: "echoing reverb fart sound effect on the target user's computer (1x)",
    cost: 20,
    category: "sound",
    icon: "fa-wind",
    action: "sfx",
    data: { url: "/assets/sounds/reverb-fart.mp3", sound: "fart", volume: 1.0 },
  },
  {
    id: "barrel-roll",
    name: "360° barrel roll",
    desc: "spins the target user's entire screen 360 degrees once",
    cost: 40,
    category: "visual",
    icon: "fa-rotate",
    action: "effect",
    data: { effect: "barrel-roll", duration: 1800 },
  },
  {
    id: "earthquake",
    name: "earthquake tremor",
    desc: "shakes the target user's screen violently for 6 seconds",
    cost: 50,
    category: "visual",
    icon: "fa-house-crack",
    action: "effect",
    data: { effect: "earthquake", duration: 6000 },
  },
  {
    id: "flip-screen",
    name: "upside-down flip",
    desc: "flips the target user's screen upside down for 8 seconds",
    cost: 60,
    category: "visual",
    icon: "fa-arrows-up-down",
    action: "effect",
    data: { effect: "flip", duration: 8000 },
  },
  {
    id: "disco-rave",
    name: "rainbow rave flash",
    desc: "turns the target user's screen into a rainbow disco strobe for 7 seconds",
    cost: 70,
    category: "visual",
    icon: "fa-wand-magic-sparkles",
    action: "effect",
    data: { effect: "disco", duration: 7000 },
  },
  {
    id: "dvd-bounce",
    name: "dvd screen bounce",
    desc: "bounces a neon dvd bouncer & shakes the target user's screen for 10s",
    cost: 75,
    category: "visual",
    icon: "fa-compact-disc",
    action: "effect",
    data: { effect: "dvd-bounce", duration: 10000 },
  },
  {
    id: "matrix-rain",
    name: "matrix hacker rain",
    desc: "floods the target user's screen with green matrix code rain for 8 seconds",
    cost: 65,
    category: "visual",
    icon: "fa-terminal",
    action: "effect",
    data: { effect: "matrix-rain", duration: 8000 },
  },
  {
    id: "fake-bsod",
    name: "fake windows bsod",
    desc: "flashes a convincing blue screen of death on the target for 5 seconds",
    cost: 95,
    category: "visual",
    icon: "fa-desktop",
    action: "effect",
    data: { effect: "bsod", duration: 5000 },
  },
  {
    id: "custom-tts",
    name: "speak tts message (1x)",
    desc: "speaks a custom message out loud through the target user's speakers",
    cost: 55,
    category: "voice",
    icon: "fa-comment-dots",
    action: "tts",
    data: { pitch: 1.0, rate: 1.0, volume: 1.0 },
  },
];

function notifyToast(message: string, type: "success" | "error" | "info" = "info") {
  const w = window as unknown as { showToast?: (msg: string, t?: string) => void };
  if (typeof w.showToast === "function") {
    w.showToast(message, type);
  }
}

export default function ShopPage() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState(false);
  const [coins, setCoins] = useState<number>(() => getCookieCoins());
  const [onlineTargets, setOnlineTargets] = useState<OnlineTargetUser[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>("");
  const [customTargetInput, setCustomTargetInput] = useState<string>("");
  const [ttsMessage, setTtsMessage] = useState<string>("hey there from cookie shop!");
  const [filterCat, setFilterCat] = useState<"all" | "sound" | "visual" | "voice">("all");
  const [sendingId, setSendingId] = useState<string | null>(null);

  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trollBcRef = useRef<BroadcastChannel | null>(null);

  const hide = useCallback(() => {
    if (!document.body.classList.contains("shop-view")) return;
    setActive(false);

    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setVisible(false);
      document.body.classList.remove("shop-view");
      fadeTimerRef.current = null;
    }, 100);
  }, []);

  const show = useCallback(() => {
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    if (
      (window as any).toggleSettingsMenu &&
      document.getElementById("settings-menu")?.classList.contains("open")
    ) {
      (window as any).toggleSettingsMenu();
    }
    if (document.body.classList.contains("games-view") && (window as any).hideGameMenu) {
      (window as any).hideGameMenu();
    }
    if (document.body.classList.contains("apps-view") && (window as any).hideAppsMenu) {
      (window as any).hideAppsMenu();
    }
    if (document.body.classList.contains("studio-view") && (window as any).hideStudioMenu) {
      (window as any).hideStudioMenu();
    }

    showHomeView();
    document.body.classList.add("shop-view");
    setVisible(true);
    setCoins(getCookieCoins());

    requestAnimationFrame(() => {
      setActive(true);
    });
  }, []);

  const toggle = useCallback(() => {
    if (document.body.classList.contains("shop-view")) hide();
    else show();
  }, [show, hide]);

  useEffect(() => {
    (window as any).showShopMenu = show;
    (window as any).hideShopMenu = hide;
    (window as any).toggleShopMenu = toggle;

    const shopBtn = document.getElementById("shop-btn");
    const brand =
      document.getElementById("branding-container") ||
      document.getElementById("brand");

    const onShopClick = (e: MouseEvent) => {
      e.preventDefault();
      toggle();
    };
    const onBrandClick = (e: MouseEvent) => {
      e.preventDefault();
      if (document.body.classList.contains("shop-view")) hide();
    };

    if (shopBtn) shopBtn.addEventListener("click", onShopClick);
    if (brand) brand.addEventListener("click", onBrandClick);

    const onCoinsUpdated = () => setCoins(getCookieCoins());
    window.addEventListener("cookie-coins-updated", onCoinsUpdated);

    try {
      trollBcRef.current = new BroadcastChannel("cookie_live_troll_channel");
    } catch {}

    return () => {
      if (shopBtn) shopBtn.removeEventListener("click", onShopClick);
      if (brand) brand.removeEventListener("click", onBrandClick);
      window.removeEventListener("cookie-coins-updated", onCoinsUpdated);
      trollBcRef.current?.close();
    };
  }, [show, hide, toggle]);

  // Fetch online users list when shop is open
  const fetchOnlineUsers = useCallback(() => {
    const meUser = getActiveUser();
    const myId = getClientId();
    fetch(`/api/chat/state?user=${encodeURIComponent(meUser)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const list: OnlineTargetUser[] = [];
        if (Array.isArray(data?.onlineUsers)) {
          for (const u of data.onlineUsers) {
            if (u.username && !list.some((x) => x.username === u.username)) {
              list.push({ id: u.id || u.username, username: u.username });
            }
          }
        }
        if (!list.some((x) => x.username.toLowerCase() === meUser.toLowerCase())) {
          list.unshift({ id: myId, username: `${meUser} (you)` });
        }
        setOnlineTargets(list);
        if (!selectedTarget && list.length > 0) {
          setSelectedTarget(list[0].username.replace(" (you)", ""));
        }
      })
      .catch(() => {
        setOnlineTargets([{ id: myId, username: `${meUser} (you)` }]);
        if (!selectedTarget) setSelectedTarget(meUser);
      });
  }, [selectedTarget]);

  useEffect(() => {
    if (!visible) return;
    fetchOnlineUsers();
    const timer = window.setInterval(fetchOnlineUsers, 6000);
    return () => window.clearInterval(timer);
  }, [visible, fetchOnlineUsers]);

  const handleBuyTroll = async (item: ShopTrollItem) => {
    if (sendingId) return;
    const targetUser = (customTargetInput.trim() || selectedTarget || "").replace(
      " (you)",
      ""
    );
    if (!targetUser) {
      notifyToast("select or type an online username to target first", "error");
      return;
    }

    if (coins < item.cost) {
      notifyToast(
        `not enough cookie coins! you need ${item.cost} coins (make & publish games in game studio to earn more)`,
        "error"
      );
      return;
    }

    let actionData = { ...item.data };
    if (item.action === "tts") {
      const cleanTts = ttsMessage.trim();
      if (!cleanTts) {
        notifyToast("enter a message for the TTS voice troll", "error");
        return;
      }
      const mod = await moderateChatMessage(cleanTts);
      if (mod.blocked) {
        notifyToast(mod.reason || "TTS message blocked by moderation", "error");
        return;
      }
      actionData = { ...actionData, text: cleanTts };
    }

    setSendingId(item.id);
    const trollEventId = `troll_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    actionData = { ...actionData, trollEventId };

    try {
      const meUser = getActiveUser().toLowerCase();
      const targetLower = targetUser.trim().toLowerCase();
      const isSelf =
        targetLower === meUser ||
        targetLower.replace(/[-_]/g, "") === meUser.replace(/[-_]/g, "");

      // Send over backend SSE to target user first so we can verify target exists / is online
      let resData: { success?: boolean; delivered?: number; userExists?: boolean; error?: string } | null = null;
      try {
        const res = await fetch("/api/shop/troll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trollEventId,
            targetUsername: targetUser,
            action: item.action,
            data: actionData,
            sender: getActiveUser(),
          }),
        });
        resData = await res.json();
      } catch {}

      if (!isSelf && resData) {
        if (resData.userExists === false) {
          notifyToast(`user "@${targetUser}" does not exist in cloudsync`, "error");
          return;
        }
        if ((resData.delivered || 0) === 0) {
          notifyToast(`@${targetUser} is currently offline — trolls can only hit online players`, "error");
          return;
        }
      }

      if (!spendCookieCoins(item.cost)) {
        notifyToast("insufficient cookie coins", "error");
        return;
      }

      if (isSelf) {
        executeTrollAction(item.action, actionData, trollEventId);
      }

      // Broadcast over local channel for instant multi-tab execution
      try {
        trollBcRef.current?.postMessage({
          type: "SHOP_TROLL",
          trollEventId,
          targetUsername: targetUser,
          action: item.action,
          data: actionData,
          sender: getActiveUser(),
        });
      } catch {}

      notifyToast(
        `sent 1x "${item.name}" to @${targetUser} (-${item.cost} cookie coins)`,
        "success"
      );
    } finally {
      setSendingId(null);
    }
  };

  if (!visible) return null;

  const filteredItems = SHOP_ITEMS.filter(
    (i) => filterCat === "all" || i.category === filterCat
  );

  const activeTarget = (customTargetInput.trim() || selectedTarget || "user").replace(" (you)", "");

  return (
    <section
      id="shop-page"
      class={`studio-page${visible ? " is-visible" : ""}${active ? " is-active" : ""}`}
      aria-hidden={!visible}
      style={{ maxWidth: "980px" }}
    >
      {/* Top Bar */}
      <div class="studio-topbar" style={{ marginBottom: "14px" }}>
        <div class="studio-brand">
          <i class="fa-solid fa-cookie-bite"></i>
          <span>cookie shop</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div
            class="studio-tab-btn active"
            style={{ cursor: "default", fontWeight: 600 }}
          >
            <i class="fa-solid fa-coins"></i>
            <span>{coins} coins</span>
          </div>

          <button
            type="button"
            class="studio-tab-btn"
            onClick={() => {
              hide();
              (window as any).showStudioMenu?.();
            }}
          >
            <i class="fa-solid fa-gamepad"></i>
            <span>earn in studio</span>
          </button>
        </div>
      </div>

      {/* Target & Filter Bar */}
      <div
        class="apps-custom-launcher"
        style={{
          flexDirection: "column",
          alignItems: "stretch",
          gap: "12px",
          padding: "14px 16px",
          marginBottom: "18px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <div class="apps-custom-launcher-label" style={{ gap: "8px" }}>
            <i class="fa-solid fa-crosshairs"></i>
            <span>target: @{activeTarget}</span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <select
              class="studio-select"
              value={selectedTarget}
              onChange={(e) => {
                setSelectedTarget(e.currentTarget.value);
                setCustomTargetInput("");
              }}
            >
              {onlineTargets.map((u) => {
                const clean = u.username.replace(" (you)", "");
                return (
                  <option key={u.id} value={clean}>
                    online: @{u.username}
                  </option>
                );
              })}
            </select>

            <input
              type="text"
              class="apps-custom-input"
              style={{ width: "170px", padding: "7px 11px", fontSize: "12.5px" }}
              placeholder="or type username..."
              value={customTargetInput}
              onInput={(e) => setCustomTargetInput(e.currentTarget.value)}
            />

            <button
              type="button"
              class="studio-tab-btn"
              onClick={fetchOnlineUsers}
              title="Refresh online users"
              style={{ padding: "7px 10px" }}
            >
              <i class="fa-solid fa-rotate"></i>
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            flexWrap: "wrap",
            borderTop: "1px solid var(--bg-surface-10)",
            paddingTop: "10px",
          }}
        >
          <div class="apps-category-pills">
            {(
              [
                { id: "all", label: "all", icon: "fa-layer-group" },
                { id: "sound", label: "sounds", icon: "fa-volume-high" },
                { id: "visual", label: "visuals", icon: "fa-display" },
                { id: "voice", label: "tts voice", icon: "fa-microphone-lines" },
              ] as const
            ).map((c) => (
              <button
                key={c.id}
                type="button"
                class={`apps-cat-pill ${filterCat === c.id ? "active" : ""}`}
                onClick={() => setFilterCat(c.id)}
              >
                <i class={`fa-solid ${c.icon}`}></i>
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          {(filterCat === "all" || filterCat === "voice") && (
            <input
              type="text"
              class="studio-input"
              style={{ width: "210px", padding: "6px 10px", fontSize: "12.5px" }}
              maxLength={120}
              value={ttsMessage}
              onInput={(e) => setTtsMessage(e.currentTarget.value)}
              placeholder="tts message..."
            />
          )}
        </div>
      </div>

      {/* Shop Items Grid */}
      <div
        class="studio-community-grid"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "12px",
        }}
      >
        {filteredItems.map((item) => {
          const canAfford = coins >= item.cost;
          const isSending = sendingId === item.id;
          return (
            <article
              key={item.id}
              class="studio-game-card"
              style={{
                padding: "14px",
                gap: "10px",
                background: "var(--bg-surface-3)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <div
                    class="app-icon-box"
                    style={{
                      width: "34px",
                      height: "34px",
                      borderRadius: "9px",
                      fontSize: "14px",
                      flexShrink: 0,
                      background: "var(--bg-surface-5)",
                      color: "var(--text-primary)",
                      boxShadow: "none",
                      border: "1px solid var(--bg-surface-10)",
                    }}
                  >
                    <i class={`fa-solid ${item.icon}`}></i>
                  </div>
                  <h3
                    class="app-card-title"
                    style={{
                      fontSize: "14px",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.name}
                  </h3>
                </div>
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 600,
                    color: canAfford ? "var(--text-primary)" : "var(--color-sublabel)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.cost}c
                </span>
              </div>

              <p
                class="app-card-desc"
                style={{
                  fontSize: "12px",
                  lineHeight: 1.4,
                  margin: 0,
                  color: "var(--color-sublabel)",
                }}
              >
                {item.desc}
              </p>

              <button
                type="button"
                class="studio-tab-btn"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "7px 10px",
                  fontSize: "12px",
                  opacity: canAfford ? 1 : 0.45,
                  background: "var(--bg-surface-5)",
                }}
                disabled={isSending}
                onClick={() => handleBuyTroll(item)}
              >
                <i class="fa-solid fa-bolt"></i>
                <span>{isSending ? "sending..." : `send 1x (${item.cost} coins)`}</span>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
