// Shared section header — an icon + title, with an optional numbered badge
// for a genuine multi-step flow (Register's "1. Select Client" / "2. ..." /
// "3. ..."). Extracted from Staff.jsx's RegisterTab so every screen that
// wants this same visual language (not just guided money flows) can reuse
// it instead of hand-rolling its own uppercase <p> label.
//
// Colors reference the shPrimary/shSecondary *semantic* tokens rather than
// the shGreen/shBlue brand names some older screens (e.g. EmployeePortal)
// still use directly — they resolve to the exact same CSS variables
// (see tailwind.config.js + index.css), so this renders identically next
// to either naming convention.
export default function StepHeader({ n, icon, title }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {n != null && (
        <span className="w-6 h-6 rounded-full bg-shPrimary/15 text-shPrimary text-[12px] font-black grid place-items-center shrink-0">{n}</span>
      )}
      <i className={`fas ${icon} text-shSecondary text-[13px]`} />
      <h4 className="text-shText font-black uppercase italic tracking-tight text-[13px]">{title}</h4>
    </div>
  );
}
