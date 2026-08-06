// Training UI Phase 5 — simple filter chips for the Trainer Daily Dashboard.
// Filtering itself happens client-side over already-loaded rows
// (filterTrainingRows, lib/trainerDashboardPolish.js) — no new query per filter.
//
// Release-gate correction: there is no real trainer-assignment field in
// this app — "my_dogs" (internal key, unchanged) matches whoever most
// recently wrote a training_session_log entry for that dog, a derived
// proxy shared with the rest of the app (trainer_scorecard, the pipeline
// list's "last trainer"). The visible label and accessible description
// say so explicitly, so this can never be misread as real assignment or
// ownership.
const FILTERS = [
  { key: "all", label: "All" },
  { key: "my_dogs", label: "Recently Trained by Me", title: "Dogs whose most recent training session was logged by you — not a trainer-assignment record." },
  { key: "not_checked_in", label: "Not Checked In" },
  { key: "ready", label: "Ready" },
  { key: "in_progress", label: "In Progress" },
  { key: "needs_review", label: "Needs Review" },
  { key: "completed", label: "Completed" },
];

export default function SessionStatusFilter({ value, onChange, testid }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testid}>
      {FILTERS.map(f => (
        <button key={f.key} onClick={() => onChange(f.key)} data-testid={testid ? `${testid}-${f.key}` : undefined}
                title={f.title} aria-label={f.title ? `${f.label} — ${f.title}` : f.label}
                className={`px-2.5 py-1.5 rounded text-[11px] font-black uppercase tracking-widest border transition ${
                  value === f.key
                    ? "bg-shPrimary text-bgHeader border-shPrimary"
                    : "bg-transparent text-shTextMuted border-shBorder hover:text-shText"
                }`}>
          {f.label}
        </button>
      ))}
    </div>
  );
}
