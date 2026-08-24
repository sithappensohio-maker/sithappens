// Training UI Phase 3 (extended by the Client Practice Coach upgrade) — the
// "Homework Practice" focused screen. Opens when a client taps an
// assignment card on Client Today. Submits through the EXISTING
// homework-log endpoints only:
//   - daily-tracker assignments -> POST /homework/{id}/day/{n}/submit
//     (field_values, note, mood, difficulty, photo, video_media_id,
//     could_not_complete/reason)
//   - single-log (section-based) assignments -> POST /homework/{id}/section-log
//     (field_values, date, note, and — see server.py's SectionLogIn —
//     difficulty, could_not_complete/reason, photo, and video_media_id.
//     Section video uploads go through POST /homework/{id}/practice-video
//     and are offered ONLY when the Practice Recipe requests video
//     (practice_coach.media.request_video); recipes that don't request it
//     keep exactly the old no-video form.)
//
// Client Practice Coach upgrade: when template_snapshot.practice_coach is
// present and enabled, this renders the structured Coach Mode flow
// (CoachPracticeOverview -> GuidedPracticeFlow -> the same completion form,
// now with end_questions + difficulty feedback) INSTEAD of jumping
// straight to the plain completion form — Quick Practice, and every
// legacy template with no practice_coach, keep using exactly the
// pre-existing simple flow below, completely unchanged.
import { useEffect, useRef, useState } from "react";
import { api, formatErr } from "../../lib/api";
import { toast } from "sonner";
import { todayISO } from "../../lib/date";
import { assignmentCardModel } from "../../lib/clientPracticePolish";
import { hasCoachMode, quickPracticeAllowed, renderPracticeCoachText } from "../../lib/practiceCoachPolish";
import VideoDemoCard from "./VideoDemoCard";
import PracticeInstructionSteps from "./PracticeInstructionSteps";
import EquipmentChips from "./EquipmentChips";
import ExpandableSection from "./ExpandableSection";
import MeasurementChips from "./MeasurementChips";
import PracticeCompletionPanel from "./PracticeCompletionPanel";
import TrainerFeedbackNotice from "./TrainerFeedbackNotice";
import EmptyState from "./EmptyState";
import CoachPracticeOverview from "./CoachPracticeOverview";
import GuidedPracticeFlow from "./GuidedPracticeFlow";
import TroubleshootingDrawer from "./TroubleshootingDrawer";
import CoachEndQuestions from "./CoachEndQuestions";
import DifficultyFeedbackNotice from "./DifficultyFeedbackNotice";
import HuskyDogImage from "../brand/HuskyDogImage";
import SectionCard from "../premium/SectionCard";

const FIELD_ICON = { reps: "fa-rotate", sets: "fa-layer-group", duration_sec: "fa-stopwatch", duration_min: "fa-stopwatch",
  distance_ft: "fa-ruler", success_rate: "fa-percent", rating_5: "fa-star", checkbox: "fa-square-check", text: "fa-pen", longtext: "fa-pen" };
const FIELD_UNIT = { duration_sec: "sec", duration_min: "min", distance_ft: "ft", success_rate: "%", rating_5: "/5" };

// Guided Practice already knows several objective facts. Put those facts into
// matching wrap-up fields so a beginner is not asked to retype information
// the app just tracked. Subjective fields (difficulty/reliability, etc.) are
// intentionally left for the client to answer.
export function guidedAutofillValues(fields, metrics, schedule, timerSec = 0, focusText = "") {
  if (!metrics) return {};
  const out = {};
  const rounds = Number(metrics.rounds_completed) || 0;
  const attempted = Number(metrics.reps_attempted) || 0;
  const plannedReps = Number(schedule?.reps_per_round) || 0;
  const fullRoundsOnly = rounds > 0 && plannedReps > 0 && attempted === rounds * plannedReps;

  for (const f of fields || []) {
    if (!f?.id || f.kind === "checkbox") continue;
    const label = `${f.id} ${f.label || ""}`.toLowerCase();

    if ((label.includes("reps per set") || label.includes("reps per round") || label.includes("repetitions per")) && fullRoundsOnly) {
      out[f.id] = plannedReps;
      continue;
    }
    if (label.includes("sets today") || label.includes("rounds today") || label.includes("rounds completed")) {
      out[f.id] = rounds;
      continue;
    }
    if ((f.kind === "success_rate" || label.includes("success rate")) && metrics.success_rate != null) {
      out[f.id] = metrics.success_rate;
      continue;
    }
    if ((f.kind === "duration_sec" || label.includes("duration sec")) && timerSec > 0) {
      out[f.id] = timerSec;
      continue;
    }
    if ((f.kind === "duration_min" || label.includes("session length") || label.includes("minutes practiced")) && timerSec > 0) {
      out[f.id] = Math.max(1, Math.round(timerSec / 60));
      continue;
    }
    if ((label.includes("what we worked on") || label.includes("practice focus") || label.includes("skill practiced")) && focusText) {
      out[f.id] = focusText;
    }
  }
  return out;
}

export default function PracticePanel({ homework, dogPhoto, onClose, onChanged, onPracticeLogged, onCompleted }) {
  const model = assignmentCardModel(homework);
  const isDailyTracker = !!homework.daily_tracker;
  const readOnly = model.status === "completed" || model.status === "waiting_review";
  const activeDay = model.actionableDay;
  const reviewDay = isDailyTracker ? [...(homework.daily_progress || [])].reverse().find(p => p.log) : null;
  const section = isDailyTracker ? (activeDay || reviewDay) : (homework.template_snapshot?.sections || [])[0];

  const coachEnabled = hasCoachMode(homework);
  const practiceCoach = homework.template_snapshot?.practice_coach || null;
  const tokens = { dog_name: homework.dog_name, client_first_name: (homework.client_name || "").split(" ")[0] || "" };

  // "overview" -> "guided" -> "form" (Coach Mode's end-of-practice form),
  // or "form" directly for Quick Practice / legacy/simple homework.
  const [viewMode, setViewMode] = useState(coachEnabled && !readOnly ? "overview" : "form");
  const [entryContext, setEntryContext] = useState(null); // null | "quick" | "guided_done"
  const [troubleshootingOpen, setTroubleshootingOpen] = useState(false);
  const [guidedMetrics, setGuidedMetrics] = useState(null);
  const [endAnswers, setEndAnswers] = useState({});

  const [values, setValues] = useState({});
  const [difficulty, setDifficulty] = useState(null);
  const [note, setNote] = useState("");
  const [couldNotComplete, setCouldNotComplete] = useState(false);
  const [couldNotCompleteReason, setCouldNotCompleteReason] = useState("");
  const [photo, setPhoto] = useState("");
  const [videoId, setVideoId] = useState("");
  const [videoName, setVideoName] = useState("");
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [askText, setAskText] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const submittingRef = useRef(false); // synchronous double-submit lock (state alone races same-tick clicks)
  const [errorMessage, setErrorMessage] = useState("");
  const [timerSec, setTimerSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);

  useEffect(() => {
    if (!timerRunning) return;
    const t = setInterval(() => setTimerSec(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [timerRunning]);

  const setField = (fid, v) => setValues(s => ({ ...s, [fid]: v }));
  const setEndAnswer = (qid, v) => setEndAnswers(s => ({ ...s, [qid]: v }));

  // Section-log (non-daily) practice offers video ONLY when the Practice
  // Recipe explicitly requests it — a recipe with no request keeps the old
  // no-video form. Daily tracker keeps its always-available video control.
  const sectionVideoAllowed = !isDailyTracker && !!practiceCoach?.media?.request_video;

  const uploadVideo = async (file, errText) => {
    if (errText) { toast.error(errText); return; }
    setUploadingVideo(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const url = isDailyTracker
        ? `/homework/${homework.id}/day/${activeDay.day_number}/video`
        : `/homework/${homework.id}/practice-video`;
      const { data } = await api.post(url, { photo: dataUrl, filename: file.name });
      setVideoId(data.media_id);
      setVideoName(file.name);
    } catch (e) {
      toast.error("Video upload failed: " + (e.response?.data?.detail || e.message));
    } finally { setUploadingVideo(false); }
  };

  // Completion is a WORKFLOW, not a popup: after a successful save the form
  // is replaced by an inline "Practice Complete" state, then (when hosted by
  // School) onCompleted routes to the backend-decided next step. The timer
  // is cleared on unmount so a quick close can't fire a stale navigation.
  useEffect(() => {
    if (viewMode !== "complete" || !onCompleted) return undefined;
    const t = setTimeout(() => onCompleted(), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  const submit = async () => {
    if (saveState === "saving" || saveState === "saved") return; // double-click guard
    // React state updates are async, so rapid same-tick clicks all still see
    // saveState === "idle" — the ref blocks those synchronously. Backend
    // section-log has no dedupe; every request that gets through is a
    // duplicate practice record.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaveState("saving"); setErrorMessage("");
    try {
      const field_values = {};
      for (const f of section?.fields || []) {
        const v = values[f.id];
        if (v === undefined || v === "") continue;
        field_values[f.id] = ["checkbox"].includes(f.kind) ? !!v : (isNaN(Number(v)) ? v : Number(v));
      }
      for (const [qid, v] of Object.entries(endAnswers)) {
        if (v !== undefined && v !== "") field_values[`q_${qid}`] = v;
      }
      if (guidedMetrics) {
        field_values.__reps_attempted = guidedMetrics.reps_attempted;
        field_values.__successful_reps = guidedMetrics.successful_reps;
        field_values.__rounds_completed = guidedMetrics.rounds_completed;
        if (guidedMetrics.success_rate != null) field_values.__success_rate = guidedMetrics.success_rate;
      }
      if (isDailyTracker) {
        await api.post(`/homework/${homework.id}/day/${activeDay.day_number}/submit`, {
          field_values, note, difficulty: difficulty || null,
          photo: photo || "", video_media_id: videoId || "",
          could_not_complete: couldNotComplete,
          could_not_complete_reason: couldNotComplete ? (couldNotCompleteReason || null) : null,
        });
      } else {
        await api.post(`/homework/${homework.id}/section-log`, {
          section_id: section.id, date: todayISO(), field_values, note,
          difficulty: difficulty || null, photo: photo || "",
          video_media_id: sectionVideoAllowed ? (videoId || "") : "",
          could_not_complete: couldNotComplete,
          could_not_complete_reason: couldNotComplete ? (couldNotCompleteReason || null) : null,
        });
      }
      setSaveState("saved");
      onPracticeLogged?.();
      onChanged?.();
      // No popup to dismiss — replace the form with the completion state.
      // In School the onCompleted effect above then routes to the next step;
      // for generic homework the state offers one obvious CONTINUE action.
      setViewMode("complete");
    } catch (e) {
      submittingRef.current = false; // a failed save must stay retryable
      setSaveState("error");
      setErrorMessage(formatErr(e.response?.data?.detail) || "Couldn't save — try again.");
    }
  };

  const [markingComplete, setMarkingComplete] = useState(false);
  const markAssignmentComplete = async () => {
    setMarkingComplete(true);
    try {
      await api.post(`/homework/${homework.id}/complete`, { note, photo: "" });
      toast.success("Assignment marked complete");
      onPracticeLogged?.();
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't mark complete");
    } finally { setMarkingComplete(false); }
  };

  const askTrainer = async () => {
    if (!askText.trim()) return;
    try {
      if (isDailyTracker && activeDay) {
        await api.post(`/homework/${homework.id}/day/${activeDay.day_number}/ask`, { text: askText });
      } else if (!isDailyTracker && section) {
        await api.post(`/homework/${homework.id}/section/${section.id}/ask`, { text: askText });
      } else {
        return;
      }
      setAskText("");
      toast.success("Question sent to your trainer");
      onChanged?.();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Failed to send question");
    }
  };

  const estimatedMinutes = (section?.steps || []).reduce((s, st) => s + (Number(st.minutes) || 0), 0) || null;
  const targetChips = (section?.fields || []).map(f => ({
    key: f.id, icon: FIELD_ICON[f.kind] || "fa-bullseye", label: f.label,
    value: f.target != null ? `${f.target}${FIELD_UNIT[f.kind] || ""}` : null,
  })).filter(c => c.value);

  const editableChips = (section?.fields || []).filter(f => f.kind !== "checkbox").map(f => ({
    key: f.id, icon: FIELD_ICON[f.kind] || "fa-bullseye", label: f.label,
    value: values[f.id] ?? "", placeholder: f.target != null ? `Goal: ${f.target}${FIELD_UNIT[f.kind] || ""}` : undefined,
    onChange: (v) => setField(f.id, v),
  }));

  const startQuickPractice = () => { setEntryContext("quick"); setViewMode("form"); };
  const startGuided = () => setViewMode("guided");
  const finishGuided = (metrics) => {
    const autofill = guidedAutofillValues(section?.fields || [], metrics, practiceCoach?.schedule || {}, timerSec, homework.title || "");
    setValues(current => ({ ...autofill, ...current }));
    setGuidedMetrics(metrics);
    setTimerRunning(false);
    setEntryContext("guided_done");
    setViewMode("form");
  };

  // Practice Timer — lives WHERE THE REPS HAPPEN: on the guided-practice
  // screen and on the quick/legacy form (where the client practices with the
  // form open). After guided practice it only lingers on the completion form
  // when it was actually used (elapsed context), never as a fresh
  // start-a-timer prompt for practice that already happened. Timer state
  // stays up here so the elapsed time survives the guided → form transition.
  const timerCard = (
    <SectionCard accent="cyan" intensity="subtle">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-shTextMuted"><i className="fas fa-stopwatch mr-1.5 text-shSecondary"/>Practice Timer <span className="normal-case tracking-normal font-semibold">(optional)</span></p><span className="block text-[30px] font-black text-white tabular-nums mt-1" data-testid="practice-timer-display">{String(Math.floor(timerSec / 60)).padStart(2, "0")}:{String(timerSec % 60).padStart(2, "0")}</span></div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button type="button" onClick={() => setTimerRunning(r => !r)} data-testid="practice-timer-toggle" className="min-h-[44px] bg-shSecondary/12 text-shSecondary border border-shSecondary/35 px-4 py-2 rounded-xl text-[11px] font-black">{timerRunning ? "Pause" : "Start"}</button>
          <button type="button" onClick={() => { setTimerSec(0); setTimerRunning(false); }} data-testid="practice-timer-reset" className="min-h-[44px] border border-shBorder/55 bg-black/10 text-shTextMuted px-4 py-2 rounded-xl text-[11px] font-black">Reset</button>
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4 lg:p-6" data-testid="practice-panel">
      <div className="relative bg-[var(--sh-card-base)] border border-shBorder/70 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0 shadow-[0_30px_100px_rgba(0,0,0,0.7)] overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-60" style={{ background: "radial-gradient(circle at 10% 0%, rgba(140,198,63,0.07), transparent 25%), radial-gradient(circle at 100% 10%, rgba(0,169,224,0.07), transparent 28%)" }}/>
        <div className="relative px-3 sm:px-5 py-3 border-b border-shBorder/55 bg-bgHeader/90 backdrop-blur-xl flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl overflow-hidden border border-shPrimary/30 bg-black/35 shrink-0"><HuskyDogImage src={dogPhoto} name={homework.dog_name} alt={homework.dog_name} className="w-full h-full object-cover object-top"/></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><p className="text-[9px] font-black uppercase tracking-[0.16em] text-shPrimary">Practice Coach</p><span className="w-1 h-1 rounded-full bg-shBorder"/><p className="text-[9px] font-black uppercase tracking-[0.12em] text-shSecondary truncate">{homework.dog_name}</p></div>
              <h3 className="text-[16px] sm:text-[18px] font-black text-shText truncate mt-0.5">{homework.title}</h3>
            </div>
          </div>
          <button onClick={onClose} data-testid="practice-panel-close" className="w-10 h-10 rounded-xl border border-shBorder/55 bg-black/15 text-shTextMuted hover:text-shText hover:bg-white/[0.03] grid place-items-center shrink-0"><i className="fas fa-times"/></button>
        </div>

        <div className="relative overflow-y-auto flex-1 min-h-0 px-3 sm:px-5 lg:px-6 py-4 sm:py-5 space-y-4 sm:space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {viewMode === "complete" ? (
            <div className="flex flex-col items-center justify-center text-center py-10 sm:py-14 space-y-4" data-testid="practice-complete-state">
              <span className="w-16 h-16 rounded-2xl bg-shPrimary/15 border border-shPrimary/40 grid place-items-center">
                <i className="fas fa-check text-shPrimary text-2xl" />
              </span>
              <div>
                <p className="text-[20px] font-black text-shText uppercase tracking-tight">✓ Practice Complete</p>
                <p className="text-[13px] text-shTextMuted mt-1" data-testid="practice-complete-subtitle">
                  {onCompleted ? "Nice work. Updating your training plan…" : "Nice work — it's saved to your training history."}
                </p>
              </div>
              {onCompleted ? (
                <i className="fas fa-spinner fa-spin text-shSecondary" aria-hidden="true" />
              ) : (
                <div className="w-full max-w-sm space-y-2">
                  <button type="button" onClick={onClose} data-testid="practice-complete-continue"
                          className="w-full min-h-[50px] bg-shPrimary text-bgHeader rounded-xl font-black text-[13px] uppercase tracking-widest shadow-lg hover:bg-shPrimary/90 transition">
                    Continue Training <i className="fas fa-arrow-right ml-1.5" />
                  </button>
                  {!isDailyTracker && (
                    <button type="button" onClick={markAssignmentComplete} disabled={markingComplete} data-testid="practice-mark-assignment-complete"
                            className="w-full min-h-[44px] text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shPrimary disabled:opacity-50">
                      {markingComplete ? "Marking complete…" : "This assignment is fully done — mark it complete"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : !section ? (
            <EmptyState icon="fa-clipboard-check" message="This assignment doesn't have any sessions to log yet." testid="practice-no-section"/>
          ) : readOnly ? (
            <div className="space-y-3">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">
                {model.status === "completed" ? "Completed" : "Submitted — waiting for your trainer"}
              </p>
              {reviewDay?.log?.note && <p className="text-[13px] text-shText italic">&ldquo;{reviewDay.log.note}&rdquo;</p>}
              {reviewDay?.log?.review_note && <TrainerFeedbackNotice text={reviewDay.log.review_note} testid="practice-review-note"/>}
              {(reviewDay?.questions || []).filter(q => q.answer).map(q => (
                <TrainerFeedbackNotice key={q.id} label="Reply to your question" text={q.answer} testid={`practice-answer-${q.id}`}/>
              ))}
            </div>
          ) : coachEnabled && viewMode === "overview" ? (
            <CoachPracticeOverview
              practiceCoach={practiceCoach} tokens={tokens} dogPhoto={dogPhoto}
              onStartGuided={startGuided}
              onQuickPractice={quickPracticeAllowed(practiceCoach) ? startQuickPractice : undefined}
              onOpenTroubleshooting={() => setTroubleshootingOpen(true)}
              testid="coach-overview"
            />
          ) : coachEnabled && viewMode === "guided" ? (
            <>
              {timerCard}
              <GuidedPracticeFlow
                practiceCoach={practiceCoach} tokens={tokens}
                onOpenTroubleshooting={() => setTroubleshootingOpen(true)}
                onFinish={finishGuided}
                testid="coach-guided"
              />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-shTextMuted font-bold">
                {estimatedMinutes ? <span><i className="fas fa-clock mr-1"/>{estimatedMinutes} min</span> : null}
              </div>

              {entryContext === "quick" && practiceCoach?.goal && (
                <SectionCard accent="lime" intensity="subtle">
                  <p className="text-[9px] font-black uppercase tracking-[0.15em] text-shPrimary mb-1.5">Quick Practice Goal</p>
                  <p className="text-[15px] text-shText font-black leading-snug">{renderPracticeCoachText(practiceCoach.goal, tokens)}</p>
                  {(practiceCoach.steps || []).length > 0 && <p className="text-[11px] text-shTextMuted mt-2 leading-relaxed">{practiceCoach.steps.map(s => renderPracticeCoachText(s.title, tokens)).join(" · ")}</p>}
                </SectionCard>
              )}
              {entryContext === "guided_done" && guidedMetrics && (
                <SectionCard accent="lime" intensity="subtle">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-shPrimary/10 border border-shPrimary/30 grid place-items-center text-shPrimary shrink-0"><i className="fas fa-check"/></span>
                    <div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-shPrimary">Guided practice complete</p><p className="text-[13px] sm:text-[14px] font-black text-shText mt-1">{guidedMetrics.rounds_completed} round{guidedMetrics.rounds_completed === 1 ? "" : "s"} · {guidedMetrics.successful_reps}/{guidedMetrics.reps_attempted} successful</p></div>
                  </div>
                </SectionCard>
              )}

              <VideoDemoCard videoUrl={homework.video_url} testid="practice-video"/>

              {section.day_focus && <p className="text-[14px] text-shText font-bold">{section.day_focus}</p>}
              <PracticeInstructionSteps text={section.instructions} testid="practice-steps"/>
              <EquipmentChips equipment={(section.equipment || []).join(", ")} testid="practice-equipment"/>
              {targetChips.length > 0 && <MeasurementChips items={targetChips} testid="practice-targets"/>}

              {homework.trainer_personalized_note && (
                <ExpandableSection title="Trainer's Note" icon="fa-user-tie" tone="secondary" testid="practice-trainer-note">
                  <p className="text-[13px] text-shText">{homework.trainer_personalized_note}</p>
                </ExpandableSection>
              )}
              {(section.resources || []).length > 0 && (
                <ExpandableSection title="Resources" icon="fa-paperclip" testid="practice-resources">
                  <ul className="space-y-1">
                    {section.resources.map(r => (
                      <li key={r.id}><a href={r.url || "#"} target="_blank" rel="noopener noreferrer" className="text-[13px] text-shSecondary hover:underline"><i className="fas fa-file mr-1.5"/>{r.name}</a></li>
                    ))}
                  </ul>
                </ExpandableSection>
              )}

              {/* During-practice surfaces keep the timer; the after-guided
                  completion form only shows it when it actually ran. */}
              {(entryContext !== "guided_done" || timerSec > 0) && timerCard}

              <PracticeCompletionPanel
                allowDifficulty={true}
                allowCouldNotComplete={true}
                allowPhoto={true}
                allowVideo={isDailyTracker || sectionVideoAllowed}
                fieldsSlot={editableChips.length > 0 ? <MeasurementChips items={editableChips} testid="practice-fields"/> : null}
                extraSlot={coachEnabled && (practiceCoach?.end_questions || []).length > 0
                  ? <CoachEndQuestions questions={practiceCoach.end_questions} answers={endAnswers} onAnswerChange={setEndAnswer} tokens={tokens} testid="coach-end-questions"/>
                  : null}
                difficultyFeedbackSlot={coachEnabled && practiceCoach?.difficulty_feedback
                  ? <DifficultyFeedbackNotice difficulty={difficulty} feedback={practiceCoach.difficulty_feedback} tokens={tokens} testid="coach-difficulty-feedback"/>
                  : null}
                difficulty={difficulty} onDifficultyChange={setDifficulty}
                note={note} onNoteChange={setNote}
                couldNotComplete={couldNotComplete} onCouldNotCompleteChange={setCouldNotComplete}
                couldNotCompleteReason={couldNotCompleteReason} onCouldNotCompleteReasonChange={setCouldNotCompleteReason}
                photo={photo} onPhotoChange={setPhoto} videoId={videoId} videoName={videoName}
                onVideoUpload={uploadVideo} uploadingVideo={uploadingVideo} onVideoClear={() => { setVideoId(""); setVideoName(""); }}
                askText={askText} onAskTextChange={setAskText}
                onAskSubmit={askTrainer}
                saveState={saveState} errorMessage={errorMessage}
                onSubmit={submit}
                testid="practice-completion"
              />
            </>
          )}
        </div>

        {(readOnly || !section) && (
          <div className="px-4 sm:px-5 py-3 border-t border-shBorder flex justify-end shrink-0">
            <button onClick={onClose} data-testid="practice-panel-done"
                    className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow">Close</button>
          </div>
        )}
      </div>

      {coachEnabled && (
        <TroubleshootingDrawer
          open={troubleshootingOpen} onClose={() => setTroubleshootingOpen(false)}
          items={practiceCoach?.troubleshooting} tokens={tokens}
          onAskTrainer={() => { setTroubleshootingOpen(false); if (viewMode !== "form") { setEntryContext("quick"); setViewMode("form"); } }}
          testid="coach-troubleshooting"
        />
      )}
    </div>
  );
}
