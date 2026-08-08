const ACCENT_CLASS = {
  lime: "sh-mobile-card--lime",
  cyan: "sh-mobile-card--cyan",
  orange: "sh-mobile-card--orange",
  danger: "sh-mobile-card--danger",
  purple: "sh-mobile-card--purple",
};

export default function AdminMobileCard({ title, subtitle, badge, rows = [], actions, accent = "lime", testid }) {
  return (
    <article className={`sh-mobile-card ${ACCENT_CLASS[accent] || ACCENT_CLASS.lime}`} data-testid={testid}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-shText font-black text-[16px] leading-tight truncate">{title}</p>
          {subtitle && <p className="text-shTextMuted text-[12px] mt-1 leading-snug">{subtitle}</p>}
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {rows.length > 0 && (
        <dl className="sh-mobile-card__rows">
          {rows.map((r, i) => (
            <div key={i} className="sh-mobile-card__row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions && <div className="sh-mobile-card__actions">{actions}</div>}
    </article>
  );
}
