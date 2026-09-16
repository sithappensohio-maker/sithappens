import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import { useConfirm } from "../lib/useConfirm";

/**
 * Photo Specials admin — create a portrait event, then work it on the day.
 *
 * Deliberately not a calendar. Every reservation here is an ordinary
 * photography booking, so the schedule, Front Desk and the Register already
 * know about it; this screen only configures the special and gives the owner
 * the event-day list with the actions that matter at the desk.
 */
const BLANK = {
  name: "", headline: "", description: "", location_name: "Sit Happens", location_address: "",
  what_to_expect: [], packages_blurb: "", arrival_notes: "", cancellation_notes: "",
  dates: [], start_time: "09:00", end_time: "15:00", slot_minutes: 15,
  dogs_per_slot: 1, max_bookings: null, booking_open: true, published: false,
};

const fmtTime = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${ampm}`;
};

export default function PhotoSpecials() {
  const confirm = useConfirm();
  const [specials, setSpecials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [roster, setRoster] = useState(null);
  const [rosterDay, setRosterDay] = useState("");
  const [busy, setBusy] = useState(false);

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
      const body = { ...editing, max_bookings: editing.max_bookings === "" ? null : editing.max_bookings };
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

  const openRoster = async (sp, day = "") => {
    try {
      const { data } = await api.get(`/admin/photo-specials/${sp.id}/reservations`, { params: day ? { date: day } : {} });
      setRoster(data);
      setRosterDay(day || (sp.dates || [])[0] || "");
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
          <button onClick={() => setEditing({ ...BLANK })} data-testid="photo-special-new"
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
                    {(sp.dates || []).length} date{(sp.dates || []).length === 1 ? "" : "s"} · {sp.slot_minutes} min · {sp.booked_count} booked
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
                <button onClick={() => setEditing(sp)} data-testid={`photo-special-edit-${sp.id}`}
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
              <div>
                <label className={label}>Dates (one per line, YYYY-MM-DD) *</label>
                <textarea rows={3} className={`${field} py-2`} data-testid="photo-special-dates"
                          value={(editing.dates || []).join("\n")}
                          onChange={(e) => setEditing({ ...editing, dates: e.target.value.split("\n").map((d) => d.trim()).filter(Boolean) })}/>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className={label}>Start</label>
                  <input type="time" className={field} value={editing.start_time} data-testid="photo-special-start"
                         onChange={(e) => setEditing({ ...editing, start_time: e.target.value })}/>
                </div>
                <div>
                  <label className={label}>End</label>
                  <input type="time" className={field} value={editing.end_time} data-testid="photo-special-end"
                         onChange={(e) => setEditing({ ...editing, end_time: e.target.value })}/>
                </div>
                <div>
                  <label className={label}>Slot (min)</label>
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
                <label className={label}>Packages / pricing copy <span className="normal-case tracking-normal font-semibold">(marketing text — the Register still prices the sale)</span></label>
                <textarea rows={3} className={`${field} py-2`} value={editing.packages_blurb} data-testid="photo-special-packages"
                          onChange={(e) => setEditing({ ...editing, packages_blurb: e.target.value })}/>
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
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(roster.special.dates || []).map((d) => (
                <button key={d} onClick={() => openRoster(roster.special, d)}
                        className={`min-h-[36px] px-3 rounded-lg border text-[11px] font-black uppercase tracking-widest ${rosterDay === d ? "border-shPrimary bg-shPrimary/15 text-shPrimary" : "border-shBorder text-shTextMuted"}`}>
                  {d}
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
                          <a href="/admin/front-desk"
                             className="min-h-[34px] px-2.5 rounded-lg border border-shBorder text-[10.5px] font-black uppercase tracking-widest text-shPrimary inline-flex items-center">Register</a>
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
    </div>
  );
}
