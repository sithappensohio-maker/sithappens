import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../lib/useConfirm";
import ServicesSettings from "../components/ServicesSettings";
import CreditPacksSettings from "../components/CreditPacksSettings";
import IconPicker from "../components/IconPicker";
import { useTheme, FONT_OPTIONS } from "../lib/theme";
import PageHero from "../components/PageHero";
import CsvImportRow from "../components/CsvImportRow";
import EmailDesignerPanel from "../components/EmailDesignerPanel";
import PaymentPlanSettingsPanel from "../components/PaymentPlanSettingsPanel";
import DayToDayControls from "../components/DayToDayControls";
import DataExportPanel from "../components/DataExportPanel";

const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const VAX_OPTIONS = [
  { key: "rabies", label: "Rabies" },
  { key: "bordetella", label: "Bordetella" },
  { key: "dhpp", label: "DHPP" },
  { key: "lepto", label: "Leptospirosis" },
  { key: "flu", label: "Canine Flu" },
  { key: "heartworm", label: "Heartworm" },
];

export default function Settings() {
  const { user } = useAuth();
  const [s, setS] = useState(null);
  const [tab, setTab] = useState("__overview__ops");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // password
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => { (async () => { const { data } = await api.get("/settings"); setS(data); })(); }, []);

  const save = async (partial) => {
    setSaving(true); setMsg("");
    try {
      const { data } = await api.put("/settings", partial);
      setS(data);
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) { setMsg(formatErr(e.response?.data?.detail)); }
    setSaving(false);
  };

  const changePw = async () => {
    setPwMsg("");
    if (pw.next.length < 8) { setPwMsg("Use at least 8 characters"); return; }
    if (pw.next !== pw.confirm) { setPwMsg("New passwords don't match"); return; }
    try {
      const { data } = await api.post("/auth/change-password", { current_password: pw.current, new_password: pw.next });
      if (data?.token) localStorage.setItem("sh_token", data.token);
      setPwMsg("Password updated");
      setPw({ current: "", next: "", confirm: "" });
    } catch (e) { setPwMsg(formatErr(e.response?.data?.detail)); }
  };

  // ──────────────────────────────────────────────────────────────────────
  // Sprint 110eh — Settings hub restructure.
  // 9 master categories. Each subsection carries a description + access
  // badges so the overview cards explain themselves. Subsections without a
  // built panel render as "Coming soon" cards (no fake controls).
  //
  // IMPORTANT: This is a NAVIGATION reshuffle only. Underlying panels stay
  // intact — `DayToDayControls` is still one mega-panel under Business
  // Operations. The follow-up pass will split it into per-category
  // sub-panels (Quiet Hours, Holiday Pricing, etc.).
  // ──────────────────────────────────────────────────────────────────────
  const CATEGORIES = [
    {
      id: "ops",
      label: "Business Operations",
      icon: "fa-clipboard-check",
      accent: "shBlue",
      blurb: "Hours, capacity, kennels, booking rules, and recurring schedules.",
      subsections: [
        { id: "feature_visibility", label: "Feature Visibility", icon: "fa-toggle-on",
          desc: "Turn major app features (Daycare, Boarding, Training, Grooming, Photography, Retail, Rewards, Trivia, Homework, Staff Portal, Messaging, Payment Plans, Manual Payments, Waitlist) on or off app-wide. Disabled features hide from the portal, nav, dashboard, and booking.",
          badges: ["Live", "Admin-only"] },
        { id: "client_portal_controls", label: "Client Portal Controls", icon: "fa-mobile-screen-button",
          desc: "Show or hide portal sections, edit client-facing labels, post an announcement banner, and customize empty-state copy. The portal now chooses the most important client action automatically.",
          badges: ["Live", "Client-facing"] },
        { id: "booking_flow_controls", label: "Booking Flow Controls", icon: "fa-calendar-check",
          desc: "Rules for every active bookable service, with category defaults underneath: online booking, approval, instant confirmation, same-day access, lead time, and advance-booking window.",
          badges: ["Live", "Per-service"] },
        { id: "dashboard_widgets", label: "Dashboard Widget Controls", icon: "fa-grip",
          desc: "Hide individual admin dashboard widgets without touching the underlying data. Use this to slim the dashboard down to what your team actually scans.",
          badges: ["Live", "Visibility-only"] },
        { id: "day_to_day", label: "Operator Quick Controls", icon: "fa-bolt",
          desc: "At-a-glance status of the rules you tweak most often, with deep links to each setting's true home.",
          badges: ["Live", "Admin-only"] },
        { id: "hours", label: "Hours & Closures", icon: "fa-clock",
          desc: "Weekly business hours, holiday closures, blackout dates.",
          badges: ["Live", "Client-facing"] },
        { id: "capacity", label: "Capacity & Kennels", icon: "fa-warehouse",
          desc: "Daily daycare cap, kennel slots, room labels.",
          badges: ["Live", "Admin-only"] },
        { id: "_d2d_guardrails", label: "Booking Guardrails", icon: "fa-shield",
          desc: "Lead times, max bookings/client, kennel limits, same-day rules, check-in/out windows.",
          badges: ["Live", "Admin-only"], d2dSection: "guardrails" },
        { id: "rules", label: "Booking Rules (legacy)", icon: "fa-clipboard-list",
          desc: "Lead times, advance windows, reschedule limits, deposit thresholds.",
          badges: ["Live", "Client-facing"] },
        { id: "_d2d_services", label: "Service Operational Defaults", icon: "fa-paw",
          desc: "Training session length, graduation thresholds, photography SLA, grooming durations.",
          badges: ["Live", "Staff-only"], d2dSection: "services" },
      ],
    },
    {
      id: "pricing",
      label: "Services & Pricing",
      icon: "fa-dollar-sign",
      accent: "shGreen",
      blurb: "Services, programs, packs, plans, taxes, and discounts.",
      subsections: [
        { id: "services", label: "Services & Programs", icon: "fa-paw",
          desc: "Daycare, boarding, grooming, training services, programs, and base prices.",
          badges: ["Live", "Client-facing"] },
        { id: "credit_packs", label: "Credit Packs", icon: "fa-coins",
          desc: "Pre-paid pack catalog for daycare, training, grooming.",
          badges: ["Live", "Client-facing"] },
        { id: "payment_plans", label: "Payment Plans", icon: "fa-file-invoice-dollar",
          desc: "Big-ticket installments — terms, default thresholds, reversal flow.",
          badges: ["Live", "Admin-only"] },
        { id: "_d2d_money", label: "Money Rules", icon: "fa-dollar-sign",
          desc: "Tipping, late-pickup fees, cancellation tiers, deposits, no-show fee, rounding.",
          badges: ["Live", "Client-facing"], d2dSection: "money" },
        { id: "_d2d_seasonal", label: "Holiday & Peak-Season Pricing", icon: "fa-calendar-star",
          desc: "Holiday surcharges, peak-season ranges, holiday lockouts, vacation auto-message.",
          badges: ["Live", "Client-facing"], d2dSection: "seasonal" },
        { id: "_discounts_soon", label: "Discounts & Coupons", icon: "fa-percent",
          desc: "Multi-dog discounts, promo codes, seasonal sales.",
          badges: ["Coming soon"], comingSoon: true },
      ],
    },
    {
      id: "compliance",
      label: "Clients, Dogs & Compliance",
      icon: "fa-shield-heart",
      accent: "shOrange",
      blurb: "Profile defaults, vaccines, waivers, behavior notes, and intake paperwork.",
      subsections: [
        { id: "vaccines", label: "Vaccine Requirements", icon: "fa-shield-virus",
          desc: "Which vaccines are required, grace periods, expiry warnings.",
          badges: ["Live", "Client-facing"] },
        { id: "waiver", label: "Waiver", icon: "fa-file-signature",
          desc: "Liability waiver content and acceptance settings.",
          badges: ["Live", "Client-facing"] },
        { id: "_d2d_compliance", label: "Compliance Rules", icon: "fa-syringe",
          desc: "Per-service vaccine matrix, block-on-expiry behavior, waiver re-sign frequency & scope.",
          badges: ["Live", "Admin-only"], d2dSection: "compliance" },
        { id: "commands", label: "Training Commands", icon: "fa-graduation-cap",
          desc: "Standard commands menu for trainers, behavior tags for report cards.",
          badges: ["Live", "Staff-only"] },
        { id: "_intake_link", label: "Intake Forms", icon: "fa-clipboard",
          desc: "Custom new-client intake questionnaires, daycare/boarding temperament forms, bite disclosures, and more. (Opens the Intake Forms screen.)",
          badges: ["Live", "Client-facing"], externalTab: "intake" },
        { id: "_incidents_link", label: "Incidents & Safety Flags", icon: "fa-triangle-exclamation",
          desc: "Severity tiers, full type taxonomy, manager/client review toggles, plus auto-suggested safety flags on every dog. (Opens the Incidents screen.)",
          badges: ["Live", "Admin-only"], externalTab: "incidents" },
      ],
    },
    {
      id: "comms",
      label: "Email & Notifications",
      icon: "fa-paper-plane",
      accent: "shGreen",
      blurb: "Every email path, template, schedule, and deliverability check.",
      subsections: [
        { id: "email_designer", label: "Email Designer", icon: "fa-envelope-open-text",
          desc: "Branding, signature, and per-template subject + body overrides for all 32 emails.",
          badges: ["Live", "Client-facing"] },
        { id: "automation", label: "Email Automation", icon: "fa-paper-plane",
          desc: "Which automations fire and when — controlled at the global automation level.",
          badges: ["Live", "Admin-only"] },
        { id: "_d2d_comms", label: "Email Timing & Quiet Hours", icon: "fa-clock",
          desc: "Reminder lead time, review-request delay, quiet hours, reply-to address, footer signature.",
          badges: ["Live", "Client-facing"], d2dSection: "comms" },
        { id: "_sms_soon", label: "Text Message Settings", icon: "fa-mobile-screen",
          desc: "SMS reminders for tomorrow's appointments (Twilio).",
          badges: ["Coming soon"], comingSoon: true },
        { id: "_marketing_emails_soon", label: "Marketing Emails", icon: "fa-bullhorn",
          desc: "Newsletter cadence, segmentation, broadcast composer.",
          badges: ["Coming soon"], comingSoon: true },
      ],
    },
    {
      id: "branding",
      label: "Marketing & Branding",
      icon: "fa-palette",
      accent: "shBlue",
      blurb: "Logo, brand colors, public copy, QR codes, and portal content.",
      subsections: [
        { id: "brand", label: "Brand & Theme", icon: "fa-palette",
          desc: "Logo, colors, fonts, splatter intensity, UI polish knobs.",
          badges: ["Live", "Client-facing"] },
        { id: "_d2d_ui", label: "Portal & UI Polish", icon: "fa-sparkles",
          desc: "Splatter intensity, primary CTA copy, PWA name/tagline, time/date format, week start, show prices/waitlist in portal.",
          badges: ["Live", "Client-facing"], d2dSection: "ui" },
        { id: "service_info", label: "Public Service Info", icon: "fa-circle-info",
          desc: "Public-facing service descriptions shown on the booking page and confirmations.",
          badges: ["Live", "Client-facing"] },
        { id: "tags", label: "Mood Tags", icon: "fa-tags",
          desc: "Daily mood / personality tags trainers can stick on report cards.",
          badges: ["Live", "Staff-only"] },
        { id: "portal_links", label: "Portal Links", icon: "fa-link",
          desc: "Outbound links shown to clients in the portal (Instagram, Google Reviews, etc).",
          badges: ["Optional", "Client-facing"] },
        { id: "portal_first_visit", label: "First Visit Card", icon: "fa-paw",
          desc: "Edit the 'What to expect on your first visit' card shown on every new client's portal. Add, remove, or reorder bullets.",
          badges: ["Live", "Client-facing"] },
        { id: "review_links", label: "Review Links", icon: "fa-star",
          desc: "Google, Facebook, and Yelp review URLs + your default review-request message template. Drives the 'Request review' button on every client/dog card.",
          badges: ["Live", "Client-facing"] },
        { id: "marketing_qr", label: "Marketing QR Codes", icon: "fa-qrcode",
          desc: "Generate branded QR codes for flyers, business cards, kennel posters.",
          badges: ["Optional", "Admin-only"] },
      ],
    },
    {
      id: "staff",
      label: "Staff & Admin",
      icon: "fa-users-gear",
      accent: "shBlue",
      blurb: "Team accounts, roles, permissions, schedule visibility.",
      subsections: [
        { id: "_staff_link", label: "Manage Staff", icon: "fa-users",
          desc: "Add, edit, and remove trainers, kennel-techs, and front-desk team. (Opens the Staff screen.)",
          badges: ["Live", "Admin-only"], externalTab: "staff" },
        { id: "_roles_link", label: "Roles & Permissions", icon: "fa-lock",
          desc: "Owner / Manager / Trainer / Daycare / Boarding / Front Desk / Read-only with a 13-key permission matrix. (Assign roles inside the Staff screen — the role panel sits at the top.)",
          badges: ["Live", "Admin-only"], externalTab: "staff" },
        { id: "permission_matrix", label: "Permission Matrix", icon: "fa-table-cells-large",
          desc: "Visual matrix of every role × permission. Toggle a checkbox to grant/revoke; saves go live on next request. Owner role is immutable (lockout protection).",
          badges: ["Live", "Admin-only"] },
        { id: "_payroll_soon", label: "Payroll Settings", icon: "fa-money-check",
          desc: "Hourly rates, overtime rules, pay-period boundaries.",
          badges: ["Coming soon"], comingSoon: true },
      ],
    },
    {
      id: "finance",
      label: "Finance & Bookkeeping",
      icon: "fa-chart-pie",
      accent: "shGreen",
      blurb: "Income reports, payment processors, refunds, and bookkeeping exports.",
      subsections: [
        { id: "_income_link", label: "Income Dashboard", icon: "fa-chart-line",
          desc: "Live P&L, weekly tallies, transaction log, and exports. (Opens the Income screen.)",
          badges: ["Live", "Admin-only"], externalTab: "income" },
        { id: "_d2d_finance", label: "Finance Defaults", icon: "fa-chart-pie",
          desc: "Fiscal year start, bookkeeping export format, mileage rate, 1099 threshold.",
          badges: ["Live", "Admin-only"], d2dSection: "finance" },
        { id: "payment_options", label: "Payment Options", icon: "fa-money-bill-wave",
          desc: "Venmo / PayPal / Clover / Cash / Check — toggle which payment methods to show clients in the portal and on booking confirmations. Manual Payment Tracking remains the source of truth.",
          badges: ["Live", "Client-facing"] },
        { id: "_processors_soon", label: "Payment Processors", icon: "fa-credit-card",
          desc: "Stripe / processor keys, webhook health, payout schedule.",
          badges: ["Coming soon"], comingSoon: true },
        { id: "_refunds_soon", label: "Refund Rules", icon: "fa-rotate-left",
          desc: "Refund windows, partial refund logic, reason codes.",
          badges: ["Coming soon"], comingSoon: true },
      ],
    },
    {
      id: "rewards",
      label: "Rewards & Referrals",
      icon: "fa-trophy",
      accent: "shOrange",
      blurb: "Trophies, streaks, loyalty tiers, referral rules, and badges.",
      subsections: [
        { id: "_rewards_center_link", label: "Rewards Center", icon: "fa-gift",
          desc: "Review real referral rewards, trivia perks, reward-credit grants, and client credit balances. (Opens the Rewards screen.)",
          badges: ["Live", "Admin-only"], externalTab: "rewards_center" },
        { id: "_trophies_link", label: "Trophy Wall", icon: "fa-trophy",
          desc: "Browse, award, and revoke trophies for dogs and clients. (Opens the Trophies screen.)",
          badges: ["Live", "Client-facing"], externalTab: "trophies" },
        { id: "_d2d_loyalty", label: "Loyalty Tiers, Streaks & Referral Rules", icon: "fa-medal",
          desc: "Configure loyalty tiers and referral rules. Actual pending rewards live in the Rewards Center.",
          badges: ["Live", "Client-facing"], d2dSection: "loyalty" },
        { id: "_streaks_soon", label: "Streak Auto-Awards", icon: "fa-fire",
          desc: "Auto-grant a trophy when a streak crosses N consecutive visits.",
          badges: ["Coming soon"], comingSoon: true },
      ],
    },
    {
      id: "system",
      label: "System & Data",
      icon: "fa-shield-halved",
      accent: "shBlue",
      blurb: "Account, backups, error logs, data export, and security.",
      subsections: [
        { id: "account", label: "My Account", icon: "fa-user-shield",
          desc: "Your signed-in admin profile and password.",
          badges: ["Live", "Admin-only"] },
        { id: "backup", label: "Backup & Restore", icon: "fa-database",
          desc: "Snapshot the database, restore from a backup, or download a copy.",
          badges: ["Live", "Admin-only"] },
        { id: "errors", label: "Server Errors", icon: "fa-triangle-exclamation",
          desc: "Recent server-side error log — useful for support.",
          badges: ["Live", "Admin-only"] },
        { id: "data_export", label: "Data Export", icon: "fa-cloud-arrow-down",
          desc: "On-demand CSV exports of clients, dogs, bookings, finances, intake submissions, comms, time-clock and more.",
          badges: ["Live", "Admin-only"] },
        { id: "_duplicate_check_link", label: "Duplicate Check", icon: "fa-copy",
          desc: "Safe preview-only scan for duplicate clients and dogs before credits, bookings, vaccines, or payments get split across accounts. (Opens Duplicate Check.)",
          badges: ["Live", "Preview only"], externalTab: "duplicate_check" },
        { id: "_audit_link", label: "Audit Log", icon: "fa-list-check",
          desc: "Searchable trail of every admin/staff write — who did what when, with redacted payload. (Opens the Audit Log screen.)",
          badges: ["Live", "Admin-only"], externalTab: "audit" },
      ],
    },
  ];
  const allSubs = CATEGORIES.flatMap(c => c.subsections.map(s => ({ ...s, _cat: c })));
  const findCategoryOf = (tabId) =>
    CATEGORIES.find(c => c.subsections.some(s => s.id === tabId))?.id || "ops";

  const [category, setCategory] = useState(() => findCategoryOf(tab));
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const openSub = (sub) => {
    if (sub.comingSoon) return;
    if (sub.externalTab) {
      window.dispatchEvent(new CustomEvent("sh:nav", { detail: sub.externalTab }));
      return;
    }
    // Sprint 110eh — sync the sidebar category whenever a sub is opened
    // (search jumps can target a sub in a different category).
    const catId = findCategoryOf(sub.id);
    if (catId) setCategory(catId);
    setTab(sub.id);
    setMobileNavOpen(false);
  };

  // Sprint 110ei — Listen for `sh:settings-jump` events fired by the
  // Operator Quick Controls hub. Lets a quick card deep-link to its
  // setting's true home (e.g. Money Rules → Services & Pricing).
  useEffect(() => {
    const onJump = (e) => {
      const { cat, sub } = e?.detail || {};
      if (cat) setCategory(cat);
      if (sub) {
        setTab(sub);
        setMobileNavOpen(false);
      }
    };
    window.addEventListener("sh:settings-jump", onJump);
    return () => window.removeEventListener("sh:settings-jump", onJump);
  }, []);

  const goCategoryOverview = (catId) => {
    setCategory(catId);
    // Reset tab to a sentinel value so the right column shows the overview.
    setTab(`__overview__${catId}`);
    setMobileNavOpen(false);
  };

  const isOverview = tab.startsWith("__overview__");
  const activeCategory = CATEGORIES.find(c => c.id === category) || CATEGORIES[0];
  const activeSub = !isOverview ? allSubs.find(s => s.id === tab) : null;

  // Search matches subsections by label + description (case-insensitive).
  const q = search.trim().toLowerCase();
  const searchHits = q.length >= 2
    ? allSubs.filter(s =>
        !s.comingSoon &&
        (s.label.toLowerCase().includes(q) || (s.desc || "").toLowerCase().includes(q)),
      )
    : [];

  if (!s) return <div className="text-gray-400 text-sm">Loading settings…</div>;

  return (
    <div className="animate-slide-in space-y-5" data-testid="settings-screen">
      <PageHero
        eyebrow={{ icon: "fa-sliders", text: "Configuration", color: "text-shBlue" }}
        title="Settings."
        highlight="Make it yours."
        subtitle="Hours, brand, services, automation, and everything in between."
        right={msg ? (<span className={`text-[12px] font-black uppercase tracking-widest px-3 py-2 rounded ${msg==="Saved"?"bg-shGreen/15 text-shGreen border border-shGreen/30":"bg-red-500/15 text-red-400 border border-red-500/30"}`}>{msg==="Saved"&&<i className="fas fa-check mr-1"/>}{msg}</span>) : null}
        testid="settings-hero"
      />

      {/* Search + breadcrumb row */}
      <div className="bg-bgPanel border border-bgHover rounded-xl p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
        <div className="flex items-center gap-2 text-[13px] font-black uppercase tracking-widest min-w-0 flex-wrap" data-testid="settings-breadcrumb">
          <button
            type="button"
            onClick={() => setMobileNavOpen(o => !o)}
            data-testid="settings-mobile-toggle"
            className="md:hidden bg-bgHover/60 border border-bgHover rounded px-3 py-1.5 text-shBlue"
            aria-label="Toggle settings nav"
          >
            <i className={`fas ${mobileNavOpen ? "fa-xmark" : "fa-bars"}`}/>
          </button>
          <i className="fas fa-sliders text-shBlue text-[11px]"/>
          <span className="text-gray-400">Settings</span>
          <i className="fas fa-chevron-right text-[9px] text-gray-600"/>
          <span className="text-white">{activeCategory.label}</span>
          {activeSub && (
            <>
              <i className="fas fa-chevron-right text-[9px] text-gray-600"/>
              <span className="text-shBlue">{activeSub.label}</span>
            </>
          )}
        </div>
        <div className="flex-1 md:max-w-md md:ml-auto relative">
          <i className="fas fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-[12px]"/>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search every setting…"
            data-testid="settings-search"
            className="w-full bg-bgBase border border-bgHover rounded-lg pl-9 pr-3 py-2 text-[14px] text-white focus:border-shBlue/60 outline-none"
          />
          {searchHits.length > 0 && (
            <div className="absolute z-30 top-full left-0 right-0 mt-1 bg-bgPanel border border-bgHover rounded-lg shadow-2xl max-h-80 overflow-y-auto" data-testid="settings-search-results">
              {searchHits.slice(0, 12).map(s => (
                <button
                  key={s.id}
                  onClick={() => { openSub(s); setSearch(""); }}
                  data-testid={`settings-search-hit-${s.id}`}
                  className="w-full text-left px-3 py-2 hover:bg-bgHover/60 border-b border-bgHover/30 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <i className={`fas ${s.icon} text-shBlue text-[12px] w-4`}/>
                    <span className="text-[14px] font-black uppercase tracking-widest text-white">{s.label}</span>
                    <span className="text-[11px] text-gray-500 normal-case tracking-normal ml-auto">{s._cat.label}</span>
                  </div>
                  <p className="text-[12px] text-gray-400 normal-case mt-0.5 ml-6">{s.desc}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6 relative">
        {/* Category sidebar */}
        <nav
          className={`${mobileNavOpen ? "block" : "hidden"} md:block md:w-64 md:shrink-0 space-y-1.5`}
          data-testid="settings-sidebar"
        >
          {CATEGORIES.map(cat => {
            const isActive = category === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => goCategoryOverview(cat.id)}
                data-testid={`settings-category-${cat.id}`}
                className={`w-full text-left rounded-xl px-3 py-2.5 transition border-l-4 ${
                  isActive
                    ? "bg-bgPanel border-shBlue shadow-md"
                    : "bg-bgPanel/40 border-transparent hover:bg-bgPanel/70 hover:border-shBlue/40"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <i className={`fas ${cat.icon} text-[14px] ${isActive ? "text-shGreen" : "text-shBlue/70"}`}/>
                  <span className={`text-[13px] font-black uppercase tracking-[0.18em] ${isActive ? "text-white" : "text-gray-300"}`}>{cat.label}</span>
                </div>
                <p className="text-[12px] text-gray-500 normal-case tracking-normal mt-1 ml-6 leading-snug">{cat.blurb}</p>
              </button>
            );
          })}
        </nav>

        {/* Main content */}
        <div className="flex-1 min-w-0 bg-bgPanel border border-bgHover rounded-xl p-4 md:p-6 shadow-2xl overflow-x-auto">
          {isOverview ? (
            <CategoryOverview category={activeCategory} onOpen={openSub} />
          ) : (
            <>
              {/* Inline back link to the parent category overview */}
              <button
                type="button"
                onClick={() => goCategoryOverview(category)}
                data-testid="settings-back-to-overview"
                className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:text-shGreen transition mb-4 inline-flex items-center gap-1"
              >
                <i className="fas fa-chevron-left"/> Back to {activeCategory.label}
              </button>
              {tab === "day_to_day" && <DayToDayPanel s={s} save={save} saving={saving} />}
              {tab.startsWith("_d2d_") && <DayToDayPanel s={s} save={save} saving={saving} section={tab.replace("_d2d_", "")} />}
              {tab === "hours" && <HoursPanel s={s} save={save} saving={saving} />}
              {tab === "brand" && <BrandPanel />}
              {tab === "feature_visibility" && <FeatureVisibilityPanel />}
              {tab === "client_portal_controls" && <ClientPortalControlsPanel />}
              {tab === "booking_flow_controls" && <BookingFlowControlsPanel />}
              {tab === "dashboard_widgets" && <DashboardWidgetsPanel />}
              {tab === "permission_matrix" && <PermissionMatrixPanel />}
              {tab === "payment_options" && <PaymentOptionsPanel />}
              {tab === "capacity" && <CapacityPanel s={s} save={save} saving={saving} />}
              {tab === "rules" && <RulesPanel s={s} save={save} saving={saving} />}
              {tab === "vaccines" && <VaccinesPanel s={s} save={save} saving={saving} />}
              {tab === "tags" && <TagsPanel s={s} save={save} saving={saving} />}
              {tab === "waiver" && <WaiverPanel s={s} save={save} saving={saving} />}
              {tab === "service_info" && <ServiceInfoPanel s={s} save={save} saving={saving} />}
              {tab === "portal_links" && <PortalLinksPanel s={s} save={save} saving={saving} />}
              {tab === "portal_first_visit" && <PortalFirstVisitPanel s={s} save={save} saving={saving} />}
              {tab === "review_links" && <ReviewLinksPanel />}
              {tab === "marketing_qr" && <MarketingQRPanel />}
              {tab === "services" && <ServicesSettings />}
              {tab === "credit_packs" && <CreditPacksSettings />}
              {tab === "commands" && <CommandsPanel />}
              {tab === "backup" && <BackupPanel />}
              {tab === "data_export" && <DataExportPanel />}
              {tab === "errors" && <ErrorsPanel />}
              {tab === "automation" && <AutomationPanel />}
              {tab === "email_designer" && <EmailDesignerPanel />}
              {tab === "payment_plans" && <PaymentPlanSettingsPanel />}
              {tab === "account" && (
                <div className="space-y-5 max-w-md" data-testid="account-panel">
                  <div>
                    <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Signed in as</p>
                    <p className="text-sm text-white font-black mt-1">{user.name} · {user.email}</p>
                  </div>
                  <div className="border-t border-bgHover pt-5 space-y-3">
                    <h4 className="text-xs font-black text-shBlue uppercase tracking-widest mb-2">Change Password</h4>
                    <Field label="Current Password" type="password" value={pw.current} onChange={(v)=>setPw({...pw,current:v})} testId="current-pw" />
                    <Field label="New Password" type="password" value={pw.next} onChange={(v)=>setPw({...pw,next:v})} testId="new-pw" />
                    <Field label="Confirm New Password" type="password" value={pw.confirm} onChange={(v)=>setPw({...pw,confirm:v})} testId="confirm-pw" />
                    {pwMsg && <div className={`text-[14px] font-black uppercase tracking-widest p-2 rounded ${pwMsg==="Password updated"?"bg-shGreen/15 text-shGreen":"bg-red-500/15 text-red-400"}`}>{pwMsg}</div>}
                    <button onClick={changePw} data-testid="save-password" className="bg-shBlue text-white px-6 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow">Update Password</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────── Category overview (card grid) ─────────────────
function CategoryOverview({ category, onOpen }) {
  return (
    <div className="space-y-5" data-testid={`category-overview-${category.id}`}>
      <div>
        <h2 className="text-2xl font-black text-white uppercase tracking-wider">{category.label}</h2>
        <p className="text-[14px] text-gray-400 mt-1 normal-case">{category.blurb}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {category.subsections.map(sub => (
          <SubsectionCard key={sub.id} sub={sub} onOpen={() => onOpen(sub)} />
        ))}
      </div>
    </div>
  );
}

function SubsectionCard({ sub, onOpen }) {
  const isComing = !!sub.comingSoon;
  return (
    <button
      onClick={onOpen}
      disabled={isComing}
      data-testid={`settings-card-${sub.id}`}
      className={`text-left rounded-xl border p-4 transition flex flex-col gap-2 ${
        isComing
          ? "bg-bgBase/30 border-bgHover/40 cursor-not-allowed opacity-60"
          : "bg-bgBase/50 border-bgHover hover:border-shBlue hover:bg-bgBase/80 hover:shadow-lg hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-[16px] shrink-0 ${
          isComing ? "bg-bgHover/40 text-gray-500" : "bg-shBlue/15 text-shBlue"
        }`}>
          <i className={`fas ${sub.icon}`}/>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`text-[15px] font-black uppercase tracking-widest ${isComing ? "text-gray-400" : "text-white"}`}>{sub.label}</h3>
            {(sub.badges || []).map(b => <Badge key={b} label={b} />)}
          </div>
          <p className="text-[13px] text-gray-400 mt-1 normal-case leading-snug">{sub.desc}</p>
          {sub.note && (
            <p className="text-[11px] text-shOrange mt-1.5 normal-case italic">
              <i className="fas fa-circle-info mr-1"/>{sub.note}
            </p>
          )}
        </div>
        {!isComing && (
          <i className="fas fa-chevron-right text-gray-500 self-center"/>
        )}
      </div>
    </button>
  );
}

function Badge({ label }) {
  const palette = {
    "Live":          "bg-shGreen/15  text-shGreen  border-shGreen/30",
    "Optional":      "bg-shBlue/15   text-shBlue   border-shBlue/30",
    "Client-facing": "bg-purple-500/15 text-purple-300 border-purple-500/30",
    "Staff-only":    "bg-shOrange/15 text-shOrange border-shOrange/30",
    "Admin-only":    "bg-red-500/15  text-red-400  border-red-500/30",
    "Coming soon":   "bg-bgHover/60  text-gray-400 border-bgHover",
  }[label] || "bg-bgHover/60 text-gray-400 border-bgHover";
  return (
    <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded border ${palette}`}>
      {label}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Sprint 110di-17 — Feature Visibility panel. Single source of truth for
// turning major app features on/off. The toggles read/write into
// settings.feature_visibility via the /api/settings endpoint. Frontend
// consumers (admin nav, portal, dashboard, booking wizard) gate render
// via the `useFeature(key)` hook in /lib/theme.js.
// ────────────────────────────────────────────────────────────────────────
const FEATURE_VISIBILITY_META = [
  // service features
  { id: "daycare",         label: "Daycare",         icon: "fa-sun",            color: "shGreen",
    desc: "Day boarding. Disable to hide from booking, portal credits, dashboard stats, and reports filter.",
    affects: ["Booking wizard", "Portal credits", "Dashboard stats", "Quick links", "Reports"] },
  { id: "boarding",        label: "Boarding",        icon: "fa-moon",           color: "shOrange",
    desc: "Overnight boarding. Disable to hide from booking, portal credits, kennel board, dashboard stats.",
    affects: ["Booking wizard", "Portal credits", "Kennel board", "Dashboard stats", "Reports"] },
  { id: "training",        label: "Training",        icon: "fa-graduation-cap", color: "purple-400",
    desc: "Training sessions. Disable to hide from booking, portal credits, homework, training programs.",
    affects: ["Booking wizard", "Portal credits", "Homework", "Programs", "Reports"] },
  { id: "grooming",        label: "Grooming",        icon: "fa-scissors",       color: "shBlue",
    desc: "Bath, nails, grooming services. Disable to hide from booking and dashboard stats.",
    affects: ["Booking wizard", "Dashboard stats", "Reports"] },
  { id: "photography",     label: "Photography",     icon: "fa-camera",         color: "shBlue",
    desc: "Photography sessions. Disable to hide from booking, portal CTA, and quick links.",
    affects: ["Booking wizard", "Portal", "Quick links", "Reports"] },
  // monetization features
  { id: "retail",          label: "Retail",          icon: "fa-shop",           color: "shGreen",
    desc: "Retail sales / point-of-sale. Disable to hide retail nav, sales buttons, and inventory.",
    affects: ["Admin nav", "Booking detail", "Reports"] },
  { id: "payment_plans",   label: "Payment Plans",   icon: "fa-file-invoice-dollar", color: "shOrange",
    desc: "Installment plans for boarding & big-ticket. Disable to hide plan-creation UI and admin shelf.",
    affects: ["Booking detail", "Admin nav", "Reports"] },
  { id: "manual_payments", label: "Manual Payments", icon: "fa-money-bills",    color: "shGreen",
    desc: "Cash, check, and other offline payment recording. Disable if you only accept card payments.",
    affects: ["Payments shelf", "Booking checkout"] },
  // engagement features
  { id: "rewards",         label: "Rewards / Trophies", icon: "fa-trophy",      color: "shOrange",
    desc: "Client-facing trophies, milestones, referrals. Disable to hide trophy nav and portal section.",
    affects: ["Admin nav", "Portal", "Quick links"] },
  { id: "trivia",          label: "Trivia",          icon: "fa-question",       color: "shBlue",
    desc: "Daily trivia mini-game on the client portal. Disable to hide the trivia widget.",
    affects: ["Portal", "Quick links"] },
  { id: "homework",        label: "Homework",        icon: "fa-book-open",      color: "purple-400",
    desc: "Training homework assignments + step tracking. Disable to hide homework nav and portal section.",
    affects: ["Admin nav", "Portal", "Quick links"] },
  // portals & comms
  { id: "staff_portal",    label: "Staff Portal",    icon: "fa-id-badge",       color: "shBlue",
    desc: "Employee clock-in, schedule, payroll surface. Disable to hide the staff portal entry point.",
    affects: ["Admin nav", "Login routing"] },
  { id: "client_messaging",label: "Client Messaging",icon: "fa-comments",       color: "shGreen",
    desc: "Two-way client/admin chat. Disable to hide Messages from portal and admin nav.",
    affects: ["Admin nav", "Portal", "Quick links"] },
  { id: "waitlist",        label: "Waitlist",        icon: "fa-hourglass-half", color: "shOrange",
    desc: "Auto-waitlist when a service is full. Disable to hide waitlist nav and CTAs.",
    affects: ["Booking wizard", "Admin nav", "Reports"] },
];

function FeatureVisibilityPanel() {
  const { reloadBranding } = useTheme();
  const [s, setS] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get("/settings").then(({ data }) => {
      const fv = data.feature_visibility || {};
      const initial = {};
      FEATURE_VISIBILITY_META.forEach(({ id }) => { initial[id] = fv[id] !== false; });
      setS(initial);
    });
  }, []);

  const toggle = (id) => {
    setS(prev => ({ ...prev, [id]: !prev[id] }));
    setDirty(true);
  };

  const saveAll = async () => {
    setSaving(true); setMsg("");
    try {
      await api.put("/settings", { feature_visibility: s });
      // Force theme provider to re-pull the public branding (which now
      // includes the updated `feature_visibility` block) so every consumer
      // screen sees the new state without a page reload.
      try { await reloadBranding(); } catch {}
      setDirty(false);
      setMsg("Saved. Refresh other tabs to pick up changes.");
      setTimeout(() => setMsg(""), 4500);
    } catch (e) {
      setMsg("Save failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () => {
    const all = {};
    FEATURE_VISIBILITY_META.forEach(({ id }) => { all[id] = true; });
    setS(all);
    setDirty(true);
  };

  if (!s) return <div className="text-gray-400">Loading...</div>;

  const enabledCount = Object.values(s).filter(v => v).length;
  const totalCount = FEATURE_VISIBILITY_META.length;

  return (
    <div className="space-y-4" data-testid="feature-visibility-panel">
      <div className="bg-bgPanel border-2 border-shBlue/40 rounded-2xl p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shBlue mb-1">
              <i className="fas fa-toggle-on mr-1.5"/>Feature Visibility
            </p>
            <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tight">
              App-Wide Feature <span className="text-shGreen">Switches.</span>
            </h2>
            <p className="text-[13px] text-gray-300 mt-2 max-w-2xl">
              Turn major app features on or off. Disabled features hide from the admin nav, client portal,
              dashboard, booking wizard, and reports filter. Historical data stays in the database — it just
              stops appearing in new flows.
            </p>
          </div>
          <span className="text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border bg-shGreen/15 text-shGreen border-shGreen/40"
                data-testid="feature-visibility-count">
            <i className="fas fa-circle-check mr-1.5"/>{enabledCount} / {totalCount} enabled
          </span>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={saveAll}
            disabled={!dirty || saving}
            data-testid="feature-visibility-save"
            className="bg-shGreen text-bgHeader font-black uppercase tracking-widest text-[12px] px-4 py-2 rounded disabled:opacity-50"
          >
            <i className={`fas ${saving ? "fa-spinner fa-spin" : "fa-save"} mr-2`}/>
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button
            onClick={resetAll}
            data-testid="feature-visibility-reset"
            className="bg-bgBase border border-bgHover text-gray-300 font-black uppercase tracking-widest text-[12px] px-4 py-2 rounded hover:border-shBlue"
          >
            <i className="fas fa-rotate-left mr-2"/>Enable all
          </button>
          {msg && (
            <span className="text-[12px] text-shGreen ml-2" data-testid="feature-visibility-msg">{msg}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {FEATURE_VISIBILITY_META.map((f) => {
          const enabled = s[f.id] !== false;
          return (
            <div
              key={f.id}
              data-testid={`feature-row-${f.id}`}
              className={`rounded-xl border p-4 transition ${enabled ? "bg-bgPanel border-bgHover" : "bg-bgPanel/60 border-bgHover/60 opacity-75"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <i className={`fas ${f.icon} text-${f.color}`}/>
                    <p className={`text-[15px] font-black uppercase italic tracking-tight ${enabled ? "text-white" : "text-gray-500"}`}>
                      {f.label}
                    </p>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                      enabled
                        ? "bg-shGreen/15 text-shGreen border-shGreen/40"
                        : "bg-gray-700/30 text-gray-400 border-gray-600/40"
                    }`}>
                      {enabled ? "On" : "Off"}
                    </span>
                  </div>
                  <p className="text-[12px] text-gray-400 mt-1 leading-snug">{f.desc}</p>
                  <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-widest">
                    Affects: <span className="text-gray-300">{f.affects.join(" · ")}</span>
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  data-testid={`feature-toggle-${f.id}`}
                  onClick={() => toggle(f.id)}
                  className={`relative shrink-0 w-12 h-7 rounded-full transition ${enabled ? "bg-shGreen" : "bg-gray-600"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`}/>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────
// Sprint 110di-18 — Client Portal Controls. One panel for ALL client-portal
// behavior: section visibility, announcement banner, custom labels,
// booking-locked message, and empty-state copy. Stored under
// settings.client_portal_controls — re-uses the existing /api/settings
// endpoint, no duplicate panel created.
// ────────────────────────────────────────────────────────────────────────
const CPC_SECTION_META = [
  { id: "credits",             label: "Credits",                    masterFeature: null,
    desc: "Daycare/training/boarding credit tiles." },
  { id: "prices",              label: "Service prices",             masterFeature: null,
    desc: "Show pricing in the portal services modal + booking wizard." },
  { id: "dog_facts",           label: "Dog Fact of the Day",        masterFeature: null,
    desc: "Daily fun-fact widget on the portal home." },
  { id: "trivia_rewards",      label: "Trivia & Rewards",           masterFeature: "rewards",
    desc: "Trivia widget + Trophy Wall. Hidden if Rewards or Trivia is OFF in Feature Visibility." },
  { id: "training_tip",        label: "Training Tip of the Day",    masterFeature: null,
    desc: "One daily training tip on the portal home. Tips tagged audience=staff are hidden from clients." },
  { id: "booking_history",     label: "Booking history",            masterFeature: null,
    desc: "Past completed/cancelled bookings list." },
  { id: "upcoming_bookings",   label: "Upcoming bookings",          masterFeature: null,
    desc: "Pending + approved bookings card." },
  { id: "profile_quick_links", label: "Profile quick links",        masterFeature: null,
    desc: "Quick-link tile grid (services, vaccines, recurring, etc.)." },
  { id: "waiver_documents",    label: "Waiver & documents",         masterFeature: null,
    desc: "Waiver section + uploaded files panel." },
  { id: "vaccines_compliance", label: "Vaccines / compliance",      masterFeature: null,
    desc: "Vaccine status pills + upload CTA." },
  { id: "messages",            label: "Client messages",            masterFeature: "client_messaging",
    desc: "Two-way chat button + modal. Hidden if Client Messaging is OFF in Feature Visibility." },
  { id: "help_button",         label: "Help / How-to button",       masterFeature: null,
    desc: "'How to Use' tutorial drawer link in the portal header." },
];

const CPC_ANNOUNCEMENT_STYLES = [
  { id: "info",    label: "Info",     color: "shBlue" },
  { id: "success", label: "Success",  color: "shGreen" },
  { id: "warning", label: "Warning",  color: "shOrange" },
  { id: "urgent",  label: "Urgent",   color: "red-500" },
];

function CpcSwitch({ on, onClick, testid, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={on}
            data-testid={testid} onClick={onClick} disabled={disabled}
            className={`relative shrink-0 w-12 h-7 rounded-full transition ${disabled ? "bg-gray-700 opacity-50" : on ? "bg-shGreen" : "bg-gray-600"}`}>
      <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`}/>
    </button>
  );
}

function ClientPortalControlsPanel() {
  const { reloadBranding } = useTheme();
  const [cpc, setCpc] = useState(null);
  const [fv, setFv] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get("/settings").then(({ data }) => {
      setCpc(data.client_portal_controls);
      setFv(data.feature_visibility || {});
    });
  }, []);

  if (!cpc) return <div className="text-gray-400">Loading...</div>;

  const setSection = (id, on) => {
    setCpc(p => ({ ...p, sections: { ...p.sections, [id]: on } }));
    setDirty(true);
  };
  const setLabel = (k, v) => {
    setCpc(p => ({ ...p, labels: { ...p.labels, [k]: v } }));
    setDirty(true);
  };
  const setEmpty = (k, v) => {
    setCpc(p => ({ ...p, empty_states: { ...p.empty_states, [k]: v } }));
    setDirty(true);
  };
  const setAnn = (k, v) => {
    setCpc(p => ({ ...p, announcement: { ...p.announcement, [k]: v } }));
    setDirty(true);
  };


  const saveAll = async () => {
    setSaving(true); setMsg("");
    try {
      await api.put("/settings", { client_portal_controls: cpc });
      try { await reloadBranding(); } catch {}
      setDirty(false);
      setMsg("Saved. Refresh the client portal to see changes.");
      setTimeout(() => setMsg(""), 5000);
    } catch (e) {
      setMsg("Save failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="client-portal-controls-panel">
      <div className="bg-bgPanel border-2 border-shGreen/40 rounded-2xl p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
              <i className="fas fa-mobile-screen-button mr-1.5"/>Client Portal Controls
            </p>
            <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tight">
              What clients <span className="text-shGreen">see &amp; do.</span>
            </h2>
            <p className="text-[13px] text-gray-300 mt-2 max-w-2xl leading-snug">
              Tune what the client portal shows and the wording on common buttons + empty states.
              The new smart overview automatically surfaces the most important action; Feature Visibility remains the master switch.
            </p>
          </div>
          <button onClick={saveAll} disabled={!dirty || saving} data-testid="cpc-save"
                  className="bg-shGreen text-bgHeader font-black uppercase tracking-widest text-[12px] px-4 py-2 rounded disabled:opacity-50">
            <i className={`fas ${saving ? "fa-spinner fa-spin" : "fa-save"} mr-2`}/>{saving ? "Saving..." : "Save changes"}
          </button>
        </div>
        {msg && <span className="text-[12px] text-shGreen" data-testid="cpc-msg">{msg}</span>}
      </div>

      {/* ── Sections ────────────────────────────────────────────────── */}
      <div className="bg-bgPanel border border-bgHover rounded-2xl p-5">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-3">
          <i className="fas fa-eye mr-1.5"/>Show / hide portal sections
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {CPC_SECTION_META.map(({ id, label, desc, masterFeature }) => {
            const on = cpc.sections?.[id] !== false;
            const masterOff = masterFeature && fv && fv[masterFeature] === false;
            return (
              <div key={id} data-testid={`cpc-section-row-${id}`}
                   className={`flex items-start gap-3 p-3 rounded-lg border ${on && !masterOff ? "border-bgHover bg-bgBase" : "border-bgHover bg-bgBase/40 opacity-70"}`}>
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-black uppercase tracking-wide ${on && !masterOff ? "text-white" : "text-gray-500"}`}>{label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{desc}</p>
                  {masterOff && (
                    <p className="text-[10px] text-shOrange mt-1 uppercase tracking-widest">
                      <i className="fas fa-lock mr-1"/>Disabled by Feature Visibility ({masterFeature})
                    </p>
                  )}
                </div>
                <CpcSwitch on={on && !masterOff} disabled={masterOff}
                        testid={`cpc-toggle-${id}`}
                        onClick={() => !masterOff && setSection(id, !on)} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Smart landing priority ─────────────────────────────────── */}
      <div className="bg-bgPanel border border-bgHover rounded-2xl p-5" data-testid="cpc-smart-priority-info">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-2">
          <i className="fas fa-wand-magic-sparkles mr-1.5"/>Smart landing priority
        </p>
        <p className="text-[12px] text-gray-300 leading-relaxed">
          The client portal now chooses one clear top action automatically: finish setup, read a new message, view a checked-in visit or report card, complete homework, review an upcoming booking, check low credits, or book the next visit. This keeps clients from having to understand or configure the portal themselves.
        </p>
      </div>

      {/* ── Announcement banner ──────────────────────────────────────── */}
      <div className="bg-bgPanel border border-bgHover rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue">
            <i className="fas fa-bullhorn mr-1.5"/>Portal announcement banner
          </p>
          <CpcSwitch on={cpc.announcement?.enabled === true} testid="cpc-announcement-toggle"
                  onClick={() => setAnn("enabled", !cpc.announcement?.enabled)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Title</label>
            <input value={cpc.announcement?.title || ""} onChange={e => setAnn("title", e.target.value)}
                   data-testid="cpc-announcement-title"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"
                   placeholder="e.g. Holiday hours" />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Style</label>
            <select value={cpc.announcement?.style || "info"} onChange={e => setAnn("style", e.target.value)}
                    data-testid="cpc-announcement-style"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white">
              {CPC_ANNOUNCEMENT_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Message</label>
            <textarea rows={3} value={cpc.announcement?.message || ""} onChange={e => setAnn("message", e.target.value)}
                      data-testid="cpc-announcement-message"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"
                      placeholder="One-line update for every client opening the portal."/>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Start date (optional)</label>
            <input type="date" value={cpc.announcement?.start_date || ""} onChange={e => setAnn("start_date", e.target.value)}
                   data-testid="cpc-announcement-start"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"/>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">End date (optional)</label>
            <input type="date" value={cpc.announcement?.end_date || ""} onChange={e => setAnn("end_date", e.target.value)}
                   data-testid="cpc-announcement-end"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"/>
          </div>
        </div>
      </div>

      {/* ── Labels ───────────────────────────────────────────────────── */}
      <div className="bg-bgPanel border border-bgHover rounded-2xl p-5">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-3">
          <i className="fas fa-font mr-1.5"/>Client-facing labels
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(cpc.labels || {}).map(([k, v]) => (
            <div key={k}>
              <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">{k.replace(/_/g, " ")}</label>
              <input value={v || ""} onChange={e => setLabel(k, e.target.value)}
                     data-testid={`cpc-label-${k}`}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"/>
            </div>
          ))}
        </div>
      </div>

      {/* ── Booking locked message + empty states ──────────────────── */}
      <div className="bg-bgPanel border border-bgHover rounded-2xl p-5 space-y-4">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange mb-1">
            <i className="fas fa-lock mr-1.5"/>Booking locked message
          </p>
          <p className="text-[11px] text-gray-500 mb-2">Shown when the client tries to book but Requirements to Book is incomplete.</p>
          <textarea rows={2} value={cpc.booking_locked_message || ""}
                    onChange={e => { setCpc(p => ({ ...p, booking_locked_message: e.target.value })); setDirty(true); }}
                    data-testid="cpc-booking-locked-message"
                    className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"/>
        </div>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shBlue mb-2">
            <i className="fas fa-circle-info mr-1.5"/>Empty-state copy
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(cpc.empty_states || {}).map(([k, v]) => (
              <div key={k}>
                <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">{k.replace(/_/g, " ")}</label>
                <input value={v || ""} onChange={e => setEmpty(k, e.target.value)}
                       data-testid={`cpc-empty-${k}`}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"/>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────
// Sprint 110di-19 — Booking Flow Controls + Dashboard Widget Controls.
// Both reuse the existing settings storage via PUT /api/settings — no new
// booking system, no duplicate panels. Per-service overrides layer on top
// of the existing global booking_rules/day_to_day.guardrails.
// ────────────────────────────────────────────────────────────────────────
const BFC_SERVICES = [
  { id: "daycare",     label: "Daycare",     master: "daycare",     color: "#8cc63f" },
  { id: "boarding",    label: "Boarding",    master: "boarding",    color: "#f97316" },
  { id: "training",    label: "Training",    master: "training",    color: "#a855f7" },
  { id: "grooming",    label: "Grooming",    master: "grooming",    color: "#06b6d4" },
  { id: "photography", label: "Photography", master: "photography", color: "#00a9e0" },
  { id: "other",       label: "Other",       master: null,           color: "#94a3b8" },
];

// Sprint 110di-29 — Payment Options panel. Five canonical methods
// (Venmo / PayPal / Clover / Cash / Check) each with an enabled toggle,
// editable display name, optional link, and instructions. Shown in the
// client portal so the operator can tell clients HOW to pay — payment
// is NEVER processed here and booking is NEVER blocked on payment.
// Manual Payment Tracking remains the source of truth.
function PaymentOptionsPanel() {
  const { reloadBranding } = useTheme();
  const [rows, setRows] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.get("/settings").then(({ data }) => {
      setRows(Array.isArray(data.payment_options) ? data.payment_options : []);
    });
  }, []);
  if (!rows) return <div className="text-gray-400">Loading...</div>;

  const update = (idx, patch) => {
    setRows(p => p.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const save = async () => {
    setSaving(true); setMsg("");
    try {
      await api.put("/settings", { payment_options: rows });
      try { await reloadBranding(); } catch {}
      setDirty(false); setMsg("Saved.");
      setTimeout(() => setMsg(""), 4000);
    } catch (e) { setMsg("Save failed: " + (e?.response?.data?.detail || e.message)); }
    finally { setSaving(false); }
  };

  const ICONS = {
    venmo:  "fa-mobile-screen", paypal: "fa-paypal", clover: "fa-credit-card",
    cash:   "fa-money-bill-wave", check:  "fa-money-check-dollar",
  };

  return (
    <div className="space-y-4" data-testid="payment-options-panel">
      <div className="bg-bgPanel border-2 border-shGreen/40 rounded-2xl p-5 shadow-2xl flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
            <i className="fas fa-money-bill-wave mr-1.5"/>Payment Options
          </p>
          <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tight">
            How clients <span className="text-shGreen">can pay.</span>
          </h2>
          <p className="text-[13px] text-gray-300 mt-2 max-w-2xl leading-snug">
            Toggle the methods you accept. Enabled methods show up in the client portal and on the
            booking-submitted screen. <span className="text-shOrange">Booking is never blocked on
            payment</span> — this is purely informational. Manual Payment Tracking stays the source
            of truth for what's been paid.
          </p>
        </div>
        <button onClick={save} disabled={!dirty || saving} data-testid="pay-options-save"
                className="bg-shGreen text-bgHeader font-black uppercase tracking-widest text-[12px] px-4 py-2 rounded disabled:opacity-50">
          <i className={`fas ${saving ? "fa-spinner fa-spin" : "fa-save"} mr-2`}/>{saving ? "Saving..." : "Save"}
        </button>
        {msg && <span className="text-[12px] text-shGreen w-full" data-testid="pay-options-msg">{msg}</span>}
      </div>

      {rows.map((row, idx) => (
        <div key={row.key || idx} className="bg-bgPanel border border-bgHover rounded-2xl p-4 space-y-3"
             data-testid={`pay-row-${row.key}`}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[15px] font-black uppercase italic tracking-tight text-white flex items-center gap-2">
              <i className={`fas ${ICONS[row.key] || "fa-money-bill"} text-shGreen`}/>
              <span>{row.label || (row.key || "").toString().toUpperCase()}</span>
            </p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={row.enabled === true}
                     onChange={e => update(idx, { enabled: e.target.checked })}
                     data-testid={`pay-toggle-${row.key}`} className="scale-125"/>
              <span className={`text-[12px] font-black uppercase tracking-widest ${row.enabled ? "text-shGreen" : "text-gray-500"}`}>
                {row.enabled ? "Enabled" : "Disabled"}
              </span>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Display name</label>
              <input value={row.label || ""} onChange={e => update(idx, { label: e.target.value })}
                     data-testid={`pay-label-${row.key}`}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"
                     placeholder={row.key}/>
            </div>
            <div>
              <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Link (optional)</label>
              <input value={row.link || ""} onChange={e => update(idx, { link: e.target.value })}
                     data-testid={`pay-link-${row.key}`}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"
                     placeholder={row.key === "venmo" ? "https://venmo.com/your-handle" : row.key === "paypal" ? "https://paypal.me/your-handle" : ""}/>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Instructions for the client</label>
            <textarea value={row.instructions || ""} onChange={e => update(idx, { instructions: e.target.value })}
                      data-testid={`pay-instructions-${row.key}`} rows={2}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"/>
          </div>
        </div>
      ))}
    </div>
  );
}


function BookingFlowControlsPanel() {
  const { reloadBranding } = useTheme();
  const [bfc, setBfc] = useState(null);
  const [fv, setFv] = useState({});
  const [catalogServices, setCatalogServices] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/settings"),
      api.get("/services", { params: { include_inactive: true } }).catch(() => ({ data: [] })),
    ]).then(([settingsRes, servicesRes]) => {
      setBfc(settingsRes.data.booking_flow_controls || { per_service: {}, per_catalog_service: {} });
      setFv(settingsRes.data.feature_visibility || {});
      setCatalogServices(Array.isArray(servicesRes.data) ? servicesRes.data : []);
    });
  }, []);
  if (!bfc) return <div className="text-gray-400">Loading...</div>;

  const setSvc = (svc, key, val) => {
    setBfc(p => ({ ...p, per_service: { ...p.per_service, [svc]: { ...(p.per_service?.[svc] || {}), [key]: val } } }));
    setDirty(true);
  };
  const setCatalogSvc = (serviceId, key, val) => {
    setBfc(p => ({
      ...p,
      per_catalog_service: {
        ...(p.per_catalog_service || {}),
        [serviceId]: { ...((p.per_catalog_service || {})[serviceId] || {}), [key]: val },
      },
    }));
    setDirty(true);
  };
  const unsetCatalogSvcKey = (serviceId, key) => {
    setBfc(p => {
      const all = { ...(p.per_catalog_service || {}) };
      const row = { ...(all[serviceId] || {}) };
      delete row[key];
      if (Object.keys(row).length === 0) delete all[serviceId];
      else all[serviceId] = row;
      return { ...p, per_catalog_service: all };
    });
    setDirty(true);
  };
  const resetCatalogSvc = (serviceId) => {
    setBfc(p => {
      const next = { ...(p.per_catalog_service || {}) };
      delete next[serviceId];
      return { ...p, per_catalog_service: next };
    });
    setDirty(true);
  };
  const setTop = (key, val) => { setBfc(p => ({ ...p, [key]: val })); setDirty(true); };
  const save = async () => {
    setSaving(true); setMsg("");
    try {
      await api.put("/settings", { booking_flow_controls: bfc });
      try { await reloadBranding(); } catch {}
      setDirty(false); setMsg("Saved.");
      setTimeout(() => setMsg(""), 4000);
    } catch (e) { setMsg("Save failed: " + (e?.response?.data?.detail || e.message)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4" data-testid="booking-flow-controls-panel">
      <div className="bg-bgPanel border-2 border-shBlue/40 rounded-2xl p-5 shadow-2xl flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shBlue mb-1">
            <i className="fas fa-calendar-check mr-1.5"/>Booking Flow Controls
          </p>
          <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tight">
            Per-Service <span className="text-shGreen">Rules.</span>
          </h2>
          <p className="text-[13px] text-gray-300 mt-2 max-w-2xl leading-snug">
            Set rules for each exact service clients can choose. Category defaults remain as a fallback for older bookings and any service without its own override. Admin-created bookings can still bypass client guardrails.
          </p>
        </div>
        <button onClick={save} disabled={!dirty || saving} data-testid="bfc-save"
                className="bg-shGreen text-bgHeader font-black uppercase tracking-widest text-[12px] px-4 py-2 rounded disabled:opacity-50">
          <i className={`fas ${saving ? "fa-spinner fa-spin" : "fa-save"} mr-2`}/>{saving ? "Saving..." : "Save"}
        </button>
        {msg && <span className="text-[12px] text-shGreen w-full" data-testid="bfc-msg">{msg}</span>}
      </div>

      <div className="bg-bgPanel border-2 border-shGreen/35 rounded-2xl p-4 space-y-4" data-testid="catalog-service-booking-rules">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">
            <i className="fas fa-paw mr-1.5"/>Rules for every offered service
          </p>
          <p className="text-[12px] text-gray-400 mt-1">
            Active base services appear here automatically. Add-ons such as baths and nail trims are excluded because they attach to another booking.
          </p>
        </div>

        {catalogServices.filter(s => s.active !== false && !s.is_addon).length === 0 && (
          <div className="bg-bgBase border border-bgHover rounded-xl p-4 text-[13px] text-gray-400">
            No active base services found. Add or activate services under Settings → Services & Programs.
          </div>
        )}

        {catalogServices
          .filter(s => s.active !== false && !s.is_addon)
          .sort((a, b) => String(a.service_type || "").localeCompare(String(b.service_type || "")) || String(a.name || "").localeCompare(String(b.name || "")))
          .map(service => {
            const exact = (bfc.per_catalog_service || {})[service.id] || {};
            const inherited = bfc.per_service?.[service.service_type] || {};
            const hasOverride = Object.keys(exact).length > 0;
            const effective = { ...inherited, ...exact };
            const masterOff = service.service_type !== "other" && fv?.[service.service_type] === false;
            return (
              <div key={service.id} className={`bg-bgBase border rounded-xl p-4 space-y-3 ${hasOverride ? "border-shGreen/45" : "border-bgHover"} ${masterOff ? "opacity-60" : ""}`}
                   data-testid={`bfc-catalog-${service.id}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg grid place-items-center shrink-0" style={{ backgroundColor: `${service.color || "#94a3b8"}22`, color: service.color || "#94a3b8" }}>
                      <i className={`fas ${service.icon || "fa-tag"}`}/>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[15px] text-white font-black uppercase italic tracking-tight truncate">{service.name}</p>
                      <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">
                        {service.service_type} · ${Number(service.base_price || 0).toFixed(2)} · {hasOverride ? "custom rules" : "using category defaults"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {masterOff && <span className="text-[10px] text-shOrange uppercase tracking-widest"><i className="fas fa-lock mr-1"/>Feature OFF</span>}
                    {hasOverride && (
                      <button type="button" onClick={() => resetCatalogSvc(service.id)}
                              className="text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-white border border-bgHover rounded px-2 py-1">
                        Use defaults
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <label className="flex items-start gap-2 bg-bgPanel border border-bgHover rounded-lg p-3 cursor-pointer">
                    <input type="checkbox" checked={effective.client_booking_enabled !== false}
                           onChange={e => setCatalogSvc(service.id, "client_booking_enabled", e.target.checked)}
                           disabled={masterOff} className="mt-1"/>
                    <span><span className="text-[12px] font-black uppercase tracking-widest text-white block">Client booking enabled</span><span className="text-[10px] text-gray-400">Show this exact service in the client booking picker.</span></span>
                  </label>
                  <label className="flex items-start gap-2 bg-bgPanel border border-bgHover rounded-lg p-3 cursor-pointer">
                    <input type="checkbox" checked={effective.require_approval === true}
                           onChange={e => { setCatalogSvc(service.id, "require_approval", e.target.checked); if (e.target.checked) setCatalogSvc(service.id, "instant_book", false); }}
                           disabled={masterOff} className="mt-1"/>
                    <span><span className="text-[12px] font-black uppercase tracking-widest text-white block">Require approval</span><span className="text-[10px] text-gray-400">Client request stays pending until staff approves it.</span></span>
                  </label>
                  <label className="flex items-start gap-2 bg-bgPanel border border-bgHover rounded-lg p-3 cursor-pointer">
                    <input type="checkbox" checked={effective.instant_book === true}
                           onChange={e => { setCatalogSvc(service.id, "instant_book", e.target.checked); if (e.target.checked) setCatalogSvc(service.id, "require_approval", false); }}
                           disabled={masterOff} className="mt-1"/>
                    <span><span className="text-[12px] font-black uppercase tracking-widest text-white block">Instant confirmation</span><span className="text-[10px] text-gray-400">Automatically approve valid client bookings.</span></span>
                  </label>
                  <label className="flex items-start gap-2 bg-bgPanel border border-bgHover rounded-lg p-3 cursor-pointer">
                    <input type="checkbox" checked={effective.same_day === true}
                           onChange={e => setCatalogSvc(service.id, "same_day", e.target.checked)}
                           disabled={masterOff} className="mt-1"/>
                    <span><span className="text-[12px] font-black uppercase tracking-widest text-white block">Same-day allowed</span><span className="text-[10px] text-gray-400">Allow clients to request this service for today.</span></span>
                  </label>
                  <div className="bg-bgPanel border border-bgHover rounded-lg p-3">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Minimum lead time (hours)</p>
                    <input type="number" min={0} value={exact.min_lead_hours ?? ""} placeholder={inherited.min_lead_hours != null ? `Default: ${inherited.min_lead_hours}` : "Use global default"}
                           onChange={e => e.target.value === "" ? unsetCatalogSvcKey(service.id, "min_lead_hours") : setCatalogSvc(service.id, "min_lead_hours", Number(e.target.value))}
                           disabled={masterOff} className="w-full mt-1 bg-bgBase border border-bgHover rounded px-2 py-1.5 text-[13px] text-white"/>
                  </div>
                  <div className="bg-bgPanel border border-bgHover rounded-lg p-3">
                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Maximum advance (days)</p>
                    <input type="number" min={0} value={exact.max_advance_days ?? ""} placeholder={inherited.max_advance_days != null ? `Default: ${inherited.max_advance_days}` : "Use global default"}
                           onChange={e => e.target.value === "" ? unsetCatalogSvcKey(service.id, "max_advance_days") : setCatalogSvc(service.id, "max_advance_days", Number(e.target.value))}
                           disabled={masterOff} className="w-full mt-1 bg-bgBase border border-bgHover rounded px-2 py-1.5 text-[13px] text-white"/>
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      <div className="pt-2">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-400">Category fallback rules</p>
        <p className="text-[11px] text-gray-500 mt-1">Used by older bookings and any service left on “Use defaults.”</p>
      </div>

      {BFC_SERVICES.map(svc => {
        const cur = bfc.per_service?.[svc.id] || {};
        const masterOff = !!svc.master && fv && fv[svc.master] === false;
        return (
          <div key={svc.id} data-testid={`bfc-svc-${svc.id}`}
               className={`bg-bgPanel border border-bgHover rounded-2xl p-4 ${masterOff ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-[15px] font-black uppercase italic tracking-tight" style={{ color: svc.color }}>{svc.label}</p>
              {masterOff && <span className="text-[10px] text-shOrange uppercase tracking-widest"><i className="fas fa-lock mr-1"/>Feature OFF</span>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { k: "require_approval", label: "Require approval", desc: "Admin must approve before client sees Confirmed." },
                { k: "instant_book",     label: "Instant book",     desc: "Auto-confirm on submit." },
                { k: "same_day",         label: "Same-day allowed", desc: "Client can book for today." },
              ].map(t => (
                <label key={t.k} className="flex items-start gap-2 bg-bgBase border border-bgHover rounded-lg p-3 cursor-pointer">
                  <input type="checkbox" checked={cur[t.k] === true} onChange={e => setSvc(svc.id, t.k, e.target.checked)}
                         disabled={masterOff}
                         data-testid={`bfc-${svc.id}-${t.k}`}
                         className="mt-1"/>
                  <span>
                    <span className="text-[13px] font-black uppercase tracking-widest text-white block">{t.label}</span>
                    <span className="text-[11px] text-gray-400">{t.desc}</span>
                  </span>
                </label>
              ))}
              <div className="bg-bgBase border border-bgHover rounded-lg p-3">
                <p className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Min lead (hours)</p>
                <input type="number" min={0} value={cur.min_lead_hours ?? ""} placeholder="—"
                       onChange={e => setSvc(svc.id, "min_lead_hours", e.target.value === "" ? null : Number(e.target.value))}
                       disabled={masterOff}
                       data-testid={`bfc-${svc.id}-min_lead_hours`}
                       className="w-full mt-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-[13px] text-white"/>
                <p className="text-[10px] text-gray-500 mt-1">Blank = use global</p>
              </div>
              <div className="bg-bgBase border border-bgHover rounded-lg p-3">
                <p className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Max advance (days)</p>
                <input type="number" min={0} value={cur.max_advance_days ?? ""} placeholder="—"
                       onChange={e => setSvc(svc.id, "max_advance_days", e.target.value === "" ? null : Number(e.target.value))}
                       disabled={masterOff}
                       data-testid={`bfc-${svc.id}-max_advance_days`}
                       className="w-full mt-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-[13px] text-white"/>
                <p className="text-[10px] text-gray-500 mt-1">Blank = use global</p>
              </div>
            </div>
          </div>
        );
      })}

      <div className="bg-bgPanel border border-bgHover rounded-2xl p-4 space-y-3">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange">
          <i className="fas fa-hourglass-half mr-1.5"/>Capacity behavior
        </p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={bfc.waitlist_on_capacity === true}
                 onChange={e => setTop("waitlist_on_capacity", e.target.checked)}
                 data-testid="bfc-waitlist-on-capacity" className="mt-1"/>
          <span>
            <span className="text-[13px] font-black uppercase tracking-widest text-white block">Auto-offer waitlist when full</span>
            <span className="text-[11px] text-gray-400">If Feature Visibility waitlist is off, this is ignored.</span>
          </span>
        </label>
        <div>
          <p className="text-[11px] text-gray-400 font-black uppercase tracking-widest">Capacity-reached message</p>
          <input value={bfc.capacity_reached_copy || ""} onChange={e => setTop("capacity_reached_copy", e.target.value)}
                 data-testid="bfc-capacity-copy"
                 className="w-full mt-1 bg-bgBase border border-bgHover rounded px-3 py-2 text-[13px] text-white"/>
        </div>
      </div>

      {/* Sprint 110di-26 — Price Estimate toggle. When enabled (default),
          clients see a live estimate in the booking wizard Step 3 just
          above the Confirm button. Uses the existing services catalog +
          the client's existing credit balance; does NOT auto-consume
          credits or process payment. */}
      <div className="bg-bgPanel border border-bgHover rounded-2xl p-4 space-y-3" data-testid="bfc-price-estimate-card">
        <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen">
          <i className="fas fa-receipt mr-1.5"/>Price estimates
        </p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={bfc.show_price_estimate !== false}
                 onChange={e => setTop("show_price_estimate", e.target.checked)}
                 data-testid="bfc-show-price-estimate" className="mt-1"/>
          <span>
            <span className="text-[13px] font-black uppercase tracking-widest text-white block">Show booking price estimates</span>
            <span className="text-[11px] text-gray-400">
              Shows a live estimate to the client in the booking wizard, before submit, using your existing
              service prices and the client's credit balance. Informational only — no payment is processed
              and credits are not consumed.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

const DASHBOARD_WIDGET_META = [
  { id: "hero_card",         label: "Hero card",            desc: "'Today at Sit Happens' hero panel." },
  { id: "today_tasks",       label: "Today's tasks",        desc: "Task readiness checklist for closing routine." },
  { id: "upcoming_bookings", label: "Upcoming bookings",    desc: "Next 7 days of approved bookings." },
  { id: "daycare_stats",     label: "Daycare stats",        desc: "Capacity / occupancy tile.", master: "daycare" },
  { id: "boarding_stats",    label: "Boarding stats",       desc: "Kennel availability tile.",  master: "boarding" },
  { id: "training_stats",    label: "Training stats",       desc: "Active programs tile.",      master: "training" },
  { id: "grooming_stats",    label: "Grooming stats",       desc: "Upcoming grooms tile.",      master: "grooming" },
  { id: "total_dogs",        label: "Total dogs",           desc: "Lifetime dog count tile." },
  { id: "dog_fact",          label: "Dog Fact of the Day",  desc: "Admin-view of the daily breed fact." },
  { id: "training_tip",      label: "Training Tip of the Day", desc: "One daily training tip on the admin dashboard. Same pool as the Training Hub." },
  { id: "trivia",            label: "Daily trivia",         desc: "Admin trivia card.", master: "trivia" },
  { id: "pnl",               label: "P&L summary",          desc: "Month-to-date revenue / expenses / net." },
  { id: "mileage",           label: "Mileage",              desc: "MTD logged miles + IRS rate." },
  { id: "owner_clock",       label: "Owner clock",          desc: "Owner's clock-in/out widget." },
  { id: "closing_routine",   label: "Closing routine",      desc: "End-of-day checklist." },
  { id: "quick_links",       label: "Quick links",          desc: "Tile grid (clients, dogs, bookings, etc.)." },
  { id: "register",          label: "Today's Register",     desc: "Dashboard cash register totals and quick actions." },
];

function DashboardWidgetsPanel() {
  const { reloadBranding } = useTheme();
  const [dw, setDw] = useState(null);
  const [fv, setFv] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    api.get("/settings").then(({ data }) => {
      setDw(data.dashboard_widgets || {});
      setFv(data.feature_visibility || {});
    });
  }, []);
  if (!dw) return <div className="text-gray-400">Loading...</div>;

  const toggle = (id) => { setDw(p => ({ ...p, [id]: !(p[id] !== false) })); setDirty(true); };
  const save = async () => {
    setSaving(true); setMsg("");
    try {
      await api.put("/settings", { dashboard_widgets: dw });
      try { await reloadBranding(); } catch {}
      setDirty(false); setMsg("Saved.");
      setTimeout(() => setMsg(""), 4000);
    } catch (e) { setMsg("Save failed: " + (e?.response?.data?.detail || e.message)); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4" data-testid="dashboard-widgets-panel">
      <div className="bg-bgPanel border-2 border-shGreen/40 rounded-2xl p-5 shadow-2xl flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
            <i className="fas fa-grip mr-1.5"/>Dashboard Widget Controls
          </p>
          <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tight">
            Slim Your <span className="text-shGreen">Dashboard.</span>
          </h2>
          <p className="text-[13px] text-gray-300 mt-2 max-w-2xl leading-snug">
            Hide widgets without touching the underlying data. Reports and APIs are unaffected.
          </p>
        </div>
        <button onClick={save} disabled={!dirty || saving} data-testid="dw-save"
                className="bg-shGreen text-bgHeader font-black uppercase tracking-widest text-[12px] px-4 py-2 rounded disabled:opacity-50">
          <i className={`fas ${saving ? "fa-spinner fa-spin" : "fa-save"} mr-2`}/>{saving ? "Saving..." : "Save"}
        </button>
        {msg && <span className="text-[12px] text-shGreen w-full" data-testid="dw-msg">{msg}</span>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {DASHBOARD_WIDGET_META.map(w => {
          const on = dw[w.id] !== false;
          const masterOff = w.master && fv && fv[w.master] === false;
          return (
            <div key={w.id} data-testid={`dw-row-${w.id}`}
                 className={`flex items-start gap-3 p-3 rounded-lg border ${on && !masterOff ? "bg-bgBase border-bgHover" : "bg-bgBase/40 border-bgHover/60 opacity-70"}`}>
              <div className="flex-1 min-w-0">
                <p className={`text-[14px] font-black uppercase tracking-wide ${on && !masterOff ? "text-white" : "text-gray-500"}`}>{w.label}</p>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{w.desc}</p>
                {masterOff && (
                  <p className="text-[10px] text-shOrange mt-1 uppercase tracking-widest">
                    <i className="fas fa-lock mr-1"/>Disabled by Feature Visibility ({w.master})
                  </p>
                )}
              </div>
              <CpcSwitch on={on && !masterOff} disabled={masterOff}
                         testid={`dw-toggle-${w.id}`}
                         onClick={() => !masterOff && toggle(w.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────────
// Sprint 110di-20 — Staff Permission Matrix UI. Reads /api/staff/roles and
// PUTs to /api/staff/roles/{role}/permissions. Reuses the existing
// PERMISSION_KEYS schema; does NOT invent new keys. Owner row is locked.
// ────────────────────────────────────────────────────────────────────────
const PERM_META = [
  // Friendly label, backend key (must already exist), tooltip description.
  { key: "settings",         label: "Manage Settings",     desc: "Access Settings, including this matrix. Required for admin-level recovery." },
  { key: "finance_reports",  label: "View Finance/Reports",desc: "P&L, revenue, payments, mileage, tax reports." },
  { key: "pricing",          label: "Manage Pricing",      desc: "Edit service rates, credit pack prices, and discounts." },
  { key: "clients_view",     label: "View Clients",        desc: "Read-only access to client list + profiles." },
  { key: "clients_edit",     label: "Edit Clients",        desc: "Create, edit, archive clients and credit packs." },
  { key: "dogs_view",        label: "View Dogs",           desc: "Read-only access to dog list + profiles." },
  { key: "dogs_edit",        label: "Edit Dogs",           desc: "Add dogs, edit vitals/vaccines, attach files." },
  { key: "incidents",        label: "Log Incidents",       desc: "Create and resolve incident reports." },
  { key: "care_complete",    label: "Check Dogs In/Out",   desc: "Care Board updates, feeding, meds, potty logs." },
  { key: "booking_edit",     label: "Edit Bookings",       desc: "Create, approve, edit, and cancel bookings." },
  { key: "payroll",          label: "Manage Staff/Payroll",desc: "View time clocks, run payroll, edit staff." },
  { key: "data_export",      label: "Export Data",         desc: "CSV / JSON exports for clients, dogs, finance." },
  { key: "delete_records",   label: "Delete Records",      desc: "Hard-delete clients, dogs, bookings (rarely used)." },
  { key: "messages",         label: "Send Messages",       desc: "Reply in client message threads, broadcast announcements." },
];

// Dependencies: granting the dependent permission auto-suggests enabling the base.
const PERM_DEPENDENCIES = {
  pricing:        ["finance_reports"],
  delete_records: ["clients_edit", "dogs_edit"],
  payroll:        ["clients_view"],
  clients_edit:   ["clients_view"],
  dogs_edit:      ["dogs_view"],
};

function PermissionMatrixPanel() {
  const [matrix, setMatrix] = useState(null);
  const [roles, setRoles] = useState([]);
  const [savingRole, setSavingRole] = useState(null);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState({}); // {roleId: bool}

  const reload = () => {
    api.get("/staff/roles").then(({ data }) => {
      setRoles(data.roles || []);
      setMatrix({ ...(data.matrix || {}) });
      setDirty({});
    }).catch(e => setMsg("Load failed: " + (e?.response?.data?.detail || e.message)));
  };
  useEffect(reload, []);

  if (!matrix) return <div className="text-gray-400">Loading permission matrix...</div>;

  const toggle = (role, key) => {
    if (role === "owner") return;
    const next = !(matrix[role]?.[key] === true);
    // Auto-enable dependencies when granting a dependent perm.
    const deps = PERM_DEPENDENCIES[key] || [];
    setMatrix(p => {
      const updated = { ...p, [role]: { ...(p[role] || {}), [key]: next } };
      if (next) {
        for (const d of deps) {
          if (updated[role][d] !== true) {
            updated[role][d] = true;
          }
        }
      }
      return updated;
    });
    setDirty(d => ({ ...d, [role]: true }));
  };

  const saveRole = async (role) => {
    if (role === "owner") return;
    setSavingRole(role); setMsg("");
    try {
      const perms = matrix[role] || {};
      // Safety: ensure at least one non-owner role still has `settings`.
      const stillHasSettingsSomewhere = roles.some(r => r === "owner" || (r === role ? perms.settings : matrix[r]?.settings));
      if (!stillHasSettingsSomewhere) {
        setMsg(`Refused — at least one non-owner role must keep "Manage Settings" so you can recover access.`);
        setSavingRole(null);
        return;
      }
      const { data } = await api.put(`/staff/roles/${role}/permissions`, { permissions: perms });
      setMatrix(p => ({ ...p, [role]: data.permissions }));
      setDirty(d => { const c = { ...d }; delete c[role]; return c; });
      setMsg(`Saved ${role}.`);
      setTimeout(() => setMsg(""), 4000);
    } catch (e) {
      setMsg(`Save failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="permission-matrix-panel">
      <div className="bg-bgPanel border-2 border-shBlue/40 rounded-2xl p-5 shadow-2xl">
        <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shBlue mb-1">
          <i className="fas fa-table-cells-large mr-1.5"/>Permission Matrix
        </p>
        <h2 className="text-2xl sm:text-3xl font-black text-white uppercase italic tracking-tight">
          Roles × <span className="text-shGreen">Permissions.</span>
        </h2>
        <p className="text-[13px] text-gray-300 mt-2 max-w-3xl leading-snug">
          Toggle a checkbox to grant or revoke a permission for that role. <b>Owner</b> is immutable so you can&apos;t accidentally lock yourself out. Granting a dependent permission auto-enables its base (e.g. Manage Pricing auto-enables View Finance/Reports). Click &ldquo;Save row&rdquo; to commit one role at a time.
        </p>
        {msg && <p className={`text-[12px] mt-3 ${msg.startsWith("Saved") ? "text-shGreen" : "text-shOrange"}`} data-testid="perm-matrix-msg">{msg}</p>}
      </div>

      <div className="bg-bgPanel border border-bgHover rounded-2xl p-4 overflow-x-auto">
        <table className="w-full text-[12px] min-w-[900px]" data-testid="perm-matrix-table">
          <thead>
            <tr className="border-b border-bgHover">
              <th className="text-left py-2 px-2 sticky left-0 bg-bgPanel z-10" style={{ minWidth: 200 }}>
                <span className="font-black uppercase tracking-widest text-gray-400">Permission</span>
              </th>
              {roles.map(r => (
                <th key={r} className="text-center py-2 px-2 font-black uppercase tracking-widest"
                    data-testid={`perm-col-${r}`}>
                  <span className={r === "owner" ? "text-shOrange" : "text-white"}>{r.replace(/_/g, " ")}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_META.map(p => (
              <tr key={p.key} className="border-b border-bgHover/40 hover:bg-bgBase/30">
                <td className="py-2 px-2 sticky left-0 bg-bgPanel z-10" title={p.desc}>
                  <p className="text-white font-black">{p.label}</p>
                  <p className="text-[10px] text-gray-500 leading-snug">{p.desc}</p>
                </td>
                {roles.map(r => {
                  const on = matrix[r]?.[p.key] === true;
                  const locked = r === "owner";
                  return (
                    <td key={r} className="text-center py-2 px-2">
                      <input type="checkbox" checked={on} disabled={locked}
                             onChange={() => toggle(r, p.key)}
                             data-testid={`perm-cell-${r}-${p.key}`}
                             className="w-5 h-5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"/>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="py-3 px-2 sticky left-0 bg-bgPanel z-10"></td>
              {roles.map(r => (
                <td key={r} className="text-center py-3 px-2">
                  {r === "owner" ? (
                    <span className="text-[10px] uppercase tracking-widest text-shOrange">Locked</span>
                  ) : (
                    <button
                      onClick={() => saveRole(r)}
                      disabled={!dirty[r] || savingRole === r}
                      data-testid={`perm-save-${r}`}
                      className="bg-shGreen text-bgHeader font-black uppercase tracking-widest text-[10px] px-3 py-1.5 rounded disabled:opacity-50"
                    >
                      {savingRole === r ? <i className="fas fa-spinner fa-spin"/> : "Save row"}
                    </button>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


function BrandPanel() {
  const ctx = useTheme();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // ────────────────────────────────────────────────────────────────────────
  // Sprint 110di-18/19/20 — Sub-panels (Client Portal Controls, Booking Flow
  // Controls, Dashboard Widget Controls, Permission Matrix) defined above.
  // ────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (ctx?.branding && !draft) setDraft({ ...ctx.branding });
  }, [ctx?.branding, draft]);

  if (!ctx || !draft) return <div className="text-gray-400 text-sm">Loading…</div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(ctx.branding);

  const onSave = async () => {
    setSaving(true); setMsg("");
    try {
      await ctx.saveBranding({
        brand_primary: draft.brand_primary,
        brand_accent: draft.brand_accent,
        brand_warning: draft.brand_warning,
        brand_font_family: draft.brand_font_family,
        brand_footer_text: draft.brand_footer_text,
        brand_footer_url: draft.brand_footer_url,
        grad_hero_color:    draft.grad_hero_color,
        grad_info_color:    draft.grad_info_color,
        grad_warning_color: draft.grad_warning_color,
        grad_danger_color:  draft.grad_danger_color,
        grad_success_color: draft.grad_success_color,
        // Sprint 110di-8 — expanded theme surfaces.
        theme_bg_base:               draft.theme_bg_base,
        theme_bg_panel:              draft.theme_bg_panel,
        theme_bg_header:             draft.theme_bg_header,
        theme_bg_hover:              draft.theme_bg_hover,
        theme_text_primary:          draft.theme_text_primary,
        theme_text_muted:            draft.theme_text_muted,
        theme_text_display:          draft.theme_text_display,
        theme_btn_primary_bg:        draft.theme_btn_primary_bg,
        theme_btn_primary_fg:        draft.theme_btn_primary_fg,
        theme_btn_secondary_border:  draft.theme_btn_secondary_border,
        theme_btn_secondary_fg:      draft.theme_btn_secondary_fg,
        theme_btn_danger_bg:         draft.theme_btn_danger_bg,
        theme_btn_danger_fg:         draft.theme_btn_danger_fg,
        theme_input_bg:              draft.theme_input_bg,
        theme_input_border:          draft.theme_input_border,
        theme_input_focus:           draft.theme_input_focus,
        theme_calendar_active:       draft.theme_calendar_active,
        theme_table_hover:           draft.theme_table_hover,
        theme_row_border:            draft.theme_row_border,
        // Sprint 110di-13 — Card chrome lives entirely under
        // `card_type_themes`. The Default Card type also drives the legacy
        // global card CSS vars (see theme.js), so there's a single source of
        // truth for normal panels and the 9 categorized variants.
        card_type_themes:            draft.card_type_themes,
      });
      setMsg("Saved");
      setTimeout(() => setMsg(""), 1800);
    } catch (e) {
      setMsg("Failed to save");
    }
    setSaving(false);
  };

  // Sprint 110di-8 — the canonical Sit Happens default palette. Reset button
  // copies these into the draft (admin still has to hit Save to commit).
  const SH_DEFAULTS = {
    brand_primary: "#8cc63f",
    brand_accent:  "#00a9e0",
    brand_warning: "#f26522",
    brand_font_family: "Inter",
    brand_footer_text: "Sit Happens",
    brand_footer_url: "",
    grad_hero_color:    "#8cc63f",
    grad_info_color:    "#00a9e0",
    grad_warning_color: "#f59e0b",
    grad_danger_color:  "#ef4444",
    grad_success_color: "#8cc63f",
    theme_bg_base:               "#060c2e",
    theme_bg_panel:              "#0c143e",
    theme_bg_header:             "#03061a",
    theme_bg_hover:              "#1a225a",
    theme_text_primary:          "#e2e8f0",
    theme_text_muted:            "#94a3b8",
    theme_text_display:          "#ffffff",
    theme_btn_primary_bg:        "#8cc63f",
    theme_btn_primary_fg:        "#03061a",
    theme_btn_secondary_border:  "#1a225a",
    theme_btn_secondary_fg:      "#e2e8f0",
    theme_btn_danger_bg:         "#ef4444",
    theme_btn_danger_fg:         "#ffffff",
    theme_input_bg:              "#060c2e",
    theme_input_border:          "#1a225a",
    theme_input_focus:           "#8cc63f",
    theme_calendar_active:       "#8cc63f",
    theme_table_hover:           "#1a225a",
    theme_row_border:            "#1a225a",
    // Sprint 110di-13 — Card chrome defaults live exclusively in the
    // `card_type_themes` object now. The Default Card type controls the
    // global panel border/glow/inset highlight app-wide.
    card_type_themes: SH_CARD_TYPE_DEFAULTS(),
  };

  const reset = () => setDraft({ ...SH_DEFAULTS });

  return (
    <div className="space-y-6" data-testid="brand-panel">
      <Section title="Brand Colors" subtitle="Applied everywhere — login screen, admin shell, and client portal. Changes save when you hit the Save button below.">
        <div className="grid sm:grid-cols-3 gap-4">
          <ColorField testid="brand-primary"  label="Primary" sub="buttons, accents, active nav" value={draft.brand_primary}  onChange={(v)=>setDraft({...draft, brand_primary: v})} />
          <ColorField testid="brand-accent"   label="Accent"  sub="highlights, links, info badges" value={draft.brand_accent}   onChange={(v)=>setDraft({...draft, brand_accent: v})} />
          <ColorField testid="brand-warning"  label="Warning" sub="alerts, expiring vaccines"    value={draft.brand_warning}  onChange={(v)=>setDraft({...draft, brand_warning: v})} />
        </div>
      </Section>

      <Section title="Font" subtitle="Switches the typeface used throughout the app.">
        <div className="flex flex-wrap gap-2" data-testid="brand-font-options">
          {FONT_OPTIONS.map(opt => {
            const active = draft.brand_font_family === opt.value;
            const styleFam = opt.value === "System" ? "system-ui" : opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`brand-font-${opt.value}`}
                onClick={()=>setDraft({...draft, brand_font_family: opt.value})}
                className={`px-4 py-3 rounded-lg border-2 transition text-left ${
                  active
                    ? "border-shGreen bg-shGreen/10"
                    : "border-bgHover bg-bgBase hover:border-shGreen/50"
                }`}
                style={{ fontFamily: styleFam }}
              >
                <div className="text-sm font-black text-white">{opt.label}</div>
                <div className="text-[14px] text-gray-400 mt-0.5">The quick brown fox</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Card Gradients" subtitle="Each card type in the app gets a tinted gradient. Pick the color for each — every matching card across admin + portal recolors instantly. Hover any swatch to see what kind of cards it controls.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <GradColorField testid="grad-hero"    label="Hero"    sub="credit balance, hero stats, onboarding banner" sample="card-hero"    value={draft.grad_hero_color}    onChange={(v)=>setDraft({...draft, grad_hero_color: v})} />
          <GradColorField testid="grad-info"    label="Info"    sub="dashboard tiles, tips, secondary info"          sample="card-info"    value={draft.grad_info_color}    onChange={(v)=>setDraft({...draft, grad_info_color: v})} />
          <GradColorField testid="grad-warning" label="Warning" sub="vaccine expiring, low credits, attention"       sample="card-warning" value={draft.grad_warning_color} onChange={(v)=>setDraft({...draft, grad_warning_color: v})} />
          <GradColorField testid="grad-danger"  label="Danger"  sub="vaccine missing, errors, overdue"               sample="card-danger"  value={draft.grad_danger_color}  onChange={(v)=>setDraft({...draft, grad_danger_color: v})} />
          <GradColorField testid="grad-success" label="Success" sub="report cards, approvals, trophies earned"       sample="card-success" value={draft.grad_success_color} onChange={(v)=>setDraft({...draft, grad_success_color: v})} />
        </div>
      </Section>

      <Section title="Footer Pill" subtitle="The small pill in the bottom-right corner of every page. Leave the URL blank to make it a non-clickable label.">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-bgBase border border-bgHover rounded-lg p-3">
            <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">Text</label>
            <p className="text-[13px] text-gray-500 mt-0.5">What the pill says</p>
            <input
              type="text"
              maxLength={28}
              value={draft.brand_footer_text || ""}
              onChange={(e)=>setDraft({...draft, brand_footer_text: e.target.value})}
              data-testid="brand-footer-text"
              placeholder="Sit Happens"
              className="w-full mt-2 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white"
            />
          </div>
          <div className="bg-bgBase border border-bgHover rounded-lg p-3">
            <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">Link URL</label>
            <p className="text-[13px] text-gray-500 mt-0.5">Opens in a new tab when clicked. Blank = no link.</p>
            <input
              type="url"
              value={draft.brand_footer_url || ""}
              onChange={(e)=>setDraft({...draft, brand_footer_url: e.target.value})}
              data-testid="brand-footer-url"
              placeholder="https://sithappens.app"
              className="w-full mt-2 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white font-mono"
            />
          </div>
        </div>
      </Section>

      {/* Sprint 110di-8 — Expanded theme surfaces. Five collapsible groups
          (Backgrounds, Text, Buttons, Forms, Calendar/Table) so the panel
          stays scannable. Each row is just a thin ColorField; defaults match
          the historical Sit Happens palette and can be wiped back by hitting
          the Reset button below. */}
      <ThemeGroup title="App Backgrounds" subtitle="Page, panel, header/sidebar, and hover/border surfaces." testid="theme-group-bg">
        <ColorField testid="theme-bg-base"   label="Base Background"        sub="page body"               value={draft.theme_bg_base}   onChange={(v)=>setDraft({...draft, theme_bg_base: v})} />
        <ColorField testid="theme-bg-panel"  label="Panel / Card Background" sub="cards, modals, sheets"   value={draft.theme_bg_panel}  onChange={(v)=>setDraft({...draft, theme_bg_panel: v})} />
        <ColorField testid="theme-bg-header" label="Header / Sidebar"        sub="top nav, side rail"      value={draft.theme_bg_header} onChange={(v)=>setDraft({...draft, theme_bg_header: v})} />
        <ColorField testid="theme-bg-hover"  label="Hover / Border"          sub="row hover + borders"     value={draft.theme_bg_hover}  onChange={(v)=>setDraft({...draft, theme_bg_hover: v})} />
      </ThemeGroup>

      <ThemeGroup title="Text" subtitle="Primary body text, muted/secondary text, and display headings." testid="theme-group-text">
        <ColorField testid="theme-text-primary" label="Primary Text" sub="body copy" value={draft.theme_text_primary} onChange={(v)=>setDraft({...draft, theme_text_primary: v})} />
        <ColorField testid="theme-text-muted"   label="Muted / Secondary"   sub="captions, hints" value={draft.theme_text_muted}   onChange={(v)=>setDraft({...draft, theme_text_muted: v})} />
        <ColorField testid="theme-text-display" label="Display / Heading"  sub="hero titles, h1/h2" value={draft.theme_text_display} onChange={(v)=>setDraft({...draft, theme_text_display: v})} />
      </ThemeGroup>

      <ThemeGroup title="Buttons" subtitle="Primary, secondary outline, and danger button colors." testid="theme-group-btn">
        <ColorField testid="theme-btn-primary-bg" label="Primary Button BG" sub="solid CTA button" value={draft.theme_btn_primary_bg} onChange={(v)=>setDraft({...draft, theme_btn_primary_bg: v})} />
        <ColorField testid="theme-btn-primary-fg" label="Primary Button Text" sub="label color"   value={draft.theme_btn_primary_fg} onChange={(v)=>setDraft({...draft, theme_btn_primary_fg: v})} />
        <ColorField testid="theme-btn-secondary-border" label="Secondary Border" sub="outline color" value={draft.theme_btn_secondary_border} onChange={(v)=>setDraft({...draft, theme_btn_secondary_border: v})} />
        <ColorField testid="theme-btn-secondary-fg"     label="Secondary Text"   sub="label color"   value={draft.theme_btn_secondary_fg}     onChange={(v)=>setDraft({...draft, theme_btn_secondary_fg: v})} />
        <ColorField testid="theme-btn-danger-bg" label="Danger Button BG" sub="delete/destructive" value={draft.theme_btn_danger_bg} onChange={(v)=>setDraft({...draft, theme_btn_danger_bg: v})} />
        <ColorField testid="theme-btn-danger-fg" label="Danger Button Text" sub="label color"     value={draft.theme_btn_danger_fg} onChange={(v)=>setDraft({...draft, theme_btn_danger_fg: v})} />
      </ThemeGroup>

      <ThemeGroup title="Forms" subtitle="Input fields and focus state." testid="theme-group-form">
        <ColorField testid="theme-input-bg"     label="Input BG"     sub="text field fill"  value={draft.theme_input_bg}     onChange={(v)=>setDraft({...draft, theme_input_bg: v})} />
        <ColorField testid="theme-input-border" label="Input Border" sub="resting border"   value={draft.theme_input_border} onChange={(v)=>setDraft({...draft, theme_input_border: v})} />
        <ColorField testid="theme-input-focus"  label="Focus Glow"   sub="active border + glow" value={draft.theme_input_focus}  onChange={(v)=>setDraft({...draft, theme_input_focus: v})} />
      </ThemeGroup>

      <ThemeGroup title="Calendar & Tables" subtitle="Calendar active day, table row hover, and row borders." testid="theme-group-grid">
        <ColorField testid="theme-calendar-active" label="Calendar Active" sub="today / selected day" value={draft.theme_calendar_active} onChange={(v)=>setDraft({...draft, theme_calendar_active: v})} />
        <ColorField testid="theme-table-hover"     label="Table Row Hover"  sub="hover highlight"      value={draft.theme_table_hover}     onChange={(v)=>setDraft({...draft, theme_table_hover: v})} />
        <ColorField testid="theme-row-border"      label="Row Border"       sub="dividers"             value={draft.theme_row_border}      onChange={(v)=>setDraft({...draft, theme_row_border: v})} />
      </ThemeGroup>

      <CardTypeThemesPanel draft={draft} setDraft={setDraft} />

      <Section title="Live Preview" subtitle="A quick taste of how things look with the choices above.">
        {/* Sprint 110di-8 — Expanded live preview surfaces (card / primary
            button / secondary button / input / warning pill / sidebar). Uses
            in-flight draft colors directly so admins can compare before Save. */}
        <div className="rounded-xl p-5 border space-y-4"
             data-testid="brand-live-preview"
             style={{
               borderColor: draft.theme_bg_hover,
               backgroundColor: draft.theme_bg_base,
               color: draft.theme_text_primary,
               fontFamily: draft.brand_font_family === "System" ? "system-ui" : draft.brand_font_family,
             }}>
          {/* Top row: pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_primary, color: "#0f172a" }}>Primary</span>
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_accent, color: "#fff" }}>Accent</span>
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_warning, color: "#fff" }}>Warning</span>
            <span className="px-3 py-1 rounded-full font-black text-[12px] uppercase tracking-widest border"
                  style={{ background: `${draft.theme_btn_danger_bg}22`, color: draft.theme_btn_danger_bg, borderColor: `${draft.theme_btn_danger_bg}55` }}>
              <i className="fas fa-triangle-exclamation mr-1"/>Danger Pill
            </span>
          </div>

          {/* Sidebar + card sample */}
          <div className="grid grid-cols-[120px_1fr] gap-3 rounded-lg overflow-hidden border"
               style={{ borderColor: draft.theme_bg_hover, background: draft.theme_bg_panel }}>
            <div className="p-3 space-y-2" style={{ background: draft.theme_bg_header }}>
              <p className="text-[10px] uppercase tracking-widest font-black" style={{ color: draft.theme_text_muted }}>Sidebar</p>
              <div className="px-2 py-1.5 rounded text-[12px] font-black uppercase tracking-widest"
                   style={{ background: draft.brand_primary, color: draft.theme_btn_primary_fg }}>Dashboard</div>
              <div className="px-2 py-1.5 rounded text-[12px] font-black uppercase tracking-widest"
                   style={{ color: draft.theme_text_muted }}>Schedule</div>
              <div className="px-2 py-1.5 rounded text-[12px] font-black uppercase tracking-widest"
                   style={{ color: draft.theme_text_muted }}>Clients</div>
            </div>
            <div className="p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-widest font-black" style={{ color: draft.theme_text_muted }}>Card</p>
              <h4 className="text-base font-black uppercase italic" style={{ color: draft.theme_text_display }}>Buddy is ready for pickup</h4>
              <p className="text-[13px]" style={{ color: draft.theme_text_primary }}>Crate training, leash manners, and a long walk today.</p>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" className="px-3 py-1.5 rounded font-black text-[12px] uppercase tracking-widest"
                        style={{ background: draft.theme_btn_primary_bg, color: draft.theme_btn_primary_fg }}>Primary Btn</button>
                <button type="button" className="px-3 py-1.5 rounded border font-black text-[12px] uppercase tracking-widest"
                        style={{ borderColor: draft.theme_btn_secondary_border, color: draft.theme_btn_secondary_fg, background: "transparent" }}>Secondary</button>
                <button type="button" className="px-3 py-1.5 rounded font-black text-[12px] uppercase tracking-widest"
                        style={{ background: draft.theme_btn_danger_bg, color: draft.theme_btn_danger_fg }}>Delete</button>
              </div>
              <div className="pt-2">
                <input readOnly value="Sample input"
                       className="w-full rounded px-2 py-1.5 text-sm"
                       style={{ background: draft.theme_input_bg, border: `1px solid ${draft.theme_input_border}`, color: draft.theme_text_primary }} />
              </div>
            </div>
          </div>

          {/* Calendar + table mini */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg p-3 border" style={{ background: draft.theme_bg_panel, borderColor: draft.theme_row_border }}>
              <p className="text-[10px] uppercase tracking-widest font-black mb-2" style={{ color: draft.theme_text_muted }}>Calendar (mini)</p>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                {["S","M","T","W","T","F","S"].map((d, i) => (
                  <div key={`hd${i}`} style={{ color: draft.theme_text_muted }}>{d}</div>
                ))}
                {Array.from({ length: 14 }).map((_, i) => {
                  const isActive = i === 5;
                  return (
                    <div key={i} className="rounded py-1"
                         style={{
                           background: isActive ? draft.theme_calendar_active : "transparent",
                           color: isActive ? draft.theme_btn_primary_fg : draft.theme_text_primary,
                           border: `1px solid ${draft.theme_row_border}`,
                         }}>{i + 1}</div>
                  );
                })}
              </div>
            </div>
            <div className="rounded-lg p-0 border overflow-hidden" style={{ background: draft.theme_bg_panel, borderColor: draft.theme_row_border }}>
              <p className="text-[10px] uppercase tracking-widest font-black px-3 pt-3" style={{ color: draft.theme_text_muted }}>Table rows</p>
              <div className="mt-2">
                {["Buddy", "Rocky", "Daisy"].map((name, i) => (
                  <div key={name}
                       className={`flex items-center justify-between px-3 py-2 text-sm border-t`}
                       style={{
                         borderTopColor: draft.theme_row_border,
                         background: i === 1 ? draft.theme_table_hover : "transparent",
                         color: draft.theme_text_primary,
                       }}>
                    <span className="font-black">{name}</span>
                    <span style={{ color: draft.theme_text_muted }}>{i === 1 ? "hover" : "row"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sprint 110di-13 — Cards & Panels preview reads from the
              `Default Card` type. One source of truth: tweak the Default
              tab below and this preview reflects it instantly. */}
          {(() => {
            const dflt = { ...SH_CARD_TYPE_DEFAULTS().default, ...((draft.card_type_themes || {}).default || {}) };
            const cbRgb = hexToRgbInline(dflt.border);
            const cgRgb = hexToRgbInline(dflt.glow);
            const ihRgb = hexToRgbInline(dflt.inner_highlight_color || "#FFFFFF");
            const opacity = Math.min(Math.max(parseFloat(dflt.border_opacity ?? 0.75), 0), 1);
            const width = Math.max(0, parseFloat(dflt.border_width ?? 2));
            const glowAlpha = Math.min(Math.max(parseFloat(dflt.glow_opacity ?? 0.25), 0), 1);
            const glowBlur = Math.max(0, parseFloat(dflt.glow_blur ?? 14));
            const innerAlpha = Math.min(Math.max(parseFloat(dflt.inner_highlight_opacity ?? 0.08), 0), 1);
            const liveBorder = `${width}px solid rgba(${cbRgb}, ${opacity})`;
            const liveShadow = `0 0 ${glowBlur}px rgba(${cgRgb}, ${glowAlpha}), inset 0 1px 0 rgba(${ihRgb}, ${innerAlpha})`;
            const cardStyle = {
              border: liveBorder,
              background: dflt.bg || draft.theme_bg_panel,
              boxShadow: liveShadow,
              color: draft.theme_text_primary,
            };
            const nestedStyle = {
              border: `${Math.max(width, 1)}px solid rgba(${cbRgb}, ${opacity * 0.85})`,
              background: draft.theme_bg_base,
              boxShadow: `0 0 ${glowBlur * 0.6}px rgba(${cgRgb}, ${glowAlpha * 0.7}), inset 0 1px 0 rgba(${ihRgb}, ${innerAlpha * 0.8})`,
            };
            return (
              <div className="space-y-3 mt-2" data-testid="brand-cards-preview">
                <p className="text-[10px] uppercase tracking-widest font-black" style={{ color: draft.theme_text_muted }}>Cards & Panels preview</p>

                {/* 3-way comparison: no border / subtle / current admin choice */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="brand-cards-comparison">
                  <div className="rounded-lg p-3" style={{ background: draft.theme_bg_panel, color: draft.theme_text_primary, border: "1px solid transparent" }}>
                    <p className="text-[10px] uppercase tracking-widest font-black mb-1" style={{ color: draft.theme_text_muted }}>No border</p>
                    <p className="text-[12px]">Blends right into the page.</p>
                  </div>
                  <div className="rounded-lg p-3" style={{
                    background: draft.theme_bg_panel,
                    color: draft.theme_text_primary,
                    border: `1px solid rgba(${cbRgb}, 0.45)`,
                    boxShadow: `0 0 8px rgba(${cgRgb}, 0.18), inset 0 1px 0 rgba(${ihRgb}, 0.05)`,
                  }}>
                    <p className="text-[10px] uppercase tracking-widest font-black mb-1" style={{ color: draft.theme_text_muted }}>Subtle</p>
                    <p className="text-[12px]">Visible but quiet.</p>
                  </div>
                  <div className="rounded-lg p-3" style={{
                    background: draft.theme_bg_panel,
                    color: draft.theme_text_primary,
                    border: liveBorder,
                    boxShadow: liveShadow,
                  }}>
                    <p className="text-[10px] uppercase tracking-widest font-black mb-1" style={{ color: draft.brand_primary }}>Your settings</p>
                    <p className="text-[12px]">Stronger neon edge.</p>
                  </div>
                </div>

                {/* Full sample card with your settings applied */}
                <div className="rounded-xl p-4" style={cardStyle}>
                  <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: draft.brand_primary }}>
                    <i className="fas fa-paw mr-1"/>Dashboard card
                  </p>
                  <h4 className="text-base font-black uppercase italic mt-1" style={{ color: draft.theme_text_display }}>Sample card with border + glow + inset highlight</h4>
                  <p className="text-[12px] mt-1" style={{ color: draft.theme_text_muted }}>This chrome gets applied app-wide to dashboard, portal, dog profile, booking, training, and settings cards.</p>
                  <div className="mt-3 rounded-lg p-3" style={nestedStyle}>
                    <p className="text-[10px] uppercase tracking-widest font-black" style={{ color: draft.brand_accent }}>Nested panel</p>
                    <p className="text-[12px] mt-1" style={{ color: draft.theme_text_primary }}>Used for sub-sections inside a card.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-widest"
                         style={{ ...nestedStyle, color: draft.brand_primary }}>
                      <i className="fas fa-bolt mr-1"/>Quick link
                    </div>
                    <div className="rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-widest"
                         style={{ ...nestedStyle, color: draft.brand_accent }}>
                      <i className="fas fa-bullhorn mr-1"/>Announcements
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <button type="button" className="px-3 py-1.5 rounded font-black text-[12px] uppercase tracking-widest"
                            style={{ background: draft.theme_btn_primary_bg, color: draft.theme_btn_primary_fg }}>Save</button>
                    <button type="button" className="px-3 py-1.5 rounded border font-black text-[12px] uppercase tracking-widest"
                            style={{ borderColor: draft.theme_btn_secondary_border, color: draft.theme_btn_secondary_fg, background: "transparent" }}>Cancel</button>
                    <button type="button" className="px-3 py-1.5 rounded font-black text-[12px] uppercase tracking-widest"
                            style={{ background: draft.theme_btn_danger_bg, color: draft.theme_btn_danger_fg }}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </Section>

      <div className="flex justify-between items-center pt-4 border-t border-bgHover">
        <button onClick={reset} data-testid="brand-reset" className="text-[14px] font-black uppercase tracking-widest text-gray-400 hover:text-white">
          <i className="fas fa-rotate-left mr-2"/>Reset to Sit Happens Defaults
        </button>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-[14px] font-black uppercase tracking-widest ${msg==="Saved"?"text-shGreen":"text-red-400"}`}>{msg}</span>}
          <button onClick={onSave} disabled={saving || !dirty} data-testid="brand-save"
                  className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-40">
            {saving ? "Saving…" : "Save Brand"}
          </button>
        </div>
      </div>
    </div>
  );
}


// Sprint 110di-12 — Card Type Themes. Canonical Sit Happens defaults; also
// used by the "Reset card themes" button and the export/import fallback.
// Sprint 110di-16 — Catalog extended to 23 surface types so every reusable
// card/panel/modal/table/form in the app inherits from one source.
function SH_CARD_TYPE_DEFAULTS() {
  const base = { border_opacity: 0.75, border_width: 2, glow_opacity: 0.25, glow_blur: 14, inner_highlight_color: "#FFFFFF", inner_highlight_opacity: 0.08, heading: "", text: "" };
  return {
    default:  { bg: "#05090D", border: "#008CFF", glow: "#008CFF", accent: "#008CFF", ...base },
    hero:     { bg: "#060c2e", border: "#9BCB00", glow: "#9BCB00", accent: "#9BCB00", ...base },
    stat:     { bg: "#05090D", border: "#1B4D7A", glow: "#008CFF", accent: "#9BCB00", ...base },
    info:     { bg: "#05090D", border: "#008CFF", glow: "#008CFF", accent: "#00C8FF", ...base },
    task:     { bg: "#0E0902", border: "#F26500", glow: "#F26500", accent: "#F26500", ...base },
    fact:     { bg: "#04111B", border: "#00C8FF", glow: "#00C8FF", accent: "#00C8FF", ...base },
    booking:  { bg: "#050B14", border: "#008CFF", glow: "#008CFF", accent: "#00C8FF", ...base },
    client:   { bg: "#080C16", border: "#9BCB00", glow: "#008CFF", accent: "#9BCB00", ...base },
    dog:      { bg: "#0A0F08", border: "#9BCB00", glow: "#9BCB00", accent: "#9BCB00", ...base },
    staff:    { bg: "#0A0814", border: "#A855F7", glow: "#A855F7", accent: "#A855F7", ...base },
    care:     { bg: "#04130B", border: "#9BCB00", glow: "#9BCB00", accent: "#9BCB00", ...base },
    kennel:   { bg: "#050B14", border: "#008CFF", glow: "#008CFF", accent: "#00C8FF", ...base },
    waitlist: { bg: "#120A02", border: "#F26500", glow: "#F26500", accent: "#F26500", ...base },
    intake:   { bg: "#05090D", border: "#008CFF", glow: "#008CFF", accent: "#00C8FF", ...base },
    waiver:   { bg: "#060c2e", border: "#1B4D7A", glow: "#008CFF", accent: "#9BCB00", ...base },
    finance:  { bg: "#09080D", border: "#F26500", glow: "#F26500", accent: "#9BCB00", ...base },
    report:   { bg: "#0A0E18", border: "#1B4D7A", glow: "#008CFF", accent: "#00C8FF", ...base },
    payment:  { bg: "#09080D", border: "#F26500", glow: "#F26500", accent: "#9BCB00", ...base },
    warning:  { bg: "#130B02", border: "#F26500", glow: "#F26500", accent: "#F26500", ...base },
    success:  { bg: "#071006", border: "#9BCB00", glow: "#9BCB00", accent: "#9BCB00", ...base },
    danger:   { bg: "#170407", border: "#FF3B5C", glow: "#FF3B5C", accent: "#FF3B5C", ...base },
    modal:    { bg: "#0c143e", border: "#008CFF", glow: "#008CFF", accent: "#008CFF", ...base },
    form:     { bg: "#05090D", border: "#1A225A", glow: "#008CFF", accent: "#9BCB00", ...base },
    table:    { bg: "#05090D", border: "#1A225A", glow: "#008CFF", accent: "#00C8FF", ...base },
    // legacy aliases — not surfaced in UI editor but kept so older saved
    // settings keep their custom colors and don't snap back to defaults.
    stats:    { bg: "#05090D", border: "#1B4D7A", glow: "#008CFF", accent: "#9BCB00", ...base },
    training: { bg: "#070914", border: "#A855F7", glow: "#A855F7", accent: "#A855F7", ...base },
    profile:  { bg: "#080C16", border: "#9BCB00", glow: "#008CFF", accent: "#9BCB00", ...base },
  };
}

const CARD_TYPE_META = [
  { id: "default",  label: "Default Card",      desc: "Every generic dark panel/card across the app." },
  { id: "hero",     label: "Hero Card",         desc: "Top-of-page feature cards (Today at Sit Happens, Welcome hero)." },
  { id: "stat",     label: "Stat Card",         desc: "Dashboard counts: daycare, boarding, totals." },
  { id: "info",     label: "Info Card",         desc: "Neutral notices, read-only callouts, helper text." },
  { id: "task",     label: "Task Card",         desc: "Operational readiness, to-do items, reminders." },
  { id: "fact",     label: "Fact Card",         desc: "Dog Fact of the Day, trivia answer, fun facts." },
  { id: "booking",  label: "Booking Card",      desc: "Bookings, schedule rows, appointment cards." },
  { id: "client",   label: "Client Card",       desc: "Client list rows + client profile summaries." },
  { id: "dog",      label: "Dog Card",          desc: "Dog list rows + dog profile summaries." },
  { id: "staff",    label: "Staff Card",        desc: "Employees, schedule, time clock entries." },
  { id: "care",     label: "Care Board",        desc: "Care Board rows (feeding, meds, potty)." },
  { id: "kennel",   label: "Kennel Board",      desc: "Kennel Board rows + assignments." },
  { id: "waitlist", label: "Waitlist",          desc: "Waitlist requests + queued bookings." },
  { id: "intake",   label: "Intake Forms",      desc: "Service intake forms (admin + client)." },
  { id: "waiver",   label: "Waiver",            desc: "Liability waiver + signatures." },
  { id: "finance",  label: "Finance",           desc: "P&L, expenses, tax payments, revenue summaries." },
  { id: "report",   label: "Reports",           desc: "Reports + analytics dashboards." },
  { id: "payment",  label: "Payment",           desc: "Invoices, transactions, credit packs." },
  { id: "warning",  label: "Warning",           desc: "Expiring soon, attention needed, alerts." },
  { id: "success",  label: "Success",           desc: "Complete, paid, approved, healthy, active." },
  { id: "danger",   label: "Danger / Urgent",   desc: "Overdue, missing vaccines, critical alerts." },
  { id: "modal",    label: "Modal",             desc: "Modal/drawer surfaces (booking wizard, profile editor)." },
  { id: "form",     label: "Form",              desc: "Form panels — inputs, textareas, dropdowns." },
  { id: "table",    label: "Table",             desc: "Table wrappers + sortable lists." },
];


function CardTypeThemesPanel({ draft, setDraft }) {
  // Sprint 110di-12 — Tabbed editor for the 10 card type themes. Tabs keep
  // the panel compact (~10 short blocks of 8 controls). Each edit writes to
  // `draft.card_type_themes.{id}`; persistence handled by parent onSave.
  const types = draft.card_type_themes || SH_CARD_TYPE_DEFAULTS();
  const [active, setActive] = useState("default");
  const [open, setOpen] = useState(false);
  const cur = { ...SH_CARD_TYPE_DEFAULTS()[active], ...(types[active] || {}) };

  const update = (patch) => {
    const next = { ...types, [active]: { ...cur, ...patch } };
    setDraft({ ...draft, card_type_themes: next });
  };
  const resetAll = () => setDraft({ ...draft, card_type_themes: SH_CARD_TYPE_DEFAULTS() });
  const resetCurrent = () => {
    const next = { ...types, [active]: { ...SH_CARD_TYPE_DEFAULTS()[active] } };
    setDraft({ ...draft, card_type_themes: next });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ card_type_themes: types }, null, 2)],
                         { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "sit-happens-card-themes.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (e) => {
    const f = (e.target.files || [])[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const obj = JSON.parse(txt);
      const next = obj.card_type_themes || obj;
      if (next && typeof next === "object") {
        setDraft({ ...draft, card_type_themes: { ...SH_CARD_TYPE_DEFAULTS(), ...next } });
      }
    } catch (err) {
      alert("That doesn't look like a Sit Happens card-themes JSON file.");
    }
    e.target.value = "";
  };

  return (
    <div className="rounded-lg border border-bgHover bg-bgBase/40" data-testid="theme-group-card-types">
      <button type="button" onClick={()=>setOpen(o=>!o)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              data-testid="theme-group-card-types-toggle">
        <div>
          <p className="text-[14px] font-black text-white uppercase tracking-widest">Card Type Themes</p>
          <p className="text-[12px] text-gray-500 mt-0.5">Control default card styling plus specific card types like stats, success, warning, danger, payment, training, booking, profile, and info.</p>
          <p className="text-[11px] text-shGreen mt-1"><i className="fas fa-info-circle mr-1"/>Default Card controls normal panels app-wide. Other card types only override the values they define — blank/zero fields fall back to Default Card.</p>
        </div>
        <i className={`fas ${open ? "fa-chevron-up" : "fa-chevron-down"} text-gray-400`}/>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1 mb-3" role="tablist">
            {CARD_TYPE_META.map(({ id, label }) => (
              <button key={id} type="button" onClick={()=>setActive(id)}
                      data-testid={`ct-tab-${id}`}
                      className={`text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded border transition ${active === id ? "bg-shGreen/15 border-shGreen text-shGreen" : "bg-bgBase border-bgHover text-gray-400 hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-gray-500 mb-3">{CARD_TYPE_META.find(c => c.id === active)?.desc}</p>

          {/* Color + sliders for the active type */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid={`ct-editor-${active}`}>
            <ColorField testid={`ct-${active}-bg`}     label="Background" sub="card fill"             value={cur.bg}     onChange={(v)=>update({ bg: v })} />
            <ColorField testid={`ct-${active}-border`} label="Border Color" sub="edge tint"           value={cur.border} onChange={(v)=>update({ border: v })} />
            <ColorField testid={`ct-${active}-glow`}   label="Glow Color"   sub="halo behind card"    value={cur.glow}   onChange={(v)=>update({ glow: v })} />
            <ColorField testid={`ct-${active}-accent`} label="Accent Color" sub="icons, labels, pills" value={cur.accent} onChange={(v)=>update({ accent: v })} />
            <SliderField testid={`ct-${active}-bo`} label="Border Opacity" sub="0 → 1" min={0} max={1}  step={0.05} value={cur.border_opacity} onChange={(v)=>update({ border_opacity: v })} />
            <SliderField testid={`ct-${active}-bw`} label="Border Width"   sub="px"    min={0} max={4}  step={1}    value={cur.border_width}   onChange={(v)=>update({ border_width: v })}   suffix="px"/>
            <SliderField testid={`ct-${active}-go`} label="Glow Opacity"   sub="0 → 1" min={0} max={1}  step={0.05} value={cur.glow_opacity}   onChange={(v)=>update({ glow_opacity: v })} />
            <SliderField testid={`ct-${active}-gb`} label="Glow Blur"      sub="px"    min={0} max={40} step={1}    value={cur.glow_blur}      onChange={(v)=>update({ glow_blur: v })}      suffix="px"/>
            <ColorField testid={`ct-${active}-heading`} label="Heading Color (optional)" sub="leave blank to inherit" value={cur.heading || ""} onChange={(v)=>update({ heading: v })} />
            <ColorField testid={`ct-${active}-text`}    label="Text Color (optional)"    sub="leave blank to inherit" value={cur.text || ""}    onChange={(v)=>update({ text: v })} />
          </div>

          {/* Preview grid: thumb buttons for each card type (clickable to switch) */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4" data-testid="ct-preview-grid">
            {CARD_TYPE_META.map(({ id, label }) => {
              const t = { ...SH_CARD_TYPE_DEFAULTS()[id], ...(types[id] || {}) };
              const bRgb = hexToRgbInline(t.border);
              const gRgb = hexToRgbInline(t.glow);
              const ba = clamp(t.border_opacity, 0, 1);
              const ga = clamp(t.glow_opacity,   0, 1);
              const isActive = id === active;
              return (
                <button key={id} type="button" onClick={()=>setActive(id)}
                        data-testid={`ct-preview-${id}`}
                        style={{
                          background: t.bg,
                          border: `${Math.max(1, t.border_width)}px solid rgba(${bRgb}, ${ba})`,
                          boxShadow: `0 0 ${t.glow_blur}px rgba(${gRgb}, ${ga}), inset 0 1px 0 rgba(255,255,255,0.06)`,
                          outline: isActive ? `1px dashed ${t.accent}` : "none",
                          outlineOffset: "2px",
                        }}
                        className="rounded-lg p-3 text-left transition">
                  <p className="text-[9px] font-black uppercase tracking-widest" style={{ color: t.accent }}>{label}</p>
                  <p className="text-[10px] text-gray-300 mt-1">Sample copy</p>
                </button>
              );
            })}
          </div>

          {/* Sprint 110di-16 — Full live-preview gallery. Shows realistic
              sample content for the most visible card types so admins can
              eyeball the overall app look without leaving Settings. All
              swatches read from the in-flight draft so edits apply live. */}
          <div className="mt-6 pt-5 border-t border-bgHover" data-testid="ct-sample-gallery">
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-3">
              <i className="fas fa-images mr-1.5"/>Live sample gallery
            </p>
            <p className="text-[12px] text-gray-400 mb-3">
              These render with the exact CSS variables your saved theme writes — what you see is what
              every matching card across the app gets.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { id: "hero",    icon: "fa-bolt",            title: "Welcome back, Alex!",  body: "3 of your favorite people are here today.",       chip: "Today" },
                { id: "stat",    icon: "fa-chart-simple",    title: "Daycare today",        body: "12 / 30 dogs · capacity 40%",                      chip: "Live" },
                { id: "info",    icon: "fa-circle-info",     title: "Heads up",             body: "Saturday daycare opens next month — same pricing.", chip: "Info" },
                { id: "task",    icon: "fa-list-check",      title: "Operational readiness", body: "8 of 9 setup steps complete.",                    chip: "1 left" },
                { id: "fact",    icon: "fa-paw",             title: "Dog fact of the day",  body: "Poodles came from Germany — 'Pudel' = 'to splash'.", chip: "Breed" },
                { id: "booking", icon: "fa-calendar-check",  title: "Daycare · Buddy",      body: "Tue, Feb 20 · 7:30am drop-off",                     chip: "Approved" },
                { id: "client",  icon: "fa-user",            title: "Alex Rivera",          body: "3 dogs · 5 credits · waiver signed",                chip: "Active" },
                { id: "dog",     icon: "fa-dog",             title: "Buddy — Lab",          body: "4 yo · vaccines current · loves the splash pool",    chip: "Healthy" },
                { id: "staff",   icon: "fa-id-badge",        title: "Trainer Jamie",        body: "Clocked in · 4h 12m · Care Board",                  chip: "On shift" },
                { id: "care",    icon: "fa-bowl-food",       title: "Care log · Buddy",     body: "Fed 8am · Meds 10am · Potty 11am",                  chip: "On track" },
                { id: "kennel",  icon: "fa-warehouse",       title: "Kennel 4",             body: "Rocky · Boarding · until Fri",                      chip: "Occupied" },
                { id: "waitlist",icon: "fa-hourglass-half",  title: "Waitlist · Daycare",   body: "Daisy · requested Thu Feb 22",                      chip: "Pending" },
                { id: "intake",  icon: "fa-clipboard-list",  title: "Boarding intake",      body: "12 questions · 4 minutes",                          chip: "Required" },
                { id: "waiver",  icon: "fa-file-signature",  title: "Liability waiver",     body: "Signed Jan 15, 2026 · v3",                          chip: "Signed" },
                { id: "finance", icon: "fa-dollar-sign",     title: "January revenue",      body: "$4,250 · expenses $1,180 · net $3,070",            chip: "P&L" },
                { id: "report",  icon: "fa-chart-line",      title: "Weekly report",        body: "Feb 10 → Feb 16 · 84 visits · 12 new",              chip: "Report" },
                { id: "payment", icon: "fa-credit-card",     title: "Daycare pack · 10",    body: "$200 · paid by card · Jan 8",                       chip: "Paid" },
                { id: "warning", icon: "fa-triangle-exclamation", title: "Vaccine expiring", body: "Buddy · rabies expires Mar 1",                    chip: "Soon" },
                { id: "success", icon: "fa-circle-check",    title: "Setup complete",       body: "You can now book daycare, boarding, training.",     chip: "Ready" },
                { id: "danger",  icon: "fa-circle-exclamation", title: "Overdue",           body: "Daisy · DHPP expired 12 days ago",                 chip: "Action" },
                { id: "modal",   icon: "fa-window-restore",  title: "Book a service",       body: "Step 1 of 3 · choose service type",                 chip: "Modal" },
                { id: "form",    icon: "fa-keyboard",        title: "Add a dog",            body: "Name · breed · age · vaccines",                     chip: "Form" },
                { id: "table",   icon: "fa-table",           title: "Today's bookings",     body: "12 rows · sort by time · filter by service",        chip: "Table" },
              ].map((sample) => {
                const t = { ...SH_CARD_TYPE_DEFAULTS()[sample.id], ...(types[sample.id] || {}) };
                const bRgb = hexToRgbInline(t.border);
                const gRgb = hexToRgbInline(t.glow);
                const ihRgb = hexToRgbInline(t.inner_highlight_color || "#FFFFFF");
                const ba = clamp(t.border_opacity, 0, 1);
                const ga = clamp(t.glow_opacity,   0, 1);
                const iha = clamp(t.inner_highlight_opacity, 0, 1);
                const cardStyle = {
                  background: t.bg,
                  border: `${Math.max(1, t.border_width)}px solid rgba(${bRgb}, ${ba})`,
                  boxShadow: `0 0 ${t.glow_blur}px rgba(${gRgb}, ${ga}), inset 0 1px 0 rgba(${ihRgb}, ${iha})`,
                  color: t.text || draft.theme_text_primary,
                };
                return (
                  <button
                    key={sample.id}
                    type="button"
                    onClick={() => setActive(sample.id)}
                    data-testid={`ct-sample-${sample.id}`}
                    className="text-left rounded-xl p-3 transition hover:scale-[1.01]"
                    style={cardStyle}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: t.accent }}>
                        <i className={`fas ${sample.icon} mr-1`}/>{sample.id}
                      </p>
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border"
                            style={{ color: t.accent, borderColor: `rgba(${bRgb}, ${Math.max(ba, 0.4)})`, background: `rgba(${bRgb}, 0.08)` }}>
                        {sample.chip}
                      </span>
                    </div>
                    <p className="text-[13px] font-black uppercase italic leading-tight"
                       style={{ color: t.heading || draft.theme_text_display || "#fff" }}>
                      {sample.title}
                    </p>
                    <p className="text-[11px] mt-1 leading-snug"
                       style={{ color: t.text || draft.theme_text_muted }}>
                      {sample.body}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex items-center justify-between flex-wrap gap-2 mt-4 pt-3 border-t border-bgHover">
            <div className="flex items-center gap-2">
              <button type="button" onClick={resetCurrent}
                      data-testid="ct-reset-current"
                      className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-white">
                <i className="fas fa-rotate-left mr-1"/>Reset this type
              </button>
              <button type="button"
                      onClick={()=>{ setActive("default"); const next = { ...types, default: { ...SH_CARD_TYPE_DEFAULTS().default } }; setDraft({ ...draft, card_type_themes: next }); }}
                      data-testid="ct-reset-default"
                      className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:underline">
                <i className="fas fa-rotate-left mr-1"/>Reset Default Card
              </button>
              <button type="button" onClick={resetAll}
                      data-testid="ct-reset-all"
                      className="text-[12px] font-black uppercase tracking-widest text-shOrange hover:underline">
                <i className="fas fa-rotate-left mr-1"/>Reset all types
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={exportJson}
                      data-testid="ct-export"
                      className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:underline">
                <i className="fas fa-arrow-down mr-1"/>Export JSON
              </button>
              <label className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:underline cursor-pointer">
                <i className="fas fa-arrow-up mr-1"/>Import JSON
                <input type="file" accept="application/json" onChange={importJson} className="hidden" data-testid="ct-import"/>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(v, lo, hi) { const n = parseFloat(v); return Number.isNaN(n) ? lo : Math.min(Math.max(n, lo), hi); }



function SliderField({ label, sub, value, onChange, min, max, step, suffix = "", testid }) {
  // Sprint 110di-10 — compact slider + numeric readout used for the new card
  // border opacity/width and glow strength controls.
  const v = value == null ? min : value;
  return (
    <div className="bg-bgBase border border-bgHover rounded-lg p-3" data-testid={testid}>
      <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">{label}</label>
      {sub && <p className="text-[13px] text-gray-500 mt-0.5 mb-2 leading-tight">{sub}</p>}
      <div className="flex items-center gap-3">
        <input type="range" min={min} max={max} step={step} value={v}
               onChange={(e)=>onChange(parseFloat(e.target.value))}
               data-testid={`${testid}-slider`}
               className="flex-1 accent-shGreen"/>
        <span className="text-[13px] font-black text-white font-mono w-14 text-right"
              data-testid={`${testid}-readout`}>
          {Number(v).toString()}{suffix}
        </span>
      </div>
    </div>
  );
}



function ThemeGroup({ title, subtitle, testid, children }) {
  // Sprint 110di-8 — collapsible color group used by the expanded Brand &
  // Theme panel. Keeps the panel scannable since the new theme controls add
  // ~17 color rows beyond the original 3. Starts collapsed so admins see
  // the existing controls first and open only the group they want to tweak.
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-bgHover bg-bgBase/40" data-testid={testid}>
      <button type="button" onClick={()=>setOpen(o=>!o)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              data-testid={`${testid}-toggle`}>
        <div>
          <p className="text-[14px] font-black text-white uppercase tracking-widest">{title}</p>
          {subtitle && <p className="text-[12px] text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <i className={`fas ${open ? "fa-chevron-up" : "fa-chevron-down"} text-gray-400`}/>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {children}
        </div>
      )}
    </div>
  );
}


function GradColorField({ label, sub, sample, value, onChange, testid }) {
  // Live mini-preview card that uses the actual gradient class — when the
  // admin drags the color, the swatch recolors in real time because the
  // class references CSS vars set by ThemeProvider on save.
  return (
    <div className="bg-bgBase border border-bgHover rounded-lg p-3" data-testid={testid}>
      <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">{label}</label>
      <p className="text-[13px] text-gray-500 mt-0.5 mb-2 leading-tight">{sub}</p>
      <div
        className={`${sample} rounded-lg h-12 flex items-center justify-center mb-2 text-[13px] font-black uppercase tracking-widest text-white/80`}
        style={{
          // Inline override so the preview reflects the in-flight draft color
          // before the admin hits Save (instead of waiting for theme vars to update).
          ["--grad-hero-rgb"]: hexToRgbInline(value),
          ["--grad-info-rgb"]: hexToRgbInline(value),
          ["--grad-warning-rgb"]: hexToRgbInline(value),
          ["--grad-danger-rgb"]: hexToRgbInline(value),
          ["--grad-success-rgb"]: hexToRgbInline(value),
        }}
      >
        Preview
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-picker`}
          className="w-12 h-9 rounded cursor-pointer bg-transparent border border-bgHover"
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-hex`}
          className="flex-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white font-mono"
        />
      </div>
    </div>
  );
}

function hexToRgbInline(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return "140, 198, 63";
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}


function ColorField({ label, sub, value, onChange, testid }) {
  return (
    <div className="bg-bgBase border border-bgHover rounded-lg p-3">
      <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">{label}</label>
      <p className="text-[13px] text-gray-500 mt-0.5">{sub}</p>
      <div className="flex items-center gap-2 mt-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-picker`}
          className="w-12 h-10 rounded cursor-pointer bg-transparent border border-bgHover"
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-hex`}
          placeholder="#8cc63f"
          className="flex-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white font-mono"
        />
      </div>
    </div>
  );
}



function Field({ label, value, onChange, type="text", testId }) {
  return (
    <div>
      <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">{label}</label>
      <input type={type} value={value} onChange={(e)=>onChange(e.target.value)} data-testid={testId}
             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
    </div>
  );
}

function HoursPanel({ s, save, saving }) {
  const [biz, setBiz] = useState(s.business_hours);
  const [svc, setSvc] = useState(s.service_hours);
  // ISO yyyy-mm-dd dates the facility is fully closed (holidays, vacations).
  // Client-side bookings on these dates are blocked at the API layer.
  const [closedDates, setClosedDates] = useState(s.closed_dates || []);
  const [newClosed, setNewClosed] = useState("");

  const setBizDay = (day, k, v) => setBiz({ ...biz, [day]: { ...biz[day], [k]: v } });
  const setSvcDay = (svcKey, day, k, v) => setSvc({ ...svc, [svcKey]: { ...svc[svcKey], [day]: { ...svc[svcKey][day], [k]: v } } });

  return (
    <div className="space-y-6" data-testid="hours-panel">
      <Section title="Business Hours" subtitle="Default operating hours for your facility.">
        {DAYS.map(d => (
          <DayRow key={d} day={d} val={biz[d]} onChange={(k,v)=>setBizDay(d,k,v)} testPrefix={`biz-${d}`} />
        ))}
      </Section>

      {["daycare","training","grooming","photography"].map(svcKey => (
        <Section key={svcKey} title={`${svcKey[0].toUpperCase()+svcKey.slice(1)} Hours`} subtitle={`Override hours just for ${svcKey}.`}>
          {DAYS.map(d => {
            const val = (svc[svcKey] && svc[svcKey][d]) || biz[d];
            return <DayRow key={d} day={d} val={val} onChange={(k,v)=>setSvcDay(svcKey,d,k,v)} testPrefix={`${svcKey}-${d}`} />;
          })}
        </Section>
      ))}

      <Section title="Boarding" subtitle="Boarding is treated as 24/7 by default. Capacity is enforced per night.">
        <div className="text-[14px] font-black text-shGreen uppercase tracking-widest bg-shGreen/10 rounded p-3">24/7 — overnight stays allowed</div>
      </Section>

      <Section title="Closed Days" subtitle="Holidays / vacations. Clients can't self-book on these dates; admin overrides still work.">
        <div className="space-y-2" data-testid="closed-dates-list">
          {closedDates.length === 0 && <p className="text-[14px] text-gray-500 italic normal-case">No closed days configured.</p>}
          {[...closedDates].sort().map((d) => (
            <div key={d} className="flex items-center gap-2 bg-bgBase rounded p-2" data-testid={`closed-date-${d}`}>
              <i className="fas fa-calendar-xmark text-shOrange text-xs"/>
              <span className="flex-1 text-sm font-black text-white">{new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
              <button onClick={()=>setClosedDates(closedDates.filter(x => x !== d))}
                      className="text-red-400 hover:text-red-300 px-2" aria-label="Remove">
                <i className="fas fa-trash text-xs"/>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input type="date" value={newClosed} onChange={(e)=>setNewClosed(e.target.value)}
                 data-testid="closed-date-input"
                 className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-sm text-white" style={{colorScheme:"dark"}}/>
          <button onClick={()=>{
                     if (!newClosed) return;
                     if (closedDates.includes(newClosed)) { setNewClosed(""); return; }
                     setClosedDates([...closedDates, newClosed]); setNewClosed("");
                   }}
                  data-testid="closed-date-add"
                  className="bg-shOrange text-bgHeader px-4 py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shOrange/80">
            + Add
          </button>
        </div>
      </Section>

      <SaveBar onSave={()=>save({ business_hours: biz, service_hours: svc, closed_dates: closedDates })} saving={saving} />
    </div>
  );
}

function DayRow({ day, val, onChange, testPrefix }) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 py-2 border-b border-bgHover/30">
      <div className="col-span-3 text-[15px] font-black uppercase tracking-widest text-gray-300">{day}</div>
      <div className="col-span-3">
        <input type="time" value={val.open||""} disabled={val.closed} onChange={(e)=>onChange("open", e.target.value)} data-testid={`${testPrefix}-open`}
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-xs text-white disabled:opacity-40" style={{colorScheme:"dark"}} />
      </div>
      <div className="col-span-3">
        <input type="time" value={val.close||""} disabled={val.closed} onChange={(e)=>onChange("close", e.target.value)} data-testid={`${testPrefix}-close`}
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-xs text-white disabled:opacity-40" style={{colorScheme:"dark"}} />
      </div>
      <label className="col-span-3 flex items-center gap-2 text-[14px] font-black uppercase tracking-widest text-gray-400 cursor-pointer">
        <input type="checkbox" checked={!!val.closed} onChange={(e)=>onChange("closed", e.target.checked)} data-testid={`${testPrefix}-closed`} className="accent-shOrange" />
        Closed
      </label>
    </div>
  );
}

function CapacityPanel({ s, save, saving }) {
  const [dcCap, setDcCap] = useState(s.daycare_capacity);
  const [bdCap, setBdCap] = useState(s.boarding_capacity);
  const [kennels, setKennels] = useState(s.kennels || []);
  const [newK, setNewK] = useState("");

  return (
    <div className="space-y-6" data-testid="capacity-panel">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Daycare Daily Capacity" type="number" value={dcCap} onChange={(v)=>setDcCap(parseInt(v)||0)} testId="daycare-cap" />
        <Field label="Boarding Nightly Capacity" type="number" value={bdCap} onChange={(v)=>setBdCap(parseInt(v)||0)} testId="boarding-cap" />
      </div>

      <Section title="Kennels / Rooms" subtitle="Named spaces for boarding assignment.">
        <div className="space-y-2">
          {kennels.map((k, i) => (
            <div key={i} className="flex items-center gap-2 bg-bgBase rounded p-2">
              <input value={k} onChange={(e)=>{const c=[...kennels]; c[i]=e.target.value; setKennels(c);}}
                     className="flex-1 bg-transparent text-sm text-white outline-none" data-testid={`kennel-${i}`} />
              <button onClick={()=>setKennels(kennels.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-300 px-2"><i className="fas fa-trash text-xs" /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <input value={newK} onChange={(e)=>setNewK(e.target.value)} placeholder="New kennel/room name"
                   className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-sm text-white" data-testid="new-kennel-input" />
            <button onClick={()=>{ if(newK.trim()){ setKennels([...kennels, newK.trim()]); setNewK(""); } }} data-testid="add-kennel"
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[14px] uppercase tracking-widest">+ Add</button>
          </div>
        </div>
      </Section>

      <SaveBar onSave={()=>save({ daycare_capacity: dcCap, boarding_capacity: bdCap, kennels })} saving={saving} />
    </div>
  );
}

function RulesPanel({ s, save, saving }) {
  const [r, setR] = useState(s.booking_rules || {});
  const set = (k, v) => setR({ ...r, [k]: v });
  // Sprint 110h — per-service multi-dog discount: daycare and boarding can be
  // configured separately. Falls back to the legacy flat fields as default.
  const SERVICES = [
    { key: "daycare",     label: "Daycare",     icon: "fa-paw",        defaultValue: 50 },
    { key: "boarding",    label: "Boarding",    icon: "fa-bed",        defaultValue: 50 },
    { key: "training",    label: "Training",    icon: "fa-graduation-cap", defaultValue: 10 },
    { key: "grooming",    label: "Grooming",    icon: "fa-scissors",   defaultValue: 10 },
    { key: "photography", label: "Photography", icon: "fa-camera",     defaultValue: 10 },
  ];
  const legacyMode  = s.multi_dog_discount_mode  || "percent";
  const legacyValue = s.multi_dog_discount_value ?? 50;
  const legacyLabel = s.multi_dog_discount_label || "Additional dog discount";
  const initialByService = {};
  for (const svc of SERVICES) {
    const existing = (s.multi_dog_discount_by_service || {})[svc.key];
    initialByService[svc.key] = existing ? {
      enabled: !!existing.enabled,
      mode: existing.mode || legacyMode,
      value: existing.value ?? svc.defaultValue,
      label: existing.label || `${svc.label} multi-dog discount`,
    } : {
      enabled: (svc.key === "daycare" || svc.key === "boarding") ? s.multi_dog_discount_enabled !== false : false,
      mode: legacyMode,
      value: (svc.key === "daycare" || svc.key === "boarding") ? legacyValue : svc.defaultValue,
      label: (svc.key === "daycare" || svc.key === "boarding") ? legacyLabel : `${svc.label} multi-dog discount`,
    };
  }
  const [mdEnabled, setMdEnabled] = useState(s.multi_dog_discount_enabled !== false);
  const [byService, setByService] = useState(initialByService);
  const setSvc = (svcKey, patch) => setByService((p) => ({ ...p, [svcKey]: { ...p[svcKey], ...patch } }));

  return (
    <div className="space-y-6" data-testid="rules-panel">
      <Section title="Booking Policy">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max advance booking (days)" type="number" value={r.max_advance_days||0} onChange={(v)=>set("max_advance_days", parseInt(v)||0)} testId="max-advance" />
          <Field label="Cancellation cutoff (hours)" type="number" value={r.cancellation_cutoff_hours||0} onChange={(v)=>set("cancellation_cutoff_hours", parseInt(v)||0)} testId="cancel-cutoff" />
        </div>
        <label className="flex items-center gap-3 mt-4 cursor-pointer">
          <input type="checkbox" checked={!!r.auto_approve} onChange={(e)=>set("auto_approve", e.target.checked)} data-testid="auto-approve" className="accent-shGreen w-4 h-4" />
          <span className="text-[15px] font-black uppercase tracking-widest text-gray-300">Auto-approve client bookings (skip pending step)</span>
        </label>
      </Section>

      <Section title="Credit Costs (per day / per night)">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Daycare" type="number" value={r.daycare_cost||0} onChange={(v)=>set("daycare_cost", parseInt(v)||0)} testId="cost-daycare" />
          <Field label="Boarding (per night)" type="number" value={r.boarding_cost_per_night||0} onChange={(v)=>set("boarding_cost_per_night", parseInt(v)||0)} testId="cost-boarding" />
          <Field label="Training" type="number" value={r.training_cost||0} onChange={(v)=>set("training_cost", parseInt(v)||0)} testId="cost-training" />
        </div>
      </Section>

      <Section title="Stay-duration pricing (auto-bill at check-out)"
               subtitle="Daycare can price from elapsed hours. Boarding bills overnight nights plus pickup-day care using the cutoff time you choose below.">
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <input type="checkbox" checked={r.stay_pricing_enabled !== false}
                 onChange={(e)=>set("stay_pricing_enabled", e.target.checked)}
                 data-testid="stay-pricing-enabled"
                 className="accent-shGreen w-4 h-4" />
          <span className="text-[15px] font-black uppercase tracking-widest text-gray-300">Auto-price stays at check-out (recommended)</span>
        </label>
        <div className={`grid grid-cols-1 sm:grid-cols-3 gap-4 ${r.stay_pricing_enabled !== false ? "" : "opacity-50 pointer-events-none"}`}>
          <Field label="Daycare half-day rate (% of full)"
                 type="number"
                 value={r.half_day_pct ?? 50}
                 onChange={(v)=>set("half_day_pct", Math.max(0, Math.min(100, parseInt(v)||0)))}
                 testId="stay-half-day-pct" />
          <Field label="Daycare: stays ≤ X hours = half day"
                 type="number"
                 value={r.daycare_half_day_max_hours ?? 5}
                 onChange={(v)=>set("daycare_half_day_max_hours", Math.max(0, parseFloat(v)||0))}
                 testId="stay-daycare-half-h" />
          <Field label="Boarding full-day pickup starts at"
                 type="time"
                 value={r.boarding_full_day_pickup_cutoff || "17:00"}
                 onChange={(v)=>set("boarding_full_day_pickup_cutoff", v || "17:00")}
                 testId="boarding-full-day-cutoff" />
        </div>
        <div className="mt-3 text-xs text-gray-400 leading-relaxed">
          <div><span className="text-shGreen font-black">Daycare:</span> total hours ≤ threshold → bill as half day, otherwise full day.</div>
          <div><span className="text-shBlue font-black">Boarding:</span> every overnight night is billed, then pickup before the selected cutoff adds a half day; pickup at or after the cutoff adds a full day. Additional dogs receive 50% off every night and the pickup day.</div>
          <div className="text-shOrange mt-1"><i className="fas fa-info-circle mr-1" />The admin can still override the auto-price by typing a manual amount in the check-out modal.</div>
        </div>
      </Section>

      <Section title="Multi-dog household discount" subtitle="Auto-applied at check-out for the 2nd-and-later dog from the same client on the same date. Each service has its OWN discount tier. Sit Happens default is 50% off the BASE service price for additional daycare/boarding dogs.">
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <input type="checkbox" checked={mdEnabled}
                 onChange={(e)=>setMdEnabled(e.target.checked)}
                 data-testid="multi-dog-enabled"
                 className="accent-shGreen w-4 h-4" />
          <span className="text-[15px] font-black uppercase tracking-widest text-gray-300">Enable multi-dog discount (master switch)</span>
        </label>
        <div className={`space-y-3 ${mdEnabled ? "" : "opacity-50 pointer-events-none"}`}>
          {SERVICES.map(svc => {
            const v = byService[svc.key] || {};
            return (
              <div key={svc.key} className="bg-bgBase rounded-lg p-3 border border-bgHover" data-testid={`multi-dog-svc-${svc.key}`}>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input type="checkbox" checked={!!v.enabled}
                         onChange={(e)=>setSvc(svc.key, { enabled: e.target.checked })}
                         data-testid={`multi-dog-${svc.key}-enabled`}
                         className="accent-shGreen w-4 h-4" />
                  <i className={`fas ${svc.icon} text-shBlue mr-1`}/>
                  <span className="text-[14px] font-black uppercase tracking-widest text-white">{svc.label}</span>
                </label>
                <div className={`grid grid-cols-3 gap-3 ${v.enabled ? "" : "opacity-60"}`}>
                  <div>
                    <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest block">Mode</label>
                    <select value={v.mode || "percent"}
                            onChange={(e)=>setSvc(svc.key, { mode: e.target.value })}
                            disabled={!v.enabled}
                            data-testid={`multi-dog-${svc.key}-mode`}
                            className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
                      <option value="percent">Percent (%)</option>
                      <option value="flat">Flat ($)</option>
                    </select>
                  </div>
                  <Field
                    label={v.mode === "flat" ? "Amount ($)" : "Amount (%)"}
                    type="number"
                    value={v.value ?? 0}
                    onChange={(val)=>setSvc(svc.key, { value: Math.max(0, parseFloat(val) || 0) })}
                    testId={`multi-dog-${svc.key}-value`} />
                  <Field label="Receipt label" value={v.label || ""}
                         onChange={(val)=>setSvc(svc.key, { label: val })}
                         testId={`multi-dog-${svc.key}-label`} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[12px] text-gray-500 mt-2 italic">
          <i className="fas fa-circle-info mr-1"/>
          Each service uses its own tier. Daycare and boarding default to 50% off additional dogs. Add-ons stay full price.
        </p>
      </Section>

      <SaveBar onSave={()=>save({
        booking_rules: r,
        multi_dog_discount_enabled: mdEnabled,
        multi_dog_discount_by_service: byService,
      })} saving={saving} />
    </div>
  );
}

// Sprint 110dm — Dedicated tab for the day-to-day operator controls so
// admins don't have to scroll past Booking Rules to reach them.
function DayToDayPanel({ s, save, saving, section }) {
  const [d2d, setD2d] = useState(s.day_to_day || {});
  // Sprint 110ei — When section is given, this card is just a slice of the
  // mega-panel (single-owner home for that group). When undefined, it's
  // the Operator Quick Controls hub which is purely read-only summaries +
  // deep-link CTAs, so the save bar should hide.
  const isQuickHub = !section;
  return (
    <div className="space-y-6" data-testid={section ? `day-to-day-section-${section}` : "operator-quick-controls-panel"}>
      {!isQuickHub && (
        <div className="bg-bgPanel/40 border border-bgHover rounded-lg p-4">
          <h3 className="text-[18px] font-black text-shGreen uppercase tracking-widest mb-1">
            {SECTION_TITLES[section] || "Settings"}
          </h3>
          <p className="text-[13px] text-gray-400 leading-relaxed">
            {SECTION_BLURBS[section] || ""}
          </p>
        </div>
      )}
      <DayToDayControls d2d={d2d} setD2d={setD2d} section={section} />
      {!isQuickHub && <SaveBar onSave={()=>save({ day_to_day: d2d })} saving={saving} />}
    </div>
  );
}

const SECTION_TITLES = {
  money:       "Money Rules",
  seasonal:    "Holiday & Peak-Season Pricing",
  guardrails:  "Booking Guardrails",
  comms:       "Email Timing & Quiet Hours",
  loyalty:     "Loyalty, Streaks & Referrals",
  compliance:  "Vaccine & Waiver Compliance",
  services:    "Service Operational Defaults",
  finance:     "Finance Defaults",
  ui:          "Portal & UI Polish",
};
const SECTION_BLURBS = {
  money:       "Tipping, late-pickup fees, deposits, three-tier cancellation fees, no-show penalties, expiry windows, rounding.",
  seasonal:    "Holiday surcharges, peak-season ranges, holiday lockouts, vacation auto-responder.",
  guardrails:  "Lead times, max bookings per client, kennel limits, same-day rules, check-in/out windows.",
  comms:       "Reminder lead time, review-request delay, quiet hours, reply-to address, footer signature.",
  loyalty:     "Bronze/Silver/Gold/Platinum visit thresholds, streak targets, trophy reward value, referral reward type & amount.",
  compliance:  "Per-service vaccine matrix, block-on-expiry behavior, waiver re-sign frequency & scope, doc upload requirements.",
  services:    "Training session length, graduation thresholds, photography SLA, grooming durations.",
  finance:     "Fiscal year start, bookkeeping export format, mileage rate, 1099 threshold.",
  ui:          "Splatter intensity, primary CTA copy, PWA name/tagline, time/date format, week start, portal toggles.",
};

function VaccinesPanel({ s, save, saving }) {
  const [req, setReq] = useState(s.required_vaccines || []);
  const [warn, setWarn] = useState(s.vaccine_warning_days || 30);
  const toggle = (k) => setReq(req.includes(k) ? req.filter(x=>x!==k) : [...req, k]);
  return (
    <div className="space-y-6" data-testid="vaccines-panel">
      <Section title="Required Vaccines" subtitle="Dogs missing any required vaccine cannot be booked.">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {VAX_OPTIONS.map(v => (
            <button key={v.key} onClick={()=>toggle(v.key)} data-testid={`vax-${v.key}`}
                    className={`py-3 px-4 rounded border text-[15px] font-black uppercase tracking-widest transition ${req.includes(v.key)?"bg-shGreen text-bgHeader border-shGreen":"bg-bgBase text-gray-400 border-bgHover hover:border-shGreen/50"}`}>
              {v.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Alert Threshold">
        <Field label="Days before expiry to flag as 'expiring soon'" type="number" value={warn} onChange={(v)=>setWarn(parseInt(v)||0)} testId="warn-days" />
      </Section>
      <SaveBar onSave={()=>save({ required_vaccines: req, vaccine_warning_days: warn })} saving={saving} />
    </div>
  );
}

// Palette of brand-friendly tag colors. Each entry has bg + border + text classes
// plus an inline hex so we can build a pill that matches the chosen color.
const TAG_COLORS = [
  { key: "green",  hex: "#8cc63f" },
  { key: "blue",   hex: "#00a9e0" },
  { key: "orange", hex: "#f26522" },
  { key: "purple", hex: "#a855f7" },
  { key: "pink",   hex: "#ec4899" },
  { key: "red",    hex: "#ef4444" },
  { key: "yellow", hex: "#facc15" },
  { key: "slate",  hex: "#94a3b8" },
];
const DEFAULT_TAG_COLOR = "#8cc63f";

function TagsPanel({ s, save, saving }) {
  // mood_tags can be legacy List[str] OR new List[{label, icon, color}]. Normalize.
  const toObj = (t) => (typeof t === "string"
    ? { label: t, icon: "", color: "" }
    : { label: t?.label || "", icon: t?.icon || "", color: t?.color || "" });
  const [tags, setTags] = useState(() => (s.mood_tags || []).map(toObj));
  const [newT, setNewT] = useState("");
  const [pickerOpen, setPickerOpen] = useState(-1); // index of tag whose icon picker is open
  return (
    <div className="space-y-4" data-testid="tags-panel">
      <Section title="Pup Report Card Mood Tags" subtitle="These appear as pill buttons on the report card modal. Pick an optional icon AND color for each one.">
        <div className="flex flex-wrap gap-2">
          {tags.map((t,i)=>{
            const color = t.color || DEFAULT_TAG_COLOR;
            return (
            <div key={i}
                 className="relative flex items-center gap-1.5 rounded-full pl-2 pr-1 py-1 border"
                 style={{ backgroundColor: `${color}26`, borderColor: `${color}66`, color }}>
              <button type="button" onClick={()=>setPickerOpen(pickerOpen === i ? -1 : i)}
                      data-testid={`tag-icon-toggle-${i}`}
                      className="w-7 h-7 rounded-full grid place-items-center bg-bgBase border hover:opacity-80"
                      style={{ borderColor: `${color}55`, color }}>
                <i className={`fas ${t.icon || "fa-plus"} text-xs`}/>
              </button>
              <input value={t.label} onChange={(e)=>{const c=[...tags]; c[i]={...c[i], label:e.target.value}; setTags(c);}}
                     className="bg-transparent text-[15px] font-black uppercase tracking-widest outline-none w-32"
                     style={{ color }}
                     data-testid={`tag-${i}`} />
              {/* Inline color swatch row */}
              <div className="flex items-center gap-0.5 px-1" data-testid={`tag-color-row-${i}`}>
                {TAG_COLORS.map(c => (
                  <button key={c.key} type="button"
                          onClick={()=>{const arr=[...tags]; arr[i]={...arr[i], color:c.hex}; setTags(arr);}}
                          title={c.key}
                          data-testid={`tag-${i}-color-${c.key}`}
                          className={`w-4 h-4 rounded-full border ${color === c.hex ? "ring-2 ring-white/70 ring-offset-1 ring-offset-bgPanel" : "border-white/20"}`}
                          style={{ backgroundColor: c.hex }}/>
                ))}
              </div>
              <button onClick={()=>{setTags(tags.filter((_,j)=>j!==i)); setPickerOpen(-1);}}
                      className="hover:text-red-400 px-1"
                      style={{ color: `${color}b3` }}>×</button>
              {pickerOpen === i && (
                <div className="absolute z-30 top-full left-0 mt-1 w-72">
                  <IconPicker value={t.icon}
                              autoOpen={true}
                              onChange={(v)=>{const c=[...tags]; c[i]={...c[i], icon:v}; setTags(c); setPickerOpen(-1);}}
                              testid={`tag-${i}-icon-picker`}/>
                </div>
              )}
            </div>
            );
          })}
        </div>
        <div className="flex gap-2 mt-4">
          <input value={newT} onChange={(e)=>setNewT(e.target.value)} placeholder="Add a tag (e.g. Loves the Hose)"
                 className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-sm text-white" data-testid="new-tag-input" />
          <button onClick={()=>{ if(newT.trim()){ setTags([...tags, { label: newT.trim(), icon: "", color: "" }]); setNewT(""); } }} data-testid="add-tag"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[14px] uppercase tracking-widest">+ Add Tag</button>
        </div>
      </Section>
      <SaveBar onSave={()=>save({ mood_tags: tags.filter(t=>t.label.trim()).map(t=>({ label: t.label.trim(), icon: t.icon || "", color: t.color || "" })) })} saving={saving} />
    </div>
  );
}

function WaiverPanel({ s, save, saving }) {
  const [text, setText] = useState(s.waiver_text || "");
  const [required, setRequired] = useState(s.waiver_required_for_booking !== false);
  const [version, setVersion] = useState(s.waiver_version || 1);
  const [signatures, setSignatures] = useState([]);
  const [showSigs, setShowSigs] = useState(false);

  useEffect(() => {
    api.get("/waivers").then(r => setSignatures(r.data)).catch(() => {});
  }, []);

  const saveAndMaybeBump = (bump) => {
    const nextVersion = bump ? (version + 1) : version;
    save({ waiver_text: text, waiver_required_for_booking: required, waiver_version: nextVersion });
    if (bump) setVersion(nextVersion);
  };

  return (
    <div className="space-y-6" data-testid="waiver-panel">
      <Section title="Waiver Text" subtitle="Markdown bold (**Heading**) becomes a green section heading in the portal.">
        <textarea value={text} onChange={(e)=>setText(e.target.value)} rows={14} data-testid="waiver-text-edit"
                  className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-xs font-mono focus:border-shBlue outline-none" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={required} onChange={(e)=>setRequired(e.target.checked)} data-testid="waiver-required" className="accent-shGreen w-4 h-4" />
            <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">Require waiver before client can book</span>
          </label>
          <span className="text-[14px] font-black uppercase tracking-widest text-gray-500">Current version: v{version}</span>
        </div>
      </Section>

      <Section title="Signed Waivers" subtitle="Bump version after material changes to require all clients to re-sign.">
        <button onClick={()=>setShowSigs(!showSigs)} className="mb-3 text-[14px] font-black uppercase tracking-widest text-shBlue hover:underline">
          {showSigs?"Hide":"Show"} {signatures.length} signature{signatures.length===1?"":"s"}
        </button>
        {showSigs && (
          <div className="space-y-2 max-h-80 overflow-y-auto" data-testid="waiver-signatures-list">
            {signatures.length === 0 && <p className="text-xs text-gray-500 uppercase font-black">No signatures yet.</p>}
            {signatures.map(sig => (
              <div key={sig.id} className="bg-bgBase rounded p-3 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2" data-testid={`sig-${sig.id}`}>
                <div>
                  <p className="text-white font-black">{sig.typed_name} <span className="text-gray-500 font-normal">· {sig.client_name}</span></p>
                  <p className="text-[14px] text-gray-500 uppercase font-black tracking-widest mt-1">Signed {(sig.signed_at||"").slice(0,19).replace("T"," ")} · v{sig.waiver_version}</p>
                </div>
                <span className="text-[14px] font-black uppercase tracking-widest bg-shGreen/15 text-shGreen px-2 py-1 rounded">Valid</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="flex flex-col md:flex-row justify-end gap-3 pt-4 border-t border-bgHover">
        <button onClick={()=>saveAndMaybeBump(false)} disabled={saving} data-testid="save-waiver-noversion"
                className="bg-shBlue text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
          Save Without Bumping
        </button>
        <button onClick={()=>saveAndMaybeBump(true)} disabled={saving} data-testid="save-waiver-bump"
                className="bg-shGreen text-bgHeader px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
          Save & Bump Version (re-sign required)
        </button>
      </div>
    </div>
  );
}

function MarketingQRPanel() {
  const [ref, setRef] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const buildUrl = (size = 512) => {
    const params = new URLSearchParams({ size: String(size) });
    if (ref.trim()) params.set("ref", ref.trim());
    return `/admin/marketing-qr?${params.toString()}`;
  };

  const loadPreview = async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.get(buildUrl(512), { responseType: "blob" });
      const blob = new Blob([r.data], { type: "image/png" });
      setPreviewUrl(URL.createObjectURL(blob));
      setTargetUrl(r.headers["x-qr-target-url"] || "");
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Couldn't generate the QR code.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPreview(); /* eslint-disable-next-line */ }, []);
  // Regenerate preview when ref changes (debounced).
  useEffect(() => {
    const id = setTimeout(loadPreview, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line
  }, [ref]);

  const download = async (size) => {
    setErr("");
    try {
      const r = await api.get(buildUrl(size), { responseType: "blob" });
      const blob = new Blob([r.data], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sit-happens-qr${ref ? "-" + ref : ""}-${size}px.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Download failed.");
    }
  };

  return (
    <div className="space-y-5" data-testid="marketing-qr-panel">
      <Section title="Marketing QR Code"
               subtitle="Scan with any phone camera to jump straight to your app. Print this on flyers, business cards, fridge magnets — anywhere clients might see it.">
        <div className="flex flex-col md:flex-row items-stretch gap-5">
          <div className="bg-white p-4 rounded-xl flex items-center justify-center w-full md:w-64 h-64 shrink-0">
            {loading && !previewUrl && <p className="text-gray-500 text-xs font-black uppercase tracking-widest">Generating…</p>}
            {previewUrl && <img src={previewUrl} alt="App QR code" className="max-w-full max-h-full" data-testid="qr-preview-img" />}
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <label className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Points to</label>
              <p className="text-[15px] text-shBlue break-all mt-1 font-mono" data-testid="qr-target-url">{targetUrl || "—"}</p>
            </div>
            <div>
              <label className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Tracking tag <span className="text-gray-600 normal-case tracking-normal">(optional — e.g. flyer, postcard, fb-ad)</span></label>
              <input
                type="text"
                value={ref}
                onChange={(e)=>setRef(e.target.value.replace(/[^a-z0-9_-]/gi, "").slice(0, 24))}
                placeholder="flyer"
                data-testid="qr-ref-input"
                className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm font-mono"
              />
              <p className="text-[13px] text-gray-500 mt-1">Appended as <span className="font-mono text-shBlue">?ref=…</span> so future analytics can show where each scan came from.</p>
            </div>
            {err && <p className="text-[14px] text-red-400 font-black uppercase tracking-widest">{err}</p>}
            <div className="grid grid-cols-3 gap-2">
              <button onClick={()=>download(512)} data-testid="qr-download-small"
                      className="bg-bgBase border border-bgHover hover:border-shBlue text-shBlue py-2 rounded text-[14px] font-black uppercase tracking-widest">
                <i className="fas fa-download mr-1"/>Small<br /><span className="text-[12px] text-gray-500">512px</span>
              </button>
              <button onClick={()=>download(1024)} data-testid="qr-download-medium"
                      className="bg-shBlue/15 border border-shBlue/40 hover:bg-shBlue/30 text-shBlue py-2 rounded text-[14px] font-black uppercase tracking-widest">
                <i className="fas fa-download mr-1"/>Print<br /><span className="text-[12px] opacity-70">1024px</span>
              </button>
              <button onClick={()=>download(2048)} data-testid="qr-download-large"
                      className="bg-shGreen text-bgHeader py-2 rounded text-[14px] font-black uppercase tracking-widest shadow">
                <i className="fas fa-download mr-1"/>Poster<br /><span className="text-[12px] opacity-70">2048px</span>
              </button>
            </div>
            <p className="text-[13px] text-gray-500">Higher resolutions = sharper print at larger sizes. Use Poster for full-page flyers, Print for cards, Small for screen sharing.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}



function ReviewLinksPanel() {
  /* Sprint 110ez polish — settings panel for the Phase 9 review URLs. */
  const [links, setLinks] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/settings/review-links").then(r => setLinks(r.data)).catch(()=>setLinks({}));
  }, []);

  const setField = (k, v) => setLinks(l => ({ ...l, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/settings/review-links", {
        google_url: links.google_url || "",
        facebook_url: links.facebook_url || "",
        yelp_url: links.yelp_url || "",
        default_message: links.default_message || "",
      });
      setLinks(data);
      toast.success("Review links saved");
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
    setSaving(false);
  };

  if (!links) return <p className="text-gray-500 text-sm">Loading…</p>;

  return (
    <div className="space-y-4" data-testid="review-links-panel">
      <p className="text-[13px] text-gray-400">
        These URLs power the &quot;Request Review&quot; button on every client and dog card. The default message has two
        placeholders you can use: <code className="text-shBlue">{"{first_name}"}</code> and <code className="text-shBlue">{"{dog_name}"}</code>.
      </p>

      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest"><i className="fab fa-google mr-1"/>Google review URL</label>
        <input value={links.google_url || ""} onChange={(e)=>setField("google_url", e.target.value)} data-testid="rl-google"
               placeholder="https://g.page/r/yourcode/review"
               className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
      </div>

      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest"><i className="fab fa-facebook mr-1"/>Facebook reviews URL</label>
        <input value={links.facebook_url || ""} onChange={(e)=>setField("facebook_url", e.target.value)} data-testid="rl-facebook"
               placeholder="https://facebook.com/yourpage/reviews"
               className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
      </div>

      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest"><i className="fab fa-yelp mr-1"/>Yelp URL <span className="text-gray-600 normal-case">(optional)</span></label>
        <input value={links.yelp_url || ""} onChange={(e)=>setField("yelp_url", e.target.value)} data-testid="rl-yelp"
               placeholder="https://yelp.com/biz/your-business"
               className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
      </div>

      <div>
        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Default request message</label>
        <textarea value={links.default_message || ""} onChange={(e)=>setField("default_message", e.target.value)} rows={4}
                  data-testid="rl-message"
                  className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
        <p className="text-[11px] text-gray-500 mt-1">
          Tip: keep it under 250 characters so it fits in a text. The Copy Message button on each client substitutes {"{first_name}"} and {"{dog_name}"} automatically.
        </p>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} data-testid="rl-save"
                className="bg-shGreen text-bgBase px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow-xl disabled:opacity-60">
          {saving ? "Saving…" : <><i className="fas fa-save mr-1"/>Save links</>}
        </button>
      </div>
    </div>
  );
}

function PortalFirstVisitPanel({ s, save, saving }) {
  const initial = s.portal_first_visit || {};
  const [enabled, setEnabled] = useState(initial.enabled !== false);
  const [heading, setHeading] = useState(initial.heading || "What to expect on your first visit");
  const [footer, setFooter] = useState(typeof initial.footer === "string" ? initial.footer : "Questions? Text us anytime — we love new pups.");
  const [bullets, setBullets] = useState(() => {
    const src = Array.isArray(initial.bullets) && initial.bullets.length > 0
      ? initial.bullets
      : [
          { title: "Pack the basics", body: "leash, any meds, and your dog's regular food if boarding overnight." },
          { title: "Drop off between 7–10am", body: "(or your scheduled time). We'll do a quick intake at the front desk." },
          { title: "You'll get a Pup Report Card", body: "by end of day — photos, mood, and a note about how the day went." },
        ];
    return src.map(b => ({ title: b.title || "", body: b.body || "" }));
  });

  const updateBullet = (i, patch) => setBullets((arr) => arr.map((b, idx) => idx === i ? { ...b, ...patch } : b));
  const addBullet = () => setBullets((arr) => arr.length >= 8 ? arr : [...arr, { title: "", body: "" }]);
  const removeBullet = (i) => setBullets((arr) => arr.length <= 1 ? arr : arr.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= bullets.length) return;
    setBullets((arr) => {
      const next = [...arr];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const onSave = () => save({
    portal_first_visit: {
      enabled,
      heading: heading.trim() || "What to expect on your first visit",
      footer: footer,
      bullets: bullets.filter(b => (b.title || "").trim() || (b.body || "").trim()),
    },
  });

  return (
    <div className="space-y-5" data-testid="portal-first-visit-panel">
      <p className="text-[14px] text-gray-400">
        This card appears on every new client&apos;s portal before their first booking — set expectations, packing tips, drop-off times, anything you want them prepped on.
      </p>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={(e)=>setEnabled(e.target.checked)}
               className="accent-shGreen w-4 h-4" data-testid="fv-enabled"/>
        <span className="text-[13px] font-black uppercase tracking-widest text-white">Show this card on the client portal</span>
      </label>

      <Section title={<span><i className="fas fa-heading text-shBlue mr-2"/>Heading</span>}>
        <input value={heading} onChange={(e)=>setHeading(e.target.value)} data-testid="fv-heading"
               className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm"/>
      </Section>

      <Section title={<span><i className="fas fa-list-ol text-shGreen mr-2"/>Bullets ({bullets.length}/8)</span>}>
        <div className="space-y-3" data-testid="fv-bullets">
          {bullets.map((b, i) => (
            <div key={i} className="bg-bgBase/60 border border-bgHover rounded-lg p-3 space-y-2"
                 data-testid={`fv-bullet-${i}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Bullet {i + 1}</span>
                <div className="flex gap-1">
                  <button type="button" onClick={()=>move(i, -1)} disabled={i === 0}
                          className="text-[11px] px-2 py-1 rounded bg-bgHover hover:bg-bgPanel text-gray-300 disabled:opacity-30"
                          data-testid={`fv-bullet-${i}-up`}>
                    <i className="fas fa-arrow-up"/>
                  </button>
                  <button type="button" onClick={()=>move(i, 1)} disabled={i === bullets.length - 1}
                          className="text-[11px] px-2 py-1 rounded bg-bgHover hover:bg-bgPanel text-gray-300 disabled:opacity-30"
                          data-testid={`fv-bullet-${i}-down`}>
                    <i className="fas fa-arrow-down"/>
                  </button>
                  <button type="button" onClick={()=>removeBullet(i)} disabled={bullets.length <= 1}
                          className="text-[11px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 disabled:opacity-30"
                          data-testid={`fv-bullet-${i}-remove`}>
                    <i className="fas fa-trash"/>
                  </button>
                </div>
              </div>
              <input value={b.title} onChange={(e)=>updateBullet(i, { title: e.target.value })}
                     placeholder="Bold lead-in (e.g. 'Pack the basics')"
                     data-testid={`fv-bullet-${i}-title`}
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
              <textarea value={b.body} onChange={(e)=>updateBullet(i, { body: e.target.value })}
                        rows={2}
                        placeholder="The rest of the sentence shown after the bold lead-in."
                        data-testid={`fv-bullet-${i}-body`}
                        className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
            </div>
          ))}
          {bullets.length < 8 && (
            <button type="button" onClick={addBullet}
                    data-testid="fv-bullet-add"
                    className="text-[12px] font-black uppercase tracking-widest px-3 py-2 rounded bg-shBlue/15 text-shBlue border border-shBlue/30 hover:bg-shBlue/25 transition">
              <i className="fas fa-plus mr-1.5"/>Add bullet
            </button>
          )}
        </div>
      </Section>

      <Section title={<span><i className="fas fa-comment-dots text-shGreen mr-2"/>Closing line (italic)</span>}>
        <input value={footer} onChange={(e)=>setFooter(e.target.value)} data-testid="fv-footer"
               className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm"/>
        <p className="text-[12px] text-gray-500 mt-1">Shown italicized at the bottom of the card. Leave blank to hide.</p>
      </Section>

      <SaveBar onSave={onSave} saving={saving} />
    </div>
  );
}


function PortalLinksPanel({ s, save, saving }) {
  const initial = s.client_portal_links || {};
  const [links, setLinks] = useState({
    website_url: initial.website_url || "",
    photo_gallery_url: initial.photo_gallery_url || "",
  });
  const onSave = () => save({ client_portal_links: links });
  return (
    <div className="space-y-5" data-testid="portal-links-panel">
      <p className="text-[14px] text-gray-400">
        These appear as quick-link buttons on your client portal. Leave blank to hide a button. You can change them anytime — clients always get the current URL.
      </p>
      <Section title={<span><i className="fas fa-globe text-shBlue mr-2"/>Your Website</span>}>
        <input
          type="url"
          value={links.website_url}
          onChange={(e)=>setLinks(l => ({ ...l, website_url: e.target.value.trim() }))}
          placeholder="https://your-business.com"
          data-testid="link-website-input"
          className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm font-mono"
        />
        <p className="text-[13px] text-gray-500 mt-1">Shows up as a "Visit Our Website" button on the portal.</p>
      </Section>
      <Section title={<span><i className="fas fa-images text-shGreen mr-2"/>Photo Gallery (Fallback Only)</span>}>
        <input
          type="url"
          value={links.photo_gallery_url}
          onChange={(e)=>setLinks(l => ({ ...l, photo_gallery_url: e.target.value.trim() }))}
          placeholder="https://photos.your-business.com"
          data-testid="link-gallery-input"
          className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm font-mono"
        />
        <p className="text-[13px] text-gray-500 mt-1">
          <i className="fas fa-circle-info mr-1 text-shBlue"/>
          Photo galleries are now <span className="font-black text-white">per-client</span> — set each client's gallery URL on their record in the Clients screen. This field is only used as a fallback for clients who don't have their own gallery URL set.
        </p>
      </Section>
      <SaveBar onSave={onSave} saving={saving} />
    </div>
  );
}


function ServiceInfoPanel({ s, save, saving }) {
  const defaults = s.service_descriptions || {};
  const [descs, setDescs] = useState({
    daycare: defaults.daycare || "",
    boarding: defaults.boarding || "",
    training: defaults.training || "",
    grooming: defaults.grooming || "",
    photography: defaults.photography || "",
  });
  const services = [
    { k: "daycare", label: "Daycare", icon: "fa-sun", color: "text-shBlue" },
    { k: "boarding", label: "Boarding", icon: "fa-moon", color: "text-shGreen" },
    { k: "training", label: "Training", icon: "fa-graduation-cap", color: "text-purple-400" },
    { k: "grooming", label: "Grooming", icon: "fa-bath", color: "text-pink-400" },
    { k: "photography", label: "Photography", icon: "fa-camera-retro", color: "text-shOrange" },
  ];
  return (
    <div className="space-y-5" data-testid="service-info-panel">
      <p className="text-[14px] text-gray-400">
        These appear when your clients tap the <i className="fas fa-circle-info text-shBlue mx-1"/> next to a service on the booking form. Keep them short and reassuring — what is it, who it's for, what to bring.
      </p>
      {services.map(svc => (
        <Section key={svc.k} title={<span><i className={`fas ${svc.icon} ${svc.color} mr-2`}/>{svc.label}</span>}>
          <textarea
            value={descs[svc.k]}
            onChange={(e)=>setDescs(d => ({...d, [svc.k]: e.target.value}))}
            rows={3}
            data-testid={`service-desc-${svc.k}`}
            placeholder={`Tell clients what ${svc.label.toLowerCase()} is like at your business…`}
            className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm leading-relaxed"
          />
        </Section>
      ))}
      <SaveBar onSave={()=>save({ service_descriptions: descs })} saving={saving} />
    </div>
  );
}


function Section({ title, subtitle, children }) {
  return (
    <div>
      <h4 className="text-xs font-black text-shBlue uppercase tracking-widest">{title}</h4>
      {subtitle && <p className="text-[15px] text-gray-500 mt-1">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SaveBar({ onSave, saving }) {
  return (
    <div className="flex justify-end pt-4 border-t border-bgHover">
      <button onClick={onSave} disabled={saving} data-testid="save-settings"
              className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
        {saving?"Saving…":"Save Changes"}
      </button>
    </div>
  );
}


function ErrorsPanel() {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true); setMsg("");
    try {
      const { data } = await api.get("/admin/recent-errors");
      setErrors(Array.isArray(data?.errors) ? data.errors : []);
    } catch (e) {
      console.warn("Recent errors load failed:", e);
      setMsg("Failed to load recent errors.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const clearAll = async () => {
    if (!window.confirm("Clear all recent errors from the buffer?")) return;
    try {
      await api.post("/admin/recent-errors/clear");
      setErrors([]);
      setMsg("Cleared.");
    } catch (e) {
      console.warn("Clear errors failed:", e);
      setMsg("Failed to clear.");
    }
  };

  const fmtTs = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  };

  return (
    <div className="space-y-4 max-w-3xl" data-testid="errors-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-black text-shOrange uppercase tracking-widest mb-1">
            <i className="fas fa-triangle-exclamation mr-2"/>Recent Server Errors
          </h4>
          <p className="text-[15px] text-gray-400 leading-relaxed">
            The last 20 unhandled API errors since the backend was started. Spot regressions before clients email you.
            Cleared automatically when the server restarts.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={load} disabled={loading} data-testid="errors-refresh-btn"
                  className="bg-bgHover text-gray-200 px-3 py-1.5 rounded text-[14px] font-black uppercase tracking-widest hover:bg-bgBase disabled:opacity-50">
            <i className={`fas fa-rotate ${loading?"fa-spin":""} mr-1.5`}/>Refresh
          </button>
          <button onClick={clearAll} disabled={loading || errors.length===0} data-testid="errors-clear-btn"
                  className="bg-red-500/20 text-red-300 px-3 py-1.5 rounded text-[14px] font-black uppercase tracking-widest hover:bg-red-500/30 disabled:opacity-40">
            <i className="fas fa-trash mr-1.5"/>Clear
          </button>
        </div>
      </div>

      {msg && <p className="text-[15px] text-gray-400">{msg}</p>}

      {errors.length === 0 && !loading ? (
        <div className="bg-bgBase border border-bgHover rounded p-6 text-center">
          <i className="fas fa-check-circle text-shGreen text-2xl mb-2 block"/>
          <p className="text-[14px] font-black text-gray-300 uppercase tracking-widest">All clear</p>
          <p className="text-[14px] text-gray-500 mt-1">No unhandled errors recorded.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((er) => {
            const isOpen = expanded === er.id;
            return (
              <div key={er.id} className="bg-bgBase border border-bgHover rounded overflow-hidden" data-testid={`error-row-${er.id}`}>
                <button onClick={()=>setExpanded(isOpen ? null : er.id)}
                        className="w-full text-left p-3 hover:bg-bgHover/40 transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-black text-shOrange uppercase tracking-widest px-2 py-0.5 bg-shOrange/10 rounded">
                          {er.type}
                        </span>
                        <span className="text-[13px] font-mono text-gray-500">{er.method} {er.path}</span>
                      </div>
                      <p className="text-[15px] text-gray-200 break-words">{er.message || "(no message)"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] text-gray-500">{fmtTs(er.ts)}</p>
                      <i className={`fas fa-chevron-${isOpen?"up":"down"} text-gray-500 text-[13px] mt-1`}/>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <pre className="text-[13px] text-gray-400 bg-black/40 p-3 overflow-x-auto whitespace-pre-wrap border-t border-bgHover">
{er.traceback || "(no traceback)"}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}



function BackupPanel() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreMode, setRestoreMode] = useState("merge");
  const [restorePreview, setRestorePreview] = useState(null);
  // Sprint 110di-23 — Config-only export/import (settings, themes, email
  // templates, payment-plan settings). Separate file from the full backup so
  // the operator can carry just their configuration between hosts.
  const [configFile, setConfigFile] = useState(null);
  const [configPreview, setConfigPreview] = useState(null);

  const download = async () => {
    setBusy(true); setMsg("");
    try {
      const { data } = await api.get("/backup/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `sit-happens-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("Backup downloaded ✓");
    } catch { setMsg("Download failed"); }
    setBusy(false);
  };

  const downloadIncomeCsv = async () => {
    setBusy(true); setMsg("");
    try {
      const year = new Date().getFullYear();
      const resp = await api.get(`/admin/income/export.csv`, { params: { year }, responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url; a.download = `sit-happens-income-${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Income CSV for ${year} downloaded ✓`);
    } catch (e) { console.warn("income csv failed", e); setMsg("Income export failed"); }
    setBusy(false);
  };

  // Sprint 110di-23 — Config-only download. Bundles just the settings collections.
  const downloadConfig = async () => {
    setBusy(true); setMsg("");
    try {
      const { data } = await api.get("/backup/export-config");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `sit-happens-config-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("Config downloaded ✓");
    } catch { setMsg("Config download failed"); }
    setBusy(false);
  };

  const onPickConfigFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setConfigFile(f); setConfigPreview(null); setMsg("");
    const r = new FileReader();
    r.onload = async () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!parsed.version || !parsed.collections) throw new Error("Not a valid config file");
        if (parsed.kind !== "config") {
          throw new Error(`This looks like a '${parsed.kind || "full"}' backup, not a config file. Use the full Restore section below.`);
        }
        const incoming = {};
        Object.entries(parsed.collections).forEach(([k, v]) => incoming[k] = (v || []).length);
        // Fetch CURRENT counts so the preview can show before-vs-after
        // diffs. The user explicitly asked for "what will be replaced" —
        // this is the clearest way to surface it.
        let current = {};
        try {
          const { data: live } = await api.get("/backup/export-config");
          Object.entries(live.collections || {}).forEach(([k, v]) => current[k] = (v || []).length);
        } catch (err) { console.warn("config-preview: current fetch failed", err); }
        setConfigPreview({
          version: parsed.version,
          exportedAt: parsed.exported_at,
          kind: parsed.kind,
          incoming,
          current,
        });
      } catch (err) { setMsg(`Invalid file: ${err.message}`); setConfigFile(null); }
    };
    r.readAsText(f);
  };

  const doConfigRestore = async () => {
    if (!configFile || !configPreview) return;
    const total = Object.values(configPreview.incoming).reduce((a,b)=>a+b, 0);
    if (!(await confirm({
      title: "Replace configuration?",
      body: (
        `This will REPLACE your current configuration (settings, themes, email templates, payment-plan settings) with ${total} records from ${configFile.name}.\n\n` +
        `Client/dog/booking/payment data is NOT affected.\n\n` +
        `A safety snapshot of your CURRENT config will be auto-saved to /app/backups/ first, so you can roll back if needed.`
      ),
      confirmText: "Yes, replace config",
      tone: "danger",
    }))) return;
    setBusy(true); setMsg("");
    try {
      const r = new FileReader();
      r.onload = async () => {
        try {
          const payload = JSON.parse(r.result);
          const { data } = await api.post("/backup/restore-config", payload);
          const summary = Object.entries(data.summary).map(([k,v])=>`${k}: ${v.inserted}`).join(" · ");
          const snap = data.pre_restore_snapshot;
          const snapNote = snap?.ok
            ? ` Pre-restore snapshot: ${snap.filename}.`
            : (snap?.error ? ` (Snapshot warning: ${snap.error})` : "");
          setMsg(`Config restored ✓ ${summary} — reload to see all changes.${snapNote}`);
          setConfigFile(null); setConfigPreview(null);
        } catch (e) { setMsg(`Config restore failed: ${e.response?.data?.detail || e.message}`); }
        setBusy(false);
      };
      r.readAsText(configFile);
    } catch { setBusy(false); setMsg("Config restore failed"); }
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setRestoreFile(f); setRestorePreview(null); setMsg("");
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!parsed.version || !parsed.collections) throw new Error("Not a valid Sit Happens backup");
        const counts = {};
        Object.entries(parsed.collections).forEach(([k, v]) => counts[k] = (v || []).length);
        setRestorePreview({ version: parsed.version, exportedAt: parsed.exported_at, counts });
      } catch (err) { setMsg(`Invalid file: ${err.message}`); setRestoreFile(null); }
    };
    r.readAsText(f);
  };

  const doRestore = async () => {
    if (!restoreFile || !restorePreview) return;
    const total = Object.values(restorePreview.counts).reduce((a,b)=>a+b, 0);
    const verb = restoreMode === "replace" ? "REPLACE all current data with" : "merge into your current data";
    if (!(await confirm({ title: restoreMode === "replace" ? "Replace ALL data?" : "Merge into current data?", body: `This will ${verb} ${total} records from ${restoreFile.name}.\n\nA safety snapshot of your CURRENT state will be auto-saved to /app/backups/ before anything is touched — you can roll back from there if needed.`, confirmText: restoreMode === "replace" ? "Yes, replace everything" : "Yes, merge", tone: "danger" }))) return;
    setBusy(true); setMsg("");
    try {
      const r = new FileReader();
      r.onload = async () => {
        try {
          const payload = JSON.parse(r.result);
          payload.mode = restoreMode;
          const { data } = await api.post("/backup/restore", payload);
          const summary = Object.entries(data.summary).map(([k,v])=>`${k}: ${v.inserted ?? v.upserted}`).join(" · ");
          const snap = data.pre_restore_snapshot;
          const snapNote = snap?.ok
            ? ` Pre-restore snapshot: ${snap.filename}.`
            : (snap?.error ? ` (Snapshot warning: ${snap.error})` : "");
          setMsg(`Restored ✓ ${summary}.${snapNote}`);
          setRestoreFile(null); setRestorePreview(null);
        } catch (e) { setMsg(`Restore failed: ${e.response?.data?.detail || e.message}`); }
        setBusy(false);
      };
      r.readAsText(restoreFile);
    } catch { setBusy(false); setMsg("Restore failed"); }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="backup-panel">
      <PreUpdateSafetyPanel />
      <ProductionHealthPanel />
      <DiskUsagePanel />
      <AutoBackupPanel />
      <div className="border-t border-bgHover pt-6">
        <h4 className="text-sm font-black text-shGreen uppercase tracking-widest mb-2"><i className="fas fa-download mr-2"/>Download Backup</h4>
        <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
          Saves a full snapshot of <span className="text-white font-black">everything that matters</span>:
          clients, dogs, bookings, incidents, waivers, client files, claim invites;
          every catalog you've customised (services, credit packs, homework templates, programs, trophies, recurring/shift templates);
          per-dog progress (homework + media, step history, training sessions, awarded trophies, program enrollments, referrals);
          financial state (expenses, retail, credit lots, credit adjustments);
          quote-request inbox, admin tasks and dismissals;
          plus staff scheduling and clocked-in time entries.
          <br/><span className="text-gray-500">User logins are migrated separately via Settings → Users → Export-with-hashes.</span>
          <br/>Download one every week or before any major change.
        </p>
        <button onClick={download} disabled={busy} data-testid="backup-download"
                className="bg-shGreen text-bgHeader px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
          <i className="fas fa-download mr-2"/>{busy ? "Working…" : "Download Backup (.json)"}
        </button>
      </div>

      <div className="border-t border-bgHover pt-6">
        <h4 className="text-sm font-black text-shBlue uppercase tracking-widest mb-2"><i className="fas fa-file-csv mr-2"/>Year-End Income Export</h4>
        <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
          Download every paid booking + credit-pack sale for the current year as a CSV — opens cleanly in Excel/Sheets. Perfect for handing your accountant in January.
        </p>
        <button onClick={downloadIncomeCsv} disabled={busy} data-testid="income-csv-download"
                className="bg-shBlue text-bgHeader px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
          <i className="fas fa-file-csv mr-2"/>{busy ? "Working…" : `Download ${new Date().getFullYear()} Income (.csv)`}
        </button>
      </div>

      {/* Sprint 110di-23 — Config-only export/import. Lets the operator carry
          their settings/branding/themes/email templates between hosts without
          shipping any client/dog/booking data. Tiny file (typically < 100 KB)
          vs. the full backup which can be megabytes. */}
      <div className="border-t border-bgHover pt-6" data-testid="config-backup-section">
        <h4 className="text-sm font-black text-purple-400 uppercase tracking-widest mb-2"><i className="fas fa-sliders mr-2"/>Config Export / Import</h4>
        <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
          Download just your <span className="text-white font-black">configuration</span> — branding, themes, feature visibility,
          portal controls, dashboard widgets, card themes, email templates, and payment-plan settings.
          <br/><span className="text-gray-500">No client/dog/booking data is touched. Tiny file — perfect for cloning a staging-tested config into production, or rolling back a theme change.</span>
        </p>
        <button onClick={downloadConfig} disabled={busy} data-testid="config-download"
                className="bg-purple-500 text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
          <i className="fas fa-download mr-2"/>{busy ? "Working…" : "Download Config (.json)"}
        </button>

        <div className="mt-5 space-y-3">
          <label className="block">
            <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Restore config from file</span>
            <input type="file" accept=".json,application/json" onChange={onPickConfigFile} data-testid="config-file"
                   className="block mt-1 w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-bgBase file:text-purple-400 file:font-black file:uppercase file:text-[14px] file:tracking-widest hover:file:bg-bgHover cursor-pointer" />
          </label>

          {configPreview && (
            <div className="bg-bgBase border border-bgHover rounded p-3 space-y-3" data-testid="config-preview">
              <div>
                <p className="text-[14px] font-black text-purple-400 uppercase tracking-widest">Config preview · what will be replaced</p>
                <p className="text-[14px] text-gray-400">Exported {configPreview.exportedAt?.slice(0,19).replace("T", " ")}</p>
              </div>
              {/* Sprint 110di-24 — Before/after diff so the operator sees
                  exactly what's going to change BEFORE they hit Restore. */}
              <div className="text-[14px]">
                <div className="grid grid-cols-12 gap-2 px-2 py-1 bg-bgPanel/40 rounded text-gray-500 font-black uppercase tracking-widest text-[11px]">
                  <div className="col-span-6">Collection</div>
                  <div className="col-span-3 text-right">Current</div>
                  <div className="col-span-3 text-right">After Restore</div>
                </div>
                {Object.keys(configPreview.incoming).map((k) => {
                  const cur = configPreview.current?.[k] ?? 0;
                  const inc = configPreview.incoming[k];
                  const diff = inc - cur;
                  return (
                    <div key={k} className="grid grid-cols-12 gap-2 px-2 py-1 border-b border-bgHover/50" data-testid={`config-preview-row-${k}`}>
                      <div className="col-span-6 text-gray-300 uppercase font-black tracking-widest text-[12px] truncate">{k}</div>
                      <div className="col-span-3 text-right text-gray-400">{cur}</div>
                      <div className="col-span-3 text-right">
                        <span className="text-white font-black">{inc}</span>
                        {diff !== 0 && (
                          <span className={`ml-2 text-[11px] font-black ${diff > 0 ? "text-shGreen" : "text-shOrange"}`}>
                            ({diff > 0 ? "+" : ""}{diff})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Explicit reassurance about what is NOT touched. The user
                  asked for this verbatim — protects against accidental fear
                  that a config restore could wipe their client list. */}
              <div className="bg-shGreen/10 border border-shGreen/40 rounded px-3 py-2 text-[12px] text-shGreen flex items-start gap-2" data-testid="config-preview-untouched">
                <i className="fas fa-shield-halved mt-0.5 shrink-0"/>
                <span className="font-black uppercase tracking-widest">Untouched: clients · dogs · bookings · payments · all per-dog progress</span>
              </div>
              {/* Auto-snapshot promise — backend writes /app/backups/pre-restore-config-*.json
                  BEFORE applying the restore so rollback is always possible. */}
              <div className="bg-shBlue/10 border border-shBlue/40 rounded px-3 py-2 text-[12px] text-shBlue flex items-start gap-2" data-testid="config-preview-autosnap">
                <i className="fas fa-clock-rotate-left mt-0.5 shrink-0"/>
                <span>A safety snapshot of your current config will be auto-saved to <span className="font-black">/app/backups/</span> before anything is replaced.</span>
              </div>
            </div>
          )}

          <button onClick={doConfigRestore} disabled={busy || !configPreview} data-testid="config-restore"
                  className="bg-purple-500 text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
            <i className="fas fa-upload mr-2"/>{busy ? "Restoring…" : "Restore Config"}
          </button>
        </div>
      </div>

      <div className="border-t border-bgHover pt-6">
        <h4 className="text-sm font-black text-shOrange uppercase tracking-widest mb-2"><i className="fas fa-upload mr-2"/>Restore from Backup</h4>
        <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
          Upload a previously-downloaded backup file. <span className="text-shOrange font-black">Always download a fresh backup before restoring</span> in case you need to revert.
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Backup file</span>
            <input type="file" accept=".json,application/json" onChange={onPickFile} data-testid="backup-file"
                   className="block mt-1 w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-bgBase file:text-shBlue file:font-black file:uppercase file:text-[14px] file:tracking-widest hover:file:bg-bgHover cursor-pointer" />
          </label>

          {restorePreview && (
            <div className="bg-bgBase border border-bgHover rounded p-3 space-y-2" data-testid="backup-preview">
              <p className="text-[14px] font-black text-shBlue uppercase tracking-widest">Backup preview</p>
              <p className="text-[14px] text-gray-400">Exported {restorePreview.exportedAt?.slice(0,19).replace("T", " ")}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[14px]">
                {Object.entries(restorePreview.counts).map(([k,v]) => (
                  <div key={k} className="bg-bgPanel rounded px-2 py-1 flex justify-between">
                    <span className="text-gray-400 uppercase font-black tracking-widest">{k}</span>
                    <span className="text-white font-black">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Restore mode</span>
            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className={`cursor-pointer rounded p-3 border ${restoreMode==="merge"?"bg-shBlue/10 border-shBlue/50":"bg-bgBase border-bgHover"}`}>
                <input type="radio" name="mode" checked={restoreMode==="merge"} onChange={()=>setRestoreMode("merge")} className="mr-2 accent-shBlue" data-testid="mode-merge" />
                <span className="text-sm font-black text-white uppercase tracking-tight">Merge (safer)</span>
                <p className="text-[14px] text-gray-400 mt-1">Adds & updates by ID. Anything not in the backup stays untouched.</p>
              </label>
              <label className={`cursor-pointer rounded p-3 border ${restoreMode==="replace"?"bg-red-500/10 border-red-500/50":"bg-bgBase border-bgHover"}`}>
                <input type="radio" name="mode" checked={restoreMode==="replace"} onChange={()=>setRestoreMode("replace")} className="mr-2 accent-red-500" data-testid="mode-replace" />
                <span className="text-sm font-black text-white uppercase tracking-tight">Replace (wipes current)</span>
                <p className="text-[14px] text-gray-400 mt-1">Deletes all current data and restores exactly what's in the backup.</p>
              </label>
            </div>
          </div>

          <button onClick={doRestore} disabled={busy || !restorePreview} data-testid="backup-restore"
                  className={`px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50 ${restoreMode==="replace"?"bg-red-500 text-white":"bg-shBlue text-white"}`}>
            <i className="fas fa-upload mr-2"/>{busy ? "Restoring…" : `Restore (${restoreMode})`}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`text-[14px] font-black uppercase tracking-widest p-3 rounded ${msg.startsWith("Restored") || msg.includes("✓") ? "bg-shGreen/15 text-shGreen":"bg-red-500/15 text-red-400"}`} data-testid="backup-msg">
          {msg}
        </div>
      )}

      <div className="bg-bgBase border border-bgHover rounded p-4 text-[14px] text-gray-400 leading-relaxed">
        <p className="text-shBlue font-black uppercase tracking-widest mb-2"><i className="fas fa-circle-info mr-2"/>What's in a backup?</p>
        <p>Clients, dogs, bookings, incidents, homework, waiver signatures, and your settings. Admin login credentials are <span className="text-white font-black">not</span> included — your password stays in the database and is never exported. Backups are plain JSON and safe to email to yourself or store in cloud storage.</p>
      </div>

      <UserMigrationSection />

      <BulkClaimEmailsSection />

      <PhotoCompressionPanel />
      <SalesTaxPanel />
      <YearEndPayrollPanel />
      <MeetNGreetPanel />
    </div>
  );
}

// ─────── Sprint 110aw · Sales tax panel ───────
function SalesTaxPanel() {
  const [cfg, setCfg] = useState(null);
  const [draft, setDraft] = useState(null);
  const [summary, setSummary] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/settings").then(r => {
      const tx = r.data?.sales_tax || { enabled: false, rate_pct: 0, label: "Sales Tax",
        applies_to: { daycare: false, boarding: false, training: false,
                       grooming: true, photography: true, retail: true, credit_packs: false } };
      setCfg(tx); setDraft(tx);
    }).catch(() => {});
    api.get("/admin/sales-tax/summary").then(r => setSummary(r.data)).catch(() => {});
  }, []);
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      await api.put("/settings", { sales_tax: {
        enabled: !!draft.enabled,
        rate_pct: Number(draft.rate_pct) || 0,
        label: draft.label || "Sales Tax",
        applies_to: draft.applies_to || {},
      }});
      setCfg(draft); setMsg("Saved ✓");
      setTimeout(() => setMsg(""), 2500);
      const fresh = await api.get("/admin/sales-tax/summary");
      setSummary(fresh.data);
    } catch (e) {
      setMsg(e.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };
  if (!draft) return null;
  const toggleAt = (k) => setDraft({ ...draft, applies_to: { ...(draft.applies_to||{}), [k]: !draft.applies_to?.[k] } });
  const services = [
    ["daycare", "Daycare"], ["boarding", "Boarding"], ["training", "Training"],
    ["grooming", "Grooming"], ["photography", "Photography"],
    ["retail", "Retail"], ["credit_packs", "Credit packs"],
  ];
  return (
    <div className="border-t border-bgHover pt-6" data-testid="sales-tax-panel">
      <h4 className="text-sm font-black text-shGreen uppercase tracking-widest mb-2"><i className="fas fa-percent mr-2"/>Sales Tax</h4>
      <p className="text-[14px] text-gray-400 mb-3 leading-relaxed">
        Single flat rate. When enabled, tax is added to checkouts of the selected service types and back-calculated from retail amounts (POS convention: customer pays the total, tax is the slice). Year-to-date totals power the summary card below.
      </p>
      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={!!draft.enabled}
                 onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                 data-testid="sales-tax-enabled"
                 className="w-5 h-5 accent-shGreen"/>
          <span className="text-[14px] font-black text-white uppercase tracking-widest">Enable sales tax</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Rate (%)</span>
            <input type="number" min={0} max={50} step="0.001"
                   value={draft.rate_pct ?? 0}
                   onChange={(e) => setDraft({ ...draft, rate_pct: e.target.value })}
                   data-testid="sales-tax-rate"
                   className="mt-1 block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm font-mono"/>
          </label>
          <label className="block">
            <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Label on receipts</span>
            <input type="text" value={draft.label || ""}
                   onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                   placeholder="Sales Tax"
                   data-testid="sales-tax-label"
                   className="mt-1 block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
        </div>
        <div>
          <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-2">Applies to</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {services.map(([k, label]) => (
              <label key={k} className={`cursor-pointer rounded px-3 py-2 border text-[13px] font-black uppercase tracking-widest ${
                  draft.applies_to?.[k] ? "bg-shGreen/15 border-shGreen/40 text-shGreen" : "bg-bgBase border-bgHover text-gray-400"
                }`}>
                <input type="checkbox" checked={!!draft.applies_to?.[k]} onChange={() => toggleAt(k)}
                       data-testid={`sales-tax-applies-${k}`}
                       className="mr-2 accent-shGreen"/>{label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} data-testid="sales-tax-save"
                  className="bg-shGreen text-bgHeader px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
            <i className="fas fa-save mr-1"/>Save
          </button>
          {msg && <span className={`text-[13px] font-black uppercase tracking-widest ${msg.startsWith("Saved") ? "text-shGreen" : "text-red-400"}`}>{msg}</span>}
        </div>
      </div>
      {summary && (
        <div className="mt-4 bg-bgBase border border-bgHover rounded p-3" data-testid="sales-tax-summary">
          <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-1">YTD Tax Collected · {summary.start_date} → {summary.end_date}</p>
          <p className="text-2xl font-black text-shGreen">${Number(summary.total_tax_collected || 0).toFixed(2)}</p>
          <div className="grid grid-cols-2 gap-2 mt-2 text-[12px] text-gray-300">
            <div className="bg-bgPanel rounded px-2 py-1 flex justify-between">
              <span className="font-black uppercase tracking-widest text-gray-500">Bookings</span>
              <span className="font-black">${Number(summary.bookings_tax_total || 0).toFixed(2)}</span>
            </div>
            <div className="bg-bgPanel rounded px-2 py-1 flex justify-between">
              <span className="font-black uppercase tracking-widest text-gray-500">Retail</span>
              <span className="font-black">${Number(summary.retail_tax_total || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────── Sprint 110aw · 1099/W2 export panel ───────
function YearEndPayrollPanel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [detail, setDetail] = useState(false);
  const download = () => {
    // Sprint 110di-46 — same-origin safe fallback + correct token key
    // ("sh_token" matches what the rest of the app uses; the legacy
    // "auth_token" key was always empty here so downloads 401'd).
    const API_ROOT = process.env.REACT_APP_BACKEND_URL || "";
    const url = `${API_ROOT}/api/admin/payroll/year-end.csv?year=${year}&detail=${detail}`;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    const token = localStorage.getItem("sh_token") || "";
    // The api interceptor adds the Authorization header to axios calls — for
    // direct anchor downloads we use a temporary fetch to attach the token.
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(b => {
        const objUrl = URL.createObjectURL(b);
        a.href = objUrl;
        a.download = `sit-happens-payroll-${year}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
      })
      .catch(() => {});
  };
  return (
    <div className="border-t border-bgHover pt-6" data-testid="payroll-yearend-panel">
      <h4 className="text-sm font-black text-shBlue uppercase tracking-widest mb-2"><i className="fas fa-file-invoice-dollar mr-2"/>Year-End Payroll · 1099 / W2 Prep</h4>
      <p className="text-[14px] text-gray-400 mb-3 leading-relaxed">
        CSV of every employee's gross wages for the year (hours × hourly rate). Hand to your accountant or import into QuickBooks / Gusto for 1099-NEC or W-2 filing.
      </p>
      <div className="flex items-end gap-3 flex-wrap">
        <label className="block">
          <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Year</span>
          <input type="number" min={2020} max={2099} value={year}
                 onChange={(e) => setYear(e.target.value)}
                 data-testid="payroll-year"
                 className="mt-1 block w-32 bg-bgBase border border-bgHover rounded p-2 text-white text-sm font-mono"/>
        </label>
        <label className="flex items-center gap-2 cursor-pointer pb-2">
          <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)}
                 data-testid="payroll-detail"
                 className="w-4 h-4 accent-shBlue"/>
          <span className="text-[13px] text-gray-300 font-black uppercase tracking-widest">Include per-entry detail</span>
        </label>
        <button onClick={download} data-testid="payroll-download"
                className="bg-shBlue text-bgHeader px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow">
          <i className="fas fa-download mr-1"/>Download CSV
        </button>
      </div>
    </div>
  );
}

// ─────── Sprint 110aw · Meet-n-Greet toggle ───────
function MeetNGreetPanel() {
  const [on, setOn] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("/settings").then(r => setOn(!!r.data?.evaluation?.require_evaluation_first)).catch(() => setOn(false));
  }, []);
  const toggle = async () => {
    setBusy(true);
    try {
      const next = !on;
      await api.put("/settings", { evaluation: { require_evaluation_first: next } });
      setOn(next);
    } catch {} finally { setBusy(false); }
  };
  return (
    <div className="border-t border-bgHover pt-6" data-testid="meet-n-greet-panel">
      <h4 className="text-sm font-black text-shOrange uppercase tracking-widest mb-2"><i className="fas fa-handshake mr-2"/>Meet-n-Greet Required</h4>
      <p className="text-[14px] text-gray-400 mb-3 leading-relaxed">
        When ON, brand-new clients are flagged as <strong>prospects</strong> and can't book regular services until staff complete a temperament evaluation and mark them active. Existing clients are unaffected. You can override on a case-by-case basis from the Clients list.
      </p>
      <button onClick={toggle} disabled={busy || on === null}
              data-testid="meet-n-greet-toggle"
              className={`px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest transition ${
                on ? "bg-shOrange text-bgHeader hover:bg-shOrange/90" : "bg-bgPanel text-gray-400 hover:bg-bgHover border border-bgHover"
              } disabled:opacity-50`}>
        {on === null ? "…" : on ? "Required" : "Disabled"}
      </button>
    </div>
  );
}

// ─────── Sprint 110av · Disk Usage panel ───────
function fmtBytes(n) {
  if (n == null || isNaN(n)) return "—";
  const gb = n / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = n / (1024 ** 2);
  return `${mb.toFixed(1)} MB`;
}


function PreUpdateSafetyPanel() {
  const [report, setReport] = useState(null);
  const [valid, setValid] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = async () => {
    setBusy(true); setMsg("");
    try {
      const [{ data: r }, { data: h }] = await Promise.all([
        api.get("/admin/backup-safety/report"),
        api.get("/admin/backup-safety/validations", { params: { limit: 5 } }).catch(() => ({ data: [] })),
      ]);
      setReport(r); setHistory(h || []);
    } catch (e) { setMsg(formatErr(e.response?.data?.detail) || "Could not load backup safety report"); }
    finally { setBusy(false); }
  };
  const validateLatest = async () => {
    setBusy(true); setMsg(""); setValid(null);
    try {
      const { data } = await api.post("/admin/backup-safety/validate-latest");
      setValid(data);
      setMsg(data.ok ? "Latest in-app backup parsed successfully ✓" : "Latest backup parsed with warnings");
      load();
    } catch (e) { setMsg(formatErr(e.response?.data?.detail) || "Validation failed"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const warnings = report?.warnings || [];
  const dangers = warnings.filter(w => w.severity === "danger").length;
  const warns = warnings.filter(w => w.severity === "warn").length;
  const infos = warnings.filter(w => w.severity === "info").length;
  const goTone = report?.pre_update_ok ? "border-shGreen/50 bg-shGreen/10 text-shGreen" : "border-red-500/50 bg-red-500/10 text-red-300";
  const file = report?.latest_file || {};
  return (
    <div className="border border-shBlue/40 rounded-xl p-4 bg-bgPanel" data-testid="pre-update-safety-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h4 className="text-sm font-black text-shBlue uppercase tracking-widest"><i className="fas fa-shield-halved mr-2"/>Pre-Update Safety Check</h4>
          <p className="text-[13px] text-gray-400">Use this before pulling GitHub updates on the Bazzite box. It does not change your data.</p>
        </div>
        <div className={`px-3 py-2 rounded border text-[12px] font-black uppercase tracking-widest ${goTone}`} data-testid="pre-update-verdict">
          {report?.pre_update_ok ? "Looks safe to update" : "Do not update yet"}
        </div>
      </div>
      {msg && <p className={`text-[13px] mb-2 ${msg.includes("✓") ? "text-shGreen" : "text-shOrange"}`}>{msg}</p>}
      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            <HealthMini label="Danger" value={dangers} color={dangers ? "text-red-300" : "text-shGreen"}/>
            <HealthMini label="Warnings" value={warns} color={warns ? "text-shOrange" : "text-shGreen"}/>
            <HealthMini label="Info" value={infos} color="text-shBlue"/>
            <HealthMini label="Backup age" value={report.latest_age_hours == null ? "—" : `${Math.round(report.latest_age_hours)}h`} color={report.latest_age_hours > 24 ? "text-shOrange" : "text-shGreen"}/>
          </div>
          <div className="bg-bgBase/70 border border-bgHover rounded p-3 mb-3 text-[13px] text-gray-300">
            <p><span className="text-gray-500 font-black uppercase tracking-widest">Latest in-app backup:</span> {file.exists ? `${file.size_mb} MB` : "not found"}</p>
            <p className="truncate"><span className="text-gray-500 font-black uppercase tracking-widest">File:</span> {file.path || "—"}</p>
            <p><span className="text-gray-500 font-black uppercase tracking-widest">Critical counts:</span> clients {report.critical_counts?.clients ?? "—"} · dogs {report.critical_counts?.dogs ?? "—"} · bookings {report.critical_counts?.bookings ?? "—"} · archive {report.critical_counts?.bookings_archive ?? "—"}</p>
          </div>
          <div className="space-y-2 mb-3">
            {(report.checklist || []).map(item => (
              <div key={item.key} className="flex gap-2 bg-bgBase/50 border border-bgHover rounded p-2">
                <i className={`fas ${item.ok === true ? "fa-circle-check text-shGreen" : item.ok === false ? "fa-triangle-exclamation text-red-300" : "fa-square-check text-shBlue"} mt-0.5`}/>
                <div>
                  <p className="text-[12px] font-black uppercase tracking-widest text-white">{item.label}</p>
                  <p className="text-[12px] text-gray-400">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {warnings.length > 0 && (
            <div className="space-y-2 mb-3">
              {warnings.map(w => (
                <div key={w.key} className={`rounded border p-2 ${w.severity === "danger" ? "bg-red-500/10 border-red-500/40" : w.severity === "warn" ? "bg-shOrange/10 border-shOrange/40" : "bg-shBlue/10 border-shBlue/40"}`}>
                  <p className={`text-[11px] font-black uppercase tracking-widest ${w.severity === "danger" ? "text-red-300" : w.severity === "warn" ? "text-shOrange" : "text-shBlue"}`}><i className="fas fa-circle-info mr-1"/>{w.title}</p>
                  <p className="text-[12px] text-gray-300 mt-0.5">{w.detail}</p>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={load} disabled={busy} data-testid="pre-update-refresh"
                    className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:border-shBlue disabled:opacity-50">
              <i className={`fas fa-rotate ${busy ? "fa-spin" : ""} mr-1`}/>Refresh
            </button>
            <button onClick={validateLatest} disabled={busy} data-testid="pre-update-validate-latest"
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
              <i className="fas fa-vial-circle-check mr-1"/>Validate Latest In-App Backup
            </button>
          </div>
          {valid && (
            <div className={`mt-3 rounded border p-3 ${valid.ok ? "bg-shGreen/10 border-shGreen/40" : "bg-shOrange/10 border-shOrange/40"}`} data-testid="latest-backup-validation-result">
              <p className={`text-[12px] font-black uppercase tracking-widest ${valid.ok ? "text-shGreen" : "text-shOrange"}`}>{valid.ok ? "Backup parse test passed" : "Backup parse test needs review"}</p>
              <p className="text-[13px] text-gray-300">Version {valid.version || "—"} · {valid.collections || 0} collections · {valid.total_docs || 0} documents</p>
              {!!(valid.warnings || []).length && <p className="text-[12px] text-shOrange mt-1">{valid.warnings.length} warning(s). Open the validation details before relying on this file.</p>}
            </div>
          )}
          {history.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] text-gray-400 font-black uppercase tracking-widest">Recent validation history</summary>
              <div className="mt-2 space-y-1">
                {history.map(h => <div key={h.id} className="text-[12px] text-gray-400 flex justify-between gap-2 bg-bgBase/50 rounded px-2 py-1"><span>{new Date(h.created_at).toLocaleString()}</span><span className={h.ok ? "text-shGreen" : "text-shOrange"}>{h.ok ? "OK" : "Review"} · {h.total_docs || 0} docs</span></div>)}
              </div>
            </details>
          )}
        </>
      )}
      <p className="text-[11px] text-gray-500 mt-3 leading-relaxed"><strong>Host backup still matters:</strong> this validates the in-app JSON backup. For your Bazzite machine, still run <code className="text-gray-300">./backup-now.sh</code> before updates because that saves Mongo plus your environment file into <code className="text-gray-300">~/sit-happens-backups</code>.</p>
    </div>
  );
}

function ProductionHealthPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = async () => {
    setErr("");
    try { const r = await api.get("/admin/production-health"); setData(r.data); }
    catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to load production health"); }
  };
  useEffect(() => { load(); }, []);
  if (!data && !err) return null;
  const checks = data?.checks || [];
  const bad = checks.filter(c => !c.ok && c.severity === "danger").length;
  const warn = checks.filter(c => !c.ok && c.severity !== "danger").length;
  return (
    <div className="border border-bgHover rounded-xl p-4 bg-bgPanel" data-testid="production-health-panel">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h4 className="text-sm font-black text-shGreen uppercase tracking-widest"><i className="fas fa-heart-pulse mr-2"/>Production Health</h4>
          <p className="text-[13px] text-gray-400">Quick safety check before updates: database, backups, disk, email, and risky env defaults.</p>
        </div>
        <button onClick={load} className="bg-bgBase border border-bgHover text-gray-300 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:border-shGreen"><i className="fas fa-rotate mr-1"/>Refresh</button>
      </div>
      {err && <p className="text-red-400 text-[13px]">{err}</p>}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <HealthMini label="Danger" value={bad} color={bad ? "text-red-300" : "text-shGreen"}/>
            <HealthMini label="Warnings" value={warn} color={warn ? "text-shOrange" : "text-shGreen"}/>
            <HealthMini label="Collections" value={Object.keys(data.counts || {}).length} color="text-shBlue"/>
          </div>
          <div className="space-y-2">
            {checks.map(c => (
              <div key={c.key} className={`rounded border p-2 ${c.ok ? "bg-shGreen/10 border-shGreen/40" : c.severity === "danger" ? "bg-red-500/10 border-red-500/40" : "bg-shOrange/10 border-shOrange/40"}`}>
                <p className={`text-[11px] font-black uppercase tracking-widest ${c.ok ? "text-shGreen" : c.severity === "danger" ? "text-red-300" : "text-shOrange"}`}><i className={`fas ${c.ok ? "fa-check-circle" : "fa-triangle-exclamation"} mr-1`}/>{c.label}</p>
                <p className="text-[12px] text-gray-300 mt-0.5">{c.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-2 uppercase tracking-widest font-black">Checked {new Date(data.checked_at).toLocaleString()}</p>
        </>
      )}
    </div>
  );
}

function HealthMini({ label, value, color }) {
  return <div className="bg-bgBase/60 border border-bgHover rounded p-2"><p className="text-[10px] text-gray-500 font-black uppercase tracking-widest">{label}</p><p className={`text-lg font-black ${color}`}>{value}</p></div>;
}

function DiskUsagePanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true); setErr("");
    try { const { data } = await api.get("/admin/disk-usage"); setData(data); }
    catch (e) { setErr(e.response?.data?.detail || "Could not read disk usage"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const tone = (v) => v === "danger" ? "text-red-400 bg-red-500/15 border-red-500/40"
                    : v === "warn"   ? "text-shOrange bg-shOrange/15 border-shOrange/40"
                    :                  "text-shGreen bg-shGreen/15 border-shGreen/40";
  return (
    <div data-testid="disk-usage-panel">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-black text-shBlue uppercase tracking-widest"><i className="fas fa-hard-drive mr-2"/>Disk Usage</h4>
        <button onClick={load} disabled={busy} data-testid="disk-usage-refresh"
                className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-white disabled:opacity-50">
          <i className={`fas fa-rotate ${busy ? "fa-spin" : ""} mr-1`}/>Refresh
        </button>
      </div>
      <p className="text-[14px] text-gray-400 mb-3 leading-relaxed">
        Live snapshot of every drive/path this container can see. Mount more host drives into <code className="text-shBlue">docker-compose.yml</code> to make them appear here.
      </p>
      {err && <p className="text-red-400 text-[14px] mb-2">{err}</p>}
      {!data && !err && <p className="text-[14px] text-gray-500"><i className="fas fa-circle-notch fa-spin mr-2"/>Reading…</p>}
      {data && data.mountpoints.length === 0 && <p className="text-[14px] text-gray-500">No mountpoints found.</p>}
      <div className="space-y-2">
        {(data?.mountpoints || []).map((m) => (
          <div key={m.path} className="bg-bgBase border border-bgHover rounded-lg p-3"
               data-testid={`disk-row-${m.path}`}>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <div className="min-w-0">
                <p className="text-sm font-black text-white uppercase truncate">{m.label}</p>
                <p className="text-[12px] text-gray-500 font-mono truncate">{m.path} · {m.fs_type}{m.likely_ephemeral ? " · ephemeral!" : ""}</p>
              </div>
              <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${tone(m.verdict)}`}>
                {m.pct_used}% used
              </span>
            </div>
            <div className="h-2 rounded-full bg-bgHover overflow-hidden">
              <div className={`h-full ${m.verdict === "danger" ? "bg-red-500" : m.verdict === "warn" ? "bg-shOrange" : "bg-shGreen"}`}
                   style={{ width: `${Math.min(100, m.pct_used)}%` }} />
            </div>
            <p className="text-[12px] text-gray-400 font-black uppercase tracking-widest mt-1">
              {fmtBytes(m.free_bytes)} free · {fmtBytes(m.used_bytes)} used · {fmtBytes(m.total_bytes)} total
            </p>
          </div>
        ))}
      </div>
      {data && (
        <p className="text-[11px] text-gray-500 mt-2 uppercase tracking-widest font-black">
          Checked {new Date(data.checked_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

// ─────── Sprint 110av · Auto-Backup panel ───────
function AutoBackupPanel() {
  const [cfg, setCfg] = useState(null);
  const [runs, setRuns] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState({});
  const load = async () => {
    setBusy(true); setErr("");
    try {
      const [c, r] = await Promise.all([
        api.get("/admin/auto-backup/config"),
        api.get("/admin/auto-backup/runs", { params: { limit: 10 } }),
      ]);
      setCfg(c.data); setDraft(c.data); setRuns(r.data || []);
    } catch (e) { setErr(e.response?.data?.detail || "Failed to load auto-backup status"); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  const save = async () => {
    setBusy(true); setErr(""); setMsg("");
    try {
      const patch = {
        enabled: !!draft.enabled,
        hour: Number(draft.hour ?? 3),
        minute: Number(draft.minute ?? 0),
        path: draft.path || cfg.backup_root || "/app/backups",
        retain_days: Math.max(1, Number(draft.retain_days ?? 30)),
      };
      const { data } = await api.put("/admin/auto-backup/config", patch);
      setCfg(data); setDraft(data); setMsg("Saved ✓");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) { setErr(e.response?.data?.detail || "Save failed"); }
    finally { setBusy(false); }
  };
  const runNow = async () => {
    setRunning(true); setErr(""); setMsg("");
    try {
      const { data } = await api.post("/admin/auto-backup/run-now");
      setMsg(data.ok ? `Backup written · ${fmtBytes(data.size_bytes)}` : `Failed · ${data.error}`);
      await load();
    } catch (e) { setErr(e.response?.data?.detail || "Run failed"); }
    finally { setRunning(false); }
  };
  if (!cfg) return null;
  const targetVerdict = cfg.path_info?.verdict;
  const ephemeralWarn = cfg.path_info?.likely_ephemeral;
  return (
    <div className="border-t border-bgHover pt-6" data-testid="auto-backup-panel">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-black text-shGreen uppercase tracking-widest"><i className="fas fa-clock-rotate-left mr-2"/>Auto-Backup · Nightly</h4>
        <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded ${cfg.enabled ? "bg-shGreen/15 text-shGreen" : "bg-gray-500/15 text-gray-400"}`}
              data-testid="auto-backup-status">
          {cfg.enabled ? "On" : "Off"}
        </span>
      </div>
      <p className="text-[14px] text-gray-400 mb-3 leading-relaxed">
        Writes and verifies a gzipped JSON snapshot of <strong className="text-white">every business collection</strong> at the scheduled hour. Backups are stored on the host-mounted persistent backup folder, so they survive container rebuilds.
      </p>

      {err && <p className="text-red-400 text-[14px] mb-2" data-testid="auto-backup-error">{err}</p>}
      {msg && <p className="text-shGreen text-[14px] mb-2" data-testid="auto-backup-msg"><i className="fas fa-check mr-1"/>{msg}</p>}

      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={!!draft.enabled}
                 onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                 data-testid="auto-backup-enabled"
                 className="w-5 h-5 accent-shGreen"/>
          <span className="text-[14px] font-black text-white uppercase tracking-widest">Enable nightly backup</span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Hour (0-23)</span>
            <input type="number" min={0} max={23} value={draft.hour ?? 3}
                   onChange={(e) => setDraft({ ...draft, hour: e.target.value })}
                   data-testid="auto-backup-hour"
                   className="mt-1 block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
          <label className="block">
            <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Minute</span>
            <input type="number" min={0} max={59} value={draft.minute ?? 0}
                   onChange={(e) => setDraft({ ...draft, minute: e.target.value })}
                   data-testid="auto-backup-minute"
                   className="mt-1 block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
        </div>

        <label className="block">
          <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Persistent backup folder</span>
          <input type="text" value={draft.path || cfg.backup_root || "/app/backups"}
                 onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                 placeholder={cfg.backup_root || "/app/backups"}
                 data-testid="auto-backup-path"
                 className="mt-1 block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm font-mono"/>
          <p className="text-[12px] mt-1 text-gray-500">
            Must be <span className="font-mono text-gray-300">{cfg.backup_root || "/app/backups"}</span> or a subfolder inside it. This maps to the host's <span className="font-mono text-gray-300">./backups</span> folder.
          </p>
          {cfg.path_info && (
            <p className={`text-[12px] mt-1 ${targetVerdict === "danger" ? "text-red-400" : targetVerdict === "warn" ? "text-shOrange" : "text-shGreen"}`}>
              <i className="fas fa-hard-drive mr-1"/>
              {fmtBytes(cfg.path_info.free_bytes)} free on {cfg.path_info.fs_type}
              {ephemeralWarn && <span className="text-red-400"> · ⚠️ ephemeral — mount a host folder here!</span>}
            </p>
          )}
        </label>

        <label className="block">
          <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Retain (days)</span>
          <input type="number" min={1} max={3650} value={draft.retain_days ?? 30}
                 onChange={(e) => setDraft({ ...draft, retain_days: e.target.value })}
                 data-testid="auto-backup-retain"
                 className="mt-1 block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        </label>

        <div className="flex gap-2">
          <button onClick={save} disabled={busy} data-testid="auto-backup-save"
                  className="bg-shGreen text-bgHeader px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
            <i className="fas fa-save mr-1"/>Save
          </button>
          <button onClick={runNow} disabled={running} data-testid="auto-backup-run-now"
                  className="bg-shBlue text-bgHeader px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
            <i className={`fas ${running ? "fa-circle-notch fa-spin" : "fa-play"} mr-1`}/>{running ? "Running…" : "Run Now"}
          </button>
        </div>
      </div>

      {cfg.last_run && (
        <div className="mt-4 bg-bgBase border border-bgHover rounded p-3 text-[13px] text-gray-300" data-testid="auto-backup-last-run">
          <p className="text-[12px] font-black uppercase tracking-widest text-gray-500">Last run</p>
          <p>
            {new Date(cfg.last_run).toLocaleString()} · {cfg.last_ok ? <span className="text-shGreen font-black">OK</span> : <span className="text-red-400 font-black">FAILED</span>}
            {cfg.last_verified && <span className="text-shBlue font-black"> · VERIFIED</span>}
            {cfg.last_size_bytes ? ` · ${fmtBytes(cfg.last_size_bytes)}` : ""}
          </p>
          {cfg.last_file && <p className="text-[12px] text-gray-500 font-mono mt-1 truncate">{cfg.last_file}</p>}
          {cfg.last_sha256 && <p className="text-[11px] text-gray-600 font-mono mt-1 truncate">SHA-256: {cfg.last_sha256}</p>}
          {cfg.last_error && <p className="text-[12px] text-red-400 mt-1">{cfg.last_error}</p>}
        </div>
      )}

      {runs.length > 0 && (
        <details className="mt-3" data-testid="auto-backup-history">
          <summary className="text-[12px] font-black uppercase tracking-widest text-gray-400 cursor-pointer hover:text-white">
            Show last {runs.length} run{runs.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 space-y-1">
            {runs.map(r => (
              <div key={r.id} className="bg-bgBase/60 border border-bgHover/40 rounded px-3 py-2 text-[12px] flex items-center justify-between gap-3">
                <span className="font-mono text-gray-300 truncate">{new Date(r.started_at).toLocaleString()}</span>
                <span className="text-gray-400 font-black uppercase tracking-widest">{r.trigger}</span>
                <span className={r.ok ? "text-shGreen font-black" : r.status === "skipped" ? "text-shOrange font-black" : "text-red-400 font-black"}>
                  {r.ok ? `${fmtBytes(r.size_bytes)}${r.verified ? " · VERIFIED" : ""}` : r.status === "skipped" ? "SKIPPED" : "FAIL"}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function UserMigrationSection() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState(null);

  const downloadExport = async () => {
    setBusy(true); setMsg("");
    try {
      const { data } = await api.get("/admin/users/export-with-hashes");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `sit-happens-users-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Exported ${data.user_count} user accounts ✓`);
    } catch (e) {
      setMsg("Export failed — " + (formatErr(e.response?.data?.detail) || "unknown error"));
    }
    setBusy(false);
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";  // allow re-select same file
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMsg("That file isn't valid JSON.");
      return;
    }
    if (!Array.isArray(parsed.users)) {
      setMsg("Wrong format — expected a file from 'Export Users' button.");
      return;
    }
    const ok = await confirm({
      title: `Import ${parsed.users.length} user accounts?`,
      message: "Existing accounts with the same email will be updated. New ones will be inserted. Your own admin account is left untouched. Clients will be able to log in with their original passwords.",
      confirmText: "Import users",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true); setMsg(""); setResult(null);
    try {
      const { data } = await api.post("/admin/users/import-with-hashes", { users: parsed.users, mode: "merge" });
      setResult(data);
      setMsg(`Imported ✓ — ${data.inserted} new, ${data.updated} updated`);
    } catch (e) {
      setMsg("Import failed — " + (formatErr(e.response?.data?.detail) || "unknown error"));
    }
    setBusy(false);
  };

  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-4 space-y-3" data-testid="user-migration-section">
      <div>
        <p className="text-shGreen font-black uppercase tracking-widest text-[14px]"><i className="fas fa-key mr-2"/>Migrate User Logins (with passwords)</p>
        <p className="text-[14px] text-gray-400 mt-1 leading-relaxed">
          Move clients to a new host without making them reset their passwords. On your <span className="text-white font-black">old instance</span>, click Export. On your <span className="text-white font-black">new instance</span>, click Import and pick that file. Existing passwords keep working.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={downloadExport} disabled={busy} data-testid="user-export-btn"
                className="bg-shGreen text-bgHeader px-5 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
          <i className="fas fa-download mr-2"/>Export Users
        </button>
        <label className="bg-shBlue text-white px-5 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg cursor-pointer hover:bg-shBlue/90 disabled:opacity-50">
          <i className="fas fa-upload mr-2"/>Import Users
          <input type="file" accept="application/json,.json" onChange={importFile} disabled={busy} className="hidden" data-testid="user-import-file" />
        </label>
      </div>
      {msg && (
        <div className={`text-[14px] font-black uppercase tracking-widest p-2 rounded ${msg.includes("✓") ? "bg-shGreen/15 text-shGreen" : "bg-red-500/15 text-red-400"}`} data-testid="user-migration-msg">
          {msg}
        </div>
      )}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[14px]" data-testid="user-migration-result">
          <StatChip label="Inserted" value={result.inserted} color="text-shGreen" />
          <StatChip label="Updated" value={result.updated} color="text-shBlue" />
          <StatChip label="Skipped (Self)" value={result.skipped_self} color="text-gray-400" />
          <StatChip label="Skipped (No Hash)" value={result.skipped_no_email_or_hash} color="text-gray-400" />
        </div>
      )}
    </div>
  );
}

function BulkClaimEmailsSection() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const send = async () => {
    const ok = await confirm({
      title: "Send claim emails to all clients?",
      message: "Every client with an email and no portal login yet will receive a one-time link to set their password. Already-linked clients are skipped automatically. This may take a minute for large lists.",
      confirmText: "Send claim emails",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const { data } = await api.post("/clients/send-claim-emails/bulk");
      setResult(data);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Bulk send failed");
    }
    setBusy(false);
  };

  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-4 space-y-3" data-testid="bulk-claim-section">
      <div>
        <p className="text-shBlue font-black uppercase tracking-widest text-[14px]"><i className="fas fa-paper-plane mr-2"/>Mass Claim Emails (Recovery)</p>
        <p className="text-[14px] text-gray-400 mt-1 leading-relaxed">
          One-shot tool for migrations: emails every client a link to set their password. Use this after restoring a backup that contained clients but not their login credentials.
          Clients who already have a portal login are skipped automatically.
        </p>
      </div>
      <button onClick={send} disabled={busy} data-testid="bulk-claim-btn"
              className="bg-shBlue text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
        {busy ? <><i className="fas fa-spinner fa-spin mr-2"/>Sending…</> : <><i className="fas fa-envelopes-bulk mr-2"/>Send Claim Emails to All Clients</>}
      </button>
      {err && <div className="text-[14px] font-black uppercase tracking-widest p-2 rounded bg-red-500/15 text-red-400">{err}</div>}
      {result && (
        <div className="bg-bgPanel rounded p-3 space-y-2" data-testid="bulk-claim-result">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[14px]">
            <StatChip label="Total Clients" value={result.total_clients} color="text-gray-300" />
            <StatChip label="Sent ✓" value={result.sent_count} color="text-shGreen" />
            <StatChip label="No Email" value={result.skipped_no_email_count} color="text-gray-400" />
            <StatChip label="Already Linked" value={result.skipped_already_linked_count} color="text-gray-400" />
          </div>
          {result.errors_count > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-[15px]">
              <p className="text-red-400 font-black uppercase tracking-widest mb-1">{result.errors_count} error{result.errors_count===1?"":"s"}:</p>
              <ul className="text-gray-300 space-y-0.5">
                {result.errors.slice(0,5).map((e,i)=>(
                  <li key={i}>· {e.name} ({e.email}): {e.error}</li>
                ))}
                {result.errors.length > 5 && <li className="text-gray-500">…and {result.errors.length-5} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div className="bg-bgBase rounded px-2 py-2 flex flex-col items-center">
      <span className="text-[13px] text-gray-500 font-black uppercase tracking-widest">{label}</span>
      <span className={`text-xl font-black ${color}`}>{value}</span>
    </div>
  );
}

function PhotoCompressionPanel() {
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { const { data } = await api.get("/admin/compress-photos/status"); setStatus(data); }
    catch (e) { setErr(e.response?.data?.detail || "Could not fetch status"); }
  };

  // Poll while running.
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [status?.running]);

  const start = async () => {
    if (!(await confirm({ title: "Shrink all photos?", body: "This will recompress every photo in your database (dogs, gallery, report cards, incidents). It runs in the background and may take several minutes. Safe to leave the page during the job.", confirmText: "Start compression", tone: "warning" }))) return;
    setBusy(true); setErr("");
    try { const { data } = await api.post("/admin/compress-photos"); setStatus(data); }
    catch (e) { setErr(e.response?.data?.detail || "Could not start"); }
    finally { setBusy(false); }
  };

  const finished = status && !status.running && status.finished_at;
  const stageLabel = {
    "starting": "Getting ready…",
    "dogs": "Compressing dog photos & gallery",
    "bookings": "Compressing report card photos",
    "incidents": "Compressing incident photos",
    "done": "All done",
  }[status?.current_stage] || (status?.running ? "Working…" : "Idle");

  return (
    <div className="border-t border-bgHover pt-6" data-testid="photo-compress-panel">
      <h4 className="text-sm font-black text-purple-400 uppercase tracking-widest mb-2"><i className="fas fa-compress-arrows-alt mr-2"/>Shrink Existing Photos</h4>
      <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
        One-time job that recompresses every photo currently in your database to the smaller format used by new uploads. Typical savings: <span className="text-purple-400 font-black">10–20× smaller</span> per photo with no visible quality loss. Safe to run again later — already-small photos are skipped automatically.
      </p>

      {status && (
        <div className="bg-bgBase border border-bgHover rounded p-4 mb-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-center" data-testid="photo-compress-stats">
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Scanned</p>
            <p className="text-shBlue text-2xl font-black">{status.scanned}</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Compressed</p>
            <p className="text-shGreen text-2xl font-black">{status.compressed}</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Skipped</p>
            <p className="text-gray-400 text-2xl font-black">{status.skipped}</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Space saved</p>
            <p className="text-purple-400 text-2xl font-black">{status.mb_saved} MB</p>
          </div>
        </div>
      )}

      {status?.running && (
        <div className="bg-shBlue/10 border border-shBlue/40 rounded p-3 mb-3 flex items-center gap-3" data-testid="photo-compress-progress">
          <i className="fas fa-circle-notch fa-spin text-shBlue text-xl"/>
          <div className="flex-1">
            <p className="text-[14px] font-black text-shBlue uppercase tracking-widest">{stageLabel}</p>
            <p className="text-[14px] text-gray-400 mt-0.5">Working in the background. You can leave this page and come back later.</p>
          </div>
        </div>
      )}

      {finished && status.error_message && (
        <p className="text-red-400 text-[14px] font-black mb-3" data-testid="photo-compress-error">
          <i className="fas fa-exclamation-triangle mr-2"/>{status.error_message}
        </p>
      )}

      {finished && !status.error_message && status.compressed > 0 && (
        <p className="text-shGreen text-[14px] font-black mb-3" data-testid="photo-compress-done">
          <i className="fas fa-check-circle mr-2"/>Saved {status.mb_saved} MB across {status.compressed} photos.
        </p>
      )}

      <button onClick={start} disabled={busy || status?.running} data-testid="photo-compress-start"
              className="bg-purple-500 text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
        <i className="fas fa-compress-arrows-alt mr-2"/>{status?.running ? "Running…" : (status?.finished_at ? "Run again" : "Shrink all photos")}
      </button>
      {err && <p className="text-red-400 text-[14px] mt-2">{err}</p>}
    </div>
  );
}

function CommandsPanel() {
  const confirm = useConfirm();
  const [commands, setCommands] = useState([]);
  const [meta, setMeta] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [c, m] = await Promise.all([api.get("/commands"), api.get("/training/meta")]);
      setCommands(c.data); setMeta(m.data);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const startNew = () => setEdit({ name: "", category: "obedience", description: "", video_url: "", order: 100, active: true });
  const save = async () => {
    try {
      if (edit.id) await api.put(`/commands/${edit.id}`, edit);
      else await api.post("/commands", edit);
      setEdit(null); load();
    } catch (e) { setErr(e.response?.data?.detail || "Save failed"); }
  };
  const remove = async (id) => {
    if (!(await confirm({ title: "Remove command?", body: "Existing dog progress is preserved. The command will no longer be available for new training plans.", confirmText: "Remove", tone: "warning" }))) return;
    try { await api.delete(`/commands/${id}`); load(); } catch (e) { setErr(e.response?.data?.detail || "Delete failed"); }
  };

  if (!meta) return <p className="text-gray-500 text-sm">Loading…</p>;
  const grouped = meta.categories.map(c => ({...c, items: commands.filter(x => x.category === c.key)}));

  return (
    <div className="space-y-5 max-w-3xl" data-testid="commands-panel">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-black text-shBlue uppercase tracking-widest"><i className="fas fa-graduation-cap mr-2"/>Service-Dog Command Library</h4>
          <p className="text-[14px] text-gray-300 mt-1">Curate the master list every dog's curriculum is built from. Seeded with TADSAW service-dog commands.</p>
        </div>
        <button onClick={startNew} data-testid="cmd-new"
                className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow"><i className="fas fa-plus mr-1"/>New</button>
      </div>

      {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-2 uppercase font-black">{err}</div>}

      {grouped.map(g => (
        <div key={g.key} className="bg-bgBase/40 border border-bgHover rounded">
          <div className="px-3 py-2 border-b border-bgHover" style={{background: g.color + "12"}}>
            <p className="text-[15px] font-black uppercase tracking-widest" style={{color: g.color}}>{g.label} · {g.items.length}</p>
          </div>
          <div className="divide-y divide-bgHover">
            {g.items.map(c => (
              <div key={c.id} className="px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white truncate">{c.name} {c.is_default && <span className="text-[13px] text-gray-500 font-black tracking-widest ml-2">(default)</span>}</p>
                  <p className="text-[15px] text-gray-400 truncate">{c.description}</p>
                </div>
                {c.video_url && <i className="fab fa-youtube text-red-500"/>}
                <button onClick={()=>setEdit({...c})} data-testid={`cmd-edit-${c.id}`} className="text-shBlue hover:text-white text-sm"><i className="fas fa-pen"/></button>
                <button onClick={()=>remove(c.id)} className="text-red-400 hover:text-red-300 text-sm"><i className="fas fa-trash"/></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {edit && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="cmd-modal">
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-black text-white uppercase italic">{edit.id?"Edit Command":"New Command"}</h4>
              <button onClick={()=>setEdit(null)} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Name *</label>
                <input value={edit.name} onChange={(e)=>setEdit({...edit, name:e.target.value})} data-testid="cmd-name"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Category</label>
                <select value={edit.category} onChange={(e)=>setEdit({...edit, category:e.target.value})}
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {meta.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Description</label>
                <textarea value={edit.description||""} onChange={(e)=>setEdit({...edit, description:e.target.value})} rows={2}
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">YouTube video URL (optional)</label>
                <input value={edit.video_url||""} onChange={(e)=>setEdit({...edit, video_url:e.target.value})} data-testid="cmd-video"
                       placeholder="https://youtu.be/..."
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={()=>setEdit(null)} className="text-gray-500 font-black uppercase text-[15px] tracking-widest">Cancel</button>
                <button onClick={save} data-testid="cmd-save"
                        className="bg-shGreen text-bgHeader px-6 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function AutomationPanel() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const [err, setErr] = useState("");
  const [emailPerStep, setEmailPerStep] = useState(null); // null = loading
  const [stepBusy, setStepBusy] = useState(false);
  // Sprint 110aw — Birthday email toggle (default ON). Setting key:
  //   settings.birthday_email.enabled
  const [bdayOn, setBdayOn] = useState(null);
  const [bdayBusy, setBdayBusy] = useState(false);
  useEffect(() => {
    api.get("/settings").then(r => {
      setEmailPerStep(!!r.data?.email_per_step);
      setBdayOn((r.data?.birthday_email?.enabled ?? true) === true);
    }).catch(() => { setEmailPerStep(false); setBdayOn(true); });
  }, []);
  const toggleEmailPerStep = async () => {
    setStepBusy(true);
    try {
      const next = !emailPerStep;
      await api.put("/settings", { email_per_step: next });
      setEmailPerStep(next);
    } catch {} finally { setStepBusy(false); }
  };
  const toggleBday = async () => {
    setBdayBusy(true);
    try {
      const next = !bdayOn;
      await api.put("/settings", { birthday_email: { enabled: next } });
      setBdayOn(next);
    } catch {} finally { setBdayBusy(false); }
  };
  const run = async () => {
    setBusy(true); setErr(""); setLast(null);
    try {
      const { data } = await api.post("/admin/daily-jobs/run-now");
      setLast(data?.result || {});
    } catch (e) {
      setErr(e.response?.data?.detail || "Run failed");
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5 max-w-2xl" data-testid="automation-panel">
      <div>
        <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Email Automation & Notifications</h4>
        <p className="text-[15px] text-gray-500 font-black uppercase tracking-widest mt-1 normal-case">Background jobs that run automatically at most once per day, triggered the first time the admin dashboard loads each morning.</p>
      </div>

      {/* Sprint 105 — Per-step homework email toggle */}
      <div className="bg-bgBase border border-bgHover rounded-lg p-4" data-testid="email-per-step-row">
        <div className="flex items-start gap-3">
          <i className="fas fa-list-check text-shBlue text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Per-step homework emails</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">
              Default is <strong>off</strong> — instead, you get one nightly roll-up email at the end of the day with every step completed. Turn this on if you want a real-time email every time a client checks off ANY step. Heads-up: this can be a lot of emails.
            </p>
          </div>
          <button onClick={toggleEmailPerStep} disabled={stepBusy || emailPerStep === null}
                  data-testid="email-per-step-toggle"
                  className={`shrink-0 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest transition ${
                    emailPerStep ? "bg-shGreen text-bgHeader hover:bg-shGreen/90"
                                  : "bg-bgPanel text-gray-400 hover:bg-bgHover border border-bgHover"
                  } disabled:opacity-50`}>
            {emailPerStep === null ? "…" : emailPerStep ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="bg-bgBase border border-bgHover rounded-lg p-4 flex items-start gap-3">
          <i className="fas fa-cake-candles text-shGreen text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Dog Birthday Cards</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">Emails the owner a celebratory card with their dog's photo on the dog's birthday. De-duped per dog per year.</p>
          </div>
          <button onClick={toggleBday} disabled={bdayBusy || bdayOn === null}
                  data-testid="birthday-email-toggle"
                  className={`shrink-0 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest transition ${
                    bdayOn ? "bg-shGreen text-bgHeader hover:bg-shGreen/90"
                            : "bg-bgPanel text-gray-400 hover:bg-bgHover border border-bgHover"
                  } disabled:opacity-50`}>
            {bdayOn === null ? "…" : bdayOn ? "On" : "Off"}
          </button>
        </div>
        <div className="bg-bgBase border border-bgHover rounded-lg p-4 flex items-start gap-3">
          <i className="fas fa-syringe text-shOrange text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Vaccine Renewal Nudge</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">30 days before any vaccine expires, the owner gets a single email listing which renewals are due with a link to upload the updated record.</p>
          </div>
          <span className="bg-shOrange/15 text-shOrange text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded">On</span>
        </div>
        <div className="bg-bgBase border border-bgHover rounded-lg p-4 flex items-start gap-3">
          <i className="fas fa-envelope-open-text text-shBlue text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Homework Daily Roll-up</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">One email at the end of each day summarising every step a client checked off — grouped by dog + plan. Replaces per-step spam.</p>
          </div>
          <span className="bg-shGreen/15 text-shGreen text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded">On</span>
        </div>
      </div>

      <div className="bg-bgBase border border-bgHover rounded-lg p-4">
        <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Manual trigger</p>
        <p className="text-[14px] text-gray-500 normal-case mt-1">Force-runs all daily jobs right now (clears today's "already ran" flag). Useful for testing.</p>
        <button onClick={run} disabled={busy} data-testid="run-daily-jobs-btn"
                className="mt-3 bg-shBlue text-white px-5 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
          {busy ? <><i className="fas fa-circle-notch fa-spin mr-2"/>Running…</> : <><i className="fas fa-play mr-2"/>Run Daily Jobs Now</>}
        </button>
        {err && <p className="text-red-400 text-[14px] mt-2 normal-case">{err}</p>}
        {last && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-[14px] font-black uppercase tracking-widest">
            <div className="bg-bgPanel rounded p-3">
              <p className="text-gray-500">Birthdays</p>
              <p className="text-shGreen text-[20px]">{last.birthdays?.sent ?? 0}<span className="text-gray-500 text-[14px] ml-1">sent</span></p>
              <p className="text-gray-600 text-[13px]">{last.birthdays?.skipped ?? 0} skipped</p>
            </div>
            <div className="bg-bgPanel rounded p-3">
              <p className="text-gray-500">Vaccine Renewals</p>
              <p className="text-shOrange text-[20px]">{last.vaccine_expiry?.sent ?? 0}<span className="text-gray-500 text-[14px] ml-1">sent</span></p>
              <p className="text-gray-600 text-[13px]">{last.vaccine_expiry?.skipped ?? 0} skipped</p>
            </div>
          </div>
        )}
      </div>

      <DogFactsPanel/>
      <TriviaPanel/>
    </div>
  );
}

// ─────── Sprint 110bi · Dog Trivia question pool management ───────
function TriviaPanel() {
  const [view, setView] = useState("leaderboard"); // leaderboard | rewards | questions
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(0);
  const [count, setCount] = useState(15);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [lb, setLb] = useState(null);
  const [editing, setEditing] = useState(null); // null | {mode: "new"} | {mode: "edit", q}
  const [rewards, setRewards] = useState(null);
  const [rewardsDefaults, setRewardsDefaults] = useState([]);
  const [savingRewards, setSavingRewards] = useState(false);

  const loadQuestions = async () => {
    try {
      const r = await api.get("/admin/trivia/questions");
      setRows(r.data.questions || []); setActive(r.data.active || 0);
    } catch (e) { setErr(e.response?.data?.detail || "Could not load"); }
  };
  const loadLeaderboard = async () => {
    try { const r = await api.get("/admin/trivia/leaderboard"); setLb(r.data); }
    catch (e) { setErr(e.response?.data?.detail || "Could not load leaderboard"); }
  };
  const loadRewards = async () => {
    try {
      const r = await api.get("/admin/trivia/rewards");
      setRewards(r.data.milestones || []);
      setRewardsDefaults(r.data.defaults || []);
    } catch (e) { setErr(e.response?.data?.detail || "Could not load rewards"); }
  };
  useEffect(() => { loadQuestions(); loadLeaderboard(); loadRewards(); }, []);

  const saveRewards = async () => {
    setSavingRewards(true); setErr("");
    try {
      const r = await api.put("/admin/trivia/rewards", { milestones: rewards });
      setRewards(r.data.milestones);
    } catch (e) { setErr(e.response?.data?.detail || "Save failed"); }
    finally { setSavingRewards(false); }
  };
  const addReward = () => setRewards(rs => [...(rs || []), { days: 60, label: "", perk_type: "" }]);
  const updateReward = (i, patch) => setRewards(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const removeReward = (i) => setRewards(rs => rs.filter((_, idx) => idx !== i));
  const resetRewards = () => setRewards(rewardsDefaults.map(d => ({ ...d })));

  const generate = async () => {
    setBusy(true); setErr("");
    try { await api.post("/admin/trivia/generate", { count: Number(count) || 10 }); await loadQuestions(); }
    catch (e) { setErr(e.response?.data?.detail || "Generation failed"); }
    finally { setBusy(false); }
  };
  const toggle = async (q) => {
    try { await api.put(`/admin/trivia/questions/${q.id}/active`, { active: !q.active }); loadQuestions(); }
    catch (e) { setErr(e.response?.data?.detail || "Toggle failed"); }
  };
  const del = async (q) => {
    if (!window.confirm("Delete this question? This cannot be undone.")) return;
    try { await api.delete(`/admin/trivia/questions/${q.id}`); loadQuestions(); }
    catch (e) { setErr(e.response?.data?.detail || "Delete failed"); }
  };
  const redeem = async (m) => {
    if (!window.confirm(`Mark ${m.client_name}'s ${m.days}-day milestone as redeemed?`)) return;
    try {
      await api.post("/admin/trivia/milestones/redeem", {
        client_id: m.client_id, days: m.days, earned_on: m.earned_on,
      });
      await loadLeaderboard();
    } catch (e) { setErr(e.response?.data?.detail || "Redeem failed"); }
  };

  const tagColor = {
    breeds: "text-amber-300", behavior: "text-purple-300", health: "text-emerald-300",
    history: "text-blue-300", training: "text-shOrange", anatomy: "text-pink-300",
    fun: "text-shGreen", myth: "text-red-300",
  };

  return (
    <div className="border-t border-bgHover pt-6 mt-6" data-testid="trivia-panel">
      <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
        <div>
          <h3 className="text-white font-black uppercase italic"><i className="fas fa-puzzle-piece text-shBlue mr-2"/>Dog Trivia</h3>
          <p className="text-[12px] text-gray-500">{active} active question{active === 1 ? "" : "s"} · {rows.length} total · Wordle-style daily card on client portal</p>
        </div>
        <div className="flex gap-1 bg-bgBase rounded p-1 border border-bgHover">
          {[["leaderboard","Leaderboard","fa-trophy"],["rewards","Goals","fa-bullseye"],["questions","Questions","fa-list"]].map(([k,l,i])=>(
            <button key={k} onClick={()=>setView(k)} data-testid={`trivia-view-${k}`}
                    className={`px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest ${view===k ? "bg-shBlue text-bgHeader" : "text-gray-400 hover:text-white"}`}>
              <i className={`fas ${i} mr-1`}/>{l}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="bg-red-500/10 border border-red-400 text-red-300 rounded p-2 text-[13px] mb-3" data-testid="trivia-err">{err}</div>}

      {view === "leaderboard" && (
        <div className="space-y-3" data-testid="trivia-admin-leaderboard">
          {!lb ? <p className="text-gray-500 text-sm">Loading…</p> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Kpi label="Total players" value={lb.total_players} testId="trivia-lb-players"/>
                <Kpi label="Total answers" value={lb.total_attempts} testId="trivia-lb-attempts"/>
                <Kpi label="Pending perks" value={lb.pending_milestones.length} color="shOrange" testId="trivia-lb-pending"/>
                <Kpi label="Top streak" value={lb.players[0]?.current_streak ?? 0} color="shGreen" testId="trivia-lb-topstreak"/>
              </div>

              {lb.pending_milestones.length > 0 && (
                <div className="bg-shOrange/5 border border-shOrange/40 rounded-xl p-3" data-testid="trivia-pending-list">
                  <p className="text-[12px] font-black uppercase tracking-widest text-shOrange mb-2">
                    <i className="fas fa-gift mr-1"/>Perks to award at next checkout
                  </p>
                  <div className="space-y-1">
                    {lb.pending_milestones.map((m,i) => (
                      <div key={`${m.client_id}-${m.days}-${m.earned_on}-${i}`}
                           className="flex justify-between items-center bg-bgBase rounded p-2 text-[13px]"
                           data-testid={`trivia-perk-${m.client_id}-${m.days}`}>
                        <div>
                          <p className="text-white font-bold">{m.client_name}{m.dogs?.length ? <span className="text-gray-500 font-normal"> · {m.dogs.join(", ")}</span> : null}</p>
                          <p className="text-[11px] text-gray-400">
                            <strong className="text-shOrange">{m.days}-day streak</strong> · earned {m.earned_on}
                          </p>
                        </div>
                        <button onClick={()=>redeem(m)} data-testid={`trivia-perk-redeem-${m.client_id}-${m.days}`}
                                className="bg-shGreen text-bgHeader px-3 py-1 rounded text-[11px] font-black uppercase tracking-widest">
                          <i className="fas fa-check mr-1"/>Redeemed
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {lb.players.length === 0 ? (
                <p className="text-gray-500 text-sm italic">No one has played yet — the daily card lives on the client portal home.</p>
              ) : (
                <div className="bg-bgBase rounded-xl border border-bgHover overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead className="text-[10px] font-black uppercase tracking-widest text-gray-500 border-b border-bgHover bg-bgPanel/60">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Player</th>
                        <th className="px-3 py-2 text-left">Dogs</th>
                        <th className="px-3 py-2 text-right">Current 🔥</th>
                        <th className="px-3 py-2 text-right">Best</th>
                        <th className="px-3 py-2 text-right">Correct</th>
                        <th className="px-3 py-2 text-right hidden sm:table-cell">Accuracy</th>
                        <th className="px-3 py-2 text-left hidden md:table-cell">Last played</th>
                        <th className="px-3 py-2 text-left">Earned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lb.players.map(p => (
                        <tr key={p.client_id} className="border-b border-bgHover/40 hover:bg-bgPanel/40"
                            data-testid={`trivia-lb-player-${p.client_id}`}>
                          <td className="px-3 py-2 text-gray-400 font-black">#{p.rank}</td>
                          <td className="px-3 py-2">
                            <p className="text-white font-bold">{p.name}</p>
                            <p className="text-[11px] text-gray-500">{p.email}</p>
                          </td>
                          <td className="px-3 py-2 text-gray-400 text-[12px] truncate max-w-[160px]">{p.dogs.join(", ") || "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-black ${p.current_streak >= 7 ? "text-shGreen" : p.current_streak >= 3 ? "text-shOrange" : "text-white"}`}>
                              {p.current_streak}d
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-300">{p.best_streak}d</td>
                          <td className="px-3 py-2 text-right text-gray-300">{p.total_correct}/{p.total_attempts}</td>
                          <td className="px-3 py-2 text-right text-gray-400 hidden sm:table-cell">{p.accuracy_pct}%</td>
                          <td className="px-3 py-2 text-gray-500 text-[12px] hidden md:table-cell">{p.last_played}</td>
                          <td className="px-3 py-2 text-[11px] text-gray-400">
                            {p.milestones && p.milestones.length > 0 ? (
                              <span className="space-x-1">
                                {p.milestones.map((m,i)=>(
                                  <span key={i} className={`inline-block px-1.5 py-0.5 rounded ${m.redeemed_at ? "bg-bgPanel text-gray-500" : "bg-shOrange/15 text-shOrange border border-shOrange/30 font-bold"}`}
                                        title={m.redeemed_at ? `Redeemed ${m.redeemed_at.slice(0,10)}` : `Pending — earned ${m.earned_on}`}>
                                    {m.days}d{m.redeemed_at ? "✓" : "!"}
                                  </span>
                                ))}
                              </span>
                            ) : <span className="text-gray-600">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {view === "rewards" && (
        <div className="space-y-3" data-testid="trivia-rewards-view">
          <div className="bg-shGreen/5 border border-shGreen/30 rounded-xl p-3 text-[13px] text-gray-300">
            <i className="fas fa-circle-info text-shGreen mr-2"/>
            Pick your own streak goals + perks. Each entry is awarded when a client's
            <strong className="text-shGreen"> current daily-trivia streak </strong> reaches or passes the day count.
            The label is what the client sees on their portal and what shows in your Rewards Center pending list.
          </div>
          {!rewards ? <p className="text-gray-500 text-sm">Loading…</p> : (
            <>
              <div className="space-y-2">
                {rewards.length === 0 && (
                  <p className="text-gray-500 italic text-sm" data-testid="trivia-rewards-empty">No goals set — clients won't earn perks. Tap "Add goal" below.</p>
                )}
                {rewards.map((r, i) => (
                  <div key={i} className="bg-bgBase rounded-lg border border-bgHover p-3 grid grid-cols-12 gap-2 items-start" data-testid={`trivia-reward-${i}`}>
                    <label className="col-span-3 sm:col-span-2 block">
                      <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Day #</span>
                      <input type="number" min={1} max={3650} value={r.days}
                             onChange={e => updateReward(i, { days: Number(e.target.value) || 0 })}
                             data-testid={`trivia-reward-days-${i}`}
                             className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1"/>
                    </label>
                    <label className="col-span-9 sm:col-span-7 block">
                      <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Perk message (clients see this)</span>
                      <input type="text" value={r.label} maxLength={200}
                             placeholder="🐾 7-day streak — free puzzle toy at pickup!"
                             onChange={e => updateReward(i, { label: e.target.value })}
                             data-testid={`trivia-reward-label-${i}`}
                             className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1"/>
                    </label>
                    <label className="col-span-9 sm:col-span-2 block">
                      <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Tag (internal)</span>
                      <input type="text" value={r.perk_type || ""} maxLength={50}
                             placeholder="puzzle_toy"
                             onChange={e => updateReward(i, { perk_type: e.target.value })}
                             data-testid={`trivia-reward-tag-${i}`}
                             className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1"/>
                    </label>
                    <label className="col-span-6 sm:col-span-2 block">
                      <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Auto credit</span>
                      <select value={r.reward_service || ""} onChange={e => updateReward(i, { reward_service: e.target.value })}
                              data-testid={`trivia-reward-credit-service-${i}`}
                              className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1">
                        <option value="">Manual prize</option>
                        <option value="daycare">Daycare</option>
                        <option value="boarding">Boarding</option>
                        <option value="training">Training</option>
                      </select>
                    </label>
                    <label className="col-span-3 sm:col-span-1 block">
                      <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Credits</span>
                      <input type="number" min="0" step="0.5" value={r.reward_credits || ""}
                             onChange={e => updateReward(i, { reward_credits: Number(e.target.value) || 0 })}
                             data-testid={`trivia-reward-credit-amount-${i}`}
                             className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1"/>
                    </label>
                    <div className="col-span-3 sm:col-span-1 flex justify-end items-center pt-5">
                      <button onClick={() => removeReward(i)}
                              data-testid={`trivia-reward-delete-${i}`}
                              className="text-gray-500 hover:text-red-400 p-2">
                        <i className="fas fa-trash"/>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between flex-wrap gap-2">
                <div className="flex gap-2">
                  <button onClick={addReward} data-testid="trivia-reward-add"
                          className="bg-bgBase border border-bgHover text-gray-200 hover:border-shBlue px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
                    <i className="fas fa-plus mr-1"/>Add goal
                  </button>
                  <button onClick={resetRewards} data-testid="trivia-reward-reset"
                          className="text-gray-400 hover:text-shOrange px-2 py-1.5 text-[12px] font-black uppercase tracking-widest">
                    <i className="fas fa-rotate-left mr-1"/>Reset to defaults
                  </button>
                </div>
                <button onClick={saveRewards} disabled={savingRewards}
                        data-testid="trivia-reward-save"
                        className="bg-shGreen text-bgHeader px-4 py-1.5 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
                  {savingRewards ? "Saving…" : <><i className="fas fa-floppy-disk mr-1"/>Save goals</>}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {view === "questions" && (<>
        <CsvImportRow
          templateUrl="/admin/trivia/import-csv/template"
          uploadUrl="/admin/trivia/import-csv"
          templateFilename="trivia-import-template.csv"
          testIdPrefix="trivia-csv"
          helperText="Headers: question, choice_a..d, correct_letter (A/B/C/D), difficulty, tag"
          onComplete={loadQuestions}
          borderColor="border-shGreen/30"
          accentColor="text-shGreen"
        />
        <div className="flex justify-end items-center gap-2 mb-3 flex-wrap">
          <button onClick={()=>setEditing({ mode: "new" })}
                  data-testid="trivia-q-new-btn"
                  className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
            <i className="fas fa-plus mr-1"/>New question
          </button>
          <input type="number" min={1} max={50} value={count} onChange={(e)=>setCount(e.target.value)}
                 data-testid="trivia-gen-count"
                 className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm w-20"/>
          <button onClick={generate} disabled={busy} data-testid="trivia-gen-btn"
                  className="bg-shBlue text-bgHeader px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
            {busy ? "Generating…" : <><i className="fas fa-wand-magic-sparkles mr-1"/>Generate with AI</>}
          </button>
        </div>
        {editing && (
          <TriviaQuestionEditor
            initial={editing.mode === "edit" ? editing.q : null}
            onClose={() => setEditing(null)}
            onSaved={async () => { setEditing(null); await loadQuestions(); }}
          />
        )}
        <div className="space-y-1 max-h-96 overflow-y-auto pr-1">
          {rows.length === 0 ? (
            <p className="text-gray-500 text-sm italic">No questions yet. Tap "New question" or "Generate with AI" to seed the pool.</p>
          ) : rows.map(q => (
            <div key={q.id} className={`flex items-start gap-2 p-2 rounded border ${q.active ? "border-bgHover bg-bgBase/50" : "border-bgHover/40 bg-bgBase/20 opacity-50"}`} data-testid={`trivia-row-${q.id}`}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-gray-200 truncate">{q.question}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  <span className={`font-black uppercase ${tagColor[q.tag] || "text-gray-400"}`}>{q.tag}</span>
                  <span className="mx-1 text-gray-600">·</span>
                  <span className="text-gray-400">{q.difficulty}</span>
                  <span className="mx-1 text-gray-600">·</span>
                  <span className="text-gray-500">A: {q.choices[q.correct_index]}</span>
                  {q.source === "manual" && <><span className="mx-1 text-gray-600">·</span><span className="text-shGreen font-black"><i className="fas fa-user-pen mr-0.5"/>mine</span></>}
                  {q.times_used > 0 && <><span className="mx-1 text-gray-600">·</span><span className="text-gray-500">used {q.times_used}x</span></>}
                </p>
              </div>
              <button onClick={()=>setEditing({ mode: "edit", q })}
                      data-testid={`trivia-edit-${q.id}`}
                      className="text-gray-400 hover:text-shBlue text-[12px] px-1">
                <i className="fas fa-pen-to-square"/>
              </button>
              <button onClick={()=>toggle(q)} data-testid={`trivia-toggle-${q.id}`}
                      className={`text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded ${q.active ? "text-shGreen hover:bg-shGreen/15" : "text-gray-500 hover:bg-gray-500/15"}`}>
                {q.active ? "active" : "off"}
              </button>
              <button onClick={()=>del(q)} data-testid={`trivia-delete-${q.id}`}
                      className="text-gray-500 hover:text-red-400 text-[12px] px-1">
                <i className="fas fa-trash"/>
              </button>
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

function Kpi({ label, value, color = "white", testId }) {
  return (
    <div className="bg-bgBase rounded-lg p-3 border border-bgHover" data-testid={testId}>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-xl font-black text-${color} mt-1`}>{value}</p>
    </div>
  );
}

const TRIVIA_DIFFICULTIES = ["easy", "medium", "hard"];
const TRIVIA_TAGS = ["breeds", "behavior", "health", "history", "training", "anatomy", "fun", "myth"];

function TriviaQuestionEditor({ initial, onClose, onSaved }) {
  const isEdit = !!initial;
  const [question, setQuestion] = useState(initial?.question || "");
  const [choices, setChoices] = useState(initial?.choices || ["", "", "", ""]);
  const [correctIndex, setCorrectIndex] = useState(initial?.correct_index ?? 0);
  const [difficulty, setDifficulty] = useState(initial?.difficulty || "medium");
  const [tag, setTag] = useState(initial?.tag || "fun");
  const [active, setActive] = useState(initial?.active ?? true);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const updateChoice = (i, v) => setChoices(cs => cs.map((c, idx) => idx === i ? v : c));

  const save = async () => {
    setErr("");
    const cleaned = choices.map(c => (c || "").trim());
    if (!question.trim()) return setErr("Question text is required");
    if (cleaned.some(c => !c)) return setErr("All 4 choices must be filled in");
    if (new Set(cleaned.map(c => c.toLowerCase())).size !== 4) return setErr("Choices must be unique");
    setSaving(true);
    try {
      const body = {
        question: question.trim(), choices: cleaned, correct_index: correctIndex,
        difficulty, tag, active,
      };
      if (isEdit) await api.put(`/admin/trivia/questions/${initial.id}`, body);
      else await api.post("/admin/trivia/questions", body);
      onSaved();
    } catch (e) { setErr(e.response?.data?.detail || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-bgBase rounded-xl border border-shGreen/40 p-4 mb-3 space-y-3" data-testid="trivia-q-editor">
      <div className="flex justify-between items-center">
        <p className="text-[12px] font-black uppercase tracking-widest text-shGreen">
          <i className={`fas ${isEdit ? "fa-pen-to-square" : "fa-plus"} mr-2`}/>
          {isEdit ? "Edit question" : "New question"}
        </p>
        <button onClick={onClose} data-testid="trivia-q-close"
                className="text-gray-500 hover:text-red-400 text-sm"><i className="fas fa-xmark"/></button>
      </div>
      {err && <div className="bg-red-500/10 border border-red-400 text-red-300 rounded p-2 text-[13px]">{err}</div>}
      <label className="block">
        <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Question</span>
        <textarea value={question} onChange={e=>setQuestion(e.target.value)} maxLength={200} rows={2}
                  data-testid="trivia-q-question"
                  placeholder="e.g. Which dog breed has a blue-black tongue?"
                  className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1"/>
      </label>
      <div className="space-y-2" data-testid="trivia-q-choices">
        <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">Choices — tap the radio to mark correct</p>
        {choices.map((c, i) => (
          <div key={i} className={`flex items-center gap-2 bg-bgPanel border rounded p-2 ${correctIndex === i ? "border-shGreen" : "border-bgHover"}`}>
            <label className="flex items-center cursor-pointer">
              <input type="radio" name="correct" checked={correctIndex === i}
                     onChange={()=>setCorrectIndex(i)}
                     data-testid={`trivia-q-correct-${i}`}
                     className="w-4 h-4 accent-shGreen"/>
            </label>
            <span className="text-[11px] font-black w-5 text-gray-400">{["A","B","C","D"][i]}</span>
            <input type="text" value={c} onChange={e=>updateChoice(i, e.target.value)} maxLength={80}
                   data-testid={`trivia-q-choice-${i}`}
                   placeholder={`Answer ${["A","B","C","D"][i]}`}
                   className="flex-1 bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm"/>
            {correctIndex === i && <span className="text-[10px] font-black text-shGreen uppercase">correct</span>}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Difficulty</span>
          <select value={difficulty} onChange={e=>setDifficulty(e.target.value)}
                  data-testid="trivia-q-difficulty"
                  style={{colorScheme:"dark"}}
                  className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1">
            {TRIVIA_DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-500">Tag</span>
          <select value={tag} onChange={e=>setTag(e.target.value)}
                  data-testid="trivia-q-tag"
                  style={{colorScheme:"dark"}}
                  className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm mt-1">
            {TRIVIA_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2">
          <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}
                 data-testid="trivia-q-active"
                 className="w-4 h-4 accent-shGreen"/>
          <span className="text-[12px] font-black uppercase tracking-widest text-gray-300">Active</span>
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} data-testid="trivia-q-cancel"
                className="bg-bgPanel border border-bgHover px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest text-gray-300 hover:border-red-400">
          Cancel
        </button>
        <button onClick={save} disabled={saving} data-testid="trivia-q-save"
                className="bg-shGreen text-bgHeader px-4 py-1.5 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
          {saving ? "Saving…" : isEdit ? "Save changes" : "Create question"}
        </button>
      </div>
    </div>
  );
}

// ─────── Sprint 110ax · Dog Facts management ───────
function DogFactsPanel() {
  const [rows, setRows] = useState([]);
  const [today, setToday] = useState(null);
  const [filter, setFilter] = useState("all"); // all | active | inactive | ai
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ text: "", tag: "fun", emoji: "🐶" });
  const [genBusy, setGenBusy] = useState(false);
  const [genCount, setGenCount] = useState(3);
  const [err, setErr] = useState("");
  const load = async () => {
    setErr("");
    try {
      const [r, t] = await Promise.all([
        api.get("/dog-facts"),
        api.get("/dog-facts/today"),
      ]);
      setRows(r.data || []);
      setToday(t.data?.fact || null);
    } catch (e) { setErr(e.response?.data?.detail || "Load failed"); }
  };
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!draft.text.trim()) return;
    try {
      await api.post("/dog-facts", draft);
      setDraft({ text: "", tag: "fun", emoji: "🐶" });
      load();
    } catch (e) { setErr(e.response?.data?.detail || "Add failed"); }
  };
  const toggle = async (f) => {
    try { await api.patch(`/dog-facts/${f.id}`, { active: !f.active }); load(); }
    catch (e) { setErr(e.response?.data?.detail || "Toggle failed"); }
  };
  const remove = async (f) => {
    if (!window.confirm(`Delete this fact?\n\n"${f.text}"`)) return;
    try { await api.delete(`/dog-facts/${f.id}`); load(); }
    catch (e) { setErr(e.response?.data?.detail || "Delete failed"); }
  };
  const saveEdit = async () => {
    try { await api.patch(`/dog-facts/${editing.id}`, editing); setEditing(null); load(); }
    catch (e) { setErr(e.response?.data?.detail || "Save failed"); }
  };
  const generate = async () => {
    setGenBusy(true); setErr("");
    try {
      const { data } = await api.post("/dog-facts/generate", { count: Number(genCount) || 3 });
      load();
      alert(`Generated ${data.created} new facts. They're staged as INACTIVE — review them below and toggle on to add to rotation.`);
    } catch (e) { setErr(e.response?.data?.detail || "Generation failed"); }
    finally { setGenBusy(false); }
  };
  const visible = rows.filter(r =>
    filter === "all" ? true :
    filter === "active" ? r.active :
    filter === "inactive" ? !r.active :
    filter === "ai" ? r.ai_generated : true
  );
  const activeCount = rows.filter(r => r.active).length;
  return (
    <div className="border-t border-bgHover pt-6" data-testid="dog-facts-panel">
      <h4 className="text-sm font-black text-shGreen uppercase tracking-widest mb-2"><i className="fas fa-paw mr-2"/>Dog Fact of the Day</h4>
      <p className="text-[14px] text-gray-400 mb-3 leading-relaxed">
        One fact rotates daily on the client portal and your dashboard. <strong className="text-white">{activeCount}</strong> facts in active rotation — roughly <strong>{Math.round(activeCount / 30 * 10) / 10} months</strong> of unique content before anything repeats.
      </p>

      {today && (
        <div className="bg-bgBase border border-shGreen/30 rounded-lg p-3 mb-4" data-testid="dog-fact-today-preview">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-shGreen mb-1">Today's pick</p>
          <p className="text-white text-[14px]"><span className="text-xl mr-2">{today.emoji}</span>{today.text}</p>
        </div>
      )}

      {err && <p className="text-red-400 text-[14px] mb-2">{err}</p>}

      {/* AI generate */}
      <div className="bg-bgBase border border-purple-500/30 rounded-lg p-3 mb-4">
        <p className="text-[12px] font-black uppercase tracking-widest text-purple-300 mb-2"><i className="fas fa-wand-magic-sparkles mr-1"/>Generate new facts (AI)</p>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Count</span>
            <input type="number" min={1} max={10} value={genCount} onChange={(e)=>setGenCount(e.target.value)}
                   data-testid="dog-facts-gen-count"
                   className="mt-1 block w-20 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm font-mono"/>
          </label>
          <button onClick={generate} disabled={genBusy} data-testid="dog-facts-generate"
                  className="bg-purple-500 text-white px-4 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow disabled:opacity-50">
            {genBusy ? <><i className="fas fa-circle-notch fa-spin mr-1"/>Generating…</> : <><i className="fas fa-wand-magic-sparkles mr-1"/>Generate</>}
          </button>
          <p className="text-[11px] text-gray-500 italic">Staged inactive — you review before they go live.</p>
        </div>
      </div>

      <CsvImportRow
        templateUrl="/admin/dog-facts/import-csv/template"
        uploadUrl="/admin/dog-facts/import-csv"
        templateFilename="dog-facts-import-template.csv"
        testIdPrefix="dog-facts-csv"
        helperText="Headers: text (required), tag, emoji"
        onComplete={load}
        borderColor="border-shBlue/30"
        accentColor="text-shBlue"
      />

      {/* Add new */}
      <div className="bg-bgBase border border-bgHover rounded-lg p-3 mb-4">
        <p className="text-[12px] font-black uppercase tracking-widest text-gray-400 mb-2"><i className="fas fa-plus mr-1"/>Add your own fact</p>
        <div className="flex gap-2 items-end flex-wrap">
          <input type="text" value={draft.emoji} onChange={(e)=>setDraft({...draft, emoji: e.target.value})}
                 placeholder="🐶" data-testid="dog-facts-new-emoji"
                 className="w-16 bg-bgPanel border border-bgHover rounded p-2 text-white text-lg text-center"/>
          <select value={draft.tag} onChange={(e)=>setDraft({...draft, tag: e.target.value})}
                  data-testid="dog-facts-new-tag"
                  className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
            {["fun","anatomy","behavior","breed","health","training","myth-buster"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="text" value={draft.text} onChange={(e)=>setDraft({...draft, text: e.target.value})}
                 placeholder="Type a fun, accurate dog fact (1 sentence)…"
                 data-testid="dog-facts-new-text" maxLength={500}
                 className="flex-1 min-w-[260px] bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
          <button onClick={add} disabled={!draft.text.trim()} data-testid="dog-facts-add"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow disabled:opacity-50">
            Add
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-2 text-[12px] font-black uppercase tracking-widest">
        {[["all","All"],["active","Active"],["inactive","Inactive"],["ai","AI"]].map(([k, label]) => (
          <button key={k} onClick={()=>setFilter(k)} data-testid={`dog-facts-filter-${k}`}
                  className={`px-3 py-1 rounded ${filter === k ? "bg-shGreen text-bgHeader" : "bg-bgBase text-gray-400 hover:text-white border border-bgHover"}`}>
            {label} {k === "active" ? `(${activeCount})` : k === "ai" ? `(${rows.filter(r => r.ai_generated).length})` : k === "all" ? `(${rows.length})` : `(${rows.length - activeCount})`}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="max-h-[420px] overflow-y-auto space-y-1 bg-bgBase border border-bgHover rounded-lg p-2">
        {visible.length === 0 && <p className="text-[13px] text-gray-500 italic p-2">No facts match this filter.</p>}
        {visible.map(f => (
          <div key={f.id} className={`flex items-start gap-2 p-2 rounded ${f.active ? "" : "opacity-50"} hover:bg-bgPanel/60`}
               data-testid={`dog-fact-row-${f.id}`}>
            <span className="text-lg shrink-0">{f.emoji}</span>
            <div className="min-w-0 flex-1">
              {editing?.id === f.id ? (
                <div className="space-y-2">
                  <input value={editing.text} onChange={(e)=>setEditing({...editing, text: e.target.value})}
                         className="block w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"
                         data-testid={`dog-fact-edit-text-${f.id}`}/>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="text-[11px] font-black uppercase tracking-widest bg-shGreen text-bgHeader px-3 py-1 rounded"
                            data-testid={`dog-fact-save-${f.id}`}>Save</button>
                    <button onClick={()=>setEditing(null)} className="text-[11px] font-black uppercase tracking-widest text-gray-400 px-3 py-1 rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-[13px] text-white leading-snug">{f.text}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mt-0.5">
                    {f.tag}{f.ai_generated ? " · AI" : f.seeded ? " · seed" : " · custom"}
                  </p>
                </>
              )}
            </div>
            {editing?.id !== f.id && (
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={()=>toggle(f)} title={f.active ? "Disable" : "Activate"}
                        data-testid={`dog-fact-toggle-${f.id}`}
                        className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded ${f.active ? "bg-shGreen/15 text-shGreen" : "bg-bgPanel text-gray-400"}`}>
                  {f.active ? "On" : "Off"}
                </button>
                <button onClick={()=>setEditing(f)} title="Edit"
                        data-testid={`dog-fact-edit-${f.id}`}
                        className="text-gray-400 hover:text-white p-1"><i className="fas fa-pencil text-[12px]"/></button>
                <button onClick={()=>remove(f)} title="Delete"
                        data-testid={`dog-fact-delete-${f.id}`}
                        className="text-gray-400 hover:text-red-400 p-1"><i className="fas fa-trash text-[12px]"/></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
