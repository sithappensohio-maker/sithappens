import SectionCard from "../premium/SectionCard";

export default function AdminSection({ title, icon, accent = "lime", intensity = "subtle", action, children, className = "", testid, description }) {
  return (
    <SectionCard accent={accent} intensity={intensity} className={`sh-admin-section ${className}`} data-testid={testid}>
      {(title || action) && (
        <div className="sh-admin-section__head">
          <div className="min-w-0">
            {title && (
              <h3 className="sh-admin-section__title">
                {icon && <i className={`fas ${icon} text-shSecondary`} />}
                <span>{title}</span>
              </h3>
            )}
            {description && <p className="sh-admin-section__description">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </SectionCard>
  );
}
