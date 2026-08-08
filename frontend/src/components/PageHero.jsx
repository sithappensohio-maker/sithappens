/**
 * App-wide page hero. This is the common visual opening for Sit Happens
 * operational screens: one strong heading, one restrained accent lane, and
 * a compact action/stat area. The palette remains runtime-themeable through
 * the existing CSS variables.
 */
export default function PageHero({
  eyebrow,
  title,
  highlight,
  subtitle,
  right,
  compact = false,
  testid = "page-hero",
}) {
  const eyebrowColor = eyebrow?.color || "text-shPrimary";
  return (
    <section className={`sh-page-hero ${compact ? "sh-page-hero--compact" : ""}`} data-testid={testid}>
      <div className="sh-page-hero__glow" aria-hidden="true" />
      <div className="sh-page-hero__rail" aria-hidden="true" />
      <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-4 sm:gap-6">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className={`sh-eyebrow ${eyebrowColor} ${compact ? "hidden sm:flex" : "flex"}`}>
              <span className="sh-eyebrow__brand">Sit Happens</span>
              <span className="sh-eyebrow__dot">·</span>
              <span className="truncate">
                {eyebrow.icon && <i className={`fas ${eyebrow.icon} mr-1.5`} />}
                {eyebrow.text}
              </span>
            </p>
          )}
          <h1 className={`sh-page-title ${compact ? "text-[26px] sm:text-[34px]" : "text-[32px] sm:text-[42px] lg:text-[48px]"}`}>
            {title}
            {highlight && <> <span className="text-shPrimary">{highlight}</span></>}
          </h1>
          {subtitle && (
            <p className={`sh-page-subtitle ${compact ? "hidden sm:block" : ""}`}>{subtitle}</p>
          )}
        </div>
        {right && (
          <div className="sh-page-hero__actions" data-testid={`${testid}-right`}>
            {right}
          </div>
        )}
      </div>
    </section>
  );
}
