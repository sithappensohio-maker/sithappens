/* Client School — the checkpoint experience.
 *
 * The single native checkpoint UI for the School lesson flow. Redesigned in
 * phase 4 so a checkpoint reads as the milestone it is rather than another
 * form: what you're about to show, which skills it covers, what your trainer
 * scores, and what happens after.
 *
 * Progression, grading and permission remain entirely backend-owned. This
 * file chooses which authored content to show for the state the server
 * reports — it never decides an outcome, never advances anything, and never
 * manufactures a score.
 */
import { useState } from "react";
import NeonEdge from "../../premium/NeonEdge";
import PremiumButton from "../../premium/PremiumButton";
import PracticeMediaUploader from "../../training/PracticeMediaUploader";
import { useImmersiveWorkflow } from "../../../lib/immersiveWorkflow";
import {
  checkpointState, CheckpointHero, ScoredCriteria, SkillsCovered, SubmissionRequirements,
  WhatHappensNext, PassCelebration, TrainerFeedback, RubricBreakdown, CheckpointScores, nextStepAfter,
} from "./checkpoint/CheckpointCards";

function fmtWhen(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}

export default function CheckpointPanel({
  lessonId, practiced, rubric, status, onSubmit, onStartPrescribedPractice, onGoToRefresher,
  busy, deliveryMode, moduleName, dogName, skills, roadmap, onContinue,
}) {
  const [returnedToCheckpoint, setReturnedToCheckpoint] = useState(false);
  const state = checkpointState({ status, practiced, deliveryMode });
  const ta = status?.trainer_assist;

  /* ---------------------------------------------------------- in person --- */
  // B6: an in-person / trainer-led student never submits a checkpoint — the
  // server returns 409 — so the upload action is not merely hidden, it is
  // never constructed. This is the polished equivalent, not an apology.
  if (state === "in_person") {
    return (
      <NeonEdge accentRgb="0,169,224" intensity="standard" className="p-5 space-y-4" data-testid="school-checkpoint-in-person-panel">
        <CheckpointHero rubric={rubric} moduleName={moduleName} icon="fa-chalkboard-user"
                        eyebrow="Checkpoint · with your trainer"
                        blurb={`Your trainer checks this one with you in person${dogName ? ` — no video to film, and nothing for you to upload.` : "."}`} />
        <SkillsCovered skills={skills} />
        <ScoredCriteria rubric={rubric} />
        <SubmissionRequirements rubric={rubric} />
        <WhatHappensNext items={[
          "Your trainer runs this assessment with you during your session.",
          "They score Handler Skills and Dog Performance on the same rubric shown above.",
          "The result and their feedback appear here and in your Feedback inbox.",
        ]} />
        <span className="hidden" data-testid="school-checkpoint-in-person" />
      </NeonEdge>
    );
  }

  /* ----------------------------------------------------- trainer assist --- */
  if (state === "trainer_assist") {
    const scheduleLine =
      ta?.status === "reschedule_needed" ? { icon: "fa-calendar-xmark", text: "Trainer Assist needs to be rescheduled" }
      : ta?.status === "scheduled" ? { icon: "fa-calendar-check", text: `Trainer Assist scheduled${ta.scheduled_date ? ` for ${ta.scheduled_date}${ta.scheduled_time ? ` · ${ta.scheduled_time}` : ""}` : ""}` }
      : ta?.status === "contacted" ? { icon: "fa-comment-dots", text: "Your trainer has reached out" }
      : { icon: "fa-hourglass-half", text: "Your trainer is arranging next steps" };
    return (
      <NeonEdge accentRgb="168,85,247" intensity="standard" className="p-5 space-y-4" data-testid="school-checkpoint-hold">
        <CheckpointHero rubric={rubric} moduleName={moduleName} tone="purple" icon="fa-handshake"
                        eyebrow="Trainer Assist"
                        title="Your trainer wants to work through this with you"
                        blurb="This is the part where having a real trainer helps. Nothing has gone wrong and nothing is lost." />
        <TrainerFeedback text={status?.trainer_feedback} trainerName={status?.trainer_name} tone="purple" />
        <div className="rounded-xl border border-purple-400/20 bg-purple-500/[0.05] p-3.5" data-testid="school-checkpoint-hold-status">
          <p className="text-purple-300 text-[16px] font-black"><i className={`fas ${scheduleLine.icon} mr-1.5`} />{scheduleLine.text}</p>
          <div className="grid sm:grid-cols-2 gap-2 mt-3 text-[15px] text-shTextMuted">
            <p><i className="fas fa-check mr-1.5 text-purple-300" />Your course progress stays exactly where it is</p>
            <p><i className="fas fa-check mr-1.5 text-purple-300" />You&apos;ll continue from here once your trainer clears it</p>
          </div>
        </div>
        {/* Only genuinely-permitted next steps. No appointment booking is
            offered, because nothing in this payload can create one. */}
        <WhatHappensNext items={[
          "Your trainer will be in touch to arrange the hands-on session.",
          "Keep working any practice that is still assigned to you.",
          "This checkpoint reopens once your trainer clears the hold.",
        ]} testid="checkpoint-assist-next" />
      </NeonEdge>
    );
  }

  /* --------------------------------------------------- assist complete --- */
  if (state === "assist_complete" && !returnedToCheckpoint) {
    return (
      <NeonEdge accentRgb="168,85,247" intensity="standard" className="p-5" data-testid="school-checkpoint-assist-complete">
        <CheckpointHero rubric={rubric} moduleName={moduleName} tone="purple" icon="fa-circle-check"
                        eyebrow="Trainer Assist complete" title="You're ready to keep training"
                        blurb={ta?.client_summary || undefined} />
        <PremiumButton onClick={() => setReturnedToCheckpoint(true)} data-testid="school-checkpoint-return-to-checkpoint"
                       className="mt-4 w-full justify-center min-h-[50px]">
          Return to checkpoint <i className="fas fa-arrow-right text-[13px]" />
        </PremiumButton>
      </NeonEdge>
    );
  }

  /* ---------------------------------------------------- awaiting review --- */
  // Deliberately renders no submit control of any kind: the work is with the
  // trainer, and a second Submit button here is how duplicate submissions
  // happen. No response time is promised — the app doesn't store one.
  if (state === "awaiting_review") {
    return (
      <NeonEdge accentRgb="0,169,224" intensity="standard" className="p-5 space-y-4" data-testid="school-checkpoint-awaiting-review">
        <CheckpointHero rubric={rubric} moduleName={moduleName} icon="fa-paper-plane"
                        eyebrow="Checkpoint submitted" title="Your trainer is reviewing it"
                        blurb={status?.submitted_at ? `Sent ${fmtWhen(status.submitted_at)}.` : "It's with your trainer now."} />
        <WhatHappensNext items={[
          "Your trainer watches your submission and scores the rubric above.",
          "You'll be notified here and by email when the review is ready.",
          "Handler Skills and Dog Performance are scored separately, so you'll know exactly what to work on.",
        ]} testid="checkpoint-awaiting-next" />
        <ScoredCriteria rubric={rubric} />
      </NeonEdge>
    );
  }

  /* ---------------------------------------------------------- passed --- */
  if (state === "passed") {
    return (
      <NeonEdge accentRgb="140,198,63" intensity="strong" className="relative overflow-hidden p-5 space-y-4" data-testid="school-checkpoint-passed">
        <PassCelebration />
        <div className="relative">
          <CheckpointHero rubric={rubric} moduleName={moduleName} tone="lime" icon="fa-award"
                          eyebrow="Passed" title={rubric?.title || "Checkpoint passed"}
                          blurb={dogName ? `You and ${dogName} showed it. Your trainer signed this one off.` : "Your trainer signed this one off."} />
        </div>
        <CheckpointScores handler={status?.handler_overall} dog={status?.dog_overall} />
        <TrainerFeedback text={status?.trainer_feedback} trainerName={status?.trainer_name} tone="lime" />
        <RubricBreakdown rubric={rubric} handlerScores={status?.handler_scores} dogScores={status?.dog_scores} />
        {/* What actually unlocked — the real next lesson, never a claim about
            what the dog is now permitted to do off-leash or in public. */}
        <div className="rounded-xl border border-shPrimary/25 bg-shPrimary/[0.06] p-3.5" data-testid="checkpoint-unlocked">
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-shPrimary mb-1">
            <i className="fas fa-lock-open mr-1.5" />Unlocked
          </p>
          <p className="text-[16px] text-shText leading-relaxed">
            {(() => {
              const next = nextStepAfter(roadmap);
              if (!next) return "The next step in your course is ready.";
              return next.kind === "lesson"
                ? `Your next lesson is ready: ${next.name}.`
                : `The next module is open: ${next.name}.`;
            })()}
          </p>
        </div>
        {onContinue && (
          <PremiumButton onClick={onContinue} disabled={busy} data-testid="school-checkpoint-continue"
                         className="w-full justify-center min-h-[52px]">
            Continue training <i className="fas fa-arrow-right text-[14px]" />
          </PremiumButton>
        )}
      </NeonEdge>
    );
  }

  /* --------------------------------------------------- more practice --- */
  if (state === "more_practice") {
    const p = status?.prescription || {};
    const remaining = p.practice_sessions_remaining;
    const canResubmit = !remaining || remaining <= 0;
    const actionLabel = p.action === "assign_refresher_lesson" && p.refresher_lesson_name
      ? `Refresher lesson: ${p.refresher_lesson_name}`
      : p.action === "assign_recipe" ? "New practice assigned"
      : "Repeat this lesson's practice";
    return (
      <div className="space-y-3" data-testid="school-checkpoint-prescribed">
        <NeonEdge accentRgb="242,101,34" intensity="standard" className="p-5 space-y-4">
          <CheckpointHero rubric={rubric} moduleName={moduleName} tone="orange" icon="fa-clipboard-list"
                          eyebrow="More practice" title="You're close — let's tighten up a few things"
                          blurb="This isn't a fail. Your trainer wants a bit more consistency before you move on." />
          <CheckpointScores handler={status?.handler_overall} dog={status?.dog_overall} />
          <TrainerFeedback text={status?.trainer_feedback} trainerName={status?.trainer_name} tone="orange" />
          <RubricBreakdown rubric={rubric} handlerScores={status?.handler_scores} dogScores={status?.dog_scores} />

          <div className="rounded-xl border border-shAccent/20 bg-shAccent/[0.055] p-3.5">
            <p className="text-[16px] text-shText font-black"><i className="fas fa-arrow-right mr-1.5 text-shAccent" />{actionLabel}</p>
            {p.min_practice_sessions_required > 0 && (
              <div className="mt-3" data-testid="school-checkpoint-remaining">
                <div className="flex items-center justify-between text-[14px] text-shTextMuted mb-1.5">
                  <span>Required practice</span><span>{remaining > 0 ? `${remaining} remaining` : "Complete"}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-shAccent" style={{ width: remaining > 0 ? "45%" : "100%" }} />
                </div>
                <p className="text-shTextMuted text-[14px] mt-2">
                  {remaining > 0 ? `Practice ${remaining} more time${remaining !== 1 ? "s" : ""} before resubmitting.` : "You're ready to resubmit."}
                </p>
              </div>
            )}
            {remaining !== 0 && onStartPrescribedPractice && (
              <PremiumButton onClick={onStartPrescribedPractice} data-testid="school-checkpoint-start-prescribed"
                             className="mt-3 w-full justify-center min-h-[52px]">
                <i className="fas fa-paw text-[13px]" />Start practice
              </PremiumButton>
            )}
            {p.action === "assign_refresher_lesson" && p.refresher_lesson_id && (
              <button onClick={() => onGoToRefresher(p.refresher_lesson_id)} data-testid="school-checkpoint-go-to-refresher"
                      className="mt-3 min-h-[44px] inline-flex items-center text-shAccent font-black text-[15px]">
                Review refresher lesson <i className="fas fa-arrow-right ml-1 text-[13px]" />
              </button>
            )}
          </div>

          {/* Why advancement is held, and what clears it. Stated plainly so
              nobody thinks the app is stuck. */}
          <WhatHappensNext items={[
            "Your course stays on this lesson until the checkpoint passes — that's what keeps the next module honest.",
            canResubmit
              ? "Work the practice above, then submit this checkpoint again."
              : "Log the required practice sessions, then this checkpoint reopens for another submission.",
            "Your trainer reviews the new submission and scores the same rubric.",
          ]} testid="checkpoint-prescribed-next" />
        </NeonEdge>
        {canResubmit && (
          <CheckpointSubmitForm rubric={rubric} skills={skills} moduleName={moduleName}
                                onSubmit={(v, f, n) => onSubmit(lessonId, v, f, n)} busy={busy} resubmit />
        )}
      </div>
    );
  }

  /* -------------------------------------------------------- not ready --- */
  if (state === "not_ready") {
    return (
      <NeonEdge accentRgb="0,169,224" intensity="subtle" className="p-5 space-y-4" data-testid="school-checkpoint-needs-practice-panel">
        <CheckpointHero rubric={rubric} moduleName={moduleName} icon="fa-flag-checkered"
                        eyebrow="Checkpoint ahead"
                        blurb="Practice this lesson first — then you'll show your trainer what it looks like." />
        <SkillsCovered skills={skills} />
        <ScoredCriteria rubric={rubric} />
        <SubmissionRequirements rubric={rubric} />
        <span className="hidden" data-testid="school-checkpoint-needs-practice" />
      </NeonEdge>
    );
  }

  /* ------------------------------------------------------------ ready --- */
  return (
    <CheckpointSubmitForm rubric={rubric} skills={skills} moduleName={moduleName} dogName={dogName}
                          onSubmit={(v, f, n) => onSubmit(lessonId, v, f, n)} busy={busy} />
  );
}

function CheckpointSubmitForm({ rubric, skills, moduleName, dogName, onSubmit, busy, resubmit }) {
  // Filming and sending the trainer check is an immersive workflow.
  useImmersiveWorkflow(true);
  const [videoFile, setVideoFile] = useState(null);
  const [videoDataUrl, setVideoDataUrl] = useState("");
  const [videoErr, setVideoErr] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  const isFinal = rubric?.assessment_type === "final_assessment";

  const onVideoUpload = (file, err) => {
    if (err) { setVideoErr(err); return; }
    setVideoErr("");
    setVideoFile(file);
    const reader = new FileReader();
    reader.onload = () => setVideoDataUrl(reader.result || "");
    reader.readAsDataURL(file);
  };

  return (
    <NeonEdge accentRgb={isFinal ? "242,101,34" : "0,169,224"} intensity="standard" className="p-5 space-y-4"
              data-testid="school-checkpoint-submit-form">
      <CheckpointHero rubric={rubric} moduleName={moduleName} icon={isFinal ? "fa-award" : "fa-flag-checkered"}
                      tone={isFinal ? "orange" : "cyan"}
                      eyebrow={resubmit ? "Ready to try again" : isFinal ? "Final assessment" : "Checkpoint"}
                      blurb={resubmit
                        ? "Show your trainer the progress you've made since last time."
                        : `You've practised it. Now let's see it in action${dogName ? ` — you and ${dogName}, one continuous take.` : "."}`} />

      <SkillsCovered skills={skills} />
      <ScoredCriteria rubric={rubric} />
      <SubmissionRequirements rubric={rubric} />

      <div>
        <PracticeMediaUploader
          photo="" onPhotoChange={() => {}} allowPhoto={false} allowVideo videoMaxMb={10}
          videoId={videoFile ? "ready" : ""} videoName={videoFile?.name}
          onVideoUpload={onVideoUpload}
          onVideoClear={() => { setVideoFile(null); setVideoDataUrl(""); }}
          testid="school-checkpoint-video"
        />
        {videoErr && <p className="text-shDanger text-[15px] font-bold mt-2" role="alert">{videoErr}</p>}
      </div>

      <div>
        <label className="text-[13px] font-black uppercase tracking-[0.14em] text-shTextMuted" htmlFor="cp-note">
          Anything your trainer should know?
        </label>
        <textarea
          id="cp-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          placeholder="Optional note about the session, distractions, or anything that felt different."
          data-testid="school-checkpoint-note"
          className="mt-1.5 w-full bg-black/25 border border-shBorder/70 rounded-xl p-3 text-shText text-[17px] outline-none transition"
        />
      </div>

      <WhatHappensNext items={[
        "Your trainer watches the whole submission, not just the best repetition.",
        "They score Handler Skills and Dog Performance separately on the rubric above.",
        "You'll see the result, their feedback and what's next right here.",
      ]} testid="checkpoint-submit-next" />

      {/* `sent` latches on the first click so a double tap cannot produce a
          second submission while the request is still in flight. */}
      <PremiumButton
        onClick={() => { if (sent || busy) return; setSent(true); onSubmit(videoDataUrl, videoFile?.name || "", note); }}
        disabled={!videoDataUrl || busy || sent}
        data-testid="school-checkpoint-submit"
        aria-label={resubmit ? "Submit checkpoint again for trainer review" : "Submit checkpoint for trainer review"}
        className="w-full justify-center min-h-[52px]"
      >
        <i className="fas fa-paper-plane text-[14px]" />
        {sent || busy ? "Sending…" : resubmit ? "Submit checkpoint again" : "Submit checkpoint"}
      </PremiumButton>
    </NeonEdge>
  );
}
