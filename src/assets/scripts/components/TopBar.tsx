import { useEffect, useState } from "preact/hooks";
import { getCookieCoins } from "../core/cookieCoins.ts";

export default function TopBar() {
  const [coins, setCoins] = useState<number>(() => getCookieCoins());

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
    if (user.username) {
      const statusEl = document.getElementById("auth-status");
      if (statusEl) statusEl.textContent = user.username;
    }

    const onCoins = () => setCoins(getCookieCoins());
    window.addEventListener("cookie-coins-updated", onCoins);
    window.addEventListener("storage", onCoins);
    return () => {
      window.removeEventListener("cookie-coins-updated", onCoins);
      window.removeEventListener("storage", onCoins);
    };
  }, []);

  return (
    <>
      <div id="top-left-stuff">
        <div id="branding-container" class="icon-btn">
          <img
            src="/sunshinelogo.png"
            style={{ width: "20px", height: "20px", marginRight: "8px" }}
          />
          <span id="brand">Operation Cookie</span>
        </div>
        <a
          href="https://discord.gg"
          target="_blank"
          id="discord-btn"
          class="icon-btn"
          title="Discord"
        >
          <i class="fa-brands fa-discord"></i>
        </a>
        <a
          href="#"
          id="chat-btn"
          class="icon-btn"
          title="Chatroom"
          onClick={(e) => {
            e.preventDefault();
            document.dispatchEvent(new CustomEvent("toggleChatModal"));
          }}
        >
          <i class="fa-solid fa-comments"></i>
        </a>
        <a href="#" id="choi" class="icon-btn" title="Games">
          <i class="fa-solid fa-gamepad"></i>
        </a>
        <a href="#" id="apps-btn" class="icon-btn" title="Apps (Proxy)">
          <i class="fa-solid fa-table-cells-large"></i>
        </a>
        <a
          href="#"
          id="studio-btn"
          class="text-icon-btn"
          title="Game Studio — Play & Create Community Games"
          style={{ fontSize: "13px", padding: "10px 14px" }}
        >
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          <span>game studio</span>
        </a>
        <a
          href="#"
          id="shop-btn"
          class="text-icon-btn"
          title="Cookie Shop — Spend Cookie Coins on 1x Targeted Trolls"
          style={{ fontSize: "13px", padding: "10px 14px" }}
        >
          <i class="fa-solid fa-cookie-bite"></i>
          <span>shop · {coins}</span>
        </a>
      </div>
      <div id="top-right-stuff">
        <div
          id="auth-container"
          class="text-icon-btn"
          onClick={() =>
            document.dispatchEvent(new CustomEvent("toggleAuthModal"))
          }
        >
          <i class="fa-solid fa-cloud"></i>
          <span id="auth-status">cloud sync</span>
        </div>
        <a href="#" id="settings" class="icon-btn">
          <i class="settings fa-solid fa-gear"></i>
        </a>
      </div>
    </>
  );
}
