/* Sit Happens School — client Today surface cards.
 *
 * These are COMPOSITIONS of the existing premium design system (tokens.js,
 * PremiumButton, EmptyState), not a second design language. The redesign brief
 * is explicit that the brand and component family already exist and must be
 * reused; what was missing was the guided, one-primary-action *arrangement*.
 *
 * Every value rendered here comes from the canonical
 * /portal/school/{id}/home view-model. Nothing is invented: metrics the
 * backend does not track (e.g. a practice day-streak) are deliberately
 * omitted rather than faked, per the brief.
 */
import { accentRgb } from "../../../premium/tokens";
import { deliveryIcon, deliveryLabel } from "../../../../lib/studentSchool";
import HuskyDogImage from "../../../brand/HuskyDogImage";
import { isRequiredPracticeSatisfied, practiceLoggedLabel, practiceTitle } from "../../../../lib/practiceState";

/* Small caps section label — the electric-blue eyebrow used throughout the
   reference design. */
export function Eyebrow({ children, tone = "cyan", className = "" }) {
  const cls = tone === "lime" ? "text-shPrimary" : tone === "orange" ? "text-shAccent" : "text-shSecondary";
  return (
    <p className={`text-[12px] font-black uppercase tracking-[0.18em] ${cls} ${className}`}>{children}</p>
  );
}

/* ---------------------------------------------------------------- Program */

/** The "this is YOUR dog's program" hero. Uses the dog's real profile photo
 *  when they have one and the existing brand artwork when they don't — never
 *  stock imagery, per the media rules. */
export function ProgramHeroCard({ home, onViewCourse }) {
  const dog = home?.dog || {};
  const pct = Math.max(0, Math.min(100, Number(home?.progress?.course_pct || 0)));
  return (
    <section className="relative overflow-hidden rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)]"
             data-testid="today-program-hero">
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <Eyebrow>Current program</Eyebrow>
          <h2 className="text-[22px] sm:text-[25px] font-black text-shText leading-tight mt-1 text-balance">
            {home?.program?.name || "Your training program"}
          </h2>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[13px] font-black uppercase tracking-widest rounded-full border border-shSecondary/25 bg-shSecondary/10 text-shSecondary px-2 py-0.5">
              <i className={`fas ${deliveryIcon(home?.delivery_mode)} mr-1`} />{deliveryLabel(home?.delivery_mode)}
            </span>
            {dog.name && <span className="text-[14px] text-shTextMuted truncate">{dog.name}</span>}
          </div>
          <p className="text-[16px] font-black text-shPrimary mt-3" data-testid="today-program-pct">{pct}% complete</p>
          <div className="h-2 rounded-full bg-black/40 overflow-hidden mt-1.5">
            <div className="h-full rounded-full bg-shPrimary transition-all" style={{ width: `${pct}%` }} />
          </div>
          {onViewCourse && (
            <button type="button" onClick={onViewCourse} data-testid="today-view-course"
                    className="mt-2 -mb-1.5 min-h-[44px] inline-flex items-center text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText transition">
              View full course <i className="fas fa-chevron-right text-[11px] ml-0.5" />
            </button>
          )}
        </div>
        <div className="w-24 sm:w-32 shrink-0 relative">
          {dog.photo
            ? <img src={dog.photo} alt="" className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 grid place-items-center bg-black/20"><HuskyDogImage className="w-full h-full object-cover opacity-90" alt="" /></div>}
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--sh-card-base)] via-transparent to-transparent" />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- Lesson */

/** The one primary action on the page. The label and sublabel come from the
 *  server-derived current_action, so this never second-guesses what the
 *  student should do next. */
export function CurrentLessonCard({ home, onPrimary }) {
  const action = home?.current_action || {};
  const lesson = home?.current_lesson;
  const minutes = lesson?.estimated_minutes;
  const p = home?.progress || {};
  const position = (p.lessons_total ? `Lesson ${Math.min((p.lessons_completed || 0) + 1, p.lessons_total)} of ${p.lessons_total}` : null);
  const noAction = ["awaiting_review", "access_expired", "setup_required", "course_paused"].includes(action.type);

  return (
    <section className="rounded-2xl border border-shSecondary/30 bg-shSecondary/[0.04] p-4 sm:p-5" data-testid="today-current-lesson">
      <Eyebrow>{noAction ? "Where you are" : "Current lesson"}</Eyebrow>
      <h3 className="text-[21px] sm:text-[23px] font-black text-shText leading-tight mt-1 text-balance">
        {lesson?.name || action.label || "Your next step"}
      </h3>
      <p className="text-[14px] text-shTextMuted mt-1">
        {[position, minutes ? `${minutes} min` : null].filter(Boolean).join(" · ") || home?.current_module?.name || ""}
      </p>
      {action.sublabel && <p className="text-[16px] text-shText/90 mt-2 leading-relaxed">{action.sublabel}</p>}
      {!noAction && (
        <button type="button" onClick={onPrimary} data-testid="today-primary-action" data-school-primary="true"
                className="mt-3.5 w-full min-h-[50px] rounded-xl bg-shPrimary text-[#071018] font-black text-[17px] tracking-wide inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_10px_30px_-12px_rgba(140,198,63,0.8)]">
          {action.label || "Continue lesson"}<i className="fas fa-arrow-right text-[14px]" />
        </button>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- Practice */

/** Practice due / overdue / all caught up. Overdue is derived from the
 *  assignment's own due_date — orange and direct, never alarmist. */
export function PracticeCard({ practice, onOpen }) {
  const items = (practice || []).filter(p => p && p.status !== "completed");
  // The server says which row is the current lesson's required practice and
  // whether it is already satisfied (required_practice_satisfied); this card
  // only phrases it. Unfinished trainer-prescribed or remediation work is
  // never "satisfied" and still shows as due.
  const open = items.filter(p => !isRequiredPracticeSatisfied(p));
  const logged = items.filter(isRequiredPracticeSatisfied);
  if (open.length === 0) {
    const done = logged[0] || null;
    const label = done ? practiceLoggedLabel(done) : null;
    return (
      <section className="rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] p-5 text-center" data-testid="today-practice-none" data-practice-logged={done ? "true" : "false"}>
        <span className="w-11 h-11 rounded-full grid place-items-center mx-auto bg-shPrimary/10 border border-shPrimary/25">
          <i className="fas fa-check text-shPrimary" />
        </span>
        {done ? (
          <>
            <p className="text-[18px] font-black text-shText mt-2.5" data-testid="today-practice-satisfied">{label.title}</p>
            <p className="text-[15px] text-shTextMuted mt-1">{label.detail}</p>
            {onOpen && (
              <button type="button" onClick={() => onOpen(done)} data-testid="today-practice-again"
                      className="mt-3 min-h-[40px] px-3 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">
                <i className="fas fa-rotate mr-1.5" />Practice again
              </button>
            )}
          </>
        ) : (
          <>
            <p className="text-[18px] font-black text-shText mt-2.5">All caught up</p>
            <p className="text-[15px] text-shTextMuted mt-1">Great job staying consistent. Enjoy your day.</p>
          </>
        )}
      </section>
    );
  }
  const next = open[0];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = next.due_date ? new Date(`${next.due_date}T00:00:00`) : null;
  const overdue = due && due < today;
  const dueToday = due && due.getTime() === today.getTime();

  return (
    <button type="button" onClick={() => onOpen?.(next)} data-testid="today-practice-due"
            data-overdue={overdue ? "true" : "false"}
            className={`w-full text-left rounded-2xl border p-4 flex items-center gap-3 transition ${overdue ? "border-shAccent/45 bg-shAccent/[0.06] hover:border-shAccent/70" : "border-shBorder/50 bg-[var(--sh-card-base)] hover:border-shSecondary/40"}`}>
      <span className={`w-11 h-11 rounded-xl grid place-items-center shrink-0 border ${overdue ? "bg-shAccent/10 border-shAccent/30 text-shAccent" : "bg-shSecondary/10 border-shSecondary/25 text-shSecondary"}`}>
        <i className="fas fa-calendar-check" />
      </span>
      <span className="min-w-0 flex-1">
        <Eyebrow tone={overdue ? "orange" : "cyan"}>{overdue ? "Overdue" : "Practice due"}</Eyebrow>
        <span className="block text-[18px] font-black text-shText truncate mt-0.5">{practiceTitle(next)}</span>
        <span className="block text-[14px] text-shTextMuted mt-0.5">
          {overdue ? "Was due " + next.due_date : dueToday ? "Due today to stay on track" : next.due_date ? `Due ${next.due_date}` : "Ready when you are"}
          {items.length > 1 ? ` · ${items.length} assigned` : ""}
        </span>
      </span>
      <i className="fas fa-chevron-right text-[14px] text-shTextMuted shrink-0" />
    </button>
  );
}

/* -------------------------------------------------------------- Milestone */

/** Next milestone — the checkpoint the student is working toward. Rendered
 *  only when the canonical data actually describes one. */
export function NextMilestoneCard({ home, onOpen }) {
  const p = home?.progress || {};
  const remaining = Math.max(0, (p.lessons_total || 0) - (p.lessons_completed || 0));
  const moduleName = home?.current_module?.name;
  if (!moduleName || !p.lessons_total) return null;
  return (
    <button type="button" onClick={onOpen} data-testid="today-next-milestone"
            className="w-full text-left rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] p-4 flex items-center gap-3 hover:border-shPrimary/40 transition">
      <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0 bg-shPrimary/10 border border-shPrimary/25 text-shPrimary">
        <i className="fas fa-shield-halved" />
      </span>
      <span className="min-w-0 flex-1">
        <Eyebrow tone="lime">Next milestone</Eyebrow>
        <span className="block text-[18px] font-black text-shText truncate mt-0.5">{moduleName}</span>
        <span className="block text-[14px] text-shTextMuted mt-0.5">
          {remaining > 0 ? `${remaining} lesson${remaining === 1 ? "" : "s"} to go in this program` : "You've completed every lesson"}
        </span>
      </span>
      <i className="fas fa-chevron-right text-[14px] text-shTextMuted shrink-0" />
    </button>
  );
}

/* --------------------------------------------------------------- Progress */

function StatTile({ icon, value, label, tone = "lime", testid }) {
  const rgb = accentRgb(tone);
  return (
    <div className="min-w-0 text-center" data-testid={testid}>
      <span className="w-9 h-9 rounded-full grid place-items-center mx-auto border"
            style={{ borderColor: `rgba(${rgb},0.35)`, background: `rgba(${rgb},0.10)`, color: `rgb(${rgb})` }}>
        <i className={`fas ${icon} text-[15px]`} />
      </span>
      <p className="text-[18px] font-black text-shText mt-1.5 leading-none">{value}</p>
      <p className="text-[12px] uppercase tracking-widest text-shTextMuted mt-1 truncate">{label}</p>
    </div>
  );
}

/** Progress the client can feel. Only metrics the backend genuinely tracks:
 *  course %, lessons, checkpoints passed, and real awarded trophies. The
 *  reference design's "day streak" is intentionally absent — nothing in the
 *  School model records one, and inventing it would be dishonest. */
export function ProgressRow({ progress, trophyCount, onViewAll }) {
  const p = progress || {};
  return (
    <section className="rounded-2xl border border-shBorder/50 bg-[var(--sh-card-base)] p-4" data-testid="today-progress-row">
      <div className="flex items-center justify-between gap-2 mb-3">
        <Eyebrow>Your progress</Eyebrow>
        {onViewAll && (
          <button type="button" onClick={onViewAll} data-testid="today-progress-view-all"
                  className="-my-2 px-1 min-h-[44px] inline-flex items-center text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText transition">
            View all
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        <StatTile icon="fa-circle-notch" tone="lime" testid="stat-program"
                  value={`${Math.round(p.course_pct || 0)}%`} label="Program" />
        <StatTile icon="fa-book-open" tone="cyan" testid="stat-lessons"
                  value={`${p.lessons_completed || 0}/${p.lessons_total || 0}`} label="Lessons" />
        <StatTile icon="fa-flag-checkered" tone="amber" testid="stat-checkpoints"
                  value={p.checkpoints_passed || 0} label="Checkpoints" />
        <StatTile icon="fa-star" tone="purple" testid="stat-badges"
                  value={trophyCount ?? 0} label="Badges" />
      </div>
    </section>
  );
}
