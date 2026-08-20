/* Student School primary navigation — five destinations, one landing page.
 *
 * Phase 2 of the client redesign collapsed the old six-item bar. It carried
 * BOTH "Home" and "Today", which rendered the same server-derived
 * current_action and left the client guessing which one was the real starting
 * point. Today is now the single default landing page, and Library moved out
 * of primary navigation (it is reached from Course) so the bar matches the
 * five destinations in the design handoff.
 *
 * Sidebar on desktop, fixed bottom bar on mobile — thumb-reachable while
 * holding a leash. Both render the SAME five destinations; no client-facing
 * navigation exposes trainer or admin concepts.
 */
export const NAV_ITEMS = [
  { view: "today", label: "Today", icon: "fa-house" },
  { view: "course", label: "Course", icon: "fa-route" },
  { view: "practice", label: "Practice", icon: "fa-bullseye" },
  { view: "progress", label: "Progress", icon: "fa-chart-line" },
  { view: "feedback", label: "Feedback", icon: "fa-comment-dots" },
];

export default function SchoolNav({ active, onNavigate }) {
  return (
    <>
      {/* Desktop: vertical rail */}
      <nav className="hidden md:flex md:flex-col gap-1 w-52 shrink-0" aria-label="School sections" data-testid="school-nav-desktop">
        {NAV_ITEMS.map((it) => {
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

      {/* Mobile: fixed bottom bar. Five items divide 320px cleanly, so the
          labels stay readable without truncation on the narrowest phone. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-shBorder bg-[var(--sh-card-base)] flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="School sections"
        data-testid="school-nav-mobile"
      >
        {NAV_ITEMS.map((it) => {
          const on = active === it.view;
          return (
            <button
              key={it.view}
              type="button"
              onClick={() => onNavigate(it.view)}
              aria-current={on ? "page" : undefined}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] ${on ? "text-shPrimary" : "text-shTextMuted"}`}
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
