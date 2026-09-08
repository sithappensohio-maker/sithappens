import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

/**
 * Settings → Public Website. The facts and words the logged-out website shows:
 * contact details, address, service area, hero wording, gallery and social
 * links. Saved as `settings.public_site`; GET /public/site merges these over
 * the defaults, so an empty field falls back to the seeded value.
 */
const FIELDS = [
  { group: "Business", items: [
    { key: "business_name", label: "Business name", placeholder: "Sit Happens Dog Training" },
    { key: "tagline", label: "Tagline (under the logo)", placeholder: "Dog Training · Daycare & Boarding · Warren, Ohio" },
    { key: "service_area", label: "Service area", placeholder: "Warren, Ohio and the surrounding Mahoning Valley", hint: "Shown as “Serving …” on the homepage, About and Contact pages." },
  ] },
  { group: "Contact", items: [
    { key: "phone", label: "Phone", placeholder: "(330) 978-5575", type: "tel" },
    { key: "email", label: "Email", placeholder: "sithappensohio@gmail.com", type: "email" },
    { key: "address_line", label: "Street address", placeholder: "137 North St NW" },
    { key: "city", label: "City", placeholder: "Warren", half: true },
    { key: "state", label: "State", placeholder: "OH", half: true },
    { key: "zip", label: "ZIP", placeholder: "44483", half: true },
    { key: "map_url", label: "Directions link (optional)", placeholder: "Leave blank to use a Google Maps search of the address", type: "url" },
  ] },
  { group: "Homepage hero", items: [
    { key: "hero_headline", label: "Headline", placeholder: "Dog training for real-life chaos in Warren, Ohio." },
    { key: "hero_subheadline", label: "Sub-headline", placeholder: "We help dogs (and their humans) build better habits…", multiline: true },
  ] },
  { group: "Links", items: [
    { key: "gallery_url", label: "Photo gallery link", placeholder: "https://…", type: "url", hint: "The “View photo galleries” button on the Pet Photography page." },
    { key: "facebook_url", label: "Facebook", placeholder: "https://facebook.com/…", type: "url" },
    { key: "instagram_url", label: "Instagram", placeholder: "https://instagram.com/…", type: "url" },
  ] },
];
const KEYS = FIELDS.flatMap((g) => g.items.map((i) => i.key));

const inputCls = "w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm focus:border-shSecondary outline-none";

export default function PublicWebsitePanel() {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    // Load the EFFECTIVE values (defaults merged) so the form shows what the
    // website is showing right now, not a pile of blanks.
    api.get("/public/site")
      .then((r) => { if (alive) setDraft(Object.fromEntries(KEYS.map((k) => [k, (r.data?.site || {})[k] || ""]))); })
      .catch((e) => { if (alive) setErr(formatErr(e.response?.data?.detail) || "Couldn't load the website settings."); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const public_site = Object.fromEntries(KEYS.map((k) => [k, (draft[k] || "").trim()]));
      await api.put("/settings", { public_site });
      toast.success("Public website updated");
    } catch (e) {
      const m = formatErr(e.response?.data?.detail) || "Couldn't save.";
      setErr(m); toast.error(m);
    }
    setSaving(false);
  };

  if (!draft) return <p className="text-shTextMuted text-sm" data-testid="public-website-loading">{err || "Loading…"}</p>;

  return (
    <div className="space-y-6" data-testid="public-website-panel">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4">
        <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-globe mr-2" />Public website</p>
        <p className="text-[13px] text-shTextMuted mt-1 leading-relaxed">
          What visitors see when they open sithappens.app without signing in. Prices come from Services & Programs, hours from Hours & Closures, the photography headline from Photography Page. Blank fields fall back to the built-in defaults.
          {" "}<a href="/" target="_blank" rel="noopener noreferrer" className="text-shPrimary font-black uppercase tracking-widest text-[11px]" data-testid="public-website-preview">Open the website <i className="fas fa-arrow-up-right-from-square ml-1" /></a>
        </p>
      </div>

      {FIELDS.map((g) => (
        <section key={g.group} className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4" data-testid={`public-website-group-${g.group.toLowerCase().replace(/\s+/g, "-")}`}>
          <h3 className="text-[13px] font-black uppercase tracking-widest text-shText mb-3">{g.group}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {g.items.map((f) => (
              <div key={f.key} className={f.half ? "" : "sm:col-span-2"}>
                <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted" htmlFor={`ps-${f.key}`}>{f.label}</label>
                {f.multiline
                  ? <textarea id={`ps-${f.key}`} rows={3} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} placeholder={f.placeholder} data-testid={`public-website-${f.key}`} className={inputCls} />
                  : <input id={`ps-${f.key}`} type={f.type || "text"} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} placeholder={f.placeholder} data-testid={`public-website-${f.key}`} className={inputCls} />}
                {f.hint && <p className="text-[11px] text-shTextMuted mt-1">{f.hint}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}

      {err && <p className="text-[13px] text-red-300 bg-red-500/10 rounded p-3 font-black" data-testid="public-website-error">{err}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} data-testid="public-website-save"
                className="bg-shPrimary text-bgHeader px-5 py-2.5 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
          {saving ? "Saving…" : "Save website settings"}
        </button>
      </div>
    </div>
  );
}
