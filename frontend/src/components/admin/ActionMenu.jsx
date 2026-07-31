import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/* Phase 4 — global "+ New" action launcher.
 *
 * Pure launcher: every action it lists calls into an existing screen/modal
 * already used elsewhere in the app (see App.js's ACTION_GROUPS) — this
 * component owns none of that business logic, only the open/close/keyboard/
 * focus behavior of the menu itself.
 */
export default function ActionMenu({ groups, disabled = false, disabledReason = "", buttonClassName = "", buttonTestId = "new-action-button", label = "New" }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef(null);
  const itemRefs = useRef([]);
  const containerRef = useRef(null);

  const flatItems = groups.flatMap(g => g.actions);

  const close = () => {
    setOpen(false);
    // Return focus to the trigger whenever the menu goes away, whether by
    // Escape, click-outside, or after an action is chosen.
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const toggle = () => {
    if (disabled) {
      toast.error(disabledReason || "Close the current dialog first.");
      return;
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    const onDocClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) close();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && itemRefs.current[activeIndex]) itemRefs.current[activeIndex].focus();
  }, [open, activeIndex]);

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, flatItems.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); return; }
    if (e.key === "Home") { e.preventDefault(); setActiveIndex(0); return; }
    if (e.key === "End") { e.preventDefault(); setActiveIndex(flatItems.length - 1); return; }
    if (e.key === "Tab") { close(); }
  };

  const runAction = (action) => {
    close();
    action.onSelect();
  };

  itemRefs.current = [];

  return (
    <div className="relative inline-block" ref={containerRef} onKeyDown={onKeyDown}>
      <button ref={buttonRef} onClick={toggle} data-testid={buttonTestId}
              aria-haspopup="menu" aria-expanded={open} aria-disabled={disabled || undefined}
              aria-label={label || "New"} title={label ? undefined : "New"}
              className={buttonClassName || "min-h-[44px] px-4 py-2.5 rounded-lg bg-shPrimary text-bgHeader font-black uppercase tracking-widest text-[13px] hover:brightness-110 transition"}>
        <i className={`fas fa-plus ${label ? "mr-2" : ""}`}/>{label}
      </button>

      {open && (
        <div role="menu" aria-label="New" data-testid={`${buttonTestId}-panel`}
             className="fixed sm:absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:top-full sm:left-0 sm:mt-2 z-50 sm:w-72 max-h-[70vh] overflow-y-auto rounded-xl border border-shBorder shadow-2xl"
             style={{ background: "var(--sh-card-base)" }}>
          {groups.map((g, gi) => (
            <div key={g.label} className={gi > 0 ? "border-t border-shBorder" : ""}>
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-shTextMuted/70">{g.label}</p>
              <div className="pb-1.5">
                {g.actions.map(a => {
                  const flatIdx = flatItems.indexOf(a);
                  return (
                    <button key={a.id}
                            ref={el => { itemRefs.current[flatIdx] = el; }}
                            role="menuitem"
                            tabIndex={activeIndex === flatIdx ? 0 : -1}
                            onClick={() => runAction(a)}
                            data-testid={`new-action-${a.id}`}
                            className="w-full min-h-[44px] flex items-center gap-2.5 text-left px-3 py-2 text-[13px] font-semibold text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised focus:text-shText focus:bg-shSurfaceRaised focus:outline-none transition">
                      <i className={`fas ${a.icon} w-4 text-shTextMuted`}/>
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {flatItems.length === 0 && (
            <p className="px-3 py-3 text-[13px] text-shTextMuted">No actions available for your role yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
