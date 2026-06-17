import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";

/** Filter chip row */
function FilterChips({ available, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="bulk-email-filter-chips">
      {available.map(f => {
        const on = selected.includes(f.id);
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onToggle(f.id)}
            data-testid={`bulk-email-filter-${f.id}`}
            className={`text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border transition ${
              on
                ? "bg-shGreen/15 text-shGreen border-shGreen"
                : "bg-bgBase text-gray-400 border-bgHover hover:border-shGreen/40 hover:text-white"
            }`}
          >
            {on && <i className="fas fa-check mr-1.5"/>}{f.label}
          </button>
        );
      })}
    </div>
  );
}

/** Preview pane */
function PreviewBox({ subject, body, recipient }) {
  const ctx = {
    client_first_name: recipient?.first_name || "Sarah",
    client_name: recipient?.name || "Sarah Connor",
    dog_names: recipient?.dog_names || "Rex",
  };
  const sub = (subject || "").replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
  const text = (body || "").replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? `{{${k}}}`);
  return (
    <div className="bg-bgBase rounded border border-bgHover p-4" data-testid="bulk-email-preview">
      <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black">
        Preview (merge tags rendered for <span className="text-shGreen">{ctx.client_name}</span>)
      </p>
      <p className="text-sm font-black text-white mt-2">Subject: {sub || <em className="text-gray-500">(empty)</em>}</p>
      <pre className="text-[13px] text-gray-200 mt-2 whitespace-pre-wrap font-sans">{text || <em className="text-gray-500">(empty)</em>}</pre>
    </div>
  );
}

export default function BulkEmail() {
  const [available, setAvailable] = useState([]);
  const [selected, setSelected] = useState(["active"]);
  const [manualIds, setManualIds] = useState(null); // null = filter mode; array = manual mode
  const [recipients, setRecipients] = useState([]);
  const [recipientCount, setRecipientCount] = useState(0);
  const [loadingRecips, setLoadingRecips] = useState(false);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templateName, setTemplateName] = useState("");

  const [templates, setTemplates] = useState([]);
  const [history, setHistory] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [view, setView] = useState("compose"); // compose | templates | history

  const loadTemplates = async () => {
    const { data } = await api.get("/admin/bulk-email/templates");
    setTemplates(data || []);
  };
  const loadHistory = async () => {
    const { data } = await api.get("/admin/bulk-email/history");
    setHistory(data || []);
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/bulk-email/filters");
        setAvailable(data?.available || []);
      } catch { toast.error("Failed to load filters"); }
      await loadTemplates();
      await loadHistory();
    })();
  }, []);

  // Refresh recipient list when filters/manual change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingRecips(true);
      try {
        const payload = manualIds ? { client_ids: manualIds } : { filters: selected };
        const { data } = await api.post("/admin/bulk-email/recipients", payload);
        if (!cancelled) { setRecipientCount(data.count); setRecipients(data.recipients || []); }
      } catch {
        if (!cancelled) { setRecipientCount(0); setRecipients([]); }
      } finally {
        if (!cancelled) setLoadingRecips(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, manualIds]);

  const toggleFilter = (id) => {
    setManualIds(null);
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const applyTemplate = (t) => {
    setSubject(t.subject || "");
    setBody(t.body || "");
    setView("compose");
    toast.success(`Loaded template: ${t.name}`);
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) { toast.error("Give the template a name first"); return; }
    if (!subject.trim() || !body.trim()) { toast.error("Subject and body are required"); return; }
    try {
      await api.post("/admin/bulk-email/templates", { name: templateName.trim(), subject, body });
      toast.success("Template saved");
      setTemplateName("");
      await loadTemplates();
    } catch (e) { toast.error("Save failed: " + (e?.response?.data?.detail || e.message)); }
  };

  const deleteTemplate = async (id) => {
    try { await api.delete(`/admin/bulk-email/templates/${id}`); toast.success("Template deleted"); await loadTemplates(); }
    catch (e) { toast.error("Delete failed: " + (e?.response?.data?.detail || e.message)); }
  };

  const doSend = async (testOnly = false) => {
    if (!subject.trim() || !body.trim()) { toast.error("Subject and body are required"); return; }
    setSending(true);
    try {
      const payload = manualIds
        ? { subject, body, client_ids: manualIds, test_only: testOnly }
        : { subject, body, filters: selected, test_only: testOnly };
      const { data } = await api.post("/admin/bulk-email/send", payload);
      toast.success(
        testOnly
          ? `Test email sent to ${data.success_count}/${data.recipient_count}.`
          : `Sent ${data.success_count} / ${data.recipient_count} emails`
      );
      await loadHistory();
      setConfirmOpen(false);
    } catch (e) {
      toast.error("Send failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setSending(false);
    }
  };

  const sample = recipients[0];
  const isManualMode = manualIds != null;

  return (
    <div className="space-y-5" data-testid="bulk-email-screen">
      {/* Header */}
      <div className="bg-bgPanel rounded-xl border border-bgHover p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs font-black text-white uppercase tracking-widest">
              <i className="fas fa-paper-plane mr-2 text-shGreen"/>Bulk Client Email
            </p>
            <p className="text-[13px] text-gray-400 mt-1 max-w-xl">
              Send a single email to a filtered slice of your clients. Every send is logged on each recipient's
              communication timeline so nothing falls through the cracks.
            </p>
          </div>
          <div className="flex bg-bgBase rounded p-1 gap-1">
            {[
              { id: "compose",   label: "Compose",   icon: "fa-pen-to-square" },
              { id: "templates", label: "Templates", icon: "fa-bookmark" },
              { id: "history",   label: "History",   icon: "fa-clock-rotate-left" },
            ].map(t => (
              <button key={t.id} onClick={() => setView(t.id)}
                      data-testid={`bulk-email-view-${t.id}`}
                      className={`text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded transition ${
                        view === t.id ? "bg-shGreen/15 text-shGreen" : "text-gray-400 hover:text-white"
                      }`}>
                <i className={`fas ${t.icon} mr-1.5`}/>{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "compose" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Compose */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-bgPanel rounded-xl border border-bgHover p-5 space-y-4">
              <div>
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Filters</label>
                <FilterChips available={available} selected={isManualMode ? [] : selected} onToggle={toggleFilter} />
                {isManualMode && (
                  <button
                    onClick={() => { setManualIds(null); }}
                    className="mt-3 text-[11px] text-shBlue underline"
                    data-testid="bulk-email-clear-manual"
                  >Clear manual selection and use filters →</button>
                )}
              </div>

              <div>
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">
                  Subject <span className="text-gray-600 normal-case">(supports <code className="text-shBlue">{`{{client_first_name}}`}</code>, <code className="text-shBlue">{`{{dog_names}}`}</code>)</span>
                </label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  data-testid="bulk-email-subject"
                  placeholder="e.g. Welcome to the new Sit Happens app, {{client_first_name}}!"
                  className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"
                />
              </div>

              <div>
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Body</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  rows={10}
                  data-testid="bulk-email-body"
                  placeholder="Write your message. Use {{client_first_name}} and {{dog_names}} for personalisation."
                  className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white font-mono"
                />
              </div>

              <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-bgHover">
                <input
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="Template name to save as…"
                  data-testid="bulk-email-template-name"
                  className="bg-bgBase border border-bgHover rounded px-3 py-1.5 text-sm text-white flex-1 min-w-[160px]"
                />
                <button onClick={saveTemplate} data-testid="bulk-email-save-template"
                        className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-shBlue/15 text-shBlue hover:bg-shBlue/25">
                  <i className="fas fa-bookmark mr-1.5"/>Save as Template
                </button>
              </div>
            </div>

            <PreviewBox subject={subject} body={body} recipient={sample} />
          </div>

          {/* Right side: recipients + send */}
          <div className="space-y-4">
            <div className="bg-bgPanel rounded-xl border border-bgHover p-5" data-testid="bulk-email-recipients">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black text-white uppercase tracking-widest">Recipients</p>
                <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${
                  recipientCount > 0 ? "bg-shGreen/15 text-shGreen" : "bg-gray-700/30 text-gray-500"
                }`}>
                  {loadingRecips ? "…" : `${recipientCount} client${recipientCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-bgHover/60">
                {recipients.length === 0 && !loadingRecips && (
                  <p className="text-[12px] text-gray-500 py-2">No clients match — try different filters.</p>
                )}
                {recipients.slice(0, 50).map(r => (
                  <div key={r.id} className="py-2 text-[12px]" data-testid={`bulk-email-recip-${r.id}`}>
                    <p className="text-white font-black truncate">{r.name}</p>
                    <p className="text-gray-500 truncate">{r.email}</p>
                  </div>
                ))}
                {recipients.length > 50 && (
                  <p className="text-[12px] text-gray-500 py-2">…and {recipients.length - 50} more</p>
                )}
              </div>
            </div>

            <div className="bg-bgPanel rounded-xl border border-bgHover p-5 space-y-2">
              <button
                onClick={() => doSend(true)}
                disabled={sending || recipientCount === 0 || !subject.trim() || !body.trim()}
                data-testid="bulk-email-test-send"
                className="w-full text-[12px] font-black uppercase tracking-widest px-3 py-2 rounded bg-shBlue/10 text-shBlue hover:bg-shBlue/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="fas fa-flask mr-1.5"/>Send Test (first recipient only)
              </button>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={sending || recipientCount === 0 || !subject.trim() || !body.trim()}
                data-testid="bulk-email-send"
                className="w-full text-[13px] font-black uppercase tracking-widest px-3 py-2.5 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i className="fas fa-paper-plane mr-1.5"/>Send to {recipientCount} {recipientCount === 1 ? "client" : "clients"}
              </button>
            </div>
          </div>
        </div>
      )}

      {view === "templates" && (
        <div className="bg-bgPanel rounded-xl border border-bgHover p-5">
          <p className="text-xs font-black text-white uppercase tracking-widest mb-4">
            Templates ({templates.length})
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map(t => (
              <div key={t.id} className="bg-bgBase rounded border border-bgHover p-4" data-testid={`template-${t.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-black text-white">{t.name}</p>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
                    t.kind === "system" ? "bg-shBlue/15 text-shBlue" : "bg-shOrange/15 text-shOrange"
                  }`}>{t.kind}</span>
                </div>
                <p className="text-[12px] text-gray-400 mt-1 truncate">{t.subject}</p>
                <p className="text-[11px] text-gray-500 mt-2 line-clamp-3 whitespace-pre-line">{t.body}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => applyTemplate(t)} data-testid={`template-use-${t.id}`}
                          className="text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded bg-shGreen/15 text-shGreen hover:bg-shGreen/25">
                    <i className="fas fa-pen mr-1"/>Use
                  </button>
                  {t.kind === "custom" && (
                    <button onClick={() => deleteTemplate(t.id)} data-testid={`template-delete-${t.id}`}
                            className="text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20">
                      <i className="fas fa-trash"/>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "history" && (
        <div className="bg-bgPanel rounded-xl border border-bgHover p-5">
          <p className="text-xs font-black text-white uppercase tracking-widest mb-4">
            Sent History ({history.length})
          </p>
          <div className="divide-y divide-bgHover/60">
            {history.length === 0 && <p className="text-[12px] text-gray-500 py-2">No emails sent yet.</p>}
            {history.map(h => (
              <div key={h.id} className="py-3" data-testid={`history-${h.id}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white truncate">{h.subject}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {new Date(h.started_at).toLocaleString()} · by {h.sender_name}
                      {h.test_only && <span className="ml-2 text-shOrange">[test]</span>}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Filters: {(h.filters || []).join(", ") || (h.manual_selection ? "manual selection" : "all")}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-black text-shGreen">{h.success_count}/{h.recipient_count} ✓</p>
                    {h.fail_count > 0 && <p className="text-[11px] text-red-400">{h.fail_count} failed</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm send modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="bulk-email-confirm-modal">
          <div className="bg-bgPanel rounded-xl border border-bgHover max-w-md w-full p-6">
            <p className="text-base font-black text-white uppercase tracking-tight">
              Send to {recipientCount} {recipientCount === 1 ? "client" : "clients"}?
            </p>
            <p className="text-[13px] text-gray-400 mt-2">
              Each recipient gets one personalised email. Every send is logged in the client communications timeline.
              This can't be undone.
            </p>
            <div className="bg-bgBase rounded p-3 mt-4 text-[12px]">
              <p className="text-gray-500"><span className="text-gray-300 font-black">Subject:</span> {subject}</p>
              <p className="text-gray-500 mt-1"><span className="text-gray-300 font-black">Recipients:</span> {recipientCount}</p>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setConfirmOpen(false)} data-testid="bulk-email-cancel"
                      className="text-[12px] font-black uppercase tracking-widest px-3 py-2 rounded text-gray-400 hover:text-white">
                Cancel
              </button>
              <button onClick={() => doSend(false)} disabled={sending} data-testid="bulk-email-confirm-send"
                      className="text-[13px] font-black uppercase tracking-widest px-4 py-2 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 disabled:opacity-50">
                {sending ? <><i className="fas fa-spinner fa-spin mr-2"/>Sending…</> : <><i className="fas fa-paper-plane mr-2"/>Yes, send</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
