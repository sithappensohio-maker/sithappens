/* Photo orders — ring up a photo package for a customer, record who is in
   the shot and how to find the file, take payment through the real register,
   then fulfil afterwards (mark ready, send the digitals, track framed prints).
   Nothing is handed over on the spot; every order is a delivery promise.

   `PhotoOrdersPanel` is shared by anything that sells photos — an event's
   photo booth (Trunk or Treat) and every Photo Special (Howl-O-Ween,
   Christmas, ...). `base` is the owner's admin API path; the server side is
   the one shared engine in backend/domains/photo_orders. `EventPhotosPanel`
   (default export) is the event flavour: it searches registrations. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

export const money = (n) => `$${Number(n || 0).toFixed(2)}`;
export const TENDER_METHODS = [["cash", "Cash"], ["card", "Card"], ["check", "Check"], ["venmo", "Venmo"], ["paypal", "PayPal"], ["other", "Other"]];
export const STATUS_META = {
  ordered: { label: "Unpaid", tone: "orange" },
  paid: { label: "Paid", tone: "blue" },
  ready: { label: "Ready", tone: "green" },
  sent: { label: "Sent", tone: "muted" },
};
export const PRINT_STATUS = [["none", "No print"], ["pending", "Print pending"], ["ready", "Print ready"], ["picked_up", "Picked up"], ["mailed", "Mailed"]];
const FILTERS = [["all", "All"], ["ordered", "Unpaid"], ["paid", "Paid"], ["ready", "Ready"], ["sent", "Sent"]];

function newKey() {
  try { return crypto.randomUUID(); } catch { return `k-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}
export function packageLabel(p) {
  if (!p) return "";
  const parts = [];
  if (p.digitals) parts.push(`${p.digitals} digital${p.digitals === 1 ? "" : "s"}`);
  if (p.print) parts.push(`${p.print} framed print`);
  return parts.join(" + ") || p.name;
}
function fmtWhen(iso) {
  if (!iso) return "";
  try { const d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch { return iso; }
}

const inputCls = "w-full mt-1 bg-bgBase border border-bgHover rounded-xl px-3 py-3 text-white text-[16px] focus:border-shGreen outline-none";
const labelCls = "text-[11px] font-black text-shTextMuted uppercase tracking-widest";

function Pill({ tone = "muted", children, testid }) {
  const cls = {
    green: "bg-shGreen/15 text-shGreen ring-1 ring-shGreen/40", orange: "bg-shOrange/15 text-shOrange ring-1 ring-shOrange/40",
    blue: "bg-shBlue/15 text-shBlue ring-1 ring-shBlue/40", red: "bg-red-500/15 text-red-300 ring-1 ring-red-500/40", muted: "bg-shSurfaceRaised text-shTextMuted",
  }[tone];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wide whitespace-nowrap ${cls}`} data-testid={testid}>{children}</span>;
}

function Sheet({ title, icon, onClose, children, testid, wide = false }) {
  useEffect(() => { const onKey = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" onClick={onClose} data-testid={testid}>
      <div className={`bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full ${wide ? "max-w-2xl" : "max-w-lg"} p-4 sm:p-6 shadow-2xl max-h-[calc(var(--app-height,100vh)_-_1rem)] overflow-y-auto sh-modal-surface`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-lg font-black text-white uppercase italic tracking-tight pr-2"><i className={`fas ${icon} text-shGreen mr-2`} />{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" data-testid={`${testid}-close`} className="text-gray-400 hover:text-white text-xl min-w-[44px] min-h-[44px]"><i className="fas fa-times" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- New order ---------------- */
const emptyOrder = () => ({ registration_id: null, booking_id: null, client_id: null, primary_contact: "", phone: "", email: "", dogs: "", contestant_numbers: [], shot_ref: "", package_key: "", qty: 1, notes: "" });

function NewOrderSheet({ base, owner, search, searchLabel, searchPlaceholder, linkedLabel, initial, onClose, onCreated }) {
  const [f, setF] = useState(() => ({ ...emptyOrder(), ...(initial || {}) }));
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const packages = owner.photo_packages || [];
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!search || !q.trim()) { setMatches([]); return undefined; }
    let alive = true; setSearching(true);
    const t = setTimeout(async () => {
      try { const found = await search(q.trim()); if (alive) setMatches((found || []).slice(0, 8)); }
      catch { if (alive) setMatches([]); }
      if (alive) setSearching(false);
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [q, search]);

  // A match is { id, title, tag, sub, fill } — `fill` is merged into the form.
  const pick = (m) => { setF((p) => ({ ...p, ...m.fill })); setQ(""); setMatches([]); };
  const pkg = packages.find((p) => p.key === f.package_key);
  const total = pkg ? pkg.price * (Number(f.qty) || 1) : 0;

  const submit = async (e) => {
    e.preventDefault(); setErr("");
    if (!pkg) { setErr("Pick a package."); return; }
    if (!f.primary_contact.trim()) { setErr("Who is this for?"); return; }
    if (!f.email.trim()) { setErr("An email is needed to deliver the photos."); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`${base}/photo-orders`, {
        ...f, primary_contact: f.primary_contact.trim(), email: f.email.trim(), phone: f.phone.trim(),
        dogs: f.dogs.split(",").map((s) => s.trim()).filter(Boolean), qty: Number(f.qty) || 1, shot_ref: f.shot_ref.trim(), notes: f.notes.trim(),
      });
      toast.success(`Order ${data.order.order_number} created`);
      onCreated(data);
    } catch (ex) { setErr(formatErr(ex.response?.data?.detail) || "Couldn't create the order."); }
    setBusy(false);
  };

  return (
    <Sheet title="New photo order" icon="fa-camera-retro" onClose={onClose} testid="photo-order-new" wide>
      <form onSubmit={submit} className="space-y-4">
        <div>
          {search && <>
          <p className={labelCls}>{searchLabel} <span className="normal-case font-normal">(or fill in a walk-up below)</span></p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className={inputCls} inputMode="search" data-testid="photo-order-search" />
          {(matches.length > 0 || searching) && (
            <div className="mt-1 rounded-xl border border-bgHover bg-bgBase divide-y divide-bgHover" data-testid="photo-order-matches">
              {searching && matches.length === 0 && <p className="px-3 py-2 text-[13px] text-shTextMuted">Searching…</p>}
              {matches.map((m) => (
                <button key={m.id} type="button" onClick={() => pick(m)} data-testid={`photo-order-match-${m.id}`} className="w-full text-left px-3 py-2.5 min-h-[44px] hover:bg-bgHover/40">
                  <span className="font-black text-white">{m.title}</span> {m.tag && <span className="font-mono text-shBlue text-[12px]">{m.tag}</span>}
                  {m.sub && <span className="text-shTextMuted text-[12px]"> · {m.sub}</span>}
                </button>
              ))}
            </div>
          )}
          </>}
          {(f.registration_id || f.booking_id) && <p className="text-[12px] text-shGreen font-black mt-1" data-testid="photo-order-linked"><i className="fas fa-link mr-1" />{linkedLabel}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Name</label><input required value={f.primary_contact} onChange={(e) => set("primary_contact")(e.target.value)} className={inputCls} data-testid="photo-order-name" /></div>
          <div><label className={labelCls}>Email <span className="normal-case font-normal">(for delivery)</span></label><input required type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} className={inputCls} data-testid="photo-order-email" /></div>
          <div><label className={labelCls}>Phone</label><input type="tel" value={f.phone} onChange={(e) => set("phone")(e.target.value)} className={inputCls} data-testid="photo-order-phone" /></div>
          <div><label className={labelCls}>Dogs in the shot <span className="normal-case font-normal">(comma separated)</span></label><input value={f.dogs} onChange={(e) => set("dogs")(e.target.value)} className={inputCls} data-testid="photo-order-dogs" placeholder="Waffles, Pickles" /></div>
          <div><label className={labelCls}>Shot reference <span className="normal-case font-normal">(frame # / note to find the file)</span></label><input value={f.shot_ref} onChange={(e) => set("shot_ref")(e.target.value)} className={inputCls} data-testid="photo-order-shot" placeholder="e.g. IMG_0412–0418" /></div>
          <div><label className={labelCls}>Notes</label><input value={f.notes} onChange={(e) => set("notes")(e.target.value)} className={inputCls} data-testid="photo-order-notes" placeholder="Family in the shot, costume, anything for editing" /></div>
        </div>
        <div>
          <p className={labelCls}>Package</p>
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="photo-order-packages">
            {packages.map((p) => (
              <button key={p.key} type="button" onClick={() => set("package_key")(p.key)} aria-pressed={f.package_key === p.key} data-testid={`photo-order-package-${p.key}`}
                      className={`text-left rounded-xl border px-3 py-3 min-h-[56px] ${f.package_key === p.key ? "border-shGreen bg-shGreen/10" : "border-bgHover bg-bgBase"}`}>
                <span className="flex items-center justify-between gap-2"><span className="font-black text-white text-[15px]">{p.name}</span><span className="font-black text-shGreen tabular-nums">{money(p.price)}</span></span>
                <span className="block text-[12px] text-shTextMuted">{packageLabel(p)}{p.popular ? " · Most popular" : ""}</span>
              </button>
            ))}
            {packages.length === 0 && <p className="text-[13px] text-shTextMuted">No packages yet. Add them in the editor under photo packages.</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className={labelCls} htmlFor="po-qty">Qty</label>
          <input id="po-qty" type="number" min="1" max="10" inputMode="numeric" value={f.qty} onChange={(e) => set("qty")(e.target.value)} className="w-20 bg-bgBase border border-bgHover rounded-xl px-3 py-3 text-white text-[16px] text-center" data-testid="photo-order-qty" />
          <span className="ml-auto text-[13px] text-shTextMuted">Total <span className="text-white font-black text-[18px] tabular-nums" data-testid="photo-order-total">{money(total)}</span> <span className="text-[11px]">+ tax</span></span>
        </div>
        {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="photo-order-error">{err}</div>}
        <button type="submit" disabled={busy} data-testid="photo-order-create" className="w-full min-h-[56px] rounded-xl bg-shGreen text-bgHeader font-black text-[15px] uppercase tracking-widest disabled:opacity-50">{busy ? "Saving…" : "Save order & take payment"}</button>
      </form>
    </Sheet>
  );
}

/* ---------------- Payment ---------------- */
function PaymentSheet({ base, order, onClose, onPaid }) {
  const [method, setMethod] = useState("cash");
  const [tendered, setTendered] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const keyRef = useRef(newKey());
  useEffect(() => {
    let alive = true;
    api.post(`${base}/photo-orders/${order.id}/preview`).then((r) => { if (alive) setPreview(r.data); }).catch((e) => { if (alive) setErr(formatErr(e.response?.data?.detail) || "Couldn't price this order."); });
    return () => { alive = false; };
  }, [base, order.id]);
  const total = preview?.total ?? 0;
  const received = method === "cash" ? Number(tendered || 0) : total;
  const change = method === "cash" && received > total ? Math.round((received - total) * 100) / 100 : 0;
  const pay = async () => {
    setErr("");
    if (method === "cash" && received + 0.005 < total) { setErr("Cash received is less than the total."); return; }
    if (method === "other" && !note.trim()) { setErr("Say what the other payment was."); return; }
    setBusy(true);
    try {
      const tender = { method, amount: total, tendered_amount: method === "cash" ? received : null, notes: note.trim() || null };
      const { data } = await api.post(`${base}/photo-orders/${order.id}/checkout`, { tenders: [tender], idempotency_key: keyRef.current });
      toast.success(`Paid · receipt ${data.order.receipt_number}`);
      onPaid(data, change);
    } catch (ex) { setErr(formatErr(ex.response?.data?.detail) || "Payment didn't go through."); }
    setBusy(false);
  };
  return (
    <Sheet title={`Take payment · ${order.order_number}`} icon="fa-cash-register" onClose={onClose} testid="photo-order-pay">
      <p className="text-[14px] text-shText">{order.primary_contact} · {order.package_name}{order.qty > 1 ? ` × ${order.qty}` : ""}</p>
      <div className="mt-3 bg-bgBase border border-bgHover rounded-xl p-3 space-y-1 text-[14px]" data-testid="photo-order-pay-breakdown">
        {preview ? (
          <>
            <p className="flex justify-between"><span className="text-shTextMuted">Subtotal</span><span className="tabular-nums">{money(preview.subtotal)}</span></p>
            {preview.tax_amount > 0 && <p className="flex justify-between"><span className="text-shTextMuted">Sales tax</span><span className="tabular-nums">{money(preview.tax_amount)}</span></p>}
            <p className="flex justify-between text-[20px] font-black text-white"><span>Total</span><span className="tabular-nums" data-testid="photo-order-pay-total">{money(preview.total)}</span></p>
          </>
        ) : <p className="text-shTextMuted">Pricing…</p>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2" data-testid="photo-order-methods">
        {TENDER_METHODS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMethod(k)} aria-pressed={method === k} data-testid={`photo-order-method-${k}`}
                  className={`min-h-[48px] rounded-xl text-[13px] font-black uppercase tracking-widest border ${method === k ? "bg-shGreen text-bgHeader border-shGreen" : "bg-bgBase border-bgHover text-gray-300"}`}>{label}</button>
        ))}
      </div>
      {method === "cash" && (
        <div className="mt-3">
          <label className={labelCls} htmlFor="po-tendered">Cash received</label>
          <div className="flex gap-2 items-center">
            <input id="po-tendered" type="number" inputMode="decimal" step="0.01" min="0" value={tendered} onChange={(e) => setTendered(e.target.value)} className={inputCls} data-testid="photo-order-tendered" placeholder={money(total)} />
            <button type="button" onClick={() => setTendered(String(total))} className="mt-1 min-h-[48px] px-3 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover whitespace-nowrap">Exact</button>
          </div>
          {change > 0 && <p className="mt-2 text-[15px] font-black text-shGreen" data-testid="photo-order-change">Change due {money(change)}</p>}
        </div>
      )}
      {method === "other" && <div className="mt-3"><label className={labelCls} htmlFor="po-note">What was it?</label><input id="po-note" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} data-testid="photo-order-pay-note" /></div>}
      {err && <div className="mt-3 text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="photo-order-pay-error">{err}</div>}
      <button type="button" onClick={pay} disabled={busy || !preview} data-testid="photo-order-pay-submit" className="mt-4 w-full min-h-[56px] rounded-xl bg-shGreen text-bgHeader font-black text-[15px] uppercase tracking-widest disabled:opacity-50">
        {busy ? "Charging…" : `Charge ${money(total)}`}
      </button>
      <p className="mt-2 text-[12px] text-shTextMuted text-center">Rings through the register like any sale: receipt, drawer, tax and P&L.</p>
    </Sheet>
  );
}

/* ---------------- Send digitals ---------------- */
function SendSheet({ base, order, onClose, onSent }) {
  const [link, setLink] = useState(order.delivery_link || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const send = async () => {
    setErr("");
    if (!/^https?:\/\//i.test(link.trim())) { setErr("Paste the download link (starts with http)."); return; }
    setBusy(true);
    try { const { data } = await api.post(`${base}/photo-orders/${order.id}/send`, { delivery_link: link.trim(), message: message.trim() }); toast.success(`Sent to ${order.email}`); onSent(data); }
    catch (ex) { setErr(formatErr(ex.response?.data?.detail) || "Couldn't send."); }
    setBusy(false);
  };
  return (
    <Sheet title="Send the photos" icon="fa-paper-plane" onClose={onClose} testid="photo-order-send">
      <p className="text-[14px] text-shText">Emails <span className="font-black text-white">{order.email}</span> a "your photos are ready" note with the link below, and marks the order Sent.</p>
      <label className={`${labelCls} block mt-3`} htmlFor="po-link">Download link</label>
      <input id="po-link" value={link} onChange={(e) => setLink(e.target.value)} className={inputCls} placeholder="https://… (Drive, Dropbox, gallery)" data-testid="photo-order-link" />
      <label className={`${labelCls} block mt-3`} htmlFor="po-msg">Personal note <span className="normal-case font-normal">(optional)</span></label>
      <textarea id="po-msg" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} data-testid="photo-order-message" />
      {err && <div className="mt-3 text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="photo-order-send-error">{err}</div>}
      <button type="button" onClick={send} disabled={busy} data-testid="photo-order-send-submit" className="mt-4 w-full min-h-[52px] rounded-xl bg-shGreen text-bgHeader font-black text-[14px] uppercase tracking-widest disabled:opacity-50">{busy ? "Sending…" : "Send & mark sent"}</button>
    </Sheet>
  );
}

/* ---------------- Panel ---------------- */
export function PhotoOrdersPanel({ owner, base, can, search = null, searchLabel = "Find a customer", searchPlaceholder = "Name or dog",
  linkedLabel = "Linked to their booking", subtitle = "Ring up the package, deliver within the week.",
  startOrder = null, onStartOrderUsed, onOrdersChanged }) {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(null);
  const [sending, setSending] = useState(null);
  const [busy, setBusy] = useState("");
  const [lastChange, setLastChange] = useState(0);
  const canPay = !!can?.("take_payments");
  // Opened with a customer already in hand (a reservation): go straight to a
  // prefilled new order.
  useEffect(() => {
    if (startOrder) { setCreating(startOrder); onStartOrderUsed?.(); }
  }, [startOrder, onStartOrderUsed]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([
        api.get(`${base}/photo-orders`, { params: { q: q.trim(), status: filter } }),
        api.get(`${base}/photo-orders/summary`),
      ]);
      setOrders(o.data.orders || []); setSummary(s.data); setErr("");
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Couldn't load photo orders."); }
    setLoading(false);
  }, [base, q, filter]);
  useEffect(() => { const t = setTimeout(load, q ? 200 : 0); return () => clearTimeout(t); }, [load, q]);

  const apply = (data) => {
    if (data.order) setOrders((os) => (os.some((o) => o.id === data.order.id) ? os.map((o) => (o.id === data.order.id ? data.order : o)) : [data.order, ...os]));
    if (data.summary) setSummary(data.summary);
  };
  const patch = async (order, body, msg) => {
    setBusy(order.id);
    try { const { data } = await api.patch(`${base}/photo-orders/${order.id}`, body); apply(data); if (msg) toast.success(msg); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail) || "That didn't save."); }
    setBusy("");
  };
  const remove = async (order) => {
    if (!window.confirm(`Delete order ${order.order_number}? Only unpaid orders can be deleted.`)) return;
    setBusy(order.id);
    try { await api.delete(`${base}/photo-orders/${order.id}`); setOrders((os) => os.filter((o) => o.id !== order.id)); load(); toast.success("Order deleted"); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't delete."); }
    setBusy("");
  };
  const exportCsv = async () => {
    try {
      const r = await api.get(`${base}/photo-orders.csv`, { responseType: "blob" });
      const href = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = href; a.download = `${owner.slug || "photo"}-photo-orders.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Export failed."); }
  };

  const cards = useMemo(() => summary ? [
    ["orders", "Photo orders", summary.orders], ["revenue", "Revenue", money(summary.revenue)], ["unpaid", "Unpaid", summary.unpaid],
    ["to_send", "Waiting to send", summary.to_send], ["sent", "Sent", summary.sent], ["prints", "Prints pending", summary.prints_pending],
  ] : [], [summary]);

  return (
    <div className="space-y-3" data-testid="event-photos">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="min-w-0 sm:flex-1">
          <p className="text-[15px] font-black uppercase italic tracking-tight text-white">{owner.photos_title || owner.name || "Event photos"}</p>
          <p className="text-[12px] text-shTextMuted">{subtitle}</p>
        </div>
        <div className="flex gap-2">
        <button type="button" onClick={exportCsv} data-testid="photo-orders-export" className="min-h-[44px] px-3 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover"><i className="fas fa-file-csv mr-1.5" />CSV</button>
        <button type="button" onClick={() => setCreating(true)} data-testid="photo-order-add" className="min-h-[48px] px-4 rounded-xl bg-shGreen text-bgHeader font-black text-[13px] uppercase tracking-widest"><i className="fas fa-camera-retro mr-1.5" />New photo order</button>
        </div>
      </div>
      {lastChange > 0 && <div className="rounded-xl border border-shGreen/50 bg-shGreen/10 p-3 text-center" data-testid="photo-change-due"><span className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Change due</span><p className="text-3xl font-black text-shGreen tabular-nums">{money(lastChange)}</p><button type="button" onClick={() => setLastChange(0)} className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mt-1">Done</button></div>}
      {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="photo-orders-error">{err}</div>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2" data-testid="photo-summary">
        {cards.map(([k, label, v]) => (
          <div key={k} className="bg-bgPanel border border-bgHover rounded-2xl p-3" data-testid={`photo-stat-${k}`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">{label}</p>
            <p className="text-[24px] font-black text-white leading-none mt-1 tabular-nums" data-testid={`photo-stat-${k}-value`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="relative">
        <i className="fas fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-shTextMuted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, order #, dog or shot" inputMode="search" data-testid="photo-orders-search"
               className="w-full bg-bgPanel border border-bgHover rounded-2xl pl-11 pr-4 py-3.5 text-white text-[16px] focus:border-shGreen outline-none" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} data-testid={`photo-filter-${k}`} className={`min-h-[36px] px-3 rounded-lg text-[11px] font-black uppercase tracking-widest ${filter === k ? "bg-shSurfaceRaised text-shText ring-1 ring-bgHover" : "text-shTextMuted"}`}>{label}</button>)}
        <span className="ml-auto text-[12px] text-shTextMuted">{loading ? "Loading…" : `${orders.length} shown`}</span>
      </div>
      {!loading && orders.length === 0 && <p className="text-shTextMuted text-[14px] py-6 text-center" data-testid="photo-orders-empty">No photo orders yet.</p>}
      <div className="space-y-2">
        {orders.map((o) => {
          const st = STATUS_META[o.status] || STATUS_META.ordered;
          return (
            <div key={o.id} className={`bg-bgPanel border rounded-2xl p-3 sm:p-4 ${o.status === "ordered" ? "border-shOrange/50" : "border-bgHover"}`} data-testid={`photo-order-${o.id}`} data-status={o.status}>
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-black text-white leading-tight">{o.primary_contact} <span className="font-mono text-shBlue text-[12px] ml-1">{o.order_number}</span></p>
                  <p className="text-[13px] text-shText mt-0.5">{o.package_name}{o.qty > 1 ? ` × ${o.qty}` : ""} · <span className="tabular-nums">{money(o.total ?? o.list_total)}</span>{o.receipt_number ? <span className="text-shTextMuted"> · receipt {o.receipt_number}</span> : null}</p>
                  <p className="text-[12px] text-shTextMuted mt-0.5 truncate">{o.email}{o.phone ? ` · ${o.phone}` : ""}{o.dogs?.length ? ` · ${o.dogs.join(", ")}` : ""}{o.shot_ref ? ` · shot ${o.shot_ref}` : ""}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Pill tone={st.tone} testid={`photo-order-status-${o.id}`}>{st.label}</Pill>
                    {o.contestant_numbers?.length > 0 && <Pill tone="orange"><i className="fas fa-hat-wizard" />{o.contestant_numbers.map((n) => `#${String(n).padStart(3, "0")}`).join(" ")}</Pill>}
                    {o.print_status && o.print_status !== "none" && <Pill>{PRINT_STATUS.find(([k]) => k === o.print_status)?.[1]}</Pill>}
                    {o.sent_at && <Pill tone="green"><i className="fas fa-check" />Sent {fmtWhen(o.sent_at)}</Pill>}
                  </div>
                </div>
                <div className="flex flex-wrap sm:flex-col gap-1.5 shrink-0 sm:w-[150px]">
                  {o.status === "ordered" && canPay && <button type="button" onClick={() => setPaying(o)} data-testid={`photo-order-pay-${o.id}`} className="min-h-[44px] px-3 rounded-xl bg-shGreen text-bgHeader font-black text-[12px] uppercase tracking-widest">Take payment</button>}
                  {o.status === "paid" && <button type="button" onClick={() => patch(o, { status: "ready" }, "Marked ready")} disabled={busy === o.id} data-testid={`photo-order-ready-${o.id}`} className="min-h-[44px] px-3 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover">Mark ready</button>}
                  {(o.status === "paid" || o.status === "ready") && <button type="button" onClick={() => setSending(o)} data-testid={`photo-order-send-${o.id}`} className="min-h-[44px] px-3 rounded-xl bg-shBlue text-white font-black text-[12px] uppercase tracking-widest">Send photos</button>}
                  {o.print && (
                    <select value={o.print_status || "pending"} onChange={(e) => patch(o, { print_status: e.target.value }, "Print status saved")} data-testid={`photo-order-print-${o.id}`} className="min-h-[40px] bg-bgBase border border-bgHover rounded-xl px-2 text-white text-[12px]">
                      {PRINT_STATUS.filter(([k]) => k !== "none").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  )}
                  {o.status === "ordered" && <button type="button" onClick={() => remove(o)} disabled={busy === o.id} data-testid={`photo-order-delete-${o.id}`} className="min-h-[36px] px-3 rounded-xl text-red-300 font-black text-[11px] uppercase tracking-widest">Delete</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {creating && <NewOrderSheet base={base} owner={owner} search={search} searchLabel={searchLabel} searchPlaceholder={searchPlaceholder} linkedLabel={linkedLabel}
                                  initial={creating === true ? null : creating} onClose={() => setCreating(false)}
                                  onCreated={(data) => { setCreating(false); apply(data); onOrdersChanged?.(); if (canPay) setPaying(data.order); }} />}
      {paying && <PaymentSheet base={base} order={paying} onClose={() => setPaying(null)} onPaid={(data, change) => { setPaying(null); apply(data); if (change > 0) setLastChange(change); }} />}
      {sending && <SendSheet base={base} order={sending} onClose={() => setSending(null)} onSent={(data) => { setSending(null); apply(data); }} />}
    </div>
  );
}

/* The event flavour: search the event's registrations to link the order. */
export default function EventPhotosPanel({ event, can }) {
  const search = useCallback(async (q) => {
    const { data } = await api.get(`/admin/events/${event.id}/registrations`, { params: { q, status: "registered" } });
    return (data.registrations || []).map((r) => ({
      id: r.id, title: r.primary_contact, tag: r.confirmation_number, sub: r.dog_names,
      fill: { registration_id: r.id, client_id: r.client_id || null, primary_contact: r.primary_contact || "", phone: r.phone || "", email: r.email || "",
        dogs: (r.dogs || []).map((d) => d.name).join(", "), contestant_numbers: (r.dogs || []).map((d) => d.contestant_number).filter(Boolean) },
    }));
  }, [event.id]);
  return <PhotoOrdersPanel owner={event} base={`/admin/events/${event.id}`} can={can} search={search}
                           searchLabel="Find a registered household" searchPlaceholder="Name, phone, confirmation # or dog"
                           linkedLabel="Linked to their registration" subtitle="Ring up at the booth, deliver within the week." />;
}
