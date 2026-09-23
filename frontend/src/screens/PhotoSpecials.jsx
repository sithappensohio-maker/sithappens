import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import { useConfirm } from "../lib/useConfirm";
import { PhotoOrdersPanel } from "../components/EventPhotosPanel";
import PhotoPackagesEditor, { fromPackageRows, toPackageRows } from "../components/PhotoPackagesEditor";

/**
 * Photo Specials admin — create a portrait event, then work it on the day.
 *
 * Deliberately not a calendar. Every reservation here is an ordinary
 * photography booking, so the schedule, Front Desk and the Register already
 * know about it; this screen only configures the special and gives the owner
 * the event-day list with the actions that matter at the desk.
 */
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAYS = DAY_KEYS.slice(0, 5);
const WEEKEND = DAY_KEYS.slice(5);

const BLANK = {
  name: "", headline: "", description: "", location_name: "Sit Happens", location_address: "",
  what_to_expect: [], packages_blurb: "", arrival_notes: "", cancellation_notes: "",
  start_date: null, end_date: null, day_hours: {}, closed_dates: [],
  dates: [], start_time: "09:00", end_time: "15:00", slot_minutes: 15,
  dogs_per_slot: 1, max_bookings: null, booking_open: true, published: false,
  photos_title: "", order_prefix: "", photo_packages: [],
};

const ORDER_STATUS_LABEL = { ordered: "Unpaid", paid: "Paid", ready: "Ready", sent: "Sent" };

/** Write one weekday's hours without disturbing the others. */
function setDay(editing, setEditing, day, row) {
  setEditing({ ...editing, day_hours: { ...(editing.day_hours || {}), [day]: row } });
}

/**
 * Hours for a group of days that normally share a window — the weekdays, or
 * the weekend. Editing here writes every day in the group, which is what makes
 * "Monday to Friday, 4pm to 7pm" one action instead of five. The per-day rows
 * underneath still exist for the day that does not follow the pattern; when
 * that happens this control says so rather than quietly showing one day's
 * hours as if they were all of them.
 */
function HoursGroup({ label, sub, days, testid, editing, setEditing, field, labelCls }) {
  const hours = editing.day_hours || {};
  const rows = days.map((d) => hours[d] || {});
  const first = rows[0] || {};
  const mixed = rows.some((r) => (r.open || "") !== (first.open || "") || (r.close || "") !== (first.close || "") || !!r.closed !== !!first.closed);
  const apply = (patch) => {
    const next = { ...hours };
    for (const d of days) next[d] = { ...(next[d] || {}), ...patch };
    setEditing({ ...editing, day_hours: next });
  };
  return (
    <div data-testid={`photo-special-hours-${testid}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label className={labelCls}>{label}</label>
        <span className="text-[11px] text-shTextMuted">{sub}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-1 text-[11px] text-shTextMuted shrink-0">
          <input type="checkbox" checked={!!first.closed} data-testid={`photo-special-${testid}-closed`}
                 onChange={(e) => apply({ closed: e.target.checked })}/>
          Closed
        </label>
        <div className="flex items-center gap-2 flex-1 basis-[190px] min-w-0">
          <input type="time" className={`${field} min-w-0 flex-1`} value={first.open || ""} disabled={!!first.closed}
                 data-testid={`photo-special-${testid}-open`}
                 onChange={(e) => apply({ open: e.target.value })}/>
          <span className="text-shTextMuted shrink-0">→</span>
          <input type="time" className={`${field} min-w-0 flex-1`} value={first.close || ""} disabled={!!first.closed}
                 data-testid={`photo-special-${testid}-close`}
                 onChange={(e) => apply({ close: e.target.value })}/>
        </div>
      </div>
      {mixed && (
        <p className="text-[11.5px] text-shAccent mt-1" data-testid={`photo-special-${testid}-mixed`}>
          These days currently differ — see per-day hours below. Editing here sets them all the same.
        </p>
      )}
    </div>
  );
}

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtRosterDay = (iso) => {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

const fmtTime = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${ampm}`;
};

export default function PhotoSpecials({ can }) {
  const confirm = useConfirm();
  const [specials, setSpecials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterDay, setRosterDay] = useState("");
  const [busy, setBusy] = useState(false);
  // Photo orders: which special's orders are open, and (optionally) a
  // reservation to start a prefilled order from.
  const [ordersFor, setOrdersFor] = useState(null);
  const [startOrder, setStartOrder] = useState(null);
  const clearStartOrder = useCallback(() => setStartOrder(null), []);
  // Other price lists to copy from when setting up the next special.
  const [eventLists, setEventLists] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/photo-specials");
      setSpecials(data.specials || []);
    } catch (e) {
      toast.error(formatErr(e) || "Could not load photo specials");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...editing, max_bookings: editing.max_bookings === "" ? null : editing.max_bookings,
        photo_packages: fromPackageRows(editing.photo_packages) };
      if (editing.id) await api.put(`/admin/photo-specials/${editing.id}`, body);
      else await api.post("/admin/photo-specials", body);
      toast.success(editing.id ? "Photo special updated" : "Photo special created");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(formatErr(e) || "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const openEditor = (sp) => {
    setEditing(sp ? { ...BLANK, ...sp, photo_packages: toPackageRows(sp.photo_packages) } : { ...BLANK });
    // Events' price lists are copy sources too (Trunk or Treat's booth menu).
    api.get("/admin/events").then(({ data }) => setEventLists(data.events || [])).catch(() => setEventLists([]));
  };

  const copySources = [
    ...specials.filter((s) => s.id !== editing?.id).map((s) => ({ id: `ps:${s.id}`, label: s.name, packages: s.photo_packages || [] })),
    ...eventLists.map((ev) => ({ id: `ev:${ev.id}`, label: ev.name, packages: ev.photo_packages || [] })),
  ];

  // The order form fills itself from the reservation: who, how to reach
  // them, which dog — and the order is tied to that booking.
  const orderFromReservation = (sp, r) => {
    setRoster(null);
    setOrdersFor(sp);
    setStartOrder({ booking_id: r.booking_id, client_id: r.client_id || null, primary_contact: r.client_name || "",
      email: r.client_email || "", phone: r.client_phone || "", dogs: r.dog_name || "" });
  };

  const searchReservations = useCallback(async (q) => {
    if (!ordersFor) return [];
    const { data } = await api.get(`/admin/photo-specials/${ordersFor.id}/reservations`);
    const term = q.toLowerCase();
    return (data.reservations || [])
      .filter((r) => r.status !== "cancelled" && `${r.client_name} ${r.dog_name} ${r.client_email} ${r.client_phone}`.toLowerCase().includes(term))
      .map((r) => ({
        id: r.booking_id, title: r.client_name || r.dog_name, tag: `${fmtRosterDay(r.date)} ${fmtTime(r.time)}`, sub: r.dog_name,
        fill: { booking_id: r.booking_id, client_id: r.client_id || null, primary_contact: r.client_name || "",
          email: r.client_email || "", phone: r.client_phone || "", dogs: r.dog_name || "" },
      }));
  }, [ordersFor]);

  const openRoster = async (sp, day = "") => {
    try {
      const { data } = await api.get(`/admin/photo-specials/${sp.id}/reservations`, { params: day ? { date: day } : {} });
      setRoster(data);
      // A special built from day-of-week rules has no explicit `dates`; the
      // list endpoint hands back the generated ones. Open on today when the
      // special is running, so the desk is not scrolled back to week one.
      const running = data.special?.dates || sp.running_dates || sp.dates || [];
      const today = todayISO();
      setRosterDay(day || (running.includes(today) ? today : running[0]) || "");
    } catch (e) {
      toast.error(formatErr(e) || "Could not load reservations");
    }
  };

  const markNoShow = async (sp, booking) => {
    if (!(await confirm({ title: "Mark no-show?", body: `${booking.dog_name} did not arrive. This frees the ${fmtTime(booking.time)} slot. Nothing is charged.`, confirmText: "Mark no-show" }))) return;
    try {
      await api.post(`/admin/photo-specials/${sp.id}/reservations/${booking.booking_id}/no-show`);
      toast.success("Marked as a no-show");
      openRoster(sp, rosterDay);
    } catch (e) {
      toast.error(formatErr(e) || "Could not mark no-show");
    }
  };

  const remove = async (sp) => {
    if (!(await confirm({ title: `Delete ${sp.name}?`, body: "This cannot be undone.", confirmText: "Delete", tone: "danger" }))) return;
    try {
      await api.delete(`/admin/photo-specials/${sp.id}`);
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(formatErr(e) || "Could not delete");
    }
  };

  const uploadHero = async (sp, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api.post(`/admin/photo-specials/${sp.id}/hero-image`, { data: reader.result, filename: file.name });
        toast.success("Hero image updated");
        load();
      } catch (e) {
        toast.error(formatErr(e) || "Upload failed");
      }
    };
    reader.readAsDataURL(file);
  };

  const field = "w-full min-h-[40px] bg-black/20 border border-shBorder/60 rounded-lg px-3 text-shText text-[14px] focus:outline-none focus:border-shSecondary/50";
  const label = "block text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1";

  return (
    <div className="space-y-4" data-testid="photo-specials-screen">
      <PageHero
        eyebrow={{ icon: "fa-camera-retro", text: `${specials.length} photo special${specials.length === 1 ? "" : "s"}`, color: "text-shSecondary" }}
        title="Photo Specials. Portrait events."
        sub="Halloween, Christmas, Valentine's — one-off portrait sessions the public can book themselves."
        right={
          <button onClick={() => openEditor(null)} data-testid="photo-special-new"
                  className="min-h-[44px] px-4 rounded-lg bg-shPrimary text-bgHeader font-black text-[12px] uppercase tracking-widest">
            <i className="fas fa-plus mr-1.5"/>New special
          </button>
        }/>

      {loading ? (
        <p className="text-shTextMuted text-sm py-6 text-center">Loading…</p>
      ) : specials.length === 0 ? (
        <div className="rounded-xl border border-dashed border-shBorder py-10 text-center" data-testid="photo-specials-empty">
          <p className="text-shTextMuted">No photo specials yet.</p>
          <p className="text-[13px] text-shTextMuted mt-1">Create one for Howl-O-Ween and the public page builds itself.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {specials.map((sp) => (
            <div key={sp.id} className="sh-front-desk-panel p-4" data-testid={`photo-special-card-${sp.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-black text-shText truncate">{sp.name}</p>
                  <p className="text-[12px] text-shTextMuted">
                    {sp.start_date && sp.end_date && !(sp.dates || []).length
                      ? `${sp.start_date} → ${sp.end_date}`
                      : `${(sp.dates || []).length} date${(sp.dates || []).length === 1 ? "" : "s"}`} · {sp.slot_minutes} min · {sp.booked_count} booked
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${sp.published ? "border-shPrimary/40 bg-shPrimary/15 text-shPrimary" : "border-shBorder text-shTextMuted"}`}>
                    {sp.published ? "Published" : "Draft"}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${sp.booking_open ? "border-shSecondary/40 bg-shSecondary/15 text-shSecondary" : "border-shAccent/40 text-shAccent"}`}>
                    {sp.booking_open ? "Booking open" : "Booking closed"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                <button onClick={() => openRoster(sp)} data-testid={`photo-special-roster-${sp.id}`}
                        className="min-h-[36px] px-3 rounded-lg border border-shBorder text-[11px] font-black uppercase tracking-widest text-shText hover:border-shSecondary/50">
                  <i className="fas fa-list mr-1"/>Reservations
                </button>
                <button onClick={() => { setOrdersFor(sp); setStartOrder(null); }} data-testid={`photo-special-orders-${sp.id}`}
                        className="min-h-[36px] px-3 rounded-lg border border-shBorder text-[11px] font-black uppercase tracking-widest text-shPrimary hover:border-shPrimary/50">
                  <i className="fas fa-camera-retro mr-1"/>Photo orders
                </button>
                <button onClick={() => openEditor(sp)} data-testid={`photo-special-edit-${sp.id}`}
                        className="min-h-[36px] px-3 rounded-lg border border-shBorder text-[11px] font-black uppercase tracking-widest text-shText hover:border-shSecondary/50">
                  <i className="fas fa-pen mr-1"/>Edit
                </button>
                <label className="min-h-[36px] px-3 rounded-lg border border-shBorder text-[11px] font-black uppercase tracking-widest text-shText hover:border-shSecondary/50 inline-flex items-center cursor-pointer">
                  <i className="fas fa-image mr-1"/>Hero
                  <input type="file" accept="image/*" className="hidden" data-testid={`photo-special-hero-${sp.id}`}
                         onChange={(e) => uploadHero(sp, e.target.files?.[0])}/>
                </label>
                {sp.published && (
                  <a href={`/photo-specials/${sp.slug}`} target="_blank" rel="noreferrer"
                     className="min-h-[36px] px-3 rounded-lg border border-shBorder text-[11px] font-black uppercase tracking-widest text-shPrimary hover:border-shPrimary/50 inline-flex items-center">
                    <i className="fas fa-arrow-up-right-from-square mr-1"/>View page
                  </a>
                )}
                <button onClick={() => remove(sp)}
                        className="min-h-[36px] px-3 rounded-lg border border-shBorder text-[11px] font-black uppercase tracking-widest text-red-400 hover:border-red-500/50">
                  <i className="fas fa-trash"/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center p-4 z-[120] overflow-y-auto"
             onClick={() => setEditing(null)} data-testid="photo-special-editor">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-5 w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-lg font-black text-shText uppercase italic mb-3">{editing.id ? "Edit photo special" : "New photo special"}</h4>
            <div className="space-y-3">
              <div>
                <label className={label}>Name *</label>
                <input className={field} value={editing.name} data-testid="photo-special-name"
                       placeholder="Howl-O-Ween Professional Dog Portraits"
                       onChange={(e) => setEditing({ ...editing, name: e.target.value })}/>
              </div>
              <div>
                <label className={label}>Headline</label>
                <input className={field} value={editing.headline} data-testid="photo-special-headline"
                       placeholder="Professional portraits, not phone snaps"
                       onChange={(e) => setEditing({ ...editing, headline: e.target.value })}/>
              </div>
              <div>
                <label className={label}>Description</label>
                <textarea rows={3} className={`${field} py-2`} value={editing.description} data-testid="photo-special-description"
                          onChange={(e) => setEditing({ ...editing, description: e.target.value })}/>
              </div>
              {/* Schedule. A promotion runs over a range with different hours on
                  different days; nobody should type forty-six dates. The two
                  group controls are the normal case, and the per-day rows
                  underneath are there for the exceptions. */}
              <div className="rounded-xl border border-shBorder/60 p-3 space-y-3" data-testid="photo-special-schedule">
                <p className="text-[11px] font-black uppercase tracking-widest text-shPrimary">Date range</p>
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3">
                  <div>
                    <label className={label}>Start date</label>
                    <input type="date" className={`${field} min-w-0`} value={editing.start_date || ""} data-testid="photo-special-start-date"
                           onChange={(e) => setEditing({ ...editing, start_date: e.target.value || null })}/>
                  </div>
                  <div>
                    <label className={label}>End date</label>
                    <input type="date" className={`${field} min-w-0`} value={editing.end_date || ""} data-testid="photo-special-end-date"
                           onChange={(e) => setEditing({ ...editing, end_date: e.target.value || null })}/>
                  </div>
                </div>

                <HoursGroup label="Weekday hours" sub="Monday – Friday" days={WEEKDAYS} testid="weekday"
                            editing={editing} setEditing={setEditing} field={field} labelCls={label}/>
                <HoursGroup label="Weekend hours" sub="Saturday – Sunday" days={WEEKEND} testid="weekend"
                            editing={editing} setEditing={setEditing} field={field} labelCls={label}/>

                <details data-testid="photo-special-per-day">
                  <summary className="cursor-pointer text-[11px] font-black uppercase tracking-widest text-shTextMuted">
                    Per-day hours (for exceptions)
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    {DAY_KEYS.map((d) => {
                      const row = (editing.day_hours || {})[d] || {};
                      return (
                        <div key={d} className="flex flex-wrap items-center gap-2">
                          <span className="w-[86px] text-[12px] font-black uppercase tracking-widest text-shTextMuted">{d.slice(0, 3)}</span>
                          <label className="inline-flex items-center gap-1 text-[11px] text-shTextMuted">
                            <input type="checkbox" checked={!!row.closed} data-testid={`photo-special-closed-${d}`}
                                   onChange={(e) => setDay(editing, setEditing, d, { ...row, closed: e.target.checked })}/>
                            Closed
                          </label>
                          <input type="time" className={`${field} flex-1 basis-[92px] min-w-0`} value={row.open || ""} disabled={!!row.closed}
                                 data-testid={`photo-special-open-${d}`}
                                 onChange={(e) => setDay(editing, setEditing, d, { ...row, open: e.target.value })}/>
                          <input type="time" className={`${field} flex-1 basis-[92px] min-w-0`} value={row.close || ""} disabled={!!row.closed}
                                 data-testid={`photo-special-close-${d}`}
                                 onChange={(e) => setDay(editing, setEditing, d, { ...row, close: e.target.value })}/>
                        </div>
                      );
                    })}
                  </div>
                </details>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={label}>Slot length (minutes)</label>
                    <input type="number" className={field} value={editing.slot_minutes} data-testid="photo-special-slot-minutes"
                           onChange={(e) => setEditing({ ...editing, slot_minutes: Number(e.target.value) || 15 })}/>
                  </div>
                  <div>
                    <label className={label}>Max bookings</label>
                    <input type="number" className={field} value={editing.max_bookings ?? ""} data-testid="photo-special-max"
                           placeholder="No cap"
                           onChange={(e) => setEditing({ ...editing, max_bookings: e.target.value === "" ? null : Number(e.target.value) })}/>
                  </div>
                </div>

                <div>
                  <label className={label}>Closed dates <span className="normal-case tracking-normal font-semibold">(one per line — skip a day without changing the range)</span></label>
                  <textarea rows={2} className={`${field} py-2`} data-testid="photo-special-closed-dates"
                            value={(editing.closed_dates || []).join("\n")}
                            onChange={(e) => setEditing({ ...editing, closed_dates: e.target.value.split("\n").map((d) => d.trim()).filter(Boolean) })}/>
                </div>

                <details data-testid="photo-special-explicit-dates">
                  <summary className="cursor-pointer text-[11px] font-black uppercase tracking-widest text-shTextMuted">
                    Specific dates instead of a range
                  </summary>
                  <p className="text-[12px] text-shTextMuted mt-1.5">
                    For a one-off event on set days. Leave empty to use the range above — if you fill this in, it wins.
                  </p>
                  <textarea rows={2} className={`${field} py-2 mt-1.5`} data-testid="photo-special-dates"
                            value={(editing.dates || []).join("\n")}
                            onChange={(e) => setEditing({ ...editing, dates: e.target.value.split("\n").map((d) => d.trim()).filter(Boolean) })}/>
                </details>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label}>Location name</label>
                  <input className={field} value={editing.location_name}
                         onChange={(e) => setEditing({ ...editing, location_name: e.target.value })}/>
                </div>
                <div>
                  <label className={label}>Location address</label>
                  <input className={field} value={editing.location_address}
                         onChange={(e) => setEditing({ ...editing, location_address: e.target.value })}/>
                </div>
              </div>
              <div>
                <label className={label}>What to expect (one per line)</label>
                <textarea rows={3} className={`${field} py-2`} value={(editing.what_to_expect || []).join("\n")}
                          onChange={(e) => setEditing({ ...editing, what_to_expect: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}/>
              </div>
              <div>
                <label className={label}>Packages intro <span className="normal-case tracking-normal font-semibold">(optional words above the price list on the public page)</span></label>
                <textarea rows={2} className={`${field} py-2`} value={editing.packages_blurb} data-testid="photo-special-packages"
                          onChange={(e) => setEditing({ ...editing, packages_blurb: e.target.value })}/>
              </div>
              {/* The price list the desk sells from after the session. Each
                  special has its own, and each package rings through the real
                  register — see domains/photo_orders. */}
              <div className="rounded-xl border border-shBorder/60 p-3 space-y-3" data-testid="photo-special-photo-packages">
                <p className="text-[11px] font-black uppercase tracking-widest text-shPrimary">Photo packages</p>
                <p className="text-[12px] text-shTextMuted">
                  Reserving a slot costs nothing; the Register still prices the sale when a package is rung up after the session.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={label}>Photos title <span className="normal-case tracking-normal font-semibold">(receipts + emails)</span></label>
                    <input className={field} value={editing.photos_title || ""} data-testid="photo-special-photos-title"
                           placeholder="Howl-O-Ween Portraits"
                           onChange={(e) => setEditing({ ...editing, photos_title: e.target.value })}/>
                  </div>
                  <div>
                    <label className={label}>Order # prefix</label>
                    <input className={field} value={editing.order_prefix || ""} data-testid="photo-special-order-prefix"
                           placeholder="SH-PS" maxLength={12}
                           onChange={(e) => setEditing({ ...editing, order_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "") })}/>
                  </div>
                </div>
                <PhotoPackagesEditor packages={editing.photo_packages || []} testid="photo-special"
                                     copySources={copySources}
                                     onChange={(list) => setEditing((cur) => ({ ...cur, photo_packages: list }))}/>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={label}>Arrival notes</label>
                  <input className={field} value={editing.arrival_notes}
                         onChange={(e) => setEditing({ ...editing, arrival_notes: e.target.value })}/>
                </div>
                <div>
                  <label className={label}>Cancellation notes</label>
                  <input className={field} value={editing.cancellation_notes}
                         onChange={(e) => setEditing({ ...editing, cancellation_notes: e.target.value })}/>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 pt-1">
                <label className="inline-flex items-center gap-2 text-[13px] text-shText">
                  <input type="checkbox" checked={!!editing.booking_open} data-testid="photo-special-open"
                         onChange={(e) => setEditing({ ...editing, booking_open: e.target.checked })}/>
                  Booking open
                </label>
                <label className="inline-flex items-center gap-2 text-[13px] text-shText">
                  <input type="checkbox" checked={!!editing.published} data-testid="photo-special-published"
                         onChange={(e) => setEditing({ ...editing, published: e.target.checked })}/>
                  Published (public page live)
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setEditing(null)} className="flex-1 min-h-[44px] rounded-lg border border-shBorder text-shTextMuted font-black text-[12px] uppercase tracking-widest">Cancel</button>
              <button onClick={save} disabled={!editing.name.trim() || busy} data-testid="photo-special-save"
                      className="flex-[2] min-h-[44px] rounded-lg bg-shPrimary text-bgHeader font-black text-[12px] uppercase tracking-widest disabled:opacity-40">
                {busy ? "Saving…" : "Save special"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event-day roster */}
      {roster && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center p-4 z-[120] overflow-y-auto"
             onClick={() => setRoster(null)} data-testid="photo-special-roster">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-5 w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-lg font-black text-shText uppercase italic">{roster.special.name} — today's list</h4>
            <p className="text-[12.5px] text-shTextMuted mb-3">
              {roster.booked_count} booked{roster.max_bookings ? ` of ${roster.max_bookings}` : ""}
            </p>
            {/* A six-week promotion has dozens of dates, so the strip scrolls
                rather than pushing the actual list off the screen. */}
            <div className="flex flex-wrap gap-1.5 mb-3 max-h-[132px] overflow-y-auto" data-testid="photo-special-roster-days">
              {(roster.special.dates || []).map((d) => (
                <button key={d} onClick={() => openRoster(roster.special, d)}
                        className={`min-h-[36px] px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest ${rosterDay === d ? "border-shPrimary bg-shPrimary/15 text-shPrimary" : "border-shBorder text-shTextMuted"}`}>
                  {fmtRosterDay(d)}
                </button>
              ))}
            </div>
            {roster.reservations.length === 0 ? (
              <p className="text-shTextMuted text-sm py-6 text-center">Nothing booked yet.</p>
            ) : (
              <div className="space-y-2">
                {roster.reservations.map((r) => (
                  <div key={r.booking_id} data-testid={`photo-special-reservation-${r.booking_id}`}
                       className={`rounded-xl border p-3 flex items-center gap-3 ${r.status === "cancelled" ? "border-shBorder/50 opacity-60" : "border-shPrimary/40"}`}>
                    <span className="w-[76px] shrink-0 text-center">
                      <span className="block text-[14px] font-black text-shText">{fmtTime(r.time)}</span>
                      <span className="block text-[9px] font-black uppercase tracking-widest text-shTextMuted">{r.date}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-black text-shText truncate">{r.dog_name}</span>
                      <span className="block text-[12px] text-shTextMuted truncate">{r.client_name}</span>
                      {/* Front Desk still sees the truth: the reservation was
                          allowed without paperwork, it did not invent any. */}
                      <span className={`inline-block mt-0.5 text-[10px] font-black uppercase tracking-widest ${r.vaccines_on_file ? "text-shPrimary" : "text-shAccent"}`}
                            data-testid={`photo-special-vax-${r.booking_id}`}>
                        Vaccine records: {r.vaccines_on_file ? "On file" : "Not on file"}
                      </span>
                      {/* Who bought what, right on the list. */}
                      {(r.photo_orders || []).map((o) => (
                        <span key={o.id} data-testid={`photo-special-reservation-order-${o.id}`}
                              className="block text-[11px] font-black text-shSecondary truncate">
                          <i className="fas fa-camera-retro mr-1"/>{o.order_number} · {o.package_name}{o.qty > 1 ? ` × ${o.qty}` : ""} · {ORDER_STATUS_LABEL[o.status] || o.status}
                        </span>
                      ))}
                    </span>
                    <span className="flex flex-wrap gap-1.5 shrink-0">
                      {r.status === "cancelled" ? (
                        <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">
                          {r.no_show ? "No show" : "Cancelled"}
                        </span>
                      ) : (
                        <>
                          <a href={`/admin/clients?focus=${r.client_id}`}
                             className="min-h-[34px] px-2.5 rounded-lg border border-shBorder text-[10.5px] font-black uppercase tracking-widest text-shText inline-flex items-center">Client</a>
                          <button onClick={() => orderFromReservation(roster.special, r)}
                                  data-testid={`photo-special-order-${r.booking_id}`}
                                  className="min-h-[34px] px-2.5 rounded-lg border border-shBorder text-[10.5px] font-black uppercase tracking-widest text-shPrimary">
                            <i className="fas fa-camera-retro mr-1"/>Photo order
                          </button>
                          <button onClick={() => markNoShow(roster.special, r)}
                                  data-testid={`photo-special-no-show-${r.booking_id}`}
                                  className="min-h-[34px] px-2.5 rounded-lg border border-shBorder text-[10.5px] font-black uppercase tracking-widest text-shAccent">No show</button>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <button onClick={() => setRoster(null)} className="min-h-[44px] px-4 rounded-lg border border-shBorder text-shTextMuted font-black text-[12px] uppercase tracking-widest">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Photo orders */}
      {ordersFor && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center p-2 sm:p-4 z-[120] overflow-y-auto"
             onClick={() => setOrdersFor(null)} data-testid="photo-special-orders">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-3 sm:p-5 w-full max-w-4xl my-4 sm:my-8 min-w-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <h4 className="text-lg font-black text-shText uppercase italic min-w-0">{ordersFor.name} — photo orders</h4>
              <button onClick={() => setOrdersFor(null)} aria-label="Close" data-testid="photo-special-orders-close"
                      className="min-w-[44px] min-h-[44px] text-shTextMuted hover:text-shText text-xl shrink-0"><i className="fas fa-times"/></button>
            </div>
            {(ordersFor.photo_packages || []).length === 0 && (
              <p className="text-[13px] text-shAccent mb-3" data-testid="photo-special-orders-no-packages">
                This special has no photo packages yet — add them with Edit → Photo packages.
              </p>
            )}
            <PhotoOrdersPanel owner={ordersFor} base={`/admin/photo-specials/${ordersFor.id}`} can={can}
                              search={searchReservations} searchLabel="Find a reservation" searchPlaceholder="Owner, dog, email or phone"
                              linkedLabel="Linked to their reservation" subtitle="Ring up the package after the session, deliver within the week."
                              startOrder={startOrder} onStartOrderUsed={clearStartOrder}/>
          </div>
        </div>
      )}
    </div>
  );
}
