(function () {
  const cfg = window.COOKIE_PAYMENTS_CONFIG;
  if (!cfg) return;

  const { PROJECTS, SITE_CONFIG } = cfg;

  const COOKIE_LOGO_SVG = `
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="13.5" fill="#C88A55" stroke="#3B2D24" stroke-width="2" />
      <circle cx="11" cy="11.5" r="2" fill="#3B2D24" />
      <circle cx="20.5" cy="10.5" r="1.7" fill="#3B2D24" />
      <circle cx="15" cy="19" r="2.2" fill="#3B2D24" />
      <circle cx="21.5" cy="20" r="1.6" fill="#3B2D24" />
      <circle cx="10" cy="21" r="1.5" fill="#3B2D24" />
    </svg>
  `;

  const BILLING_ICONS = {
    "secure-checkout": `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    "instant-delivery": `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    "clear-statements": `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>`,
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderPolicyPanel(policy) {
    return `
      <div class="policy-panel-head">
        <h3>${escapeHtml(policy.title)}</h3>
        <span class="policy-updated">Last updated: ${escapeHtml(policy.lastUpdated)}</span>
      </div>
      <p class="policy-intro">${escapeHtml(policy.intro)}</p>
      <div class="policy-clauses">
        ${policy.clauses
          .map(
            (clause) => `
              <article class="policy-clause">
                <h4>${escapeHtml(clause.heading)}</h4>
                <p>${escapeHtml(clause.body)}</p>
              </article>
            `
          )
          .join("")}
      </div>
    `;
  }

  function renderApp() {
    const root = document.getElementById("app");
    if (!root) return;

    const defaultPolicy = SITE_CONFIG.policiesSection.tabs[0];

    root.innerHTML = `
      <header class="site-header">
        <div class="container header-inner">
          <a class="brand-link" href="#top" aria-label="${escapeHtml(SITE_CONFIG.brandName)} home">
            <span class="brand-mark">${COOKIE_LOGO_SVG}</span>
            <span class="brand-text">
              <span class="brand-name">${escapeHtml(SITE_CONFIG.brandName)}</span>
              <span class="brand-sub">${escapeHtml(SITE_CONFIG.brandSub)}</span>
            </span>
          </a>
          <nav class="nav-links" aria-label="Primary navigation">
            ${SITE_CONFIG.navLinks
              .map(
                (link) =>
                  `<a class="nav-link" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`
              )
              .join("")}
          </nav>
        </div>
      </header>

      <main id="top">
        <section class="hero">
          <div class="container">
            <div class="hero-card">
              <span class="mono-badge">
                <span class="status-dot" aria-hidden="true"></span>
                ${escapeHtml(SITE_CONFIG.hero.badge)}
              </span>
              <h1>${escapeHtml(SITE_CONFIG.hero.headline)}</h1>
              <p class="hero-subtext">${escapeHtml(SITE_CONFIG.hero.subtext)}</p>
              <div class="hero-actions">
                <a class="btn btn-primary" href="${escapeHtml(SITE_CONFIG.hero.primaryCta.href)}">
                  ${escapeHtml(SITE_CONFIG.hero.primaryCta.label)}
                </a>
                <a class="btn btn-secondary" href="${escapeHtml(SITE_CONFIG.hero.secondaryCta.href)}">
                  ${escapeHtml(SITE_CONFIG.hero.secondaryCta.label)}
                </a>
              </div>
            </div>
          </div>
        </section>

        <section id="projects" class="section">
          <div class="container">
            <div class="section-header">
              <p class="section-eyebrow">${escapeHtml(SITE_CONFIG.projectsSection.eyebrow)}</p>
              <h2 class="section-title">${escapeHtml(SITE_CONFIG.projectsSection.title)}</h2>
              <p class="section-subtitle">${escapeHtml(SITE_CONFIG.projectsSection.subtitle)}</p>
            </div>

            <div class="projects-grid">
              ${PROJECTS.map(
                (project) => `
                  <article class="project-card">
                    <div class="project-top">
                      <div class="project-badges">
                        <span class="badge-category">${escapeHtml(project.category)}</span>
                        <span class="badge-status">
                          <span class="status-dot" aria-hidden="true"></span>
                          ${escapeHtml(project.status)}
                        </span>
                      </div>
                    </div>

                    <div class="project-title-row">
                      <div>
                        <h3 class="project-name">${escapeHtml(project.name)}</h3>
                        <p class="project-platform">on ${escapeHtml(project.platform)}</p>
                      </div>
                      <div class="project-price-box">
                        <div class="project-price">${escapeHtml(project.price)}</div>
                        <div class="project-cycle">${escapeHtml(project.billingCycle)}</div>
                      </div>
                    </div>

                    <p class="project-desc">${escapeHtml(project.description)}</p>

                    <ul class="project-highlights">
                      ${project.highlights
                        .map((item) => `<li>${escapeHtml(item)}</li>`)
                        .join("")}
                    </ul>

                    <div class="project-footer">
                      <span class="statement-chip">Statement: ${escapeHtml(project.statementDescriptor)}</span>
                      <a
                        class="btn btn-primary"
                        href="${escapeHtml(project.ctaUrl)}"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ${escapeHtml(project.ctaLabel)}
                      </a>
                    </div>
                  </article>
                `
              ).join("")}
            </div>
          </div>
        </section>

        <section id="billing" class="section">
          <div class="container">
            <div class="section-header">
              <p class="section-eyebrow">${escapeHtml(SITE_CONFIG.billingSection.eyebrow)}</p>
              <h2 class="section-title">${escapeHtml(SITE_CONFIG.billingSection.title)}</h2>
              <p class="section-subtitle">${escapeHtml(SITE_CONFIG.billingSection.subtitle)}</p>
            </div>

            <div class="billing-grid">
              ${SITE_CONFIG.billingSection.pillars
                .map(
                  (pillar) => `
                    <article class="billing-card">
                      <div class="billing-card-head">
                        <span class="billing-icon">${BILLING_ICONS[pillar.id] || ""}</span>
                        <span class="badge-category">${escapeHtml(pillar.badge)}</span>
                      </div>
                      <h3>${escapeHtml(pillar.title)}</h3>
                      <p>${escapeHtml(pillar.description)}</p>
                    </article>
                  `
                )
                .join("")}
            </div>
          </div>
        </section>

        <section id="policies" class="section">
          <div class="container">
            <div class="section-header">
              <p class="section-eyebrow">${escapeHtml(SITE_CONFIG.policiesSection.eyebrow)}</p>
              <h2 class="section-title">${escapeHtml(SITE_CONFIG.policiesSection.title)}</h2>
              <p class="section-subtitle">${escapeHtml(SITE_CONFIG.policiesSection.subtitle)}</p>
            </div>

            <div class="policies-shell">
              <div class="policy-tabs" role="tablist" aria-label="Billing and legal policies">
                ${SITE_CONFIG.policiesSection.tabs
                  .map(
                    (tab, idx) => `
                      <button
                        type="button"
                        role="tab"
                        class="policy-tab-btn${idx === 0 ? " is-active" : ""}"
                        data-policy-id="${escapeHtml(tab.id)}"
                        aria-selected="${idx === 0 ? "true" : "false"}"
                      >
                        ${escapeHtml(tab.tabLabel)}
                      </button>
                    `
                  )
                  .join("")}
              </div>
              <div id="policy-panel" role="tabpanel">
                ${renderPolicyPanel(defaultPolicy)}
              </div>
            </div>
          </div>
        </section>

        <section id="support" class="section">
          <div class="container">
            <div class="support-card">
              <div>
                <p class="section-eyebrow">${escapeHtml(SITE_CONFIG.supportCard.eyebrow)}</p>
                <h2 class="section-title">${escapeHtml(SITE_CONFIG.supportCard.title)}</h2>
                <p class="section-subtitle">${escapeHtml(SITE_CONFIG.supportCard.description)}</p>
                <div class="support-meta">
                  <a
                    class="btn btn-primary"
                    href="mailto:${escapeHtml(SITE_CONFIG.supportEmail)}"
                  >
                    ${escapeHtml(SITE_CONFIG.supportEmail)}
                  </a>
                  <span class="mono-badge">
                    Response time: ${escapeHtml(SITE_CONFIG.responseWindow)}
                  </span>
                </div>
              </div>

              <div class="support-checklist">
                <h3>${escapeHtml(SITE_CONFIG.supportCard.checklistTitle)}</h3>
                <ul>
                  ${SITE_CONFIG.supportCard.checklist
                    .map((item) => `<li>${escapeHtml(item)}</li>`)
                    .join("")}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer class="site-footer">
        <div class="container footer-inner">
          <span>&copy; ${escapeHtml(SITE_CONFIG.copyrightYear)} ${escapeHtml(SITE_CONFIG.brandName)}</span>
          <div class="footer-links">
            ${SITE_CONFIG.policiesSection.tabs
              .map(
                (tab) => `
                  <button
                    type="button"
                    class="footer-link"
                    data-jump-policy="${escapeHtml(tab.id)}"
                  >
                    ${escapeHtml(tab.tabLabel)}
                  </button>
                `
              )
              .join("")}
            <a href="mailto:${escapeHtml(SITE_CONFIG.supportEmail)}">
              ${escapeHtml(SITE_CONFIG.supportEmail)}
            </a>
          </div>
        </div>
      </footer>
    `;

    const panel = document.getElementById("policy-panel");
    const tabButtons = Array.from(document.querySelectorAll("[data-policy-id]"));

    function selectPolicy(policyId) {
      const target = SITE_CONFIG.policiesSection.tabs.find((t) => t.id === policyId);
      if (!target || !panel) return;
      panel.innerHTML = renderPolicyPanel(target);
      tabButtons.forEach((btn) => {
        const isMatch = btn.getAttribute("data-policy-id") === policyId;
        btn.classList.toggle("is-active", isMatch);
        btn.setAttribute("aria-selected", isMatch ? "true" : "false");
      });
    }

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-policy-id");
        if (id) selectPolicy(id);
      });
    });

    document.querySelectorAll("[data-jump-policy]").forEach((link) => {
      link.addEventListener("click", () => {
        const id = link.getAttribute("data-jump-policy");
        if (id) selectPolicy(id);
        const policiesEl = document.getElementById("policies");
        if (policiesEl) policiesEl.scrollIntoView({ behavior: "smooth" });
      });
    });
  }

  renderApp();
})();
