import { useEffect, useRef, useState } from "react";

/* Compact "…" action menu — replaces rows of tiny text buttons crammed into
 * a table row. items: [{label, icon, onClick, danger, disabled, testid}]. */
export default function AdminActionMenu({ items = [], testid }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="relative inline-block" ref={ref} data-testid={testid}>
      <button onClick={() => setOpen(v => !v)}
              data-testid={testid ? `${testid}-trigger` : undefined}
              className="w-8 h-8 rounded-md grid place-items-center text-shTextMuted hover:text-shText border border-shBorder hover:border-shPrimary/40 transition"
              style={{ background: "var(--sh-card-base)" }}>
        <i className="fas fa-ellipsis-vertical text-[13px]" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 rounded-lg border border-shBorder shadow-sh z-20 py-1 overflow-hidden"
             style={{ background: "var(--sh-card-base)" }}>
          {items.map((it, i) => (
            <button key={i} onClick={() => { setOpen(false); it.onClick?.(); }} disabled={it.disabled}
                    data-testid={it.testid}
                    className={`w-full text-left px-3 py-2 text-[13px] font-medium flex items-center gap-2 transition disabled:opacity-40 ${it.danger ? "text-shDanger hover:bg-shDanger/10" : "text-shText hover:bg-shSurfaceRaised"}`}>
              {it.icon && <i className={`fas ${it.icon} w-4`} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
