/* Client School — the Practice destination.
 *
 * Phase 3 of the client redesign. Practice answers one question: "what should
 * I practice today?" — so the page is ordered by urgency rather than laid out
 * as an assignment table.
 *
 * Everything shown is real assignment data from the existing home view-model:
 * no new endpoint, no second Practice store, and no derived "streak" or score
 * the system doesn't actually keep. Opening a card hands off to the canonical
 * Practice Coach exactly as before.
 */
import { Eyebrow } from "../today/TodayCards";
import { todayISO } from "../../../../lib/date";
import { renderPracticeCoachText } from "../../../../lib/practiceCoachPolish";

/* Attention states. Overdue is orange, and orange is used ONLY here — the
   brief is explicit that it must stay an attention colour rather than becoming
   the visual language of the whole screen. */
const STATE = {
  overdue: { label: "Overdue", cls: "text-shAccent border-shAccent/45 bg-shAccent/10", icon: "fa-triangle-exclamation" },
  due: { label: "Due today", cls: "text-shSecondary border-shSecondary/45 bg-shSecondary/10", icon: "fa-clock" },
  recommended: { label: "Recommended next", cls: "text-shPrimary border-shPrimary/40 bg-shPrimary/10", icon: "fa-star" },
  open: { label: "Assigned", cls: "text-shTextMuted border-shBorder bg-black/20", icon: "fa-paw" },
  completed: { label: "Completed", cls: "text-shPrimary border-shPrimary/35 bg-shPrimary/[0.07]", icon: "fa-circle-check" },
};

/** Sort assignments into the four groups the brief asks for, in priority
 *  order. `recommendedId` is the assignment the SERVER already named as the
 *  next best action — this never picks a favourite of its own. */
export function practiceBuckets(list, { recommendedId, today = todayISO() } = {}) {
  const overdue = [], due = [], recommended = [], upcoming = [], completed = [];
  for (const hw of list || []) {
    if (!hw) continue;
    if (hw.status === "completed") { completed.push(hw); continue; }
    const d = hw.due_date || "";
    if (d && d < today) { overdue.push(hw); continue; }
    if (d && d === today) { due.push(hw); continue; }
    if (recommendedId && hw.id === recommendedId) { recommended.push(hw); continue; }
    upcoming.push(hw);
  }
  const byDue = (a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999"));
  return {
    overdue: overdue.sort(byDue),
    due: due.sort(byDue),
    recommended,
    upcoming: upcoming.sort(byDue),
    completed: completed.slice(0, 5),
  };
}

/** Everything a client can honestly be told about one assignment before
 *  opening it. Each field is omitted when the assignment doesn't carry it,
 *  rather than rendered as a blank or a zero. */
export function practiceCardModel(hw, { today = todayISO() } = {}) {
  const pc = hw?.template_snapshot?.practice_coach || null;
  const schedule = pc?.schedule || {};
  /* Authored copy carries {{dog_name}} / {{client_first_name}} tokens. The
     Practice Coach substitutes them; this card must too, or the client reads
     the raw token on the way in. */
  const tokens = { dog_name: hw?.dog_name || "", client_first_name: String(hw?.client_name || "").split(" ")[0] || "" };
  const minutes = Number(hw?.minutes_per_session) || Number(schedule.minutes_per_round) || null;
  const rounds = Number(schedule.rounds_per_day) || null;
  const overdue = !!(hw?.due_date && hw.due_date < today && hw.status !== "completed");
  const days = Number(hw?.total_days) || 0;
  return {
    title: renderPracticeCoachText(hw?.title || "Practice", tokens),
    // The skill this practice belongs to, as the trainer named it.
    focus: renderPracticeCoachText((pc?.goal || hw?.template_snapshot?.description || hw?.instructions || "").trim(), tokens),
    // Approximate time: one round times the number of rounds when the recipe
    // says how many, otherwise just the per-session estimate.
    timeLabel: minutes ? (rounds && rounds > 1 ? `about ${minutes * rounds} min` : `about ${minutes} min`) : null,
    dayLabel: hw?.daily_tracker && days > 0 ? `${days}-day plan` : null,
    trainerNote: renderPracticeCoachText((hw?.trainer_personalized_note || "").trim(), tokens),
    overdue,
    dueLabel: hw?.due_date ? (overdue ? `Was due ${hw.due_date}` : `Due ${hw.due_date}`) : null,
    required: hw?.required !== false,
  };
}

export function PracticeAssignmentCard({ hw, state = "open", onOpen, testid }) {
  const m = practiceCardModel(hw);
  const st = STATE[state] || STATE.open;
  const primary = state === "overdue" || state === "due" || state === "recommended";

  return (
    <article data-testid={testid || `practice-card-${hw.id}`} data-state={state}
             className={`rounded-2xl border p-4 ${state === "overdue" ? "border-shAccent/35 bg-shAccent/[0.035]" : primary ? "border-shBorder/60 bg-[var(--sh-card-base)]" : "border-shBorder/45 bg-black/10"}`}>
      <div className="flex items-start gap-3">
        <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 border text-[12px] ${st.cls}`}>
          <i className={`fas ${st.icon}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[9.5px] font-black uppercase tracking-[0.16em] ${st.cls.split(" ")[0]}`}>{st.label}</p>
          <h3 className="text-[14.5px] font-black text-shText leading-snug mt-0.5 text-balance">{m.title}</h3>
          {m.focus && <p className="text-[12px] text-shTextMuted mt-1.5 leading-relaxed line-clamp-2">{m.focus}</p>}

          {(m.timeLabel || m.dayLabel || m.dueLabel) && (
            <p className="text-[11px] text-shTextMuted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {m.timeLabel && <span><i className="fas fa-stopwatch mr-1 opacity-70" />{m.timeLabel}</span>}
              {m.dayLabel && <span><i className="fas fa-calendar-days mr-1 opacity-70" />{m.dayLabel}</span>}
              {m.dueLabel && <span className={m.overdue ? "text-shAccent font-black" : ""}>{m.dueLabel}</span>}
            </p>
          )}

          {/* Trainer context only when a trainer actually wrote something for
              this client — never a generic filler line. */}
          {m.trainerNote && (
            <p className="mt-2.5 rounded-xl border border-shSecondary/25 bg-shSecondary/[0.05] px-3 py-2 text-[12px] text-shText leading-relaxed"
               data-testid={testid ? `${testid}-trainer-note` : undefined}>
              <i className="fas fa-comment-dots text-shSecondary mr-1.5" />{m.trainerNote}
            </p>
          )}
        </div>
      </div>

      {state !== "completed" && onOpen && (
        <button type="button" onClick={() => onOpen(hw)} data-testid={testid ? `${testid}-start` : `practice-start-${hw.id}`}
                className={`mt-3 w-full min-h-[48px] rounded-xl font-black text-[13.5px] inline-flex items-center justify-center gap-2 transition ${
                  primary ? "bg-shPrimary text-[#071018] hover:brightness-110"
                          : "border border-shBorder text-shText hover:bg-white/[0.03]"}`}>
          <i className="fas fa-play text-[10px]" />Start practice
        </button>
      )}
    </article>
  );
}

export function PracticeGroup({ title, hint, items, state, onOpen, testid }) {
  if (!items?.length) return null;
  return (
    <section data-testid={testid} className="space-y-2.5">
      <div>
        <Eyebrow>{title}</Eyebrow>
        {hint && <p className="text-[12px] text-shTextMuted mt-0.5">{hint}</p>}
      </div>
      {items.map(hw => (
        <PracticeAssignmentCard key={hw.id} hw={hw} state={state} onOpen={onOpen} />
      ))}
    </section>
  );
}
