/* Events — the admin side of public event preregistration.
   One event at a time (the newest by default): summary cards, a phone-first
   attendee search with a big CHECK IN button (and undo), walk-ins at the door,
   the costume-contest roster with contestant numbers, and CSV exports. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import EventEditor from "../components/EventEditor";

const VIEWS = [
  ["attendees", "Attendees", "fa-list-check"],
  ["costume", "Costume contest", "fa-hat-wizard"],
];
const STATUS_FILTERS = [["registered", "Registered"], ["all", "All"], ["cancelled", "Cancelled"]];

export function padContestant(n) { return n ? `#${String(n).padStart(3, "0")}` : ""; }
export function fmtWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}
export function fmtTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch { return iso; }
}
/** Summary cards in the order the owner asked for. */
export const SUMMARY_CARDS = [
  ["households", "Registered households", "fa-house"],
  ["adults", "Expected adults", "fa-user"],
  ["children", "Expected children", "fa-child"],
  ["people", "Expected total people", "fa-people-group"],
  ["dogs", "Expected dogs", "fa-paw"],
  ["costume_entries", "Costume contest entries", "fa-hat-wizard"],
  ["checked_in", "Checked in", "fa-circle-check"],
  ["walk_ins", "Walk-ins", "fa-person-walking"],
];

/** The flyer QR code for an event: shown small, downloadable print-size.
 *  Fetched through the API client (it needs the staff token), so it is an
 *  object URL rather than a plain <img src>. The API path has no .png suffix
 *  on purpose — production nginx serves image-looking paths statically. */
function EventQr({ event }) {
  const [src, setSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const origin = window.location.origin;
  useEffect(() => {
    let alive = true; let url = null;
    setSrc(null);
    api.get(`/admin/events/${event.id}/qr`, { params: { origin, size: 6 }, responseType: "blob" })
      .then((r) => { if (!alive) return; url = URL.createObjectURL(r.data); setSrc(url); })
      .catch(() => { if (alive) setSrc(""); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [event.id, event.slug, origin]);
  const download = async () => {
    setBusy(true);
    try {
      const r = await api.get(`/admin/events/${event.id}/qr`, { params: { origin, size: 30 }, responseType: "blob" });
      const href = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = href; a.download = `${event.slug}-qr.png`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't build the QR code."); }
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-3" data-testid="event-qr">
      <div className="w-[96px] h-[96px] shrink-0 rounded-lg bg-white p-1 grid place-items-center overflow-hidden">
        {src ? <img src={src} alt={`QR code for ${event.name}`} className="w-full h-full object-contain" data-testid="event-qr-image" />
             : src === "" ? <span className="text-[10px] text-gray-500 text-center">QR unavailable</span> : <span className="text-[10px] text-gray-500">…</span>}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Flyer QR code</p>
        <p className="text-[12px] text-shTextMuted mt-0.5">Scans straight to the preregistration page.</p>
        <button type="button" onClick={download} disabled={busy || !src} data-testid="event-qr-download"
                className="mt-1.5 min-h-[40px] px-3 rounded-lg bg-shSurfaceRaised text-shText font-black text-[11px] uppercase tracking-widest border border-bgHover disabled:opacity-50">
          <i className="fas fa-download mr-1" />{busy ? "Building…" : "Download PNG"}
        </button>
      </div>
    </div>
  );
}

async function downloadCsv(url, filename) {
  const r = await api.get(url, { responseType: "blob" });
  const href = URL.createObjectURL(new Blob([r.data], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = href; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(href);
}

const inputCls = "w-full mt-1 bg-bgBase border border-bgHover rounded-xl px-3 py-3 text-white text-[16px] focus:border-shGreen outline-none";
const labelCls = "text-[11px] font-black text-shTextMuted uppercase tracking-widest";

function Pill({ tone = "muted", children, testid }) {
  const cls = {
    green: "bg-shGreen/15 text-shGreen ring-1 ring-shGreen/40",
    orange: "bg-shOrange/15 text-shOrange ring-1 ring-shOrange/40",
    blue: "bg-shBlue/15 text-shBlue ring-1 ring-shBlue/40",
    red: "bg-red-500/15 text-red-300 ring-1 ring-red-500/40",
    muted: "bg-shSurfaceRaised text-shTextMuted",
  }[tone];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wide whitespace-nowrap ${cls}`} data-testid={testid}>{children}</span>;
}

/** One attendee row — built for a thumb on a phone: identity on the left, the
 *  big button on the right, details on tap. */
function AttendeeRow({ reg, onCheckIn, onUndo, onOpen, busy }) {
  const cancelled = reg.status === "cancelled";
  return (
    <div className={`bg-bgPanel border rounded-2xl p-3 sm:p-4 ${reg.checked_in ? "border-shGreen/50" : "border-bgHover"} ${cancelled ? "opacity-60" : ""}`}
         data-testid={`event-reg-${reg.id}`} data-checked-in={reg.checked_in ? "1" : "0"}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={() => onOpen(reg)} className="min-w-0 flex-1 text-left" data-testid={`event-reg-open-${reg.id}`}>
          <p className="text-[16px] font-black text-white leading-tight truncate">{reg.primary_contact}</p>
          <p className="text-[12px] text-shTextMuted truncate mt-0.5">
            <span className="font-mono font-black text-shBlue">{reg.confirmation_number}</span>
            {reg.dog_names ? <> · <i className="fas fa-paw text-[10px]" /> {reg.dog_names}</> : null}
          </p>
          <p className="text-[12px] text-shTextMuted mt-0.5 truncate">{reg.phone}{reg.email ? ` · ${reg.email}` : ""}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Pill>{reg.adults} adult{reg.adults === 1 ? "" : "s"}{reg.children ? ` · ${reg.children} child${reg.children === 1 ? "" : "ren"}` : ""}</Pill>
            <Pill>{reg.dog_count} dog{reg.dog_count === 1 ? "" : "s"}</Pill>
            {reg.costume_contest && <Pill tone="orange"><i className="fas fa-hat-wizard" />{reg.dogs.filter((d) => d.contestant_number).map((d) => padContestant(d.contestant_number)).join(" ")}</Pill>}
            {reg.source === "walk_in" && <Pill tone="blue">Walk-in</Pill>}
            {cancelled && <Pill tone="red">Cancelled</Pill>}
            {reg.checked_in && <Pill tone="green" testid={`event-reg-checked-${reg.id}`}><i className="fas fa-check" />In {fmtTime(reg.checked_in_at)}</Pill>}
          </div>
        </button>
        <div className="shrink-0 flex flex-col items-stretch gap-1.5 w-[104px] sm:w-[128px]">
          {reg.checked_in ? (
            <button type="button" onClick={() => onUndo(reg)} disabled={busy === reg.id} data-testid={`event-undo-${reg.id}`}
                    className="min-h-[52px] rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover disabled:opacity-50">
              <i className="fas fa-rotate-left mr-1" />Undo
            </button>
          ) : (
            <button type="button" onClick={() => onCheckIn(reg)} disabled={busy === reg.id || cancelled} data-testid={`event-checkin-${reg.id}`}
                    className="min-h-[52px] rounded-xl bg-shGreen text-bgHeader font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-40">
              <i className="fas fa-check mr-1" />Check in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Sheet({ title, icon, onClose, children, testid }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" onClick={onClose} data-testid={testid}>
      <div className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full max-w-lg p-4 sm:p-6 shadow-2xl max-h-[calc(var(--app-height,100vh)_-_1rem)] overflow-y-auto sh-modal-surface"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-lg font-black text-white uppercase italic tracking-tight pr-2"><i className={`fas ${icon} text-shGreen mr-2`} />{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" data-testid={`${testid}-close`} className="text-gray-400 hover:text-white text-xl min-w-[44px] min-h-[44px]"><i className="fas fa-times" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RegistrationDetail({ reg, onClose, onCheckIn, onUndo, onCancel, onReinstate, busy }) {
  const Row = ({ label, children }) => (children === null || children === undefined || children === "" ? null : (
    <div className="flex flex-col sm:flex-row sm:gap-3 text-[14px]">
      <span className="sm:w-36 shrink-0 text-[11px] font-black uppercase tracking-widest text-shTextMuted pt-0.5">{label}</span>
      <span className="text-shText break-words">{children}</span>
    </div>
  ));
  return (
    <Sheet title={reg.primary_contact} icon="fa-id-badge" onClose={onClose} testid="event-reg-detail">
      <div className="space-y-2">
        <Row label="Confirmation"><span className="font-mono font-black text-shBlue text-[16px]">{reg.confirmation_number}</span></Row>
        <Row label="Contact">{reg.phone}{reg.email ? <><br />{reg.email}</> : null}</Row>
        <Row label="People">{reg.adults} adult{reg.adults === 1 ? "" : "s"}, {reg.children} child{reg.children === 1 ? "" : "ren"}</Row>
        <Row label="Source">{reg.source === "walk_in" ? "Walk-in" : reg.source === "online" ? "Preregistered online" : reg.source}{reg.heard_from_label ? ` · heard via ${reg.heard_from_label}${reg.heard_from_other ? ` (${reg.heard_from_other})` : ""}` : ""}</Row>
        <Row label="Marketing">{reg.marketing_consent ? "Opted in to future events & specials" : "Not opted in"}</Row>
        <Row label="Registered">{fmtWhen(reg.created_at)}</Row>
        <Row label="Check-in">{reg.checked_in ? `${fmtWhen(reg.checked_in_at)}${reg.checked_in_by?.name ? ` by ${reg.checked_in_by.name}` : ""}` : "Not yet"}</Row>
        {reg.admin_notes && <Row label="Notes">{reg.admin_notes}</Row>}
      </div>
      <div className="mt-4">
        <p className={labelCls}>Dogs</p>
        {reg.dogs.length === 0 && <p className="text-[14px] text-shTextMuted mt-1">No dogs listed.</p>}
        <ul className="mt-1 space-y-2" data-testid="event-reg-detail-dogs">
          {reg.dogs.map((d, i) => (
            <li key={i} className="bg-bgBase border border-bgHover rounded-xl p-3">
              <p className="text-[15px] font-black text-white"><i className="fas fa-paw text-shGreen mr-1.5" />{d.name}{d.dog_id && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-shBlue">Client dog</span>}</p>
              {d.costume_entered ? (
                <p className="text-[13px] text-shText mt-1"><span className="text-shOrange font-black">Contestant {padContestant(d.contestant_number)}</span>{d.costume_theme ? ` · ${d.costume_theme}` : ""}{d.dog_and_human ? " · dog + human" : ""}{d.costume_notes ? <><br /><span className="text-shTextMuted">{d.costume_notes}</span></> : null}</p>
              ) : <p className="text-[12px] text-shTextMuted mt-1">Not in the costume contest</p>}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {reg.status === "registered" && (reg.checked_in
          ? <button type="button" onClick={() => onUndo(reg)} disabled={busy === reg.id} data-testid="event-reg-detail-undo" className="min-h-[52px] rounded-xl bg-shSurfaceRaised text-shText font-black text-[13px] uppercase tracking-widest border border-bgHover"><i className="fas fa-rotate-left mr-1" />Undo check-in</button>
          : <button type="button" onClick={() => onCheckIn(reg)} disabled={busy === reg.id} data-testid="event-reg-detail-checkin" className="min-h-[52px] rounded-xl bg-shGreen text-bgHeader font-black text-[13px] uppercase tracking-widest"><i className="fas fa-check mr-1" />Check in</button>)}
        {reg.status === "registered"
          ? <button type="button" onClick={() => onCancel(reg)} disabled={busy === reg.id} data-testid="event-reg-detail-cancel" className="min-h-[52px] rounded-xl bg-red-500/10 text-red-300 font-black text-[12px] uppercase tracking-widest border border-red-500/30">Cancel registration</button>
          : <button type="button" onClick={() => onReinstate(reg)} disabled={busy === reg.id} data-testid="event-reg-detail-reinstate" className="min-h-[52px] rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover col-span-2">Reinstate</button>}
      </div>
    </Sheet>
  );
}

const emptyWalkIn = () => ({ primary_contact: "", phone: "", email: "", adults: 1, children: 0, dogs: [{ name: "", costume_entered: false, costume_theme: "", dog_and_human: false }], costume_contest: false, notes: "", check_in: true });

function WalkInSheet({ event, onClose, onAdded }) {
  const [f, setF] = useState(emptyWalkIn);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setDogCount = (n) => setF((p) => { const dogs = p.dogs.slice(0, n); while (dogs.length < n) dogs.push({ name: "", costume_entered: false, costume_theme: "", dog_and_human: false }); return { ...p, dogs }; });
  const setDog = (i, patch) => setF((p) => ({ ...p, dogs: p.dogs.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const contestOn = event?.features?.costume_contest !== false;
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.phone.trim() && !f.email.trim()) { setErr("A phone number or email is required."); return; }
    setBusy(true);
    try {
      const dogs = f.dogs.filter((d) => d.name.trim()).map((d) => ({ ...d, name: d.name.trim(), costume_entered: !!(f.costume_contest && (d.costume_entered || f.dogs.length === 1)) }));
      const { data } = await api.post(`/admin/events/${event.id}/walk-in`, { ...f, dogs, costume_contest: !!(f.costume_contest && contestOn) });
      toast.success(`Added ${data.registration.primary_contact} · ${data.registration.confirmation_number}`);
      onAdded(data);
    } catch (ex) {
      setErr(formatErr(ex.response?.data?.detail) || "Couldn't add the walk-in.");
    }
    setBusy(false);
  };
  const num = (label, key, min, max) => (
    <div>
      <p className={labelCls}>{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label}`} onClick={() => set(key)(Math.max(min, f[key] - 1))} className="w-11 h-11 rounded-xl bg-bgBase border border-bgHover text-white text-lg font-black">−</button>
        <input type="number" inputMode="numeric" min={min} max={max} value={f[key]} onChange={(e) => set(key)(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} data-testid={`walkin-${key}`}
               className="w-14 h-11 text-center bg-bgBase border border-bgHover rounded-xl text-white text-[16px] font-black" />
        <button type="button" aria-label={`More ${label}`} onClick={() => set(key)(Math.min(max, f[key] + 1))} className="w-11 h-11 rounded-xl bg-bgBase border border-bgHover text-white text-lg font-black">+</button>
      </div>
    </div>
  );
  return (
    <Sheet title="Add walk-in" icon="fa-person-walking" onClose={onClose} testid="event-walkin">
      <form onSubmit={submit} className="space-y-4">
        <div><label className={labelCls} htmlFor="wi-name">Name</label><input id="wi-name" required value={f.primary_contact} onChange={(e) => set("primary_contact")(e.target.value)} className={inputCls} data-testid="walkin-name" autoFocus /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={labelCls} htmlFor="wi-phone">Phone</label><input id="wi-phone" type="tel" value={f.phone} onChange={(e) => set("phone")(e.target.value)} className={inputCls} data-testid="walkin-phone" /></div>
          <div><label className={labelCls} htmlFor="wi-email">Email <span className="normal-case font-normal">(or phone)</span></label><input id="wi-email" type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} className={inputCls} data-testid="walkin-email" /></div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {num("Adults", "adults", 1, 20)}
          {num("Children", "children", 0, 20)}
          <div>
            <p className={labelCls}>Dogs</p>
            <div className="mt-1 flex items-center gap-2">
              <button type="button" aria-label="Fewer dogs" onClick={() => setDogCount(Math.max(0, f.dogs.length - 1))} className="w-11 h-11 rounded-xl bg-bgBase border border-bgHover text-white text-lg font-black">−</button>
              <span className="w-14 h-11 grid place-items-center bg-bgBase border border-bgHover rounded-xl text-white text-[16px] font-black" data-testid="walkin-dogs">{f.dogs.length}</span>
              <button type="button" aria-label="More dogs" onClick={() => setDogCount(Math.min(10, f.dogs.length + 1))} className="w-11 h-11 rounded-xl bg-bgBase border border-bgHover text-white text-lg font-black">+</button>
            </div>
          </div>
        </div>
        {f.dogs.map((d, i) => (
          <div key={i} className="bg-bgBase border border-bgHover rounded-xl p-3 space-y-2">
            <input required placeholder={`Dog ${i + 1} name`} value={d.name} onChange={(e) => setDog(i, { name: e.target.value })} className={inputCls.replace("mt-1 ", "")} data-testid={`walkin-dog-${i}`} />
            {contestOn && f.costume_contest && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {f.dogs.length > 1 && <label className="flex items-center gap-2 min-h-[44px] text-[13px] text-shText sm:col-span-2"><input type="checkbox" checked={!!d.costume_entered} onChange={(e) => setDog(i, { costume_entered: e.target.checked })} className="w-5 h-5 accent-shOrange" data-testid={`walkin-dog-costume-${i}`} />{d.name || `Dog ${i + 1}`} is competing</label>}
                <input placeholder="Costume / theme (optional)" value={d.costume_theme} onChange={(e) => setDog(i, { costume_theme: e.target.value })} className={inputCls.replace("mt-1 ", "")} data-testid={`walkin-dog-theme-${i}`} />
                <label className="flex items-center gap-2 min-h-[44px] text-[13px] text-shText"><input type="checkbox" checked={!!d.dog_and_human} onChange={(e) => setDog(i, { dog_and_human: e.target.checked })} className="w-5 h-5 accent-shOrange" />Dog + human costume</label>
              </div>
            )}
          </div>
        ))}
        {contestOn && f.dogs.length > 0 && (
          <label className="flex items-center gap-3 min-h-[44px] text-[14px] font-black text-white"><input type="checkbox" checked={f.costume_contest} onChange={(e) => set("costume_contest")(e.target.checked)} className="w-5 h-5 accent-shOrange" data-testid="walkin-costume" /><i className="fas fa-hat-wizard text-shOrange" />Entering the costume contest</label>
        )}
        <label className="flex items-center gap-3 min-h-[44px] text-[14px] text-shText"><input type="checkbox" checked={f.check_in} onChange={(e) => set("check_in")(e.target.checked)} className="w-5 h-5 accent-shGreen" data-testid="walkin-checkin" />Check in now (they're here)</label>
        <div><label className={labelCls} htmlFor="wi-notes">Notes <span className="normal-case font-normal">(optional)</span></label><input id="wi-notes" value={f.notes} onChange={(e) => set("notes")(e.target.value)} className={inputCls} /></div>
        {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="walkin-error">{err}</div>}
        <button type="submit" disabled={busy} data-testid="walkin-submit" className="w-full min-h-[56px] rounded-xl bg-shGreen text-bgHeader font-black text-[15px] uppercase tracking-widest disabled:opacity-50">{busy ? "Adding…" : "Add walk-in"}</button>
      </form>
    </Sheet>
  );
}

export default function Events({ can }) {
  const [events, setEvents] = useState(null);
  const [eventId, setEventId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [view, setView] = useState("attendees");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("registered");
  const [regs, setRegs] = useState([]);
  const [contestants, setContestants] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(null);
  const [walkIn, setWalkIn] = useState(false);
  const [editor, setEditor] = useState(null); // null | "new" | event
  const canEdit = !!can?.("edit_events");
  const searchRef = useRef(null);
  const event = useMemo(() => (events || []).find((e) => e.id === eventId) || null, [events, eventId]);
  useEffect(() => { if (events && events.length && !events.some((e) => e.id === eventId)) setEventId(events[0].id); }, [events, eventId]);

  const loadEvents = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/events");
      setEvents(data.events || []);
      setEventId((cur) => cur || data.events?.[0]?.id || null);
      setErr("");
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Couldn't load events."); setEvents([]); }
  }, []);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const refreshSummary = useCallback(async (id) => {
    if (!id) return;
    try { const { data } = await api.get(`/admin/events/${id}`); setSummary(data.summary); setEvents((evs) => (evs || []).map((e) => (e.id === id ? { ...e, ...data.event } : e))); } catch { /* keep the last numbers */ }
  }, []);
  const loadRegs = useCallback(async (id, term, status) => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/events/${id}/registrations`, { params: { q: term || "", status: status || "all" } });
      setRegs(data.registrations || []);
      setErr("");
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Couldn't load attendees."); }
    setLoading(false);
  }, []);
  const loadContestants = useCallback(async (id) => {
    if (!id) return;
    try { const { data } = await api.get(`/admin/events/${id}/costume-contest`); setContestants(data.contestants || []); } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (eventId) { refreshSummary(eventId); loadContestants(eventId); } }, [eventId, refreshSummary, loadContestants]);
  // Debounced search — typing on a phone must not fire a request per keystroke.
  useEffect(() => {
    if (!eventId) return undefined;
    const t = setTimeout(() => loadRegs(eventId, q.trim(), statusFilter), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [eventId, q, statusFilter, loadRegs]);

  const applyResult = (data) => {
    if (data.summary) setSummary(data.summary);
    if (data.registration) {
      setRegs((rs) => rs.map((r) => (r.id === data.registration.id ? data.registration : r)));
      setOpen((o) => (o && o.id === data.registration.id ? data.registration : o));
    }
    loadContestants(eventId);
  };
  const act = async (reg, path, okMsg, body) => {
    setBusy(reg.id);
    try {
      const { data } = body ? await api.patch(`/admin/events/${eventId}/registrations/${reg.id}`, body) : await api.post(`/admin/events/${eventId}/registrations/${reg.id}/${path}`);
      applyResult(data);
      if (body) refreshSummary(eventId);
      toast.success(okMsg);
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "That didn't save."); }
    setBusy("");
  };
  const checkIn = (reg) => act(reg, "check-in", `${reg.primary_contact} checked in`);
  const undo = (reg) => act(reg, "undo-check-in", `Check-in undone for ${reg.primary_contact}`);
  const cancel = (reg) => { if (window.confirm(`Cancel ${reg.primary_contact}'s registration?`)) act(reg, null, "Registration cancelled", { status: "cancelled" }); };
  const reinstate = (reg) => act(reg, null, "Registration reinstated", { status: "registered" });
  const toggleEvent = async (patch, msg) => {
    try { const { data } = await api.patch(`/admin/events/${eventId}`, patch); setEvents((evs) => evs.map((e) => (e.id === eventId ? { ...e, ...data.event } : e))); setSummary(data.summary); toast.success(msg); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't update the event."); }
  };
  const exportCsv = async (kind) => {
    try { await downloadCsv(`/admin/events/${eventId}/${kind === "costume" ? "costume-contest.csv" : "export.csv"}`, `${event?.slug || "event"}-${kind === "costume" ? "costume-contest" : "registrations"}.csv`); }
    catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Export failed."); }
  };

  const publicUrl = event ? `${window.location.origin}/events/${event.slug}` : "";
  const copyLink = async () => { try { await navigator.clipboard.writeText(publicUrl); toast.success("Link copied"); } catch { toast.error("Copy the link from the address shown."); } };

  return (
    <div className="space-y-4 sm:space-y-5" data-testid="events-screen">
      <PageHero compact icon="fa-calendar-day" title="Events" subtitle="Preregistrations, event-day check-in, walk-ins, the costume contest and exports." />

      {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="events-error">{err}</div>}
      {canEdit && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setEditor("new")} data-testid="event-new"
                  className="min-h-[48px] px-4 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover">
            <i className="fas fa-plus mr-1.5" />New event
          </button>
        </div>
      )}
      {events && events.length === 0 && !err && <p className="text-shTextMuted text-[14px]" data-testid="events-empty">No events yet.{canEdit ? " Create one with New event." : ""}</p>}

      {event && (
        <>
          {/* Event header */}
          <div className="bg-bgPanel border border-bgHover rounded-2xl p-4 sm:p-5" data-testid="event-header">
            <div className="flex flex-col lg:flex-row lg:items-start gap-3">
              <div className="min-w-0 flex-1">
                {events.length > 1 && (
                  <select value={eventId || ""} onChange={(e) => { setEventId(e.target.value); setQ(""); }} data-testid="event-select"
                          className="mb-2 bg-bgBase border border-bgHover rounded-xl px-3 py-2 text-white text-[14px] max-w-full">
                    {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
                <h2 className="text-[20px] sm:text-[24px] font-black text-white uppercase italic tracking-tight leading-tight" data-testid="event-name">{event.name}</h2>
                <p className="text-[13px] text-shTextMuted mt-1">{fmtWhen(event.start_at)}{event.end_at ? ` – ${fmtTime(event.end_at)}` : ""} · {event.location_name}{event.admission === "free" ? " · Free" : ""}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Pill tone={event.published ? "green" : "muted"}>{event.published ? "Published" : "Unpublished"}</Pill>
                  <Pill tone={event.registration_closed ? "red" : "green"} testid="event-reg-state">{event.registration_closed ? "Preregistration closed" : "Preregistration open"}</Pill>
                  <Pill tone={event.walk_ins_allowed !== false ? "blue" : "muted"}>{event.walk_ins_allowed !== false ? "Walk-ins welcome" : "No walk-ins"}</Pill>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                  <a href={publicUrl} target="_blank" rel="noreferrer" className="text-shBlue font-black break-all" data-testid="event-public-link">{publicUrl}</a>
                  <button type="button" onClick={copyLink} className="min-h-[36px] px-2.5 rounded-lg bg-shSurfaceRaised text-shText font-black uppercase tracking-widest text-[11px]"><i className="fas fa-copy mr-1" />Copy</button>
                </div>
                <div className="mt-3"><EventQr event={event} /></div>
              </div>
              {/* Side by side on wide screens, but the buttons must wrap rather than
                  squeeze the link + QR column to nothing: cap them at half the card. */}
              <div className="flex flex-wrap gap-2 lg:justify-end lg:max-w-[50%] lg:shrink-0">
                <button type="button" onClick={() => setWalkIn(true)} data-testid="event-add-walkin" className="min-h-[48px] px-4 rounded-xl bg-shGreen text-bgHeader font-black text-[13px] uppercase tracking-widest"><i className="fas fa-person-walking mr-1.5" />Add walk-in</button>
                <button type="button" onClick={() => exportCsv("all")} data-testid="event-export-csv" className="min-h-[48px] px-3 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover"><i className="fas fa-file-csv mr-1.5" />Export CSV</button>
                <button type="button" onClick={() => exportCsv("costume")} data-testid="event-export-costume-csv" className="min-h-[48px] px-3 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover"><i className="fas fa-hat-wizard mr-1.5" />Costume CSV</button>
                {canEdit && (
                  <button type="button" onClick={() => toggleEvent({ registration_open: !!event.registration_closed }, event.registration_closed ? "Preregistration reopened" : "Preregistration closed")} data-testid="event-toggle-registration"
                          className="min-h-[48px] px-3 rounded-xl bg-shSurfaceRaised text-shTextMuted font-black text-[12px] uppercase tracking-widest border border-bgHover">
                    {event.registration_closed ? "Reopen preregistration" : "Close preregistration"}
                  </button>
                )}
                {canEdit && (
                  <button type="button" onClick={() => setEditor(event)} data-testid="event-edit"
                          className="min-h-[48px] px-3 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover">
                    <i className="fas fa-pen-to-square mr-1.5" />Edit event
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3" data-testid="event-summary">
            {SUMMARY_CARDS.map(([key, label, icon]) => (
              <div key={key} className={`bg-bgPanel border rounded-2xl p-3 sm:p-4 ${key === "checked_in" ? "border-shGreen/50" : "border-bgHover"}`} data-testid={`event-stat-${key}`}>
                <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-shTextMuted leading-tight"><i className={`fas ${icon} mr-1`} />{label}</p>
                <p className="text-[26px] sm:text-[32px] font-black text-white leading-none mt-1.5 tabular-nums" data-testid={`event-stat-${key}-value`}>{summary ? summary[key] : "—"}</p>
              </div>
            ))}
          </div>

          {/* View switch */}
          <div className="flex gap-2" data-testid="event-views">
            {VIEWS.map(([k, label, icon]) => (
              <button key={k} type="button" onClick={() => setView(k)} aria-pressed={view === k} data-testid={`event-view-${k}`}
                      className={`min-h-[44px] px-3 sm:px-4 rounded-xl text-[12px] font-black uppercase tracking-widest ${view === k ? "bg-shPrimary text-bgHeader" : "bg-shSurfaceRaised text-shTextMuted"}`}>
                <i className={`fas ${icon} mr-1.5`} />{label}{k === "costume" && contestants.length ? <span className="ml-1.5 opacity-80">{contestants.length}</span> : null}
              </button>
            ))}
          </div>

          {view === "attendees" && (
            <div className="space-y-3" data-testid="event-attendees">
              <div className="relative">
                <i className="fas fa-magnifying-glass absolute left-4 top-1/2 -translate-y-1/2 text-shTextMuted" />
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, email, confirmation # or dog"
                       inputMode="search" autoComplete="off" data-testid="event-search"
                       className="w-full bg-bgPanel border border-bgHover rounded-2xl pl-11 pr-11 py-4 text-white text-[16px] focus:border-shGreen outline-none" />
                {q && <button type="button" onClick={() => { setQ(""); searchRef.current?.focus(); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[40px] min-h-[40px] text-shTextMuted"><i className="fas fa-times" /></button>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {STATUS_FILTERS.map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setStatusFilter(k)} aria-pressed={statusFilter === k} data-testid={`event-filter-${k}`}
                          className={`min-h-[36px] px-3 rounded-lg text-[11px] font-black uppercase tracking-widest ${statusFilter === k ? "bg-shSurfaceRaised text-shText ring-1 ring-bgHover" : "text-shTextMuted"}`}>{label}</button>
                ))}
                <span className="ml-auto text-[12px] text-shTextMuted" data-testid="event-attendee-count">{loading ? "Searching…" : `${regs.length} shown`}</span>
              </div>
              {!loading && regs.length === 0 && <p className="text-shTextMuted text-[14px] py-6 text-center" data-testid="event-attendees-empty">{q ? "No one matches. Try a phone number or the confirmation number, or add them as a walk-in." : "No registrations yet."}</p>}
              <div className="space-y-2">
                {regs.map((r) => <AttendeeRow key={r.id} reg={r} busy={busy} onCheckIn={checkIn} onUndo={undo} onOpen={setOpen} />)}
              </div>
            </div>
          )}

          {view === "costume" && (
            <div className="bg-bgPanel border border-bgHover rounded-2xl overflow-hidden" data-testid="event-costume">
              {contestants.length === 0 ? <p className="text-shTextMuted text-[14px] p-6 text-center" data-testid="event-costume-empty">No costume entries yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[640px]" data-testid="event-costume-table">
                    <thead className="text-[10px] uppercase tracking-widest text-shTextMuted">
                      <tr className="border-b border-bgHover">{["Contestant #", "Dog", "Owner", "Costume / theme", "Dog + human", "Checked in", "Notes"].map((h) => <th key={h} className="text-left px-3 py-2 font-black whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {contestants.map((c) => (
                        <tr key={`${c.registration_id}-${c.contestant_number}`} className="border-b border-bgHover/60" data-testid={`event-contestant-${c.contestant_number}`}>
                          <td className="px-3 py-2 font-mono font-black text-shOrange text-[15px] whitespace-nowrap">{c.contestant_label}</td>
                          <td className="px-3 py-2 font-black text-white">{c.dog_name}</td>
                          <td className="px-3 py-2 text-shText">{c.owner}</td>
                          <td className="px-3 py-2 text-shText">{c.costume_theme || <span className="text-shTextMuted">—</span>}</td>
                          <td className="px-3 py-2">{c.dog_and_human ? <Pill tone="orange">Yes</Pill> : <span className="text-shTextMuted">No</span>}</td>
                          <td className="px-3 py-2">{c.checked_in ? <Pill tone="green"><i className="fas fa-check" />In</Pill> : <span className="text-shTextMuted">Not yet</span>}</td>
                          <td className="px-3 py-2 text-shTextMuted max-w-[240px] truncate">{c.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {open && <RegistrationDetail reg={open} busy={busy} onClose={() => setOpen(null)} onCheckIn={checkIn} onUndo={undo} onCancel={cancel} onReinstate={reinstate} />}
      {editor && (
        <EventEditor event={editor === "new" ? null : editor} onClose={() => setEditor(null)}
          onSaved={(data) => {
            setEditor(null);
            setEvents((evs) => {
              const list = (evs || []).some((e) => e.id === data.event.id) ? evs.map((e) => (e.id === data.event.id ? { ...e, ...data.event } : e)) : [{ ...data.event, summary: data.summary }, ...(evs || [])];
              return list.sort((x, y) => String(y.start_at).localeCompare(String(x.start_at)));
            });
            setEventId(data.event.id);
            setSummary(data.summary);
          }}
          onDeleted={(ev) => {
            setEditor(null);
            setEvents((evs) => (evs || []).filter((e) => e.id !== ev.id));
            setEventId((cur) => (cur === ev.id ? null : cur));
            setSummary(null);
          }} />
      )}
      {walkIn && event && <WalkInSheet event={event} onClose={() => setWalkIn(false)} onAdded={(data) => { setWalkIn(false); applyResult(data); loadRegs(eventId, q.trim(), statusFilter); }} />}
    </div>
  );
}
