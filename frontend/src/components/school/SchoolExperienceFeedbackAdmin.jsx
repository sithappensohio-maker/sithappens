import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import EmptyState from "../premium/EmptyState";

const pretty = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (value) => {
  if (!value) return "";
  try { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return ""; }
};

export default function SchoolExperienceFeedbackAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [recommend, setRecommend] = useState("all");
  const [rating, setRating] = useState("all");

  const load = useCallback(async () => {
    try {
      setError("");
      const params = {};
      if (recommend !== "all") params.recommend = recommend;
      if (rating !== "all") params.min_rating = Number(rating);
      const { data: result } = await api.get("/admin/school/experience-feedback", { params });
      setData(result || { summary: {}, items: [] });
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not load School feedback.");
      setData({ summary: {}, items: [] });
    }
  }, [recommend, rating]);

  useEffect(() => { setData(null); load(); }, [load]);

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return data?.items || [];
    return (data?.items || []).filter((r) => [r.client_name, r.client_email, r.dog_name, r.program_name, r.liked_most, r.improve]
      .some((v) => String(v || "").toLowerCase().includes(needle)));
  }, [data, query]);

  if (data === null) return <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{[1,2,3,4].map((n)=><div key={n} className="h-24 rounded-2xl bg-shBorder/20 animate-pulse"/>)}</div>;

  const s = data.summary || {};
  return (
    <div className="space-y-4" data-testid="school-client-feedback-admin">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-shSecondary">School experience</p>
        <h2 className="text-2xl font-black text-shText mt-1">Client Feedback</h2>
        <p className="text-[13px] text-shTextMuted mt-1 max-w-3xl">What clients say about the course experience itself. This is separate from checkpoint grades, trainer notes, and Ask Trainer conversations.</p>
      </div>

      {error && <div className="rounded-xl border border-shAccent/35 bg-shAccent/10 p-3 text-[12px] text-shAccent">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" data-testid="school-client-feedback-stats">
        <Stat icon="fa-star" value={s.average_rating == null ? "—" : `${s.average_rating}/5`} label="Overall rating" />
        <Stat icon="fa-thumbs-up" value={s.recommend_yes_pct == null ? "—" : `${s.recommend_yes_pct}%`} label="Would recommend" />
        <Stat icon="fa-book-open-reader" value={s.easy_to_follow_pct == null ? "—" : `${s.easy_to_follow_pct}%`} label="Easy to follow" />
        <Stat icon="fa-arrow-trend-up" value={s.making_progress_pct == null ? "—" : `${s.making_progress_pct}%`} label="Making progress" />
        <Stat icon="fa-comments" value={s.responses ?? 0} label="Responses" detail={`${s.testimonial_permissions || 0} testimonial OK`} />
      </div>

      <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-3 flex flex-col md:flex-row gap-2 md:items-center">
        <div className="relative flex-1 min-w-0">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-shTextMuted text-xs"/>
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search client, dog, course, or comments…" className="w-full min-h-[42px] rounded-xl border border-shBorder bg-black/15 pl-9 pr-3 text-[12px] text-shText" data-testid="school-client-feedback-search"/>
        </div>
        <select value={recommend} onChange={(e)=>setRecommend(e.target.value)} className="min-h-[42px] rounded-xl border border-shBorder bg-[var(--sh-card-base)] px-3 text-[12px] text-shText" data-testid="school-client-feedback-recommend-filter">
          <option value="all">All recommendations</option><option value="yes">Would recommend</option><option value="maybe">Maybe</option><option value="no">Would not recommend</option>
        </select>
        <select value={rating} onChange={(e)=>setRating(e.target.value)} className="min-h-[42px] rounded-xl border border-shBorder bg-[var(--sh-card-base)] px-3 text-[12px] text-shText" data-testid="school-client-feedback-rating-filter">
          <option value="all">All ratings</option><option value="5">5 stars</option><option value="4">4+ stars</option><option value="3">3+ stars</option><option value="2">2+ stars</option><option value="1">1+ stars</option>
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="fa-star" accent="cyan" title="No client feedback yet" description="Submitted School experience reviews will appear here." />
      ) : (
        <div className="space-y-3" data-testid="school-client-feedback-list">
          {items.map((r) => <ReviewCard key={r.id} review={r} onChanged={load}/>) }
        </div>
      )}
    </div>
  );
}

function Stat({ icon, value, label, detail }) {
  return <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4"><i className={`fas ${icon} text-shSecondary text-sm`}/><p className="text-2xl font-black text-shText mt-2">{value}</p><p className="text-[9px] font-black uppercase tracking-widest text-shTextMuted mt-1">{label}</p>{detail&&<p className="text-[10px] text-shTextMuted mt-1">{detail}</p>}</div>;
}

function ReviewCard({ review: r, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Storefront featuring — the explicit admin act that publishes a
  // permission-granted quote on the public Online School page. The server
  // refuses featuring without testimonial_permission, and the public
  // endpoint re-checks BOTH flags on every read, so a client revoking
  // permission unpublishes instantly even while this stays toggled on.
  const toggleFeature = async () => {
    setBusy(true); setErr("");
    try {
      await api.put(`/admin/school/experience-feedback/${encodeURIComponent(r.id)}/feature`, { featured: !r.storefront_featured });
      onChanged?.();
    } catch (e) {
      setErr(typeof e?.response?.data?.detail === "string" ? e.response.data.detail : "Couldn't update this testimonial.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid={`school-client-feedback-${r.id}`}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-black text-shText">{r.client_name || "Client"}</p>
            {r.dog_name && <span className="text-[10px] font-black uppercase tracking-widest text-shPrimary">· {r.dog_name}</span>}
            {r.testimonial_permission && <span className="rounded-full border border-shPrimary/30 bg-shPrimary/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-quote-left mr-1"/>Testimonial OK</span>}
            {r.storefront_featured && <span className="rounded-full border border-shSecondary/35 bg-shSecondary/10 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-shSecondary" data-testid={`school-client-feedback-featured-${r.id}`}><i className="fas fa-store mr-1"/>On storefront</span>}
          </div>
          <p className="text-[11px] text-shTextMuted mt-1">{[r.program_name, fmt(r.updated_at)].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0" aria-label={`${r.overall_rating || 0} out of 5 stars`}>
          {[1,2,3,4,5].map((n)=><i key={n} className={`${n <= Number(r.overall_rating || 0) ? "fas text-shPrimary" : "far text-shTextMuted"} fa-star`}/>) }
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        <Mini label="Lessons" value={pretty(r.lesson_ease)} />
        <Mini label="Progress" value={pretty(r.making_progress)} />
        <Mini label="Recommend" value={pretty(r.recommend)} />
        <Mini label="Submitted at" value={r.course_completed_at_submission ? "Course complete" : "During course"} />
      </div>

      {(r.liked_most || r.improve) && <div className="grid md:grid-cols-2 gap-3 mt-4">
        {r.liked_most && <QuoteBlock title="What they like most" text={r.liked_most}/>}
        {r.improve && <QuoteBlock title="What could be better" text={r.improve}/>}
      </div>}
      {r.testimonial_permission && r.liked_most && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={toggleFeature} disabled={busy} data-testid={`school-client-feedback-feature-${r.id}`}
                  className={`min-h-[40px] px-4 rounded-xl text-[10.5px] font-black uppercase tracking-widest border transition ${r.storefront_featured ? "border-shSecondary/45 bg-shSecondary/10 text-shSecondary" : "border-shBorder text-shTextMuted hover:text-shText hover:border-shSecondary/40"} ${busy ? "opacity-60 cursor-wait" : ""}`}>
            <i className={`fas ${r.storefront_featured ? "fa-store-slash" : "fa-store"} mr-1.5`}/>
            {r.storefront_featured ? "Remove from storefront" : "Feature on storefront"}
          </button>
          <span className="text-[10.5px] text-shTextMuted">The "what they like most" quote appears on the public Online School page.</span>
          {err && <span className="text-[10.5px] text-shAccent">{err}</span>}
        </div>
      )}
      {Number(r.revision || 1) > 1 && <p className="text-[10px] text-shTextMuted mt-3"><i className="fas fa-clock-rotate-left mr-1"/>Client has updated this review {r.revision - 1} time{r.revision - 1 === 1 ? "" : "s"}; the current answer is shown here.</p>}
    </article>
  );
}

function Mini({ label, value }) { return <div className="rounded-xl border border-shBorder/70 bg-black/10 p-2.5"><p className="text-[9px] font-black uppercase tracking-widest text-shTextMuted">{label}</p><p className="text-[12px] font-black text-shText mt-1">{value || "—"}</p></div>; }
function QuoteBlock({ title, text }) { return <div className="rounded-xl border border-shBorder/70 bg-black/10 p-3"><p className="text-[9px] font-black uppercase tracking-widest text-shSecondary">{title}</p><p className="text-[13px] text-shText mt-2 whitespace-pre-wrap leading-relaxed">{text}</p></div>; }
