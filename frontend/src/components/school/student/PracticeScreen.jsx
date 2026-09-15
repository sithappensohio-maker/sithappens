import { useState } from "react";
import { practiceBuckets, practiceCardModel, PracticeGroup, PracticeAssignmentCard } from "./practice/PracticeCards";
import { primaryPractice, practiceRowStatus, practiceProgressLabel, practiceEmptyState, practiceTitle } from "../../../lib/practiceState";
import EmptyState from "../../training/EmptyState";

/* Practice — the fourth primary destination.
 *
 * Stage 4 of the clarity pass makes it answer ONE question first: "what
 * should I do today?"
 *
 *   DO THIS TODAY      one rich card + one obvious button
 *   MORE PRACTICE      other open work, compact
 *   DONE FOR TODAY     satisfied required Practice, compact
 *   RECENTLY COMPLETED history, loaded on demand, small pages
 *
 * Selection never invents a priority of its own: the primary item is the
 * row Today's NOW already points at (journey.now.practice — the existing
 * current-action engine), else the same urgency buckets this screen always
 * used (overdue → due → server-recommended → open). The Practice COACH is
 * the canonical engine and is untouched; every button hands off to it.
 * All data comes from the home view-model; history arrives through the
 * shell (onLoadHistory) so this screen stays a pure presentation.
 */

const STATUS_WORDS = {
  overdue: "Still to do",
  due: "Due today",
  recommended: "Up next",
  open: "Ready when you are",
};

function Meta({ items }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return null;
  return (
    <p className="text-[15px] text-shTextMuted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {list.map((it, i) => <span key={i}><i className={`fas ${it.icon} mr-1.5 opacity-70`} aria-hidden="true" />{it.text}</span>)}
    </p>
  );
}

/* ------------------------------------------------------------- Do this today */
function PrimaryPracticeCard({ pick, home, onOpen, onOpenLesson, onPrimaryAction }) {
  if (!pick) return null;
  if (pick.kind === "locked") {
    const p = pick.practice;
    return (
      <section className="rounded-3xl border border-shSecondary/40 bg-gradient-to-br from-shSecondary/[0.10] via-black/18 to-shPrimary/[0.04] p-4 sm:p-6" data-testid="practice-today" data-practice-kind="locked">
        <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shSecondary"><i className="fas fa-lock mr-1.5" aria-hidden="true" />Finish the lesson first</p>
        <h2 className="text-[24px] sm:text-[30px] font-black text-shText leading-tight mt-1 text-balance">{p?.title || "Your Practice"}</h2>
        <p className="text-[17px] text-shText mt-1.5 leading-snug">This Practice unlocks after you finish the lesson instructions in the app.</p>
        {p?.note && <p className="text-[15px] text-shTextMuted mt-2 leading-relaxed"><span className="font-black text-shText">Trainer note:</span> {p.note}</p>}
        {onOpenLesson && home?.current_lesson?.id && (
          <button type="button" onClick={() => onOpenLesson(home.current_lesson.id)} data-testid="practice-primary-action" data-primary-action="true"
                  className="mt-3.5 w-full min-h-[54px] rounded-xl bg-shPrimary text-[#071018] font-black text-[17px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_12px_34px_-12px_rgba(140,198,63,0.8)]">
            Continue lesson<i className="fas fa-arrow-right text-[14px]" aria-hidden="true" />
          </button>
        )}
      </section>
    );
  }

  const hw = pick.hw;
  const m = practiceCardModel(hw);
  const st = practiceRowStatus(hw);
  const progress = practiceProgressLabel(hw);
  const review = st.status === "waiting_review";
  const redo = st.status === "needs_redo";
  const started = st.status === "in_progress" && !redo;
  const eyebrow = review ? "Waiting for trainer review"
    : redo ? "Your trainer asked for another try"
    : pick.reason === "overdue" ? "Still to do"
    : pick.reason === "remediation" ? "Your trainer's plan"
    : "Do this today";
  const ctaLabel = review ? null : redo ? "Try again" : started ? "Continue Practice" : "Start Practice";
  const dueNote = pick.reason === "overdue" ? "This Practice was planned for earlier. You can complete it now."
    : pick.reason === "due" ? "Planned for today."
    : null;
  const meta = [
    m.timeLabel ? { icon: "fa-stopwatch", text: m.timeLabel } : null,
    progress ? { icon: "fa-list-check", text: progress } : null,
    hw.session_linked ? { icon: "fa-person-chalkboard", text: "From your last lesson" } : hw.assigned_by_trainer ? { icon: "fa-person-chalkboard", text: "Trainer assigned" } : null,
    hw.is_optional ? { icon: "fa-star", text: "Optional extra work" } : null,
  ];

  return (
    <section className="rounded-3xl border border-shPrimary/40 bg-gradient-to-br from-shPrimary/[0.11] via-black/18 to-shSecondary/[0.055] p-4 sm:p-6"
             data-testid="practice-today" data-practice-id={hw.id} data-practice-kind={review ? "review" : redo ? "redo" : started ? "continue" : "start"}>
      <p className={`text-[13px] font-black uppercase tracking-[0.2em] ${review ? "text-shSecondary" : pick.reason === "overdue" || redo ? "text-shAccent" : "text-shPrimary"}`}>
        <i className={`fas ${review ? "fa-hourglass-half" : redo ? "fa-rotate-left" : "fa-location-arrow"} mr-1.5`} aria-hidden="true" />{eyebrow}
      </p>
      <h2 className="text-[24px] sm:text-[30px] font-black text-shText leading-tight mt-1 text-balance" data-testid="practice-today-title">{m.title}</h2>
      {m.focus && <p className="text-[17px] text-shText mt-1.5 leading-snug" data-testid="practice-today-focus">{m.focus}</p>}
      <Meta items={meta} />
      {dueNote && <p className="text-[15px] text-shTextMuted mt-2" data-testid="practice-today-due">{dueNote}</p>}
      {m.trainerNote && (
        <p className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-[15px] text-shTextMuted leading-relaxed" data-testid="practice-today-note">
          <span className="font-black text-shText">Trainer note:</span> {m.trainerNote}
        </p>
      )}
      {review ? (
        <p className="mt-3.5 rounded-xl border border-shSecondary/30 bg-shSecondary/[0.08] px-3.5 py-3 text-[16px] font-black text-shText" data-testid="practice-today-review">
          <i className="fas fa-hourglass-half text-shSecondary mr-2" aria-hidden="true" />Submitted — your trainer will review it. Nothing to resend.
        </p>
      ) : (
        <button type="button" onClick={() => onOpen?.(hw)} data-testid="practice-primary-action" data-primary-action="true"
                className="mt-3.5 w-full min-h-[54px] rounded-xl bg-shPrimary text-[#071018] font-black text-[17px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_12px_34px_-12px_rgba(140,198,63,0.8)]">
          {ctaLabel}<i className="fas fa-arrow-right text-[14px]" aria-hidden="true" />
        </button>
      )}
      {pick.reason === "remediation" && home?.current_action?.type === "remediation" && onPrimaryAction && (
        <p className="text-[14px] text-shTextMuted mt-2.5">{home.current_action.sublabel}</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ compact rows */
function CompactRow({ hw, state, onOpen, testid }) {
  const m = practiceCardModel(hw);
  const st = practiceRowStatus(hw);
  const progress = practiceProgressLabel(hw);
  const done = state === "done";
  const completed = state === "completed";
  const word = completed ? (hw.completed_at ? `Completed ${String(hw.completed_at).slice(0, 10)}` : "Completed")
    : done ? (m.logged ? m.logged.title : "Logged today")
    : st.status === "waiting_review" ? "Waiting for trainer review"
    : st.status === "needs_redo" ? "Trainer asked for another try"
    : hw.is_optional ? "Optional extra work"
    : STATUS_WORDS[state] || STATUS_WORDS.open;
  const icon = completed || done ? "fa-circle-check" : st.status === "waiting_review" ? "fa-hourglass-half" : state === "overdue" ? "fa-clock" : "fa-paw";
  const bits = [m.timeLabel, progress, hw.session_linked ? "From your last lesson" : hw.assigned_by_trainer && !completed ? "Trainer assigned" : null].filter(Boolean);
  const Tag = onOpen && !completed ? "button" : "div";
  return (
    <Tag type={onOpen && !completed ? "button" : undefined} onClick={onOpen && !completed ? () => onOpen(hw) : undefined}
         aria-label={onOpen && !completed ? `${done ? "Practice again" : "Start Practice"}: ${m.title}` : undefined}
         data-testid={testid || `practice-card-${hw.id}`} data-state={state}
         className={`w-full text-left rounded-2xl border px-3.5 py-3 flex items-center gap-3 min-h-[56px] ${onOpen && !completed ? "hover:border-shSecondary/40 transition" : ""} ${state === "overdue" ? "border-shAccent/30 bg-shAccent/[0.04]" : "border-shBorder/50 bg-[var(--sh-card-base)]"}`}>
      <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 border text-[14px] ${completed || done ? "text-shPrimary border-shPrimary/35 bg-shPrimary/[0.07]" : state === "overdue" ? "text-shAccent border-shAccent/40 bg-shAccent/10" : "text-shSecondary border-shSecondary/35 bg-shSecondary/10"}`} aria-hidden="true">
        <i className={`fas ${icon}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-black text-shText truncate">{m.title}</span>
        <span className="block text-[14px] text-shTextMuted mt-0.5 truncate">{[word, ...bits].join(" · ")}</span>
      </span>
      {onOpen && !completed && <i className={`fas ${done ? "fa-rotate" : "fa-chevron-right"} text-[13px] text-shTextMuted shrink-0`} aria-hidden="true" />}
    </Tag>
  );
}

function CompactGroup({ title, items, state, onOpen, testid, hint }) {
  if (!items?.length) return null;
  return (
    <section data-testid={testid} className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] font-black uppercase tracking-[0.18em] text-shTextMuted">{title}</p>
        {hint && <p className="text-[13px] text-shTextMuted">{hint}</p>}
      </div>
      {items.map((hw) => <CompactRow key={hw.id} hw={hw} state={state} onOpen={onOpen} />)}
    </section>
  );
}

/* ---------------------------------------------------------------- screen */
export default function PracticeScreen({ home, loading, onOpenPractice, onPrimaryAction, onOpenLesson, onGoCourse, history = null, onLoadHistory }) {
  const [historyBusy, setHistoryBusy] = useState(false);
  if (loading && !home) {
    return (
      <div className="space-y-3" data-testid="practice-screen-loading">
        <div className="h-8 w-40 rounded bg-shBorder/40 animate-pulse" />
        <div className="h-40 rounded-3xl bg-shBorder/25 animate-pulse" />
        <div className="h-16 rounded-2xl bg-shBorder/20 animate-pulse" />
      </div>
    );
  }
  if (!home) return null;

  const all = home.active_practice || [];
  const action = home.current_action;
  const practiceIsNext = action?.type === "practice";
  // The server already decided what comes next; this screen only labels it.
  const recommendedId = (practiceIsNext ? (action?.target?.homework_id || action?.target?.practice_id || null) : null)
    || home.journey?.now?.practice?.id || null;
  const b = practiceBuckets(all, { recommendedId });
  const pick = primaryPractice(home, b);
  const primaryId = pick?.hw?.id || null;
  const notPrimary = (rows) => rows.filter((hw) => hw.id !== primaryId);
  const more = [...notPrimary(b.overdue).map((hw) => ({ hw, state: "overdue" })), ...notPrimary(b.due).map((hw) => ({ hw, state: "due" })),
                ...notPrimary(b.recommended).map((hw) => ({ hw, state: "recommended" })), ...notPrimary(b.upcoming).map((hw) => ({ hw, state: "open" }))];
  const dogName = home.dog?.name;
  const next = home.journey?.next;
  const empty = !pick && more.length === 0 && b.done.length === 0 ? practiceEmptyState(home) : null;
  const doneForToday = !pick && more.length === 0 && b.done.length > 0;
  const completedRows = history?.items || b.completed;
  const historyTotal = history?.total ?? null;
  const canLoadMore = !!onLoadHistory && (history === null || (historyTotal != null && completedRows.length < historyTotal));

  const loadMore = async () => {
    if (!onLoadHistory || historyBusy) return;
    setHistoryBusy(true);
    try { await onLoadHistory(); } finally { setHistoryBusy(false); }
  };

  return (
    <div className="space-y-5" data-testid="practice-screen" data-practice-primary={primaryId || ""}>
      <header>
        <h1 className="text-shText font-black text-[22px] sm:text-[26px] leading-tight">Practice</h1>
        <p className="text-[16px] text-shTextMuted mt-0.5 leading-relaxed" data-testid="practice-intro">
          {pick ? `Short reps between lessons are what make it stick${dogName ? ` for ${dogName}` : ""}.`
            : doneForToday ? "Today's Practice is logged. Practice again any time if you want more reps."
            : empty?.intro || "Nothing outstanding right now."}
        </p>
      </header>

      {/* ------------------------------------------------- DO THIS TODAY */}
      <PrimaryPracticeCard pick={pick} home={home} onOpen={onOpenPractice} onOpenLesson={onOpenLesson} onPrimaryAction={onPrimaryAction} />

      {/* ------------------------------------------------ DONE FOR TODAY (hero form) */}
      {doneForToday && (
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.10] via-black/15 to-shSecondary/[0.05] p-4 sm:p-6" data-testid="practice-tab-done-for-today">
          <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary"><i className="fas fa-circle-check mr-1.5" aria-hidden="true" />You're done for today</p>
          <h2 className="text-[24px] sm:text-[30px] font-black text-shText leading-tight mt-1">Nice work.</h2>
          {next?.title && (
            <p className="text-[17px] text-shText mt-1.5 leading-snug" data-testid="practice-done-next">
              <span className="font-black">Next:</span> {next.title}{next.body ? ` — ${next.body}` : ""}
            </p>
          )}
        </section>
      )}

      {/* ------------------------------------------------- MORE PRACTICE */}
      {more.length > 0 && (
        <section data-testid="practice-group-upcoming" className="space-y-2">
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-shTextMuted">More Practice</p>
          {more.map(({ hw, state }) => <CompactRow key={hw.id} hw={hw} state={state} onOpen={onOpenPractice} />)}
        </section>
      )}

      {/* ------------------------------------------------ DONE FOR TODAY (rows) */}
      <CompactGroup testid="practice-group-done" title="Done for today" state="done" items={b.done}
                    hint="Practice again any time" onOpen={onOpenPractice} />

      {/* --------------------------------------------- RECENTLY COMPLETED */}
      {(completedRows.length > 0 || canLoadMore) && (
        <section data-testid="practice-group-completed" className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[12px] font-black uppercase tracking-[0.18em] text-shTextMuted">Recently completed</p>
            {historyTotal != null && <p className="text-[13px] text-shTextMuted" data-testid="practice-history-total">{historyTotal} total</p>}
          </div>
          {completedRows.map((hw) => <CompactRow key={hw.id} hw={hw} state="completed" />)}
          {canLoadMore && (
            <button type="button" onClick={loadMore} disabled={historyBusy} data-testid="practice-history-more"
                    className="min-h-[44px] px-1 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText disabled:opacity-60">
              {historyBusy ? "Loading…" : history === null ? "View older Practice" : "Load more"} <i className="fas fa-chevron-right ml-1 text-[11px]" aria-hidden="true" />
            </button>
          )}
        </section>
      )}

      {/* ------------------------------------------------------- EMPTY */}
      {empty && (
        <section className="rounded-3xl border border-shBorder/60 bg-[var(--sh-card-base)] p-5 sm:p-6" data-testid="practice-empty" data-empty-kind={empty.kind}>
          <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shSecondary"><i className={`fas ${empty.icon} mr-1.5`} aria-hidden="true" />{empty.eyebrow}</p>
          <h2 className="text-[22px] sm:text-[26px] font-black text-shText leading-tight mt-1">{empty.title}</h2>
          <p className="text-[16px] text-shTextMuted mt-1.5 leading-relaxed">{empty.body}</p>
          {empty.cta === "course" && onGoCourse && (
            <button type="button" onClick={onGoCourse} data-testid="practice-empty-course"
                    className="mt-3.5 min-h-[48px] px-5 rounded-xl bg-shPrimary text-[#071018] font-black text-[15px] uppercase tracking-widest inline-flex items-center gap-2 hover:brightness-110 transition">
              Go to Course<i className="fas fa-arrow-right text-[13px]" aria-hidden="true" />
            </button>
          )}
        </section>
      )}
    </div>
  );
}

// Kept exported for the trainer-facing/legacy consumers of the group + card.
export { PracticeGroup, PracticeAssignmentCard, practiceTitle };
