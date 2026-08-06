// Training UI Phase 1 — shared video/demo card. Uses the lesson's existing
// demo_video_url (now surfaced on plan activities, see server.py
// _generate_suggested_plan). Clean fallback when no demo exists yet (brief
// safety test 9).
import EmptyState from "./EmptyState";

export default function VideoDemoCard({ videoUrl, label = "Watch Demo", testid }) {
  if (!videoUrl) {
    return (
      <div className="bg-black/20 border border-shBorder rounded-lg" data-testid={testid}>
        <EmptyState icon="fa-video-slash" message="No demo video yet" testid={testid ? `${testid}-empty` : undefined}/>
      </div>
    );
  }
  return (
    <a href={videoUrl} target="_blank" rel="noopener noreferrer" data-testid={testid}
       className="group flex items-center gap-3 bg-black/20 border border-shBorder hover:border-shSecondary rounded-lg p-3 transition">
      <div className="shrink-0 w-11 h-11 rounded-full bg-shSecondary/15 border border-shSecondary/40 grid place-items-center group-hover:bg-shSecondary/25">
        <i className="fas fa-play text-shSecondary text-[14px]"/>
      </div>
      <span className="text-[13px] font-black uppercase tracking-widest text-shSecondary">{label}</span>
    </a>
  );
}
