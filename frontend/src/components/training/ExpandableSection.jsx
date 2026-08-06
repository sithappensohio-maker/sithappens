// Training UI Phase 1 — shared collapsed-by-default instruction section.
// Directly implements the brief's global information hierarchy rule:
// full trainer directions / troubleshooting / safety detail stay hidden
// until explicitly opened.
import { useState } from "react";

export default function ExpandableSection({ title, icon, tone = "muted", defaultOpen = false, children, testid }) {
  const [open, setOpen] = useState(defaultOpen);
  const toneCls = { muted: "text-shTextMuted", secondary: "text-shSecondary", accent: "text-shAccent", danger: "text-red-300" }[tone] || "text-shTextMuted";
  return (
    <div className="bg-black/20 border border-shBorder rounded-lg" data-testid={testid}>
      <button onClick={() => setOpen(o => !o)} data-testid={testid ? `${testid}-toggle` : undefined}
              className="w-full flex items-center justify-between px-3 py-2.5">
        <span className={`text-[11px] font-black uppercase tracking-widest ${toneCls}`}>
          {icon && <i className={`fas ${icon} mr-1.5`}/>}{title}
        </span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[12px]`}/>
      </button>
      {open && <div className="px-3 pb-3" data-testid={testid ? `${testid}-content` : undefined}>{children}</div>}
    </div>
  );
}
