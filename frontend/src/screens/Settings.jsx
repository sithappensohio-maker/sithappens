import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../lib/useConfirm";
import ServicesSettings from "../components/ServicesSettings";
import CreditPacksSettings from "../components/CreditPacksSettings";
import IconPicker from "../components/IconPicker";
import { useTheme, FONT_OPTIONS } from "../lib/theme";

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
    { id: "brand", label: "Brand & Theme", icon: "fa-palette" },
    { id: "capacity", label: "Capacity & Kennels", icon: "fa-warehouse" },
    { id: "rules", label: "Booking Rules", icon: "fa-clipboard-list" },
    { id: "vaccines", label: "Vaccines", icon: "fa-shield-virus" },
    { id: "tags", label: "Mood Tags", icon: "fa-tags" },
    { id: "waiver", label: "Waiver", icon: "fa-file-signature" },
    { id: "service_info", label: "Service Info", icon: "fa-circle-info" },
    { id: "portal_links", label: "Portal Links", icon: "fa-link" },
    { id: "marketing_qr", label: "Marketing QR", icon: "fa-qrcode" },
    { id: "services", label: "Services & Programs", icon: "fa-dollar-sign" },
    { id: "credit_packs", label: "Credit Packs", icon: "fa-coins" },
    { id: "commands", label: "Training Commands", icon: "fa-graduation-cap" },
    { id: "backup", label: "Backup & Restore", icon: "fa-database" },
    { id: "errors", label: "Server Errors", icon: "fa-triangle-exclamation" },
    { id: "automation", label: "Email Automation", icon: "fa-paper-plane" },
    { id: "account", label: "Account", icon: "fa-user-shield" },
  ];

  return (
    <div className="animate-slide-in" data-testid="settings-screen">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Settings</h3>
        {msg && <span className={`text-[14px] font-black uppercase tracking-widest ${msg==="Saved"?"text-shGreen":"text-red-400"}`}>{msg}</span>}
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        <nav className="w-full md:w-56 md:shrink-0 flex md:block overflow-x-auto md:overflow-visible gap-1 md:space-y-1 md:gap-0 pb-2 md:pb-0">
          {tabs.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} data-testid={`settings-tab-${t.id}`}
                    className={`shrink-0 md:w-full text-left py-3 px-4 rounded-lg text-[15px] font-black uppercase tracking-widest transition whitespace-nowrap ${tab===t.id?"bg-bgPanel border-l-4 border-shBlue text-shBlue":"hover:bg-bgHover text-gray-400"}`}>
              <i className={`fas ${t.icon} mr-3 w-4`} /> {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 bg-bgPanel border border-bgHover rounded-xl p-4 md:p-6 shadow-2xl overflow-x-auto">
          {tab === "hours" && <HoursPanel s={s} save={save} saving={saving} />}
          {tab === "brand" && <BrandPanel />}
          {tab === "capacity" && <CapacityPanel s={s} save={save} saving={saving} />}
          {tab === "rules" && <RulesPanel s={s} save={save} saving={saving} />}
          {tab === "vaccines" && <VaccinesPanel s={s} save={save} saving={saving} />}
          {tab === "tags" && <TagsPanel s={s} save={save} saving={saving} />}
          {tab === "waiver" && <WaiverPanel s={s} save={save} saving={saving} />}
          {tab === "service_info" && <ServiceInfoPanel s={s} save={save} saving={saving} />}
          {tab === "portal_links" && <PortalLinksPanel s={s} save={save} saving={saving} />}
          {tab === "marketing_qr" && <MarketingQRPanel />}
          {tab === "services" && <ServicesSettings />}
          {tab === "credit_packs" && <CreditPacksSettings />}
          {tab === "commands" && <CommandsPanel />}
          {tab === "backup" && <BackupPanel />}
          {tab === "errors" && <ErrorsPanel />}
          {tab === "automation" && <AutomationPanel />}
          {tab === "account" && (
            <div className="space-y-5 max-w-md" data-testid="account-panel">
              <div>
                <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Signed in as</p>
                <p className="text-sm text-white font-black mt-1">{user.name} · {user.email}</p>
              </div>
              <div className="border-t border-bgHover pt-5 space-y-3">
                <h4 className="text-xs font-black text-shBlue uppercase tracking-widest mb-2">Change Password</h4>
                <Field label="Current Password" type="password" value={pw.current} onChange={(v)=>setPw({...pw,current:v})} testId="current-pw" />
                <Field label="New Password" type="password" value={pw.next} onChange={(v)=>setPw({...pw,next:v})} testId="new-pw" />
                <Field label="Confirm New Password" type="password" value={pw.confirm} onChange={(v)=>setPw({...pw,confirm:v})} testId="confirm-pw" />
                {pwMsg && <div className={`text-[14px] font-black uppercase tracking-widest p-2 rounded ${pwMsg==="Password updated"?"bg-shGreen/15 text-shGreen":"bg-red-500/15 text-red-400"}`}>{pwMsg}</div>}
                <button onClick={changePw} data-testid="save-password" className="bg-shBlue text-white px-6 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow">Update Password</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BrandPanel() {
  const ctx = useTheme();
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (ctx?.branding && !draft) setDraft({ ...ctx.branding });
  }, [ctx?.branding, draft]);

  if (!ctx || !draft) return <div className="text-gray-400 text-sm">Loading…</div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(ctx.branding);

  const onSave = async () => {
    setSaving(true); setMsg("");
    try {
      await ctx.saveBranding({
        brand_primary: draft.brand_primary,
        brand_accent: draft.brand_accent,
        brand_warning: draft.brand_warning,
        brand_font_family: draft.brand_font_family,
        brand_footer_text: draft.brand_footer_text,
        brand_footer_url: draft.brand_footer_url,
        grad_hero_color:    draft.grad_hero_color,
        grad_info_color:    draft.grad_info_color,
        grad_warning_color: draft.grad_warning_color,
        grad_danger_color:  draft.grad_danger_color,
        grad_success_color: draft.grad_success_color,
      });
      setMsg("Saved");
      setTimeout(() => setMsg(""), 1800);
    } catch (e) {
      setMsg("Failed to save");
    }
    setSaving(false);
  };

  const reset = () => {
    setDraft({
      brand_primary: "#8cc63f",
      brand_accent:  "#00a9e0",
      brand_warning: "#f26522",
      brand_font_family: "Inter",
      brand_footer_text: "Sit Happens",
      brand_footer_url: "",
      grad_hero_color:    "#8cc63f",
      grad_info_color:    "#00a9e0",
      grad_warning_color: "#f59e0b",
      grad_danger_color:  "#ef4444",
      grad_success_color: "#8cc63f",
    });
  };

  return (
    <div className="space-y-6" data-testid="brand-panel">
      <Section title="Brand Colors" subtitle="Applied everywhere — login screen, admin shell, and client portal. Changes save when you hit the Save button below.">
        <div className="grid sm:grid-cols-3 gap-4">
          <ColorField testid="brand-primary"  label="Primary" sub="buttons, accents, active nav" value={draft.brand_primary}  onChange={(v)=>setDraft({...draft, brand_primary: v})} />
          <ColorField testid="brand-accent"   label="Accent"  sub="highlights, links, info badges" value={draft.brand_accent}   onChange={(v)=>setDraft({...draft, brand_accent: v})} />
          <ColorField testid="brand-warning"  label="Warning" sub="alerts, expiring vaccines"    value={draft.brand_warning}  onChange={(v)=>setDraft({...draft, brand_warning: v})} />
        </div>
      </Section>

      <Section title="Font" subtitle="Switches the typeface used throughout the app.">
        <div className="flex flex-wrap gap-2" data-testid="brand-font-options">
          {FONT_OPTIONS.map(opt => {
            const active = draft.brand_font_family === opt.value;
            const styleFam = opt.value === "System" ? "system-ui" : opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                data-testid={`brand-font-${opt.value}`}
                onClick={()=>setDraft({...draft, brand_font_family: opt.value})}
                className={`px-4 py-3 rounded-lg border-2 transition text-left ${
                  active
                    ? "border-shGreen bg-shGreen/10"
                    : "border-bgHover bg-bgBase hover:border-shGreen/50"
                }`}
                style={{ fontFamily: styleFam }}
              >
                <div className="text-sm font-black text-white">{opt.label}</div>
                <div className="text-[14px] text-gray-400 mt-0.5">The quick brown fox</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Card Gradients" subtitle="Each card type in the app gets a tinted gradient. Pick the color for each — every matching card across admin + portal recolors instantly. Hover any swatch to see what kind of cards it controls.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <GradColorField testid="grad-hero"    label="Hero"    sub="credit balance, hero stats, onboarding banner" sample="card-hero"    value={draft.grad_hero_color}    onChange={(v)=>setDraft({...draft, grad_hero_color: v})} />
          <GradColorField testid="grad-info"    label="Info"    sub="dashboard tiles, tips, secondary info"          sample="card-info"    value={draft.grad_info_color}    onChange={(v)=>setDraft({...draft, grad_info_color: v})} />
          <GradColorField testid="grad-warning" label="Warning" sub="vaccine expiring, low credits, attention"       sample="card-warning" value={draft.grad_warning_color} onChange={(v)=>setDraft({...draft, grad_warning_color: v})} />
          <GradColorField testid="grad-danger"  label="Danger"  sub="vaccine missing, errors, overdue"               sample="card-danger"  value={draft.grad_danger_color}  onChange={(v)=>setDraft({...draft, grad_danger_color: v})} />
          <GradColorField testid="grad-success" label="Success" sub="report cards, approvals, trophies earned"       sample="card-success" value={draft.grad_success_color} onChange={(v)=>setDraft({...draft, grad_success_color: v})} />
        </div>
      </Section>

      <Section title="Footer Pill" subtitle="The small pill in the bottom-right corner of every page. Leave the URL blank to make it a non-clickable label.">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-bgBase border border-bgHover rounded-lg p-3">
            <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">Text</label>
            <p className="text-[13px] text-gray-500 mt-0.5">What the pill says</p>
            <input
              type="text"
              maxLength={28}
              value={draft.brand_footer_text || ""}
              onChange={(e)=>setDraft({...draft, brand_footer_text: e.target.value})}
              data-testid="brand-footer-text"
              placeholder="Sit Happens"
              className="w-full mt-2 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white"
            />
          </div>
          <div className="bg-bgBase border border-bgHover rounded-lg p-3">
            <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">Link URL</label>
            <p className="text-[13px] text-gray-500 mt-0.5">Opens in a new tab when clicked. Blank = no link.</p>
            <input
              type="url"
              value={draft.brand_footer_url || ""}
              onChange={(e)=>setDraft({...draft, brand_footer_url: e.target.value})}
              data-testid="brand-footer-url"
              placeholder="https://sithappens.app"
              className="w-full mt-2 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white font-mono"
            />
          </div>
        </div>
      </Section>

      <Section title="Live Preview" subtitle="A quick taste of how things look with the choices above.">
        <div
          className="rounded-xl p-5 border space-y-3"
          style={{
            borderColor: draft.brand_primary,
            backgroundColor: "#0f172a",
            fontFamily: draft.brand_font_family === "System" ? "system-ui" : draft.brand_font_family,
          }}
        >
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_primary, color: "#0f172a" }}>Primary</span>
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_accent, color: "#fff" }}>Accent</span>
            <span className="px-3 py-1 rounded font-black text-[15px] uppercase tracking-widest" style={{ background: draft.brand_warning, color: "#fff" }}>Warning</span>
          </div>
          <p className="text-base text-white">A booking was just approved for <span style={{ color: draft.brand_primary, fontWeight: 900 }}>Buddy</span>.</p>
          <p className="text-[14px] text-gray-300">Rabies expires soon — <span style={{ color: draft.brand_warning, fontWeight: 900 }}>renew before Dec 31</span>.</p>
        </div>
      </Section>

      <div className="flex justify-between items-center pt-4 border-t border-bgHover">
        <button onClick={reset} data-testid="brand-reset" className="text-[14px] font-black uppercase tracking-widest text-gray-400 hover:text-white">
          <i className="fas fa-rotate-left mr-2"/>Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-[14px] font-black uppercase tracking-widest ${msg==="Saved"?"text-shGreen":"text-red-400"}`}>{msg}</span>}
          <button onClick={onSave} disabled={saving || !dirty} data-testid="brand-save"
                  className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-40">
            {saving ? "Saving…" : "Save Brand"}
          </button>
        </div>
      </div>
    </div>
  );
}


function GradColorField({ label, sub, sample, value, onChange, testid }) {
  // Live mini-preview card that uses the actual gradient class — when the
  // admin drags the color, the swatch recolors in real time because the
  // class references CSS vars set by ThemeProvider on save.
  return (
    <div className="bg-bgBase border border-bgHover rounded-lg p-3" data-testid={testid}>
      <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">{label}</label>
      <p className="text-[13px] text-gray-500 mt-0.5 mb-2 leading-tight">{sub}</p>
      <div
        className={`${sample} rounded-lg h-12 flex items-center justify-center mb-2 text-[13px] font-black uppercase tracking-widest text-white/80`}
        style={{
          // Inline override so the preview reflects the in-flight draft color
          // before the admin hits Save (instead of waiting for theme vars to update).
          ["--grad-hero-rgb"]: hexToRgbInline(value),
          ["--grad-info-rgb"]: hexToRgbInline(value),
          ["--grad-warning-rgb"]: hexToRgbInline(value),
          ["--grad-danger-rgb"]: hexToRgbInline(value),
          ["--grad-success-rgb"]: hexToRgbInline(value),
        }}
      >
        Preview
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-picker`}
          className="w-12 h-9 rounded cursor-pointer bg-transparent border border-bgHover"
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-hex`}
          className="flex-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white font-mono"
        />
      </div>
    </div>
  );
}

function hexToRgbInline(hex) {
  const h = (hex || "").replace("#", "").trim();
  if (h.length !== 6) return "140, 198, 63";
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}


function ColorField({ label, sub, value, onChange, testid }) {
  return (
    <div className="bg-bgBase border border-bgHover rounded-lg p-3">
      <label className="text-[15px] font-black text-gray-400 uppercase tracking-widest">{label}</label>
      <p className="text-[13px] text-gray-500 mt-0.5">{sub}</p>
      <div className="flex items-center gap-2 mt-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-picker`}
          className="w-12 h-10 rounded cursor-pointer bg-transparent border border-bgHover"
        />
        <input
          type="text"
          value={value || ""}
          onChange={(e)=>onChange(e.target.value)}
          data-testid={`${testid}-hex`}
          placeholder="#8cc63f"
          className="flex-1 bg-bgPanel border border-bgHover rounded px-2 py-1.5 text-sm text-white font-mono"
        />
      </div>
    </div>
  );
}



function Field({ label, value, onChange, type="text", testId }) {
  return (
    <div>
      <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">{label}</label>
      <input type={type} value={value} onChange={(e)=>onChange(e.target.value)} data-testid={testId}
             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
    </div>
  );
}

function HoursPanel({ s, save, saving }) {
  const [biz, setBiz] = useState(s.business_hours);
  const [svc, setSvc] = useState(s.service_hours);
  // ISO yyyy-mm-dd dates the facility is fully closed (holidays, vacations).
  // Client-side bookings on these dates are blocked at the API layer.
  const [closedDates, setClosedDates] = useState(s.closed_dates || []);
  const [newClosed, setNewClosed] = useState("");

  const setBizDay = (day, k, v) => setBiz({ ...biz, [day]: { ...biz[day], [k]: v } });
  const setSvcDay = (svcKey, day, k, v) => setSvc({ ...svc, [svcKey]: { ...svc[svcKey], [day]: { ...svc[svcKey][day], [k]: v } } });

  return (
    <div className="space-y-6" data-testid="hours-panel">
      <Section title="Business Hours" subtitle="Default operating hours for your facility.">
        {DAYS.map(d => (
          <DayRow key={d} day={d} val={biz[d]} onChange={(k,v)=>setBizDay(d,k,v)} testPrefix={`biz-${d}`} />
        ))}
      </Section>

      {["daycare","training","grooming"].map(svcKey => (
        <Section key={svcKey} title={`${svcKey[0].toUpperCase()+svcKey.slice(1)} Hours`} subtitle={`Override hours just for ${svcKey}.`}>
          {DAYS.map(d => {
            const val = (svc[svcKey] && svc[svcKey][d]) || biz[d];
            return <DayRow key={d} day={d} val={val} onChange={(k,v)=>setSvcDay(svcKey,d,k,v)} testPrefix={`${svcKey}-${d}`} />;
          })}
        </Section>
      ))}

      <Section title="Boarding" subtitle="Boarding is treated as 24/7 by default. Capacity is enforced per night.">
        <div className="text-[14px] font-black text-shGreen uppercase tracking-widest bg-shGreen/10 rounded p-3">24/7 — overnight stays allowed</div>
      </Section>

      <Section title="Closed Days" subtitle="Holidays / vacations. Clients can't self-book on these dates; admin overrides still work.">
        <div className="space-y-2" data-testid="closed-dates-list">
          {closedDates.length === 0 && <p className="text-[14px] text-gray-500 italic normal-case">No closed days configured.</p>}
          {[...closedDates].sort().map((d) => (
            <div key={d} className="flex items-center gap-2 bg-bgBase rounded p-2" data-testid={`closed-date-${d}`}>
              <i className="fas fa-calendar-xmark text-shOrange text-xs"/>
              <span className="flex-1 text-sm font-black text-white">{new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</span>
              <button onClick={()=>setClosedDates(closedDates.filter(x => x !== d))}
                      className="text-red-400 hover:text-red-300 px-2" aria-label="Remove">
                <i className="fas fa-trash text-xs"/>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input type="date" value={newClosed} onChange={(e)=>setNewClosed(e.target.value)}
                 data-testid="closed-date-input"
                 className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-sm text-white" style={{colorScheme:"dark"}}/>
          <button onClick={()=>{
                     if (!newClosed) return;
                     if (closedDates.includes(newClosed)) { setNewClosed(""); return; }
                     setClosedDates([...closedDates, newClosed]); setNewClosed("");
                   }}
                  data-testid="closed-date-add"
                  className="bg-shOrange text-bgHeader px-4 py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shOrange/80">
            + Add
          </button>
        </div>
      </Section>

      <SaveBar onSave={()=>save({ business_hours: biz, service_hours: svc, closed_dates: closedDates })} saving={saving} />
    </div>
  );
}

function DayRow({ day, val, onChange, testPrefix }) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 py-2 border-b border-bgHover/30">
      <div className="col-span-3 text-[15px] font-black uppercase tracking-widest text-gray-300">{day}</div>
      <div className="col-span-3">
        <input type="time" value={val.open||""} disabled={val.closed} onChange={(e)=>onChange("open", e.target.value)} data-testid={`${testPrefix}-open`}
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-xs text-white disabled:opacity-40" style={{colorScheme:"dark"}} />
      </div>
      <div className="col-span-3">
        <input type="time" value={val.close||""} disabled={val.closed} onChange={(e)=>onChange("close", e.target.value)} data-testid={`${testPrefix}-close`}
               className="w-full bg-bgBase border border-bgHover rounded p-2 text-xs text-white disabled:opacity-40" style={{colorScheme:"dark"}} />
      </div>
      <label className="col-span-3 flex items-center gap-2 text-[14px] font-black uppercase tracking-widest text-gray-400 cursor-pointer">
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
                    className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[14px] uppercase tracking-widest">+ Add</button>
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
          <span className="text-[15px] font-black uppercase tracking-widest text-gray-300">Auto-approve client bookings (skip pending step)</span>
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
                    className={`py-3 px-4 rounded border text-[15px] font-black uppercase tracking-widest transition ${req.includes(v.key)?"bg-shGreen text-bgHeader border-shGreen":"bg-bgBase text-gray-400 border-bgHover hover:border-shGreen/50"}`}>
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

// Palette of brand-friendly tag colors. Each entry has bg + border + text classes
// plus an inline hex so we can build a pill that matches the chosen color.
const TAG_COLORS = [
  { key: "green",  hex: "#8cc63f" },
  { key: "blue",   hex: "#00a9e0" },
  { key: "orange", hex: "#f26522" },
  { key: "purple", hex: "#a855f7" },
  { key: "pink",   hex: "#ec4899" },
  { key: "red",    hex: "#ef4444" },
  { key: "yellow", hex: "#facc15" },
  { key: "slate",  hex: "#94a3b8" },
];
const DEFAULT_TAG_COLOR = "#8cc63f";

function TagsPanel({ s, save, saving }) {
  // mood_tags can be legacy List[str] OR new List[{label, icon, color}]. Normalize.
  const toObj = (t) => (typeof t === "string"
    ? { label: t, icon: "", color: "" }
    : { label: t?.label || "", icon: t?.icon || "", color: t?.color || "" });
  const [tags, setTags] = useState(() => (s.mood_tags || []).map(toObj));
  const [newT, setNewT] = useState("");
  const [pickerOpen, setPickerOpen] = useState(-1); // index of tag whose icon picker is open
  return (
    <div className="space-y-4" data-testid="tags-panel">
      <Section title="Pup Report Card Mood Tags" subtitle="These appear as pill buttons on the report card modal. Pick an optional icon AND color for each one.">
        <div className="flex flex-wrap gap-2">
          {tags.map((t,i)=>{
            const color = t.color || DEFAULT_TAG_COLOR;
            return (
            <div key={i}
                 className="relative flex items-center gap-1.5 rounded-full pl-2 pr-1 py-1 border"
                 style={{ backgroundColor: `${color}26`, borderColor: `${color}66`, color }}>
              <button type="button" onClick={()=>setPickerOpen(pickerOpen === i ? -1 : i)}
                      data-testid={`tag-icon-toggle-${i}`}
                      className="w-7 h-7 rounded-full grid place-items-center bg-bgBase border hover:opacity-80"
                      style={{ borderColor: `${color}55`, color }}>
                <i className={`fas ${t.icon || "fa-plus"} text-xs`}/>
              </button>
              <input value={t.label} onChange={(e)=>{const c=[...tags]; c[i]={...c[i], label:e.target.value}; setTags(c);}}
                     className="bg-transparent text-[15px] font-black uppercase tracking-widest outline-none w-32"
                     style={{ color }}
                     data-testid={`tag-${i}`} />
              {/* Inline color swatch row */}
              <div className="flex items-center gap-0.5 px-1" data-testid={`tag-color-row-${i}`}>
                {TAG_COLORS.map(c => (
                  <button key={c.key} type="button"
                          onClick={()=>{const arr=[...tags]; arr[i]={...arr[i], color:c.hex}; setTags(arr);}}
                          title={c.key}
                          data-testid={`tag-${i}-color-${c.key}`}
                          className={`w-4 h-4 rounded-full border ${color === c.hex ? "ring-2 ring-white/70 ring-offset-1 ring-offset-bgPanel" : "border-white/20"}`}
                          style={{ backgroundColor: c.hex }}/>
                ))}
              </div>
              <button onClick={()=>{setTags(tags.filter((_,j)=>j!==i)); setPickerOpen(-1);}}
                      className="hover:text-red-400 px-1"
                      style={{ color: `${color}b3` }}>×</button>
              {pickerOpen === i && (
                <div className="absolute z-30 top-full left-0 mt-1 w-72">
                  <IconPicker value={t.icon}
                              autoOpen={true}
                              onChange={(v)=>{const c=[...tags]; c[i]={...c[i], icon:v}; setTags(c); setPickerOpen(-1);}}
                              testid={`tag-${i}-icon-picker`}/>
                </div>
              )}
            </div>
            );
          })}
        </div>
        <div className="flex gap-2 mt-4">
          <input value={newT} onChange={(e)=>setNewT(e.target.value)} placeholder="Add a tag (e.g. Loves the Hose)"
                 className="flex-1 bg-bgBase border border-bgHover rounded p-2 text-sm text-white" data-testid="new-tag-input" />
          <button onClick={()=>{ if(newT.trim()){ setTags([...tags, { label: newT.trim(), icon: "", color: "" }]); setNewT(""); } }} data-testid="add-tag"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[14px] uppercase tracking-widest">+ Add Tag</button>
        </div>
      </Section>
      <SaveBar onSave={()=>save({ mood_tags: tags.filter(t=>t.label.trim()).map(t=>({ label: t.label.trim(), icon: t.icon || "", color: t.color || "" })) })} saving={saving} />
    </div>
  );
}

function WaiverPanel({ s, save, saving }) {
  const [text, setText] = useState(s.waiver_text || "");
  const [required, setRequired] = useState(s.waiver_required_for_booking !== false);
  const [version, setVersion] = useState(s.waiver_version || 1);
  const [signatures, setSignatures] = useState([]);
  const [showSigs, setShowSigs] = useState(false);

  useEffect(() => {
    api.get("/waivers").then(r => setSignatures(r.data)).catch(() => {});
  }, []);

  const saveAndMaybeBump = (bump) => {
    const nextVersion = bump ? (version + 1) : version;
    save({ waiver_text: text, waiver_required_for_booking: required, waiver_version: nextVersion });
    if (bump) setVersion(nextVersion);
  };

  return (
    <div className="space-y-6" data-testid="waiver-panel">
      <Section title="Waiver Text" subtitle="Markdown bold (**Heading**) becomes a green section heading in the portal.">
        <textarea value={text} onChange={(e)=>setText(e.target.value)} rows={14} data-testid="waiver-text-edit"
                  className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-xs font-mono focus:border-shBlue outline-none" />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={required} onChange={(e)=>setRequired(e.target.checked)} data-testid="waiver-required" className="accent-shGreen w-4 h-4" />
            <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">Require waiver before client can book</span>
          </label>
          <span className="text-[14px] font-black uppercase tracking-widest text-gray-500">Current version: v{version}</span>
        </div>
      </Section>

      <Section title="Signed Waivers" subtitle="Bump version after material changes to require all clients to re-sign.">
        <button onClick={()=>setShowSigs(!showSigs)} className="mb-3 text-[14px] font-black uppercase tracking-widest text-shBlue hover:underline">
          {showSigs?"Hide":"Show"} {signatures.length} signature{signatures.length===1?"":"s"}
        </button>
        {showSigs && (
          <div className="space-y-2 max-h-80 overflow-y-auto" data-testid="waiver-signatures-list">
            {signatures.length === 0 && <p className="text-xs text-gray-500 uppercase font-black">No signatures yet.</p>}
            {signatures.map(sig => (
              <div key={sig.id} className="bg-bgBase rounded p-3 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2" data-testid={`sig-${sig.id}`}>
                <div>
                  <p className="text-white font-black">{sig.typed_name} <span className="text-gray-500 font-normal">· {sig.client_name}</span></p>
                  <p className="text-[14px] text-gray-500 uppercase font-black tracking-widest mt-1">Signed {(sig.signed_at||"").slice(0,19).replace("T"," ")} · v{sig.waiver_version}</p>
                </div>
                <span className="text-[14px] font-black uppercase tracking-widest bg-shGreen/15 text-shGreen px-2 py-1 rounded">Valid</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="flex flex-col md:flex-row justify-end gap-3 pt-4 border-t border-bgHover">
        <button onClick={()=>saveAndMaybeBump(false)} disabled={saving} data-testid="save-waiver-noversion"
                className="bg-shBlue text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
          Save Without Bumping
        </button>
        <button onClick={()=>saveAndMaybeBump(true)} disabled={saving} data-testid="save-waiver-bump"
                className="bg-shGreen text-bgHeader px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
          Save & Bump Version (re-sign required)
        </button>
      </div>
    </div>
  );
}

function MarketingQRPanel() {
  const [ref, setRef] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const buildUrl = (size = 512) => {
    const params = new URLSearchParams({ size: String(size) });
    if (ref.trim()) params.set("ref", ref.trim());
    return `/admin/marketing-qr?${params.toString()}`;
  };

  const loadPreview = async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.get(buildUrl(512), { responseType: "blob" });
      const blob = new Blob([r.data], { type: "image/png" });
      setPreviewUrl(URL.createObjectURL(blob));
      setTargetUrl(r.headers["x-qr-target-url"] || "");
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Couldn't generate the QR code.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPreview(); /* eslint-disable-next-line */ }, []);
  // Regenerate preview when ref changes (debounced).
  useEffect(() => {
    const id = setTimeout(loadPreview, 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line
  }, [ref]);

  const download = async (size) => {
    setErr("");
    try {
      const r = await api.get(buildUrl(size), { responseType: "blob" });
      const blob = new Blob([r.data], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sit-happens-qr${ref ? "-" + ref : ""}-${size}px.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Download failed.");
    }
  };

  return (
    <div className="space-y-5" data-testid="marketing-qr-panel">
      <Section title="Marketing QR Code"
               subtitle="Scan with any phone camera to jump straight to your app. Print this on flyers, business cards, fridge magnets — anywhere clients might see it.">
        <div className="flex flex-col md:flex-row items-stretch gap-5">
          <div className="bg-white p-4 rounded-xl flex items-center justify-center w-full md:w-64 h-64 shrink-0">
            {loading && !previewUrl && <p className="text-gray-500 text-xs font-black uppercase tracking-widest">Generating…</p>}
            {previewUrl && <img src={previewUrl} alt="App QR code" className="max-w-full max-h-full" data-testid="qr-preview-img" />}
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <label className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Points to</label>
              <p className="text-[15px] text-shBlue break-all mt-1 font-mono" data-testid="qr-target-url">{targetUrl || "—"}</p>
            </div>
            <div>
              <label className="text-[14px] text-gray-400 font-black uppercase tracking-widest">Tracking tag <span className="text-gray-600 normal-case tracking-normal">(optional — e.g. flyer, postcard, fb-ad)</span></label>
              <input
                type="text"
                value={ref}
                onChange={(e)=>setRef(e.target.value.replace(/[^a-z0-9_-]/gi, "").slice(0, 24))}
                placeholder="flyer"
                data-testid="qr-ref-input"
                className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm font-mono"
              />
              <p className="text-[13px] text-gray-500 mt-1">Appended as <span className="font-mono text-shBlue">?ref=…</span> so future analytics can show where each scan came from.</p>
            </div>
            {err && <p className="text-[14px] text-red-400 font-black uppercase tracking-widest">{err}</p>}
            <div className="grid grid-cols-3 gap-2">
              <button onClick={()=>download(512)} data-testid="qr-download-small"
                      className="bg-bgBase border border-bgHover hover:border-shBlue text-shBlue py-2 rounded text-[14px] font-black uppercase tracking-widest">
                <i className="fas fa-download mr-1"/>Small<br /><span className="text-[12px] text-gray-500">512px</span>
              </button>
              <button onClick={()=>download(1024)} data-testid="qr-download-medium"
                      className="bg-shBlue/15 border border-shBlue/40 hover:bg-shBlue/30 text-shBlue py-2 rounded text-[14px] font-black uppercase tracking-widest">
                <i className="fas fa-download mr-1"/>Print<br /><span className="text-[12px] opacity-70">1024px</span>
              </button>
              <button onClick={()=>download(2048)} data-testid="qr-download-large"
                      className="bg-shGreen text-bgHeader py-2 rounded text-[14px] font-black uppercase tracking-widest shadow">
                <i className="fas fa-download mr-1"/>Poster<br /><span className="text-[12px] opacity-70">2048px</span>
              </button>
            </div>
            <p className="text-[13px] text-gray-500">Higher resolutions = sharper print at larger sizes. Use Poster for full-page flyers, Print for cards, Small for screen sharing.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}



function PortalLinksPanel({ s, save, saving }) {
  const initial = s.client_portal_links || {};
  const [links, setLinks] = useState({
    website_url: initial.website_url || "",
    photo_gallery_url: initial.photo_gallery_url || "",
  });
  const onSave = () => save({ client_portal_links: links });
  return (
    <div className="space-y-5" data-testid="portal-links-panel">
      <p className="text-[14px] text-gray-400">
        These appear as quick-link buttons on your client portal. Leave blank to hide a button. You can change them anytime — clients always get the current URL.
      </p>
      <Section title={<span><i className="fas fa-globe text-shBlue mr-2"/>Your Website</span>}>
        <input
          type="url"
          value={links.website_url}
          onChange={(e)=>setLinks(l => ({ ...l, website_url: e.target.value.trim() }))}
          placeholder="https://your-business.com"
          data-testid="link-website-input"
          className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm font-mono"
        />
        <p className="text-[13px] text-gray-500 mt-1">Shows up as a "Visit Our Website" button on the portal.</p>
      </Section>
      <Section title={<span><i className="fas fa-images text-shGreen mr-2"/>Photo Gallery (Fallback Only)</span>}>
        <input
          type="url"
          value={links.photo_gallery_url}
          onChange={(e)=>setLinks(l => ({ ...l, photo_gallery_url: e.target.value.trim() }))}
          placeholder="https://photos.your-business.com"
          data-testid="link-gallery-input"
          className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm font-mono"
        />
        <p className="text-[13px] text-gray-500 mt-1">
          <i className="fas fa-circle-info mr-1 text-shBlue"/>
          Photo galleries are now <span className="font-black text-white">per-client</span> — set each client's gallery URL on their record in the Clients screen. This field is only used as a fallback for clients who don't have their own gallery URL set.
        </p>
      </Section>
      <SaveBar onSave={onSave} saving={saving} />
    </div>
  );
}


function ServiceInfoPanel({ s, save, saving }) {
  const defaults = s.service_descriptions || {};
  const [descs, setDescs] = useState({
    daycare: defaults.daycare || "",
    boarding: defaults.boarding || "",
    training: defaults.training || "",
    grooming: defaults.grooming || "",
    photography: defaults.photography || "",
  });
  const services = [
    { k: "daycare", label: "Daycare", icon: "fa-sun", color: "text-shBlue" },
    { k: "boarding", label: "Boarding", icon: "fa-moon", color: "text-shGreen" },
    { k: "training", label: "Training", icon: "fa-graduation-cap", color: "text-purple-400" },
    { k: "grooming", label: "Grooming", icon: "fa-bath", color: "text-pink-400" },
    { k: "photography", label: "Photography", icon: "fa-camera-retro", color: "text-shOrange" },
  ];
  return (
    <div className="space-y-5" data-testid="service-info-panel">
      <p className="text-[14px] text-gray-400">
        These appear when your clients tap the <i className="fas fa-circle-info text-shBlue mx-1"/> next to a service on the booking form. Keep them short and reassuring — what is it, who it's for, what to bring.
      </p>
      {services.map(svc => (
        <Section key={svc.k} title={<span><i className={`fas ${svc.icon} ${svc.color} mr-2`}/>{svc.label}</span>}>
          <textarea
            value={descs[svc.k]}
            onChange={(e)=>setDescs(d => ({...d, [svc.k]: e.target.value}))}
            rows={3}
            data-testid={`service-desc-${svc.k}`}
            placeholder={`Tell clients what ${svc.label.toLowerCase()} is like at your business…`}
            className="w-full bg-bgBase border border-bgHover rounded p-3 text-white text-sm leading-relaxed"
          />
        </Section>
      ))}
      <SaveBar onSave={()=>save({ service_descriptions: descs })} saving={saving} />
    </div>
  );
}


function Section({ title, subtitle, children }) {
  return (
    <div>
      <h4 className="text-xs font-black text-shBlue uppercase tracking-widest">{title}</h4>
      {subtitle && <p className="text-[15px] text-gray-500 mt-1">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SaveBar({ onSave, saving }) {
  return (
    <div className="flex justify-end pt-4 border-t border-bgHover">
      <button onClick={onSave} disabled={saving} data-testid="save-settings"
              className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
        {saving?"Saving…":"Save Changes"}
      </button>
    </div>
  );
}


function ErrorsPanel() {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true); setMsg("");
    try {
      const { data } = await api.get("/admin/recent-errors");
      setErrors(Array.isArray(data?.errors) ? data.errors : []);
    } catch (e) {
      console.warn("Recent errors load failed:", e);
      setMsg("Failed to load recent errors.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const clearAll = async () => {
    if (!window.confirm("Clear all recent errors from the buffer?")) return;
    try {
      await api.post("/admin/recent-errors/clear");
      setErrors([]);
      setMsg("Cleared.");
    } catch (e) {
      console.warn("Clear errors failed:", e);
      setMsg("Failed to clear.");
    }
  };

  const fmtTs = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch { return iso; }
  };

  return (
    <div className="space-y-4 max-w-3xl" data-testid="errors-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-black text-shOrange uppercase tracking-widest mb-1">
            <i className="fas fa-triangle-exclamation mr-2"/>Recent Server Errors
          </h4>
          <p className="text-[15px] text-gray-400 leading-relaxed">
            The last 20 unhandled API errors since the backend was started. Spot regressions before clients email you.
            Cleared automatically when the server restarts.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={load} disabled={loading} data-testid="errors-refresh-btn"
                  className="bg-bgHover text-gray-200 px-3 py-1.5 rounded text-[14px] font-black uppercase tracking-widest hover:bg-bgBase disabled:opacity-50">
            <i className={`fas fa-rotate ${loading?"fa-spin":""} mr-1.5`}/>Refresh
          </button>
          <button onClick={clearAll} disabled={loading || errors.length===0} data-testid="errors-clear-btn"
                  className="bg-red-500/20 text-red-300 px-3 py-1.5 rounded text-[14px] font-black uppercase tracking-widest hover:bg-red-500/30 disabled:opacity-40">
            <i className="fas fa-trash mr-1.5"/>Clear
          </button>
        </div>
      </div>

      {msg && <p className="text-[15px] text-gray-400">{msg}</p>}

      {errors.length === 0 && !loading ? (
        <div className="bg-bgBase border border-bgHover rounded p-6 text-center">
          <i className="fas fa-check-circle text-shGreen text-2xl mb-2 block"/>
          <p className="text-[14px] font-black text-gray-300 uppercase tracking-widest">All clear</p>
          <p className="text-[14px] text-gray-500 mt-1">No unhandled errors recorded.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {errors.map((er) => {
            const isOpen = expanded === er.id;
            return (
              <div key={er.id} className="bg-bgBase border border-bgHover rounded overflow-hidden" data-testid={`error-row-${er.id}`}>
                <button onClick={()=>setExpanded(isOpen ? null : er.id)}
                        className="w-full text-left p-3 hover:bg-bgHover/40 transition">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[13px] font-black text-shOrange uppercase tracking-widest px-2 py-0.5 bg-shOrange/10 rounded">
                          {er.type}
                        </span>
                        <span className="text-[13px] font-mono text-gray-500">{er.method} {er.path}</span>
                      </div>
                      <p className="text-[15px] text-gray-200 break-words">{er.message || "(no message)"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] text-gray-500">{fmtTs(er.ts)}</p>
                      <i className={`fas fa-chevron-${isOpen?"up":"down"} text-gray-500 text-[13px] mt-1`}/>
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <pre className="text-[13px] text-gray-400 bg-black/40 p-3 overflow-x-auto whitespace-pre-wrap border-t border-bgHover">
{er.traceback || "(no traceback)"}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}



function BackupPanel() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreMode, setRestoreMode] = useState("merge");
  const [restorePreview, setRestorePreview] = useState(null);

  const download = async () => {
    setBusy(true); setMsg("");
    try {
      const { data } = await api.get("/backup/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `sit-happens-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("Backup downloaded ✓");
    } catch { setMsg("Download failed"); }
    setBusy(false);
  };

  const downloadIncomeCsv = async () => {
    setBusy(true); setMsg("");
    try {
      const year = new Date().getFullYear();
      const resp = await api.get(`/admin/income/export.csv`, { params: { year }, responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url; a.download = `sit-happens-income-${year}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Income CSV for ${year} downloaded ✓`);
    } catch (e) { console.warn("income csv failed", e); setMsg("Income export failed"); }
    setBusy(false);
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setRestoreFile(f); setRestorePreview(null); setMsg("");
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (!parsed.version || !parsed.collections) throw new Error("Not a valid Sit Happens backup");
        const counts = {};
        Object.entries(parsed.collections).forEach(([k, v]) => counts[k] = (v || []).length);
        setRestorePreview({ version: parsed.version, exportedAt: parsed.exported_at, counts });
      } catch (err) { setMsg(`Invalid file: ${err.message}`); setRestoreFile(null); }
    };
    r.readAsText(f);
  };

  const doRestore = async () => {
    if (!restoreFile || !restorePreview) return;
    const total = Object.values(restorePreview.counts).reduce((a,b)=>a+b, 0);
    const verb = restoreMode === "replace" ? "REPLACE all current data with" : "merge into your current data";
    if (!(await confirm({ title: restoreMode === "replace" ? "Replace ALL data?" : "Merge into current data?", body: `This will ${verb} ${total} records from ${restoreFile.name}.\n\nThis cannot be undone — make sure you have a current backup downloaded first.`, confirmText: restoreMode === "replace" ? "Yes, replace everything" : "Yes, merge", tone: "danger" }))) return;
    setBusy(true); setMsg("");
    try {
      const r = new FileReader();
      r.onload = async () => {
        try {
          const payload = JSON.parse(r.result);
          payload.mode = restoreMode;
          const { data } = await api.post("/backup/restore", payload);
          const summary = Object.entries(data.summary).map(([k,v])=>`${k}: ${v.inserted ?? v.upserted}`).join(" · ");
          setMsg(`Restored ✓ ${summary}`);
          setRestoreFile(null); setRestorePreview(null);
        } catch (e) { setMsg(`Restore failed: ${e.response?.data?.detail || e.message}`); }
        setBusy(false);
      };
      r.readAsText(restoreFile);
    } catch { setBusy(false); setMsg("Restore failed"); }
  };

  return (
    <div className="space-y-6 max-w-2xl" data-testid="backup-panel">
      <div>
        <h4 className="text-sm font-black text-shGreen uppercase tracking-widest mb-2"><i className="fas fa-download mr-2"/>Download Backup</h4>
        <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
          Save a full snapshot of everything: clients, dogs, bookings, incidents, homework, waiver signatures, and settings.
          We recommend downloading one every week or before any major change.
        </p>
        <button onClick={download} disabled={busy} data-testid="backup-download"
                className="bg-shGreen text-bgHeader px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
          <i className="fas fa-download mr-2"/>{busy ? "Working…" : "Download Backup (.json)"}
        </button>
      </div>

      <div className="border-t border-bgHover pt-6">
        <h4 className="text-sm font-black text-shBlue uppercase tracking-widest mb-2"><i className="fas fa-file-csv mr-2"/>Year-End Income Export</h4>
        <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
          Download every paid booking + credit-pack sale for the current year as a CSV — opens cleanly in Excel/Sheets. Perfect for handing your accountant in January.
        </p>
        <button onClick={downloadIncomeCsv} disabled={busy} data-testid="income-csv-download"
                className="bg-shBlue text-bgHeader px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
          <i className="fas fa-file-csv mr-2"/>{busy ? "Working…" : `Download ${new Date().getFullYear()} Income (.csv)`}
        </button>
      </div>

      <div className="border-t border-bgHover pt-6">
        <h4 className="text-sm font-black text-shOrange uppercase tracking-widest mb-2"><i className="fas fa-upload mr-2"/>Restore from Backup</h4>
        <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
          Upload a previously-downloaded backup file. <span className="text-shOrange font-black">Always download a fresh backup before restoring</span> in case you need to revert.
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Backup file</span>
            <input type="file" accept=".json,application/json" onChange={onPickFile} data-testid="backup-file"
                   className="block mt-1 w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded file:border-0 file:bg-bgBase file:text-shBlue file:font-black file:uppercase file:text-[14px] file:tracking-widest hover:file:bg-bgHover cursor-pointer" />
          </label>

          {restorePreview && (
            <div className="bg-bgBase border border-bgHover rounded p-3 space-y-2" data-testid="backup-preview">
              <p className="text-[14px] font-black text-shBlue uppercase tracking-widest">Backup preview</p>
              <p className="text-[14px] text-gray-400">Exported {restorePreview.exportedAt?.slice(0,19).replace("T", " ")}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[14px]">
                {Object.entries(restorePreview.counts).map(([k,v]) => (
                  <div key={k} className="bg-bgPanel rounded px-2 py-1 flex justify-between">
                    <span className="text-gray-400 uppercase font-black tracking-widest">{k}</span>
                    <span className="text-white font-black">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Restore mode</span>
            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className={`cursor-pointer rounded p-3 border ${restoreMode==="merge"?"bg-shBlue/10 border-shBlue/50":"bg-bgBase border-bgHover"}`}>
                <input type="radio" name="mode" checked={restoreMode==="merge"} onChange={()=>setRestoreMode("merge")} className="mr-2 accent-shBlue" data-testid="mode-merge" />
                <span className="text-sm font-black text-white uppercase tracking-tight">Merge (safer)</span>
                <p className="text-[14px] text-gray-400 mt-1">Adds & updates by ID. Anything not in the backup stays untouched.</p>
              </label>
              <label className={`cursor-pointer rounded p-3 border ${restoreMode==="replace"?"bg-red-500/10 border-red-500/50":"bg-bgBase border-bgHover"}`}>
                <input type="radio" name="mode" checked={restoreMode==="replace"} onChange={()=>setRestoreMode("replace")} className="mr-2 accent-red-500" data-testid="mode-replace" />
                <span className="text-sm font-black text-white uppercase tracking-tight">Replace (wipes current)</span>
                <p className="text-[14px] text-gray-400 mt-1">Deletes all current data and restores exactly what's in the backup.</p>
              </label>
            </div>
          </div>

          <button onClick={doRestore} disabled={busy || !restorePreview} data-testid="backup-restore"
                  className={`px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50 ${restoreMode==="replace"?"bg-red-500 text-white":"bg-shBlue text-white"}`}>
            <i className="fas fa-upload mr-2"/>{busy ? "Restoring…" : `Restore (${restoreMode})`}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`text-[14px] font-black uppercase tracking-widest p-3 rounded ${msg.startsWith("Restored") || msg.includes("✓") ? "bg-shGreen/15 text-shGreen":"bg-red-500/15 text-red-400"}`} data-testid="backup-msg">
          {msg}
        </div>
      )}

      <div className="bg-bgBase border border-bgHover rounded p-4 text-[14px] text-gray-400 leading-relaxed">
        <p className="text-shBlue font-black uppercase tracking-widest mb-2"><i className="fas fa-circle-info mr-2"/>What's in a backup?</p>
        <p>Clients, dogs, bookings, incidents, homework, waiver signatures, and your settings. Admin login credentials are <span className="text-white font-black">not</span> included — your password stays in the database and is never exported. Backups are plain JSON and safe to email to yourself or store in cloud storage.</p>
      </div>

      <UserMigrationSection />

      <BulkClaimEmailsSection />

      <PhotoCompressionPanel />
    </div>
  );
}

function UserMigrationSection() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState(null);

  const downloadExport = async () => {
    setBusy(true); setMsg("");
    try {
      const { data } = await api.get("/admin/users/export-with-hashes");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `sit-happens-users-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`Exported ${data.user_count} user accounts ✓`);
    } catch (e) {
      setMsg("Export failed — " + (formatErr(e.response?.data?.detail) || "unknown error"));
    }
    setBusy(false);
  };

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";  // allow re-select same file
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setMsg("That file isn't valid JSON.");
      return;
    }
    if (!Array.isArray(parsed.users)) {
      setMsg("Wrong format — expected a file from 'Export Users' button.");
      return;
    }
    const ok = await confirm({
      title: `Import ${parsed.users.length} user accounts?`,
      message: "Existing accounts with the same email will be updated. New ones will be inserted. Your own admin account is left untouched. Clients will be able to log in with their original passwords.",
      confirmText: "Import users",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true); setMsg(""); setResult(null);
    try {
      const { data } = await api.post("/admin/users/import-with-hashes", { users: parsed.users, mode: "merge" });
      setResult(data);
      setMsg(`Imported ✓ — ${data.inserted} new, ${data.updated} updated`);
    } catch (e) {
      setMsg("Import failed — " + (formatErr(e.response?.data?.detail) || "unknown error"));
    }
    setBusy(false);
  };

  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-4 space-y-3" data-testid="user-migration-section">
      <div>
        <p className="text-shGreen font-black uppercase tracking-widest text-[14px]"><i className="fas fa-key mr-2"/>Migrate User Logins (with passwords)</p>
        <p className="text-[14px] text-gray-400 mt-1 leading-relaxed">
          Move clients to a new host without making them reset their passwords. On your <span className="text-white font-black">old instance</span>, click Export. On your <span className="text-white font-black">new instance</span>, click Import and pick that file. Existing passwords keep working.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={downloadExport} disabled={busy} data-testid="user-export-btn"
                className="bg-shGreen text-bgHeader px-5 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
          <i className="fas fa-download mr-2"/>Export Users
        </button>
        <label className="bg-shBlue text-white px-5 py-2.5 rounded font-black text-[14px] uppercase tracking-widest shadow-lg cursor-pointer hover:bg-shBlue/90 disabled:opacity-50">
          <i className="fas fa-upload mr-2"/>Import Users
          <input type="file" accept="application/json,.json" onChange={importFile} disabled={busy} className="hidden" data-testid="user-import-file" />
        </label>
      </div>
      {msg && (
        <div className={`text-[14px] font-black uppercase tracking-widest p-2 rounded ${msg.includes("✓") ? "bg-shGreen/15 text-shGreen" : "bg-red-500/15 text-red-400"}`} data-testid="user-migration-msg">
          {msg}
        </div>
      )}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[14px]" data-testid="user-migration-result">
          <StatChip label="Inserted" value={result.inserted} color="text-shGreen" />
          <StatChip label="Updated" value={result.updated} color="text-shBlue" />
          <StatChip label="Skipped (Self)" value={result.skipped_self} color="text-gray-400" />
          <StatChip label="Skipped (No Hash)" value={result.skipped_no_email_or_hash} color="text-gray-400" />
        </div>
      )}
    </div>
  );
}

function BulkClaimEmailsSection() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const send = async () => {
    const ok = await confirm({
      title: "Send claim emails to all clients?",
      message: "Every client with an email and no portal login yet will receive a one-time link to set their password. Already-linked clients are skipped automatically. This may take a minute for large lists.",
      confirmText: "Send claim emails",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const { data } = await api.post("/clients/send-claim-emails/bulk");
      setResult(data);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Bulk send failed");
    }
    setBusy(false);
  };

  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-4 space-y-3" data-testid="bulk-claim-section">
      <div>
        <p className="text-shBlue font-black uppercase tracking-widest text-[14px]"><i className="fas fa-paper-plane mr-2"/>Mass Claim Emails (Recovery)</p>
        <p className="text-[14px] text-gray-400 mt-1 leading-relaxed">
          One-shot tool for migrations: emails every client a link to set their password. Use this after restoring a backup that contained clients but not their login credentials.
          Clients who already have a portal login are skipped automatically.
        </p>
      </div>
      <button onClick={send} disabled={busy} data-testid="bulk-claim-btn"
              className="bg-shBlue text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
        {busy ? <><i className="fas fa-spinner fa-spin mr-2"/>Sending…</> : <><i className="fas fa-envelopes-bulk mr-2"/>Send Claim Emails to All Clients</>}
      </button>
      {err && <div className="text-[14px] font-black uppercase tracking-widest p-2 rounded bg-red-500/15 text-red-400">{err}</div>}
      {result && (
        <div className="bg-bgPanel rounded p-3 space-y-2" data-testid="bulk-claim-result">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[14px]">
            <StatChip label="Total Clients" value={result.total_clients} color="text-gray-300" />
            <StatChip label="Sent ✓" value={result.sent_count} color="text-shGreen" />
            <StatChip label="No Email" value={result.skipped_no_email_count} color="text-gray-400" />
            <StatChip label="Already Linked" value={result.skipped_already_linked_count} color="text-gray-400" />
          </div>
          {result.errors_count > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-[15px]">
              <p className="text-red-400 font-black uppercase tracking-widest mb-1">{result.errors_count} error{result.errors_count===1?"":"s"}:</p>
              <ul className="text-gray-300 space-y-0.5">
                {result.errors.slice(0,5).map((e,i)=>(
                  <li key={i}>· {e.name} ({e.email}): {e.error}</li>
                ))}
                {result.errors.length > 5 && <li className="text-gray-500">…and {result.errors.length-5} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div className="bg-bgBase rounded px-2 py-2 flex flex-col items-center">
      <span className="text-[13px] text-gray-500 font-black uppercase tracking-widest">{label}</span>
      <span className={`text-xl font-black ${color}`}>{value}</span>
    </div>
  );
}

function PhotoCompressionPanel() {
  const confirm = useConfirm();
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try { const { data } = await api.get("/admin/compress-photos/status"); setStatus(data); }
    catch (e) { setErr(e.response?.data?.detail || "Could not fetch status"); }
  };

  // Poll while running.
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [status?.running]);

  const start = async () => {
    if (!(await confirm({ title: "Shrink all photos?", body: "This will recompress every photo in your database (dogs, gallery, report cards, incidents). It runs in the background and may take several minutes. Safe to leave the page during the job.", confirmText: "Start compression", tone: "warning" }))) return;
    setBusy(true); setErr("");
    try { const { data } = await api.post("/admin/compress-photos"); setStatus(data); }
    catch (e) { setErr(e.response?.data?.detail || "Could not start"); }
    finally { setBusy(false); }
  };

  const finished = status && !status.running && status.finished_at;
  const stageLabel = {
    "starting": "Getting ready…",
    "dogs": "Compressing dog photos & gallery",
    "bookings": "Compressing report card photos",
    "incidents": "Compressing incident photos",
    "done": "All done",
  }[status?.current_stage] || (status?.running ? "Working…" : "Idle");

  return (
    <div className="border-t border-bgHover pt-6" data-testid="photo-compress-panel">
      <h4 className="text-sm font-black text-purple-400 uppercase tracking-widest mb-2"><i className="fas fa-compress-arrows-alt mr-2"/>Shrink Existing Photos</h4>
      <p className="text-[14px] text-gray-300 mb-3 leading-relaxed">
        One-time job that recompresses every photo currently in your database to the smaller format used by new uploads. Typical savings: <span className="text-purple-400 font-black">10–20× smaller</span> per photo with no visible quality loss. Safe to run again later — already-small photos are skipped automatically.
      </p>

      {status && (
        <div className="bg-bgBase border border-bgHover rounded p-4 mb-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-center" data-testid="photo-compress-stats">
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Scanned</p>
            <p className="text-shBlue text-2xl font-black">{status.scanned}</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Compressed</p>
            <p className="text-shGreen text-2xl font-black">{status.compressed}</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Skipped</p>
            <p className="text-gray-400 text-2xl font-black">{status.skipped}</p>
          </div>
          <div>
            <p className="text-[12px] uppercase tracking-widest text-gray-500 font-black">Space saved</p>
            <p className="text-purple-400 text-2xl font-black">{status.mb_saved} MB</p>
          </div>
        </div>
      )}

      {status?.running && (
        <div className="bg-shBlue/10 border border-shBlue/40 rounded p-3 mb-3 flex items-center gap-3" data-testid="photo-compress-progress">
          <i className="fas fa-circle-notch fa-spin text-shBlue text-xl"/>
          <div className="flex-1">
            <p className="text-[14px] font-black text-shBlue uppercase tracking-widest">{stageLabel}</p>
            <p className="text-[14px] text-gray-400 mt-0.5">Working in the background. You can leave this page and come back later.</p>
          </div>
        </div>
      )}

      {finished && status.error_message && (
        <p className="text-red-400 text-[14px] font-black mb-3" data-testid="photo-compress-error">
          <i className="fas fa-exclamation-triangle mr-2"/>{status.error_message}
        </p>
      )}

      {finished && !status.error_message && status.compressed > 0 && (
        <p className="text-shGreen text-[14px] font-black mb-3" data-testid="photo-compress-done">
          <i className="fas fa-check-circle mr-2"/>Saved {status.mb_saved} MB across {status.compressed} photos.
        </p>
      )}

      <button onClick={start} disabled={busy || status?.running} data-testid="photo-compress-start"
              className="bg-purple-500 text-white px-6 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-lg disabled:opacity-50">
        <i className="fas fa-compress-arrows-alt mr-2"/>{status?.running ? "Running…" : (status?.finished_at ? "Run again" : "Shrink all photos")}
      </button>
      {err && <p className="text-red-400 text-[14px] mt-2">{err}</p>}
    </div>
  );
}

function CommandsPanel() {
  const confirm = useConfirm();
  const [commands, setCommands] = useState([]);
  const [meta, setMeta] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [c, m] = await Promise.all([api.get("/commands"), api.get("/training/meta")]);
      setCommands(c.data); setMeta(m.data);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const startNew = () => setEdit({ name: "", category: "obedience", description: "", video_url: "", order: 100, active: true });
  const save = async () => {
    try {
      if (edit.id) await api.put(`/commands/${edit.id}`, edit);
      else await api.post("/commands", edit);
      setEdit(null); load();
    } catch (e) { setErr(e.response?.data?.detail || "Save failed"); }
  };
  const remove = async (id) => {
    if (!(await confirm({ title: "Remove command?", body: "Existing dog progress is preserved. The command will no longer be available for new training plans.", confirmText: "Remove", tone: "warning" }))) return;
    try { await api.delete(`/commands/${id}`); load(); } catch (e) { setErr(e.response?.data?.detail || "Delete failed"); }
  };

  if (!meta) return <p className="text-gray-500 text-sm">Loading…</p>;
  const grouped = meta.categories.map(c => ({...c, items: commands.filter(x => x.category === c.key)}));

  return (
    <div className="space-y-5 max-w-3xl" data-testid="commands-panel">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-black text-shBlue uppercase tracking-widest"><i className="fas fa-graduation-cap mr-2"/>Service-Dog Command Library</h4>
          <p className="text-[14px] text-gray-300 mt-1">Curate the master list every dog's curriculum is built from. Seeded with TADSAW service-dog commands.</p>
        </div>
        <button onClick={startNew} data-testid="cmd-new"
                className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow"><i className="fas fa-plus mr-1"/>New</button>
      </div>

      {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-2 uppercase font-black">{err}</div>}

      {grouped.map(g => (
        <div key={g.key} className="bg-bgBase/40 border border-bgHover rounded">
          <div className="px-3 py-2 border-b border-bgHover" style={{background: g.color + "12"}}>
            <p className="text-[15px] font-black uppercase tracking-widest" style={{color: g.color}}>{g.label} · {g.items.length}</p>
          </div>
          <div className="divide-y divide-bgHover">
            {g.items.map(c => (
              <div key={c.id} className="px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white truncate">{c.name} {c.is_default && <span className="text-[13px] text-gray-500 font-black tracking-widest ml-2">(default)</span>}</p>
                  <p className="text-[15px] text-gray-400 truncate">{c.description}</p>
                </div>
                {c.video_url && <i className="fab fa-youtube text-red-500"/>}
                <button onClick={()=>setEdit({...c})} data-testid={`cmd-edit-${c.id}`} className="text-shBlue hover:text-white text-sm"><i className="fas fa-pen"/></button>
                <button onClick={()=>remove(c.id)} className="text-red-400 hover:text-red-300 text-sm"><i className="fas fa-trash"/></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {edit && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="cmd-modal">
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-base font-black text-white uppercase italic">{edit.id?"Edit Command":"New Command"}</h4>
              <button onClick={()=>setEdit(null)} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Name *</label>
                <input value={edit.name} onChange={(e)=>setEdit({...edit, name:e.target.value})} data-testid="cmd-name"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Category</label>
                <select value={edit.category} onChange={(e)=>setEdit({...edit, category:e.target.value})}
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {meta.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Description</label>
                <textarea value={edit.description||""} onChange={(e)=>setEdit({...edit, description:e.target.value})} rows={2}
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">YouTube video URL (optional)</label>
                <input value={edit.video_url||""} onChange={(e)=>setEdit({...edit, video_url:e.target.value})} data-testid="cmd-video"
                       placeholder="https://youtu.be/..."
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={()=>setEdit(null)} className="text-gray-500 font-black uppercase text-[15px] tracking-widest">Cancel</button>
                <button onClick={save} data-testid="cmd-save"
                        className="bg-shGreen text-bgHeader px-6 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function AutomationPanel() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const [err, setErr] = useState("");
  const [emailPerStep, setEmailPerStep] = useState(null); // null = loading
  const [stepBusy, setStepBusy] = useState(false);
  useEffect(() => {
    api.get("/settings").then(r => setEmailPerStep(!!r.data?.email_per_step)).catch(() => setEmailPerStep(false));
  }, []);
  const toggleEmailPerStep = async () => {
    setStepBusy(true);
    try {
      const next = !emailPerStep;
      await api.put("/settings", { email_per_step: next });
      setEmailPerStep(next);
    } catch {} finally { setStepBusy(false); }
  };
  const run = async () => {
    setBusy(true); setErr(""); setLast(null);
    try {
      const { data } = await api.post("/admin/daily-jobs/run-now");
      setLast(data?.result || {});
    } catch (e) {
      setErr(e.response?.data?.detail || "Run failed");
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-5 max-w-2xl" data-testid="automation-panel">
      <div>
        <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Email Automation & Notifications</h4>
        <p className="text-[15px] text-gray-500 font-black uppercase tracking-widest mt-1 normal-case">Background jobs that run automatically at most once per day, triggered the first time the admin dashboard loads each morning.</p>
      </div>

      {/* Sprint 105 — Per-step homework email toggle */}
      <div className="bg-bgBase border border-bgHover rounded-lg p-4" data-testid="email-per-step-row">
        <div className="flex items-start gap-3">
          <i className="fas fa-list-check text-shBlue text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Per-step homework emails</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">
              Default is <strong>off</strong> — instead, you get one nightly roll-up email at the end of the day with every step completed. Turn this on if you want a real-time email every time a client checks off ANY step. Heads-up: this can be a lot of emails.
            </p>
          </div>
          <button onClick={toggleEmailPerStep} disabled={stepBusy || emailPerStep === null}
                  data-testid="email-per-step-toggle"
                  className={`shrink-0 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest transition ${
                    emailPerStep ? "bg-shGreen text-bgHeader hover:bg-shGreen/90"
                                  : "bg-bgPanel text-gray-400 hover:bg-bgHover border border-bgHover"
                  } disabled:opacity-50`}>
            {emailPerStep === null ? "…" : emailPerStep ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="bg-bgBase border border-bgHover rounded-lg p-4 flex items-start gap-3">
          <i className="fas fa-cake-candles text-shGreen text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Dog Birthday Cards</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">Emails the owner a celebratory card with their dog's photo on the dog's birthday. De-duped per dog per year.</p>
          </div>
          <span className="bg-shGreen/15 text-shGreen text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded">On</span>
        </div>
        <div className="bg-bgBase border border-bgHover rounded-lg p-4 flex items-start gap-3">
          <i className="fas fa-syringe text-shOrange text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Vaccine Renewal Nudge</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">30 days before any vaccine expires, the owner gets a single email listing which renewals are due with a link to upload the updated record.</p>
          </div>
          <span className="bg-shOrange/15 text-shOrange text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded">On</span>
        </div>
        <div className="bg-bgBase border border-bgHover rounded-lg p-4 flex items-start gap-3">
          <i className="fas fa-envelope-open-text text-shBlue text-xl mt-1 w-7 text-center"/>
          <div className="flex-1">
            <p className="text-white font-black text-[14px] uppercase tracking-widest">Homework Daily Roll-up</p>
            <p className="text-[14px] text-gray-500 normal-case mt-1">One email at the end of each day summarising every step a client checked off — grouped by dog + plan. Replaces per-step spam.</p>
          </div>
          <span className="bg-shGreen/15 text-shGreen text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded">On</span>
        </div>
      </div>

      <div className="bg-bgBase border border-bgHover rounded-lg p-4">
        <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Manual trigger</p>
        <p className="text-[14px] text-gray-500 normal-case mt-1">Force-runs all daily jobs right now (clears today's "already ran" flag). Useful for testing.</p>
        <button onClick={run} disabled={busy} data-testid="run-daily-jobs-btn"
                className="mt-3 bg-shBlue text-white px-5 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
          {busy ? <><i className="fas fa-circle-notch fa-spin mr-2"/>Running…</> : <><i className="fas fa-play mr-2"/>Run Daily Jobs Now</>}
        </button>
        {err && <p className="text-red-400 text-[14px] mt-2 normal-case">{err}</p>}
        {last && (
          <div className="mt-3 grid grid-cols-2 gap-3 text-[14px] font-black uppercase tracking-widest">
            <div className="bg-bgPanel rounded p-3">
              <p className="text-gray-500">Birthdays</p>
              <p className="text-shGreen text-[20px]">{last.birthdays?.sent ?? 0}<span className="text-gray-500 text-[14px] ml-1">sent</span></p>
              <p className="text-gray-600 text-[13px]">{last.birthdays?.skipped ?? 0} skipped</p>
            </div>
            <div className="bg-bgPanel rounded p-3">
              <p className="text-gray-500">Vaccine Renewals</p>
              <p className="text-shOrange text-[20px]">{last.vaccine_expiry?.sent ?? 0}<span className="text-gray-500 text-[14px] ml-1">sent</span></p>
              <p className="text-gray-600 text-[13px]">{last.vaccine_expiry?.skipped ?? 0} skipped</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
