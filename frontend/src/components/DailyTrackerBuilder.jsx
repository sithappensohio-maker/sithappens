import { useState } from "react";
import { api, formatErr } from "../lib/api";

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

  const updateField = (dayIdx, fieldId, patch) => {
    const d = days[dayIdx];
    setDay(dayIdx, { fields: d.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) });
  };

  // Sprint 103 — Action steps editor
  const addStep = (dayIdx) => {
    const d = days[dayIdx];
    const steps = d.steps || [];
    const newStep = { id: `s-${d.day_number}-${steps.length + 1}-${Math.random().toString(36).slice(2, 6)}`, label: "" };
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
            .map((s) => ({ id: s.id, label: s.label.trim() })),
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
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
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

              {/* Action steps (Sprint 103) — checkable list shown in Today's Plan */}
              <div className="bg-bgBase border border-shGreen/30 rounded-xl p-4">
                <p className="text-[14px] font-black uppercase tracking-widest text-shGreen mb-1">
                  <i className="fas fa-list-check mr-1" />Action steps for today ({(activeDay.steps || []).filter(s => s.label?.trim()).length})
                </p>
                <p className="text-[13px] text-gray-400 mb-3">
                  Bite-sized checkboxes the client ticks off as they go. When every step is checked, the day auto-submits for your review.
                </p>
                <div className="space-y-2">
                  {(activeDay.steps || []).map((s, i) => (
                    <div key={s.id} className="flex items-center gap-2" data-testid={`dtb-step-${s.id}`}>
                      <i className="fas fa-square text-shGreen text-xs w-4 text-center"/>
                      <input value={s.label} onChange={(e) => updateStep(activeDayIdx, s.id, { label: e.target.value })}
                             placeholder={`Step ${i + 1} · e.g., "Practice sit for 5 reps in the kitchen"`}
                             className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
                      {(activeDay.steps || []).length > 1 && (
                        <button onClick={() => removeStep(activeDayIdx, s.id)} data-testid={`dtb-remove-step-${s.id}`}
                                className="text-gray-400 hover:text-red-400 px-2">
                          <i className="fas fa-times"/>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => addStep(activeDayIdx)} data-testid="dtb-add-step"
                        className="mt-3 text-shGreen hover:text-shGreen/80 text-[13px] font-black uppercase tracking-widest">
                  <i className="fas fa-plus mr-1"/>Add a step
                </button>
              </div>

              {/* Steps list */}
              <div className="bg-bgBase border border-bgHover rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[14px] font-black uppercase tracking-widest text-shBlue">
                    <i className="fas fa-list-check mr-1" />Steps to log ({(activeDay.fields || []).length})
                  </p>
                </div>
                <div className="space-y-2">
                  {(activeDay.fields || []).map((f) => (
                    <div key={f.id} className="bg-bgPanel border border-bgHover rounded p-2.5 flex items-center gap-2" data-testid={`dtb-field-${f.id}`}>
                      <i className={`fas ${FIELD_KIND_OPTIONS.find(k=>k.value===f.kind)?.icon || "fa-circle"} text-gray-500 w-5 text-center text-[14px]`} />
                      <input value={f.label} onChange={(e) => updateField(activeDayIdx, f.id, { label: e.target.value })}
                             placeholder="Label" className="flex-1 bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" />
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
