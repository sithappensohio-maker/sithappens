/* Sprint 110ey — Phase 8: Client communication log
   Drop-in timeline section for client/dog detail cards. */
import { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { toast } from "sonner";

const TYPE_META = {
  phone_call:      { label: "Phone",     icon: "fa-phone",         cls: "bg-shPrimary/15 text-shPrimary" },
  voicemail:       { label: "Voicemail", icon: "fa-voicemail",     cls: "bg-shSecondary/15 text-shSecondary" },
  text:            { label: "Text",      icon: "fa-message",       cls: "bg-shPrimary/15 text-shPrimary" },
  email:           { label: "Email",     icon: "fa-envelope",      cls: "bg-shSecondary/15 text-shSecondary" },
  in_person:       { label: "In-person", icon: "fa-handshake",     cls: "bg-purple-500/15 text-purple-300" },
  behavior:        { label: "Behavior",  icon: "fa-paw",           cls: "bg-shAccent/15 text-shAccent" },
  schedule_change: { label: "Schedule",  icon: "fa-calendar",      cls: "bg-shSecondary/15 text-shSecondary" },
  payment:         { label: "Payment",   icon: "fa-dollar-sign",   cls: "bg-shPrimary/15 text-shPrimary" },
  complaint:       { label: "Complaint", icon: "fa-triangle-exclamation", cls: "bg-red-500/15 text-red-300" },
  follow_up:       { label: "Follow-up", icon: "fa-bell",          cls: "bg-shAccent/15 text-shAccent" },
  general:         { label: "Note",      icon: "fa-note-sticky",   cls: "bg-shSurfaceRaised text-shTextMuted" },
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export default function CommunicationLog({ clientId, dogId = null }) {
  const confirm = useConfirm();
  const [entries, setEntries] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({
    type: "phone_call", summary: "",
    follow_up_required: false, follow_up_date: "",
  });

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (clientId) params.append("client_id", clientId);
      if (dogId) params.append("dog_id", dogId);
      params.append("limit", "100");
      const { data } = await api.get(`/communications?${params.toString()}`);
      setEntries(data.entries || []);
    } catch { setEntries([]); }
  }, [clientId, dogId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clientId, dogId]);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "open_followups") return entries.filter(e => e.follow_up_required && !e.follow_up_resolved_at);
    return entries.filter(e => e.type === filter);
  }, [entries, filter]);

  const counts = useMemo(() => {
    const c = { all: entries.length };
    c.open_followups = entries.filter(e => e.follow_up_required && !e.follow_up_resolved_at).length;
    for (const t of Object.keys(TYPE_META)) c[t] = entries.filter(e => e.type === t).length;
    return c;
  }, [entries]);

  const save = async () => {
    if (!form.summary.trim()) { toast.error("Summary is required"); return; }
    try {
      await api.post("/communications", {
        client_id: clientId, dog_id: dogId || null,
        type: form.type, summary: form.summary.trim(),
        follow_up_required: !!form.follow_up_required,
        follow_up_date: form.follow_up_required ? (form.follow_up_date || null) : null,
      });
      toast.success("Logged");
      setShowAdd(false);
      setForm({ type: "phone_call", summary: "", follow_up_required: false, follow_up_date: "" });
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const resolveFollowup = async (entry) => {
    try {
      await api.post(`/communications/${entry.id}/resolve`);
      toast.success("Follow-up resolved");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (entry) => {
    const ok = await confirm({
      title: "Delete this log entry?",
      body: "Permanent — no undo. Audit log still keeps a record of the deletion.",
      confirmText: "Delete", tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/communications/${entry.id}`);
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  return (
    <div className="mt-3 pt-3 border-t border-shBorder" data-testid={`comm-log-${clientId}-${dogId || ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">
          <i className="fas fa-comments mr-1"/>Communication · {entries.length}
          {counts.open_followups > 0 && (
            <span className="ml-2 text-shAccent">{counts.open_followups} open follow-up{counts.open_followups===1?"":"s"}</span>
          )}
        </div>
        <button onClick={()=>setShowAdd(true)} data-testid={`add-comm-${clientId}`}
                className="text-[13px] font-black uppercase tracking-widest text-shPrimary hover:text-shPrimary/80">
          + Log
        </button>
      </div>

      {entries.length > 3 && (
        <div className="flex flex-wrap gap-1 mb-2">
          <Pill active={filter==="all"} onClick={()=>setFilter("all")} label={`All · ${counts.all}`}/>
          {counts.open_followups > 0 && (
            <Pill active={filter==="open_followups"} onClick={()=>setFilter("open_followups")} label={`Open follow-up · ${counts.open_followups}`} accent="shAccent"/>
          )}
          {Object.entries(TYPE_META).filter(([k]) => counts[k] > 0).map(([k, m]) => (
            <Pill key={k} active={filter===k} onClick={()=>setFilter(k)} label={`${m.label} · ${counts[k]}`}/>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-[13px] text-shTextMuted italic">No communication logged yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {visible.slice(0, 10).map(e => {
            const meta = TYPE_META[e.type] || TYPE_META.general;
            const isOpenFu = e.follow_up_required && !e.follow_up_resolved_at;
            return (
              <li key={e.id} className={`bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-2 ${isOpenFu ? "border-l-4 border-l-shAccent" : ""}`}
                  data-testid={`comm-entry-${e.id}`}>
                <div className="flex items-start gap-2 flex-wrap">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${meta.cls}`}>
                    <i className={`fas ${meta.icon} mr-1`}/>{meta.label}
                  </span>
                  <span className="text-[12px] text-shTextMuted flex-1 min-w-0">{e.summary}</span>
                  <span className="text-[11px] text-shTextMuted font-mono">{(e.occurred_at || "").slice(0, 10)}</span>
                </div>
                {(e.created_by_name || isOpenFu) && (
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px]">
                    {e.created_by_name && <span className="text-shTextMuted">by {e.created_by_name}</span>}
                    {isOpenFu && (
                      <>
                        <span className="text-shAccent font-black uppercase tracking-widest">
                          <i className="fas fa-bell mr-1"/>Follow-up{e.follow_up_date ? ` · ${e.follow_up_date}` : ""}
                        </span>
                        <button onClick={()=>resolveFollowup(e)} data-testid={`resolve-${e.id}`}
                                className="text-shPrimary font-black uppercase tracking-widest hover:underline ml-auto">
                          Mark resolved
                        </button>
                      </>
                    )}
                    {!isOpenFu && (
                      <button onClick={()=>remove(e)} data-testid={`del-comm-${e.id}`}
                              className="ml-auto text-gray-600 hover:text-red-300">
                        <i className="fas fa-trash text-[10px]"/>
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
          {visible.length > 10 && <li className="text-[12px] text-shTextMuted italic">+ {visible.length - 10} more.</li>}
        </ul>
      )}

      {showAdd && (
        <AddModal form={form} setForm={setForm} onSave={save} onCancel={()=>setShowAdd(false)} />
      )}
    </div>
  );
}

function Pill({ active, onClick, label, accent = "shPrimary" }) {
  const activeCls = accent === "shAccent" ? "bg-shAccent text-bgBase border-shAccent" : "bg-shPrimary text-bgBase border-shPrimary";
  return (
    <button onClick={onClick}
            className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border transition
                       ${active ? activeCls : "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder hover:text-shText"}`}>
      {label}
    </button>
  );
}

function AddModal({ form, setForm, onSave, onCancel }) {
  return createPortal((
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[100]">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto" data-testid="comm-add-modal">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-black text-shText uppercase italic tracking-tight">Log Communication</h4>
          <button onClick={onCancel} className="text-shTextMuted hover:text-shText"><i className="fas fa-times"/></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-black text-shTextMuted uppercase tracking-widest">Type</label>
            <div className="mt-1 grid grid-cols-3 gap-1">
              {Object.entries(TYPE_META).map(([k, m]) => (
                <button key={k} type="button" onClick={()=>setForm({ ...form, type: k })}
                        data-testid={`comm-type-${k}`}
                        className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-1.5 rounded border ${form.type===k?"bg-shPrimary text-bgBase border-shPrimary":"bg-[var(--sh-card-base)] border-shBorder text-shTextMuted hover:text-shText"}`}>
                  <i className={`fas ${m.icon} mr-1`}/>{m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] font-black text-shTextMuted uppercase tracking-widest">Summary</label>
            <textarea value={form.summary} onChange={(e)=>setForm({ ...form, summary: e.target.value })} rows={3}
                      autoFocus data-testid="comm-summary"
                      placeholder="What was discussed? Keep it short and factual."
                      className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.follow_up_required}
                   onChange={(e)=>setForm({ ...form, follow_up_required: e.target.checked, follow_up_date: e.target.checked ? (form.follow_up_date || todayISO()) : "" })}
                   className="accent-shAccent w-4 h-4" data-testid="comm-fu-required"/>
            <span className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Follow-up needed</span>
          </label>
          {form.follow_up_required && (
            <div>
              <label className="text-[12px] font-black text-shTextMuted uppercase tracking-widest">Follow-up date</label>
              <input type="date" value={form.follow_up_date} onChange={(e)=>setForm({ ...form, follow_up_date: e.target.value })}
                     style={{ colorScheme: "dark" }} data-testid="comm-fu-date"
                     className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-shBorder">
            <button onClick={onCancel} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest">Cancel</button>
            <button onClick={onSave} data-testid="comm-save"
                    className="bg-shPrimary text-bgBase px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow-xl">
              <i className="fas fa-save mr-1"/>Log entry
            </button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
