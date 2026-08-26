// Training UI Phase 5 — simple filter chips for the Trainer Daily Dashboard.
// Filtering itself happens client-side over already-loaded rows
// (filterTrainingRows, lib/trainerDashboardPolish.js) — no new query per filter.
//
// Daily Training Workflow: "my_dogs" is true assignment, keyed to the
// trainer responsible for today's booking (with program assignment fallback).
const FILTERS = [
  { key: "all", label: "All" },
  { key: "my_dogs", label: "My Dogs Today", title: "Dogs assigned to you for today's training." },
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
