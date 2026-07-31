import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import IntakeFormsSection from "./IntakeFormsSection";
import CommunicationLog from "./CommunicationLog";
import TrophyWall from "./TrophyWall";
import AdminClientPaymentPlans from "./AdminClientPaymentPlans";
import { BOOKING_STATUS, INVOICE_STATUS } from "../lib/statusDefs";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtCredits = (n) => {
  const val = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
};

const TABS = [
  { id: "overview", label: "Overview", icon: "fa-user" },
  { id: "dogs", label: "Dogs", icon: "fa-paw" },
  { id: "bookings", label: "Bookings", icon: "fa-calendar-check" },
  { id: "money", label: "Money", icon: "fa-dollar-sign", perm: "finance_reports" },
  { id: "prepaid", label: "Prepaid Visits", icon: "fa-ticket", perm: "finance_reports" },
  { id: "messages", label: "Messages", icon: "fa-comments", perm: "messages" },
  { id: "documents", label: "Documents", icon: "fa-folder-open" },
  { id: "history", label: "History", icon: "fa-clock-rotate-left" },
];

/* Client Record Hub — a tabbed reorganization of the SAME data and
 * workflows already used on the Clients screen's expanded card. No new
 * booking/payment/credit/message/document logic anywhere in this file:
 * every tab either reads an existing authoritative endpoint directly, or
 * embeds an existing component (AdminClientPaymentPlans, CommunicationLog,
 * IntakeFormsSection, TrophyWall) verbatim. Quick actions call back into
 * Clients.jsx's own existing modal-opening functions (onSellPack,
 * onTakePayment, etc.) — the exact same ones the client card's action menu
 * already uses — so nothing here duplicates a workflow. */
export default function ClientHub({
  client, onClose, onJumpToDog, can = () => false,
  initialTab = "overview", focusRecordId = null,
  onBook, onSellPack, onSellProgram, onTakePayment, onOpenFiles, onOpenPackLots, onEditClient, onAddDog, onOpenSpecialPricing,
}) {
  const [tab, setTab] = useState(TABS.some(t => t.id === initialTab) ? initialTab : "overview");
  const visibleTabs = useMemo(() => TABS.filter(t => !t.perm || can(t.perm)), [can]);

  const [bookings, setBookings] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [lots, setLots] = useState(null);
  const [receipts, setReceipts] = useState(null);
  const [trophies, setTrophies] = useState(null);

  useEffect(() => {
    if (tab === "bookings" && bookings === null) {
      api.get("/bookings", { params: { client_id: client.id, include_all: true } })
        .then(({ data }) => setBookings(data || []))
        .catch(() => setBookings([]));
    }
    if (tab === "money" && invoices === null && can("finance_reports")) {
      api.get(`/clients/${client.id}/invoices`).then(({ data }) => setInvoices(data || [])).catch(() => setInvoices([]));
    }
    if (tab === "prepaid" && lots === null && can("finance_reports")) {
      api.get(`/clients/${client.id}/credit-lots`).then(({ data }) => setLots(data || [])).catch(() => setLots([]));
    }
    if (tab === "documents" && receipts === null) {
      api.get(`/clients/${client.id}/receipts`).then(({ data }) => setReceipts(data || [])).catch(() => setReceipts([]));
    }
    if (tab === "history" && trophies === null) {
      api.get(`/clients/${client.id}/trophies`).then(({ data }) => setTrophies(data || [])).catch(() => setTrophies([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, client.id]);

  const nextBooking = useMemo(() => {
    const list = bookings || [];
    const today = new Date().toISOString().slice(0, 10);
    return list.filter(b => b.date >= today && ["approved", "pending"].includes(b.status))
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  }, [bookings]);

  const missingRequirements = useMemo(() => {
    const gaps = [];
    for (const d of client.dogs || []) {
      const v = d.vaccines || {};
      if (!v.rabies) gaps.push(`${d.name}: rabies missing`);
    }
    return gaps;
  }, [client.dogs]);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose} data-testid="client-hub">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-bgHover shrink-0">
          <div className="min-w-0">
            <h3 className="text-white font-black text-lg uppercase italic truncate">{client.name}</h3>
            <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest truncate">{client.email || client.phone || "No contact on file"}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white shrink-0 ml-3" aria-label="Close"><i className="fas fa-times text-xl" /></button>
        </div>

        <div className="flex overflow-x-auto border-b border-bgHover shrink-0 px-2" data-testid="client-hub-tabs">
          {visibleTabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`client-hub-tab-${t.id}`}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-3 min-h-[44px] text-[12px] font-black uppercase tracking-widest border-b-2 transition ${tab === t.id ? "border-shGreen text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
              <i className={`fas ${t.icon}`} />{t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-5" data-testid="client-hub-content">
          {tab === "overview" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button onClick={onBook} data-testid="hub-action-book" className="min-h-[44px] px-3 py-2 rounded bg-shGreen text-black text-[12px] font-black uppercase tracking-widest">New Booking</button>
                {can("take_payments") && <button onClick={onTakePayment} data-testid="hub-action-take-payment" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Take Payment</button>}
                {can("sell_credits") && <button onClick={onSellPack} data-testid="hub-action-sell-pack" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Sell Prepaid Visits</button>}
                <button onClick={onAddDog} data-testid="hub-action-add-dog" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Add Dog</button>
                <button onClick={() => setTab("messages")} data-testid="hub-action-message" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Send Message</button>
                <button onClick={onEditClient} data-testid="hub-action-edit" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Edit Client</button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Daycare</p>
                  <p className="text-xl font-black text-shGreen">{fmtCredits(client.credits || 0)}</p>
                </div>
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Training</p>
                  <p className="text-xl font-black text-purple-400">{fmtCredits(client.training_credits || 0)}</p>
                </div>
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Boarding</p>
                  <p className="text-xl font-black text-shAccent">{fmtCredits(client.boarding_credits || 0)}</p>
                </div>
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Amount Due</p>
                  <p className={`text-xl font-black ${Number(client.account_balance) > 0 ? "text-shAccent" : "text-shGreen"}`}>
                    {money(Math.abs(Number(client.account_balance || 0)))}
                  </p>
                </div>
              </div>

              <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest mb-1">Next Booking</p>
                <p className="text-white text-sm font-bold">
                  {nextBooking ? `${nextBooking.dog_name} — ${nextBooking.service_type} · ${nextBooking.date}` : (bookings === null ? "Loading…" : "None scheduled")}
                </p>
              </div>

              {missingRequirements.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-red-400 tracking-widest mb-1">Booking Blockers</p>
                  {missingRequirements.map((g, i) => <p key={i} className="text-red-300 text-sm">{g}</p>)}
                </div>
              )}

              <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 flex items-center justify-between">
                <div>
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Portal</p>
                  <p className="text-sm text-white font-bold">{client.portal_email ? "Active" : "Not set up"}</p>
                </div>
                {client.portal_email && client.last_login_at && (
                  <p className="text-[12px] text-gray-500">Last login {new Date(client.last_login_at).toLocaleDateString()}</p>
                )}
              </div>
            </div>
          )}

          {tab === "dogs" && (
            <div className="space-y-2">
              {(client.dogs || []).length === 0 && <p className="text-gray-500 italic text-sm">No dogs on file.</p>}
              {(client.dogs || []).map((d) => (
                <button key={d.id} onClick={() => onJumpToDog(d.id)} data-testid={`hub-dog-${d.id}`}
                        className="w-full text-left bg-bgBase/40 border border-bgHover rounded-lg p-3 flex items-center justify-between hover:border-shGreen/40 transition">
                  <div>
                    <p className="text-white font-black uppercase">{d.name}</p>
                    <p className="text-[12px] text-gray-500 uppercase tracking-widest">{d.breed || "Unknown breed"}</p>
                  </div>
                  <i className="fas fa-arrow-right text-gray-600" />
                </button>
              ))}
            </div>
          )}

          {tab === "bookings" && (
            <div className="space-y-2">
              {bookings === null && <p className="text-gray-500 text-sm">Loading…</p>}
              {bookings?.length === 0 && <p className="text-gray-500 italic text-sm">No bookings in the last/next 90 days.</p>}
              {(bookings || []).map((b) => {
                const meta = BOOKING_STATUS[b.status] || { label: b.status, cls: "text-gray-400 bg-gray-500/10" };
                return (
                  <div key={b.id} data-testid={`hub-booking-${b.id}`}
                       className={`bg-bgBase/40 border rounded-lg p-3 flex items-center justify-between ${focusRecordId === b.id ? "border-shGreen" : "border-bgHover"}`}>
                    <div>
                      <p className="text-white font-bold">{b.dog_name} — {b.service_type}</p>
                      <p className="text-[12px] text-gray-500">{b.date}{b.end_date && b.end_date !== b.date ? ` – ${b.end_date}` : ""}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${meta.cls}`}>{meta.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "money" && can("finance_reports") && (
            <div className="space-y-4">
              {can("pricing") && (
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Special Pricing</p>
                    <p className="text-[12px] text-gray-400 mt-0.5">Client-specific and grandfathered prices for services, credit packs, and products.</p>
                  </div>
                  <button onClick={onOpenSpecialPricing} data-testid="hub-open-special-pricing"
                          className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest shrink-0">
                    <i className="fas fa-tag mr-1" />Manage
                  </button>
                </div>
              )}
              <AdminClientPaymentPlans clientId={client.id} />
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest mb-2">Bills</p>
                {invoices === null && <p className="text-gray-500 text-sm">Loading…</p>}
                {invoices?.length === 0 && <p className="text-gray-500 italic text-sm">No bills on file.</p>}
                <div className="space-y-2">
                  {(invoices || []).map((inv) => {
                    const meta = INVOICE_STATUS[inv.status] || { label: inv.status, cls: "text-gray-400 bg-gray-500/10" };
                    return (
                      <div key={inv.id} data-testid={`hub-invoice-${inv.id}`}
                           className={`bg-bgBase/40 border rounded-lg p-3 flex items-center justify-between ${focusRecordId === inv.id ? "border-shGreen" : "border-bgHover"}`}>
                        <div>
                          <p className="text-white font-bold">Bill #{inv.id.slice(0, 8).toUpperCase()}</p>
                          <p className="text-[12px] text-gray-500">{inv.date}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-black">{money(inv.total)}</p>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${meta.cls}`}>{meta.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {tab === "prepaid" && can("finance_reports") && (
            <div className="space-y-3">
              <button onClick={onOpenPackLots} data-testid="hub-open-pack-lots"
                      className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">
                View full pack/lot detail
              </button>
              {lots === null && <p className="text-gray-500 text-sm">Loading…</p>}
              {lots?.length === 0 && <p className="text-gray-500 italic text-sm">No prepaid packs purchased.</p>}
              {(lots || []).map((lot) => (
                <div key={lot.id} className="bg-bgBase/40 border border-bgHover rounded-lg p-3 flex items-center justify-between">
                  <p className="text-white font-bold">{lot.pack_name || lot.program_name}</p>
                  <p className="text-[12px] text-gray-400">{lot.qty_remaining} / {lot.qty_total} remaining</p>
                </div>
              ))}
            </div>
          )}

          {tab === "messages" && can("messages") && <CommunicationLog clientId={client.id} />}

          {tab === "documents" && (
            <div className="space-y-3">
              <button onClick={onOpenFiles} data-testid="hub-open-files"
                      className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">
                Open files & waivers
              </button>
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest mb-2">Receipts</p>
                {receipts === null && <p className="text-gray-500 text-sm">Loading…</p>}
                {receipts?.length === 0 && <p className="text-gray-500 italic text-sm">No receipts yet.</p>}
                {(receipts || []).slice(0, 20).map((r) => (
                  <div key={r.id} className="bg-bgBase/40 border border-bgHover rounded-lg p-2.5 flex items-center justify-between">
                    <p className="text-[13px] text-gray-300">{r.date || r.created_at}</p>
                    <p className="text-[13px] text-white font-bold">{money(r.total)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-4">
              <IntakeFormsSection clientId={client.id} />
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest mb-2">Trophies</p>
                {trophies === null ? <p className="text-gray-500 text-sm">Loading…</p> : <TrophyWall awards={trophies} testIdPrefix="hub-trophies" />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
