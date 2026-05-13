import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";

const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const VAX_OPTIONS = [
  { key: "rabies", label: "Rabies" },
  { key: "bordetella", label: "Bordetella" },
  { key: "dhpp", label: "DHPP" },
  { key: "lepto", label: "Leptospirosis" },
  { key: "flu", label: "Canine Flu" },
  { key: "heartworm", label: "Heartworm" },
];

export default function Settings() {
  const { user } = useAuth();
  const [s, setS] = useState(null);
  const [tab, setTab] = useState("hours");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // password
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwMsg, setPwMsg] = useState("");

  useEffect(() => { (async () => { const { data } = await api.get("/settings"); setS(data); })(); }, []);

  const save = async (partial) => {
    setSaving(true); setMsg("");
    try {
      const { data } = await api.put("/settings", partial);
      setS(data);
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) { setMsg(formatErr(e.response?.data?.detail)); }
    setSaving(false);
  };

  const changePw = async () => {
    setPwMsg("");
    if (pw.next !== pw.confirm) { setPwMsg("New passwords don't match"); return; }
    try {
      await api.post("/auth/change-password", { current_password: pw.current, new_password: pw.next });
      setPwMsg("Password updated");
      setPw({ current: "", next: "", confirm: "" });
    } catch (e) { setPwMsg(formatErr(e.response?.data?.detail)); }
  };

  if (!s) return <div className="text-gray-400 text-sm">Loading settings…</div>;

  const tabs = [
    { id: "hours", label: "Hours", icon: "fa-clock" },
    { id: "capacity", label: "Capacity & Kennels", icon: "fa-warehouse" },
    { id: "rules", label: "Booking Rules", icon: "fa-clipboard-list" },
    { id: "vaccines", label: "Vaccines", icon: "fa-shield-virus" },
    { id: "tags", label: "Mood Tags", icon: "fa-tags" },
    { id: "account", label: "Account", icon: "fa-user-shield" },
  ];

  return (
    <div className="animate-slide-in" data-testid="settings-screen">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Settings</h3>
        {msg && <span className={`text-[10px] font-black uppercase tracking-widest ${msg==="Saved"?"text-shGreen":"text-red-400"}`}>{msg}</span>}
      </div>

      <div className="flex gap-6">
        <nav className="w-56 shrink-0 space-y-1">
          {tabs.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} data-testid={`settings-tab-${t.id}`}
                    className={`w-full text-left py-3 px-4 rounded-lg text-[11px] font-black uppercase tracking-widest transition ${tab===t.id?"bg-bgPanel border-l-4 border-shBlue text-shBlue":"hover:bg-bgHover text-gray-400"}`}>
              <i className={`fas ${t.icon} mr-3 w-4`} /> {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 bg-bgPanel border border-bgHover rounded-xl p-6 shadow-2xl">
          {tab === "hours" && <HoursPanel s={s} save={save} saving={saving} />}
          {tab === "capacity" && <CapacityPanel s={s} save={save} saving={saving} />}
          {tab === "rules" && <RulesPanel s={s} save={save} saving={saving} />}
          {tab === "vaccines" && <VaccinesPanel s={s} save={save} saving={saving} />}
          {tab === "tags" && <TagsPanel s={s} save={save} saving={saving} />}
          {tab === "account" && (
            <div className="space-y-5 max-w-md" data-testid="account-panel">
              <div>
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Signed in as</p>
                <p className="text-sm text-white font-black mt-1">{user.name} · {user.email}</p>
              </div>
              <div className="border-t border-bgHover pt-5 space-y-3">
                <h4 className="text-xs font-black text-shBlue uppercase tracking-widest mb-2">Change Password</h4>
                <Field label="Current Password" type="password" value={pw.current} onChange={(v)=>setPw({...pw,current:v})} testId="current-pw" />
                <Field label="New Password" type="password" value={pw.next} onChange={(v)=>setPw({...pw,next:v})} testId="new-pw" />
                <Field label="Confirm New Password" type="password" value={pw.confirm} onChange={(v)=>setPw({...pw,confirm:v})} testId="confirm-pw" />
                {pwMsg && <div className={`text-[10px] font-black uppercase tracking-widest p-2 rounded ${pwMsg==="Password updated"?"bg-shGreen/15 text-shGreen":"bg-red-500/15 text-red-400"}`}>{pwMsg}</div>}
                <button onClick={changePw} data-testid="save-password" className="bg-shBlue text-white px-6 py-2 rounded font-black text-[10px] uppercase tracking-widest shadow">Update Password</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type="text", testId }) {
  return (
    <div>
      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{label}</label>
      <input type={type} value={value} onChange={(e)=>onChange(e.target.value)} data-testid={testId}
             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
    </div>
  );
}

function HoursPanel({ s, save, saving }) {
  const [biz, setBiz] = useState(s.business_hours);
  const [svc, setSvc] = useState(s.service_hours);

  const setBizDay = (day, k, v) => setBiz({ ...biz, [day]: { ...biz[day], [k]: v } });
  const setSvcDay = (svcKey, day, k, v) => setSvc({ ...svc, [svcKey]: { ...svc[svcKey], [day]: { ...svc[svcKey][day], [k]: v } } });

  return (
    <div className="space-y-6" data-testid="hours-panel">
      <Section title="Business Hours" subtitle="Default operating hours for your facility.">
        {DAYS.map(d => (
          <DayRow key={d} day={d} val={biz[d]} onChange={(k,v)=>setBizDay(d,k,v)} testPrefix={`biz-${d}`} />
        ))}
      </Section>

      {["daycare","training"].map(svcKey => (
        <Section key={svcKey} title={`${svcKey[0].toUpperCase()+svcKey.slice(1)} Hours`} subtitle={`Override hours just for ${svcKey}.`}>
          {DAYS.map(d => {
            const val = (svc[svcKey] && svc[svcKey][d]) || biz[d];
            return <DayRow key={d} day={d} val={val} onChange={(k,v)=>setSvcDay(svcKey,d,k,v)} testPrefix={`${svcKey}-${d}`} />;
          })}
        </Section>
      ))}

      <Section title="Boarding" subtitle="Boarding is treated as 24/7 by default. Capacity is enforced per night.">
        <div className="text-[10px] font-black text-shGreen uppercase tracking-widest bg-shGreen/10 rounded p-3">24/7 — overnight stays allowed</div>
      </Section>

      <SaveBar onSave={()=>save({ business_hours: biz, service_hours: svc })} saving={saving} />
    </div>
  );
}

function DayRow({ day, val, onChange, testPrefix }) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 py-2 border-b border-bgHover/30">
      <div className="col-span-3 text-[11px] font-black uppercase tracking-widest text-gray-300">{day}</div>
      <div className="col-span-3">
        <input type="time" value={val.open||""} disabled={val.closed} onChange={(e)=>onChange("open", e.target.value)} data-testid={`${testPrefix}-open`}
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-xs text-white disabled:opacity-40" style={{colorScheme:"dark"}} />
      </div>
      <div className="col-span-3">
        <input type="time" value={val.close||""} disabled={val.closed} onChange={(e)=>onChange("close", e.target.value)} data-testid={`${testPrefix}-close`}
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-xs text-white disabled:opacity-40" style={{colorScheme:"dark"}} />
      </div>
      <label className="col-span-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-gray-400 cursor-pointer">
        <input type="checkbox" checked={!!val.closed} onChange={(e)=>onChange("closed", e.target.checked)} data-testid={`${testPrefix}-closed`} className="accent-shOrange" />
        Closed
      </label>
    </div>
  );
}

function CapacityPanel({ s, save, saving }) {
  const [dcCap, setDcCap] = useState(s.daycare_capacity);
  const [bdCap, setBdCap] = useState(s.boarding_capacity);
  const [kennels, setKennels] = useState(s.kennels || []);
  const [newK, setNewK] = useState("");

  return (
    <div className="space-y-6" data-testid="capacity-panel">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Daycare Daily Capacity" type="number" value={dcCap} onChange={(v)=>setDcCap(parseInt(v)||0)} testId="daycare-cap" />
        <Field label="Boarding Nightly Capacity" type="number" value={bdCap} onChange={(v)=>setBdCap(parseInt(v)||0)} testId="boarding-cap" />
      </div>

      <Section title="Kennels / Rooms" subtitle="Named spaces for boarding assignment.">
        <div className="space-y-2">
          {kennels.map((k, i) => (
            <div key={i} className="flex items-center gap-2 bg-bgBase rounded p-2">
              <input value={k} onChange={(e)=>{const c=[...kennels]; c[i]=e.target.value; setKennels(c);}}
                     className="flex-1 bg-transparent text-sm text-white outline-none" data-testid={`kennel-${i}`} />
              <button onClick={()=>setKennels(kennels.filter((_,j)=>j!==i))} className="text-red-400 hover:text-red-300 px-2"><i className="fas fa-trash text-xs" /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <input value={newK} onChange={(e)=>setNewK(e.target.value)} placeholder="New kennel/room name"
                   className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-sm text-white" data-testid="new-kennel-input" />
            <button onClick={()=>{ if(newK.trim()){ setKennels([...kennels, newK.trim()]); setNewK(""); } }} data-testid="add-kennel"
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[10px] uppercase tracking-widest">+ Add</button>
          </div>
        </div>
      </Section>

      <SaveBar onSave={()=>save({ daycare_capacity: dcCap, boarding_capacity: bdCap, kennels })} saving={saving} />
    </div>
  );
}

function RulesPanel({ s, save, saving }) {
  const [r, setR] = useState(s.booking_rules || {});
  const set = (k, v) => setR({ ...r, [k]: v });

  return (
    <div className="space-y-6" data-testid="rules-panel">
      <Section title="Booking Policy">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Max advance booking (days)" type="number" value={r.max_advance_days||0} onChange={(v)=>set("max_advance_days", parseInt(v)||0)} testId="max-advance" />
          <Field label="Cancellation cutoff (hours)" type="number" value={r.cancellation_cutoff_hours||0} onChange={(v)=>set("cancellation_cutoff_hours", parseInt(v)||0)} testId="cancel-cutoff" />
        </div>
        <label className="flex items-center gap-3 mt-4 cursor-pointer">
          <input type="checkbox" checked={!!r.auto_approve} onChange={(e)=>set("auto_approve", e.target.checked)} data-testid="auto-approve" className="accent-shGreen w-4 h-4" />
          <span className="text-[11px] font-black uppercase tracking-widest text-gray-300">Auto-approve client bookings (skip pending step)</span>
        </label>
      </Section>

      <Section title="Credit Costs (per day / per night)">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Daycare" type="number" value={r.daycare_cost||0} onChange={(v)=>set("daycare_cost", parseInt(v)||0)} testId="cost-daycare" />
          <Field label="Boarding (per night)" type="number" value={r.boarding_cost_per_night||0} onChange={(v)=>set("boarding_cost_per_night", parseInt(v)||0)} testId="cost-boarding" />
          <Field label="Training" type="number" value={r.training_cost||0} onChange={(v)=>set("training_cost", parseInt(v)||0)} testId="cost-training" />
        </div>
      </Section>

      <SaveBar onSave={()=>save({ booking_rules: r })} saving={saving} />
    </div>
  );
}

function VaccinesPanel({ s, save, saving }) {
  const [req, setReq] = useState(s.required_vaccines || []);
  const [warn, setWarn] = useState(s.vaccine_warning_days || 30);
  const toggle = (k) => setReq(req.includes(k) ? req.filter(x=>x!==k) : [...req, k]);
  return (
    <div className="space-y-6" data-testid="vaccines-panel">
      <Section title="Required Vaccines" subtitle="Dogs missing any required vaccine cannot be booked.">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {VAX_OPTIONS.map(v => (
            <button key={v.key} onClick={()=>toggle(v.key)} data-testid={`vax-${v.key}`}
                    className={`py-3 px-4 rounded border text-[11px] font-black uppercase tracking-widest transition ${req.includes(v.key)?"bg-shGreen text-bgHeader border-shGreen":"bg-bgBase text-gray-400 border-bgHover hover:border-shGreen/50"}`}>
              {v.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Alert Threshold">
        <Field label="Days before expiry to flag as 'expiring soon'" type="number" value={warn} onChange={(v)=>setWarn(parseInt(v)||0)} testId="warn-days" />
      </Section>
      <SaveBar onSave={()=>save({ required_vaccines: req, vaccine_warning_days: warn })} saving={saving} />
    </div>
  );
}

function TagsPanel({ s, save, saving }) {
  const [tags, setTags] = useState(s.mood_tags || []);
  const [newT, setNewT] = useState("");
  return (
    <div className="space-y-4" data-testid="tags-panel">
      <Section title="Pup Report Card Mood Tags" subtitle="These appear as pill buttons on the report card modal.">
        <div className="flex flex-wrap gap-2">
          {tags.map((t,i)=>(
            <div key={i} className="flex items-center gap-2 bg-shGreen/15 text-shGreen border border-shGreen/40 rounded-full pl-3 pr-1 py-1">
              <input value={t} onChange={(e)=>{const c=[...tags]; c[i]=e.target.value; setTags(c);}}
                     className="bg-transparent text-[11px] font-black uppercase tracking-widest outline-none w-32" data-testid={`tag-${i}`} />
              <button onClick={()=>setTags(tags.filter((_,j)=>j!==i))} className="text-shGreen/70 hover:text-red-400 px-1">×</button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <input value={newT} onChange={(e)=>setNewT(e.target.value)} placeholder="Add a tag (e.g. Loves the Hose)"
                 className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-sm text-white" data-testid="new-tag-input" />
          <button onClick={()=>{ if(newT.trim()){ setTags([...tags, newT.trim()]); setNewT(""); } }} data-testid="add-tag"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[10px] uppercase tracking-widest">+ Add Tag</button>
        </div>
      </Section>
      <SaveBar onSave={()=>save({ mood_tags: tags })} saving={saving} />
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div>
      <h4 className="text-xs font-black text-shBlue uppercase tracking-widest">{title}</h4>
      {subtitle && <p className="text-[11px] text-gray-500 mt-1">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SaveBar({ onSave, saving }) {
  return (
    <div className="flex justify-end pt-4 border-t border-bgHover">
      <button onClick={onSave} disabled={saving} data-testid="save-settings"
              className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[10px] uppercase tracking-widest shadow-xl disabled:opacity-50">
        {saving?"Saving…":"Save Changes"}
      </button>
    </div>
  );
}
