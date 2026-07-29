import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import PremiumButton from "./premium/PremiumButton";

const CATEGORIES = [
  { id: "booking",     label: "Booking question" },
  { id: "daycare",     label: "Daycare" },
  { id: "boarding",    label: "Boarding" },
  { id: "training",    label: "Training" },
  { id: "vaccines",    label: "Vaccines / records" },
  { id: "forms",       label: "Forms / paperwork" },
  { id: "payments",    label: "Payments" },
  { id: "dog_records", label: "My dog's info" },
  { id: "other",       label: "Something else" },
];

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff/60) + "m ago";
  if (diff < 86400) return Math.floor(diff/3600) + "h ago";
  return d.toLocaleDateString();
}

export default function PortalMessages({ dogs = [], open = false, onClose = () => {}, onUnreadChange = () => {} }) {
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [composing, setComposing] = useState(false);

  // composer
  const [category, setCategory] = useState("other");
  const [subject, setSubject] = useState("");
  const [bodyTxt, setBodyTxt] = useState("");
  const [dogId, setDogId] = useState("");

  // reply
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await api.get("/me/messages");
    setThreads(data || []);
    const unread = (data || []).filter(t => t.unread_client).length;
    onUnreadChange(unread);
    if (data?.length && !activeId) setActiveId(data[0].id);
  };

  const loadActive = async (id) => {
    if (!id) { setActive(null); return; }
    const { data } = await api.get(`/me/messages/${id}`);
    setActive(data);
    if (data?.unread_client) {
      try { await api.post(`/me/messages/${id}/read`); load(); } catch {}
    }
  };

  useEffect(() => { if (open) load(); /* refresh whenever opened */ }, [open]);
  useEffect(() => { if (open) loadActive(activeId); }, [activeId, open]);

  const startNewThread = async () => {
    if (!bodyTxt.trim()) { toast.error("Type your message first"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/me/messages", {
        category, subject, body: bodyTxt, dog_id: dogId || null,
      });
      toast.success("Message sent — we'll get back to you soon!");
      setComposing(false);
      setSubject(""); setBodyTxt(""); setDogId(""); setCategory("other");
      await load();
      setActiveId(data.id);
    } catch (e) { toast.error("Send failed: " + (e?.response?.data?.detail || e.message)); }
    finally { setBusy(false); }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await api.post(`/me/messages/${activeId}/reply`, { body: reply });
      setReply("");
      await loadActive(activeId);
      await load();
    } catch (e) { toast.error("Send failed: " + (e?.response?.data?.detail || e.message)); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-3 sm:p-6 overflow-y-auto" data-testid="portal-messages-modal">
      <div className="rounded-xl border border-shBorder max-w-4xl mx-auto overflow-hidden shadow-sh" style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-shBorder">
          <p className="text-sm sm:text-base font-bold text-shText">
            <i className="fas fa-comments text-shSecondary mr-2"/>Messages
          </p>
          <button onClick={onClose} data-testid="portal-messages-close"
                  className="text-shTextMuted hover:text-shText text-xl"><i className="fas fa-xmark"/></button>
        </div>

        {composing ? (
          <div className="p-5 space-y-3" data-testid="portal-messages-composer">
            <p className="text-[12px] text-shTextMuted">Send the team a message. We'll reply right inside the app and (if you have email reminders on) your inbox.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-shTextMuted uppercase tracking-widest block mb-1">What's it about?</label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                        data-testid="portal-messages-category"
                        style={{ background: "var(--sh-card-base)" }}
                        className="w-full border border-shBorder rounded px-3 py-2 text-sm text-shText focus:outline-none focus:border-shSecondary/60">
                  {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-shTextMuted uppercase tracking-widest block mb-1">Which dog? (optional)</label>
                <select value={dogId} onChange={e => setDogId(e.target.value)}
                        data-testid="portal-messages-dog"
                        style={{ background: "var(--sh-card-base)" }}
                        className="w-full border border-shBorder rounded px-3 py-2 text-sm text-shText focus:outline-none focus:border-shSecondary/60">
                  <option value="">— Not specific —</option>
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-shTextMuted uppercase tracking-widest block mb-1">Subject (optional)</label>
              <input value={subject} onChange={e => setSubject(e.target.value)}
                     data-testid="portal-messages-subject"
                     placeholder="Short summary"
                     style={{ background: "var(--sh-card-base)" }}
                     className="w-full border border-shBorder rounded px-3 py-2 text-sm text-shText focus:outline-none focus:border-shSecondary/60"/>
            </div>
            <div>
              <label className="text-[11px] font-bold text-shTextMuted uppercase tracking-widest block mb-1">Message</label>
              <textarea value={bodyTxt} onChange={e => setBodyTxt(e.target.value)} rows={6}
                        data-testid="portal-messages-body"
                        placeholder="Type your message…"
                        style={{ background: "var(--sh-card-base)" }}
                        className="w-full border border-shBorder rounded px-3 py-2 text-sm text-shText focus:outline-none focus:border-shSecondary/60"/>
            </div>
            <div className="flex gap-2 justify-end">
              <PremiumButton variant="ghost" onClick={() => setComposing(false)}>
                Cancel
              </PremiumButton>
              <PremiumButton variant="cyan" onClick={startNewThread} disabled={busy || !bodyTxt.trim()} data-testid="portal-messages-send-new">
                {busy ? <><i className="fas fa-spinner fa-spin"/>Sending…</> : <><i className="fas fa-paper-plane"/>Send</>}
              </PremiumButton>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 min-h-[60vh]">
            {/* Threads list */}
            <div className="border-r border-shBorder sm:col-span-1 overflow-y-auto max-h-[70vh]">
              <button onClick={() => { setComposing(true); }}
                      data-testid="portal-messages-new"
                      className="w-full text-left px-4 py-3 bg-shSecondary/10 hover:bg-shSecondary/20 text-shSecondary text-[13px] font-bold uppercase tracking-widest border-b border-shBorder transition">
                <i className="fas fa-plus mr-2"/>New Message
              </button>
              {threads.length === 0 && (
                <p className="text-[12px] text-shTextMuted p-5 text-center">No messages yet — say hi 👋</p>
              )}
              {threads.map(t => (
                <button key={t.id} onClick={() => setActiveId(t.id)}
                        data-testid={`portal-messages-thread-${t.id}`}
                        className={`w-full text-left px-4 py-3 border-b border-shBorder transition ${
                          activeId === t.id ? "bg-shSecondary/10 border-l-2 border-l-shSecondary" : "hover:bg-shSurfaceRaised"
                        }`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-[13px] font-bold truncate ${t.unread_client ? "text-shText" : "text-shTextMuted"}`}>
                      {t.unread_client && <span className="inline-block w-1.5 h-1.5 rounded-full bg-shAccent mr-1.5 align-middle" style={{ boxShadow: "0 0 6px rgba(242,101,34,0.7)" }}/>}
                      {t.subject || CATEGORIES.find(c => c.id === t.category)?.label || "Message"}
                    </p>
                  </div>
                  <p className="text-[11px] text-shTextMuted mt-1 truncate">{t.last_message_preview}</p>
                  <p className="text-[11px] text-shTextMuted mt-1">{fmtTime(t.last_message_at)}</p>
                </button>
              ))}
            </div>

            {/* Active conversation */}
            <div className="sm:col-span-2 flex flex-col min-h-0 max-h-[70vh]">
              {!active && (
                <p className="text-[13px] text-shTextMuted p-8 text-center">Select a message or start a new one.</p>
              )}
              {active && (
                <>
                  <div className="px-4 py-3 border-b border-shBorder">
                    <p className="text-sm font-bold text-shText truncate">{active.subject}</p>
                    <p className="text-[11px] text-shTextMuted mt-0.5">
                      {CATEGORIES.find(c => c.id === active.category)?.label || active.category}
                      {active.dog_name && <span> · 🐾 {active.dog_name}</span>}
                    </p>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                    {(active.messages || []).map(m => {
                      const isMe = m.sender_role === "client";
                      return (
                        <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-lg p-3 border ${
                            isMe ? "bg-shSecondary/10 border-shSecondary/30" : "border-shBorder"
                          }`} style={isMe ? undefined : { background: "var(--sh-card-base)" }}>
                            <p className="text-[11px] text-shTextMuted font-bold uppercase tracking-widest mb-1">
                              {isMe ? "You" : "Sit Happens"} · {fmtTime(m.created_at)}
                            </p>
                            <pre className="text-[13px] text-shText whitespace-pre-wrap font-sans">{m.body}</pre>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="p-3 border-t border-shBorder">
                    <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2}
                              placeholder="Type a reply…"
                              data-testid="portal-messages-reply-body"
                              style={{ background: "var(--sh-card-base)" }}
                              className="w-full border border-shBorder rounded px-3 py-2 text-sm text-shText focus:outline-none focus:border-shSecondary/60"/>
                    <div className="flex justify-end mt-2">
                      <PremiumButton variant="cyan" onClick={sendReply} disabled={busy || !reply.trim()} data-testid="portal-messages-send-reply">
                        {busy ? <><i className="fas fa-spinner fa-spin"/>Sending…</> : <><i className="fas fa-paper-plane"/>Reply</>}
                      </PremiumButton>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
