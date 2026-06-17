/* Sprint 110eq — Phase 1 inline section.
   Drop-in for the client and dog detail cards. Lists this entity's intake
   submissions with status pills + a quick "Send form" affordance.
   Routes operator to the full Intake Forms screen for reviewing details. */
import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";

const STATUS_STYLE = {
  draft: "bg-bgHover text-gray-300",
  sent: "bg-shBlue/15 text-shBlue",
  submitted: "bg-shGreen/15 text-shGreen",
  reviewed: "bg-purple-500/15 text-purple-300",
  needs_follow_up: "bg-shOrange/15 text-shOrange",
  archived: "bg-bgHover text-gray-500",
};
const STATUS_LABEL = {
  draft: "Draft", sent: "Sent", submitted: "Submitted",
  reviewed: "Reviewed", needs_follow_up: "Needs follow-up", archived: "Archived",
};

export default function IntakeFormsSection({ clientId = null, dogId = null, label = "Intake Forms" }) {
  const [subs, setSubs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [open, setOpen] = useState(false);
  const [pickTemplate, setPickTemplate] = useState("");

  const load = async () => {
    const q = new URLSearchParams();
    if (clientId) q.append("client_id", clientId);
    if (dogId) q.append("dog_id", dogId);
    try {
      const [s, t] = await Promise.all([
        api.get(`/intake/submissions?${q.toString()}`),
        api.get("/intake/templates?active=true"),
      ]);
      setSubs(s.data.submissions || []);
      setTemplates((t.data.templates || []).filter(x => x.active));
    } catch (e) { /* silent — section just stays empty on error */ }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clientId, dogId]);

  const send = async () => {
    if (!pickTemplate) { toast.error("Pick a form template"); return; }
    if (!clientId) { toast.error("No client to send to"); return; }
    try {
      await api.post("/intake/submissions", { template_id: pickTemplate, client_id: clientId, dog_id: dogId || null, status: "sent" });
      toast.success("Form assigned");
      setOpen(false);
      setPickTemplate("");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const jumpToIntake = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("sh:nav", { detail: "intake" }));
  };

  return (
    <div className="mt-3 pt-3 border-t border-bgHover" data-testid={`intake-section-${clientId || dogId}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-black uppercase tracking-widest text-gray-500">
          <i className="fas fa-clipboard-list mr-1"/>{label} · {subs.length}
        </div>
        <div className="flex gap-3">
          <button onClick={jumpToIntake} className="text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-shBlue/80"
                  data-testid={`open-intake-${clientId || dogId}`}>
            Manage
          </button>
          {clientId && templates.length > 0 && (
            <button onClick={()=>setOpen(true)} data-testid={`send-intake-${clientId || dogId}`}
                    className="text-[13px] font-black uppercase tracking-widest text-shGreen hover:text-shGreen/80">+ Send</button>
          )}
        </div>
      </div>

      {subs.length === 0 ? (
        <p className="text-[13px] text-gray-500 italic">No intake forms yet.</p>
      ) : (
        <ul className="space-y-1">
          {subs.slice(0, 6).map(s => (
            <li key={s.id} className="flex items-center gap-2 flex-wrap text-[13px]"
                data-testid={`intake-sub-${s.id}`}>
              <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${STATUS_STYLE[s.status] || "bg-bgHover"}`}>
                {STATUS_LABEL[s.status] || s.status}
              </span>
              <span className="text-white font-black truncate">{s.template_name}</span>
              <span className="text-gray-500 ml-auto">{s.created_at?.slice(0,10)}</span>
            </li>
          ))}
          {subs.length > 6 && <li className="text-[12px] text-gray-500 italic">+ {subs.length - 6} more — open Intake Forms to view all.</li>}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Send intake form</h4>
              <button onClick={()=>setOpen(false)} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
            </div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Template</label>
            <select value={pickTemplate} onChange={(e)=>setPickTemplate(e.target.value)} data-testid="quick-send-template"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="">— Pick a template —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="mt-3 text-[11px] text-gray-500 italic">
              <i className="fas fa-circle-info mr-1"/>Status will be set to <strong>Sent</strong>. Client-portal completion ships in the next phase.
            </p>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[12px] tracking-widest">Cancel</button>
              <button onClick={send} data-testid="quick-send-confirm"
                      className="bg-shBlue text-white px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest">
                <i className="fas fa-paper-plane mr-1"/>Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
