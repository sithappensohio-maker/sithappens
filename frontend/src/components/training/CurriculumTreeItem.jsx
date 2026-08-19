// Training UI Phase 5 — one row in the Program Studio curriculum outline.
// Icon + indentation carry the type visually, but never ALONE — every row
// also carries an aria-label naming its type, so the hierarchy reads
// correctly to a screen reader, not just by icon/indent.
const TYPE_META = {
  module: { icon: "fa-layer-group", cls: "text-shPrimary", active: "border-shPrimary/30 bg-shPrimary/[0.08]" },
  lesson: { icon: "fa-book-open", cls: "text-shSecondary", active: "border-shSecondary/30 bg-shSecondary/[0.07]" },
  skill: { icon: "fa-bullseye", cls: "text-shAccent", active: "border-shAccent/30 bg-shAccent/[0.06]" },
};

const COMPLETENESS_DOT = {
  complete: "bg-shPrimary shadow-[0_0_6px_rgba(140,198,63,0.45)]",
  needs_attention: "bg-shAccent shadow-[0_0_6px_rgba(242,101,34,0.45)]",
  optional: "bg-shTextMuted",
};

export default function CurriculumTreeItem({ type, name, selected, indent = 0, completeness, inactive, meta: metaText, onSelect, actions, testid }) {
  const meta = TYPE_META[type] || TYPE_META.module;
  return (
    <div className={`group flex items-center gap-2 min-h-[42px] px-2.5 py-2 rounded-xl border cursor-pointer transition ${selected ? meta.active : "border-transparent hover:border-shBorder/50 hover:bg-white/[0.025]"}`}
         style={{ paddingLeft: `${10 + indent * 6}px` }}
         onClick={onSelect}
         role="treeitem" aria-selected={selected} aria-label={`${type.charAt(0).toUpperCase()}${type.slice(1)}: ${name}`}
         data-testid={testid}>
      <span className={`w-7 h-7 rounded-lg border border-shBorder/40 bg-black/20 grid place-items-center shrink-0 ${meta.cls}`}>
        <i className={`fas ${meta.icon} text-[10px]`} aria-hidden="true"/>
      </span>
      {/* The name gets a floor, not just min-w-0: the four action buttons are
          always in the layout, and with a wrapping (non-nowrap) name the
          flex item would otherwise collapse to 0 width and stack one letter
          per line. Two lines before ellipsis + the full name as a tooltip
          keeps long titles identifiable instead of showing "Day …". */}
      <span className="flex-1 basis-0 min-w-[3.5rem] sm:min-w-[6.5rem]">
        <span title={name}
              className={`block text-[11.5px] font-bold leading-snug line-clamp-2 break-words ${inactive ? "text-shTextMuted" : "text-shText"}`}>{name}</span>
        {metaText && <span title={metaText} className="block text-[9px] text-shTextMuted truncate mt-0.5">{metaText}</span>}
        {inactive && <span className="text-[8px] text-shTextMuted">draft / inactive</span>}
      </span>
      {completeness && <span className={`w-2 h-2 rounded-full shrink-0 ${COMPLETENESS_DOT[completeness] || COMPLETENESS_DOT.optional}`} title={`Content: ${completeness.replace("_", " ")}`}/>} 
      <span className="flex items-center gap-0.5 shrink-0 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition">{actions}</span>
    </div>
  );
}
