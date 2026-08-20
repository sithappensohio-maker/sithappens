/* Client School — Course experience cards.
 *
 * Phase 2 of the client redesign. The journey is presented as modules and
 * lessons a person can read, not as records in a tree: friendly state words,
 * a stated reason for anything locked, and one primary Continue action.
 *
 * ALL state is server-derived. buildSchoolRoadmap (existing) supplies module
 * status and locked_reason; lesson status comes straight off the roadmap.
 * Nothing here decides what is unlocked — it only says so in plain English.
 */
import { useState } from "react";
import { Eyebrow } from "../today/TodayCards";
import HuskyDogImage from "../../../brand/HuskyDogImage";

/* Friendly labels for the server's status vocabulary. The brief explicitly
   asks that admin words like AVAILABLE/LOCKED not dominate the card. */
const MODULE_STATE = {
  // The backend emits "completed"; "complete" is accepted too so a future
  // wording change on either side cannot silently downgrade a finished module
  // to "Up next" (which is exactly what happened before this was pinned).
  completed: { label: "Complete", cls: "text-shPrimary border-shPrimary/40 bg-shPrimary/10", icon: "fa-circle-check" },
  complete: { label: "Complete", cls: "text-shPrimary border-shPrimary/40 bg-shPrimary/10", icon: "fa-circle-check" },
  current: { label: "In progress", cls: "text-shSecondary border-shSecondary/40 bg-shSecondary/10", icon: "fa-circle-play" },
  upcoming: { label: "Up next", cls: "text-shTextMuted border-shBorder bg-black/20", icon: "fa-circle" },
  locked: { label: "Locked", cls: "text-shTextMuted border-shBorder bg-black/20", icon: "fa-lock" },
};

function moduleState(m) {
  return MODULE_STATE[m.status] || MODULE_STATE.upcoming;
}

/** Course hero — program promise, real progress, one Continue CTA.
 *
 * `progress` is the server's whole-course tally from the home view-model. It
 * MUST be preferred over anything counted from the roadmap: the roadmap only
 * carries lessons for modules the client has unlocked, so counting it told a
 * client on the 120-lesson Service Dog program that their course was 5
 * lessons long. The roadmap-derived count survives only as a fallback for a
 * caller that has no progress payload yet. */
export function CourseHero({ detail, roadmap, progress, onResume }) {
  const pct = Math.max(0, Math.min(100, Math.round(progress?.course_pct ?? detail?.course_pct ?? 0)));
  const visibleLessons = roadmap?.modules?.flatMap(m => m.lessons || []) || [];
  const lessonsDone = Number(progress?.lessons_completed ?? visibleLessons.filter(l => l.status === "completed").length);
  const lessonsTotal = Number(progress?.lessons_total ?? visibleLessons.length);
  /* Modules are the third metric because every module IS present in the
     roadmap. A checkpoint total is not derivable client-side for the same
     locked-module reason, and a passed-count with no denominator would be
     worse than showing nothing. */
  const modulesDone = Number(progress?.modules_completed ?? 0);
  const modulesTotal = Number(progress?.modules_total ?? roadmap?.modules?.length ?? 0);
  const completed = detail?.status === "completed";
  const current = roadmap?.current_lesson;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-shBorder/60 bg-[var(--sh-card-base)]" data-testid="course-hero">
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <Eyebrow>{detail?.dog_name ? `${detail.dog_name} · your course` : "Your course"}</Eyebrow>
          <h1 className="text-[20px] sm:text-[24px] font-black text-shText leading-tight mt-1 text-balance">
            {detail?.program_name || "Your program"}
          </h1>
          {detail?.program_focus && (
            <p className="text-[13px] text-shTextMuted mt-1.5 leading-relaxed">{detail.program_focus}</p>
          )}

          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="min-w-0">
              <p className="text-[17px] font-black text-shPrimary leading-none" data-testid="course-pct">{pct}%</p>
              <p className="text-[9.5px] uppercase tracking-widest text-shTextMuted mt-1">Overall progress</p>
            </div>
            <div className="min-w-0">
              <p className="text-[17px] font-black text-shText leading-none" data-testid="course-lessons">
                {lessonsDone}<span className="text-shTextMuted"> / {lessonsTotal}</span>
              </p>
              <p className="text-[9.5px] uppercase tracking-widest text-shTextMuted mt-1">Lessons done</p>
            </div>
            {modulesTotal > 0 && (
              <div className="min-w-0">
                <p className="text-[17px] font-black text-shText leading-none" data-testid="course-modules">
                  {modulesDone}<span className="text-shTextMuted"> / {modulesTotal}</span>
                </p>
                <p className="text-[9.5px] uppercase tracking-widest text-shTextMuted mt-1">Modules</p>
              </div>
            )}
          </div>

          <div className="h-2 rounded-full bg-black/40 overflow-hidden mt-3">
            <div className="h-full rounded-full bg-shPrimary transition-all" style={{ width: `${pct}%` }} />
          </div>

          {!completed && current && onResume && (
            <button type="button" onClick={() => onResume(current.id)} data-testid="course-continue"
                    className="mt-4 w-full sm:w-auto sm:px-6 min-h-[50px] rounded-xl bg-shPrimary text-[#071018] font-black text-[14px] inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_10px_30px_-12px_rgba(140,198,63,0.8)]">
              Continue lesson<i className="fas fa-arrow-right text-[11px]" />
            </button>
          )}
        </div>
        <div className="w-24 sm:w-32 shrink-0 relative hidden xs:block sm:block">
          <HuskyDogImage src={detail?.dog_photo} name={detail?.dog_name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[var(--sh-card-base)] via-transparent to-transparent" />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- Lesson */

function lessonState(lesson, currentLessonId) {
  if (lesson.id === currentLessonId) return { label: "Current lesson", cls: "text-shSecondary border-shSecondary/45 bg-shSecondary/10", icon: "fa-circle-play" };
  if (lesson.status === "completed") return { label: "Completed", cls: "text-shPrimary border-shPrimary/40 bg-shPrimary/10", icon: "fa-circle-check" };
  if (lesson.status === "locked") return { label: "Locked", cls: "text-shTextMuted border-shBorder bg-black/20", icon: "fa-lock" };
  return { label: "Up next", cls: "text-shTextMuted border-shBorder bg-black/20", icon: "fa-circle" };
}

function LessonRow({ lesson, currentLessonId, onOpen }) {
  const st = lessonState(lesson, currentLessonId);
  const locked = lesson.status === "locked";
  const minutes = lesson.estimated_minutes;
  return (
    <button type="button" disabled={locked} onClick={() => !locked && onOpen?.(lesson.id)}
            data-testid={`course-lesson-${lesson.id}`} data-state={locked ? "locked" : lesson.id === currentLessonId ? "current" : lesson.status || "available"}
            className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${locked ? "opacity-70 cursor-default" : "hover:bg-white/[0.03]"}`}>
      <span className={`w-7 h-7 rounded-lg grid place-items-center shrink-0 border text-[10px] ${st.cls}`}>
        <i className={`fas ${st.icon}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-black text-shText leading-snug line-clamp-2">{lesson.name}</span>
        <span className="block text-[11px] text-shTextMuted mt-0.5">
          {[minutes ? `${minutes} min` : null, st.label].filter(Boolean).join(" · ")}
          {locked && lesson.locked_reason ? ` — ${lesson.locked_reason}` : ""}
        </span>
      </span>
      {!locked && <i className="fas fa-chevron-right text-[10px] text-shTextMuted shrink-0" />}
    </button>
  );
}

/* ----------------------------------------------------------------- Module */

/** One module. The CURRENT module is expanded by default; completed and
 *  future modules collapse so the journey reads as a path rather than a wall
 *  of rows. Locked modules say what unlocks them. */
export function ModuleCard({ module: m, currentLessonId, onOpenLesson, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const st = moduleState(m);
  const lessons = m.lessons || [];
  const done = lessons.filter(l => l.status === "completed").length;
  const locked = m.status === "locked";

  return (
    <section className={`rounded-2xl border overflow-hidden ${m.status === "current" ? "border-shSecondary/35 bg-shSecondary/[0.03]" : "border-shBorder/50 bg-[var(--sh-card-base)]"}`}
             data-testid={`course-module-${m.id}`} data-state={m.status}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              data-testid={`course-module-toggle-${m.id}`}
              className="w-full text-left px-4 py-3.5 flex items-center gap-3">
        <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 border ${st.cls}`}>
          <i className={`fas ${st.icon} text-[12px]`} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-black text-shText leading-snug line-clamp-2">{m.name}</span>
          {m.description && <span className="block text-[11.5px] text-shTextMuted mt-0.5 line-clamp-2">{m.description}</span>}
          <span className="block text-[10.5px] font-black uppercase tracking-widest mt-1.5">
            <span className={st.cls.split(" ")[0]}>{st.label}</span>
            {!locked && lessons.length > 0 && (
              <span className="text-shTextMuted"> · {done} / {lessons.length} lessons</span>
            )}
          </span>
        </span>
        {!locked && <i className={`fas fa-chevron-${open ? "up" : "down"} text-[11px] text-shTextMuted shrink-0`} />}
      </button>

      {locked && m.lockedReason && (
        <p className="px-4 pb-3.5 -mt-1 text-[11.5px] text-shTextMuted" data-testid={`course-module-locked-${m.id}`}>
          <i className="fas fa-circle-info mr-1.5 text-shSecondary" />{m.lockedReason}
        </p>
      )}

      {open && !locked && (
        <div className="px-1.5 pb-2" data-testid={`course-module-lessons-${m.id}`}>
          {lessons.length === 0
            ? <p className="text-[12px] text-shTextMuted italic px-3 py-3">Lessons for this module are being prepared.</p>
            : lessons.map(l => (
                <LessonRow key={l.id} lesson={l} currentLessonId={currentLessonId} onOpen={onOpenLesson} />
              ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------- Locked run summary */

/** A long program ends in a long tail of locked modules — Service Dog opens
 *  with ONE current module and twenty-three locked ones. Rendering each as a
 *  full card buries the part the client can act on under identical "Complete X
 *  before continuing" copy.
 *
 *  The tail is folded into a single honest summary that says how much is
 *  ahead and can be opened by anyone who wants to read the whole plan. Nothing
 *  is hidden — this is presentation only, and the modules inside are the same
 *  cards, still locked, still stating their reason. */
export function LockedModuleRun({ modules, testid = "course-locked-run" }) {
  const [open, setOpen] = useState(false);
  if (!modules?.length) return null;
  const lessons = modules.reduce((n, m) => n + (m.lessons || []).length, 0);

  return (
    <section data-testid={testid} data-count={modules.length} className="space-y-3">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              data-testid={`${testid}-toggle`}
              className="w-full text-left rounded-2xl border border-shBorder/50 bg-black/10 px-4 py-3.5 flex items-center gap-3 min-h-[56px] hover:bg-white/[0.02] transition">
        <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0 border border-shBorder bg-black/20 text-shTextMuted">
          <i className="fas fa-road text-[12px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-black text-shText leading-snug">
            {modules.length} more module{modules.length === 1 ? "" : "s"} ahead
          </span>
          <span className="block text-[11.5px] text-shTextMuted mt-0.5">
            {open ? "Tap to collapse" : "Unlocks as you finish the work before it"}
            {lessons > 0 ? ` · ${lessons} lesson${lessons === 1 ? "" : "s"}` : ""}
          </span>
        </span>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[11px] text-shTextMuted shrink-0`} />
      </button>

      {open && (
        <div className="space-y-3" data-testid={`${testid}-modules`}>
          {modules.map(m => <ModuleCard key={m.id} module={m} defaultOpen={false} />)}
        </div>
      )}
    </section>
  );
}

/** Group a roadmap into render items, folding every RUN of consecutive locked
 *  modules into one summary. A run is only folded when it is long enough that
 *  the repetition is the problem — a course with two locked modules left reads
 *  perfectly well as two cards. */
export function groupCourseModules(modules, { foldAfter = 3 } = {}) {
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    if (run.length >= foldAfter) out.push({ kind: "locked_run", id: `locked-${run[0].id}`, modules: run });
    else for (const m of run) out.push({ kind: "module", id: m.id, module: m });
    run = [];
  };
  for (const m of modules || []) {
    if (m.status === "locked") { run.push(m); continue; }
    flush();
    out.push({ kind: "module", id: m.id, module: m });
  }
  flush();
  return out;
}
