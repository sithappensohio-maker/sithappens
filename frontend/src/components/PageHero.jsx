/**
 * Sprint 110v — Reusable landing-style page hero used by admin screens.
 *
 * Consistent treatment: brand-color radial glow backdrop, eyebrow label
 * (uppercase brand tracking), uppercase-italic-black headline with optional
 * highlight span, subhead, and a right-aligned slot for stat tiles or CTAs.
 *
 * Usage:
 *   <PageHero
 *     eyebrow={{ icon: "fa-calendar-alt", text: "Today's roster", color: "text-shBlue" }}
 *     title="Schedule"
 *     highlight="at a glance."
 *     subtitle="Drag, drop, and check off the day."
 *     right={<MyStatTiles />}
 *   />
 */
export default function PageHero({
  eyebrow,                      // { icon, text, color }   — optional
  title,                         // string
  highlight,                     // string (rendered in shGreen) — optional
  subtitle,                      // string                  — optional
  right,                          // ReactNode               — optional
  testid = "page-hero",
}) {
  const eyebrowColor = eyebrow?.color || "text-shGreen";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-bgHover bg-gradient-to-br from-bgPanel via-bgBase to-bgPanel p-5 sm:p-7"
         data-testid={testid}>
      <div className="absolute inset-0 pointer-events-none opacity-35"
           style={{ background: "radial-gradient(circle at 12% 18%, rgba(0,169,224,0.45) 0%, transparent 38%), radial-gradient(circle at 88% 78%, rgba(140,198,63,0.4) 0%, transparent 42%), radial-gradient(circle at 70% 10%, rgba(242,101,34,0.22) 0%, transparent 32%)" }}/>
      <div className="relative flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className={`text-[11px] font-black uppercase tracking-[0.35em] mb-2 ${eyebrowColor}`}>
              {eyebrow.icon && <i className={`fas ${eyebrow.icon} mr-2`}/>}{eyebrow.text}
            </p>
          )}
          {/* Sprint 110aa — italic + tight tracking + overflow-hidden caused
              the tail of right-leaning letters (D, S, B…) to clip. Adding
              `pr-2` (or `pr-1` on mobile) gives the slant room without
              affecting layout otherwise. */}
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black uppercase italic tracking-tight text-white leading-tight pr-1 sm:pr-2">
            {title}
            {highlight && <> <span className="text-shGreen">{highlight}</span></>}
          </h1>
          {subtitle && (
            <p className="text-[14px] text-gray-300 mt-2 max-w-2xl">{subtitle}</p>
          )}
        </div>
        {right && (
          <div className="shrink-0 flex flex-wrap gap-2" data-testid={`${testid}-right`}>
            {right}
          </div>
        )}
      </div>
    </div>
  );
}
