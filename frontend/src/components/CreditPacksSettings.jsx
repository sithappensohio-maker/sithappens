import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import IconPicker from "./IconPicker";
import ColorSwatchRow from "./ColorSwatchRow";

/**
 * Admin-managed catalog of credit packs (bulk daycare day discounts).
 * Each pack stores qty + price; per-credit value is computed on the fly.
 */
const empty = { name: "", qty: 10, price: 300, service_type: "daycare", icon: "fa-tag", color: "", active: true };

const DEFAULT_ICON_BY_POOL = { daycare: "fa-sun", training: "fa-graduation-cap", boarding: "fa-moon" };
const DEFAULT_COLOR_BY_POOL = { daycare: "#8cc63f", training: "#a855f7", boarding: "#f26522" };

export default function CreditPacksSettings() {
  const confirm = useConfirm();
  const [packs, setPacks] = useState([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false); // controls the New/Edit modal

  const load = async () => {
    // include_inactive=false (default) so soft-deleted default packs disappear from the list.
    const { data } = await api.get("/credit-packs");
    setPacks(data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setErr(""); setOpen(true); };
  const openEdit = (p) => { setEditing(p); setForm({ ...empty, ...p }); setErr(""); setOpen(true); };
  const closeModal = () => { setOpen(false); setEditing(null); setForm(empty); setErr(""); };

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
      closeModal();
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
          <button onClick={openNew} data-testid="new-pack-btn"
                  className="bg-shGreen text-black px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/80">
            + New Pack
          </button>
        </div>
      </div>

      <div className="space-y-2" data-testid="credit-packs-list">
        {packs.length === 0 && (
          <div className="bg-bgBase border border-bgHover rounded-lg p-8 text-center text-[13px] text-gray-500 uppercase font-black tracking-widest">
            No packs yet — seed the standard 4 or add your own.
          </div>
        )}
        {packs.map(p => {
          const accent = p.color || DEFAULT_COLOR_BY_POOL[p.service_type] || "#94a3b8";
          return (
          <div key={p.id} className={`bg-bgBase border rounded-lg p-3 grid grid-cols-12 items-center gap-2 ${p.active ? "border-bgHover" : "border-bgHover/30 opacity-50"}`}>
            <div className="col-span-5 min-w-0 flex items-center gap-3">
              <div className="w-10 h-10 rounded grid place-items-center shrink-0"
                   style={{ backgroundColor: `${accent}26` }}>
                <i className={`fas ${p.icon || DEFAULT_ICON_BY_POOL[p.service_type] || "fa-tag"}`} style={{ color: accent }}/>
              </div>
              <div className="min-w-0">
                <p className="text-white font-black text-[14px] tracking-tight truncate">{p.name}</p>
                <p className="text-[12px] font-black uppercase tracking-widest mt-0.5">
                  <span style={{ color: accent }}>{p.service_type}</span>
                  <span className="text-gray-500">{p.is_default ? " · default" : ""}{!p.active ? " · inactive" : ""}</span>
                </p>
              </div>
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
              <button onClick={()=>openEdit(p)} data-testid={`edit-pack-${p.id}`} className="text-shBlue text-[12px] font-black uppercase tracking-widest hover:underline px-1">Edit</button>
              <button onClick={()=>remove(p)} className="text-red-400 text-[12px] font-black uppercase tracking-widest hover:underline px-1">Remove</button>
            </div>
          </div>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6 animate-fade-in"
             onClick={closeModal}
             data-testid="pack-form-modal">
          <div onClick={(e)=>e.stopPropagation()}
               className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-4 flex items-center justify-between gap-3 z-10">
              <h5 className="text-white font-black text-[16px] uppercase italic tracking-tight">{editing ? `Edit · ${editing.name}` : "New Pack"}</h5>
              <button onClick={closeModal} className="text-gray-500 hover:text-white" data-testid="pack-form-close">
                <i className="fas fa-xmark text-xl"/>
              </button>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Pack name</label>
                  <input value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} placeholder="e.g., 50-Day Daycare Pack"
                         data-testid="pack-name-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Pool</label>
                  <select value={form.service_type} onChange={(e)=>{
                             const t = e.target.value;
                             const pooledDefaults = Object.values(DEFAULT_ICON_BY_POOL);
                             const nextIcon = (!form.icon || pooledDefaults.includes(form.icon)) ? (DEFAULT_ICON_BY_POOL[t] || form.icon) : form.icon;
                             setForm({...form, service_type: t, icon: nextIcon});
                           }}
                          data-testid="pack-pool-select"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                    <option value="daycare">Daycare credits</option>
                    <option value="training">Training credits</option>
                    <option value="boarding">Boarding nights</option>
                  </select>
                </div>
                <div>
                  <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Credits per pack</label>
                  <input type="number" min="1" value={form.qty} onChange={(e)=>setForm({...form, qty: parseInt(e.target.value) || 1})}
                         data-testid="pack-qty-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div>
                  <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Price (USD)</label>
                  <input type="number" step="0.01" min="0" value={form.price} onChange={(e)=>setForm({...form, price: parseFloat(e.target.value) || 0})}
                         data-testid="pack-price-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Icon</label>
                  <IconPicker value={form.icon} onChange={(v)=>setForm({...form, icon: v})} testid="pack-icon-picker" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Color</label>
                  <div className="mt-2">
                    <ColorSwatchRow value={form.color} onChange={(hex)=>setForm({...form, color: hex})} testid="pack-color-row" />
                    <p className="text-[11px] text-gray-500 mt-1.5">Leave blank to use the pool default ({form.service_type === "training" ? "purple" : form.service_type === "boarding" ? "orange" : "green"}).</p>
                  </div>
                </div>
              </div>
              <p className="text-[12px] text-gray-500 mt-2">Per-credit value: <span className="text-shGreen font-black">${(form.price / Math.max(form.qty, 1)).toFixed(2)}</span></p>
              {/* Live preview — exactly how this pack will render in the catalog list. */}
              <div className="mt-4">
                <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Preview</p>
                {(() => {
                  const accent = form.color || DEFAULT_COLOR_BY_POOL[form.service_type] || "#94a3b8";
                  const unit = form.service_type === "training" ? "sessions" : form.service_type === "boarding" ? "nights" : "credits";
                  return (
                    <div className="bg-bgBase border border-bgHover rounded-lg p-3 flex items-center gap-3" data-testid="pack-preview">
                      <div className="w-10 h-10 rounded grid place-items-center shrink-0"
                           style={{ backgroundColor: `${accent}26` }}>
                        <i className={`fas ${form.icon || DEFAULT_ICON_BY_POOL[form.service_type] || "fa-tag"}`} style={{ color: accent }}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-black text-[14px] tracking-tight truncate">{form.name || "Untitled pack"}</p>
                        <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: accent }}>{form.service_type} · {form.qty} {unit}</p>
                      </div>
                      <p className="text-shGreen font-black text-[18px] whitespace-nowrap">${(form.price || 0).toFixed(2)}</p>
                    </div>
                  );
                })()}
              </div>
              {err && <p className="text-red-400 text-[13px] mt-3">{err}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeModal} className="text-gray-400 text-[12px] uppercase font-black tracking-widest px-3 py-2 hover:text-white">Cancel</button>
                <button onClick={save} data-testid="save-pack-btn"
                        className="bg-shGreen text-black px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shGreen/80">
                  {editing ? "Save Changes" : "Add Pack"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
