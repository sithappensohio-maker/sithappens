// Client-facing Lesson History for ONE School attempt.
//
// Renders exactly what /portal/school/{sid}/lesson-history returns. That
// endpoint is an explicit allowlist — private trainer notes and staff-only
// fields are never in the payload — so there is deliberately no filtering
// here: privacy is a server guarantee, and this component must not be the
// thing standing between the owner and a leaked internal note.
import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../../../lib/api";
import SectionCard from "../../premium/SectionCard";
import NeonEdge from "../../premium/NeonEdge";
import EmptyState from "../../training/EmptyState";

const ASSESSMENT_LABELS = {
  skipped: "Not worked",
  introduced: "Introduced",
  needs_more_work: "Needs work",
  improving: "Improving",
  passed: "Good",
  reliable: "Reliable",
};

const ASSESSMENT_TONES = {
  skipped: "text-shTextMuted border-shBorder",
  introduced: "text-shText border-shBorder",
  needs_more_work: "text-shAccent border-shAccent/40",
  improving: "text-shSecondary border-shSecondary/40",
  passed: "text-shPrimary border-shPrimary/40",
  reliable: "text-shPrimary border-shPrimary/70",
};

function ScorePips({ score }) {
  if (score == null) return null;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} className={`fas fa-circle text-[6px] ${n <= score ? "text-shPrimary" : "text-shBorder"}`} />
      ))}
      <span className="text-[11px] font-black text-shText ml-1">{score}/5</span>
    </span>
  );
}

export default function LessonHistoryScreen({ enrollmentId, dogName }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get(`/portal/school/${enrollmentId}/lesson-history`);
      setData(d);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Could not load training history");
    }
  }, [enrollmentId]);
  useEffect(() => { if (enrollmentId) load(); }, [enrollmentId, load]);

  if (err) return <p className="text-shDanger text-[13px] font-bold p-4" data-testid="lesson-history-error">{err}</p>;
  if (!data) return <p className="text-shTextMuted text-sm py-6 text-center"><i className="fas fa-spinner fa-spin mr-2" />Loading…</p>;

  const { progress = {}, lessons = [] } = data;

  return (
    <div className="space-y-4" data-testid="lesson-history-screen">
      <SectionCard accent="cyan" intensity="subtle">
        <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shSecondary">Training history</p>
        <h2 className="text-[18px] font-black text-shText mt-1">{data.program_name || "School Program"}</h2>
        <p className="text-[12px] text-shTextMuted mt-1">
          {dogName ? `${dogName} · ` : ""}{lessons.length} lesson{lessons.length === 1 ? "" : "s"} recorded
        </p>
        <div className="mt-3 flex items-center gap-3" data-testid="lesson-history-progress">
          <div className="flex-1 h-2 rounded-full bg-black/30 overflow-hidden">
            <div className="h-full bg-shPrimary rounded-full" style={{ width: `${progress.mastered_pct || 0}%` }} />
          </div>
          <span className="text-[12px] font-black text-shText shrink-0">
            {progress.mastered_goals || 0}/{progress.total_goals || 0} skills mastered
          </span>
        </div>
      </SectionCard>

      {lessons.length === 0 ? (
        <EmptyState icon="fa-clipboard-list" title="No lessons recorded yet"
                    message="Once your trainer completes a lesson, the recap appears here."
                    testid="lesson-history-empty" />
      ) : (
        lessons.map((l) => (
          <NeonEdge key={l.session_id} accentRgb="0,169,224" intensity="subtle" className="p-4"
                    data-testid={`lesson-history-item-${l.session_id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[15px] font-black text-shText">{l.lesson_name || "Training Session"}</p>
                <p className="text-[11.5px] text-shTextMuted mt-0.5">
                  {l.module_name ? `${l.module_name} · ` : ""}
                  {l.date ? new Date(l.date).toLocaleDateString() : ""}
                  {l.trainer_name ? ` · with ${l.trainer_name}` : ""}
                </p>
              </div>
            </div>

            {l.skills?.length > 0 && (
              <div className="mt-3 space-y-2" data-testid={`lesson-history-skills-${l.session_id}`}>
                {l.skills.map((s) => (
                  <div key={s.skill_id || s.name} className="rounded-xl border border-shBorder/50 bg-black/10 p-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[13px] font-black text-shText">{s.name}</p>
                      <div className="flex items-center gap-2">
                        <ScorePips score={s.score} />
                        {s.assessment && (
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${ASSESSMENT_TONES[s.assessment] || "text-shTextMuted border-shBorder"}`}>
                            {ASSESSMENT_LABELS[s.assessment] || s.assessment}
                          </span>
                        )}
                      </div>
                    </div>
                    {s.observation && <p className="text-[12.5px] text-shTextMuted mt-1.5 leading-relaxed">{s.observation}</p>}
                  </div>
                ))}
              </div>
            )}

            {l.what_went_well && (
              <div className="mt-3">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shPrimary"><i className="fas fa-thumbs-up mr-1" />What went well</p>
                <p className="text-[13px] text-shText mt-1 leading-relaxed">{l.what_went_well}</p>
              </div>
            )}
            {l.needs_work && (
              <div className="mt-3">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shAccent"><i className="fas fa-triangle-exclamation mr-1" />Needs work</p>
                <p className="text-[13px] text-shText mt-1 leading-relaxed">{l.needs_work}</p>
              </div>
            )}
            {l.trainer_feedback && (
              <div className="mt-3 rounded-xl border border-shSecondary/25 bg-shSecondary/[0.05] p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shSecondary"><i className="fas fa-comment-dots mr-1" />From your trainer</p>
                <p className="text-[13px] text-shText mt-1 leading-relaxed">{l.trainer_feedback}</p>
              </div>
            )}
            {l.practice_assigned?.length > 0 && (
              <div className="mt-3">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shSecondary"><i className="fas fa-paw mr-1" />Practice before next lesson</p>
                <ul className="mt-1 space-y-0.5">
                  {l.practice_assigned.map((t, i) => (
                    <li key={i} className="text-[13px] text-shText"><i className="fas fa-circle text-[5px] mr-2 align-middle text-shSecondary" />{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </NeonEdge>
        ))
      )}
    </div>
  );
}
