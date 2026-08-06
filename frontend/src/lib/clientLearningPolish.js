// Training UI Phase 4 — pure presentation helpers for Client Learn/Progress.
// Every function derives its answer from data /portal/learn and
// /portal/progress already return — no parallel progress/streak system.

// /portal/learn only ever returns UNLOCKED modules (current + prior), plus
// a `locked_module_count` for everything beyond. Build one roadmap entry
// per returned module, plus a single trailing placeholder for the locked
// tail — never fabricating the locked modules' own names/content.
export function buildModuleRoadmap(learnEntry) {
  const modules = (learnEntry?.modules || []).map(m => ({
    id: m.id, name: m.name, description: m.description,
    lessonCount: (m.lessons || []).length + (m.locked_lesson_count || 0),
    skillCount: new Set((m.lessons || []).flatMap(l => l.skill_ids || [])).size || undefined,
    status: m.is_current ? "current" : "completed",
    currentLessonName: m.is_current ? (m.lessons || []).find(l => l.is_current)?.name : null,
    lessons: m.lessons || [],
    lockedLessonCount: m.locked_lesson_count || 0,
  }));
  if ((learnEntry?.locked_module_count || 0) > 0) {
    modules.push({
      id: "__locked__", name: `${learnEntry.locked_module_count} More Module${learnEntry.locked_module_count === 1 ? "" : "s"}`,
      description: "Unlocks as your dog completes the current module.",
      lessonCount: null, skillCount: null, status: "locked", lessons: [], lockedLessonCount: 0,
    });
  }
  return modules;
}

// Lesson cards for one module, plus a trailing locked placeholder built
// from the count only (never a fabricated future-lesson name).
export function buildLessonCards(module) {
  const cards = (module.lessons || []).map(l => ({
    id: l.id, name: l.name, overview: l.client_overview, estimatedMinutes: l.estimated_minutes,
    hasVideo: !!l.demo_video_url,
    status: l.is_current ? "current" : "completed",
    lesson: l,
  }));
  if ((module.lockedLessonCount || 0) > 0) {
    cards.push({
      id: "__locked__", name: `${module.lockedLessonCount} More Lesson${module.lockedLessonCount === 1 ? "" : "s"}`,
      status: "locked",
      lockedReason: "Complete the current lesson to unlock the next one.",
    });
  }
  return cards;
}

const LEVEL_ORDER = ["Not Introduced", "Introduced", "Learning", "Practicing", "Reliable", "Mastered"];

export function filterSkills(skills, filter, currentModuleSkillIds) {
  switch (filter) {
    case "current_module":
      return skills.filter(s => currentModuleSkillIds?.has(s.id));
    case "needs_practice":
      return skills.filter(s => LEVEL_ORDER.indexOf(s.level_label) <= 2 || s.needs_reassessment);
    case "reliable":
      return skills.filter(s => s.level_label === "Reliable");
    case "mastered":
      return skills.filter(s => s.level_label === "Mastered");
    default:
      return skills;
  }
}

// Simple, honest heuristics over already-loaded data — never a second
// progress calculation. "Recent win" = the most recent recap where a
// skill's status became mastered (named for what it actually is — the
// latest mastery, not a measured "biggest" delta, which would need
// historical score data this endpoint doesn't return); "strongest skill" =
// the highest-scored current skill.
export function deriveStrongestSkill(currentSkills) {
  if (!currentSkills?.length) return null;
  return [...currentSkills].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
}

export function deriveRecentWin(sessionRecaps) {
  for (const recap of sessionRecaps || []) {
    const mastered = (recap.skills_practiced || []).find(s => s.status === "mastered");
    if (mastered) return mastered.name;
  }
  return null;
}

export function lockedLessonExplanation({ modulePosition, isCurrentModule }) {
  if (!isCurrentModule) return "This module hasn't opened yet — complete the current module first.";
  return "Complete the previous lesson to unlock this one.";
}
