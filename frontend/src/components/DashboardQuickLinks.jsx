const QUICK_LINKS = [
  { id: "care",     label: "Care Board",     icon: "fa-bowl-food",            color: "shGreen",   desc: "Log meals & meds" },
  { id: "waitlist", label: "Waitlist",       icon: "fa-hourglass-half",       color: "shOrange",  desc: "Pending requests" },
  { id: "kennel",   label: "Kennel Board",   icon: "fa-paw",                  color: "shBlue",    desc: "Assign spaces" },
  { id: "intake",   label: "Intake Forms",   icon: "fa-clipboard-list",       color: "shGreen",   desc: "Build & review forms" },
  { id: "incidents",label: "Incidents",      icon: "fa-triangle-exclamation", color: "shOrange",  desc: "Log & review" },
  { id: "audit",    label: "Audit Log",      icon: "fa-list-check",           color: "shBlue",    desc: "Who did what" },
];

const COLOR_MAP = {
  shGreen:  { ring: "ring-shGreen/40 hover:ring-shGreen",   text: "text-shGreen",  bg: "bg-shGreen/10"  },
  shOrange: { ring: "ring-shOrange/40 hover:ring-shOrange", text: "text-shOrange", bg: "bg-shOrange/10" },
  shBlue:   { ring: "ring-shBlue/40 hover:ring-shBlue",     text: "text-shBlue",   bg: "bg-shBlue/10"   },
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
    <div className="bg-bgPanel rounded-xl border border-bgHover p-4" data-testid="dashboard-quick-links">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-black text-white uppercase tracking-widest">
          <i className="fas fa-bolt mr-2 text-shGreen"/>Operations Quick Links
        </p>
        <span className="text-[12px] text-gray-500 uppercase tracking-widest hidden sm:inline">One-tap jump</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {visible.map(l => {
          const c = COLOR_MAP[l.color];
          return (
            <button
              key={l.id}
              onClick={() => onNavigate(l.id)}
              data-testid={`quick-link-${l.id}`}
              className={`bg-bgBase rounded p-3 flex flex-col items-center gap-1 ring-1 ${c.ring} transition group`}
            >
              <span className={`w-10 h-10 rounded-full grid place-items-center ${c.bg} ${c.text} text-lg`}>
                <i className={`fas ${l.icon}`}/>
              </span>
              <span className="text-[12px] font-black text-white uppercase mt-1 text-center leading-tight whitespace-normal">{l.label}</span>
              <span className="text-[10px] text-gray-500 uppercase tracking-widest text-center leading-tight">{l.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
