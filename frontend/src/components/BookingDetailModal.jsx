import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useEditLock } from "../lib/useLiveRefresh";
import CareLogStrip from "./CareLogStrip";

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
// outside this modal. Less ways to break a booking from this surface.

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

function Pill({ icon, label, value, tone = "default" }) {
  const tones = {
    default: "bg-bgBase/60 border-bgHover text-gray-300",
    green: "bg-shGreen/10 border-shGreen/40 text-shGreen",
    blue: "bg-shBlue/10 border-shBlue/40 text-shBlue",
    orange: "bg-shOrange/10 border-shOrange/40 text-shOrange",
    red: "bg-red-500/10 border-red-500/40 text-red-300",
    amber: "bg-amber-500/10 border-amber-500/40 text-amber-300",
    purple: "bg-purple-500/10 border-purple-500/40 text-purple-300",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${tones[tone] || tones.default}`}>
      <div className="text-[10px] uppercase tracking-widest font-black opacity-70">
        {icon && <i className={`fas ${icon} mr-1`}/>}{label}
      </div>
      <div className="text-sm font-black mt-0.5 break-words">{value || "—"}</div>
    </div>
  );
}

export default function BookingDetailModal({ booking: initial, onClose, onJumpToDog }) {
  useEditLock(true);
  const [booking, setBooking] = useState(initial);
  const [dog, setDog] = useState(null);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [b, d, c] = await Promise.all([
          api.get(`/bookings/${initial.id}`).catch(() => ({ data: initial })),
          initial.dog_id ? api.get(`/dogs/${initial.dog_id}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
          initial.client_id ? api.get(`/clients/${initial.client_id}`).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        ]);
        if (cancelled) return;
        setBooking(b.data || initial);
        setDog(d.data);
        setClient(c.data);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.detail || "Could not load booking details");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initial.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const onPremises = booking.checked_in_at && !booking.checked_out_at;
  const done = !!booking.checked_out_at;
  const statusTone = done ? "default" : onPremises ? "green" : "orange";
  const statusLabel = done ? "Checked out" : onPremises ? "On premises" : booking.approved ? "Scheduled" : "Awaiting approval";

  // Compute totals
  const addOns = booking.add_ons || [];
  const addOnTotal = addOns.reduce((s, a) => s + (Number(a.price || 0) * (a.qty || 1)), 0);
  const reportCard = booking.report_card || null;

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
      <div className="bg-bgCard border border-bgHover rounded-2xl shadow-2xl w-full max-w-3xl my-8" onClick={(e)=>e.stopPropagation()}>
        {/* Header */}
        <div className={`px-6 py-5 rounded-t-2xl border-b border-bgHover ${
          done ? "bg-gradient-to-r from-gray-700/30 to-gray-900/30"
               : onPremises ? "bg-gradient-to-r from-shGreen/20 to-shGreen/5"
                            : "bg-gradient-to-r from-shOrange/20 to-shOrange/5"
        }`}>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              {dog?.photo ? (
                <img src={dog.photo} alt={booking.dog_name}
                     className="w-20 h-20 rounded-full object-cover border-4 border-bgPanel shadow-lg"/>
              ) : (
                <div className="w-20 h-20 rounded-full bg-bgPanel border-4 border-bgHover grid place-items-center shadow-lg">
                  <i className="fas fa-dog text-3xl text-gray-500"/>
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.3em] font-black opacity-70 mb-1">
                <i className={`fas fa-${done ? "circle-check" : onPremises ? "house-circle-check" : "calendar"} mr-1`}/>
                {statusLabel}
              </div>
              <h2 className="text-3xl font-black tracking-tight text-white">{booking.dog_name || "Dog"}</h2>
              <p className="text-[14px] text-gray-300 mt-0.5">
                {dog?.breed || ""}
                {(dog?.age_y > 0 || dog?.age_m > 0) ? ` · ${dog.age_y || 0}y ${dog.age_m || 0}m` : ""}
                {dog?.sex ? ` · ${dog.sex}` : ""}
              </p>
              <p className="text-[13px] text-gray-400 mt-1 uppercase tracking-widest font-black">
                {booking.client_name || client?.name || "Client"}
              </p>
            </div>
            <button onClick={onClose} data-testid="booking-detail-close"
                    className="text-gray-400 hover:text-white text-xl">
              <i className="fas fa-times"/>
            </button>
          </div>
          <div className="flex gap-2 mt-4 flex-wrap">
            {booking.dog_id && (
              <button onClick={()=>{ onClose?.(); onJumpToDog?.(booking.dog_id); }}
                      data-testid="booking-detail-jump-dog"
                      className="text-[12px] font-black uppercase tracking-widest bg-shBlue/15 border border-shBlue/40 text-shBlue px-3 py-1.5 rounded hover:bg-shBlue/25">
                <i className="fas fa-paw mr-1"/>Dog profile
              </button>
            )}
            {booking.client_id && client?.phone && (
              <a href={`tel:${client.phone}`}
                 className="text-[12px] font-black uppercase tracking-widest bg-shGreen/15 border border-shGreen/40 text-shGreen px-3 py-1.5 rounded hover:bg-shGreen/25">
                <i className="fas fa-phone mr-1"/>{client.phone}
              </a>
            )}
            {client?.email && (
              <a href={`mailto:${client.email}`}
                 className="text-[12px] font-black uppercase tracking-widest bg-bgBase/60 border border-bgHover text-gray-300 px-3 py-1.5 rounded hover:bg-bgPanel/60">
                <i className="fas fa-envelope mr-1"/>{client.email}
              </a>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 p-3 rounded text-sm">{err}</div>}
          {loading && <div className="text-center text-gray-500 text-sm py-2">Loading details…</div>}

          {/* Service summary */}
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-gray-500 mb-2">Service</h3>
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

          {/* Status timeline */}
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-gray-500 mb-2">Timeline</h3>
            <ol className="relative border-l-2 border-bgHover ml-3 space-y-3" data-testid="booking-detail-timeline">
              <TimelineItem dot="bg-shBlue" label="Booked" time={booking.created_at && fmtDateTime(booking.created_at)} sub={booking.created_by_name && `by ${booking.created_by_name}`}/>
              {booking.approved_at && <TimelineItem dot="bg-shGreen" label="Approved" time={fmtDateTime(booking.approved_at)} sub={booking.approved_by_name && `by ${booking.approved_by_name}`}/>}
              {booking.checked_in_at && (
                <TimelineItem dot="bg-shGreen" label="Checked in" time={fmtDateTime(booking.checked_in_at)} sub={
                  <>
                    {booking.checked_in_by_name && <span>by {booking.checked_in_by_name}</span>}
                    {booking.checked_in_lat && <span> · <i className="fas fa-location-dot text-shGreen mr-1"/>{booking.checked_in_lat.toFixed(4)}, {booking.checked_in_lng.toFixed(4)}</span>}
                  </>
                }/>
              )}
              {booking.checked_out_at && (
                <TimelineItem dot="bg-gray-400" label="Checked out" time={fmtDateTime(booking.checked_out_at)} sub={
                  <>
                    {booking.checked_out_by_name && <span>by {booking.checked_out_by_name}</span>}
                    {booking.checked_out_lat && <span> · <i className="fas fa-location-dot text-shGreen mr-1"/>{booking.checked_out_lat.toFixed(4)}, {booking.checked_out_lng.toFixed(4)}</span>}
                  </>
                }/>
              )}
              {booking.cancelled_at && <TimelineItem dot="bg-red-500" label="Cancelled" time={fmtDateTime(booking.cancelled_at)} sub={booking.cancel_reason}/>}
            </ol>
          </section>

          {/* Care needs */}
          {(careNotes.length > 0 || dog?.notes || dog?.tags?.length > 0) && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-gray-500 mb-2">Care needs</h3>
              <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 text-[13px] space-y-2">
                {dog?.feeding_schedule?.length > 0 && (
                  <div>
                    <span className="text-shGreen font-black"><i className="fas fa-bowl-food mr-1"/>Feeding</span>
                    <ul className="ml-5 list-disc text-gray-300 mt-1">
                      {dog.feeding_schedule.map((f,i) => <li key={i}>{typeof f === "string" ? f : `${f.time || ""} — ${f.amount || ""} ${f.notes ? `(${f.notes})` : ""}`}</li>)}
                    </ul>
                  </div>
                )}
                {dog?.medications?.length > 0 && (
                  <div>
                    <span className="text-purple-400 font-black"><i className="fas fa-pills mr-1"/>Medications</span>
                    <ul className="ml-5 list-disc text-gray-300 mt-1">
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
                  <div><span className="text-amber-300 font-black"><i className="fas fa-circle-info mr-1"/>Notes:</span> <span className="text-gray-300 whitespace-pre-wrap">{dog.notes}</span></div>
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
              <ul className="bg-bgBase/40 border border-amber-500/30 rounded-lg divide-y divide-bgHover/40" data-testid="booking-detail-addons">
                {addOns.map((ao,i) => (
                  <li key={i} className="px-3 py-2 flex items-center justify-between text-[13px]">
                    <span className="text-white"><i className={`fas ${ao.icon || "fa-plus"} text-amber-400 mr-1.5`}/>{ao.name} × {ao.qty || 1}</span>
                    <span className="text-shGreen font-black">{fmtMoney(Number(ao.price || 0) * (ao.qty || 1))}</span>
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
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-gray-500 mb-2">Notes from booking</h3>
              <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3 text-[13px] text-gray-200 whitespace-pre-wrap">{booking.notes}</div>
            </section>
          )}

          {/* Pricing */}
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-gray-500 mb-2">Pricing</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Pill icon="fa-dollar-sign" label="Service total" value={fmtMoney(booking.actual_price ?? booking.base_price ?? 0)} tone="green"/>
              {booking.payment_method && <Pill icon="fa-credit-card" label="Payment" value={<span className="capitalize">{booking.payment_method}</span>}/>}
              {booking.payment_status && <Pill icon="fa-circle-check" label="Status" value={<span className="capitalize">{booking.payment_status}</span>}
                                              tone={booking.payment_status === "paid" ? "green" : "orange"}/>}
              {(booking.credits_deducted || 0) > 0 && (
                <Pill icon="fa-coins" label="Credits used" value={`${booking.credits_deducted} cr · ${fmtMoney(booking.credit_value_deducted || 0)}`} tone="purple"/>
              )}
              {booking.tip_amount > 0 && <Pill icon="fa-hand-holding-dollar" label="Tip" value={fmtMoney(booking.tip_amount)} tone="green"/>}
            </div>
          </section>

          {/* Report card */}
          {reportCard && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shOrange mb-2 flex items-center gap-2 flex-wrap">
                <span><i className="fas fa-clipboard-list mr-1"/>Report card</span>
                <ReportCardEmailStatus booking={booking} onResent={onClose}/>
              </h3>
              <div className="bg-shOrange/5 border border-shOrange/30 rounded-lg p-3 space-y-2">
                {reportCard.mood && (
                  <div className="text-[13px] text-gray-200">
                    <span className="text-shOrange font-black uppercase tracking-widest mr-2">Mood:</span>
                    {reportCard.mood}
                  </div>
                )}
                {reportCard.notes && (
                  <div className="text-[13px] text-gray-200 whitespace-pre-wrap">{reportCard.notes}</div>
                )}
                {Array.isArray(reportCard.photos) && reportCard.photos.length > 0 && (
                  <div className="flex gap-2 flex-wrap" data-testid="booking-detail-report-photos">
                    {reportCard.photos.map((p,i) => (
                      <img key={i} src={p} alt={`photo ${i+1}`} className="w-16 h-16 rounded object-cover border border-bgHover"/>
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
              <h3 className="text-[11px] uppercase tracking-[0.3em] font-black text-shGreen mb-2">
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
        <span className="font-black text-white uppercase tracking-widest text-[12px]">{label}</span>
        <span className="text-gray-400 ml-2">· {time || "—"}</span>
      </div>
      {sub && <div className="text-[12px] text-gray-500 mt-0.5">{sub}</div>}
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
function ReportCardEmailStatus({ booking, onResent: _onResent }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const sentAt = booking.report_card_email_sent_at;
  const attemptedAt = booking.report_card_email_attempted_at;
  const error = booking.report_card_email_error;

  const resend = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await api.post(`/bookings/${booking.id}/resend-report-card`);
      const body = r.data || {};
      if (body.sent) setMsg(`✓ Sent to ${body.sent_to}`);
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
        <span className="bg-shGreen/15 border border-shGreen/40 text-shGreen px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">
          <i className="fas fa-paper-plane mr-1"/>Emailed {_fmtAgo(sentAt)}
        </span>
        <button onClick={resend} disabled={busy} data-testid="report-card-resend-btn"
                className="text-gray-500 hover:text-shBlue text-[10px] font-black uppercase tracking-widest underline-offset-2 hover:underline disabled:opacity-50">
          {busy ? "Sending…" : "Re-send"}
        </button>
        {msg && <span className="text-[10px] text-gray-400">{msg}</span>}
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
                className="text-shBlue hover:text-white text-[10px] font-black uppercase tracking-widest underline-offset-2 hover:underline disabled:opacity-50">
          {busy ? "Retrying…" : "Retry"}
        </button>
        {msg && <span className="text-[10px] text-gray-400">{msg}</span>}
      </span>
    );
  }
  return (
    <button onClick={resend} disabled={busy} data-testid="report-card-resend-btn"
            className="text-shBlue hover:text-white text-[10px] font-black uppercase tracking-widest hover:underline underline-offset-2 disabled:opacity-50">
      <i className="fas fa-paper-plane mr-1"/>{busy ? "Sending…" : "Send to client"}
    </button>
  );
}
