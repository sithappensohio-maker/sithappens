// One modal to handle every flagged vaccine across the whole business — opens
// when the admin clicks the "Health Flags" stat tile on the dashboard. Each
// flagged dog gets one row with: dog info, current status pill, a date input,
// an optional photo upload, and a Save button. Saves go through the existing
// `POST /api/dogs/{dog_id}/vaccine-cert` endpoint so the data ends up exactly
// where it would if the admin opened the dog's profile and updated it there.
//
// Refreshes the list when the parent reloads (the parent passes `key={open}`
// so this remounts each time you open it, ensuring fresh data).

import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";

export default function VaccineCenterModal({ open, onClose, onChanged }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [rowMsg, setRowMsg] = useState({});  // {dog_id: "Saved" | "Error: ..."}
  const [drafts, setDrafts] = useState({});  // {dog_id: {expires_on, photo}}

  // Default expiry: 1 year from today — matches what most rabies vaccines are
  // valid for, and saves the admin a few clicks per row.
  const defaultExpiry = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.get("/vaccine-alerts").then(({ data }) => {
      setAlerts(data || []);
      // Seed each row with the default 1-year expiry so the admin can just hit Save
      const seed = {};
      (data || []).forEach(a => { seed[a.dog_id] = { expires_on: defaultExpiry, photo: null }; });
      setDrafts(seed);
    }).catch(() => setAlerts([])).finally(() => setLoading(false));
  }, [open, defaultExpiry]);

  if (!open) return null;

  const setDraft = (id, patch) => setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }));

  const onPhotoPick = async (id, file) => {
    if (!file) return;
    // Compress / base64 inline (matches the rest of the app's approach)
    const reader = new FileReader();
    reader.onload = (e) => setDraft(id, { photo: e.target.result });
    reader.readAsDataURL(file);
  };

  const saveRow = async (alert) => {
    const draft = drafts[alert.dog_id] || {};
    if (!draft.expires_on) {
      setRowMsg(m => ({ ...m, [alert.dog_id]: "Pick a new expiry date." }));
      return;
    }
    setSavingId(alert.dog_id);
    setRowMsg(m => ({ ...m, [alert.dog_id]: "" }));
    try {
      await api.post(`/dogs/${alert.dog_id}/vaccine-cert`, {
        vaccine: alert.vaccine,
        expires_on: draft.expires_on,
        photo: draft.photo || null,
      });
      setRowMsg(m => ({ ...m, [alert.dog_id]: "Saved ✓" }));
      // Remove this row from the list — it's no longer flagged
      setTimeout(() => {
        setAlerts(prev => prev.filter(a => a.dog_id !== alert.dog_id));
        setRowMsg(m => { const c = { ...m }; delete c[alert.dog_id]; return c; });
        if (onChanged) onChanged();
      }, 800);
    } catch (e) {
      setRowMsg(m => ({ ...m, [alert.dog_id]: formatErr(e.response?.data?.detail) || "Save failed" }));
    }
    setSavingId(null);
  };

  const dismissRow = async (alert) => {
    if (!window.confirm(`Hide ${alert.dog_name}'s vaccine alert for 30 days?`)) return;
    try {
      await api.post(`/vaccine-alerts/${alert.dog_id}/dismiss`);
      setAlerts(prev => prev.filter(a => a.dog_id !== alert.dog_id));
      if (onChanged) onChanged();
    } catch (e) {
      setRowMsg(m => ({ ...m, [alert.dog_id]: formatErr(e.response?.data?.detail) || "Dismiss failed" }));
    }
  };

  const statusBadge = (status) => {
    if (status === "expired") return "bg-red-500/15 text-red-400 border-red-500/40";
    if (status === "missing") return "bg-orange-500/15 text-orange-400 border-orange-500/40";
    return "bg-yellow-500/15 text-yellow-300 border-yellow-500/40";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose} data-testid="vaccine-center-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-4xl my-8 shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="flex justify-between items-center px-6 py-4 border-b border-bgHover sticky top-0 bg-bgPanel rounded-t-2xl z-10">
          <div>
            <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
              <i className="fas fa-shield-virus text-shOrange mr-2"/>Vaccine Center
            </h3>
            <p className="text-[15px] text-gray-400 mt-0.5">Update every flagged vaccine in one place. Default expiry is 1 year out — adjust if needed.</p>
          </div>
          <button onClick={onClose} data-testid="vaccine-center-close" className="text-gray-400 hover:text-white text-xl px-2"><i className="fas fa-times"/></button>
        </div>

        <div className="p-6 space-y-3">
          {loading && <div className="text-center text-gray-400 py-12 font-black uppercase tracking-widest text-sm">Loading…</div>}

          {!loading && alerts.length === 0 && (
            <div className="text-center py-12" data-testid="vaccine-center-empty">
              <i className="fas fa-shield-heart text-shGreen text-5xl mb-3"/>
              <p className="text-shGreen font-black uppercase tracking-widest">All clear!</p>
              <p className="text-[14px] text-gray-400 mt-1">Every dog's vaccines are up to date.</p>
            </div>
          )}

          {!loading && alerts.map(a => {
            const draft = drafts[a.dog_id] || {};
            const msg = rowMsg[a.dog_id];
            const saved = msg && msg.includes("✓");
            return (
              <div key={a.dog_id}
                   className="bg-bgBase border border-bgHover rounded-lg p-4 space-y-3"
                   data-testid={`vax-row-${a.dog_id}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-black text-white uppercase tracking-tight">
                      {a.dog_name}
                      <span className="text-gray-500 font-normal normal-case text-[14px] ml-2">· {a.owner_name}</span>
                    </p>
                    <p className="text-[14px] text-gray-500 mt-1">
                      <span className={`px-2 py-0.5 rounded border text-[13px] font-black uppercase tracking-widest ${statusBadge(a.status)}`}>
                        {a.vaccine} · {a.status}
                      </span>
                      {a.rabies && <span className="ml-2 text-gray-400">(was {a.rabies})</span>}
                    </p>
                  </div>
                  <button onClick={() => dismissRow(a)} title="Hide this alert for 30 days" data-testid={`vax-dismiss-${a.dog_id}`}
                          className="text-[14px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-300 px-2 py-1">
                    <i className="fas fa-bell-slash mr-1"/>Hide 30d
                  </button>
                </div>

                <div className="grid sm:grid-cols-3 gap-2 items-end">
                  <div>
                    <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">New Expiry</label>
                    <input type="date" value={draft.expires_on || ""}
                           onChange={(e) => setDraft(a.dog_id, { expires_on: e.target.value })}
                           data-testid={`vax-expiry-${a.dog_id}`}
                           className="w-full mt-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white"/>
                  </div>
                  <div>
                    <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Photo (optional)</label>
                    <div className="mt-1 flex items-center gap-2">
                      <label className="flex-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-[15px] text-gray-300 cursor-pointer hover:border-shGreen text-center truncate">
                        <i className="fas fa-upload mr-1"/>{draft.photo ? "Photo attached" : "Upload"}
                        <input type="file" accept="image/*" onChange={(e) => onPhotoPick(a.dog_id, e.target.files?.[0])}
                               data-testid={`vax-photo-${a.dog_id}`} className="hidden"/>
                      </label>
                      {draft.photo && (
                        <button onClick={() => setDraft(a.dog_id, { photo: null })} className="text-gray-500 hover:text-red-400 text-[14px]" title="Remove">
                          <i className="fas fa-times"/>
                        </button>
                      )}
                    </div>
                  </div>
                  <button onClick={() => saveRow(a)} disabled={savingId === a.dog_id}
                          data-testid={`vax-save-${a.dog_id}`}
                          className="bg-shGreen text-bgHeader py-2 px-4 rounded font-black uppercase tracking-widest text-[15px] shadow-lg disabled:opacity-50">
                    {savingId === a.dog_id ? "Saving…" : <><i className="fas fa-check mr-1"/>Save</>}
                  </button>
                </div>

                {msg && (
                  <div className={`text-[14px] font-black uppercase tracking-widest ${saved ? "text-shGreen" : "text-red-400"}`}>
                    {msg}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
