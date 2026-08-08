const ACCENTS = {
  lime: "sh-admin-tabs__item--lime",
  cyan: "sh-admin-tabs__item--cyan",
  orange: "sh-admin-tabs__item--orange",
  purple: "sh-admin-tabs__item--purple",
};

export default function AdminTabs({
  items = [],
  value,
  onChange,
  testid = "admin-tabs",
  accent = "lime",
  compact = false,
  className = "",
}) {
  return (
    <nav
      className={`sh-admin-tabs ${compact ? "sh-admin-tabs--compact" : ""} ${className}`}
      data-testid={testid}
      aria-label="Workspace sections"
    >
      <div className="sh-admin-tabs__track">
        {items.map((item) => {
          const key = item.key ?? item.value;
          const active = key === value;
          const disabled = !!item.disabled;
          return (
            <button
              key={key}
              type="button"
              onClick={() => !disabled && onChange?.(key, item)}
              disabled={disabled}
              data-testid={item.testid}
              title={item.title}
              className={`sh-admin-tabs__item ${active ? `is-active ${ACCENTS[item.accent || accent] || ACCENTS.lime}` : ""}`}
            >
              {item.icon && <i className={`fas ${item.icon} sh-admin-tabs__icon`} />}
              <span>{item.label}</span>
              {item.count != null && <span className="sh-admin-tabs__count">{item.count}</span>}
              {item.external && <i className="fas fa-arrow-up-right-from-square sh-admin-tabs__external" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
