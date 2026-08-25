import { printSchoolCertificate, resolveSchoolCertificateTemplate } from "../../../lib/schoolCertificate";
import { useAuth } from "../../../lib/auth";

const fmtDate = (v) => {
  if (!v) return null;
  const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};

export default function CourseCompletionCard({ home, onCourse, onProgress, onFeedback }) {
  const { user } = useAuth();
  const c = home?.completion_summary || {};
  const dog = home?.dog?.name || "Your dog";
  const course = home?.program?.name || "School course";
  const completed = fmtDate(c.completed_at);
  const final = c.final_assessment || null;
  const certificateConfig = home?.program?.school_support?.certificate || {};
  const certificateTemplate = resolveSchoolCertificateTemplate(course, certificateConfig);
  return (
    <section className="relative overflow-hidden rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.12] via-black/20 to-shSecondary/[0.06] p-6 sm:p-8" data-testid="school-course-complete">
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-shPrimary/10 blur-3xl" />
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl border border-shPrimary/35 bg-shPrimary/10 grid place-items-center"><i className="fas fa-graduation-cap text-shPrimary text-xl" /></div>
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-shPrimary mt-5">Course complete</p>
        <h2 className="text-2xl sm:text-3xl font-black text-shText mt-1 text-balance">{dog} completed {course}</h2>
        <p className="text-[14px] text-shTextMuted mt-2 max-w-2xl">You finished the guided path. This course is now part of {dog}&rsquo;s training library. Review any lesson or practice a skill again whenever you need it — your original completion stays saved.</p>
        {completed && <p className="text-xs text-shTextMuted mt-2"><i className="fas fa-calendar-check mr-1.5 text-shPrimary"/>Completed {completed}</p>}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
          <Stat value={c.total_lessons ?? "—"} label="Lessons"/>
          <Stat value={c.total_modules ?? "—"} label="Modules"/>
          <Stat value={c.checkpoints_passed ?? 0} label="Checkpoints"/>
          <Stat value={c.practice_sessions_logged ?? 0} label="Practice sessions"/>
        </div>

        {final && <div className="mt-4 rounded-2xl border border-shSecondary/25 bg-black/15 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary">Final trainer assessment</p>
          <div className="flex flex-wrap gap-5 mt-2"><Score label="Handler Skills" value={final.handler_overall}/><Score label="Dog Performance" value={final.dog_overall}/></div>
          {final.trainer_feedback && <p className="text-sm text-shText mt-3 border-l-2 border-shSecondary/35 pl-3">{final.trainer_feedback}</p>}
        </div>}

        {(c.skills_mastered || []).length > 0 && <div className="mt-4"><p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Skills covered</p><div className="flex flex-wrap gap-2 mt-2">{c.skills_mastered.slice(0, 12).map((s, i) => <span key={`${s.name}-${i}`} className="rounded-full border border-shBorder bg-black/15 px-3 py-1.5 text-[11px] font-bold text-shText">{s.name}</span>)}</div></div>}

        {(home?.program?.recommended_next_programs || []).length > 0 && <div className="mt-5 rounded-2xl border border-shSecondary/25 bg-shSecondary/[0.045] p-4"><p className="text-[10px] font-black uppercase tracking-widest text-shSecondary">Recommended next step</p><div className="space-y-2 mt-2">{home.program.recommended_next_programs.map((p)=><button key={p.id} onClick={()=>window.location.assign(`/shop/item/training_program/${p.id}`)} className="w-full text-left rounded-xl border border-shBorder bg-black/15 p-3 hover:border-shSecondary/35"><p className="text-[13px] font-black text-shText">{p.name}</p>{p.focus&&<p className="text-[11px] text-shTextMuted mt-1">{p.focus}</p>}</button>)}</div></div>}
        <div className="flex flex-wrap gap-2 mt-5">
          <button onClick={onCourse} data-testid="school-course-review-library" className="min-h-[48px] px-4 rounded-xl bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest"><i className="fas fa-book-open mr-1.5" />Review any lesson</button>
          <button onClick={onProgress} className="min-h-[44px] px-4 rounded-xl border border-shBorder text-shText text-[12px] font-black uppercase tracking-widest"><i className="fas fa-chart-line mr-1.5" />View progress</button>
          <button onClick={onFeedback} className="min-h-[44px] px-4 rounded-xl border border-shSecondary/35 text-shSecondary text-[12px] font-black uppercase tracking-widest"><i className="fas fa-comments mr-1.5" />Trainer feedback</button>
          {certificateTemplate.enabled && <button onClick={() => printSchoolCertificate({
            clientName: user?.name || "",
            dogName: dog,
            programName: course,
            completionSummary: c,
            schoolEnrollmentId: home?.school_enrollment_id,
            certificateConfig,
          })} className="min-h-[44px] px-4 rounded-xl border border-shBorder text-shText text-[12px] font-black uppercase tracking-widest"><i className="fas fa-certificate mr-1.5" />Print certificate</button>}
        </div>
      </div>
    </section>
  );
}
function Stat({ value, label }) { return <div className="rounded-xl border border-shBorder bg-black/15 p-3"><p className="text-xl font-black text-shText">{value}</p><p className="text-[9px] font-black uppercase tracking-widest text-shTextMuted">{label}</p></div>; }
function Score({ label, value }) { return <div><p className="text-[10px] text-shTextMuted uppercase tracking-widest font-black">{label}</p><p className="text-lg font-black text-shText">{value == null ? "—" : `${Number(value).toFixed(1)}/5`}</p></div>; }
