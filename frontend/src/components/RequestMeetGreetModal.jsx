import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatSlotTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Public "Request a Meet & Greet" form — no account required. Collects
 * owner + dog basics plus a real open slot (checked against the admin's
 * actual schedule via /public/meet-greet-slots) and posts to the public
 * /public/meet-greet-request endpoint, which creates (or merges into) a
 * prospect client record, books the slot, and emails a portal-setup link.
 */
export default function RequestMeetGreetModal({ open, onClose }) {
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dogName, setDogName] = useState("");
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState("");
  const [slotInfo, setSlotInfo] = useState(null); // { enabled, closed, slot_minutes, slots }
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open || !date) return;
    let alive = true;
    setSlotsLoading(true);
    setTime("");
    api.get("/public/meet-greet-slots", { params: { date_str: date } })
      .then((r) => { if (alive) setSlotInfo(r.data); })
      .catch(() => { if (alive) setSlotInfo(null); })
      .finally(() => { if (alive) setSlotsLoading(false); });
    return () => { alive = false; };
  }, [open, date]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!time) { setErr("Please pick an available time."); return; }
    setBusy(true); setErr("");
    try {
      await api.post("/public/meet-greet-request", {
        owner_name: ownerName,
        email,
        phone,
        dog_name: dogName,
        date,
        time,
      });
      setDone(true);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't send your request. Try again.");
    }
    setBusy(false);
  };

  const close = () => {
    setDone(false); setErr("");
    setOwnerName(""); setEmail(""); setPhone(""); setDogName("");
    setDate(todayIso()); setTime(""); setSlotInfo(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={close} data-testid="meet-greet-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-8 shadow-2xl animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-paw text-shGreen mr-2"/>Request a Meet &amp; Greet
          </h3>
          <button onClick={close} data-testid="meet-greet-close" className="text-gray-400 hover:text-white text-xl"><i className="fas fa-times"/></button>
        </div>

        {done ? (
          <div className="space-y-4" data-testid="meet-greet-success">
            <div className="bg-shGreen/10 border border-shGreen/30 rounded-lg p-4">
              <p className="text-shGreen font-black uppercase tracking-widest text-sm mb-2">
                <i className="fas fa-envelope mr-2"/>You're on the schedule
              </p>
              <p className="text-[14px] text-gray-300 leading-relaxed">
                Thanks{ownerName ? `, ${ownerName.split(" ")[0]}` : ""}! We'll see you {date && time ? `on ${date} at ${formatSlotTime(time)}` : "soon"}.
                Check <span className="text-white font-black">{email}</span> for a link to set up your portal.
              </p>
            </div>
            <button onClick={close} data-testid="meet-greet-done" className="w-full bg-shBlue text-white py-3 rounded font-black text-sm uppercase tracking-widest">
              Got it
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3.5">
            <p className="text-[14px] text-gray-400 leading-relaxed">
              Tell us about you and your pup, then pick a time that works — we'll confirm it right away.
            </p>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Your Name</label>
              <input required autoFocus value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                     data-testid="meet-greet-owner-name-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none"/>
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                     data-testid="meet-greet-email-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none"/>
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Phone</label>
              <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
                     data-testid="meet-greet-phone-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none"/>
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Dog's Name</label>
              <input required value={dogName} onChange={(e) => setDogName(e.target.value)}
                     data-testid="meet-greet-dog-name-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none"/>
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Date</label>
              <input type="date" required min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)}
                     data-testid="meet-greet-date-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none" style={{ colorScheme: "dark" }}/>
            </div>

            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Available Times</label>
              {slotsLoading && (
                <p className="text-[13px] text-gray-500 mt-1" data-testid="meet-greet-slots-loading">Checking openings…</p>
              )}
              {!slotsLoading && slotInfo && (slotInfo.closed || !slotInfo.enabled || slotInfo.slots.length === 0) && (
                <p className="text-[13px] text-shOrange mt-1" data-testid="meet-greet-slots-closed">
                  No Meet &amp; Greet times available on this date — try another day.
                </p>
              )}
              {!slotsLoading && slotInfo && !slotInfo.closed && slotInfo.enabled && slotInfo.slots.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-1.5" data-testid="meet-greet-slots-grid">
                  {slotInfo.slots.map((s) => (
                    <button key={s.time} type="button" disabled={!s.available}
                            onClick={() => setTime(s.time)}
                            data-testid={`meet-greet-slot-${s.time}`}
                            className={`py-2 rounded text-[12px] font-black uppercase tracking-widest transition ${
                              !s.available
                                ? "bg-bgBase text-gray-600 line-through cursor-not-allowed"
                                : time === s.time
                                  ? "bg-shGreen text-bgHeader"
                                  : "bg-bgBase border border-bgHover text-gray-300 hover:border-shGreen"
                            }`}>
                      {formatSlotTime(s.time)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black" data-testid="meet-greet-error">{err}</div>}
            <button type="submit" disabled={busy || !time} data-testid="meet-greet-submit"
                    className="w-full bg-shGreen text-bgHeader py-3 rounded font-black text-sm uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Sending…" : "Request Meet & Greet"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
