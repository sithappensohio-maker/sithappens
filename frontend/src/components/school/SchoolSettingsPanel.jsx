import { useEffect, useState } from "react";
import { api } from "../../lib/api";

const fields = [
  ["inactivity_days", "Inactivity flag", "days with no School activity", 1, 90],
  ["repeated_struggle_count", "Repeated struggle flag", "could-not-complete reports in 7 days", 1, 20],
  ["repeated_difficulty_count", "Repeated difficulty flag", "high-difficulty reports in 7 days", 1, 20],
  ["checkpoint_review_hours", "Checkpoint review overdue", "hours waiting for trainer review", 1, 168],
  ["question_response_hours", "Question response overdue", "hours waiting for a trainer reply", 1, 168],
];

export default function SchoolSettingsPanel() {
  const [value, setValue] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.get("/admin/school/settings").then((r) => setValue(r.data)).catch(() => setValue({})); }, []);
  const save = async () => {
    setSaving(true); setSaved(false);
    try { const { data } = await api.patch("/admin/school/settings", value); setValue(data); setSaved(true); setTimeout(() => setSaved(false), 1800); }
    finally { setSaving(false); }
  };
  if (!value) return <div className="h-44 rounded-2xl bg-shBorder/20 animate-pulse"/>;
  return <div className="max-w-4xl space-y-4" data-testid="school-settings-panel">
    <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.22em] text-shSecondary">School operations</p>
      <h3 className="text-xl font-black text-shText mt-1">Attention & service standards</h3>
      <p className="text-sm text-shTextMuted mt-1 max-w-2xl">These rules decide when School HQ surfaces a student before they get forgotten. They do not change course progression or automatically punish a student.</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-5">
        {fields.map(([key, label, help, min, max]) => <label key={key} className="rounded-xl border border-shBorder bg-black/15 p-3">
          <span className="block text-xs font-black text-shText">{label}</span>
          <span className="block text-[10px] text-shTextMuted mt-0.5">{help}</span>
          <input type="number" min={min} max={max} value={value[key] ?? ""} onChange={(e) => setValue((v) => ({ ...v, [key]: Number(e.target.value) }))} className="mt-3 w-full rounded-lg border border-shBorder bg-black/20 px-3 py-2 text-sm text-shText"/>
        </label>)}
      </div>
      <div className="flex items-center gap-3 mt-5"><button disabled={saving} onClick={save} className="min-h-[44px] px-5 rounded-xl bg-shPrimary text-bgHeader text-xs font-black uppercase tracking-widest">{saving ? "Saving…" : "Save School settings"}</button>{saved && <span className="text-xs font-black text-shPrimary"><i className="fas fa-check mr-1"/>Saved</span>}</div>
    </section>
    <section className="rounded-2xl border border-shBorder p-4 text-xs text-shTextMuted">
      <p className="font-black text-shText mb-1">What these settings do</p>
      Inactivity, repeated difficulty, overdue checkpoint reviews, and unanswered questions appear in the Interventions tab. Trainer Assist and checkpoint progression still follow their canonical School workflows.
    </section>
  </div>;
}
