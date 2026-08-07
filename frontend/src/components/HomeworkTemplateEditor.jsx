// Client Practice Coach upgrade — the homework-template authoring editor.
// Extends the existing homework-template model (POST/PUT /homework-
// templates, previously uncalled from the frontend — see Phase 0 audit)
// with a Coach Mode / Troubleshooting / Preview workflow, per
// 04_HOMEWORK_AUTHORING_WORKFLOW.md. Reachable from the admin Homework
// screen (new-template / edit-template) and from Program Studio's existing
// template pickers (an edit affordance next to each select) — never a
// second, disconnected template tool.
//
// Preview renders the REAL production client Coach Mode components
// (CoachPracticeOverview, GuidedPracticeFlow, PracticeCompletionPanel)
// against in-memory draft state — never a separately-styled mock.
import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import { practiceCoachReadiness, PRACTICE_COACH_ICON_KEYS, iconKeyToFaClass } from "../lib/practiceCoachPolish";
import CoachPracticeOverview from "./training/CoachPracticeOverview";
import GuidedPracticeFlow from "./training/GuidedPracticeFlow";
import PracticeCompletionPanel from "./training/PracticeCompletionPanel";
import CoachEndQuestions from "./training/CoachEndQuestions";
import DifficultyFeedbackNotice from "./training/DifficultyFeedbackNotice";

const TIERS = ["foundation", "intermediate", "advanced", "specialty", "master"];
const TABS = ["basics", "coach", "troubleshooting", "preview"];
const TAB_LABELS = { basics: "Basics", coach: "Coach Mode", troubleshooting: "Troubleshooting", preview: "Preview" };

function genId(prefix) { return `${prefix}-${Math.random().toString(36).slice(2, 8)}`; }

function emptyPracticeCoach() {
  return {
    enabled: false, allow_quick_practice: true, goal: "", success_today: "", encouragement: "",
    schedule: { minutes_per_round: null, rounds_per_day: null, reps_per_round: null, rest_after_reps: null, target_response_seconds: null },
    setup_items: [], pro_tip: "", steps: [],
    good_rep: { sequence: [], explanation: "", media_url: null },
    not_this: { sequence: [], explanation: "", media_url: null },
    troubleshooting: [], stop_rules: [],
    guided_practice: { enabled: true, ready_instruction: "", cue_prompt: "", success_button_label: "SUCCESS", miss_button_label: "MISS", success_message: "", miss_message: "", count_successes: true },
    difficulty_feedback: { easy: "", good: "", okay: "", hard: "", very_hard: "" },
    end_questions: [],
    media: { request_photo: false, request_video: false, media_prompt: null },
  };
}

function emptyTemplate() {
  return {
    name: "", tier: "master", description: "", default_duration_days: 7, cover_color: "#8cc63f", icon: "fa-paw",
    global_rules_this_week: [], sections: [], active: true, practice_coach: null,
  };
}

// ---- small shared field controls ----
function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted block mb-1">{label}</label>
      {children}
    </div>
  );
}
const inputCls = "w-full bg-black/20 border border-shBorder rounded p-2 text-shText text-sm";

function StringListEditor({ items, onChange, placeholder, testid }) {
  return (
    <div className="space-y-1.5" data-testid={testid}>
      {(items || []).map((v, i) => (
        <div key={i} className="flex gap-1.5">
          <input value={v} onChange={(e) => onChange(items.map((x, j) => j === i ? e.target.value : x))} className={inputCls}/>
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-shDanger px-2"><i className="fas fa-trash"/></button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...(items || []), ""])}
              className="text-[11px] font-black uppercase tracking-widest text-shPrimary">
        <i className="fas fa-plus mr-1"/>{placeholder || "Add"}
      </button>
    </div>
  );
}

function ListEditor({ items, onChange, newItem, renderItem, addLabel, testid }) {
  const update = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const copy = [...items];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  };
  return (
    <div className="space-y-2" data-testid={testid}>
      {(items || []).map((it, i) => (
        <div key={it.id || i} className="bg-black/20 border border-shBorder rounded-lg p-2.5 space-y-2" data-testid={testid ? `${testid}-item-${i}` : undefined}>
          {renderItem(it, (patch) => update(i, patch), i)}
          <div className="flex items-center gap-2 justify-end pt-1 border-t border-shBorder/50">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} data-testid={testid ? `${testid}-item-${i}-up` : undefined}
                    className="text-shTextMuted disabled:opacity-30 text-[11px]"><i className="fas fa-arrow-up"/></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} data-testid={testid ? `${testid}-item-${i}-down` : undefined}
                    className="text-shTextMuted disabled:opacity-30 text-[11px]"><i className="fas fa-arrow-down"/></button>
            <button type="button" onClick={() => remove(i)} data-testid={testid ? `${testid}-item-${i}-delete` : undefined}
                    className="text-shDanger text-[11px]"><i className="fas fa-trash mr-1"/>Remove</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...(items || []), newItem()])} data-testid={testid ? `${testid}-add` : undefined}
              className="text-[11px] font-black uppercase tracking-widest text-shPrimary">
        <i className="fas fa-plus mr-1"/>{addLabel}
      </button>
    </div>
  );
}

function ReadinessChecklist({ pc, testid }) {
  const checklist = practiceCoachReadiness(pc);
  if (!pc?.enabled) return null;
  return (
    <div className="bg-black/20 border border-shBorder rounded-lg p-3 space-y-1.5" data-testid={testid}>
      <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1">Readiness</p>
      {checklist.map(c => (
        <div key={c.key} className="flex items-center gap-2 text-[12px]" data-testid={testid ? `${testid}-${c.key}` : undefined}>
          <i className={`fas ${c.met ? "fa-circle-check text-shPrimary" : c.optional ? "fa-circle text-shTextMuted" : "fa-circle-exclamation text-shAccent"}`}/>
          <span className={c.met ? "text-shText" : "text-shTextMuted"}>{c.label}{c.optional && !c.met ? " (optional)" : ""}</span>
        </div>
      ))}
    </div>
  );
}

export default function HomeworkTemplateEditor({ templateId, onClose, onSaved }) {
  const [draft, setDraft] = useState(emptyTemplate());
  const [loading, setLoading] = useState(!!templateId);
  const [activeTab, setActiveTab] = useState("basics");
  const [previewMode, setPreviewMode] = useState("overview"); // overview | guided | quick | mobile
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!templateId) return;
    (async () => {
      try {
        const { data } = await api.get("/homework-templates");
        const found = (data || []).find(t => t.id === templateId);
        if (found) setDraft({ ...emptyTemplate(), ...found, practice_coach: found.practice_coach || null });
      } catch (e) {
        toast.error(formatErr(e.response?.data?.detail) || "Couldn't load template");
      } finally { setLoading(false); }
    })();
  }, [templateId]);

  const pc = draft.practice_coach || emptyPracticeCoach();
  const updatePc = (patch) => setDraft(d => ({ ...d, practice_coach: { ...(d.practice_coach || emptyPracticeCoach()), ...patch } }));
  const enableCoachMode = (on) => setDraft(d => ({ ...d, practice_coach: on ? { ...(d.practice_coach || emptyPracticeCoach()), enabled: true } : { ...(d.practice_coach || emptyPracticeCoach()), enabled: false } }));

  const save = async () => {
    setSaving(true); setError("");
    try {
      const body = { ...draft };
      if (!body.sections || body.sections.length === 0) {
        // A brand-new template needs at least one section so Quick Practice /
        // simple-mode logging (POST /homework/{id}/section-log) always has a
        // valid section_id — the minimum needed to make the recipe usable,
        // not a general sections/fields builder (out of scope here).
        body.sections = [{ id: "practice", title: body.name || "Practice", instructions: "", fields: [] }];
      }
      let saved;
      if (templateId) {
        const { data } = await api.put(`/homework-templates/${templateId}`, body);
        saved = data;
      } else {
        const { data } = await api.post("/homework-templates", body);
        saved = data;
      }
      toast.success("Template saved");
      onSaved?.(saved);
    } catch (e) {
      setError(formatErr(e.response?.data?.detail) || "Couldn't save template");
    } finally { setSaving(false); }
  };

  // Sample tokens only — any dog/client name works here since Preview
  // renders purely from the draft's own practice_coach data, never from
  // this specific name (see coachModeEntryPoints.test.js's generality guard).
  const previewTokens = useMemo(() => ({ dog_name: "Your Dog", client_first_name: "There" }), []);
  const previewHomework = useMemo(() => ({
    id: "preview", dog_name: "Your Dog", client_name: "Preview Client", daily_tracker: false, status: "assigned",
    template_snapshot: { sections: draft.sections?.length ? draft.sections : [{ id: "practice", title: draft.name, instructions: "", fields: [] }], practice_coach: pc },
  }), [draft, pc]);

  if (loading) return <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center"><i className="fas fa-spinner fa-spin text-shText text-2xl"/></div>;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4" data-testid="homework-template-editor">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-4xl max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-4 sm:px-5 py-3.5 border-b border-shBorder flex items-center justify-between shrink-0">
          <h3 className="text-base font-black text-shText uppercase tracking-tight">{templateId ? "Edit Template" : "New Template"}</h3>
          <button onClick={onClose} data-testid="template-editor-close" className="text-shTextMuted hover:text-shText text-xl px-2"><i className="fas fa-times"/></button>
        </div>

        <div className="flex border-b border-shBorder shrink-0 px-2">
          {TABS.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} data-testid={`template-editor-tab-${t}`}
                    className={`px-3 py-2.5 text-[11px] font-black uppercase tracking-widest border-b-2 transition
                      ${activeTab === t ? "border-shPrimary text-shPrimary" : "border-transparent text-shTextMuted hover:text-shText"}`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-4 sm:px-5 py-4">
          {activeTab === "basics" && (
            <div className="space-y-3" data-testid="tab-basics">
              <Field label="Name"><input value={draft.name} onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))} className={inputCls} data-testid="tpl-name"/></Field>
              <Field label="Tier">
                <select value={draft.tier} onChange={(e) => setDraft(d => ({ ...d, tier: e.target.value }))} className={inputCls} data-testid="tpl-tier">
                  {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Description (legacy/Quick mode instructions)">
                <textarea value={draft.description} onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))} rows={3} className={inputCls} data-testid="tpl-description"/>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default duration (days)"><input type="number" value={draft.default_duration_days} onChange={(e) => setDraft(d => ({ ...d, default_duration_days: Number(e.target.value) }))} className={inputCls} data-testid="tpl-duration"/></Field>
                <Field label="Cover color"><input value={draft.cover_color} onChange={(e) => setDraft(d => ({ ...d, cover_color: e.target.value }))} className={inputCls} data-testid="tpl-color"/></Field>
              </div>
              <Field label="Icon (FontAwesome class)"><input value={draft.icon} onChange={(e) => setDraft(d => ({ ...d, icon: e.target.value }))} className={inputCls} data-testid="tpl-icon"/></Field>
              <Field label="Global rules this week">
                <StringListEditor items={draft.global_rules_this_week} onChange={(v) => setDraft(d => ({ ...d, global_rules_this_week: v }))} placeholder="Add rule" testid="tpl-rules"/>
              </Field>
            </div>
          )}

          {activeTab === "coach" && (
            <div className="space-y-4" data-testid="tab-coach">
              <label className="flex items-center gap-2 text-[13px] font-black text-shText cursor-pointer" data-testid="tpl-coach-enabled-toggle">
                <input type="checkbox" checked={!!pc.enabled} onChange={(e) => enableCoachMode(e.target.checked)}/>
                Coach Mode enabled
              </label>
              {pc.enabled && (
                <>
                  <label className="flex items-center gap-2 text-[12px] text-shTextMuted cursor-pointer" data-testid="tpl-quick-practice-toggle">
                    <input type="checkbox" checked={pc.allow_quick_practice !== false} onChange={(e) => updatePc({ allow_quick_practice: e.target.checked })}/>
                    Allow Quick Practice
                  </label>
                  <Field label="Today's Goal"><textarea value={pc.goal || ""} onChange={(e) => updatePc({ goal: e.target.value })} rows={2} className={inputCls} data-testid="tpl-goal" placeholder="Get {{dog_name}} to..."/></Field>
                  <Field label="Success Today"><textarea value={pc.success_today || ""} onChange={(e) => updatePc({ success_today: e.target.value })} rows={2} className={inputCls} data-testid="tpl-success"/></Field>
                  <Field label="Encouragement / short explanation"><textarea value={pc.encouragement || ""} onChange={(e) => updatePc({ encouragement: e.target.value })} rows={2} className={inputCls} data-testid="tpl-encouragement"/></Field>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {["minutes_per_round", "rounds_per_day", "reps_per_round", "rest_after_reps"].map(k => (
                      <Field key={k} label={k.replace(/_/g, " ")}>
                        <input type="number" value={pc.schedule?.[k] ?? ""} onChange={(e) => updatePc({ schedule: { ...pc.schedule, [k]: e.target.value === "" ? null : Number(e.target.value) } })}
                               className={inputCls} data-testid={`tpl-schedule-${k}`}/>
                      </Field>
                    ))}
                  </div>

                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">Setup checklist</p>
                    <ListEditor items={pc.setup_items} onChange={(v) => updatePc({ setup_items: v })} testid="tpl-setup-items"
                                addLabel="Add setup item"
                                newItem={() => ({ id: genId("setup"), icon_key: "home", title: "", description: "", required: false })}
                                renderItem={(it, update) => (
                                  <>
                                    <div className="grid grid-cols-2 gap-2">
                                      <select value={it.icon_key || "home"} onChange={(e) => update({ icon_key: e.target.value })} className={inputCls}>
                                        {PRACTICE_COACH_ICON_KEYS.map(k => <option key={k} value={k}>{k}</option>)}
                                      </select>
                                      <input value={it.title} onChange={(e) => update({ title: e.target.value })} placeholder="Title" className={inputCls}/>
                                    </div>
                                    <input value={it.description || ""} onChange={(e) => update({ description: e.target.value })} placeholder="Description" className={inputCls}/>
                                    <label className="flex items-center gap-2 text-[12px] text-shTextMuted"><input type="checkbox" checked={!!it.required} onChange={(e) => update({ required: e.target.checked })}/>Required</label>
                                  </>
                                )}/>
                  </div>

                  <Field label="Pro Tip"><input value={pc.pro_tip || ""} onChange={(e) => updatePc({ pro_tip: e.target.value })} className={inputCls} data-testid="tpl-pro-tip"/></Field>

                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">Guided steps</p>
                    <ListEditor items={pc.steps} onChange={(v) => updatePc({ steps: v })} testid="tpl-steps"
                                addLabel="Add step"
                                newItem={() => ({ id: genId("step"), title: "", instruction: "", media_url: null })}
                                renderItem={(it, update) => (
                                  <>
                                    <input value={it.title} onChange={(e) => update({ title: e.target.value })} placeholder="Step title" className={inputCls}/>
                                    <textarea value={it.instruction} onChange={(e) => update({ instruction: e.target.value })} rows={2} placeholder="Instruction" className={inputCls}/>
                                  </>
                                )}/>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[["good_rep", "Good Rep example"], ["not_this", "Not This example"]].map(([key, label]) => {
                      const ex = pc[key] || { sequence: [], explanation: "" };
                      return (
                        <div key={key}>
                          <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">{label}</p>
                          <StringListEditor items={ex.sequence} onChange={(v) => updatePc({ [key]: { ...ex, sequence: v } })} placeholder="Add sequence step" testid={`tpl-${key}-sequence`}/>
                          <textarea value={ex.explanation || ""} onChange={(e) => updatePc({ [key]: { ...ex, explanation: e.target.value } })} rows={2} placeholder="Explanation" className={`${inputCls} mt-1.5`}/>
                        </div>
                      );
                    })}
                  </div>

                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">When to Stop</p>
                    <ListEditor items={pc.stop_rules} onChange={(v) => updatePc({ stop_rules: v })} testid="tpl-stop-rules"
                                addLabel="Add stop rule"
                                newItem={() => ({ id: genId("stop"), condition: "", message: "" })}
                                renderItem={(it, update) => (
                                  <>
                                    <input value={it.condition} onChange={(e) => update({ condition: e.target.value })} placeholder="Condition (e.g. 3 misses in a row)" className={inputCls}/>
                                    <input value={it.message} onChange={(e) => update({ message: e.target.value })} placeholder="Message" className={inputCls}/>
                                  </>
                                )}/>
                  </div>

                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">Guided rep labels/messages</p>
                    <label className="flex items-center gap-2 text-[12px] text-shTextMuted cursor-pointer mb-1.5">
                      <input type="checkbox" checked={pc.guided_practice?.enabled !== false} onChange={(e) => updatePc({ guided_practice: { ...pc.guided_practice, enabled: e.target.checked } })}/>
                      Enable Guided Practice
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={pc.guided_practice?.ready_instruction || ""} onChange={(e) => updatePc({ guided_practice: { ...pc.guided_practice, ready_instruction: e.target.value } })} placeholder="Ready instruction" className={inputCls}/>
                      <input value={pc.guided_practice?.cue_prompt || ""} onChange={(e) => updatePc({ guided_practice: { ...pc.guided_practice, cue_prompt: e.target.value } })} placeholder="Cue prompt" className={inputCls}/>
                      <input value={pc.guided_practice?.success_button_label || ""} onChange={(e) => updatePc({ guided_practice: { ...pc.guided_practice, success_button_label: e.target.value } })} placeholder="Success button label" className={inputCls}/>
                      <input value={pc.guided_practice?.miss_button_label || ""} onChange={(e) => updatePc({ guided_practice: { ...pc.guided_practice, miss_button_label: e.target.value } })} placeholder="Miss button label" className={inputCls}/>
                      <input value={pc.guided_practice?.success_message || ""} onChange={(e) => updatePc({ guided_practice: { ...pc.guided_practice, success_message: e.target.value } })} placeholder="Success coaching message" className={inputCls}/>
                      <input value={pc.guided_practice?.miss_message || ""} onChange={(e) => updatePc({ guided_practice: { ...pc.guided_practice, miss_message: e.target.value } })} placeholder="Miss coaching message" className={inputCls}/>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">Difficulty feedback</p>
                    <div className="grid grid-cols-1 gap-2">
                      {["easy", "good", "okay", "hard", "very_hard"].map(k => (
                        <input key={k} value={pc.difficulty_feedback?.[k] || ""} onChange={(e) => updatePc({ difficulty_feedback: { ...pc.difficulty_feedback, [k]: e.target.value } })}
                               placeholder={`${k} feedback`} className={inputCls} data-testid={`tpl-difficulty-${k}`}/>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">End of practice questions</p>
                    <ListEditor items={pc.end_questions} onChange={(v) => updatePc({ end_questions: v })} testid="tpl-end-questions"
                                addLabel="Add question"
                                newItem={() => ({ id: genId("q"), type: "text", label: "", options: [], required: false })}
                                renderItem={(it, update) => (
                                  <>
                                    <div className="grid grid-cols-2 gap-2">
                                      <select value={it.type} onChange={(e) => update({ type: e.target.value })} className={inputCls}>
                                        <option value="text">Text</option>
                                        <option value="choice">Choice</option>
                                      </select>
                                      <input value={it.label} onChange={(e) => update({ label: e.target.value })} placeholder="Question label" className={inputCls}/>
                                    </div>
                                    {it.type === "choice" && (
                                      <StringListEditor items={it.options || []} onChange={(v) => update({ options: v })} placeholder="Add option"/>
                                    )}
                                  </>
                                )}/>
                  </div>

                  <ReadinessChecklist pc={pc} testid="tpl-readiness"/>
                </>
              )}
            </div>
          )}

          {activeTab === "troubleshooting" && (
            <div data-testid="tab-troubleshooting">
              {!pc.enabled ? (
                <p className="text-[12px] text-shTextMuted">Enable Coach Mode first to add troubleshooting.</p>
              ) : (
                <ListEditor items={pc.troubleshooting} onChange={(v) => updatePc({ troubleshooting: v })} testid="tpl-troubleshooting"
                            addLabel="Add troubleshooting item"
                            newItem={() => ({ id: genId("ts"), trigger: "", title: "", actions: [], stop_round: false })}
                            renderItem={(it, update) => (
                              <>
                                <input value={it.trigger} onChange={(e) => update({ trigger: e.target.value })} placeholder="Trigger (e.g. dog doesn't look)" className={inputCls}/>
                                <input value={it.title} onChange={(e) => update({ title: e.target.value })} placeholder="Short title" className={inputCls}/>
                                <StringListEditor items={it.actions} onChange={(v) => update({ actions: v })} placeholder="Add action"/>
                                <label className="flex items-center gap-2 text-[12px] text-shTextMuted"><input type="checkbox" checked={!!it.stop_round} onChange={(e) => update({ stop_round: e.target.checked })}/>Stop round</label>
                              </>
                            )}/>
              )}
            </div>
          )}

          {activeTab === "preview" && (
            <div data-testid="tab-preview">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                {["overview", "guided", "quick", "mobile"].map(m => (
                  <button key={m} onClick={() => setPreviewMode(m)} data-testid={`preview-mode-${m}`}
                          className={`px-2.5 py-1.5 rounded text-[11px] font-black uppercase tracking-widest border
                            ${previewMode === m ? "bg-shPrimary text-bgHeader border-shPrimary" : "bg-transparent text-shTextMuted border-shBorder"}`}>
                    {m}
                  </button>
                ))}
              </div>
              {!pc.enabled ? (
                <p className="text-[12px] text-shTextMuted">Enable Coach Mode to preview the guided client experience.</p>
              ) : (
                <div className={previewMode === "mobile" ? "max-w-[390px] mx-auto border border-shBorder rounded-xl p-3" : ""}>
                  {(previewMode === "overview" || previewMode === "mobile") && (
                    <CoachPracticeOverview practiceCoach={pc} tokens={previewTokens} testid="preview-overview"/>
                  )}
                  {previewMode === "guided" && (
                    <GuidedPracticeFlow practiceCoach={pc} tokens={previewTokens} onFinish={() => {}} testid="preview-guided"/>
                  )}
                  {previewMode === "quick" && (
                    <PracticeCompletionPanel
                      allowDifficulty allowCouldNotComplete allowPhoto allowVideo={false}
                      extraSlot={(pc.end_questions || []).length > 0 ? <CoachEndQuestions questions={pc.end_questions} answers={{}} onAnswerChange={() => {}} tokens={previewTokens}/> : null}
                      difficultyFeedbackSlot={pc.difficulty_feedback ? <DifficultyFeedbackNotice difficulty="good" feedback={pc.difficulty_feedback} tokens={previewTokens}/> : null}
                      note="" onNoteChange={() => {}} onSubmit={() => {}} saveState="idle" testid="preview-quick"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 border-t border-shBorder flex items-center justify-between shrink-0">
          {error ? <p className="text-shDanger text-[12px] font-bold">{error}</p> : <span/>}
          <div className="flex gap-2">
            <button onClick={onClose} className="text-shTextMuted px-3 py-2 text-[12px] font-black uppercase tracking-widest">Cancel</button>
            <button onClick={save} disabled={saving} data-testid="template-editor-save"
                    className="bg-shPrimary text-bgHeader px-5 py-2.5 rounded font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
              {saving ? "Saving…" : "Save Template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
