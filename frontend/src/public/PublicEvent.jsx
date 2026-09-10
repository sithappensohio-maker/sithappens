import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import PublicSiteShell from "./PublicSiteShell";
import { Eyebrow, Title, Cta, ContactStrip } from "./PublicBits";
import { usePublicSite } from "./publicSite";
import { fmtEventWhen } from "./publicEvents";

/**
 * /events/<slug> — a public event page with free preregistration.
 * Works logged out (no account needed). A signed-in client gets their name,
 * email, phone and dogs prefilled and picks which dogs are coming; nothing
 * about them is duplicated. The URL is permanent and token-free so it can
 * live on a flyer as a QR code.
 */
const HEARD = [
  ["client", "I'm a Sit Happens client"],
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["local_business", "A local business"],
  ["friend", "Friend or family"],
  ["flyer", "Flyer or QR code"],
  ["other", "Other"],
];
const MAX_ADULTS = 20, MAX_CHILDREN = 20, MAX_DOGS = 10;

function newKey() {
  try { return crypto.randomUUID(); } catch { return `k-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

export { fmtEventWhen };

const inputCls = "w-full mt-1 bg-bgBase border border-bgHover rounded-xl px-3 py-3 text-white text-[16px] focus:border-shGreen outline-none";
const labelCls = "text-[12px] font-black text-gray-400 uppercase tracking-widest";

function Stepper({ label, value, onChange, min, max, testid }) {
  return (
    <div>
      <p className={labelCls}>{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <button type="button" aria-label={`Fewer ${label}`} onClick={() => onChange(Math.max(min, value - 1))} data-testid={`${testid}-minus`}
                className="w-12 h-12 rounded-xl bg-bgPanel border border-bgHover text-white text-xl font-black">−</button>
        <input type="number" inputMode="numeric" min={min} max={max} value={value} data-testid={testid}
               onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
               className="w-16 h-12 text-center bg-bgBase border border-bgHover rounded-xl text-white text-[18px] font-black" />
        <button type="button" aria-label={`More ${label}`} onClick={() => onChange(Math.min(max, value + 1))} data-testid={`${testid}-plus`}
                className="w-12 h-12 rounded-xl bg-bgPanel border border-bgHover text-white text-xl font-black">+</button>
      </div>
    </div>
  );
}

function YesNo({ label, value, onChange, testid }) {
  return (
    <div>
      <p className={labelCls}>{label}</p>
      <div className="mt-1 grid grid-cols-2 gap-2" data-testid={testid}>
        {[[true, "Yes"], [false, "No"]].map(([v, t]) => (
          <button key={t} type="button" onClick={() => onChange(v)} aria-pressed={value === v} data-testid={`${testid}-${t.toLowerCase()}`}
                  className={`min-h-[48px] rounded-xl text-[14px] font-black uppercase tracking-widest border ${value === v ? "bg-shGreen text-bgHeader border-shGreen" : "bg-bgBase border-bgHover text-gray-300"}`}>{t}</button>
        ))}
      </div>
    </div>
  );
}

const emptyDog = () => ({ name: "", dog_id: null, costume_entered: false, costume_theme: "", dog_and_human: false, costume_notes: "" });

export default function PublicEvent() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { site } = usePublicSite();
  const [ev, setEv] = useState(undefined);
  const [prefill, setPrefill] = useState(null);
  const [key] = useState(newKey);
  const [f, setF] = useState({ primary_contact: "", email: "", phone: "", adults: 1, children: 0, dogs: [emptyDog()], costume_contest: false, heard_from: "", heard_from_other: "", rules_acknowledged: false, marketing_consent: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(null);

  // "Not found" only when the server actually said so. A dead network or a
  // server hiccup (a QR scan on a weak signal) gets a retry, not "isn't here".
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setEv(undefined); setLoadFailed(false);
    api.get(`/public/events/${slug}`)
      .then((r) => { if (alive) setEv(r.data?.event || null); })
      .catch((e) => { if (!alive) return; if (e.response?.status === 404) setEv(null); else { setLoadFailed(true); setEv(null); } });
    return () => { alive = false; };
  }, [slug, attempt]);

  // Signed-in client: prefill from their profile and offer their dogs.
  useEffect(() => {
    if (!user || user.role !== "client") return undefined;
    let alive = true;
    api.get("/portal/events/prefill").then((r) => {
      if (!alive) return;
      const p = r.data || {};
      setPrefill(p);
      setF((prev) => ({ ...prev, primary_contact: prev.primary_contact || p.name || "", email: prev.email || p.email || "", phone: prev.phone || p.phone || "" }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [user]);

  // The form is long and the confirmation card is short: after submitting, the
  // page would otherwise sit where the bottom of the form was. Bring the
  // "You're registered" card to the top of the screen (the public shell scrolls
  // its own container, so window.scrollTo would do nothing).
  useEffect(() => {
    if (!done) return;
    try { document.getElementById("preregister")?.scrollIntoView({ block: "start" }); } catch { /* ignore */ }
  }, [done]);

  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));
  const setDogCount = (n) => setF((prev) => {
    const dogs = prev.dogs.slice(0, n);
    while (dogs.length < n) dogs.push(emptyDog());
    return { ...prev, dogs };
  });
  const setDog = (i, patch) => setF((prev) => ({ ...prev, dogs: prev.dogs.map((d, j) => (j === i ? { ...d, ...patch } : d)) }));
  const toggleExistingDog = (dog) => setF((prev) => {
    const has = prev.dogs.some((d) => d.dog_id === dog.id);
    let dogs = has ? prev.dogs.filter((d) => d.dog_id !== dog.id) : [...prev.dogs.filter((d) => d.dog_id || d.name.trim()), { ...emptyDog(), name: dog.name, dog_id: dog.id }];
    if (dogs.length === 0) dogs = [emptyDog()];
    return { ...prev, dogs: dogs.slice(0, MAX_DOGS) };
  });

  const when = useMemo(() => fmtEventWhen(ev), [ev]);
  const features = ev?.features || {};
  const contestOn = features.costume_contest !== false;
  const dogCount = f.dogs.length;

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!f.rules_acknowledged) { setErr("Please confirm you've read the event rules."); return; }
    if (!f.heard_from) { setErr("Tell us how you heard about the event."); return; }
    const dogs = f.dogs.filter((d) => d.name.trim() || d.dog_id);
    if (dogs.length !== dogCount) { setErr("Please give each dog a name."); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/public/events/${slug}/register`, {
        idempotency_key: key,
        primary_contact: f.primary_contact, email: f.email, phone: f.phone,
        adults: f.adults, children: f.children,
        dogs: dogs.map((d) => ({ name: d.name.trim(), dog_id: d.dog_id || null, costume_entered: !!(f.costume_contest && contestOn && d.costume_entered),
          costume_theme: d.costume_theme, dog_and_human: !!d.dog_and_human, costume_notes: d.costume_notes })),
        costume_contest: !!(f.costume_contest && contestOn),
        heard_from: f.heard_from, heard_from_other: f.heard_from_other,
        rules_acknowledged: true, marketing_consent: !!f.marketing_consent, website: f.website,
      });
      setDone(data.registration);
    } catch (ex) {
      setErr(formatErr(ex.response?.data?.detail) || "Couldn't register. Please try again.");
    }
    setBusy(false);
  };

  if (ev === undefined) {
    return <PublicSiteShell testid="public-event"><div className="max-w-3xl mx-auto px-4 py-16 text-gray-400">Loading…</div></PublicSiteShell>;
  }
  if (ev === null && loadFailed) {
    return (
      <PublicSiteShell testid="public-event">
        <div className="max-w-3xl mx-auto px-4 py-16" data-testid="event-load-failed">
          <Eyebrow icon="fa-wifi" color="text-shOrange">Event</Eyebrow>
          <Title as="h1">Couldn't load this event.</Title>
          <p className="text-gray-300 mt-3">Check your connection and try again.</p>
          <div className="mt-5"><Cta color="green" onClick={() => setAttempt((n) => n + 1)} icon="fa-rotate-right" testid="event-retry">Try again</Cta></div>
        </div>
      </PublicSiteShell>
    );
  }
  if (ev === null) {
    return (
      <PublicSiteShell testid="public-event">
        <div className="max-w-3xl mx-auto px-4 py-16" data-testid="event-not-found">
          <Eyebrow icon="fa-calendar-xmark">Event</Eyebrow>
          <Title as="h1">That event isn't here.</Title>
          <p className="text-gray-300 mt-3">It may have ended or the link is wrong. <Link to="/" className="text-shGreen font-black">Back to Sit Happens</Link>.</p>
        </div>
      </PublicSiteShell>
    );
  }

  const registrationOpen = ev.registration_open !== false && (!ev.registration_closes_at || new Date(ev.registration_closes_at) > new Date());
  const tel = (site?.phone || "").replace(/[^\d+]/g, "");

  return (
    <PublicSiteShell testid="public-event">
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden" data-testid="event-hero">
        <div className="absolute inset-0 pointer-events-none opacity-50" style={{ background: "radial-gradient(circle at 10% 10%, #f26522 0%, transparent 36%), radial-gradient(circle at 90% 80%, #8cc63f 0%, transparent 40%), radial-gradient(circle at 70% 5%, #00a9e0 0%, transparent 28%)" }} />
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 pt-8 pb-8 sm:pt-14 sm:pb-12 sh-splatter">
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_.9fr] gap-6 lg:gap-10 items-center">
            <div>
              <Eyebrow icon="fa-calendar-day" color="text-shOrange">{ev.admission === "free" ? "Free community event" : "Community event"}</Eyebrow>
              <h1 className="sh-display text-[34px] sm:text-5xl lg:text-6xl text-white leading-[0.95]" style={{ textWrap: "balance" }} data-testid="event-title">
                {ev.name_line_1 || ev.name}
                {ev.name_line_2 && <><br /><span className="text-shGreen">{ev.name_line_2}</span></>}
              </h1>
              <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-[15px]" data-testid="event-facts">
                <div><dt className={labelCls}>When</dt><dd className="text-white font-black text-[17px] mt-0.5" data-testid="event-when">{when.day}<br /><span className="text-gray-300 font-bold">{when.time}</span></dd></div>
                <div><dt className={labelCls}>Where</dt><dd className="text-white font-black text-[17px] mt-0.5" data-testid="event-where">{ev.location_name}{ev.location_address ? <><br /><span className="text-gray-300 font-bold">{ev.location_address}</span></> : null}</dd></div>
                <div><dt className={labelCls}>Admission</dt><dd className="text-shGreen font-black text-[17px] mt-0.5 uppercase tracking-wide" data-testid="event-admission">{ev.admission === "free" ? "Free admission" : ev.admission}</dd></div>
                {ev.walk_ins_allowed !== false && <div><dt className={labelCls}>Walk-ins</dt><dd className="text-white font-bold text-[15px] mt-0.5">Welcome. Preregistering saves time at the door.</dd></div>}
              </dl>
              {registrationOpen ? (
                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                  <Cta color="green" href="#preregister" icon="fa-paw" testid="event-hero-cta" className="min-h-[56px] text-[16px]">Preregister free</Cta>
                  {tel && <Cta color="ghost" href={`tel:${tel}`} icon="fa-phone" testid="event-hero-call">Questions? {site.phone}</Cta>}
                </div>
              ) : (
                <p className="mt-6 text-[14px] font-black uppercase tracking-widest text-shOrange" data-testid="event-registration-closed">Preregistration is closed{ev.walk_ins_allowed !== false ? ", but walk-ins are welcome on the day." : "."}</p>
              )}
            </div>
            <div className="sh-site-card overflow-hidden p-0" data-testid="event-flyer" style={{ "--card-accent": "#f26522" }}>
              {ev.hero_image_url
                ? <img src={ev.hero_image_url} alt={`${ev.name} flyer`} className="w-full h-auto object-cover" />
                : (
                  <div className="aspect-[4/5] sm:aspect-[4/3] lg:aspect-[4/5] flex flex-col items-center justify-center text-center p-6 bg-gradient-to-br from-shOrange/25 via-bgPanel to-shGreen/15">
                    <img src="/logo.png" alt="" className="w-40 sm:w-48 drop-shadow-[0_12px_30px_rgba(0,0,0,0.6)]" />
                    <p className="sh-display text-3xl sm:text-4xl text-white mt-4 leading-none">Trunk<span className="text-shOrange"> or </span>Treat</p>
                    <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen mt-2">Dog costume contest</p>
                    <p className="text-[12px] text-gray-400 mt-3">{when.day}</p>
                  </div>
                )}
            </div>
          </div>
        </div>
      </section>

      {/* ===== What's happening ===== */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10" data-testid="event-details">
        {ev.description && <p className="text-[16px] sm:text-[17px] text-gray-200 leading-relaxed max-w-3xl">{ev.description}</p>}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="event-features">
          {(ev.highlights || []).map((h) => (
            <div key={h.title} className="sh-site-card flex items-start gap-3" style={{ "--card-accent": h.color || "#8cc63f" }}>
              <span className="w-10 h-10 rounded-lg grid place-items-center shrink-0 text-lg" style={{ backgroundColor: `${h.color || "#8cc63f"}22`, color: h.color || "#8cc63f" }}><i className={`fas ${h.icon || "fa-paw"}`} /></span>
              <span><span className="block text-[15px] font-black uppercase italic tracking-tight text-white">{h.title}</span>{h.body && <span className="block text-[13px] text-gray-300 leading-relaxed mt-0.5">{h.body}</span>}</span>
            </div>
          ))}
        </div>
        {(ev.rules || []).length > 0 && (
          <div className="mt-6 sh-site-band" data-testid="event-rules">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shOrange mb-2"><i className="fas fa-shield-dog mr-1.5" />Good to know</p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[14px] text-gray-200">
              {ev.rules.map((r) => <li key={r}><i className="fas fa-check text-shGreen mr-2" />{r}</li>)}
            </ul>
          </div>
        )}
      </section>

      {/* ===== Registration ===== */}
      <section id="preregister" className="border-t border-bgHover/60 bg-bgPanel/30 scroll-mt-20" data-testid="event-register">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
          {done ? (
            <div className="sh-site-card sh-site-card--glow p-6 sm:p-8" style={{ "--card-accent": "#8cc63f" }} data-testid="event-confirmation">
              <Eyebrow icon="fa-circle-check">{done.duplicate ? "Already registered" : "You're registered!"}</Eyebrow>
              <Title as="h2">{done.duplicate ? "You were already on the list." : "You're registered!"}</Title>
              <p className="text-[16px] text-gray-200 mt-3">{ev.name}<br /><span className="text-gray-400">{when.day} · {when.time}</span></p>
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 bg-bgBase border border-bgHover rounded-xl p-3">
                  <p className={labelCls}>Confirmation</p>
                  <p className="text-3xl font-black text-shGreen tracking-wide whitespace-nowrap" data-testid="event-confirmation-number">{done.confirmation_number}</p>
                </div>
                <div className="bg-bgBase border border-bgHover rounded-xl p-3"><p className={labelCls}>People</p><p className="text-2xl font-black text-white" data-testid="event-confirmation-people">{done.adults + done.children}</p><p className="text-[11px] text-gray-500">{done.adults} adult{done.adults === 1 ? "" : "s"} · {done.children} child{done.children === 1 ? "" : "ren"}</p></div>
                <div className="bg-bgBase border border-bgHover rounded-xl p-3"><p className={labelCls}>Dogs</p><p className="text-2xl font-black text-white" data-testid="event-confirmation-dogs">{(done.dogs || []).length}</p><p className="text-[11px] text-gray-500 truncate">{(done.dogs || []).map((d) => d.name).join(", ")}</p></div>
              </div>
              <div className="mt-4 bg-bgBase border border-bgHover rounded-xl p-3" data-testid="event-confirmation-costume">
                <p className={labelCls}>Costume contest</p>
                {done.costume_contest && (done.dogs || []).some((d) => d.contestant_number) ? (
                  <ul className="mt-1 space-y-1">
                    {(done.dogs || []).filter((d) => d.contestant_number).map((d) => (
                      <li key={d.contestant_number} className="text-[15px] text-white font-bold"><span className="text-shOrange font-black">Contestant #{String(d.contestant_number).padStart(3, "0")}</span> · {d.name}{d.costume_theme ? <span className="text-gray-400 font-normal"> · {d.costume_theme}</span> : null}</li>
                    ))}
                  </ul>
                ) : <p className="text-[15px] text-gray-300 mt-1">Not entered. You can still enter at the door.</p>}
              </div>
              <p className="text-[14px] text-gray-400 mt-4">
                {done.email_sent ? `We emailed a copy to ${done.email}. ` : ""}No ticket needed. Just give your name or confirmation number at the check-in table.
              </p>
              <div className="mt-5 flex flex-col sm:flex-row gap-3">
                <Cta color="ghost" to="/" icon="fa-house" testid="event-confirmation-home">Back to Sit Happens</Cta>
                {tel && <Cta color="ghost" href={`tel:${tel}`} icon="fa-phone">Call {site.phone}</Cta>}
              </div>
            </div>
          ) : !registrationOpen ? (
            <div className="sh-site-card" data-testid="event-register-closed">
              <Title as="h2">Preregistration has closed.</Title>
              <p className="text-gray-300 mt-2">{ev.walk_ins_allowed !== false ? "Come on by. Walk-ins are welcome on the day." : "Thanks for your interest."}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-6" data-testid="event-form">
              <div>
                <Eyebrow icon="fa-pen-to-square">Preregister free</Eyebrow>
                <Title as="h2">Tell us who's coming.</Title>
                <p className="text-[15px] text-gray-300 mt-2">Two minutes, no account needed. {user?.role === "client" ? "We've filled in what we already know." : "Already a client? "}{user?.role !== "client" && <Link to="/login" className="text-shGreen font-black">Sign in</Link>}{user?.role !== "client" && " to prefill your details."}</p>
              </div>

              <div className="sh-site-card space-y-4" data-testid="event-form-contact">
                <div><label className={labelCls} htmlFor="ev-name">Your name</label><input id="ev-name" required value={f.primary_contact} onChange={(e) => set("primary_contact")(e.target.value)} className={inputCls} autoComplete="name" data-testid="ev-name" /></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelCls} htmlFor="ev-email">Email</label><input id="ev-email" type="email" required value={f.email} onChange={(e) => set("email")(e.target.value)} className={inputCls} autoComplete="email" data-testid="ev-email" /></div>
                  <div><label className={labelCls} htmlFor="ev-phone">Phone</label><input id="ev-phone" type="tel" required value={f.phone} onChange={(e) => set("phone")(e.target.value)} className={inputCls} autoComplete="tel" data-testid="ev-phone" /></div>
                </div>
              </div>

              <div className="sh-site-card space-y-4" data-testid="event-form-party">
                <p className="text-[15px] font-black uppercase italic tracking-tight text-white">Who's coming</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Stepper label="Adults" value={f.adults} onChange={set("adults")} min={1} max={MAX_ADULTS} testid="ev-adults" />
                  <Stepper label="Children" value={f.children} onChange={set("children")} min={0} max={MAX_CHILDREN} testid="ev-children" />
                  <Stepper label="Dogs" value={dogCount} onChange={setDogCount} min={0} max={MAX_DOGS} testid="ev-dogs" />
                </div>
                {prefill?.dogs?.length > 0 && (
                  <div data-testid="ev-existing-dogs">
                    <p className={labelCls}>Your dogs (tap to add)</p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {prefill.dogs.map((d) => {
                        const on = f.dogs.some((x) => x.dog_id === d.id);
                        return <button key={d.id} type="button" onClick={() => toggleExistingDog(d)} aria-pressed={on} data-testid={`ev-existing-dog-${d.id}`}
                                       className={`min-h-[44px] px-3 rounded-full text-[13px] font-black uppercase tracking-wide border ${on ? "bg-shGreen text-bgHeader border-shGreen" : "bg-bgBase border-bgHover text-gray-200"}`}><i className="fas fa-paw mr-1.5" />{d.name}</button>;
                      })}
                    </div>
                  </div>
                )}
                {f.dogs.map((d, i) => (
                  <div key={i}>
                    <label className={labelCls} htmlFor={`ev-dog-${i}`}>Dog {i + 1} name</label>
                    <input id={`ev-dog-${i}`} required value={d.name} onChange={(e) => setDog(i, { name: e.target.value, dog_id: null })} className={inputCls} data-testid={`ev-dog-${i}`} placeholder="e.g. Waffles" />
                  </div>
                ))}
              </div>

              {contestOn && dogCount > 0 && (
                <div className="sh-site-card space-y-4" style={{ "--card-accent": "#f26522" }} data-testid="event-form-costume">
                  <YesNo label="Entering the dog costume contest?" value={f.costume_contest} onChange={(v) => { set("costume_contest")(v); if (v) setF((prev) => ({ ...prev, dogs: prev.dogs.map((d) => ({ ...d, costume_entered: prev.dogs.length === 1 ? true : d.costume_entered })) })); }} testid="ev-costume" />
                  {f.costume_contest && (
                    <div className="space-y-4" data-testid="ev-costume-details">
                      <p className="text-[13px] text-gray-400">Judging categories are decided on the day. Just tell us who's dressing up.</p>
                      {f.dogs.map((d, i) => (
                        <div key={i} className="rounded-xl border border-bgHover bg-bgBase p-3 space-y-3" data-testid={`ev-costume-dog-${i}`}>
                          <label className="flex items-center gap-3 min-h-[44px]">
                            <input type="checkbox" checked={!!d.costume_entered} onChange={(e) => setDog(i, { costume_entered: e.target.checked })} className="w-5 h-5 accent-shOrange" data-testid={`ev-costume-enter-${i}`} />
                            <span className="text-[15px] font-black text-white">{d.name || `Dog ${i + 1}`} is competing</span>
                          </label>
                          {d.costume_entered && (
                            <>
                              <div><label className={labelCls} htmlFor={`ev-theme-${i}`}>Costume or theme <span className="normal-case font-normal text-gray-500">(optional)</span></label><input id={`ev-theme-${i}`} value={d.costume_theme} onChange={(e) => setDog(i, { costume_theme: e.target.value })} className={inputCls} data-testid={`ev-costume-theme-${i}`} placeholder="e.g. Hot dog, pirate, dinosaur" /></div>
                              <YesNo label="Dog + human costume?" value={!!d.dog_and_human} onChange={(v) => setDog(i, { dog_and_human: v })} testid={`ev-costume-human-${i}`} />
                              <div><label className={labelCls} htmlFor={`ev-notes-${i}`}>Notes <span className="normal-case font-normal text-gray-500">(optional)</span></label><input id={`ev-notes-${i}`} value={d.costume_notes} onChange={(e) => setDog(i, { costume_notes: e.target.value })} className={inputCls} data-testid={`ev-costume-notes-${i}`} /></div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="sh-site-card space-y-4" data-testid="event-form-heard">
                <p className={labelCls}>How did you hear about this event?</p>
                <div className="flex flex-wrap gap-2" data-testid="ev-heard">
                  {HEARD.map(([k, label]) => (
                    <button key={k} type="button" onClick={() => set("heard_from")(k)} aria-pressed={f.heard_from === k} data-testid={`ev-heard-${k}`}
                            className={`min-h-[44px] px-3 rounded-full text-[13px] font-black uppercase tracking-wide border ${f.heard_from === k ? "bg-shBlue text-white border-shBlue" : "bg-bgBase border-bgHover text-gray-200"}`}>{label}</button>
                  ))}
                </div>
                {f.heard_from === "other" && <input value={f.heard_from_other} onChange={(e) => set("heard_from_other")(e.target.value)} className={inputCls} placeholder="Where?" data-testid="ev-heard-other" />}
              </div>

              <div className="sh-site-card space-y-3" data-testid="event-form-consent">
                <label className="flex items-start gap-3 min-h-[44px]">
                  <input type="checkbox" checked={f.rules_acknowledged} onChange={(e) => set("rules_acknowledged")(e.target.checked)} className="w-5 h-5 mt-0.5 accent-shGreen shrink-0" data-testid="ev-rules" required />
                  <span className="text-[14px] text-gray-200 leading-relaxed">{ev.rules_acknowledgment || "I understand that dogs must remain leashed, retractable leashes are not permitted, owners are responsible for their dogs, and Sit Happens staff may ask a dog to leave the busy event area if necessary for safety."}</span>
                </label>
                <label className="flex items-start gap-3 min-h-[44px] border-t border-bgHover pt-3">
                  <input type="checkbox" checked={f.marketing_consent} onChange={(e) => set("marketing_consent")(e.target.checked)} className="w-5 h-5 mt-0.5 accent-shBlue shrink-0" data-testid="ev-marketing" />
                  <span className="text-[14px] text-gray-300 leading-relaxed">I'd like to hear about future Sit Happens events, training programs and specials. <span className="text-gray-500">(Optional)</span></span>
                </label>
              </div>

              {/* Honeypot: hidden from people, filled by bots. */}
              <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
                <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set("website")(e.target.value)} data-testid="ev-website" /></label>
              </div>

              {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded-xl p-3 font-black" data-testid="event-form-error">{err}</div>}
              <button type="submit" disabled={busy} data-testid="event-submit"
                      className="w-full min-h-[60px] rounded-full bg-shGreen text-bgHeader font-black text-[16px] uppercase tracking-widest shadow-lg disabled:opacity-50">
                {busy ? "Registering…" : "Preregister free"}
              </button>
              <p className="text-[12px] text-gray-500 text-center">Free. No ticket. Walk-ins welcome too.</p>
            </form>
          )}
        </div>
      </section>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-10"><ContactStrip site={site} testid="event-contact-strip" /></div>
    </PublicSiteShell>
  );
}
