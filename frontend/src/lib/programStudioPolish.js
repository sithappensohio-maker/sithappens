// Training UI Phase 5 — pure presentation helpers for Program Studio's
// curriculum completeness indicators and validation-issue navigation.
// Every check reads fields already on the in-memory draft (program.modules)
// — no new backend computation, no new stored field.

// Content-completeness dimensions, deliberately matching the backend's own
// _validate_program_structure warning set (missing_trainer_instructions,
// missing_advancement_criteria, lesson_without_skills) so Studio's visual
// checklist and the server's publish-blocking validation never disagree
// about what's "recommended" vs. truly optional. Video/resource and
// homework links are OPTIONAL — never flagged as an issue when absent,
// per the brief's "don't mark optional media as an error" rule.
export function computeLessonCompleteness(lesson) {
  const l = lesson || {};
  return [
    { key: "client_overview", label: "Client overview", state: (l.client_overview || "").trim() ? "complete" : "needs_attention" },
    { key: "trainer_directions", label: "Trainer directions", state: (l.trainer_instructions || "").trim() ? "complete" : "needs_attention" },
    { key: "success_criteria", label: "Success criteria", state: (l.success_criteria || "").trim() ? "complete" : "needs_attention" },
    { key: "video_resource", label: "Video / resource", state: (l.demo_video_url || "").trim() ? "complete" : "optional" },
    { key: "homework_linked", label: "Homework linked", state: (l.suggested_homework_template_ids || []).length > 0 ? "complete" : "optional" },
    { key: "skills_attached", label: "Skills attached", state: (l.skill_ids || []).length > 0 ? "complete" : "needs_attention" },
    { key: "advancement_criteria", label: "Advancement criteria", state: (l.advancement_criteria || "").trim() ? "complete" : "needs_attention" },
  ];
}

export function computeSkillCompleteness(skill) {
  const g = skill || {};
  const hasMeasurement = !!(g.target_duration || g.target_distance || g.target_repetitions || g.target_distraction_level || g.target_environment);
  return [
    { key: "client_explanation", label: "Client-facing explanation", state: (g.client_facing_explanation || "").trim() ? "complete" : "needs_attention" },
    { key: "measurements", label: "Measurements configured", state: hasMeasurement ? "complete" : "optional" },
    { key: "pass_criteria", label: "Pass criteria", state: (g.pass_criteria || "").trim() ? "complete" : "needs_attention" },
  ];
}

// Rolls a completeness list up into one badge state for the outline tree —
// "needs_attention" wins over "complete"/"optional" so a single missing
// recommended field is never hidden by an otherwise-full lesson.
export function rollUpCompleteness(items) {
  if ((items || []).some(i => i.state === "needs_attention")) return "needs_attention";
  return "complete";
}

// Validation checklist grouping — buckets the backend's flat errors/
// warnings (each already carrying module_id/lesson_id/skill_id, see
// _validate_program_structure) by section, so the UI can render "Modules",
// "Lessons", "Skills", "Homework links", "Prerequisites" groups instead of
// one giant unstructured list.
const HOMEWORK_CODES = new Set(["broken_homework_ref", "inactive_homework_ref"]);
const PREREQ_CODES = new Set(["broken_prerequisite", "broken_next_skill"]);

export function groupValidationIssues(validation) {
  const groups = { program: [], modules: [], lessons: [], skills: [], homework_links: [], prerequisites: [] };
  const all = [
    ...(validation?.errors || []).map(i => ({ ...i, severity: "error" })),
    ...(validation?.warnings || []).map(i => ({ ...i, severity: "warning" })),
  ];
  for (const issue of all) {
    if (HOMEWORK_CODES.has(issue.code)) groups.homework_links.push(issue);
    else if (PREREQ_CODES.has(issue.code)) groups.prerequisites.push(issue);
    else if (issue.skill_id) groups.skills.push(issue);
    else if (issue.lesson_id) groups.lessons.push(issue);
    else if (issue.module_id) groups.modules.push(issue);
    else groups.program.push(issue);
  }
  return groups;
}

// Resolves a validation issue's {module_id, lesson_id?, skill_id?} back to
// this Studio session's local _key-based selection — the SAME ids the
// backend already returns, matched against the in-memory program's real
// `id` fields (set once a module/lesson/skill has been saved at least
// once; a brand-new unsaved node has no `id` yet and simply can't be a
// validation target, since validation always runs against a saved draft).
export function resolveValidationTarget(issue, modules) {
  const mod = (modules || []).find(m => m.id === issue.module_id);
  if (!mod) return null;
  if (issue.skill_id) {
    const skill = (mod.goals || []).find(g => g.id === issue.skill_id);
    if (skill) return { moduleKey: mod._key, skillKey: skill._key };
  }
  if (issue.lesson_id) {
    const lesson = (mod.lessons || []).find(l => l.id === issue.lesson_id);
    if (lesson) return { moduleKey: mod._key, lessonKey: lesson._key };
  }
  return { moduleKey: mod._key };
}
