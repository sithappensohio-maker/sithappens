// Training UI Phase 3 (extended by the Client Practice Coach upgrade) — the
// "Homework Practice" focused screen. Opens when a client taps an
// assignment card on Client Today. Submits through the EXISTING
// homework-log endpoints only:
//   - daily-tracker assignments -> POST /homework/{id}/day/{n}/submit
//     (field_values, note, mood, difficulty, photo, video_media_id,
//     could_not_complete/reason)
//   - single-log (section-based) assignments -> POST /homework/{id}/section-log
//     (field_values, date, note, and now — see server.py's SectionLogIn —
//     difficulty, could_not_complete/reason, and photo too; video is still
//     daily-tracker only, no section-scoped upload endpoint exists yet)
//
// Client Practice Coach upgrade: when template_snapshot.practice_coach is
// present and enabled, this renders the structured Coach Mode flow
// (CoachPracticeOverview -> GuidedPracticeFlow -> the same completion form,
// now with end_questions + difficulty feedback) INSTEAD of jumping
// straight to the plain completion form — Quick Practice, and every
// legacy template with no practice_coach, keep using exactly the
// pre-existing simple flow below, completely unchanged.
import { useEffect, useState } from "react";
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

const FIELD_ICON = { reps: "fa-rotate", sets: "fa-layer-group", duration_sec: "fa-stopwatch", duration_min: "fa-stopwatch",
  distance_ft: "fa-ruler", success_rate: "fa-percent", rating_5: "fa-star", checkbox: "fa-square-check", text: "fa-pen", longtext: "fa-pen" };
const FIELD_UNIT = { duration_sec: "sec", duration_min: "min", distance_ft: "ft", success_rate: "%", rating_5: "/5" };

export default function PracticePanel({ homework, dogPhoto, onClose, onChanged }) {
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
      const { data } = await api.post(`/homework/${homework.id}/day/${activeDay.day_number}/video`, { photo: dataUrl, filename: file.name });
      setVideoId(data.media_id);
      setVideoName(file.name);
    } catch (e) {
      toast.error("Video upload failed: " + (e.response?.data?.detail || e.message));
    } finally { setUploadingVideo(false); }
  };

  const submit = async () => {
    if (saveState === "saving") return; // guard against double-tap/double-click submits
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
          could_not_complete: couldNotComplete,
          could_not_complete_reason: couldNotComplete ? (couldNotCompleteReason || null) : null,
        });
      }
      setSaveState("saved");
      onChanged?.();
      toast.success("Practice logged");
    } catch (e) {
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
  const finishGuided = (metrics) => { setGuidedMetrics(metrics); setEntryContext("guided_done"); setViewMode("form"); };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4" data-testid="practice-panel">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-4 sm:px-5 py-3.5 border-b border-shBorder flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-shPrimary">{homework.dog_name}</p>
            <h3 className="text-base font-black text-shText uppercase tracking-tight truncate">{homework.title}</h3>
          </div>
          <button onClick={onClose} data-testid="practice-panel-close" className="text-shTextMuted hover:text-shText text-xl px-2 shrink-0"><i className="fas fa-times"/></button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-4 sm:px-5 py-4 space-y-4">
          {!section ? (
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
            <GuidedPracticeFlow
              practiceCoach={practiceCoach} tokens={tokens}
              onOpenTroubleshooting={() => setTroubleshootingOpen(true)}
              onFinish={finishGuided}
              testid="coach-guided"
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-shTextMuted font-bold">
                {estimatedMinutes ? <span><i className="fas fa-clock mr-1"/>{estimatedMinutes} min</span> : null}
              </div>

              {entryContext === "quick" && practiceCoach?.goal && (
                <div className="bg-black/20 border border-shBorder rounded-lg p-2.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-shPrimary">Goal</p>
                  <p className="text-[13px] text-shText font-bold">{renderPracticeCoachText(practiceCoach.goal, tokens)}</p>
                  {(practiceCoach.steps || []).length > 0 && (
                    <p className="text-[11px] text-shTextMuted mt-1">
                      {practiceCoach.steps.map(s => renderPracticeCoachText(s.title, tokens)).join(" · ")}
                    </p>
                  )}
                </div>
              )}
              {entryContext === "guided_done" && guidedMetrics && (
                <div className="bg-shPrimary/10 border border-shPrimary/30 rounded-lg p-2.5 text-center">
                  <p className="text-[12px] font-black text-shText">
                    {guidedMetrics.rounds_completed} round{guidedMetrics.rounds_completed === 1 ? "" : "s"} · {guidedMetrics.successful_reps}/{guidedMetrics.reps_attempted} successful
                  </p>
                </div>
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

              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2"><i className="fas fa-stopwatch mr-1"/>Practice Timer (optional)</p>
                <div className="flex items-center gap-3 bg-black/20 border border-shBorder rounded-lg p-3">
                  <span className="text-2xl font-black text-shText tabular-nums" data-testid="practice-timer-display">
                    {String(Math.floor(timerSec / 60)).padStart(2, "0")}:{String(timerSec % 60).padStart(2, "0")}
                  </span>
                  <button type="button" onClick={() => setTimerRunning(r => !r)} data-testid="practice-timer-toggle"
                          className="bg-shSecondary/15 text-shSecondary border border-shSecondary/40 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest">
                    {timerRunning ? "Pause" : "Start"}
                  </button>
                  <button type="button" onClick={() => { setTimerSec(0); setTimerRunning(false); }} data-testid="practice-timer-reset"
                          className="text-shTextMuted text-[12px] font-black uppercase tracking-widest">Reset</button>
                </div>
              </div>

              <PracticeCompletionPanel
                allowDifficulty={true}
                allowCouldNotComplete={true}
                allowPhoto={true}
                allowVideo={isDailyTracker}
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
              {!isDailyTracker && (
                <button type="button" onClick={markAssignmentComplete} disabled={markingComplete} data-testid="practice-mark-assignment-complete"
                        className="w-full text-center text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shPrimary py-1 disabled:opacity-50">
                  {markingComplete ? "Marking complete…" : "This assignment is fully done — mark complete"}
                </button>
              )}
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
