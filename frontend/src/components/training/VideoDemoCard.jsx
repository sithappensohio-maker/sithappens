// Shared lesson/demo card. Presentation only — still uses the lesson's
// existing demo_video_url and opens the same external target.
import EmptyState from "./EmptyState";

export default function VideoDemoCard({ videoUrl, label = "Watch Demo", testid }) {
  if (!videoUrl) {
    return (
      <div className="rounded-2xl border border-shBorder/55 bg-black/15 overflow-hidden" data-testid={testid}>
        <EmptyState icon="fa-video-slash" message="No demo video yet" testid={testid ? `${testid}-empty` : undefined}/>
      </div>
    );
  }
  return (
    <a href={videoUrl} target="_blank" rel="noopener noreferrer" data-testid={testid}
       className="group relative overflow-hidden flex items-center gap-4 rounded-2xl border border-shSecondary/30 bg-gradient-to-br from-shSecondary/[0.09] via-black/20 to-black/35 p-4 sm:p-5 transition hover:border-shSecondary/55 hover:-translate-y-0.5 shadow-[0_14px_40px_-28px_rgba(0,169,224,0.65)]">
      <div className="absolute -right-12 -top-12 w-36 h-36 rounded-full bg-shSecondary/10 blur-3xl pointer-events-none"/>
      <div className="relative shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-shSecondary/12 border border-shSecondary/35 grid place-items-center group-hover:bg-shSecondary/20 transition">
        <i className="fas fa-play text-shSecondary text-[17px] sm:text-[19px]"/>
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.16em] text-shSecondary/80 mb-1">Demo</p>
        <p className="text-[16px] sm:text-[18px] font-black text-shText leading-tight">{label}</p>
        <p className="text-[11px] sm:text-[12px] text-shTextMuted mt-1">See what a clean rep should look like before you start.</p>
      </div>
      <i className="fas fa-arrow-up-right-from-square relative text-shSecondary/65 text-[11px] shrink-0"/>
    </a>
  );
}
