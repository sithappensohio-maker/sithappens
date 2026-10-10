import { useTheme } from "../../lib/theme";

/* Consistent admin/workspace title block. Kept intentionally quieter than
 * PageHero for sub-pages, dialogs, and dense operational tools.
 *
 * The padded/rounded "card" treatment (sh-admin-page-header--decorated)
 * only applies when a sectionHeaderBackground image is actually active —
 * it exists purely to give that image real room to read as a banner.
 * Applying it unconditionally padded every screen using this component
 * (ScheduleWorkspace/TrainingWorkspace/SchoolHQ) in from the page edge
 * even with no theme asset uploaded, breaking their alignment against
 * the tab bar/content directly below, which has no matching padding of
 * its own — caught live after the fact, not during the original change. */
export default function AdminPageHeader({ icon, title, description, action, testid, eyebrow = "Sit Happens" }) {
  const ctx = useTheme();
  const hasHeaderImage = !!ctx?.branding?.assets?.sectionHeaderBackground
    && (ctx?.branding?.enabled_targets?.staff_portal ?? true);
  return (
    <div className={`sh-admin-page-header ${hasHeaderImage ? "sh-admin-page-header--decorated" : ""}`} data-testid={testid}>
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
