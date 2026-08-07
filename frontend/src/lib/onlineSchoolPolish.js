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
  }));
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

// The dashboard hero's single "what do I do next" line.
export function nextActionLabel(entry) {
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
  if (status?.on_hold) return { label: "Trainer Assist recommended", tone: "purple", icon: "fa-handshake" };
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
