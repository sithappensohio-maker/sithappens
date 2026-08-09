/* School HQ — shared presentation helpers for the Online School event spine.
 * One place maps an event/notification type to its icon, accent color, short
 * label, and the verb for its "open the thing that needs me" action, so the
 * Activity feed, Needs Attention queue, and Overview all read consistently. */

export const EVENT_META = {
  school_enrolled:              { icon: "fa-user-plus",           accent: "cyan",    label: "Enrolled" },
  school_started:               { icon: "fa-play",                accent: "cyan",    label: "Started" },
  lesson_started:               { icon: "fa-play",                accent: "neutral", label: "Lesson started" },
  lesson_completed:             { icon: "fa-circle-check",        accent: "lime",    label: "Lesson complete" },
  module_completed:             { icon: "fa-layer-group",         accent: "lime",    label: "Module complete" },
  course_completed:             { icon: "fa-graduation-cap",      accent: "lime",    label: "Course complete" },
  achievement_earned:           { icon: "fa-trophy",              accent: "amber",   label: "Achievement" },
  practice_started:             { icon: "fa-dumbbell",            accent: "neutral", label: "Practice started" },
  practice_completed:           { icon: "fa-dumbbell",            accent: "lime",    label: "Practice logged" },
  practice_difficulty_reported: { icon: "fa-gauge-high",          accent: "amber",   label: "Found it hard" },
  practice_question_asked:      { icon: "fa-circle-question",     accent: "orange",  label: "Question" },
  student_question:             { icon: "fa-circle-question",     accent: "orange",  label: "Question" },
  practice_could_not_complete:  { icon: "fa-triangle-exclamation",accent: "danger",  label: "Couldn't complete" },
  practice_video_submitted:     { icon: "fa-video",               accent: "purple",  label: "Video to review" },
  checkpoint_submitted:         { icon: "fa-clipboard-check",     accent: "amber",   label: "Checkpoint" },
  checkpoint_passed:            { icon: "fa-award",               accent: "lime",    label: "Checkpoint passed" },
  checkpoint_remediation_required: { icon: "fa-rotate-left",      accent: "amber",   label: "Remediation" },
  trainer_assist_requested:     { icon: "fa-hand-holding-heart",  accent: "purple",  label: "Trainer Assist" },
  trainer_assist_recommended:   { icon: "fa-hand-holding-heart",  accent: "purple",  label: "Trainer Assist" },
  trainer_reply:                { icon: "fa-reply",               accent: "cyan",    label: "Trainer replied" },
};

export function eventMeta(type) {
  return EVENT_META[type] || { icon: "fa-circle-info", accent: "neutral", label: (type || "").replace(/_/g, " ") };
}

const ACTION_LABEL = {
  checkpoint_submitted: "Review checkpoint",
  trainer_assist_requested: "Open Trainer Assist",
  trainer_assist_recommended: "Open Trainer Assist",
  practice_question_asked: "Reply",
  student_question: "Reply",
  practice_video_submitted: "Review video",
  practice_could_not_complete: "View practice",
};

export function actionLabel(type) {
  return ACTION_LABEL[type] || "Open";
}

export const PRIORITY_META = {
  urgent: { label: "Urgent", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
  high:   { label: "High",   cls: "bg-shAccent/15 text-shAccent border-shAccent/40" },
  normal: { label: "Normal", cls: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  info:   { label: "Info",   cls: "bg-shPrimary/10 text-shPrimary border-shPrimary/30" },
};

export function priorityMeta(p) {
  return PRIORITY_META[p] || PRIORITY_META.info;
}

/** Compact "2m / 3h / 5d ago" from an ISO timestamp. */
export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** One-line "Dog · Course · Lesson" context string, skipping missing parts. */
export function contextLine(item) {
  return [item.dog_name, item.program_name, item.lesson_name || item.module_name]
    .filter(Boolean).join(" · ");
}

/** Fire the app-shell nav event so a School HQ deep-link that targets another
 * screen (e.g. the Homework thread for a question) never dead-ends. */
export function navigateToScreen(screen) {
  window.dispatchEvent(new CustomEvent("sh:nav", { detail: screen }));
}

/** Let the sidebar badge refresh immediately after a read/resolve instead of
 * waiting for its next poll (mirrors the "sh:shop-orders-seen" convention). */
export function announceAttentionChanged() {
  window.dispatchEvent(new CustomEvent("sh:school-attention-changed"));
}
