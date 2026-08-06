// Training UI Phase 3 — the "How did it go?" completion flow. `richMode`
// gates the difficulty/could-not-complete/media controls: daily-tracker
// homework supports all of them (DaySubmitIn already has these fields);
// single-log (section-based) homework only supports field values + a note
// (POST /homework/{id}/section-log has no difficulty/photo/video/could-not-
// complete fields), so this component never renders controls whose value
// would silently go nowhere.
import DifficultySelector from "./DifficultySelector";
import PracticeMediaUploader from "./PracticeMediaUploader";

export default function PracticeCompletionPanel({
  richMode = true,
  fieldsSlot,
  difficulty, onDifficultyChange,
  note, onNoteChange,
  couldNotComplete, onCouldNotCompleteChange,
  couldNotCompleteReason, onCouldNotCompleteReasonChange,
  photo, onPhotoChange, videoId, videoName, onVideoUpload, uploadingVideo, onVideoClear,
  askText, onAskTextChange, onAskSubmit,
  saveState, // "idle" | "saving" | "saved" | "error"
  errorMessage,
  onSubmit,
  submitLabel = "Finish Practice",
  testid,
}) {
  return (
    <div className="space-y-4" data-testid={testid}>
      {fieldsSlot}

      {richMode && (
        <div>
          <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">How did it go?</p>
          <DifficultySelector value={difficulty} onChange={onDifficultyChange} testid={testid ? `${testid}-difficulty` : undefined}/>
        </div>
      )}

      <div>
        <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Note (optional)</label>
        <textarea value={note || ""} onChange={(e) => onNoteChange(e.target.value)} rows={2}
                  placeholder="Anything tricky? Wins? Questions?" data-testid={testid ? `${testid}-note` : undefined}
                  className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
      </div>

      {onAskSubmit && (
        <div className="flex gap-2">
          <input value={askText || ""} onChange={(e) => onAskTextChange(e.target.value)}
                 placeholder="Ask your trainer about this exercise…" data-testid={testid ? `${testid}-ask-input` : undefined}
                 className="flex-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
          <button type="button" onClick={onAskSubmit} disabled={!askText?.trim()} data-testid={testid ? `${testid}-ask-submit` : undefined}
                  className="bg-shSecondary/15 text-shSecondary border border-shSecondary/40 px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-40">
            <i className="fas fa-paper-plane"/>
          </button>
        </div>
      )}

      {richMode && (
        <div className="bg-black/20 border border-shBorder rounded-lg p-3 space-y-2">
          <label className="flex items-center gap-2 text-[13px] text-shText cursor-pointer" data-testid={testid ? `${testid}-cnc-toggle` : undefined}>
            <input type="checkbox" checked={!!couldNotComplete} onChange={(e) => onCouldNotCompleteChange(e.target.checked)}/>
            Couldn&apos;t complete this today
          </label>
          {couldNotComplete && (
            <textarea value={couldNotCompleteReason || ""} onChange={(e) => onCouldNotCompleteReasonChange(e.target.value)}
                      rows={2} placeholder="What got in the way? (optional)" data-testid={testid ? `${testid}-cnc-reason` : undefined}
                      className="w-full bg-transparent border border-shBorder rounded p-2 text-shText text-sm"/>
          )}
        </div>
      )}

      {richMode && (
        <PracticeMediaUploader photo={photo} onPhotoChange={onPhotoChange} videoId={videoId} videoName={videoName}
                                onVideoUpload={onVideoUpload} uploadingVideo={uploadingVideo} onVideoClear={onVideoClear}
                                testid={testid ? `${testid}-media` : undefined}/>
      )}

      {saveState === "error" && (
        <p className="text-shDanger text-[13px] font-bold" data-testid={testid ? `${testid}-error` : undefined}>
          {errorMessage || "Couldn't save — try again."}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        {saveState === "saved" && <span className="text-[12px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-check mr-1"/>Saved</span>}
        <button type="button" onClick={onSubmit} disabled={saveState === "saving"} data-testid={testid ? `${testid}-submit` : undefined}
                className="bg-shPrimary text-bgHeader px-5 py-2.5 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50 shadow">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Retry" : submitLabel}
        </button>
      </div>
    </div>
  );
}
