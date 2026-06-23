// Sprint 110di-71 — Trainer Scorecard tab on the Income screen.
// Reads from /admin/training/trainer-scorecard?days=N (Sprint 110di-71 endpoint).
// Each row = one trainer over the rolling window. Click a row to expand a
// dog-by-dog breakdown (TBD if needed; v1 is the rollup table only).

import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";

const RANGES = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function fmtRelative(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const ms = now - d;
    const days = Math.floor(ms / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return iso; }
}

export default function TrainerScorecardTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // Sprint 110di-72 — expand a trainer row to show per-dog breakdown
  const [expanded, setExpanded] = useState({}); // { [trainer_key]: bool }

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    api.get(`/admin/training/trainer-scorecard?days=${days}`)
      .then(r => { if (alive) setData(r.data); })
      .catch(e => { if (alive) setErr(formatErr(e?.response?.data?.detail) || "Failed to load"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  return (
    <div className="space-y-4" data-testid="trainer-scorecard">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen">
          <i className="fas fa-clipboard-user mr-1.5"/>Trainer Scorecard
        </p>
        <div className="flex items-center gap-1 bg-bgPanel border border-bgHover rounded p-0.5">
          {RANGES.map(r => (
            <button key={r.value} onClick={() => setDays(r.value)}
                    data-testid={`scorecard-range-${r.value}`}
                    className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-widest rounded transition ${
                      days === r.value ? "bg-shGreen text-bgHeader" : "text-gray-400 hover:text-white"
                    }`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-400">
          <i className="fas fa-spinner fa-spin mr-2"/>Loading scorecard…
        </div>
      )}

      {err && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 card-danger" data-testid="scorecard-err">
          <i className="fas fa-triangle-exclamation mr-2"/>{err}
        </div>
      )}

      {!loading && !err && data && (
        <>
          {/* Totals strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="Trainers" value={data.totals.trainers} icon="fa-user-tie" color="text-shBlue" testId="scorecard-total-trainers"/>
            <Tile label="Sessions" value={data.totals.sessions} icon="fa-clipboard-list" color="text-shGreen" testId="scorecard-total-sessions"/>
            <Tile label="Skills mastered" value={data.totals.skills_mastered} icon="fa-star" color="text-shOrange" testId="scorecard-total-mastered"/>
            <Tile label="Modules advanced" value={data.totals.modules_advanced} icon="fa-forward" color="text-pink-400" testId="scorecard-total-advanced"/>
          </div>

          {/* Trainer rows */}
          {data.trainers.length === 0 ? (
            <div className="bg-bgPanel border border-bgHover rounded-xl p-8 text-center text-gray-500" data-testid="scorecard-empty">
              <i className="fas fa-clipboard text-3xl mb-2 opacity-40"/>
              <p className="text-sm">No training sessions logged in the last {data.days} days.</p>
              <p className="text-[12px] mt-1">Trainers will appear here after their first logged session via the Training Tracker.</p>
            </div>
          ) : (
            <div className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden card-table" data-testid="scorecard-table">
              <div className="hidden sm:grid grid-cols-12 gap-3 px-4 py-2 bg-bgBase/50 border-b border-bgHover text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">
                <div className="col-span-4">Trainer</div>
                <div className="col-span-2 text-right">Sessions</div>
                <div className="col-span-2 text-right">Dogs</div>
                <div className="col-span-2 text-right">Mastered</div>
                <div className="col-span-1 text-right">Adv</div>
                <div className="col-span-1 text-right">Last</div>
              </div>
              {data.trainers.map(t => (
                <div key={t.trainer_key} data-testid={`scorecard-row-${t.trainer_key}`}
                     className="border-b border-bgHover/60 last:border-b-0">
                  <button onClick={() => setExpanded(e => ({ ...e, [t.trainer_key]: !e[t.trainer_key] }))}
                          data-testid={`scorecard-row-toggle-${t.trainer_key}`}
                          className="w-full grid grid-cols-12 gap-3 px-4 py-3 items-center hover:bg-bgBase/40 transition text-left">
                    <div className="col-span-12 sm:col-span-4 flex items-center gap-2">
                      <i className={`fas ${expanded[t.trainer_key] ? "fa-chevron-down" : "fa-chevron-right"} text-gray-500 text-[10px]`}/>
                      <div className="min-w-0">
                        <p className="text-white font-black text-[14px] truncate">{t.trainer_name}</p>
                        {t.trainer_email && t.trainer_email !== t.trainer_name && (
                          <p className="text-gray-500 text-[11px] truncate">{t.trainer_email}</p>
                        )}
                      </div>
                    </div>
                    <div className="col-span-3 sm:col-span-2 sm:text-right">
                      <p className="sm:hidden text-[10px] font-black uppercase tracking-widest text-gray-500">Sessions</p>
                      <p className="text-shGreen font-black text-[16px]">{t.session_count}</p>
                    </div>
                    <div className="col-span-3 sm:col-span-2 sm:text-right">
                      <p className="sm:hidden text-[10px] font-black uppercase tracking-widest text-gray-500">Dogs</p>
                      <p className="text-shBlue font-black text-[16px]">{t.unique_dogs}</p>
                    </div>
                    <div className="col-span-3 sm:col-span-2 sm:text-right">
                      <p className="sm:hidden text-[10px] font-black uppercase tracking-widest text-gray-500">Mastered</p>
                      <p className="text-shOrange font-black text-[16px]">{t.skills_mastered}</p>
                    </div>
                    <div className="col-span-3 sm:col-span-1 sm:text-right">
                      <p className="sm:hidden text-[10px] font-black uppercase tracking-widest text-gray-500">Adv</p>
                      <p className="text-pink-400 font-black text-[16px]">{t.modules_advanced}</p>
                    </div>
                    <div className="col-span-12 sm:col-span-1 sm:text-right">
                      <p className="sm:hidden text-[10px] font-black uppercase tracking-widest text-gray-500">Last session</p>
                      <p className="text-gray-400 text-[11px] font-black uppercase tracking-widest">{fmtRelative(t.last_session_at)}</p>
                    </div>
                  </button>
                  {expanded[t.trainer_key] && (
                    <div className="bg-bgBase/40 border-t border-bgHover/60 px-4 py-3 space-y-2"
                         data-testid={`scorecard-expansion-${t.trainer_key}`}>
                      {(t.dogs || []).length === 0 ? (
                        <p className="text-gray-500 text-[12px]">No per-dog breakdown available.</p>
                      ) : (t.dogs || []).map(d => (
                        <div key={d.dog_id || d.enrollment_id} data-testid={`scorecard-dog-${d.dog_id}`}
                             className="bg-bgPanel/60 border border-bgHover rounded p-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div>
                              <p className="text-white font-black text-[13px]">
                                <i className="fas fa-dog text-shBlue mr-1.5"/>{d.dog_name}
                                {d.client_name && <span className="text-gray-500 text-[11px] font-normal ml-2">· {d.client_name}</span>}
                              </p>
                              {d.program_name && <p className="text-gray-500 text-[11px]">{d.program_name}</p>}
                            </div>
                            <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest">{fmtRelative(d.last_session_at)}</p>
                          </div>
                          <div className="grid grid-cols-4 gap-2 mt-2 text-[12px] font-black uppercase tracking-widest">
                            <Mini label="Sessions" value={d.session_count} color="text-shGreen"/>
                            <Mini label="Moved" value={d.skills_moved} color="text-shBlue"/>
                            <Mini label="Mastered" value={d.skills_mastered} color="text-shOrange"/>
                            <Mini label="Adv" value={d.modules_advanced} color="text-pink-400"/>
                          </div>
                          {(d.recent_diffs || []).length > 0 && (
                            <ul className="mt-2 space-y-0.5 text-[12px] text-gray-400">
                              {d.recent_diffs.slice(0, 3).map((diff, i) => (
                                <li key={i} className="flex items-center gap-1.5">
                                  <i className={`fas ${diff.new_status === "mastered" ? "fa-star text-shGreen" : "fa-arrow-right text-shBlue"} text-[10px]`}/>
                                  <span className="text-white">
                                    {(diff.prior_status || "—") + " → " + (diff.new_status || "—")}
                                  </span>
                                  {(diff.new_score ?? 0) !== (diff.prior_score ?? 0) && (
                                    <span className="text-gray-500">(score {diff.prior_score ?? 0} → {diff.new_score ?? 0})</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-500">
            <i className="fas fa-circle-info mr-1"/>&ldquo;Skills mastered&rdquo; counts goal transitions to mastered (status flip or score crossing into 4-5) within the window.
            &ldquo;Modules advanced&rdquo; counts the trainer&apos;s use of the &ldquo;Save + Advance week&rdquo; button.
          </p>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, icon, color, testId }) {
  return (
    <div data-testid={testId} className="bg-bgPanel border border-bgHover rounded-xl p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">
        <i className={`fas ${icon} mr-1 ${color}`}/>{label}
      </p>
      <p className={`text-2xl font-black ${color}`}>{value}</p>
    </div>
  );
}

function Mini({ label, value, color }) {
  return (
    <div className="text-center">
      <p className="text-gray-500 text-[10px]">{label}</p>
      <p className={`${color} text-[14px]`}>{value || 0}</p>
    </div>
  );
}
