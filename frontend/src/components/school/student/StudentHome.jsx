import { useEffect, useState } from "react";
import HandoffPanel from "../../HandoffPanel";
import { api } from "../../../lib/api";
import { greeting, deliveryLabel } from "../../../lib/studentSchool";
import TrainingModeNote from "./TrainingModeNote";
import TrainerCard from "./TrainerCard";
import LatestFeedbackCard from "./LatestFeedbackCard";
import CourseCompletionCard from "./CourseCompletionCard";
import SchoolOrientation, { actionCoachCopy, doThisNowCopy } from "./SchoolOrientation";
import { PracticeCard, NextMilestoneCard, ProgressRow } from "./today/TodayCards";
import { journeyWhen, appointmentLabel, practiceCoveredByJourney, practiceCoveredByRecap, recapMode, recapHeading, JOURNEY_STEP_META } from "./today/journey";

/* Today's command card — the client's training journey in one connected rail:
 *
 *   LAST   what happened most recently (trainer lesson, checkpoint, lesson, Practice)
 *   NOW    the one thing to do right now — THE button (strongest emphasis)
 *   NEXT   what comes after, from real progression state
 *
 * Mobile hierarchy inside NOW, top to bottom: lesson / task name, one plain
 * sentence ("do this now"), THE button, then the fuller explanation and
 * progress. On a 320×568 phone the button is on screen without scrolling past
 * a wall of text. Everything comes from the backend view-model: current_action
 * stays the source of truth for the action, and `home.journey` (derived
 * server-side for THIS dog + program only) supplies the LAST / NEXT copy and
 * the one Practice row NOW refers to. Nothing here decides progression. */
function JourneyStep({ step, eyebrow, children, testid, tone = "muted", connector = true }) {
  const meta = JOURNEY_STEP_META[step];
  const strong = tone === "strong";
  return (
    <div className="relative flex gap-2.5 sm:gap-3" data-testid={testid} data-journey-step={step}>
      <div className="flex flex-col items-center shrink-0 w-8 sm:w-9">
        <span className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full grid place-items-center border text-[13px] ${strong
          ? "bg-shPrimary text-[#071018] border-shPrimary shadow-[0_0_18px_-4px_rgba(140,198,63,0.9)]"
          : "bg-black/25 text-shSecondary border-shSecondary/40"}`} aria-hidden="true">
          <i className={`fas ${meta.icon}`} />
        </span>
        {connector && <span className="flex-1 w-px min-h-[18px] bg-gradient-to-b from-shSecondary/50 to-shSecondary/10 my-1" aria-hidden="true" />}
      </div>
      <div className={`sh-journey-step-body min-w-0 flex-1 ${connector ? "pb-4" : ""}`}>
        <p className={`text-[12px] font-black uppercase tracking-[0.2em] ${strong ? "text-shPrimary" : "text-shSecondary"}`}>
          {meta.label}{eyebrow ? <span className="text-shTextMuted normal-case tracking-normal font-bold"> · {eyebrow}</span> : null}
        </p>
        {children}
      </div>
    </div>
  );
}

/* The trainer's handoff, in the client's words. Only sections with real
 * content render — a legacy session with none of the modern fields shows a
 * single "Worked with your trainer on …" line and nothing else. */
function RecapSections({ recap, compact = false }) {
  const rows = [
    recap.went_well ? { key: "went-well", label: "What went well", text: recap.went_well, tone: "text-shPrimary" } : null,
    recap.needs_work ? { key: "needs-work", label: "Keep working on", text: recap.needs_work, tone: "text-shAccent" } : null,
  ].filter(Boolean);
  const nothing = rows.length === 0 && !recap.trainer_message;
  return (
    <div className={compact ? "space-y-2 mt-2" : "space-y-3 mt-2"} data-testid="today-recap-sections">
      {nothing && (
        <p className="text-[15px] text-shTextMuted leading-relaxed" data-testid="today-recap-minimal">
          Worked with your trainer{recap.lesson_name ? ` on ${recap.lesson_name}` : ""}.
        </p>
      )}
      {rows.map((r) => (
        <div key={r.key} data-testid={`today-recap-${r.key}`}>
          <p className={`text-[13px] font-black uppercase tracking-[0.16em] ${r.tone}`}>{r.label}</p>
          <p className="text-[16px] text-shText mt-0.5 leading-relaxed">{r.text}</p>
        </div>
      ))}
      {recap.trainer_message && (
        <blockquote className="text-[16px] text-gray-200 italic leading-relaxed border-l-2 border-shSecondary/40 pl-3" data-testid="today-recap-trainer-message">
          “{recap.trainer_message}”{recap.trainer_name ? <span className="not-italic text-[14px] text-shTextMuted"> — {recap.trainer_name}</span> : null}
        </blockquote>
      )}
    </div>
  );
}

export function TodayCommandCard({ home, onPrimaryAction, onViewCourse, onOpenPractice }) {
  const action = home?.current_action || {};
  const lesson = home?.current_lesson || {};
  const progress = home?.progress || {};
  const journey = home?.journey || null;
  const last = journey?.last || null;
  const now = journey?.now || null;
  const next = journey?.next || null;
  // Stage 3 — the post-lesson handoff lives INSIDE the rail: LAST tells the
  // session in full while it is prominent, NOW carries the Practice that
  // session assigned (or says plainly that none was / it is done), NEXT
  // carries the trainer's next focus. Once the client starts that Practice
  // the recap folds into a disclosure on LAST; nothing is duplicated.
  const recap = journey?.recap || null;
  const recapState = recapMode(journey);
  const recapProminent = recapState === "prominent";
  const recapPractice = recap?.practice || null;
  const recapPracticeDue = recapProminent && recapPractice && (recapPractice.state === "due");
  const recapPracticeLocked = recapProminent && recapPractice && recapPractice.state === "locked";
  const recapNoPractice = recapProminent && !recapPractice;
  const recapPracticeDone = recapProminent && recapPractice && (recapPractice.state === "completed" || recapPractice.state === "started");
  const pct = Math.max(0, Math.min(100, Number(progress.course_pct || 0)));
  const lessonPosition = progress.lessons_total
    ? `Lesson ${Math.min((progress.lessons_completed || 0) + 1, progress.lessons_total)} of ${progress.lessons_total}`
    : null;
  // NOW's button. `run: "practice_row"` opens the named Practice row through
  // the existing Practice Coach; everything else runs current_action exactly
  // as before. A `secondary` CTA (Practice again after today's work is done)
  // never dresses up as the primary action — and when the journey says
  // "done for today" there is deliberately no big button at all.
  // When the recap's Practice is due, the trainer's assignment is the one
  // thing to do — it is the same canonical row Today's practice list exposes,
  // opened through the existing Practice Coach (run: practice_row). The
  // engine's own action stays reachable as a secondary link below.
  const recapCta = recapPracticeDue ? { label: "Start Practice", run: "practice_row", practiceId: recapPractice.id } : null;
  const cta = recapCta || now?.cta || null;
  const primaryCta = cta && !cta.secondary ? cta : null;
  const noButton = ["awaiting_review", "access_expired", "course_paused", "setup_required"].includes(action.type) || (!!now && !primaryCta);
  const title = recapPracticeDue ? `Practice ${recapPractice.title}`
    : recapNoPractice ? "No home Practice from this lesson"
    : recapPracticeDone ? "Practice completed"
    : recapPracticeLocked ? `Practice ${recapPractice.title}`
    : (now?.title || lesson.name || action.label || "Your next training step");
  // One plain sentence under the title. Practice states keep the existing
  // coaching sentence (the practice block below carries the numbers); other
  // journey states use the journey's own body unless it would just repeat
  // the title or the lesson name.
  const doNow = recapPracticeDue ? `Your trainer set this up for ${home?.dog?.name || "your dog"} at your last lesson.`
    : recapNoPractice ? "Nothing to log at home from this one. Your next step is below."
    : recapPracticeDone ? "Nice work — you're caught up on what your trainer assigned."
    : recapPracticeLocked ? "Finish this lesson's reading in the app first — then this Practice opens."
    : (now && !now.practice && now.body && now.body !== title && now.body !== lesson.name)
      ? now.body : doThisNowCopy(action, home?.dog?.name, lesson.name);
  const runCta = (c) => {
    if (c?.run === "practice_row" && c.practiceId && onOpenPractice) onOpenPractice({ id: c.practiceId });
    else if (c?.run === "practice_row" && now?.practice?.id && onOpenPractice) onOpenPractice(now.practice);
    else onPrimaryAction?.();
  };
  const shownPractice = (recapPracticeDue || recapPracticeLocked) ? recapPractice : now?.practice;
  const practiceDetail = shownPractice?.detail || null;
  const practiceNote = shownPractice?.note || null;
  // The engine's action, kept reachable when the recap's Practice took the button.
  const engineCta = recapPracticeDue && now?.cta && !now.cta.secondary && !(now.kind === "practice" || now.kind === "practice_row") ? now.cta : null;
  const lastWhen = last?.at ? journeyWhen(last.at) : "";
  const appt = next?.appointment ? appointmentLabel(next.appointment) : "";

  return (
    <section className="rounded-3xl border border-shPrimary/40 bg-gradient-to-br from-shPrimary/[0.11] via-black/18 to-shSecondary/[0.055] overflow-hidden"
             data-testid="today-command-center" data-journey-dog={home?.dog?.id || ""} data-journey-mode={home?.delivery_mode || ""}>
      <div className="sh-command-body p-4 sm:p-7">
        <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary" data-testid="today-command-eyebrow">
          <i className={`fas ${recapProminent ? "fa-clipboard-check" : "fa-location-arrow"} mr-1.5`}/>
          {recapProminent ? recapHeading(recap) : <>Today&apos;s Next Step</>}
        </p>
        <p className="sh-journey-context text-[14px] text-shTextMuted mt-1 break-words" data-testid="today-journey-context">
          <span className="sh-journey-context-program">{home?.program?.name || "Your training program"}{home?.dog?.name || home?.delivery_mode ? " · " : ""}</span>
          {home?.dog?.name || ""}{home?.dog?.name && home?.delivery_mode ? " · " : ""}{home?.delivery_mode ? deliveryLabel(home.delivery_mode) : ""}
        </p>

        <div className="sh-journey-rail mt-4">
          {/* ------------------------------------------------------- LAST */}
          {last && (
            <JourneyStep step="last" eyebrow={recapProminent ? "What happened" : last.eyebrow} testid="today-journey-last">
              <p className="text-[17px] font-black text-shText leading-snug mt-0.5 text-balance" data-testid="today-journey-last-title">
                {recapProminent ? (recap.lesson_name || last.title) : last.title}
              </p>
              {recapProminent ? (
                <>
                  <p className="text-[13px] font-bold text-shTextMuted mt-0.5" data-testid="today-journey-last-when">
                    {[lastWhen || journeyWhen(recap.session_at), recap.trainer_name ? `with ${recap.trainer_name}` : null].filter(Boolean).join(" · ")}
                    {recap.outcome_label ? ` · ${recap.outcome_label}` : ""}
                  </p>
                  <RecapSections recap={recap} />
                </>
              ) : (
                <>
                  {last.summary && <p className="sh-journey-last-detail text-[15px] text-shTextMuted mt-0.5 leading-relaxed">{last.summary}</p>}
                  {lastWhen && <p className="sh-journey-last-detail text-[13px] font-bold text-shTextMuted mt-0.5" data-testid="today-journey-last-when">{lastWhen}</p>}
                  {/* Reduced recap: still one tap away, whatever LAST became
                      (the Practice the client logged after the lesson usually
                      is the newer event). */}
                  {recap && (
                    <details className="mt-1.5 group" data-testid="today-recap-disclosure">
                      <summary className="list-none cursor-pointer min-h-[40px] inline-flex items-center gap-1.5 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">
                        <i className="fas fa-chevron-right text-[11px] transition-transform group-open:rotate-90" aria-hidden="true" />
                        {last.kind === "session" ? "Show recap" : `Lesson recap · ${recap.lesson_name || "with your trainer"}`}
                      </summary>
                      {last.kind !== "session" && recap.session_at && (
                        <p className="text-[13px] font-bold text-shTextMuted mt-1.5">{journeyWhen(recap.session_at)}{recap.trainer_name ? ` · with ${recap.trainer_name}` : ""}</p>
                      )}
                      <RecapSections recap={recap} compact />
                    </details>
                  )}
                </>
              )}
            </JourneyStep>
          )}

          {/* -------------------------------------------------------- NOW */}
          <JourneyStep step="now" eyebrow={recapPracticeDue || recapPracticeLocked ? "Practice at home" : recapPracticeDone ? "Practice at home · done" : recapNoPractice ? "Practice at home" : now?.kind === "done_today" ? "Done for today" : "Do this now"} tone="strong" testid="today-journey-now" connector={!!next}>
            <h2 className="sh-journey-now-title text-[24px] sm:text-[32px] font-black text-shText leading-tight mt-1 text-balance">{title}</h2>
            {doNow && <p className="sh-journey-do-now text-[17px] sm:text-[19px] text-shText mt-1.5 leading-snug" data-testid="today-do-now">{doNow}</p>}
            {(practiceDetail || practiceNote) && (
              <div className="mt-2.5 rounded-xl border border-white/10 bg-black/20 px-3.5 py-3" data-testid="today-journey-practice">
                {practiceDetail && <p className="text-[16px] font-black text-shText">{practiceDetail}</p>}
                {practiceNote && <p className="text-[15px] text-shTextMuted mt-1 leading-relaxed"><span className="font-black text-shText">Trainer note:</span> {practiceNote}</p>}
              </div>
            )}

            {!noButton && (
              <button type="button" onClick={() => runCta(primaryCta)} data-testid="today-primary-action" data-school-primary="true"
                      className="sh-today-primary mt-3.5 w-full min-h-[58px] rounded-xl bg-shPrimary text-[#071018] font-black text-[17px] sm:text-[18px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_12px_34px_-12px_rgba(140,198,63,0.8)]">
                {primaryCta?.label || action.label || "Continue Training"}<i className="fas fa-arrow-right text-[14px]"/>
              </button>
            )}
            {engineCta && (
              <button type="button" onClick={() => runCta(now.cta)} data-testid="today-journey-engine-action"
                      className="mt-2.5 min-h-[44px] px-2 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText inline-flex items-center gap-1.5">
                {engineCta.label} <i className="fas fa-chevron-right text-[11px]" aria-hidden="true" />
              </button>
            )}
            {noButton && now?.kind === "awaiting_review" && (
              <p className="mt-3 rounded-xl border border-shSecondary/30 bg-shSecondary/[0.08] px-3.5 py-3 text-[16px] font-black text-shText" data-testid="today-journey-waiting">
                <i className="fas fa-hourglass-half text-shSecondary mr-2" aria-hidden="true" />Waiting for trainer review — nothing to do right now.
              </p>
            )}
            {cta?.secondary && (
              <button type="button" onClick={() => runCta(cta)} data-testid="today-journey-secondary-action"
                      className="mt-3 min-h-[44px] px-3 rounded-xl border border-shBorder bg-black/15 text-shText text-[14px] font-black uppercase tracking-widest inline-flex items-center gap-2 hover:border-shPrimary/40 transition">
                <i className="fas fa-rotate" aria-hidden="true" />{cta.label}
              </button>
            )}

            <div className="mt-4 rounded-2xl border border-white/10 bg-black/18 p-3.5 sm:p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-shSecondary">What you do now</p>
              <p className="text-[17px] sm:text-[19px] text-shText mt-1.5 leading-relaxed">{
                recapPracticeDue ? actionCoachCopy({ type: "practice" }, home?.dog?.name)
                : recapPracticeDone ? "Nothing else is required today. Practice again any time, or wait for your next lesson with your trainer."
                : actionCoachCopy(action, home?.dog?.name)
              }</p>
            </div>
          </JourneyStep>

          {/* ------------------------------------------------------- NEXT */}
          {next && (
            <JourneyStep step="next" eyebrow={recapProminent && recap.next_focus ? "Next focus" : null} testid="today-journey-next" connector={false}>
              {recapProminent && recap.next_focus && (
                <p className="text-[16px] text-shText leading-relaxed mt-0.5" data-testid="today-recap-next-focus">{recap.next_focus}</p>
              )}
              <p className={`${recapProminent && recap.next_focus ? "text-[15px] font-black text-shTextMuted mt-1.5" : "text-[17px] font-black text-shText mt-0.5"} leading-snug text-balance`} data-testid="today-journey-next-title">{next.title}</p>
              {next.body && <p className="text-[15px] text-shTextMuted mt-0.5 leading-relaxed">{next.body}</p>}
              {appt && (
                <p className="text-[15px] font-black text-shText mt-1" data-testid="today-journey-appointment">
                  <i className="fas fa-calendar-check text-shSecondary mr-1.5" aria-hidden="true" />Your next visit: {appt}
                </p>
              )}
            </JourneyStep>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between gap-3 text-[14px]">
            <span className="font-black text-shText">{lessonPosition || "Your program"}</span>
            <span className="font-black text-shPrimary">{Math.round(pct)}% complete</span>
          </div>
          <div className="h-2 rounded-full bg-black/40 overflow-hidden mt-2" aria-hidden="true">
            <div className="h-full rounded-full bg-shPrimary transition-all" style={{ width: `${pct}%` }}/>
          </div>
          {/* Stage 1 clarity pass — what kind of program this is, in the one
              shared sentence, kept out of the primary action's way. */}
          <TrainingModeNote mode={home?.delivery_mode} testid="today-training-mode" className="mt-3" />
          <button type="button" onClick={onViewCourse} className="mt-2 min-h-[40px] px-1 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText" data-testid="today-command-view-course">
            All lessons <i className="fas fa-chevron-right ml-1 text-[11px]"/>
          </button>
        </div>
      </div>
    </section>
  );
}

/* Student Today is the command center, not a dashboard. The backend's
 * current_action remains the source of truth; this screen turns it into one
 * unmistakable instruction and one primary button. */
export default function StudentHome({ home, loading, clientName, blockedByOnboarding = false, onPrimaryAction, onAsk, onViewFeedback, onViewProgress, onViewCourse, onOpenPractice, handoff = null, onHandoffAction }) {
  const [trophyCount, setTrophyCount] = useState(null);
  const dogId = home?.dog?.id;
  useEffect(() => {
    let live = true;
    if (!dogId) return undefined;
    api.get("/portal/trophies")
      .then(({ data }) => {
        if (!live) return;
        const mine = (data?.dog_trophies || []).filter(t => !t.dog_id || t.dog_id === dogId || t.recipient_id === dogId);
        setTrophyCount(mine.length);
      })
      .catch(() => { if (live) setTrophyCount(0); });
    return () => { live = false; };
  }, [dogId]);

  if (loading && !home) {
    return (
      <div className="space-y-4" data-testid="student-home-loading">
        <div className="h-8 w-48 rounded bg-shBorder/40 animate-pulse" />
        <div className="h-64 rounded-3xl bg-shBorder/25 animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
          <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!home && blockedByOnboarding) {
    // Step 0. The one-time setup form renders directly under this card
    // (StudentWorkspaceExtras) — one thing to do, and it is right here.
    return (
      <div className="space-y-4" data-testid="student-home-setup-first">
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.12] via-black/15 to-shSecondary/[0.05] p-4 sm:p-7">
          <p className="text-[13px] font-black uppercase tracking-[0.22em] text-shPrimary"><i className="fas fa-location-arrow mr-1.5"/>Step 0 · Before your first lesson</p>
          <h1 className="text-[24px] sm:text-[32px] font-black text-shText mt-2 leading-tight text-balance">Tell us a little about your dog, then we start training.</h1>
          <p className="text-[17px] sm:text-[19px] text-shText mt-2 leading-snug">Answer the short questions right below this. When you save them, School opens your first lesson.</p>
          <p className="text-[15px] text-shTextMuted mt-2 leading-relaxed"><i className="fas fa-arrow-down mr-1.5 text-shPrimary" aria-hidden="true" />The questions are just below. A sentence or two each is plenty.</p>
        </section>
      </div>
    );
  }

  if (!home) {
    return (
      <div className="space-y-4" data-testid="student-home-unavailable">
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.12] via-black/15 to-shSecondary/[0.05] p-6 sm:p-8">
          <p className="text-[13px] font-black uppercase tracking-[0.22em] text-shPrimary">Start here</p>
          <h1 className="text-[26px] sm:text-[34px] font-black text-shText mt-1 leading-tight text-balance">One quick step before training</h1>
          <p className="text-[18px] sm:text-[20px] text-shTextMuted mt-3 leading-relaxed max-w-2xl">
            If you see the one-time setup below, complete that first. When you save it, your Today plan will load automatically and School will tell you exactly what to do next.
          </p>
          <p className="text-[16px] sm:text-[17px] text-shTextMuted mt-2 leading-relaxed max-w-2xl">
            Already finished the setup? Open All Lessons and continue from the first available lesson.
          </p>
          <button type="button" onClick={onViewCourse} data-testid="student-home-open-course-fallback"
                  className="mt-5 w-full sm:w-auto sm:px-8 min-h-[56px] rounded-xl border border-shBorder bg-black/15 text-shText font-black text-[16px] sm:text-[17px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:border-shPrimary/40 transition">
            Open All Lessons <i className="fas fa-arrow-right text-[14px]" />
          </button>
        </section>
      </div>
    );
  }

  const hasUnansweredQuestion = !!home.trainer?.has_unanswered_question;
  const completed = home.status === "completed";

  return (
    <div className="space-y-4" data-testid="student-home">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="sh-today-greeting text-shText font-black text-[20px] sm:text-[26px] leading-tight text-balance">{greeting(clientName)}</h1>
          {home.dog?.name && <p className="sh-today-sub text-[14px] sm:text-[16px] text-shTextMuted mt-0.5">School will tell you exactly what {home.dog.name} needs next.</p>}
        </div>
        <SchoolOrientation dogName={home.dog?.name} />
      </header>

      {/* Stage 10 — the handoff for the action the client JUST took, above
          the rail that already describes where they are now. One enrollment,
          shown once, never persisted. */}
      {handoff && !completed && (
        <HandoffPanel handoff={handoff} testid="today-handoff" onAction={onHandoffAction} onSecondary={onHandoffAction} />
      )}

      {completed ? (
        <CourseCompletionCard home={home} onCourse={onViewCourse} onProgress={onViewProgress} onFeedback={onViewFeedback} />
      ) : (
        <TodayCommandCard home={home} onPrimaryAction={onPrimaryAction} onViewCourse={onViewCourse} onOpenPractice={onOpenPractice} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 min-w-0">
          {/* The rail already names the one Practice row NOW points at and the
              NEXT milestone — these cards only render when they add a row the
              rail does not (a second assignment, a trainer's general row). */}
          {!completed && !practiceCoveredByJourney(home) && !practiceCoveredByRecap(home) && <PracticeCard practice={home.active_practice} onOpen={onOpenPractice} />}
          {!completed && !home.journey && <NextMilestoneCard home={home} onOpen={onViewCourse} />}
        </div>
        <div className="space-y-4 min-w-0">
          <LatestFeedbackCard feedback={home.latest_feedback} onView={onViewFeedback} />
          <TrainerCard trainer={home.trainer} onAsk={onAsk} onViewFeedback={onViewFeedback}
                       hasUnansweredQuestion={hasUnansweredQuestion} unreadReplies={home.trainer?.unread_replies || 0} />
        </div>
      </div>

      <ProgressRow progress={home.progress} trophyCount={trophyCount} onViewAll={onViewProgress} />
    </div>
  );
}
