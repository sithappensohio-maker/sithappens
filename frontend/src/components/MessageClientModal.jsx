// Online School Phase 4 — "Message Client" action reused from Trainer
// Assist. Deliberately thin: it reuses the existing client_message_threads
// system end to end (find-or-reply via the same endpoints the full
// Messages screen uses) rather than building any new chat system. The
// suggested body is a starting point only — nothing sends until the
// trainer explicitly clicks Send, and the textarea is always editable.
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function MessageClientModal({ clientId, dogId, lessonName, suggestedBody, onSent, onClose }) {
  const [existingThreadId, setExistingThreadId] = useState(null);
  const [clientName, setClientName] = useState("");
  const [body, setBody] = useState(
    suggestedBody || (lessonName
      ? `I reviewed your Online School checkpoint for ${lessonName} and I'd like to work through this with you.`
      : "")
  );
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/admin/messages?client_id=${encodeURIComponent(clientId)}`);
        const thread = (data || [])[0];
        if (thread) { setExistingThreadId(thread.id); setClientName(thread.client_name); }
      } catch { /* ignore — will just start a new thread */ }
      finally { setLoading(false); }
    })();
  }, [clientId]);

  const send = async () => {
    if (!body.trim()) { setErr("Message body is required"); return; }
    setSending(true); setErr("");
    try {
      if (existingThreadId) {
        await api.post(`/admin/messages/${existingThreadId}/reply`, { body: body.trim(), email_notify: true });
      } else {
        await api.post("/admin/messages/start", {
          client_id: clientId, dog_id: dogId || undefined,
          subject: lessonName ? `Online School — ${lessonName}` : "Online School",
          category: "training", body: body.trim(), email_notify: true,
        });
      }
      setSent(true);
      onSent?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Failed to send message.");
    } finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60]" onClick={onClose} data-testid="message-client-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-shBorder p-4 flex items-center justify-between">
          <p className="text-shText font-black uppercase tracking-widest text-[14px]">
            <i className="fas fa-comment text-shSecondary mr-2"/>Message {clientName || "Client"}
          </p>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText" data-testid="message-client-close">
            <i className="fas fa-times"/>
          </button>
        </div>
        <div className="p-4 space-y-3">
          {sent ? (
            <div className="text-center py-6" data-testid="message-client-sent">
              <i className="fas fa-check-circle text-shPrimary text-2xl mb-2 block"/>
              <p className="text-shText text-[14px] font-black">Message sent.</p>
              <button onClick={onClose} className="mt-3 text-[12px] font-black uppercase tracking-widest text-shSecondary">Close</button>
            </div>
          ) : (
            <>
              {loading ? (
                <p className="text-shTextMuted text-[13px]"><i className="fas fa-spinner fa-spin mr-1"/>Checking for an existing conversation…</p>
              ) : (
                <p className="text-shTextMuted text-[12px]">
                  {existingThreadId ? "Replying to an existing conversation with this client." : "Starting a new conversation with this client."}
                </p>
              )}
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
                        data-testid="message-client-body"
                        className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
              <p className="text-shTextMuted text-[11px]">Edit as needed before sending — nothing is sent automatically.</p>
              {err && <p className="text-red-400 text-[13px] font-black">{err}</p>}
              <div className="flex justify-end">
                <button onClick={send} disabled={sending || !body.trim()} data-testid="message-client-send"
                        className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
                  {sending ? <><i className="fas fa-spinner fa-spin mr-2"/>Sending…</> : <><i className="fas fa-paper-plane mr-2"/>Send</>}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
