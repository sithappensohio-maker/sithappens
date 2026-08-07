import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import CsvImportButton from "./CsvImportButton";
import { parseProgramCsv, PROGRAM_CSV_SAMPLE } from "../lib/csvImport";
import ShopImageUpload from "./ShopImageUpload";
import ShopCategoryFields from "./ShopCategoryFields";
import ExpandableSection from "./training/ExpandableSection";
import CurriculumTree from "./training/CurriculumTree";
import ContentCompleteness from "./training/ContentCompleteness";
import ProgramPreviewPanel from "./training/ProgramPreviewPanel";
import PublishReadinessPanel from "./training/PublishReadinessPanel";
import { computeLessonCompleteness, computeSkillCompleteness, resolveValidationTarget } from "../lib/programStudioPolish";
import HomeworkTemplateEditor from "./HomeworkTemplateEditor";

/* ============================================================
 * Training-school expansion, Phase 2 — Program Studio.
 *
 * Replaces the flat single-form ProgramEditor for CATALOG program editing
 * only (Programs.jsx's ProgramsPanel). ProgramEditor itself is untouched
 * and keeps serving the custom-one-off-program flow (DogTrainingTab.jsx)
 * and the Shop Manager quick-add flow — those don't need draft/publish or
 * a curriculum outline, so reusing the richer Studio there would be scope
 * creep, not a simplification.
 *
 * Layout: Setup / Curriculum / Preview / Validation tabs. Curriculum is an
 * outline (modules -> lessons -> skills) + a focused editor for whatever
 * node is selected, instead of one giant form. Save Draft / Publish map to
 * the backend's draft/publish endpoints; a direct "Save Live" escape hatch
 * preserves today's exact behavior (immediate apply + optional cascade
 * prompt) for anyone who doesn't want the draft workflow.
 * ============================================================ */

const uid = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`);

const emptySkill = () => ({ _key: uid(), name: "New skill", description: "" });
const emptyLesson = () => ({ _key: uid(), name: "New lesson", order: 0, active: true, skill_ids: [] });
const emptyModule = () => ({ _key: uid(), name: "New module", description: "", goals: [], lessons: [], homework_template_id: null });

function withKeys(program) {
  // Local-only `_key` (never sent to the server) so React lists stay stable
  // across reorders even before anything has a real server-stamped id.
  return {
    ...program,
    modules: (program.modules || []).map(m => ({
      ...m, _key: m.id || uid(),
      goals: (m.goals || []).map(g => ({ ...g, _key: g.id || uid() })),
      lessons: (m.lessons || []).map(l => ({ ...l, _key: l.id || uid() })),
    })),
  };
}

function stripKeys(program) {
  const strip = (o) => { const { _key, ...rest } = o; return rest; };
  return {
    ...program,
    modules: (program.modules || []).map(m => ({
      ...strip(m),
      goals: (m.goals || []).map(strip),
      lessons: (m.lessons || []).map(strip),
    })),
  };
}

// UI Phase 5 — Preview and Validation are no longer separate top-level
// tabs; they're now the right-hand column's own tabs inside Curriculum
// (see ProgramPreviewPanel), always visible alongside whatever is
// selected in the outline — Setup stays separate from curriculum
// authoring per the brief.
const TABS = [
  { key: "setup", label: "Setup", icon: "fa-sliders" },
  { key: "curriculum", label: "Curriculum", icon: "fa-diagram-project" },
];

const MOBILE_STAGES = [
  { key: "outline", label: "Outline", icon: "fa-list" },
  { key: "edit", label: "Edit", icon: "fa-pen" },
  { key: "preview", label: "Preview", icon: "fa-eye" },
  { key: "validate", label: "Validate", icon: "fa-clipboard-check" },
];

export default function ProgramStudio({ programId, initialProgram, meta, allPrograms = [], onClose, onSaved }) {
  const confirm = useConfirm();
  const isNew = !programId;
  const [tab, setTab] = useState("setup");
  const [program, setProgram] = useState(() => withKeys(initialProgram));
  const [originalImageId] = useState(initialProgram.image_id || null);
  const [draftMeta, setDraftMeta] = useState(initialProgram.draft ? { saved_at: initialProgram.draft.saved_at } : null);
  const [selected, setSelected] = useState(null); // { moduleKey, lessonKey?, skillKey? }
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [hwTemplates, setHwTemplates] = useState([]);
  const [emailTemplates, setEmailTemplates] = useState([]);
  // UI Phase 5 — pre-publish impact, fetched proactively whenever a draft
  // exists so PublishReadinessPanel can show it prominently BEFORE the
  // trainer decides Publish vs. Publish & Cascade, instead of only
  // revealing it inside a confirm() dialog after the click.
  const [impact, setImpact] = useState(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [previewTab, setPreviewTab] = useState("client");
  const [mobileStage, setMobileStage] = useState("outline");

  // Client Practice Coach upgrade — exposed so ModuleEditor's "Edit
  // Template" affordance can refresh the picker list after saving through
  // HomeworkTemplateEditor, without Program Studio owning any template-
  // content editing itself.
  const reloadHwTemplates = () => {
    api.get("/homework-templates").then(r => setHwTemplates(r.data || [])).catch(() => setHwTemplates([]));
  };

  useEffect(() => {
    reloadHwTemplates();
    api.get("/admin/email-templates").then(r => setEmailTemplates((r.data || []).filter(t => t.audience === "client"))).catch(() => setEmailTemplates([]));
  }, []);

  useEffect(() => {
    if (isNew || !draftMeta) { setImpact(null); return; }
    setLoadingImpact(true);
    api.get(`/programs/${programId}/publish-impact`)
      .then(({ data }) => { setImpact(data); setValidation(data.validation); })
      .catch(() => setImpact(null))
      .finally(() => setLoadingImpact(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftMeta, programId]);

  const set = (patch) => setProgram(p => ({ ...p, ...patch }));
  const modules = program.modules || [];
  const moduleByKey = (k) => modules.find(m => m._key === k);

  // ---- curriculum mutation helpers -----------------------------------
  const updateModule = (key, patch) => set({ modules: modules.map(m => m._key === key ? { ...m, ...patch } : m) });
  const addModule = () => {
    const m = { ...emptyModule(), order: modules.length };
    set({ modules: [...modules, m] });
    setSelected({ moduleKey: m._key });
  };
  const duplicateModule = (key) => {
    const src = moduleByKey(key);
    if (!src) return;
    const clone = { ...src, id: undefined, _key: uid(), name: `${src.name} (Copy)`, order: modules.length,
      goals: (src.goals || []).map(g => ({ ...g, id: undefined, _key: uid() })),
      lessons: (src.lessons || []).map(l => ({ ...l, id: undefined, _key: uid() })) };
    set({ modules: [...modules, clone] });
  };
  const removeModule = async (key) => {
    const m = moduleByKey(key);
    const skillCount = (m?.goals || []).length;
    if (!(await confirm({
      title: "Remove this module?",
      body: skillCount > 0
        ? `This removes ${skillCount} skill${skillCount === 1 ? "" : "s"} and any lessons in it. Any dog with existing progress on those skills keeps that history in their session log, but the impact preview at Publish time will show exactly how many active enrollments this touches.`
        : "This module has no skills yet.",
      confirmText: "Remove module", tone: "warning",
    }))) return;
    set({ modules: modules.filter(m => m._key !== key) });
    if (selected?.moduleKey === key) setSelected(null);
  };
  const moveModule = (key, dir) => {
    const i = modules.findIndex(m => m._key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= modules.length) return;
    const next = [...modules];
    [next[i], next[j]] = [next[j], next[i]];
    set({ modules: next.map((m, idx) => ({ ...m, order: idx })) });
  };

  const addSkill = (moduleKey) => {
    const m = moduleByKey(moduleKey);
    const g = { ...emptySkill(), order: (m.goals || []).length };
    updateModule(moduleKey, { goals: [...(m.goals || []), g] });
    setSelected({ moduleKey, skillKey: g._key });
  };
  const updateSkill = (moduleKey, skillKey, patch) => {
    const m = moduleByKey(moduleKey);
    updateModule(moduleKey, { goals: (m.goals || []).map(g => g._key === skillKey ? { ...g, ...patch } : g) });
  };
  const removeSkill = (moduleKey, skillKey) => {
    const m = moduleByKey(moduleKey);
    updateModule(moduleKey, {
      goals: (m.goals || []).filter(g => g._key !== skillKey),
      lessons: (m.lessons || []).map(l => ({ ...l, skill_ids: (l.skill_ids || []).filter(sid => sid !== skillKey && sid !== (m.goals.find(g=>g._key===skillKey)||{}).id) })),
    });
    if (selected?.skillKey === skillKey) setSelected({ moduleKey });
  };
  const moveSkill = (moduleKey, skillKey, dir) => {
    const m = moduleByKey(moduleKey);
    const goals = m.goals || [];
    const i = goals.findIndex(g => g._key === skillKey);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= goals.length) return;
    const next = [...goals];
    [next[i], next[j]] = [next[j], next[i]];
    updateModule(moduleKey, { goals: next.map((g, idx) => ({ ...g, order: idx })) });
  };

  const addLesson = (moduleKey) => {
    const m = moduleByKey(moduleKey);
    const l = { ...emptyLesson(), order: (m.lessons || []).length };
    updateModule(moduleKey, { lessons: [...(m.lessons || []), l] });
    setSelected({ moduleKey, lessonKey: l._key });
  };
  const updateLesson = (moduleKey, lessonKey, patch) => {
    const m = moduleByKey(moduleKey);
    updateModule(moduleKey, { lessons: (m.lessons || []).map(l => l._key === lessonKey ? { ...l, ...patch } : l) });
  };
  const removeLesson = (moduleKey, lessonKey) => {
    const m = moduleByKey(moduleKey);
    updateModule(moduleKey, { lessons: (m.lessons || []).filter(l => l._key !== lessonKey) });
    if (selected?.lessonKey === lessonKey) setSelected({ moduleKey });
  };
  const moveLesson = (moduleKey, lessonKey, dir) => {
    const m = moduleByKey(moduleKey);
    const lessons = m.lessons || [];
    const i = lessons.findIndex(l => l._key === lessonKey);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= lessons.length) return;
    const next = [...lessons];
    [next[i], next[j]] = [next[j], next[i]];
    updateModule(moduleKey, { lessons: next.map((l, idx) => ({ ...l, order: idx })) });
  };
  const duplicateLessonInto = (srcModuleKey, lessonKey, targetModuleKey) => {
    const src = moduleByKey(srcModuleKey);
    const lesson = (src.lessons || []).find(l => l._key === lessonKey);
    if (!lesson) return;
    const target = moduleByKey(targetModuleKey);
    const clone = { ...lesson, id: undefined, _key: uid(), name: `${lesson.name} (Copy)`, order: (target.lessons || []).length, skill_ids: [] };
    updateModule(targetModuleKey, { lessons: [...(target.lessons || []), clone] });
  };

  const copyFromProgram = (sourceProgramId) => {
    const src = allPrograms.find(p => p.id === sourceProgramId);
    if (!src) return;
    const withFreshIds = withKeys(src).modules.map(m => ({
      ...m, id: undefined, _key: uid(), order: modules.length,
      goals: (m.goals || []).map(g => ({ ...g, id: undefined, _key: uid() })),
      lessons: (m.lessons || []).map(l => ({ ...l, id: undefined, _key: uid(), skill_ids: [] })),
    }));
    set({ modules: [...modules, ...withFreshIds.map((m, i) => ({ ...m, order: modules.length + i }))] });
  };

  // ---- save / draft / publish -----------------------------------------
  const buildPayload = () => stripKeys(program);

  const saveLive = async () => {
    setErr(""); setSaving(true);
    try {
      const payload = buildPayload();
      if (!isNew) {
        let cascade = false;
        try {
          const { data } = await api.get(`/programs/${programId}/active-enrollments-count`);
          if ((data?.count || 0) > 0) {
            cascade = await confirm({
              title: `Apply changes to ${data.count} enrolled dog${data.count > 1 ? "s" : ""}?`,
              body: "Yes: every active enrollment updates to the new curriculum immediately. Trainer scores and notes for skills that still exist are preserved; progress on removed skills is dropped.\n\nNo: only future enrollments use the new version.",
              confirmText: "Yes, update enrolled dogs", cancelText: "No, only future enrollments", tone: "warning",
            });
          }
        } catch { /* count lookup failure isn't fatal — just skip cascade prompt */ }
        const { data } = await api.put(`/programs/${programId}${cascade ? "?cascade=true" : ""}`, payload);
        if (originalImageId && originalImageId !== payload.image_id) api.delete(`/shop/media/${originalImageId}`).catch(() => {});
        onSaved(data);
      } else {
        const { data } = await api.post("/programs", payload);
        onSaved(data);
      }
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    finally { setSaving(false); }
  };

  const saveDraft = async () => {
    if (isNew) { setErr("Create the program first, then you can save drafts of further edits."); return; }
    setErr(""); setSaving(true);
    try {
      const { data } = await api.put(`/programs/${programId}?save_as_draft=true`, buildPayload());
      setDraftMeta({ saved_at: data.draft?.saved_at });
      setValidation(null);
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Draft save failed"); }
    finally { setSaving(false); }
  };

  const discardDraft = async () => {
    if (!(await confirm({ title: "Discard this draft?", body: "Your saved draft edits will be deleted. The live, published version is unaffected.", confirmText: "Discard draft", tone: "danger" }))) return;
    try {
      await api.delete(`/programs/${programId}/draft`);
      setDraftMeta(null);
      const { data } = await api.get(`/programs`);
      const fresh = data.find(p => p.id === programId);
      if (fresh) setProgram(withKeys(fresh));
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Could not discard draft"); }
  };

  // UI Phase 5 — cascade is now decided by which of the two explicit
  // PublishReadinessPanel buttons was clicked ("Publish" vs "Publish &
  // Update N Active Enrollments"), never a confirm() dialog buried behind
  // a single ambiguous Publish button. The impact/validation data those
  // two buttons are labeled from is already loaded (see the effect above),
  // so this function is a straight POST — no re-fetch, no dialog.
  const publish = async (cascade) => {
    if (!draftMeta) { setErr("Save a draft first, then publish it."); return; }
    if (validation && !validation.valid) {
      setErr("This draft has structural errors that must be fixed before it can be published — see the Validation checklist.");
      return;
    }
    setErr(""); setSaving(true);
    try {
      const { data } = await api.post(`/programs/${programId}/publish${cascade ? "?cascade=true" : ""}`);
      setDraftMeta(null);
      setImpact(null);
      onSaved(data);
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail?.errors) setValidation({ valid: false, errors: detail.errors, warnings: [] });
      setErr(formatErr(detail?.message || detail) || "Publish failed");
    } finally { setSaving(false); }
  };

  const runValidation = async () => {
    setValidating(true); setErr("");
    try {
      if (!isNew && draftMeta) {
        const { data } = await api.get(`/programs/${programId}/validate`, { params: { target: "draft" } });
        setValidation(data);
      } else if (!isNew) {
        // No unsaved-as-draft changes to check against the server yet — save
        // a draft first so validation reflects what's actually on screen.
        await api.put(`/programs/${programId}?save_as_draft=true`, buildPayload());
        setDraftMeta({ saved_at: new Date().toISOString() });
        const { data } = await api.get(`/programs/${programId}/validate`, { params: { target: "draft" } });
        setValidation(data);
      } else {
        setErr("Create the program first, then Studio can check it for problems.");
      }
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Validation check failed"); }
    finally { setValidating(false); }
  };

  const handleCancel = () => {
    // Drop any not-yet-saved photo upload from this session (mirrors the
    // old ProgramEditor's cleanup — but must live here now, since only the
    // Studio's own live state knows the current in-progress image_id).
    if (program.image_id && program.image_id !== originalImageId) {
      api.delete(`/shop/media/${program.image_id}`).catch(() => {});
    }
    onClose();
  };

  const selectedModule = selected ? moduleByKey(selected.moduleKey) : null;
  const selectedLesson = selectedModule && selected.lessonKey ? (selectedModule.lessons || []).find(l => l._key === selected.lessonKey) : null;
  const selectedSkill = selectedModule && selected.skillKey ? (selectedModule.goals || []).find(g => g._key === selected.skillKey) : null;

  // Clicking a validation issue navigates straight to the affected item —
  // same setSelected the outline tree already uses, so it opens exactly
  // the editor a manual click would.
  const handleValidationNavigate = (target) => {
    setSelected(target);
    setTab("curriculum");
    setMobileStage("edit");
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-2 sm:p-4 z-50" data-testid="program-studio">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-6xl max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-4 sm:px-6 py-3 border-b border-shBorder flex items-center justify-between shrink-0 gap-2">
          <div className="min-w-0">
            <h4 className="text-base font-black text-shText uppercase italic truncate">{isNew ? "New Program" : program.name || "Edit Program"}</h4>
            {draftMeta && <p className="text-[11px] text-shAccent font-black uppercase tracking-widest">Editing draft · unpublished</p>}
          </div>
          <button onClick={handleCancel} className="text-shTextMuted hover:text-shText shrink-0"><i className="fas fa-times text-xl"/></button>
        </div>

        <div className="flex border-b border-shBorder shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} data-testid={`studio-tab-${t.key}`}
                    className={`px-4 py-2.5 text-[13px] font-black uppercase tracking-widest whitespace-nowrap border-b-2 ${tab === t.key ? "border-shPrimary text-shPrimary" : "border-transparent text-shTextMuted hover:text-shText"}`}>
              <i className={`fas ${t.icon} mr-1.5`}/>{t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "setup" && (
            <SetupTab program={program} set={set} meta={meta} allPrograms={allPrograms} hwTemplates={hwTemplates}
                      emailTemplates={emailTemplates} originalImageId={originalImageId} programId={programId} />
          )}
          {tab === "curriculum" && (
            <CurriculumTab
              modules={modules} selected={selected} setSelected={setSelected}
              addModule={addModule} duplicateModule={duplicateModule} removeModule={removeModule} moveModule={moveModule} updateModule={updateModule}
              addSkill={addSkill} updateSkill={updateSkill} removeSkill={removeSkill} moveSkill={moveSkill}
              addLesson={addLesson} updateLesson={updateLesson} removeLesson={removeLesson} moveLesson={moveLesson} duplicateLessonInto={duplicateLessonInto}
              selectedModule={selectedModule} selectedLesson={selectedLesson} selectedSkill={selectedSkill}
              hwTemplates={hwTemplates} reloadHwTemplates={reloadHwTemplates} allPrograms={allPrograms.filter(p => p.id !== programId)} copyFromProgram={copyFromProgram}
              set={set} program={program}
              validation={validation} validating={validating} onRunValidation={runValidation} onValidationNavigate={handleValidationNavigate}
              previewTab={previewTab} setPreviewTab={setPreviewTab}
              mobileStage={mobileStage} setMobileStage={setMobileStage}
              isNew={isNew} draftMeta={draftMeta} impact={impact} loadingImpact={loadingImpact} onPublish={publish} saving={saving}
            />
          )}
        </div>

        <div className="px-4 sm:px-6 py-3 border-t border-shBorder flex flex-wrap justify-between items-center gap-3 shrink-0">
          {err ? <p className="text-red-400 text-[13px] font-bold flex-1 min-w-[200px]" data-testid="studio-err">{err}</p> : <span className="flex-1"/>}
          <div className="flex flex-wrap gap-2 shrink-0">
            <button onClick={handleCancel} className="text-shTextMuted hover:text-shText font-black uppercase text-[13px] tracking-widest px-2">Cancel</button>
            {!isNew && draftMeta && (
              <button onClick={discardDraft} className="bg-red-500/15 text-red-400 border border-red-500/40 px-3 py-2 rounded font-black text-[13px] uppercase tracking-widest">
                Discard Draft
              </button>
            )}
            {!isNew && (
              <button onClick={saveDraft} disabled={saving} data-testid="studio-save-draft"
                      className="bg-shSecondary/15 text-shSecondary border border-shSecondary/40 px-3 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shSecondary/25 disabled:opacity-50">
                <i className="fas fa-floppy-disk mr-1.5"/>Save Draft
              </button>
            )}
            {/* Publish now lives in the Curriculum tab's right column
                (PublishReadinessPanel), next to the impact preview it
                needs — kept out of this bar so Publish vs. Publish &
                Cascade are never squeezed into one ambiguous button here. */}
            <button onClick={saveLive} disabled={saving} data-testid="studio-save-live"
                    className={`px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50 ${(!isNew && draftMeta) ? "bg-transparent border border-shBorder text-shTextMuted" : "bg-shPrimary text-bgHeader"}`}>
              {isNew ? "Create Program" : "Save Live Now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Setup */
// UI Phase 5 — regrouped into named subsections (Program Identity /
// Training Format & Scheduling / Client Shop & Pricing / Public Storefront /
// Enrollment & Completion / Welcome Communication) via ExpandableSection,
// kept fully separate from curriculum authoring per the brief. Every
// field/value below is identical to before — this only reorganizes the
// single flat form into focused, collapsible groups.
function SetupTab({ program, set, meta, allPrograms, hwTemplates, emailTemplates, originalImageId, programId }) {
  return (
    <div className="px-4 sm:px-6 py-4 space-y-3">
      <ExpandableSection title="Program Identity" icon="fa-tag" defaultOpen testid="setup-section-identity">
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SField label="Name *"><input value={program.name} onChange={(e) => set({ name: e.target.value })} data-testid="prog-name" className={inputCls} /></SField>
            <SField label="Type">
              <select value={program.type} onChange={(e) => set({ type: e.target.value })} className={inputCls}>
                {meta.types.filter(t => t.key !== "custom").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </SField>
          </div>
          <SField label="Description (internal purpose)"><textarea value={program.description || ""} onChange={(e) => set({ description: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Focus (client-facing overview)"><input value={program.focus || ""} onChange={(e) => set({ focus: e.target.value })} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Delivery Mode" icon="fa-route" testid="setup-section-delivery">
        <div className="space-y-2">
          <p className="text-[12px] text-shTextMuted">How this curriculum reaches clients — the same modules/lessons/skills either way, never duplicated content.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { k: "trainer_led", label: "Trainer-Led", icon: "fa-user-tie" },
              { k: "self_guided", label: "Self-Guided (Online School)", icon: "fa-graduation-cap" },
              { k: "both", label: "Both", icon: "fa-arrows-split-up-and-left" },
            ].map(dm => (
              <button key={dm.k} type="button" onClick={() => set({ delivery_mode: dm.k })} data-testid={`prog-delivery-mode-${dm.k}`}
                      className={`py-2 rounded text-[12px] font-black uppercase tracking-widest border ${(program.delivery_mode || "trainer_led") === dm.k ? "bg-shPrimary text-bgHeader border-shPrimary" : "bg-transparent border-shBorder text-shTextMuted"}`}>
                <i className={`fas ${dm.icon} mr-1`}/>{dm.label}
              </button>
            ))}
          </div>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Training Format & Scheduling" icon="fa-calendar-days" testid="setup-section-format">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SField label="Sessions / credits issued">
            <input type="number" min="1" value={program.format?.count || 1} onChange={(e) => set({ format: { ...program.format, count: parseInt(e.target.value) || 1 } })} data-testid="prog-format-count" className={inputCls}/>
          </SField>
          <SField label="Unit">
            <select value={program.format?.unit || "sessions"} onChange={(e) => set({ format: { ...program.format, unit: e.target.value } })} className={inputCls}>
              <option value="sessions">Sessions</option><option value="weeks">Weeks</option><option value="days">Days</option><option value="months">Months</option>
            </select>
          </SField>
          <SField label="Min age (months)"><input type="number" min="0" value={program.min_age_months || 0} onChange={(e) => set({ min_age_months: parseInt(e.target.value) || 0 })} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Client Shop & Pricing" icon="fa-dollar-sign" testid="setup-section-pricing">
        <div className="space-y-3">
          <SField label="Price (USD)">
            <input type="number" min="0" step="0.01" value={program.price ?? 0} onChange={(e) => set({ price: parseFloat(e.target.value) || 0 })} data-testid="prog-price" className={inputCls}/>
          </SField>
          <div className="border-t border-shBorder pt-3 space-y-3">
            <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Shop Category</p>
            <ShopCategoryFields categoryId={program.category_id} subcategoryId={program.subcategory_id} section="training" onChange={(patch) => set(patch)} />
          </div>
          <div className="border-t border-shBorder pt-3 space-y-3">
            <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-black">Client Shop</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!program.available_online} onChange={(e) => set({ available_online: e.target.checked })} data-testid="prog-available-online"/>
              <span className="text-shText text-sm">Available Online (client Shop)</span>
            </label>
            {program.available_online && (
              <div className="space-y-3">
                <SField label="Online Description (optional)"><input value={program.online_description || ""} onChange={(e) => set({ online_description: e.target.value })} className={inputCls}/></SField>
                <SField label="Program Photo"><ShopImageUpload imageId={program.image_id} originalImageId={originalImageId} onChange={(id) => set({ image_id: id })}/></SField>
              </div>
            )}
          </div>
        </div>
      </ExpandableSection>

      {program.available_online && (
        <ExpandableSection title="Public Storefront" icon="fa-globe" testid="setup-section-storefront">
          <div className="space-y-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!program.publicly_visible} onChange={(e) => set({ publicly_visible: e.target.checked })} data-testid="prog-publicly-visible"/>
              <span className="text-shText text-sm">Publicly Visible (always requires sign-in to buy)</span>
            </label>
            {program.publicly_visible && (
              <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={program.show_public_price !== false} onChange={(e) => set({ show_public_price: e.target.checked })}/>
                  <span className="text-shText text-sm">Show Price to Guests</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!program.requires_dog} onChange={(e) => set({ requires_dog: e.target.checked })}/>
                  <span className="text-shText text-sm">Requires Selecting a Dog</span>
                </label>
                {program.requires_dog && <p className="text-[12px] text-shAccent">Until dog-selection support is built, this blocks online checkout — customers are directed to contact staff.</p>}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!program.requires_approval} onChange={(e) => set({ requires_approval: e.target.checked })}/>
                  <span className="text-shText text-sm">Requires Approval</span>
                </label>
                {program.requires_approval && <p className="text-[12px] text-shAccent">Until approval-workflow support is built, this blocks online checkout — customers are directed to contact staff.</p>}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!program.requires_completed_onboarding} onChange={(e) => set({ requires_completed_onboarding: e.target.checked })}/>
                  <span className="text-shText text-sm">Requires Completed Account Setup</span>
                </label>
              </>
            )}
          </div>
        </ExpandableSection>
      )}

      <ExpandableSection title="Enrollment & Completion" icon="fa-flag-checkered" testid="setup-section-enrollment">
        <div className="space-y-3">
          {allPrograms.length > 0 && (
            <SField label="Prerequisites (any of these)">
              <select multiple value={program.prereq_slugs || []} onChange={(e) => set({ prereq_slugs: Array.from(e.target.selectedOptions, o => o.value) })} className={`${inputCls} h-24`}>
                {allPrograms.filter(p => p.slug && p.id !== programId).map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
              </select>
            </SField>
          )}
          <div className="bg-black/20 border border-shBorder rounded p-3">
            <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary mb-2">Completion Rule</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { k: "percent", label: "% mastered", icon: "fa-percent" },
                { k: "all_mastered", label: "All skills", icon: "fa-list-check" },
                { k: "manual", label: "Manual sign-off", icon: "fa-hand-pointer" },
                { k: "sessions", label: "Session count", icon: "fa-calendar-check" },
              ].map(rt => (
                <button key={rt.k} type="button" onClick={() => set({ completion_rule: { ...(program.completion_rule || {}), type: rt.k } })}
                        className={`py-2 rounded text-[13px] font-black uppercase tracking-widest border ${(program.completion_rule?.type || "percent") === rt.k ? "bg-shSecondary text-bgHeader border-shSecondary" : "bg-transparent border-shBorder text-shTextMuted"}`}>
                  <i className={`fas ${rt.icon} mr-1`}/>{rt.label}
                </button>
              ))}
            </div>
            {((program.completion_rule?.type || "percent") === "percent" || program.completion_rule?.type === "sessions") && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[13px] font-black text-shTextMuted uppercase tracking-widest">{program.completion_rule?.type === "sessions" ? "Required sessions" : "Threshold %"}:</label>
                <input type="number" min="1" max="100" value={program.completion_rule?.threshold ?? (program.completion_rule?.type === "sessions" ? 5 : 80)}
                       onChange={(e) => set({ completion_rule: { ...(program.completion_rule || { type: "percent" }), threshold: parseInt(e.target.value) || 0 } })}
                       className="w-24 bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm"/>
              </div>
            )}
          </div>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Welcome Communication" icon="fa-envelope-open-text" testid="setup-section-welcome">
        <div className="space-y-3">
          <SField label="Welcome homework (auto-sent on enrollment)">
            <select value={program.welcome_homework_template_id || ""} onChange={(e) => set({ welcome_homework_template_id: e.target.value || null })} className={inputCls}>
              <option value="">— None —</option>
              {hwTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.tier ? ` · ${t.tier}` : ""}</option>)}
            </select>
          </SField>
          <SField label="Welcome email (auto-sent when program is sold)">
            <select value={program.welcome_email_template_slug || ""} onChange={(e) => set({ welcome_email_template_slug: e.target.value || null })} className={inputCls}>
              <option value="">— None (default sale email) —</option>
              {emailTemplates.map(t => <option key={t.slug} value={t.slug}>{t.name}{t.kind === "custom" ? " · Custom" : ""}</option>)}
            </select>
          </SField>
        </div>
      </ExpandableSection>
    </div>
  );
}

/* ------------------------------------------------------------ Curriculum */
// UI Phase 5 — true 3-column layout: outline tree / focused editor / live
// preview+readiness. On mobile the 3 columns become 4 stage-tabs (Outline/
// Edit/Preview/Validate) instead of forcing horizontal scrolling — every
// column below is always in the DOM, just hidden/shown per breakpoint and
// mobileStage, so state (scroll position, unsaved edits) never resets when
// switching stages.
function CurriculumTab(props) {
  const {
    modules, selected, setSelected, addModule, allPrograms, copyFromProgram,
    selectedModule, selectedLesson, selectedSkill,
    validation, validating, onRunValidation, onValidationNavigate,
    previewTab, setPreviewTab, mobileStage, setMobileStage,
    isNew, draftMeta, impact, loadingImpact, onPublish, saving,
  } = props;
  const [copySource, setCopySource] = useState("");

  return (
    <div className="flex flex-col min-h-full">
      <div className="md:hidden flex border-b border-shBorder shrink-0 overflow-x-auto" data-testid="studio-mobile-stages">
        {MOBILE_STAGES.map(s => (
          <button key={s.key} onClick={() => setMobileStage(s.key)} data-testid={`studio-mobile-stage-${s.key}`}
                  className={`flex-1 px-2 py-2 text-[11px] font-black uppercase tracking-widest whitespace-nowrap border-b-2 ${mobileStage === s.key ? "border-shSecondary text-shSecondary" : "border-transparent text-shTextMuted"}`}>
            <i className={`fas ${s.icon} mr-1`}/>{s.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <div className={`${mobileStage === "outline" ? "block" : "hidden"} md:block md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-shBorder p-3 space-y-2 overflow-y-auto`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Outline</p>
            <div className="flex gap-1">
              <CsvImportButton label="CSV" parse={parseProgramCsv} sampleText={PROGRAM_CSV_SAMPLE} sampleFilename="program-template.csv"
                                testIdPrefix="studio-csv" helpText="Columns: module_name, module_description, goal_name, goal_description."
                                onImport={(parsed) => { if (parsed?.modules?.length) props.set({ modules: [...modules, ...parsed.modules] }); }}/>
              <button onClick={addModule} data-testid="studio-add-module" className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-2 py-1 rounded text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-plus mr-1"/>Module
              </button>
            </div>
          </div>
          {allPrograms.length > 0 && (
            <div className="flex gap-1">
              <select value={copySource} onChange={(e) => setCopySource(e.target.value)} className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-1 text-[11px] text-shText">
                <option value="">Copy modules from…</option>
                {allPrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button disabled={!copySource} onClick={() => { copyFromProgram(copySource); setCopySource(""); }}
                      className="bg-shSecondary/15 text-shSecondary border border-shSecondary/40 px-2 rounded text-[11px] font-black uppercase disabled:opacity-40">Copy</button>
            </div>
          )}
          {modules.length === 0 && <p className="text-[13px] text-shTextMuted italic py-3">No modules yet.</p>}
          <CurriculumTree
            modules={modules} selected={selected}
            setSelected={(sel) => { setSelected(sel); setMobileStage("edit"); }}
            moveModule={props.moveModule} duplicateModule={props.duplicateModule} removeModule={props.removeModule}
            addSkill={props.addSkill} addLesson={props.addLesson} moveSkill={props.moveSkill} moveLesson={props.moveLesson}
            removeSkill={props.removeSkill} removeLesson={props.removeLesson}
            testid="studio-outline"
          />
        </div>

        <div className={`${mobileStage === "edit" ? "block" : "hidden"} md:block flex-1 min-w-0 p-4 overflow-y-auto`}>
          {!selected && <p className="text-[14px] text-shTextMuted italic">Select a module, lesson, or skill from the outline to edit it.</p>}
          {selected && selectedModule && !selected.lessonKey && !selected.skillKey && (
            <ModuleEditor module={selectedModule} {...props} />
          )}
          {selected && selectedLesson && (
            <LessonEditor module={selectedModule} lesson={selectedLesson} {...props} />
          )}
          {selected && selectedSkill && (
            <SkillEditor module={selectedModule} skill={selectedSkill} {...props} />
          )}
        </div>

        <div className={`${mobileStage === "preview" || mobileStage === "validate" ? "block" : "hidden"} md:block md:w-96 shrink-0 border-t md:border-t-0 md:border-l border-shBorder flex flex-col`}>
          <div className="p-3 border-b border-shBorder">
            <PublishReadinessPanel isNew={isNew} draftMeta={draftMeta} validation={validation} impact={impact}
                                    loadingImpact={loadingImpact} onPublish={onPublish} saving={saving} testid="studio-publish-readiness"/>
          </div>
          <ProgramPreviewPanel
            modules={modules} selectedModule={selectedModule} selectedLesson={selectedLesson} selectedSkill={selectedSkill}
            validation={validation} onValidationNavigate={onValidationNavigate} onValidationRefresh={onRunValidation} validating={validating}
            tab={mobileStage === "validate" ? "validation" : previewTab}
            onTabChange={(t) => { setPreviewTab(t); if (t === "validation") setMobileStage("validate"); else if (mobileStage === "validate") setMobileStage("preview"); }}
            testid="studio-preview"
          />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- Module editor */
function ModuleEditor({ module: m, updateModule, hwTemplates, reloadHwTemplates }) {
  // Client Practice Coach upgrade — an edit affordance next to the
  // existing template select, opening the SAME HomeworkTemplateEditor the
  // admin Homework screen uses (never a second/duplicate template editor).
  // Program Studio never edits template content itself — it stays a
  // consumer of the template list, exactly as before.
  const [editingTemplate, setEditingTemplate] = useState(false);
  return (
    <div className="space-y-3 max-w-xl">
      <p className="text-[11px] font-black uppercase tracking-widest text-shPrimary">Module</p>
      <SField label="Name"><input value={m.name} onChange={(e) => updateModule(m._key, { name: e.target.value })} className={inputCls}/></SField>
      <SField label="Description"><textarea value={m.description || ""} onChange={(e) => updateModule(m._key, { description: e.target.value })} rows={2} className={inputCls}/></SField>
      <SField label="Homework for this module (auto-sent when the dog begins it)">
        <div className="flex gap-2">
          <select value={m.homework_template_id || ""} onChange={(e) => updateModule(m._key, { homework_template_id: e.target.value || null })} className={inputCls}>
            <option value="">— None —</option>
            {hwTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.tier ? ` · ${t.tier}` : ""}</option>)}
          </select>
          <button type="button" onClick={() => setEditingTemplate(true)} data-testid="module-edit-homework-template"
                  className="shrink-0 bg-black/20 border border-shBorder text-shTextMuted hover:text-shPrimary rounded px-3">
            <i className="fas fa-pen"/>
          </button>
        </div>
      </SField>
      <p className="text-[12px] text-shTextMuted">{(m.goals || []).length} skill(s) · {(m.lessons || []).length} lesson(s)</p>
      {editingTemplate && (
        <HomeworkTemplateEditor
          templateId={m.homework_template_id || null}
          onClose={() => setEditingTemplate(false)}
          onSaved={(saved) => {
            setEditingTemplate(false);
            reloadHwTemplates?.();
            if (!m.homework_template_id && saved?.id) updateModule(m._key, { homework_template_id: saved.id });
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------- Lesson editor */
// UI Phase 5 — fields regrouped into the brief's focused sections (Basics /
// Client experience / Trainer directions / Success criteria / Media and
// resources / Homework links / Prerequisites and advancement), each an
// ExpandableSection so only what the trainer is working on is expanded —
// never all fields shown flat at once, never nested accordions. Every
// field/value is unchanged from before — this is a re-layout, not a new
// data model.
function LessonEditor({ module: m, lesson: l, updateLesson, hwTemplates }) {
  const set = (patch) => updateLesson(m._key, l._key, patch);
  const skillOptions = m.goals || [];
  const completeness = computeLessonCompleteness(l);
  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">Lesson</p>
        <label className="flex items-center gap-2 text-[12px] text-shText"><input type="checkbox" checked={l.active !== false} onChange={(e) => set({ active: e.target.checked })}/>Active (uncheck to keep as draft)</label>
      </div>

      <ContentCompleteness items={completeness} testid="lesson-completeness"/>

      <ExpandableSection title="Basics" icon="fa-circle-info" defaultOpen testid="lesson-section-basics">
        <div className="space-y-3">
          <SField label="Name"><input value={l.name} onChange={(e) => set({ name: e.target.value })} className={inputCls}/></SField>
          <SField label="Estimated minutes"><input type="number" min="0" value={l.estimated_minutes ?? ""} onChange={(e) => set({ estimated_minutes: e.target.value ? parseInt(e.target.value) : null })} className={`${inputCls} max-w-[160px]`}/></SField>
          <SField label="Skills covered in this lesson">
            <div className="flex flex-wrap gap-1.5">
              {skillOptions.length === 0 && <p className="text-[12px] text-shTextMuted italic">Add skills to this module first.</p>}
              {skillOptions.map(g => {
                const on = (l.skill_ids || []).includes(g.id || g._key);
                return (
                  <button key={g._key} type="button" onClick={() => {
                    const key = g.id || g._key;
                    set({ skill_ids: on ? (l.skill_ids || []).filter(x => x !== key) : [...(l.skill_ids || []), key] });
                  }} className={`px-2 py-1 rounded text-[11px] font-bold border ${on ? "bg-shAccent/20 border-shAccent text-shAccent" : "bg-transparent border-shBorder text-shTextMuted"}`}>
                    {g.name}
                  </button>
                );
              })}
            </div>
          </SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Client Experience" icon="fa-user" testid="lesson-section-client">
        <div className="space-y-3">
          <SField label="Client-facing overview"><textarea value={l.client_overview || ""} onChange={(e) => set({ client_overview: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Why this lesson matters"><textarea value={l.why_it_matters || ""} onChange={(e) => set({ why_it_matters: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Client-facing instructions"><textarea value={l.client_instructions || ""} onChange={(e) => set({ client_instructions: e.target.value })} rows={3} className={inputCls}/></SField>
          <SField label="Common mistakes"><textarea value={l.common_mistakes || ""} onChange={(e) => set({ common_mistakes: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Troubleshooting"><textarea value={l.troubleshooting || ""} onChange={(e) => set({ troubleshooting: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Safety notes"><textarea value={l.safety_notes || ""} onChange={(e) => set({ safety_notes: e.target.value })} rows={2} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Trainer Directions" icon="fa-clipboard-user" tone="accent" testid="lesson-section-trainer">
        <div className="space-y-3">
          <SField label="Internal trainer purpose"><textarea value={l.trainer_purpose || ""} onChange={(e) => set({ trainer_purpose: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Trainer prep notes"><textarea value={l.trainer_prep_notes || ""} onChange={(e) => set({ trainer_prep_notes: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Step-by-step trainer instructions"><textarea value={l.trainer_instructions || ""} onChange={(e) => set({ trainer_instructions: e.target.value })} rows={4} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Success Criteria" icon="fa-flag-checkered" testid="lesson-section-success">
        <SField label="Success criteria"><textarea value={l.success_criteria || ""} onChange={(e) => set({ success_criteria: e.target.value })} rows={2} className={inputCls}/></SField>
      </ExpandableSection>

      <ExpandableSection title="Media and Resources" icon="fa-photo-film" testid="lesson-section-media">
        <div className="space-y-3">
          <SField label="Demo video URL"><input value={l.demo_video_url || ""} onChange={(e) => set({ demo_video_url: e.target.value })} className={inputCls}/></SField>
          <SField label="Equipment needed"><input value={l.equipment_needed || ""} onChange={(e) => set({ equipment_needed: e.target.value })} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Homework Links" icon="fa-graduation-cap" testid="lesson-section-homework">
        <div className="space-y-2">
          <select value={""} onChange={(e) => { if (e.target.value) set({ suggested_homework_template_ids: [...new Set([...(l.suggested_homework_template_ids || []), e.target.value])] }); }} className={inputCls}>
            <option value="">+ Add template…</option>
            {hwTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {(l.suggested_homework_template_ids || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(l.suggested_homework_template_ids || []).map(tid => {
                const t = hwTemplates.find(h => h.id === tid);
                return <span key={tid} className="px-2 py-1 rounded text-[11px] bg-shSecondary/15 text-shSecondary border border-shSecondary/40">
                  {t?.name || tid} <button onClick={() => set({ suggested_homework_template_ids: (l.suggested_homework_template_ids || []).filter(x => x !== tid) })} className="ml-1"><i className="fas fa-times"/></button>
                </span>;
              })}
            </div>
          )}
        </div>
      </ExpandableSection>

      <ExpandableSection title="Prerequisites and Advancement" icon="fa-stairs" testid="lesson-section-advancement">
        <SField label="Advancement criteria"><textarea value={l.advancement_criteria || ""} onChange={(e) => set({ advancement_criteria: e.target.value })} rows={2} className={inputCls}/></SField>
      </ExpandableSection>
    </div>
  );
}

/* --------------------------------------------------------- Skill editor */
function SkillEditor({ module: m, skill: g, updateSkill }) {
  const set = (patch) => updateSkill(m._key, g._key, patch);
  const completeness = computeSkillCompleteness(g);
  return (
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-black uppercase tracking-widest text-shAccent">Skill</p>
        <label className="flex items-center gap-2 text-[12px] text-pink-300" title="Check-off (Done/Reset) instead of a 0-5 score">
          <input type="checkbox" checked={!!g.manual_only} onChange={(e) => set({ manual_only: e.target.checked })}/>Manual (checkbox, not scored)
        </label>
      </div>

      <ContentCompleteness items={completeness} testid="skill-completeness"/>

      <ExpandableSection title="Basics" icon="fa-circle-info" defaultOpen testid="skill-section-basics">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SField label="Name"><input value={g.name} onChange={(e) => set({ name: e.target.value })} className={inputCls}/></SField>
          <SField label="Description"><input value={g.description || ""} onChange={(e) => set({ description: e.target.value })} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Client Experience" icon="fa-user" testid="skill-section-client">
        <SField label="Client-facing explanation"><textarea value={g.client_facing_explanation || ""} onChange={(e) => set({ client_facing_explanation: e.target.value })} rows={2} className={inputCls}/></SField>
      </ExpandableSection>

      <ExpandableSection title="Trainer Directions" icon="fa-clipboard-user" tone="accent" testid="skill-section-trainer">
        <div className="space-y-3">
          <SField label="Training objective"><input value={g.training_objective || ""} onChange={(e) => set({ training_objective: e.target.value })} className={inputCls}/></SField>
          <SField label="Starting criteria"><input value={g.starting_criteria || ""} onChange={(e) => set({ starting_criteria: e.target.value })} className={inputCls}/></SField>
          <SField label="Trainer-only guidance"><textarea value={g.trainer_only_guidance || ""} onChange={(e) => set({ trainer_only_guidance: e.target.value })} rows={2} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Success Criteria" icon="fa-flag-checkered" testid="skill-section-success">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SField label="Pass criteria"><textarea value={g.pass_criteria || ""} onChange={(e) => set({ pass_criteria: e.target.value })} rows={2} className={inputCls}/></SField>
          <SField label="Reset / failure criteria"><textarea value={g.reset_criteria || ""} onChange={(e) => set({ reset_criteria: e.target.value })} rows={2} className={inputCls}/></SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Measurements" icon="fa-ruler" testid="skill-section-measurements">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <SField label="Target duration"><input value={g.target_duration || ""} onChange={(e) => set({ target_duration: e.target.value })} placeholder="e.g. 30s" className={inputCls}/></SField>
          <SField label="Target distance"><input value={g.target_distance || ""} onChange={(e) => set({ target_distance: e.target.value })} placeholder="e.g. 15ft" className={inputCls}/></SField>
          <SField label="Target repetitions"><input value={g.target_repetitions || ""} onChange={(e) => set({ target_repetitions: e.target.value })} placeholder="e.g. 5x" className={inputCls}/></SField>
          <SField label="Distraction level"><input value={g.target_distraction_level || ""} onChange={(e) => set({ target_distraction_level: e.target.value })} className={inputCls}/></SField>
          <SField label="Environment"><input value={g.target_environment || ""} onChange={(e) => set({ target_environment: e.target.value })} className={inputCls}/></SField>
          <SField label="Handler assistance"><input value={g.handler_assistance || ""} onChange={(e) => set({ handler_assistance: e.target.value })} className={inputCls}/></SField>
        </div>
        <div className="mt-3">
          <SField label="Leash requirement">
            <select value={g.leash_requirement || ""} onChange={(e) => set({ leash_requirement: e.target.value || null })} className={inputCls}>
              <option value="">— Not specified —</option><option value="on_leash">On leash</option><option value="off_leash">Off leash</option><option value="either">Either</option>
            </select>
          </SField>
        </div>
      </ExpandableSection>

      <ExpandableSection title="Homework Links" icon="fa-graduation-cap" testid="skill-section-homework">
        <SField label="Homework template IDs (comma-separated)">
          <input value={(g.homework_template_ids || []).join(", ")}
                 onChange={(e) => set({ homework_template_ids: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                 className={inputCls}/>
        </SField>
      </ExpandableSection>

      <ExpandableSection title="Prerequisites and Advancement" icon="fa-stairs" testid="skill-section-advancement">
        <div className="space-y-3">
          <SField label="Prerequisite skill IDs (comma-separated)">
            <input value={(g.prerequisite_skill_ids || []).join(", ")}
                   onChange={(e) => set({ prerequisite_skill_ids: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                   className={inputCls}/>
          </SField>
          <SField label="Suggested next skill ID">
            <input value={g.suggested_next_skill_id || ""} onChange={(e) => set({ suggested_next_skill_id: e.target.value || null })} className={inputCls}/>
          </SField>
        </div>
      </ExpandableSection>
    </div>
  );
}

const inputCls = "w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm";
function SField({ label, children }) {
  return <div><label className="text-[11px] font-black text-shTextMuted uppercase tracking-widest">{label}</label><div className="mt-1">{children}</div></div>;
}
