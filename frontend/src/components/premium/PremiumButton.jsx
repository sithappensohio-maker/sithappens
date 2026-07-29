import { accentRgb } from "./tokens";

const FILLED_ACCENT = { primary: "lime", orange: "orange", cyan: "cyan" };

/* Standardized client-portal button, based on the approved hero-card CTA:
 * a flat(ter) rectangle with a top highlight and dark text on a bright
 * fill, not a generic enterprise pill. variant="secondary"/"ghost"/"danger"
 * cover the non-filled cases so screens stop hand-rolling button classNames. */
export default function PremiumButton({ variant = "primary", as, className = "", children, ...rest }) {
  const Tag = as === "a" ? "a" : "button";
  if (variant === "secondary") {
    return (
      <Tag
        style={{ background: "var(--sh-card-base)" }}
        className={`inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md text-[13px] font-bold border border-shBorder text-shText hover:border-shPrimary/40 transition ${className}`}
        {...rest}
      >
        {children}
      </Tag>
    );
  }
  if (variant === "ghost") {
    return (
      <Tag
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[13px] font-bold text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised transition ${className}`}
        {...rest}
      >
        {children}
      </Tag>
    );
  }
  const rgb = accentRgb(variant === "danger" ? "danger" : FILLED_ACCENT[variant] || "lime");
  const textClass = variant === "danger" || variant === "orange" || variant === "cyan" ? "text-white" : "text-bgHeader";
  return (
    <Tag
      className={`relative inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md text-[13px] font-black overflow-hidden transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 ${textClass} ${className}`}
      style={{ background: `rgb(${rgb})`, boxShadow: `0 8px 20px -8px rgba(${rgb},0.6)` }}
      {...rest}
    >
      <span className="pointer-events-none absolute inset-0 rounded-md" style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.4), transparent 55%)" }} />
      <span className="relative z-10 flex items-center gap-1.5">{children}</span>
    </Tag>
  );
}
