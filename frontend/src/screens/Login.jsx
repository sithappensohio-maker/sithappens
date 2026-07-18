import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import ForgotPasswordModal from "../components/ForgotPasswordModal";
import RequestMeetGreetModal from "../components/RequestMeetGreetModal";

/**
 * Sprint 110t — Landing + Auth combined screen.
 *
 * The old single-card login was punching way under its weight as the FIRST
 * thing prospects see. This screen turns it into a real landing page:
 *   • Hero with brand promise + scroll CTA
 *   • Live "What we do" grid (4 hard-coded categories + a "browse all"
 *     modal that pulls from /api/public/services so prospects can see the
 *     real menu and pricing without needing an account)
 *   • "Why Sit Happens" pillars
 *   • "How it works" 3-step flow
 *   • Compact sign-in / register card pinned in the hero AND repeated at
 *     the bottom so scrolling never strands the user
 *
 * Auth behaviour is unchanged — same useAuth() hooks, ?ref=CODE handling,
 * forgot password modal, testids preserved.
 */

const CATEGORIES = [
  {
    key: "training",
    label: "Training",
    icon: "fa-graduation-cap",
    color: "#a855f7",
    blurb: "Personalised plans, daily homework you can track from your phone, real progress.",
  },
  {
    key: "daycare",
    label: "Daycare",
    icon: "fa-sun",
    color: "#00a9e0",
    blurb: "Structured play, calm naps, a tired happy pup at pickup.",
  },
  {
    key: "boarding",
    label: "Boarding",
    icon: "fa-moon",
    color: "#8cc63f",
    blurb: "Overnight stays where your dog gets attention, not just a kennel.",
  },
  {
    key: "photography",
    label: "Photography",
    icon: "fa-camera-retro",
    color: "#f97316",
    blurb: "Pro shots of your pup in action — order prints right from the portal.",
  },
];

const WHY = [
  {
    icon: "fa-mobile-screen",
    color: "#00a9e0",
    title: "All in your pocket",
    body: "Book, track training homework, see report cards, and chat with us from a single portal — phone, tablet, or desktop.",
  },
  {
    icon: "fa-paw",
    color: "#8cc63f",
    title: "We know your dog",
    body: "Vaccines, vet, feeding, meds, behaviour notes — everything lives in one place. No re-explaining at every check-in.",
  },
  {
    icon: "fa-camera",
    color: "#f26522",
    title: "You get to see the day",
    body: "Pup report cards, mood tags, real photos. Boarding parents sleep easier; daycare parents smile at lunch.",
  },
  {
    icon: "fa-gift",
    color: "#a855f7",
    title: "Loyalty + referrals",
    body: "Earn a free daycare day for every friend you send our way. Streaks, trophies, real rewards.",
  },
];

const HOW = [
  { n: 1, title: "Create your account", body: "Quick sign-up + a one-time waiver and vaccine upload." },
  { n: 2, title: "Add your pup", body: "Photo, breed, vet, feeding schedule. We tailor every visit to them." },
  { n: 3, title: "Book in seconds", body: "Pick a service and a date. We confirm and you're set." },
];

export default function Login() {
  const { login, register, error, setError } = useAuth();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [refCode, setRefCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [services, setServices] = useState([]);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [meetGreetOpen, setMeetGreetOpen] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = (params.get("ref") || "").toUpperCase().trim();
      if (ref) { setRefCode(ref); setMode("register"); }
    } catch {}
    // Pull the live services catalog so the "browse all" link shows a real
    // count and the modal renders genuine offerings.
    api.get("/public/services")
      .then((r) => setServices(Array.isArray(r.data) ? r.data : []))
      .catch(() => setServices([]));
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    if (mode === "login") await login(email, password);
    else await register(email, password, name, refCode || undefined);
    setLoading(false);
  };

  const scrollToAuth = () => {
    document.getElementById("landing-auth")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeServiceCount = services.length;

  return (
    <div className="min-h-screen w-full bg-bgBase text-white" data-testid="login-screen">
      {/* ===== Top bar ===== */}
      <header className="sticky top-0 z-30 backdrop-blur bg-bgBase/80 border-b border-bgHover/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt="Sit Happens"
                 className="h-14 sm:h-16 lg:h-20 shrink-0 drop-shadow-[0_0_18px_rgba(140,198,63,0.35)]"
                 data-testid="landing-logo"/>
            <div className="hidden sm:block min-w-0">
              <p className="text-[11px] uppercase font-black tracking-[0.25em] text-gray-400 truncate">
                Dog Training · Daycare · Boarding · Photography
              </p>
            </div>
          </div>
          <button onClick={scrollToAuth} data-testid="landing-top-cta"
                  className="bg-shBlue text-white px-4 sm:px-5 py-2 rounded font-black text-[12px] sm:text-[13px] uppercase tracking-widest hover:bg-shBlue/90 transition">
            Sign in / Register
          </button>
        </div>
      </header>

      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        {/* Soft radial accents matching the brand palette */}
        <div className="absolute inset-0 pointer-events-none opacity-40"
             style={{ background:
               "radial-gradient(circle at 12% 18%, #00a9e0 0%, transparent 38%), radial-gradient(circle at 88% 78%, #8cc63f 0%, transparent 42%), radial-gradient(circle at 70% 10%, #f26522 0%, transparent 30%)"
             }}/>

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20 sh-splatter">
          {/* Hero copy + feature logo */}
          <div data-testid="landing-hero-copy">
            {/* Sprint 110u — feature logo, large and proud at the top of the
                hero. Previously a 4%-opacity background watermark; now the
                actual brand mark sits front-and-centre with a soft brand-color
                halo behind it so it pops without overpowering the headline. */}
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 -m-6 rounded-full pointer-events-none opacity-60 blur-3xl"
                   style={{ background: "radial-gradient(circle, rgba(140,198,63,0.6) 0%, rgba(0,169,224,0.35) 45%, transparent 70%)" }}/>
              <img src="/logo.png" alt="Sit Happens"
                   className="relative h-32 sm:h-40 lg:h-48 drop-shadow-[0_8px_30px_rgba(0,0,0,0.65)]"
                   data-testid="landing-hero-logo"/>
            </div>

            <p className="text-[11px] sm:text-[12px] font-black uppercase tracking-[0.35em] text-shGreen mb-3">
              <i className="fas fa-paw mr-2"/>For pups who deserve more than a kennel
            </p>
            <h1 className="sh-display text-5xl sm:text-6xl lg:text-7xl text-white leading-[0.95]">
              Where every pup<br/>
              <span className="sh-pop-green">finds their happy.</span>
            </h1>
            <p className="text-base sm:text-lg text-gray-300 leading-relaxed mt-5 max-w-xl">
              Training, daycare, boarding & photography from a team that actually knows your dog — with a portal that keeps you in the loop every single day.
            </p>

            {/* Primary CTA — this is THE entry point for new visitors: every
                new pup starts with a free Meet & Greet before anything else. */}
            <div className="mt-7 relative bg-gradient-to-br from-shOrange/25 via-shOrange/10 to-transparent border-2 border-shOrange rounded-2xl p-5 sm:p-6 shadow-[0_10px_40px_-12px_rgba(242,101,34,0.5)]">
              <p className="text-[11px] sm:text-[12px] font-black uppercase tracking-[0.3em] text-shOrange mb-2">
                <i className="fas fa-flag-checkered mr-2"/>How to get started
              </p>
              <h2 className="text-xl sm:text-2xl font-black uppercase italic tracking-tight text-white mb-2">
                Let's get the ball rolling
              </h2>
              <p className="text-[14px] text-gray-300 leading-relaxed mb-4 max-w-md">
                Every new pup starts with a free Meet &amp; Greet. Tell us a bit about you and your dog and we'll reach out to schedule it — no account needed.
              </p>
              <button onClick={() => setMeetGreetOpen(true)}
                      data-testid="landing-hero-meet-greet-cta"
                      className="w-full sm:w-auto justify-center bg-shOrange text-white px-7 py-3.5 rounded-full font-black text-[15px] uppercase tracking-widest shadow-lg hover:bg-shOrange/90 transition inline-flex items-center gap-2">
                <i className="fas fa-paw"/>Request a Meet &amp; Greet
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-6 text-[12px] uppercase tracking-widest font-black text-gray-500">
              <span><i className="fas fa-shield-halved text-shGreen mr-1.5"/>Vaccine-checked</span>
              <span><i className="fas fa-camera text-shOrange mr-1.5"/>Daily report cards</span>
              <span><i className="fas fa-graduation-cap text-shBlue mr-1.5"/>Trainer in-house</span>
            </div>

            {/* Sign in / register — secondary to the Meet & Greet CTA above,
                so it sits directly underneath rather than competing beside it. */}
            <div id="landing-auth" className="mt-8 max-w-md scroll-mt-24" data-testid="landing-auth-card">
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-gray-500 mb-3">
                Already a client, or ready to sign up now?
              </p>
              <div className="relative bg-bgPanel border border-bgHover rounded-2xl p-6 sm:p-7 shadow-2xl card-form">
                <div className="flex gap-2 mb-5 bg-bgBase rounded-lg p-1">
                  <button onClick={() => setMode("login")} data-testid="tab-login"
                          className={`flex-1 py-2 rounded text-[13px] font-black uppercase tracking-widest transition ${mode==="login"?"bg-shBlue text-white":"text-gray-400 hover:text-gray-200"}`}>
                    Sign In
                  </button>
                  <button onClick={() => setMode("register")} data-testid="tab-register"
                          className={`flex-1 py-2 rounded text-[13px] font-black uppercase tracking-widest transition ${mode==="register"?"bg-shGreen text-bgHeader":"text-gray-400 hover:text-gray-200"}`}>
                    Register
                  </button>
                </div>

                <form onSubmit={onSubmit} className="space-y-3.5">
                  {mode === "register" && (
                    <>
                      <div>
                        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Full Name</label>
                        <input value={name} onChange={(e)=>setName(e.target.value)} required data-testid="register-name-input"
                               className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shGreen outline-none"/>
                      </div>
                      <div>
                        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Referral Code <span className="text-gray-600 normal-case font-normal">(optional)</span></label>
                        <input value={refCode} onChange={(e)=>setRefCode(e.target.value.toUpperCase())} maxLength={12} data-testid="register-refcode-input"
                               placeholder="e.g. 7KTUMQ"
                               className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm font-mono uppercase focus:border-shGreen outline-none"/>
                        {refCode && <p className="text-[12px] text-shGreen mt-1 uppercase tracking-widest">Your friend gets a free daycare day once you finish your first appointment!</p>}
                      </div>
                    </>
                  )}
                  <div>
                    <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Email</label>
                    <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required data-testid="login-email-input"
                           className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shBlue outline-none"/>
                  </div>
                  <div>
                    <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Password</label>
                    <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required
                           minLength={mode === "register" ? 8 : undefined} autoComplete={mode === "register" ? "new-password" : "current-password"}
                           data-testid="login-password-input"
                           className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2.5 text-white text-sm focus:border-shBlue outline-none"/>
                    {mode === "register" && <p className="mt-1 text-[11px] text-gray-500">Use at least 8 characters.</p>}
                    {mode === "login" && (
                      <button type="button" onClick={()=>setForgotOpen(true)} data-testid="forgot-password-link"
                              className="mt-2 text-[12px] font-black uppercase tracking-widest text-shGreen hover:text-shGreen/80 transition">
                        Forgot password?
                      </button>
                    )}
                  </div>
                  {error && <div data-testid="login-error" className="text-[13px] text-red-400 bg-red-500/10 rounded p-2.5 uppercase font-black">{error}</div>}
                  <button type="submit" disabled={loading} data-testid="login-submit-button"
                          className={`w-full py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50 transition ${mode==="register" ? "bg-shGreen text-bgHeader hover:bg-shGreen/90" : "bg-shBlue text-white hover:bg-shBlue/90"}`}>
                    {loading?"Please wait...":(mode==="login"?"Sign In":"Create Account")}
                  </button>
                </form>

                <p className="mt-5 text-center text-[12px] text-gray-500 uppercase tracking-widest">
                  {mode==="login" ? "New here? Tap Register above." : "Already a client? Tap Sign In above."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== What we do ===== */}
      <section className="relative border-t border-bgHover/60 bg-bgPanel/30" data-testid="landing-services">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <div className="flex items-end justify-between flex-wrap gap-3 mb-8">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shBlue mb-2">
                <i className="fas fa-list-check mr-2"/>What we do
              </p>
              <h2 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tight text-white">
                Four ways we help your pup.
              </h2>
            </div>
            {activeServiceCount > 0 && (
              <button onClick={() => setBrowseOpen(true)} data-testid="landing-browse-services"
                      className="text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-white border border-shGreen/40 hover:border-shGreen rounded px-4 py-2 transition">
                Browse all {activeServiceCount} services <i className="fas fa-arrow-right ml-1"/>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {CATEGORIES.map((c) => (
              <div key={c.key}
                   data-testid={`landing-category-${c.key}`}
                   className="group relative bg-bgBase border border-bgHover hover:border-shGreen/40 rounded-xl p-5 transition shadow-md hover:shadow-lg flex flex-col">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center mb-3"
                     style={{ backgroundColor: `${c.color}22`, color: c.color }}>
                  <i className={`fas ${c.icon} text-2xl`}/>
                </div>
                <h3 className="text-lg font-black uppercase italic tracking-tight text-white">{c.label}</h3>
                <p className="text-[14px] text-gray-300 leading-relaxed mt-1.5 flex-1">{c.blurb}</p>
                <button onClick={scrollToAuth}
                        className="mt-3 self-start text-[12px] font-black uppercase tracking-widest text-shGreen group-hover:text-white transition">
                  Get started <i className="fas fa-arrow-right ml-1 group-hover:translate-x-0.5 transition-transform"/>
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Why us ===== */}
      <section className="relative" data-testid="landing-why">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shOrange mb-2">
            <i className="fas fa-heart mr-2"/>Why Sit Happens
          </p>
          <h2 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tight text-white mb-8">
            Built around the dog. And the human.
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {WHY.map((w, i) => (
              <div key={i}
                   data-testid={`landing-why-${i}`}
                   className="bg-bgPanel border border-bgHover rounded-xl p-5">
                <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-3"
                     style={{ backgroundColor: `${w.color}22`, color: w.color }}>
                  <i className={`fas ${w.icon} text-xl`}/>
                </div>
                <h3 className="text-[15px] font-black uppercase italic tracking-tight text-white">{w.title}</h3>
                <p className="text-[14px] text-gray-300 leading-relaxed mt-1.5">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section className="relative border-t border-bgHover/60 bg-bgPanel/30" data-testid="landing-how">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
          <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-2">
            <i className="fas fa-route mr-2"/>How it works
          </p>
          <h2 className="text-3xl sm:text-4xl font-black uppercase italic tracking-tight text-white mb-8">
            From sign-up to first wag in three steps.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {HOW.map((s) => (
              <div key={s.n} data-testid={`landing-how-${s.n}`}
                   className="relative bg-bgBase border border-bgHover rounded-xl p-5">
                <span className="absolute -top-3 -left-3 w-10 h-10 rounded-full bg-shGreen text-bgHeader flex items-center justify-center font-black text-lg shadow-lg">
                  {s.n}
                </span>
                <h3 className="text-base font-black uppercase italic tracking-tight text-white mt-2">{s.title}</h3>
                <p className="text-[14px] text-gray-300 leading-relaxed mt-1.5">{s.body}</p>
              </div>
            ))}
          </div>

          {/* Final CTA strip */}
          <div className="mt-10 bg-gradient-to-r from-shGreen/15 via-shBlue/10 to-shOrange/15 border border-shGreen/40 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xl sm:text-2xl font-black uppercase italic tracking-tight text-white">
                Ready when you are.
              </h3>
              <p className="text-[14px] text-gray-300 mt-1">Set up your profile in under two minutes — no credit card required.</p>
            </div>
            <button onClick={() => { setMode("register"); scrollToAuth(); }}
                    data-testid="landing-bottom-cta"
                    className="bg-shGreen text-bgHeader px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition shrink-0">
              <i className="fas fa-paw mr-2"/>Create my account
            </button>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="border-t border-bgHover/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] uppercase tracking-widest font-black text-gray-500">
          <p>© {new Date().getFullYear()} Sit Happens · Dog Training</p>
          <p><i className="fas fa-paw text-shGreen mr-1"/>Where every pup finds their happy.</p>
        </div>
      </footer>

      <ForgotPasswordModal open={forgotOpen} onClose={()=>setForgotOpen(false)} initialEmail={email}/>
      <RequestMeetGreetModal open={meetGreetOpen} onClose={()=>setMeetGreetOpen(false)}/>

      {/* ===== Browse-all-services modal ===== */}
      {browseOpen && (
        <BrowseServicesModal services={services} onClose={() => setBrowseOpen(false)} onCta={() => { setBrowseOpen(false); setMode("register"); scrollToAuth(); }} />
      )}
    </div>
  );
}


function BrowseServicesModal({ services, onClose, onCta }) {
  const grouped = ["daycare", "boarding", "training", "grooming", "photography", "other"].map((k) => ({
    key: k,
    list: services.filter((s) => s.service_type === k),
  })).filter((g) => g.list.length > 0);

  const catMeta = {
    daycare: { label: "Daycare", icon: "fa-sun", color: "#00a9e0" },
    boarding: { label: "Boarding", icon: "fa-moon", color: "#8cc63f" },
    training: { label: "Training", icon: "fa-graduation-cap", color: "#a855f7" },
    grooming: { label: "Grooming", icon: "fa-bath", color: "#06b6d4" },
    photography: { label: "Photography", icon: "fa-camera-retro", color: "#f97316" },
    other: { label: "Other", icon: "fa-tag", color: "#94a3b8" },
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur flex items-center justify-center p-3 sm:p-6"
         onClick={onClose}
         data-testid="landing-browse-modal">
      <div onClick={(e) => e.stopPropagation()}
           className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-4xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto shadow-2xl animate-slide-in">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-bgPanel/95 backdrop-blur border-b border-bgHover">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight">
              <i className="fas fa-list-check text-shGreen mr-2"/>Our services
            </h2>
            <p className="text-[13px] text-gray-400 truncate">{services.length} active offering{services.length === 1 ? "" : "s"} · sign up to book</p>
          </div>
          <button onClick={onClose} data-testid="landing-browse-close"
                  className="text-gray-400 hover:text-white text-2xl p-1 leading-none">
            <i className="fas fa-times"/>
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {grouped.length === 0 && (
            <p className="text-center text-gray-500 py-10">Catalog is being updated — check back soon.</p>
          )}
          {grouped.map((g) => {
            const meta = catMeta[g.key] || catMeta.other;
            return (
              <div key={g.key} data-testid={`landing-browse-cat-${g.key}`}>
                <div className="flex items-center gap-2 mb-2.5">
                  <i className={`fas ${meta.icon}`} style={{ color: meta.color }}/>
                  <h3 className="text-[14px] font-black uppercase italic tracking-tight text-white">{meta.label}</h3>
                  <span className="text-[12px] font-black uppercase tracking-widest text-gray-500">· {g.list.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {g.list.map((s) => (
                    <div key={s.id}
                         data-testid={`landing-browse-svc-${s.id}`}
                         className="bg-bgBase border border-bgHover rounded-lg p-3 flex items-start gap-3">
                      <div className="w-10 h-10 rounded grid place-items-center shrink-0"
                           style={{ backgroundColor: `${s.color || "#64748b"}22`, color: s.color || "#64748b" }}>
                        <i className={`fas ${s.icon || "fa-tag"}`}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[14px] font-black text-white tracking-tight">{s.name}</p>
                          <p className="text-shGreen font-black text-[14px] whitespace-nowrap">${Number(s.base_price || 0).toFixed(2)}</p>
                        </div>
                        {s.description && (
                          <p className="text-[13px] text-gray-400 leading-relaxed mt-1">{s.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="pt-4 border-t border-bgHover flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[13px] text-gray-400">Like what you see? Create your account to book.</p>
            <button onClick={onCta} data-testid="landing-browse-cta"
                    className="bg-shGreen text-bgHeader px-5 py-2.5 rounded font-black text-[13px] uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition">
              <i className="fas fa-paw mr-2"/>Get started
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
