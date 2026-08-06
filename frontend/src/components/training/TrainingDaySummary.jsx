// Training UI Phase 5 — Trainer Daily Dashboard header metrics. Every
// number is a reduce over rows already fetched for the dashboard below it
// (computeDaySummary, lib/trainerDashboardPolish.js) — no second query.
import StatusChip from "./StatusChip";

export default function TrainingDaySummary({ summary, testid }) {
  const s = summary || {};
  const items = [
    { key: "training", icon: "fa-paw", label: "Training Today", value: s.trainingToday ?? 0, tone: "muted" },
    { key: "checked_in", icon: "fa-clipboard-check", label: "Checked In", value: s.checkedIn ?? 0, tone: "secondary" },
    { key: "plans_ready", icon: "fa-list-check", label: "Plans Ready", value: s.plansReady ?? 0, tone: "primary" },
    { key: "in_progress", icon: "fa-person-running", label: "In Progress", value: s.inProgress ?? 0, tone: "accent" },
    { key: "needs_review", icon: "fa-triangle-exclamation", label: "Needs Review", value: s.needsReview ?? 0, tone: s.needsReview > 0 ? "danger" : "muted" },
    { key: "completed", icon: "fa-flag-checkered", label: "Completed", value: s.completed ?? 0, tone: "primary" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid={testid}>
      {items.map(it => (
        <StatusChip key={it.key} icon={it.icon} label={it.label} value={it.value} tone={it.tone} testid={testid ? `${testid}-${it.key}` : undefined}/>
      ))}
    </div>
  );
}
