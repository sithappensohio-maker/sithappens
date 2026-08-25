// Training UI Phase 5 — one visual card per today's training dog. Every
// field comes from /admin/training/today. Trainer Delivery adds Board & Train
// day/slot/closeout metadata to those SAME rows; this component only makes
// that required work obvious to the trainer.
import Avatar from "../Avatar";
import StatusChip from "./StatusChip";
import { resolvePrimaryAction } from "../../lib/trainerDashboardPolish";

const STATUS_META = {
  not_checked_in: { label: "Not Checked In", icon: "fa-clock", tone: "muted" },
  plan_ready: { label: "Plan Ready", icon: "fa-list-check", tone: "primary" },
  in_progress: { label: "In Progress", icon: "fa-person-running", tone: "accent" },
  completed: { label: "Completed", icon: "fa-flag-checkered", tone: "primary" },
  resolution_needed: { label: "Needs Attention", icon: "fa-triangle-exclamation", tone: "danger" },
};

function BoardTrainMeta({ row: r, testid }) {
  if (r.trainer_delivery_kind !== "board_train") return null;
  const slot = String(r.trainer_delivery_slot || "").toUpperCase();
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid={testid ? `${testid}-board-train-meta` : undefined}>
      <span className="rounded-full border border-shSecondary/35 bg-shSecondary/[0.08] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-shSecondary">
        Day {r.trainer_delivery_day || "—"} of {r.trainer_delivery_total_days || "—"}
      </span>
      <span className="rounded-full border border-shPrimary/35 bg-shPrimary/[0.08] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-shPrimary">
        {slot || "Training"}
      </span>
      {slot === "PM" && (
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
          r.trainer_delivery_closeout_complete
            ? "border-shPrimary/35 bg-shPrimary/[0.08] text-shPrimary"
            : "border-shAccent/40 bg-shAccent/[0.08] text-shAccent"
        }`}>
          <i className={`fas ${r.trainer_delivery_closeout_complete ? "fa-circle-check" : "fa-clipboard-list"} mr-1"`}/>
          {r.trainer_delivery_closeout_complete ? "Daily closeout done" : "Closeout required"}
        </span>
      )}
    </div>
  );
}

export default function TrainingDogRow({ row: r, onPrimaryAction, testid }) {
  const sm = STATUS_META[r.session_status] || STATUS_META.not_checked_in;
  const action = resolvePrimaryAction(r);
  const breadcrumb = r.session_status === "resolution_needed"
    ? (r.resolution_reason || "").replace(/_/g, " ")
    : [r.program_name, r.current_module_name, r.current_lesson_name].filter(Boolean).join(" · ");

  return (
    <div className={`border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-3 ${
      r.trainer_delivery_kind === "board_train" ? "bg-shSecondary/[0.035] border-shSecondary/25" : "bg-black/20 border-shBorder"
    }`} data-testid={testid}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar src={r.dog_photo} icon="fa-paw" size="md" alt={r.dog_name}/>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-black text-shText truncate">{r.dog_name}</p>
            <span className="text-shTextMuted text-[13px]">·</span>
            <p className="text-[13px] text-shTextMuted truncate">{r.client_name}</p>
            <span className="text-[12px] text-shTextMuted font-black tabular-nums shrink-0">{r.time || "—"}</span>
          </div>
          <p className={`text-[12px] truncate ${r.session_status === "resolution_needed" ? "text-red-400" : "text-shTextMuted"}`}>
            {breadcrumb || "—"}
          </p>
          {r.recommended_focus?.length > 0 && (
            <p className="text-[12px] text-shSecondary mt-0.5 truncate">Focus: {r.recommended_focus.join(", ")}</p>
          )}
          <BoardTrainMeta row={r} testid={testid}/>
          <div className="flex items-center gap-3 text-[12px] text-shTextMuted mt-1 flex-wrap">
            {r.homework_completion && (
              <span data-testid={testid ? `${testid}-homework` : undefined}><i className="fas fa-graduation-cap mr-1"/>{r.homework_completion.days_completed}/{r.homework_completion.total_days}</span>
            )}
            {r.media_awaiting_review > 0 && (
              <span className="text-shAccent" data-testid={testid ? `${testid}-media` : undefined}><i className="fas fa-video mr-1"/>{r.media_awaiting_review}</span>
            )}
            {r.client_question && (
              <span className="text-shSecondary" title={r.client_question} data-testid={testid ? `${testid}-question` : undefined}><i className="fas fa-comment-dots mr-1"/>Question</span>
            )}
            {r.assigned_trainer && <span className="hidden md:inline">{r.assigned_trainer}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
        <StatusChip icon={sm.icon} label={sm.label} tone={sm.tone} testid={testid ? `${testid}-status` : undefined}/>
        <button onClick={() => onPrimaryAction(action, r)} data-testid={testid ? `${testid}-action` : undefined}
                className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shPrimary/25 whitespace-nowrap">
          {action.label}
        </button>
      </div>
    </div>
  );
}
