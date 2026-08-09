import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import { SCHOOL_HQ_TARGET_KEY } from "../lib/schoolHq";

const STATUS_PILLS = {
  open:     { label: "Open",     cls: "bg-shPrimary/15 text-shPrimary" },
  pending:  { label: "Pending",  cls: "bg-shAccent/15 text-shAccent" },
  resolved: { label: "Resolved", cls: "bg-gray-600/30 text-shTextMuted" },
};
const CAT_LABEL = {
  booking:"Booking", daycare:"Daycare", boarding:"Boarding", training:"Training",
  vaccines:"Vaccines", forms:"Forms", payments:"Payments", dog_records:"Dog Records", other:"Other",
};

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff/60) + "m ago";
  if (diff < 86400) return Math.floor(diff/3600) + "h ago";
  return d.toLocaleDateString();
}

export default function ClientMessages() {
  const [threads, setThreads] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [active, setActive] = useState(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [emailNotify, setEmailNotify] = useState(true);
  const [busy, setBusy] = useState(false);

  // `search` and `activeId` are read via ref so typing in the search box (only
  // submitted explicitly on Enter, see below) and switching the active thread
  // never trigger this callback's identity to change / this effect to re-fire —
  // only statusFilter/unreadOnly should do that, matching prior behavior.
  const searchRef = useRef(search);
  searchRef.current = search;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (unreadOnly) params.set("unread_only", "true");
    if (searchRef.current.trim()) params.set("search", searchRef.current.trim());
    const { data } = await api.get(`/admin/messages?${params.toString()}`);
    setThreads(data || []);
    if (data?.length && !activeIdRef.current) setActiveId(data[0].id);
  }, [statusFilter, unreadOnly]);

  const loadActive = async (id) => {
    if (!id) { setActive(null); return; }
    const { data } = await api.get(`/admin/messages/${id}`);
    setActive(data);
    if (data?.unread_admin) {
      try { await api.post(`/admin/messages/${id}/read`); } catch {}
    }
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SCHOOL_HQ_TARGET_KEY);
      if (raw) {
        const target = JSON.parse(raw);
        if (target?.screen === "messages" && target.thread_id) {
          sessionStorage.removeItem(SCHOOL_HQ_TARGET_KEY);
          setActiveId(target.thread_id);
        }
      }
    } catch { /* ignore */ }
    load();
  }, [load]);
  useEffect(() => { loadActive(activeId); }, [activeId]);

  const sendReply = async () => {
    if (!reply.trim()) { toast.error("Reply body is required"); return; }
    setBusy(true);
    try {
      await api.post(`/admin/messages/${activeId}/reply`, { body: reply, email_notify: emailNotify });
      setReply("");
      toast.success("Reply sent");
      await loadActive(activeId);
      await load();
    } catch (e) { toast.error("Send failed: " + (e?.response?.data?.detail || e.message)); }
    finally { setBusy(false); }
  };

  const changeStatus = async (status) => {
    try {
      await api.patch(`/admin/messages/${activeId}`, { status });
      toast.success(`Marked ${STATUS_PILLS[status].label}`);
      await loadActive(activeId);
      await load();
    } catch (e) { toast.error("Failed: " + (e?.response?.data?.detail || e.message)); }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/admin/messages/${activeId}/note`, { body: note });
      setNote("");
      await loadActive(activeId);
      toast.success("Internal note added");
    } catch (e) { toast.error("Failed: " + (e?.response?.data?.detail || e.message)); }
  };

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/admin/messages/${activeId}/note/${noteId}`);
      await loadActive(activeId);
    } catch (e) { toast.error("Failed: " + (e?.response?.data?.detail || e.message)); }
  };

  return (
    <div className="h-full flex flex-col gap-3 sh-messages-workspace" data-testid="admin-messages-screen">
      <PageHero
        compact
        eyebrow={{ icon: "fa-comments", text: "Client communication", color: "text-shSecondary" }}
        title="Messages."
        highlight="One conversation at a time."
        subtitle="Client threads, internal notes, and follow-up state in one inbox."
        testid="messages-hero"
      />
      {/* Header */}
      <div className="sh-messages-toolbar space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-black text-shText uppercase tracking-widest">
            <i className="fas fa-inbox mr-2 text-shPrimary"/>Client Messages
          </p>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && load()}
              placeholder="Search by client, dog, subject…"
              data-testid="admin-messages-search"
              className="bg-[var(--sh-card-base)] border border-shBorder rounded px-3 py-1.5 text-[12px] text-shText w-56"
            />
            <button onClick={load} className="text-[12px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded bg-shSecondary/15 text-shSecondary">
              <i className="fas fa-search"/>
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {["", "open", "pending", "resolved"].map(s => (
            <button key={s || "all"}
                    onClick={() => setStatusFilter(s)}
                    data-testid={`admin-messages-filter-${s || "all"}`}
                    className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border transition ${
                      statusFilter === s
                        ? "bg-shPrimary/15 text-shPrimary border-shPrimary"
                        : "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder hover:text-shText"
                    }`}>
              {s ? STATUS_PILLS[s].label : "All"}
            </button>
          ))}
          <button onClick={() => setUnreadOnly(u => !u)}
                  data-testid="admin-messages-filter-unread"
                  className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border transition ${
                    unreadOnly ? "bg-shAccent/15 text-shAccent border-shAccent" : "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder hover:text-shText"
                  }`}>
            <i className="fas fa-envelope mr-1"/>Unread only
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,0.9fr)_minmax(0,2.1fr)] gap-3 flex-1 min-h-0 sh-messages-grid">
        {/* Thread list */}
        <div className="sh-messages-list overflow-y-auto" data-testid="admin-messages-list">
          {threads.length === 0 && (
            <p className="text-[13px] text-shTextMuted p-5 text-center">No client messages match.</p>
          )}
          {threads.map(t => {
            const isActive = activeId === t.id;
            return (
              <button key={t.id} onClick={() => setActiveId(t.id)}
                      data-testid={`admin-messages-thread-${t.id}`}
                      className={`w-full text-left p-4 border-b border-shBorder/40 transition ${
                        isActive ? "bg-shSecondary/10 border-l-4 border-l-shPrimary" : "hover:bg-[var(--sh-card-base)]/40 border-l-4 border-l-transparent"
                      }`}>
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-[13px] font-black truncate ${t.unread_admin ? "text-shText" : "text-shTextMuted"}`}>
                    {t.unread_admin && <span className="inline-block w-1.5 h-1.5 rounded-full bg-shAccent mr-1.5 align-middle"/>}
                    {t.client_name}
                  </p>
                  <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${STATUS_PILLS[t.status]?.cls || "bg-gray-700/30 text-shTextMuted"}`}>
                    {STATUS_PILLS[t.status]?.label || t.status}
                  </span>
                </div>
                <p className="text-[11px] text-shTextMuted mt-1 truncate">
                  {CAT_LABEL[t.category] || t.category}
                  {t.dog_name && <span> · {t.dog_name}</span>}
                </p>
                <p className={`text-[12px] mt-1 truncate ${t.unread_admin ? "text-gray-200" : "text-shTextMuted"}`}>
                  {t.subject}
                </p>
                <p className="text-[11px] text-shTextMuted mt-1">{fmtTime(t.last_message_at)}</p>
              </button>
            );
          })}
        </div>

        {/* Active thread */}
        <div className="sh-messages-detail overflow-y-auto flex flex-col" data-testid="admin-messages-active">
          {!active && <p className="text-[13px] text-shTextMuted p-8 text-center">Select a thread to view the conversation.</p>}
          {active && (
            <>
              <div className="p-4 border-b border-shBorder">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-base font-black text-shText truncate">{active.subject}</p>
                    <p className="text-[12px] text-shTextMuted mt-1">
                      {active.client_name}
                      {active.dog_name && <span> · 🐾 {active.dog_name}</span>}
                      <span className="ml-2 text-shTextMuted">· {CAT_LABEL[active.category] || active.category}</span>
                    </p>
                    {active.school_enrollment_id && (
                      <div className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-shSecondary/25 bg-shSecondary/[0.05] px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-shSecondary" data-testid="admin-message-school-context">
                        <span><i className="fas fa-graduation-cap mr-1" />Online School</span>
                        {active.school_program_name && <span>· {active.school_program_name}</span>}
                        {active.school_module_name && <span>· {active.school_module_name}</span>}
                        {active.school_lesson_name && <span>· {active.school_lesson_name}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {["open", "pending", "resolved"].map(s => (
                      <button key={s} onClick={() => changeStatus(s)}
                              data-testid={`admin-messages-status-${s}`}
                              className={`text-[11px] font-black uppercase tracking-widest px-2 py-1 rounded transition ${
                                active.status === s
                                  ? STATUS_PILLS[s].cls + " ring-2 ring-inset ring-current"
                                  : "bg-[var(--sh-card-base)] text-shTextMuted hover:text-shText"
                              }`}>
                        {STATUS_PILLS[s].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 p-4 space-y-3 overflow-y-auto">
                {(active.messages || []).map(m => {
                  const isClient = m.sender_role === "client";
                  return (
                    <div key={m.id} className={`flex ${isClient ? "justify-start" : "justify-end"}`} data-testid={`admin-messages-bubble-${m.id}`}>
                      <div className={`max-w-[85%] rounded-lg p-3 ${
                        isClient ? "bg-[var(--sh-card-base)] border border-shBorder" : "bg-shPrimary/15 border border-shPrimary/30"
                      }`}>
                        <p className="text-[11px] text-shTextMuted font-black uppercase tracking-widest mb-1">
                          {m.sender_name} · {fmtTime(m.created_at)}
                        </p>
                        <pre className="text-[13px] text-shText whitespace-pre-wrap font-sans">{m.body}</pre>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Reply composer */}
              <div className="p-4 border-t border-shBorder">
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  rows={3}
                  placeholder="Type a reply to the client…"
                  data-testid="admin-messages-reply-body"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded px-3 py-2 text-sm text-shText"
                />
                <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
                  <label className="text-[12px] text-shTextMuted flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={emailNotify} onChange={e => setEmailNotify(e.target.checked)}
                           data-testid="admin-messages-email-notify"/>
                    Also email the client
                  </label>
                  <button onClick={sendReply} disabled={busy || !reply.trim()}
                          data-testid="admin-messages-send-reply"
                          className="text-[13px] font-black uppercase tracking-widest px-4 py-2 rounded bg-shPrimary text-bgHeader hover:bg-shPrimary/90 disabled:opacity-40 transition">
                    {busy ? <><i className="fas fa-spinner fa-spin mr-2"/>Sending…</> : <><i className="fas fa-paper-plane mr-2"/>Reply</>}
                  </button>
                </div>
              </div>

              {/* Internal notes */}
              <div className="p-4 border-t border-shBorder bg-[var(--sh-card-base)]/30" data-testid="admin-messages-notes">
                <p className="text-[11px] font-black uppercase tracking-widest text-shAccent mb-2">
                  <i className="fas fa-lock mr-1"/>Internal notes (staff-only · client cannot see)
                </p>
                <div className="space-y-2 mb-2">
                  {(active.internal_notes || []).map(n => (
                    <div key={n.id} className="flex items-start justify-between gap-2 bg-[var(--sh-card-base)] rounded border border-shBorder p-2"
                         data-testid={`admin-messages-note-${n.id}`}>
                      <div className="min-w-0">
                        <p className="text-[11px] text-shTextMuted">{n.author_name} · {fmtTime(n.created_at)}</p>
                        <pre className="text-[13px] text-gray-200 whitespace-pre-wrap font-sans">{n.body}</pre>
                      </div>
                      <button onClick={() => deleteNote(n.id)} className="text-shTextMuted hover:text-red-400 shrink-0 text-[11px]"
                              data-testid={`admin-messages-delete-note-${n.id}`}>
                        <i className="fas fa-times"/>
                      </button>
                    </div>
                  ))}
                  {(!active.internal_notes || active.internal_notes.length === 0) && (
                    <p className="text-[12px] text-shTextMuted italic">No internal notes yet.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()}
                         placeholder="Add a staff-only note…"
                         data-testid="admin-messages-note-input"
                         className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded px-3 py-1.5 text-[12px] text-shText"/>
                  <button onClick={addNote} disabled={!note.trim()} data-testid="admin-messages-add-note"
                          className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-shAccent/15 text-shAccent hover:bg-shAccent/25 disabled:opacity-40">
                    Add
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
