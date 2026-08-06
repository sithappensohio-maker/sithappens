// Training UI Phase 1 — shared clean fallback for missing media/data
// (brief safety test 9: missing images/videos use a clean fallback).
export default function EmptyState({ icon = "fa-circle-info", message, action, testid }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-center" data-testid={testid}>
      <div className="w-10 h-10 rounded-full bg-shBorder/40 grid place-items-center">
        <i className={`fas ${icon} text-shTextMuted text-[16px]`}/>
      </div>
      <p className="text-[13px] text-shTextMuted">{message}</p>
      {action}
    </div>
  );
}
