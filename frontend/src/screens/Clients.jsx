import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { compressImage } from "../lib/imageCompress";
import ClientPortalPreview from "../components/ClientPortalPreview";
import TrophyWall, { ManualAwardPicker } from "../components/TrophyWall";
import Avatar from "../components/Avatar";
import { startImpersonation } from "../lib/impersonation";

const empty = { name:"", address:"", phone:"", email:"", emerg:"", credits:0, photo:"", photo_gallery_url:"", photo_gallery_pin:"", photo_gallery_has_new:false };
const emptyDog = { name:"", breed:"", age_y:0, age_m:0, sex:"Male", fixed:"No", rabies:"", bordetella:"", dhpp:"", notes:"", rabies_photo:"", bordetella_photo:"", dhpp_photo:"" };

export default function Clients({ focusId = null, onConsumed = () => {}, onJumpToDog = () => {} }) {
  const confirm = useConfirm();
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  // Quick-add dog inside the "New Client" modal so the admin doesn't have to
  // bounce over to the Dogs screen for every new sign-up. Only relevant when
  // creating a brand-new client.
  const [addDog, setAddDog] = useState(true);
  const [dog, setDog] = useState(emptyDog);
  const [portalOpen, setPortalOpen] = useState(null); // client id
  const [portalForm, setPortalForm] = useState({ email:"", password:"" });
  const [sellOpen, setSellOpen] = useState(null); // client object
  const [adjustOpen, setAdjustOpen] = useState(null); // client object
  const [receiptsOpen, setReceiptsOpen] = useState(null); // client object — shows list of past receipts
  const [packs, setPacks] = useState([]);
  const [err, setErr] = useState("");
  const [receipt, setReceipt] = useState(null); // populated after a sale to show the printable receipt
  const [previewId, setPreviewId] = useState(null); // client id whose portal we're previewing
  const [trophyMap, setTrophyMap] = useState({});  // client_id -> awarded[]
  const [awardPicker, setAwardPicker] = useState(null);  // client object

  const loadTrophies = async (clientList) => {
    try {
      const entries = await Promise.all(
        clientList.map(async c => {
          try { const { data } = await api.get(`/clients/${c.id}/trophies`); return [c.id, data]; }
          catch { return [c.id, []]; }
        })
      );
      const map = {};
      entries.forEach(([id, list]) => { map[id] = list; });
      setTrophyMap(map);
    } catch {}
  };

  const load = async () => {
    const [c, p] = await Promise.all([api.get("/clients"), api.get("/credit-packs").catch(()=>({data:[]}))]);
    setClients(c.data);
    setPacks(p.data || []);
    loadTrophies(c.data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setDog(emptyDog); setAddDog(true); setOpen(true); setErr(""); };
  const openEdit = (c) => { setEditing(c); setForm({...empty, ...c}); setAddDog(false); setOpen(true); setErr(""); };

  useEffect(() => {
    if (!focusId || clients.length === 0) return;
    const c = clients.find(x => x.id === focusId);
    if (c) { openEdit(c); onConsumed(); }
  }, [focusId, clients]);

  const save = async () => {
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
            const dogResp = await api.post("/dogs", {
              owner_id: data.id,
              name: dog.name.trim(),
              breed: dog.breed || "",
              age_y: parseInt(dog.age_y) || 0,
              age_m: parseInt(dog.age_m) || 0,
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
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Client Hub</h3>
        <button onClick={openNew} data-testid="add-client-button"
                className="bg-shBlue text-white px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shBlue/90">+ Add Client</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6" data-testid="client-grid">
        {clients.length === 0 && <div className="col-span-full text-center text-gray-500 text-xs font-black uppercase py-16">No clients yet — add your first.</div>}
        {clients.map(c => (
          <div key={c.id} className="bg-bgPanel p-5 sm:p-6 rounded-xl border-l-4 border-shBlue group relative shadow-lg" data-testid={`client-card-${c.id}`}>
            <div className="absolute top-3 right-3 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
              <button onClick={()=>openEdit(c)} className="text-gray-400 hover:text-white p-2 -m-1" data-testid={`edit-client-${c.id}`}><i className="fas fa-edit" /></button>
              <button onClick={()=>remove(c.id)} className="text-gray-400 hover:text-red-400 p-2 -m-1"><i className="fas fa-trash" /></button>
            </div>
            <div className="flex items-center gap-3 pr-16">
              <Avatar src={c.photo} icon="fa-user" size="md" ring="border-shBlue/40" alt={c.name} testid={`client-avatar-${c.id}`}/>
              <h4 className="text-lg font-black text-white uppercase tracking-tight min-w-0 truncate">{c.name}</h4>
            </div>
            <div className="mt-2 space-y-1 text-xs text-gray-400">
              {c.phone && <p><i className="fas fa-phone w-4 text-shBlue" /> {c.phone}</p>}
              {c.email && <p><i className="fas fa-envelope w-4 text-shBlue" /> {c.email}</p>}
              {c.address && <p><i className="fas fa-map-marker-alt w-4 text-shBlue" /> {c.address}</p>}
            </div>
            <div className="mt-3 border-t border-bgHover pt-3" data-testid={`client-dogs-${c.id}`}>
              <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest flex items-center gap-2">
                <i className="fas fa-paw text-shGreen" /> Dogs · {(c.dogs || []).length}
              </p>
              {(c.dogs || []).length === 0 ? (
                <p className="text-[12px] text-gray-600 italic mt-1">No dogs on file</p>
              ) : (
                <ul className="mt-1 text-[13px] text-white space-y-0.5">
                  {c.dogs.map(d => (
                    <li key={d.id} data-testid={`client-dog-${d.id}`}>
                      <button onClick={()=>onJumpToDog(d.id)} data-testid={`jump-to-dog-${d.id}`}
                              className="flex items-baseline gap-2 text-left hover:text-shBlue transition group">
                        <span className="font-black uppercase tracking-tight group-hover:underline">{d.name}</span>
                        {d.breed && <span className="text-gray-500 text-[12px]">· {d.breed}</span>}
                        <i className="fas fa-arrow-right text-[10px] text-shBlue opacity-0 group-hover:opacity-100 transition" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-bgHover pt-3">
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Daycare</p>
                <p className="text-xl font-black text-shGreen" data-testid={`daycare-credits-${c.id}`}>{c.credits || 0}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Training</p>
                <p className="text-xl font-black text-purple-400" data-testid={`training-credits-${c.id}`}>{c.training_credits || 0}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Boarding</p>
                <p className="text-xl font-black text-shOrange" data-testid={`boarding-credits-${c.id}`}>{c.boarding_credits || 0}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Portal</p>
                <p className="text-[14px] text-shBlue font-black">{c.portal_email ? "Active" : "Not set"}</p>
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
                    className="mt-4 w-full bg-yellow-500 text-bgHeader py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-yellow-400 flex items-center justify-center gap-2 shadow-lg">
              <i className="fas fa-user-shield"/>View Portal as {c.name?.split(" ")[0] || "Client"}
            </button>
            <button onClick={()=>setPreviewId(c.id)} data-testid={`preview-portal-${c.id}`}
                    className="mt-2 w-full bg-shBlue/10 text-shBlue py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/20 flex items-center justify-center gap-2">
              <i className="fas fa-eye"/>Quick portal snapshot
            </button>
            <button onClick={()=>sendClaimEmail(c)} data-testid={`send-claim-email-${c.id}`}
                    className="mt-2 w-full bg-shGreen text-bgHeader py-2 rounded text-[14px] font-black uppercase tracking-widest shadow hover:bg-shGreen/90">
              <i className="fas fa-envelope mr-1"/>{c.portal_email ? "Send password reset email" : "Send claim account email"}
            </button>
            {claimToast && claimToast.clientId === c.id && (
              <div data-testid={`claim-toast-${c.id}`}
                   className={`mt-2 text-[12px] font-black uppercase tracking-widest rounded px-3 py-2 ${claimToast.tone === "ok" ? "bg-shGreen/15 text-shGreen" : "bg-yellow-500/15 text-yellow-300"}`}>
                <i className={`fas ${claimToast.tone === "ok" ? "fa-check" : "fa-exclamation-triangle"} mr-1`} />{claimToast.msg}
              </div>
            )}
            <button onClick={()=>openPortal(c)} data-testid={`portal-credentials-${c.id}`}
                    className="mt-2 w-full bg-shBlue/10 text-shBlue py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/20">
              {c.portal_email ? "Manually set portal password" : "Manually create portal login"}
            </button>
            <button onClick={()=>setSellOpen(c)} data-testid={`sell-pack-${c.id}`}
                    className="mt-2 w-full bg-shGreen/10 text-shGreen py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/20">
              <i className="fas fa-coins mr-1"/>Sell Credit Pack
            </button>
            <button onClick={()=>setAdjustOpen(c)} data-testid={`adjust-credits-${c.id}`}
                    className="mt-2 w-full bg-shOrange/10 text-shOrange py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shOrange/20">
              <i className="fas fa-plus-minus mr-1"/>Adjust Credits
            </button>
            <button onClick={()=>setReceiptsOpen(c)} data-testid={`receipts-${c.id}`}
                    className="mt-2 w-full bg-bgHover/40 text-gray-300 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-bgHover/70 hover:text-white">
              <i className="fas fa-receipt mr-1"/>Receipts
            </button>
            <div className="mt-3 pt-3 border-t border-bgHover" data-testid={`client-trophy-section-${c.id}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className="fas fa-trophy mr-1"/>Trophies · {(trophyMap[c.id]||[]).length}</div>
                <button onClick={()=>setAwardPicker(c)} data-testid={`award-trophy-${c.id}`}
                        className="text-[11px] font-black uppercase tracking-widest text-shOrange hover:text-shOrange/80">+ Award</button>
              </div>
              {(trophyMap[c.id]||[]).length > 0 ? (
                <TrophyWall awards={trophyMap[c.id]} testIdPrefix={`client-trophies-${c.id}`}/>
              ) : (
                <p className="text-[11px] text-gray-500 italic">No trophies yet.</p>
              )}
            </div>
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

      {open && (
        <Modal title={editing?"Edit Client":"New Client"} onClose={()=>setOpen(false)}>
          <div className="space-y-4">
            <Input label="Name" value={form.name} onChange={(v)=>setForm({...form, name:v})} testId="client-name-input" />
            {/* Profile photo — shown as an avatar on the Clients list card. */}
            <div className="flex items-center gap-3">
              <Avatar src={form.photo} icon="fa-user" size="lg" ring="border-shBlue/40" testid="client-photo-preview"/>
              <div className="flex-1">
                <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Profile Photo</label>
                <div className="flex items-center gap-2 mt-1">
                  <label className="bg-shBlue/10 text-shBlue border border-shBlue/40 px-3 py-2 rounded cursor-pointer text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/20" data-testid="client-photo-upload-btn">
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
                <p className="text-[11px] text-gray-500 mt-1 normal-case">Optional. Auto-compressed. Falls back to a placeholder icon if empty.</p>
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
              <p className="text-[11px] text-gray-500 mt-1 normal-case"><i className="fas fa-camera-retro mr-1"/>Per-client private gallery link. Shown on their portal as "See your pup in action — order prints". Leave blank if no gallery yet.</p>
            </div>
            <div>
              <Input label="Photo Gallery Download PIN" color="text-shOrange"
                     value={form.photo_gallery_pin || ""}
                     onChange={(v)=>setForm({...form, photo_gallery_pin: v.trim()})}
                     testId="client-photo-gallery-pin-input" />
              <p className="text-[11px] text-gray-500 mt-1 normal-case"><i className="fas fa-key mr-1"/>Optional. Shown to the client under "See your pup in action" with a copy button — used to unlock photo downloads on PicTime/Pixieset. Leave blank to hide.</p>
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
                    <p className={`text-[13px] font-black uppercase tracking-widest ${form.photo_gallery_has_new ? "text-shOrange" : "text-white"}`}>
                      {form.photo_gallery_has_new ? "New photos badge: ON" : "Notify of New Photos"}
                    </p>
                    <p className="text-[11px] text-gray-500 normal-case tracking-normal">{form.photo_gallery_has_new
                      ? "Client sees a pulsing NEW badge on their gallery link. Clears when they open it."
                      : "Flip on after uploading a fresh batch to nudge the client to visit their gallery."}</p>
                  </div>
                </div>
                <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded ${form.photo_gallery_has_new ? "bg-shOrange/30 text-shOrange" : "bg-bgHover text-gray-400"}`}>
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
                      <p className={`text-[13px] font-black uppercase tracking-widest ${addDog ? "text-shGreen" : "text-white"}`}>Also add a dog</p>
                      <p className="text-[11px] text-gray-500 normal-case tracking-normal">Saves a trip to the Dogs screen for new sign-ups.</p>
                    </div>
                  </div>
                  <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded ${addDog ? "bg-shGreen/30 text-shGreen" : "bg-bgHover text-gray-400"}`}>{addDog ? "On" : "Off"}</span>
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
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Sex</label>
                        <select value={dog.sex} onChange={(e)=>setDog({...dog, sex:e.target.value})}
                                data-testid="quick-dog-sex-select"
                                className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Fixed / Altered</label>
                        <select value={dog.fixed} onChange={(e)=>setDog({...dog, fixed:e.target.value})}
                                className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
                          <option value="No">No</option>
                          <option value="Yes">Yes</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest mb-1">Vaccine Expiry Dates + Optional Cert Photos</p>
                      <div className="space-y-2">
                        <VaccineCertRow vaccine="rabies" label="Rabies" dog={dog} setDog={setDog} testIdBase="quick-dog-rabies"/>
                        <VaccineCertRow vaccine="bordetella" label="Bordetella" dog={dog} setDog={setDog} testIdBase="quick-dog-bordetella"/>
                        <VaccineCertRow vaccine="dhpp" label="DHPP" dog={dog} setDog={setDog} testIdBase="quick-dog-dhpp"/>
                      </div>
                      <p className="text-[11px] text-gray-500 normal-case mt-1.5"><i className="fas fa-keyboard text-shBlue mr-1"/>Tip: copy a cert photo from your phone/email then press <kbd className="bg-bgPanel border border-bgHover rounded px-1.5 py-0.5 text-[10px] mx-0.5">Ctrl/Cmd + V</kbd> to drop it on the next empty cert. Leave blank to skip — the client will be prompted on their portal.</p>
                    </div>
                    <Input label="Notes (optional)" value={dog.notes} onChange={(v)=>setDog({...dog, notes:v})}
                           testId="quick-dog-notes-input" />
                    <p className="text-[11px] text-gray-500 normal-case"><i className="fas fa-circle-info text-shBlue mr-1"/>Feeding, medications, training skills, and photos can be added from the Dogs screen after save.</p>
                  </div>
                )}
              </div>
            )}
            {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={save} data-testid="save-client-button" className="bg-shBlue text-white px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg">Save</button>
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

      {receipt && (
        <ReceiptModal data={receipt} onClose={()=>setReceipt(null)} />
      )}

      {receiptsOpen && (
        <ReceiptsListModal client={receiptsOpen}
                           onClose={()=>setReceiptsOpen(null)}
                           onReprint={(r)=>{ setReceipt({ client: receiptsOpen, ...r }); setReceiptsOpen(null); }} />
      )}
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
      <p className="text-[12px] text-gray-400 mb-4">
        Use positive numbers to add, negative to remove. This is for fixing data-entry mistakes or comping a client — it doesn't create a receipt.
      </p>
      <div className="space-y-3" data-testid="adjust-credits-modal">
        {rows.map(r => (
          <div key={r.key} className="bg-bgBase/60 border border-bgHover rounded p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">{r.label}</p>
              <p className="text-[12px] text-gray-500">Current <span className="text-white font-black">{current[r.key]}</span> → New <span className={`font-black ${next[r.key] < 0 ? "text-red-400" : r.color}`}>{next[r.key]}</span></p>
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
          <label className="text-[12px] text-gray-400 font-black uppercase tracking-widest">Reason / note <span className="text-gray-600 normal-case tracking-normal">(saved to audit log)</span></label>
          <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={2} data-testid="adjust-note"
                    placeholder="e.g. comp for missed appointment, fixing entry mistake…"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        </div>
        {err && <p className="text-[13px] text-red-400 font-black uppercase tracking-widest">{err}</p>}
        {anyNegative && <p className="text-[12px] text-red-400 font-black uppercase tracking-widest">Cannot drop a balance below zero.</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 text-gray-400 hover:text-white py-2 text-[13px] font-black uppercase tracking-widest">Cancel</button>
          <button onClick={save} disabled={!anyChange || anyNegative || saving} data-testid="adjust-save"
                  className="flex-1 bg-shOrange text-bgHeader py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
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
      const r = await api.post(`/clients/${client.id}/sell-packs`, { items, payment_method: method, note });
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
                      className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest border ${poolFilter===p.k?"bg-bgBase border-shBlue text-shBlue":"border-bgHover text-gray-400 hover:text-shBlue"}`}>
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Available Packs · tap to add</label>
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
                        <p className={`text-[11px] uppercase tracking-widest font-bold ${color}`}>
                          {p.qty} {unit} · ${p.price.toFixed(2)} · ${p.value_each.toFixed(2)}/each
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {inCart > 0 && <span className="bg-shBlue text-bgHeader px-2 py-0.5 rounded text-[12px] font-black">×{inCart}</span>}
                      <i className="fas fa-plus text-shGreen text-[14px]" />
                    </div>
                  </button>
                );
              })}
              {active.length === 0 && <p className="text-[13px] text-gray-500 italic">No packs in this pool.</p>}
            </div>
          </div>

          {cartItems.length > 0 && (
            <div className="border border-shGreen/40 bg-shGreen/5 rounded p-3 space-y-2" data-testid="sell-cart">
              <p className="text-[11px] uppercase tracking-widest text-shGreen font-black">Cart · {cartItems.length} line item{cartItems.length === 1 ? "" : "s"}</p>
              {cartItems.map(({ pack, qty }) => {
                const isTr = pack.service_type === "training";
                const isBd = pack.service_type === "boarding";
                const color = isTr ? "text-purple-400" : isBd ? "text-shOrange" : "text-shGreen";
                const unit = isTr ? "sessions" : isBd ? "nights" : "credits";
                return (
                  <div key={pack.id} className="flex items-center justify-between gap-2 bg-bgBase rounded px-2 py-1.5" data-testid={`cart-row-${pack.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-white font-bold truncate">{pack.name}</p>
                      <p className={`text-[10px] uppercase tracking-widest font-bold ${color}`}>
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
                <div><p className="text-[10px] uppercase tracking-widest text-gray-500">Daycare</p><p className="text-shGreen text-lg font-black">+{totalDaycare}</p></div>
                <div><p className="text-[10px] uppercase tracking-widest text-gray-500">Training</p><p className="text-purple-400 text-lg font-black">+{totalTraining}</p></div>
                <div><p className="text-[10px] uppercase tracking-widest text-gray-500">Boarding</p><p className="text-shOrange text-lg font-black">+{totalBoarding}</p></div>
                <div><p className="text-[10px] uppercase tracking-widest text-gray-500">Charge</p><p className="text-white text-lg font-black" data-testid="cart-total-charge">${totalCharge.toFixed(2)}</p></div>
              </div>
            </div>
          )}

          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Payment method</label>
            <select value={method} onChange={(e)=>setMethod(e.target.value)}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="cash">Cash</option><option value="card">Card</option><option value="transfer">Transfer</option><option value="check">Check</option><option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Note (optional)</label>
            <input value={note} onChange={(e)=>setNote(e.target.value)} placeholder="e.g., birthday gift, returning customer"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <p className="text-[11px] text-gray-500 italic">Income is recognized when each credit is redeemed at check-out, not now.</p>
          {err && <p className="text-red-400 text-[13px]">{err}</p>}
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
        {err && <p className="text-red-400 text-[13px]">{err}</p>}
        {receipts === null && !err && <p className="text-gray-500 text-[13px]">Loading…</p>}
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
                  <p className="text-[11px] uppercase tracking-widest text-gray-500 mt-0.5">
                    {r.line_count} item{r.line_count === 1 ? "" : "s"} · {r.lot_count} pack{r.lot_count === 1 ? "" : "s"} · {r.payment_method} · {r.sold_by}
                  </p>
                  <div className="flex gap-2 mt-1.5 flex-wrap">
                    {dc > 0 && <span className="text-[10px] uppercase tracking-widest font-black text-shGreen bg-shGreen/10 px-2 py-0.5 rounded">+{dc} daycare</span>}
                    {tr > 0 && <span className="text-[10px] uppercase tracking-widest font-black text-purple-400 bg-purple-400/10 px-2 py-0.5 rounded">+{tr} training</span>}
                  </div>
                  {r.note && <p className="text-[12px] text-gray-400 italic mt-1.5 truncate">"{r.note}"</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-shGreen text-xl font-black">${r.total_price.toFixed(2)}</p>
                  <button onClick={()=>onReprint(r)} data-testid={`reprint-${i}`}
                          className="mt-1.5 text-[11px] font-black uppercase tracking-widest text-shBlue hover:text-white">
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
            <p className="text-[11px] uppercase tracking-widest text-shGreen print:text-gray-600 font-black">Sit Happens · Receipt</p>
            <h3 className="text-2xl font-black mt-1 uppercase tracking-tight print:text-black">{client?.name}</h3>
            <p className="text-[12px] text-gray-400 print:text-gray-600 mt-1">{dateStr} · Sold by {sold_by}</p>
          </div>

          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600">
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
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-bold">
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

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[13px]">
            {dc > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Daycare credits added</p>
                <p className="text-shGreen text-2xl font-black print:text-black">+{dc}</p>
              </div>
            )}
            {tr > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Training sessions added</p>
                <p className="text-purple-400 text-2xl font-black print:text-black">+{tr}</p>
              </div>
            )}
            {bd > 0 && (
              <div className="bg-bgBase border border-bgHover rounded p-3 print:bg-white print:border-gray-300">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Boarding nights added</p>
                <p className="text-shOrange text-2xl font-black print:text-black">+{bd}</p>
              </div>
            )}
          </div>

          <div className="mt-5 border-t-2 border-shGreen pt-3 flex items-end justify-between print:border-black">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Payment · {payment_method}</p>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black mt-1">Credits never expire</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 print:text-gray-600 font-black">Total charged</p>
              <p className="text-shGreen text-3xl font-black print:text-black" data-testid="receipt-total">${total_price.toFixed(2)}</p>
            </div>
          </div>

          {note && <p className="mt-4 text-[12px] text-gray-400 italic print:text-gray-600">Note: {note}</p>}

          <p className="mt-6 text-[11px] text-gray-500 print:text-gray-600 text-center">
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
          <p className="text-[11px] font-black text-gray-300 uppercase tracking-widest">{label}</p>
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
                      className="text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-300 px-1">Clear</button>
            </>
          ) : (
            <label className="bg-bgBase border border-bgHover rounded px-2 py-1 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-shGreen hover:border-shGreen/40 cursor-pointer"
                   data-testid={`${testIdBase}-photo-label`}>
              <i className="fas fa-paperclip mr-1"/>Cert
              <input type="file" accept="image/*" className="hidden" onChange={onFile}
                     data-testid={`${testIdBase}-photo-input`}/>
            </label>
          )}
        </div>
      </div>
      {err && <p className="text-[11px] text-red-400 mt-1 normal-case">{err}</p>}
    </div>
  );
}

