import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ProgressRing from "./ProgressRing";
import CollapsibleText from "./CollapsibleText";

/** Per-dog training summary shown on the client portal.
 *  Read-only view of the dog's active enrollment + history + completed certs. */
export default function PortalTrainingCard({ dog }) {
  const [enrollments, setEnrollments] = useState(null);
  const [meta, setMeta] = useState(null);
  const [expanded, setExpanded] = useState(false);

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
  const active = enrollments.find(e => e.status === "active");
  const completed = enrollments.filter(e => e.status === "completed");
  const typeByKey = Object.fromEntries(meta.types.map(t => [t.key, t]));

  if (enrollments.length === 0) {
    return (
      <div className="bg-bgPanel rounded-xl border border-bgHover shadow-lg p-5" data-testid={`portal-training-${dog.id}`}>
        <div className="flex items-center gap-3">
          <i className="fas fa-graduation-cap text-gray-600 text-2xl"/>
          <div>
            <p className="text-sm font-black text-white uppercase italic tracking-tight">{dog.name}</p>
            <p className="text-[13px] text-gray-500">Not currently enrolled in a training program.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bgPanel rounded-xl border border-bgHover shadow-lg overflow-hidden" data-testid={`portal-training-${dog.id}`}>
      {active && <ActiveSection enrollment={active} typeMeta={typeByKey[active.program_snapshot.type]}
                                  dogName={dog.name} expanded={expanded} setExpanded={setExpanded} />}
      {!active && (
        <div className="px-5 py-4 border-b border-bgHover">
          <p className="text-sm font-black text-white">{dog.name}</p>
          <p className="text-[13px] text-gray-500">No active program — see completed programs below.</p>
        </div>
      )}

      {completed.length > 0 && (
        <div className="px-5 py-3 border-t border-bgHover">
          <p className="text-[13px] font-black uppercase tracking-widest text-shGreen mb-2"><i className="fas fa-flag-checkered mr-2"/>Completed Programs</p>
          <div className="space-y-2">
            {completed.map(c => (
              <div key={c.id} className="bg-bgBase/60 border border-bgHover rounded p-3 flex items-center gap-3">
                <i className="fas fa-medal text-shGreen text-xl shrink-0"/>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-black text-white truncate">{c.program_snapshot.name}</p>
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Completed {c.completed_at?.slice(0,10)} · {c.mastered_goals}/{c.total_goals} goals mastered</p>
                </div>
                <button onClick={()=>printCertificate(dog, c, typeByKey)} data-testid={`portal-cert-${c.id}`}
                        className="text-[12px] font-black uppercase tracking-widest text-shGreen hover:text-white"><i className="fas fa-print mr-1"/>Cert</button>
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
  const homework = []; // not tied to programs currently — leave for future
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
          <p className="text-[11px] font-black uppercase tracking-widest" style={{color}}>{typeMeta?.label || snap.type}</p>
          <p className="text-sm sm:text-base font-black text-white uppercase italic tracking-tight">{dogName} · {snap.name}</p>
          {snap.focus && (
            <CollapsibleText text={snap.focus} maxChars={70} className="mt-1"
                             testid={`portal-enrollment-focus-${enrollment.id}`} />
          )}
          <p className="text-[11px] sm:text-[12px] text-gray-500 font-black uppercase tracking-widest mt-2">Started {enrollment.started_at} · {snap.format?.count} {snap.format?.unit}</p>
        </div>
      </div>

      <div className="px-5 py-3 flex justify-between items-center border-b border-bgHover">
        <button onClick={()=>setExpanded(e=>!e)} data-testid={`portal-training-toggle-${enrollment.id}`}
                className="text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-white">
          <i className={`fas fa-chevron-${expanded?"up":"down"} mr-2`}/>{expanded?"Hide":"View"} progress
        </button>
      </div>

      {expanded && (
        <div className="px-5 py-3 space-y-3">
          {modulesWithProgress.map(m => (
            <div key={m.id} className="bg-bgBase/50 border border-bgHover rounded">
              <div className="px-3 py-2 border-b border-bgHover" style={{background: color + "10"}}>
                <p className="text-[13px] font-black uppercase tracking-widest" style={{color}}>{m.name}</p>
              </div>
              <div className="divide-y divide-bgHover">
                {m.goals.map(g => (
                  <div key={g.id} className="px-3 py-2 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-black text-white">{g.name}</p>
                      {g.description && <p className="text-[13px] text-gray-400">{g.description}</p>}
                      {g.notes && <p className="text-[12px] text-gray-500 italic mt-1">Trainer: "{g.notes}"</p>}
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
    <span className="shrink-0 text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border"
          style={{color: c, borderColor: c+"80", background: c+"10"}}>
      {score}/5 · {labels[score]}
    </span>
  );
}

function printCertificate(dog, enrollment, typeByKey) {
  const snap = enrollment.program_snapshot;
  const tm = typeByKey[snap.type] || { color: "#8cc63f", label: snap.type };
  const win = window.open("", "_blank", "noopener");
  if (!win) return;
  const today = new Date().toLocaleDateString();
  const completed = (enrollment.completed_at || "").slice(0,10) || today;
  win.document.write(`<!doctype html><html><head><title>${dog.name} · ${snap.name}</title>
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
      <h2>Sit Happens Dog Training · ${tm.label}</h2>
      <h1>Certificate of Completion</h1>
      <p class="desc">This certifies that</p>
      <p class="name">${dog.name}</p>
      <p class="desc">has successfully completed</p>
      <p class="program">${snap.name}</p>
      <p class="desc">${snap.focus || snap.description || ""}</p>
      <p>Mastered <strong>${enrollment.mastered_goals}</strong> of <strong>${enrollment.total_goals}</strong> program goals.</p>
      <div class="footer"><span>Issued ${today}</span><span>Completed ${completed}</span></div>
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
    </body></html>`);
  win.document.close();
}
