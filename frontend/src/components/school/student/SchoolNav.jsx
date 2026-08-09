/* Student School sub-navigation. Sidebar on desktop, fixed bottom bar on mobile
 * (thumb-reachable while holding a leash). Home is live in 2A; the other
 * destinations are wired to open the current School experience until 2B/2C
 * replace them with routed screens. */
const ITEMS = [
  { view: "home", label: "Home", icon: "fa-house" },
  { view: "course", label: "My Course", icon: "fa-route" },
  { view: "today", label: "Today", icon: "fa-bullseye" },
  { view: "progress", label: "Progress", icon: "fa-chart-line" },
  { view: "feedback", label: "Feedback", icon: "fa-comment-dots" },
  { view: "resources", label: "Library", icon: "fa-folder-open" },
];

export default function SchoolNav({ active, onNavigate }) {
  return (
    <>
      {/* Desktop: vertical rail */}
      <nav className="hidden md:flex md:flex-col gap-1 w-52 shrink-0" aria-label="School sections" data-testid="school-nav-desktop">
        {ITEMS.map((it) => {
          const on = active === it.view;
          return (
            <button
              key={it.view}
              type="button"
              onClick={() => onNavigate(it.view)}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-semibold transition text-left ${on ? "bg-shPrimary/12 text-shText" : "text-shTextMuted hover:text-shText hover:bg-shBorder/30"}`}
              style={on ? { borderLeft: "3px solid rgb(140,198,63)" } : { borderLeft: "3px solid transparent" }}
              data-testid={`school-nav-${it.view}`}
            >
              <i className={`fas ${it.icon} w-4 ${on ? "text-shPrimary" : ""}`} />{it.label}
            </button>
          );
        })}
      </nav>

      {/* Mobile: fixed bottom bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-shBorder bg-[var(--sh-card-base)] flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="School sections"
        data-testid="school-nav-mobile"
      >
        {ITEMS.map((it) => {
          const on = active === it.view;
          return (
            <button
              key={it.view}
              type="button"
              onClick={() => onNavigate(it.view)}
              aria-current={on ? "page" : undefined}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 ${on ? "text-shPrimary" : "text-shTextMuted"}`}
              data-testid={`school-nav-m-${it.view}`}
            >
              <i className={`fas ${it.icon} text-[16px]`} />
              <span className="text-[10px] font-bold uppercase tracking-wide truncate max-w-full">{it.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
