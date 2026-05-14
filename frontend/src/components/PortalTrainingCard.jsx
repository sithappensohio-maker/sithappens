import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ProgressRing from "./ProgressRing";

/** Per-dog training summary shown on the client portal.
 *  Read-only view of curriculum + progress ring + badges + flagged homework commands. */
export default function PortalTrainingCard({ dog }) {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [m, t] = await Promise.all([
          api.get("/training/meta"),
          api.get(`/dogs/${dog.id}/training`),
        ]);
        setMeta(m.data); setData(t.data);
      } catch { /* ignore */ }
    })();
  }, [dog.id]);

  if (!data || !meta) return null;
  const scaleByValue = Object.fromEntries(meta.scale.map(s => [s.value, s]));
  const flagged = data.items.filter(i => i.in_homework);
  const grouped = meta.categories.map(c => ({
    ...c,
    items: data.items.filter(i => i.command.category === c.key),
  }));

  return (
    <div className="bg-bgPanel rounded-xl border border-bgHover shadow-lg overflow-hidden" data-testid={`portal-training-${dog.id}`}>
      <div className="px-5 py-4 border-b border-bgHover flex items-center gap-4">
        <ProgressRing percent={data.progress.overall.mastered_pct} size={88} stroke={8} color="#8cc63f"
                      label={`${data.progress.overall.mastered}/${data.progress.overall.total}`} />
        <div className="flex-1 min-w-0">
          <h4 className="text-base font-black text-white uppercase italic tracking-tight">{dog.name}</h4>
          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">Service-Dog Curriculum</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3">
            {data.progress.by_category.map(c => (
              <div key={c.key} className="text-[13px] flex items-center justify-between">
                <span className="font-black uppercase tracking-widest" style={{color: c.color}}>{c.label}</span>
                <span className="text-white font-black">{c.mastered_pct}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.badges.length > 0 && (
        <div className="px-5 py-3 border-b border-bgHover flex flex-wrap gap-2" data-testid={`portal-badges-${dog.id}`}>
          {data.badges.map(b => (
            <div key={b.key} className="rounded px-2 py-1 border flex items-center gap-2" style={{borderColor: b.color+"80", background: b.color+"15"}}>
              <i className="fas fa-medal" style={{color: b.color}}/>
              <span className="text-[13px] font-black uppercase tracking-widest" style={{color: b.color}}>{b.title}</span>
            </div>
          ))}
        </div>
      )}

      {flagged.length > 0 && (
        <div className="px-5 py-3 bg-shOrange/5 border-b border-bgHover">
          <p className="text-[13px] font-black uppercase tracking-widest text-shOrange mb-2"><i className="fas fa-house mr-2"/>Practice This Week</p>
          <ul className="space-y-1">
            {flagged.map(it => (
              <li key={it.command.id} className="text-[14px] text-gray-200">
                <span className="font-black">{it.command.name}</span>
                <span className="text-gray-500"> — {it.command.description}</span>
                {it.notes && <p className="text-[13px] text-gray-400 italic ml-4">"{it.notes}"</p>}
                {it.command.video_url && (
                  <a href={it.command.video_url} target="_blank" rel="noopener noreferrer"
                     className="ml-4 inline-block text-[13px] font-black uppercase tracking-widest text-red-400"><i className="fab fa-youtube mr-1"/>watch demo</a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-5 py-3 flex justify-between items-center">
        <button onClick={()=>setExpanded(e=>!e)} data-testid={`portal-training-toggle-${dog.id}`}
                className="text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-white">
          <i className={`fas fa-chevron-${expanded?"up":"down"} mr-2`}/>{expanded?"Hide":"View"} full curriculum
        </button>
        {data.badges.find(b => b.tier === "Gold" || b.tier === "Silver" || b.tier === "Bronze") && (
          <button onClick={()=>printCertificate(dog, data)} data-testid={`portal-cert-${dog.id}`}
                  className="text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-white">
            <i className="fas fa-print mr-2"/>Print Certificate
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-5 pb-5 space-y-3">
          {grouped.map(g => (
            <div key={g.key} className="bg-bgBase/50 border border-bgHover rounded">
              <div className="px-3 py-2 border-b border-bgHover" style={{background: g.color + "10"}}>
                <p className="text-[13px] font-black uppercase tracking-widest" style={{color: g.color}}>{g.label}</p>
              </div>
              <div className="divide-y divide-bgHover">
                {g.items.map(it => {
                  const sc = scaleByValue[it.level];
                  return (
                    <div key={it.command.id} className="px-3 py-2 flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-black text-white">{it.command.name}</p>
                        <p className="text-[13px] text-gray-400">{it.command.description}</p>
                      </div>
                      <span className="shrink-0 text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border"
                            style={{color: sc.color, borderColor: sc.color+"80", background: sc.color+"10"}}>
                        {it.level}/5
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function printCertificate(dog, data) {
  const top = data.badges.find(b => b.tier === "Gold") || data.badges.find(b => b.tier === "Silver") || data.badges.find(b => b.tier === "Bronze");
  if (!top) return;
  const win = window.open("", "_blank", "noopener");
  if (!win) return;
  const today = new Date().toLocaleDateString();
  win.document.write(`<!doctype html><html><head><title>${dog.name} · ${top.title}</title>
    <style>
      @page { size: landscape; margin: 0.5in; }
      body { font-family: Georgia, serif; background:#fff; color:#0f172a; text-align:center; padding:48px 32px; }
      .frame { border: 8px double ${top.color}; padding: 48px 32px; max-width: 900px; margin: 0 auto; }
      h1 { font-size: 48px; margin: 0 0 16px 0; letter-spacing: 0.05em; }
      h2 { font-size: 24px; margin: 8px 0; color:${top.color}; }
      .name { font-size: 56px; font-weight: 900; margin: 24px 0; color:#0f172a; }
      .desc { font-style: italic; font-size: 18px; margin: 16px 0; color:#475569; }
      .footer { display:flex; justify-content:space-between; margin-top: 48px; padding-top: 16px; border-top: 1px solid #cbd5e1; font-size:14px; color:#64748b; }
      .badge { display:inline-block; margin: 16px 0; font-size: 28px; color: ${top.color}; }
    </style></head><body>
    <div class="frame">
      <h2>Sit Happens Dog Training</h2>
      <h1>Certificate of Achievement</h1>
      <div class="badge">🏅 ${top.title}</div>
      <p class="desc">This certifies that</p>
      <p class="name">${dog.name}</p>
      <p class="desc">${top.description}</p>
      <p>has successfully demonstrated <strong>${data.progress.overall.mastered}</strong> mastered commands across the service-dog curriculum.</p>
      <div class="footer"><span>Issued ${today}</span><span>Sit Happens · ${data.progress.overall.mastered_pct}% Curriculum Complete</span></div>
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),200);</script>
    </body></html>`);
  win.document.close();
}
