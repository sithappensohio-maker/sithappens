import { useState } from "react";
import HuskyDogImage from "../../brand/HuskyDogImage";
import { deliveryLabel } from "../../../lib/studentSchool";

/* Dog / course switcher for clients with multiple active School enrollments.
 * Renders nothing for a single enrollment. Switching swaps the entire Home
 * (the parent reloads the view-model for the newly selected enrollment). */
export default function EnrollmentSelector({ enrollments = [], selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  if (enrollments.length <= 1) return null;
  const selected = enrollments.find((e) => e.school_enrollment_id === selectedId) || enrollments[0];

  return (
    <div className="relative" data-testid="enrollment-selector">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 rounded-xl border border-shBorder bg-[var(--sh-card-base)] px-3 py-2.5 text-left hover:border-shSecondary/40 transition"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="enrollment-selector-toggle"
      >
        <span className="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-[var(--sh-card-base)] border border-shBorder">
          <HuskyDogImage src={selected.dog_photo} name={selected.dog_name} className="w-full h-full object-cover" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-shText text-[14px] font-bold truncate">{selected.dog_name}</span>
          <span className="block text-[12px] text-shTextMuted truncate">{selected.program_name} · {deliveryLabel(selected.delivery_mode)}</span>
        </span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-xs`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul
            className="absolute z-20 mt-1 w-full rounded-xl border border-shBorder bg-[var(--sh-surface-raised,var(--sh-card-base))] shadow-xl overflow-hidden"
            role="listbox"
          >
            {enrollments.map((e) => {
              const active = e.school_enrollment_id === selectedId;
              return (
                <li key={e.school_enrollment_id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => { setOpen(false); if (!active) onSelect?.(e.school_enrollment_id); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition ${active ? "bg-shSecondary/10" : "hover:bg-shBorder/30"}`}
                    data-testid={`enrollment-option-${e.school_enrollment_id}`}
                  >
                    <span className="shrink-0 w-8 h-8 rounded-full overflow-hidden bg-[var(--sh-card-base)] border border-shBorder">
                      <HuskyDogImage src={e.dog_photo} name={e.dog_name} className="w-full h-full object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-shText text-[13px] font-bold truncate">{e.dog_name}</span>
                      <span className="block text-[11px] text-shTextMuted truncate">{e.program_name} · {deliveryLabel(e.delivery_mode)}</span>
                    </span>
                    {active && <i className="fas fa-check text-shPrimary text-xs" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
