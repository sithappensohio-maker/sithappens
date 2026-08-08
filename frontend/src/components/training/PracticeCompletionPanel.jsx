// Practice completion form. Capability flags/API semantics are unchanged;
// layout is now more readable on desktop and thumb-friendly on phones.
import DifficultySelector from "./DifficultySelector";
import PracticeMediaUploader from "./PracticeMediaUploader";
import PremiumButton from "../premium/PremiumButton";
import SectionCard from "../premium/SectionCard";

export default function PracticeCompletionPanel({
  allowDifficulty = true,
  allowCouldNotComplete = true,
  allowPhoto = true,
  allowVideo = true,
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
  submitLabel = "Finish Practice",
  testid,
}) {
  return (
    <div className="space-y-4 sm:space-y-5" data-testid={testid}>
      {fieldsSlot && <SectionCard accent="cyan" intensity="subtle"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-shSecondary mb-3">What happened today?</p>{fieldsSlot}</SectionCard>}
      {extraSlot}

      {allowDifficulty && (
        <SectionCard accent="lime" intensity="subtle">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shPrimary mb-1">How did it go?</p>
          <p className="text-[12px] text-shTextMuted mb-3">Pick the one that best matches this session.</p>
          <DifficultySelector value={difficulty} onChange={onDifficultyChange} testid={testid ? `${testid}-difficulty` : undefined}/>
          {difficultyFeedbackSlot && <div className="mt-3">{difficultyFeedbackSlot}</div>}
        </SectionCard>
      )}

      <SectionCard accent="cyan" intensity="subtle">
        <label className="text-[10px] font-black uppercase tracking-[0.14em] text-shTextMuted">Session note <span className="normal-case tracking-normal font-semibold">(optional)</span></label>
        <textarea value={note || ""} onChange={(e) => onNoteChange(e.target.value)} rows={3}
                  placeholder="Wins, tricky moments, or anything you want to remember…" data-testid={testid ? `${testid}-note` : undefined}
                  className="w-full mt-2 bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-[13px] sm:text-sm min-h-[88px] focus:outline-none focus:border-shSecondary/45 resize-y"/>
      </SectionCard>

      {onAskSubmit && (
        <SectionCard accent="purple" intensity="subtle">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-purple-300 mb-2">Need your trainer?</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={askText || ""} onChange={(e) => onAskTextChange(e.target.value)}
                   placeholder="Ask about this exercise…" data-testid={testid ? `${testid}-ask-input` : undefined}
                   className="flex-1 min-w-0 min-h-[46px] bg-black/20 border border-shBorder/55 rounded-xl px-3 text-shText text-[13px] focus:outline-none focus:border-purple-400/40"/>
            <button type="button" onClick={onAskSubmit} disabled={!askText?.trim()} data-testid={testid ? `${testid}-ask-submit` : undefined}
                    className="min-h-[46px] sm:w-12 rounded-xl bg-purple-500/10 text-purple-300 border border-purple-400/30 grid place-items-center font-black disabled:opacity-40 hover:bg-purple-500/15 transition">
              <i className="fas fa-paper-plane"/><span className="sm:hidden ml-2">Send to trainer</span>
            </button>
          </div>
        </SectionCard>
      )}

      {allowCouldNotComplete && (
        <div className={`rounded-2xl border p-4 transition ${couldNotComplete ? "border-shAccent/35 bg-shAccent/[0.055]" : "border-shBorder/50 bg-black/12"}`}>
          <label className="flex items-center gap-3 text-[13px] text-shText cursor-pointer min-h-[36px]" data-testid={testid ? `${testid}-cnc-toggle` : undefined}>
            <input type="checkbox" checked={!!couldNotComplete} onChange={(e) => onCouldNotCompleteChange(e.target.checked)} className="w-4 h-4 accent-[var(--sh-accent)]"/>
            <span><span className="font-black">Couldn&apos;t complete this today</span><span className="block text-[11px] text-shTextMuted mt-0.5">That&apos;s useful training information, not a failure.</span></span>
          </label>
          {couldNotComplete && (
            <textarea value={couldNotCompleteReason || ""} onChange={(e) => onCouldNotCompleteReasonChange(e.target.value)}
                      rows={2} placeholder="What got in the way? (optional)" data-testid={testid ? `${testid}-cnc-reason` : undefined}
                      className="w-full mt-3 bg-black/20 border border-shAccent/25 rounded-xl p-3 text-shText text-[13px] focus:outline-none focus:border-shAccent/45"/>
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
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
          {saveState === "saved" && <span className="text-[11px] font-black uppercase tracking-[0.12em] text-shPrimary text-center sm:text-left"><i className="fas fa-check mr-1.5"/>Saved</span>}
          <PremiumButton onClick={onSubmit} disabled={saveState === "saving"} data-testid={testid ? `${testid}-submit` : undefined} className="w-full sm:w-auto justify-center min-h-[50px] sm:min-w-[200px]">
            {saveState === "saving" ? <><i className="fas fa-spinner fa-spin"/>Saving…</> : saveState === "error" ? <>Retry</> : <><i className="fas fa-check text-[10px]"/>{submitLabel}</>}
          </PremiumButton>
        </div>
      </div>
    </div>
  );
}
