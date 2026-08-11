// Online School — the client portal HERO. For an enrolled School client the
// dashboard should essentially say "you have a dog, and here is what you're
// training today" — so this is a full-width, tall, visually dominant panel,
// not a slim status strip. Everything shown is backend-derived from
// /portal/school (course %, Week/Module X of Y, current lesson, practiced
// state); nothing is computed by guessing indices in the frontend.
import HuskyDogImage from "../brand/HuskyDogImage";

function ctaFor(entry) {
  if (!entry) return { label: "View Course", icon: "fa-arrow-right" };
  if (entry.status === "completed") return { label: "View Course", icon: "fa-graduation-cap" };
  if (entry.access_state && entry.access_state !== "active") return { label: "View Course", icon: "fa-arrow-right" };
  if (!entry.current_lesson_name) return { label: "View Course", icon: "fa-arrow-right" };
  return entry.current_lesson_practiced
    ? { label: "Continue Training", icon: "fa-arrow-right" }
    : { label: "Start Today's Training", icon: "fa-play" };
}

export default function OnlineSchoolHeroCard({ entries = [], onOpen, testid = "online-school-hero" }) {
  if (!entries.length) return null;
  const e = entries[0];
  const pct = Math.max(0, Math.min(100, Math.round(e.course_pct ?? 0)));
  const cta = ctaFor(e);
  // "Week 1 of 8" when the curriculum is authored as weeks, otherwise
  // "Module 1 of 8" — both straight from the backend module position.
  const unit = /^week/i.test(e.current_module_name || "") ? "Week" : "Module";
  const positionLine = e.modules_total
    ? `${unit} ${e.module_number ?? 1} of ${e.modules_total} · ${pct}% Complete`
    : `${pct}% Complete`;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-shPrimary/35 shadow-2xl bg-gradient-to-br from-shBlue/20 via-bgPanel to-shPrimary/15"
      data-testid={testid}
    >
      {/* brand glow backdrop */}
      <div className="absolute inset-0 pointer-events-none opacity-70"
           style={{ background: "radial-gradient(circle at 8% 0%, rgba(140,198,63,0.14), transparent 40%), radial-gradient(circle at 100% 100%, rgba(0,169,224,0.12), transparent 45%)" }} />

      <div className="relative p-5 sm:p-6 lg:p-7 grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-8 items-center">
        {/* ── Left: course identity ── */}
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.32em] text-shBlue">
            <i className="fas fa-graduation-cap mr-2 text-shPrimary" />Sit Happens Online School
          </p>
          <h2 className="text-[26px] sm:text-[32px] leading-tight font-black text-white uppercase italic tracking-tight mt-2 text-balance"
              data-testid={`${testid}-course-name`}>
            {e.program_name}
          </h2>
          <div className="flex items-center gap-3 mt-3 min-w-0">
            {e.dog_photo !== undefined && (
              <span className="w-11 h-11 rounded-xl overflow-hidden border border-shSecondary/35 bg-black/25 shrink-0">
                <HuskyDogImage src={e.dog_photo} name={e.dog_name} alt={e.dog_name} className="w-full h-full object-cover object-top" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-black text-shText truncate">{e.dog_name}</p>
              <p className="text-[12px] text-shTextMuted truncate">
                {e.status === "completed"
                  ? "Course complete — every lesson stays open for review."
                  : e.current_module_name || "Ready to begin"}
              </p>
            </div>
          </div>
          {entries.length > 1 && (
            <p className="text-[11px] text-shTextMuted mt-3" data-testid={`${testid}-more-courses`}>
              <i className="fas fa-layer-group mr-1.5 text-shSecondary" />
              +{entries.length - 1} more course{entries.length - 1 === 1 ? "" : "s"} inside School
            </p>
          )}
        </div>

        {/* ── Right: progress + next step + CTA ── */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 text-[12px] font-black uppercase tracking-widest">
            <span className="text-shTextMuted truncate" data-testid={`${testid}-position`}>{positionLine}</span>
            <span className="text-shPrimary text-[16px] shrink-0" data-testid={`${testid}-pct`}>{pct}%</span>
          </div>
          <div className="h-3 rounded-full bg-black/35 border border-shBorder/50 overflow-hidden mt-2" data-testid={`${testid}-progress`}>
            <div className="h-full rounded-full bg-gradient-to-r from-shSecondary to-shPrimary transition-all" style={{ width: `${pct}%` }} />
          </div>

          {e.status !== "completed" && e.current_lesson_name && (
            <div className="mt-4 rounded-xl border border-shBorder/55 bg-black/20 p-3.5" data-testid={`${testid}-up-next`}>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-shSecondary">
                {e.current_lesson_practiced ? "In progress" : "Up next"}
              </p>
              <p className="text-[15px] font-black text-shText mt-1 break-words">{e.current_lesson_name}</p>
              <p className="text-[11px] text-shTextMuted mt-1">
                {e.current_lesson_practiced
                  ? "Today's training logged ✓ — keep the streak going."
                  : "Today's training is ready when you are."}
              </p>
            </div>
          )}

          <button type="button" onClick={onOpen} data-testid="online-school-open"
                  className="mt-4 w-full lg:w-auto lg:min-w-[260px] inline-flex items-center justify-center gap-2 bg-shPrimary text-bgHeader px-6 py-4 rounded-xl font-black text-[14px] uppercase tracking-widest shadow-xl hover:bg-shPrimary/90 active:scale-[0.99] transition"
                  data-cta={cta.label}>
            <i className={`fas ${cta.icon}`} />{cta.label}
          </button>
        </div>
      </div>
    </section>
  );
}
