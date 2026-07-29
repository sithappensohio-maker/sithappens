/* Compact sticky-feeling bar for a screen's search/filter/primary-action
 * row — near-black raised surface, wraps cleanly on mobile. */
export default function AdminToolbar({ children, className = "", testid }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 p-2.5 sm:p-3 rounded-xl border border-shBorder mb-4 ${className}`}
         style={{ background: "var(--sh-card-base)" }} data-testid={testid}>
      {children}
    </div>
  );
}
