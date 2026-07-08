import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useEditLock } from "../lib/useLiveRefresh";

// Sprint 110am — Per-client price overrides ("legacy pricing"). Admins use
// this to grandfather an existing client into the OLD price of a service or
// credit pack when the public rate goes up. Each row has an optional expiry
// (YYYY-MM-DD). The backend resolves the effective price at booking-checkout
// and credit-pack-sell time, so the override can't be bypassed via the
// client portal even if a curious user inspects the network tab.
export default function LegacyPricingModal({ client, onClose }) {
  useEditLock(true);
  const [overrides, setOverrides] = useState([]);
  const [services, setServices] = useState([]);
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExpired, setShowExpired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState({
    target_kind: "service",
    target_code: "",
    override_price: "",
    expires_on: "",
    note: "",
  });

  const load = async () => {
    setLoading(true);
    try {
      const [over, svcs, pcks] = await Promise.all([
        api.get(`/clients/${client.id}/price-overrides`, { params: { include_expired: showExpired } }),
        api.get("/services"),
        api.get("/credit-packs"),
      ]);
      setOverrides(over.data.overrides || []);
      // Only show active catalog rows in the add-picker
      setServices((svcs.data || []).filter(s => s.active !== false));
      setPacks((pcks.data || []).filter(p => p.active !== false));
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [showExpired]);

  const catalog = draft.target_kind === "service" ? services : packs;
  const selectedRow = catalog.find(r => r.id === draft.target_code);
  const listPriceForSelected =
    draft.target_kind === "service" ? (selectedRow?.base_price || 0) : (selectedRow?.price || 0);
  const savingsPreview = selectedRow && draft.override_price
    ? Math.max(0, listPriceForSelected - Number(draft.override_price))
    : 0;

  const submit = async () => {
    setErr("");
    if (!draft.target_code) return setErr("Pick which item to grandfather.");
    if (draft.override_price === "" || Number(draft.override_price) < 0)
      return setErr("Enter a valid override price.");
    try {
      await api.post(`/clients/${client.id}/price-overrides`, {
        target_kind: draft.target_kind,
        target_code: draft.target_code,
        override_price: Number(draft.override_price),
        expires_on: draft.expires_on || null,
        note: draft.note || "",
      });
      setAdding(false);
      setDraft({ target_kind: "service", target_code: "", override_price: "", expires_on: "", note: "" });
      load();
    } catch (e) {
      setErr(formatErr(e));
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove the locked price on "${row.target_name}"? They will pay the current catalog rate from now on.`)) return;
    try {
      await api.delete(`/price-overrides/${row.id}`);
      load();
    } catch (e) {
      setErr(formatErr(e));
    }
  };

  const editExpiry = async (row) => {
    const next = window.prompt(`New expiry date for "${row.target_name}" (YYYY-MM-DD, or leave blank for forever):`, row.expires_on || "");
    if (next === null) return;
    try {
      await api.put(`/price-overrides/${row.id}`, { expires_on: next || "" });
      load();
    } catch (e) {
      setErr(formatErr(e));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 grid place-items-center p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
         data-testid="legacy-pricing-modal">
      <div className="bg-bgCard border border-bgHover rounded-2xl shadow-2xl w-full max-w-2xl max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-amber-500/20 to-amber-500/5 border-b border-amber-500/30 p-5 z-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] font-black text-amber-400 mb-1">
                <i className="fas fa-lock mr-1"/>Legacy Pricing
              </div>
              <h2 className="text-2xl font-black tracking-tight text-white">{client.name}</h2>
              <p className="text-[13px] text-gray-300 mt-1 max-w-md leading-relaxed">
                Grandfather this client into specific old prices when you raise public rates. Active overrides apply automatically at every booking checkout and credit-pack purchase.
              </p>
            </div>
            <button onClick={onClose} data-testid="legacy-close"
                    className="text-gray-400 hover:text-white text-xl"><i className="fas fa-times"/></button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {err && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="legacy-error">
              {err}
            </div>
          )}

          {!adding && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-[12px] text-gray-400 font-black uppercase tracking-widest flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showExpired} onChange={(e)=>setShowExpired(e.target.checked)} />
                Include expired
              </label>
              <button onClick={()=>setAdding(true)}
                      data-testid="legacy-add-btn"
                      className="bg-shGreen text-bgBase px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/90">
                <i className="fas fa-plus mr-1"/>Grandfather an item
              </button>
            </div>
          )}

          {adding && (
            <div className="bg-bgBase/60 border border-bgHover rounded-xl p-4 space-y-3">
              <div className="text-[12px] font-black uppercase tracking-widest text-shGreen">
                <i className="fas fa-plus-circle mr-1"/>Lock a price
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1 uppercase tracking-widest font-black">Type</label>
                  <select value={draft.target_kind}
                          onChange={(e)=>setDraft(d=>({...d, target_kind: e.target.value, target_code: ""}))}
                          data-testid="legacy-kind-select"
                          className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                    <option value="service">Service</option>
                    <option value="credit_pack">Credit pack</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1 uppercase tracking-widest font-black">Item</label>
                  <select value={draft.target_code}
                          onChange={(e)=>setDraft(d=>({...d, target_code: e.target.value}))}
                          data-testid="legacy-target-select"
                          className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                    <option value="">— Choose —</option>
                    {catalog.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name} (current ${draft.target_kind === "service" ? r.base_price : r.price})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1 uppercase tracking-widest font-black">Locked price ($)</label>
                  <input type="number" min="0" step="0.01" value={draft.override_price}
                         onChange={(e)=>setDraft(d=>({...d, override_price: e.target.value}))}
                         data-testid="legacy-price-input"
                         placeholder="e.g. 30.00"
                         className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                  {savingsPreview > 0 && (
                    <p className="text-[12px] text-shGreen mt-1">
                      <i className="fas fa-tag mr-1"/>Saves ${savingsPreview.toFixed(2)} per use
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1 uppercase tracking-widest font-black">Expires on</label>
                  <input type="date" value={draft.expires_on}
                         onChange={(e)=>setDraft(d=>({...d, expires_on: e.target.value}))}
                         data-testid="legacy-expiry-input"
                         className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                  <p className="text-[11px] text-gray-500 mt-1 italic">Leave blank to lock the rate forever.</p>
                </div>
              </div>
              <div>
                <label className="block text-[11px] text-gray-400 mb-1 uppercase tracking-widest font-black">Note (private — admin only)</label>
                <input type="text" value={draft.note}
                       onChange={(e)=>setDraft(d=>({...d, note: e.target.value}))}
                       data-testid="legacy-note-input"
                       placeholder="e.g. Original 2024 sign-up rate"
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={()=>{ setAdding(false); setErr(""); }}
                        className="text-gray-400 font-black uppercase text-[13px] tracking-widest px-3 py-2 hover:text-white">
                  Cancel
                </button>
                <button onClick={submit}
                        data-testid="legacy-save-btn"
                        className="bg-shGreen text-bgBase px-4 py-2 rounded font-black uppercase text-[13px] tracking-widest hover:bg-shGreen/90">
                  <i className="fas fa-lock mr-1"/>Lock this price
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center text-gray-500 py-6 text-sm">Loading…</div>
          ) : overrides.length === 0 ? (
            <div className="text-center text-gray-500 py-8 text-sm italic">
              <i className="fas fa-lock-open text-2xl block mb-2 text-gray-700"/>
              No locked prices yet. This client pays current catalog rates for everything.
            </div>
          ) : (
            <ul className="space-y-2" data-testid="legacy-overrides-list">
              {overrides.map(row => (
                <li key={row.id}
                    data-testid={`legacy-row-${row.id}`}
                    className={`bg-bgBase/40 border rounded-lg p-3 flex items-center gap-3 ${row.active ? "border-amber-500/30" : "border-bgHover opacity-50"}`}>
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/15 grid place-items-center">
                    <i className={`fas ${row.target_kind === "service" ? "fa-tag" : "fa-coins"} text-amber-400`}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{row.target_name}</div>
                    <div className="text-[12px] text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                      <span><span className="line-through text-gray-600">${row.list_price.toFixed(2)}</span> → <span className="text-amber-400 font-bold">${row.override_price.toFixed(2)}</span></span>
                      {row.savings > 0 && <span className="text-shGreen">saves ${row.savings.toFixed(2)}</span>}
                      <span className={row.expires_on ? "" : "text-shGreen"}>
                        {row.expires_on ? <><i className="far fa-calendar mr-1"/>thru {row.expires_on}</> : <><i className="fas fa-infinity mr-1"/>forever</>}
                      </span>
                      {!row.active && <span className="text-red-400 font-black">EXPIRED</span>}
                    </div>
                    {row.note && <div className="text-[12px] text-gray-500 italic mt-1">{row.note}</div>}
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={()=>editExpiry(row)}
                            data-testid={`legacy-edit-${row.id}`}
                            className="text-[11px] font-black uppercase text-shBlue hover:text-shBlue/80 tracking-widest"
                            title="Change expiry date">
                      <i className="fas fa-pen mr-1"/>Expiry
                    </button>
                    <button onClick={()=>remove(row)}
                            data-testid={`legacy-remove-${row.id}`}
                            className="text-[11px] font-black uppercase text-red-400 hover:text-red-300 tracking-widest">
                      <i className="fas fa-trash mr-1"/>Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
