import {
  renderPracticeCoachText, hasCoachMode, quickPracticeAllowed, practiceTimeLabel,
  practiceCoachReadiness, iconKeyToFaClass, initGuidedState, guidedPracticeReducer,
  sessionMetricsFromGuidedState, STOP_RULE_MISS_THRESHOLD,
} from "./practiceCoachPolish";

const merlinPc = {
  enabled: true, allow_quick_practice: true,
  goal: "Get {{dog_name}} to look at you when you say the name once.",
  success_today: "{{dog_name}} looks within 2 seconds.",
  schedule: { minutes_per_round: 3, rounds_per_day: 2, reps_per_round: 4, rest_after_reps: 2 },
  setup_items: [{ id: "s1", icon_key: "home", title: "Quiet room", description: "", required: true }],
  steps: [{ id: "step1", title: "Get ready", instruction: "Have {{dog_name}} nearby." }],
  good_rep: { sequence: ["Say name", "Dog looks"], explanation: "" },
  troubleshooting: [{ id: "t1", trigger: "No look", title: "Didn't look?", actions: ["Wait"], stop_round: false }],
  stop_rules: [{ id: "sr1", condition: "3 misses", message: "Take a break." }],
  guided_practice: {
    enabled: true, ready_instruction: "Wait.", cue_prompt: "Say the name ONCE.",
    success_button_label: "HE LOOKED", miss_button_label: "HE DIDN'T",
    success_message: "Say YES!", miss_message: "Don't repeat the name.", count_successes: true,
  },
  difficulty_feedback: { easy: "Great.", good: "Nice.", okay: "Stay.", hard: "Easier.", very_hard: "Stop." },
  end_questions: [{ id: "q1", type: "text", label: "Notes?", required: false }],
};

// ---------------------------------------------------------------------------
// Token rendering — safety
// ---------------------------------------------------------------------------

test("renderPracticeCoachText resolves whitelisted tokens", () => {
  expect(renderPracticeCoachText("Get {{dog_name}} to look at {{client_first_name}}.", { dog_name: "Merlin", client_first_name: "Jamie" }))
    .toBe("Get Merlin to look at Jamie.");
});

test("renderPracticeCoachText resolves a known token to blank when no value is available, never leaves the literal braces silently wrong", () => {
  expect(renderPracticeCoachText("Hi {{client_first_name}}!", { dog_name: "Merlin" })).toBe("Hi !");
});

test("renderPracticeCoachText renders an unknown token literally — never evaluated, never HTML-interpolated", () => {
  const out = renderPracticeCoachText("Do this {{trainer_secret_field}} now.", { dog_name: "Merlin" });
  expect(out).toBe("Do this {{trainer_secret_field}} now.");
});

test("renderPracticeCoachText never executes script-like content — it's returned as inert text", () => {
  const out = renderPracticeCoachText("<script>alert(1)</script>{{dog_name}}", { dog_name: "Merlin" });
  expect(out).toBe("<script>alert(1)</script>Merlin");
  expect(typeof out).toBe("string"); // never becomes markup/DOM — caller renders as plain text children
});

test("renderPracticeCoachText handles empty/missing text safely", () => {
  expect(renderPracticeCoachText(null, {})).toBe("");
  expect(renderPracticeCoachText(undefined, {})).toBe("");
});

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

test("hasCoachMode is true only for an enabled practice_coach on the snapshot", () => {
  expect(hasCoachMode({ template_snapshot: { practice_coach: { enabled: true } } })).toBe(true);
  expect(hasCoachMode({ template_snapshot: { practice_coach: { enabled: false } } })).toBe(false);
  expect(hasCoachMode({ template_snapshot: { practice_coach: null } })).toBe(false);
  expect(hasCoachMode({ template_snapshot: {} })).toBe(false);
  expect(hasCoachMode({})).toBe(false);
});

test("quickPracticeAllowed respects allow_quick_practice, defaults false when coach mode is off", () => {
  expect(quickPracticeAllowed({ enabled: true, allow_quick_practice: true })).toBe(true);
  expect(quickPracticeAllowed({ enabled: true, allow_quick_practice: false })).toBe(false);
  expect(quickPracticeAllowed({ enabled: false, allow_quick_practice: true })).toBe(false);
  expect(quickPracticeAllowed(null)).toBe(false);
});

test("practiceTimeLabel renders only the pieces the schedule actually set", () => {
  expect(practiceTimeLabel({ minutes_per_round: 3, rounds_per_day: 3 })).toBe("3 min per round • 3 rounds today");
  expect(practiceTimeLabel({ rounds_per_day: 1 })).toBe("1 round today");
  expect(practiceTimeLabel(null)).toBe("");
});

test("iconKeyToFaClass falls back to a generic icon for an unknown key", () => {
  expect(iconKeyToFaClass("home")).toBe("fa-house-chimney");
  expect(iconKeyToFaClass("totally-made-up-key")).toBe("fa-circle-check");
});

// ---------------------------------------------------------------------------
// Authoring readiness checklist
// ---------------------------------------------------------------------------

test("practiceCoachReadiness reports every required item met for a complete recipe", () => {
  const checklist = practiceCoachReadiness(merlinPc);
  const byKey = Object.fromEntries(checklist.map(c => [c.key, c]));
  expect(byKey.goal.met).toBe(true);
  expect(byKey.success.met).toBe(true);
  expect(byKey.setup.met).toBe(true);
  expect(byKey.steps.met).toBe(true);
  expect(byKey.troubleshooting.met).toBe(true);
  expect(byKey.stop_rule.met).toBe(true);
  expect(byKey.guided_rep.met).toBe(true);
  expect(byKey.difficulty_feedback.met).toBe(true);
});

test("practiceCoachReadiness marks video as optional, never blocking, even when absent", () => {
  const checklist = practiceCoachReadiness({ ...merlinPc, steps: [{ id: "s", title: "t", instruction: "i" }] });
  const video = checklist.find(c => c.key === "video");
  expect(video.optional).toBe(true);
  expect(video.met).toBe(false);
});

test("practiceCoachReadiness reports missing goal/steps for a bare enabled recipe", () => {
  const checklist = practiceCoachReadiness({ enabled: true });
  const byKey = Object.fromEntries(checklist.map(c => [c.key, c]));
  expect(byKey.goal.met).toBe(false);
  expect(byKey.steps.met).toBe(false);
});

// ---------------------------------------------------------------------------
// Guided Practice reducer — pure round/rep state machine
// ---------------------------------------------------------------------------

// Records each outcome in sequence WITHOUT acknowledging in between — for
// tests that only care about counting/miss-streak behavior, not the
// message-display/transition-timing step (see playThroughReps below for
// that). RECORD_OUTCOME only requires phase === "active", which stays true
// across these calls since a deferred resting/round_summary transition
// isn't applied until an explicit ACK_OUTCOME — so this never needs to
// "continue past rest" itself.
function outcomes(list, pc = merlinPc) {
  let state = initGuidedState(pc);
  for (const o of list) {
    state = guidedPracticeReducer(state, { type: "RECORD_OUTCOME", outcome: o }, pc);
  }
  return state;
}

// Mirrors what a real client does after every rep: record the outcome,
// acknowledge its coaching message (ACK_OUTCOME — this is also where a
// deferred resting/round_summary transition actually applies), then
// auto-continue past a rest prompt. Used by tests that specifically care
// about reaching round_summary/finished through full, realistic taps.
function playThroughReps(list, pc = merlinPc) {
  let state = initGuidedState(pc);
  for (const o of list) {
    if (state.phase !== "active") break;
    state = guidedPracticeReducer(state, { type: "RECORD_OUTCOME", outcome: o }, pc);
    state = guidedPracticeReducer(state, { type: "ACK_OUTCOME" }, pc);
    if (state.phase === "resting") state = guidedPracticeReducer(state, { type: "CONTINUE_AFTER_REST" }, pc);
  }
  return state;
}

test("initGuidedState starts at round 1 / rep 1, active phase", () => {
  const s = initGuidedState(merlinPc);
  expect(s.roundIndex).toBe(0);
  expect(s.repIndex).toBe(0);
  expect(s.phase).toBe("active");
  expect(s.roundsPerDay).toBe(2);
  expect(s.repsPerRound).toBe(4);
});

test("a success advances a rep and is counted", () => {
  const s = outcomes(["success"]);
  expect(s.repIndex).toBe(1);
  expect(s.totals.repsAttempted).toBe(1);
  expect(s.totals.successfulReps).toBe(1);
  expect(s.lastOutcome).toBe("success");
  expect(s.phase).toBe("active");
});

test("a miss advances a rep but is not counted as successful", () => {
  const s = outcomes(["miss"]);
  expect(s.totals.repsAttempted).toBe(1);
  expect(s.totals.successfulReps).toBe(0);
  expect(s.lastOutcome).toBe("miss");
});

test("ACK_OUTCOME clears the transient coaching-message flag without changing counts", () => {
  let s = outcomes(["success"]);
  s = guidedPracticeReducer(s, { type: "ACK_OUTCOME" }, merlinPc);
  expect(s.lastOutcome).toBe(null);
  expect(s.totals.repsAttempted).toBe(1); // unchanged
});

test("a rep landing on the rest boundary still shows its own coaching message before resting — never silently skipped", () => {
  // rest_after_reps=2 on merlinPc's schedule. RECORD_OUTCOME for rep 2
  // must stay "active" with the coaching message showing; only the
  // FOLLOWING ACK_OUTCOME (the client tapping "Next Rep") applies the
  // deferred transition into "resting". This is the exact gap a live
  // walkthrough of the Place Duration recipe surfaced (a rep that both
  // succeeded AND landed on the rest checkpoint skipped its own success
  // message) — regression-guarded here.
  let s = initGuidedState(merlinPc);
  s = guidedPracticeReducer(s, { type: "RECORD_OUTCOME", outcome: "success" }, merlinPc);
  s = guidedPracticeReducer(s, { type: "ACK_OUTCOME" }, merlinPc);
  s = guidedPracticeReducer(s, { type: "RECORD_OUTCOME", outcome: "success" }, merlinPc);
  expect(s.phase).toBe("active");
  expect(s.lastOutcome).toBe("success"); // coaching message still showing
  expect(s.pendingTransition).toBe("resting");
  s = guidedPracticeReducer(s, { type: "ACK_OUTCOME" }, merlinPc);
  expect(s.phase).toBe("resting");
});

test("CONTINUE_AFTER_REST resumes the active phase without altering counts", () => {
  let s = initGuidedState(merlinPc);
  s = guidedPracticeReducer(s, { type: "RECORD_OUTCOME", outcome: "success" }, merlinPc);
  s = guidedPracticeReducer(s, { type: "ACK_OUTCOME" }, merlinPc);
  s = guidedPracticeReducer(s, { type: "RECORD_OUTCOME", outcome: "success" }, merlinPc);
  s = guidedPracticeReducer(s, { type: "ACK_OUTCOME" }, merlinPc);
  expect(s.phase).toBe("resting");
  s = guidedPracticeReducer(s, { type: "CONTINUE_AFTER_REST" }, merlinPc);
  expect(s.phase).toBe("active");
  expect(s.totals.repsAttempted).toBe(2);
});

test("round summary appears once repsPerRound is reached, applied on ACK_OUTCOME after the final rep's coaching message", () => {
  // repsPerRound=4, rest at 2 — continue past the rest to reach round end.
  const s = playThroughReps(["success", "success", "success", "success"], merlinPc);
  expect(s.phase).toBe("round_summary");
  expect(s.totals.roundsCompleted).toBe(1);
});

test("NEXT_ROUND advances to round 2 and resets the rep counter", () => {
  let s = playThroughReps(["success", "success", "success", "success"], merlinPc);
  s = guidedPracticeReducer(s, { type: "NEXT_ROUND" }, merlinPc);
  expect(s.roundIndex).toBe(1);
  expect(s.repIndex).toBe(0);
  expect(s.phase).toBe("active");
});

test("NEXT_ROUND on the final round finishes instead", () => {
  const singleRoundPc = { ...merlinPc, schedule: { ...merlinPc.schedule, rounds_per_day: 1 } };
  let s = playThroughReps(["success", "success", "success", "success"], singleRoundPc);
  expect(s.phase).toBe("round_summary");
  s = guidedPracticeReducer(s, { type: "NEXT_ROUND" }, singleRoundPc);
  expect(s.phase).toBe("finished");
});

test(`the stop rule triggers after ${STOP_RULE_MISS_THRESHOLD} misses in a row and surfaces the recipe's own message, never a hardcoded one`, () => {
  const s = outcomes(["miss", "miss", "miss"]);
  expect(s.phase).toBe("stopped");
  expect(s.stopMessage).toBe(merlinPc.stop_rules[0].message);
});

test("a success resets the consecutive-miss counter before it reaches the stop threshold", () => {
  // A large reps_per_round with rest disabled isolates the miss-streak
  // logic from round/rest boundaries, which is what this test targets.
  const isolatedPc = { ...merlinPc, schedule: { ...merlinPc.schedule, reps_per_round: 20, rest_after_reps: 0 } };
  const s = outcomes(["miss", "miss", "success", "miss", "miss"], isolatedPc);
  expect(s.phase).toBe("active"); // never reached 3 in a row
  expect(s.missesInARow).toBe(2);
});

test("RESUME_AFTER_STOP clears the stop state and lets practice continue", () => {
  let s = outcomes(["miss", "miss", "miss"]);
  expect(s.phase).toBe("stopped");
  s = guidedPracticeReducer(s, { type: "RESUME_AFTER_STOP" }, merlinPc);
  expect(s.phase).toBe("active");
  expect(s.missesInARow).toBe(0);
});

test("FINISH_NOW ends the session immediately from any active state", () => {
  let s = outcomes(["success"]);
  s = guidedPracticeReducer(s, { type: "FINISH_NOW" }, merlinPc);
  expect(s.phase).toBe("finished");
});

test("a recipe without stop_rules still stops after the miss threshold, with a null message rather than a crash", () => {
  const noRulesPc = { ...merlinPc, stop_rules: [], schedule: { ...merlinPc.schedule, reps_per_round: 20, rest_after_reps: 0 } };
  const state = outcomes(["miss", "miss", "miss"], noRulesPc);
  expect(state.phase).toBe("stopped");
  expect(state.stopMessage).toBe(null);
});

// ---------------------------------------------------------------------------
// Session metrics — folded into the existing submit call, not persisted separately
// ---------------------------------------------------------------------------

test("sessionMetricsFromGuidedState computes reps/successes/rounds/success_rate", () => {
  const s = outcomes(["success", "miss"]);
  const m = sessionMetricsFromGuidedState(s);
  expect(m.reps_attempted).toBe(2);
  expect(m.successful_reps).toBe(1);
  expect(m.rounds_completed).toBe(0);
  expect(m.success_rate).toBe(50);
});

test("sessionMetricsFromGuidedState returns a null success_rate before any rep is attempted", () => {
  const m = sessionMetricsFromGuidedState(initGuidedState(merlinPc));
  expect(m.reps_attempted).toBe(0);
  expect(m.success_rate).toBe(null);
});
