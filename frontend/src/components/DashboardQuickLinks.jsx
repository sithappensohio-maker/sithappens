const QUICK_LINKS = [
  { id: "care",     label: "Care Board",     icon: "fa-bowl-food",            color: "shPrimary",   desc: "Log meals & meds" },
  { id: "waitlist", label: "Waitlist",       icon: "fa-hourglass-half",       color: "shAccent",  desc: "Pending requests" },
  { id: "kennel",   label: "Kennel Board",   icon: "fa-paw",                  color: "shSecondary",    desc: "Assign spaces" },
  { id: "intake",   label: "Intake Forms",   icon: "fa-clipboard-list",       color: "shPrimary",   desc: "Build & review forms" },
  { id: "incidents",label: "Incidents",      icon: "fa-triangle-exclamation", color: "shAccent",  desc: "Log & review" },
  { id: "audit",    label: "Audit Log",      icon: "fa-list-check",           color: "shSecondary",    desc: "Who did what" },
];

const COLOR_MAP = {
  shPrimary:  { ring: "ring-shPrimary/40 hover:ring-shPrimary",   text: "text-shPrimary",  bg: "bg-shPrimary/10"  },
  shAccent: { ring: "ring-shAccent/40 hover:ring-shAccent", text: "text-shAccent", bg: "bg-shAccent/10" },
  shSecondary:   { ring: "ring-shSecondary/40 hover:ring-shSecondary",     text: "text-shSecondary",   bg: "bg-shSecondary/10"   },
};

export default function DashboardQuickLinks({ onNavigate = () => {}, can = () => true }) {
  // Permission gates mirror App.js navItems
  const PERM_GATES = {
    care: "care_complete",
    waitlist: "booking_edit",
    kennel: "dogs_view",
    intake: "clients_edit",
    incidents: "incidents",
    audit: "settings",
  };
  const visible = QUICK_LINKS.filter(l => {
    const p = PERM_GATES[l.id];
    return !p || can(p);
  });
  if (visible.length === 0) return null;

  return (
    <div className="bg-[var(--sh-card-base)] rounded-xl border border-shBorder p-4" data-testid="dashboard-quick-links">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-black text-shText uppercase tracking-widest">
          <i className="fas fa-bolt mr-2 text-shPrimary"/>Operations Quick Links
        </p>
        <span className="text-[12px] text-shTextMuted uppercase tracking-widest hidden sm:inline">One-tap jump</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {visible.map(l => {
          const c = COLOR_MAP[l.color];
          return (
            <button
              key={l.id}
              onClick={() => onNavigate(l.id)}
              data-testid={`quick-link-${l.id}`}
              className={`bg-[var(--sh-card-base)] rounded p-3 flex flex-col items-center gap-1 ring-1 ${c.ring} transition group`}
            >
              <span className={`w-10 h-10 rounded-full grid place-items-center ${c.bg} ${c.text} text-lg`}>
                <i className={`fas ${l.icon}`}/>
              </span>
              <span className="text-[12px] font-black text-shText uppercase mt-1 text-center leading-tight whitespace-normal">{l.label}</span>
              <span className="text-[10px] text-shTextMuted uppercase tracking-widest text-center leading-tight">{l.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
