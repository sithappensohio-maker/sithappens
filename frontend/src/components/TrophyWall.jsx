import React, { useState } from "react";
import { createPortal } from "react-dom";
import TrophyBadge from "./TrophyBadge";
import { api } from "../lib/api";

function fmtDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return ""; }
}

/**
 * Renders an award detail modal with share-card preview and copy/download.
 */
function TrophyDetailModal({ award, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!award) return null;
  const apiBase = process.env.REACT_APP_BACKEND_URL || "";
  const cardUrl = `${apiBase}/api/trophies/share-card/${award.id}.png`;
  const shareText = `${award.recipient_name} just earned the "${award.trophy_name}" trophy at Sit Happens! 🏆`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${shareText} ${cardUrl}`); setCopied(true); setTimeout(()=>setCopied(false), 2500); } catch {}
  };
  // Sprint 110di-77 — render via portal so the `.card-dog` (isolation: isolate)
  // stacking context can't trap us behind a sibling card.
  return createPortal((
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur grid place-items-center p-4" onClick={onClose} data-testid="trophy-detail-modal">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <TrophyBadge trophy={award} size="lg"/>
            <div>
              <div className="text-[13px] font-black uppercase tracking-widest text-gray-500">{award.trophy_tier} Trophy</div>
              <h3 className="text-2xl font-black text-white uppercase italic">{award.trophy_name}</h3>
              <div className="text-[14px] text-gray-400 mt-1">Awarded to <span className="text-white font-bold">{award.recipient_name}</span> · {fmtDate(award.awarded_at)}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1" data-testid="trophy-detail-close"><i className="fas fa-times text-lg"/></button>
        </div>
        {award.trophy_description && <p className="text-[14px] text-gray-300 mb-4 leading-relaxed">{award.trophy_description}</p>}
        {award.note && <p className="text-[15px] bg-bgBase rounded p-3 mb-4 italic text-gray-300"><i className="fas fa-comment-dots mr-2 text-shBlue"/>{award.note}</p>}
        <div className="bg-bgBase rounded-lg overflow-hidden border border-bgHover mb-4">
          <img src={cardUrl} alt="share card" className="w-full" data-testid="trophy-share-card"/>
        </div>
        <div className="flex gap-2">
          <a href={cardUrl} download={`${award.trophy_code}-${award.recipient_name}.png`} data-testid="trophy-share-download"
             className="flex-1 bg-shBlue/10 hover:bg-shBlue/20 text-shBlue text-center py-3 rounded font-black text-[14px] uppercase tracking-widest">
            <i className="fas fa-download mr-1"/> Download
          </a>
          <button onClick={copy} data-testid="trophy-share-copy"
                  className="flex-1 bg-shOrange/10 hover:bg-shOrange/20 text-shOrange text-center py-3 rounded font-black text-[14px] uppercase tracking-widest">
            <i className={`fas ${copied?"fa-check":"fa-link"} mr-1`}/>{copied?"Copied":"Copy share link"}
          </button>
        </div>
      </div>
    </div>
  ), document.body);
}

/**
 * Compact wall of trophy badges. Accepts an array of award rows.
 * Pass `locked` (an array of catalog items the recipient hasn't earned yet)
 * to render greyed-out "yet to unlock" placeholders.
 */
export default function TrophyWall({ awards = [], locked = [], emptyMsg = "No trophies yet — earn one by crushing your goals!", testIdPrefix = "trophywall" }) {
  const [open, setOpen] = useState(null);
  const hasAny = awards.length > 0 || locked.length > 0;
  if (!hasAny) {
    return (
      <div className="bg-bgBase/40 border border-dashed border-bgHover rounded-lg p-6 text-center" data-testid={`${testIdPrefix}-empty`}>
        <i className="fas fa-trophy text-3xl text-gray-600 mb-2"/>
        <p className="text-sm text-gray-400">{emptyMsg}</p>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-wrap gap-3" data-testid={testIdPrefix}>
        {awards.map(a => (
          <TrophyBadge key={a.id} trophy={a} size="md" onClick={()=>setOpen(a)} data-testid={`${testIdPrefix}-award-${a.trophy_code}`}/>
        ))}
        {locked.map(t => (
          <TrophyBadge key={`locked-${t.code}`} definition={t} size="md" locked data-testid={`${testIdPrefix}-locked-${t.code}`}/>
        ))}
      </div>
      <TrophyDetailModal award={open} onClose={()=>setOpen(null)}/>
    </>
  );
}

/**
 * Admin-only manual-award modal. Pass `recipientType` ("dog" or "client")
 * and `recipientId`. Renders pickable trophies (only manual ones not already
 * held). Closes on success.
 */
export function ManualAwardPicker({ recipientType, recipientId, onClose, onAwarded }) {
  const [catalog, setCatalog] = useState([]);
  const [held, setHeld] = useState(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  React.useEffect(() => {
    (async () => {
      try {
        const [{ data: cat }, { data: existing }] = await Promise.all([
          api.get("/trophies/catalog"),
          api.get(`/${recipientType === "dog" ? "dogs" : "clients"}/${recipientId}/trophies`),
        ]);
        setCatalog((cat.trophies || []).filter(t => t.active && t.category === recipientType));
        setHeld(new Set((existing || []).map(a => a.trophy_code)));
      } catch (e) { setErr("Couldn't load trophy catalog."); }
    })();
  }, [recipientType, recipientId]);

  const award = async (code) => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/${recipientType === "dog" ? "dogs" : "clients"}/${recipientId}/trophies/${code}/award`, { note });
      onAwarded?.(data);
      onClose?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Award failed");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur grid place-items-center p-4" onClick={onClose} data-testid="manual-award-modal">
      <div onClick={(e)=>e.stopPropagation()} className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl font-black uppercase italic text-white"><i className="fas fa-trophy text-shOrange mr-2"/>Award a Trophy</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white p-1"><i className="fas fa-times text-lg"/></button>
        </div>
        <div className="mb-3">
          <label className="text-[14px] font-black uppercase tracking-widest text-gray-500">Optional note</label>
          <input value={note} onChange={(e)=>setNote(e.target.value)} placeholder="e.g. Crushed loose-leash walking today!"
                 data-testid="manual-award-note"
                 className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shBlue outline-none"/>
        </div>
        {err && <div className="text-red-400 text-[15px] mb-2">{err}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {catalog.map(t => {
            const owned = held.has(t.code);
            return (
              <button
                key={t.code}
                disabled={owned || busy}
                onClick={()=>award(t.code)}
                data-testid={`manual-award-pick-${t.code}`}
                className={`bg-bgBase border border-bgHover rounded-lg p-4 flex flex-col items-center gap-2 text-center transition ${owned ? "opacity-40 cursor-not-allowed" : "hover:border-shOrange/60 hover:bg-shOrange/5"}`}
              >
                <TrophyBadge definition={t} size="md"/>
                <div className="text-[14px] font-black uppercase tracking-tight text-white">{t.name}</div>
                <div className="text-[12px] uppercase tracking-widest text-gray-500">{t.tier}{owned ? " · OWNED" : ""}</div>
                {t.description && <div className="text-[13px] text-gray-400 leading-tight">{t.description}</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
