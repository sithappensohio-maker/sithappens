import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { visibleRecents, clearRecents } from "../lib/recentlyOpened";

const RECENT_ICON = {
  client: "fa-user", dog: "fa-paw", booking: "fa-calendar-check",
  invoice: "fa-file-invoice-dollar", payment: "fa-money-bill-wave",
  shop_order: "fa-box", prepaid_purchase: "fa-ticket",
};

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const BOOKING_STATUS_LABEL = {
  pending: "Pending approval", approved: "Confirmed", rejected: "Declined",
  completed: "Completed", cancelled: "Cancelled",
};
const INVOICE_STATUS_LABEL = {
  DRAFT: "Draft", OPEN: "Unpaid", PARTIALLY_PAID: "Partially paid", PAID: "Paid",
  REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Partially refunded", VOID: "Voided",
};

// Builds the flat, ordered list of result rows plus which group each row
// belongs to, so keyboard nav and mouse hover share one index space and
// groups with zero results simply don't render.
function buildGroups(results) {
  const groups = [];
  if (results.clients?.length) {
    groups.push({
      key: "clients", label: "Clients",
      items: results.clients.map((c) => ({
        kind: "client", id: c.id, title: c.name,
        subtitle: c.email || c.phone || "No contact on file",
        icon: "fa-user",
      })),
    });
  }
  if (results.dogs?.length) {
    groups.push({
      key: "dogs", label: "Dogs",
      items: results.dogs.map((d) => ({
        kind: "dog", id: d.id, client_id: d.owner_id, title: d.name,
        subtitle: `Owner: ${d.owner_name || "Unknown"}`,
        meta: d.upcoming ? `Upcoming: ${d.upcoming}` : null,
        icon: "fa-paw",
      })),
    });
  }
  if (results.bookings?.length) {
    groups.push({
      key: "bookings", label: "Bookings",
      items: results.bookings.map((b) => ({
        kind: "booking", id: b.id, client_id: b.client_id, dog_id: b.dog_id,
        title: `Booking #${b.reference}`,
        subtitle: `${b.dog_name} — ${(b.service_type || "").replace(/^\w/, (c) => c.toUpperCase())}`,
        meta: `${b.date}${b.end_date && b.end_date !== b.date ? ` – ${b.end_date}` : ""} · ${BOOKING_STATUS_LABEL[b.status] || b.status}`,
        icon: "fa-calendar-check",
      })),
    });
  }
  if (results.invoices?.length) {
    groups.push({
      key: "invoices", label: "Bills",
      items: results.invoices.map((inv) => ({
        kind: "invoice", id: inv.id, client_id: inv.client_id,
        title: `Bill #${inv.reference}`,
        subtitle: inv.client_name,
        meta: inv.balance > 0.005 ? `${money(inv.balance)} due` : INVOICE_STATUS_LABEL[inv.status] || inv.status,
        icon: "fa-file-invoice-dollar",
      })),
    });
  }
  if (results.payments?.length) {
    groups.push({
      key: "payments", label: "Payments",
      items: results.payments.map((p) => ({
        kind: "payment", id: p.id, client_id: p.client_id,
        title: `Payment #${p.reference}`,
        subtitle: p.client_name || "Unknown client",
        meta: `${money(p.amount)} · ${(p.method || "").replace(/_/g, " ")}`,
        icon: "fa-money-bill-wave",
      })),
    });
  }
  if (results.shop_orders?.length) {
    groups.push({
      key: "shop_orders", label: "Shop Orders",
      items: results.shop_orders.map((o) => ({
        kind: "shop_order", id: o.id, client_id: o.client_id,
        title: `Shop Order #${o.reference}`,
        subtitle: o.client_name,
        meta: `${(o.status || "").replace(/^\w/, (c) => c.toUpperCase())} · ${(o.fulfillment_status || "").replace(/_/g, " ")}`,
        icon: "fa-box",
      })),
    });
  }
  if (results.prepaid_purchases?.length) {
    groups.push({
      key: "prepaid_purchases", label: "Prepaid Visits",
      items: results.prepaid_purchases.map((lot) => ({
        kind: "prepaid_purchase", id: lot.id, client_id: lot.client_id,
        title: lot.pack_name || "Prepaid pack",
        subtitle: lot.client_name || "Unknown client",
        meta: `${lot.qty_remaining ?? "—"} / ${lot.qty_total ?? "—"} remaining`,
        icon: "fa-ticket",
      })),
    });
  }
  return groups;
}

function actionsFor(item) {
  const actions = [];
  if (item.kind === "dog") {
    actions.push({ label: "Open Dog", primary: true, act: "open_dog" });
    actions.push({ label: "Book", act: "book_dog" });
  } else if (item.kind === "client") {
    actions.push({ label: "Open Client", primary: true, act: "open_client" });
  } else if (item.kind === "booking") {
    actions.push({ label: "Open Booking", primary: true, act: "open_booking" });
    actions.push({ label: "Open Client", act: "open_client_of" });
  } else if (item.kind === "invoice") {
    actions.push({ label: "Open Bill", primary: true, act: "open_invoice" });
    actions.push({ label: "Take Payment", act: "take_payment" });
  } else if (item.kind === "payment") {
    actions.push({ label: "Open Client", primary: true, act: "open_client_of" });
  } else if (item.kind === "shop_order") {
    actions.push({ label: "Open Order", primary: true, act: "open_shop_order" });
  } else if (item.kind === "prepaid_purchase") {
    actions.push({ label: "Open Client", primary: true, act: "open_client_of" });
  }
  return actions;
}

export default function GlobalSearch({ open, onClose, onNavigate, onAction, userId, can = () => false }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState({});
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [recents, setRecents] = useState([]);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQ(""); setResults({}); setActive(0); setErr("");
      setRecents(visibleRecents(userId, can));
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!q.trim()) { setResults({}); setLoading(false); setErr(""); return; }
    setLoading(true);
    setErr("");
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/search", { params: { q } });
        setResults(data);
        setActive(0);
      } catch {
        setErr("Search failed. Try again.");
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const groups = buildGroups(results);
  const flat = groups.flatMap((g) => g.items);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const runPrimary = (item) => {
    onClose();
    onNavigate(item);
  };

  const handleKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); runPrimary(flat[active]); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-3 sm:p-4 sm:pt-24" onClick={onClose} data-testid="global-search">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl shadow-2xl animate-slide-in flex flex-col max-h-[85vh] sm:max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3 border-b border-bgHover shrink-0">
          <i className="fas fa-search text-gray-500 mr-3" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={handleKey}
                 placeholder="Search clients, dogs, bookings, bills, payments, shop orders…"
                 data-testid="search-input"
                 className="flex-1 bg-transparent text-white text-sm outline-none min-w-0" />
          <button onClick={onClose} className="ml-2 sm:hidden text-gray-500" aria-label="Close search"><i className="fas fa-times text-lg" /></button>
          <kbd className="hidden sm:inline text-[11px] font-black uppercase tracking-widest text-gray-500 bg-bgBase border border-bgHover rounded px-2 py-1">ESC</kbd>
        </div>
        <div ref={listRef} className="overflow-y-auto flex-1 min-h-0" data-testid="search-results">
          {!q && recents.length === 0 && (
            <p className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black tracking-widest">
              Start typing to search clients, dogs, bookings, bills, payments, and shop orders.
            </p>
          )}
          {!q && recents.length > 0 && (
            <div data-testid="recently-opened">
              <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted/70">Recently Opened</p>
                <button onClick={() => { clearRecents(userId); setRecents([]); }} data-testid="clear-recent-items"
                        className="text-[11px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-300">
                  Clear
                </button>
              </div>
              {recents.map((r) => (
                <button key={`${r.kind}-${r.id}`} onClick={() => { onClose(); onNavigate({ kind: r.kind, id: r.id, client_id: r.clientId, title: r.title, subtitle: r.subtitle }); }}
                        data-testid={`recent-${r.kind}-${r.id}`}
                        className="w-full text-left px-4 py-3 flex items-center gap-3 min-h-[56px] hover:bg-bgBase">
                  <i className={`fas ${RECENT_ICON[r.kind] || "fa-clock-rotate-left"} text-shTextMuted w-5 shrink-0`} />
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white uppercase truncate">{r.title}</p>
                    {r.subtitle && <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest truncate">{r.subtitle}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {q && loading && (
            <p className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black tracking-widest">
              <i className="fas fa-spinner fa-spin mr-2" />Searching…
            </p>
          )}
          {q && !loading && err && (
            <p className="px-6 py-10 text-center text-xs text-red-400 uppercase font-black tracking-widest">{err}</p>
          )}
          {q && !loading && !err && flat.length === 0 && (
            <p className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black tracking-widest">No matches for "{q}"</p>
          )}
          {groups.map((g) => {
            const startIdx = groups.slice(0, groups.indexOf(g)).reduce((n, gg) => n + gg.items.length, 0);
            return (
              <div key={g.key}>
                <p className="px-4 pt-3 pb-1 text-[11px] font-black uppercase tracking-widest text-shTextMuted/70">{g.label} · {g.items.length}</p>
                {g.items.map((item, i) => {
                  const idx = startIdx + i;
                  const acts = actionsFor(item);
                  return (
                    <div key={`${item.kind}-${item.id}`} data-idx={idx}
                         className={`px-4 py-3 flex items-center gap-3 min-h-[56px] ${active === idx ? "bg-bgBase" : ""}`}
                         onMouseEnter={() => setActive(idx)}>
                      <button onClick={() => runPrimary(item)} className="flex items-center gap-3 flex-1 min-w-0 text-left" data-testid={`search-result-${item.kind}-${item.id}`}>
                        <i className={`fas ${item.icon} text-shGreen w-5 shrink-0`} />
                        <div className="min-w-0">
                          <p className="text-sm font-black text-white uppercase truncate">{item.title}</p>
                          <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest truncate">{item.subtitle}</p>
                          {item.meta && <p className="text-[12px] text-gray-400 truncate">{item.meta}</p>}
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {acts.map((a) => (
                          <button key={a.act}
                                  onClick={() => { onClose(); onAction(a.act, item); }}
                                  data-testid={`search-action-${a.act}-${item.id}`}
                                  className={`min-h-[36px] px-2.5 py-1.5 rounded text-[11px] font-black uppercase tracking-widest whitespace-nowrap ${a.primary ? "bg-shGreen text-black" : "bg-bgBase border border-bgHover text-gray-300"}`}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="hidden sm:flex px-4 py-2 border-t border-bgHover items-center justify-between text-[11px] font-black uppercase tracking-widest text-gray-500 shrink-0">
          <span><kbd className="bg-bgBase border border-bgHover rounded px-1.5 py-0.5">↑</kbd> <kbd className="bg-bgBase border border-bgHover rounded px-1.5 py-0.5">↓</kbd> Navigate</span>
          <span><kbd className="bg-bgBase border border-bgHover rounded px-1.5 py-0.5">↵</kbd> Open</span>
        </div>
      </div>
    </div>
  );
}
