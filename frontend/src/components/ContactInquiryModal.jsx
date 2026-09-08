import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";

/**
 * Public "Tell us about your dog" questionnaire — the landing page's second
 * door for people who don't yet know whether they want daycare, boarding,
 * training or Online School. No account required. Posts to
 * /public/contact-inquiry, which saves the answers, creates or merges a
 * prospect client, emails the operator and sends a short acknowledgement.
 *
 * The choices come from /public/contact-inquiry-options so the words here,
 * in the operator's email and in the admin list are always the same.
 */
const FALLBACK_OPTIONS = {
  interests: { daycare: "Daycare", boarding: "Boarding", in_person_training: "In-person training", online_school: "Online School", grooming: "Grooming", not_sure: "Not sure — help me choose" },
  concerns: { puppy_basics: "Puppy basics", leash_pulling: "Pulling on leash", jumping: "Jumping", barking: "Barking", recall: "Not coming when called", house_training: "House training", separation_anxiety: "Separation anxiety", reactivity: "Reactive to dogs or people", bite_history: "Has growled, snapped, or bitten", other: "Other" },
  preferred_contact: { call: "Call", text: "Text", email: "Email" },
  start_timing: { asap: "As soon as possible", next_month: "In the next month", exploring: "Just exploring" },
  yes_no_unsure: { yes: "Yes", no: "No", not_sure: "Not sure" },
};

const EMPTY = {
  name: "", email: "", phone: "", preferred_contact: "text",
  dog_name: "", breed: "", dog_age: "",
  interests: [], concerns: [], message: "",
  dog_sex: "", fixed: "", vaccines_current: "", previous_training: "", household: "", zip: "", start_timing: "", heard_from: "",
  website: "", // honeypot — stays empty for humans
};

const inputCls = "w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-[16px] sm:text-sm focus:border-shGreen outline-none";
const labelCls = "text-[12px] font-black text-gray-500 uppercase tracking-widest";

function Chips({ options, value, onChange, testid, multi = true }) {
  const toggle = (k) => {
    if (!multi) { onChange(value === k ? "" : k); return; }
    onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k]);
  };
  const on = (k) => (multi ? value.includes(k) : value === k);
  return (
    <div className="flex flex-wrap gap-2 mt-1.5" data-testid={testid}>
      {Object.entries(options).map(([k, label]) => (
        <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={on(k)}
                data-testid={`${testid}-${k}`}
                className={`min-h-[40px] px-3 py-1.5 rounded-full text-[13px] font-black uppercase tracking-wide transition border ${
                  on(k) ? "bg-shGreen text-bgHeader border-shGreen" : "bg-bgBase border-bgHover text-gray-300 hover:border-shGreen"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export default function ContactInquiryModal({ open, onClose }) {
  const [f, setF] = useState(EMPTY);
  const [options, setOptions] = useState(FALLBACK_OPTIONS);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api.get("/public/contact-inquiry-options")
      .then((r) => { if (alive && r.data && r.data.interests) setOptions({ ...FALLBACK_OPTIONS, ...r.data }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const set = (k) => (v) => setF((prev) => ({ ...prev, [k]: v }));
  const onText = (k) => (e) => set(k)(e.target.value);

  const submit = async (e) => {
    e.preventDefault();
    if (f.interests.length === 0) { setErr("Pick at least one thing you're looking for."); return; }
    if (f.concerns.length === 0) { setErr("Pick at least one goal or concern — “Puppy basics” or “Other” is fine."); return; }
    setBusy(true); setErr("");
    try {
      await api.post("/public/contact-inquiry", f);
      setDone(true);
    } catch (ex) {
      setErr(formatErr(ex.response?.data?.detail) || "Couldn't send that. Please try again.");
    }
    setBusy(false);
  };

  const close = () => { setDone(false); setErr(""); setF(EMPTY); setMore(false); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={close} data-testid="contact-inquiry-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 sm:p-8 shadow-2xl animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto sh-modal-surface"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg sm:text-xl font-black text-white uppercase italic tracking-tight pr-2">
            <i className="fas fa-dog text-shGreen mr-2"/>Tell us about your dog
          </h3>
          <button onClick={close} data-testid="contact-inquiry-close" aria-label="Close" className="text-gray-400 hover:text-white text-xl"><i className="fas fa-times"/></button>
        </div>

        {done ? (
          <div className="space-y-4" data-testid="contact-inquiry-success">
            <div className="bg-shGreen/10 border border-shGreen/30 rounded-lg p-4">
              <p className="text-shGreen font-black uppercase tracking-widest text-sm mb-2">
                <i className="fas fa-check mr-2"/>Got it
              </p>
              <p className="text-[15px] text-gray-300 leading-relaxed">
                Thanks{f.name ? `, ${f.name.split(" ")[0]}` : ""}! We read every one of these ourselves and will reach out
                {f.preferred_contact === "email" ? " by email" : f.preferred_contact === "call" ? " with a call" : " by text"} within one business day.
              </p>
            </div>
            <button onClick={close} data-testid="contact-inquiry-done" className="w-full bg-shBlue text-white py-3 rounded font-black text-sm uppercase tracking-widest">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-[14px] text-gray-400 leading-relaxed">
              Two minutes, no account. We'll read it and get back to you with a plan.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Your name</label>
                <input required autoFocus value={f.name} onChange={onText("name")} data-testid="ci-name" className={inputCls} autoComplete="name"/>
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input type="tel" required value={f.phone} onChange={onText("phone")} data-testid="ci-phone" className={inputCls} autoComplete="tel"/>
              </div>
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" required value={f.email} onChange={onText("email")} data-testid="ci-email" className={inputCls} autoComplete="email"/>
            </div>
            <div>
              <label className={labelCls}>Best way to reach you</label>
              <Chips options={options.preferred_contact} value={f.preferred_contact} onChange={(v) => set("preferred_contact")(v || "text")} testid="ci-contact" multi={false}/>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Dog's name</label>
                <input required value={f.dog_name} onChange={onText("dog_name")} data-testid="ci-dog-name" className={inputCls}/>
              </div>
              <div>
                <label className={labelCls}>Breed or mix</label>
                <input required value={f.breed} onChange={onText("breed")} data-testid="ci-breed" className={inputCls}/>
              </div>
              <div>
                <label className={labelCls}>Age</label>
                <input required value={f.dog_age} onChange={onText("dog_age")} data-testid="ci-age" className={inputCls} placeholder="e.g. 5 months"/>
              </div>
            </div>

            <div>
              <label className={labelCls}>What are you looking for?</label>
              <Chips options={options.interests} value={f.interests} onChange={set("interests")} testid="ci-interest"/>
            </div>
            <div>
              <label className={labelCls}>Main goals or concerns</label>
              <Chips options={options.concerns} value={f.concerns} onChange={set("concerns")} testid="ci-concern"/>
            </div>
            <div>
              <label className={labelCls}>Anything else you want us to know</label>
              <textarea required rows={3} value={f.message} onChange={onText("message")} data-testid="ci-message" className={inputCls}
                        placeholder="What's going well, what's hard, what you're hoping for."/>
            </div>

            <button type="button" onClick={() => setMore((m) => !m)} data-testid="ci-more-toggle" aria-expanded={more}
                    className="text-[12px] font-black uppercase tracking-widest text-shBlue">
              <i className={`fas ${more ? "fa-chevron-up" : "fa-chevron-down"} mr-1.5`}/>{more ? "Fewer questions" : "A few optional questions"}
            </button>

            {more && (
              <div className="space-y-3 border-t border-bgHover pt-3" data-testid="ci-optional">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Sex</label>
                    <Chips options={{ male: "Male", female: "Female" }} value={f.dog_sex} onChange={set("dog_sex")} testid="ci-sex" multi={false}/>
                  </div>
                  <div>
                    <label className={labelCls}>Spayed / neutered</label>
                    <Chips options={options.yes_no_unsure} value={f.fixed} onChange={set("fixed")} testid="ci-fixed" multi={false}/>
                  </div>
                  <div>
                    <label className={labelCls}>Vaccines up to date</label>
                    <Chips options={options.yes_no_unsure} value={f.vaccines_current} onChange={set("vaccines_current")} testid="ci-vax" multi={false}/>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Previous training, and with whom</label>
                  <input value={f.previous_training} onChange={onText("previous_training")} data-testid="ci-previous" className={inputCls}/>
                </div>
                <div>
                  <label className={labelCls}>Other dogs or kids at home</label>
                  <input value={f.household} onChange={onText("household")} data-testid="ci-household" className={inputCls}/>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Zip code</label>
                    <input value={f.zip} onChange={onText("zip")} data-testid="ci-zip" className={inputCls} inputMode="numeric" autoComplete="postal-code"/>
                  </div>
                  <div>
                    <label className={labelCls}>How did you hear about us?</label>
                    <input value={f.heard_from} onChange={onText("heard_from")} data-testid="ci-heard" className={inputCls}/>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>When would you like to start?</label>
                  <Chips options={options.start_timing} value={f.start_timing} onChange={set("start_timing")} testid="ci-start" multi={false}/>
                </div>
              </div>
            )}

            {/* Honeypot: invisible to people, irresistible to bots. Never shown, never read by humans. */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
              <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={onText("website")} data-testid="ci-website"/></label>
            </div>

            {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 font-black" data-testid="contact-inquiry-error">{err}</div>}
            <button type="submit" disabled={busy} data-testid="contact-inquiry-submit"
                    className="w-full bg-shGreen text-bgHeader py-3.5 rounded font-black text-sm uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Sending…" : "Send it over"}
            </button>
            <p className="text-[12px] text-gray-500 leading-relaxed">We only use this to get back to you. No newsletters, no sharing.</p>
          </form>
        )}
      </div>
    </div>
  );
}
