import { TRAINER_LOCKED_HINT, trainerChoices, trainerLabel, trainerPickerMode } from "../../lib/trainerAssign";

// Audit #55 — one trainer picker for School HQ, Assign Program and the legacy
// move: it offers only what the server allows this person to do.
export default function TrainerAssignField({
  trainers = [], value, onChange, canAssign, meId, currentId, currentName,
  unassignedLabel = "Sit Happens team", selectClassName = "input-school", testid = "trainer-assign",
}) {
  const mode = trainerPickerMode({ canAssign, currentId });
  if (mode === "locked") {
    return (
      <div className="min-h-[42px] flex flex-col justify-center" data-testid={`${testid}-locked`}>
        <p className="text-sm font-bold text-shText">{trainerLabel(trainers, currentId, currentName)}</p>
        <p className="text-[10px] text-shTextMuted leading-snug mt-0.5">{TRAINER_LOCKED_HINT}</p>
      </div>
    );
  }
  const options = trainerChoices(mode, trainers, meId);
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value)} className={selectClassName} data-testid={`${testid}-select`}>
      <option value="">{unassignedLabel}</option>
      {options.map(t => (
        <option key={t.id} value={t.id}>{mode === "full" ? (t.name || t.email) : `Me (${t.name || t.email})`}</option>
      ))}
    </select>
  );
}
