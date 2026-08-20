import { useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { toast } from "sonner";
import TemplatePicker, { tierMeta } from "../components/HomeworkTemplatePicker";
import HomeworkReportPanel from "../components/HomeworkReportPanel";
import DailyTrackerBuilder from "../components/DailyTrackerBuilder";
import DailyReviewQueue from "../components/DailyReviewQueue";
import HomeworkAnalytics from "../components/HomeworkAnalytics";
import PageHero from "../components/PageHero";
import { todayISO } from "../lib/date";
import { SCHOOL_HQ_TARGET_KEY } from "../lib/schoolHq";

export default function Homework() {
  const [list, setList] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [attentionCount, setAttentionCount] = useState(0);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [form, setForm] = useState({ dog_id: "", title: "", instructions: "", video_url: "", due_date: "" });
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [deepLinkTarget, setDeepLinkTarget] = useState(null);

  const load = async () => {
    const [h, d] = await Promise.all([api.get("/homework"), api.get("/dogs")]);
    setList(h.data); setDogs(d.data);
    /* The header count must reflect ALL unreviewed practice, not only
       daily-tracker days awaiting approval. /admin/homework/pending-reviews
       is filtered to daily_tracker rows, so section-based practice — which
       is what the real recipes create — never appeared there and the Review
       button stayed hidden precisely when there was work to do. */
    try {
      const r = await api.get("/admin/homework/unreviewed-count");
      setPendingCount(Number(r.data?.unreviewed) || 0);
      setAttentionCount(Number(r.data?.needs_attention) || 0);
    } catch { setPendingCount(0); setAttentionCount(0); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SCHOOL_HQ_TARGET_KEY);
      if (!raw) return;
      const target = JSON.parse(raw);
      if (target?.screen !== "homework" || !target.homework_id) return;
      sessionStorage.removeItem(SCHOOL_HQ_TARGET_KEY);
      setFilter("all");
      setExpandedId(target.homework_id);
      setDeepLinkTarget(target);
    } catch { /* ignore malformed target */ }
  }, []);
  useEffect(() => {
    if (!deepLinkTarget?.homework_id || !list.some((h) => h.id === deepLinkTarget.homework_id)) return;
    setExpandedId(deepLinkTarget.homework_id);
    const timer = setTimeout(() => document.querySelector(`[data-testid="hw-${deepLinkTarget.homework_id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    return () => clearTimeout(timer);
  }, [list, deepLinkTarget]);

  const [digestBusy, setDigestBusy] = useState(false);
  const [mondayBusy, setMondayBusy] = useState(false);

  const sendMondayBrief = async () => {
    if (!(await confirm({
      title: "Send the Monday brief now?",
      body: "Fires your weekly trainer brief immediately (streak leaders, review queue, unanswered questions, expiring vaccines, week's bookings). Normally auto-fires every Monday morning.",
      confirmText: "Send now",
    }))) return;
    setMondayBusy(true);
    try {
      const { data } = await api.post("/admin/homework/send-monday-digest");
      let msg;
      if (data.sent === 1) msg = "Monday brief sent! Check the admin email.";
      else if (data.reason === "nothing_to_report") msg = "Nothing to report this week — no email sent.";
      else if (data.skipped_already_sent) msg = "Already sent this week. Run the dedup-clear and try again.";
      else if (data.reason === "email_send_failed") msg = "Email send failed — check Resend domain verification.";
      else msg = `Result: ${JSON.stringify(data)}`;
      toast.success(msg);
    } catch (e) {
      toast.error(`Failed: ${e.response?.data?.detail || e.message}`);
    } finally { setMondayBusy(false); }
  };

  const sendWeeklyDigest = async () => {
    if (!(await confirm({
      title: "Send weekly recap now?",
      body: "Every client with a daily-tracker plan they touched this week will get a recap email with their streak, photos and your review notes. Normally this auto-fires every Sunday night.",
      confirmText: "Send now",
    }))) return;
    setDigestBusy(true);
    try {
      const { data } = await api.post("/admin/homework/send-weekly-digest");
      let msg = `Weekly digest fired · ${data.sent || 0} email${data.sent === 1 ? "" : "s"} sent`;
      if (data.attempted && data.sent < data.attempted) {
        msg += ` (${data.attempted - data.sent} email${data.attempted - data.sent === 1 ? "" : "s"} failed — check Resend domain verification)`;
      }
      toast.success(msg);
    } catch (e) {
      toast.error(`Failed: ${e.response?.data?.detail || e.message}`);
    } finally { setDigestBusy(false); }
  };

  /* NEW / UNREVIEWED is deliberately not the same signal as NEEDS TRAINER
     ATTENTION. An ordinary log with no video, no reported difficulty and no
     question is still new until a trainer acknowledges it. Rest days and
     trainer-entered rows are not client submissions. */
  const unreviewedLogs = (h) => (h.section_logs || []).filter(
    (lo) => lo && !lo.reviewed_at && !lo.is_rest_day && lo.logged_by_role !== "admin",
  ).length;

  /* Complete Assignment — the explicit end to an assignment, separate from
     reviewing its logs. Reuses the canonical completion state via the
     trainer endpoint; completing never marks outstanding logs reviewed. */
  const [completingId, setCompletingId] = useState(null);
  const completeAssignment = async (h) => {
    if (completingId) return;                     // double-click guard
    const outstanding = unreviewedLogs(h);
    // Unreviewed logs never BLOCK completion — the trainer is told and
    // decides. Those logs stay unreviewed; completing acknowledges nothing.
    const body = outstanding > 0
      ? `This assignment has ${outstanding} unreviewed practice log${outstanding === 1 ? "" : "s"}. They will stay unreviewed. Complete anyway?`
      : "This ends the assignment. Its logs and history stay available.";
    if (!(await confirm({
      title: `Complete ${h.title} for ${h.dog_name}?`,
      body, confirmText: "Complete assignment",
    }))) return;
    setCompletingId(h.id);
    try {
      await api.post(`/admin/homework/${h.id}/complete`, { note: "" });
      await load();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Couldn't complete this assignment — try again.");
    } finally {
      setCompletingId(null);
    }
  };

  const openNew = () => {
    if (dogs.length === 0) { toast.error("Add a dog first"); return; }
    setForm({ dog_id: dogs[0].id, title: "", instructions: "", video_url: "", due_date: "" });
    setErr(""); setOpen(true);
  };

  const save = async () => {
    setErr("");
    try { await api.post("/homework", form); setOpen(false); load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const confirm = useConfirm();
  const remove = async (id) => { if (!(await confirm({ title: "Delete Practice?", body: "This will remove the assignment and all its session logs. This cannot be undone.", confirmText: "Delete", tone: "danger" }))) return; await api.delete(`/homework/${id}`); load(); };

  const filtered = filter === "all" ? list : list.filter(h => h.status === filter);
  const counts = { all: list.length, assigned: list.filter(h=>h.status==="assigned").length, completed: list.filter(h=>h.status==="completed").length };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="homework-screen">
      <PageHero
        eyebrow={{ icon: "fa-graduation-cap", text: "Curriculum control room", color: "text-purple-300" }}
        title="Training Practice."
        highlight="Built around the dog."
        subtitle="Assign exercises, run daily trackers, and review every submission."
        right={(
          <div className="flex flex-wrap gap-2">
            {pendingCount > 0 && (
              <button onClick={() => setReviewOpen(true)} data-testid="review-queue-button"
                      className="relative bg-shAccent text-bgHeader px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shAccent/80 transition">
                <i className="fas fa-clipboard-check mr-2" />Unreviewed · {pendingCount}
                {attentionCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-shText rounded-full w-5 h-5 flex items-center justify-center text-[11px] font-black animate-pulse"
                        title={`${attentionCount} need trainer attention`} data-testid="review-attention-badge">{attentionCount}</span>
                )}
              </button>
            )}
            <button onClick={() => setTrackerOpen(true)} data-testid="daily-tracker-button"
                    className="bg-purple-500 text-shText px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-purple-500/80 transition">
              <i className="fas fa-calendar-check mr-2" />Daily Tracker
            </button>
            <button onClick={() => setAnalyticsOpen(true)} data-testid="homework-analytics-button" title="Curriculum completion + drop-off insights"
                    className="bg-[var(--sh-card-base)] border border-shBorder text-gray-200 px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest hover:border-shPrimary hover:text-shPrimary transition">
              <i className="fas fa-chart-line mr-1.5" />Analytics
            </button>
            <button onClick={sendWeeklyDigest} disabled={digestBusy} data-testid="send-weekly-digest-button" title="Auto-fires every Sunday night"
                    className="bg-[var(--sh-card-base)] border border-shBorder text-gray-200 px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest hover:border-purple-400 hover:text-purple-300 disabled:opacity-50 transition">
              <i className="fas fa-envelope-open-text mr-1.5" />{digestBusy ? "Sending…" : "Weekly recap"}
            </button>
            <button onClick={()=>setPickerOpen(true)} data-testid="assign-from-template-button"
                    className="bg-shPrimary text-bgHeader px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shPrimary/90 transition">
              <i className="fas fa-clipboard-list mr-2"/>From Template
            </button>
            <button onClick={openNew} data-testid="add-homework-button"
                    className="bg-shSecondary text-shText px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shSecondary/90 transition">
              <i className="fas fa-plus mr-1.5"/>Custom
            </button>
          </div>
        )}
        testid="homework-hero"
      />

      <div className="flex gap-2 flex-wrap">
        {["all","assigned","completed"].map(k => (
          <button key={k} onClick={()=>setFilter(k)} data-testid={`hw-filter-${k}`}
                  className={`px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest ${filter===k?"bg-shSecondary text-shText":"bg-[var(--sh-card-base)] text-shTextMuted border border-shBorder"}`}>
            {k} · {counts[k]}
          </button>
        ))}
      </div>

      <div className="space-y-3" data-testid="homework-list">
        {filtered.length === 0 && <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-10 text-center text-xs text-shTextMuted uppercase font-black">No Practice {filter !== "all" ? `(${filter})` : "yet"}.</div>}
        {filtered.map(h => {
          const snap = h.template_snapshot;
          const tm = snap ? tierMeta(snap.tier) : null;
          const logCount = (h.section_logs || []).length;
          const isExpanded = expandedId === h.id;
          // Sprint 107 — daily-tracker progress at a glance
          const totalDays = h.total_days || (snap?.sections?.length || 0);
          const streak = h.streak || 0;
          const progressPct = totalDays > 0 ? Math.round((streak / totalDays) * 100) : 0;
          const isTracker = !!h.daily_tracker;
          return (
            <div key={h.id} className={`bg-[var(--sh-card-base)] border rounded-xl p-5 shadow-lg ${deepLinkTarget?.homework_id === h.id ? "border-shSecondary ring-2 ring-shSecondary/20" : h.status==="completed"?"border-shPrimary/40":"border-shBorder"}`} data-testid={`hw-${h.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={`text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest ${h.status==="completed"?"bg-shPrimary/15 text-shPrimary":"bg-shAccent/15 text-shAccent"}`}>{h.status}</span>
                    {h.daily_tracker && <span className="text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest bg-purple-500/15 text-purple-300"><i className="fas fa-calendar-check mr-1"/>Daily · {totalDays}d</span>}
                    {h.template_snapshot && !h.daily_tracker && (() => { const tm = tierMeta(h.template_snapshot.tier); return <span className={`text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest ${tm.bg} ${tm.color}`}><i className={`fas ${h.template_snapshot.icon || "fa-paw"} mr-1`}/>{tm.label}</span>; })()}
                    {h.due_date && <span className="text-[14px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-calendar mr-1"/>Due {h.due_date}</span>}
                    {snap && <span className="text-[14px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-list-check mr-1"/>{logCount} client log{logCount===1?"":"s"}</span>}
                    {h.status !== "completed" && unreviewedLogs(h) > 0 && (
                      <span className="text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest bg-shAccent/15 text-shAccent" data-testid={`hw-new-logs-${h.id}`}>
                        <i className="fas fa-hourglass-half mr-1"/>{unreviewedLogs(h)} new log{unreviewedLogs(h)===1?"":"s"}
                      </span>
                    )}
                    {isTracker && streak > 0 && <span className="text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest bg-shPrimary/15 text-shPrimary" data-testid={`hw-streak-${h.id}`}><i className="fas fa-fire mr-1"/>{streak}/{totalDays}</span>}
                  </div>
                  <h4 className="text-lg font-black text-shText uppercase tracking-tight">{h.title}</h4>
                  <p className="text-[15px] text-shSecondary font-black uppercase tracking-widest mt-1">{h.dog_name} · {h.client_name}</p>
                  {isTracker && h.status !== "completed" && totalDays > 0 && (
                    <div className="mt-3" data-testid={`hw-progress-${h.id}`}>
                      <div className="flex items-center justify-between text-[12px] text-shTextMuted mb-1">
                        <span className="font-black uppercase tracking-widest">Progress</span>
                        <span className="font-black text-shPrimary">{progressPct}% · day {Math.min(streak + 1, totalDays)} of {totalDays}</span>
                      </div>
                      <div className="h-2 rounded-full bg-[var(--sh-card-base)] overflow-hidden">
                        <div className="h-full bg-shPrimary transition-all" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                  )}
                  {h.instructions && <p className="text-sm text-shTextMuted mt-2 whitespace-pre-wrap">{h.instructions}</p>}
                  {h.video_url && <a href={h.video_url} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[14px] text-shSecondary hover:underline font-black uppercase tracking-widest"><i className="fas fa-video mr-1"/>Watch demo video</a>}
                  {h.status === "completed" && (
                    <div className="mt-3 bg-shPrimary/5 border border-shPrimary/20 rounded p-3">
                      <p className="text-[14px] font-black text-shPrimary uppercase tracking-widest mb-1"><i className="fas fa-check mr-1"/>Marked done {(h.completed_at||"").slice(0,10)}</p>
                      {h.completion_note && <p className="text-xs text-shTextMuted italic">"{h.completion_note}"</p>}
                      {h.completion_photo && <img src={h.completion_photo} alt="" loading="lazy" decoding="async" className="mt-2 h-32 rounded object-cover border border-shBorder" />}
                    </div>
                  )}
                  {h.daily_tracker && h.status === "completed" && (
                    <CertUploadInline homeworkId={h.id} hasCert={!!h.certificate} certFilename={h.certificate_filename} onChanged={load} />
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <button onClick={()=>remove(h.id)} className="text-shTextMuted hover:text-red-400 p-2"><i className="fas fa-trash text-sm" /></button>
                  {h.status !== "completed" && (
                    <button onClick={()=>completeAssignment(h)} disabled={completingId === h.id} data-testid={`hw-complete-${h.id}`}
                            className="bg-shPrimary text-bgHeader px-3 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest whitespace-nowrap hover:bg-shPrimary/90 disabled:opacity-50 transition">
                      <i className="fas fa-check mr-1.5"/>{completingId === h.id ? "Completing…" : "Complete assignment"}
                    </button>
                  )}
                  {snap && (
                    <button onClick={()=>setExpandedId(isExpanded ? null : h.id)} data-testid={`hw-toggle-report-${h.id}`}
                            className="text-[14px] font-black uppercase tracking-widest text-shSecondary hover:underline whitespace-nowrap">
                      {isExpanded ? "Hide report" : "View report"} <i className={`fas fa-chevron-${isExpanded?"up":"down"} ml-1`}/>
                    </button>
                  )}
                </div>
              </div>
              {snap && isExpanded && (
                <div className="mt-4 pt-4 border-t border-shBorder">
                  <HomeworkReportPanel homeworkId={h.id} focus={deepLinkTarget?.homework_id === h.id ? deepLinkTarget : null} onReviewed={load} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pickerOpen && (
        <TemplatePicker dogs={dogs} onClose={()=>setPickerOpen(false)} onAssigned={()=>load()} />
      )}

      {trackerOpen && (
        <DailyTrackerBuilder dogs={dogs} onClose={()=>setTrackerOpen(false)} onAssigned={()=>load()} />
      )}

      {reviewOpen && (
        <DailyReviewQueue onClose={()=>setReviewOpen(false)} onReviewed={()=>load()} />
      )}

      {analyticsOpen && (
        <HomeworkAnalytics onClose={()=>setAnalyticsOpen(false)} />
      )}

      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg p-6 md:p-8 shadow-2xl animate-slide-in">
            <h4 className="text-xl font-black text-shText uppercase italic tracking-tight mb-4">Custom Homework</h4>
            <div className="space-y-4">
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Dog</label>
                <select value={form.dog_id} onChange={(e)=>setForm({...form, dog_id:e.target.value})} data-testid="hw-dog"
                        className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Title</label>
                <input value={form.title} onChange={(e)=>setForm({...form, title:e.target.value})} placeholder="e.g., Practice place command 10 min/day" data-testid="hw-title"
                       className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Instructions</label>
                <textarea value={form.instructions} onChange={(e)=>setForm({...form, instructions:e.target.value})} rows={4} data-testid="hw-instructions"
                          className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Video URL (YouTube link to a demo, optional)</label>
                <input value={form.video_url} onChange={(e)=>setForm({...form, video_url:e.target.value})} placeholder="https://youtu.be/..." data-testid="hw-video"
                       className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Due Date (optional)</label>
                <input type="date" min={todayISO()} value={form.due_date} onChange={(e)=>setForm({...form, due_date:e.target.value})} data-testid="hw-due"
                       className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-xs" style={{colorScheme:"dark"}} />
              </div>
              {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
              <div className="flex justify-end gap-3">
                <button onClick={()=>setOpen(false)} className="text-shTextMuted font-black uppercase text-[14px] tracking-widest">Cancel</button>
                <button onClick={save} data-testid="save-homework" className="bg-shSecondary text-shText px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl">Assign</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function CertUploadInline({ homeworkId, hasCert, certFilename, onChanged }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const pick = () => ref.current?.click();
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error("Certificate file is too large — keep it under 5 MB."); return; }
    setBusy(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((res, rej) => { reader.onload = () => res(reader.result); reader.onerror = rej; reader.readAsDataURL(f); });
      await api.post(`/homework/${homeworkId}/certificate`, { photo: dataUrl, filename: f.name });
      onChanged?.();
    } catch (ex) { toast.error("Upload failed: " + (ex.response?.data?.detail || ex.message)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    const ok = await confirm({
      title: "Remove this completion certificate?",
      body: "The homework record stays intact; only the uploaded certificate is removed.",
      confirmText: "Remove Certificate",
      tone: "warning",
    });
    if (!ok) return;
    await api.delete(`/homework/${homeworkId}/certificate`);
    onChanged?.();
  };

  return (
    <div className="mt-2 bg-shAccent/5 border border-shAccent/30 rounded p-3 flex items-center gap-3 flex-wrap" data-testid={`cert-row-${homeworkId}`}>
      <i className="fas fa-award text-shAccent text-xl"/>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-black uppercase tracking-widest text-shAccent">Completion certificate</p>
        <p className="text-[13px] text-shTextMuted truncate">
          {hasCert ? <><i className="fas fa-check text-shPrimary mr-1"/>Uploaded · <span className="text-shTextMuted">{certFilename || "certificate"}</span></>
                   : "Upload a personalised cert (PNG/PDF/JPG) — clients see a Download button in their portal."}
        </p>
      </div>
      <input ref={ref} type="file" accept="image/*,.pdf" onChange={onFile} className="hidden" data-testid={`cert-input-${homeworkId}`} />
      {hasCert ? (
        <>
          <button onClick={pick} disabled={busy} data-testid={`cert-replace-${homeworkId}`}
                  className="bg-shAccent/15 text-shAccent border border-shAccent/40 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shAccent/25">
            {busy ? "Uploading…" : "Replace"}
          </button>
          <button onClick={remove} className="text-shTextMuted hover:text-red-400 text-[14px] px-2" data-testid={`cert-remove-${homeworkId}`}>
            <i className="fas fa-trash"/>
          </button>
        </>
      ) : (
        <button onClick={pick} disabled={busy} data-testid={`cert-upload-${homeworkId}`}
                className="bg-shAccent text-bgHeader px-4 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shAccent/80 disabled:opacity-50">
          <i className="fas fa-upload mr-1"/>{busy ? "Uploading…" : "Upload cert"}
        </button>
      )}
    </div>
  );
}
