import { huskyPlaceholderSrc } from "./brand/HuskyDogImage";

/**
 * Public-facing Sit Happens shell used by unauthenticated storefront,
 * activation/reset, and public certificate pages. Keeps these routes visually
 * connected to the authenticated app without pulling in admin navigation.
 */
export default function PublicBrandShell({
  children,
  eyebrow = "Sit Happens",
  title,
  subtitle,
  action,
  compact = false,
  center = false,
  testid,
  homeTestId,
  mascotKey,
  footer = true,
  className = "",
}) {
  return (
    <div className={`sh-public-shell min-h-screen w-full ${className}`} data-testid={testid}>
      <header className="sh-public-shell__header">
        <a href="/" className="sh-public-shell__brand" aria-label="Sit Happens home" data-testid={homeTestId}>
          <img
            src={huskyPlaceholderSrc(mascotKey || title || eyebrow)}
            alt=""
            aria-hidden="true"
            className="sh-public-shell__mascot"
          />
          <div className="min-w-0">
            <div className="sh-public-wordmark">Sit Happens</div>
            <div className="sh-public-shell__eyebrow">Dog Training · Daycare · Boarding</div>
          </div>
        </a>
        {action && <div className="sh-public-shell__action">{action}</div>}
      </header>

      <main className={`sh-public-shell__main ${compact ? "sh-public-shell__main--compact" : ""} ${center ? "sh-public-shell__main--center" : ""}`}>
        {(title || subtitle) && (
          <section className={`sh-public-hero ${center ? "sh-public-hero--center" : ""}`}>
            <div className="sh-public-hero__rail" aria-hidden="true" />
            <p className="sh-eyebrow text-shPrimary">
              <span className="sh-eyebrow__brand">Sit Happens</span>
              <span className="sh-eyebrow__dot">·</span>
              <span>{eyebrow}</span>
            </p>
            {title && <h1 className="sh-public-title">{title}</h1>}
            {subtitle && <p className="sh-public-subtitle">{subtitle}</p>}
          </section>
        )}
        {children}
      </main>

      {footer && (
        <footer className="sh-public-shell__footer">
          <span className="sh-public-wordmark sh-public-wordmark--small">Sit Happens</span>
          <span>Dog Training · Daycare · Boarding</span>
        </footer>
      )}
    </div>
  );
}
