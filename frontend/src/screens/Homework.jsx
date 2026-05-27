import { useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import TemplatePicker, { tierMeta } from "../components/HomeworkTemplatePicker";
import HomeworkReportPanel from "../components/HomeworkReportPanel";
import DailyTrackerBuilder from "../components/DailyTrackerBuilder";
import DailyReviewQueue from "../components/DailyReviewQueue";
import HomeworkAnalytics from "../components/HomeworkAnalytics";

function todayISO() { return new Date().toISOString().split("T")[0]; }

export default function Homework() {
  const [list, setList] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [form, setForm] = useState({ dog_id: "", title: "", instructions: "", video_url: "", due_date: "" });
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    const [h, d] = await Promise.all([api.get("/homework"), api.get("/dogs")]);
    setList(h.data); setDogs(d.data);
    try {
      const r = await api.get("/admin/homework/pending-reviews");
      setPendingCount(Array.isArray(r.data) ? r.data.length : 0);
    } catch { setPendingCount(0); }
  };
  useEffect(() => { load(); }, []);

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
      alert(msg);
    } catch (e) {
      alert(`Failed: ${e.response?.data?.detail || e.message}`);
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
      alert(msg);
    } catch (e) {
      alert(`Failed: ${e.response?.data?.detail || e.message}`);
    } finally { setDigestBusy(false); }
  };

  const openNew = () => {
    if (dogs.length === 0) { alert("Add a dog first"); return; }
    setForm({ dog_id: dogs[0].id, title: "", instructions: "", video_url: "", due_date: "" });
    setErr(""); setOpen(true);
  };

  const save = async () => {
    setErr("");
    try { await api.post("/homework", form); setOpen(false); load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const confirm = useConfirm();
  const remove = async (id) => { if (!(await confirm({ title: "Delete homework?", body: "This will remove the assignment and all its session logs. This cannot be undone.", confirmText: "Delete", tone: "danger" }))) return; await api.delete(`/homework/${id}`); load(); };

  const filtered = filter === "all" ? list : list.filter(h => h.status === filter);
  const counts = { all: list.length, assigned: list.filter(h=>h.status==="assigned").length, completed: list.filter(h=>h.status==="completed").length };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="homework-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Training Homework</h3>
          <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">Assign exercises to clients between sessions</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {pendingCount > 0 && (
            <button onClick={() => setReviewOpen(true)} data-testid="review-queue-button"
                    className="relative bg-shOrange text-bgHeader px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shOrange/80">
              <i className="fas fa-clipboard-check mr-2" />Review · {pendingCount}
              <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[11px] font-black animate-pulse">{pendingCount}</span>
            </button>
          )}
          <button onClick={() => setTrackerOpen(true)} data-testid="daily-tracker-button"
                  className="bg-purple-500 text-white px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-purple-500/80">
            <i className="fas fa-calendar-check mr-2" />Daily Tracker
          </button>
          <button onClick={() => setAnalyticsOpen(true)} data-testid="homework-analytics-button" title="Curriculum completion + drop-off insights"
                  className="bg-bgPanel border border-bgHover text-gray-300 px-4 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest hover:border-shGreen hover:text-shGreen">
            <i className="fas fa-chart-line mr-1.5" />Analytics
          </button>
          <button onClick={sendWeeklyDigest} disabled={digestBusy} data-testid="send-weekly-digest-button" title="Auto-fires every Sunday night"
                  className="bg-bgPanel border border-bgHover text-gray-300 px-4 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest hover:border-purple-400 hover:text-purple-300 disabled:opacity-50">
            <i className="fas fa-envelope-open-text mr-1.5" />{digestBusy ? "Sending…" : "Weekly recap"}
          </button>
          <button onClick={()=>setPickerOpen(true)} data-testid="assign-from-template-button" className="bg-shGreen text-black px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/80">
            <i className="fas fa-clipboard-list mr-2"/>From Template
          </button>
          <button onClick={openNew} data-testid="add-homework-button" className="bg-shBlue text-white px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shBlue/90">
            + Custom
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all","assigned","completed"].map(k => (
          <button key={k} onClick={()=>setFilter(k)} data-testid={`hw-filter-${k}`}
                  className={`px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest ${filter===k?"bg-shBlue text-white":"bg-bgPanel text-gray-400 border border-bgHover"}`}>
            {k} · {counts[k]}
          </button>
        ))}
      </div>

      <div className="space-y-3" data-testid="homework-list">
        {filtered.length === 0 && <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center text-xs text-gray-500 uppercase font-black">No homework {filter !== "all" ? `(${filter})` : "yet"}.</div>}
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
            <div key={h.id} className={`bg-bgPanel border rounded-xl p-5 shadow-lg ${h.status==="completed"?"border-shGreen/40":"border-bgHover"}`} data-testid={`hw-${h.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={`text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest ${h.status==="completed"?"bg-shGreen/15 text-shGreen":"bg-shOrange/15 text-shOrange"}`}>{h.status}</span>
                    {h.daily_tracker && <span className="text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest bg-purple-500/15 text-purple-300"><i className="fas fa-calendar-check mr-1"/>Daily · {totalDays}d</span>}
                    {h.template_snapshot && !h.daily_tracker && (() => { const tm = tierMeta(h.template_snapshot.tier); return <span className={`text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest ${tm.bg} ${tm.color}`}><i className={`fas ${h.template_snapshot.icon || "fa-paw"} mr-1`}/>{tm.label}</span>; })()}
                    {h.due_date && <span className="text-[14px] font-black uppercase tracking-widest text-gray-400"><i className="fas fa-calendar mr-1"/>Due {h.due_date}</span>}
                    {snap && <span className="text-[14px] font-black uppercase tracking-widest text-gray-400"><i className="fas fa-list-check mr-1"/>{logCount} client log{logCount===1?"":"s"}</span>}
                    {isTracker && streak > 0 && <span className="text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest bg-shGreen/15 text-shGreen" data-testid={`hw-streak-${h.id}`}><i className="fas fa-fire mr-1"/>{streak}/{totalDays}</span>}
                  </div>
                  <h4 className="text-lg font-black text-white uppercase tracking-tight">{h.title}</h4>
                  <p className="text-[15px] text-shBlue font-black uppercase tracking-widest mt-1">{h.dog_name} · {h.client_name}</p>
                  {isTracker && h.status !== "completed" && totalDays > 0 && (
                    <div className="mt-3" data-testid={`hw-progress-${h.id}`}>
                      <div className="flex items-center justify-between text-[12px] text-gray-400 mb-1">
                        <span className="font-black uppercase tracking-widest">Progress</span>
                        <span className="font-black text-shGreen">{progressPct}% · day {Math.min(streak + 1, totalDays)} of {totalDays}</span>
                      </div>
                      <div className="h-2 rounded-full bg-bgBase overflow-hidden">
                        <div className="h-full bg-shGreen transition-all" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                  )}
                  {h.instructions && <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{h.instructions}</p>}
                  {h.video_url && <a href={h.video_url} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[14px] text-shBlue hover:underline font-black uppercase tracking-widest"><i className="fas fa-video mr-1"/>Watch demo video</a>}
                  {h.status === "completed" && (
                    <div className="mt-3 bg-shGreen/5 border border-shGreen/20 rounded p-3">
                      <p className="text-[14px] font-black text-shGreen uppercase tracking-widest mb-1"><i className="fas fa-check mr-1"/>Marked done {(h.completed_at||"").slice(0,10)}</p>
                      {h.completion_note && <p className="text-xs text-gray-300 italic">"{h.completion_note}"</p>}
                      {h.completion_photo && <img src={h.completion_photo} alt="" loading="lazy" decoding="async" className="mt-2 h-32 rounded object-cover border border-bgHover" />}
                    </div>
                  )}
                  {h.daily_tracker && h.status === "completed" && (
                    <CertUploadInline homeworkId={h.id} hasCert={!!h.certificate} certFilename={h.certificate_filename} onChanged={load} />
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <button onClick={()=>remove(h.id)} className="text-gray-400 hover:text-red-400 p-2"><i className="fas fa-trash text-sm" /></button>
                  {snap && (
                    <button onClick={()=>setExpandedId(isExpanded ? null : h.id)} data-testid={`hw-toggle-report-${h.id}`}
                            className="text-[14px] font-black uppercase tracking-widest text-shBlue hover:underline whitespace-nowrap">
                      {isExpanded ? "Hide report" : "View report"} <i className={`fas fa-chevron-${isExpanded?"up":"down"} ml-1`}/>
                    </button>
                  )}
                </div>
              </div>
              {snap && isExpanded && (
                <div className="mt-4 pt-4 border-t border-bgHover">
                  <HomeworkReportPanel homeworkId={h.id} />
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
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 md:p-8 shadow-2xl animate-slide-in">
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight mb-4">Custom Homework</h4>
            <div className="space-y-4">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                <select value={form.dog_id} onChange={(e)=>setForm({...form, dog_id:e.target.value})} data-testid="hw-dog"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Title</label>
                <input value={form.title} onChange={(e)=>setForm({...form, title:e.target.value})} placeholder="e.g., Practice place command 10 min/day" data-testid="hw-title"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Instructions</label>
                <textarea value={form.instructions} onChange={(e)=>setForm({...form, instructions:e.target.value})} rows={4} data-testid="hw-instructions"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Video URL (YouTube link to a demo, optional)</label>
                <input value={form.video_url} onChange={(e)=>setForm({...form, video_url:e.target.value})} placeholder="https://youtu.be/..." data-testid="hw-video"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Due Date (optional)</label>
                <input type="date" min={todayISO()} value={form.due_date} onChange={(e)=>setForm({...form, due_date:e.target.value})} data-testid="hw-due"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </div>
              {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
              <div className="flex justify-end gap-3">
                <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
                <button onClick={save} data-testid="save-homework" className="bg-shBlue text-white px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl">Assign</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function CertUploadInline({ homeworkId, hasCert, certFilename, onChanged }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  const pick = () => ref.current?.click();
  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { alert("Cert file too large — keep it under 5 MB."); return; }
    setBusy(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((res, rej) => { reader.onload = () => res(reader.result); reader.onerror = rej; reader.readAsDataURL(f); });
      await api.post(`/homework/${homeworkId}/certificate`, { photo: dataUrl, filename: f.name });
      onChanged?.();
    } catch (ex) { alert("Upload failed: " + (ex.response?.data?.detail || ex.message)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm("Remove the certificate for this homework?")) return;
    await api.delete(`/homework/${homeworkId}/certificate`);
    onChanged?.();
  };

  return (
    <div className="mt-2 bg-shOrange/5 border border-shOrange/30 rounded p-3 flex items-center gap-3 flex-wrap" data-testid={`cert-row-${homeworkId}`}>
      <i className="fas fa-award text-shOrange text-xl"/>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-black uppercase tracking-widest text-shOrange">Completion certificate</p>
        <p className="text-[13px] text-gray-300 truncate">
          {hasCert ? <><i className="fas fa-check text-shGreen mr-1"/>Uploaded · <span className="text-gray-400">{certFilename || "certificate"}</span></>
                   : "Upload a personalised cert (PNG/PDF/JPG) — clients see a Download button in their portal."}
        </p>
      </div>
      <input ref={ref} type="file" accept="image/*,.pdf" onChange={onFile} className="hidden" data-testid={`cert-input-${homeworkId}`} />
      {hasCert ? (
        <>
          <button onClick={pick} disabled={busy} data-testid={`cert-replace-${homeworkId}`}
                  className="bg-shOrange/15 text-shOrange border border-shOrange/40 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shOrange/25">
            {busy ? "Uploading…" : "Replace"}
          </button>
          <button onClick={remove} className="text-gray-400 hover:text-red-400 text-[14px] px-2" data-testid={`cert-remove-${homeworkId}`}>
            <i className="fas fa-trash"/>
          </button>
        </>
      ) : (
        <button onClick={pick} disabled={busy} data-testid={`cert-upload-${homeworkId}`}
                className="bg-shOrange text-bgHeader px-4 py-1.5 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shOrange/80 disabled:opacity-50">
          <i className="fas fa-upload mr-1"/>{busy ? "Uploading…" : "Upload cert"}
        </button>
      )}
    </div>
  );
}
