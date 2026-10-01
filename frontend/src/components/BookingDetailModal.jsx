import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useEditLock } from "../lib/useLiveRefresh";
import { useAuth } from "../lib/auth";
import {
  friendsFamilyOn, isFriendsDog, activeRows, byRank, bookedServicePrice, waitingForBill,
} from "../lib/friendsFamily";
import CareLogStrip from "./CareLogStrip";
import GroupDogAdd from "./GroupDogAdd";
import { CancelBookingModal } from "./CheckoutModal";

// Sprint 110aq — One-stop overview of a single booking, opened by clicking
// any row on the Today's Check-in Board (and reusable from other screens).
//
// Pulls everything in one composite fetch:
//   • booking row itself (status, kennel, times, notes, add-ons, price)
//   • dog (photo, age, breed, vaccines, care icons, medications)
//   • client (name, phone, email, balances, primary contact)
//   • check-in / check-out audit (timestamps, who, geo)
//   • report card (notes, photos, mood)
//   • credit deduction (if any) + price-override pill
//
// Designed to be **read-only** — every actionable thing (check in, check
// out, cancel, edit, report card) is launched from the dashboard buttons
// outside this modal. Less ways to break a booking from this surface. The one
// exception is the booking's dogs (friends & family, owner request
// 2026-09-28): add a dog, take one out, close the group's one bill — each a
// single server call, after which the modal reloads and tells `onChanged`.

function fmtTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  catch { return iso; }
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}
function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function Pill({ icon, label, value, tone = "default", ...rest }) {
  const tones = {
    default: "bg-[var(--sh-card-base)]/60 border-shBorder text-shTextMuted",
    green: "bg-shPrimary/10 border-shPrimary/40 text-shPrimary",
    blue: "bg-shSecondary/10 border-shSecondary/40 text-shSecondary",
    orange: "bg-shAccent/10 border-shAccent/40 text-shAccent",
    red: "bg-red-500/10 border-red-500/40 text-red-300",
    amber: "bg-amber-500/10 border-amber-500/40 text-amber-300",
    purple: "bg-purple-500/10 border-purple-500/40 text-purple-300",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${tones[tone] || tones.default}`} {...rest}>
      <div className="text-[10px] uppercase tracking-widest font-black opacity-70">
        {icon && <i className={`fas ${icon} mr-1`}/>}{label}
      </div>
      <div className="text-sm font-black mt-0.5 break-words">{value || "—"}</div>
    </div>
  );
}

export default function BookingDetailModal({ booking: initial, onClose, onJumpToDog, onChanged }) {
  useEditLock(true);
  const auth = useAuth();
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [billBusy, setBillBusy] = useState(false);
  const billBusyRef = useRef(false);   // (a second tap lands before the screen redraws)
  const [billConfirm, setBillConfirm] = useState(false);
  const [billMsg, setBillMsg] = useState("");
  const [booking, setBooking] = useState(initial);
  const [dog, setDog] = useState(null);
  const [client, setClient] = useState(null);
  // Sprint 110di-47 — Service catalog (id → service). Used to compute a
  // price ESTIMATE for unpaid bookings so the modal stops showing $0 as
  // the "Service total" before checkout.
  const [services, setServices] = useState([]);
  // Sprint 110di-50 — When the booking belongs to a multi-dog group, fetch
  // the sibling bookings so the modal can show ONE combined estimate with
  // the multi-dog discount applied (mirrors what the customer sees on the
  // portal estimate). Backed by GET /api/bookings/group/{group_id}.
  const [groupMembers, setGroupMembers] = useState([]);
  // Multi-dog discount config from /settings/public — same source of truth
  // as the portal estimate + the checkout flow.
  const [mdCfg, setMdCfg] = useState({ enabled: false, by_service: {}, label: "Multi-dog discount" });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // The booking first: the calendar opens this modal with only an id,
        // so the dog and family come from the booking itself.
        const b = await api.get(`/bookings/${initial.id}`).catch(() => ({ data: initial }));
        const bk = b.data || initial;
        const [d, c, s, settRes] = await Promise.all([
          bk.dog_id ? api.get(`/dogs/${bk.dog_id}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
          bk.client_id ? api.get(`/clients/${bk.client_id}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
          api.get(`/services`).catch(() => ({ data: [] })),
          api.get(`/settings/public`).catch(() => ({ data: {} })),
        ]);
        if (cancelled) return;
        setBooking(b.data || initial);
        setDog(d.data);
        setClient(c.data);
        setServices(Array.isArray(s.data) ? s.data : []);
        setMdCfg({
          enabled: !!settRes.data?.multi_dog_discount_enabled,
          mode: settRes.data?.multi_dog_discount_mode || "percent",
          value: Number(settRes.data?.multi_dog_discount_value || 0),
          label: settRes.data?.multi_dog_discount_label || "Multi-dog discount",
          by_service: settRes.data?.multi_dog_discount_by_service || {},
        });
        // If grouped, fan out to fetch siblings for the combined estimate.
        const gid = bk.group_id;
        const gRes = gid ? await api.get(`/bookings/group/${gid}`).catch(() => ({ data: { bookings: [] } })) : { data: { bookings: [] } };
        if (!cancelled) setGroupMembers(gRes.data?.bookings || []);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.detail || "Could not load booking details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initial.id, reloadKey]);  // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { setReloadKey((k) => k + 1); onChanged?.(); };

  const onPremises = booking.checked_in_at && !booking.checked_out_at;
  const done = !!booking.checked_out_at;
  const statusTone = done ? "default" : onPremises ? "green" : "orange";
  const statusLabel = done ? "Checked out" : onPremises ? "On premises" : booking.approved ? "Scheduled" : "Awaiting approval";

  // Compute totals
  const addOns = booking.add_ons || [];
  const addOnTotal = addOns.reduce((s, a) => s + (Number(a.price || 0) * (a.qty || 1)), 0);
  const reportCard = booking.report_card || null;

  // Sprint 110di-47 — Inline price estimate. Picks the catalog row that
  // matches this booking's service_type (+ grooming_type if applicable),
  // multiplies by nights for boarding, then adds the snapshotted add-on
  // total. We do NOT mutate booking.actual_price — the accounting flow is
  // untouched. This estimate is purely for display so the operator sees a
  // sensible number on the schedule modal before checkout completes.
  const baseForBooking = (b) => {
    if (!services.length) return 0;
    const t = b.service_type;
    const candidates = services.filter((sv) => sv.service_type === t && !sv.is_addon && sv.active !== false);
    const exact = b.grooming_type
      ? candidates.find((sv) => (sv.grooming_type || "") === b.grooming_type)
      : null;
    const svc = exact || candidates[0];
    const base = Number(svc?.base_price || 0);
    if (t === "boarding") {
      try {
        const d1 = new Date(b.date + "T00:00:00");
        const d2 = new Date((b.end_date || b.date) + "T00:00:00");
        const nights = Math.max(1, Math.round((d2 - d1) / 86400000));
        return base * nights;
      } catch { return base; }
    }
    return base;
  };
  const addOnTotalFor = (b) => (b.add_ons || []).reduce(
    (s, a) => s + (Number(a.price || 0) * (a.qty || 1)), 0
  );

  // Sprint 110di-50 — Group-aware estimate. When this booking belongs to a
  // multi-dog group, sum every sibling's base + add-ons and apply the
  // configured multi-dog discount to the extra dogs (mirrors the portal
  // estimate so the operator sees the same combined number the customer
  // saw at booking time).
  // The dogs still on the booking, in the order the server ranks them (the
  // first pays the first-dog price). Each dog's price is the one the server
  // stored when it was booked — the multi-dog discount as configured, at the
  // paying family's rates. Only very old rows without one fall back to the
  // catalog estimate.
  const members = byRank(activeRows(groupMembers));
  const isGrouped = members.length > 1;
  const estimateBase = baseForBooking(booking);
  const estimatedSingleTotal = estimateBase + addOnTotal;
  const storedPrices = isGrouped && members.every((m) => bookedServicePrice(m) !== null);
  const perDog = members.map((m, i) => {
    const gone = (m.checked_out_at || m.status === "completed") && Number.isFinite(Number(m.actual_price));
    if (storedPrices && gone) return { m, discount: 0, addons: 0, base: Number(m.actual_price) };
    const stored = storedPrices && m.multi_dog_discount?.pre_applied ? Number(m.multi_dog_discount.amount || 0) : 0;
    return {
      // No dog ahead of the first one still booked: it pays the first-dog price.
      m, discount: i === 0 ? 0 : stored, addons: addOnTotalFor(m),
      base: storedPrices ? bookedServicePrice(m) + stored : baseForBooking(m),
    };
  });

  let groupSubtotal = 0;
  let groupMdDiscount = 0;
  let groupTotal = 0;
  if (isGrouped) {
    groupSubtotal = perDog.reduce((s, p) => s + p.base + p.addons, 0);
    if (storedPrices) {
      groupMdDiscount = perDog.reduce((s, p) => s + p.discount, 0);
    } else if (booking.service_type === "daycare" || booking.service_type === "boarding") {
      // Legacy rows with no stored price: the old catalog estimate.
      groupMdDiscount = perDog.slice(1).reduce((s, p) => s + p.base, 0) * 0.5;
    }
    groupTotal = Math.max(0, groupSubtotal - groupMdDiscount);
  }
  const mdLabel = perDog.find((p) => p.discount > 0)?.m.multi_dog_discount?.label || "Additional dog discount";

  // Friends & family: who pays, and what staff may do with the booking's dogs.
  const payerName = booking.bill_to_client_name || "";
  const dogsHere = members.length ? members : [booking];
  const anyGone = dogsHere.some((m) => m.checked_out_at || m.status === "completed");
  const canAddDog = friendsFamilyOn(auth) && !!auth?.can?.("booking_edit") && !!auth?.can?.("clients_view")
    && ["daycare", "boarding"].includes(booking.service_type) && booking.status === "approved" && !anyGone;
  const canRemove = (m) => !!auth?.can?.("booking_edit") && dogsHere.length > 1 && !m.checked_out_at && m.status !== "completed";
  const billWaiting = waitingForBill(groupMembers) && !!auth?.can?.("take_payments");
  const dogState = (m) => (m.checked_out_at || m.status === "completed"
    ? (m.group_bill_pending || m.group_bill_claim ? "Gone home · waiting for the one bill" : "Gone home")
    : m.checked_in_at ? "Here" : "Booked");
  const closeBill = async () => {
    if (billBusyRef.current) return;
    billBusyRef.current = true;
    setBillBusy(true); setBillMsg("");
    try {
      const { data } = await api.post(`/bookings/group/${booking.group_id}/close-bill`);
      setBillMsg(`Bill made for ${data.client_name || payerName}: ${fmtMoney(data.total)}`);
    } catch (e) {
      setBillMsg(e?.response?.data?.detail || "Could not make the bill");
    }
    setBillConfirm(false);
    billBusyRef.current = false;
    setBillBusy(false);
    refresh();
  };

  // Use actual_price when checkout has locked it in; otherwise show our
  // estimate so the operator never sees a misleading $0.
  const hasActualPrice = done && Number.isFinite(Number(booking.actual_price));
  const displayTotal = hasActualPrice
    ? Number(booking.actual_price)
    : (isGrouped ? groupTotal : estimatedSingleTotal);

  const careNotes = [];
  if (dog?.feeding_schedule?.length) careNotes.push(`${dog.feeding_schedule.length} feeding(s)`);
  if (dog?.medications?.length) careNotes.push(`${dog.medications.length} med(s)`);
  if (dog?.notes) careNotes.push("notes");

  return (
    <div
      className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 grid place-items-start sm:place-items-center overflow-y-auto p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="booking-detail-modal"
    >
      <div className="bg-bgCard border border-shBorder rounded-2xl shadow-2xl w-full max-w-3xl my-8 sh-modal-surface" onClick={(e)=>e.stopPropagation()}>
        {/* Header */}
        <div className={`px-6 py-5 rounded-t-2xl border-b border-shBorder ${
          done ? "bg-gradient-to-r from-gray-700/30 to-gray-900/30"
               : onPremises ? "bg-gradient-to-r from-shPrimary/20 to-shPrimary/5"
                            : "bg-gradient-to-r from-shAccent/20 to-shAccent/5"
        }`}>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              {dog?.photo ? (
                <img src={dog.photo} alt={booking.dog_name}
                     className="w-20 h-20 rounded-full object-cover border-4 border-bgPanel shadow-lg"/>
              ) : (
                <div className="w-20 h-20 rounded-full bg-[var(--sh-card-base)] border-4 border-shBorder grid place-items-center shadow-lg">
                  <i className="fas fa-dog text-3xl text-shTextMuted"/>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.3em] font-black opacity-70 mb-1">
                <i className={`fas fa-${done ? "circle-check" : onPremises ? "house-circle-check" : "calendar"} mr-1`}/>
                {statusLabel}
              </div>
              <h2 className="text-3xl font-black tracking-tight text-shText">{booking.dog_name || "Dog"}</h2>
              <p className="text-[14px] text-shTextMuted mt-0.5">
                {dog?.breed || ""}
                {(dog?.age_y > 0 || dog?.age_m > 0) ? ` · ${dog.age_y || 0}y ${dog.age_m || 0}m` : ""}
                {dog?.sex ? ` · ${dog.sex}` : ""}
              </p>
              <p className="text-[13px] text-shTextMuted mt-1 uppercase tracking-widest font-black">
                {booking.client_name || client?.name || "Client"}
              </p>
              {booking.bill_to_client_id && (
                <p className="mt-1.5" data-testid="booking-detail-paid-by">
                  <span className="inline-block rounded-full border border-shSecondary/40 bg-shSecondary/10 px-2.5 py-0.5 text-[12px] font-black text-shSecondary">
                    {isFriendsDog(booking) ? `Paid by ${payerName}` : "Friends & family · paying for the group"}
                  </span>
                </p>
              )}
            </div>
            <button onClick={onClose} data-testid="booking-detail-close"
                    className="text-shTextMuted hover:text-shText text-xl">
              <i className="fas fa-times"/>
            </button>
          </div>
          <div className="flex gap-2 mt-4 flex-wrap">
            {booking.dog_id && (
              <button onClick={()=>{ onClose?.(); onJumpToDog?.(booking.dog_id); }}
                      data-testid="booking-detail-jump-dog"
                      className="text-[12px] font-black uppercase tracking-widest bg-shSecondary/15 border border-shSecondary/40 text-shSecondary px-3 py-1.5 rounded hover:bg-shSecondary/25">
                <i className="fas fa-paw mr-1"/>Dog profile
              </button>
            )}
            {booking.client_id && client?.phone && (
              <a href={`tel:${client.phone}`}
                 className="text-[12px] font-black uppercase tracking-widest bg-shPrimary/15 border border-shPrimary/40 text-shPrimary px-3 py-1.5 rounded hover:bg-shPrimary/25">
                <i className="fas fa-phone mr-1"/>{client.phone}
              </a>
            )}
            {client?.email && (
              <a href={`mailto:${client.email}`}
                 className="text-[12px] font-black uppercase tracking-widest bg-[var(--sh-card-base)]/60 border border-shBorder text-shTextMuted px-3 py-1.5 rounded hover:bg-[var(--sh-card-base)]/60">
                <i className="fas fa-envelope mr-1"/>{client.email}
              </a>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-3 rounded text-sm">{err}</div>}
          {loading && <div className="text-center text-shTextMuted text-sm py-2">Loading details…</div>}

          {/* Service summary */}
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shTextMuted mb-2">Service</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Pill icon="fa-tag" label="Service" value={
                <span className="capitalize">{booking.service_type}{booking.grooming_type ? ` · ${booking.grooming_type.replace("_"," ")}` : ""}</span>
              } tone={statusTone}/>
              <Pill icon="fa-calendar-day" label="Date" value={booking.date + (booking.end_date && booking.end_date !== booking.date ? ` → ${booking.end_date}` : "")}/>
              {booking.kennel && <Pill icon="fa-warehouse" label="Kennel" value={booking.kennel} tone="purple"/>}
              {booking.time && <Pill icon="fa-clock" label="Appt. time" value={fmtTime(`${booking.date}T${booking.time}`)}/>}
              {booking.dropoff_time && <Pill icon="fa-right-to-bracket" label="Drop-off" value={fmtTime(`${booking.date}T${booking.dropoff_time}`)}/>}
              {booking.pickup_time && <Pill icon="fa-right-from-bracket" label="Pickup" value={fmtTime(`${booking.date}T${booking.pickup_time}`)}/>}
            </div>
          </section>

          {/* The booking's dogs — each family, who pays, add / take out / close the bill */}
          {(isGrouped || canAddDog || booking.bill_to_client_id) && (
            <section data-testid="booking-detail-dogs">
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shTextMuted mb-2">Dogs on this booking</h3>
              <div className="space-y-1.5">
                {dogsHere.map((m) => (
                  <div key={m.id} data-testid={`booking-detail-dog-${m.id}`}
                       className="flex items-center justify-between gap-2 rounded-lg border border-shBorder px-3 py-2 text-[13px]">
                    <span className="min-w-0">
                      <i className="fas fa-dog text-shPrimary mr-1.5 opacity-70"/>
                      <strong className="text-shText">{m.dog_name}</strong>
                      <span className="text-shTextMuted"> · {m.client_name}</span>
                      {isFriendsDog(m) && <span className="ml-2 text-[11px] font-black uppercase tracking-widest text-shSecondary">Friend&apos;s dog</span>}
                      <span className="ml-2 text-shTextMuted">{dogState(m)}</span>
                    </span>
                    {canRemove(m) && (
                      <button type="button" onClick={() => setRemoving(m)} data-testid={`booking-detail-remove-${m.id}`}
                              className="shrink-0 text-[11px] font-black uppercase tracking-widest text-red-300 border border-red-500/40 rounded px-2 py-1">
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {payerName && (
                <p className="text-[12.5px] text-shTextMuted mt-2" data-testid="booking-detail-one-bill">
                  Paid by <strong className="text-shText">{payerName}</strong> · one bill for every dog when the last dog leaves.
                </p>
              )}
              {billWaiting && (
                <div className="mt-2">
                  {billConfirm && (
                    <p className="text-[12.5px] text-shAccent mb-1.5" data-testid="booking-detail-close-bill-warning">
                      Dogs still here or still to come won&apos;t be on this bill — each gets its own when it leaves.
                    </p>
                  )}
                  <button type="button" disabled={billBusy} data-testid="booking-detail-close-bill"
                          onClick={() => (billConfirm ? closeBill() : setBillConfirm(true))}
                          className="text-[12px] font-black uppercase tracking-widest text-shAccent border border-shAccent/40 rounded px-3 py-1.5 disabled:opacity-50">
                    <i className="fas fa-file-invoice-dollar mr-1"/>{billConfirm ? "Yes, make the bill now" : "Close the bill now"}
                  </button>
                </div>
              )}
              {billMsg && <p className="text-[13px] text-shText mt-2" data-testid="booking-detail-bill-msg">{billMsg}</p>}
              {canAddDog && !addOpen && (
                <button type="button" onClick={() => setAddOpen(true)} data-testid="booking-detail-add-dog"
                        className="mt-2 text-[12px] font-black uppercase tracking-widest text-shSecondary border border-shSecondary/40 rounded px-3 py-1.5">
                  <i className="fas fa-plus mr-1"/>Add a dog
                </button>
              )}
              {addOpen && (
                <GroupDogAdd booking={booking} onDogs={dogsHere.map((m) => m.dog_id)} payerName={payerName || booking.client_name}
                             isAdmin={auth?.user?.role === "admin"} canNewFriend={!!auth?.can?.("clients_edit")}
                             canVaccines={!!auth?.can?.("dogs_edit")}
                             onAdded={() => { setAddOpen(false); refresh(); }} onCancel={() => setAddOpen(false)}/>
              )}
            </section>
          )}
          {removing && createPortal(
            <CancelBookingModal booking={removing} onClose={() => { setRemoving(null); refresh(); }}/>, document.body)}

          {/* Status timeline */}
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shTextMuted mb-2">Timeline</h3>
            <ol className="relative border-l-2 border-shBorder ml-3 space-y-3" data-testid="booking-detail-timeline">
              <TimelineItem dot="bg-shSecondary" label="Booked" time={booking.created_at && fmtDateTime(booking.created_at)} sub={booking.created_by_name && `by ${booking.created_by_name}`}/>
              {booking.approved_at && <TimelineItem dot="bg-shPrimary" label="Approved" time={fmtDateTime(booking.approved_at)} sub={booking.approved_by_name && `by ${booking.approved_by_name}`}/>}
              {booking.checked_in_at && (
                <TimelineItem dot="bg-shPrimary" label="Checked in" time={fmtDateTime(booking.checked_in_at)} sub={
                  <>
                    {booking.checked_in_by_name && <span>by {booking.checked_in_by_name}</span>}
                    {booking.checked_in_lat && <span> · <i className="fas fa-location-dot text-shPrimary mr-1"/>{booking.checked_in_lat.toFixed(4)}, {booking.checked_in_lng.toFixed(4)}</span>}
                  </>
                }/>
              )}
              {booking.checked_out_at && (
                <TimelineItem dot="bg-gray-400" label="Checked out" time={fmtDateTime(booking.checked_out_at)} sub={
                  <>
                    {booking.checked_out_by_name && <span>by {booking.checked_out_by_name}</span>}
                    {booking.checked_out_lat && <span> · <i className="fas fa-location-dot text-shPrimary mr-1"/>{booking.checked_out_lat.toFixed(4)}, {booking.checked_out_lng.toFixed(4)}</span>}
                  </>
                }/>
              )}
              {booking.cancelled_at && <TimelineItem dot="bg-red-500" label="Cancelled" time={fmtDateTime(booking.cancelled_at)} sub={booking.cancel_reason}/>}
            </ol>
          </section>

          {/* Care needs */}
          {(careNotes.length > 0 || dog?.notes || dog?.tags?.length > 0) && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shTextMuted mb-2">Care needs</h3>
              <div className="bg-[var(--sh-card-base)]/40 border border-shBorder rounded-lg p-3 text-[13px] space-y-2">
                {dog?.feeding_schedule?.length > 0 && (
                  <div>
                    <span className="text-shPrimary font-black"><i className="fas fa-bowl-food mr-1"/>Feeding</span>
                    <ul className="ml-5 list-disc text-shTextMuted mt-1">
                      {dog.feeding_schedule.map((f,i) => <li key={i}>{typeof f === "string" ? f : `${f.time || ""} — ${f.amount || ""} ${f.notes ? `(${f.notes})` : ""}`}</li>)}
                    </ul>
                  </div>
                )}
                {dog?.medications?.length > 0 && (
                  <div>
                    <span className="text-purple-400 font-black"><i className="fas fa-pills mr-1"/>Medications</span>
                    <ul className="ml-5 list-disc text-shTextMuted mt-1">
                      {dog.medications.map((m,i) => <li key={i}>{typeof m === "string" ? m : `${m.name || ""} — ${m.dose || ""} ${m.schedule || ""} ${m.notes ? `(${m.notes})` : ""}`}</li>)}
                    </ul>
                  </div>
                )}
                {dog?.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {dog.tags.map((t,i) => (
                      <span key={i} className="bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-widest">
                        <i className="fas fa-tag mr-1"/>{t}
                      </span>
                    ))}
                  </div>
                )}
                {dog?.notes && (
                  <div><span className="text-amber-300 font-black"><i className="fas fa-circle-info mr-1"/>Notes:</span> <span className="text-shTextMuted whitespace-pre-wrap">{dog.notes}</span></div>
                )}
              </div>
            </section>
          )}

          {/* Add-ons */}
          {addOns.length > 0 && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-amber-400 mb-2">
                <i className="fas fa-plus-circle mr-1"/>Add-ons
              </h3>
              <ul className="bg-[var(--sh-card-base)]/40 border border-amber-500/30 rounded-lg divide-y divide-shBorder/40" data-testid="booking-detail-addons">
                {addOns.map((ao,i) => (
                  <li key={i} className="px-3 py-2 flex items-center justify-between text-[13px]">
                    <span className="text-shText"><i className={`fas ${ao.icon || "fa-plus"} text-amber-400 mr-1.5`}/>{ao.name} × {ao.qty || 1}</span>
                    <span className="text-shPrimary font-black">{fmtMoney(Number(ao.price || 0) * (ao.qty || 1))}</span>
                  </li>
                ))}
                <li className="px-3 py-2 flex items-center justify-between bg-amber-500/5 text-[13px]">
                  <span className="text-amber-300 font-black uppercase tracking-widest">Add-on total</span>
                  <span className="text-amber-300 font-black">{fmtMoney(addOnTotal)}</span>
                </li>
              </ul>
            </section>
          )}

          {/* Notes */}
          {booking.notes && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shTextMuted mb-2">Notes from booking</h3>
              <div className="bg-[var(--sh-card-base)]/40 border border-shBorder rounded-lg p-3 text-[13px] text-gray-200 whitespace-pre-wrap">{booking.notes}</div>
            </section>
          )}

          {/* Online School Phase 4 — only rendered when this appointment was
              scheduled from a Trainer Assist case. Never shown otherwise,
              so an ordinary training booking looks exactly as before. */}
          {booking.trainer_assist_case_id && (
            <TrainerAssistContext caseId={booking.trainer_assist_case_id}/>
          )}

          {/* Pricing */}
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shTextMuted mb-2">
              Pricing{isGrouped && (
                <span className="ml-2 text-shPrimary normal-case tracking-normal">
                  · Group of {members.length} dogs
                </span>
              )}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {/* Sprint 110di-47 — Shows the snapshotted actual_price once
                  checkout has locked it in; otherwise an inline ESTIMATE
                  computed from the services catalog so the modal stops
                  showing $0 for scheduled-but-not-yet-paid bookings.
                  Accounting/checkout flow is untouched — this is display
                  only and is clearly labeled "(est.)" when synthetic.
                  Sprint 110di-50 — Group bookings show the COMBINED total
                  with the multi-dog discount applied so the operator sees
                  what the customer saw at portal-checkout time. */}
              <Pill icon="fa-dollar-sign"
                    label={hasActualPrice
                      ? (isGrouped ? "Group total" : "Service total")
                      : (isGrouped ? "Group total (est.)" : "Service total (est.)")}
                    value={fmtMoney(displayTotal)}
                    tone="green"
                    data-testid="booking-detail-service-total"/>
              {booking.payment_method && <Pill icon="fa-credit-card" label="Payment" value={<span className="capitalize">{booking.payment_method}</span>}/>}
              {booking.payment_status && <Pill icon="fa-circle-check" label="Status" value={booking.bill_to_client_id && booking.payment_status === "paid_partial"
                                                ? `On ${payerName}'s bill` : <span className="capitalize">{booking.payment_status}</span>}
                                              tone={booking.payment_status === "paid" || booking.payment_status === "comped" ? "green" : "orange"}/>}
              {Number(booking.checkout_discount?.amount || 0) > 0 && (
                <Pill icon="fa-tag" label="One-time discount"
                      value={<>−{fmtMoney(booking.checkout_discount.amount)}<span className="block text-[11px] font-normal mt-1 normal-case">{booking.checkout_discount.reason}</span></>}
                      tone="orange" data-testid="booking-detail-checkout-discount"/>
              )}
              {(booking.credits_deducted || 0) > 0 && (
                <Pill icon="fa-coins" label="Credits used" value={`${booking.credits_deducted} cr · ${fmtMoney(booking.credit_value_deducted || 0)}`} tone="purple"/>
              )}
              {booking.tip_amount > 0 && <Pill icon="fa-hand-holding-dollar" label="Tip" value={fmtMoney(booking.tip_amount)} tone="green"/>}
            </div>

            {/* Group breakdown — shows each dog's line + multi-dog discount */}
            {isGrouped && !hasActualPrice && (
              <div className="mt-3 bg-[var(--sh-card-base)]/40 border border-shBorder rounded-lg p-3 space-y-1.5 text-[13px]"
                   data-testid="booking-detail-group-breakdown">
                {perDog
                  .map(({ m, base: b, addons: ao }, idx) => {
                    return (
                      <div key={m.id} className="flex justify-between items-center"
                           data-testid={`booking-detail-group-member-${m.id}`}>
                        <span className="text-shTextMuted">
                          <i className="fas fa-dog text-shPrimary mr-1.5 opacity-70"/>
                          {m.dog_name || `Dog ${idx + 1}`}
                          {m.bill_to_client_id && <span className="text-shTextMuted"> ({m.client_name})</span>}
                          {idx === 0 && <span className="text-[10px] text-shTextMuted uppercase tracking-widest ml-2">(primary)</span>}
                          {ao > 0 && <span className="text-shTextMuted ml-1">· {fmtMoney(b)} base + {fmtMoney(ao)} add-ons</span>}
                        </span>
                        <span className="text-shText font-black">{fmtMoney(b + ao)}</span>
                      </div>
                    );
                  })}
                <div className="flex justify-between border-t border-shBorder pt-1.5"
                     data-testid="booking-detail-group-subtotal">
                  <span className="text-shTextMuted uppercase tracking-widest font-black text-[11px]">Standard price</span>
                  <span className="text-shText font-black">{fmtMoney(groupSubtotal)}</span>
                </div>
                {groupMdDiscount > 0 && (
                  <div className="flex justify-between"
                       data-testid="booking-detail-group-md-discount">
                    <span className="text-shPrimary">
                      <i className="fas fa-tag mr-1.5"/>{mdLabel}
                    </span>
                    <span className="text-shPrimary font-black">−{fmtMoney(groupMdDiscount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-shBorder pt-1.5">
                  <span className="text-shText font-black uppercase tracking-widest text-[12px]">Group total (est.)</span>
                  <span className="text-shPrimary font-black text-[15px]">{fmtMoney(groupTotal)}</span>
                </div>
              </div>
            )}
          </section>

          {/* Report card */}
          {reportCard && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shAccent mb-2 flex items-center gap-2 flex-wrap">
                <span><i className="fas fa-clipboard-list mr-1"/>Report card</span>
                <ReportCardEmailStatus booking={booking} onResent={onClose}/>
              </h3>
              <div className="bg-shAccent/5 border border-shAccent/30 rounded-lg p-3 space-y-2">
                {reportCard.mood && (
                  <div className="text-[13px] text-gray-200">
                    <span className="text-shAccent font-black uppercase tracking-widest mr-2">Mood:</span>
                    {reportCard.mood}
                  </div>
                )}
                {reportCard.notes && (
                  <div className="text-[13px] text-gray-200 whitespace-pre-wrap">{reportCard.notes}</div>
                )}
                {Array.isArray(reportCard.photos) && reportCard.photos.length > 0 && (
                  <div className="flex gap-2 flex-wrap" data-testid="booking-detail-report-photos">
                    {reportCard.photos.map((p,i) => (
                      <img key={i} src={p} alt={`photo ${i+1}`} className="w-16 h-16 rounded object-cover border border-shBorder"/>
                    ))}
                  </div>
                )}
                {/* Sprint 110co — Floor care logs inline. */}
                <CareLogStrip feedings={booking.feeding_log} medications={booking.medication_log} bathroom={booking.bathroom_log} />
              </div>
            </section>
          )}
          {/* Show care log standalone if no report card was filed yet. */}
          {!reportCard && ((booking.feeding_log?.length || 0) + (booking.medication_log?.length || 0) + ((booking.bathroom_log?.pee || 0) + (booking.bathroom_log?.poop || 0)) > 0) && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shPrimary mb-2">
                <i className="fas fa-clipboard-check mr-1"/>Care log
              </h3>
              <CareLogStrip feedings={booking.feeding_log} medications={booking.medication_log} bathroom={booking.bathroom_log} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineItem({ dot, label, time, sub }) {
  return (
    <li className="ml-4">
      <span className={`absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full ring-2 ring-bgCard ${dot}`}/>
      <div className="text-[13px]">
        <span className="font-black text-shText uppercase tracking-widest text-[12px]">{label}</span>
        <span className="text-shTextMuted ml-2">· {time || "—"}</span>
      </div>
      {sub && <div className="text-[12px] text-shTextMuted mt-0.5">{sub}</div>}
    </li>
  );
}



function _fmtAgo(iso) {
  if (!iso) return "";
  try {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  } catch { return ""; }
}

/** Sprint 110cp — Email-send status badge for the Report Card section.
 *  Renders one of:
 *   - "✓ Emailed Xm ago"      (success)
 *   - "⚠ Failed (reason)"     (attempted but Resend rejected — domain etc.)
 *   - "→ Send report card"    (no attempt yet)
 *  Plus a "Re-send" action that wipes the flags and re-fires. */
export function ReportCardEmailStatus({ booking, onResent: _onResent }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const sentAt = booking.report_card_email_sent_at;
  const attemptedAt = booking.report_card_email_attempted_at;
  const error = booking.report_card_email_error;
  const queuedAt = booking.report_card_email_queued_at;   // held for Quiet Hours

  const resend = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await api.post(`/bookings/${booking.id}/resend-report-card`);
      const body = r.data || {};
      if (body.sent) setMsg(`✓ Sent to ${body.sent_to}`);
      else if (body.queued) setMsg("Queued — goes out when quiet hours end");
      else setMsg(`⚠ ${body.error || "Failed"}`);
      // Give the modal a beat to render the new state, then refresh by closing.
      setTimeout(() => { window.location.reload(); }, 1400);
    } catch (e) {
      setMsg(`⚠ ${e?.response?.data?.detail || "Failed"}`);
    } finally { setBusy(false); }
  };

  if (sentAt) {
    return (
      <span className="inline-flex items-center gap-2" data-testid="report-card-email-status-sent">
        <span className="bg-shPrimary/15 border border-shPrimary/40 text-shPrimary px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">
          <i className="fas fa-paper-plane mr-1"/>Emailed {_fmtAgo(sentAt)}
        </span>
        <button onClick={resend} disabled={busy} data-testid="report-card-resend-btn"
                className="text-shTextMuted hover:text-shSecondary text-[10px] font-black uppercase tracking-widest underline-offset-2 hover:underline disabled:opacity-50">
          {busy ? "Sending…" : "Re-send"}
        </button>
        {msg && <span className="text-[10px] text-shTextMuted">{msg}</span>}
      </span>
    );
  }
  if (queuedAt && !error) {
    return (
      <span className="inline-flex items-center gap-2" data-testid="report-card-email-status-queued">
        <span className="bg-shAccent/15 border border-shAccent/40 text-shAccent px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest"
              title="It goes out automatically when quiet hours end">
          <i className="fas fa-moon mr-1"/>Waiting for quiet hours
        </span>
        <button onClick={resend} disabled={busy} data-testid="report-card-resend-btn"
                className="text-shTextMuted hover:text-shSecondary text-[10px] font-black uppercase tracking-widest underline-offset-2 hover:underline disabled:opacity-50">
          {busy ? "Sending…" : "Re-send"}
        </button>
        {msg && <span className="text-[10px] text-shTextMuted">{msg}</span>}
      </span>
    );
  }
  if (attemptedAt && error) {
    return (
      <span className="inline-flex items-center gap-2" data-testid="report-card-email-status-failed">
        <span className="bg-red-600/15 border border-red-500/40 text-red-300 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest" title={error}>
          <i className="fas fa-triangle-exclamation mr-1"/>Email failed
        </span>
        <button onClick={resend} disabled={busy} data-testid="report-card-resend-btn"
                className="text-shSecondary hover:text-shText text-[10px] font-black uppercase tracking-widest underline-offset-2 hover:underline disabled:opacity-50">
          {busy ? "Retrying…" : "Retry"}
        </button>
        {msg && <span className="text-[10px] text-shTextMuted">{msg}</span>}
      </span>
    );
  }
  return (
    <button onClick={resend} disabled={busy} data-testid="report-card-resend-btn"
            className="text-shSecondary hover:text-shText text-[10px] font-black uppercase tracking-widest hover:underline underline-offset-2 disabled:opacity-50">
      <i className="fas fa-paper-plane mr-1"/>{busy ? "Sending…" : "Send to client"}
    </button>
  );
}

// Online School Phase 4 — "the trainer should know exactly why this dog is
// in front of them." Reuses the exact same Trainer Assist detail endpoint
// the staff queue uses (GET /admin/school/trainer-assist/{id}) — no
// duplicate context-building, no duplicate video storage.
function TrainerAssistContext({ caseId }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/admin/school/trainer-assist/${caseId}`);
        if (!cancelled) setDetail(data);
      } catch { /* case may have been deleted alongside its enrollment — fail quiet */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [caseId]);

  if (loading) {
    return <p className="text-shTextMuted text-[12px]"><i className="fas fa-spinner fa-spin mr-1"/>Loading Online School context…</p>;
  }
  if (!detail) return null;
  const cp = detail.checkpoint || {};
  return (
    <section data-testid="booking-trainer-assist-context">
      <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-purple-300 mb-2">
        <i className="fas fa-handshake mr-1.5"/>Online School Trainer Assist
      </h3>
      <div className="bg-purple-500/10 border border-purple-400/40 rounded-lg p-3 space-y-2">
        <p className="text-[13px] text-shText">
          <span className="font-black">{detail.program_name}</span>
          {detail.module_name ? ` · ${detail.module_name}` : ""} · {cp.lesson_name}
        </p>
        {cp.trainer_feedback && (
          <p className="text-gray-200 text-[13px] italic border-l-2 border-purple-400/40 pl-3">"{cp.trainer_feedback}"</p>
        )}
        {cp.client_note && (
          <p className="text-shTextMuted text-[12px]"><span className="font-black text-shText">Client note:</span> "{cp.client_note}"</p>
        )}
        {(cp.rubric_snapshot?.handler_criteria?.length > 0 || cp.rubric_snapshot?.dog_criteria?.length > 0) && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            {cp.rubric_snapshot?.handler_criteria?.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1">Handler — {cp.handler_overall != null ? `${Number(cp.handler_overall).toFixed(1)}/5` : "—"}</p>
                {cp.rubric_snapshot.handler_criteria.map(c => (
                  <p key={c.id} className="text-[12px] text-shText flex justify-between"><span>{c.name}</span><span className="font-black">{cp.handler_scores?.[c.id] ?? "—"}/5</span></p>
                ))}
              </div>
            )}
            {cp.rubric_snapshot?.dog_criteria?.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1">Dog — {cp.dog_overall != null ? `${Number(cp.dog_overall).toFixed(1)}/5` : "—"}</p>
                {cp.rubric_snapshot.dog_criteria.map(c => (
                  <p key={c.id} className="text-[12px] text-shText flex justify-between"><span>{c.name}</span><span className="font-black">{cp.dog_scores?.[c.id] ?? "—"}/5</span></p>
                ))}
              </div>
            )}
          </div>
        )}
        {cp.video_media_id && cp.homework_id && (
          <TrainerAssistVideo homeworkId={cp.homework_id} mediaId={cp.video_media_id}/>
        )}
      </div>
    </section>
  );
}

function TrainerAssistVideo({ homeworkId, mediaId }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/homework/${homeworkId}/media/${mediaId}`);
        setSrc(data.data || "");
      } catch { /* ignore */ }
    })();
  }, [homeworkId, mediaId]);
  if (!src) return null;
  return <video src={src} controls playsInline className="max-h-56 rounded border border-shBorder w-full" data-testid="booking-trainer-assist-video"/>;
}
