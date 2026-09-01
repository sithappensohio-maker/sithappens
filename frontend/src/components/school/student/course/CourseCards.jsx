/* Client School — Course experience cards.
 *
 * Phase 2 of the client redesign presented the journey as modules and
 * lessons a person can read; the trail redesign keeps that DATA contract
 * byte-identical and upgrades only the presentation: per-module hues and
 * content-derived icon tiles (lib/moduleIcons), a dog-photo progress ring,
 * a segmented per-lesson bar, and state icons instead of gray dots.
 *
 * ALL state is server-derived. buildSchoolRoadmap (existing) supplies module
 * status and locked_reason; lesson status comes straight off the roadmap.
 * Nothing here decides what is open — it only says so in plain English.
 */
import { useState } from "react";
import { Eyebrow } from "../today/TodayCards";
import HuskyDogImage from "../../../brand/HuskyDogImage";
import ModuleIconTile from "../../ModuleIconTile";
import { moduleHue } from "../../../../lib/moduleIcons";

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

function moduleMinutes(m) {
  // Locked lessons arrive as minimal placeholders WITHOUT estimated_minutes,
  // so a partial sum would present one lesson's minutes as the module's.
  // Only claim a total when every listed lesson actually carries one.
  const lessons = m.lessons || [];
  if (!lessons.length || lessons.some(l => !Number(l.estimated_minutes))) return null;
  return `${lessons.reduce((n, l) => n + Number(l.estimated_minutes), 0)} min`;
}

/** Course hero — program promise, real progress, one Continue action.
 *
 * `progress` is the server's whole-course tally from the home view-model. It
 * MUST be preferred over anything counted from the roadmap: the roadmap only
 * carries lessons for modules the client has unlocked, so counting it told a
 * client on the 120-lesson Service Dog program that their course was 5
 * lessons long. The roadmap-derived count survives only as a fallback for a
 * caller that has no progress payload yet. */
export function CourseHero({ detail, roadmap, progress, onResume, onAbout, trophyCount = null }) {
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
  /* The dog-photo ring: green = finished share of the course, a blue sliver
     = the one lesson in flight. Both are drawn FROM the same server numbers
     shown in the tiles — never a second computation of progress. */
  const sliver = completed || !lessonsTotal || pct >= 100 ? 0 : Math.min(100 - pct, Math.max(3, 100 / lessonsTotal));
  const ringStyle = {
    background: `conic-gradient(#8cc63f 0 ${pct}%, #00a9e0 ${pct}% ${pct + sliver}%, rgba(255,255,255,.10) ${pct + sliver}% 100%)`,
    WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
    mask: "radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))",
  };
  const segmented = lessonsTotal > 0 && lessonsTotal <= 20;

  return (
    <section data-testid="course-hero"
             className="relative overflow-hidden rounded-3xl border border-transparent"
             style={{
               background: "linear-gradient(var(--sh-card-base), var(--sh-card-base)) padding-box, linear-gradient(135deg, rgba(0,169,224,.7), rgba(96,128,196,.15) 40%, rgba(140,198,63,.7)) border-box",
             }}>
      <div className="relative p-5 sm:p-6"
           style={{ background: "radial-gradient(130% 100% at 100% 0%, rgba(0,169,224,.16), transparent 52%), radial-gradient(110% 90% at 0% 100%, rgba(140,198,63,.10), transparent 55%)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>{detail?.dog_name ? `${detail.dog_name} · your course` : "Your course"}</Eyebrow>
          {onAbout && (
            <button type="button" onClick={onAbout} data-testid="course-about-program"
                    className="min-h-[40px] px-2 text-[10.5px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">
              About this program <i className="fas fa-circle-info ml-1 text-[9px]" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-4 mt-1">
          <div className="min-w-0 flex-1">
            <h1 className="sh-display text-[24px] sm:text-[30px] text-shText leading-[1.02] text-balance">
              {detail?.program_name || "Your program"}
            </h1>
            {detail?.program_focus && (
              <p className="text-[13px] text-shTextMuted mt-1.5 leading-relaxed">{detail.program_focus}</p>
            )}
          </div>
          <div className="relative w-[92px] h-[92px] shrink-0" data-testid="course-dog-ring">
            <div className="absolute -inset-[5px] rounded-full" style={ringStyle} aria-hidden="true" />
            <HuskyDogImage src={detail?.dog_photo} name={detail?.dog_name}
                           className="w-full h-full rounded-full object-cover border-[3px] border-[var(--sh-card-base)] bg-black/40" />
            <span className="absolute -right-1.5 bottom-0 px-2 py-0.5 rounded-full text-[10px] font-black text-[#071018] shadow-lg"
                  style={{ background: "linear-gradient(135deg,#a5dc55,#8cc63f)" }} data-testid="course-pct">{pct}%</span>
          </div>
        </div>

        {/* One segment per lesson (green done, blue in flight) — falls back to
            the continuous bar for very long programs where 120 slivers would
            read as noise. */}
        {segmented ? (
          <div className="flex gap-1 mt-4" data-testid="course-segbar" aria-hidden="true">
            {Array.from({ length: lessonsTotal }, (_, i) => (
              <span key={i} className="h-2 flex-1 rounded-full"
                    style={i < lessonsDone
                      ? { background: "linear-gradient(90deg,#8cc63f,#b6e56b)", boxShadow: "0 0 10px rgba(140,198,63,.5)" }
                      : i === lessonsDone && !completed
                        ? { background: "linear-gradient(90deg,#25b9ec,#00a9e0)", boxShadow: "0 0 10px rgba(0,169,224,.55)" }
                        : { background: "rgba(255,255,255,.08)" }} />
            ))}
          </div>
        ) : (
          <div className="h-2 rounded-full bg-black/40 overflow-hidden mt-4" aria-hidden="true">
            <div className="h-full rounded-full bg-shPrimary transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-xl border border-shPrimary/25 bg-shPrimary/[0.05] px-3 py-2 flex items-center gap-2.5 min-w-0">
            <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 bg-shPrimary/15 border border-shPrimary/40 text-shPrimary"><i className="fas fa-bone text-[11px]" /></span>
            <span className="min-w-0">
              <span className="block text-[14px] font-black text-shText leading-none tabular-nums" data-testid="course-lessons">
                {lessonsDone}<span className="text-shTextMuted"> / {lessonsTotal}</span>
              </span>
              <span className="block text-[8.5px] font-black uppercase tracking-[0.12em] text-shTextMuted mt-1">Lessons</span>
            </span>
          </div>
          {modulesTotal > 0 && (
            <div className="rounded-xl border border-shSecondary/25 bg-shSecondary/[0.05] px-3 py-2 flex items-center gap-2.5 min-w-0">
              <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 bg-shSecondary/15 border border-shSecondary/40 text-shSecondary"><i className="fas fa-paw text-[11px]" /></span>
              <span className="min-w-0">
                <span className="block text-[14px] font-black text-shText leading-none tabular-nums" data-testid="course-modules">
                  {modulesDone}<span className="text-shTextMuted"> / {modulesTotal}</span>
                </span>
                <span className="block text-[8.5px] font-black uppercase tracking-[0.12em] text-shTextMuted mt-1">Modules</span>
              </span>
            </div>
          )}
          {trophyCount != null && (
            <div className="rounded-xl border border-shAccent/25 bg-shAccent/[0.05] px-3 py-2 flex items-center gap-2.5 min-w-0" data-testid="course-trophies">
              <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0 bg-shAccent/15 border border-shAccent/40 text-shAccent"><i className="fas fa-trophy text-[11px]" /></span>
              <span className="min-w-0">
                <span className="block text-[14px] font-black text-shText leading-none tabular-nums">{trophyCount}</span>
                <span className="block text-[8.5px] font-black uppercase tracking-[0.12em] text-shTextMuted mt-1">Trophies</span>
              </span>
            </div>
          )}
        </div>

        {!completed && current && onResume && (
          <button type="button" onClick={() => onResume(current.id)} data-testid="course-continue"
                  className="mt-4 w-full sm:w-auto sm:px-6 min-h-[50px] rounded-xl text-[#071018] font-black text-[13px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_14px_30px_-10px_rgba(140,198,63,0.75)]"
                  style={{ background: "linear-gradient(135deg,#9ad14e,#8cc63f)" }}>
            <i className="fas fa-play text-[10px]" />Continue lesson<i className="fas fa-arrow-right text-[11px]" />
          </button>
        )}
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

function LessonBadge({ lesson, currentLessonId, index }) {
  if (lesson.id === currentLessonId) {
    return (
      <span className="relative w-[34px] h-[34px] rounded-xl grid place-items-center shrink-0 text-[#04101a] shadow-[0_6px_18px_-6px_rgba(0,169,224,.85)]"
            style={{ background: "linear-gradient(135deg,#25b9ec,#00a9e0)" }}>
        <span className="absolute -inset-1 rounded-[14px] border border-shSecondary/50 animate-ping" aria-hidden="true" />
        <i className="fas fa-play text-[11px]" />
      </span>
    );
  }
  if (lesson.status === "completed") {
    return (
      <span className="w-[34px] h-[34px] rounded-xl grid place-items-center shrink-0 border-[1.5px] border-shPrimary/55 bg-shPrimary/15 text-shPrimary">
        <i className="fas fa-check text-[12px]" />
      </span>
    );
  }
  if (lesson.status === "locked") {
    return (
      <span className="w-[34px] h-[34px] rounded-xl grid place-items-center shrink-0 border border-shBorder bg-black/20 text-shTextMuted">
        <i className="fas fa-lock text-[11px]" />
      </span>
    );
  }
  return (
    <span className="sh-display w-[34px] h-[34px] rounded-xl grid place-items-center shrink-0 border border-shBorder bg-white/[0.04] text-shTextMuted text-[13px]">
      {index + 1}
    </span>
  );
}

function LessonRow({ lesson, currentLessonId, onOpen, index }) {
  const st = lessonState(lesson, currentLessonId);
  const locked = lesson.status === "locked";
  const isCurrent = lesson.id === currentLessonId;
  const minutes = lesson.estimated_minutes;
  return (
    <button type="button" disabled={locked} onClick={() => !locked && onOpen?.(lesson.id)}
            data-testid={`course-lesson-${lesson.id}`} data-state={locked ? "locked" : isCurrent ? "current" : lesson.status || "available"}
            className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${locked ? "opacity-70 cursor-default" : "hover:bg-white/[0.03]"}`}>
      <LessonBadge lesson={lesson} currentLessonId={currentLessonId} index={index} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13.5px] font-black leading-snug line-clamp-2 ${isCurrent ? "text-[#e4f6ff]" : "text-shText"}`}>{lesson.name}</span>
        <span className={`block text-[9.5px] font-black uppercase tracking-[0.09em] mt-0.5 ${isCurrent ? "text-shSecondary" : lesson.status === "completed" ? "text-shPrimary" : "text-shTextMuted"}`}>
          {st.label}
          {locked && lesson.locked_reason ? <span className="normal-case font-bold tracking-normal"> — {lesson.locked_reason}</span> : ""}
        </span>
      </span>
      {minutes ? (
        <span className={`text-[10px] font-black rounded-full px-2.5 py-1 tabular-nums whitespace-nowrap shrink-0 ${isCurrent ? "text-[#04101a]" : "text-shTextMuted border border-shBorder bg-white/[0.04]"}`}
              style={isCurrent ? { background: "linear-gradient(135deg,#25b9ec,#00a9e0)" } : undefined}>
          {minutes} min
        </span>
      ) : null}
      {!locked && <i className="fas fa-chevron-right text-[10px] text-shTextMuted shrink-0" />}
    </button>
  );
}

/* ----------------------------------------------------------------- Module */

/** One module. The CURRENT module is expanded by default; completed and
 *  future modules collapse so the journey reads as a path rather than a wall
 *  of rows. Locked modules say what unlocks them. `position` (1-based, from
 *  the roadmap order) drives the hue cycle and the trail node number. */
export function ModuleCard({ module: m, currentLessonId, onOpenLesson, defaultOpen, position }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const st = moduleState(m);
  const lessons = m.lessons || [];
  const done = lessons.filter(l => l.status === "completed").length;
  const locked = m.status === "locked";
  const isCurrent = m.status === "current";
  const hue = moduleHue(position);
  const minutes = moduleMinutes(m);
  const meta = [
    lessons.length > 0 ? `${done} / ${lessons.length} lessons` : null,
    minutes,
  ].filter(Boolean).join(" · ");

  return (
    <section data-testid={`course-module-${m.id}`} data-state={m.status}
             className={`rounded-2xl overflow-hidden border ${isCurrent ? "border-transparent" : "border-shBorder/50 bg-[var(--sh-card-base)]"}`}
             style={isCurrent ? {
               background: "linear-gradient(var(--sh-card-base), var(--sh-card-base)) padding-box, linear-gradient(120deg, rgba(0,169,224,.7), rgba(96,128,196,.2) 50%, rgba(140,198,63,.5)) border-box",
               boxShadow: "0 10px 40px -16px rgba(0,169,224,.4)",
             } : undefined}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
              data-testid={`course-module-toggle-${m.id}`}
              className="w-full text-left px-4 py-3.5 flex items-center gap-3"
              style={{ background: locked ? undefined : `radial-gradient(130% 180% at 0% 0%, ${hue.main}${isCurrent ? "24" : "14"}, transparent 55%)` }}>
        <ModuleIconTile module={m} hue={locked ? null : hue} size={44} />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-black text-shText leading-snug line-clamp-2">{m.name}</span>
          {m.description && <span className="block text-[11px] text-shTextMuted mt-0.5 line-clamp-2">{m.description}</span>}
          <span className="block text-[10px] font-black uppercase tracking-widest mt-1.5">
            <span className={st.cls.split(" ")[0]}><i className={`fas ${st.icon} mr-1 text-[9px]`} />{st.label}</span>
            {!locked && meta && <span className="text-shTextMuted"> · {meta}</span>}
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
            : lessons.map((l, i) => (
                <LessonRow key={l.id} lesson={l} currentLessonId={currentLessonId} onOpen={onOpenLesson} index={i} />
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
        <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0 border border-shBorder bg-black/20 text-shTextMuted">
          <i className="fas fa-road text-[13px]" />
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
          {modules.map(m => <ModuleCard key={m.id} module={m} defaultOpen={false} position={m.position} />)}
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
