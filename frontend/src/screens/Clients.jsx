import { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { toast } from "sonner";
import { compressImage } from "../lib/imageCompress";
import { dogAgeMonths } from "../lib/dogAge";
import { scrollToCardAndFlash } from "../lib/scrollToCard";
import ClientPortalPreview from "../components/ClientPortalPreview";
import TrophyWall, { ManualAwardPicker } from "../components/TrophyWall";
import Avatar from "../components/Avatar";
import { startImpersonation } from "../lib/impersonation";
import ClientFilesModal from "../components/ClientFilesModal";
import LegacyPricingModal from "../components/LegacyPricingModal";
import PackLotsModal from "../components/PackLotsModal";
import AdminClientPaymentPlans from "../components/AdminClientPaymentPlans";
import PageHero from "../components/PageHero";
import IntakeFormsSection from "../components/IntakeFormsSection";
import CommunicationLog from "../components/CommunicationLog";
import TakePaymentModal from "../components/TakePaymentModal";
import ReviewRequestButton from "../components/ReviewRequestButton";
import LazyMount from "../components/LazyMount";
import SendClientEmailModal from "../components/SendClientEmailModal";

const empty = { name:"", address:"", phone:"", email:"", emerg:"", credits:0, photo:"", photo_gallery_url:"", photo_gallery_pin:"", photo_gallery_has_new:false };
const emptyDog = { name:"", breed:"", age_y:0, age_m:0, birthday:"", sex:"Male", fixed:"No", rabies:"", bordetella:"", dhpp:"", notes:"", rabies_photo:"", bordetella_photo:"", dhpp_photo:"" };

export default function Clients({ focusId = null, focusMode = "scroll", onConsumed = () => {}, onJumpToDog = () => {} }) {
  const confirm = useConfirm();
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [emailClient, setEmailClient] = useState(null);  // Sprint 110dh-2 — single-client email modal
  const [form, setForm] = useState(empty);
  // Quick-add dog inside the "New Client" modal so the admin doesn't have to
  // bounce over to the Dogs screen for every new sign-up. Only relevant when
  // creating a brand-new client.
  const [addDog, setAddDog] = useState(true);
  const [dog, setDog] = useState(emptyDog);
  const [portalOpen, setPortalOpen] = useState(null); // client id
  const [portalForm, setPortalForm] = useState({ email:"", password:"" });
  const [sellOpen, setSellOpen] = useState(null); // client object
  const [sellProgramOpen, setSellProgramOpen] = useState(null); // client object — Sprint 110bw
  const [takePaymentOpen, setTakePaymentOpen] = useState(null); // client object — Sprint 110di-61
  const [adjustOpen, setAdjustOpen] = useState(null); // client object
  const [receiptsOpen, setReceiptsOpen] = useState(null); // client object — shows list of past receipts
  const [filesOpen, setFilesOpen] = useState(null); // client object — shows files/homework manager
  const [legacyOpen, setLegacyOpen] = useState(null); // client object — shows the grandfathered-price overrides
  const [lotsOpen, setLotsOpen] = useState(null); // Sprint 110da — credit-lot viewer w/ legacy vs paid-at-sale badges
  const [packs, setPacks] = useState([]);
  const [err, setErr] = useState("");
  const [receipt, setReceipt] = useState(null); // populated after a sale to show the printable receipt
  const [previewId, setPreviewId] = useState(null); // client id whose portal we're previewing
  const [trophyMap, setTrophyMap] = useState({});  // client_id -> awarded[]
  const [awardPicker, setAwardPicker] = useState(null);  // client object
  const [plansByClient, setPlansByClient] = useState({});  // client_id -> plans[]

  const loadTrophies = async (clientList) => {
    // Sprint 110ef — Single batch call to avoid the N-parallel 429 storm
    // (see also Dogs.jsx + /admin/dog-trophies-summary).
    try {
      const { data } = await api.get("/admin/client-trophies-summary");
      const map = {};
      clientList.forEach(c => { map[c.id] = data?.[c.id] || []; });
      setTrophyMap(map);
    } catch (e) { console.warn("Clients trophy load failed:", e); }
  };

  const load = async () => {
    const [c, p, pp] = await Promise.all([
      api.get("/clients"),
      api.get("/credit-packs").catch(()=>({data:[]})),
      api.get("/admin/payment-plans").catch(()=>({data:[]})),
    ]);
    setClients(c.data);
    setPacks(p.data || []);
    // Sprint 110ef — Group all payment plans by client_id once so each
    // AdminClientPaymentPlans card uses the bulk-loaded slice instead of
    // firing its own /admin/payment-plans?client_id=… request (was causing
    // browser-level `ERR_INSUFFICIENT_RESOURCES` with hundreds of clients).
    const byClient = {};
    (pp.data || []).forEach(plan => {
      const cid = plan.client_id;
      if (!cid) return;
      (byClient[cid] = byClient[cid] || []).push(plan);
    });
    setPlansByClient(byClient);
    loadTrophies(c.data);
  };
  useEffect(() => { load(); }, []);

  const openNewClient = () => {
    setEditing(null); setForm(empty); setDog(emptyDog); setAddDog(true); setOpen(true); setErr("");
  };
  const openEditClient = (c) => {
    setEditing(c); setForm({...empty, ...c}); setAddDog(false); setOpen(true); setErr("");
  };

  useEffect(() => {
    if (!focusId || clients.length === 0) return;
    // Sprint 110cm — Search result clicked → scroll-and-flash (don't auto-
    // open the edit modal — disorienting). Explicit "Open profile" buttons
    // from Pipeline/Dashboard pass mode="open" so they keep their old
    // behavior of yanking the modal up.
    if (focusMode === "open") {
      const c = clients.find(x => x.id === focusId);
      if (c) { openEditClient(c); onConsumed(); }
    } else {
      scrollToCardAndFlash(`client-card-${focusId}`).then(onConsumed);
    }
  }, [focusId, focusMode, clients]);

  const submitClient = async () => {
    setErr("");
    try {
      if (editing) {
        await api.put(`/clients/${editing.id}`, form);
        setOpen(false); load();
      } else {
        const { data } = await api.post("/clients", form);

        // Quick-add dog: if the admin filled in a dog name, create the dog
        // record using the new client's id. We swallow this error inline so the
        // client still gets saved even if (say) a vaccine date is malformed —
        // the dog can always be added from the Dogs screen.
        let dogWarning = "";
        if (addDog && dog.name?.trim()) {
          try {
            // Birthday wins — derive age_y/age_m from it for consistency.
            let ageY = parseInt(dog.age_y) || 0;
            let ageM = parseInt(dog.age_m) || 0;
            if (dog.birthday) {
              const months = dogAgeMonths({ birthday: dog.birthday });
              ageY = Math.floor(months / 12);
              ageM = months % 12;
            }
            const dogResp = await api.post("/dogs", {
              owner_id: data.id,
              name: dog.name.trim(),
              breed: dog.breed || "",
              age_y: ageY,
              age_m: ageM,
              birthday: dog.birthday || "",
              sex: dog.sex || "Male",
              fixed: dog.fixed || "No",
              vaccines: {
                rabies: dog.rabies || "",
                bordetella: dog.bordetella || "",
                dhpp: dog.dhpp || "",
              },
              notes: dog.notes || "",
            });
            // Attach any cert photos the admin pasted/uploaded in the modal.
            // Each cert is its own POST so a single failure doesn't break the
            // whole new-client flow.
            const dogId = dogResp.data?.id;
            if (dogId) {
              for (const v of ["rabies", "bordetella", "dhpp"]) {
                const photo = dog[`${v}_photo`];
                const expires_on = dog[v];
                if (photo && expires_on) {
                  try {
                    await api.post(`/dogs/${dogId}/vaccine-cert`, { vaccine: v, expires_on, photo });
                  } catch { /* surfaced below if all certs fail; harmless if just one fails */ }
                }
              }
            }
          } catch (e) {
            dogWarning = formatErr(e.response?.data?.detail) || "Dog couldn't be added — add it from the Dogs screen.";
          }
        }

        setOpen(false);
        // If the new client has an email, auto-send a claim-your-account email.
        if (form.email) {
          try {
            await api.post(`/clients/${data.id}/send-claim-email`);
            const msg = dogWarning
              ? `Client + claim email sent. ${dogWarning}`
              : `Claim email sent to ${form.email}` + (addDog && dog.name?.trim() ? ` · ${dog.name.trim()} added` : "");
            setClaimToast({ clientId: data.id, msg, tone: dogWarning ? "warn" : "ok" });
            setTimeout(() => setClaimToast(t => t && t.clientId === data.id ? null : t), 5000);
          } catch (e) {
            // Don't block client creation if email fails — surface a warning instead.
            setClaimToast({ clientId: data.id, msg: "Client saved, but the claim email couldn't be sent. Use the button to retry.", tone: "warn" });
          }
        } else if (dogWarning) {
          setClaimToast({ clientId: data.id, msg: dogWarning, tone: "warn" });
          setTimeout(() => setClaimToast(t => t && t.clientId === data.id ? null : t), 5000);
        } else if (addDog && dog.name?.trim()) {
          setClaimToast({ clientId: data.id, msg: `${dog.name.trim()} added`, tone: "ok" });
          setTimeout(() => setClaimToast(t => t && t.clientId === data.id ? null : t), 4000);
        }
        load();
      }
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!(await confirm({ title: "Delete this client?", body: "This client and all their dogs will be removed. Bookings, training notes, and homework will also be deleted. This cannot be undone.", confirmText: "Delete client", tone: "danger" }))) return;
    await api.delete(`/clients/${id}`); load();
  };

  const openPortal = (c) => {
    setPortalOpen(c.id);
    setPortalForm({ email: c.portal_email || c.email || "", password: "" });
    setErr("");
  };

  const savePortal = async () => {
    setErr("");
    try {
      await api.post(`/clients/${portalOpen}/portal-account`, portalForm);
      setPortalOpen(null); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const [claimToast, setClaimToast] = useState(null); // { clientId, msg, tone }
  const sendClaimEmail = async (c) => {
    const isReset = !!c.portal_email;
    const verb = isReset ? "reset" : "claim";
    if (!c.email) {
      setClaimToast({ clientId: c.id, msg: "Add an email to this client first.", tone: "warn" });
      return;
    }
    if (!(await confirm({
      title: isReset ? "Send password reset email?" : "Send claim account email?",
      body: `We'll email ${c.email} a one-time ${verb} link (valid for 7 days). They'll set their own password and be signed in automatically.`,
      confirmText: isReset ? "Send reset email" : "Send claim email",
      tone: "info",
    }))) return;
    try {
      await api.post(`/clients/${c.id}/send-claim-email`);
      setClaimToast({ clientId: c.id, msg: `Email sent to ${c.email}`, tone: "ok" });
      setTimeout(() => setClaimToast(t => t && t.clientId === c.id ? null : t), 4000);
    } catch (e) {
      setClaimToast({ clientId: c.id, msg: formatErr(e.response?.data?.detail) || "Failed to send email.", tone: "warn" });
    }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="clients-screen">
      <PageHero
        eyebrow={{ icon: "fa-users", text: `${clients.length} families on file`, color: "text-shBlue" }}
        title="Client Hub."
        highlight="Where humans live."
        subtitle="Profiles, dogs, credits, and waivers — all in one place."
        right={(
          <button onClick={openNewClient} data-testid="add-client-button"
                  className="bg-shGreen text-bgHeader px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition">
            <i className="fas fa-plus mr-2"/>Add Client
          </button>
        )}
        testid="clients-hero"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6" data-testid="client-grid">
        {clients.length === 0 && <div className="col-span-full text-center text-gray-500 text-xs font-black uppercase py-16">No clients yet — add your first.</div>}
        {clients.map(c => (
          <div key={c.id} className="card-client p-5 sm:p-6 rounded-xl group relative shadow-lg" data-testid={`client-card-${c.id}`}>
            <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
              {c.email && (
                <button onClick={()=>setEmailClient(c)} className="text-gray-400 hover:text-shGreen p-2 -m-1"
                        title="Email this client"
                        data-testid={`email-client-${c.id}`}><i className="fas fa-paper-plane" /></button>
              )}
              <button onClick={()=>openEditClient(c)} className="text-gray-400 hover:text-white p-2 -m-1" data-testid={`edit-client-${c.id}`}><i className="fas fa-edit" /></button>
              <button onClick={()=>remove(c.id)} className="text-gray-400 hover:text-red-400 p-2 -m-1"><i className="fas fa-trash" /></button>
            </div>
            <div className="flex items-center gap-3 pr-16">
              <Avatar src={c.photo} icon="fa-user" size="md" ring="border-shBlue/40" alt={c.name} testid={`client-avatar-${c.id}`}/>
              <div className="min-w-0 flex-1">
                <h4 className="text-lg font-black text-white uppercase tracking-tight min-w-0 truncate">{c.name}</h4>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {c.client_status && c.client_status !== "active" && (
                    <ClientStatusPill status={c.client_status} clientId={c.id} onChange={load}/>
                  )}
                  {c.setup_badge && c.setup_overall !== "complete" && (
                    <span
                      data-testid={`client-setup-badge-${c.id}`}
                      className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${
                        c.setup_overall === "pending_review"
                          ? "bg-shBlue/15 text-shBlue border-shBlue/40"
                          : "bg-shOrange/15 text-shOrange border-shOrange/40"
                      }`}
                      title="First-time client setup completion"
                    >
                      <i className={`fas ${c.setup_overall === "pending_review" ? "fa-hourglass-half" : "fa-clipboard-list"} mr-1`}/>{c.setup_badge}
                    </span>
                  )}
                  {c.setup_badge && c.setup_overall === "complete" && (
                    <span data-testid={`client-setup-badge-${c.id}`}
                          className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-shGreen/15 text-shGreen border-shGreen/40"
                          title="First-time client setup completion">
                      <i className="fas fa-circle-check mr-1"/>Ready to Book
                    </span>
                  )}
                  {/* Sprint 110di-56 — Outstanding-balance flag. Big and
                      bright so the operator notices BEFORE booking another
                      visit. Positive = owes, negative = pre-paid credit. */}
                  {Math.abs(Number(c.account_balance || 0)) > 0.005 && (
                    <span
                      data-testid={`client-balance-flag-${c.id}`}
                      title={Number(c.account_balance) > 0
                        ? `This client owes $${Number(c.account_balance).toFixed(2)}`
                        : `Pre-paid credit on file: $${Math.abs(Number(c.account_balance)).toFixed(2)}`}
                      className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${
                        Number(c.account_balance) > 0
                          ? "bg-shOrange/20 text-shOrange border-shOrange/60 animate-pulse"
                          : "bg-shGreen/15 text-shGreen border-shGreen/40"
                      }`}
                    >
                      <i className={`fas ${Number(c.account_balance) > 0 ? "fa-file-invoice-dollar" : "fa-piggy-bank"} mr-1`}/>
                      {Number(c.account_balance) > 0 ? "Owes" : "Credit"} ${Math.abs(Number(c.account_balance)).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-400">
              {c.phone && <p><i className="fas fa-phone w-4 text-shBlue" /> {c.phone}</p>}
              {c.email && <p><i className="fas fa-envelope w-4 text-shBlue" /> {c.email}</p>}
              {c.address && <p><i className="fas fa-map-marker-alt w-4 text-shBlue" /> {c.address}</p>}
            </div>
            <div className="mt-3 border-t border-bgHover pt-3" data-testid={`client-dogs-${c.id}`}>
              <p className="text-[13px] uppercase font-black text-gray-500 tracking-widest flex items-center gap-2">
                <i className="fas fa-paw text-shGreen" /> Dogs · {(c.dogs || []).length}
              </p>
              {(c.dogs || []).length === 0 ? (
                <p className="text-[14px] text-gray-600 italic mt-1">No dogs on file</p>
              ) : (
                <ul className="mt-1 text-[15px] text-white space-y-0.5">
                  {c.dogs.map(d => (
                    <li key={d.id} data-testid={`client-dog-${d.id}`}>
                      <button onClick={()=>onJumpToDog(d.id)} data-testid={`jump-to-dog-${d.id}`}
                              className="flex items-baseline gap-2 text-left hover:text-shBlue transition group">
                        <span className="font-black uppercase tracking-tight group-hover:underline">{d.name}</span>
                        {d.breed && <span className="text-gray-500 text-[14px]">· {d.breed}</span>}
                        <i className="fas fa-arrow-right text-[12px] text-shBlue opacity-0 group-hover:opacity-100 transition" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-bgHover pt-3">
              <div>
                <p className="text-[13px] uppercase font-black text-gray-500 tracking-widest">Daycare</p>
                <p className="text-xl font-black text-shGreen" data-testid={`daycare-credits-${c.id}`}>{c.credits || 0}</p>
              </div>
              <div>
                <p className="text-[13px] uppercase font-black text-gray-500 tracking-widest">Training</p>
                <p className="text-xl font-black text-purple-400" data-testid={`training-credits-${c.id}`}>{c.training_credits || 0}</p>
              </div>
              <div>
                <p className="text-[13px] uppercase font-black text-gray-500 tracking-widest">Boarding</p>
                <p className="text-xl font-black text-shOrange" data-testid={`boarding-credits-${c.id}`}>{c.boarding_credits || 0}</p>
              </div>
              {/* Sprint 110di-51 — Running tab. Positive = client owes,
                  negative = pre-paid credit on file. Hidden when balance is
                  exactly zero (the common case for paid-in-full clients). */}
              {Math.abs(Number(c.account_balance || 0)) > 0.001 ? (
                <div>
                  <p className="text-[13px] uppercase font-black text-gray-500 tracking-widest">Tab</p>
                  <p className={`text-xl font-black ${Number(c.account_balance) > 0 ? "text-shOrange" : "text-shGreen"}`}
                     data-testid={`tab-balance-${c.id}`}>
                    {Number(c.account_balance) > 0 ? "" : "+"}
                    ${Math.abs(Number(c.account_balance || 0)).toFixed(2)}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest font-black text-gray-500">
                    {Number(c.account_balance) > 0 ? "Owes you" : "Pre-paid"}
                  </p>
                </div>
              ) : null}
              <div className="text-right">
                <p className="text-[13px] uppercase font-black text-gray-500 tracking-widest">Portal</p>
                <p className="text-[14px] text-shBlue font-black">{c.portal_email ? "Active" : "Not set"}</p>
                {c.portal_email && (
                  <p className={`text-[13px] font-black uppercase tracking-widest mt-1 ${lastLoginColor(c.last_login_at)}`}
                     title={c.last_login_at ? `Logged in ${c.login_count} time${c.login_count===1?"":"s"} · last ${c.last_login_at}` : "Hasn't logged in yet"}
                     data-testid={`last-login-${c.id}`}>
                    <i className="fas fa-clock mr-1"/>{lastLoginLabel(c.last_login_at)}
                  </p>
                )}
              </div>
            </div>
            <button onClick={async ()=>{
                      try { await startImpersonation(c.id); }
                      catch (e) {
                        const msg = formatErr(e.response?.data?.detail) || "Couldn't open portal as this client";
                        setClaimToast({ clientId: c.id, tone: "warn", msg });
                      }
                    }}
                    data-testid={`view-as-client-${c.id}`}
                    className="mt-4 w-full bg-yellow-500 text-bgHeader py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-yellow-400 flex items-center justify-center gap-2 shadow-lg">
              <i className="fas fa-user-shield"/>View Portal as {c.name?.split(" ")[0] || "Client"}
            </button>
            <button onClick={()=>setPreviewId(c.id)} data-testid={`preview-portal-${c.id}`}
                    className="mt-2 w-full bg-shBlue/10 text-shBlue py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shBlue/20 flex items-center justify-center gap-2">
              <i className="fas fa-eye"/>Quick portal snapshot
            </button>
            {claimToast && claimToast.clientId === c.id && (
              <div data-testid={`claim-toast-${c.id}`}
                   className={`mt-2 text-[14px] font-black uppercase tracking-widest rounded px-3 py-2 ${claimToast.tone === "ok" ? "bg-shGreen/15 text-shGreen" : "bg-yellow-500/15 text-yellow-300"}`}>
                <i className={`fas ${claimToast.tone === "ok" ? "fa-check" : "fa-exclamation-triangle"} mr-1`} />{claimToast.msg}
              </div>
            )}
            <ClientActionsMenu
              clientId={c.id}
              hasPortal={!!c.portal_email}
              onSendClaim={()=>sendClaimEmail(c)}
              onSetPassword={()=>openPortal(c)}
              onSellPack={()=>setSellOpen(c)}
              onSellProgram={()=>setSellProgramOpen(c)}
              onTakePayment={()=>setTakePaymentOpen(c)}
              onAdjustCredits={()=>setAdjustOpen(c)}
              onReceipts={()=>setReceiptsOpen(c)}
              onFiles={()=>setFilesOpen(c)}
              onLegacy={()=>setLegacyOpen(c)}
              onPackLots={()=>setLotsOpen(c)}
            />
            {/* Sprint 110ch — Payment plans for big-ticket items */}
            <div className="mt-3 pt-3 border-t border-bgHover">
              <AdminClientPaymentPlans clientId={c.id} plans={plansByClient[c.id]} />
            </div>
            <div className="mt-3 pt-3 border-t border-bgHover" data-testid={`client-trophy-section-${c.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[13px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-trophy mr-1"/>Trophies · {(trophyMap[c.id]||[]).length}</div>
                <button onClick={()=>setAwardPicker(c)} data-testid={`award-trophy-${c.id}`}
                        className="text-[13px] font-black uppercase tracking-widest text-shOrange hover:text-shOrange/80">+ Award</button>
              </div>
              {(trophyMap[c.id]||[]).length > 0 ? (
                <TrophyWall awards={trophyMap[c.id]} testIdPrefix={`client-trophies-${c.id}`}/>
              ) : (
                <p className="text-[13px] text-gray-500 italic">No trophies yet.</p>
              )}
            </div>
            {/* Sprint 110di-25 — Viewport-gated to prevent N+1 fetch storm
                on the Clients screen with large client lists. */}
            <LazyMount testid={`client-extra-${c.id}`} minHeight="160px">
              <IntakeFormsSection clientId={c.id} />
              <CommunicationLog clientId={c.id} />
              <div className="mt-3 pt-3 border-t border-bgHover flex items-center justify-between">
                <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">
                  <i className="fas fa-star mr-1"/>Reviews
                </span>
                <ReviewRequestButton clientId={c.id} clientName={c.name} compact={true}/>
              </div>
            </LazyMount>
          </div>
        ))}
      </div>

      {awardPicker && (
        <ManualAwardPicker
          recipientType="client"
          recipientId={awardPicker.id}
          onClose={()=>setAwardPicker(null)}
          onAwarded={()=>{ loadTrophies(clients); }}
        />
      )}

      {emailClient && (
        <SendClientEmailModal client={emailClient} onClose={()=>setEmailClient(null)} />
      )}

      {open && (
        <Modal title={editing?"Edit Client":"New Client"} onClose={()=>setOpen(false)}>
          <div className="space-y-4">
            <Input label="Name" value={form.name} onChange={(v)=>setForm({...form, name:v})} testId="client-name-input" />
            {/* Profile photo — shown as an avatar on the Clients list card. */}
            <div className="flex items-center gap-3">
              <Avatar src={form.photo} icon="fa-user" size="lg" ring="border-shBlue/40" testid="client-photo-preview"/>
              <div className="flex-1">
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Profile Photo</label>
                <div className="flex items-center gap-2 mt-1">
                  <label className="bg-shBlue/10 text-shBlue border border-shBlue/40 px-3 py-2 rounded cursor-pointer text-[15px] font-black uppercase tracking-widest hover:bg-shBlue/20" data-testid="client-photo-upload-btn">
                    <i className="fas fa-upload mr-1"/>{form.photo ? "Replace" : "Upload"}
                    <input type="file" accept="image/*" className="hidden" data-testid="client-photo-input"
                           onChange={async (e) => {
                             const f = e.target.files?.[0];
                             if (!f) return;
                             const dataUrl = await compressImage(f, { maxWidth: 600, quality: 0.8 });
                             setForm((s) => ({ ...s, photo: dataUrl }));
                             e.target.value = "";
                           }}/>
                  </label>
                  {form.photo && <button type="button" onClick={()=>setForm({...form, photo:""})} className="text-red-400 text-xs font-black uppercase">Remove</button>}
                </div>
                <p className="text-[13px] text-gray-500 mt-1 normal-case">Optional. Auto-compressed. Falls back to a placeholder icon if empty.</p>
              </div>
            </div>
            <Input label="Address" value={form.address} onChange={(v)=>setForm({...form, address:v})} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Phone" value={form.phone} onChange={(v)=>setForm({...form, phone:v})} />
              <Input label="Credits" type="number" color="text-shBlue" value={form.credits} onChange={(v)=>setForm({...form, credits:parseInt(v)||0})} testId="client-credits-input" />
            </div>
            <Input label="Email" type="email" value={form.email} onChange={(v)=>setForm({...form, email:v})} />
            <Input label="Emergency Contact" color="text-red-400" value={form.emerg} onChange={(v)=>setForm({...form, emerg:v})} />
            <div>
              <Input label="Photo Gallery URL (PicTime, Pixieset, etc.)" color="text-shGreen"
                     value={form.photo_gallery_url || ""}
                     onChange={(v)=>setForm({...form, photo_gallery_url: v.trim()})}
                     testId="client-photo-gallery-input" />
              <p className="text-[13px] text-gray-500 mt-1 normal-case"><i className="fas fa-camera-retro mr-1"/>Per-client private gallery link. Shown on their portal as &ldquo;See your pup in action — order prints&rdquo;. Leave blank if no gallery yet.</p>
            </div>
            <div>
              <Input label="Photo Gallery Download PIN" color="text-shOrange"
                     value={form.photo_gallery_pin || ""}
                     onChange={(v)=>setForm({...form, photo_gallery_pin: v.trim()})}
                     testId="client-photo-gallery-pin-input" />
              <p className="text-[13px] text-gray-500 mt-1 normal-case"><i className="fas fa-key mr-1"/>Optional. Shown to the client under &ldquo;See your pup in action&rdquo; with a copy button — used to unlock photo downloads on PicTime/Pixieset. Leave blank to hide.</p>
            </div>
            <div>
              <button type="button" onClick={()=>setForm(f => ({...f, photo_gallery_has_new: !f.photo_gallery_has_new}))}
                      data-testid="client-photo-gallery-new-toggle"
                      className={`w-full flex items-center justify-between gap-3 rounded border px-3 py-2.5 transition ${form.photo_gallery_has_new
                          ? "bg-shOrange/15 border-shOrange/60 hover:bg-shOrange/25"
                          : "bg-bgBase border-bgHover hover:border-shOrange/40"}`}>
                <div className="flex items-center gap-3 text-left">
                  <i className={`fas fa-bell ${form.photo_gallery_has_new ? "text-shOrange" : "text-gray-500"} text-lg w-6 text-center`}/>
                  <div>
                    <p className={`text-[15px] font-black uppercase tracking-widest ${form.photo_gallery_has_new ? "text-shOrange" : "text-white"}`}>
                      {form.photo_gallery_has_new ? "New photos badge: ON" : "Notify of New Photos"}
                    </p>
                    <p className="text-[13px] text-gray-500 normal-case tracking-normal">{form.photo_gallery_has_new
                      ? "Client sees a pulsing NEW badge on their gallery link. Clears when they open it."
                      : "Flip on after uploading a fresh batch to nudge the client to visit their gallery."}</p>
                  </div>
                </div>
                <span className={`text-[13px] font-black uppercase tracking-widest px-2.5 py-1 rounded ${form.photo_gallery_has_new ? "bg-shOrange/30 text-shOrange" : "bg-bgHover text-gray-400"}`}>
                  {form.photo_gallery_has_new ? "On" : "Off"}
                </span>
              </button>
            </div>
            {!editing && (
              <div className="border-t border-bgHover pt-4 -mx-1" data-testid="quick-add-dog-section">
                <button type="button" onClick={()=>setAddDog(v=>!v)} data-testid="quick-add-dog-toggle"
                        className={`w-full flex items-center justify-between gap-3 rounded border px-3 py-2.5 transition ${addDog ? "bg-shGreen/10 border-shGreen/50" : "bg-bgBase border-bgHover hover:border-shGreen/40"}`}>
                  <div className="flex items-center gap-3 text-left">
                    <i className={`fas fa-paw text-lg w-6 text-center ${addDog ? "text-shGreen" : "text-gray-500"}`}/>
                    <div>
                      <p className={`text-[15px] font-black uppercase tracking-widest ${addDog ? "text-shGreen" : "text-white"}`}>Also add a dog</p>
                      <p className="text-[13px] text-gray-500 normal-case tracking-normal">Saves a trip to the Dogs screen for new sign-ups.</p>
                    </div>
                  </div>
                  <span className={`text-[13px] font-black uppercase tracking-widest px-2.5 py-1 rounded ${addDog ? "bg-shGreen/30 text-shGreen" : "bg-bgHover text-gray-400"}`}>{addDog ? "On" : "Off"}</span>
                </button>

                {addDog && (
                  <div className="mt-3 space-y-3 bg-bgBase border border-bgHover rounded-lg p-4">
                    <Input label="Dog Name" color="text-shGreen" value={dog.name}
                           onChange={(v)=>setDog({...dog, name:v})} testId="quick-dog-name-input" />
                    <div className="grid grid-cols-2 gap-3">
                      <Input label="Breed" value={dog.breed} onChange={(v)=>setDog({...dog, breed:v})} testId="quick-dog-breed-input" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input label="Age (yrs)" type="number" value={dog.age_y} onChange={(v)=>setDog({...dog, age_y:parseInt(v)||0})} />
                        <Input label="Age (mos)" type="number" value={dog.age_m} onChange={(v)=>setDog({...dog, age_m:parseInt(v)||0})} />
                      </div>
                    </div>
                    <Input label="Birthday (optional)" type="date" value={dog.birthday}
                           onChange={(v)=>setDog({...dog, birthday:v})} testId="quick-dog-birthday-input" />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Sex</label>
                        <select value={dog.sex} onChange={(e)=>setDog({...dog, sex:e.target.value})}
                                data-testid="quick-dog-sex-select"
                                className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Fixed / Altered</label>
                        <select value={dog.fixed} onChange={(e)=>setDog({...dog, fixed:e.target.value})}
                                className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
                          <option value="No">No</option>
                          <option value="Yes">Yes</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest mb-1">Vaccine Expiry Dates + Optional Cert Photos</p>
                      <div className="space-y-2">
                        <VaccineCertRow vaccine="rabies" label="Rabies" dog={dog} setDog={setDog} testIdBase="quick-dog-rabies"/>
                        <VaccineCertRow vaccine="bordetella" label="Bordetella" dog={dog} setDog={setDog} testIdBase="quick-dog-bordetella"/>
                        <VaccineCertRow vaccine="dhpp" label="DHPP" dog={dog} setDog={setDog} testIdBase="quick-dog-dhpp"/>
                      </div>
                      <p className="text-[13px] text-gray-500 normal-case mt-1.5"><i className="fas fa-keyboard text-shBlue mr-1"/>Tip: copy a cert photo from your phone/email then press <kbd className="bg-bgPanel border border-bgHover rounded px-1.5 py-0.5 text-[12px] mx-0.5">Ctrl/Cmd + V</kbd> to drop it on the next empty cert. Leave blank to skip — the client will be prompted on their portal.</p>
                    </div>
                    <Input label="Notes (optional)" value={dog.notes} onChange={(v)=>setDog({...dog, notes:v})}
                           testId="quick-dog-notes-input" />
                    <p className="text-[13px] text-gray-500 normal-case"><i className="fas fa-circle-info text-shBlue mr-1"/>Feeding, medications, training skills, and photos can be added from the Dogs screen after save.</p>
                  </div>
                )}
              </div>
            )}
            {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={submitClient} data-testid="save-client-button" className="bg-shBlue text-white px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg">Save</button>
            </div>
          </div>
        </Modal>
      )}

      {portalOpen && (
        <Modal title="Portal Login" onClose={()=>setPortalOpen(null)}>
          <p className="text-[15px] text-gray-400 mb-4">Set the email and password the client will use to access the portal.</p>
          <div className="space-y-4">
            <Input label="Login Email" type="email" value={portalForm.email} onChange={(v)=>setPortalForm({...portalForm, email:v})} testId="portal-email-input" />
            <Input label="Password (min 6 chars)" type="password" value={portalForm.password} onChange={(v)=>setPortalForm({...portalForm, password:v})} testId="portal-password-input" />
            {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setPortalOpen(null)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={savePortal} data-testid="save-portal-button" className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg">Save Login</button>
            </div>
          </div>
        </Modal>
      )}

      {sellOpen && (
        <SellPackModal client={sellOpen} packs={packs}
                       onClose={()=>setSellOpen(null)}
                       onSold={(r)=>{ setSellOpen(null); load(); if (r?.receipt) setReceipt({ client: sellOpen, ...r.receipt }); }} />
      )}

      {sellProgramOpen && (
        <SellProgramModal client={sellProgramOpen}
                          onClose={()=>setSellProgramOpen(null)}
                          onSold={()=>{ setSellProgramOpen(null); load(); }} />
      )}

      {takePaymentOpen && (
        <TakePaymentModal presetClientId={takePaymentOpen.id}
                          onClose={()=>setTakePaymentOpen(null)}
                          onSuccess={()=>{ setTakePaymentOpen(null); load(); }} />
      )}

      {receipt && (
        <ReceiptModal data={receipt} onClose={()=>setReceipt(null)} />
      )}

      {receiptsOpen && (
        <ReceiptsListModal client={receiptsOpen}
                           onClose={()=>setReceiptsOpen(null)}
                           onReprint={(r)=>{ setReceipt({ client: receiptsOpen, ...r }); setReceiptsOpen(null); }} />
      )}
      {filesOpen && <ClientFilesModal client={filesOpen} onClose={()=>setFilesOpen(null)} />}
      {legacyOpen && <LegacyPricingModal client={legacyOpen} onClose={()=>setLegacyOpen(null)} />}
      {lotsOpen && <PackLotsModal client={lotsOpen} onClose={()=>setLotsOpen(null)} />}
      {previewId && <ClientPortalPreview clientId={previewId} onClose={()=>setPreviewId(null)} />}
      {adjustOpen && <AdjustCreditsModal client={adjustOpen} onClose={()=>setAdjustOpen(null)} onSaved={()=>{ setAdjustOpen(null); load(); }} />}
    </div>
  );
}


function AdjustCreditsModal({ client, onClose, onSaved }) {
  const [deltas, setDeltas] = useState({ daycare: 0, training: 0, boarding: 0 });
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const current = {
    daycare: client.credits || 0,
    training: client.training_credits || 0,
    boarding: client.boarding_credits || 0,
  };
  const next = {
    daycare: current.daycare + (Number(deltas.daycare) || 0),
    training: current.training + (Number(deltas.training) || 0),
    boarding: current.boarding + (Number(deltas.boarding) || 0),
  };
  const anyChange = (Number(deltas.daycare)||0) || (Number(deltas.training)||0) || (Number(deltas.boarding)||0);
  const anyNegative = next.daycare < 0 || next.training < 0 || next.boarding < 0;

  const rows = [
    { key: "daycare", label: "Daycare", color: "text-shGreen", testid: "adjust-daycare" },
    { key: "training", label: "Training", color: "text-purple-400", testid: "adjust-training" },
    { key: "boarding", label: "Boarding", color: "text-shOrange", testid: "adjust-boarding" },
  ];

  const save = async () => {
    setErr(""); setSaving(true);
    try {
      await api.post(`/clients/${client.id}/adjust-credits`, {
        daycare: Number(deltas.daycare) || 0,
        training: Number(deltas.training) || 0,
        boarding: Number(deltas.boarding) || 0,
        note,
      });
      onSaved();
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Save failed.");
    } finally { setSaving(false); }
  };

  return (
    <Modal title={`Adjust credits · ${client.name}`} onClose={onClose} maxWidth="max-w-md">
      <p className="text-[14px] text-gray-400 mb-4">
        Use positive numbers to add, negative to remove. This is for fixing data-entry mistakes or comping a client — it doesn&rsquo;t create a receipt.
      </p>
      <div className="space-y-3" data-testid="adjust-credits-modal">
        {rows.map(r => (
          <div key={r.key} className="bg-bgBase/60 border border-bgHover rounded p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] uppercase font-black text-gray-500 tracking-widest">{r.label}</p>
              <p className="text-[14px] text-gray-500">Current <span className="text-white font-black">{current[r.key]}</span> → New <span className={`font-black ${next[r.key] < 0 ? "text-red-400" : r.color}`}>{next[r.key]}</span></p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={()=>setDeltas(d => ({ ...d, [r.key]: (Number(d[r.key])||0) - 1 }))}
                      data-testid={`${r.testid}-minus`}
                      className="w-9 h-9 bg-bgHover hover:bg-red-500/30 text-red-400 rounded font-black"><i className="fas fa-minus"/></button>
              <input type="number" value={deltas[r.key]}
                     onChange={(e)=>setDeltas(d => ({ ...d, [r.key]: e.target.value }))}
                     data-testid={`${r.testid}-input`}
                     className="w-16 bg-bgPanel border border-bgHover rounded p-2 text-center text-white text-sm" />
              <button type="button" onClick={()=>setDeltas(d => ({ ...d, [r.key]: (Number(d[r.key])||0) + 1 }))}
                      data-testid={`${r.testid}-plus`}
                      className="w-9 h-9 bg-bgHover hover:bg-shGreen/30 text-shGreen rounded font-black"><i className="fas fa-plus"/></button>
            </div>
          </div>
        ))}
        <div>
          <label className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Reason / note <span className="text-gray-600 normal-case tracking-normal">(saved to audit log)</span></label>
          <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={2} data-testid="adjust-note"
                    placeholder="e.g. comp for missed appointment, fixing entry mistake…"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        </div>
        {err && <p className="text-[15px] text-red-400 font-black uppercase tracking-widest">{err}</p>}
        {anyNegative && <p className="text-[14px] text-red-400 font-black uppercase tracking-widest">Cannot drop a balance below zero.</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 text-gray-400 hover:text-white py-2 text-[15px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={!anyChange || anyNegative || saving} data-testid="adjust-save"
                  className="flex-1 bg-shOrange text-bgHeader py-2 rounded font-black text-[15px] uppercase tracking-widest shadow disabled:opacity-50">
            {saving ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </Modal>
  );
}


function SellPackModal({ client, packs, onClose, onSold }) {
  const [poolFilter, setPoolFilter] = useState("all"); // all | daycare | training
  const active = packs.filter(p => p.active && (poolFilter === "all" || p.service_type === poolFilter));
  // cart: { [pack_id]: quantity }
  const [cart, setCart] = useState({});
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // Sprint 110di-61 — Partial pay toggle on the bulk pack-sale cart.
  const [payMode, setPayMode] = useState("full"); // "full" | "partial"
  const [amountPaid, setAmountPaid] = useState("");

  const addToCart = (id) => setCart(c => ({ ...c, [id]: (c[id] || 0) + 1 }));
  const removeFromCart = (id) => setCart(c => {
    const n = (c[id] || 0) - 1;
    const next = { ...c };
    if (n <= 0) delete next[id]; else next[id] = n;
    return next;
  });
  const clearItem = (id) => setCart(c => { const n = { ...c }; delete n[id]; return n; });

  const cartItems = Object.entries(cart).map(([pid, qty]) => {
    const pack = packs.find(p => p.id === pid);
    return pack ? { pack, qty } : null;
  }).filter(Boolean);

  const totalCredits = cartItems.reduce((sum, it) => sum + (it.pack.qty * it.qty), 0);
  const totalDaycare = cartItems.filter(it => (it.pack.service_type || "daycare") === "daycare").reduce((s, it) => s + it.pack.qty * it.qty, 0);
  const totalTraining = cartItems.filter(it => it.pack.service_type === "training").reduce((s, it) => s + it.pack.qty * it.qty, 0);
  const totalBoarding = cartItems.filter(it => it.pack.service_type === "boarding").reduce((s, it) => s + it.pack.qty * it.qty, 0);
  const totalCharge = cartItems.reduce((sum, it) => sum + (it.pack.price * it.qty), 0);

  const sell = async () => {
    setBusy(true); setErr("");
    try {
      const items = cartItems.map(it => ({ pack_id: it.pack.id, quantity: it.qty }));
      const body = { items, payment_method: method, note };
      if (payMode === "partial" && amountPaid !== "") body.amount_paid = Number(amountPaid);
      const r = await api.post(`/clients/${client.id}/sell-packs`, body);
      onSold?.(r.data);
    } catch (e) {
      setErr(e.response?.data?.detail || "Sale failed");
    } finally { setBusy(false); }
  };

  return (
    <Modal title={`Sell Credit Packs · ${client.name}`} onClose={onClose}>
      {packs.filter(p=>p.active).length === 0 ? (
        <p className="text-[14px] text-gray-400">No packs configured. Set them up in <span className="text-shBlue">Settings → Credit Packs</span> first.</p>
      ) : (
        <div className="space-y-4" data-testid="sell-pack-modal">
          <div className="flex gap-2 flex-wrap">
            {[
              {k:"all", label:"All"},
              {k:"daycare", label:"Daycare", color:"text-shGreen"},
              {k:"training", label:"Training", color:"text-purple-400"},
              {k:"boarding", label:"Boarding", color:"text-shOrange"},
            ].map(p => (
              <button key={p.k} onClick={()=>setPoolFilter(p.k)} data-testid={`pool-filter-${p.k}`}
                      className={`px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest border ${poolFilter===p.k?"bg-bgBase border-shBlue text-shBlue":"border-bgHover text-gray-400 hover:text-shBlue"}`}>
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Available Packs · tap to add</label>
            <div className="mt-2 space-y-1.5 max-h-56 overflow-auto pr-1">
              {active.map(p => {
                const isTr = p.service_type === "training";
                const isBd = p.service_type === "boarding";
                const color = isTr ? "text-purple-400" : isBd ? "text-shOrange" : "text-shGreen";
                const iconHex = p.color || (isTr ? "#a855f7" : isBd ? "#f26522" : "#8cc63f");
                const unit = isTr ? "sessions" : isBd ? "nights" : "credits";
                const inCart = cart[p.id] || 0;
                return (
                  <button key={p.id} onClick={()=>addToCart(p.id)} data-testid={`add-pack-${p.id}`}
                          className={`w-full text-left flex items-center justify-between bg-bgBase border rounded p-2.5 hover:border-shBlue transition ${inCart > 0 ? "border-shBlue" : "border-bgHover"}`}>
                    <div className="min-w-0 flex-1 flex items-center gap-2.5">
                      <i className={`fas ${p.icon || (isTr ? "fa-graduation-cap" : isBd ? "fa-moon" : "fa-sun")} shrink-0`} style={{ color: iconHex }}/>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-black text-white truncate">{p.name}</p>
                        <p className={`text-[13px] uppercase tracking-widest font-bold ${color}`}>
                          {p.qty} {unit} · ${p.price.toFixed(2)} · ${p.value_each.toFixed(2)}/each
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {inCart > 0 && <span className="bg-shBlue text-bgHeader px-2 py-0.5 rounded text-[14px] font-black">×{inCart}</span>}
                      <i className="fas fa-plus text-shGreen text-[14px]" />
                    </div>
                  </button>
                );
              })}
              {active.length === 0 && <p className="text-[15px] text-gray-500 italic">No packs in this pool.</p>}
            </div>
          </div>

          {cartItems.length > 0 && (
            <div className="border border-shGreen/40 bg-shGreen/5 rounded p-3 space-y-2" data-testid="sell-cart">
              <p className="text-[13px] uppercase tracking-widest text-shGreen font-black">Cart · {cartItems.length} line item{cartItems.length === 1 ? "" : "s"}</p>
              {cartItems.map(({ pack, qty }) => {
                const isTr = pack.service_type === "training";
                const isBd = pack.service_type === "boarding";
                const color = isTr ? "text-purple-400" : isBd ? "text-shOrange" : "text-shGreen";
                const unit = isTr ? "sessions" : isBd ? "nights" : "credits";
                return (
                  <div key={pack.id} className="flex items-center justify-between gap-2 bg-bgBase rounded px-2 py-1.5" data-testid={`cart-row-${pack.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] text-white font-bold truncate">{pack.name}</p>
                      <p className={`text-[12px] uppercase tracking-widest font-bold ${color}`}>
                        {pack.qty * qty} {unit} · ${(pack.price * qty).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={()=>removeFromCart(pack.id)} data-testid={`cart-minus-${pack.id}`}
                              className="bg-bgHover text-white w-7 h-7 rounded font-black text-sm hover:bg-red-500/40">−</button>
                      <span className="text-white font-black w-6 text-center text-sm">{qty}</span>
                      <button onClick={()=>addToCart(pack.id)} data-testid={`cart-plus-${pack.id}`}
                              className="bg-bgHover text-white w-7 h-7 rounded font-black text-sm hover:bg-shGreen/40">+</button>
                      <button onClick={()=>clearItem(pack.id)} className="text-gray-500 hover:text-red-400 ml-1"><i className="fas fa-times text-xs"/></button>
                    </div>
                  </div>
                );
              })}
              <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                <div><p className="text-[12px] uppercase tracking-widest text-gray-500">Daycare</p><p className="text-shGreen text-lg font-black">+{totalDaycare}</p></div>
                <div><p className="text-[12px] uppercase tracking-widest text-gray-500">Training</p><p className="text-purple-400 text-lg font-black">+{totalTraining}</p></div>
                <div><p className="text-[12px] uppercase tracking-widest text-gray-500">Boarding</p><p className="text-shOrange text-lg font-black">+{totalBoarding}</p></div>
                <div><p className="text-[12px] uppercase tracking-widest text-gray-500">Charge</p><p className="text-white text-lg font-black" data-testid="cart-total-charge">${totalCharge.toFixed(2)}</p></div>
              </div>
            </div>
          )}

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Payment method</label>
            <select value={method} onChange={(e)=>setMethod(e.target.value)}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Transfer</option><option value="check">Check</option><option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Note (optional)</label>
            <input value={note} onChange={(e)=>setNote(e.target.value)} placeholder="e.g., birthday gift, returning customer"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          {/* Sprint 110di-61 — Partial-pay toggle. Identical UX to the
              CheckoutModal partial-pay flow. */}
          {totalCharge > 0 && (
            <div className="border-t border-bgHover pt-3">
              <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black block mb-2">
                <i className="fas fa-cash-register mr-1 text-shGreen"/>How much is the client paying today?
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={()=>{ setPayMode("full"); setAmountPaid(""); }}
                        data-testid="sell-pack-pay-full"
                        className={`p-2 rounded border-2 text-left transition ${payMode==="full" ? "border-shGreen bg-shGreen/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shGreen/50"}`}>
                  <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check-circle mr-1"/>Paid in full</div>
                </button>
                <button type="button" onClick={()=>{ setPayMode("partial"); }}
                        data-testid="sell-pack-pay-partial"
                        className={`p-2 rounded border-2 text-left transition ${payMode==="partial" ? "border-shOrange bg-shOrange/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shOrange/50"}`}>
                  <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-file-invoice-dollar mr-1"/>Partial / on tab</div>
                </button>
              </div>
              {payMode === "partial" && (
                <div className="mt-2 grid grid-cols-3 gap-3 items-end bg-shOrange/5 border border-shOrange/30 rounded p-3"
                     data-testid="sell-pack-partial-block">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">Total</p>
                    <p className="text-xl font-black text-white mt-1">${totalCharge.toFixed(2)}</p>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest text-shOrange font-black block">Paying today</label>
                    <input type="number" step="0.01" min="0" value={amountPaid}
                           onChange={(e)=>setAmountPaid(e.target.value)}
                           data-testid="sell-pack-amount-paid"
                           autoFocus placeholder="$0.00"
                           className="w-full mt-1 bg-bgPanel border-2 border-shOrange/60 rounded p-2 text-white text-lg font-black focus:border-shOrange focus:outline-none"/>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">On tab</p>
                    <p className="text-xl font-black mt-1">
                      <span className={amountPaid === "" ? "text-gray-500" : (Number(amountPaid) < totalCharge ? "text-shOrange" : (Number(amountPaid) > totalCharge ? "text-shGreen" : "text-gray-400"))}>
                        {amountPaid === "" ? `+$${totalCharge.toFixed(2)}` : Number(amountPaid) < totalCharge ? `+$${(totalCharge - Number(amountPaid)).toFixed(2)}` : Number(amountPaid) > totalCharge ? `−$${(Number(amountPaid) - totalCharge).toFixed(2)}` : "$0.00"}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-[13px] text-gray-500 italic">Income is recognized when each credit is redeemed at check-out, not now.</p>
          {err && <p className="text-red-400 text-[15px]">{err}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
            <button onClick={sell} disabled={busy || cartItems.length === 0} data-testid="confirm-sell-pack"
                    className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
              {busy ? "Selling…" : (totalCredits > 0 ? `Sell · +${totalCredits} credits · $${totalCharge.toFixed(2)}` : "Sell")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Sprint 110bw — Sell Training Program modal ─────────────────────────
function SellProgramModal({ client, onClose, onSold }) {
  const [programs, setPrograms] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [breakdown, setBreakdown] = useState(null);
  const [programId, setProgramId] = useState("");
  const [dogId, setDogId] = useState("");
  const [overridePrice, setOverridePrice] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Sprint 110ce — recurring session scheduling state. Hidden for Board & Train.
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [dow, setDow] = useState(1);          // 0=Mon … 6=Sun, default Tuesday
  const [scheduleTime, setScheduleTime] = useState("10:00");
  const [scheduleStart, setScheduleStart] = useState("");
  const [overrideClosures, setOverrideClosures] = useState(false);
  // Sprint 110di-61 — Partial-pay toggle.
  const [payMode, setPayMode] = useState("full"); // "full" | "partial"
  const [amountPaid, setAmountPaid] = useState("");

  useEffect(() => {
    (async () => {
      const [p, d, b] = await Promise.all([
        api.get("/programs?include_custom=true").catch(()=>({data:[]})),
        // Sprint 110ca — `/clients/{id}/dogs` doesn't exist; the `/dogs` endpoint
        // returns all dogs for an admin caller, so we filter to this client.
        api.get("/dogs").catch(()=>({data:[]})),
        api.get(`/admin/clients/${client.id}/training-credits`).catch(()=>({data:null})),
      ]);
      const sellable = (p.data || []).filter(pr =>
        (pr.format?.count || 0) > 0 && pr.active !== false
      );
      setPrograms(sellable);
      const clientDogs = (d.data || []).filter(dog => dog.owner_id === client.id);
      setDogs(clientDogs);
      setBreakdown(b.data);
    })();
  }, [client.id]);

  const selectedProgram = programs.find(p => p.id === programId);
  const qty = selectedProgram?.format?.count || 0;
  const unit = selectedProgram?.format?.unit || "sessions";
  const listPrice = Number(selectedProgram?.price || 0);
  const effectivePrice = overridePrice !== "" ? Number(overridePrice) : listPrice;
  const perEach = qty > 0 ? (effectivePrice / qty) : 0;

  const sell = async () => {
    if (!programId) { setError("Pick a program"); return; }
    setBusy(true); setError("");
    try {
      const body = { program_id: programId, payment_method: method, note };
      if (dogId) body.dog_id = dogId;
      if (overridePrice !== "") body.override_price = Number(overridePrice);
      // Sprint 110di-61 — Partial pay.
      if (payMode === "partial" && amountPaid !== "") body.amount_paid = Number(amountPaid);
      // Sprint 110ce — scheduling fields. Board & Train doesn't get bookings.
      const programType = selectedProgram?.type;
      if (dogId && scheduleEnabled && programType !== "board_train" && scheduleTime) {
        body.schedule_day_of_week = Number(dow);
        body.schedule_time = scheduleTime;
        if (scheduleStart) body.schedule_start_date = scheduleStart;
        if (overrideClosures) body.schedule_override_closures = true;
      }
      const r = await api.post(`/clients/${client.id}/sell-program`, body);
      const sb = r.data.scheduled_bookings || [];
      const warns = r.data.schedule_warnings || [];
      const parts = [`Sold ${r.data.lot.pack_name} · +${qty} ${unit}`];
      if (sb.length) parts.push(`${sb.length} weekly session${sb.length === 1 ? "" : "s"} booked`);
      if (warns.length) parts.push(`(${warns.length} closure${warns.length === 1 ? "" : "s"} skipped)`);
      toast.success(parts.join(" · "));
      onSold?.(r.data);
    } catch (e) {
      setError(e.response?.data?.detail || "Could not complete sale");
    } finally { setBusy(false); }
  };

  // Preview the dates that will be auto-booked so the operator can sanity-check
  const schedulePreview = useMemo(() => {
    if (!qty || !scheduleEnabled || selectedProgram?.type === "board_train") return [];
    const anchor = scheduleStart ? new Date(scheduleStart + "T00:00:00") : new Date();
    const wdTarget = Number(dow);
    const anchorWd = (anchor.getDay() + 6) % 7;  // JS Sunday=0; convert to Mon=0
    const delta = (wdTarget - anchorWd + 7) % 7;
    const first = new Date(anchor);
    first.setDate(anchor.getDate() + delta);
    const out = [];
    for (let i = 0; i < qty; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i * 7);
      out.push(d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
    }
    return out;
  }, [qty, scheduleEnabled, selectedProgram, scheduleStart, dow]);

  return (
    <Modal title={`Sell Training Program · ${client.name}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3" data-testid="sell-program-modal">
        {breakdown && breakdown.global_training_credits > 0 && (
          <div className="bg-purple-500/5 border border-purple-500/30 rounded p-2 text-[12px]">
            <p className="font-black uppercase tracking-widest text-purple-300 mb-1">
              <i className="fas fa-graduation-cap mr-1"/>Current training credits: {breakdown.global_training_credits}
            </p>
            {breakdown.by_program.length > 0 && (
              <ul className="text-gray-400 text-[11px] space-y-0.5">
                {breakdown.by_program.map(p => (
                  <li key={p.program_id}>
                    • {p.program_name}: <span className="text-shGreen font-black">{p.qty_remaining}</span> of {p.qty_total} {p.unit} left
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Program *</span>
          <select value={programId} onChange={(e)=>setProgramId(e.target.value)}
                  data-testid="sell-program-select"
                  className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
            <option value="">— pick a program —</option>
            {programs.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.format?.count} {p.format?.unit || "sessions"} · ${Number(p.price || 0).toFixed(2)}
              </option>
            ))}
          </select>
          {programs.length === 0 && (
            <p className="text-[11px] text-shOrange mt-1 italic">
              No sellable programs found. Make sure programs have a session count + price set.
            </p>
          )}
        </label>

        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">
            Assign to dog <span className="text-gray-600 normal-case">(optional)</span>
          </span>
          <select value={dogId} onChange={(e)=>setDogId(e.target.value)}
                  data-testid="sell-program-dog"
                  className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
            <option value="">{`— don't assign now (credits only) —`}</option>
            {dogs.map(d => <option key={d.id} value={d.id}>{d.name} · {d.breed || "—"}</option>)}
          </select>
          {dogId && (
            <p className="text-[11px] text-shGreen mt-1 italic">
              Will auto-enroll this dog so trainer can start logging sessions immediately.
            </p>
          )}
        </label>

        {/* Sprint 110ce — recurring session scheduler. Hidden when no dog is
            picked (need someone to book FOR) and when the program is Board &
            Train (the dog will already be on-site). */}
        {dogId && selectedProgram && selectedProgram.type !== "board_train" && (
          <div className="bg-shBlue/5 border border-shBlue/30 rounded p-3 space-y-2"
               data-testid="sell-program-schedule">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
                data-testid="sell-program-schedule-toggle"
                className="w-4 h-4 accent-shBlue"
              />
              <span className="text-[12px] font-black uppercase tracking-widest text-shBlue">
                <i className="fas fa-calendar-check mr-1"/>Auto-book {qty || "N"} weekly sessions
              </span>
            </label>
            {scheduleEnabled && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Day of week</span>
                    <select value={dow} onChange={(e) => setDow(e.target.value)}
                            data-testid="sell-program-schedule-dow"
                            className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                      {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
                        .map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">Time</span>
                    <input type="time" value={scheduleTime}
                           onChange={(e) => setScheduleTime(e.target.value)}
                           data-testid="sell-program-schedule-time"
                           className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                  </label>
                </div>
                <label className="block">
                  <span className="text-[11px] font-black uppercase tracking-widest text-gray-400">
                    Start date <span className="text-gray-600 normal-case">(blank = next occurrence)</span>
                  </span>
                  <input type="date" value={scheduleStart}
                         onChange={(e) => setScheduleStart(e.target.value)}
                         data-testid="sell-program-schedule-start"
                         className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                </label>
                <label className="flex items-center gap-2 text-[11px] text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideClosures}
                    onChange={(e) => setOverrideClosures(e.target.checked)}
                    data-testid="sell-program-override-closures"
                    className="w-3 h-3 accent-orange-500"
                  />
                  <span>Book even on closed days (skip the auto-skip)</span>
                </label>
                {schedulePreview.length > 0 && (
                  <div className="bg-bgBase/60 border border-bgHover rounded p-2 mt-2"
                       data-testid="sell-program-schedule-preview">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">
                      <i className="fas fa-eye mr-1"/>Sessions preview · {schedulePreview.length} weekly
                    </p>
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      {schedulePreview.slice(0, 12).map((d, i) => (
                        <span key={i} className="bg-bgHover text-gray-300 rounded px-1.5 py-0.5">{d} · {scheduleTime}</span>
                      ))}
                      {schedulePreview.length > 12 && (
                        <span className="text-gray-500 text-[10px] self-center">… +{schedulePreview.length - 12} more</span>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1 italic">
                      Closed-day dates will be skipped automatically (rolling forward 7 days each time).
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Price ($)</span>
            <input type="number" min="0" step="0.01"
                   value={overridePrice}
                   placeholder={listPrice ? listPrice.toFixed(2) : "0.00"}
                   onChange={(e)=>setOverridePrice(e.target.value)}
                   data-testid="sell-program-price"
                   className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
            {overridePrice !== "" && Number(overridePrice) !== listPrice && (
              <p className="text-[11px] text-shOrange mt-1 italic">
                {Number(overridePrice) < listPrice ? "Discount" : "Surcharge"} applied
              </p>
            )}
          </label>
          <label className="block">
            <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Payment</span>
            <select value={method} onChange={(e)=>setMethod(e.target.value)}
                    data-testid="sell-program-method"
                    className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="venmo">Venmo</option>
              <option value="check">Check</option>
              <option value="other">Other</option>
              <option value="complimentary">Complimentary</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Note <span className="text-gray-600 normal-case">(optional)</span></span>
          <input type="text" value={note} onChange={(e)=>setNote(e.target.value)}
                 data-testid="sell-program-note"
                 className="mt-1 w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        </label>

        {selectedProgram && (
          <div className="bg-bgBase/60 border border-bgHover rounded p-3 text-[13px]" data-testid="sell-program-summary">
            <p className="font-black uppercase tracking-widest text-shGreen mb-2">
              <i className="fas fa-receipt mr-1"/>Summary
            </p>
            <p className="text-gray-300">
              {selectedProgram.name} · {qty} {unit}
            </p>
            <p className="text-gray-400 text-[12px] mt-1">
              ${effectivePrice.toFixed(2)} total · ${perEach.toFixed(2)} per {unit.replace(/s$/, "")}
            </p>
          </div>
        )}

        {/* Sprint 110di-61 — Partial-pay toggle for program sales. */}
        {selectedProgram && effectivePrice > 0 && (
          <div className="border-t border-bgHover pt-3">
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black block mb-2">
              <i className="fas fa-cash-register mr-1 text-shGreen"/>How much is the client paying today?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={()=>{ setPayMode("full"); setAmountPaid(""); }}
                      data-testid="sell-program-pay-full"
                      className={`p-2 rounded border-2 text-left transition ${payMode==="full" ? "border-shGreen bg-shGreen/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shGreen/50"}`}>
                <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check-circle mr-1"/>Paid in full</div>
              </button>
              <button type="button" onClick={()=>setPayMode("partial")}
                      data-testid="sell-program-pay-partial"
                      className={`p-2 rounded border-2 text-left transition ${payMode==="partial" ? "border-shOrange bg-shOrange/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shOrange/50"}`}>
                <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-file-invoice-dollar mr-1"/>Partial / on tab</div>
              </button>
            </div>
            {payMode === "partial" && (
              <div className="mt-2 grid grid-cols-3 gap-3 items-end bg-shOrange/5 border border-shOrange/30 rounded p-3" data-testid="sell-program-partial-block">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">Total</p>
                  <p className="text-xl font-black text-white mt-1">${effectivePrice.toFixed(2)}</p>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-shOrange font-black block">Paying today</label>
                  <input type="number" step="0.01" min="0" value={amountPaid}
                         onChange={(e)=>setAmountPaid(e.target.value)}
                         data-testid="sell-program-amount-paid"
                         autoFocus placeholder="$0.00"
                         className="w-full mt-1 bg-bgPanel border-2 border-shOrange/60 rounded p-2 text-white text-lg font-black focus:border-shOrange focus:outline-none"/>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">On tab</p>
                  <p className="text-xl font-black mt-1">
                    <span className={amountPaid === "" ? "text-gray-500" : (Number(amountPaid) < effectivePrice ? "text-shOrange" : (Number(amountPaid) > effectivePrice ? "text-shGreen" : "text-gray-400"))}>
                      {amountPaid === "" ? `+$${effectivePrice.toFixed(2)}` : Number(amountPaid) < effectivePrice ? `+$${(effectivePrice - Number(amountPaid)).toFixed(2)}` : Number(amountPaid) > effectivePrice ? `−$${(Number(amountPaid) - effectivePrice).toFixed(2)}` : "$0.00"}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-red-400 text-[13px] font-black uppercase tracking-widest" data-testid="sell-program-error">
            <i className="fas fa-circle-exclamation mr-1"/>{error}
          </p>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 text-gray-400 py-3 text-[14px] font-black uppercase tracking-widest">
            Cancel
          </button>
          <button onClick={sell} disabled={busy || !programId}
                  data-testid="sell-program-confirm"
                  className="flex-1 bg-purple-500 text-white py-3 rounded font-black text-[14px] uppercase tracking-widest disabled:opacity-50">
            {busy ? <><i className="fas fa-circle-notch fa-spin mr-1"/>Selling…</> : <><i className="fas fa-check mr-1"/>Confirm sale</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}



function Modal({ title, children, onClose, maxWidth = "max-w-md" }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
      <div className={`bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full ${maxWidth} p-5 sm:p-8 shadow-2xl animate-slide-in max-h-[95vh] sm:max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between mb-5 sm:mb-6 sticky top-0 bg-bgPanel pt-1 -mt-1 z-10">
          <h4 className="text-lg sm:text-xl font-black text-white uppercase italic tracking-tight pr-3">{title}</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl shrink-0 p-1 -m-1"><i className="fas fa-times" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReceiptsListModal({ client, onClose, onReprint }) {
  const [receipts, setReceipts] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`/clients/${client.id}/receipts`)
      .then(r => { if (alive) setReceipts(r.data || []); })
      .catch(e => { if (alive) setErr(e.response?.data?.detail || "Failed to load receipts"); });
    return () => { alive = false; };
  }, [client.id]);

  return (
    <Modal title={`Receipts · ${client.name}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="space-y-3 max-h-[60vh] overflow-auto" data-testid="receipts-list">
        {err && <p className="text-red-400 text-[15px]">{err}</p>}
        {receipts === null && !err && <p className="text-gray-500 text-[15px]">Loading…</p>}
        {receipts && receipts.length === 0 && (
          <p className="text-[14px] text-gray-400 italic">No pack purchases yet. Sales will appear here automatically.</p>
        )}
        {receipts && receipts.map((r, i) => {
          const dt = new Date(r.sold_at);
          const dc = r.totals?.daycare?.qty || 0;
          const tr = r.totals?.training?.qty || 0;
          return (
            <div key={i} data-testid={`receipt-row-${i}`}
                 className="bg-bgBase border border-bgHover rounded p-3 hover:border-shBlue transition">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-black text-white">{dt.toLocaleDateString()} · {dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                  <p className="text-[13px] uppercase tracking-widest text-gray-500 mt-0.5">
                    {r.line_count} item{r.line_count === 1 ? "" : "s"} · {r.lot_count} pack{r.lot_count === 1 ? "" : "s"} · {r.payment_method} · {r.sold_by}
                  </p>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    {dc > 0 && <span className="text-[12px] uppercase tracking-widest font-black text-shGreen bg-shGreen/10 px-2 py-0.5 rounded">+{dc} daycare</span>}
                    {tr > 0 && <span className="text-[12px] uppercase tracking-widest font-black text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">+{tr} training</span>}
                  </div>
                  {r.note && <p className="text-[14px] text-gray-400 italic mt-1.5 truncate">&ldquo;{r.note}&rdquo;</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-shGreen text-xl font-black">${r.total_price.toFixed(2)}</p>
                  <button onClick={()=>onReprint(r)} data-testid={`reprint-${i}`}
                          className="mt-1.5 text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-white">
                    <i className="fas fa-print mr-1"/>Reprint
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end pt-4">
        <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Close</button>
      </div>
    </Modal>
  );
}

function ReceiptModal({ data, onClose }) {
  const { client, lines = [], totals = {}, total_price = 0, payment_method = "cash", note = "", sold_by = "", sold_at = "" } = data || {};
  const dc = totals.daycare?.qty || 0;
  const tr = totals.training?.qty || 0;
  const bd = totals.boarding?.qty || 0;
  const dateStr = sold_at ? new Date(sold_at).toLocaleString() : new Date().toLocaleString();
  const print = () => window.print();

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-50 print:bg-white print:p-0 print:block" data-testid="pack-receipt">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg shadow-2xl print:shadow-none print:bg-white print:border-0 print:rounded-none print:max-w-none print:w-full">
        {/* Header (hidden in print) */}
        <div className="flex items-center justify-between p-6 border-b border-bgHover print:hidden">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-receipt text-shGreen mr-2"/>Sale Complete
          </h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white" data-testid="receipt-close"><i className="fas fa-times"/></button>
        </div>

        {/* Printable receipt body */}
        <div id="pack-receipt-print" className="p-6 text-white print:text-black print:p-10">
          <div className="border-b border-bgHover pb-4 mb-4 print:border-gray-300">
            <p className="text-[13px] uppercase tracking-widest text-shGreen print:text-gray-600 font-black">Sit Happens · Receipt</p>
            <h3 className="text-2xl font-black mt-1 uppercase tracking-tight print:text-black">{client?.name}</h3>
            <p className="text-[14px] text-gray-400 print:text-gray-600 mt-1">{dateStr} · Sold by {sold_by}</p>
          </div>

          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600">
                <th className="text-left font-black pb-2">Item</th>
                <th className="text-right font-black pb-2">Qty</th>
                <th className="text-right font-black pb-2">Each</th>
                <th className="text-right font-black pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-bgHover print:border-gray-300" data-testid={`receipt-line-${i}`}>
                  <td className="py-2.5 font-bold">
                    {l.name}
                    <p className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-bold">
                      {(l.pack_qty || 0) * l.qty} {l.service_type === "training" ? "training sessions" : l.service_type === "boarding" ? "boarding nights" : "daycare credits"}
                    </p>
                  </td>
                  <td className="text-right py-2.5 font-bold">{l.qty}</td>
                  <td className="text-right py-2.5">${l.unit_price.toFixed(2)}</td>
                  <td className="text-right py-2.5 font-black">${l.line_total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[15px]">
            {dc > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Daycare credits added</p>
                <p className="text-shGreen text-2xl font-black print:text-black">+{dc}</p>
              </div>
            )}
            {tr > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Training sessions added</p>
                <p className="text-purple-400 text-2xl font-black print:text-black">+{tr}</p>
              </div>
            )}
            {bd > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Boarding nights added</p>
                <p className="text-shOrange text-2xl font-black print:text-black">+{bd}</p>
              </div>
            )}
          </div>

          <div className="mt-5 border-t-2 border-shGreen pt-3 flex items-end justify-between print:border-black">
            <div>
              <p className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Payment · {payment_method}</p>
              <p className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black mt-1">Credits never expire</p>
            </div>
            <div className="text-right">
              <p className="text-[12px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Total charged</p>
              <p className="text-shGreen text-3xl font-black print:text-black" data-testid="receipt-total">${total_price.toFixed(2)}</p>
            </div>
          </div>

          {note && <p className="mt-4 text-[14px] text-gray-400 italic print:text-gray-600">Note: {note}</p>}

          <p className="mt-6 text-[13px] text-gray-500 print:text-gray-600 text-center">
            Sit Happens Dog Training · Daycare · Boarding<br/>
            Thank you for your business!
          </p>
        </div>

        {/* Actions (hidden in print) */}
        <div className="flex justify-end gap-3 p-6 border-t border-bgHover print:hidden">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest" data-testid="receipt-done">Done</button>
          <button onClick={print} data-testid="receipt-print"
                  className="bg-shBlue text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg hover:bg-shBlue/90">
            <i className="fas fa-print mr-2"/>Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

export function Input({ label, value, onChange, type="text", color="text-gray-500", testId }) {
  return (
    <div>
      <label className={`text-[14px] font-black uppercase tracking-widest ${color}`}>{label}</label>
      <input type={type} value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId}
             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
    </div>
  );
}

export { Modal };

/** Vaccine row inside the quick-add-dog section: date input + optional cert
 *  photo with file-picker, drag-drop, and clipboard paste (Cmd/Ctrl+V) entry
 *  points. Used during the New Client flow so the admin can attach the cert
 *  the moment the client texts/emails it during sign-up. */
function VaccineCertRow({ vaccine, label, dog, setDog, testIdBase }) {
  const photoKey = `${vaccine}_photo`;
  const photo = dog[photoKey] || "";
  const date = dog[vaccine] || "";
  const [err, setErr] = useState("");

  const ingest = async (file) => {
    if (!file) return;
    setErr("");
    try {
      const compressed = await compressImage(file, { maxWidth: 1400, maxHeight: 1400, quality: 0.78 });
      setDog((d) => ({ ...d, [photoKey]: compressed }));
    } catch {
      setErr("Couldn't read that image.");
    }
  };

  const onFile = (e) => ingest(e.target.files?.[0]);
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) ingest(f);
  };
  const onPasteRow = async (e) => {
    const items = e.clipboardData?.items || [];
    for (const it of items) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        e.preventDefault();
        ingest(it.getAsFile());
        return;
      }
    }
  };

  return (
    <div className="bg-bgPanel border border-bgHover rounded p-2"
         onPaste={onPasteRow} onDragOver={(e)=>e.preventDefault()} onDrop={onDrop}
         data-testid={`${testIdBase}-row`}>
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-4">
          <p className="text-[13px] font-black text-gray-300 uppercase tracking-widest">{label}</p>
        </div>
        <div className="col-span-5">
          <input type="date" value={date}
                 onChange={(e)=>setDog({...dog, [vaccine]: e.target.value})}
                 data-testid={`${testIdBase}-input`} style={{colorScheme:"dark"}}
                 className="w-full bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" />
        </div>
        <div className="col-span-3 flex justify-end gap-1.5">
          {photo ? (
            <>
              <img src={photo} alt={`${label} cert`} className="h-8 w-8 object-cover rounded border border-shGreen/40"
                   data-testid={`${testIdBase}-preview`} title="Cert attached"/>
              <button type="button" onClick={()=>setDog((d)=>({...d, [photoKey]: ""}))}
                      data-testid={`${testIdBase}-photo-clear`}
                      className="text-[12px] font-black uppercase tracking-widest text-red-400 hover:text-red-300 px-1">Clear</button>
            </>
          ) : (
            <label className="bg-bgBase border border-bgHover rounded px-2 py-1 text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-shGreen hover:border-shGreen/40 cursor-pointer"
                   data-testid={`${testIdBase}-photo-label`}>
              <i className="fas fa-paperclip mr-1"/>Cert
              <input type="file" accept="image/*" className="hidden" onChange={onFile}
                     data-testid={`${testIdBase}-photo-input`}/>
            </label>
          )}
        </div>
      </div>
      {err && <p className="text-[13px] text-red-400 mt-1 normal-case">{err}</p>}
    </div>
  );
}


// Format ISO timestamp into a friendly "5d ago" / "3h ago" / "Today" label, or
// "Never" if the client has never logged in. Used in the Portal column so admin
// can spot which clients are actually using the app.
function lastLoginLabel(iso) {
  if (!iso) return "Never logged in";
  const t = new Date(iso).getTime();
  if (!t) return "Never logged in";
  const mins = (Date.now() - t) / 60000;
  if (mins < 2) return "Just now";
  if (mins < 60) return `${Math.floor(mins)} min ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 14) return `${Math.floor(days)}d ago`;
  const weeks = days / 7;
  if (weeks < 9) return `${Math.floor(weeks)}w ago`;
  const months = days / 30;
  return `${Math.floor(months)}mo ago`;
}

// Color codes recency: green = active, gray = quiet, red = stale (>90 days).
function lastLoginColor(iso) {
  if (!iso) return "text-gray-500";
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days < 7) return "text-shGreen";
  if (days < 30) return "text-shBlue";
  if (days < 90) return "text-gray-400";
  return "text-red-400";
}

// Sprint 110aw — Meet-n-Greet client status pill. Click to advance the
// client through prospect → evaluation_scheduled → evaluated → active /
// rejected. Hidden when the client is already `active`.
function ClientStatusPill({ status, clientId, onChange }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const labels = {
    prospect: { text: "Prospect", color: "bg-shOrange/20 text-shOrange border-shOrange/40" },
    evaluation_scheduled: { text: "Eval Scheduled", color: "bg-shBlue/20 text-shBlue border-shBlue/40" },
    evaluated: { text: "Evaluated", color: "bg-purple-500/20 text-purple-400 border-purple-500/40" },
    rejected: { text: "Rejected", color: "bg-red-500/20 text-red-400 border-red-500/40" },
    active: { text: "Active", color: "bg-shGreen/20 text-shGreen border-shGreen/40" },
  };
  const meta = labels[status] || labels.prospect;
  const setStatus = async (newStatus) => {
    setBusy(true);
    try {
      await api.post(`/clients/${clientId}/status`, { status: newStatus, note });
      setOpen(false); setNote(""); onChange?.();
    } catch (e) {
      alert(e.response?.data?.detail || "Failed to update status");
    } finally { setBusy(false); }
  };
  return (
    <>
      <button onClick={(e)=>{ e.stopPropagation(); setOpen(true); }}
              data-testid={`client-status-pill-${clientId}`}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border mt-1 ${meta.color} hover:opacity-80`}>
        <i className="fas fa-handshake text-[10px]"/>{meta.text}
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={()=>setOpen(false)}>
          <div className="bg-bgPanel border border-bgHover rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e)=>e.stopPropagation()}
               data-testid="client-status-modal">
            <h4 className="text-lg font-black text-white uppercase italic mb-2">Update client status</h4>
            <p className="text-[13px] text-gray-400 mb-3">Current: <strong className="text-white">{meta.text}</strong></p>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)}
                      placeholder="Optional note (e.g. 'Passed eval — friendly with all sizes')"
                      data-testid="client-status-note"
                      className="block w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm mb-3" rows={2}/>
            <div className="grid grid-cols-1 gap-2">
              {["evaluation_scheduled", "evaluated", "active", "rejected"].filter(s => s !== status).map(s => (
                <button key={s} onClick={()=>setStatus(s)} disabled={busy}
                        data-testid={`client-status-set-${s}`}
                        className={`px-3 py-2 rounded font-black text-[12px] uppercase tracking-widest border text-left ${labels[s].color} hover:opacity-80 disabled:opacity-50`}>
                  <i className="fas fa-chevron-right mr-2 text-[10px]"/>{labels[s].text}
                </button>
              ))}
              <button onClick={()=>setOpen(false)} disabled={busy}
                      className="text-gray-400 hover:text-white font-black text-[12px] uppercase tracking-widest mt-1 py-2">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}




// ─── Sprint 110dk — Collapse client card action buttons into one popover ────
// Single "MANAGE CLIENT ▾" button that opens a floating menu of every
// secondary admin action. Reduces client-card scroll by ~75%. Color cues
// preserved per item so visual scanning still works.
//
// IMPLEMENTATION NOTE: The menu is rendered via React portal at document.body
// because each client card has `isolation: isolate` (Sprint 110dj) for splatter
// clipping — that traps any z-index inside the card and would hide the
// popover behind the next card in the grid. Portal + fixed positioning
// (computed from the trigger's bounding rect) escapes all stacking contexts.
function ClientActionsMenu({
  clientId, hasPortal,
  onSendClaim, onSetPassword, onSellPack, onSellProgram, onTakePayment,
  onAdjustCredits, onReceipts, onFiles, onLegacy, onPackLots,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  // Recompute position when opened OR when window resizes / scrolls.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      // Open downward by default; if it would overflow the viewport, flip up.
      const menuMaxH = 460;
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < 320 && r.top > spaceBelow;
      setPos({
        left: r.left,
        top: openUp ? Math.max(8, r.top - menuMaxH - 8) : r.bottom + 6,
        width: r.width,
        openUp,
      });
    };
    reposition();
    const onDocClick = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const fire = (fn) => () => { setOpen(false); fn && fn(); };

  const items = [
    { label: hasPortal ? "Send password reset email" : "Send claim account email",
      icon: "fa-envelope", color: "text-shGreen", onClick: onSendClaim,
      testId: `menu-send-claim-${clientId}` },
    { label: hasPortal ? "Manually set portal password" : "Manually create portal login",
      icon: "fa-key", color: "text-shBlue", onClick: onSetPassword,
      testId: `menu-set-password-${clientId}` },
    { divider: true },
    { label: "Sell Credit Pack", icon: "fa-coins", color: "text-shGreen",
      onClick: onSellPack, testId: `menu-sell-pack-${clientId}` },
    { label: "Sell Training Program", icon: "fa-graduation-cap", color: "text-purple-300",
      onClick: onSellProgram, testId: `menu-sell-program-${clientId}` },
    // Sprint 110di-61 — Take a standalone payment (settle a tab, prepay).
    { label: "Take Payment", icon: "fa-cash-register", color: "text-shGreen",
      onClick: onTakePayment, testId: `menu-take-payment-${clientId}` },
    { label: "Adjust Credits", icon: "fa-plus-minus", color: "text-shOrange",
      onClick: onAdjustCredits, testId: `menu-adjust-credits-${clientId}` },
    { divider: true },
    { label: "Receipts", icon: "fa-receipt", color: "text-gray-300",
      onClick: onReceipts, testId: `menu-receipts-${clientId}` },
    { label: "Files & Homework", icon: "fa-folder-open", color: "text-shBlue",
      onClick: onFiles, testId: `menu-files-${clientId}` },
    { label: "Legacy Pricing", icon: "fa-lock", color: "text-amber-400",
      onClick: onLegacy, testId: `menu-legacy-${clientId}` },
    { label: "View Pack Lots", icon: "fa-layer-group", color: "text-shBlue",
      onClick: onPackLots, testId: `menu-pack-lots-${clientId}` },
  ];

  const menu = open ? createPortal(
    <div ref={menuRef}
         data-testid={`manage-client-menu-${clientId}`}
         role="menu"
         style={{
           position: "fixed",
           left: pos.left,
           top: pos.top,
           width: pos.width,
           zIndex: 9999,
           // Solid opaque dark fill so the menu is visually distinct from the
           // card behind it (cards have semi-transparent grunge gradients).
           backgroundColor: "#0a1426",
           backgroundImage: "linear-gradient(155deg, rgba(10,20,38,1) 0%, rgba(4,10,22,1) 100%)",
         }}
         className="border-2 border-shBlue rounded-lg shadow-[0_28px_56px_-12px_rgba(0,0,0,0.95),0_0_28px_rgba(0,174,240,0.45)] overflow-hidden">
      {items.map((it, i) => it.divider ? (
        <div key={`d${i}`} className="h-px bg-bgHover" />
      ) : (
        <button key={it.label}
                role="menuitem"
                onClick={fire(it.onClick)}
                data-testid={it.testId}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-shBlue/15 transition group">
          <i className={`fas ${it.icon} ${it.color} w-4 text-center`} />
          <span className={`text-[14px] font-black uppercase tracking-widest ${it.color}`}>{it.label}</span>
          <i className="fas fa-chevron-right ml-auto text-[10px] text-gray-600 group-hover:text-gray-300 transition" />
        </button>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div className="mt-2">
      <button ref={triggerRef}
              onClick={()=>setOpen(o=>!o)}
              data-testid={`manage-client-toggle-${clientId}`}
              aria-expanded={open}
              className="w-full bg-bgBase border-2 border-shBlue/60 text-shBlue py-2.5 rounded text-[15px] font-black uppercase tracking-widest hover:border-shBlue hover:bg-shBlue/10 flex items-center justify-center gap-2 transition shadow-[0_0_14px_rgba(0,174,240,0.25)]">
        <i className="fas fa-bars-staggered" />
        Manage Client
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[12px] transition-transform`} />
      </button>
      {menu}
    </div>
  );
}
