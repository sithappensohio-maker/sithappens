/* Front Desk V2 — shared presentational pieces.
 *
 * Pure presentation: every component here receives real data and existing
 * handlers from Pos.jsx. No fetching, no business rules, no new state
 * machines — the redesign reorganizes and restyles the proven Front Desk
 * wiring, it never re-implements it.
 */

const TONE = {
  lime: { chip: "bg-shPrimary/20 border-shPrimary/55 text-shPrimary", text: "text-shPrimary", hue: "sh-hue-card--lime" },
  blue: { chip: "bg-shSecondary/20 border-shSecondary/55 text-shSecondary", text: "text-shSecondary", hue: "sh-hue-card--cyan" },
  orange: { chip: "bg-shAccent/20 border-shAccent/55 text-shAccent", text: "text-shAccent", hue: "sh-hue-card--orange" },
  purple: { chip: "bg-[#a78bfa]/20 border-[#a78bfa]/55 text-[#a78bfa]", text: "text-[#a78bfa]", hue: "sh-hue-card--purple" },
  teal: { chip: "bg-[#2dd4bf]/20 border-[#2dd4bf]/55 text-[#2dd4bf]", text: "text-[#2dd4bf]", hue: "sh-hue-card--teal" },
  muted: { chip: "bg-black/20 border-shBorder/60 text-shTextMuted", text: "text-shTextMuted", hue: "" },
};

/** Today at a Glance stat card — a 3D hue card: big number, concise label,
 *  colored icon medallion, gradient-edge surface from the shared system. */
export function FrontDeskStatCard({ icon, tone = "blue", value, label, action, onClick, testid }) {
  const t = TONE[tone] || TONE.blue;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} data-testid={testid}
         className={`sh-hue-card ${t.hue} rounded-2xl p-3.5 flex items-center gap-3 text-left min-h-[74px] ${onClick ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary" : ""}`}>
      <span className={`w-11 h-11 rounded-full grid place-items-center border shrink-0 ${t.chip}`} aria-hidden="true">
        <i className={`fas ${icon} text-[16px]`}/>
      </span>
      <span className="min-w-0">
        <span className="block text-[22px] font-black text-shText leading-none">{value}</span>
        <span className="block text-[10px] font-black uppercase tracking-[0.12em] text-shTextMuted mt-1">{label}</span>
        {action && <span className={`block text-[10.5px] font-bold mt-0.5 ${t.text}`}>{action} <i className="fas fa-chevron-right text-[8px]"/></span>}
      </span>
    </Tag>
  );
}

/** Large quick-action card — 3D hue card with icon chip + title + helper. */
export function FrontDeskQuickAction({ icon, tone = "blue", title, sub, onClick, active = false, badge = null, testid, children }) {
  const t = TONE[tone] || TONE.blue;
  return (
    <button onClick={onClick} data-testid={testid}
            className={`sh-hue-card ${t.hue} rounded-2xl p-3.5 flex items-center gap-3 text-left min-h-[68px] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary ${
              active ? "ring-2 ring-shPrimary ring-inset" : ""}`}>
      <span className={`w-11 h-11 rounded-xl grid place-items-center border shrink-0 ${t.chip}`} aria-hidden="true">
        <i className={`fas ${icon} text-[16px]`}/>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-black text-shText leading-tight">{title}
          {badge != null && badge > 0 && (
            <span className="ml-2 inline-block bg-shAccent text-bgHeader text-[10px] font-black px-1.5 py-0.5 rounded-full align-middle">{badge} NEW</span>
          )}
        </span>
        {sub && <span className="block text-[11px] text-shTextMuted mt-0.5 leading-tight">{sub}</span>}
      </span>
      {children}
    </button>
  );
}

/** Compact secondary tool button for the utilities row. */
export function FrontDeskToolButton({ icon, label, onClick, active = false, badge = null, testid, children }) {
  return (
    <button onClick={onClick} data-testid={testid}
            className={`min-h-[40px] px-3 rounded-xl border text-[11px] font-black uppercase tracking-widest transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary ${
              active ? "border-shPrimary/60 bg-shPrimary/10 text-shPrimary" : "border-shBorder/60 bg-black/15 text-shTextMuted hover:text-shText hover:border-shSecondary/45"}`}>
      {icon && <i className={`fas ${icon} mr-1.5`}/>}{label}{children}
    </button>
  );
}

/** Visit status chip — always a word, colored by the REAL roster bucket. */
export function FrontDeskStatusChip({ bucket, missed = false, label }) {
  const cls = missed ? "bg-shAccent text-bgHeader"
    : bucket === "on_site" ? "bg-shSecondary/20 border border-shSecondary/50 text-shSecondary"
    : bucket === "checked_out" ? "bg-black/25 border border-shBorder/60 text-shTextMuted"
    : "bg-shPrimary/15 border border-shPrimary/50 text-shPrimary";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

/** Branded dog avatar fallback — the roster deliberately carries no photos,
 *  so this is an honest paw-and-initial tile, never a stock image. */
export function FrontDeskDogAvatar({ name, bucket }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const tone = bucket === "on_site" ? "border-shSecondary/50 bg-shSecondary/10 text-shSecondary"
    : bucket === "checked_out" ? "border-shBorder/60 bg-black/20 text-shTextMuted"
    : "border-shPrimary/50 bg-shPrimary/10 text-shPrimary";
  return (
    <span className={`w-11 h-11 rounded-xl border grid place-items-center shrink-0 relative ${tone}`} aria-hidden="true">
      <i className="fas fa-dog text-[15px]"/>
      <span className="absolute -bottom-1 -right-1 w-4.5 h-4.5 min-w-[18px] min-h-[18px] rounded-full bg-[var(--sh-card-base)] border border-shBorder text-[9px] font-black grid place-items-center text-shText">{initial}</span>
    </span>
  );
}

/** Section header shared across the Front Desk panels. */
export function FrontDeskSectionHeader({ icon, tone = "lime", title, right }) {
  const t = TONE[tone] || TONE.lime;
  return (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <p className="text-shText font-black uppercase tracking-[0.12em] text-[14px]">
        {icon && <i className={`fas ${icon} mr-2 ${t.text}`}/>}{title}
      </p>
      {right}
    </div>
  );
}

/** Visual catalog category tile — built ONLY from the real catalog taxonomy. */
const CATEGORY_HUES = ["sh-hue-card--lime", "sh-hue-card--cyan", "sh-hue-card--orange", "sh-hue-card--purple", "sh-hue-card--teal", "sh-hue-card--pink", "sh-hue-card--gold", "sh-hue-card--green"];
const CATEGORY_ICONS = [
  [/daycare|day care/i, "fa-paw"], [/board/i, "fa-house"], [/train/i, "fa-graduation-cap"],
  [/groom|bath/i, "fa-scissors"], [/treat|food|snack/i, "fa-bone"], [/retail|merch|gear|toy/i, "fa-bag-shopping"],
  [/pack|credit/i, "fa-cubes"], [/add.?on/i, "fa-circle-plus"], [/gift/i, "fa-gift"],
];
export function catalogCategoryIcon(label) {
  for (const [re, icon] of CATEGORY_ICONS) if (re.test(label || "")) return icon;
  return "fa-tag";
}
export function CatalogCategoryTile({ label, count, index = 0, active = false, onClick, testid }) {
  const hue = CATEGORY_HUES[index % CATEGORY_HUES.length];
  return (
    <button onClick={onClick} data-testid={testid}
            className={`sh-hue-card ${hue} rounded-2xl p-3 text-left min-h-[76px] w-full flex flex-col justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary ${active ? "ring-2 ring-shPrimary ring-inset" : ""}`}
            aria-pressed={active || undefined}>
      <span className="flex items-center justify-between">
        <i className={`fas ${catalogCategoryIcon(label)} text-[16px] text-shText`} aria-hidden="true"/>
        {active && <i className="fas fa-check text-shPrimary text-[12px]" aria-hidden="true"/>}
      </span>
      <span className="mt-1.5">
        <span className="block text-[12px] font-black uppercase tracking-[0.08em] text-shText leading-tight">{label}</span>
        <span className="block text-[10px] font-bold text-shTextMuted mt-0.5">{count} item{count === 1 ? "" : "s"}</span>
      </span>
    </button>
  );
}
