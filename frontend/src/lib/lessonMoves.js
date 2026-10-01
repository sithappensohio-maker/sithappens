// Audit #52 — a course edit pushed to enrolled dogs never strands one.
//
// When a saved/published course drops the lesson a dog is on, the server
// moves that dog to the nearest lesson that still exists
// (backend/domains/school/curriculum_moves.py). The same rule previews the
// move before the save (POST /programs/{id}/cascade-preview, and
// publish-impact's `lesson_moves`) and the save returns the list it made
// (`_lesson_moves`, the import's `lesson_moves`). These helpers turn either
// list into plain sentences, so every screen says it the same way.

const plural = (n, one, many) => (n === 1 ? one : many);

const quoted = (name) => (name ? `"${name}"` : "");

function destination(m) {
  const lesson = quoted(m.to_lesson_name) || "the next lesson";
  return m.to_module_name ? `${lesson} (${m.to_module_name})` : lesson;
}

// One move as one line: "Rex: "Loose leash" → "Heel" (Module 2)".
export function describeLessonMove(m) {
  const dog = m.dog_name || "A dog";
  const from = quoted(m.from_lesson_name) || "a lesson that no longer exists";
  switch (m.rule) {
    case "was_already_missing":
      return `${dog}: was on a lesson that no longer exists → ${destination(m)}`;
    case "held_for_module_quiz":
      return `${dog}: ${from} → ${destination(m)} — the ${m.to_module_name || "module"} quiz still comes first`;
    case "lesson_moved_module":
      return `${dog}: ${from} now sits in ${m.to_module_name || "another module"} — they stay on it`;
    case "no_lessons_left":
      return `${dog}: ${from} was removed and no lessons are left — add a lesson so they can continue`;
    case "changed_during_save":
      return `${dog} changed lessons while this saved — left where they are now`;
    default:
      return `${dog}: ${from} → ${destination(m)}`;
  }
}

// Lines for a list, capped so a big class doesn't swamp a dialog.
export function lessonMoveLines(moves, limit = 6) {
  const list = Array.isArray(moves) ? moves : [];
  const lines = list.slice(0, limit).map(describeLessonMove);
  if (list.length > limit) lines.push(`…and ${list.length - limit} more`);
  return lines;
}

// How many of the moves are dogs whose lesson was removed (a lesson that only
// changed module isn't a removal).
export function removedLessonCount(preview) {
  if (preview && Number.isFinite(preview.students_on_removed_lessons)) return preview.students_on_removed_lessons;
  const moves = (preview && preview.lesson_moves) || [];
  return moves.filter(m => m.rule !== "lesson_moved_module").length;
}

// The heading over a preview list ("" when nobody changes lessons).
export function lessonMovePreviewIntro(preview, yesLabel = "Yes") {
  const moves = (preview && preview.lesson_moves) || [];
  if (!moves.length) return "";
  const n = removedLessonCount(preview);
  if (!n) return `With ${yesLabel}, ${plural(moves.length, "this dog follows its lesson", "these dogs follow their lessons")} to the new module:`;
  return `${n} enrolled ${plural(n, "dog is", "dogs are")} on a lesson you removed. With ${yesLabel}, ${plural(n, "it moves", "they move")} to the nearest lesson that still exists:`;
}

// The extra paragraph for the "Apply changes to enrolled dogs?" dialog.
export function lessonMovePreviewNote(preview) {
  const intro = lessonMovePreviewIntro(preview);
  if (!intro) return "";
  return `\n\n${intro}\n${lessonMoveLines(preview.lesson_moves).map(l => `• ${l}`).join("\n")}`;
}

// The heading over what a save actually did ("" when nobody moved).
export function lessonMovesHeadline(moves) {
  const n = Array.isArray(moves) ? moves.length : 0;
  if (!n) return "";
  return `${n} enrolled ${plural(n, "dog", "dogs")} changed lesson because the course changed`;
}

// Save Live / Shop Manager: who an "update enrolled dogs" save of these
// modules would move. A failed preview never blocks the save — it just
// leaves the dialog without the list.
export async function previewLessonMoves(client, programId, modules) {
  try {
    const { data } = await client.post(`/programs/${programId}/cascade-preview`, { modules: modules || [] });
    return data || null;
  } catch {
    return null;
  }
}
