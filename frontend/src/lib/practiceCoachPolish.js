// Client Practice Coach upgrade — pure helpers shared by the client Coach
// Mode components AND the template authoring Preview tab (same functions,
// same output, so "what the trainer sees in Preview" and "what the client
// actually gets" can never drift apart). Nothing here does I/O; every
// function takes already-loaded data and returns derived values.

// Only these two tokens are ever substituted — see
// 01_CLAUDE_IMPLEMENTATION_PROMPT.md's "Reusable template tokens" rule.
// This is deliberately NOT a general template language: an unknown
// `{{...}}` pattern is left exactly as written (rendered as inert plain
// text — React already escapes it, so it can never execute as HTML/script),
// never evaluated or interpolated.
const TOKEN_WHITELIST = ["dog_name", "client_first_name"];

export function renderPracticeCoachText(text, tokens) {
  if (!text) return "";
  const values = tokens || {};
  return String(text).replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key) => {
    if (!TOKEN_WHITELIST.includes(key)) return match; // unknown token -> literal, safe text
    const v = values[key];
    return v ? String(v) : "";
  });
}

// Setup-item icon_key -> FontAwesome class. A fixed, safe whitelist — see
// 01_CLAUDE_IMPLEMENTATION_PROMPT.md's "Semantic icons" rule ("a safe
// semantic key, not arbitrary HTML/SVG markup"). Unknown/missing keys fall
// back to a generic checklist icon rather than rendering nothing.
const ICON_KEY_MAP = {
  home: "fa-house-chimney",
  quiet: "fa-volume-xmark",
  treat: "fa-bone",
  treats: "fa-bone",
  leash: "fa-link",
  bed: "fa-bed",
  toy: "fa-baseball",
  crate: "fa-cube",
  clicker: "fa-computer-mouse",
  dog: "fa-dog",
  timer: "fa-stopwatch",
  distance: "fa-ruler-horizontal",
  door: "fa-door-open",
  outdoors: "fa-tree",
  people: "fa-users",
};
export const PRACTICE_COACH_ICON_KEYS = Object.keys(ICON_KEY_MAP);

export function iconKeyToFaClass(key) {
  return ICON_KEY_MAP[key] || "fa-circle-check";
}

// True only when a template_snapshot carries an ENABLED practice_coach —
// this is the single switch every caller (PracticePanel, admin preview)
// should check before rendering Coach Mode instead of the legacy/simple
// practice experience.
export function hasCoachMode(hw) {
  return !!(hw && hw.template_snapshot && hw.template_snapshot.practice_coach && hw.template_snapshot.practice_coach.enabled);
}

export function quickPracticeAllowed(practiceCoach) {
  if (!practiceCoach || !practiceCoach.enabled) return false;
  return practiceCoach.allow_quick_practice !== false;
}

// "2-3 min per round • 3 rounds today" style label — renders only the
// pieces the recipe actually set, never a fabricated total.
export function practiceTimeLabel(schedule) {
  if (!schedule) return "";
  const parts = [];
  if (schedule.minutes_per_round) parts.push(`${schedule.minutes_per_round} min per round`);
  if (schedule.rounds_per_day) parts.push(`${schedule.rounds_per_day} round${schedule.rounds_per_day === 1 ? "" : "s"} today`);
  return parts.join(" • ");
}

// Authoring-UI readiness checklist — mirrors _validate_practice_coach's
// warnings on the backend (server.py) so the builder's checklist and the
// server's own soft-warning set can never silently drift apart. Video is
// always `optional: true`, never a blocking item, per the handoff's own
// rule ("Do not make optional video/media an error").
export function practiceCoachReadiness(pc) {
  if (!pc) return [];
  const steps = pc.steps || [];
  const hasMedia = steps.some(s => s && s.media_url) || !!(pc.good_rep && pc.good_rep.media_url);
  const diffFeedback = pc.difficulty_feedback || {};
  return [
    { key: "goal", label: "Goal present", met: !!String(pc.goal || "").trim() },
    { key: "success", label: "Success definition present", met: !!String(pc.success_today || "").trim() },
    { key: "setup", label: "Setup present", met: (pc.setup_items || []).length > 0 },
    { key: "steps", label: "At least one step", met: steps.length > 0 },
    { key: "troubleshooting", label: "Troubleshooting present", met: (pc.troubleshooting || []).length > 0 },
    { key: "stop_rule", label: "Stop rule present", met: (pc.stop_rules || []).length > 0 },
    {
      key: "guided_rep", label: "Guided rep configuration valid",
      met: Number(pc.schedule && pc.schedule.rounds_per_day) > 0 && Number(pc.schedule && pc.schedule.reps_per_round) > 0,
    },
    {
      key: "difficulty_feedback", label: "Difficulty feedback configured",
      met: Object.values(diffFeedback).some(v => String(v || "").trim()),
    },
    { key: "video", label: "Demo media (optional)", met: hasMedia, optional: true },
  ];
}

// ---------------------------------------------------------------------------
// Guided Practice — a pure round/rep state machine. Per
// 01_CLAUDE_IMPLEMENTATION_PROMPT.md's "Important persistence boundary":
// this is LOCAL UI STATE ONLY. Nothing here calls the network; the caller
// folds the final totals (sessionMetricsFromGuidedState) into whichever
// existing submit call it already makes (POST /homework/{id}/section-log or
// .../day/{n}/submit), both of which already accept a free-form
// field_values dict — no new backend endpoint needed for this data.
// ---------------------------------------------------------------------------

// The Practice Recipe schema's stop_rules carry a free-text `condition`
// ("3 unsuccessful repetitions in a row") rather than a structured
// threshold — parsing that prose per-recipe would mean branching on
// exercise-specific wording, which is exactly what this feature must never
// do. Both provided reference recipes (Merlin's name response, Place
// duration) use the same real threshold, so a single app-wide constant is
// used for every recipe; the MESSAGE shown always comes from the recipe's
// own stop_rules[0], never a hardcoded string.
export const STOP_RULE_MISS_THRESHOLD = 3;

export function initGuidedState(practiceCoach) {
  const schedule = (practiceCoach && practiceCoach.schedule) || {};
  return {
    roundIndex: 0,
    repIndex: 0,
    phase: "active", // active | resting | round_summary | stopped | finished
    missesInARow: 0,
    successesThisRound: 0,
    lastOutcome: null, // null | "success" | "miss"
    pendingTransition: null, // null | "resting" | "round_summary" — applied by ACK_OUTCOME
    stopMessage: null,
    totals: { repsAttempted: 0, successfulReps: 0, roundsCompleted: 0 },
    roundsPerDay: Math.max(1, Number(schedule.rounds_per_day) || 1),
    repsPerRound: Math.max(1, Number(schedule.reps_per_round) || 1),
    restAfterReps: Number(schedule.rest_after_reps) || 0,
  };
}

export function guidedPracticeReducer(state, action, practiceCoach) {
  switch (action.type) {
    case "RECORD_OUTCOME": {
      if (state.phase !== "active") return state;
      const success = action.outcome === "success";
      const repIndex = state.repIndex + 1;
      const totals = {
        ...state.totals,
        repsAttempted: state.totals.repsAttempted + 1,
        successfulReps: state.totals.successfulReps + (success ? 1 : 0),
      };
      const missesInARow = success ? 0 : state.missesInARow + 1;
      const successesThisRound = state.successesThisRound + (success ? 1 : 0);

      // A stop is urgent (safety) — its own message IS the thing shown, so
      // it takes over the screen immediately rather than waiting behind a
      // rep's coaching message.
      if (missesInARow >= STOP_RULE_MISS_THRESHOLD) {
        const rule = (practiceCoach && practiceCoach.stop_rules && practiceCoach.stop_rules[0]) || null;
        return {
          ...state, repIndex, totals, missesInARow, successesThisRound,
          lastOutcome: "miss", phase: "stopped",
          stopMessage: rule ? rule.message : null,
        };
      }
      // A rep that ALSO lands on a rest or round-end boundary must still
      // show its own success/miss coaching message first — staying
      // "active" here and recording the pending transition, applied by
      // ACK_OUTCOME below, is what guarantees the client always sees
      // "mark/reward coaching" for every single rep (03_CLIENT_FLOW.md
      // Screen 4), never silently skipped because the rep also happened to
      // be rep 5 of a 5-rep round.
      let pendingTransition = null;
      if (repIndex >= state.repsPerRound) pendingTransition = "round_summary";
      else if (state.restAfterReps > 0 && repIndex % state.restAfterReps === 0) pendingTransition = "resting";
      return {
        ...state, repIndex, totals, missesInARow, successesThisRound,
        lastOutcome: success ? "success" : "miss", pendingTransition,
      };
    }
    case "ACK_OUTCOME": {
      // Clears the just-shown success/miss coaching message and applies
      // whichever transition (if any) RECORD_OUTCOME deferred — a
      // transient UI ack, not a counted event.
      if (state.phase !== "active") return state;
      if (state.pendingTransition === "round_summary") {
        return {
          ...state, lastOutcome: null, pendingTransition: null, phase: "round_summary",
          totals: { ...state.totals, roundsCompleted: state.totals.roundsCompleted + 1 },
        };
      }
      if (state.pendingTransition === "resting") {
        return { ...state, lastOutcome: null, pendingTransition: null, phase: "resting" };
      }
      return { ...state, lastOutcome: null };
    }
    case "CONTINUE_AFTER_REST":
      return state.phase === "resting" ? { ...state, phase: "active" } : state;
    case "RESUME_AFTER_STOP":
      return state.phase === "stopped" ? { ...state, phase: "active", missesInARow: 0, stopMessage: null } : state;
    case "NEXT_ROUND": {
      if (state.phase !== "round_summary") return state;
      const nextRound = state.roundIndex + 1;
      if (nextRound >= state.roundsPerDay) return { ...state, phase: "finished" };
      return { ...state, roundIndex: nextRound, repIndex: 0, successesThisRound: 0, phase: "active" };
    }
    case "FINISH_NOW":
      return { ...state, phase: "finished" };
    default:
      return state;
  }
}

export function sessionMetricsFromGuidedState(state) {
  const { repsAttempted, successfulReps, roundsCompleted } = state.totals;
  return {
    reps_attempted: repsAttempted,
    successful_reps: successfulReps,
    rounds_completed: roundsCompleted,
    success_rate: repsAttempted > 0 ? Math.round((successfulReps / repsAttempted) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Reactive troubleshooting (client redesign, phase 3).
//
// The authored recipe already tags each troubleshooting entry with a `trigger`
// — no_response, over_aroused, repeated_misses, handler_frustrated. Until now
// all of them lived behind a drawer the client had to think to open, which is
// the one thing nobody does mid-session with a dog on the end of a leash.
//
// These selectors map the guided-practice state the reducer ALREADY tracks
// onto those triggers, so the relevant tip surfaces itself at the moment it
// applies. Pure, additive, and authored-content-only: when a recipe has no
// entry for a trigger, nothing is shown rather than something invented.
// ---------------------------------------------------------------------------

// Two misses in a row is the point where the authored advice ("reduce one
// variable, get one clean rep") is worth interrupting for. Three consecutive
// misses is already the stop rule above, so this deliberately fires first.
export const REACTIVE_TIP_MISS_THRESHOLD = 2;

export function troubleshootingByTrigger(practiceCoach, trigger) {
  const items = (practiceCoach && practiceCoach.troubleshooting) || [];
  return items.find((t) => t && t.trigger === trigger) || null;
}

/** The authored troubleshooting entry that fits the CURRENT practice state, or
 *  null when nothing applies. Never invents guidance: every field shown comes
 *  from the recipe. */
export function troubleshootingForState(practiceCoach, state) {
  if (!practiceCoach || !state) return null;
  // A stopped round is the most urgent state, and the recipe's own stop-round
  // entries are the ones written for it.
  if (state.phase === "stopped") {
    const items = (practiceCoach.troubleshooting || []).filter((t) => t && t.stop_round);
    return items[0] || troubleshootingByTrigger(practiceCoach, "over_aroused");
  }
  if (state.phase !== "active") return null;
  if ((state.missesInARow || 0) >= REACTIVE_TIP_MISS_THRESHOLD) {
    return troubleshootingByTrigger(practiceCoach, "repeated_misses")
        || troubleshootingByTrigger(practiceCoach, "no_response");
  }
  return null;
}

/** Progress through the whole practice session — every round, not just the
 *  current one — so the client can see how much is left. */
export function guidedSessionProgress(state) {
  if (!state) return { done: 0, total: 0, pct: 0 };
  const total = Math.max(1, (state.roundsPerDay || 1) * (state.repsPerRound || 1));
  const done = Math.min(total, (state.roundIndex || 0) * (state.repsPerRound || 1) + (state.repIndex || 0));
  return { done, total, pct: Math.round((done / total) * 100) };
}
