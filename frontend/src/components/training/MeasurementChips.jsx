// Training UI Phase 1 — shared measurement chip group. Replaces bare text-
// input grids with labeled pill-style chips. Each item without an onChange
// renders as a read-only target chip (e.g. showing the goal's stored
// target_duration); each item WITH an onChange renders as a compact
// editable chip (used for recording actuals) — same visual language either
// way, so a trainer sees "what we're aiming for" and "what happened today"
// in a consistent shape.
export default function MeasurementChips({ items, testid }) {
  const visible = items.filter(it => it.value || it.onChange);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid={testid}>
      {visible.map(it => (
        <div key={it.key} className="bg-black/20 border border-shBorder rounded-lg px-2.5 py-1.5 min-w-[84px]" data-testid={testid ? `${testid}-${it.key}` : undefined}>
          <p className="text-[9px] font-black uppercase tracking-widest text-shTextMuted flex items-center gap-1">
            {it.icon && <i className={`fas ${it.icon}`}/>}{it.label}
          </p>
          {it.onChange ? (
            <input value={it.value || ""} onChange={(e) => it.onChange(e.target.value)}
                   placeholder={it.placeholder || "—"} data-testid={testid ? `${testid}-${it.key}-input` : undefined}
                   className="w-full bg-transparent text-shText text-[13px] font-bold border-0 p-0 focus:outline-none"/>
          ) : (
            <p className="text-shText text-[13px] font-bold truncate">{it.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
