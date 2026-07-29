import { accentRgb } from "./tokens";

const TONE_ACCENT = { success: "lime", info: "cyan", warning: "amber", error: "danger", special: "purple" };

/* Small branded status indicator — success/info/warning/error/special —
 * used in place of ad-hoc colored pill classNames scattered per screen. */
export default function StatusBadge({ tone = "info", glow = false, children, className = "", ...rest }) {
  const rgb = accentRgb(TONE_ACCENT[tone] || "cyan");
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide whitespace-nowrap ${className}`}
      style={{
        background: `rgba(${rgb},0.14)`,
        border: `1px solid rgba(${rgb},0.4)`,
        color: `rgb(${rgb})`,
        boxShadow: glow ? `0 0 10px -3px rgba(${rgb},0.6)` : undefined,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
