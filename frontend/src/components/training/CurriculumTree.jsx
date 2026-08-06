// Training UI Phase 5 — Program Studio's left-column curriculum outline
// (Program -> Modules -> Lessons/Skills). Select/add/duplicate/reorder/
// delete are the SAME mutation callbacks ProgramStudio.jsx already owned
// pre-redesign (curriculum editing behavior is unchanged — this is
// presentation-only) — this component just renders them via
// CurriculumTreeItem instead of one long inline JSX block, and adds a
// content-completeness dot per lesson/skill.
import CurriculumTreeItem from "./CurriculumTreeItem";
import { computeLessonCompleteness, computeSkillCompleteness, rollUpCompleteness } from "../../lib/programStudioPolish";

function TreeBtn({ icon, onClick, disabled, title, danger, tiny }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title}
            className={`shrink-0 ${tiny ? "w-4 h-4 text-[9px]" : "w-5 h-5 text-[10px]"} rounded flex items-center justify-center ${danger ? "text-red-400 hover:bg-red-500/15" : "text-shTextMuted hover:bg-white/10"} disabled:opacity-25`}>
      <i className={`fas ${icon}`}/>
    </button>
  );
}

export default function CurriculumTree({
  modules, selected, setSelected,
  moveModule, duplicateModule, removeModule,
  addSkill, addLesson, moveSkill, moveLesson, removeSkill, removeLesson,
  testid,
}) {
  return (
    <div role="tree" aria-label="Curriculum outline" className="space-y-1" data-testid={testid}>
      {modules.map((m, mi) => {
        const isModSel = selected?.moduleKey === m._key && !selected.lessonKey && !selected.skillKey;
        return (
          <div key={m._key} className="bg-black/20 border border-shBorder rounded">
            <CurriculumTreeItem type="module" name={m.name} selected={isModSel}
              onSelect={() => setSelected({ moduleKey: m._key })}
              testid={testid ? `${testid}-module-${m._key}` : undefined}
              actions={(
                <>
                  <TreeBtn icon="fa-chevron-up" onClick={(e) => { e.stopPropagation(); moveModule(m._key, -1); }} disabled={mi === 0} title="Move module up"/>
                  <TreeBtn icon="fa-chevron-down" onClick={(e) => { e.stopPropagation(); moveModule(m._key, 1); }} disabled={mi === modules.length - 1} title="Move module down"/>
                  <TreeBtn icon="fa-copy" onClick={(e) => { e.stopPropagation(); duplicateModule(m._key); }} title="Duplicate module"/>
                  <TreeBtn icon="fa-trash" onClick={(e) => { e.stopPropagation(); removeModule(m._key); }} title="Remove module" danger/>
                </>
              )}
            />
            <div className="pb-1.5">
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
              <button onClick={() => addLesson(m._key)} data-testid={testid ? `${testid}-add-lesson-${m._key}` : undefined}
                      className="text-[11px] text-shSecondary font-black uppercase tracking-widest px-2 py-1 ml-4"><i className="fas fa-plus mr-1"/>Lesson</button>
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
              <button onClick={() => addSkill(m._key)} data-testid={testid ? `${testid}-add-skill-${m._key}` : undefined}
                      className="text-[11px] text-shAccent font-black uppercase tracking-widest px-2 py-1 ml-4"><i className="fas fa-plus mr-1"/>Skill</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
