/* Consistent admin/workspace title block. Kept intentionally quieter than
 * PageHero for sub-pages, dialogs, and dense operational tools. */
export default function AdminPageHeader({ icon, title, description, action, testid, eyebrow = "Sit Happens" }) {
  return (
    <div className="sh-admin-page-header" data-testid={testid}>
      <div className="min-w-0 flex-1">
        <p className="sh-admin-page-header__eyebrow">
          <span>{eyebrow}</span>
          {icon && <><span className="text-shTextMuted/50">·</span><i className={`fas ${icon} text-shSecondary`} /></>}
        </p>
        <h1 className="sh-admin-page-header__title">{title}</h1>
        {description && <p className="sh-admin-page-header__description">{description}</p>}
      </div>
      {action && <div className="sh-admin-page-header__action">{action}</div>}
    </div>
  );
}
