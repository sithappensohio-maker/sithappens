/* Page-level title block used inside each admin screen's own content area
 * (not the AdminShell's persistent top header, which just shows the nav
 * label) — icon + title + optional description + right-aligned action. */
export default function AdminPageHeader({ icon, title, description, action, testid }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap mb-5" data-testid={testid}>
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-shText tracking-tight flex items-center gap-2.5">
          {icon && <i className={`fas ${icon} text-shPrimary`} />}
          {title}
        </h1>
        {description && <p className="text-[13px] text-shTextMuted mt-1 max-w-2xl">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
