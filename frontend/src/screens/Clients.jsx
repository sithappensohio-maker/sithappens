import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";

const empty = { name:"", address:"", phone:"", email:"", emerg:"", credits:0 };

export default function Clients({ focusId = null, onConsumed = () => {} }) {
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [portalOpen, setPortalOpen] = useState(null); // client id
  const [portalForm, setPortalForm] = useState({ email:"", password:"" });
  const [sellOpen, setSellOpen] = useState(null); // client object
  const [packs, setPacks] = useState([]);
  const [err, setErr] = useState("");

  const load = async () => {
    const [c, p] = await Promise.all([api.get("/clients"), api.get("/credit-packs").catch(()=>({data:[]}))]);
    setClients(c.data);
    setPacks(p.data || []);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); setErr(""); };
  const openEdit = (c) => { setEditing(c); setForm({...empty, ...c}); setOpen(true); setErr(""); };

  useEffect(() => {
    if (!focusId || clients.length === 0) return;
    const c = clients.find(x => x.id === focusId);
    if (c) { openEdit(c); onConsumed(); }
  }, [focusId, clients]);

  const save = async () => {
    setErr("");
    try {
      if (editing) await api.put(`/clients/${editing.id}`, form);
      else await api.post("/clients", form);
      setOpen(false); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this client and all their dogs?")) return;
    await api.delete(`/clients/${id}`); load();
  };

  const openPortal = (c) => {
    setPortalOpen(c.id);
    setPortalForm({ email: c.portal_email || c.email || "", password: "" });
    setErr("");
  };

  const savePortal = async () => {
    setErr("");
    try {
      await api.post(`/clients/${portalOpen}/portal-account`, portalForm);
      setPortalOpen(null); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="clients-screen">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Client Hub</h3>
        <button onClick={openNew} data-testid="add-client-button"
                className="bg-shBlue text-white px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shBlue/90">+ Add Client</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="client-grid">
        {clients.length === 0 && <div className="col-span-full text-center text-gray-500 text-xs font-black uppercase py-16">No clients yet — add your first.</div>}
        {clients.map(c => (
          <div key={c.id} className="bg-bgPanel p-6 rounded-xl border-l-4 border-shBlue group relative shadow-lg" data-testid={`client-card-${c.id}`}>
            <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition">
              <button onClick={()=>openEdit(c)} className="text-gray-400 hover:text-white p-1" data-testid={`edit-client-${c.id}`}><i className="fas fa-edit" /></button>
              <button onClick={()=>remove(c.id)} className="text-gray-400 hover:text-red-400 p-1"><i className="fas fa-trash" /></button>
            </div>
            <h4 className="text-lg font-black text-white uppercase tracking-tight">{c.name}</h4>
            <div className="mt-2 space-y-1 text-xs text-gray-400">
              {c.phone && <p><i className="fas fa-phone w-4 text-shBlue" /> {c.phone}</p>}
              {c.email && <p><i className="fas fa-envelope w-4 text-shBlue" /> {c.email}</p>}
              {c.address && <p><i className="fas fa-map-marker-alt w-4 text-shBlue" /> {c.address}</p>}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-bgHover pt-3">
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Daycare</p>
                <p className="text-xl font-black text-shGreen" data-testid={`daycare-credits-${c.id}`}>{c.credits || 0}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Training</p>
                <p className="text-xl font-black text-purple-400" data-testid={`training-credits-${c.id}`}>{c.training_credits || 0}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Portal</p>
                <p className="text-[14px] text-shBlue font-black">{c.portal_email ? "Active" : "Not set"}</p>
              </div>
            </div>
            <button onClick={()=>openPortal(c)} data-testid={`portal-credentials-${c.id}`}
                    className="mt-4 w-full bg-shBlue/10 text-shBlue py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/20">
              {c.portal_email ? "Update Portal Login" : "Create Portal Login"}
            </button>
            <button onClick={()=>setSellOpen(c)} data-testid={`sell-pack-${c.id}`}
                    className="mt-2 w-full bg-shGreen/10 text-shGreen py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/20">
              <i className="fas fa-coins mr-1"/>Sell Credit Pack
            </button>
          </div>
        ))}
      </div>

      {open && (
        <Modal title={editing?"Edit Client":"New Client"} onClose={()=>setOpen(false)}>
          <div className="space-y-4">
            <Input label="Name" value={form.name} onChange={(v)=>setForm({...form, name:v})} testId="client-name-input" />
            <Input label="Address" value={form.address} onChange={(v)=>setForm({...form, address:v})} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Phone" value={form.phone} onChange={(v)=>setForm({...form, phone:v})} />
              <Input label="Credits" type="number" color="text-shBlue" value={form.credits} onChange={(v)=>setForm({...form, credits:parseInt(v)||0})} testId="client-credits-input" />
            </div>
            <Input label="Email" type="email" value={form.email} onChange={(v)=>setForm({...form, email:v})} />
            <Input label="Emergency Contact" color="text-red-400" value={form.emerg} onChange={(v)=>setForm({...form, emerg:v})} />
            {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={save} data-testid="save-client-button" className="bg-shBlue text-white px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg">Save</button>
            </div>
          </div>
        </Modal>
      )}

      {portalOpen && (
        <Modal title="Portal Login" onClose={()=>setPortalOpen(null)}>
          <p className="text-[15px] text-gray-400 mb-4">Set the email and password the client will use to access the portal.</p>
          <div className="space-y-4">
            <Input label="Login Email" type="email" value={portalForm.email} onChange={(v)=>setPortalForm({...portalForm, email:v})} testId="portal-email-input" />
            <Input label="Password (min 6 chars)" type="password" value={portalForm.password} onChange={(v)=>setPortalForm({...portalForm, password:v})} testId="portal-password-input" />
            {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setPortalOpen(null)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={savePortal} data-testid="save-portal-button" className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg">Save Login</button>
            </div>
          </div>
        </Modal>
      )}

      {sellOpen && (
        <SellPackModal client={sellOpen} packs={packs}
                       onClose={()=>setSellOpen(null)}
                       onSold={()=>{ setSellOpen(null); load(); }} />
      )}
    </div>
  );
}

function SellPackModal({ client, packs, onClose, onSold }) {
  const [poolFilter, setPoolFilter] = useState("all"); // all | daycare | training
  const active = packs.filter(p => p.active && (poolFilter === "all" || p.service_type === poolFilter));
  const [packId, setPackId] = useState(active[0]?.id || "");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Re-pick first pack whenever the filter shrinks the list
  useEffect(() => {
    if (active.length === 0) { setPackId(""); return; }
    if (!active.find(p => p.id === packId)) setPackId(active[0].id);
  }, [poolFilter]);  // eslint-disable-line

  const selected = active.find(p => p.id === packId);
  const isTraining = selected?.service_type === "training";

  const sell = async () => {
    setBusy(true); setErr("");
    try {
      await api.post(`/clients/${client.id}/sell-pack`, { pack_id: packId, payment_method: method, note });
      onSold?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Sale failed");
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Sell Credit Pack · ${client.name}`} onClose={onClose}>
      {packs.filter(p=>p.active).length === 0 ? (
        <p className="text-[14px] text-gray-400">No packs configured. Set them up in <span className="text-shBlue">Settings → Credit Packs</span> first.</p>
      ) : (
        <div className="space-y-4" data-testid="sell-pack-modal">
          <div className="flex gap-2">
            {[
              {k:"all", label:"All"},
              {k:"daycare", label:"Daycare", color:"text-shGreen"},
              {k:"training", label:"Training", color:"text-purple-400"},
            ].map(p => (
              <button key={p.k} onClick={()=>setPoolFilter(p.k)} data-testid={`pool-filter-${p.k}`}
                      className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest border ${poolFilter===p.k?"bg-bgBase border-shBlue text-shBlue":"border-bgHover text-gray-400 hover:text-shBlue"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Pack</label>
            <select value={packId} onChange={(e)=>setPackId(e.target.value)} data-testid="sell-pack-select"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              {active.map(p => <option key={p.id} value={p.id}>{p.name} · {p.qty} credits · ${p.price.toFixed(2)} (${p.value_each.toFixed(2)}/credit)</option>)}
            </select>
          </div>
          {selected && (
            <div className={`bg-bgBase border rounded p-3 grid grid-cols-3 gap-3 text-center ${isTraining ? "border-purple-400/30" : "border-shGreen/30"}`}>
              <div>
                <p className="text-[11px] uppercase tracking-widest text-gray-500">Credits</p>
                <p className={`text-2xl font-black ${isTraining ? "text-purple-400" : "text-shBlue"}`}>+{selected.qty}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest">{isTraining ? "training" : "daycare"}</p>
              </div>
              <div><p className="text-[11px] uppercase tracking-widest text-gray-500">Charge</p><p className="text-shGreen text-2xl font-black">${selected.price.toFixed(2)}</p></div>
              <div><p className="text-[11px] uppercase tracking-widest text-gray-500">Value/credit</p><p className="text-white text-2xl font-black">${selected.value_each.toFixed(2)}</p></div>
            </div>
          )}
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Payment method</label>
            <select value={method} onChange={(e)=>setMethod(e.target.value)}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Transfer</option><option value="check">Check</option><option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Note (optional)</label>
            <input value={note} onChange={(e)=>setNote(e.target.value)} placeholder="e.g., birthday gift, returning customer"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <p className="text-[11px] text-gray-500 italic">Income is recognized when each credit is redeemed at check-out, not now.</p>
          {err && <p className="text-red-400 text-[13px]">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
            <button onClick={sell} disabled={busy || !packId} data-testid="confirm-sell-pack"
                    className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Selling…" : "Sell Pack"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-8 shadow-2xl animate-slide-in">
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{title}</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Input({ label, value, onChange, type="text", color="text-gray-500", testId }) {
  return (
    <div>
      <label className={`text-[14px] font-black uppercase tracking-widest ${color}`}>{label}</label>
      <input type={type} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId}
             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
    </div>
  );
}

export { Modal };
