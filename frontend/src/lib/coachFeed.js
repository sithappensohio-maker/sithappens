/* Training Experience Clarity Pass — Stage 5: the client Coach destination.
 *
 * Pure helpers that turn the EXISTING enrollment-scoped records — trainer
 * lesson recaps (/lesson-history), graded checkpoints (/checkpoint-history),
 * Practice reviews / Q&A / message threads (/support) and the Today
 * view-model's Practice rows — into (a) the few things that genuinely need
 * the client's action and (b) one readable chronological feed. Nothing here
 * fetches, stores, or invents state; every label maps an existing status to
 * plain words, and raw enum values never reach the screen. */

export const PRACTICE_REVIEW_WORDS = {
  looks_good: { label: "Looks Good", tone: "good", icon: "fa-thumbs-up" },
  keep_practicing: { label: "Keep Practicing", tone: "note", icon: "fa-rotate" },
  trainer_attention: { label: "Trainer follow-up", tone: "attention", icon: "fa-hand-holding-heart" },
};

export const DAY_REVIEW_WORDS = {
  approved: { label: "Approved", tone: "good", icon: "fa-circle-check" },
  needs_redo: { label: "Try this again", tone: "attention", icon: "fa-rotate-left" },
  submitted: { label: "Waiting for trainer review", tone: "waiting", icon: "fa-hourglass-half" },
};

export const CHECKPOINT_WORDS = {
  advance: { label: "Passed", tone: "good", icon: "fa-circle-check", body: "Your trainer approved this checkpoint." },
  prescribe_practice: { label: "More Practice needed", tone: "attention", icon: "fa-rotate-left", body: "Your trainer wants more Practice before you try again." },
  trainer_assist_recommended: { label: "Trainer Assist", tone: "note", icon: "fa-hand-holding-heart", body: "Your trainer recommended a hands-on session." },
};

export function coachDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return ""; }
}

const excerpt = (text, limit = 180) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= limit) return t;
  return (t.slice(0, limit).replace(/\s+\S*$/, "") || t.slice(0, limit)) + "…";
};

/** Things that genuinely need the client to do something. Ordinary recaps
 *  and informational results never appear here. */
export function coachAttentionItems({ home = null, support = null, history = [] } = {}) {
  const items = [];
  // Practice a trainer sent back for another round (daily-tracker day review).
  for (const hw of home?.active_practice || []) {
    const day = (hw?.daily_progress || []).find((d) => d && d.status === "needs_redo");
    if (!day) continue;
    items.push({
      id: `practice-redo:${hw.id}`, kind: "practice_redo",
      title: "Try this Practice again",
      body: `Your trainer reviewed ${hw.school_lesson_name || hw.title || "your Practice"} and wants another round.`,
      note: day.log?.review_note || null,
      cta: { label: "Start Practice", run: "open_practice", homeworkId: hw.id },
    });
  }
  // Current checkpoint graded "more practice" and not yet satisfied.
  const cp = home?.checkpoint_status || null;
  if (cp?.status === "graded" && cp.outcome === "prescribe_practice") {
    const remaining = cp.prescription?.practice_sessions_remaining;
    if (remaining == null || remaining > 0) {
      const remediationNow = home?.current_action?.type === "remediation";
      items.push({
        id: `checkpoint-more:${cp.id || "current"}`, kind: "checkpoint_more",
        title: "Checkpoint needs more work",
        body: remaining != null ? `${remaining} more Practice session${remaining === 1 ? "" : "s"} before you can try again.` : "Some more Practice before you try again.",
        note: cp.trainer_feedback || null,
        cta: remediationNow ? { label: "Start Practice", run: "primary_action" } : { label: "See what to work on", run: "expand", target: `checkpoint:${cp.id}` },
      });
    }
  }
  if (cp?.status === "graded" && cp.outcome === "trainer_assist_recommended" && cp.trainer_assist?.status !== "completed") {
    items.push({
      id: `assist:${cp.id || "current"}`, kind: "assist",
      title: "Trainer Assist",
      body: cp.trainer_assist?.scheduled_date ? `Booked for ${cp.trainer_assist.scheduled_date}${cp.trainer_assist.scheduled_time ? ` at ${cp.trainer_assist.scheduled_time}` : ""}.` : "Your trainer will arrange a hands-on session with you.",
      note: cp.trainer_feedback || null,
      cta: { label: "See details", run: "expand", target: `checkpoint:${cp.id}` },
    });
  }
  // A staff message the client has not answered (real reply system). The
  // stored role is whoever replied — trainer, admin, staff — so "needs a
  // response" means "the last word was not the client's".
  for (const t of support?.threads || []) {
    if (!t || t.status === "resolved" || !t.last_message_role || t.last_message_role === "client") continue;
    const last = [...(t.messages || [])].reverse().find((m) => m.sender_role !== "client");
    items.push({
      id: `thread:${t.id}`, kind: "trainer_message",
      title: t.unread_client ? "Your trainer replied" : "Your trainer is waiting on you",
      body: last?.body ? `“${excerpt(last.body, 140)}”` : (t.subject || "Open the conversation to reply."),
      note: null,
      cta: { label: "Respond", run: "expand", target: `thread:${t.id}` },
    });
  }
  return items;
}

/** One chronological feed of client-safe events, newest first. `kind` ∈
 *  recap | practice | checkpoint | question. */
export function coachFeed({ recaps = [], history = [], support = null, home = null } = {}) {
  const out = [];
  for (const l of recaps || []) {
    if (!l) continue;
    out.push({
      id: `recap:${l.session_id}`, kind: "recap", at: l.date || "",
      title: l.lesson_name || "Training session", who: l.trainer_name || null,
      wentWell: l.what_went_well || null, keepWorking: l.needs_work || null, nextFocus: l.next_lesson_focus || null,
      note: l.trainer_feedback || null,
      practice: (l.practice_assigned || []).filter(Boolean),
    });
  }
  for (const e of history || []) {
    if (!e || e.status !== "graded") continue;
    const w = CHECKPOINT_WORDS[e.outcome] || { label: "Reviewed", tone: "note", icon: "fa-clipboard-check", body: "Your trainer reviewed this checkpoint." };
    const remaining = e.prescription?.practice_sessions_remaining;
    out.push({
      id: `checkpoint:${e.id}`, kind: "checkpoint", at: e.graded_at || e.submitted_at || "",
      title: e.lesson_name || "Checkpoint", who: e.trainer_name || null,
      result: w.label, tone: w.tone, icon: w.icon,
      body: e.outcome === "prescribe_practice" && remaining != null
        ? `${remaining} more Practice session${remaining === 1 ? "" : "s"} before you try again.` : w.body,
      note: e.trainer_feedback || null, entry: e,
    });
  }
  for (const r of support?.practice_reviews || []) {
    if (!r) continue;
    const w = PRACTICE_REVIEW_WORDS[r.review_status] || PRACTICE_REVIEW_WORDS.looks_good;
    out.push({
      id: `practice:${r.id}`, kind: "practice", at: r.reviewed_at || r.logged_at || r.date || "",
      title: r.practice_title || r.lesson_name || "Practice", who: r.trainer_name || null,
      result: w.label, tone: w.tone, icon: w.icon, note: r.review_note || null, homeworkId: r.homework_id || null,
    });
  }
  // The current checkpoint still with the trainer — informational, not an action.
  const cp = home?.checkpoint_status;
  if (cp?.status === "awaiting_review") {
    out.push({
      id: `checkpoint-waiting:${cp.id || "current"}`, kind: "checkpoint", at: cp.submitted_at || "",
      title: home?.current_lesson?.name || "Checkpoint", who: null,
      result: "Waiting for review", tone: "waiting", icon: "fa-hourglass-half",
      body: "Your trainer needs to review this before you continue. You don't need to do anything else right now.",
      note: null, entry: null,
    });
  }
  // Day-level reviews on still-active daily trackers (approved / try again /
  // still waiting).
  for (const hw of home?.active_practice || []) {
    for (const d of hw?.daily_progress || []) {
      if (!d?.log || !["approved", "needs_redo", "submitted"].includes(d.status)) continue;
      const w = DAY_REVIEW_WORDS[d.status];
      out.push({
        id: `day:${hw.id}:${d.day_number}`, kind: "practice", at: d.log.reviewed_at || d.log.logged_at || "",
        title: hw.school_lesson_name || hw.title || "Practice", who: d.log.reviewed_by || null,
        result: w.label, tone: w.tone, icon: w.icon, note: d.log.review_note || null, homeworkId: hw.id, day: d.day_number,
      });
    }
  }
  for (const t of support?.threads || []) {
    if (!t) continue;
    const last = [...(t.messages || [])].pop();
    out.push({
      id: `thread:${t.id}`, kind: "question", at: t.last_message_at || last?.created_at || "",
      title: t.subject || "Conversation", who: last?.sender_role === "client" ? "You" : (last?.sender_name || "Your trainer"),
      body: last?.body ? excerpt(last.body, 160) : "", thread: t,
      waiting: t.status !== "resolved" && t.last_message_role === "client",
      unread: !!t.unread_client,
    });
  }
  for (const q of support?.practice_questions || []) {
    if (!q) continue;
    out.push({
      id: `pq:${q.id}`, kind: "question", at: q.answered_at || q.asked_at || "",
      title: q.lesson_name || "Practice question", who: q.answer ? (q.answered_by || "Your trainer") : "You",
      body: q.answer ? excerpt(q.answer, 160) : `You asked: “${excerpt(q.text, 120)}”`, question: q,
      waiting: !q.answer,
    });
  }
  out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return out;
}

export const COACH_FILTERS = [
  { key: "all", label: "All" },
  { key: "recap", label: "Session Recaps" },
  { key: "practice", label: "Practice Reviews" },
  { key: "checkpoint", label: "Checkpoint Results" },
  { key: "question", label: "Questions & Replies" },
];

export function coachEmptyState(home) {
  const mode = home?.delivery_mode;
  if (mode === "in_person" || mode === "trainer_led") {
    return { title: "Nothing here yet", body: "After your trainer completes a lesson, you'll be able to review their notes, Practice reviews, and replies here." };
  }
  if (mode === "hybrid") {
    return { title: "Nothing here yet", body: "Your lesson recaps, Practice reviews, checkpoint results, and replies will appear here as you train." };
  }
  return { title: "Nothing here yet", body: "Your Practice reviews, checkpoint results, and trainer replies will appear here as you train." };
}
