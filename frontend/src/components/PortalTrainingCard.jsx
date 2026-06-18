import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ProgressRing from "./ProgressRing";
import CollapsibleText from "./CollapsibleText";

/** Per-dog training summary shown on the client portal.
 *  Read-only view of every active enrollment + history + completed certs.
 *  (Was previously only showing ONE active enrollment even when admin had
 *  assigned several — Sprint 83.) */
export default function PortalTrainingCard({ dog }) {
  const [enrollments, setEnrollments] = useState(null);
  const [meta, setMeta] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [m, e] = await Promise.all([
          api.get("/programs/meta"),
          api.get(`/dogs/${dog.id}/programs`),
        ]);
        setMeta(m.data); setEnrollments(e.data);
      } catch { /* ignore */ }
    })();
  }, [dog.id]);

  if (!enrollments || !meta) return null;
  // Show ALL active + on_hold enrollments (not just one). Sort newest-first.
  const live = enrollments
    .filter(e => e.status === "active" || e.status === "on_hold")
    .sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
  const completed = enrollments.filter(e => e.status === "completed");
  const typeByKey = Object.fromEntries(meta.types.map(t => [t.key, t]));

  if (enrollments.length === 0) {
    return (
      <div className="bg-bgPanel rounded-xl border border-bgHover shadow-lg p-5" data-testid={`portal-training-${dog.id}`}>
        <div className="flex items-center gap-3">
          <i className="fas fa-graduation-cap text-gray-600 text-2xl"/>
          <div>
            <p className="text-sm font-black text-white uppercase italic tracking-tight">{dog.name}</p>
            <p className="text-[14px] text-gray-400 mt-1 leading-snug">
              No active training program yet. When {dog.name} starts a program, you&apos;ll see goals, homework, progress notes, and completed skills here.
            </p>
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={() => {
                  const el = document.getElementById("portal-homework-anchor")
                          || document.querySelector('[data-testid="portal-training-section"]');
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                  else window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                data-testid={`portal-training-empty-files-${dog.id}`}
                className="text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-shBlue/15 text-shBlue border border-shBlue/30 hover:bg-shBlue/25 transition">
                <i className="fas fa-folder-open mr-1.5"/>View Training Files
              </button>
              <button
                onClick={() => {
                  // Open the existing portal Messages modal via its header
                  // button — falls back to scrolling if not present.
                  const btn = document.querySelector('[data-testid="portal-messages-button"]');
                  if (btn) btn.click();
                }}
                data-testid={`portal-training-empty-ask-${dog.id}`}
                className="text-[11px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-shGreen/15 text-shGreen border border-shGreen/30 hover:bg-shGreen/25 transition">
                <i className="fas fa-comments mr-1.5"/>Ask About Training
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bgPanel rounded-xl border border-bgHover shadow-lg overflow-hidden" data-testid={`portal-training-${dog.id}`}>
      {live.length === 0 && (
        <div className="px-5 py-4 border-b border-bgHover">
          <p className="text-sm font-black text-white">{dog.name}</p>
          <p className="text-[14px] text-gray-400 mt-1 leading-snug">
            No active training program yet. When {dog.name} starts a program, you&apos;ll see goals, homework, progress notes, and completed skills here.
          </p>
        </div>
      )}

      {/* Render EVERY active/on-hold enrollment — divider between each. */}
      {live.map((enr, idx) => (
        <div key={enr.id} className={idx > 0 ? "border-t-4 border-bgBase" : ""}>
          <ActiveSection
            enrollment={enr}
            typeMeta={typeByKey[enr.program_snapshot.type]}
            dogName={dog.name}
            expanded={expandedId === enr.id}
            setExpanded={(v) => setExpandedId(v ? enr.id : null)}
          />
        </div>
      ))}

      {completed.length > 0 && (
        <div className="px-5 py-3 border-t border-bgHover">
          <p className="text-[15px] font-black uppercase tracking-widest text-shGreen mb-2"><i className="fas fa-flag-checkered mr-2"/>Completed Programs</p>
          <div className="space-y-2">
            {completed.map(c => (
              <div key={c.id} className="bg-bgBase/60 border border-bgHover rounded p-3 flex items-center gap-3">
                <i className="fas fa-medal text-shGreen text-xl shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-black text-white truncate">{c.program_snapshot.name}</p>
                  <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest">Completed {c.completed_at?.slice(0,10)} · {c.mastered_goals}/{c.total_goals} goals mastered</p>
                </div>
                <button onClick={()=>printCertificate(dog, c, typeByKey)} data-testid={`portal-cert-${c.id}`}
                        className="text-[14px] font-black uppercase tracking-widest text-shGreen hover:text-white"><i className="fas fa-print mr-1"/>Cert</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActiveSection({ enrollment, typeMeta, dogName, expanded, setExpanded }) {
  const color = typeMeta?.color || "#00a9e0";
  const snap = enrollment.program_snapshot;
  const onHold = enrollment.status === "on_hold";
  const modulesWithProgress = snap.modules.map(m => ({
    ...m,
    goals: m.goals.map(g => ({ ...g, ...(enrollment.goal_progress?.[g.id] || {}) })),
  }));

  return (
    <>
      <div className="px-4 sm:px-5 py-4 border-b border-bgHover flex items-start gap-3 sm:gap-4" style={{background: color + "08"}}>
        <ProgressRing percent={enrollment.mastered_pct} size={72} stroke={7} color={color}
                      label={`${enrollment.mastered_goals}/${enrollment.total_goals}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-black uppercase tracking-widest" style={{color}}>{typeMeta?.label || snap.type}</p>
            {onHold && (
              <span className="text-[12px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                On Hold
              </span>
            )}
          </div>
          <p className="text-sm sm:text-base font-black text-white uppercase italic tracking-tight">{dogName} · {snap.name}</p>
          {snap.focus && (
            <CollapsibleText text={snap.focus} maxChars={70} className="mt-1"
                             testid={`portal-enrollment-focus-${enrollment.id}`} />
          )}
          <p className="text-[13px] sm:text-[14px] text-gray-500 font-black uppercase tracking-widest mt-2">Started {enrollment.started_at} · {snap.format?.count} {snap.format?.unit}</p>
        </div>
      </div>

      <div className="px-5 py-3 flex justify-between items-center">
        <button onClick={()=>setExpanded(!expanded)} data-testid={`portal-training-toggle-${enrollment.id}`}
                className="text-[15px] font-black uppercase tracking-widest text-shBlue hover:text-white">
          <i className={`fas fa-chevron-${expanded?"up":"down"} mr-2`}/>{expanded?"Hide":"View"} progress
        </button>
      </div>

      {expanded && (
        <div className="px-5 pb-3 space-y-3">
          {modulesWithProgress.map(m => (
            <div key={m.id} className="bg-bgBase/50 border border-bgHover rounded">
              <div className="px-3 py-2 border-b border-bgHover" style={{background: color + "10"}}>
                <p className="text-[15px] font-black uppercase tracking-widest" style={{color}}>{m.name}</p>
              </div>
              <div className="divide-y divide-bgHover">
                {m.goals.map(g => (
                  <div key={g.id} className="px-3 py-2 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-black text-white">{g.name}</p>
                      {g.description && <p className="text-[15px] text-gray-400">{g.description}</p>}
                      {g.notes && <p className="text-[14px] text-gray-500 italic mt-1">Trainer: "{g.notes}"</p>}
                    </div>
                    <GoalChip score={g.score || 0} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function GoalChip({ score }) {
  const colors = ["#475569","#f59e0b","#f97316","#eab308","#84cc16","#22c55e"];
  const labels = ["Not Started","Intro","Learning","Emerging","Proficient","Mastered"];
  const c = colors[score] || colors[0];
  return (
    <span className="shrink-0 text-[14px] font-black uppercase tracking-widest px-2 py-0.5 rounded border"
          style={{color: c, borderColor: c+"80", background: c+"10"}}>
      {score}/5 · {labels[score]}
    </span>
  );
}

// Escape user-controlled text before interpolating into HTML so a malicious
// dog/program name can't execute script in the new tab.
function escHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function printCertificate(dog, enrollment, typeByKey) {
  const snap = enrollment.program_snapshot;
  const tm = typeByKey[snap.type] || { color: "#8cc63f", label: snap.type };
  const today = new Date().toLocaleDateString();
  const completed = (enrollment.completed_at || "").slice(0,10) || today;
  const html = `<!doctype html><html><head><title>${escHtml(dog.name)} · ${escHtml(snap.name)}</title>
    <style>
      @page { size: landscape; margin: 0.5in; }
      body { font-family: Georgia, serif; background:#fff; color:#0f172a; text-align:center; padding:48px 32px; }
      .frame { border: 8px double ${tm.color}; padding: 48px 32px; max-width: 900px; margin: 0 auto; }
      h1 { font-size: 44px; margin: 0 0 12px 0; letter-spacing: 0.05em; }
      h2 { font-size: 22px; margin: 8px 0; color:${tm.color}; }
      .name { font-size: 56px; font-weight: 900; margin: 18px 0; color:#0f172a; }
      .program { font-size: 28px; margin: 8px 0; color:#0f172a; font-style: italic; }
      .desc { font-style: italic; font-size: 17px; margin: 14px 0; color:#475569; }
      .footer { display:flex; justify-content:space-between; margin-top: 40px; padding-top: 14px; border-top: 1px solid #cbd5e1; font-size:14px; color:#64748b; }
    </style></head><body>
    <div class="frame">
      <h2>Sit Happens Dog Training · ${escHtml(tm.label)}</h2>
      <h1>Certificate of Completion</h1>
      <p class="desc">This certifies that</p>
      <p class="name">${escHtml(dog.name)}</p>
      <p class="desc">has successfully completed</p>
      <p class="program">${escHtml(snap.name)}</p>
      <p class="desc">${escHtml(snap.focus || snap.description || "")}</p>
      <p>Mastered <strong>${escHtml(enrollment.mastered_goals)}</strong> of <strong>${escHtml(enrollment.total_goals)}</strong> program goals.</p>
      <div class="footer"><span>Issued ${escHtml(today)}</span><span>Completed ${escHtml(completed)}</span></div>
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
    </body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
