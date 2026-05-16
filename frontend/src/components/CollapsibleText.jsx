import { useState } from "react";

/**
 * CollapsibleText — keeps a single-line preview with a tiny "More" toggle.
 * Used for read-once-then-forget content (training program focus blurbs, etc.).
 * Optional title for the popover/expanded view.
 */
export default function CollapsibleText({ text, title = "Description", maxChars = 60, className = "", testid }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > maxChars;
  return (
    <div className={className} data-testid={testid}>
      <div className="flex items-start gap-2">
        <p className={`text-[13px] text-gray-400 min-w-0 ${open ? "" : "truncate"}`}>{open ? text : (long ? text.slice(0, maxChars).trimEnd() + "…" : text)}</p>
        {long && (
          <button
            type="button"
            onClick={(e)=>{ e.stopPropagation(); setOpen(o => !o); }}
            data-testid={testid ? `${testid}-toggle` : undefined}
            className="shrink-0 text-[10px] font-black uppercase tracking-widest text-shBlue hover:underline whitespace-nowrap"
          >
            <i className={`fas fa-chevron-${open ? "up" : "down"} mr-1`}/>{open ? "Less" : "More"}
          </button>
        )}
      </div>
      {open && title && <p className="sr-only">{title}</p>}
    </div>
  );
}
