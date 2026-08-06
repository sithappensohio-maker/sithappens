// Training UI Phase 4 — the visual course path shared by Learn and
// Progress (same status language: completed/current/available/locked/
// needs_review) so both screens feel connected, per the brief.
import { useState } from "react";
import ModuleJourneyCard from "./ModuleJourneyCard";

export default function ProgramRoadmap({ modules, renderModuleBody, testid }) {
  const [expandedId, setExpandedId] = useState(() => modules.find(m => m.status === "current")?.id || null);
  if (!modules || modules.length === 0) return null;
  return (
    <div className="space-y-2" data-testid={testid}>
      {modules.map(m => (
        <ModuleJourneyCard
          key={m.id}
          name={m.name} description={m.description}
          lessonCount={m.lessonCount} skillCount={m.skillCount}
          status={m.status} currentLessonName={m.currentLessonName}
          expanded={expandedId === m.id}
          onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
          testid={testid ? `${testid}-module-${m.id}` : undefined}
        >
          {renderModuleBody ? renderModuleBody(m) : null}
        </ModuleJourneyCard>
      ))}
    </div>
  );
}
