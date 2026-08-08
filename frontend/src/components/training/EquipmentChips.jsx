// Shared equipment chip list. Presentation only over the existing stored
// equipment string.
export default function EquipmentChips({ equipment, testid }) {
  if (!equipment) return null;
  const items = String(equipment).split(/[,/]/).map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid={testid}>
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-2 bg-white/[0.025] border border-shBorder/55 rounded-xl px-3 py-2 text-[11px] sm:text-[12px] font-bold text-shText">
          <i className="fas fa-bag-shopping text-shSecondary text-[10px]"/>{item}
        </span>
      ))}
    </div>
  );
}
