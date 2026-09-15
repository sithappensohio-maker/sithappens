/* Stage 11 — the trainer's day, one ordered queue.
 *
 * Renders the items from GET /admin/training/day grouped into NEEDS ATTENTION
 * → TODAY'S TRAINING → CONTINUE → UPCOMING → DONE. Every card shows dog,
 * client, program, current lesson, delivery mode, state, TODAY (why it is
 * here), NEXT (what to do) and ONE primary action; secondary actions sit in
 * a small row underneath. This component makes no requests of its own —
 * the screen loads the queue once and reloads it after every action. */
import Avatar from "../Avatar";
import { SECTIONS, ACTION_LABELS, groupTrainerDay, actionableCount, contextLine, modeLabel, waitedLabel, emptyStateCopy, needsAssignmentCount } from "../../lib/trainerDay";

const TONE = {
  accent: { eyebrow: "text-shAccent", dot: "bg-shAccent" },
  primary: { eyebrow: "text-shPrimary", dot: "bg-shPrimary" },
  secondary: { eyebrow: "text-shSecondary", dot: "bg-shSecondary" },
  muted: { eyebrow: "text-shTextMuted", dot: "bg-shTextMuted" },
};

const STATE_TONE = {
  needs_attention: "text-shAccent border-shAccent/40 bg-shAccent/10",
  today: "text-shPrimary border-shPrimary/40 bg-shPrimary/10",
  continue: "text-shSecondary border-shSecondary/40 bg-shSecondary/10",
  upcoming: "text-shTextMuted border-shBorder bg-black/20",
  done: "text-shTextMuted border-shBorder bg-black/20",
};

const FLAG_LABELS = {
  unassigned: "No trainer assigned",
  client_question: "Client question",
  media_awaiting_review: "Video to review",
  needs_reassessment: "Skill flagged for reassessment",
};

export function TrainerDayCard({ item, onAction, compact = false, trainers = [], canAssignTrainer = false, onAssignTrainer, assignedTrainerId = null, canOpenDog = true, focused = false }) {
  // Stage 12 — the owner sees WHO owns each piece of work (from the assignment the item carries)
  const ownerName = canAssignTrainer && item.assigned_trainer_id ? (trainers.find((t) => t.id === item.assigned_trainer_id)?.name || null) : null;
  // Stage 11.5 — the Staff Portal has no dog screen to jump to; never show a button that does nothing.
  const secondary = (item.secondary || []).filter((a) => canOpenDog || a.kind !== "open_dog");
  const context = contextLine(item);
  const mode = modeLabel(item.delivery_mode);
  const waited = item.section === "needs_attention" ? waitedLabel(item.since) : null;
  const stateCls = STATE_TONE[item.section] || STATE_TONE.today;
  const done = item.section === "done";
  return (
    <article className={`rounded-2xl border ${done ? "border-shBorder/50 bg-black/10" : "border-shBorder bg-[var(--sh-card-base)]"} p-3.5 sm:p-4 ${focused ? "ring-2 ring-shPrimary ring-offset-2 ring-offset-bgBase" : ""}`}
             data-testid={`day-item-${item.key}`} data-kind={item.kind} data-section={item.section} data-mine={item.mine === false ? "0" : "1"} data-focused={focused ? "1" : undefined}>
      <div className="flex items-start gap-3">
        <Avatar src={item.dog?.photo} icon="fa-paw" size="md" alt={item.dog?.name || "Dog"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`text-[17px] font-black leading-tight ${done ? "text-shTextMuted" : "text-shText"}`} data-testid="day-item-dog">{item.dog?.name || "Dog"}
                {item.client?.name && <span className="text-[14px] font-medium text-shTextMuted"> · {item.client.name}</span>}
              </p>
              {context && <p className="text-[13px] text-shTextMuted mt-0.5 leading-snug" data-testid="day-item-context">{context}</p>}
            </div>
            {item.time && !done && <span className="shrink-0 text-[12px] font-black tabular-nums text-shTextMuted" data-testid="day-item-time">{item.time}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-black uppercase tracking-wide ${stateCls}`} data-testid="day-item-state">{item.state}</span>
            {mode && <span className="rounded-full border border-shBorder px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-shTextMuted" data-testid="day-item-mode">{mode}</span>}
            {waited && <span className="text-[11px] font-bold text-shTextMuted" data-testid="day-item-waited">{waited}</span>}
            {ownerName && <span className="rounded-full border border-shBorder px-2 py-0.5 text-[11px] font-bold text-shTextMuted" data-testid="day-item-trainer"><i className="fas fa-user mr-1" aria-hidden="true" />{ownerName}</span>}
            {(item.flags || []).map((f) => FLAG_LABELS[f] && (
              <span key={f} className="rounded-full border border-shSecondary/35 bg-shSecondary/10 px-2 py-0.5 text-[11px] font-bold text-shSecondary" data-testid={`day-item-flag-${f}`}>{FLAG_LABELS[f]}</span>
            ))}
          </div>
        </div>
      </div>

      {compact && done && item.today_line && (
        <p className="mt-2 text-[13px] text-shTextMuted leading-snug" data-testid="day-item-today">{item.today_line}</p>
      )}
      {!compact && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
          <dt className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted pt-0.5">Today</dt>
          <dd className="text-shText leading-snug" data-testid="day-item-today">{item.today_line || "—"}</dd>
          <dt className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted pt-0.5">Next</dt>
          <dd className={`leading-snug ${done ? "text-shTextMuted" : "text-shText font-bold"}`} data-testid="day-item-next">{item.next_line || "—"}</dd>
        </dl>
      )}

      {(item.action || !done) && <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        {item.action ? (
          <button type="button" onClick={() => onAction?.(item.action, item)} data-testid="day-item-action" data-action-kind={item.action.kind}
                  className={`min-h-[48px] px-4 rounded-xl font-black text-[13px] uppercase tracking-widest inline-flex items-center justify-center gap-2 transition ${done
                    ? "border border-shBorder text-shTextMuted hover:text-shText"
                    : "bg-shPrimary text-bgHeader shadow hover:brightness-110"}`}>
            {item.action.label || ACTION_LABELS[item.action.kind] || "Open"}<i className="fas fa-arrow-right text-[12px]" aria-hidden="true" />
          </button>
        ) : (
          <p className="text-[13px] text-shTextMuted rounded-xl border border-dashed border-shBorder px-3 py-2" data-testid="day-item-no-action">{item.no_action_reason || "Nothing to do right now."}</p>
        )}
        {(secondary.length > 0 || (canAssignTrainer && item.kind !== "upcoming_booking" && item.action?.target?.booking_id)) && (
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            {secondary.map((a) => (
              <button key={a.kind} type="button" onClick={() => onAction?.(a, item)} data-testid={`day-item-secondary-${a.kind}`}
                      className="min-h-[40px] px-3 rounded-lg border border-shBorder text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText hover:border-shSecondary/45">
                {a.label || ACTION_LABELS[a.kind] || a.kind}
              </button>
            ))}
            {canAssignTrainer && item.kind !== "upcoming_booking" && item.action?.target?.booking_id && (
              <select value={assignedTrainerId || ""} onChange={(e) => onAssignTrainer?.(item, e.target.value || null)} data-testid="day-item-assign-trainer"
                      className="min-h-[40px] max-w-[190px] bg-black/20 border border-shBorder rounded-lg px-2 text-[12px] font-bold text-shText">
                <option value="">Assign trainer…</option>
                {trainers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
        )}
      </div>}
    </article>
  );
}

export default function TrainerDayQueue({ day, loading = false, mineOnly = false, onToggleMine, onAction, trainers = [], canAssignTrainer = false, onAssignTrainer, assignedTrainerFor, canOpenDog = true, focusKey = null, heading = "Your day", needsAssignmentOnly = false, onToggleNeedsAssignment }) {
  const items = day?.items || [];
  const sections = groupTrainerDay(items, { mineOnly, needsAssignmentOnly });
  const actionable = actionableCount(items, { mineOnly });
  // Stage 12 — unowned work is the owner's to hand out; a trainer never sees this control
  const unowned = canAssignTrainer ? needsAssignmentCount(items) : 0;
  const upcomingCount = (day?.counts?.upcoming) || items.filter((it) => it.section === "upcoming").length;
  const empty = !loading && actionable === 0;

  return (
    <section className="space-y-4" data-testid="trainer-day-queue" data-actionable={actionable}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-[13px] font-black uppercase tracking-widest text-shText"><i className="fas fa-sun mr-1.5 text-shPrimary" aria-hidden="true" />{heading}</p>
          <p className="text-[13px] text-shTextMuted" data-testid="trainer-day-summary">
            {loading ? "Loading…" : actionable === 0 ? "Nothing waiting on you." : `${actionable} thing${actionable === 1 ? "" : "s"} need${actionable === 1 ? "s" : ""} you today.`}
            {!loading && unowned > 0 && <span data-testid="trainer-day-unowned"> · {unowned} need{unowned === 1 ? "s" : ""} a trainer</span>}
          </p>
        </div>
        {canAssignTrainer && onToggleNeedsAssignment && (
          <button type="button" onClick={() => onToggleNeedsAssignment(!needsAssignmentOnly)} aria-pressed={needsAssignmentOnly} data-testid="trainer-day-needs-assignment"
                  className={`min-h-[40px] px-3 rounded-lg border text-[12px] font-black uppercase tracking-widest ${needsAssignmentOnly ? "border-shAccent bg-shAccent/15 text-shAccent" : unowned > 0 ? "border-shAccent/50 text-shAccent" : "border-shBorder text-shTextMuted"}`}>
            <i className="fas fa-user-plus mr-1.5" aria-hidden="true" />Needs assignment · {unowned}
          </button>
        )}
        {onToggleMine && (
          <div className="inline-flex rounded-lg border border-shBorder overflow-hidden" role="group" aria-label="Whose work to show">
            <button type="button" onClick={() => onToggleMine(true)} aria-pressed={mineOnly} data-testid="trainer-day-mine"
                    className={`min-h-[40px] px-3 text-[12px] font-black uppercase tracking-widest ${mineOnly ? "bg-shPrimary/20 text-shPrimary" : "text-shTextMuted"}`}>My work</button>
            <button type="button" onClick={() => onToggleMine(false)} aria-pressed={!mineOnly} data-testid="trainer-day-all"
                    className={`min-h-[40px] px-3 text-[12px] font-black uppercase tracking-widest ${!mineOnly ? "bg-shPrimary/20 text-shPrimary" : "text-shTextMuted"}`}>Everyone</button>
          </div>
        )}
      </div>

      {loading && <p className="p-6 text-center text-shTextMuted text-sm" data-testid="trainer-day-loading"><i className="fas fa-spinner fa-spin mr-2" aria-hidden="true" />Loading your day…</p>}

      {!loading && needsAssignmentOnly && unowned === 0 && (
        <p className="rounded-xl border border-dashed border-shBorder px-4 py-3 text-[14px] text-shTextMuted" data-testid="trainer-day-needs-assignment-empty">Every piece of training work has a trainer.</p>
      )}
      {empty && !needsAssignmentOnly && (() => { const c = emptyStateCopy({ upcomingCount, mineOnly }); return (
        <div className="rounded-2xl border border-shPrimary/35 bg-shPrimary/[0.06] p-5" data-testid="trainer-day-empty">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-shPrimary"><i className="fas fa-circle-check mr-1.5" aria-hidden="true" />All clear</p>
          <h2 className="text-[20px] font-black text-shText mt-0.5">{c.title}</h2>
          <p className="text-[15px] text-shText mt-1">{c.body}</p>
          {c.upcoming && <p className="text-[13px] text-shTextMuted mt-1" data-testid="trainer-day-empty-upcoming">{c.upcoming}</p>}
        </div>
      ); })()}

      {!loading && sections.map((s) => {
        const tone = TONE[s.tone] || TONE.muted;
        const quiet = s.key === "upcoming" || s.key === "done";
        return (
          <div key={s.key} data-testid={`day-section-${s.key}`} data-count={s.items.length}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <p className={`text-[12px] font-black uppercase tracking-[0.18em] ${tone.eyebrow}`}><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${tone.dot}`} aria-hidden="true" />{s.title} · {s.items.length}</p>
              <p className="text-[12px] text-shTextMuted">{s.hint}</p>
            </div>
            <div className="space-y-2">
              {s.items.map((it) => (
                <TrainerDayCard key={it.key} item={it} onAction={onAction} compact={quiet} canOpenDog={canOpenDog} focused={!!focusKey && it.key === focusKey}
                                trainers={trainers} canAssignTrainer={canAssignTrainer && !quiet} onAssignTrainer={onAssignTrainer}
                                assignedTrainerId={assignedTrainerFor ? assignedTrainerFor(it) : null} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
