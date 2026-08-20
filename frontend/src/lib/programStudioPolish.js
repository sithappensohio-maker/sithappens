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

// ---------------------------------------------------------------------------
// Program templates — export a program as a portable, editable blueprint and
// re-import it to seed a brand-new program. A template bundles EVERYTHING the
// course needs: the curriculum (modules/lessons/skills/checkpoints) AND the
// Practice Coach homework recipes each lesson links to, so one file recreates
// the whole thing. This never touches the server's create/validate authority:
// import recreates the practice recipes (POST /homework-templates), relinks
// the lessons to their new ids, then prefills the New Program editor (an
// id-less draft) so the operator still reviews and Saves through the normal
// POST /programs path. Curriculum ids (module/lesson/goal) are KEPT so a
// lesson's skill_ids keep pointing at their goals; only identity/runtime
// fields that must not carry across into a fresh program are stripped.
// ---------------------------------------------------------------------------
export const TEMPLATE_STRIP_FIELDS = [
  "id", "_id", "slug", "created_at", "is_default", "owner_dog_id",
  "draft", "practice_coach_readiness", "_cascaded_enrollments",
];
// Homework (Practice Coach) recipes keep their `id` in the bundle purely so
// import can remap each lesson's link after recreating them; only true
// runtime/derived fields are dropped.
export const HW_TEMPLATE_STRIP_FIELDS = ["_id", "created_at", "practice_coach_readiness"];

// Every homework-template id a program references, from ALL link sites: the
// program welcome recipe, a module's on-mastery recipe, a goal's recipes, and
// a lesson's practice recipes. Bundling from all of them keeps a template
// self-contained no matter which links the author used.
export function referencedHomeworkTemplateIds(program) {
  const ids = new Set();
  const add = (id) => { if (id) ids.add(id); };
  add(program?.welcome_homework_template_id);
  for (const m of (program?.modules || [])) {
    add(m.homework_template_id);
    for (const g of (m.goals || [])) for (const id of (g.homework_template_ids || [])) add(id);
    for (const l of (m.lessons || [])) for (const id of (l.suggested_homework_template_ids || [])) add(id);
  }
  return [...ids];
}

// Serialize a program (plus the homework templates it references, drawn from
// the caller's already-loaded library) into a self-describing bundle — what a
// downloaded .json file contains.
export function programToTemplate(program, homeworkTemplates = []) {
  const p = { ...(program || {}) };
  for (const f of TEMPLATE_STRIP_FIELDS) delete p[f];
  const refIds = new Set(referencedHomeworkTemplateIds(program));
  const bundled = (homeworkTemplates || [])
    .filter((t) => t && refIds.has(t.id))
    .map((t) => { const c = { ...t }; for (const f of HW_TEMPLATE_STRIP_FIELDS) delete c[f]; return c; });
  return { sit_happens_template: "online_school_program", version: 2, program: p, homework_templates: bundled };
}

// Parse an uploaded template (accepts either the wrapped {program} shape or a
// bare program object) into a New Program draft. Returns null if it isn't a
// usable program (no modules array) so the caller can show a clean error
// instead of opening an empty editor.
export function templateToNewProgram(parsed) {
  const raw = parsed && typeof parsed === "object" && parsed.program ? parsed.program : parsed;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.modules) || !raw.name) return null;
  const draft = { ...raw };
  for (const f of TEMPLATE_STRIP_FIELDS) delete draft[f]; // never carry an id => saves as NEW
  return draft;
}

// Full bundle parse: the program draft plus any embedded homework recipes the
// caller must recreate before opening the editor. Null when it isn't a usable
// program at all.
export function parseProgramTemplate(parsed) {
  const draft = templateToNewProgram(parsed);
  if (!draft) return null;
  const homeworkTemplates = Array.isArray(parsed?.homework_templates) ? parsed.homework_templates : [];
  return { program: draft, homeworkTemplates };
}

// After import recreates the bundled homework templates (getting fresh server
// ids), rewrite every lesson's practice link from the old bundled id to the
// new one. Links with no mapping (a recipe that wasn't in the bundle) are
// dropped rather than left dangling at an id that doesn't exist here.
export function remapProgramHomework(program, idMap) {
  const map = idMap || {};
  // A bundled id remaps to its fresh server id; an id that wasn't in the
  // bundle is left as-is (it may be a real recipe that already exists on this
  // install), never dropped or nulled.
  const one = (id) => (id ? (map[id] || id) : id);
  const many = (ids) => (ids || []).map((id) => map[id] || id);
  const modules = (program?.modules || []).map((m) => ({
    ...m,
    homework_template_id: one(m.homework_template_id),
    goals: (m.goals || []).map((g) => ({ ...g, homework_template_ids: many(g.homework_template_ids) })),
    lessons: (m.lessons || []).map((l) => ({ ...l, suggested_homework_template_ids: many(l.suggested_homework_template_ids) })),
  }));
  return { ...program, welcome_homework_template_id: one(program?.welcome_homework_template_id), modules };
}

// ---------------------------------------------------------------------------
// Program Studio UX polish — outline scale, lesson navigation, readiness.
// Everything below is PURE and reads the same in-memory draft the editors
// already use. No new stored field, no second readiness model: the counts
// roll up computeLessonCompleteness / computeSkillCompleteness verbatim.
// ---------------------------------------------------------------------------

// A checkpoint counts as "ready" only when it is switched on AND actually
// gradeable — a rubric with no criteria cannot be scored, and a submission
// with no instructions cannot be filmed. Lessons WITHOUT a checkpoint are not
// counted at all (they are not incomplete, they simply have none).
export function computeCheckpointCompleteness(lesson) {
  const cp = (lesson || {}).checkpoint || {};
  return [
    { key: "handler_criteria", label: "Handler criteria", state: (cp.handler_criteria || []).length > 0 ? "complete" : "needs_attention" },
    { key: "dog_criteria", label: "Dog criteria", state: (cp.dog_criteria || []).length > 0 ? "complete" : "needs_attention" },
    { key: "submission_instructions", label: "Submission instructions", state: (cp.submission_instructions || "").trim() ? "complete" : "needs_attention" },
  ];
}

export function lessonHasCheckpoint(lesson) {
  return !!((lesson || {}).checkpoint || {}).enabled;
}

/** Curriculum order, flattened. The single source of truth for "what is the
 *  next lesson" — walks modules in order, then lessons within each module, so
 *  Previous/Next crosses module boundaries exactly the way the outline reads. */
export function flattenLessons(modules) {
  const out = [];
  for (const m of modules || []) {
    for (const l of m.lessons || []) {
      out.push({ moduleKey: m._key, lessonKey: l._key, moduleName: m.name, lessonName: l.name });
    }
  }
  return out;
}

/** Neighbours of the currently-selected lesson in curriculum order.
 *  Returns {prev, next, index, total}; prev/next are null at the ends. */
export function lessonNeighbours(modules, selected) {
  const flat = flattenLessons(modules);
  const idx = selected?.lessonKey ? flat.findIndex(x => x.lessonKey === selected.lessonKey) : -1;
  if (idx === -1) return { prev: null, next: null, index: -1, total: flat.length };
  return {
    prev: idx > 0 ? flat[idx - 1] : null,
    next: idx < flat.length - 1 ? flat[idx + 1] : null,
    index: idx, total: flat.length,
  };
}

/** Readiness rollup for the header metrics. Reuses the existing completeness
 *  dimensions so Studio can never disagree with the per-item checklists. */
export function computeProgramReadiness(modules) {
  const mods = modules || [];
  let lessonsReady = 0, lessonsTotal = 0;
  let skillsReady = 0, skillsTotal = 0;
  let cpReady = 0, cpTotal = 0;
  for (const m of mods) {
    for (const l of m.lessons || []) {
      lessonsTotal += 1;
      if (rollUpCompleteness(computeLessonCompleteness(l)) === "complete") lessonsReady += 1;
      if (lessonHasCheckpoint(l)) {
        cpTotal += 1;
        if (rollUpCompleteness(computeCheckpointCompleteness(l)) === "complete") cpReady += 1;
      }
    }
    for (const g of m.goals || []) {
      skillsTotal += 1;
      if (rollUpCompleteness(computeSkillCompleteness(g)) === "complete") skillsReady += 1;
    }
  }
  return {
    modules: { total: mods.length },
    lessons: { ready: lessonsReady, total: lessonsTotal },
    skills: { ready: skillsReady, total: skillsTotal },
    checkpoints: { ready: cpReady, total: cpTotal },
  };
}

/** First item still needing attention, for the "click a metric to jump"
 *  affordance. Returns a `selected`-shaped object or null. */
export function firstIncomplete(modules, kind) {
  for (const m of modules || []) {
    if (kind === "skills") {
      for (const g of m.goals || []) {
        if (rollUpCompleteness(computeSkillCompleteness(g)) !== "complete") return { moduleKey: m._key, skillKey: g._key };
      }
      continue;
    }
    for (const l of m.lessons || []) {
      if (kind === "lessons" && rollUpCompleteness(computeLessonCompleteness(l)) !== "complete") {
        return { moduleKey: m._key, lessonKey: l._key };
      }
      if (kind === "checkpoints" && lessonHasCheckpoint(l)
          && rollUpCompleteness(computeCheckpointCompleteness(l)) !== "complete") {
        return { moduleKey: m._key, lessonKey: l._key };
      }
    }
  }
  return null;
}

/** Case-insensitive outline filter across module, lesson and skill names.
 *  READ-ONLY: returns a filtered VIEW of the same objects (never a copy that
 *  could be edited and lost, and never a mutation of the draft). A module is
 *  kept when its own name matches (with all children) or when any child
 *  matches (with only the matching children). */
export function filterCurriculum(modules, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return { modules: modules || [], filtered: false, matchCount: 0 };
  const hit = (s) => (s || "").toLowerCase().includes(q);
  const out = [];
  let matchCount = 0;
  for (const m of modules || []) {
    const lessons = (m.lessons || []).filter(l => hit(l.name));
    const goals = (m.goals || []).filter(g => hit(g.name));
    if (hit(m.name)) {
      matchCount += 1 + (m.lessons || []).length + (m.goals || []).length;
      out.push(m);
    } else if (lessons.length || goals.length) {
      matchCount += lessons.length + goals.length;
      out.push({ ...m, lessons, goals });
    }
  }
  return { modules: out, filtered: true, matchCount };
}
