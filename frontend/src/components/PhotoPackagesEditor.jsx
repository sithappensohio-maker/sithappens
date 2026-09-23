/* PhotoPackagesEditor — the editable photo price list, shared by the event
   editor (Trunk or Treat's photo booth) and the Photo Specials editor
   (Howl-O-Ween, Christmas, ...). One row per thing you sell. Each package
   sells through a hidden register product on the server, matched by its key,
   so renaming or repricing never loses its sales history.

   `copySources` (optional) lists other price lists to start from:
   [{ id, label, packages }]. Copying brings names/prices/contents only. */
const inputCls = "w-full mt-1 bg-bgBase border border-bgHover rounded-xl px-3 py-3 text-white text-[16px] focus:border-shGreen outline-none";
const labelCls = "text-[11px] font-black text-shTextMuted uppercase tracking-widest";

export const blankPackage = () => ({ key: "", name: "", price: "", digitals: "0", print: "", popular: false, product_id: null });

/** Saved package -> editable row (numbers as strings for the inputs). */
export const toPackageRows = (list) => (list || []).map((pk) => ({
  key: pk.key || "", name: pk.name || "", price: String(pk.price ?? ""), digitals: String(pk.digitals ?? 0),
  print: pk.print || "", popular: !!pk.popular, product_id: pk.product_id || null,
}));

/** Editable rows -> what the API takes. Blank names are dropped. */
export const fromPackageRows = (rows) => (rows || []).filter((pk) => (pk.name || "").trim()).map((pk) => ({
  key: pk.key || null, name: pk.name.trim(), price: Number(pk.price) || 0, digitals: Number(pk.digitals) || 0,
  print: (pk.print || "").trim(), popular: !!pk.popular,
}));

export default function PhotoPackagesEditor({ packages, onChange, testid = "event-editor", copySources = [] }) {
  const rows = packages || [];
  const edit = (i, patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const sources = copySources.filter((s) => (s.packages || []).length > 0);
  const copyFrom = (id) => {
    const src = sources.find((s) => s.id === id);
    if (!src) return;
    if (rows.some((r) => (r.name || "").trim()) && !window.confirm(`Replace these packages with the ones from ${src.label}?`)) return;
    // Keys are kept so the copy reads the same, but the register product
    // belongs to the source — the server makes this list its own.
    onChange(toPackageRows(src.packages).map((r) => ({ ...r, product_id: null })));
  };
  return (
    <div className="space-y-2" data-testid={`${testid}-packages`}>
      {rows.length === 0 && <p className="text-[13px] text-shTextMuted">No packages yet. Add one per thing you sell, e.g. 3 Edited Digitals $30.</p>}
      {rows.map((pk, i) => (
        <div key={i} className="bg-bgBase border border-bgHover rounded-xl p-3 grid grid-cols-2 sm:grid-cols-[1fr_90px_80px_90px_auto_auto] gap-2 items-end" data-testid={`${testid}-package-${i}`}>
          <div className="col-span-2 sm:col-span-1"><p className={labelCls}>Name</p><input value={pk.name} onChange={(e) => edit(i, { name: e.target.value })} className={inputCls} data-testid={`${testid}-package-name-${i}`} placeholder="3 Edited Digitals" /></div>
          <div><p className={labelCls}>Price</p><input type="number" min="0" step="0.01" inputMode="decimal" value={pk.price} onChange={(e) => edit(i, { price: e.target.value })} className={inputCls} data-testid={`${testid}-package-price-${i}`} /></div>
          <div><p className={labelCls}>Digitals</p><input type="number" min="0" inputMode="numeric" value={pk.digitals} onChange={(e) => edit(i, { digitals: e.target.value })} className={inputCls} data-testid={`${testid}-package-digitals-${i}`} /></div>
          <div><p className={labelCls}>Print</p><input value={pk.print} onChange={(e) => edit(i, { print: e.target.value })} className={inputCls} data-testid={`${testid}-package-print-${i}`} placeholder="5×7" /></div>
          <label className="flex items-center gap-2 min-h-[44px] text-[12px] text-shText"><input type="checkbox" checked={!!pk.popular} onChange={(e) => edit(i, { popular: e.target.checked })} className="w-5 h-5 accent-shOrange" />Popular</label>
          <button type="button" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))} data-testid={`${testid}-package-remove-${i}`} className="min-w-[44px] min-h-[44px] text-shTextMuted hover:text-red-300"><i className="fas fa-trash" /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onChange([...rows, blankPackage()])} data-testid={`${testid}-add-package`}
                className="min-h-[40px] px-3 rounded-lg bg-shSurfaceRaised text-shText font-black text-[11px] uppercase tracking-widest"><i className="fas fa-plus mr-1" />Add package</button>
        {sources.length > 0 && (
          <select value="" onChange={(e) => copyFrom(e.target.value)} data-testid={`${testid}-copy-packages`} aria-label="Copy packages from another event"
                  className="min-h-[40px] min-w-0 max-w-full bg-bgBase border border-bgHover rounded-lg px-2 text-shText text-[12px]">
            <option value="">Copy packages from…</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.label} ({s.packages.length})</option>)}
          </select>
        )}
      </div>
      <p className="text-[12px] text-shTextMuted">Each package sells through a hidden register product, so photo sales land in the drawer, sales tax and the P&L like any merchandise.</p>
    </div>
  );
}
