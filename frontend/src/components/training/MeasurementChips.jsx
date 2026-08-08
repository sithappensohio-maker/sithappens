// Shared measurement chip group. Editable/read-only semantics are unchanged;
// the layout is now roomier on desktop and finger-friendly on phones.
export default function MeasurementChips({ items, testid }) {
  const visible = items.filter(it => it.value || it.onChange);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2" data-testid={testid}>
      {visible.map(it => (
        <div key={it.key} className="bg-black/15 border border-shBorder/55 rounded-xl px-3 py-2.5 min-w-0 sm:min-w-[110px]" data-testid={testid ? `${testid}-${it.key}` : undefined}>
          <p className="text-[9px] font-black uppercase tracking-[0.12em] text-shTextMuted flex items-center gap-1.5 truncate">
            {it.icon && <i className={`fas ${it.icon} text-shSecondary`}/>}<span className="truncate">{it.label}</span>
          </p>
          {it.onChange ? (
            <input value={it.value || ""} onChange={(e) => it.onChange(e.target.value)}
                   placeholder={it.placeholder || "—"} data-testid={testid ? `${testid}-${it.key}-input` : undefined}
                   className="w-full bg-transparent text-shText text-[15px] font-black border-0 p-0 mt-1 focus:outline-none min-h-[24px]"/>
          ) : (
            <p className="text-shText text-[14px] font-black truncate mt-1">{it.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
