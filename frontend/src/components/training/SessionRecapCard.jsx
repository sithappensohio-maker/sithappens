// Training UI Phase 4 — visual session card, replacing plain recap text.
// Every field comes from /portal/session-recaps, which is already an
// explicit client-safe allowlist (never session_note, the internal field).
import { useState } from "react";

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return ""; }
}

export default function SessionRecapCard({ recap, testid }) {
  const [open, setOpen] = useState(false);
  const improving = (recap.skills_practiced || []).filter(s => s.status && s.status !== "mastered");
  const solid = (recap.skills_practiced || []).filter(s => s.status === "mastered");

  return (
    <div className="bg-black/20 border border-shBorder rounded-lg" data-testid={testid}>
      <button onClick={() => setOpen(o => !o)} data-testid={testid ? `${testid}-toggle` : undefined}
              className="w-full text-left px-3.5 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-black text-shText">{fmtDate(recap.at)}</p>
            {recap.trainer_name && <span className="text-[11px] text-shTextMuted">with {recap.trainer_name}</span>}
          </div>
          {recap.module_name && <p className="text-[12px] text-shSecondary font-bold mt-0.5">{recap.module_name}</p>}
          {(recap.skills_practiced || []).length > 0 && (
            <p className="text-[12px] text-shTextMuted mt-1">{recap.skills_practiced.map(s => s.name).filter(Boolean).join(", ")}</p>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest bg-shPrimary/15 text-shPrimary rounded-full px-2 py-0.5 mt-1.5">
            <i className="fas fa-circle-check"/>Completed
          </span>
        </div>
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[12px] mt-1 shrink-0`}/>
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 space-y-2.5 border-t border-shBorder pt-3">
          {solid.length > 0 && (
            <p className="text-[12px]"><span className="text-shPrimary font-black uppercase tracking-widest text-[10px]">Went well: </span><span className="text-shText">{solid.map(s => s.name).join(", ")}</span></p>
          )}
          {improving.length > 0 && (
            <p className="text-[12px]"><span className="text-shAccent font-black uppercase tracking-widest text-[10px]">Needs more work: </span><span className="text-shText">{improving.map(s => s.name).join(", ")}</span></p>
          )}
          {recap.recap_note && (
            <p className="text-[13px] text-shText italic bg-black/20 border border-shBorder rounded p-2.5">&ldquo;{recap.recap_note}&rdquo;</p>
          )}
          {(recap.homework_assigned || []).length > 0 && (
            <p className="text-[12px]"><span className="text-shSecondary font-black uppercase tracking-widest text-[10px]"><i className="fas fa-graduation-cap mr-1"/>Homework: </span><span className="text-shText">{recap.homework_assigned.join(", ")}</span></p>
          )}
          {recap.next_focus && (
            <p className="text-[12px]"><span className="text-shTextMuted font-black uppercase tracking-widest text-[10px]">Next focus: </span><span className="text-shText">{recap.next_focus}</span></p>
          )}
        </div>
      )}
    </div>
  );
}
