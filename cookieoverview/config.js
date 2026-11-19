/**
 * Cookie Payments — Central Configuration
 * ---------------------------------------------------------------------------
 * Edit this file to add new products, update pricing, change support email,
 * or update policy text. No build step required—save and deploy to Vercel.
 */

window.COOKIE_PAYMENTS_CONFIG = {
  /**
   * PROJECTS
   * Add or edit digital products & memberships here.
   * Currently listed: Cookie Master on Operation Cookie.
   */
  PROJECTS: [
    {
      id: "cookie-master",
      name: "Cookie Master",
      platform: "Operation Cookie",
      category: "Membership",
      status: "Pending Stripe Approval",
      statementDescriptor: "COOKIEPAY* MASTER",
      description:
        "A $2/month membership for Operation Cookie. Removes banner ads across the homepage and chat, gives +1,000 Cookie Coins every 24 hours, and unlocks the Cookie Crown badge and custom UI themes.",
      highlights: [
        "No banner ads on Operation Cookie or in community chat",
        "+1,000 Cookie Coins every 24 hours for screen effects and Cookie Shop items",
        "Cookie Crown chat badge, custom profile styling, and member drops",
        "Links to your CloudSync account or verifies with your email, sub_..., or cs_... ID",
      ],
      price: "$2",
      billingCycle: "/ month · cancel anytime",
      ctaLabel: "Open Operation Cookie",
      ctaUrl: "https://p01--sunshinewaves--8tvyj9vm8crz.code.run/",
    },
  ],

  SITE_CONFIG: {
    brandName: "Cookie Payments",
    brandSub: "Billing & Product Hub",
    supportEmail: "admin@furballsmp.online",
    responseWindow: "within 24–48 hours",
    copyrightYear: "2026",

    navLinks: [
      { label: "Projects", href: "#projects" },
      { label: "Billing Info", href: "#billing" },
      { label: "Policies", href: "#policies" },
      { label: "Support", href: "#support" },
    ],

    hero: {
      badge: "Pending Stripe Approval · Checkout Coming Soon",
      headline: "Billing and memberships for Operation Cookie and future projects.",
      subtext:
        "Cookie Payments is the central billing page for our web apps and memberships. Right now that just means Cookie Master on Operation Cookie, with paid checkout currently pending Stripe approval.",
      primaryCta: {
        label: "See Cookie Master",
        href: "#projects",
      },
      secondaryCta: {
        label: "Refund & Billing Info",
        href: "#policies",
      },
    },

    projectsSection: {
      eyebrow: "Freshly Baked",
      title: "Current Projects",
      subtitle:
        "Everything we run under Cookie Payments. Live payments will turn on once Stripe approval is complete.",
    },

    billingSection: {
      eyebrow: "Billing Info",
      title: "How Payments & Delivery Work",
      subtitle:
        "Payments are currently pending Stripe approval. Once live, checkout and delivery work like this:",
      pillars: [
        {
          id: "secure-checkout",
          title: "Stripe Checkout",
          badge: "Pending Approval",
          description:
            "Once approved, all payments and monthly memberships will run through Stripe Checkout. We never see or store your card number on our servers.",
        },
        {
          id: "instant-delivery",
          title: "Instant Perks",
          badge: "Auto-Synced",
          description:
            "After checkout, your perks unlock right away on your CloudSync account. You can also verify anytime using your billing email, sub_..., or cs_... ID.",
        },
        {
          id: "clear-statements",
          title: "Bank Statements",
          badge: "Clear Name",
          description:
            "Charges will show up on your bank or card statement as COOKIEPAY* [PROJECT] (for example, COOKIEPAY* MASTER).",
        },
      ],
    },

    policiesSection: {
      eyebrow: "Policies",
      title: "Refunds, Terms & Privacy",
      subtitle:
        "What you need to know before subscribing once paid checkout is live.",
      tabs: [
        {
          id: "refunds",
          tabLabel: "Refunds & Cancellations",
          title: "Refund & Cancellation Policy",
          lastUpdated: "November 2026",
          intro:
            "You can cancel anytime without contacting support, and we refund billing mistakes or delivery issues.",
          clauses: [
            {
              heading: "Cancelling a Subscription",
              body: "You can cancel Cookie Master ($2/month) anytime from the Stripe Billing Portal or inside your Operation Cookie account settings. Auto-renewal stops right away, and you keep your perks until the end of the month you already paid for.",
            },
            {
              heading: "Refunds for Digital Perks & Mistakes",
              body: "Because perks unlock right after payment, we don't usually do partial-month refunds once a month has started. That said, if you were double-charged, forgot to cancel right before renewal, had an unauthorized charge, or perks didn't unlock, email us within 7 days and we will refund it in full.",
            },
            {
              heading: "How to Ask for a Refund",
              body: "Send an email to admin@furballsmp.online with the email you used at checkout and your Stripe subscription ID (sub_...) or session ID (cs_...). Approved refunds go back to your original card through Stripe within 5–10 business days.",
            },
          ],
        },
        {
          id: "terms",
          tabLabel: "Terms of Service",
          title: "Terms of Service",
          lastUpdated: "November 2026",
          intro:
            "By buying a membership or digital perk through Cookie Payments, you agree to these basic rules.",
          clauses: [
            {
              heading: "Memberships & Access",
              body: "A membership gives your account access to perks like ad-free browsing, daily Cookie Coins, and custom themes while your subscription is active. Perks are for your own account and can't be resold or transferred.",
            },
            {
              heading: "Monthly Renewals",
              body: "Subscriptions renew every month unless you cancel before the next billing date. If we ever change the price of a plan, we'll give active members notice before the new price takes effect.",
            },
            {
              heading: "Fair Use",
              body: "Don't use your account or perks to spam chat, bypass site rules, or abuse chargebacks. Cookie Coins are in-app points only and don't have real-world cash value.",
            },
          ],
        },
        {
          id: "privacy",
          tabLabel: "Privacy Policy",
          title: "Privacy Policy",
          lastUpdated: "November 2026",
          intro:
            "We only keep the minimum info needed to check your membership status and help with support.",
          clauses: [
            {
              heading: "What We Store",
              body: "Stripe handles all card and payment details directly. We only store your billing email, Stripe subscription or session IDs (sub_..., cs_...), whether your pass is active, and your CloudSync username if you linked one.",
            },
            {
              heading: "How It's Used",
              body: "We only use that info to keep your perks unlocked, prevent abuse, and look up your account if you email us for help or a refund. We never sell or share your info with third parties.",
            },
            {
              heading: "Removing Your Info",
              body: "If you want your billing metadata unlinked or removed from our records, email admin@furballsmp.online and we'll take care of it.",
            },
          ],
        },
      ],
    },

    supportCard: {
      eyebrow: "Support",
      title: "Questions About Billing or Your Pass?",
      description:
        "If something looks off on a statement, your perks didn't unlock, or you need a refund, send us an email.",
      checklistTitle: "Helpful details to include:",
      checklist: [
        "The email address you used at checkout",
        "Your Stripe subscription ID (sub_...) or session ID (cs_...), if you have it",
        "Which project it's for (e.g., Operation Cookie — Cookie Master) and what happened",
      ],
    },
  },
};
