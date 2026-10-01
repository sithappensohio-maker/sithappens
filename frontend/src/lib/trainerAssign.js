// Audit #55 — who may change a dog's trainer, as the screens show it.
//
// The server rule (domains/training/services.require_trainer_assignment_authority):
// changing or removing a dog's trainer needs the 'Assign training staff'
// permission; without it the only change is naming yourself on a dog that has
// no trainer yet. Every trainer picker shows exactly that, so nobody is offered
// a choice the server will refuse:
//   "full"          — has the permission: any trainer, or none
//   "self_or_none"  — no permission, dog has no trainer: themselves, or none
//   "locked"        — no permission, dog has a trainer: read-only

export const TRAINER_LOCKED_HINT =
  "Only the owner or a manager can change a dog's trainer (Assign training staff permission).";

export function trainerPickerMode({ canAssign, currentId }) {
  if (canAssign) return "full";
  return currentId ? "locked" : "self_or_none";
}

// The trainers a picker in this mode may offer (besides "none").
export function trainerChoices(mode, trainers, meId) {
  const list = Array.isArray(trainers) ? trainers : [];
  if (mode === "full") return list;
  if (mode === "self_or_none") return list.filter(t => t && t.id === meId);
  return [];
}

// A trainer's name for read-only display.
export function trainerLabel(trainers, id, knownName) {
  if (!id) return "No trainer yet";
  if (knownName) return knownName;
  const t = (Array.isArray(trainers) ? trainers : []).find(x => x && x.id === id);
  return t ? (t.name || t.email || "Trainer") : "A trainer who is no longer on the team list";
}
