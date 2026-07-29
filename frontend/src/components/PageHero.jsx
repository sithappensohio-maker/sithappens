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
  compact = false,                // Sprint 110dh-4: when true, hide eyebrow + subtitle + shrink title on mobile
  testid = "page-hero",
}) {
  const eyebrowColor = eyebrow?.color || "text-shPrimary";
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-shBorder bg-[var(--sh-card-base)] ${compact ? "p-3 sm:p-7" : "p-5 sm:p-7"}`}
         data-testid={testid}>
      <div className="absolute inset-0 pointer-events-none opacity-25"
           style={{ background: "radial-gradient(circle at 12% 18%, rgba(0,169,224,0.4) 0%, transparent 38%), radial-gradient(circle at 88% 78%, rgba(140,198,63,0.35) 0%, transparent 42%), radial-gradient(circle at 70% 10%, rgba(242,101,34,0.18) 0%, transparent 32%)" }}/>
      <div className="relative flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className={`text-[11px] font-bold uppercase tracking-[0.3em] mb-2 ${eyebrowColor} ${compact ? "hidden sm:block" : ""}`}>
              {eyebrow.icon && <i className={`fas ${eyebrow.icon} mr-2`}/>}{eyebrow.text}
            </p>
          )}
          <h1 className={`font-bold tracking-tight text-shText leading-tight pr-1 sm:pr-2 ${
            compact ? "text-xl sm:text-3xl lg:text-4xl" : "text-2xl sm:text-3xl lg:text-4xl"
          }`}>
            {title}
            {highlight && <> <span className="text-shPrimary">{highlight}</span></>}
          </h1>
          {subtitle && (
            <p className={`text-[14px] text-shTextMuted mt-2 max-w-2xl ${compact ? "hidden sm:block" : ""}`}>{subtitle}</p>
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
