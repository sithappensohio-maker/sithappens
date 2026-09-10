/* EventEditor — create or edit a public event: every word on the event page,
   the dates, the link name, the rules people must accept, the costume contest
   switch and whether it is published. Reused for every event after Trunk or
   Treat. Owner/manager only (edit_events). */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import { eventImageUrl } from "../public/publicEvents";

export const ICON_PRESETS = [
  ["fa-car-side", "Trunk / car"], ["fa-hat-wizard", "Costume"], ["fa-camera-retro", "Photo booth"], ["fa-bone", "Treat / trick"],
  ["fa-trophy", "Contest / prize"], ["fa-bag-shopping", "Shop"], ["fa-paw", "Dogs"], ["fa-music", "Music"], ["fa-utensils", "Food"],
  ["fa-gift", "Giveaway"], ["fa-graduation-cap", "Training"], ["fa-heart", "Community"], ["fa-star", "Special"],
];
export const COLOR_PRESETS = [["#8cc63f", "Green"], ["#f26522", "Orange"], ["#00a9e0", "Blue"]];

/** ISO (any zone) → the browser-local value a datetime-local input wants. */
export function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** datetime-local value (browser-local) → ISO with the browser's offset. */
export function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
export function slugify(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

const DEFAULT_RULES_ACK = "I understand that dogs must remain leashed, retractable leashes are not permitted, owners are responsible for their dogs, and Sit Happens staff may ask a dog to leave the busy event area if necessary for safety.";

export function formFromEvent(ev) {
  if (!ev) {
    return {
      name: "", slug: "", slugTouched: false, name_line_1: "", name_line_2: "", description: "",
      start_at: "", end_at: "", location_name: "Sit Happens Dog Training", location_address: "", admission: "free", capacity: "",
      registration_open: true, registration_closes_at: "", published: false, walk_ins_allowed: true,
      confirmation_prefix: "SH-EV", costume_contest: true, notify_on_registration: true,
      highlights: [], rules: ["Leashed dogs only.", "No retractable leashes.", "Owners are responsible for their dogs at all times."],
      rules_acknowledgment: DEFAULT_RULES_ACK, hero_image_url: "",
    };
  }
  return {
    name: ev.name || "", slug: ev.slug || "", slugTouched: true, name_line_1: ev.name_line_1 || "", name_line_2: ev.name_line_2 || "",
    description: ev.description || "", start_at: isoToLocalInput(ev.start_at), end_at: isoToLocalInput(ev.end_at),
    location_name: ev.location_name || "", location_address: ev.location_address || "", admission: ev.admission || "free",
    capacity: ev.capacity ? String(ev.capacity) : "", registration_open: ev.registration_open !== false,
    registration_closes_at: isoToLocalInput(ev.registration_closes_at), published: !!ev.published,
    walk_ins_allowed: ev.walk_ins_allowed !== false, confirmation_prefix: ev.confirmation_prefix || "SH-EV",
    notify_on_registration: ev.notify_on_registration !== false,
    costume_contest: (ev.features || {}).costume_contest !== false,
    highlights: (ev.highlights || []).map((h) => ({ icon: h.icon || "fa-paw", color: h.color || "#8cc63f", title: h.title || "", body: h.body || "" })),
    rules: [...(ev.rules || [])], rules_acknowledgment: ev.rules_acknowledgment || DEFAULT_RULES_ACK, hero_image_url: ev.hero_image_url || "",
  };
}

export function payloadFromForm(f) {
  return {
    name: f.name.trim(), slug: (f.slug || "").trim() || slugify(f.name),
    name_line_1: f.name_line_1.trim(), name_line_2: f.name_line_2.trim(), description: f.description.trim(),
    start_at: localInputToIso(f.start_at), end_at: localInputToIso(f.end_at),
    location_name: f.location_name.trim(), location_address: f.location_address.trim(), admission: f.admission.trim() || "free",
    capacity: f.capacity ? Number(f.capacity) : null,
    registration_open: !!f.registration_open, registration_closes_at: localInputToIso(f.registration_closes_at),
    published: !!f.published, walk_ins_allowed: !!f.walk_ins_allowed,
    confirmation_prefix: f.confirmation_prefix.trim().toUpperCase(), costume_contest: !!f.costume_contest,
    notify_on_registration: !!f.notify_on_registration,
    highlights: f.highlights.filter((h) => h.title.trim()).map((h) => ({ ...h, title: h.title.trim(), body: h.body.trim() })),
    rules: f.rules.map((r) => r.trim()).filter(Boolean),
    rules_acknowledgment: f.rules_acknowledgment.trim(), hero_image_url: f.hero_image_url.trim(),
  };
}

const inputCls = "w-full mt-1 bg-bgBase border border-bgHover rounded-xl px-3 py-3 text-white text-[16px] focus:border-shGreen outline-none";
const labelCls = "text-[11px] font-black text-shTextMuted uppercase tracking-widest";
const Field = ({ label, hint, children, testid }) => (
  <div data-testid={testid}>
    <p className={labelCls}>{label}{hint && <span className="normal-case font-normal text-shTextMuted/80 ml-1">{hint}</span>}</p>
    {children}
  </div>
);
const Toggle = ({ label, hint, value, onChange, testid }) => (
  <label className="flex items-start gap-3 min-h-[44px] bg-bgBase border border-bgHover rounded-xl px-3 py-2.5">
    <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 mt-0.5 accent-shGreen shrink-0" data-testid={testid} />
    <span><span className="block text-[14px] font-black text-white">{label}</span>{hint && <span className="block text-[12px] text-shTextMuted">{hint}</span>}</span>
  </label>
);

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

/** An uploadable event picture (`banner` behind the homepage banner, `flyer`
 *  on the event page): uploaded straight away (it needs a saved event), shown
 *  as a preview, replaceable, removable. */
function EventImageField({ kind, event, onChanged, emptyText, help, previewClass = "h-28 sm:h-36" }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef(null);
  if (!event) {
    return <p className="text-[13px] text-shTextMuted" data-testid={`event-editor-${kind}-later`}>Create the event first, then you can upload this picture here.</p>;
  }
  const url = eventImageUrl(event, kind);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr("");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setErr("Use a JPEG, PNG or WEBP picture."); return; }
    if (file.size > 5 * 1024 * 1024) { setErr("That picture is over 5 MB. Please shrink it first."); return; }
    setBusy(true);
    try {
      const data = await readAsDataUrl(file);
      const r = await api.post(`/admin/events/${event.id}/images/${kind}`, { data, filename: file.name });
      toast.success("Picture saved");
      onChanged(r.data);
    } catch (ex) { setErr(formatErr(ex.response?.data?.detail) || ex.message || "Couldn't upload the picture."); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    try { const r = await api.delete(`/admin/events/${event.id}/images/${kind}`); toast.success("Picture removed"); onChanged(r.data); }
    catch (ex) { setErr(formatErr(ex.response?.data?.detail) || "Couldn't remove the picture."); }
    setBusy(false);
  };
  return (
    <div className="space-y-2" data-testid={`event-editor-${kind}`}>
      <div className="rounded-xl border border-bgHover overflow-hidden bg-bgBase">
        {url
          ? <div className={`${previewClass} bg-contain bg-center bg-no-repeat`} style={{ backgroundImage: `url("${url}")` }} data-testid={`event-editor-${kind}-preview`} />
          : <div className="h-20 grid place-items-center text-[13px] text-shTextMuted px-3 text-center" data-testid={`event-editor-${kind}-empty`}>{emptyText}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" data-testid={`event-editor-${kind}-file`} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} data-testid={`event-editor-${kind}-upload`}
                className="min-h-[44px] px-4 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover disabled:opacity-50">
          <i className="fas fa-image mr-1.5" />{busy ? "Uploading…" : url ? "Replace picture" : "Upload picture"}
        </button>
        {url && <button type="button" onClick={remove} disabled={busy} data-testid={`event-editor-${kind}-remove`} className="min-h-[44px] px-4 rounded-xl bg-red-500/10 text-red-300 font-black text-[12px] uppercase tracking-widest border border-red-500/30 disabled:opacity-50">Remove</button>}
      </div>
      <p className="text-[12px] text-shTextMuted">{help}</p>
      {err && <p className="text-[13px] text-red-300 font-black" data-testid={`event-editor-${kind}-error`}>{err}</p>}
    </div>
  );
}

export default function EventEditor({ event, onClose, onSaved, onDeleted, onChanged = () => {} }) {
  const [f, setF] = useState(() => formFromEvent(event));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const isNew = !event;
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const setHighlight = (i, patch) => setF((p) => ({ ...p, highlights: p.highlights.map((h, j) => (j === i ? { ...h, ...patch } : h)) }));
  const setRule = (i, v) => setF((p) => ({ ...p, rules: p.rules.map((r, j) => (j === i ? v : r)) }));
  const slugChanged = !isNew && f.slug !== event.slug;
  const publicUrl = useMemo(() => `${window.location.origin}/events/${(f.slug || slugify(f.name)) || "…"}`, [f.slug, f.name]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.name.trim()) { setErr("Give the event a name."); return; }
    if (!f.start_at) { setErr("Set when the event starts."); return; }
    if (slugChanged && (event.registration_count || 0) > 0 && !window.confirm("Changing the link name breaks any QR code or link already shared for this event. Change it anyway?")) return;
    setBusy(true);
    try {
      const body = payloadFromForm(f);
      const { data } = isNew ? await api.post("/admin/events", body) : await api.put(`/admin/events/${event.id}`, body);
      toast.success(isNew ? "Event created" : "Event saved");
      onSaved(data);
    } catch (ex) {
      setErr(formatErr(ex.response?.data?.detail) || "Couldn't save the event.");
    }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${event.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try { await api.delete(`/admin/events/${event.id}`); toast.success("Event deleted"); onDeleted(event); }
    catch (ex) { setErr(formatErr(ex.response?.data?.detail) || "Couldn't delete the event."); }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" onClick={onClose} data-testid="event-editor">
      <form onSubmit={save} onClick={(e) => e.stopPropagation()}
            className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full max-w-2xl p-4 sm:p-6 shadow-2xl max-h-[calc(var(--app-height,100vh)_-_1rem)] overflow-y-auto sh-modal-surface space-y-5">
        <div className="flex justify-between items-start">
          <h3 className="text-lg font-black text-white uppercase italic tracking-tight pr-2"><i className="fas fa-pen-to-square text-shGreen mr-2" />{isNew ? "New event" : "Edit event"}</h3>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="event-editor-close" className="text-gray-400 hover:text-white text-xl min-w-[44px] min-h-[44px]"><i className="fas fa-times" /></button>
        </div>

        {/* Basics */}
        <div className="space-y-3">
          <Field label="Event name" hint="(used in emails, the admin list and the portal card)">
            <input required value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value, slug: p.slugTouched ? p.slug : slugify(e.target.value) }))} className={inputCls} data-testid="event-editor-name" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Title line 1" hint="(big, white)"><input value={f.name_line_1} onChange={(e) => set("name_line_1")(e.target.value)} className={inputCls} data-testid="event-editor-line1" placeholder={f.name} /></Field>
            <Field label="Title line 2" hint="(green)"><input value={f.name_line_2} onChange={(e) => set("name_line_2")(e.target.value)} className={inputCls} data-testid="event-editor-line2" placeholder="+ Dog Costume Contest" /></Field>
          </div>
          <Field label="Link name" hint="(the address on the flyer / QR code)">
            <input value={f.slug} onChange={(e) => setF((p) => ({ ...p, slug: e.target.value.toLowerCase(), slugTouched: true }))} className={`${inputCls} font-mono`} data-testid="event-editor-slug" pattern="[a-z0-9][a-z0-9\-]*" />
            <p className="text-[12px] text-shBlue mt-1 break-all" data-testid="event-editor-url">{publicUrl}</p>
            {slugChanged && <p className="text-[12px] text-shOrange font-black mt-1" data-testid="event-editor-slug-warning"><i className="fas fa-triangle-exclamation mr-1" />Changing this breaks any QR code or link already shared.</p>}
          </Field>
          <Field label="Description"><textarea rows={3} value={f.description} onChange={(e) => set("description")(e.target.value)} className={inputCls} data-testid="event-editor-description" /></Field>
          <Field label="Flyer" hint="(optional; shows on the event page in place of the logo card)">
            <div className="mt-1">
              <EventImageField kind="flyer" event={event} onChanged={onChanged} previewClass="h-40 sm:h-56"
                               emptyText="No flyer yet. The event page shows the logo card." help="JPEG, PNG or WEBP up to 5 MB. Portrait or square flyers look best." />
              <details className="mt-2">
                <summary className="text-[12px] font-black uppercase tracking-widest text-shTextMuted cursor-pointer">Or paste a picture link</summary>
                <input value={f.hero_image_url} onChange={(e) => set("hero_image_url")(e.target.value)} className={inputCls} data-testid="event-editor-hero" placeholder="https://…" />
                <p className="text-[12px] text-shTextMuted mt-1">Used only when no flyer is uploaded.</p>
              </details>
            </div>
          </Field>
          <Field label="Homepage banner background" hint="(optional picture behind the banner; text and button stay the same)">
            <div className="mt-1">
              <EventImageField kind="banner" event={event} onChanged={onChanged}
                               emptyText="No picture yet. The banner uses the brand colours." help="JPEG, PNG or WEBP up to 5 MB. Wide pictures work best (about 3:1). A dark wash goes over it so the words stay readable." />
            </div>
          </Field>
        </div>

        {/* When / where */}
        <div className="space-y-3">
          <p className="text-[13px] font-black uppercase italic tracking-tight text-white">When and where</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Starts"><input type="datetime-local" required value={f.start_at} onChange={(e) => set("start_at")(e.target.value)} className={inputCls} data-testid="event-editor-start" /></Field>
            <Field label="Ends"><input type="datetime-local" value={f.end_at} onChange={(e) => set("end_at")(e.target.value)} className={inputCls} data-testid="event-editor-end" /></Field>
            <Field label="Location name"><input value={f.location_name} onChange={(e) => set("location_name")(e.target.value)} className={inputCls} data-testid="event-editor-location" /></Field>
            <Field label="Address" hint="(optional)"><input value={f.location_address} onChange={(e) => set("location_address")(e.target.value)} className={inputCls} data-testid="event-editor-address" /></Field>
            <Field label="Admission" hint='("free" shows FREE ADMISSION)'><input value={f.admission} onChange={(e) => set("admission")(e.target.value)} className={inputCls} data-testid="event-editor-admission" /></Field>
            <Field label="Capacity" hint="(households, blank = unlimited)"><input type="number" min="0" inputMode="numeric" value={f.capacity} onChange={(e) => set("capacity")(e.target.value)} className={inputCls} data-testid="event-editor-capacity" /></Field>
          </div>
        </div>

        {/* Registration */}
        <div className="space-y-3">
          <p className="text-[13px] font-black uppercase italic tracking-tight text-white">Preregistration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Toggle label="Published" hint="Shown on the website, in the nav, on the homepage and in the client portal." value={f.published} onChange={set("published")} testid="event-editor-published" />
            <Toggle label="Preregistration open" hint="Off = the page shows details only." value={f.registration_open} onChange={set("registration_open")} testid="event-editor-open" />
            <Toggle label="Walk-ins welcome" hint="Staff can add people at the door." value={f.walk_ins_allowed} onChange={set("walk_ins_allowed")} testid="event-editor-walkins" />
            <Toggle label="Dog costume contest" hint="Adds the costume questions and contestant numbers." value={f.costume_contest} onChange={set("costume_contest")} testid="event-editor-costume" />
            <Toggle label="Email me each preregistration" hint="One email per household, to the business notification address. Walk-ins never send one." value={f.notify_on_registration} onChange={set("notify_on_registration")} testid="event-editor-notify" />
            <Field label="Preregistration closes" hint="(optional)"><input type="datetime-local" value={f.registration_closes_at} onChange={(e) => set("registration_closes_at")(e.target.value)} className={inputCls} data-testid="event-editor-closes" /></Field>
            <Field label="Confirmation prefix" hint="(e.g. SH-TOT → SH-TOT-0001)"><input value={f.confirmation_prefix} onChange={(e) => set("confirmation_prefix")(e.target.value.toUpperCase())} className={`${inputCls} font-mono uppercase`} data-testid="event-editor-prefix" maxLength={12} /></Field>
          </div>
        </div>

        {/* Highlights */}
        <div className="space-y-2" data-testid="event-editor-highlights">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-black uppercase italic tracking-tight text-white">What's happening <span className="text-shTextMuted font-normal normal-case not-italic">(the cards on the page)</span></p>
            <button type="button" onClick={() => setF((p) => ({ ...p, highlights: [...p.highlights, { icon: "fa-paw", color: COLOR_PRESETS[p.highlights.length % 3][0], title: "", body: "" }] }))} data-testid="event-editor-add-highlight"
                    className="min-h-[40px] px-3 rounded-lg bg-shSurfaceRaised text-shText font-black text-[11px] uppercase tracking-widest"><i className="fas fa-plus mr-1" />Add</button>
          </div>
          {f.highlights.length === 0 && <p className="text-[13px] text-shTextMuted">No cards yet. Add one for each activity.</p>}
          {f.highlights.map((h, i) => (
            <div key={i} className="bg-bgBase border border-bgHover rounded-xl p-3 space-y-2" data-testid={`event-editor-highlight-${i}`}>
              <div className="flex gap-2">
                <span className="w-11 h-11 rounded-lg grid place-items-center shrink-0 text-lg" style={{ backgroundColor: `${h.color}22`, color: h.color }}><i className={`fas ${h.icon}`} /></span>
                <input value={h.title} onChange={(e) => setHighlight(i, { title: e.target.value })} placeholder="Title, e.g. Photo Booth" className={inputCls.replace("mt-1 ", "")} data-testid={`event-editor-highlight-title-${i}`} />
                <button type="button" aria-label="Remove" onClick={() => setF((p) => ({ ...p, highlights: p.highlights.filter((_, j) => j !== i) }))} className="min-w-[44px] text-shTextMuted hover:text-red-300"><i className="fas fa-trash" /></button>
              </div>
              <input value={h.body} onChange={(e) => setHighlight(i, { body: e.target.value })} placeholder="One line about it (optional)" className={inputCls.replace("mt-1 ", "")} data-testid={`event-editor-highlight-body-${i}`} />
              <div className="flex flex-wrap gap-2 items-center">
                <select value={ICON_PRESETS.some(([k]) => k === h.icon) ? h.icon : "custom"} onChange={(e) => { if (e.target.value !== "custom") setHighlight(i, { icon: e.target.value }); }} className="bg-bgPanel border border-bgHover rounded-lg px-2 py-2 text-white text-[13px]" data-testid={`event-editor-highlight-icon-${i}`}>
                  {ICON_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  <option value="custom">Other…</option>
                </select>
                <input value={h.icon} onChange={(e) => setHighlight(i, { icon: e.target.value })} className="bg-bgPanel border border-bgHover rounded-lg px-2 py-2 text-white text-[13px] font-mono w-40" placeholder="fa-icon-name" aria-label="Font Awesome icon" />
                <div className="flex gap-1">
                  {COLOR_PRESETS.map(([c, l]) => <button key={c} type="button" title={l} aria-label={l} aria-pressed={h.color === c} onClick={() => setHighlight(i, { color: c })} className={`w-9 h-9 rounded-full border-2 ${h.color === c ? "border-white" : "border-transparent"}`} style={{ backgroundColor: c }} />)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Rules */}
        <div className="space-y-2" data-testid="event-editor-rules">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-black uppercase italic tracking-tight text-white">Good to know <span className="text-shTextMuted font-normal normal-case not-italic">(bullet list on the page)</span></p>
            <button type="button" onClick={() => setF((p) => ({ ...p, rules: [...p.rules, ""] }))} data-testid="event-editor-add-rule" className="min-h-[40px] px-3 rounded-lg bg-shSurfaceRaised text-shText font-black text-[11px] uppercase tracking-widest"><i className="fas fa-plus mr-1" />Add</button>
          </div>
          {f.rules.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input value={r} onChange={(e) => setRule(i, e.target.value)} className={inputCls.replace("mt-1 ", "")} data-testid={`event-editor-rule-${i}`} />
              <button type="button" aria-label="Remove" onClick={() => setF((p) => ({ ...p, rules: p.rules.filter((_, j) => j !== i) }))} className="min-w-[44px] text-shTextMuted hover:text-red-300"><i className="fas fa-trash" /></button>
            </div>
          ))}
          <Field label="What people must agree to" hint="(the required checkbox on the form)">
            <textarea rows={3} value={f.rules_acknowledgment} onChange={(e) => set("rules_acknowledgment")(e.target.value)} className={inputCls} data-testid="event-editor-ack" />
          </Field>
        </div>

        {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="event-editor-error">{err}</div>}
        <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
          {!isNew && (event.registration_count || 0) === 0 && (
            <button type="button" onClick={remove} disabled={busy} data-testid="event-editor-delete" className="min-h-[48px] px-4 rounded-xl bg-red-500/10 text-red-300 font-black text-[12px] uppercase tracking-widest border border-red-500/30 sm:mr-auto">Delete event</button>
          )}
          <button type="button" onClick={onClose} className="min-h-[48px] px-4 rounded-xl bg-shSurfaceRaised text-shText font-black text-[12px] uppercase tracking-widest border border-bgHover">Cancel</button>
          <button type="submit" disabled={busy} data-testid="event-editor-save" className="min-h-[48px] px-5 rounded-xl bg-shGreen text-bgHeader font-black text-[13px] uppercase tracking-widest disabled:opacity-50">{busy ? "Saving…" : isNew ? "Create event" : "Save event"}</button>
        </div>
      </form>
    </div>
  );
}
