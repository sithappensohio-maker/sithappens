// Practice completion form. Capability flags/API semantics are unchanged;
// the client gets plain-language guidance and a different wrap-up when Guided
// Practice ended early versus when the planned session was completed.
import DifficultySelector from "./DifficultySelector";
import PracticeMediaUploader from "./PracticeMediaUploader";
import PremiumButton from "../premium/PremiumButton";
import SectionCard from "../premium/SectionCard";

export default function PracticeCompletionPanel({
  allowDifficulty = true,
  allowCouldNotComplete = true,
  allowPhoto = true,
  allowVideo = true,
  stoppedEarly = false,
  fieldsSlot,
  extraSlot,
  difficulty, onDifficultyChange,
  difficultyFeedbackSlot,
  note, onNoteChange,
  couldNotComplete, onCouldNotCompleteChange,
  couldNotCompleteReason, onCouldNotCompleteReasonChange,
  photo, onPhotoChange, videoId, videoName, onVideoUpload, uploadingVideo, onVideoClear,
  askText, onAskTextChange, onAskSubmit,
  saveState,
  errorMessage,
  onSubmit,
  submitLabel = "Save Today's Practice",
  testid,
}) {
  return (
    <div className="space-y-4 sm:space-y-5" data-testid={testid}>
      <section className={`rounded-3xl border p-5 sm:p-6 ${stoppedEarly ? "border-shAccent/35 bg-shAccent/[0.055]" : "border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.08] via-black/15 to-shSecondary/[0.035]"}`} data-testid={testid ? `${testid}-save-guide` : undefined}>
        <p className={`text-[12px] sm:text-[13px] font-black uppercase tracking-[0.12em] ${stoppedEarly ? "text-shAccent" : "text-shPrimary"}`}>Last Step · Save Today&apos;s Session</p>
        <h3 className="text-[19px] sm:text-[23px] font-black text-shText mt-1.5 leading-tight">
          {stoppedEarly ? "You stopped before the planned practice was finished. That's okay — record what happened." : "The training part is done. Now record how it went."}
        </h3>
        <p className="text-[14px] sm:text-[15px] text-shTextMuted mt-2 leading-relaxed max-w-2xl">
          {stoppedEarly
            ? "Do not restart just to make the numbers look better. Save the repetitions you actually completed and tell your trainer what made you stop."
            : "Take about 30 seconds to check the results School tracked, answer the short wrap-up, and save the session."}
        </p>
        <div className="grid gap-2 sm:grid-cols-3 mt-4">
          <div className="rounded-xl border border-shBorder/55 bg-black/15 p-3">
            <p className="text-[12px] sm:text-[13px] font-black uppercase tracking-[0.11em] text-shSecondary">1 · Check the results</p>
            <p className="text-[13.5px] text-shTextMuted mt-1 leading-relaxed">Confirm the rounds, repetitions, time, or other details from what actually happened.</p>
          </div>
          <div className="rounded-xl border border-shBorder/55 bg-black/15 p-3">
            <p className="text-[12px] sm:text-[13px] font-black uppercase tracking-[0.11em] text-shSecondary">2 · Answer the wrap-up</p>
            <p className="text-[13.5px] text-shTextMuted mt-1 leading-relaxed">Choose the answers that come closest to how today really felt.</p>
          </div>
          <div className="rounded-xl border border-shBorder/55 bg-black/15 p-3">
            <p className="text-[12px] sm:text-[13px] font-black uppercase tracking-[0.11em] text-shSecondary">3 · Save & continue</p>
            <p className="text-[13.5px] text-shTextMuted mt-1 leading-relaxed">Tap the green button once. School saves the session and then shows the next training step.</p>
          </div>
        </div>
      </section>

      {fieldsSlot && (
        <SectionCard accent="cyan" intensity="subtle">
          <p className="text-[12px] font-black uppercase tracking-[0.11em] text-shSecondary">Today&apos;s Results</p>
          <p className="text-[14px] text-shTextMuted mt-1 mb-3 leading-relaxed">
            These are about what actually happened today. Guided Practice fills in objective results it already tracked so you do not have to type them again.
          </p>
          {fieldsSlot}
        </SectionCard>
      )}
      {extraSlot}

      {allowDifficulty && (
        <SectionCard accent="lime" intensity="subtle">
          <p className="text-[12px] font-black uppercase tracking-[0.11em] text-shPrimary mb-1">How did today&apos;s practice feel?</p>
          <p className="text-[14px] text-shTextMuted mb-3 leading-relaxed">
            Pick the closest answer. This is different from the success score School tracked — it tells your trainer how manageable the setup felt to you and your dog.
          </p>
          <DifficultySelector value={difficulty} onChange={onDifficultyChange} testid={testid ? `${testid}-difficulty` : undefined}/>
          {difficultyFeedbackSlot && <div className="mt-3">{difficultyFeedbackSlot}</div>}
        </SectionCard>
      )}

      <SectionCard accent="cyan" intensity="subtle">
        <label className="text-[12px] font-black uppercase tracking-[0.11em] text-shTextMuted">Anything your trainer should know? <span className="normal-case tracking-normal font-semibold">(optional)</span></label>
        <p className="text-[13.5px] text-shTextMuted mt-1">Use this for a win, something that was difficult, or anything unusual that happened.</p>
        <textarea value={note || ""} onChange={(e) => onNoteChange(e.target.value)} rows={3}
                  placeholder="Example: The first few repetitions were hard, but it got easier after we moved to a quieter room." data-testid={testid ? `${testid}-note` : undefined}
                  className="w-full mt-2 bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-[15px] sm:text-[16px] min-h-[88px] focus:outline-none focus:border-shSecondary/45 resize-y"/>
      </SectionCard>

      {onAskSubmit && (
        <SectionCard accent="purple" intensity="subtle">
          <p className="text-[12px] font-black uppercase tracking-[0.11em] text-purple-300 mb-1">Need help from your trainer?</p>
          <p className="text-[13.5px] text-shTextMuted mb-2">Ask a question about what happened during this practice.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={askText || ""} onChange={(e) => onAskTextChange(e.target.value)}
                   placeholder="Example: What should I change if my dog keeps looking away?" data-testid={testid ? `${testid}-ask-input` : undefined}
                   className="flex-1 min-w-0 min-h-[46px] bg-black/20 border border-shBorder/55 rounded-xl px-3 text-shText text-[15px] focus:outline-none focus:border-purple-400/40"/>
            <button type="button" onClick={onAskSubmit} disabled={!askText?.trim()} data-testid={testid ? `${testid}-ask-submit` : undefined}
                    className="min-h-[46px] sm:w-12 rounded-xl bg-purple-500/10 text-purple-300 border border-purple-400/30 grid place-items-center font-black disabled:opacity-40 hover:bg-purple-500/15 transition">
              <i className="fas fa-paper-plane"/><span className="sm:hidden ml-2">Send to trainer</span>
            </button>
          </div>
        </SectionCard>
      )}

      {stoppedEarly ? (
        <SectionCard accent="orange" intensity="subtle">
          <label className="text-[12px] font-black uppercase tracking-[0.11em] text-shAccent">What made you stop?</label>
          <p className="text-[13.5px] text-shTextMuted mt-1">A short answer helps your trainer decide whether the next practice should be easier, shorter, or set up differently.</p>
          <textarea value={couldNotCompleteReason || ""} onChange={(e) => onCouldNotCompleteReasonChange(e.target.value)}
                    rows={2} placeholder="Example: My dog stopped taking treats, got distracted, or seemed tired." data-testid={testid ? `${testid}-cnc-reason` : undefined}
                    className="w-full mt-3 bg-black/20 border border-shAccent/25 rounded-xl p-3 text-shText text-[15px] focus:outline-none focus:border-shAccent/45"/>
        </SectionCard>
      ) : allowCouldNotComplete && (
        <div className={`rounded-2xl border p-4 transition ${couldNotComplete ? "border-shAccent/35 bg-shAccent/[0.055]" : "border-shBorder/50 bg-black/12"}`}>
          <label className="flex items-center gap-3 text-[15px] text-shText cursor-pointer min-h-[36px]" data-testid={testid ? `${testid}-cnc-toggle` : undefined}>
            <input type="checkbox" checked={!!couldNotComplete} onChange={(e) => onCouldNotCompleteChange(e.target.checked)} className="w-4 h-4 accent-[var(--sh-accent)]"/>
            <span><span className="font-black">I couldn&apos;t finish the planned practice today</span><span className="block text-[13px] text-shTextMuted mt-0.5">Use this only when you stopped before finishing the plan. That is useful training information, not a failure.</span></span>
          </label>
          {couldNotComplete && (
            <textarea value={couldNotCompleteReason || ""} onChange={(e) => onCouldNotCompleteReasonChange(e.target.value)}
                      rows={2} placeholder="What made you stop? (optional)" data-testid={testid ? `${testid}-cnc-reason` : undefined}
                      className="w-full mt-3 bg-black/20 border border-shAccent/25 rounded-xl p-3 text-shText text-[15px] focus:outline-none focus:border-shAccent/45"/>
          )}
        </div>
      )}

      {allowPhoto && (
        <SectionCard accent="cyan" intensity="subtle">
          <PracticeMediaUploader photo={photo} onPhotoChange={onPhotoChange} videoId={videoId} videoName={videoName}
                                  onVideoUpload={onVideoUpload} uploadingVideo={uploadingVideo} onVideoClear={onVideoClear}
                                  allowVideo={allowVideo} testid={testid ? `${testid}-media` : undefined}/>
        </SectionCard>
      )}

      {saveState === "error" && (
        <p className="text-shDanger text-[13px] font-bold rounded-xl border border-shDanger/25 bg-shDanger/[0.05] p-3" data-testid={testid ? `${testid}-error` : undefined}>
          <i className="fas fa-triangle-exclamation mr-2"/>{errorMessage || "Couldn't save — try again."}
        </p>
      )}

      <div className="sticky bottom-0 -mx-1 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-[var(--sh-card-base)] via-[var(--sh-card-base)]/95 to-transparent">
        <div className="rounded-2xl border border-shPrimary/25 bg-[var(--sh-card-base)]/95 backdrop-blur px-3 py-3 sm:px-4">
          <p className="text-[13.5px] text-shTextMuted text-center sm:text-right mb-2">
            When everything above looks right, save this session. School will keep your history and then show you what comes next.
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
            {saveState === "saved" && <span className="text-[11px] font-black uppercase tracking-[0.12em] text-shPrimary text-center sm:text-left"><i className="fas fa-check mr-1.5"/>Saved</span>}
            <PremiumButton onClick={onSubmit} disabled={saveState === "saving"} data-testid={testid ? `${testid}-submit` : undefined} className="w-full sm:w-auto justify-center min-h-[54px] sm:min-w-[280px]">
              {saveState === "saving" ? <><i className="fas fa-spinner fa-spin"/>Saving Today&apos;s Practice…</> : saveState === "error" ? <>Retry Saving</> : <><i className="fas fa-check text-[10px]"/>{submitLabel}</>}
            </PremiumButton>
          </div>
        </div>
      </div>
    </div>
  );
}
