// Training UI Phase 1 — shared equipment chip list. `equipment` is the
// existing stored string field (comma/slash separated); this never adds a
// new backend list field, it just splits the existing string for display.
export default function EquipmentChips({ equipment, testid }) {
  if (!equipment) return null;
  const items = String(equipment).split(/[,/]/).map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1 bg-shBorder/20 border border-shBorder rounded-full px-2.5 py-1 text-[11px] font-bold text-shText">
          <i className="fas fa-box text-shTextMuted text-[10px]"/>{item}
        </span>
      ))}
    </div>
  );
}
