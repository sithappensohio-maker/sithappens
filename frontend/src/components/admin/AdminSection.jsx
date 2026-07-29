import SectionCard from "../premium/SectionCard";

/* Admin content-block wrapper — thin SectionCard extension with an optional
 * title row (icon + label + right-aligned action slot). Defaults to SUBTLE
 * intensity since most admin content (tables, forms, history) should be
 * calm; pass intensity="standard" for normal cards/widgets. */
export default function AdminSection({ title, icon, accent = "lime", intensity = "subtle", action, children, className = "", testid }) {
  return (
    <SectionCard accent={accent} intensity={intensity} className={className} data-testid={testid}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          {title && (
            <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-shTextMuted flex items-center gap-2">
              {icon && <i className={`fas ${icon} text-shPrimary`} />}
              {title}
            </p>
          )}
          {action}
        </div>
      )}
      {children}
    </SectionCard>
  );
}
