import { accentRgb } from "./tokens";

/* Reusable compact banner (extracted from Home's "Action Needed" row) —
 * dark raised surface + accent radial glow + icon, instead of a flat
 * color-washed fill. Used for warnings/next-steps throughout the portal. */
export default function AlertCard({ accent = "orange", icon = "fa-triangle-exclamation", eyebrow, title, action, testId, className = "" }) {
  const rgb = accentRgb(accent);
  return (
    <div
      data-testid={testId}
      className={`relative overflow-hidden rounded-xl border shadow-sh flex items-center gap-3 px-4 py-3 ${className}`}
      style={{ borderColor: `rgba(${rgb},0.3)`, background: "var(--sh-card-base)" }}
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(120% 160% at 0% 50%, rgba(${rgb},0.12), transparent 60%)` }} />
      <span
        className="relative z-10 w-9 h-9 shrink-0 rounded-full grid place-items-center"
        style={{ background: `rgba(${rgb},0.15)`, border: `1px solid rgba(${rgb},0.35)`, boxShadow: `0 0 16px -4px rgba(${rgb},0.5)`, color: `rgb(${rgb})` }}
      >
        <i className={`fas ${icon}`} />
      </span>
      <div className="relative z-10 flex-1 min-w-0">
        {eyebrow && <p className="text-[11px] sm:text-[13px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: `rgb(${rgb})` }}>{eyebrow}</p>}
        <p className="text-[13px] text-shTextMuted truncate">{title}</p>
      </div>
      {action && <div className="relative z-10 shrink-0">{action}</div>}
    </div>
  );
}
