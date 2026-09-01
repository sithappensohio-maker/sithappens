import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { toast } from "sonner";

const EASE = [
  ["very_easy", "Very easy"], ["easy", "Easy"], ["okay", "Okay"],
  ["difficult", "Difficult"], ["very_difficult", "Very difficult"],
];
const PROGRESS = [["yes", "Yes"], ["somewhat", "Somewhat"], ["not_yet", "Not yet"]];
const RECOMMEND = [["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]];

const blank = {
  overall_rating: 0,
  lesson_ease: "",
  making_progress: "",
  liked_most: "",
  improve: "",
  recommend: "",
  testimonial_permission: false,
};

export default function SchoolExperienceFeedbackCard({ enrollmentId, source = "feedback_screen", completionPrompt = false }) {
  const [form, setForm] = useState(blank);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [course, setCourse] = useState(null);
  const [expanded, setExpanded] = useState(!completionPrompt);

  const load = useCallback(async () => {
    if (!enrollmentId) return;
    try {
      const { data } = await api.get(`/portal/school/${enrollmentId}/experience-feedback`);
      const courseData = data?.course || null;
      setCourse(courseData);
      setAvailable(courseData?.experience_feedback_eligible !== false);
      if (data?.feedback) {
        const f = data.feedback;
        setForm({
          overall_rating: Number(f.overall_rating || 0),
          lesson_ease: f.lesson_ease || "",
          making_progress: f.making_progress || "",
          liked_most: f.liked_most || "",
          improve: f.improve || "",
          recommend: f.recommend || "",
          testimonial_permission: !!f.testimonial_permission,
        });
        setSaved(true);
      } else {
        setForm(blank); setSaved(false);
      }
    } catch {
      // This is a secondary product-feedback surface; School itself should
      // never crash or show a broken survey because feedback could not load.
      setAvailable(false);
    } finally { setLoaded(true); }
  }, [enrollmentId]);

  useEffect(() => {
    setLoaded(false); setAvailable(null); setExpanded(!completionPrompt); load();
  }, [load, completionPrompt]);

  const valid = useMemo(() => (
    form.overall_rating >= 1 && form.overall_rating <= 5
    && !!form.lesson_ease && !!form.making_progress && !!form.recommend
  ), [form]);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const { data } = await api.put(`/portal/school/${enrollmentId}/experience-feedback`, {
        ...form,
        overall_rating: Number(form.overall_rating),
        source,
      });
      if (data?.feedback) {
        setSaved(true);
        toast.success(data.updated ? "Your School feedback was updated." : "Thanks — your School feedback was sent.");
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save your feedback. Please try again.");
    } finally { setBusy(false); }
  };

  if (!enrollmentId || !loaded || available !== true) return null;

  return (
    <section className={`rounded-2xl border ${completionPrompt ? "border-shPrimary/35 bg-shPrimary/[0.045]" : "border-shSecondary/30 bg-shSecondary/[0.035]"} p-4 sm:p-5`} data-testid="school-experience-feedback">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className={`text-[13px] font-black uppercase tracking-[0.22em] ${completionPrompt ? "text-shPrimary" : "text-shSecondary"}`}>
            {completionPrompt ? "You did it — one last thing" : "Your School experience"}
          </p>
          <h2 className="text-xl sm:text-2xl font-black text-shText mt-1">
            {completionPrompt ? "How was your experience with this course?" : "How’s Online School going?"}
          </h2>
          <p className="text-[15px] text-shTextMuted mt-1 max-w-2xl">
            {saved
              ? "You can update this anytime. Your latest answers help us improve the course."
              : "Your feedback helps us make Sit Happens Online School clearer, easier, and more useful for the next dog-and-human team."}
          </p>
          {course?.program_name && <p className="text-[14px] text-shTextMuted mt-1"><i className="fas fa-graduation-cap mr-1.5"/>{course.program_name}{course.dog_name ? ` · ${course.dog_name}` : ""}</p>}
        </div>
        {completionPrompt && !expanded && (
          <button type="button" onClick={() => setExpanded(true)} className="min-h-[44px] px-4 rounded-xl bg-shPrimary text-bgHeader text-[14px] font-black uppercase tracking-widest" data-testid="school-experience-open">
            <i className="fas fa-star mr-1.5"/>{saved ? "Update review" : "Rate this course"}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-5 space-y-5" data-testid="school-experience-form">
          <div>
            <p className="text-[14px] font-black text-shText">Overall experience</p>
            <div className="flex gap-1 mt-2" role="radiogroup" aria-label="Overall experience">
              {[1,2,3,4,5].map((n) => (
                <button key={n} type="button" onClick={() => setForm((f) => ({ ...f, overall_rating: n }))}
                        aria-pressed={form.overall_rating === n}
                        aria-label={`${n} star${n === 1 ? "" : "s"}`}
                        className="w-11 h-11 rounded-xl border border-shBorder bg-black/15 text-xl hover:border-shPrimary/40 transition"
                        data-testid={`school-experience-star-${n}`}>
                  <i className={`${n <= form.overall_rating ? "fas text-shPrimary" : "far text-shTextMuted"} fa-star`}/>
                </button>
              ))}
            </div>
          </div>

          <ChoiceGroup title="How easy are the lessons to follow?" options={EASE} value={form.lesson_ease} onChange={(v) => setForm((f) => ({ ...f, lesson_ease: v }))}/>
          <ChoiceGroup title="Do you feel like you and your dog are making progress?" options={PROGRESS} value={form.making_progress} onChange={(v) => setForm((f) => ({ ...f, making_progress: v }))}/>

          <div className="grid sm:grid-cols-2 gap-3">
            <TextArea label="What are you liking most?" value={form.liked_most} onChange={(v) => setForm((f) => ({ ...f, liked_most: v }))} placeholder="A lesson, Practice Coach, the way it’s explained…"/>
            <TextArea label="What could we make better?" value={form.improve} onChange={(v) => setForm((f) => ({ ...f, improve: v }))} placeholder="Anything confusing, missing, too fast, too slow…"/>
          </div>

          <ChoiceGroup title="Would you recommend Sit Happens Online School?" options={RECOMMEND} value={form.recommend} onChange={(v) => setForm((f) => ({ ...f, recommend: v }))}/>

          <label className="flex items-start gap-3 rounded-xl border border-shBorder bg-black/10 p-3 cursor-pointer">
            <input type="checkbox" checked={form.testimonial_permission} onChange={(e) => setForm((f) => ({ ...f, testimonial_permission: e.target.checked }))} className="mt-1" data-testid="school-experience-testimonial"/>
            <span className="text-[15px] text-shTextMuted"><strong className="text-shText">Sit Happens may use my comments as a testimonial.</strong><br/>Leave this unchecked if you want your comments used only as private School feedback.</span>
          </label>

          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={submit} disabled={!valid || busy || !loaded}
                    className="min-h-[46px] px-5 rounded-xl bg-shPrimary text-bgHeader text-[14px] font-black uppercase tracking-widest disabled:opacity-40"
                    data-testid="school-experience-submit">
              <i className="fas fa-paper-plane mr-1.5"/>{busy ? "Saving…" : saved ? "Update feedback" : "Send feedback"}
            </button>
            {saved && <span className="text-[14px] font-bold text-shPrimary"><i className="fas fa-circle-check mr-1"/>Feedback saved</span>}
            {completionPrompt && <button type="button" onClick={() => setExpanded(false)} className="min-h-[44px] px-2 text-[14px] font-black uppercase tracking-widest text-shTextMuted">Close</button>}
          </div>
        </div>
      )}
    </section>
  );
}

function ChoiceGroup({ title, options, value, onChange }) {
  return <div><p className="text-[14px] font-black text-shText">{title}</p><div className="flex flex-wrap gap-2 mt-2">{options.map(([key,label]) => <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key} className={`min-h-[40px] px-3 rounded-xl border text-[14px] font-bold transition ${value === key ? "border-shPrimary/45 bg-shPrimary/10 text-shPrimary" : "border-shBorder bg-black/10 text-shTextMuted hover:text-shText"}`}>{label}</button>)}</div></div>;
}

function TextArea({ label, value, onChange, placeholder }) {
  return <label className="block"><span className="text-[14px] font-black text-shText">{label}</span><textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={5000} rows={4} placeholder={placeholder} className="mt-2 w-full rounded-xl border border-shBorder bg-black/15 p-3 text-[15px] text-shText placeholder:text-shTextMuted/60 resize-y"/></label>;
}
