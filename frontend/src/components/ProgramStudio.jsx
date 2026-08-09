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
import HuskyDogImage from "./brand/HuskyDogImage";

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
const emptyLesson = () => ({ _key: uid(), name: "New lesson", order: 0, active: true, skill_ids: [], content_blocks: [] });
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
  const [schoolTrainers, setSchoolTrainers] = useState([]);
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
    api.get("/admin/school/trainers").then(r => setSchoolTrainers(r.data || [])).catch(() => setSchoolTrainers([]));
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
    <div className="fixed inset-0 bg-black/[0.92] backdrop-blur-md flex items-stretch sm:items-center justify-center p-0 sm:p-3 z-50" data-testid="program-studio">
      <div className="relative overflow-hidden bg-[var(--sh-card-base)] sm:border border-shBorder/80 rounded-none sm:rounded-[24px] w-full max-w-[1580px] h-[var(--app-height)] sm:h-auto sm:max-h-[calc(var(--app-height)_-_0.75rem)] flex flex-col min-h-0 shadow-[0_30px_100px_rgba(0,0,0,0.78)]">
        <div className="absolute inset-x-0 top-0 h-28 pointer-events-none bg-[radial-gradient(circle_at_18%_0%,rgba(140,198,63,0.12),transparent_45%),radial-gradient(circle_at_76%_0%,rgba(0,169,224,0.09),transparent_40%)]"/>
        <div className="relative px-3 sm:px-6 py-3 sm:py-4 border-b border-shBorder/70 flex items-center justify-between shrink-0 gap-3 bg-black/25">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl border border-shPrimary/25 bg-black/30 overflow-hidden shrink-0 shadow-[0_0_24px_rgba(140,198,63,0.10)]">
              <HuskyDogImage name={program.name || "Sit Happens"} className="w-full h-full object-cover"/>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-shPrimary">Sit Happens · Course Builder</p>
              <h4 className="sh-display text-lg sm:text-2xl text-shText truncate mt-0.5">{isNew ? "New Program" : program.name || "Edit Program"}</h4>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="hidden sm:inline text-[10px] text-shTextMuted">Build the curriculum, client experience, and storefront from one place.</span>
                {draftMeta && <span className="rounded-full px-2 py-0.5 bg-shAccent/10 border border-shAccent/25 text-[9px] font-black uppercase tracking-[0.13em] text-shAccent">Draft · unpublished</span>}
              </div>
            </div>
          </div>
          <button onClick={handleCancel} className="w-10 h-10 rounded-xl border border-shBorder/70 bg-white/[0.025] text-shTextMuted hover:text-shText hover:border-shTextMuted/50 transition shrink-0"><i className="fas fa-times"/></button>
        </div>

        <div className="relative px-3 sm:px-6 py-2 border-b border-shBorder/60 shrink-0 overflow-x-auto bg-black/10">
          <div className="inline-flex rounded-xl border border-shBorder/60 bg-black/30 p-1 gap-1 min-w-max">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} data-testid={`studio-tab-${t.key}`}
                      className={`px-4 py-2 text-[11px] font-black whitespace-nowrap rounded-lg transition ${tab === t.key ? "bg-shPrimary text-[#071018] shadow-[0_0_20px_rgba(140,198,63,0.12)]" : "text-shTextMuted hover:text-shText hover:bg-white/[0.04]"}`}>
                <i className={`fas ${t.icon} mr-1.5`}/>{t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "setup" && (
            <SetupTab program={program} set={set} meta={meta} allPrograms={allPrograms} hwTemplates={hwTemplates}
                      emailTemplates={emailTemplates} originalImageId={originalImageId} programId={programId}
                      schoolTrainers={schoolTrainers} />
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

        <div className="relative px-3 sm:px-6 py-2.5 sm:py-3 border-t border-shBorder/70 bg-black/30 flex flex-col-reverse sm:flex-row sm:flex-wrap justify-between items-stretch sm:items-center gap-2 sm:gap-3 shrink-0">
          {err ? <p className="text-red-400 text-[12px] font-bold flex-1 min-w-[200px] rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2" data-testid="studio-err">{err}</p> : <span className="flex-1"/>}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 shrink-0">
            <button onClick={handleCancel} className="text-shTextMuted hover:text-shText font-bold text-[12px] px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition min-h-[44px]">Cancel</button>
            {!isNew && draftMeta && (
              <button onClick={discardDraft} className="bg-red-500/[0.08] text-red-400 border border-red-500/25 px-3 py-2 rounded-lg font-black text-[11px] uppercase tracking-[0.1em] hover:bg-red-500/[0.13] transition">
                Discard Draft
              </button>
            )}
            {!isNew && (
              <button onClick={saveDraft} disabled={saving} data-testid="studio-save-draft"
                      className="bg-shSecondary/[0.08] text-shSecondary border border-shSecondary/25 px-3 py-2.5 rounded-lg font-black text-[11px] tracking-[0.06em] hover:bg-shSecondary/[0.13] disabled:opacity-50 transition min-h-[44px]">
                <i className="fas fa-floppy-disk mr-1.5"/>Save Draft
              </button>
            )}
            {/* Publish now lives in the Curriculum tab's right column
                (PublishReadinessPanel), next to the impact preview it
                needs — kept out of this bar so Publish vs. Publish &
                Cascade are never squeezed into one ambiguous button here. */}
            <button onClick={saveLive} disabled={saving} data-testid="studio-save-live"
                    className={`px-4 py-2.5 rounded-lg font-black text-[11px] tracking-[0.06em] shadow disabled:opacity-50 transition min-h-[44px] ${(!isNew && draftMeta) ? "bg-transparent border border-shBorder text-shTextMuted hover:bg-white/[0.03]" : "bg-shPrimary text-[#071018] hover:brightness-110 shadow-[0_0_22px_rgba(140,198,63,0.12)]"}`}>
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
function SetupTab({ program, set, meta, allPrograms, hwTemplates, emailTemplates, originalImageId, programId, schoolTrainers = [] }) {
  const moduleCount = (program.modules || []).length;
  const lessonCount = (program.modules || []).reduce((sum, m) => sum + (m.lessons || []).length, 0);
  const skillCount = (program.modules || []).reduce((sum, m) => sum + (m.goals || []).length, 0);
  const deliveryLabel = {
    trainer_led: "Trainer-Led",
    self_guided: "Online School",
    both: "Trainer + Online",
  }[program.delivery_mode || "trainer_led"];

  return (
    <div className="px-3 sm:px-6 py-4 sm:py-5">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 max-w-[1380px] mx-auto">
        <div className="space-y-3 min-w-0">
          <div className="rounded-2xl border border-shPrimary/20 bg-[radial-gradient(circle_at_0%_0%,rgba(140,198,63,0.08),transparent_42%),rgba(0,0,0,0.15)] p-4 sm:p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shPrimary">Course setup</p>
            <h5 className="text-lg sm:text-xl font-black text-shText mt-1">Start with what the client is buying.</h5>
            <p className="text-[12px] sm:text-[13px] text-shTextMuted mt-1 max-w-2xl">Identity, delivery, pricing, access, and completion rules live here. Curriculum authoring stays in its own workbench so you are not hunting through one giant form.</p>
          </div>

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
            <div className="space-y-3">
              <p className="text-[12px] text-shTextMuted">How this curriculum reaches clients — the same modules, lessons, and skills either way.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  { k: "trainer_led", label: "Trainer-Led", icon: "fa-user-tie", note: "Staff guides the program" },
                  { k: "self_guided", label: "Online School", icon: "fa-graduation-cap", note: "Client follows the school" },
                  { k: "both", label: "Both", icon: "fa-arrows-split-up-and-left", note: "One curriculum, two paths" },
                ].map(dm => {
                  const active = (program.delivery_mode || "trainer_led") === dm.k;
                  return (
                    <button key={dm.k} type="button" onClick={() => set({ delivery_mode: dm.k })} data-testid={`prog-delivery-mode-${dm.k}`}
                            className={`min-h-[74px] rounded-xl border p-3 text-left transition ${active ? "bg-shPrimary/[0.10] border-shPrimary/60 shadow-[0_0_20px_rgba(140,198,63,0.08)]" : "bg-black/10 border-shBorder/70 hover:border-shTextMuted/40"}`}>
                      <span className={`w-8 h-8 rounded-lg grid place-items-center mb-2 ${active ? "bg-shPrimary text-[#071018]" : "bg-white/[0.03] text-shTextMuted border border-shBorder/60"}`}><i className={`fas ${dm.icon} text-[11px]`}/></span>
                      <span className={`block text-[12px] font-black ${active ? "text-shPrimary" : "text-shText"}`}>{dm.label}</span>
                      <span className="block text-[10px] text-shTextMuted mt-0.5">{dm.note}</span>
                    </button>
                  );
                })}
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
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                <SField label="Price (USD)">
                  <input type="number" min="0" step="0.01" value={program.price ?? 0} onChange={(e) => set({ price: parseFloat(e.target.value) || 0 })} data-testid="prog-price" className={inputCls}/>
                </SField>
                <div className="rounded-xl border border-shBorder/60 bg-black/10 px-3 py-2.5 min-h-[44px] flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-bold text-shTextMuted">Client Shop</p><p className="text-[12px] font-black text-shText">{program.available_online ? "Visible as a sellable item" : "Not available online"}</p></div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input type="checkbox" checked={!!program.available_online} onChange={(e) => set({ available_online: e.target.checked })} data-testid="prog-available-online" className="sr-only peer"/>
                    <span className="w-11 h-6 rounded-full bg-white/10 border border-shBorder peer-checked:bg-shPrimary/30 peer-checked:border-shPrimary/60 transition"/>
                    <span className="absolute left-1 w-4 h-4 rounded-full bg-shTextMuted peer-checked:bg-shPrimary peer-checked:translate-x-5 transition"/>
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3 space-y-3">
                <p className="text-[11px] text-shTextMuted font-black">Shop category</p>
                <ShopCategoryFields categoryId={program.category_id} subcategoryId={program.subcategory_id} section="training" onChange={(patch) => set(patch)} />
              </div>

              {program.available_online && (
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_260px] gap-3 items-start">
                  <SField label="Online Description (optional)"><textarea value={program.online_description || ""} onChange={(e) => set({ online_description: e.target.value })} rows={3} className={inputCls}/></SField>
                  <SField label="Program Photo"><ShopImageUpload imageId={program.image_id} originalImageId={originalImageId} onChange={(id) => set({ image_id: id })}/></SField>
                </div>
              )}

              {(() => {
                const canOnlineSchool = ["self_guided", "both"].includes(program.delivery_mode || "trainer_led");
                return (
                  <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3 space-y-3">
                    <div>
                      <p className="text-[11px] text-shText font-black">What does a purchase grant?</p>
                      <p className="text-[11px] text-shTextMuted mt-0.5">Delivery capability and purchase fulfillment stay separate on purpose.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button type="button" onClick={() => set({ purchase_fulfillment: "credits_only" })} data-testid="prog-fulfillment-credits_only"
                              className={`min-h-[52px] rounded-xl text-[12px] font-black border transition ${(program.purchase_fulfillment || "credits_only") === "credits_only" ? "bg-shPrimary/[0.10] text-shPrimary border-shPrimary/50" : "bg-black/10 border-shBorder text-shTextMuted hover:text-shText"}`}>
                        <i className="fas fa-coins mr-1.5"/>Training Credits
                      </button>
                      <button type="button" disabled={!canOnlineSchool} onClick={() => canOnlineSchool && set({ purchase_fulfillment: "online_school" })} data-testid="prog-fulfillment-online_school"
                              title={canOnlineSchool ? "" : "Set Delivery Mode to Self-Guided or Both first"}
                              className={`min-h-[52px] rounded-xl text-[12px] font-black border transition ${!canOnlineSchool ? "opacity-40 cursor-not-allowed bg-black/10 border-shBorder text-shTextMuted" : program.purchase_fulfillment === "online_school" ? "bg-shSecondary/[0.10] text-shSecondary border-shSecondary/50" : "bg-black/10 border-shBorder text-shTextMuted hover:text-shText"}`}>
                        <i className="fas fa-graduation-cap mr-1.5"/>Online School Access
                      </button>
                    </div>
                    {program.purchase_fulfillment === "online_school" && (
                      <p className="text-[11px] text-shAccent"><i className="fas fa-circle-info mr-1"/>Buying this program enrolls the selected dog directly into Online School — no training credits are involved.</p>
                    )}
                  </div>
                );
              })()}
            </div>
          </ExpandableSection>

          {program.available_online && (
            <ExpandableSection title="Public Storefront" icon="fa-globe" testid="setup-section-storefront">
              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-shBorder/50 bg-black/10 p-3">
                  <span><span className="block text-[12px] font-black text-shText">Publicly Visible</span><span className="block text-[10px] text-shTextMuted">Guests can see it; buying still requires sign-in.</span></span>
                  <input type="checkbox" checked={!!program.publicly_visible} onChange={(e) => set({ publicly_visible: e.target.checked })} data-testid="prog-publicly-visible" className="w-5 h-5"/>
                </label>
                {program.publicly_visible && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <label className="rounded-xl border border-shBorder/50 bg-black/10 p-3 flex items-start gap-2"><input className="mt-0.5" type="checkbox" checked={program.show_public_price !== false} onChange={(e) => set({ show_public_price: e.target.checked })}/><span className="text-[11px] text-shText">Show Price to Guests</span></label>
                    <label className="rounded-xl border border-shBorder/50 bg-black/10 p-3 flex items-start gap-2"><input className="mt-0.5" type="checkbox" checked={!!program.requires_dog} onChange={(e) => set({ requires_dog: e.target.checked })}/><span className="text-[11px] text-shText">Requires Selecting a Dog</span></label>
                    <label className="rounded-xl border border-shBorder/50 bg-black/10 p-3 flex items-start gap-2"><input className="mt-0.5" type="checkbox" checked={!!program.requires_approval} onChange={(e) => set({ requires_approval: e.target.checked })}/><span className="text-[11px] text-shText">Requires Approval</span></label>
                    <label className="rounded-xl border border-shBorder/50 bg-black/10 p-3 flex items-start gap-2"><input className="mt-0.5" type="checkbox" checked={!!program.requires_completed_onboarding} onChange={(e) => set({ requires_completed_onboarding: e.target.checked })}/><span className="text-[11px] text-shText">Requires Completed Account Setup</span></label>
                  </div>
                )}
                {program.publicly_visible && program.requires_dog && <p className="text-[11px] text-shAccent">Dog selection is required before checkout for dog-specific programs.</p>}
                {program.publicly_visible && program.requires_approval && <p className="text-[11px] text-shAccent">Approval requirements can block online checkout until the requirement is satisfied.</p>}
              </div>
            </ExpandableSection>
          )}

          <ExpandableSection title="Enrollment & Completion" icon="fa-flag-checkered" testid="setup-section-enrollment">
            <div className="space-y-4">
              {allPrograms.length > 0 && (
                <SField label="Required prerequisites (complete all selected)">
                  <select multiple value={program.prereq_slugs || []} onChange={(e) => set({ prereq_slugs: Array.from(e.target.selectedOptions, o => o.value) })} className={`${inputCls} h-28`}>
                    {allPrograms.filter(p => p.slug && p.id !== programId).map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
                  </select>
                </SField>
              )}
              <div className="rounded-xl border border-shSecondary/20 bg-shSecondary/[0.035] p-3 sm:p-4">
                <p className="text-[11px] font-black text-shSecondary mb-2">Completion rule</p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {[
                    { k: "percent", label: "% mastered", icon: "fa-percent" },
                    { k: "all_mastered", label: "All skills", icon: "fa-list-check" },
                    { k: "manual", label: "Manual sign-off", icon: "fa-hand-pointer" },
                    { k: "sessions", label: "Session count", icon: "fa-calendar-check" },
                  ].map(rt => {
                    const active = (program.completion_rule?.type || "percent") === rt.k;
                    return (
                      <button key={rt.k} type="button" onClick={() => set({ completion_rule: { ...(program.completion_rule || {}), type: rt.k } })}
                              className={`min-h-[50px] rounded-xl text-[11px] font-black border transition ${active ? "bg-shSecondary text-[#031018] border-shSecondary" : "bg-black/10 border-shBorder text-shTextMuted hover:text-shText"}`}>
                        <i className={`fas ${rt.icon} mr-1`}/>{rt.label}
                      </button>
                    );
                  })}
                </div>
                {((program.completion_rule?.type || "percent") === "percent" || program.completion_rule?.type === "sessions") && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-bold text-shTextMuted">{program.completion_rule?.type === "sessions" ? "Required sessions" : "Threshold %"}</label>
                    <input type="number" min="1" max="100" value={program.completion_rule?.threshold ?? (program.completion_rule?.type === "sessions" ? 5 : 80)}
                           onChange={(e) => set({ completion_rule: { ...(program.completion_rule || { type: "percent" }), threshold: parseInt(e.target.value) || 0 } })}
                           className="w-28 min-h-[42px] bg-black/25 border border-shBorder rounded-xl px-3 text-shText text-sm focus:outline-none focus:border-shSecondary/60"/>
                  </div>
                )}
              </div>
            </div>
          </ExpandableSection>

          {(["self_guided", "both"].includes(program.delivery_mode || "trainer_led")) && (
            <ExpandableSection title="Online School Experience" icon="fa-school" tone="accent" testid="setup-section-school-experience">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <SField label="Expected course length (weeks)"><input type="number" min="1" max="104" value={program.estimated_weeks ?? ""} onChange={(e) => set({ estimated_weeks: e.target.value ? parseInt(e.target.value) : null })} className={inputCls}/></SField>
                  <SField label="Default School trainer"><select value={program.school_default_trainer_id || ""} onChange={(e) => set({ school_default_trainer_id: e.target.value || null })} className={inputCls}><option value="">Unassigned / Sit Happens team</option>{schoolTrainers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></SField>
                  <SField label="Trainer checkpoints included"><input type="number" min="0" value={program.school_support?.trainer_checkpoints_included ?? ""} onChange={(e) => set({ school_support: { ...(program.school_support || {}), trainer_checkpoints_included: e.target.value === "" ? null : parseInt(e.target.value) } })} className={inputCls}/></SField>
                  <SField label="Trainer Assists included"><input type="number" min="0" value={program.school_support?.trainer_assists_included ?? ""} onChange={(e) => set({ school_support: { ...(program.school_support || {}), trainer_assists_included: e.target.value === "" ? null : parseInt(e.target.value) } })} className={inputCls}/></SField>
                </div>
                <SField label="Target trainer response time (hours — informational)"><input type="number" min="1" max="168" value={program.school_support?.response_target_hours ?? ""} onChange={(e) => set({ school_support: { ...(program.school_support || {}), response_target_hours: e.target.value === "" ? null : parseInt(e.target.value) } })} className={`${inputCls} max-w-[180px]`}/></SField>
                <div className="rounded-xl border border-shBorder/50 bg-black/10 p-3">
                  <p className="text-[11px] font-black text-shText mb-2">Enrollment onboarding</p>
                  <div className="grid sm:grid-cols-3 gap-2">
                    <label className="flex items-center gap-2 text-[11px] text-shText"><input type="checkbox" checked={program.school_onboarding?.enabled !== false} onChange={(e) => set({ school_onboarding: { ...(program.school_onboarding || {}), enabled: e.target.checked } })}/>Guided onboarding</label>
                    <label className="flex items-center gap-2 text-[11px] text-shText"><input type="checkbox" checked={!!program.school_onboarding?.require_baseline} onChange={(e) => set({ school_onboarding: { ...(program.school_onboarding || {}), require_baseline: e.target.checked } })}/>Require baseline</label>
                    <label className="flex items-center gap-2 text-[11px] text-shText"><input type="checkbox" checked={!!program.school_onboarding?.require_equipment_check} onChange={(e) => set({ school_onboarding: { ...(program.school_onboarding || {}), require_equipment_check: e.target.checked } })}/>Equipment check</label>
                  </div>
                </div>
                {allPrograms.length > 0 && <SField label="Recommended next programs">
                  <select multiple value={program.recommended_next_program_slugs || []} onChange={(e) => set({ recommended_next_program_slugs: Array.from(e.target.selectedOptions, o => o.value) })} className={`${inputCls} h-28`}>
                    {allPrograms.filter(p => p.slug && p.id !== programId).map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
                  </select>
                </SField>}
              </div>
            </ExpandableSection>
          )}

          <ExpandableSection title="Welcome Communication" icon="fa-envelope-open-text" testid="setup-section-welcome">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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

        <aside className="xl:sticky xl:top-4 self-start rounded-2xl border border-shBorder/60 bg-black/20 overflow-hidden">
          <div className="relative h-40 bg-black/30 overflow-hidden">
            <HuskyDogImage name={program.name || "Sit Happens"} className="w-full h-full object-cover opacity-75"/>
            <div className="absolute inset-0 bg-gradient-to-t from-[#07080d] via-black/30 to-transparent"/>
            <div className="absolute left-4 right-4 bottom-3">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-shPrimary">Course at a glance</p>
              <h6 className="text-lg font-black text-white truncate">{program.name || "Untitled Program"}</h6>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[{ v: moduleCount, l: "Modules" }, { v: lessonCount, l: "Lessons" }, { v: skillCount, l: "Skills" }].map(item => (
                <div key={item.l} className="rounded-xl border border-shBorder/50 bg-black/20 px-2 py-3 text-center">
                  <p className="text-lg font-black text-shText">{item.v}</p><p className="text-[9px] text-shTextMuted">{item.l}</p>
                </div>
              ))}
            </div>
            <div className="space-y-2 text-[11px]">
              <SetupSummaryRow label="Delivery" value={deliveryLabel}/>
              <SetupSummaryRow label="Price" value={`$${Number(program.price || 0).toFixed(2)}`}/>
              <SetupSummaryRow label="Shop" value={program.available_online ? "Available online" : "Staff / manual only"}/>
              <SetupSummaryRow label="Purchase grants" value={program.purchase_fulfillment === "online_school" ? "Online School access" : "Training credits"}/>
            </div>
            <div className="rounded-xl border border-shPrimary/20 bg-shPrimary/[0.04] p-3">
              <p className="text-[10px] font-black text-shPrimary">Next best move</p>
              <p className="text-[11px] text-shTextMuted mt-1">Finish the setup, then switch to Curriculum to build the exact client journey lesson by lesson.</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SetupSummaryRow({ label, value }) {
  return <div className="flex items-start justify-between gap-3"><span className="text-shTextMuted">{label}</span><span className="font-black text-shText text-right">{value}</span></div>;
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
  const lessonCount = modules.reduce((sum, m) => sum + (m.lessons || []).length, 0);
  const skillCount = modules.reduce((sum, m) => sum + (m.goals || []).length, 0);
  const selectedType = selectedLesson ? "Lesson" : selectedSkill ? "Skill" : selectedModule ? "Module" : "Nothing selected";
  const selectedName = selectedLesson?.name || selectedSkill?.name || selectedModule?.name || "Choose something from the outline";

  return (
    <div className="flex flex-col min-h-full bg-[radial-gradient(circle_at_40%_0%,rgba(0,169,224,0.035),transparent_32%),transparent]">
      <div className="md:hidden sticky top-0 z-20 px-2 py-2 border-b border-shBorder/70 bg-[var(--sh-card-base)] backdrop-blur overflow-x-auto" data-testid="studio-mobile-stages">
        <div className="grid grid-cols-4 min-w-[360px] gap-1 rounded-xl border border-shBorder/60 bg-black/30 p-1">
          {MOBILE_STAGES.map(s => (
            <button key={s.key} onClick={() => setMobileStage(s.key)} data-testid={`studio-mobile-stage-${s.key}`}
                    className={`min-h-[44px] px-2 py-2 text-[10px] font-black whitespace-nowrap rounded-lg transition ${mobileStage === s.key ? "bg-shSecondary text-[#031018]" : "text-shTextMuted hover:text-shText"}`}>
              <i className={`fas ${s.icon} mr-1`}/>{s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden md:flex items-center justify-between gap-4 px-5 py-3 border-b border-shBorder/60 bg-black/10 shrink-0">
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-shSecondary">Curriculum workbench</p>
          <div className="flex items-center gap-2 min-w-0 mt-0.5">
            <span className="text-[11px] font-black text-shTextMuted">{selectedType}</span>
            <i className="fas fa-chevron-right text-[8px] text-shTextMuted/50"/>
            <span className="text-[13px] font-black text-shText truncate">{selectedName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {[{ icon: "fa-layer-group", v: modules.length, l: "modules", c: "text-shPrimary" }, { icon: "fa-book-open", v: lessonCount, l: "lessons", c: "text-shSecondary" }, { icon: "fa-bullseye", v: skillCount, l: "skills", c: "text-shAccent" }].map(item => (
            <div key={item.l} className="rounded-xl border border-shBorder/50 bg-black/20 px-3 py-2 flex items-center gap-2">
              <i className={`fas ${item.icon} ${item.c} text-[10px]`}/><span className="text-[12px] font-black text-shText">{item.v}</span><span className="text-[9px] text-shTextMuted">{item.l}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <aside className={`${mobileStage === "outline" ? "block" : "hidden"} md:block md:w-[320px] shrink-0 border-b md:border-b-0 md:border-r border-shBorder/60 bg-black/10 overflow-y-auto`}>
          <div className="sticky top-0 z-10 p-3 sm:p-4 border-b border-shBorder/50 bg-[var(--sh-card-base)] backdrop-blur space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-shPrimary">Course outline</p>
                <p className="text-[11px] text-shTextMuted mt-0.5">Build the path clients actually follow.</p>
              </div>
              <button onClick={addModule} data-testid="studio-add-module" className="min-h-[38px] bg-shPrimary text-[#071018] px-3 py-2 rounded-lg text-[10px] font-black shadow-[0_6px_16px_-8px_rgba(140,198,63,0.9)]">
                <i className="fas fa-plus mr-1"/>Module
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <CsvImportButton label="CSV" parse={parseProgramCsv} sampleText={PROGRAM_CSV_SAMPLE} sampleFilename="program-template.csv"
                                testIdPrefix="studio-csv" helpText="Columns: module_name, module_description, goal_name, goal_description."
                                onImport={(parsed) => { if (parsed?.modules?.length) props.set({ modules: [...modules, ...parsed.modules] }); }}/>
              {allPrograms.length > 0 && (
                <>
                  <select value={copySource} onChange={(e) => setCopySource(e.target.value)} className="min-w-0 flex-1 min-h-[38px] bg-black/30 border border-shBorder/70 rounded-lg px-2 text-[10px] text-shText focus:outline-none focus:border-shSecondary/50">
                    <option value="">Copy from another program…</option>
                    {allPrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button disabled={!copySource} onClick={() => { copyFromProgram(copySource); setCopySource(""); }}
                          className="min-h-[38px] bg-shSecondary/[0.08] text-shSecondary border border-shSecondary/25 px-2.5 rounded-lg text-[10px] font-black disabled:opacity-40">Copy</button>
                </>
              )}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            {modules.length === 0 && (
              <div className="rounded-2xl border border-dashed border-shBorder bg-black/10 px-4 py-10 text-center">
                <div className="w-12 h-12 rounded-2xl grid place-items-center mx-auto bg-shPrimary/[0.08] border border-shPrimary/20 text-shPrimary"><i className="fas fa-layer-group"/></div>
                <p className="text-[13px] font-black text-shText mt-3">Start with your first module</p>
                <p className="text-[11px] text-shTextMuted mt-1">Modules group lessons and skills into a clear training path.</p>
              </div>
            )}
            <CurriculumTree
              modules={modules} selected={selected}
              setSelected={(sel) => { setSelected(sel); setMobileStage("edit"); }}
              moveModule={props.moveModule} duplicateModule={props.duplicateModule} removeModule={props.removeModule}
              addSkill={props.addSkill} addLesson={props.addLesson} moveSkill={props.moveSkill} moveLesson={props.moveLesson}
              removeSkill={props.removeSkill} removeLesson={props.removeLesson}
              testid="studio-outline"
            />
          </div>
        </aside>

        <main className={`${mobileStage === "edit" ? "block" : "hidden"} md:block flex-1 min-w-0 overflow-y-auto`}>
          <div className="p-3 sm:p-5 lg:p-6 max-w-[820px] mx-auto">
            {!selected && (
              <div className="min-h-[420px] flex items-center justify-center">
                <div className="max-w-md text-center rounded-2xl border border-shBorder/50 bg-black/10 p-6 sm:p-8">
                  <div className="w-14 h-14 rounded-2xl grid place-items-center mx-auto border border-shSecondary/25 bg-shSecondary/[0.06] text-shSecondary"><i className="fas fa-pen-ruler text-lg"/></div>
                  <h5 className="text-lg font-black text-shText mt-4">Pick something to edit</h5>
                  <p className="text-[12px] text-shTextMuted mt-1">Choose a module, lesson, or skill from the outline. Your live client/trainer preview stays available beside you on desktop.</p>
                  <button onClick={() => setMobileStage("outline")} className="md:hidden mt-4 min-h-[44px] px-4 rounded-lg bg-shPrimary text-[#071018] text-[11px] font-black">Open Outline</button>
                </div>
              </div>
            )}
            {selected && (
              <div className="mb-4 rounded-2xl border border-shBorder/50 bg-black/20 p-3 sm:p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-shTextMuted">Editing {selectedType}</p>
                  <h5 className="text-lg sm:text-xl font-black text-shText truncate">{selectedName}</h5>
                  {selectedModule && (selectedLesson || selectedSkill) && <p className="text-[10px] text-shTextMuted mt-0.5">Inside {selectedModule.name}</p>}
                </div>
                <button onClick={() => setMobileStage("preview")} className="md:hidden shrink-0 min-h-[42px] px-3 rounded-lg border border-shSecondary/30 bg-shSecondary/[0.06] text-shSecondary text-[10px] font-black"><i className="fas fa-eye mr-1"/>Preview</button>
              </div>
            )}
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
        </main>

        <aside className={`${mobileStage === "preview" || mobileStage === "validate" ? "block" : "hidden"} md:block md:w-[410px] shrink-0 border-t md:border-t-0 md:border-l border-shBorder/60 bg-black/10 flex flex-col min-h-0`}>
          <div className="p-3 sm:p-4 border-b border-shBorder/50 bg-black/10">
            <div className="mb-2">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-shPrimary">Publish center</p>
              <p className="text-[11px] text-shTextMuted">See readiness and enrollment impact before anything goes live.</p>
            </div>
            <PublishReadinessPanel isNew={isNew} draftMeta={draftMeta} validation={validation} impact={impact}
                                    loadingImpact={loadingImpact} onPublish={onPublish} saving={saving} testid="studio-publish-readiness"/>
          </div>
          <div className="flex-1 min-h-0">
            <ProgramPreviewPanel
              modules={modules} selectedModule={selectedModule} selectedLesson={selectedLesson} selectedSkill={selectedSkill}
              validation={validation} onValidationNavigate={onValidationNavigate} onValidationRefresh={onRunValidation} validating={validating}
              tab={mobileStage === "validate" ? "validation" : previewTab}
              onTabChange={(t) => { setPreviewTab(t); if (t === "validation") setMobileStage("validate"); else if (mobileStage === "validate") setMobileStage("preview"); }}
              testid="studio-preview"
            />
          </div>
        </aside>
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_220px] gap-3">
        <div className="rounded-2xl border border-shPrimary/20 bg-shPrimary/[0.035] p-4 space-y-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl grid place-items-center bg-shPrimary/[0.10] border border-shPrimary/25 text-shPrimary"><i className="fas fa-layer-group"/></span>
            <div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-shPrimary">Module</p><p className="text-[11px] text-shTextMuted">A major section of the client's training journey.</p></div>
          </div>
          <SField label="Name"><input value={m.name} onChange={(e) => updateModule(m._key, { name: e.target.value })} className={inputCls}/></SField>
          <SField label="Description"><textarea value={m.description || ""} onChange={(e) => updateModule(m._key, { description: e.target.value })} rows={3} className={inputCls}/></SField>
        </div>
        <div className="rounded-2xl border border-shBorder/50 bg-black/10 p-4">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shTextMuted">Module contents</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-xl border border-shSecondary/20 bg-shSecondary/[0.035] p-3 text-center"><p className="text-xl font-black text-shSecondary">{(m.lessons || []).length}</p><p className="text-[9px] text-shTextMuted">Lessons</p></div>
            <div className="rounded-xl border border-shAccent/20 bg-shAccent/[0.03] p-3 text-center"><p className="text-xl font-black text-shAccent">{(m.goals || []).length}</p><p className="text-[9px] text-shTextMuted">Skills</p></div>
          </div>
          <p className="text-[10px] text-shTextMuted mt-3">Add and reorder lessons/skills from the course outline on the left.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-shBorder/50 bg-black/10 p-4">
        <div className="flex items-start gap-3 mb-3">
          <span className="w-9 h-9 rounded-xl grid place-items-center bg-shSecondary/[0.06] border border-shSecondary/20 text-shSecondary shrink-0"><i className="fas fa-graduation-cap text-[11px]"/></span>
          <div><p className="text-[12px] font-black text-shText">Module homework</p><p className="text-[10px] text-shTextMuted">Automatically send the linked homework when the dog begins this module.</p></div>
        </div>
        <SField label="Homework template">
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={m.homework_template_id || ""} onChange={(e) => updateModule(m._key, { homework_template_id: e.target.value || null })} className={inputCls}>
              <option value="">— None —</option>
              {hwTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.tier ? ` · ${t.tier}` : ""}</option>)}
            </select>
            <button type="button" onClick={() => setEditingTemplate(true)} data-testid="module-edit-homework-template"
                    className="shrink-0 min-h-[44px] bg-black/25 border border-shBorder text-shTextMuted hover:text-shPrimary hover:border-shPrimary/30 rounded-xl px-4 text-[11px] font-black transition">
              <i className="fas fa-pen mr-1.5"/>Edit Template
            </button>
          </div>
        </SField>
      </div>
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
    <div className="space-y-4">
      <div className="rounded-2xl border border-shSecondary/20 bg-shSecondary/[0.035] p-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl grid place-items-center bg-shSecondary/[0.10] border border-shSecondary/25 text-shSecondary"><i className="fas fa-book-open"/></span><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-shSecondary">Lesson</p><p className="text-[11px] text-shTextMuted">Client learning, trainer direction, practice, and checkpoint rules live here.</p></div></div>
        <label className="min-h-[40px] flex items-center gap-2 rounded-xl border border-shBorder/50 bg-black/10 px-3 text-[11px] font-bold text-shText"><input type="checkbox" checked={l.active !== false} onChange={(e) => set({ active: e.target.checked })}/>Active lesson</label>
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

      <ExpandableSection title="Lesson Builder" icon="fa-layer-group" tone="accent" testid="lesson-section-blocks">
        <LessonBlocksEditor blocks={l.content_blocks || []} onChange={(content_blocks) => set({ content_blocks })} />
      </ExpandableSection>

      <ExpandableSection title="Practice Links" icon="fa-graduation-cap" testid="lesson-section-homework">
        <div className="space-y-2">
          <select value={""} onChange={(e) => { if (e.target.value) set({ suggested_homework_template_ids: [...new Set([...(l.suggested_homework_template_ids || []), e.target.value])] }); }} className={inputCls}>
            <option value="">+ Add template…</option>
            {hwTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {(l.suggested_homework_template_ids || []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(l.suggested_homework_template_ids || []).map(tid => {
                const t = hwTemplates.find(h => h.id === tid);
                return <span key={tid} className="px-2 py-1 rounded text-[11px] bg-shSecondary/10 text-shSecondary border border-shSecondary/40">
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

      <ExpandableSection title="Trainer Checkpoint" icon="fa-video" tone="accent" testid="lesson-section-checkpoint">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-[12px] text-shText">
            <input type="checkbox" checked={!!l.checkpoint?.enabled}
                   onChange={(e) => set({ checkpoint: { ...(l.checkpoint || {}), enabled: e.target.checked } })}
                   data-testid="checkpoint-enabled-toggle"/>
            Requires a trainer checkpoint before advancing — the client must submit a video for review instead of self-advancing
          </label>
          {l.checkpoint?.enabled && (
            <div className="space-y-3 pl-3 border-l-2 border-shAccent/30 ml-1">
              <label className="flex items-center gap-2 text-[12px] text-shText">
                <input type="checkbox" checked={l.checkpoint?.assessment_type === "final_assessment"}
                       onChange={(e) => set({ checkpoint: { ...l.checkpoint, assessment_type: e.target.checked ? "final_assessment" : "checkpoint" } })}
                       data-testid="checkpoint-final-assessment-toggle"/>
                Mark as the program's Final Assessment — client sees "Final Assessment" instead of "Checkpoint"; only one lesson per program may be marked this way
              </label>
              <SField label="Checkpoint title (optional — defaults to the lesson name)">
                <input value={l.checkpoint?.title || ""} onChange={(e) => set({ checkpoint: { ...l.checkpoint, title: e.target.value } })} className={inputCls} data-testid="checkpoint-title"/>
              </SField>
              <SField label="Submission instructions (shown to the client)">
                <textarea value={l.checkpoint?.submission_instructions || ""} onChange={(e) => set({ checkpoint: { ...l.checkpoint, submission_instructions: e.target.value } })} rows={2} className={inputCls} data-testid="checkpoint-submission-instructions"/>
              </SField>
              <CriteriaListEditor label="Handler criteria (at least one required)" testid="checkpoint-handler-criteria"
                                   criteria={l.checkpoint?.handler_criteria || []}
                                   onChange={(next) => set({ checkpoint: { ...l.checkpoint, handler_criteria: next } })}/>
              <CriteriaListEditor label="Dog criteria (at least one required)" testid="checkpoint-dog-criteria"
                                   criteria={l.checkpoint?.dog_criteria || []}
                                   onChange={(next) => set({ checkpoint: { ...l.checkpoint, dog_criteria: next } })}/>
              <SField label="Submission requirements (optional — e.g. filming angle)">
                <textarea value={l.checkpoint?.submission_requirements || ""} onChange={(e) => set({ checkpoint: { ...l.checkpoint, submission_requirements: e.target.value } })} rows={2} className={inputCls} data-testid="checkpoint-submission-requirements"/>
              </SField>
              <SField label="Pass/readiness guidance — trainer-only, never shown to the client">
                <textarea value={l.checkpoint?.pass_readiness_guidance || ""} onChange={(e) => set({ checkpoint: { ...l.checkpoint, pass_readiness_guidance: e.target.value } })} rows={2} className={inputCls} data-testid="checkpoint-pass-readiness-guidance"/>
              </SField>
            </div>
          )}
        </div>
      </ExpandableSection>
    </div>
  );
}

const BLOCK_TYPES = [
  ["text","Text"],["video","Video"],["image","Image"],["steps","Steps"],["trainer_tip","Trainer Tip"],
  ["warning","Safety / Warning"],["checklist","Checklist"],["quiz","Knowledge Check"],["timer","Timer"],
  ["rep_counter","Rep Counter"],["download","Download / Resource"],["practice","Practice Prompt"],["checkpoint","Checkpoint Prompt"],
];

function LessonBlocksEditor({ blocks, onChange }) {
  const [schoolResources, setSchoolResources] = useState([]);
  useEffect(() => { let live = true; api.get("/admin/school/resources").then(({data}) => { if (live) setSchoolResources((data || []).filter((r) => r.active !== false)); }).catch(() => {}); return () => { live = false; }; }, []);
  const update = (idx, patch) => onChange(blocks.map((b, i) => i === idx ? { ...b, ...patch } : b));
  const add = () => onChange([...blocks, { id: undefined, type: "text", title: "", body: "", url: "", resource_id: null, items: [], config: {}, order: blocks.length, active: true }]);
  const remove = (idx) => onChange(blocks.filter((_, i) => i !== idx).map((b, i) => ({ ...b, order: i })));
  const move = (idx, dir) => { const j = idx + dir; if (j < 0 || j >= blocks.length) return; const next = [...blocks]; [next[idx], next[j]] = [next[j], next[idx]]; onChange(next.map((b, i) => ({ ...b, order: i }))); };
  return <div className="space-y-3">
    <div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-black text-shText">Build the client lesson in ordered blocks</p><p className="text-[11px] text-shTextMuted mt-0.5">Old lesson fields still work. Blocks let you mix video, steps, tips, checks, timers, reps and resources without code.</p></div><button type="button" onClick={add} className="min-h-[40px] px-3 rounded-xl bg-shSecondary text-[#031018] text-[11px] font-black"><i className="fas fa-plus mr-1"/>Add block</button></div>
    {blocks.length === 0 && <div className="rounded-xl border border-dashed border-shBorder p-5 text-center text-[12px] text-shTextMuted">No blocks yet. The legacy lesson fields above will still render normally.</div>}
    {blocks.map((b, idx) => <div key={b.id || idx} className="rounded-xl border border-shBorder/70 bg-black/15 p-3 space-y-3" data-testid={`lesson-block-${idx}`}>
      <div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-black text-shTextMuted">#{idx + 1}</span><select value={b.type || "text"} onChange={(e) => update(idx,{type:e.target.value})} className={`${inputCls} max-w-[190px]`}>{BLOCK_TYPES.map(([k,l]) => <option key={k} value={k}>{l}</option>)}</select><label className="text-[11px] text-shText flex items-center gap-1"><input type="checkbox" checked={b.active !== false} onChange={(e)=>update(idx,{active:e.target.checked})}/>Visible</label><span className="flex-1"/><button type="button" onClick={()=>move(idx,-1)} disabled={idx===0} className="px-2 py-1 text-shTextMuted disabled:opacity-30"><i className="fas fa-arrow-up"/></button><button type="button" onClick={()=>move(idx,1)} disabled={idx===blocks.length-1} className="px-2 py-1 text-shTextMuted disabled:opacity-30"><i className="fas fa-arrow-down"/></button><button type="button" onClick={()=>remove(idx)} className="px-2 py-1 text-shDanger"><i className="fas fa-trash"/></button></div>
      <SField label="Heading (optional)"><input value={b.title || ""} onChange={(e)=>update(idx,{title:e.target.value})} className={inputCls}/></SField>
      {!["video","image","download"].includes(b.type) && <SField label={b.type === "quiz" ? "Question / explanation" : "Content"}><textarea rows={2} value={b.body || ""} onChange={(e)=>update(idx,{body:e.target.value})} className={inputCls}/></SField>}
      {["video","image","download"].includes(b.type) && <div className="grid sm:grid-cols-2 gap-2"><SField label="Direct URL (optional)"><input value={b.url || ""} onChange={(e)=>update(idx,{url:e.target.value,resource_id:e.target.value?null:b.resource_id})} className={inputCls}/></SField><SField label="School resource"><select value={b.resource_id || ""} onChange={(e)=>update(idx,{resource_id:e.target.value || null,url:e.target.value?"":b.url})} className={inputCls}><option value="">— Use URL / none —</option>{schoolResources.map((r)=><option key={r.id} value={r.id}>{r.title} · {r.kind}</option>)}</select></SField></div>}
      {["steps","checklist","quiz"].includes(b.type) && <SField label={b.type === "quiz" ? "Answer options — one per line" : "Items — one per line"}><textarea rows={3} value={(b.items || []).join("\n")} onChange={(e)=>{const items=e.target.value.split("\n").map(x=>x.trim()).filter(Boolean);const correct=(b.config||{}).correct_answer;update(idx,{items,config:{...(b.config||{}),correct_answer:items.includes(correct)?correct:null}})}} className={inputCls}/></SField>}
      {b.type === "quiz" && (b.items || []).length > 0 && <div className="grid sm:grid-cols-2 gap-2"><SField label="Correct answer (optional — leave blank for reflection only)"><select value={b.config?.correct_answer || ""} onChange={(e)=>update(idx,{config:{...(b.config||{}),correct_answer:e.target.value||null}})} className={inputCls}><option value="">Reflection only</option>{(b.items||[]).map(o=><option key={o} value={o}>{o}</option>)}</select></SField><SField label="Answer explanation / coaching note (optional)"><textarea rows={2} value={b.config?.explanation || ""} onChange={(e)=>update(idx,{config:{...(b.config||{}),explanation:e.target.value}})} className={inputCls}/></SField></div>}
      {b.type === "timer" && <SField label="Timer seconds"><input type="number" min="1" value={b.config?.seconds || ""} onChange={(e)=>update(idx,{config:{...(b.config||{}),seconds:parseInt(e.target.value)||null}})} className={`${inputCls} max-w-[160px]`}/></SField>}
      {b.type === "rep_counter" && <SField label="Target reps"><input type="number" min="1" value={b.config?.target || ""} onChange={(e)=>update(idx,{config:{...(b.config||{}),target:parseInt(e.target.value)||null}})} className={`${inputCls} max-w-[160px]`}/></SField>}
    </div>)}
  </div>;
}

/* ---------------------------------------------------- Checkpoint criteria */
function CriteriaListEditor({ label, criteria, onChange, testid }) {
  const addOne = () => onChange([...criteria, { id: undefined, name: "", guidance: "" }]);
  const updateOne = (idx, patch) => onChange(criteria.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const removeOne = (idx) => onChange(criteria.filter((_, i) => i !== idx));
  return (
    <div data-testid={testid}>
      <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">{label}</p>
      <div className="space-y-2">
        {criteria.map((c, idx) => (
          <div key={c.id || idx} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-start bg-black/20 border border-shBorder/60 rounded-xl p-2.5" data-testid={`${testid}-row-${idx}`}>
            <div className="flex-1 space-y-1">
              <input value={c.name || ""} onChange={(e) => updateOne(idx, { name: e.target.value })}
                     placeholder="Criterion name (e.g. Cue clarity)" className={inputCls} data-testid={`${testid}-name-${idx}`}/>
              <input value={c.guidance || ""} onChange={(e) => updateOne(idx, { guidance: e.target.value })}
                     placeholder="Grading guidance — trainer-only, optional" className={inputCls} data-testid={`${testid}-guidance-${idx}`}/>
            </div>
            <button type="button" onClick={() => removeOne(idx)} className="shrink-0 min-h-[40px] sm:min-h-0 text-shTextMuted hover:text-shDanger px-3 py-2 rounded-lg hover:bg-red-500/[0.06]" data-testid={`${testid}-remove-${idx}`}>
              <i className="fas fa-times"/>
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addOne} className="mt-2 min-h-[40px] px-3 rounded-lg border border-dashed border-shSecondary/30 bg-shSecondary/[0.035] text-[11px] font-black text-shSecondary hover:bg-shSecondary/[0.07]" data-testid={`${testid}-add`}>
        <i className="fas fa-plus mr-1"/>Add criterion
      </button>
    </div>
  );
}

/* --------------------------------------------------------- Skill editor */
function SkillEditor({ module: m, skill: g, updateSkill }) {
  const set = (patch) => updateSkill(m._key, g._key, patch);
  const completeness = computeSkillCompleteness(g);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-shAccent/20 bg-shAccent/[0.03] p-4 flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-xl grid place-items-center bg-shAccent/[0.08] border border-shAccent/25 text-shAccent"><i className="fas fa-bullseye"/></span><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-shAccent">Skill</p><p className="text-[11px] text-shTextMuted">Define what success looks like and how it is measured.</p></div></div>
        <label className="min-h-[40px] flex items-center gap-2 rounded-xl border border-shBorder/50 bg-black/10 px-3 text-[11px] font-bold text-pink-300" title="Check-off (Done/Reset) instead of a 0-5 score">
          <input type="checkbox" checked={!!g.manual_only} onChange={(e) => set({ manual_only: e.target.checked })}/>Manual check-off
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
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

const inputCls = "w-full min-h-[44px] bg-black/25 border border-shBorder/70 rounded-xl px-3 py-2.5 text-shText text-sm placeholder:text-shTextMuted/50 focus:outline-none focus:border-shSecondary/60 focus:ring-1 focus:ring-shSecondary/20 transition";
function SField({ label, children }) {
  return <div><label className="text-[11px] font-bold text-shTextMuted">{label}</label><div className="mt-1.5">{children}</div></div>;
}
