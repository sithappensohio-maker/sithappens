import AdminMobileCard from "./AdminMobileCard";

/* Shared dense-table shell: near-black desktop <table> + automatic stacked
 * AdminMobileCard fallback under md, generalizing the pattern Bookings.jsx
 * already used ad hoc. Caller supplies `rows` plus a `renderRow(row,i)` that
 * returns a <tr> for desktop and (optionally) `renderMobileCard(row,i)` for
 * the mobile view; if omitted, a minimal default card is used. */
export default function AdminTable({ columns = [], rows = [], renderRow, renderMobileCard, emptyLabel = "Nothing to show", testid }) {
  return (
    <div data-testid={testid}>
      <div className="hidden md:block rounded-xl border border-shBorder overflow-hidden" style={{ background: "var(--sh-card-base)" }}>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-shBorder" style={{ background: "rgba(255,255,255,0.03)" }}>
              {columns.map((c, i) => (
                <th key={i} className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest text-shTextMuted ${c.className || ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-shBorder">
            {rows.map((row, i) => renderRow(row, i))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-[13px] text-shTextMuted">{emptyLabel}</p>}
      </div>
      <div className="md:hidden space-y-2.5">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-shTextMuted">{emptyLabel}</p>
        ) : rows.map((row, i) => (
          <div key={row.id ?? i}>
            {renderMobileCard ? renderMobileCard(row, i) : <AdminMobileCard title={String(row.id ?? i)} />}
          </div>
        ))}
      </div>
    </div>
  );
}
