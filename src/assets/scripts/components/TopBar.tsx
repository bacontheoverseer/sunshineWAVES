import { useEffect } from "preact/hooks";

export default function TopBar() {
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
    if (user.username) {
      const statusEl = document.getElementById("auth-status");
      if (statusEl) statusEl.textContent = user.username;
    }
  }, []);

  return (
    <>
      <div id="top-left-stuff">
        <div id="branding-container" class="icon-btn">
          <img src="/sunshinelogo.png" style={{ width: '20px', height: '20px', marginRight: '8px' }} />
          <span id="brand">Operation Cookie</span>
        </div>
        <a
          href="https://discord.gg/dJvdkPRheV"
          target="_blank"
          id="discord-btn"
          class="icon-btn"
        >
          <i class="fa-brands fa-discord"></i>
        </a>
        <a href="#" id="choi" class="icon-btn">
          <i class="fa-solid fa-gamepad"></i>
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