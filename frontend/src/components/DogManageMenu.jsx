/* Sprint 110di-34 — Always-visible Manage dropdown on the admin Dogs cards.

The user reported the "manage dog drop down is missing" after the
previous N+1 LazyMount change. Root cause: the only opener was a
hover-revealed pencil icon at top-right, which is invisible on
desktop until you hover the card. This component is the proper fix —
a labeled button + dropdown that's always visible AND deep-links to
the right tab of the existing edit modal (no new modal, no new
endpoint, no new settings). */
import { useEffect, useRef, useState } from "react";

const QUICK_TABS = [
  { id: "basics",   label: "Basics",            icon: "fa-paw" },
  { id: "vaccines", label: "Vaccines",          icon: "fa-shield-virus" },
  { id: "care",     label: "Feeding & Meds",    icon: "fa-bowl-food" },
  { id: "training", label: "Training & Homework", icon: "fa-graduation-cap" },
  { id: "gallery",  label: "Gallery",           icon: "fa-images" },
  { id: "notes",    label: "Notes & Vet",       icon: "fa-clipboard" },
  { id: "timeline", label: "Timeline",          icon: "fa-clock-rotate-left" },
];

export default function DogManageMenu({ dog, onOpen, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="absolute top-3 right-3 z-10" data-testid={`dog-manage-${dog.id}`}>
      <button onClick={() => setOpen(o => !o)} data-testid={`dog-manage-btn-${dog.id}`}
              className="bg-bgHeader/90 text-white px-3 py-1.5 rounded-md text-[11px] font-black uppercase tracking-widest border border-bgHover hover:border-shGreen flex items-center gap-1.5 shadow-lg">
        <i className="fas fa-sliders"/>Manage<i className={`fas fa-chevron-${open ? "up" : "down"} text-[9px]`}/>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-bgPanel border border-bgHover rounded-md shadow-2xl py-1"
             data-testid={`dog-manage-menu-${dog.id}`}>
          {QUICK_TABS.map(t => (
            <button key={t.id} onClick={() => { setOpen(false); onOpen(dog, t.id); }}
                    data-testid={`dog-manage-item-${dog.id}-${t.id}`}
                    className="w-full text-left px-3 py-2 text-[12px] font-black uppercase tracking-widest text-gray-300 hover:bg-bgHover hover:text-white flex items-center gap-2">
              <i className={`fas ${t.icon} text-shGreen w-4 text-center`}/>{t.label}
            </button>
          ))}
          <div className="border-t border-bgHover my-1"/>
          <button onClick={() => { setOpen(false); onDelete(); }}
                  data-testid={`dog-manage-delete-${dog.id}`}
                  className="w-full text-left px-3 py-2 text-[12px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/10 flex items-center gap-2">
            <i className="fas fa-trash w-4 text-center"/>Delete Dog
          </button>
        </div>
      )}
    </div>
  );
}
