const ACTIVE_CLASS = {
  lime: "sh-filter-chip--lime",
  cyan: "sh-filter-chip--cyan",
  orange: "sh-filter-chip--orange",
  purple: "sh-filter-chip--purple",
  danger: "sh-filter-chip--danger",
};

export function AdminFilterChip({ active, onClick, children, accent = "lime", testid }) {
  return (
    <button onClick={onClick} data-testid={testid}
            className={`sh-filter-chip ${active ? (ACTIVE_CLASS[accent] || ACTIVE_CLASS.lime) : ""}`}>
      {children}
    </button>
  );
}

export default function AdminFilterBar({ children, className = "", testid }) {
  return <div className={`sh-filter-bar ${className}`} data-testid={testid}>{children}</div>;
}
