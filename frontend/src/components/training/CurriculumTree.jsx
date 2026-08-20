// Training UI Phase 5 — Program Studio's left-column curriculum outline
// (Program -> Modules -> Lessons/Skills). Select/add/duplicate/reorder/
// delete are the SAME mutation callbacks ProgramStudio.jsx already owned
// pre-redesign (curriculum editing behavior is unchanged — this is
// presentation-only) — this component just renders them via
// CurriculumTreeItem instead of one long inline JSX block, and adds a
// content-completeness dot per lesson/skill.
import CurriculumTreeItem from "./CurriculumTreeItem";
import { computeLessonCompleteness, computeSkillCompleteness, rollUpCompleteness } from "../../lib/programStudioPolish";

function TreeBtn({ icon, onClick, disabled, title, danger, tiny, testid }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title} data-testid={testid}
            className={`shrink-0 ${tiny ? "w-7 h-7 text-[9px]" : "w-8 h-8 text-[10px]"} rounded-lg flex items-center justify-center transition ${danger ? "text-red-400/75 hover:text-red-300 hover:bg-red-500/10" : "text-shTextMuted hover:text-shText hover:bg-white/[0.05]"} disabled:opacity-20`}>
      <i className={`fas ${icon}`}/>
    </button>
  );
}

function AddRowButton({ tone, icon, children, onClick, testid }) {
  const cls = tone === "accent"
    ? "text-shAccent border-shAccent/20 hover:bg-shAccent/[0.05]"
    : "text-shSecondary border-shSecondary/20 hover:bg-shSecondary/[0.05]";
  return (
    <button onClick={onClick} data-testid={testid}
            className={`w-full min-h-[36px] rounded-lg border border-dashed text-[10px] font-black transition ${cls}`}>
      <i className={`fas ${icon} mr-1.5`}/>{children}
    </button>
  );
}

export default function CurriculumTree({
  modules, selected, setSelected,
  moveModule, duplicateModule, removeModule,
  addSkill, addLesson, moveSkill, moveLesson, removeSkill, removeLesson,
  testid,
  // Collapse state is owned by the caller so Collapse All / Expand All and
  // the auto-expand of the selected module stay in one place. A module is
  // collapsed only when its key is in this set AND it is not the selected
  // one — selection always wins, so collapsing can never hide what you are
  // editing. Purely presentational: nothing here mutates the draft.
  collapsedModules, onToggleModule,
}) {
  const isCollapsed = (m) => !!collapsedModules?.has?.(m._key) && selected?.moduleKey !== m._key;
  return (
    <div role="tree" aria-label="Curriculum outline" className="space-y-2.5" data-testid={testid}>
      {modules.map((m, mi) => {
        const isModSel = selected?.moduleKey === m._key && !selected.lessonKey && !selected.skillKey;
        const lessonCount = (m.lessons || []).length;
        const skillCount = (m.goals || []).length;
        const collapsed = isCollapsed(m);
        return (
          <div key={m._key} className={`overflow-hidden rounded-2xl border transition ${selected?.moduleKey === m._key ? "border-shPrimary/30 bg-shPrimary/[0.025]" : "border-shBorder/60 bg-black/20"}`}>
            <div className="px-2 pt-2">
              <CurriculumTreeItem type="module" name={m.name} selected={isModSel}
                meta={`${lessonCount} lesson${lessonCount === 1 ? "" : "s"} · ${skillCount} skill${skillCount === 1 ? "" : "s"}`}
                onSelect={() => setSelected({ moduleKey: m._key })}
                testid={testid ? `${testid}-module-${m._key}` : undefined}
                actions={(
                  <>
                    <TreeBtn icon={collapsed ? "fa-plus" : "fa-minus"}
                             onClick={(e) => { e.stopPropagation(); onToggleModule?.(m._key); }}
                             title={collapsed ? "Expand module" : "Collapse module"}
                             testid={testid ? `${testid}-toggle-${m._key}` : undefined}/>
                    <TreeBtn icon="fa-chevron-up" onClick={(e) => { e.stopPropagation(); moveModule(m._key, -1); }} disabled={mi === 0} title="Move module up"/>
                    <TreeBtn icon="fa-chevron-down" onClick={(e) => { e.stopPropagation(); moveModule(m._key, 1); }} disabled={mi === modules.length - 1} title="Move module down"/>
                    <TreeBtn icon="fa-copy" onClick={(e) => { e.stopPropagation(); duplicateModule(m._key); }} title="Duplicate module"/>
                    <TreeBtn icon="fa-trash" onClick={(e) => { e.stopPropagation(); removeModule(m._key); }} title="Remove module" danger/>
                  </>
                )}
              />
            </div>

            {!collapsed && <div className="px-2 pb-2.5 pt-1.5 space-y-2">
              <div className="rounded-xl border border-shBorder/40 bg-black/10 overflow-hidden">
                <div className="px-2.5 py-2 flex items-center justify-between gap-2 border-b border-shBorder/30">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-shSecondary">Lessons</span>
                  <span className="text-[9px] font-black text-shTextMuted">{lessonCount}</span>
                </div>
                <div className="p-1.5 space-y-1">
                  {(m.lessons || []).map((l, li) => (
                    <CurriculumTreeItem key={l._key} type="lesson" name={l.name} indent={1}
                      selected={selected?.lessonKey === l._key} inactive={l.active === false}
                      completeness={rollUpCompleteness(computeLessonCompleteness(l))}
                      onSelect={() => setSelected({ moduleKey: m._key, lessonKey: l._key })}
                      testid={testid ? `${testid}-lesson-${l._key}` : undefined}
                      actions={(
                        <>
                          <TreeBtn icon="fa-chevron-up" onClick={(e) => { e.stopPropagation(); moveLesson(m._key, l._key, -1); }} disabled={li === 0} title="Move lesson up" tiny/>
                          <TreeBtn icon="fa-chevron-down" onClick={(e) => { e.stopPropagation(); moveLesson(m._key, l._key, 1); }} disabled={li === (m.lessons || []).length - 1} title="Move lesson down" tiny/>
                          <TreeBtn icon="fa-trash" onClick={(e) => { e.stopPropagation(); removeLesson(m._key, l._key); }} title="Remove lesson" danger tiny/>
                        </>
                      )}
                    />
                  ))}
                  {lessonCount === 0 && <p className="text-[10px] text-shTextMuted italic px-2 py-2">No lessons yet.</p>}
                  <AddRowButton onClick={() => addLesson(m._key)} testid={testid ? `${testid}-add-lesson-${m._key}` : undefined} icon="fa-plus">Add lesson</AddRowButton>
                </div>
              </div>

              <div className="rounded-xl border border-shBorder/40 bg-black/10 overflow-hidden">
                <div className="px-2.5 py-2 flex items-center justify-between gap-2 border-b border-shBorder/30">
                  <span className="text-[9px] font-black uppercase tracking-[0.16em] text-shAccent">Skills</span>
                  <span className="text-[9px] font-black text-shTextMuted">{skillCount}</span>
                </div>
                <div className="p-1.5 space-y-1">
                  {(m.goals || []).map((g, gi) => (
                    <CurriculumTreeItem key={g._key} type="skill" name={g.name} indent={1}
                      selected={selected?.skillKey === g._key}
                      completeness={rollUpCompleteness(computeSkillCompleteness(g))}
                      onSelect={() => setSelected({ moduleKey: m._key, skillKey: g._key })}
                      testid={testid ? `${testid}-skill-${g._key}` : undefined}
                      actions={(
                        <>
                          <TreeBtn icon="fa-chevron-up" onClick={(e) => { e.stopPropagation(); moveSkill(m._key, g._key, -1); }} disabled={gi === 0} title="Move skill up" tiny/>
                          <TreeBtn icon="fa-chevron-down" onClick={(e) => { e.stopPropagation(); moveSkill(m._key, g._key, 1); }} disabled={gi === (m.goals || []).length - 1} title="Move skill down" tiny/>
                          <TreeBtn icon="fa-trash" onClick={(e) => { e.stopPropagation(); removeSkill(m._key, g._key); }} title="Remove skill" danger tiny/>
                        </>
                      )}
                    />
                  ))}
                  {skillCount === 0 && <p className="text-[10px] text-shTextMuted italic px-2 py-2">No skills yet.</p>}
                  <AddRowButton tone="accent" onClick={() => addSkill(m._key)} testid={testid ? `${testid}-add-skill-${m._key}` : undefined} icon="fa-plus">Add skill</AddRowButton>
                </div>
              </div>
            </div>}
          </div>
        );
      })}
    </div>
  );
}
