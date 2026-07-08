import { useState } from "react";
import { api, formatErr } from "../lib/api";
import CsvImportButton from "./CsvImportButton";
import { parseDailyTrackerCsv, DAILY_TRACKER_CSV_SAMPLE } from "../lib/csvImport";

/**
 * Admin-facing wizard for building a daily-tracker homework.
 *
 * Flow:
 *   1. Pick dog + title + total days
 *   2. Per-day editor: day focus + step list (drag to reorder, +/- to add/remove)
 *   3. Assign
 *
 * Props:
 *   - dogs: list of dogs (admin owns all)
 *   - defaultDogId: optional pre-selected dog
 *   - onClose, onAssigned (called after successful POST)
 */

const FIELD_KIND_OPTIONS = [
  { value: "checkbox",     label: "✓ Did it / didn't",      icon: "fa-square-check" },
  { value: "mood_5",       label: "😊 Mood (1-5)",          icon: "fa-face-smile" },
  { value: "reps",         label: "# Reps",                  icon: "fa-repeat" },
  { value: "sets",         label: "# Sets",                  icon: "fa-layer-group" },
  { value: "duration_min", label: "⏱ Duration (min)",       icon: "fa-clock" },
  { value: "distance_ft",  label: "📏 Distance (ft)",        icon: "fa-ruler-horizontal" },
  { value: "rating_5",     label: "⭐ Rating (1-5)",         icon: "fa-star" },
  { value: "success_rate", label: "📈 Success rate (%)",    icon: "fa-percent" },
  { value: "text",         label: "📝 Short text",           icon: "fa-pen" },
  { value: "longtext",     label: "📋 Long text",            icon: "fa-pen-fancy" },
];

function blankDay(dayNumber) {
  return {
    day_number: dayNumber,
    day_focus: "",
    instructions: "",
    equipment: [],
    steps: [
      { id: `s-${dayNumber}-1`, label: "" },
    ],
    fields: [
      { id: `f-${dayNumber}-mood`, label: "How'd it go?", kind: "mood_5" },
      { id: `f-${dayNumber}-notes`, label: "Anything to flag for your trainer?", kind: "longtext" },
    ],
  };
}

export default function DailyTrackerBuilder({ dogs, defaultDogId = "", onClose, onAssigned }) {
  const [step, setStep] = useState(1);
  const [dogId, setDogId] = useState(defaultDogId || dogs?.[0]?.id || "");
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [days, setDays] = useState([blankDay(1)]);
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setDay = (idx, patch) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const addDay = () => {
    const nextNum = days.length + 1;
    setDays([...days, blankDay(nextNum)]);
    setActiveDayIdx(days.length);
  };

  const removeDay = (idx) => {
    if (days.length === 1) return;
    const next = days.filter((_, i) => i !== idx).map((d, i) => ({ ...d, day_number: i + 1 }));
    setDays(next);
    setActiveDayIdx(Math.max(0, Math.min(idx, next.length - 1)));
  };

  const duplicateDay = (idx) => {
    const src = days[idx];
    const copy = {
      ...src,
      day_number: idx + 2,
      fields: src.fields.map((f) => ({ ...f, id: `f-${idx + 2}-${f.kind}-${Math.random().toString(36).slice(2, 6)}` })),
    };
    const next = [
      ...days.slice(0, idx + 1),
      copy,
      ...days.slice(idx + 1).map((d, i) => ({ ...d, day_number: idx + 3 + i })),
    ];
    setDays(next);
    setActiveDayIdx(idx + 1);
  };

  const addField = (dayIdx, kind) => {
    const d = days[dayIdx];
    const meta = FIELD_KIND_OPTIONS.find((k) => k.value === kind);
    const newField = {
      id: `f-${d.day_number}-${kind}-${Math.random().toString(36).slice(2, 6)}`,
      label: meta?.label.replace(/^[^A-Za-z]+/, "") || "New field",
      kind,
    };
    setDay(dayIdx, { fields: [...(d.fields || []), newField] });
  };

  const removeField = (dayIdx, fieldId) => {
    const d = days[dayIdx];
    setDay(dayIdx, { fields: d.fields.filter((f) => f.id !== fieldId) });
  };

  // Sprint 106 — Reorder helpers for both fields + steps (move up/down by 1).
  const reorderArray = (arr, idx, dir) => {
    const next = idx + dir;
    if (next < 0 || next >= arr.length) return arr;
    const copy = [...arr];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    return copy;
  };
  const moveField = (dayIdx, fieldId, dir) => {
    const d = days[dayIdx];
    const fs = d.fields || [];
    const idx = fs.findIndex(f => f.id === fieldId);
    setDay(dayIdx, { fields: reorderArray(fs, idx, dir) });
  };
  const moveStep = (dayIdx, stepId, dir) => {
    const d = days[dayIdx];
    const ss = d.steps || [];
    const idx = ss.findIndex(s => s.id === stepId);
    setDay(dayIdx, { steps: reorderArray(ss, idx, dir) });
  };

  const updateField = (dayIdx, fieldId, patch) => {
    const d = days[dayIdx];
    setDay(dayIdx, { fields: d.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) });
  };

  // Sprint 103 — Action steps editor
  const addStep = (dayIdx) => {
    const d = days[dayIdx];
    const steps = d.steps || [];
    const newStep = { id: `s-${d.day_number}-${steps.length + 1}-${Math.random().toString(36).slice(2, 6)}`, label: "", minutes: null };
    setDay(dayIdx, { steps: [...steps, newStep] });
  };
  const updateStep = (dayIdx, stepId, patch) => {
    const d = days[dayIdx];
    setDay(dayIdx, { steps: (d.steps || []).map((s) => (s.id === stepId ? { ...s, ...patch } : s)) });
  };
  const removeStep = (dayIdx, stepId) => {
    const d = days[dayIdx];
    setDay(dayIdx, { steps: (d.steps || []).filter((s) => s.id !== stepId) });
  };

  // Sprint 105 — Per-day resources (URL or pasted link). Each row is
  // {id, name, kind: "link"|"file", url}. We use `kind: "link"` so the backend
  // doesn't require a media_id. Admins paste a Google Drive / Dropbox / direct PDF link.
  const addDayResource = (dayIdx) => {
    const d = days[dayIdx];
    const list = d.resources || [];
    setDay(dayIdx, { resources: [...list, { id: `res-${Math.random().toString(36).slice(2, 8)}`, name: "", kind: "link", url: "" }] });
  };
  const updateDayResource = (dayIdx, resId, patch) => {
    const d = days[dayIdx];
    setDay(dayIdx, { resources: (d.resources || []).map((r) => (r.id === resId ? { ...r, ...patch } : r)) });
  };
  const removeDayResource = (dayIdx, resId) => {
    const d = days[dayIdx];
    setDay(dayIdx, { resources: (d.resources || []).filter((r) => r.id !== resId) });
  };

  // Plan-level resources (shared across all days)
  const [planResources, setPlanResources] = useState([]);
  const addPlanResource = () => setPlanResources(rs => [...rs, { id: `res-${Math.random().toString(36).slice(2, 8)}`, name: "", kind: "link", url: "" }]);
  const updatePlanResource = (rid, patch) => setPlanResources(rs => rs.map(r => r.id === rid ? { ...r, ...patch } : r));
  const removePlanResource = (rid) => setPlanResources(rs => rs.filter(r => r.id !== rid));

  // Sprint 106 — direct file upload (PDF/JPG/PNG, ≤10 MB). Reads the file as a
  // base64 data-URL, POSTs to /homework/resource-upload, gets back a media_id,
  // then inserts a resource row with the upload already wired.
  const [uploadingScope, setUploadingScope] = useState(""); // "plan" | `day-${idx}`
  const [uploadErr, setUploadErr] = useState("");
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const handleUpload = async (scope, dayIdx, file) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setUploadErr(`File too large (${Math.round(file.size / (1024 * 1024))} MB). Max is 10 MB.`); return; }
    setUploadingScope(scope === "plan" ? "plan" : `day-${dayIdx}`);
    setUploadErr("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const { data } = await api.post("/homework/resource-upload", { data: dataUrl, filename: file.name });
      const row = { id: `res-${Math.random().toString(36).slice(2, 8)}`, name: file.name, kind: data.kind || "file", media_id: data.media_id };
      if (scope === "plan") setPlanResources(rs => [...rs, row]);
      else setDay(dayIdx, { resources: [...(days[dayIdx].resources || []), row] });
    } catch (e) {
      setUploadErr(e.response?.data?.detail || formatErr(e) || "Upload failed");
    } finally { setUploadingScope(""); }
  };

  const canGoStep2 = dogId && title.trim().length >= 2;
  const canAssign = days.every((d) => d.day_focus.trim().length > 0 && (d.fields || []).length > 0);

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      const body = {
        dog_id: dogId,
        title: title.trim(),
        instructions: overview.trim(),
        video_url: videoUrl.trim(),
        days: days.map((d) => ({
          day_number: d.day_number,
          day_focus: d.day_focus.trim(),
          instructions: (d.instructions || "").trim(),
          equipment: (d.equipment || []).map(e => (e || "").trim()).filter(Boolean),
          steps: (d.steps || [])
            .filter((s) => (s.label || "").trim())
            .map((s) => ({
              id: s.id,
              label: s.label.trim(),
              minutes: s.minutes ? Number(s.minutes) || null : null,
              // Sprint 110di-66 — per-step directions the client reads under the checkbox
              description: (s.description || "").trim() || undefined,
            })),
          resources: (d.resources || [])
            .filter((r) => ((r.url || "").trim() || (r.media_id || "").trim()) && (r.name || "").trim())
            .map((r) => ({
              id: r.id,
              name: r.name.trim(),
              kind: r.kind || (r.media_id ? "file" : "link"),
              url: r.url ? r.url.trim() : null,
              media_id: r.media_id || null,
            })),
          fields: (d.fields || []).map((f) => ({
            id: f.id,
            label: (f.label || "").trim() || "Untitled",
            kind: f.kind,
            placeholder: f.placeholder || "",
            target: f.target ? Number(f.target) : undefined,
          })),
        })),
        save_as_template: saveAsTemplate,
        template_name: saveAsTemplate ? templateName.trim() : "",
        resources: planResources
          .filter(r => ((r.url || "").trim() || (r.media_id || "").trim()) && (r.name || "").trim())
          .map(r => ({
            id: r.id,
            name: r.name.trim(),
            kind: r.kind || (r.media_id ? "file" : "link"),
            url: r.url ? r.url.trim() : null,
            media_id: r.media_id || null,
          })),
      };
      const { data } = await api.post("/homework/daily-tracker", body);
      onAssigned?.(data);
      onClose?.();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Failed to assign");
    } finally {
      setBusy(false);
    }
  };

  const activeDay = days[activeDayIdx] || days[0];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose} data-testid="daily-tracker-builder">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-5xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover p-5 flex items-center justify-between z-10">
          <div>
            <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
              <i className="fas fa-calendar-check text-shGreen mr-2" />Create Daily Tracker
            </h3>
            <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">
              {step === 1 ? "Step 1 of 2 · Basics" : `Step 2 of 2 · Build ${days.length} day${days.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl" data-testid="dtb-close">
            <i className="fas fa-times" />
          </button>
        </div>

        {step === 1 ? (
          <div className="p-5 space-y-4 max-w-2xl">
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
              <select value={dogId} onChange={(e) => setDogId(e.target.value)} data-testid="dtb-dog"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="">— pick a dog —</option>
                {dogs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="dtb-title"
                     placeholder="e.g., 7-Day Loose-Leash Bootcamp"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Overview (optional)</label>
              <textarea value={overview} onChange={(e) => setOverview(e.target.value)} rows={3} data-testid="dtb-overview"
                        placeholder="Set the stage for the client — what's the goal of the whole week?"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Demo video (optional)</label>
              <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} data-testid="dtb-video"
                     placeholder="https://youtu.be/..."
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </div>
            <div className="bg-shBlue/5 border border-shBlue/30 rounded p-3">
              <p className="text-[13px] text-shBlue font-black uppercase tracking-widest mb-1">
                <i className="fas fa-info-circle mr-1" />How the daily tracker works
              </p>
              <p className="text-[14px] text-gray-300 leading-relaxed">
                You build each day with a one-line focus + a handful of micro-steps. The client only sees Day 1 first.
                They fill it in, submit it, you approve it → Day 2 unlocks. Repeat until the whole plan is done.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={() => setStep(2)} disabled={!canGoStep2} data-testid="dtb-next"
                      className="bg-shBlue text-white px-6 py-2 rounded font-black text-[14px] uppercase tracking-widest disabled:opacity-50">
                Next: Build days →
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-4 gap-5">
            {/* Day-list sidebar */}
            <div className="lg:col-span-1 space-y-2">
              <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">Days · {days.length}</p>
              <div className="space-y-1.5">
                {days.map((d, idx) => (
                  <button key={idx} onClick={() => setActiveDayIdx(idx)} data-testid={`dtb-day-tab-${idx}`}
                          className={`w-full text-left rounded p-2.5 border transition flex items-start gap-2
                            ${activeDayIdx === idx ? "bg-shGreen/15 border-shGreen text-white" : "bg-bgBase border-bgHover text-gray-300 hover:border-shGreen/40"}`}>
                    <span className="font-black text-[14px] uppercase tracking-widest min-w-[44px]">Day {d.day_number}</span>
                    <span className="text-[13px] truncate flex-1">{d.day_focus || <em className="text-gray-500">add focus…</em>}</span>
                  </button>
                ))}
              </div>
              <button onClick={addDay} data-testid="dtb-add-day"
                      className="w-full bg-shGreen/10 text-shGreen border border-shGreen/30 rounded p-2 text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/20">
                <i className="fas fa-plus mr-1" />Add a day
              </button>

              {/* Sprint 110di-65 — bulk-import days + steps from CSV */}
              <div className="border-t border-bgHover pt-3">
                <CsvImportButton
                  label="Import days from CSV"
                  parse={parseDailyTrackerCsv}
                  sampleText={DAILY_TRACKER_CSV_SAMPLE}
                  sampleFilename="daily-tracker-template.csv"
                  testIdPrefix="dtb-csv"
                  helpText="Columns: day_number, day_focus, day_instructions (optional), day_equipment (optional, semicolons), step_label, step_minutes (optional), step_description (optional). Replaces the current days plan."
                  onImport={(parsed) => {
                    if (!parsed?.days?.length) return;
                    setDays(parsed.days);
                    setActiveDayIdx(0);
                  }}
                />
              </div>

              <div className="border-t border-bgHover pt-3 mt-3 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} data-testid="dtb-save-template"
                         className="accent-shGreen w-4 h-4 mt-0.5" />
                  <span className="text-[13px] text-gray-300 font-black uppercase tracking-widest">Also save as a reusable template</span>
                </label>
                {saveAsTemplate && (
                  <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} data-testid="dtb-template-name"
                         placeholder="Template name"
                         className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                )}
              </div>

              {/* Plan-level resources (Sprint 105) — shared across all days */}
              <div className="border-t border-bgHover pt-3 mt-3">
                <p className="text-[13px] font-black uppercase tracking-widest text-purple-300 mb-1">
                  <i className="fas fa-paperclip mr-1"/>Plan-wide resources ({planResources.length})
                </p>
                <p className="text-[12px] text-gray-500 mb-2">PDFs or links available on every day card.</p>
                <div className="space-y-2">
                  {planResources.map((r) => (
                    <div key={r.id} className="space-y-1" data-testid={`dtb-plan-res-${r.id}`}>
                      <input value={r.name} onChange={(e) => updatePlanResource(r.id, { name: e.target.value })}
                             placeholder="Display name"
                             className="w-full bg-bgBase border border-bgHover rounded p-1.5 text-white text-[13px]" />
                      <div className="flex items-center gap-1">
                        {r.media_id ? (
                          <span className="flex-1 text-[12px] text-purple-200 bg-purple-500/20 px-2 py-1 rounded font-black uppercase tracking-widest">
                            <i className="fas fa-circle-check mr-1"/>{r.kind === "image" ? "image" : "file"} uploaded
                          </span>
                        ) : (
                          <input value={r.url || ""} onChange={(e) => updatePlanResource(r.id, { url: e.target.value })}
                                 placeholder="https://..."
                                 className="flex-1 bg-bgBase border border-bgHover rounded p-1.5 text-white text-[13px]" />
                        )}
                        <button onClick={() => removePlanResource(r.id)} className="text-gray-400 hover:text-red-400 px-1.5" data-testid={`dtb-remove-plan-res-${r.id}`}>
                          <i className="fas fa-times"/>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 items-center">
                  <label data-testid="dtb-plan-upload-file"
                         className={`cursor-pointer bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 px-3 py-1 rounded text-[12px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 ${uploadingScope === "plan" ? "opacity-60 cursor-wait" : ""}`}>
                    {uploadingScope === "plan" ? <><i className="fas fa-spinner fa-spin"/>Uploading…</> : <><i className="fas fa-upload"/>Upload PDF / image</>}
                    <input type="file" accept=".pdf,image/*" className="hidden" disabled={uploadingScope === "plan"}
                           onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handleUpload("plan", null, f); }} />
                  </label>
                  <button onClick={addPlanResource} data-testid="dtb-add-plan-resource"
                          className="text-purple-300 hover:text-purple-200 text-[12px] font-black uppercase tracking-widest">
                    <i className="fas fa-link mr-1"/>Or paste a URL
                  </button>
                </div>
              </div>
            </div>

            {/* Active-day editor */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-bgBase border border-bgHover rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[14px] font-black uppercase tracking-widest text-shGreen">Day {activeDay.day_number}</p>
                  <div className="flex gap-1">
                    <button onClick={() => duplicateDay(activeDayIdx)} className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-shBlue px-2 py-1" data-testid="dtb-dup-day">
                      <i className="fas fa-clone mr-1" />Duplicate
                    </button>
                    {days.length > 1 && (
                      <button onClick={() => removeDay(activeDayIdx)} className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-red-400 px-2 py-1" data-testid="dtb-remove-day">
                        <i className="fas fa-trash mr-1" />Remove
                      </button>
                    )}
                  </div>
                </div>

                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Today's focus</label>
                <input value={activeDay.day_focus} onChange={(e) => setDay(activeDayIdx, { day_focus: e.target.value })} data-testid="dtb-day-focus"
                       placeholder="e.g., Walk to mailbox & back without pulling"
                       className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />

                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest mt-3 block">Detailed instructions (optional)</label>
                <textarea value={activeDay.instructions} onChange={(e) => setDay(activeDayIdx, { instructions: e.target.value })} rows={2} data-testid="dtb-day-instructions"
                          placeholder="Specifics for the client: warm-up, distractions to use, where to practice…"
                          className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />

                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest mt-3 block">
                  <i className="fas fa-toolbox mr-1 text-shOrange"/>Equipment / treats needed (comma-separated)
                </label>
                <input value={(activeDay.equipment || []).join(", ")}
                       onChange={(e) => setDay(activeDayIdx, { equipment: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                       data-testid="dtb-day-equipment"
                       placeholder="e.g., high-value treats, 6-ft leash, target stick"
                       className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
                <p className="text-[12px] text-gray-500 mt-1">Shown to the client at the top of the day card so they don't show up empty-handed.</p>
              </div>

              {/* Action steps (Sprint 103+105) — checkable list with per-step minutes */}
              <div className="bg-bgBase border border-shGreen/30 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                  <p className="text-[14px] font-black uppercase tracking-widest text-shGreen">
                    <i className="fas fa-list-check mr-1" />Action steps for today ({(activeDay.steps || []).filter(s => s.label?.trim()).length})
                  </p>
                  {(() => {
                    const total = (activeDay.steps || []).reduce((acc, s) => acc + (Number(s.minutes) || 0), 0);
                    return total > 0 ? (
                      <span className="text-[12px] text-shGreen font-black uppercase tracking-widest" data-testid="dtb-day-minutes-total">
                        <i className="fas fa-clock mr-1"/>~{total} min total
                      </span>
                    ) : null;
                  })()}
                </div>
                <p className="text-[13px] text-gray-400 mb-3">
                  Bite-sized checkboxes the client ticks off as they go. Add a minute target so you (and they) know how long the day takes. When every step is checked, the day auto-submits.
                </p>
                <div className="space-y-3">
                  {(activeDay.steps || []).map((s, i) => (
                    <div key={s.id} className="space-y-1.5" data-testid={`dtb-step-${s.id}`}>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <button onClick={() => moveStep(activeDayIdx, s.id, -1)} disabled={i === 0} data-testid={`dtb-step-up-${s.id}`}
                                  className="text-gray-500 hover:text-shGreen disabled:opacity-30 disabled:cursor-not-allowed text-xs leading-none h-3">
                            <i className="fas fa-chevron-up"/>
                          </button>
                          <button onClick={() => moveStep(activeDayIdx, s.id, 1)} disabled={i === (activeDay.steps || []).length - 1} data-testid={`dtb-step-down-${s.id}`}
                                  className="text-gray-500 hover:text-shGreen disabled:opacity-30 disabled:cursor-not-allowed text-xs leading-none h-3 mt-0.5">
                            <i className="fas fa-chevron-down"/>
                          </button>
                        </div>
                        <input value={s.label} onChange={(e) => updateStep(activeDayIdx, s.id, { label: e.target.value })}
                               placeholder={`Step ${i + 1} · e.g., "Practice sit for 5 reps in the kitchen"`}
                               className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
                        <input
                          type="number" min="0" max="180"
                          value={s.minutes ?? ""}
                          onChange={(e) => updateStep(activeDayIdx, s.id, { minutes: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value) || 0) })}
                          placeholder="min"
                          title="Minutes for this step"
                          data-testid={`dtb-step-minutes-${s.id}`}
                          className="w-20 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm text-center"
                        />
                        {(activeDay.steps || []).length > 1 && (
                          <button onClick={() => removeStep(activeDayIdx, s.id)} data-testid={`dtb-remove-step-${s.id}`}
                                  className="text-gray-400 hover:text-red-400 px-2">
                            <i className="fas fa-times"/>
                          </button>
                        )}
                      </div>
                      {/* Sprint 110di-66 — per-step directions the client reads under the checkbox */}
                      <textarea
                        value={s.description || ""}
                        onChange={(e) => updateStep(activeDayIdx, s.id, { description: e.target.value })}
                        data-testid={`dtb-step-description-${s.id}`}
                        placeholder="Directions for the client (how to actually do this step, what to mark, what to reward)…"
                        rows={2}
                        className="w-full ml-6 bg-bgPanel/60 border border-bgHover rounded p-2 text-gray-300 text-[13px] leading-snug"
                        style={{ width: "calc(100% - 1.5rem)" }}
                      />
                    </div>
                  ))}
                </div>
                <button onClick={() => addStep(activeDayIdx)} data-testid="dtb-add-step"
                        className="mt-3 text-shGreen hover:text-shGreen/80 text-[13px] font-black uppercase tracking-widest">
                  <i className="fas fa-plus mr-1"/>Add a step
                </button>
              </div>

              {/* Per-day resources (Sprint 105) — printable handouts the client can take outside */}
              <div className="bg-bgBase border border-purple-400/30 rounded-xl p-4">
                <p className="text-[14px] font-black uppercase tracking-widest text-purple-300 mb-1">
                  <i className="fas fa-paperclip mr-1"/>Day {activeDay.day_number} resources ({(activeDay.resources || []).length})
                </p>
                <p className="text-[13px] text-gray-400 mb-3">
                  Paste a public link to a PDF, diagram, or YouTube clip the client should grab for THIS day. They'll see a tap-to-open button on the day card.
                </p>
                <div className="space-y-2">
                  {(activeDay.resources || []).map((r) => (
                    <div key={r.id} className="flex items-center gap-2" data-testid={`dtb-day-res-${r.id}`}>
                      <i className={`fas ${r.media_id ? "fa-file" : "fa-link"} text-purple-300 text-xs w-4 text-center`}/>
                      <input value={r.name} onChange={(e) => updateDayResource(activeDayIdx, r.id, { name: e.target.value })}
                             placeholder="Display name (e.g., Leash-positioning diagram)"
                             className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
                      {r.media_id ? (
                        <span className="text-[12px] text-purple-200 bg-purple-500/20 px-2 py-1 rounded font-black uppercase tracking-widest">
                          <i className="fas fa-circle-check mr-1"/>uploaded
                        </span>
                      ) : (
                        <input value={r.url || ""} onChange={(e) => updateDayResource(activeDayIdx, r.id, { url: e.target.value })}
                               placeholder="https://..."
                               className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
                      )}
                      <button onClick={() => removeDayResource(activeDayIdx, r.id)} data-testid={`dtb-remove-day-res-${r.id}`}
                              className="text-gray-400 hover:text-red-400 px-2"><i className="fas fa-times"/></button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <label data-testid="dtb-day-upload-file"
                         className={`cursor-pointer bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest inline-flex items-center gap-1.5 ${uploadingScope === `day-${activeDayIdx}` ? "opacity-60 cursor-wait" : ""}`}>
                    {uploadingScope === `day-${activeDayIdx}` ? <><i className="fas fa-spinner fa-spin"/>Uploading…</> : <><i className="fas fa-upload"/>Upload PDF / image</>}
                    <input type="file" accept=".pdf,image/*" className="hidden" disabled={uploadingScope === `day-${activeDayIdx}`}
                           onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handleUpload("day", activeDayIdx, f); }} />
                  </label>
                  <button onClick={() => addDayResource(activeDayIdx)} data-testid="dtb-add-day-resource"
                          className="text-purple-300 hover:text-purple-200 text-[13px] font-black uppercase tracking-widest">
                    <i className="fas fa-link mr-1"/>Or paste a URL
                  </button>
                </div>
                {uploadErr && uploadingScope === "" && <p className="text-red-400 text-[13px] mt-2" data-testid="dtb-upload-err">{uploadErr}</p>}
              </div>

              {/* Steps list */}
              <div className="bg-bgBase border border-bgHover rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[14px] font-black uppercase tracking-widest text-shBlue">
                    <i className="fas fa-list-check mr-1" />Steps to log ({(activeDay.fields || []).length})
                  </p>
                </div>
                <div className="space-y-2">
                  {(activeDay.fields || []).map((f, i) => (
                    <div key={f.id} className="bg-bgPanel border border-bgHover rounded p-2.5 flex items-center gap-2" data-testid={`dtb-field-${f.id}`}>
                      <div className="flex flex-col">
                        <button onClick={() => moveField(activeDayIdx, f.id, -1)} disabled={i === 0} data-testid={`dtb-field-up-${f.id}`}
                                className="text-gray-500 hover:text-shBlue disabled:opacity-30 disabled:cursor-not-allowed text-xs leading-none h-3">
                          <i className="fas fa-chevron-up"/>
                        </button>
                        <button onClick={() => moveField(activeDayIdx, f.id, 1)} disabled={i === (activeDay.fields || []).length - 1} data-testid={`dtb-field-down-${f.id}`}
                                className="text-gray-500 hover:text-shBlue disabled:opacity-30 disabled:cursor-not-allowed text-xs leading-none h-3 mt-0.5">
                          <i className="fas fa-chevron-down"/>
                        </button>
                      </div>
                      <i className={`fas ${FIELD_KIND_OPTIONS.find(k=>k.value===f.kind)?.icon || "fa-circle"} text-gray-500 w-5 text-center text-[14px]`} />
                      <input value={f.label} onChange={(e) => updateField(activeDayIdx, f.id, { label: e.target.value })}
                             placeholder="Custom label (e.g., How many recalls?)" className="flex-1 bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" />
                      <select value={f.kind} onChange={(e) => updateField(activeDayIdx, f.id, { kind: e.target.value })}
                              className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-[13px]">
                        {FIELD_KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                      <button onClick={() => removeField(activeDayIdx, f.id)} className="text-gray-400 hover:text-red-400 px-2" data-testid={`dtb-remove-field-${f.id}`}>
                        <i className="fas fa-times" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-bgHover">
                  <p className="text-[13px] font-black text-gray-500 uppercase tracking-widest mb-2">Add a step:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FIELD_KIND_OPTIONS.map(k => (
                      <button key={k.value} onClick={() => addField(activeDayIdx, k.value)} data-testid={`dtb-addfield-${k.value}`}
                              className="bg-bgPanel border border-bgHover hover:border-shBlue rounded px-2.5 py-1.5 text-[12px] text-gray-300 font-black uppercase tracking-widest">
                        <i className={`fas ${k.icon} mr-1`} />{k.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {err && <div className="text-[14px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
              <div className="flex justify-between gap-2 pt-2 border-t border-bgHover">
                <button onClick={() => setStep(1)} className="text-gray-400 font-black uppercase text-[14px] tracking-widest">← Back</button>
                <button onClick={submit} disabled={busy || !canAssign} data-testid="dtb-assign"
                        className="bg-shGreen text-black px-6 py-2.5 rounded font-black text-[14px] uppercase tracking-widest disabled:opacity-50 hover:bg-shGreen/80">
                  {busy ? "Assigning…" : `Assign ${days.length}-day plan`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
