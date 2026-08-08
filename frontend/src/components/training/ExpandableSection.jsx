// Shared expandable instruction section. Long trainer directions stay tucked
// away until requested, but the surface now matches the Online School shell.
import { useState } from "react";

export default function ExpandableSection({ title, icon, tone = "muted", defaultOpen = false, children, testid }) {
  const [open, setOpen] = useState(defaultOpen);
  const toneCls = {
    muted: "text-shTextMuted",
    secondary: "text-shSecondary",
    accent: "text-shAccent",
    danger: "text-red-300",
    primary: "text-shPrimary",
  }[tone] || "text-shTextMuted";
  const borderCls = {
    secondary: "open:border-shSecondary/35",
    accent: "open:border-shAccent/35",
    danger: "open:border-red-400/30",
    primary: "open:border-shPrimary/35",
  }[tone] || "";
  return (
    <div className={`rounded-2xl border border-shBorder/55 bg-black/15 overflow-hidden transition ${borderCls}`} data-testid={testid}>
      <button onClick={() => setOpen(o => !o)} data-testid={testid ? `${testid}-toggle` : undefined}
              className="w-full flex items-center justify-between gap-3 px-4 py-3.5 sm:px-4 sm:py-4 text-left hover:bg-white/[0.025] transition">
        <span className={`flex items-center gap-2.5 text-[12px] sm:text-[13px] font-black ${toneCls}`}>
          {icon && <span className="w-8 h-8 rounded-xl border border-shBorder/55 bg-white/[0.025] grid place-items-center shrink-0"><i className={`fas ${icon} text-[11px]`}/></span>}
          {title}
        </span>
        <span className="w-8 h-8 rounded-lg border border-shBorder/45 grid place-items-center shrink-0">
          <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[10px]`}/>
        </span>
      </button>
      {open && <div className="px-4 pb-4 sm:px-5 sm:pb-5 border-t border-shBorder/35 pt-4" data-testid={testid ? `${testid}-content` : undefined}>{children}</div>}
    </div>
  );
}
