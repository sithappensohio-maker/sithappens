/* Generic stacked mobile-card primitive — the target shape for any admin
 * table row on narrow screens (title/subtitle + label:value rows + action
 * row), so screens converge on one visual pattern instead of each rolling
 * its own. */
const BORDER_CLASS = {
  lime: "border-shBorder",
  cyan: "border-shSecondary/30",
  orange: "border-shAccent/30",
  danger: "border-shDanger/40",
};

export default function AdminMobileCard({ title, subtitle, badge, rows = [], actions, accent = "lime", testid }) {
  return (
    <div className={`rounded-xl border p-3.5 space-y-2 ${BORDER_CLASS[accent] || BORDER_CLASS.lime}`}
         style={{ background: "var(--sh-card-base)" }} data-testid={testid}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-shText font-bold text-[15px] truncate">{title}</p>
          {subtitle && <p className="text-shTextMuted text-[12px] mt-0.5">{subtitle}</p>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {rows.length > 0 && (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-[13px] gap-2">
              <span className="text-shTextMuted">{r.label}</span>
              <span className="text-shText font-medium text-right truncate">{r.value}</span>
            </div>
          ))}
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2 pt-2 border-t border-shBorder mt-2">{actions}</div>}
    </div>
  );
}
