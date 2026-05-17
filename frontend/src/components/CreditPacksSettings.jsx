import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

/**
 * Admin-managed catalog of credit packs (bulk daycare day discounts).
 * Each pack stores qty + price; per-credit value is computed on the fly.
 */
const empty = { name: "", qty: 10, price: 300, service_type: "daycare", active: true };

export default function CreditPacksSettings() {
  const confirm = useConfirm();
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
    // Client-side guard so we surface a friendly inline message instead of a
    // 422 from FastAPI (whose `detail` is an array of objects React can't render).
    if (!form.name?.trim()) { setErr("Pack name is required."); return; }
    if (!Number.isFinite(form.qty) || form.qty < 1) { setErr("Credits per pack must be at least 1."); return; }
    if (!Number.isFinite(form.price) || form.price < 0) { setErr("Price must be 0 or higher."); return; }
    try {
      if (editing) await api.put(`/credit-packs/${editing.id}`, form);
      else await api.post("/credit-packs", form);
      setEditing(null); setForm(empty);
      load();
    } catch (e) {
      // FastAPI 422 detail can be an array of error objects — formatErr
      // flattens it so we never try to render a raw object inside <p>.
      setErr(formatErr(e.response?.data?.detail) || "Save failed");
    }
  };

  const remove = async (p) => {
    if (!(await confirm({ title: `Remove "${p.name}"?`, body: "Already-issued credit lots stay valid. New sales of this pack will be disabled.", confirmText: "Remove pack", tone: "danger" }))) return;
    await api.delete(`/credit-packs/${p.id}`);
    load();
  };

  const seed = async () => {
    const r = await api.post("/credit-packs/seed-standard");
    load();
    if ((r?.data?.seeded ?? 0) === 0) {
      // gentle inline hint via err (it shows in the form area)
      setErr(""); // clear stale error if any
    }
  };

  return (
    <div className="space-y-5" data-testid="credit-packs-settings">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Credit Packs</h4>
          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-1">Bulk pricing for daycare, training, and boarding credits. Income is recognized when each credit is redeemed at check-out, not when the pack is sold.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={seed} data-testid="seed-packs-btn"
                  className="bg-shBlue/15 text-shBlue px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/25">
            <i className="fas fa-magic-wand-sparkles mr-1"/>{packs.length === 0 ? "Seed Standard Packs" : "Add Missing Defaults"}
          </button>
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
              <p className="text-[12px] font-black uppercase tracking-widest mt-0.5">
                <span className={p.service_type === "training" ? "text-purple-400" : p.service_type === "boarding" ? "text-shOrange" : "text-shGreen"}>{p.service_type}</span>
                <span className="text-gray-500">{p.is_default ? " · default" : ""}{!p.active ? " · inactive" : ""}</span>
              </p>
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Pack name</label>
            <input value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} placeholder="e.g., 50-Day Daycare Pack"
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Pool</label>
            <select value={form.service_type} onChange={(e)=>setForm({...form, service_type: e.target.value})}
                    data-testid="pack-pool-select"
                    className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
              <option value="daycare">Daycare credits</option>
              <option value="training">Training credits</option>
              <option value="boarding">Boarding nights</option>
            </select>
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
