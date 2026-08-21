import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { loadSchoolMediaUrl, openSchoolMedia } from "../../../lib/schoolMedia";

/* An inline demonstration image.
 *
 * These carry real instructional weight in dog training — hand position,
 * lure height, what the wrong shape looks like — so they render as content,
 * not as an attachment: capped so a portrait photo cannot swallow the page,
 * aspect ratio preserved, and the caption tied to the image with <figcaption>
 * rather than floating as a loose paragraph.
 *
 * ALT is the authored accessible description. It is deliberately NOT the
 * caption: a caption adds context a sighted reader also needs, while alt
 * describes the picture itself. When no alt was authored the image is marked
 * decorative (alt="") instead of repeating the caption or inventing a
 * description — a wrong description is worse than none.
 */
function InlineImage({ src, alt, caption, testid }) {
  if (!src) return null;
  return (
    <figure className="my-1" data-testid={testid}>
      <img src={src} alt={alt || ""} loading="lazy"
           className="w-full max-w-full h-auto max-h-[60vh] sm:max-h-[520px] object-contain rounded-xl border border-shBorder/50 bg-black/25" />
      {caption && (
        <figcaption className="mt-2 text-[15px] sm:text-[16px] text-shTextMuted leading-[1.5]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

function SplitLines({ body }) {
  const lines = String(body || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return <ol className="space-y-3">{lines.map((x, i) => <li key={i} className="flex gap-3 text-[17px] sm:text-[18px] text-shText"><span className="w-7 h-7 rounded-full bg-shSecondary/10 border border-shSecondary/25 text-shSecondary text-[12px] font-black grid place-items-center shrink-0">{i + 1}</span><p className="leading-[1.55] pt-0.5">{x}</p></li>)}</ol>;
}

/* A prep checklist the client uses one-handed while a dog waits, so the tap
   target is a real one and the text is readable at arm's length. Ticking a
   box is a personal aid — it deliberately does NOT report progress anywhere,
   because the lesson model does not define these as completion criteria. */
function ChecklistBlock({ block }) {
  const items = block?.items || [];
  const base = block?.id || "checklist";
  return (
    <ul className="space-y-1">
      {items.map((x, i) => {
        const id = `chk-${base}-${i}`;
        return (
          <li key={id}>
            <label htmlFor={id}
                   className="flex items-start gap-3.5 py-2.5 cursor-pointer group">
              <input id={id} type="checkbox"
                     className="mt-0.5 w-6 h-6 shrink-0 rounded-md border-2 border-shSecondary/50 bg-black/25 accent-shPrimary cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase" />
              <span className="min-w-0 flex-1 text-[17px] sm:text-[18px] text-shText leading-[1.5] group-hover:text-white">{x}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
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


function LinkedResourceMedia({ resource, type, title, alt, caption, testid }) {
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
  if (type === "image") return <InlineImage src={src} alt={alt} caption={caption} testid={testid} />;
  return null;
}

/* The lesson's Quick Knowledge Check.
 *
 * Unlike the Module Quiz (server-graded, authoritative, gates advancement),
 * this block's correct answer and explanation are ALREADY in the authored
 * payload — so the client can be told immediately, which is what the redesign
 * asks for wherever existing behaviour permits it. No scoring rule is invented
 * here: this remains reinforcement and never unlocks or blocks anything.
 */
function QuizBlock({ block }) {
  const [answer, setAnswer] = useState("");
  const options = block.items || [];
  const correct = block.config?.correct_answer || null;
  // Free-text reflection has no right answer, so it keeps an explicit submit;
  // a multiple choice question resolves the moment it is answered.
  const [reflected, setReflected] = useState(false);
  const checked = options.length ? !!answer : reflected;
  const isCorrect = correct ? answer === correct : null;

  return (
    <div className="space-y-3">
      {block.body && <p className="text-[14px] sm:text-[15px] font-black text-shText leading-snug">{block.body}</p>}
      {options.length ? (
        <div className="grid gap-2.5">
          {options.map((o) => {
            const on = answer === o;
            const right = checked && correct === o;
            const wrong = checked && on && isCorrect === false;
            return (
              <button key={o} type="button" data-testid={`quick-check-option-${block.id}-${options.indexOf(o)}`}
                      data-selected={on ? "true" : "false"} data-correct={right ? "true" : undefined}
                      onClick={() => setAnswer(o)}
                      className={`w-full text-left rounded-xl border p-3.5 flex items-start gap-3 text-[13.5px] min-h-[56px] transition ${
                        right ? "border-shPrimary/55 bg-shPrimary/[0.09]"
                        : wrong ? "border-shAccent/45 bg-shAccent/[0.06]"
                        : on ? "border-shSecondary/50 bg-shSecondary/[0.07]"
                        : "border-shBorder bg-black/10 hover:border-shSecondary/35"}`}>
                <span className={`w-6 h-6 rounded-full grid place-items-center shrink-0 border text-[10px] mt-0.5 ${
                  right ? "border-shPrimary bg-shPrimary text-[#071018]"
                  : wrong ? "border-shAccent bg-shAccent text-[#071018]"
                  : on ? "border-shSecondary bg-shSecondary text-[#031018]"
                  : "border-shBorder text-transparent"}`}>
                  <i className={`fas ${wrong ? "fa-xmark" : "fa-check"}`} />
                </span>
                <span className="leading-relaxed break-words min-w-0 flex-1 text-shText">{o}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setReflected(false); }} rows={3}
                    className="w-full rounded-xl border border-shBorder bg-black/15 p-3 text-shText text-[13.5px]" placeholder="Your answer" />
          {answer && !reflected && (
            <button type="button" onClick={() => setReflected(true)} data-testid={`quick-check-submit-${block.id}`}
                    className="min-h-[44px] px-4 rounded-xl border border-shSecondary/35 text-shSecondary text-[11px] font-black uppercase tracking-widest">
              Check answer
            </button>
          )}
        </>
      )}

      {checked && (
        <div className={`rounded-xl border p-3.5 ${isCorrect === true ? "border-shPrimary/30 bg-shPrimary/[0.045]" : isCorrect === false ? "border-shAccent/30 bg-shAccent/[0.04]" : "border-shBorder bg-black/10"}`}
             data-testid={`quick-check-feedback-${block.id}`}>
          <p className={`text-[13px] font-black ${isCorrect === true ? "text-shPrimary" : isCorrect === false ? "text-shAccent" : "text-shText"}`}>
            {isCorrect === true ? "That’s it." : isCorrect === false ? "Not quite — here’s why." : "Response recorded for your own reflection."}
          </p>
          {isCorrect === false && correct && (
            <p className="text-[12.5px] text-shText mt-1.5"><i className="fas fa-circle-check text-shPrimary mr-1.5" />{correct}</p>
          )}
          {block.config?.explanation && <p className="text-[12.5px] text-shTextMuted mt-2 leading-relaxed">{block.config.explanation}</p>}
          <p className="text-[10px] text-shTextMuted mt-2.5">Knowledge checks reinforce the lesson; they do not unlock or block course progression.</p>
          {isCorrect === false && (
            <button type="button" onClick={() => setAnswer("")} data-testid={`quick-check-retry-${block.id}`}
                    className="mt-2.5 text-[11px] font-black text-shSecondary underline underline-offset-2">Try again</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LessonContentBlocks({ blocks = [], enrollmentId, previewMode = false, hideTitles = false }) {
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
      {b.title && !hideTitles && <h3 className={`text-[18px] sm:text-[20px] font-black leading-snug mb-2.5 ${b.type === "warning" ? "text-red-300" : b.type === "trainer_tip" ? "text-shPrimary" : "text-shText"}`}>{b.title}</h3>}
      {b.type === "video" && b.url && <div className="aspect-video rounded-xl overflow-hidden bg-black"><video src={b.url} controls playsInline preload="metadata" className="w-full h-full object-contain" /></div>}
      {b.type === "image" && b.url && <InlineImage src={b.url} alt={b.config?.alt} caption={b.config?.caption} testid={`lesson-image-${b.id || i}`} />}
      {b.resource_id && resourceById[b.resource_id] && ["video","image"].includes(b.type) && <LinkedResourceMedia resource={resourceById[b.resource_id]} type={b.type} title={b.title} alt={b.config?.alt} caption={b.config?.caption} testid={`lesson-image-${b.id || i}`} />}
      {b.resource_id && resourceById[b.resource_id] && b.type === "download" && <button type="button" onClick={() => openResource(resourceById[b.resource_id])} className="w-full text-left rounded-xl border border-shSecondary/20 bg-shSecondary/[0.035] p-3"><i className="fas fa-download text-shSecondary mr-2"/><span className="text-[13px] font-black text-shText">{resourceById[b.resource_id].title}</span><span className="block text-[11px] text-shTextMuted mt-1">Open School resource</span></button>}
      {previewMode && b.resource_id && !resourceById[b.resource_id] && ["video","image","download"].includes(b.type) && <div className="rounded-xl border border-dashed border-shSecondary/25 bg-shSecondary/[0.025] p-3"><i className={`fas ${b.type === "video" ? "fa-video" : b.type === "image" ? "fa-image" : "fa-download"} text-shSecondary mr-2`}/><span className="text-[13px] font-black text-shText">{b.title || "Linked School resource"}</span><span className="block text-[11px] text-shTextMuted mt-1">The selected resource will appear here for enrolled students.</span></div>}
      {b.type === "steps" && <SplitLines body={(b.items || []).length ? b.items.join("\n") : b.body} />}
      {b.type === "checklist" && <ChecklistBlock block={b} />}
      {b.type === "quiz" && <QuizBlock block={b} />}
      {b.type === "timer" && <TimerBlock block={b} />}
      {b.type === "rep_counter" && <RepBlock block={b} />}
      {b.type === "download" && !b.resource_id && <a href={b.url || "#"} target="_blank" rel="noreferrer" className="inline-flex min-h-[42px] items-center px-4 rounded-xl border border-shSecondary/35 text-shSecondary text-[11px] font-black uppercase tracking-widest"><i className="fas fa-download mr-2"/>Open resource</a>}
      {["text","trainer_tip","warning","practice","checkpoint"].includes(b.type) && b.body && <p className="text-[17px] sm:text-[18px] text-shText leading-[1.55] whitespace-pre-line">{b.body}</p>}
    </section>;
  })}</div>;
}
