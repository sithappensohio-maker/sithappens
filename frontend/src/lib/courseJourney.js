/* Stage 9 — the CLIENT's reading of the one School curriculum.
 *
 * Pure projection of what /portal/school/{id} (roadmap) and /portal/school/
 * {id}/home (current_action, progress, active_practice) already return. The
 * server still owns every lock and progression decision; this only says, in
 * the client's words, where they are, what they are learning now, what is
 * coming next, and why something is not open yet. No second pointer, no
 * second progress calculation. */

const text = (v) => String(v || "").trim();
const excerpt = (v, n = 170) => { const t = text(v).replace(/\s+/g, " "); return t.length <= n ? t : (t.slice(0, n).replace(/\s+\S*$/, "") || t.slice(0, n)) + "…"; };

/** Plain-English reason the NEXT step is not open yet, from the server's
 *  own current_action — never a gate name. Returns null when the client can
 *  simply continue. */
export function nextStepReason(action, deliveryMode, currentLessonName) {
  const t = action?.type;
  const lesson = currentLessonName ? `${currentLessonName}` : "the current lesson";
  if (deliveryMode === "in_person" || t === "trainer_guided") return "Your trainer will move you forward at your next visit.";
  switch (t) {
    case "lesson": return `Finish ${lesson} first.`;
    case "practice": return "Complete today's Practice first.";
    case "awaiting_review": return "Waiting for your trainer to review.";
    case "submit_checkpoint": return "Pass the checkpoint to continue.";
    case "remediation": return "Finish the extra Practice your trainer asked for, then retry the checkpoint.";
    case "trainer_assist": return "Your trainer is arranging a hands-on session first.";
    case "module_quiz": return "Pass the module quiz to continue.";
    case "advance": return null;
    default: return null;
  }
}

/** What the client should do about the CURRENT lesson, by delivery mode. */
function currentLessonAction(action, deliveryMode) {
  const t = action?.type;
  if (deliveryMode === "in_person") {
    if (t === "lesson") return { kind: "lesson", label: "Review this lesson", modeLine: "You'll work on this with your trainer. Read it over before your visit." };
    if (t === "practice") return { kind: "practice", label: "Go to Practice", modeLine: "You'll work on this with your trainer. Practice is ready in the meantime." };
    return { kind: "none", label: null, modeLine: "You'll work on this with your trainer. Keep practising until your next visit." };
  }
  if (deliveryMode === "hybrid") {
    if (["lesson", "practice", "module_quiz", "submit_checkpoint", "remediation", "advance", "start"].includes(t)) {
      return { kind: "lesson", label: "Continue lesson", modeLine: "Do this in the app. Your trainer also works on it with you in person." };
    }
    if (t === "awaiting_review" || t === "trainer_assist") return { kind: "none", label: null, modeLine: "Your trainer is on this one — nothing to do in the app right now." };
    return { kind: "lesson", label: "Continue lesson", modeLine: "Do this in the app. Your trainer also works on it with you in person." };
  }
  if (t === "awaiting_review" || t === "trainer_assist") return { kind: "none", label: null, modeLine: "Your trainer is reviewing — nothing else to do right now." };
  return { kind: "lesson", label: "Continue lesson", modeLine: null };
}

/** Coming next: the lesson after the current one, or the milestone in the way
 *  (checkpoint, module quiz, graduation). Locked modules do not expose lesson
 *  names, so "next" then becomes the module itself. */
export function comingNext(roadmap) {
  if (!roadmap) return null;
  const modules = roadmap.modules || [];
  const curId = roadmap.current_lesson_id || roadmap.current_lesson?.id;
  const mi = modules.findIndex((m) => (m.lessons || []).some((l) => l.id === curId));
  if (mi < 0) return null;
  const mod = modules[mi];
  const lessons = mod.lessons || [];
  const li = lessons.findIndex((l) => l.id === curId);
  const nextLesson = lessons[li + 1] || null;
  // The checkpoint stays "coming next" until it is actually PASSED (graded +
  // advance). A graded "more practice" / "trainer assist" outcome is a retry
  // still ahead of the client, not a milestone behind them.
  const cs = roadmap.checkpoint_status || null;
  const checkpointPassed = !!cs && cs.status === "graded" && cs.outcome === "advance";
  if (roadmap.requires_checkpoint && !checkpointPassed) {
    return { kind: "checkpoint", title: roadmap.checkpoint_rubric?.title || "Checkpoint", moduleName: mod.name };
  }
  if (nextLesson) return { kind: "lesson", title: nextLesson.name, id: nextLesson.id, moduleName: mod.name, status: nextLesson.status };
  if (mod.quiz?.enabled && mod.quiz?.status !== "passed") return { kind: "quiz", title: `Module quiz — ${mod.name}`, moduleName: mod.name };
  const nextMod = modules[mi + 1];
  if (nextMod) {
    const first = (nextMod.lessons || [])[0];
    return first ? { kind: "lesson", title: first.name, id: first.id, moduleName: nextMod.name, status: first.status }
                 : { kind: "module", title: nextMod.name, moduleName: nextMod.name };
  }
  return { kind: "graduation", title: "Graduation" };
}

export const LESSON_STATE = {
  completed: { label: "Completed", icon: "fa-check", tone: "done" },
  current: { label: "Current lesson", icon: "fa-play", tone: "current" },
  next: { label: "Coming next", icon: "fa-arrow-right", tone: "next" },
  available: { label: "Open", icon: "fa-circle", tone: "next" },
  locked: { label: "Locked", icon: "fa-lock", tone: "locked" },
};

/** One row per lesson with a state and, when locked, a truthful reason. */
export function decorateLesson(lesson, { currentLessonId, nextId, nextReason }) {
  if (!lesson) return null;
  let state = lesson.status === "completed" ? "completed"
    : lesson.id === currentLessonId ? "current"
    : lesson.status === "locked" ? "locked"
    : lesson.id === nextId ? "next" : "available";
  const reason = state === "locked"
    ? (lesson.id === nextId && nextReason ? nextReason : (lesson.locked_reason || null))
    : null;
  return { ...lesson, state, stateLabel: LESSON_STATE[state].label, reason };
}

export function buildCourseJourney({ detail, home }) {
  const roadmap = detail?.roadmap || null;
  const mode = detail?.delivery_mode || home?.delivery_mode || null;
  const progress = home?.progress || {};
  const action = home?.current_action || null;
  const completed = detail?.status === "completed" || action?.type === "course_complete";
  const current = roadmap?.current_lesson || null;
  const modules = roadmap?.modules || [];
  const currentModule = modules.find((m) => (m.lessons || []).some((l) => l.id === current?.id)) || null;
  const next = completed ? null : comingNext(roadmap);
  const reason = completed ? null : nextStepReason(action, mode, current?.name);
  const act = completed ? { kind: "none", label: null, modeLine: null } : currentLessonAction(action, mode);
  const lessonsDone = Number(progress.lessons_completed ?? 0);
  const lessonsTotal = Number(progress.lessons_total ?? 0);
  const activePractice = (home?.active_practice || []).find((r) => r && current && (r.source_lesson_id === current.id || r.school_lesson_id === current.id || r.lesson_id === current.id)) || null;

  const chapters = modules.map((m) => {
    const lessons = (m.lessons || []).map((l) => decorateLesson(l, { currentLessonId: current?.id, nextId: next?.id, nextReason: reason }));
    const done = lessons.filter((l) => l.state === "completed").length;
    return {
      ...m, lessons, done, total: lessons.length,
      isCurrent: m.status === "current" || (!!currentModule && currentModule.id === m.id),
      meta: lessons.length ? `${done} of ${lessons.length} lesson${lessons.length === 1 ? "" : "s"} complete` : null,
    };
  });

  return {
    program: { name: detail?.program_name || home?.program?.name || "", focus: detail?.program_focus || null, dogName: detail?.dog_name || null, mode, completed,
               pct: Math.max(0, Math.min(100, Math.round(progress.course_pct ?? detail?.course_pct ?? 0))), lessonsDone, lessonsTotal },
    current: completed || !current ? null : {
      id: current.id, name: current.name, moduleName: currentModule?.name || null,
      position: lessonsTotal ? `Lesson ${Math.min(lessonsDone + 1, lessonsTotal)} of ${lessonsTotal}` : null,
      summary: excerpt(current.client_overview || current.why_it_matters || ""),
      minutes: current.estimated_minutes || null,
      action: act, practice: activePractice ? { id: activePractice.id, title: activePractice.title } : null,
      isCheckpoint: !!roadmap?.requires_checkpoint,
    },
    next: next ? { ...next, reason } : null,
    chapters,
  };
}
