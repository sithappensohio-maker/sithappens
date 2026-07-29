/* Compact filter-chip row. Uses literal per-accent class strings (not
 * template-built) so Tailwind's JIT scanner can see them — same convention
 * as premium/tokens.js's HOVER_BORDER_CLASS. */
const ACTIVE_CLASS = {
  lime: "bg-shPrimary/15 border-shPrimary/50 text-shPrimary",
  cyan: "bg-shSecondary/15 border-shSecondary/50 text-shSecondary",
  orange: "bg-shAccent/15 border-shAccent/50 text-shAccent",
  purple: "bg-purple-500/15 border-purple-500/50 text-purple-300",
  danger: "bg-shDanger/15 border-shDanger/50 text-shDanger",
};

export function AdminFilterChip({ active, onClick, children, accent = "lime", testid }) {
  return (
    <button onClick={onClick} data-testid={testid}
            className={`px-3 py-1.5 rounded-full text-[12px] font-bold uppercase tracking-widest border transition whitespace-nowrap ${
              active ? (ACTIVE_CLASS[accent] || ACTIVE_CLASS.lime) : "border-shBorder text-shTextMuted hover:text-shText hover:border-shPrimary/30"
            }`}
            style={!active ? { background: "var(--sh-card-base)" } : undefined}>
      {children}
    </button>
  );
}

export default function AdminFilterBar({ children, className = "", testid }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid={testid}>
      {children}
    </div>
  );
}
