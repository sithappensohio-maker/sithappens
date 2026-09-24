import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { bookingFailure } from "../lib/bookingBlocks";
import BookingBlockNotice from "../components/BookingBlockNotice";
import PublicSiteShell from "./PublicSiteShell";
import { Section, Title, Eyebrow, Cta } from "./PublicBits";

/**
 * A Photo Special's public page — a real mini-session landing page, not an
 * internal booking form bolted onto the website.
 *
 * The whole page is driven by one Photo Special record, so Christmas and
 * Valentine's are new rows in Admin rather than another build. It knows three
 * states that matter commercially — open, sold out, and booking closed — and
 * says so plainly instead of showing an empty grid.
 *
 * The flow is deliberately four small steps rather than one long form: pick a
 * date, pick a time, tell us about you and the dog, check it over. Someone
 * booking a fifteen-minute portrait on a phone should never be scrolling
 * through fields they have not reached yet.
 */
const STEPS = ["date", "time", "details", "review"];

function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function fmtDayShort(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
// What's still missing before "Review booking" can be pressed. The button
// used to just go faint, with nothing saying which field it was waiting on.
function detailsProblem(form) {
  const missing = [];
  if (!form.first_name.trim()) missing.push("your first name");
  if (!form.phone.trim()) missing.push("a mobile number");
  if (!form.email.trim()) missing.push("an email address");
  if (!form.dog_name.trim()) missing.push("your dog's name");
  if (missing.length) return `Please add ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")} to continue.`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "That email address doesn't look right — please check it.";
  if (form.phone.replace(/\D/g, "").length < 7) return "That mobile number looks too short — please check it.";
  return "";
}

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export default function PublicPhotoSpecial() {
  const { slug } = useParams();
  const [special, setSpecial] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [step, setStep] = useState("date");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsFailed, setSlotsFailed] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "", dog_name: "", breed: "", dog_notes: "" });
  const [busy, setBusy] = useState(false);
  // Why the last attempt failed: { message, block, where } — `where` is the
  // step the customer was sent back to, so the reason shows up right there
  // instead of on a step that has just disappeared.
  const [err, setErr] = useState(null);
  const [confirmed, setConfirmed] = useState(null);
  // A six-week promotion has dozens of dates. Showing all of them as buttons
  // is unusable on a phone, so the nearest fortnight is offered up front and
  // the rest are one tap away.
  const [allDates, setAllDates] = useState(false);
  // One key per visit, so a double tap or a browser retry returns the booking
  // they already made instead of taking a second slot.
  const [idemKey] = useState(() => `ps-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

  useEffect(() => {
    let cancelled = false;
    api.get(`/public/photo-specials/${slug}`)
      .then(({ data }) => { if (!cancelled) { setSpecial(data); setDay((data.dates || [])[0] || ""); } })
      .catch((e) => {
        if (cancelled) return;
        setLoadErr(e?.response?.status === 404
          ? "We couldn't find this photo session. It may have ended, or the link may be wrong — check our website for current sessions."
          : bookingFailure(e, "This session couldn't be loaded. Please refresh the page.").message);
      });
    return () => { cancelled = true; };
  }, [slug]);

  const loadSlots = useCallback(async (forDay) => {
    if (!forDay) return;
    setSlotsLoading(true);
    setSlotsFailed(false);
    try {
      const { data } = await api.get(`/public/photo-specials/${slug}/availability`, { params: { date: forDay } });
      setSlots(data);
    } catch {
      // A failed load is not "closed" — say it failed and offer a retry.
      setSlots(null);
      setSlotsFailed(true);
    } finally {
      setSlotsLoading(false);
    }
  }, [slug]);

  useEffect(() => { if (day) loadSlots(day); }, [day, loadSlots]);

  const open = special?.booking_open;
  const free = useMemo(() => (slots?.slots || []).filter((s) => s.available), [slots]);
  const soldOut = open && slots && !slots.closed && (slots.slots || []).length > 0 && free.length === 0;
  const detailsHint = detailsProblem(form);
  const detailsReady = !detailsHint;
  const dates = useMemo(() => special?.dates || [], [special]);
  const DATE_PREVIEW = 14;
  const visibleDates = allDates ? dates : dates.slice(0, DATE_PREVIEW);
  const hiddenDateCount = Math.max(dates.length - visibleDates.length, 0);

  const reserve = async () => {
    setBusy(true); setErr(null);
    try {
      const { data } = await api.post(`/public/photo-specials/${slug}/reserve`, {
        date: day, time, ...form, idempotency_key: idemKey,
      });
      setConfirmed(data.reservation);
    } catch (e) {
      const f = bookingFailure(e, "We couldn't reserve that time. Please try again.");
      const action = f.block?.action;
      if (action === "pick_time") {
        // Somebody took it while the form was open — back to a fresh grid,
        // with the reason shown there. Their details are kept.
        setErr({ ...f, where: "time" }); setStep("time"); setTime(""); loadSlots(day);
      } else if (action === "pick_date") {
        setErr({ ...f, where: "date" }); setStep("date"); setTime("");
      } else {
        setErr({ ...f, where: "review" });
      }
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full min-h-[48px] bg-bgHeader/60 border border-bgHover rounded-xl px-3.5 text-white text-[15px] focus:outline-none focus:border-shGreen";
  const label = "block text-[11px] font-black uppercase tracking-widest text-white/60 mb-1.5";

  if (loadErr) {
    return (
      <PublicSiteShell testid="public-photo-special">
        <Section testid="photo-special-missing">
          <Title>Session not found</Title>
          <p className="text-white/70 mt-3">{loadErr}</p>
          <div className="mt-6"><Cta to="/" color="ghost">Back to the website</Cta></div>
        </Section>
      </PublicSiteShell>
    );
  }
  if (!special) {
    return (
      <PublicSiteShell testid="public-photo-special">
        <Section><p className="text-white/60" data-testid="photo-special-loading">Loading…</p></Section>
      </PublicSiteShell>
    );
  }

  // ---------------------------------------------------------------- confirmed
  if (confirmed) {
    return (
      <PublicSiteShell testid="public-photo-special">
        <Section testid="photo-special-confirmed">
          <Eyebrow icon="fa-circle-check">You're booked</Eyebrow>
          <Title>{special.name} booked</Title>
          {/* The date and time are the loudest thing on this screen on purpose —
              it is the only part anyone needs to remember. */}
          <div className="mt-6 rounded-3xl border-2 border-shGreen/70 bg-shGreen/[0.08] p-6 sm:p-8 text-center"
               data-testid="photo-special-when">
            <p className="text-[12px] font-black uppercase tracking-[0.2em] text-shGreen">{confirmed.dog_name}</p>
            <p className="text-[30px] sm:text-[44px] font-black text-white leading-tight mt-1">{fmtTime(confirmed.time)}</p>
            <p className="text-[17px] sm:text-[22px] font-black text-white/90">{fmtDay(confirmed.date)}</p>
            <p className="text-[13px] text-white/60 mt-2">{special.slot_minutes} minute session</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 mt-6">
            <div className="rounded-2xl border border-bgHover bg-bgPanel/40 p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-white/50">Where</p>
              <p className="text-white font-black mt-1">{special.location_name || "Sit Happens"}</p>
              {special.location_address && <p className="text-white/70 text-[14px]">{special.location_address}</p>}
            </div>
            <div className="rounded-2xl border border-bgHover bg-bgPanel/40 p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-white/50">Paying</p>
              <p className="text-white font-black mt-1">Pay at your session</p>
              <p className="text-white/70 text-[14px]">Nothing is charged now. You choose your package after the photos.</p>
            </div>
          </div>

          {(special.arrival_notes || special.cancellation_notes) && (
            <div className="mt-6 space-y-3">
              {special.arrival_notes && (
                <div className="rounded-2xl border border-bgHover bg-bgPanel/40 p-4" data-testid="photo-special-arrival">
                  <p className="text-[11px] font-black uppercase tracking-widest text-white/50">Arriving</p>
                  <p className="text-white/80 text-[14.5px] mt-1 leading-relaxed">{special.arrival_notes}</p>
                </div>
              )}
              {special.cancellation_notes && (
                <div className="rounded-2xl border border-bgHover bg-bgPanel/40 p-4" data-testid="photo-special-cancellation">
                  <p className="text-[11px] font-black uppercase tracking-widest text-white/50">Need to change it?</p>
                  <p className="text-white/80 text-[14.5px] mt-1 leading-relaxed">{special.cancellation_notes}</p>
                </div>
              )}
            </div>
          )}
          <div className="mt-8"><Cta to="/" color="ghost">Back to the website</Cta></div>
        </Section>
      </PublicSiteShell>
    );
  }

  // ------------------------------------------------------------------ booking
  return (
    <PublicSiteShell testid="public-photo-special">
      {/* Hero */}
      <Section testid="photo-special-hero">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <Eyebrow icon="fa-camera-retro">{special.headline || "Portrait session"}</Eyebrow>
            <Title as="h1" className="mt-1">{special.name}</Title>
            {special.description && (
              <p className="text-white/75 text-[16px] leading-relaxed mt-4">{special.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mt-5" data-testid="photo-special-facts">
              {/* A handful of dates reads as dates; a six-week run reads as a
                  range. Same data, described the way a person would say it. */}
              {(special.dates || []).length > 3 ? (
                <span className="rounded-full border border-shGreen/50 bg-shGreen/10 px-3 py-1.5 text-[12.5px] font-black text-shGreen"
                      data-testid="photo-special-date-range">
                  {fmtDayShort(special.dates[0])} – {fmtDayShort(special.dates[special.dates.length - 1])}
                </span>
              ) : (special.dates || []).map((d) => (
                <span key={d} className="rounded-full border border-shGreen/50 bg-shGreen/10 px-3 py-1.5 text-[12.5px] font-black text-shGreen">
                  {fmtDayShort(d)}
                </span>
              ))}
              <span className="rounded-full border border-bgHover px-3 py-1.5 text-[12.5px] font-black text-white/80">
                {special.slot_minutes} min per dog
              </span>
              {special.location_name && (
                <span className="rounded-full border border-bgHover px-3 py-1.5 text-[12.5px] font-black text-white/80">
                  {special.location_name}
                </span>
              )}
            </div>
          </div>
          {special.has_hero_image && (
            /* The flyer sets its own shape. A tall portrait poster is as
               likely as a wide banner, so the height is capped and the width
               follows the picture — the frame hugs the image instead of
               cropping a phone number off the bottom of it. */
            <img src={`${api.defaults.baseURL}/public/photo-specials/${slug}/hero`} alt=""
                 className="mx-auto w-auto max-w-full max-h-[min(70vh,560px)] rounded-3xl border border-bgHover object-contain"
                 data-testid="photo-special-hero-image"/>
          )}
        </div>
      </Section>

      {/* Booking */}
      <Section tone="panel" testid="photo-special-booking">
        <Eyebrow icon="fa-calendar-check">Book your session</Eyebrow>
        <Title>Pick your time</Title>

        {open && dates.length === 0 ? (
          /* A promotion that has run its course still has a page. Say so,
             rather than showing a grid with nothing in it. */
          <div className="mt-5 rounded-2xl border border-shOrange/50 bg-shOrange/10 p-5" data-testid="photo-special-finished">
            <p className="text-shOrange font-black uppercase tracking-widest text-[12px]">No dates left</p>
            <p className="text-white/80 mt-1.5">There are no more sessions available on this one. Give us a call and we&apos;ll let you know when we run it again.</p>
          </div>
        ) : !open ? (
          <div className="mt-5 rounded-2xl border border-shOrange/50 bg-shOrange/10 p-5" data-testid="photo-special-closed">
            <p className="text-shOrange font-black uppercase tracking-widest text-[12px]">Booking closed</p>
            <p className="text-white/80 mt-1.5">Booking for this session is closed. Give us a call and we&apos;ll see what we can do.</p>
          </div>
        ) : (
          <>
            {/* Step 1 — date */}
            <div className="mt-5" data-testid="photo-special-step-date">
              <p className={label}>1 · Choose a date</p>
              {err?.where === "date" && <div className="mb-3"><BookingBlockNotice testid="photo-special-error" failure={err}/></div>}
              <div className="flex flex-wrap gap-2">
                {visibleDates.map((d) => (
                  <button key={d} type="button" data-testid={`photo-special-date-${d}`}
                          onClick={() => { setDay(d); setTime(""); setStep("time"); setErr(null); }}
                          className={`min-h-[52px] px-4 rounded-2xl border text-[14px] font-black transition ${
                            day === d ? "border-shGreen bg-shGreen/15 text-shGreen" : "border-bgHover text-white/80 hover:border-shGreen/50"}`}>
                    {fmtDayShort(d)}
                  </button>
                ))}
                {hiddenDateCount > 0 && (
                  <button type="button" onClick={() => setAllDates(true)} data-testid="photo-special-more-dates"
                          className="min-h-[52px] px-4 rounded-2xl border border-dashed border-bgHover text-[13.5px] font-black text-white/70 hover:border-shGreen/50">
                    +{hiddenDateCount} more {hiddenDateCount === 1 ? "date" : "dates"}
                  </button>
                )}
              </div>
            </div>

            {/* Step 2 — time */}
            {day && (
              <div className="mt-6" data-testid="photo-special-step-time">
                <p className={label}>2 · Choose a time</p>
                {err?.where === "time" && <div className="mb-3"><BookingBlockNotice testid="photo-special-error" failure={err}/></div>}
                {slotsLoading ? (
                  <p className="text-white/60 text-[14px]">Checking what&apos;s free…</p>
                ) : slotsFailed ? (
                  <div className="rounded-2xl border border-shOrange/50 bg-shOrange/10 p-5" data-testid="photo-special-slots-failed">
                    <p className="text-white/80">We couldn&apos;t load the times for {fmtDay(day)}. Check your connection and try again.</p>
                    <button type="button" onClick={() => loadSlots(day)} data-testid="photo-special-slots-retry"
                            className="mt-3 min-h-[44px] px-4 rounded-xl border border-shOrange/60 text-shOrange font-black text-[13px] uppercase tracking-widest">
                      Try again
                    </button>
                  </div>
                ) : slots?.closed ? (
                  <div className="rounded-2xl border border-shOrange/50 bg-shOrange/10 p-5" data-testid="photo-special-day-closed">
                    <p className="text-white/80">There are no times on {fmtDay(day)}. Please choose another date above.</p>
                  </div>
                ) : soldOut ? (
                  <div className="rounded-2xl border border-shOrange/50 bg-shOrange/10 p-5" data-testid="photo-special-sold-out">
                    <p className="text-shOrange font-black uppercase tracking-widest text-[12px]">Fully booked</p>
                    <p className="text-white/80 mt-1.5">Every time on {fmtDay(day)} has gone. Try another date above.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2" data-testid="photo-special-slots">
                    {(slots?.slots || []).map((s) => (
                      <button key={s.time} type="button" disabled={!s.available}
                              data-testid={`photo-special-slot-${s.time}`}
                              onClick={() => { setTime(s.time); setStep("details"); setErr(null); }}
                              className={`min-h-[52px] rounded-2xl border text-[14px] font-black transition ${
                                time === s.time ? "border-shGreen bg-shGreen/20 text-shGreen"
                                : s.available ? "border-bgHover text-white hover:border-shGreen/60"
                                : "border-bgHover/40 text-white/25 line-through cursor-not-allowed"}`}>
                        {fmtTime(s.time)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 3 — details */}
            {time && (
              <div className="mt-7" data-testid="photo-special-step-details">
                <p className={label}>3 · Who&apos;s coming?</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor="ps-first">First name *</label>
                    <input id="ps-first" className={field} value={form.first_name} data-testid="photo-special-first-name"
                           onChange={(e) => setForm({ ...form, first_name: e.target.value })}/>
                  </div>
                  <div>
                    <label className={label} htmlFor="ps-last">Last name</label>
                    <input id="ps-last" className={field} value={form.last_name} data-testid="photo-special-last-name"
                           onChange={(e) => setForm({ ...form, last_name: e.target.value })}/>
                  </div>
                  <div>
                    <label className={label} htmlFor="ps-phone">Mobile *</label>
                    <input id="ps-phone" inputMode="tel" className={field} value={form.phone} data-testid="photo-special-phone"
                           onChange={(e) => setForm({ ...form, phone: e.target.value })}/>
                  </div>
                  <div>
                    <label className={label} htmlFor="ps-email">Email *</label>
                    <input id="ps-email" inputMode="email" className={field} value={form.email} data-testid="photo-special-email"
                           onChange={(e) => setForm({ ...form, email: e.target.value })}/>
                  </div>
                  <div>
                    <label className={label} htmlFor="ps-dog">Dog&apos;s name *</label>
                    <input id="ps-dog" className={field} value={form.dog_name} data-testid="photo-special-dog-name"
                           onChange={(e) => setForm({ ...form, dog_name: e.target.value })}/>
                  </div>
                  <div>
                    <label className={label} htmlFor="ps-breed">Breed</label>
                    <input id="ps-breed" className={field} value={form.breed} data-testid="photo-special-breed"
                           onChange={(e) => setForm({ ...form, breed: e.target.value })}/>
                  </div>
                </div>
                <div className="mt-3">
                  <label className={label} htmlFor="ps-notes">Anything we should know about your dog before the session?</label>
                  <input id="ps-notes" className={field} data-testid="photo-special-dog-notes"
                         placeholder="Nervous around strangers, needs extra space, very food motivated…"
                         value={form.dog_notes} onChange={(e) => setForm({ ...form, dog_notes: e.target.value })}/>
                </div>
                <p className="text-[13px] text-white/50 mt-2">One dog per appointment — book another time for a second dog.</p>
                {detailsHint && (
                  <p className="text-[14px] text-shOrange font-bold mt-3" data-testid="photo-special-details-hint">
                    <i className="fas fa-circle-info mr-1.5"/>{detailsHint}
                  </p>
                )}
                <div className="mt-4">
                  <Cta onClick={() => setStep("review")} testid="photo-special-to-review"
                       className={detailsReady ? "" : "opacity-40 pointer-events-none"}>
                    Review booking
                  </Cta>
                </div>
              </div>
            )}

            {/* Step 4 — review */}
            {step === "review" && detailsReady && (
              <div className="mt-7 rounded-3xl border border-shGreen/50 bg-shGreen/[0.06] p-5" data-testid="photo-special-step-review">
                <p className={label}>4 · Check it over</p>
                <p className="text-[24px] font-black text-white leading-tight">{fmtTime(time)}</p>
                <p className="text-[16px] font-black text-white/85">{fmtDay(day)}</p>
                <p className="text-white/70 text-[14.5px] mt-2">
                  {form.dog_name}{form.breed ? ` (${form.breed})` : ""} · {form.first_name} {form.last_name}
                </p>
                <p className="text-white/60 text-[13.5px]">{form.email} · {form.phone}</p>
                <p className="text-white/70 text-[14px] mt-3">
                  <i className="fas fa-wallet mr-1.5 text-shGreen"/>Nothing to pay now — you&apos;ll pay at your session.
                </p>
                {err?.where === "review" && <div className="mt-3"><BookingBlockNotice testid="photo-special-error" failure={err}/></div>}
                <div className="flex flex-wrap gap-2 mt-4">
                  <Cta onClick={reserve} testid="photo-special-reserve" className={busy ? "opacity-60 pointer-events-none" : ""}>
                    {busy ? "Reserving…" : "Reserve my appointment"}
                  </Cta>
                  <Cta color="ghost" onClick={() => setStep("details")} testid="photo-special-back">Change details</Cta>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* What to expect + packages */}
      {((special.what_to_expect || []).length > 0 || special.packages_blurb || (special.packages || []).length > 0) && (
        <Section testid="photo-special-expect">
          <div className="grid gap-8 lg:grid-cols-2">
            {(special.what_to_expect || []).length > 0 && (
              <div>
                <Eyebrow icon="fa-paw">What to expect</Eyebrow>
                <ul className="mt-3 space-y-2">
                  {special.what_to_expect.map((item, i) => (
                    <li key={i} className="flex gap-2.5 text-white/80 text-[15px]">
                      <i className="fas fa-check text-shGreen mt-1"/><span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(special.packages_blurb || (special.packages || []).length > 0) && (
              <div>
                <Eyebrow icon="fa-images">Packages</Eyebrow>
                {special.packages_blurb && (
                  <p className="mt-3 text-white/80 text-[15px] leading-relaxed whitespace-pre-line"
                     data-testid="photo-special-packages">{special.packages_blurb}</p>
                )}
                {/* The same price list the desk rings up — typed once, in the editor. */}
                {(special.packages || []).length > 0 && (
                  <ul className="mt-3 divide-y divide-white/10 rounded-xl border border-white/10" data-testid="photo-special-price-list">
                    {special.packages.map((p, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <span className="min-w-0 text-white/85 text-[15px]">
                          {p.name}
                          {p.popular && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-shOrange">Popular</span>}
                        </span>
                        <span className="shrink-0 font-black text-white tabular-nums">${Number(p.price || 0).toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-white/50 text-[13.5px] mt-3">
                  You choose your package after the session — nothing is charged to book.
                </p>
              </div>
            )}
          </div>
        </Section>
      )}
    </PublicSiteShell>
  );
}
