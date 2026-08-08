import AdminMobileCard from "./AdminMobileCard";

export default function AdminTable({ columns = [], rows = [], renderRow, renderMobileCard, emptyLabel = "Nothing to show", testid }) {
  return (
    <div className="sh-admin-table-shell" data-testid={testid}>
      <div className="hidden md:block sh-admin-table-desktop">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} className={`px-3.5 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-shTextMuted ${c.className || ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => renderRow(row, i))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-8 text-center text-[13px] text-shTextMuted">{emptyLabel}</p>}
      </div>
      <div className="md:hidden space-y-3">
        {rows.length === 0 ? (
          <p className="p-8 text-center text-[13px] text-shTextMuted">{emptyLabel}</p>
        ) : rows.map((row, i) => (
          <div key={row.id ?? i}>
            {renderMobileCard ? renderMobileCard(row, i) : <AdminMobileCard title={String(row.id ?? i)} />}
          </div>
        ))}
      </div>
    </div>
  );
}
