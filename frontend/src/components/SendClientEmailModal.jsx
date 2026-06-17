import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";

/**
 * Compact composer for sending a one-off email to a single client.
 * Reuses the existing /api/admin/bulk-email endpoints (with client_ids=[id])
 * so the send is automatically logged to client_communications + history.
 */
export default function SendClientEmailModal({ client, onClose }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [templates, setTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const loadTemplates = async () => {
    try {
      const { data } = await api.get("/admin/bulk-email/templates");
      setTemplates(data || []);
    } catch { /* non-fatal */ }
    setTemplatesLoaded(true);
  };

  useEffect(() => { loadTemplates(); }, []);

  const firstName = (client?.name || "").trim().split(" ")[0] || "there";
  const renderPreview = (text) => (text || "")
    .replace(/\{\{client_first_name\}\}/g, firstName)
    .replace(/\{\{client_name\}\}/g,       client?.name || "")
    .replace(/\{\{dog_names\}\}/g,         (client?.dogs || []).map(d => d.name).filter(Boolean).join(", ") || "your pup");

  const applyTemplate = (slug) => {
    const t = templates.find(x => x.id === slug || x.slug === slug);
    if (!t) return;
    setSubject(t.subject || "");
    setBody(t.body || "");
  };

  const saveCurrentAsTemplate = async () => {
    if (!templateName.trim()) {
      toast.error("Give the template a name first");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      toast.error("Write a subject and body before saving");
      return;
    }
    setSavingTemplate(true);
    try {
      await api.post("/admin/bulk-email/templates", {
        name: templateName.trim(), subject, body,
      });
      toast.success(`Saved template: ${templateName.trim()}`);
      setTemplateName("");
      await loadTemplates();
    } catch (e) {
      toast.error("Save failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setSavingTemplate(false);
    }
  };

  const send = async () => {
    if (!subject.trim() || !body.trim()) {
      toast.error("Subject and body are required");
      return;
    }
    if (!client?.email) {
      toast.error("This client doesn't have an email on file");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/bulk-email/send", {
        subject, body, client_ids: [client.id], test_only: false,
      });
      if (data.success_count >= 1) {
        toast.success(`Email sent to ${client.name}`);
        onClose();
      } else {
        const reason = data.failed?.[0]?.error || "Resend rejected the send";
        toast.error(`Failed to send: ${reason}`);
      }
    } catch (e) {
      toast.error("Send failed: " + (e?.response?.data?.detail || e.message));
    } finally {
      setBusy(false);
    }
  };

  if (!client) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-3 sm:p-6 overflow-y-auto"
         data-testid="send-client-email-modal" onClick={onClose}>
      <div className="bg-bgPanel rounded-xl border border-bgHover max-w-2xl mx-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-bgHover">
          <div className="min-w-0">
            <p className="text-xs font-black text-shGreen uppercase tracking-widest">
              <i className="fas fa-paper-plane mr-2"/>Send Email
            </p>
            <p className="text-sm text-white font-black truncate mt-1">{client.name}</p>
            <p className="text-[12px] text-gray-500 truncate">{client.email || "— no email on file —"}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl shrink-0"
                  data-testid="send-client-email-close">
            <i className="fas fa-xmark"/>
          </button>
        </div>

        <div className="p-5 space-y-3">
          {!client.email && (
            <div className="bg-shOrange/15 text-shOrange border border-shOrange/30 rounded p-3 text-[12px]"
                 data-testid="send-client-email-no-email">
              <i className="fas fa-triangle-exclamation mr-2"/>
              This client has no email address on file — add one to the profile before sending.
            </div>
          )}

          {templatesLoaded ? (
            <div>
              <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1 block">
                Start from a template <span className="text-gray-600 normal-case">({templates.length} available)</span>
              </label>
              <select
                onChange={e => applyTemplate(e.target.value)}
                data-testid="send-client-email-template"
                defaultValue=""
                className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"
              >
                <option value="">— Blank email —</option>
                {templates.filter(t => t.kind === "system").length > 0 && (
                  <optgroup label="System templates">
                    {templates.filter(t => t.kind === "system").map(t => (
                      <option key={t.id} value={t.id}>★ {t.name}</option>
                    ))}
                  </optgroup>
                )}
                {templates.filter(t => t.kind === "custom").length > 0 && (
                  <optgroup label="Your saved templates">
                    {templates.filter(t => t.kind === "custom").map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
          ) : (
            <div className="text-[11px] text-gray-500"><i className="fas fa-spinner fa-spin mr-1"/>Loading templates…</div>
          )}

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1 block">
              Subject <span className="text-gray-600 normal-case">(supports <code className="text-shBlue">{`{{client_first_name}}`}</code>, <code className="text-shBlue">{`{{dog_names}}`}</code>)</span>
            </label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              data-testid="send-client-email-subject"
              placeholder="e.g. Quick update for {{client_first_name}}"
              className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"
            />
          </div>

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Body</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={8}
              data-testid="send-client-email-body"
              placeholder="Write the message — same merge tags supported."
              className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white font-mono"
            />
          </div>

          {(subject || body) && (
            <div className="bg-bgBase rounded border border-bgHover p-3" data-testid="send-client-email-preview">
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black">
                Preview for <span className="text-shGreen">{client.name}</span>
              </p>
              <p className="text-sm font-black text-white mt-1">{renderPreview(subject) || <em className="text-gray-500">(empty subject)</em>}</p>
              <pre className="text-[13px] text-gray-200 mt-1 whitespace-pre-wrap font-sans">{renderPreview(body) || <em className="text-gray-500">(empty body)</em>}</pre>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-bgHover">
            <input
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              placeholder="Save this as a template…"
              data-testid="send-client-email-template-name"
              className="flex-1 bg-bgBase border border-bgHover rounded px-3 py-1.5 text-sm text-white"
            />
            <button
              onClick={saveCurrentAsTemplate}
              disabled={savingTemplate || !templateName.trim() || !subject.trim() || !body.trim()}
              data-testid="send-client-email-save-template"
              className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-shBlue/15 text-shBlue hover:bg-shBlue/25 disabled:opacity-40 transition shrink-0">
              {savingTemplate ? <><i className="fas fa-spinner fa-spin mr-1"/>Saving…</> : <><i className="fas fa-bookmark mr-1"/>Save</>}
            </button>
          </div>

          <p className="text-[11px] text-gray-500">
            <i className="fas fa-circle-info mr-1"/>This send is logged on {client.name}&apos;s communication timeline and shows up in Bulk Email → History.
          </p>
        </div>

        <div className="flex gap-2 justify-end px-5 py-4 border-t border-bgHover">
          <button onClick={onClose} disabled={busy} data-testid="send-client-email-cancel"
                  className="text-[12px] font-black uppercase tracking-widest px-3 py-2 text-gray-400 hover:text-white disabled:opacity-50">
            Cancel
          </button>
          <button onClick={send} disabled={busy || !client.email || !subject.trim() || !body.trim()}
                  data-testid="send-client-email-send"
                  className="text-[13px] font-black uppercase tracking-widest px-4 py-2 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 disabled:opacity-40 transition">
            {busy ? <><i className="fas fa-spinner fa-spin mr-2"/>Sending…</> : <><i className="fas fa-paper-plane mr-2"/>Send</>}
          </button>
        </div>
      </div>
    </div>
  );
}
