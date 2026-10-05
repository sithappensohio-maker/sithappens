import { useEffect, useMemo, useRef, useState } from "react";
import { todayISO } from "../lib/date";
import { api } from "../lib/api";
import IntakeFormsSection from "./IntakeFormsSection";
import CommunicationLog from "./CommunicationLog";
import TrophyWall from "./TrophyWall";
import AdminClientPaymentPlans from "./AdminClientPaymentPlans";
import { BOOKING_STATUS, INVOICE_STATUS } from "../lib/statusDefs";
import Avatar from "./Avatar";
import ClientMarketingOptOut from "./ClientMarketingOptOut";
import BillFixModal from "./BillFixModal";
import { friendsPaidFor } from "../lib/friendsFamily";

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
  const [visits, setVisits] = useState(null); // lifetime visits + award tier, from the award engine's own count
  const [fixBill, setFixBill] = useState(null); // bill id open in the Fix dialog (audit #7)
  // Friends & family (owner request 2026-09-28): the friends' dogs this family
  // pays for, and any booking waiting for its one bill.
  const [ff, setFF] = useState(null);
  const [billAsk, setBillAsk] = useState(null);   // group id whose "close the bill now" is being confirmed
  const [billMsg, setBillMsg] = useState("");
  const [billBusy, setBillBusy] = useState(false);
  const billBusyRef = useRef(false);   // (a second tap lands before the screen redraws)

  useEffect(() => {
    if ((tab === "bookings" || tab === "overview") && bookings === null) {
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
    if ((tab === "bookings" || tab === "overview") && ff === null) {
      api.get(`/clients/${client.id}/friends-family`).then(({ data }) => setFF(data || false)).catch(() => setFF(false));
    }
    if (tab === "overview" && visits === null) {
      api.get(`/clients/${client.id}/visits`).then(({ data }) => setVisits(data || false)).catch(() => setVisits(false));
    }
    if (tab === "history" && trophies === null) {
      api.get(`/clients/${client.id}/trophies`).then(({ data }) => setTrophies(data || [])).catch(() => setTrophies([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, client.id]);

  const nextBooking = useMemo(() => {
    const list = bookings || [];
    const today = todayISO();
    return list.filter(b => b.date >= today && ["approved", "pending"].includes(b.status))
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  }, [bookings]);

  const payingFor = useMemo(() => friendsPaidFor(ff, client.id), [ff, client.id]);
  const closeBill = async (groupId) => {
    if (billBusyRef.current) return;
    billBusyRef.current = true;
    setBillBusy(true);
    setBillMsg("");
    try {
      const { data } = await api.post(`/bookings/group/${groupId}/close-bill`);
      setBillMsg(`Bill made: ${money(data.total)} — take the payment on it from the Money tab or Front Desk.`);
      setInvoices(null);
    } catch (e) {
      setBillMsg(e?.response?.data?.detail || "Could not make the bill");
    }
    setBillAsk(null);
    billBusyRef.current = false;
    setBillBusy(false);
    api.get(`/clients/${client.id}/friends-family`).then(({ data }) => setFF(data || false)).catch(() => {});
  };

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
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="relative flex items-center justify-between gap-4 px-4 sm:px-5 py-4 border-b border-shBorder shrink-0 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-30" style={{background:"radial-gradient(circle at 5% 30%, rgba(0,169,224,.22), transparent 38%), radial-gradient(circle at 80% 0%, rgba(140,198,63,.14), transparent 35%)"}}/>
          <div className="relative flex items-center gap-3 min-w-0">
            <Avatar src={client.photo} icon="fa-user" size="lg" ring="border-shSecondary/30" alt={client.name} />
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shSecondary">Sit Happens · Client Record</p>
              <h3 className="sh-display text-xl sm:text-2xl text-white leading-none truncate mt-1">{client.name}</h3>
              <p className="text-[11px] text-shTextMuted font-medium truncate mt-1">{client.email || client.phone || "No contact on file"}</p>
              <ClientMarketingOptOut client={client} canClear={can("manage_communications")} />
            </div>
          </div>
          <button onClick={onClose} className="relative w-10 h-10 rounded-xl border border-shBorder text-shTextMuted hover:text-white hover:border-shPrimary/40 shrink-0 grid place-items-center" aria-label="Close"><i className="fas fa-times" /></button>
        </div>

        <div className="flex overflow-x-auto border-b border-shBorder shrink-0 px-2 bg-black/10" data-testid="client-hub-tabs">
          {visibleTabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`client-hub-tab-${t.id}`}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-3 min-h-[44px] text-[12px] font-black uppercase tracking-widest border-b-2 transition ${tab === t.id ? "border-shPrimary text-shPrimary" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
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

              {ff?.waiting_for_bill && (
                <div className="bg-shAccent/10 border border-shAccent/40 rounded-lg p-3" data-testid="hub-ff-waiting">
                  <p className="text-[11px] uppercase font-black text-shAccent tracking-widest mb-1">Waiting for one bill</p>
                  <p className="text-sm text-shText">
                    Dogs {client.name} pays for have gone home; their one bill is made when the last dog leaves.
                    Payments on the account wait until then — take the payment on the bill.
                  </p>
                </div>
              )}
              {payingFor.length > 0 && (
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 space-y-2" data-testid="hub-ff-paying-for">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Paying for (friends &amp; family)</p>
                  {payingFor.map((g) => (
                    <div key={g.group_id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`hub-ff-group-${g.group_id}`}>
                      <p className="text-sm text-white">
                        {g.friends.length > 0
                          ? g.friends.map((d) => `${d.dog_name} (${d.client_name})`).join(", ")
                          : "Their own dogs"}
                        <span className="text-[12px] text-gray-500"> · {(g.dogs[0] || {}).date}</span>
                        {g.waiting && <span className="ml-2 text-[11px] font-black uppercase tracking-widest text-shAccent">waiting for the bill</span>}
                      </p>
                      {g.waiting && can("take_payments") && (
                        <button onClick={() => (billAsk === g.group_id ? closeBill(g.group_id) : setBillAsk(g.group_id))}
                                disabled={billBusy} data-testid={`hub-ff-close-bill-${g.group_id}`}
                                className="min-h-[36px] px-3 rounded border border-shAccent/40 text-shAccent text-[11px] font-black uppercase tracking-widest">
                          {billAsk === g.group_id ? "Yes, make the bill now" : "Close the bill now"}
                        </button>
                      )}
                    </div>
                  ))}
                  {billAsk && (
                    <p className="text-[12px] text-shAccent" data-testid="hub-ff-close-warning">
                      Dogs still here or still to come won&apos;t be on this bill — each gets its own when it leaves.
                    </p>
                  )}
                  {billMsg && <p className="text-[13px] text-white" data-testid="hub-ff-bill-msg">{billMsg}</p>}
                </div>
              )}

              <VisitsCard visits={visits} />

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
                      {b.bill_to_client_id && (
                        <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary" data-testid={`hub-booking-paid-by-${b.id}`}>
                          {b.bill_to_client_id === client.id ? "Friends & family · paying" : `Paid by ${b.bill_to_client_name}`}
                        </p>
                      )}
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
                          {Number(inv.balance || 0) > 0.005 && <p className="text-[12px] text-shAccent font-bold">Owed {money(inv.balance)}</p>}
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${meta.cls}`}>{meta.label}</span>
                          {inv.needs_attention && (
                            <button onClick={() => setFixBill(inv.id)} data-testid={`hub-invoice-fix-${inv.id}`}
                                    className="block ml-auto mt-1 px-2 py-0.5 rounded bg-red-500/15 border border-red-500/40 text-red-300 text-[10px] font-black uppercase tracking-widest">
                              <i className="fas fa-wrench mr-1" />{inv.online_payment_stuck ? "Online payment stuck" : "Needs fixing"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {fixBill && (
            <BillFixModal invoiceId={fixBill} onClose={() => setFixBill(null)}
                          onChanged={() => api.get(`/clients/${client.id}/invoices`).then(({ data }) => setInvoices(data || [])).catch(() => {})} />
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

/* Lifetime visits, counted exactly the way the visit awards are (checked-out
 * or completed bookings, live + archived, every dog). Shows the tier the
 * client holds and how far the next one is, so "why doesn't she have
 * Regular yet?" answers itself. */
function fmtVisitDate(iso) {
  if (!iso) return "";
  try { return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch { return iso; }
}

export function VisitsCard({ visits }) {
  if (visits === null) return <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 text-[12px] text-gray-500" data-testid="hub-visits-loading">Counting visits…</div>;
  if (!visits) return null;
  const next = visits.next;
  const held = visits.held;
  const pct = next ? Math.min(100, Math.round((visits.visits / next.threshold) * 100)) : 100;
  return (
    <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 sm:p-4" data-testid="hub-visits">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Visits</p>
          <p className="text-3xl font-black text-white leading-none mt-1" data-testid="hub-visits-count">{visits.visits}</p>
          {visits.last_visit && <p className="text-[12px] text-gray-500 mt-1" data-testid="hub-visits-last">Last visit {fmtVisitDate(visits.last_visit)}</p>}
        </div>
        <div className="text-right min-w-0">
          {held ? (
            <p className="text-[12px] font-black uppercase tracking-widest text-shGreen" data-testid="hub-visits-held"><i className="fas fa-trophy mr-1.5" />{held.name}</p>
          ) : (
            <p className="text-[12px] font-black uppercase tracking-widest text-gray-500" data-testid="hub-visits-held">No visit award yet</p>
          )}
          {next
            ? <p className="text-[12px] text-gray-300 mt-0.5" data-testid="hub-visits-next">{next.remaining} more to <span className="font-black text-white">{next.name}</span> ({next.threshold})</p>
            : held && <p className="text-[12px] text-gray-400 mt-0.5" data-testid="hub-visits-next">Top tier reached</p>}
        </div>
      </div>
      {next && (
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mt-3" aria-hidden="true">
          <div className="h-full rounded-full bg-gradient-to-r from-shBlue to-shGreen" style={{ width: `${pct}%` }} />
        </div>
      )}
      {(visits.per_dog || []).length > 1 && (
        <div className="flex flex-wrap gap-1.5 mt-3" data-testid="hub-visits-dogs">
          {visits.per_dog.map((d) => (
            <span key={d.dog_id} className="px-2 py-1 rounded-full bg-bgPanel border border-bgHover text-[11px] font-black uppercase tracking-wide text-gray-300">
              <i className="fas fa-paw text-shGreen mr-1" />{d.dog_name} · {d.visits}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
