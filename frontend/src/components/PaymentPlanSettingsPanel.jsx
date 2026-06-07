import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import RichTextEditor from "./RichTextEditor";

/**
 * Sprint 110ch — Payment plans admin settings.
 *
 * Lives at Settings → Payment Plans. Lets the operator customize:
 *   • The agreement HTML (rendered into each plan with {{variables}})
 *   • Business name shown in the agreement
 *   • How many days before each due date to send a reminder
 *   • Default cadence preset
 */
export default function PaymentPlanSettingsPanel() {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.get("/admin/payment-plans/settings")
      .then(r => setDraft(r.data))
      .catch(() => setDraft({}));
  }, []);

  if (!draft) return <div className="text-gray-400 text-sm">Loading…</div>;

  const update = (k, v) => setDraft({ ...draft, [k]: v });

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      await api.put("/admin/payment-plans/settings", draft);
      setMsg("Saved");
      setTimeout(() => setMsg(""), 1800);
    } catch (e) {
      setMsg(formatErr(e.response?.data?.detail) || "Save failed");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-5" data-testid="payment-plan-settings">
      <div className="bg-bgPanel border border-bgHover rounded-xl p-5 shadow-xl">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shGreen mb-1">
              <i className="fas fa-file-signature mr-1.5"/>Big-ticket payment plans
            </p>
            <h3 className="text-xl font-black text-white">Agreement & Defaults</h3>
            <p className="text-xs text-gray-400 mt-1">Variables inside the agreement are auto-filled when each plan is created.</p>
          </div>
          {msg && (
            <span className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded ${msg === "Saved" ? "bg-shGreen/15 text-shGreen border border-shGreen/30" : "bg-red-500/15 text-red-400 border border-red-500/30"}`}>
              {msg === "Saved" && <i className="fas fa-check mr-1"/>}{msg}
            </span>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-1">Business name (in agreement)</label>
            <input value={draft.business_name || ""} onChange={e => update("business_name", e.target.value)}
                   data-testid="plan-business-name"
                   className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-1">Reminder · days before due</label>
            <input type="number" min={0} max={30}
                   value={draft.reminder_days_before ?? 3}
                   onChange={e => update("reminder_days_before", Number(e.target.value))}
                   data-testid="plan-reminder-days"
                   className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-1">Default cadence</label>
            <select value={draft.default_cadence || "biweekly"}
                    onChange={e => update("default_cadence", e.target.value)}
                    data-testid="plan-default-cadence"
                    className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white">
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="monthly">Monthly</option>
              <option value="custom">Custom (no preset)</option>
            </select>
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-[12px] font-black text-gray-300 uppercase tracking-widest mb-2">
            Agreement text
          </label>
          <p className="text-[11px] text-gray-500 mb-1">
            Type your agreement like a normal document — bold, italic, lists, links all work via the toolbar.
          </p>
          <p className="text-[11px] text-gray-400 mb-2">
            <i className="fas fa-magic-wand-sparkles text-shBlue mr-1"/>
            <strong>Auto-fill buttons</strong> at the bottom drop in placeholders that get <em>automatically</em> replaced with each client&apos;s actual info when the agreement is sent. Example: clicking <span className="text-shBlue font-black">Client&apos;s full name</span> shows up as <code className="bg-bgHover px-1 rounded text-shBlue">{`{{client_name}}`}</code> in the editor, but the client sees their real name (e.g. &ldquo;Alex Rivera&rdquo;). You don&apos;t need to type these by hand — just click.
          </p>
          <RichTextEditor
            value={draft.agreement_html || ""}
            onChange={v => update("agreement_html", v)}
            testId="plan-agreement-html"
            rows={14}
            placeholder="By signing below, the client agrees to the schedule and terms above…"
            variables={["business_name", "client_name", "program_name", "total_amount", "installment_count", "installment_amount", "schedule_list"]}
          />
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
                  data-testid="plan-settings-save"
                  className="bg-shBlue hover:bg-shBlue/80 text-white px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Live agreement preview */}
      {draft.agreement_html && (
        <div className="bg-white rounded-xl p-6 shadow-xl"
             data-testid="plan-agreement-preview">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-3">
            <i className="fas fa-eye mr-1"/>Preview · with sample data
          </p>
          <div className="prose prose-sm max-w-none text-gray-900"
               dangerouslySetInnerHTML={{
                 __html: (draft.agreement_html || "")
                   .replaceAll("{{business_name}}", draft.business_name || "Sit Happens")
                   .replaceAll("{{client_name}}", "Alex Rivera")
                   .replaceAll("{{program_name}}", "Service Dog Program")
                   .replaceAll("{{total_amount}}", "$2,000.00")
                   .replaceAll("{{installment_count}}", "4")
                   .replaceAll("{{installment_amount}}", "$500.00")
                   .replaceAll("{{schedule_list}}", "• 2026-07-01 — $500.00<br/>• 2026-07-15 — $500.00<br/>• 2026-07-29 — $500.00<br/>• 2026-08-12 — $500.00"),
               }} />
        </div>
      )}
    </div>
  );
}
