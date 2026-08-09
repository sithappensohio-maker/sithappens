/* "Coming up next" — one calm look-ahead, never overwhelming. Only renders when
 * the backend view-model actually knows what's next. */
export default function UpcomingCard({ upcoming }) {
  if (!upcoming || !upcoming.name) return null;
  const isModule = upcoming.kind === "module";
  return (
    <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="upcoming-card">
      <p className="text-[11px] font-black uppercase tracking-[0.28em] text-shTextMuted mb-3">
        <i className="fas fa-forward mr-1.5 text-shSecondary" />Coming up
      </p>
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-9 h-9 rounded-lg grid place-items-center bg-shSecondary/12 text-shSecondary">
          <i className={`fas ${isModule ? "fa-layer-group" : upcoming.checkpoint ? "fa-clipboard-check" : "fa-book-open"}`} />
        </span>
        <div className="min-w-0">
          <p className="text-shText text-[14px] font-bold truncate">{upcoming.name}</p>
          <p className="text-[12px] text-shTextMuted">
            {isModule ? (upcoming.locked ? "Next module — unlocks as you progress" : "Next module")
              : upcoming.checkpoint ? "Next lesson · includes a checkpoint" : "Next lesson"}
          </p>
        </div>
      </div>
    </section>
  );
}
