import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
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
    if (pw.next !== pw.confirm) { setPwMsg("New passwords don't match"); return; }
    try {
      await api.post("/auth/change-password", { current_password: pw.current, new_password: pw.next });
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
        { id: "_intake_soon", label: "Intake Forms", icon: "fa-clipboard",
          desc: "Custom new-client intake questionnaires and required fields.",
          badges: ["Coming soon"], comingSoon: true },
        { id: "_incidents_soon", label: "Incident Rules", icon: "fa-triangle-exclamation",
          desc: "Severity tiers, automatic admin alerts, follow-up requirements.",
          badges: ["Coming soon"], comingSoon: true },
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
        { id: "_roles_soon", label: "Roles & Permissions", icon: "fa-lock",
          desc: "Granular permission matrix per staff role.",
          badges: ["Coming soon"], comingSoon: true },
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
        { id: "_trophies_link", label: "Trophy Wall", icon: "fa-trophy",
          desc: "Browse, award, and revoke trophies for dogs and clients. (Opens the Trophies screen.)",
          badges: ["Live", "Client-facing"], externalTab: "trophies" },
        { id: "_d2d_loyalty", label: "Loyalty Tiers, Streaks & Referrals", icon: "fa-medal",
          desc: "Bronze/Silver/Gold/Platinum visit thresholds, streak targets, trophy reward value, referral reward type & amount.",
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
        { id: "_export_soon", label: "Data Export", icon: "fa-cloud-arrow-down",
          desc: "On-demand export of clients, dogs, bookings, finances.",
          badges: ["Coming soon"], comingSoon: true },
        { id: "_audit_soon", label: "Audit Log", icon: "fa-list-check",
          desc: "Searchable trail of every admin action — who did what when.",
          badges: ["Coming soon"], comingSoon: true },
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
              {tab === "capacity" && <CapacityPanel s={s} save={save} saving={saving} />}
              {tab === "rules" && <RulesPanel s={s} save={save} saving={saving} />}
              {tab === "vaccines" && <VaccinesPanel s={s} save={save} saving={saving} />}
              {tab === "tags" && <TagsPanel s={s} save={save} saving={saving} />}
              {tab === "waiver" && <WaiverPanel s={s} save={save} saving={saving} />}
              {tab === "service_info" && <ServiceInfoPanel s={s} save={save} saving={saving} />}
              {tab === "portal_links" && <PortalLinksPanel s={s} save={save} saving={saving} />}
              {tab === "marketing_qr" && <MarketingQRPanel />}
              {tab === "services" && <ServicesSettings />}
              {tab === "credit_packs" && <CreditPacksSettings />}
              {tab === "commands" && <CommandsPanel />}
              {tab === "backup" && <BackupPanel />}
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

function BrandPanel() {
  const ctx = useTheme();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

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
      });
      setMsg("Saved");
      setTimeout(() => setMsg(""), 1800);
    } catch (e) {
      setMsg("Failed to save");
    }
    setSaving(false);
  };

  const reset = () => {
    setDraft({
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
    });
  };

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

      <Section title="Live Preview" subtitle="A quick taste of how things look with the choices above.">
        <div
          className="rounded-xl p-5 border space-y-3"
          style={{
            borderColor: draft.brand_primary,
            backgroundColor: "#0f172a",
            fontFamily: draft.brand_font_family === "System" ? "system-ui" : draft.brand_font_family,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_primary, color: "#0f172a" }}>Primary</span>
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_accent, color: "#fff" }}>Accent</span>
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_warning, color: "#fff" }}>Warning</span>
          </div>
          <p className="text-base text-white">A booking was just approved for <span style={{ color: draft.brand_primary, fontWeight: 900 }}>Buddy</span>.</p>
          <p className="text-[14px] text-gray-300">Rabies expires soon — <span style={{ color: draft.brand_warning, fontWeight: 900 }}>renew before Dec 31</span>.</p>
        </div>
      </Section>

      <div className="flex justify-between items-center pt-4 border-t border-bgHover">
        <button onClick={reset} data-testid="brand-reset" className="text-[14px] font-black uppercase tracking-widest text-gray-400 hover:text-white">
          <i className="fas fa-rotate-left mr-2"/>Reset to defaults
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
    { key: "daycare",     label: "Daycare",     icon: "fa-paw",        defaultValue: 10 },
    { key: "boarding",    label: "Boarding",    icon: "fa-bed",        defaultValue: 15 },
    { key: "training",    label: "Training",    icon: "fa-graduation-cap", defaultValue: 10 },
    { key: "grooming",    label: "Grooming",    icon: "fa-scissors",   defaultValue: 10 },
    { key: "photography", label: "Photography", icon: "fa-camera",     defaultValue: 10 },
  ];
  const legacyMode  = s.multi_dog_discount_mode  || "percent";
  const legacyValue = s.multi_dog_discount_value ?? 10;
  const legacyLabel = s.multi_dog_discount_label || "Multi-dog discount";
  const initialByService = {};
  for (const svc of SERVICES) {
    const existing = (s.multi_dog_discount_by_service || {})[svc.key];
    initialByService[svc.key] = existing ? {
      enabled: !!existing.enabled,
      mode: existing.mode || legacyMode,
      value: existing.value ?? svc.defaultValue,
      label: existing.label || `${svc.label} multi-dog discount`,
    } : {
      enabled: !!s.multi_dog_discount_enabled && svc.key === "daycare",  // migrate legacy onto daycare
      mode: legacyMode,
      value: svc.key === "daycare" ? legacyValue : svc.defaultValue,
      label: svc.key === "daycare" ? legacyLabel : `${svc.label} multi-dog discount`,
    };
  }
  const [mdEnabled, setMdEnabled] = useState(!!s.multi_dog_discount_enabled);
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
               subtitle="When a dog is checked out, the system computes the dollar charge from the actual hours on premises. Boarding rolls up nights from check-in to check-out, and a trailing partial day either bills as half-day or whole-day depending on the threshold below.">
        <label className="flex items-center gap-3 cursor-pointer mb-4">
          <input type="checkbox" checked={r.stay_pricing_enabled !== false}
                 onChange={(e)=>set("stay_pricing_enabled", e.target.checked)}
                 data-testid="stay-pricing-enabled"
                 className="accent-shGreen w-4 h-4" />
          <span className="text-[15px] font-black uppercase tracking-widest text-gray-300">Auto-price stays at check-out (recommended)</span>
        </label>
        <div className={`grid grid-cols-3 gap-4 ${r.stay_pricing_enabled !== false ? "" : "opacity-50 pointer-events-none"}`}>
          <Field label="Half-day rate (% of full)"
                 type="number"
                 value={r.half_day_pct ?? 50}
                 onChange={(v)=>set("half_day_pct", Math.max(0, Math.min(100, parseInt(v)||0)))}
                 testId="stay-half-day-pct" />
          <Field label="Daycare: stays ≤ X hours = half day"
                 type="number"
                 value={r.daycare_half_day_max_hours ?? 5}
                 onChange={(v)=>set("daycare_half_day_max_hours", Math.max(0, parseFloat(v)||0))}
                 testId="stay-daycare-half-h" />
          <Field label="Boarding: final partial day ≤ X hours = half day"
                 type="number"
                 value={r.boarding_half_day_max_hours ?? 12}
                 onChange={(v)=>set("boarding_half_day_max_hours", Math.max(0, parseFloat(v)||0))}
                 testId="stay-boarding-half-h" />
        </div>
        <div className="mt-3 text-xs text-gray-400 leading-relaxed">
          <div><span className="text-shGreen font-black">Daycare:</span> total hours ≤ threshold → bill as half day, otherwise full day.</div>
          <div><span className="text-shBlue font-black">Boarding:</span> nights = floor(hours ÷ 24). Trailing remainder &gt; boarding threshold → +1 full day, otherwise +half day (or no extra if remainder is zero).</div>
          <div className="text-shOrange mt-1"><i className="fas fa-info-circle mr-1" />The admin can still override the auto-price by typing a manual amount in the check-out modal.</div>
        </div>
      </Section>

      <Section title="Multi-dog household discount" subtitle="Auto-applied at check-out for the 2nd-and-later dog from the same client on the same date. Each service has its OWN discount tier — set daycare and boarding to whatever margins make sense for each.">
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
          Each service uses its own tier. Disable per-service for the ones you don't want discounted (e.g. keep daycare at 15% but leave photography full price).
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
    if (!(await confirm({ title: restoreMode === "replace" ? "Replace ALL data?" : "Merge into current data?", body: `This will ${verb} ${total} records from ${restoreFile.name}.\n\nThis cannot be undone — make sure you have a current backup downloaded first.`, confirmText: restoreMode === "replace" ? "Yes, replace everything" : "Yes, merge", tone: "danger" }))) return;
    setBusy(true); setMsg("");
    try {
      const r = new FileReader();
      r.onload = async () => {
        try {
          const payload = JSON.parse(r.result);
          payload.mode = restoreMode;
          const { data } = await api.post("/backup/restore", payload);
          const summary = Object.entries(data.summary).map(([k,v])=>`${k}: ${v.inserted ?? v.upserted}`).join(" · ");
          setMsg(`Restored ✓ ${summary}`);
          setRestoreFile(null); setRestorePreview(null);
        } catch (e) { setMsg(`Restore failed: ${e.response?.data?.detail || e.message}`); }
        setBusy(false);
      };
      r.readAsText(restoreFile);
    } catch { setBusy(false); setMsg("Restore failed"); }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="backup-panel">
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
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/admin/payroll/year-end.csv?year=${year}&detail=${detail}`;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    const token = localStorage.getItem("auth_token") || "";
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
        path: draft.path || "/app/backups",
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
        Writes a gzipped JSON snapshot of <strong className="text-white">every business collection</strong> at the scheduled hour, prunes anything older than the retain window, and logs every run. Point the path at a host-mounted folder so backups survive container rebuilds.
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
          <span className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Backup folder (in-container path)</span>
          <input type="text" value={draft.path || ""}
                 onChange={(e) => setDraft({ ...draft, path: e.target.value })}
                 placeholder="/app/backups"
                 data-testid="auto-backup-path"
                 className="mt-1 block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm font-mono"/>
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
            {cfg.last_size_bytes ? ` · ${fmtBytes(cfg.last_size_bytes)}` : ""}
          </p>
          {cfg.last_file && <p className="text-[12px] text-gray-500 font-mono mt-1 truncate">{cfg.last_file}</p>}
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
                <span className={r.ok ? "text-shGreen font-black" : "text-red-400 font-black"}>
                  {r.ok ? fmtBytes(r.size_bytes) : "FAIL"}
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
            Pick your own streak goals + perks. Each entry is matched when a client's
            <strong className="text-shGreen"> current daily-trivia streak </strong> hits exactly the day count.
            The label is what the client sees on their portal and what shows in your "Perks to award at next checkout" list.
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

