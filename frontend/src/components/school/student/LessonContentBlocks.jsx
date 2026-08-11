import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { loadSchoolMediaUrl, openSchoolMedia } from "../../../lib/schoolMedia";

function SplitLines({ body }) {
  const lines = String(body || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return <div className="space-y-2">{lines.map((x, i) => <div key={i} className="flex gap-2 text-[13px] text-shText"><span className="w-6 h-6 rounded-full bg-shSecondary/10 border border-shSecondary/25 text-shSecondary text-[10px] font-black grid place-items-center shrink-0">{i + 1}</span><p className="leading-relaxed pt-0.5">{x}</p></div>)}</div>;
}

function TimerBlock({ block }) {
  const total = Number(block.config?.seconds || 60);
  const [left, setLeft] = useState(total);
  const [running, setRunning] = useState(false);
  const mins = String(Math.floor(left / 60)).padStart(2, "0");
  const secs = String(left % 60).padStart(2, "0");
  useEffect(() => {
    if (!running || left <= 0) return undefined;
    const id = setTimeout(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(id);
  }, [running, left]);
  return <div className="flex flex-wrap items-center gap-3"><div className="text-3xl font-black text-shText tabular-nums">{mins}:{secs}</div><button onClick={() => setRunning((v) => !v)} className="min-h-[42px] px-4 rounded-xl bg-shSecondary text-[#031018] text-[11px] font-black uppercase tracking-widest">{running ? "Pause" : "Start"}</button><button onClick={() => { setRunning(false); setLeft(total); }} className="min-h-[42px] px-3 rounded-xl border border-shBorder text-[11px] font-black text-shTextMuted">Reset</button></div>;
}

function RepBlock({ block }) {
  const target = Number(block.config?.target || 5);
  const [count, setCount] = useState(0);
  return <div className="flex items-center gap-4"><button onClick={() => setCount((c) => Math.min(target, c + 1))} className="w-14 h-14 rounded-2xl bg-shPrimary text-[#071018] text-xl font-black">+1</button><div><p className="text-2xl font-black text-shText">{count} / {target}</p><p className="text-[11px] text-shTextMuted">repetitions</p></div><button onClick={() => setCount(0)} className="text-[11px] font-black text-shTextMuted uppercase tracking-widest">Reset</button></div>;
}


function LinkedResourceMedia({ resource, type, title }) {
  const [src, setSrc] = useState(resource?.url || "");
  useEffect(() => {
    if (!resource?.media_id) { setSrc(resource?.url || ""); return undefined; }
    let live = true; let cleanup = () => {};
    loadSchoolMediaUrl(resource.media_id).then((media) => {
      if (!live) { media.revoke(); return; }
      cleanup = media.revoke; setSrc(media.url);
    }).catch(() => setSrc(""));
    return () => { live = false; cleanup(); };
  }, [resource?.media_id, resource?.url]);
  if (!src) return <div className="rounded-xl border border-dashed border-shBorder p-3 text-[11px] text-shTextMuted"><i className="fas fa-spinner fa-spin mr-2"/>Loading School media…</div>;
  if (type === "video") return <div className="aspect-video rounded-xl overflow-hidden bg-black"><video src={src} controls playsInline preload="metadata" className="w-full h-full object-contain" /></div>;
  if (type === "image") return <img src={src} alt={title || resource?.title || "Lesson visual"} className="w-full max-h-[520px] object-contain rounded-xl bg-black/20" />;
  return null;
}

function QuizBlock({ block }) {
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState(false);
  const options = block.items || [];
  const correct = block.config?.correct_answer || null;
  const isCorrect = correct ? answer === correct : null;
  const choose = (value) => { setAnswer(value); setChecked(false); };
  return <div className="space-y-2">{block.body && <p className="text-[13px] text-shText leading-relaxed">{block.body}</p>}{options.length ? <div className="grid gap-2">{options.map((o) => <label key={o} className={`rounded-xl border p-3 flex items-center gap-2 text-[13px] text-shText ${checked && correct === o ? "border-shPrimary/45 bg-shPrimary/[0.06]" : checked && answer === o && isCorrect === false ? "border-shAccent/40 bg-shAccent/[0.05]" : "border-shBorder bg-black/10"}`}><input type="radio" name={`quiz-${block.id}`} value={o} checked={answer === o} onChange={() => choose(o)} />{o}</label>)}</div> : <textarea value={answer} onChange={(e) => choose(e.target.value)} rows={2} className="w-full rounded-xl border border-shBorder bg-black/15 p-3 text-shText" placeholder="Your answer" />}{answer && <button onClick={() => setChecked(true)} className="min-h-[40px] px-3 rounded-xl border border-shSecondary/30 text-shSecondary text-[11px] font-black uppercase tracking-widest">Check answer</button>}{checked && <div className={`rounded-xl border p-3 ${isCorrect === true ? "border-shPrimary/30 bg-shPrimary/[0.045]" : isCorrect === false ? "border-shAccent/30 bg-shAccent/[0.04]" : "border-shBorder bg-black/10"}`}><p className={`text-[12px] font-black ${isCorrect === true ? "text-shPrimary" : isCorrect === false ? "text-shAccent" : "text-shText"}`}>{isCorrect === true ? "That’s it." : isCorrect === false ? "Not quite — review this point and try again." : "Response recorded for your own reflection."}</p>{block.config?.explanation && <p className="text-[11px] text-shTextMuted mt-1">{block.config.explanation}</p>}<p className="text-[10px] text-shTextMuted mt-2">Knowledge checks reinforce the lesson; they do not unlock or block course progression.</p></div>}</div>;
}

export default function LessonContentBlocks({ blocks = [], enrollmentId, previewMode = false }) {
  const [resources, setResources] = useState([]);
  const active = [...blocks].filter((b) => b?.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  const resourceIds = useMemo(() => active.map((b) => b.resource_id).filter(Boolean), [active]);
  const resourceKey = resourceIds.join("|");
  useEffect(() => {
    if (resourceKey === "") { setResources([]); return undefined; }
    let live = true;
    const request = enrollmentId ? api.get(`/portal/school/${enrollmentId}/resources`) : previewMode ? api.get("/admin/school/resources") : null;
    if (!request) { setResources([]); return undefined; }
    request.then(({data}) => { if (live) setResources((data || []).filter((r) => r.active !== false)); }).catch(() => { if (live) setResources([]); });
    return () => { live = false; };
  }, [enrollmentId, previewMode, resourceKey]);
  const resourceById = Object.fromEntries(resources.map((r) => [r.id, r]));
  const openResource = async (r) => {
    if (!r) return; if (r.url) { window.open(r.url, "_blank", "noopener,noreferrer"); return; }
    if (r.media_id) { try { await openSchoolMedia(r.media_id); } catch { /* ignore */ } }
  };
  if (!active.length) return null;
  return <div className="space-y-4" data-testid="lesson-content-blocks">{active.map((b, i) => {
    const tone = b.type === "warning" ? "border-red-400/30 bg-red-500/[0.055]" : b.type === "trainer_tip" ? "border-shPrimary/30 bg-shPrimary/[0.055]" : "border-shBorder bg-[var(--sh-card-base)]";
    return <section key={b.id || i} className={`rounded-2xl border p-4 sm:p-5 ${tone}`} data-testid={`lesson-content-block-${b.type}`}>
      {b.title && <p className={`text-[10px] font-black uppercase tracking-[0.18em] mb-2 ${b.type === "warning" ? "text-red-300" : b.type === "trainer_tip" ? "text-shPrimary" : "text-shSecondary"}`}>{b.title}</p>}
      {b.type === "video" && b.url && <div className="aspect-video rounded-xl overflow-hidden bg-black"><video src={b.url} controls playsInline preload="metadata" className="w-full h-full object-contain" /></div>}
      {b.type === "image" && b.url && <img src={b.url} alt={b.title || "Lesson visual"} className="w-full max-h-[520px] object-contain rounded-xl bg-black/20" />}
      {b.resource_id && resourceById[b.resource_id] && ["video","image"].includes(b.type) && <LinkedResourceMedia resource={resourceById[b.resource_id]} type={b.type} title={b.title} />}
      {b.resource_id && resourceById[b.resource_id] && b.type === "download" && <button type="button" onClick={() => openResource(resourceById[b.resource_id])} className="w-full text-left rounded-xl border border-shSecondary/20 bg-shSecondary/[0.035] p-3"><i className="fas fa-download text-shSecondary mr-2"/><span className="text-[13px] font-black text-shText">{resourceById[b.resource_id].title}</span><span className="block text-[11px] text-shTextMuted mt-1">Open School resource</span></button>}
      {previewMode && b.resource_id && !resourceById[b.resource_id] && ["video","image","download"].includes(b.type) && <div className="rounded-xl border border-dashed border-shSecondary/25 bg-shSecondary/[0.025] p-3"><i className={`fas ${b.type === "video" ? "fa-video" : b.type === "image" ? "fa-image" : "fa-download"} text-shSecondary mr-2`}/><span className="text-[13px] font-black text-shText">{b.title || "Linked School resource"}</span><span className="block text-[11px] text-shTextMuted mt-1">The selected resource will appear here for enrolled students.</span></div>}
      {b.type === "steps" && <SplitLines body={(b.items || []).length ? b.items.join("\n") : b.body} />}
      {b.type === "checklist" && <div className="space-y-2">{(b.items || []).map((x) => <label key={x} className="flex items-start gap-2 text-[13px] text-shText"><input type="checkbox" className="mt-1" />{x}</label>)}</div>}
      {b.type === "quiz" && <QuizBlock block={b} />}
      {b.type === "timer" && <TimerBlock block={b} />}
      {b.type === "rep_counter" && <RepBlock block={b} />}
      {b.type === "download" && !b.resource_id && <a href={b.url || "#"} target="_blank" rel="noreferrer" className="inline-flex min-h-[42px] items-center px-4 rounded-xl border border-shSecondary/35 text-shSecondary text-[11px] font-black uppercase tracking-widest"><i className="fas fa-download mr-2"/>Open resource</a>}
      {["text","trainer_tip","warning","practice","checkpoint"].includes(b.type) && b.body && <p className="text-[13px] sm:text-[14px] text-shText leading-relaxed whitespace-pre-line">{b.body}</p>}
    </section>;
  })}</div>;
}
