/* Sprint 110co — Care-log strip. Renders the staff-captured care actions
   for a single visit: feeding confirmations, medication confirmations w/
   photo proof, bathroom counters. Shown inside the report card so every
   client gets a transparent "here's what we did for your dog today" view.

   All inputs are optional — if nothing was captured, the strip renders
   nothing. */
import { useState } from "react";

export default function CareLogStrip({ feedings = [], medications = [], bathroom }) {
  const [zoom, setZoom] = useState(null);
  const hasFeedings = (feedings || []).length > 0;
  const hasMeds = (medications || []).length > 0;
  const hasBathroom = bathroom && ((bathroom.pee || 0) + (bathroom.poop || 0)) > 0;
  if (!hasFeedings && !hasMeds && !hasBathroom) return null;

  const fmtTime = (iso) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    catch { return ""; }
  };

  return (
    <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 space-y-2.5 mt-3" data-testid="care-log-strip">
      <p className="text-[11px] font-black uppercase tracking-[0.25em] text-shGreen">
        <i className="fas fa-clipboard-check mr-1.5"/>Care log
      </p>

      {hasFeedings && (
        <div className="space-y-1" data-testid="care-feedings">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-bowl-food text-shGreen mr-1"/>Meals</p>
          {feedings.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px] text-gray-200">
              <i className="fas fa-check text-shGreen text-[10px]"/>
              <span>Meal {(f.index ?? i) + 1} given{f.at ? ` · ${fmtTime(f.at)}` : ""}{f.by_name ? ` · ${f.by_name}` : ""}{f.note ? ` · ${f.note}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {hasMeds && (
        <div className="space-y-1" data-testid="care-meds">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-pills text-shOrange mr-1"/>Medications</p>
          {medications.map((m, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px] text-gray-200">
              <i className="fas fa-check text-shOrange text-[10px] mt-1"/>
              <div className="min-w-0">
                <span>Dose {(m.index ?? i) + 1} given{m.at ? ` · ${fmtTime(m.at)}` : ""}{m.by_name ? ` · ${m.by_name}` : ""}{m.note ? ` · ${m.note}` : ""}</span>
                {m.photo && (
                  <button type="button" onClick={()=>setZoom(m.photo)}
                          data-testid={`care-med-photo-${i}`}
                          className="ml-2 inline-flex items-center gap-1 text-shBlue hover:text-white text-[11px] font-black uppercase tracking-widest">
                    <img src={m.photo} alt="proof" loading="lazy" className="h-8 w-8 rounded object-cover border border-bgHover"/>
                    <i className="fas fa-magnifying-glass-plus"/>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasBathroom && (
        <div className="flex items-center gap-2 text-[13px]" data-testid="care-bathroom">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-toilet mr-1"/>Bathroom</p>
          {(bathroom.pee || 0) > 0 && (
            <span className="bg-shBlue/15 border border-shBlue/40 text-shBlue px-2 py-0.5 rounded text-[12px] font-black uppercase tracking-widest">
              💧 {bathroom.pee}
            </span>
          )}
          {(bathroom.poop || 0) > 0 && (
            <span className="bg-shOrange/15 border border-shOrange/40 text-shOrange px-2 py-0.5 rounded text-[12px] font-black uppercase tracking-widest">
              💩 {bathroom.poop}
            </span>
          )}
        </div>
      )}

      {zoom && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={()=>setZoom(null)} data-testid="care-photo-lightbox">
          <img src={zoom} alt="med proof" className="max-h-[85vh] max-w-full rounded-xl shadow-2xl"/>
        </div>
      )}
    </div>
  );
}
