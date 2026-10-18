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
  // Optional [{ label, keys: [...] }] — purely a presentation grouping over
  // the same flat `items` (which stays the single source of truth for
  // content/order/testids). Every other caller of this shared component
  // omits it and gets the exact same flat row as before; a screen with
  // enough tabs that "where do I even look for X" becomes a real question
  // (Shop Manager's 10) can opt in without this component growing a second
  // way to describe a tab's content.
  groups = null,
}) {
  const renderItem = (item) => {
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
        className={`sh-admin-tabs__item ${ACCENTS[item.accent || accent] || ACCENTS.lime} ${active ? "is-active" : ""}`}
      >
        {item.icon && <i className={`fas ${item.icon} sh-admin-tabs__icon`} />}
        <span>{item.label}</span>
        {/* A "0" badge is pure noise — show the count only when there
            is actually something behind the tab. */}
        {item.count != null && item.count > 0 && <span className="sh-admin-tabs__count">{item.count}</span>}
        {item.external && <i className="fas fa-arrow-up-right-from-square sh-admin-tabs__external" />}
      </button>
    );
  };

  // A key in `items` but not in any group still renders — in its own
  // trailing cluster — rather than silently vanishing if a group list
  // drifts out of sync with the real tab list.
  const grouped = groups && (() => {
    const seen = new Set();
    const clusters = groups.map((g) => ({
      label: g.label,
      rows: g.keys.map((k) => items.find((it) => (it.key ?? it.value) === k)).filter(Boolean),
    }));
    clusters.forEach((c) => c.rows.forEach((it) => seen.add(it.key ?? it.value)));
    const leftover = items.filter((it) => !seen.has(it.key ?? it.value));
    if (leftover.length) clusters.push({ label: null, rows: leftover });
    return clusters;
  })();

  return (
    <nav
      className={`sh-admin-tabs ${compact ? "sh-admin-tabs--compact" : ""} ${className}`}
      data-testid={testid}
      aria-label="Workspace sections"
    >
      <div className="sh-admin-tabs__track">
        {grouped
          ? grouped.map((cluster, i) => (
              <div key={cluster.label || `group-${i}`} className="flex items-center gap-[5px]">
                {i > 0 && <span className="w-px self-stretch my-1.5 bg-shBorder" aria-hidden="true" />}
                {cluster.label && (
                  <span className="text-[9px] text-shTextMuted/70 uppercase tracking-widest font-black px-1 whitespace-nowrap">
                    {cluster.label}
                  </span>
                )}
                {cluster.rows.map(renderItem)}
              </div>
            ))
          : items.map(renderItem)}
      </div>
    </nav>
  );
}
