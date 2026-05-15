import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import TemplatePicker, { tierMeta } from "../components/HomeworkTemplatePicker";
import HomeworkReportPanel from "../components/HomeworkReportPanel";

function todayISO() { return new Date().toISOString().split("T")[0]; }

export default function Homework() {
  const [list, setList] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState({ dog_id: "", title: "", instructions: "", video_url: "", due_date: "" });
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    const [h, d] = await Promise.all([api.get("/homework"), api.get("/dogs")]);
    setList(h.data); setDogs(d.data);
  };
  useEffect(() => { load(); }, []);

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
        <div className="flex gap-2">
          <button onClick={()=>setPickerOpen(true)} data-testid="assign-from-template-button" className="bg-shGreen text-black px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/80">
            <i className="fas fa-clipboard-list mr-2"/>Assign from Template
          </button>
          <button onClick={openNew} data-testid="add-homework-button" className="bg-shBlue text-white px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shBlue/90">
            + Custom
          </button>
        </div>
      </div>

      <div className="flex gap-2">
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
          return (
            <div key={h.id} className={`bg-bgPanel border rounded-xl p-5 shadow-lg ${h.status==="completed"?"border-shGreen/40":"border-bgHover"}`} data-testid={`hw-${h.id}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className={`text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest ${h.status==="completed"?"bg-shGreen/15 text-shGreen":"bg-shOrange/15 text-shOrange"}`}>{h.status}</span>
                    {snap && <span className={`text-[12px] font-black uppercase px-2 py-1 rounded tracking-widest ${tm.bg} ${tm.color}`}><i className={`fas ${snap.icon || "fa-paw"} mr-1`}/>{tm.label}</span>}
                    {h.due_date && <span className="text-[14px] font-black uppercase tracking-widest text-gray-400"><i className="fas fa-calendar mr-1"/>Due {h.due_date}</span>}
                    {snap && <span className="text-[12px] font-black uppercase tracking-widest text-gray-400"><i className="fas fa-list-check mr-1"/>{logCount} client log{logCount===1?"":"s"}</span>}
                  </div>
                  <h4 className="text-lg font-black text-white uppercase tracking-tight">{h.title}</h4>
                  <p className="text-[15px] text-shBlue font-black uppercase tracking-widest mt-1">{h.dog_name} · {h.client_name}</p>
                  {h.instructions && <p className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">{h.instructions}</p>}
                  {h.video_url && <a href={h.video_url} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[14px] text-shBlue hover:underline font-black uppercase tracking-widest"><i className="fas fa-video mr-1"/>Watch demo video</a>}
                  {h.status === "completed" && (
                    <div className="mt-3 bg-shGreen/5 border border-shGreen/20 rounded p-3">
                      <p className="text-[14px] font-black text-shGreen uppercase tracking-widest mb-1"><i className="fas fa-check mr-1"/>Marked done {(h.completed_at||"").slice(0,10)}</p>
                      {h.completion_note && <p className="text-xs text-gray-300 italic">"{h.completion_note}"</p>}
                      {h.completion_photo && <img src={h.completion_photo} alt="" loading="lazy" decoding="async" className="mt-2 h-32 rounded object-cover border border-bgHover" />}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <button onClick={()=>remove(h.id)} className="text-gray-400 hover:text-red-400 p-2"><i className="fas fa-trash text-sm" /></button>
                  {snap && (
                    <button onClick={()=>setExpandedId(isExpanded ? null : h.id)} data-testid={`hw-toggle-report-${h.id}`}
                            className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:underline whitespace-nowrap">
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
