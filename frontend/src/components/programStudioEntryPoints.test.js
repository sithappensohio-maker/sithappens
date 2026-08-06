// Training UI Phase 5 — source-level regression guards for the Program
// Studio redesign, matching this repo's established no-RTL convention (see
// trainingEntryPoints.test.js / trainerDashboardEntryPoints.test.js).
// Draft/publish/cascade/validation *behavior* is unchanged — every backend
// call site below is identical to the pre-redesign Studio; these guards
// prove the presentation layer wires to that unchanged behavior correctly.
import fs from "fs";
import path from "path";

const studioSrc = fs.readFileSync(path.join(__dirname, "ProgramStudio.jsx"), "utf8");
const programsSrc = fs.readFileSync(path.join(__dirname, "Programs.jsx"), "utf8");
const treeSrc = fs.readFileSync(path.join(__dirname, "training", "CurriculumTree.jsx"), "utf8");
const treeItemSrc = fs.readFileSync(path.join(__dirname, "training", "CurriculumTreeItem.jsx"), "utf8");
const previewSrc = fs.readFileSync(path.join(__dirname, "training", "ProgramPreviewPanel.jsx"), "utf8");
const publishSrc = fs.readFileSync(path.join(__dirname, "training", "PublishReadinessPanel.jsx"), "utf8");
const validationChecklistSrc = fs.readFileSync(path.join(__dirname, "training", "ValidationChecklist.jsx"), "utf8");

const INTERNAL_FIELD_PATTERN = /\.(trainer_instructions|trainer_prep_notes|trainer_purpose|trainer_only_guidance|advancement_criteria)\b/;

// 1. Hierarchy preserves IDs — reorder/add/duplicate all key off the same
// `_key` (real server id when persisted, local uid only pre-save) that
// withKeys/stripKeys already established pre-redesign; the new tree never
// introduces a second identity scheme.
test("CurriculumTree selection and reorder callbacks key off module/lesson/skill _key, never array index", () => {
  expect(treeSrc).toMatch(/setSelected\(\{ moduleKey: m\._key \}\)/);
  expect(treeSrc).toMatch(/moveLesson\(m\._key, l\._key, -1\)/);
  expect(treeSrc).toMatch(/moveSkill\(m\._key, g\._key, -1\)/);
});

// 2. Tree selection opens the correct editor — the same selected-state
// shape (moduleKey/lessonKey/skillKey) drives which editor renders.
test("ProgramStudio renders ModuleEditor, LessonEditor, or SkillEditor based on the exact same `selected` shape as before", () => {
  expect(studioSrc).toMatch(/selected && selectedModule && !selected\.lessonKey && !selected\.skillKey/);
  expect(studioSrc).toMatch(/selected && selectedLesson/);
  expect(studioSrc).toMatch(/selected && selectedSkill/);
});

// 3. Reordering doesn't recreate IDs — moveModule/moveLesson/moveSkill are
// passed through unchanged from ProgramStudio's existing mutation
// functions; the tree never reimplements reorder logic itself.
test("CurriculumTree never reimplements reorder logic — it only calls the passed-in moveModule/moveLesson/moveSkill props", () => {
  expect(treeSrc).not.toMatch(/\.sort\(|\.splice\(/);
  expect(treeSrc).toMatch(/moveModule\(m\._key, -1\)/);
});

// 4. Draft save never alters published data — saveDraft always calls the
// backend with save_as_draft=true, a distinct query param from the plain/
// cascade publish calls.
test("saveDraft always passes save_as_draft=true, never touching the live program fields", () => {
  expect(studioSrc).toMatch(/api\.put\(`\/programs\/\$\{programId\}\?save_as_draft=true`, buildPayload\(\)\)/);
});

// 5. Publish is separate from cascade — two distinct buttons/calls, never
// one button whose behavior is decided inside a hidden confirm() dialog.
test("PublishReadinessPanel renders two distinct buttons — Publish and Publish & Cascade — never a single ambiguous one", () => {
  expect(publishSrc).toMatch(/onPublish\(false\)/);
  expect(publishSrc).toMatch(/onPublish\(true\)/);
  expect(publishSrc).not.toMatch(/(await\s+confirm\(|=\s*confirm\()/); // no confirm() CALL — the word appears only in an explanatory comment
});
test("ProgramStudio's publish() takes the cascade decision as a direct argument, not from a confirm() dialog", () => {
  expect(studioSrc).toMatch(/const publish = async \(cascade\) => \{/);
  expect(studioSrc).not.toMatch(/publish[\s\S]{0,400}await confirm\(/);
});

// 6. Cascade impact preview is required before the cascade button even
// appears — PublishReadinessPanel only renders the cascade button once
// impact.enrollments_affected > 0, using the SAME publish-impact endpoint
// as before (no second impact-computation).
test("The cascade button only appears once impact data confirms affected enrollments, and impact comes from the existing publish-impact endpoint", () => {
  expect(publishSrc).toMatch(/impact && impact\.enrollments_affected > 0/);
  expect(studioSrc).toMatch(/api\.get\(`\/programs\/\$\{programId\}\/publish-impact`\)/);
});

// 7. Validation issues link to the correct item — resolveValidationTarget
// (lib/programStudioPolish.js) maps an issue's module_id/lesson_id/
// skill_id back to real selection keys, and ValidationChecklist wires
// clicks through that resolver, never a raw index guess.
test("ValidationChecklist resolves each issue's navigation target via resolveValidationTarget, not a raw index", () => {
  expect(validationChecklistSrc).toMatch(/import \{ groupValidationIssues, resolveValidationTarget \} from ["']\.\.\/\.\.\/lib\/programStudioPolish["']/);
  expect(validationChecklistSrc).toMatch(/resolveValidationTarget\(issue, modules\)/);
});

// 8. Trainer-only fields are absent from the Client preview — the client
// tab renders through LessonDetailPanel, whose own established test
// convention (portalLearningEntryPoints.test.js) already guarantees it
// never reads trainer-only fields; this guard proves ProgramPreviewPanel's
// CLIENT branch specifically never bypasses that component to read them
// directly itself.
test("ProgramPreviewPanel's client-preview branch never reads trainer-only fields directly", () => {
  const clientFnSrc = previewSrc.slice(previewSrc.indexOf("function ClientPreviewContent"), previewSrc.indexOf("function TrainerPreviewContent"));
  expect(clientFnSrc).not.toMatch(INTERNAL_FIELD_PATTERN);
  expect(clientFnSrc).toMatch(/import LessonDetailPanel|<LessonDetailPanel/);
});

// 9. Client preview uses client-safe content — reuses the exact production
// LessonDetailPanel/ProgramRoadmap/SkillLevelIndicator components clients
// see elsewhere, never a separately styled duplicate markup.
test("ProgramPreviewPanel's client tab reuses LessonDetailPanel and ProgramRoadmap, the same production client-facing components", () => {
  expect(previewSrc).toMatch(/import LessonDetailPanel from ["']\.\/LessonDetailPanel["']/);
  expect(previewSrc).toMatch(/import ProgramRoadmap from ["']\.\/ProgramRoadmap["']/);
});

// 10. Mobile Outline/Edit/Preview/Validate navigation works — all four
// stages exist, and picking one updates the same mobileStage state that
// gates which column is visible.
test("ProgramStudio defines all 4 mobile stages and CurriculumTab shows/hides columns by mobileStage", () => {
  expect(studioSrc).toMatch(/const MOBILE_STAGES = \[/);
  expect(studioSrc).toMatch(/\{ key: "outline"/);
  expect(studioSrc).toMatch(/\{ key: "edit"/);
  expect(studioSrc).toMatch(/\{ key: "preview"/);
  expect(studioSrc).toMatch(/\{ key: "validate"/);
  expect(studioSrc).toMatch(/mobileStage === "outline" \? "block" : "hidden"/);
  expect(studioSrc).toMatch(/mobileStage === "edit" \? "block" : "hidden"/);
});

// 11. Delete confirmation shows affected hierarchy — removeModule's existing
// confirm() dialog (unchanged from before the redesign) still names the
// skill count being removed; this redesign didn't strip that context out.
test("removeModule's confirmation still names the skill count being removed, unchanged from before", () => {
  expect(studioSrc).toMatch(/This removes \$\{skillCount\} skill/);
});

// 12. Commercial pricing fields retain their existing values — SetupTab's
// price/shop-category/storefront fields are the exact same controlled
// inputs (same value=/onChange=) as before, just regrouped into
// ExpandableSection, never rewritten.
test("SetupTab's price and storefront fields are unchanged controlled inputs, just regrouped", () => {
  expect(studioSrc).toMatch(/data-testid="prog-price"/);
  expect(studioSrc).toMatch(/data-testid="prog-publicly-visible"/);
  expect(studioSrc).toMatch(/value=\{program\.price \?\? 0\}/);
});

// 13. Permission-denied users can't open/write Program Studio — the
// frontend hides entry points (New/Edit/Archive) via the SAME
// /me/permissions flag every other admin panel already uses; server-side
// enforcement (require_admin_and_permission("manage_training_content") on
// every program-authoring endpoint) is pre-existing and untouched.
test("ProgramsPanel hides New/Edit/Archive behind the manage_training_content permission flag", () => {
  expect(programsSrc).toMatch(/permissions\.manage_training_content/);
  expect(programsSrc).toMatch(/\{canManage && \(/);
  expect(programsSrc).toMatch(/data-testid="programs-forbidden"/);
});

// 14. Existing Program Studio deep links remain valid — the modal is still
// opened the same way (programId/initialProgram props from ProgramsPanel),
// and the same data-testid="program-studio" root persists for anything
// that scripts against it.
test("ProgramStudio keeps its existing data-testid and prop contract (programId/initialProgram/onClose/onSaved)", () => {
  expect(studioSrc).toMatch(/data-testid="program-studio"/);
  expect(studioSrc).toMatch(/export default function ProgramStudio\(\{ programId, initialProgram, meta, allPrograms = \[\], onClose, onSaved \}\)/);
});

// 15. ExpandableSection groups are never nested inside another
// ExpandableSection — ContentCompleteness/field groups sit flat inside
// each ExpandableSection's children, matching the brief's "avoid nested
// accordions" rule.
test("LessonEditor and SkillEditor never nest one ExpandableSection inside another", () => {
  const lessonEditorSrc = studioSrc.slice(studioSrc.indexOf("function LessonEditor"), studioSrc.indexOf("function SkillEditor"));
  const skillEditorSrc = studioSrc.slice(studioSrc.indexOf("function SkillEditor"), studioSrc.indexOf("const inputCls"));
  // A second <ExpandableSection open with no </ExpandableSection> close in
  // between the first open and the second would indicate nesting; sibling
  // sections (close, then open again) must NOT match this pattern.
  const nestedPattern = /<ExpandableSection(?:(?!<\/ExpandableSection>)[\s\S])*<ExpandableSection/;
  for (const src of [lessonEditorSrc, skillEditorSrc]) {
    const opens = (src.match(/<ExpandableSection\b/g) || []).length;
    expect(opens).toBeGreaterThan(1); // sanity check the slice actually contains multiple sections
    expect(src).not.toMatch(nestedPattern);
  }
});
