/**
 * Sprint 110r — Homework Analytics modal.
 *
 * Trainer-only dashboard surfacing per-template completion metrics, drop-off
 * day analysis (both stale-plan + engagement-cliff flavors), and per-day mood
 * & engagement sparklines. Pulled lazily from /api/admin/homework/analytics
 * when the modal opens — small dataset, simple Python aggregation backend.
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const MOOD_DOT_COLOR = (avg) => {
  if (avg == null) return "#374151";        // gray-700 for missing
  if (avg >= 4.0) return "#8cc63f";         // shGreen
  if (avg >= 3.0) return "#00a9e0";         // shBlue
  if (avg >= 2.0) return "#f59e0b";         // amber
  return "#ef4444";                          // red
};

export default function HomeworkAnalytics({ onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get("/admin/homework/analytics");
        if (alive) { setData(r.data); setErr(""); }
      } catch (e) {
        if (alive) setErr(e.response?.data?.detail || "Couldn't load analytics");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-black/85 backdrop-blur flex items-center justify-center p-3 sm:p-6"
         onClick={onClose}
         data-testid="homework-analytics-modal">
      <div onClick={(e) => e.stopPropagation()}
           className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-6xl max-h-[92vh] overflow-y-auto shadow-2xl animate-slide-in">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-bgPanel/95 backdrop-blur border-b border-bgHover">
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight">
              <i className="fas fa-chart-line text-shGreen mr-2"/>Homework Analytics
            </h2>
            <p className="text-[14px] text-gray-400 truncate">
              {data ? `${data.templates.length} curricul${data.templates.length === 1 ? "um" : "a"} tracked · ${data.global.total_assigned} total plans assigned` : "loading…"}
            </p>
          </div>
          <button onClick={onClose} data-testid="homework-analytics-close"
                  className="text-gray-400 hover:text-white text-2xl p-1 leading-none">
            <i className="fas fa-times"/>
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-6">
          {loading && <p className="text-[14px] text-gray-400">Crunching numbers…</p>}
          {err && <p className="text-red-400 text-[14px]" data-testid="homework-analytics-err">{err}</p>}

          {data && (
            <>
              {/* Global tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="homework-analytics-tiles">
                <Tile label="Active plans"      value={data.global.active_plans}    color="text-shBlue"   icon="fa-play" />
                <Tile label="Completed"         value={data.global.completed_plans} color="text-shGreen"  icon="fa-trophy" />
                <Tile label="Completion rate"   value={`${data.global.completion_rate}%`} color="text-shOrange" icon="fa-percent" />
                <Tile label="Avg active streak" value={`${data.global.avg_streak}d`} color="text-purple-300" icon="fa-fire" />
              </div>

              {/* Templates list */}
              <div className="bg-bgBase border border-bgHover rounded-xl overflow-hidden" data-testid="homework-analytics-templates">
                <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-gray-500 border-b border-bgHover bg-bgPanel/40">
                  <div className="col-span-4">Template</div>
                  <div className="col-span-1 text-center">Days</div>
                  <div className="col-span-1 text-center">Assigned</div>
                  <div className="col-span-2 text-center">Completion</div>
                  <div className="col-span-2 text-center">Avg days to finish</div>
                  <div className="col-span-2 text-center">Drop-off</div>
                </div>

                {data.templates.length === 0 && (
                  <div className="p-8 text-center text-gray-500 text-[14px]">
                    No homework plans yet. Once you assign a daily tracker, metrics show up here.
                  </div>
                )}

                {data.templates.map((t) => {
                  const isOpen = openId === (t.template_id || "custom");
                  return (
                    <div key={t.template_id || "custom"} data-testid={`homework-analytics-row-${t.template_id || "custom"}`}>
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : (t.template_id || "custom"))}
                        className="w-full grid grid-cols-12 gap-3 px-4 py-3 text-left hover:bg-bgPanel/50 border-b border-bgHover transition items-center">
                        <div className="col-span-12 md:col-span-4 flex items-center gap-2 min-w-0">
                          <i className={`fas ${isOpen ? "fa-chevron-down" : "fa-chevron-right"} text-gray-500 text-xs shrink-0`}/>
                          <div className="min-w-0">
                            <p className="text-[14px] font-black text-white truncate">{t.title}</p>
                            <p className="text-[11px] text-gray-500 uppercase tracking-widest md:hidden">
                              {t.total_days}d · {t.assigned_count} assigned · {t.completion_rate}%
                            </p>
                          </div>
                        </div>
                        <div className="hidden md:block col-span-1 text-center text-[14px] text-gray-300">{t.total_days}</div>
                        <div className="hidden md:block col-span-1 text-center text-[14px] font-black text-white">{t.assigned_count}</div>
                        <div className="hidden md:flex col-span-2 items-center justify-center gap-2">
                          <div className="h-1.5 w-16 bg-bgHover rounded overflow-hidden">
                            <div className="h-full bg-shGreen" style={{ width: `${t.completion_rate}%` }}/>
                          </div>
                          <span className="text-[13px] font-black text-shGreen w-12 text-right">{t.completion_rate}%</span>
                        </div>
                        <div className="hidden md:block col-span-2 text-center text-[14px] text-gray-300">
                          {t.avg_days_to_complete != null ? `${t.avg_days_to_complete}d` : "—"}
                        </div>
                        <div className="hidden md:flex col-span-2 justify-center gap-1.5 text-[11px] font-black uppercase tracking-widest">
                          {t.dropoff_day_stale != null && (
                            <span className="bg-shOrange/15 text-shOrange px-1.5 py-0.5 rounded border border-shOrange/30"
                                  title="Stale-plan drop-off: most plans went 14+ days without a log after this day">
                              <i className="fas fa-clock mr-1"/>Day {t.dropoff_day_stale}
                            </span>
                          )}
                          {t.dropoff_day_engagement != null && (
                            <span className="bg-red-500/15 text-red-300 px-1.5 py-0.5 rounded border border-red-500/30"
                                  title="Engagement cliff: biggest day-over-day drop in % of plans that logged">
                              <i className="fas fa-arrow-trend-down mr-1"/>Day {t.dropoff_day_engagement}
                            </span>
                          )}
                          {t.dropoff_day_stale == null && t.dropoff_day_engagement == null && (
                            <span className="text-gray-600">—</span>
                          )}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="bg-bgPanel/40 px-5 py-4 border-b border-bgHover space-y-4"
                             data-testid={`homework-analytics-detail-${t.template_id || "custom"}`}>
                          {/* Per-day breakdown */}
                          <div>
                            <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">
                              <i className="fas fa-chart-column text-shGreen mr-1"/>Per-day engagement &amp; mood
                            </p>
                            <div className="overflow-x-auto">
                              <div className="flex gap-1.5 min-w-max" data-testid={`homework-analytics-perday-${t.template_id || "custom"}`}>
                                {t.per_day.map((d) => (
                                  <div key={d.day_number}
                                       className="flex flex-col items-center gap-1 w-14 shrink-0"
                                       data-testid={`homework-analytics-perday-${t.template_id || "custom"}-${d.day_number}`}>
                                    <div className="h-20 w-full bg-bgBase border border-bgHover rounded flex flex-col justify-end overflow-hidden relative" title={`${d.logged_count}/${t.assigned_count} clients logged (${d.engagement_pct}%)`}>
                                      <div className="bg-shGreen w-full transition-all"
                                           style={{ height: `${Math.max(d.engagement_pct, 2)}%` }}/>
                                      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-white drop-shadow">
                                        {d.engagement_pct}%
                                      </span>
                                    </div>
                                    {/* Mood dot */}
                                    <div className="w-3 h-3 rounded-full"
                                         title={d.mood_avg != null ? `Avg mood ${d.mood_avg}/5` : "No mood data"}
                                         style={{ background: MOOD_DOT_COLOR(d.mood_avg) }}/>
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">D{d.day_number}</p>
                                    {(d.needs_redo > 0 || d.questions > 0) && (
                                      <div className="flex gap-0.5 text-[9px] font-black">
                                        {d.needs_redo > 0 && <span className="bg-red-500/20 text-red-300 px-1 rounded" title={`${d.needs_redo} needs-redo`}>{d.needs_redo}r</span>}
                                        {d.questions > 0 && <span className="bg-shBlue/20 text-shBlue px-1 rounded" title={`${d.questions} questions`}>{d.questions}q</span>}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-500">
                              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-shGreen inline-block rounded"/>engagement</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#8cc63f" }}/>mood≥4</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#00a9e0" }}/>mood≥3</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#f59e0b" }}/>mood≥2</span>
                              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#ef4444" }}/>mood&lt;2</span>
                              <span className="ml-auto">r = needs-redo · q = questions</span>
                            </div>
                          </div>

                          {/* Recent completions */}
                          {t.recent_completions.length > 0 && (
                            <div>
                              <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mb-2">
                                <i className="fas fa-graduation-cap text-shGreen mr-1"/>Recent completions
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {t.recent_completions.map((c, i) => (
                                  <span key={i}
                                        className="text-[12px] bg-shGreen/10 border border-shGreen/30 text-shGreen px-2 py-1 rounded"
                                        data-testid={`homework-analytics-recent-${t.template_id || "custom"}-${i}`}>
                                    <i className="fas fa-paw mr-1"/>{c.dog_name}
                                    <span className="text-gray-500 normal-case"> · {(c.completed_at || "").slice(0,10) || "—"}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Plain-English coaching */}
                          {(t.dropoff_day_stale != null || t.dropoff_day_engagement != null) && (
                            <div className="bg-shBlue/10 border border-shBlue/30 rounded p-3 text-[13px] text-shBlue">
                              <p className="font-black uppercase tracking-widest text-[11px] mb-1">
                                <i className="fas fa-lightbulb mr-1"/>What to check
                              </p>
                              <p className="text-gray-200">
                                {t.dropoff_day_stale != null && (
                                  <>Plans most often go silent after <span className="font-black text-white">Day {t.dropoff_day_stale}</span>. Consider an extra prompt, easier step, or short check-in message on that day. </>
                                )}
                                {t.dropoff_day_engagement != null && (
                                  <>Engagement drops sharpest at <span className="font-black text-white">Day {t.dropoff_day_engagement}</span> — review the instructions or step difficulty there.</>
                                )}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


function Tile({ label, value, color, icon }) {
  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-4" data-testid={`homework-analytics-tile-${label.replace(/\s+/g, "-").toLowerCase()}`}>
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500">
        <i className={`fas ${icon} mr-1 ${color}`}/>{label}
      </p>
      <p className={`text-3xl font-black mt-1 ${color}`}>{value}</p>
    </div>
  );
}
