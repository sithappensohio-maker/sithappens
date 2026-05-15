import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

const empty = { name:"", address:"", phone:"", email:"", emerg:"", credits:0 };

export default function Clients({ focusId = null, onConsumed = () => {} }) {
  const confirm = useConfirm();
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [portalOpen, setPortalOpen] = useState(null); // client id
  const [portalForm, setPortalForm] = useState({ email:"", password:"" });
  const [sellOpen, setSellOpen] = useState(null); // client object
  const [receiptsOpen, setReceiptsOpen] = useState(null); // client object — shows list of past receipts
  const [packs, setPacks] = useState([]);
  const [err, setErr] = useState("");
  const [receipt, setReceipt] = useState(null); // populated after a sale to show the printable receipt

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
      if (editing) {
        await api.put(`/clients/${editing.id}`, form);
        setOpen(false); load();
      } else {
        const { data } = await api.post("/clients", form);
        setOpen(false);
        // If the new client has an email, auto-send a claim-your-account email.
        if (form.email) {
          try {
            await api.post(`/clients/${data.id}/send-claim-email`);
            setClaimToast({ clientId: data.id, msg: `Claim email sent to ${form.email}`, tone: "ok" });
            setTimeout(() => setClaimToast(t => t && t.clientId === data.id ? null : t), 5000);
          } catch (e) {
            // Don't block client creation if email fails — surface a warning instead.
            setClaimToast({ clientId: data.id, msg: "Client saved, but the claim email couldn't be sent. Use the button to retry.", tone: "warn" });
          }
        }
        load();
      }
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!(await confirm({ title: "Delete this client?", body: "This client and all their dogs will be removed. Bookings, training notes, and homework will also be deleted. This cannot be undone.", confirmText: "Delete client", tone: "danger" }))) return;
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

  const [claimToast, setClaimToast] = useState(null); // { clientId, msg, tone }
  const sendClaimEmail = async (c) => {
    const isReset = !!c.portal_email;
    const verb = isReset ? "reset" : "claim";
    if (!c.email) {
      setClaimToast({ clientId: c.id, msg: "Add an email to this client first.", tone: "warn" });
      return;
    }
    if (!(await confirm({
      title: isReset ? "Send password reset email?" : "Send claim account email?",
      body: `We'll email ${c.email} a one-time ${verb} link (valid for 7 days). They'll set their own password and be signed in automatically.`,
      confirmText: isReset ? "Send reset email" : "Send claim email",
      tone: "info",
    }))) return;
    try {
      await api.post(`/clients/${c.id}/send-claim-email`);
      setClaimToast({ clientId: c.id, msg: `Email sent to ${c.email}`, tone: "ok" });
      setTimeout(() => setClaimToast(t => t && t.clientId === c.id ? null : t), 4000);
    } catch (e) {
      setClaimToast({ clientId: c.id, msg: formatErr(e.response?.data?.detail) || "Failed to send email.", tone: "warn" });
    }
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
            <button onClick={()=>sendClaimEmail(c)} data-testid={`send-claim-email-${c.id}`}
                    className="mt-4 w-full bg-shGreen text-bgHeader py-2 rounded text-[14px] font-black uppercase tracking-widest shadow hover:bg-shGreen/90">
              <i className="fas fa-envelope mr-1"/>{c.portal_email ? "Send password reset email" : "Send claim account email"}
            </button>
            {claimToast && claimToast.clientId === c.id && (
              <div data-testid={`claim-toast-${c.id}`}
                   className={`mt-2 text-[12px] font-black uppercase tracking-widest rounded px-3 py-2 ${claimToast.tone === "ok" ? "bg-shGreen/15 text-shGreen" : "bg-yellow-500/15 text-yellow-300"}`}>
                <i className={`fas ${claimToast.tone === "ok" ? "fa-check" : "fa-exclamation-triangle"} mr-1`} />{claimToast.msg}
              </div>
            )}
            <button onClick={()=>openPortal(c)} data-testid={`portal-credentials-${c.id}`}
                    className="mt-2 w-full bg-shBlue/10 text-shBlue py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/20">
              {c.portal_email ? "Manually set portal password" : "Manually create portal login"}
            </button>
            <button onClick={()=>setSellOpen(c)} data-testid={`sell-pack-${c.id}`}
                    className="mt-2 w-full bg-shGreen/10 text-shGreen py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/20">
              <i className="fas fa-coins mr-1"/>Sell Credit Pack
            </button>
            <button onClick={()=>setReceiptsOpen(c)} data-testid={`receipts-${c.id}`}
                    className="mt-2 w-full bg-bgHover/40 text-gray-300 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-bgHover/70 hover:text-white">
              <i className="fas fa-receipt mr-1"/>Receipts
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
                       onSold={(r)=>{ setSellOpen(null); load(); if (r?.receipt) setReceipt({ client: sellOpen, ...r.receipt }); }} />
      )}

      {receipt && (
        <ReceiptModal data={receipt} onClose={()=>setReceipt(null)} />
      )}

      {receiptsOpen && (
        <ReceiptsListModal client={receiptsOpen}
                           onClose={()=>setReceiptsOpen(null)}
                           onReprint={(r)=>{ setReceipt({ client: receiptsOpen, ...r }); setReceiptsOpen(null); }} />
      )}
    </div>
  );
}

function SellPackModal({ client, packs, onClose, onSold }) {
  const [poolFilter, setPoolFilter] = useState("all"); // all | daycare | training
  const active = packs.filter(p => p.active && (poolFilter === "all" || p.service_type === poolFilter));
  // cart: { [pack_id]: quantity }
  const [cart, setCart] = useState({});
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const addToCart = (id) => setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 }));
  const removeFromCart = (id) => setCart(c => {
    const n = (c[id] || 0) - 1;
    const next = { ...c };
    if (n <= 0) delete next[id]; else next[id] = n;
    return next;
  });
  const clearItem = (id) => setCart(c => { const n = { ...c }; delete n[id]; return n; });

  const cartItems = Object.entries(cart).map(([pid, qty]) => {
    const pack = packs.find(p => p.id === pid);
    return pack ? { pack, qty } : null;
  }).filter(Boolean);

  const totalCredits = cartItems.reduce((sum, it) => sum + (it.pack.qty * it.qty), 0);
  const totalDaycare = cartItems.filter(it => (it.pack.service_type || "daycare") === "daycare").reduce((s, it) => s + it.pack.qty * it.qty, 0);
  const totalTraining = cartItems.filter(it => it.pack.service_type === "training").reduce((s, it) => s + it.pack.qty * it.qty, 0);
  const totalCharge = cartItems.reduce((sum, it) => sum + (it.pack.price * it.qty), 0);

  const sell = async () => {
    setBusy(true); setErr("");
    try {
      const items = cartItems.map(it => ({ pack_id: it.pack.id, quantity: it.qty }));
      const r = await api.post(`/clients/${client.id}/sell-packs`, { items, payment_method: method, note });
      onSold?.(r.data);
    } catch (e) {
      setErr(e.response?.data?.detail || "Sale failed");
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Sell Credit Packs · ${client.name}`} onClose={onClose}>
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
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Available Packs · tap to add</label>
            <div className="mt-2 space-y-1.5 max-h-56 overflow-auto pr-1">
              {active.map(p => {
                const isTr = p.service_type === "training";
                const inCart = cart[p.id] || 0;
                return (
                  <button key={p.id} onClick={()=>addToCart(p.id)} data-testid={`add-pack-${p.id}`}
                          className={`w-full text-left flex items-center justify-between bg-bgBase border rounded p-2.5 hover:border-shBlue transition ${inCart > 0 ? "border-shBlue" : "border-bgHover"}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-black text-white truncate">{p.name}</p>
                      <p className={`text-[11px] uppercase tracking-widest font-bold ${isTr ? "text-purple-400" : "text-shGreen"}`}>
                        {p.qty} {isTr ? "sessions" : "credits"} · ${p.price.toFixed(2)} · ${p.value_each.toFixed(2)}/each
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {inCart > 0 && <span className="bg-shBlue text-bgHeader px-2 py-0.5 rounded text-[12px] font-black">×{inCart}</span>}
                      <i className="fas fa-plus text-shGreen text-[14px]" />
                    </div>
                  </button>
                );
              })}
              {active.length === 0 && <p className="text-[13px] text-gray-500 italic">No packs in this pool.</p>}
            </div>
          </div>

          {cartItems.length > 0 && (
            <div className="border border-shGreen/40 bg-shGreen/5 rounded p-3 space-y-2" data-testid="sell-cart">
              <p className="text-[11px] uppercase tracking-widest text-shGreen font-black">Cart · {cartItems.length} line item{cartItems.length === 1 ? "" : "s"}</p>
              {cartItems.map(({ pack, qty }) => {
                const isTr = pack.service_type === "training";
                return (
                  <div key={pack.id} className="flex items-center justify-between gap-2 bg-bgBase rounded px-2 py-1.5" data-testid={`cart-row-${pack.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-white font-bold truncate">{pack.name}</p>
                      <p className={`text-[10px] uppercase tracking-widest font-bold ${isTr ? "text-purple-400" : "text-shGreen"}`}>
                        {pack.qty * qty} {isTr ? "sessions" : "credits"} · ${(pack.price * qty).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={()=>removeFromCart(pack.id)} data-testid={`cart-minus-${pack.id}`}
                              className="bg-bgHover text-white w-7 h-7 rounded font-black text-sm hover:bg-red-500/40">−</button>
                      <span className="text-white font-black w-6 text-center text-sm">{qty}</span>
                      <button onClick={()=>addToCart(pack.id)} data-testid={`cart-plus-${pack.id}`}
                              className="bg-bgHover text-white w-7 h-7 rounded font-black text-sm hover:bg-shGreen/40">+</button>
                      <button onClick={()=>clearItem(pack.id)} className="text-gray-500 hover:text-red-400 ml-1"><i className="fas fa-times text-xs"/></button>
                    </div>
                  </div>
                );
              })}
              <div className="grid grid-cols-3 gap-2 pt-2 text-center">
                <div><p className="text-[10px] uppercase tracking-widest text-gray-500">Daycare</p><p className="text-shGreen text-lg font-black">+{totalDaycare}</p></div>
                <div><p className="text-[10px] uppercase tracking-widest text-gray-500">Training</p><p className="text-purple-400 text-lg font-black">+{totalTraining}</p></div>
                <div><p className="text-[10px] uppercase tracking-widest text-gray-500">Charge</p><p className="text-white text-lg font-black" data-testid="cart-total-charge">${totalCharge.toFixed(2)}</p></div>
              </div>
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
            <button onClick={sell} disabled={busy || cartItems.length === 0} data-testid="confirm-sell-pack"
                    className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Selling…" : (totalCredits > 0 ? `Sell · +${totalCredits} credits · $${totalCharge.toFixed(2)}` : "Sell")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Modal({ title, children, onClose, maxWidth = "max-w-md" }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className={`bg-bgPanel border border-bgHover rounded-2xl w-full ${maxWidth} p-8 shadow-2xl animate-slide-in`}>
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{title}</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReceiptsListModal({ client, onClose, onReprint }) {
  const [receipts, setReceipts] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`/clients/${client.id}/receipts`)
      .then(r => { if (alive) setReceipts(r.data || []); })
      .catch(e => { if (alive) setErr(e.response?.data?.detail || "Failed to load receipts"); });
    return () => { alive = false; };
  }, [client.id]);

  return (
    <Modal title={`Receipts · ${client.name}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3 max-h-[60vh] overflow-auto" data-testid="receipts-list">
        {err && <p className="text-red-400 text-[13px]">{err}</p>}
        {receipts === null && !err && <p className="text-gray-500 text-[13px]">Loading…</p>}
        {receipts && receipts.length === 0 && (
          <p className="text-[14px] text-gray-400 italic">No pack purchases yet. Sales will appear here automatically.</p>
        )}
        {receipts && receipts.map((r, i) => {
          const dt = new Date(r.sold_at);
          const dc = r.totals?.daycare?.qty || 0;
          const tr = r.totals?.training?.qty || 0;
          return (
            <div key={i} data-testid={`receipt-row-${i}`}
                 className="bg-bgBase border border-bgHover rounded p-3 hover:border-shBlue transition">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-black text-white">{dt.toLocaleDateString()} · {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                  <p className="text-[11px] uppercase tracking-widest text-gray-500 mt-0.5">
                    {r.line_count} item{r.line_count === 1 ? "" : "s"} · {r.lot_count} pack{r.lot_count === 1 ? "" : "s"} · {r.payment_method} · {r.sold_by}
                  </p>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    {dc > 0 && <span className="text-[10px] uppercase tracking-widest font-black text-shGreen bg-shGreen/10 px-2 py-0.5 rounded">+{dc} daycare</span>}
                    {tr > 0 && <span className="text-[10px] uppercase tracking-widest font-black text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">+{tr} training</span>}
                  </div>
                  {r.note && <p className="text-[12px] text-gray-400 italic mt-1.5 truncate">"{r.note}"</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-shGreen text-xl font-black">${r.total_price.toFixed(2)}</p>
                  <button onClick={()=>onReprint(r)} data-testid={`reprint-${i}`}
                          className="mt-1.5 text-[11px] font-black uppercase tracking-widest text-shBlue hover:text-white">
                    <i className="fas fa-print mr-1"/>Reprint
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end pt-4">
        <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Close</button>
      </div>
    </Modal>
  );
}

function ReceiptModal({ data, onClose }) {
  const { client, lines = [], totals = {}, total_price = 0, payment_method = "cash", note = "", sold_by = "", sold_at = "" } = data || {};
  const dc = totals.daycare?.qty || 0;
  const tr = totals.training?.qty || 0;
  const dateStr = sold_at ? new Date(sold_at).toLocaleString() : new Date().toLocaleString();
  const print = () => window.print();

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 print:bg-white print:p-0 print:block" data-testid="pack-receipt">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg shadow-2xl print:shadow-none print:bg-white print:border-0 print:rounded-none print:max-w-none print:w-full">
        {/* Header (hidden in print) */}
        <div className="flex items-center justify-between p-6 border-b border-bgHover print:hidden">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-receipt text-shGreen mr-2"/>Sale Complete
          </h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white" data-testid="receipt-close"><i className="fas fa-times"/></button>
        </div>

        {/* Printable receipt body */}
        <div id="pack-receipt-print" className="p-6 text-white print:text-black print:p-10">
          <div className="border-b border-bgHover pb-4 mb-4 print:border-gray-300">
            <p className="text-[11px] uppercase tracking-widest text-shGreen print:text-gray-600 font-black">Sit Happens · Receipt</p>
            <h3 className="text-2xl font-black mt-1 uppercase tracking-tight print:text-black">{client?.name}</h3>
            <p className="text-[12px] text-gray-400 print:text-gray-600 mt-1">{dateStr} · Sold by {sold_by}</p>
          </div>

          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600">
                <th className="text-left font-black pb-2">Item</th>
                <th className="text-right font-black pb-2">Qty</th>
                <th className="text-right font-black pb-2">Each</th>
                <th className="text-right font-black pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-bgHover print:border-gray-300" data-testid={`receipt-line-${i}`}>
                  <td className="py-2.5 font-bold">
                    {l.name}
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-bold">
                      {(l.pack_qty || 0) * l.qty} {l.service_type === "training" ? "training sessions" : "daycare credits"}
                    </p>
                  </td>
                  <td className="text-right py-2.5 font-bold">{l.qty}</td>
                  <td className="text-right py-2.5">${l.unit_price.toFixed(2)}</td>
                  <td className="text-right py-2.5 font-black">${l.line_total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            {dc > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Daycare credits added</p>
                <p className="text-shGreen text-2xl font-black print:text-black">+{dc}</p>
              </div>
            )}
            {tr > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Training sessions added</p>
                <p className="text-purple-400 text-2xl font-black print:text-black">+{tr}</p>
              </div>
            )}
          </div>

          <div className="mt-5 border-t-2 border-shGreen pt-3 flex items-end justify-between print:border-black">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Payment · {payment_method}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black mt-1">Credits never expire</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Total charged</p>
              <p className="text-shGreen text-3xl font-black print:text-black" data-testid="receipt-total">${total_price.toFixed(2)}</p>
            </div>
          </div>

          {note && <p className="mt-4 text-[12px] text-gray-400 italic print:text-gray-600">Note: {note}</p>}

          <p className="mt-6 text-[11px] text-gray-500 print:text-gray-600 text-center">
            Sit Happens Dog Training · Daycare · Boarding<br/>
            Thank you for your business!
          </p>
        </div>

        {/* Actions (hidden in print) */}
        <div className="flex justify-end gap-3 p-6 border-t border-bgHover print:hidden">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest" data-testid="receipt-done">Done</button>
          <button onClick={print} data-testid="receipt-print"
                  className="bg-shBlue text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg hover:bg-shBlue/90">
            <i className="fas fa-print mr-2"/>Print Receipt
          </button>
        </div>
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
