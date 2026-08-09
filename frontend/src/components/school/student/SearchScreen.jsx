import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { openSchoolMedia } from "../../../lib/schoolMedia";

export default function SearchScreen({ enrollmentId, onOpenLesson, onFeedback }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2 || !enrollmentId) { setData(null); setLoading(false); return undefined; }
    setLoading(true);
    const id = setTimeout(() => {
      api.get(`/portal/school/${enrollmentId}/search`, { params: { q: needle } })
        .then((r) => setData(r.data || { lessons: [], resources: [], feedback: [], total: 0 }))
        .catch(() => setData({ lessons: [], resources: [], feedback: [], total: 0, error: true }))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(id);
  }, [q, enrollmentId]);

  const openResource = async (r) => {
    if (r.url) { window.open(r.url, "_blank", "noopener,noreferrer"); return; }
    if (r.media_id) {
      try { await openSchoolMedia(r.media_id); } catch { /* keep School usable */ }
    }
  };

  const groups = [
    { key: "lessons", title: "Lessons", icon: "fa-book-open", rows: data?.lessons || [], click: (r) => onOpenLesson?.(r.lesson_id) },
    { key: "resources", title: "Resources", icon: "fa-folder-open", rows: data?.resources || [], click: openResource },
    { key: "feedback", title: "Trainer Feedback", icon: "fa-comment-dots", rows: data?.feedback || [], click: () => onFeedback?.() },
  ];

  return <div className="max-w-3xl mx-auto space-y-5" data-testid="school-search-screen">
    <header><p className="text-[10px] font-black uppercase tracking-[0.22em] text-shSecondary">Find it fast</p><h1 className="text-2xl sm:text-3xl font-black text-shText mt-1">Search your School</h1><p className="text-[13px] text-shTextMuted mt-1">Search lessons you've reached, training resources, and your trainer's feedback for this dog.</p></header>
    <div className="relative"><i className="fas fa-search absolute left-4 top-4 text-shSecondary"/><input autoFocus value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Try place, leash pressure, distractions…" className="w-full min-h-[52px] rounded-2xl border border-shBorder bg-black/20 pl-11 pr-4 text-[14px] text-shText focus:outline-none focus:border-shSecondary/50"/></div>
    {q.trim().length < 2 ? <div className="rounded-2xl border border-dashed border-shBorder p-8 text-center text-sm text-shTextMuted">Type at least 2 characters to search this dog's School history.</div> : loading ? <div className="h-36 rounded-2xl bg-shBorder/20 animate-pulse"/> : data?.error ? <div className="rounded-2xl border border-shAccent/25 p-5 text-sm text-shAccent">Search could not load. Try again.</div> : data?.total === 0 ? <div className="rounded-2xl border border-dashed border-shBorder p-8 text-center text-sm text-shTextMuted">No School results match “{q.trim()}”.</div> : groups.map(g => g.rows.length > 0 && <section key={g.key} className="space-y-2"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-shTextMuted"><i className={`fas ${g.icon} mr-1.5 text-shSecondary`}/>{g.title} · {g.rows.length}</p>{g.rows.map((r,i)=><button key={r.id||r.lesson_id||r.checkpoint_id||i} onClick={()=>g.click(r)} className="w-full text-left rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 hover:border-shSecondary/35"><div className="flex justify-between gap-3"><div className="min-w-0"><p className="text-[13px] font-black text-shText">{r.title}</p>{(r.module_name||r.state)&&<p className="text-[10px] uppercase tracking-widest font-black text-shSecondary mt-1">{[r.module_name,r.state].filter(Boolean).join(" · ")}</p>}<p className="text-[12px] text-shTextMuted mt-1 line-clamp-2">{r.summary}</p></div><i className="fas fa-arrow-right text-shTextMuted mt-1"/></div></button>)}</section>) }
  </div>;
}
