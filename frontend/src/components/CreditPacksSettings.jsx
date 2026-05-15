import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Admin-managed catalog of credit packs (bulk daycare day discounts).
 * Each pack stores qty + price; per-credit value is computed on the fly.
 */
const empty = { name: "", qty: 10, price: 300, service_type: "daycare", active: true };

export default function CreditPacksSettings() {
  const [packs, setPacks] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    const { data } = await api.get("/credit-packs", { params: { include_inactive: true } });
    setPacks(data);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr("");
    try {
      if (editing) await api.put(`/credit-packs/${editing.id}`, form);
      else await api.post("/credit-packs", form);
      setEditing(null); setForm(empty);
      load();
    } catch (e) {
      setErr(e.response?.data?.detail || "Save failed");
    }
  };

  const remove = async (p) => {
    if (!window.confirm(`Remove "${p.name}"?`)) return;
    await api.delete(`/credit-packs/${p.id}`);
    load();
  };

  const seed = async () => {
    await api.post("/credit-packs/seed-standard");
    load();
  };

  return (
    <div className="space-y-5" data-testid="credit-packs-settings">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Credit Packs</h4>
          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-1">Bulk pricing for daycare credits. Income is recognized when each credit is redeemed at check-out, not when the pack is sold.</p>
        </div>
        <div className="flex gap-2">
          {packs.length === 0 && (
            <button onClick={seed} data-testid="seed-packs-btn"
                    className="bg-shBlue/15 text-shBlue px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/25">
              <i className="fas fa-magic-wand-sparkles mr-1"/>Seed Standard 4
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2" data-testid="credit-packs-list">
        {packs.length === 0 && (
          <div className="bg-bgBase border border-bgHover rounded-lg p-8 text-center text-[13px] text-gray-500 uppercase font-black tracking-widest">
            No packs yet — seed the standard 4 or add your own.
          </div>
        )}
        {packs.map(p => (
          <div key={p.id} className={`bg-bgBase border rounded-lg p-3 grid grid-cols-12 items-center gap-2 ${p.active ? "border-bgHover" : "border-bgHover/30 opacity-50"}`}>
            <div className="col-span-5 min-w-0">
              <p className="text-white font-black text-[14px] tracking-tight">{p.name}</p>
              <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">{p.service_type}{p.is_default ? " · default" : ""}{!p.active ? " · inactive" : ""}</p>
            </div>
            <div className="col-span-2 text-center">
              <p className="text-shBlue font-black text-[18px]">{p.qty}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">credits</p>
            </div>
            <div className="col-span-2 text-center">
              <p className="text-shGreen font-black text-[18px]">${p.price?.toFixed(2)}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">price</p>
            </div>
            <div className="col-span-2 text-center">
              <p className="text-white font-black text-[16px]">${p.value_each?.toFixed(2)}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">per credit</p>
            </div>
            <div className="col-span-1 text-right">
              <button onClick={()=>{setEditing(p); setForm({ ...empty, ...p });}} className="text-shBlue text-[12px] font-black uppercase tracking-widest hover:underline px-1">Edit</button>
              <button onClick={()=>remove(p)} className="text-red-400 text-[12px] font-black uppercase tracking-widest hover:underline px-1">Remove</button>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-bgBase border border-bgHover rounded-lg p-4">
        <h5 className="text-white font-black text-[14px] uppercase tracking-tight mb-3">{editing ? `Edit · ${editing.name}` : "New Pack"}</h5>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Pack name</label>
            <input value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} placeholder="e.g., 50-Day Daycare Pack"
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Credits per pack</label>
            <input type="number" min="1" value={form.qty} onChange={(e)=>setForm({...form, qty: parseInt(e.target.value) || 1})}
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Price (USD)</label>
            <input type="number" step="0.01" min="0" value={form.price} onChange={(e)=>setForm({...form, price: parseFloat(e.target.value) || 0})}
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>
        </div>
        <p className="text-[12px] text-gray-500 mt-2">Per-credit value: <span className="text-shGreen font-black">${(form.price / Math.max(form.qty, 1)).toFixed(2)}</span></p>
        {err && <p className="text-red-400 text-[13px] mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-3">
          {editing && <button onClick={()=>{setEditing(null); setForm(empty);}} className="text-gray-400 text-[12px] uppercase font-black tracking-widest px-2">Cancel</button>}
          <button onClick={save} data-testid="save-pack-btn"
                  className="bg-shGreen text-black px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shGreen/80">
            {editing ? "Save Changes" : "Add Pack"}
          </button>
        </div>
      </div>
    </div>
  );
}
