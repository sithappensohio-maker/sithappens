// Online School — client checkpoint state panel (submit / awaiting review /
// prescribed practice / Trainer Assist hold). Kept as the single native
// checkpoint UI for the School lesson flow; progression and grading remain
// backend-owned.
import { useState } from "react";
import NeonEdge from "../../premium/NeonEdge";
import PremiumButton from "../../premium/PremiumButton";
import PracticeMediaUploader from "../../training/PracticeMediaUploader";

export default function CheckpointPanel({ lessonId, practiced, rubric, status, onSubmit, onStartPrescribedPractice, onGoToRefresher, busy, deliveryMode }) {
  const [returnedToCheckpoint, setReturnedToCheckpoint] = useState(false);

  // In-person School students never submit a checkpoint video — their trainer
  // scores the same rubric live (server returns 409 for these submissions).
  // Only the two submission-soliciting states are swapped: awaiting-review,
  // prescribed-practice and Trainer Assist below stay exactly as they are,
  // because a live trainer checkpoint can still produce those outcomes.
  const trainerAssessed = deliveryMode === "in_person" || deliveryMode === "trainer_led";
  const inPersonPanel = (
    <NeonEdge accentRgb="0,169,224" intensity="subtle" className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-shSecondary/10 border border-shSecondary/25 grid place-items-center shrink-0"><i className="fas fa-chalkboard-user text-shSecondary"/></div>
        <div>
          <p className="text-[14px] font-black text-shText">Your trainer checks this one in person</p>
          <p className="text-[12px] text-shTextMuted mt-1">No video needed — your trainer scores this checkpoint with you at your next session. Keep practising and it will be marked off here.</p>
        </div>
      </div>
      <span className="hidden" data-testid="school-checkpoint-in-person"/>
    </NeonEdge>
  );

  if (!practiced) {
    if (trainerAssessed) return inPersonPanel;
    return (
      <NeonEdge accentRgb="0,169,224" intensity="subtle" className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-shSecondary/10 border border-shSecondary/25 grid place-items-center shrink-0"><i className="fas fa-video text-shSecondary"/></div>
          <div><p className="text-[14px] font-black text-shText">Practice first, then show your trainer</p><p className="text-[12px] text-shTextMuted mt-1">Practice this lesson first, then submit a checkpoint video for your trainer to review.</p></div>
        </div>
        <span className="hidden" data-testid="school-checkpoint-needs-practice"/>
      </NeonEdge>
    );
  }

  const ta = status?.trainer_assist;

  // Online School Phase 4 — real Trainer Assist lifecycle, not just an
  // on/off hold flag. "This is exactly where having a real trainer
  // helps" — never scary wording, never a fail screen (spec §20).
  if (status?.on_hold && ta) {
    return (
      <NeonEdge accentRgb="168,85,247" intensity="standard" className="p-5" data-testid="school-checkpoint-hold">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-purple-400/10 border border-purple-400/30 grid place-items-center shrink-0"><i className="fas fa-handshake text-purple-300"/></div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-purple-300">Trainer Assist</p>
            <h4 className="text-[18px] font-black text-white mt-1">Your trainer wants to help with this one</h4>
            <p className="text-shTextMuted text-[13px] mt-1.5 leading-relaxed">We've paused this checkpoint so we can work through it with you.</p>
          </div>
        </div>
        {status.trainer_feedback && (
          <div className="mt-4 rounded-xl bg-black/25 border border-purple-400/15 p-3.5">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-purple-300/80 mb-1">From your trainer</p>
            <p className="text-shText/90 text-[13px] leading-relaxed">“{status.trainer_feedback}”</p>
          </div>
        )}
        <div className="mt-4 rounded-xl border border-purple-400/20 bg-purple-500/[0.05] p-3.5" data-testid="school-checkpoint-hold-status">
          {ta.status === "reschedule_needed" ? (
            <p className="text-purple-300 text-[13px] font-bold"><i className="fas fa-calendar-xmark mr-1.5"/>Trainer Assist needs to be rescheduled</p>
          ) : ta.status === "scheduled" ? (
            <p className="text-purple-300 text-[13px] font-bold"><i className="fas fa-calendar-check mr-1.5"/>Trainer Assist scheduled{ta.scheduled_date ? ` for ${ta.scheduled_date}${ta.scheduled_time ? ` · ${ta.scheduled_time}` : ""}` : ""}</p>
          ) : ta.status === "contacted" ? (
            <p className="text-purple-300 text-[13px] font-bold"><i className="fas fa-comment-dots mr-1.5"/>Your trainer has reached out</p>
          ) : (
            <p className="text-purple-300 text-[13px] font-bold"><i className="fas fa-hourglass-half mr-1.5"/>Trainer is reviewing next steps</p>
          )}
          <div className="grid sm:grid-cols-2 gap-2 mt-3 text-[12px] text-shTextMuted">
            <p><i className="fas fa-check mr-1.5 text-purple-300"/>Your course progress stays exactly where it is</p>
            <p><i className="fas fa-check mr-1.5 text-purple-300"/>You'll continue from here once cleared</p>
          </div>
        </div>
      </NeonEdge>
    );
  }

  // Trainer Assist complete — the hold has been lifted, but this same
  // submission still holds the client-facing follow-up summary until the
  // client resubmits. "Return to Checkpoint" is a local reveal step, not
  // a fabricated success — it just opens the same submit form below.
  if (!status?.on_hold && ta?.status === "completed" && !returnedToCheckpoint) {
    return (
      <NeonEdge accentRgb="168,85,247" intensity="standard" className="p-5" data-testid="school-checkpoint-assist-complete">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-purple-400/10 border border-purple-400/30 grid place-items-center shrink-0"><i className="fas fa-circle-check text-purple-300"/></div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-purple-300">Trainer Assist complete</p>
            <h4 className="text-[18px] font-black text-white mt-1">You're ready to keep training</h4>
            {ta.client_summary && <p className="text-shText/90 text-[13px] mt-2 leading-relaxed">{ta.client_summary}</p>}
          </div>
        </div>
        <PremiumButton onClick={() => setReturnedToCheckpoint(true)} data-testid="school-checkpoint-return-to-checkpoint" className="mt-4 w-full justify-center">
          Return to checkpoint <i className="fas fa-arrow-right text-[10px]"/>
        </PremiumButton>
      </NeonEdge>
    );
  }

  if (status?.status === "awaiting_review") {
    return (
      <NeonEdge accentRgb="242,101,34" intensity="standard" className="p-5" data-testid="school-checkpoint-awaiting-review">
        <div className="flex items-center gap-4">
          <div className="relative w-12 h-12 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center shrink-0"><i className="fas fa-hourglass-half text-shAccent"/><span className="absolute inset-0 rounded-2xl border border-shAccent/20 animate-pulse"/></div>
          <div><p className="text-[10px] font-black uppercase tracking-[0.15em] text-shAccent">Checkpoint submitted</p><h4 className="text-[18px] font-black text-white mt-1">Your video is with your trainer</h4><p className="text-shTextMuted text-[12px] mt-1">You'll get an email when your review is ready.</p></div>
        </div>
      </NeonEdge>
    );
  }

  if (status?.status === "graded" && status.outcome === "prescribe_practice") {
    const p = status.prescription || {};
    const remaining = p.practice_sessions_remaining;
    const canResubmit = !remaining || remaining <= 0;
    const actionLabel = p.action === "assign_refresher_lesson" && p.refresher_lesson_name
      ? `Refresher lesson: ${p.refresher_lesson_name}`
      : p.action === "assign_recipe" ? "New practice assigned"
      : "Repeat this lesson's practice";
    return (
      <div className="space-y-3" data-testid="school-checkpoint-prescribed">
        <NeonEdge accentRgb="242,101,34" intensity="standard" className="p-5">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center shrink-0"><i className="fas fa-clipboard-list text-shAccent"/></div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-shAccent">Your trainer's plan</p>
              <h4 className="text-[18px] font-black text-white mt-1">You're making progress</h4>
              <p className="text-shTextMuted text-[12px] mt-1">Let's clean up one piece before moving on.</p>
            </div>
          </div>
          {status.trainer_feedback && <div className="mt-4 rounded-xl border border-shAccent/15 bg-black/25 p-3.5"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-shAccent/80 mb-1">Trainer feedback</p><p className="text-shText/90 text-[13px] leading-relaxed">“{status.trainer_feedback}”</p></div>}
          <div className="mt-4 rounded-xl border border-shAccent/20 bg-shAccent/[0.055] p-3.5">
            <p className="text-[13px] text-shText font-black"><i className="fas fa-arrow-right mr-1.5 text-shAccent"/>{actionLabel}</p>
            {p.min_practice_sessions_required > 0 && (
              <div className="mt-3" data-testid="school-checkpoint-remaining">
                <div className="flex items-center justify-between text-[11px] text-shTextMuted mb-1.5"><span>Required practice</span><span>{remaining > 0 ? `${remaining} remaining` : "Complete"}</span></div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-shAccent" style={{ width: remaining > 0 ? "45%" : "100%" }}/></div>
                <p className="text-shTextMuted text-[11px] mt-2">{remaining > 0 ? `Practice ${remaining} more time${remaining !== 1 ? "s" : ""} before resubmitting.` : "You're ready to resubmit."}</p>
              </div>
            )}
            {remaining !== 0 && onStartPrescribedPractice && (
              <PremiumButton onClick={onStartPrescribedPractice} data-testid="school-checkpoint-start-prescribed" className="mt-3 w-full justify-center">
                <i className="fas fa-paw text-[10px]" />Start prescribed practice
              </PremiumButton>
            )}
            {p.action === "assign_refresher_lesson" && p.refresher_lesson_id && (
              <button onClick={() => onGoToRefresher(p.refresher_lesson_id)} data-testid="school-checkpoint-go-to-refresher" className="mt-3 text-shAccent font-black text-[12px]">
                Review refresher lesson <i className="fas fa-arrow-right ml-1 text-[10px]"/>
              </button>
            )}
          </div>
        </NeonEdge>
        {canResubmit && <CheckpointSubmitForm rubric={rubric} onSubmit={(v, f, n) => onSubmit(lessonId, v, f, n)} busy={busy} resubmit/>}
      </div>
    );
  }

  if (trainerAssessed) return inPersonPanel;

  return <CheckpointSubmitForm rubric={rubric} onSubmit={(v, f, n) => onSubmit(lessonId, v, f, n)} busy={busy}/>;
}

function CheckpointSubmitForm({ rubric, onSubmit, busy, resubmit }) {
  const [videoFile, setVideoFile] = useState(null);
  const [videoDataUrl, setVideoDataUrl] = useState("");
  const [videoErr, setVideoErr] = useState("");
  const [note, setNote] = useState("");
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
    <NeonEdge accentRgb={isFinal ? "242,101,34" : "0,169,224"} intensity="standard" className="p-5" data-testid="school-checkpoint-submit-form">
      <div className="flex items-start gap-3.5 mb-4">
        <div className={`w-11 h-11 rounded-2xl grid place-items-center border shrink-0 ${isFinal ? "bg-shAccent/10 border-shAccent/30" : "bg-shSecondary/10 border-shSecondary/30"}`}>
          <i className={`fas ${isFinal ? "fa-award text-shAccent" : "fa-video text-shSecondary"}`}/>
        </div>
        <div className="min-w-0">
          <p className={`text-[10px] font-black uppercase tracking-[0.15em] ${isFinal ? "text-shAccent" : "text-shSecondary"}`}>{resubmit ? "Ready to try again" : isFinal ? "Final Assessment" : "Trainer Checkpoint"}</p>
          <h4 className="text-[18px] font-black text-white mt-1">{resubmit ? "Show your trainer the progress" : "Show us you can do it"}</h4>
          <p className="text-[12px] text-shTextMuted mt-1">Your trainer will review your handling AND your dog's performance.</p>
        </div>
      </div>

      {rubric?.submission_instructions && (
        <div className="rounded-xl border border-shSecondary/20 bg-shSecondary/[0.05] p-3.5 mb-4">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shSecondary mb-1.5"><i className="fas fa-circle-info mr-1.5"/>Filming instructions</p>
          <p className="text-[13px] text-shText/90 whitespace-pre-wrap leading-relaxed">{rubric.submission_instructions}</p>
        </div>
      )}

      <PracticeMediaUploader
        photo="" onPhotoChange={() => {}} allowPhoto={false} allowVideo videoMaxMb={10}
        videoId={videoFile ? "ready" : ""} videoName={videoFile?.name}
        onVideoUpload={onVideoUpload}
        onVideoClear={() => { setVideoFile(null); setVideoDataUrl(""); }}
        testid="school-checkpoint-video"
      />
      {videoErr && <p className="text-shDanger text-[12px] font-bold mt-2">{videoErr}</p>}

      <div className="mt-4">
        <label className="text-[10px] font-black uppercase tracking-[0.14em] text-shTextMuted">Anything your trainer should know?</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Optional note about the session, distractions, or anything that felt different."
          data-testid="school-checkpoint-note"
          className="mt-1.5 w-full bg-black/25 border border-shBorder/70 rounded-xl p-3 text-shText text-sm outline-none transition"
        />
      </div>

      <PremiumButton
        onClick={() => onSubmit(videoDataUrl, videoFile?.name || "", note)}
        disabled={!videoDataUrl || busy}
        data-testid="school-checkpoint-submit"
        className="mt-4 w-full justify-center"
      >
        <i className="fas fa-paper-plane text-[11px]"/>Submit for trainer review
      </PremiumButton>
    </NeonEdge>
  );
}
