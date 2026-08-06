// Training UI Phase 5 — one row in the Program Studio curriculum outline.
// Icon + indentation carry the type visually, but never ALONE — every row
// also carries an aria-label naming its type, so the hierarchy reads
// correctly to a screen reader, not just by icon/indent.
const TYPE_META = {
  module: { icon: "fa-layer-group", cls: "text-shPrimary" },
  lesson: { icon: "fa-book", cls: "text-shSecondary" },
  skill: { icon: "fa-bullseye", cls: "text-shAccent" },
};

const COMPLETENESS_DOT = {
  complete: "bg-shPrimary",
  needs_attention: "bg-shAccent",
  optional: "bg-shTextMuted",
};

export default function CurriculumTreeItem({ type, name, selected, indent = 0, completeness, inactive, onSelect, actions, testid }) {
  const meta = TYPE_META[type] || TYPE_META.module;
  return (
    <div className={`flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer ${selected ? "bg-shPrimary/15" : "hover:bg-white/5"}`}
         style={{ paddingLeft: `${8 + indent * 16}px` }}
         onClick={onSelect}
         role="treeitem" aria-selected={selected} aria-label={`${type.charAt(0).toUpperCase()}${type.slice(1)}: ${name}`}
         data-testid={testid}>
      <i className={`fas ${meta.icon} ${meta.cls} text-[11px] w-4 text-center shrink-0`} aria-hidden="true"/>
      <span className="flex-1 text-[12.5px] text-shText truncate">
        {name}
        {inactive && <span className="text-shTextMuted ml-1">(draft)</span>}
      </span>
      {completeness && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${COMPLETENESS_DOT[completeness] || COMPLETENESS_DOT.optional}`} title={`Content: ${completeness.replace("_", " ")}`}/>}
      {actions}
    </div>
  );
}
