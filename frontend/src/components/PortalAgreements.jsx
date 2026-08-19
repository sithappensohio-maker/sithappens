import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";

export default function PortalAgreements() {
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(null);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => api.get("/portal/agreements").then((r) => setRows(r.data?.agreements || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  if (!rows.length) return null;

  const sign = async () => {
    if (!open || typedName.trim().length < 2) return;
    setBusy(true); setError("");
    try {
      await api.post(`/portal/agreements/${open.id}/sign`, { typed_name: typedName.trim() });
      setOpen(null); setTypedName(""); await load();
    } catch (e) { setError(formatErr(e.response?.data?.detail) || "Couldn't sign agreement"); }
    setBusy(false);
  };

  return <div className="p-5 rounded-xl border border-shBorder bg-bgPanel/50" data-testid="portal-agreements-card">
    <div className="flex items-center justify-between gap-3 mb-3">
      <div><p className="text-[14px] font-black uppercase tracking-widest text-shText"><i className="fas fa-file-signature mr-2 text-shSecondary"/>Service & Training Agreements</p><p className="text-xs text-shTextMuted mt-1">Signed versions stay on file exactly as they were when you signed them.</p></div>
      <span className="text-xs font-black text-shTextMuted">{rows.filter((x)=>x.signed).length}/{rows.length}</span>
    </div>
    <div className="space-y-2">
      {rows.map((a) => <div key={a.id} className="border border-shBorder rounded-lg p-3 flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="font-bold text-shText truncate">{a.title}</p><p className="text-[11px] text-shTextMuted">v{a.version}{a.required ? " · Required when applicable" : ""}</p></div>
        {a.signed ? <span className="text-shPrimary text-[11px] font-black uppercase"><i className="fas fa-circle-check mr-1"/>Signed</span> : <button onClick={()=>{setOpen(a); setError("");}} className="px-3 py-1.5 rounded bg-shSecondary text-shText font-black uppercase tracking-widest text-[11px]">Review & Sign</button>}
      </div>)}
    </div>
    {open && <div className="fixed inset-0 z-[90] bg-black/75 p-4 overflow-y-auto grid place-items-start sm:place-items-center" onMouseDown={(e)=>{if(e.target===e.currentTarget&&!busy)setOpen(null)}}>
      <div className="w-full max-w-2xl my-8 bg-bgPanel border border-shBorder rounded-2xl p-5 space-y-4" onMouseDown={(e)=>e.stopPropagation()} data-testid="agreement-sign-modal">
        <div className="flex justify-between gap-3"><div><p className="text-xs uppercase tracking-widest font-black text-shSecondary">Agreement v{open.version}</p><h2 className="text-xl font-black text-shText">{open.title}</h2></div><button onClick={()=>setOpen(null)}><i className="fas fa-times text-shTextMuted"/></button></div>
        <div className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap bg-bgBase border border-shBorder rounded-xl p-4 text-sm text-shText leading-relaxed">{open.body}</div>
        <div><label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Type your full name to sign</label><input value={typedName} onChange={(e)=>setTypedName(e.target.value)} className="w-full mt-1 bg-bgBase border border-shBorder rounded p-3 text-shText" /></div>
        {error && <p className="text-red-400 text-sm font-bold">{error}</p>}
        <div className="flex justify-end gap-2"><button onClick={()=>setOpen(null)} className="px-4 py-2 border border-shBorder rounded text-shTextMuted font-black uppercase text-xs">Cancel</button><button onClick={sign} disabled={busy||typedName.trim().length<2} className="px-5 py-2 bg-shPrimary text-bgHeader rounded font-black uppercase text-xs disabled:opacity-40">{busy?"Signing…":"Sign Agreement"}</button></div>
      </div>
    </div>}
  </div>;
}
