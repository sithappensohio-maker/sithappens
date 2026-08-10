// Sit Happens Online School (Phase 1) — pure presentation helpers. Every
// function derives its answer from what /portal/school and
// /portal/school/{id} already return (the server has already computed lock
// state — see backend/server.py's _school_roadmap) — no second progress
// calculation, mirroring clientLearningPolish.js's philosophy exactly.
// Practice Coach itself is untouched; these helpers only shape data for
// ProgramRoadmap / LessonCard / LessonDetailPanel, the same shared
// components the trainer-led Learn screen already uses.

// ProgramRoadmap expects {id,name,description,lessonCount,skillCount,
// status,currentLessonName} per module — the backend's module status
// vocabulary (completed|current|locked) already matches ModuleJourneyCard's
// directly, no translation needed.
export function buildSchoolRoadmap(roadmap) {
  if (!roadmap) return [];
  return (roadmap.modules || []).map(m => ({
    id: m.id, name: m.name, description: m.description,
    lessonCount: m.status === "locked" ? null : (m.lessons || []).length,
    skillCount: m.status === "locked" ? null
      : (new Set((m.lessons || []).flatMap(l => l.skill_ids || [])).size || undefined),
    status: m.status,
    currentLessonName: m.status === "current" ? (roadmap.current_lesson?.name || null) : null,
    lessons: m.lessons || [],
    lockedReason: m.locked_reason,
    quiz: m.quiz || null,
  }));
}

// Module Quiz chip copy — one place so Roadmap/Progress read identically.
// quiz.status vocabulary is locked|available|passed (server-derived).
export function moduleQuizChip(quiz) {
  if (!quiz || !quiz.enabled) return null;
  if (quiz.status === "passed") {
    return { label: `Quiz · ${quiz.best_score != null ? `${Math.round(quiz.best_score)}% ` : ""}Passed`, tone: "passed" };
  }
  if (quiz.status === "available") return { label: "Quiz · Ready", tone: "ready" };
  return { label: "Quiz · Not Ready", tone: "locked" };
}

// LessonCard's status vocabulary is completed|current|available|locked
// (its "current" key renders the label "In Progress"). The backend's
// per-lesson vocabulary is completed|in_progress|available|locked — this
// is the one, single place that translation happens.
export function schoolLessonCardStatus(lessonStatus) {
  return lessonStatus === "in_progress" ? "current" : lessonStatus;
}

export function buildSchoolLessonCards(module) {
  return (module.lessons || []).map(l => ({
    id: l.id, name: l.name,
    overview: l.client_overview, estimatedMinutes: l.estimated_minutes,
    hasVideo: !!l.demo_video_url,
    status: schoolLessonCardStatus(l.status),
    lockedReason: l.locked_reason,
    isCurrent: !!l.is_current,
    lesson: l,
  }));
}

// The dashboard hero's single "what do I do next" line. A completed
// enrollment still carries a current_lesson_name (the final lesson stays
// "current" after a checkpoint graduation), so completion must be checked
// FIRST — otherwise a graduated program reads "Start: <final lesson>".
export function nextActionLabel(entry) {
  if (entry && entry.status === "completed") return "Program complete — review your journey";
  if (!entry || !entry.current_lesson_name) return "Review your progress";
  return entry.current_lesson_practiced
    ? `Continue: ${entry.current_lesson_name}`
    : `Start: ${entry.current_lesson_name}`;
}

// A lesson can only be advanced past once its practice has actually
// happened — never fabricated, always read straight from the server's
// current_lesson_practiced flag (itself derived from a real section_log
// entry or completed homework, see _lesson_is_practiced).
export function canAdvance(roadmap) {
  return !!(roadmap && roadmap.current_lesson && roadmap.current_lesson_practiced);
}

export function practiceButtonLabel(practiced) {
  return practiced ? "Practice Again" : "Start Practice";
}

export function continueButtonLabel(roadmap) {
  if (roadmap && roadmap.is_final_lesson && roadmap.current_lesson_practiced) return "Finish Program";
  return "Continue Training";
}

export function formatCompletionPct(pct) {
  return `${Math.max(0, Math.min(100, Math.round(pct || 0)))}% complete`;
}

// Group the graduation summary's flat skills_mastered list
// ([{name, explanation, module}]) into per-module buckets, preserving the
// authored order (first appearance wins), so the "Skills your dog mastered"
// recap reads module-by-module exactly as the curriculum was built. Skills
// with a blank/missing name are dropped — the recap only ever shows real,
// named skills the server included from the completed enrollment's snapshot.
export function groupSkillsByModule(skills) {
  const order = [];
  const byModule = new Map();
  for (const s of skills || []) {
    if (!s || !s.name) continue;
    const module = s.module || "";
    if (!byModule.has(module)) { byModule.set(module, []); order.push(module); }
    byModule.get(module).push(s);
  }
  return order.map(module => ({ module, skills: byModule.get(module) }));
}

// Online School Phase 3 — Student Home's "Trainer Status" line. Deliberately
// reads the CURRENT lesson's live checkpoint_status only (not history —
// see recentFeedbackFromHistory below for why those are different
// questions). Every branch maps to a real, already-returned field; there is
// no "everything's fine, guessing" fallback beyond the genuinely correct
// default of "no trainer action needed" when no checkpoint is in play.
export function trainerStatusLabel(roadmap) {
  const status = roadmap?.requires_checkpoint ? roadmap.checkpoint_status : null;
  // Color rules: orange = checkpoint/attention/trainer review, purple =
  // Trainer Assist/special support, muted = nothing needed right now.
  // Online School Phase 4 — the Trainer Assist branch reflects the REAL
  // lifecycle (needs_attention/contacted/scheduled/completed) instead of a
  // single "recommended" label glued to the whole hold period. Every
  // sub-label maps to a real stored field (ta.status, ta.scheduled_date) —
  // never an invented ETA or response-time promise.
  const ta = status?.trainer_assist;
  if (status?.on_hold && ta) {
    // Derived-only "reschedule_needed" (never stored) — the linked booking
    // was cancelled through the existing booking-cancellation path; never
    // keep telling the client about a date/time that no longer exists.
    if (ta.status === "reschedule_needed") return { label: "Trainer Assist needs rescheduling", tone: "purple", icon: "fa-calendar-xmark" };
    if (ta.status === "scheduled") {
      return { label: ta.scheduled_date ? `Trainer Assist scheduled for ${ta.scheduled_date}` : "Trainer Assist scheduled", tone: "purple", icon: "fa-calendar-check" };
    }
    if (ta.status === "contacted") return { label: "Trainer contacted you", tone: "purple", icon: "fa-comment-dots" };
    return { label: "Trainer Assist recommended", tone: "purple", icon: "fa-handshake" };
  }
  if (!status?.on_hold && ta?.status === "completed") {
    return { label: "Trainer Assist complete — ready to continue", tone: "purple", icon: "fa-circle-check" };
  }
  if (status?.status === "awaiting_review") return { label: "Checkpoint awaiting review", tone: "accent", icon: "fa-hourglass-half" };
  if (status?.status === "graded" && status.outcome === "prescribe_practice") return { label: "Practice plan assigned", tone: "accent", icon: "fa-rotate-left" };
  return { label: "No trainer action needed", tone: "muted", icon: "fa-circle-check" };
}

// The newest GRADED item from /portal/school/{id}/checkpoint-history — NOT
// roadmap.checkpoint_status, since an "advance" outcome moves the current
// lesson forward and the just-reviewed submission is no longer "the
// current lesson's" checkpoint (Phase 3 review correction).
export function recentFeedbackFromHistory(history) {
  return (history && history[0]) || null;
}
