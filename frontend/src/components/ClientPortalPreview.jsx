import { useEffect, useState } from "react";
import { api } from "../lib/api";
import ProgressRing from "./ProgressRing";

/**
 * ClientPortalPreview — read-only modal showing what a single client would see in their portal.
 * Pulls /admin/clients/:id/portal-snapshot. No interactive controls (no booking, no signing).
 * Visible to admins only. Used from the Clients screen to QA the customer experience.
 */
export default function ClientPortalPreview({ clientId, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    if (!clientId) return;
    setData(null); setErr("");
    api.get(`/admin/clients/${clientId}/portal-snapshot`)
      .then(r => { if (alive) setData(r.data); })
      .catch(e => alive && setErr(e?.response?.data?.detail || "Failed to load snapshot."));
    return () => { alive = false; };
  }, [clientId]);

  if (!clientId) return null;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (data?.bookings || []).filter(b => b.date >= today && b.status !== "cancelled" && b.status !== "rejected").slice(0, 5);
  const recent = (data?.bookings || []).filter(b => b.date < today).slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-0 sm:p-4" onClick={onClose} data-testid="client-portal-preview">
      <div className="bg-bgBase border border-bgHover rounded-none sm:rounded-2xl w-full sm:max-w-3xl h-full sm:h-[90vh] flex flex-col shadow-2xl" onClick={e=>e.stopPropagation()}>
        {/* Banner */}
        <div className="shrink-0 bg-gradient-to-r from-red-500/80 to-orange-500/70 text-white px-4 py-2 flex items-center justify-between gap-3 text-[14px] font-black uppercase tracking-widest">
          <span><i className="fas fa-eye mr-2"/>Viewing as {data?.client?.name || "client"} (read-only)</span>
          <button onClick={onClose} data-testid="close-portal-preview" className="hover:bg-white/15 rounded px-2 py-1">
            <i className="fas fa-times mr-1"/>Return to Admin
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {!data && !err && <p className="text-gray-400 text-sm">Loading snapshot…</p>}
          {err && <p className="text-red-400 text-sm font-black uppercase tracking-widest">{err}</p>}
          {data && (
            <>
              {/* Credits + waiver */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-bgPanel border border-bgHover rounded-xl p-4 text-center">
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Daycare</p>
                  <p className="text-3xl font-black text-shGreen mt-1" data-testid="preview-daycare-credits">{data.client.credits ?? 0}</p>
                  <p className="text-[12px] text-gray-500 font-black uppercase">Days left</p>
                </div>
                <div className="bg-bgPanel border border-bgHover rounded-xl p-4 text-center">
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Training</p>
                  <p className="text-3xl font-black text-purple-400 mt-1" data-testid="preview-training-credits">{data.client.training_credits ?? 0}</p>
                  <p className="text-[12px] text-gray-500 font-black uppercase">Sessions</p>
                </div>
                <div className="bg-bgPanel border border-bgHover rounded-xl p-4 text-center">
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Boarding</p>
                  <p className="text-3xl font-black text-shOrange mt-1" data-testid="preview-boarding-credits">{data.client.boarding_credits ?? 0}</p>
                  <p className="text-[12px] text-gray-500 font-black uppercase">Nights</p>
                </div>
                <div className={`rounded-xl p-4 text-center border ${data.waiver.signed && !data.waiver.needs_resign ? "bg-shGreen/10 border-shGreen/40" : "bg-red-500/10 border-red-500/40"}`}>
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">Waiver</p>
                  <p className={`text-base font-black uppercase italic mt-2 ${data.waiver.signed && !data.waiver.needs_resign ? "text-shGreen" : "text-red-400"}`}>
                    {data.waiver.signed && !data.waiver.needs_resign ? "Signed" : data.waiver.needs_resign ? "Re-sign needed" : "Unsigned"}
                  </p>
                  {data.waiver.signature?.signed_at && <p className="text-[12px] text-gray-500 mt-1">{data.waiver.signature.signed_at.slice(0,10)}</p>}
                </div>
              </div>

              {/* Dogs */}
              <section>
                <h4 className="text-xs font-black uppercase tracking-widest text-shBlue mb-3"><i className="fas fa-paw mr-2"/>My Dogs · {data.dogs.length}</h4>
                {data.dogs.length === 0 ? (
                  <p className="text-gray-500 text-[15px] italic">No dogs on file yet.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="preview-dogs">
                    {data.dogs.map(d => (
                      <div key={d.id} className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden" data-testid={`preview-dog-${d.id}`}>
                        {d.photo
                          ? <div className="h-28 bg-bgBase flex items-center justify-center overflow-hidden">
                              <img src={d.photo} alt={d.name} loading="lazy" className="max-h-28 max-w-full object-contain" />
                            </div>
                          : <div className="h-28 bg-gradient-to-br from-bgHover to-bgPanel flex items-center justify-center text-shGreen text-3xl"><i className="fas fa-paw"/></div>}
                        <div className="p-3">
                          <p className="font-black text-white uppercase">{d.name}</p>
                          <p className="text-[14px] text-shBlue font-black uppercase tracking-widest">{d.breed || "Unknown"}</p>
                          <p className="text-[14px] text-gray-400 mt-1">Rabies: <span className={d.vaccines?.rabies && d.vaccines.rabies >= today ? "text-shGreen" : "text-red-400"}>{d.vaccines?.rabies || "Missing"}</span></p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Upcoming + Recent bookings */}
              <section>
                <h4 className="text-xs font-black uppercase tracking-widest text-shBlue mb-3"><i className="fas fa-calendar mr-2"/>Upcoming bookings · {upcoming.length}</h4>
                {upcoming.length === 0 ? (
                  <p className="text-gray-500 text-[15px] italic">No upcoming bookings.</p>
                ) : (
                  <ul className="space-y-2" data-testid="preview-upcoming">
                    {upcoming.map(b => (
                      <li key={b.id} className="bg-bgPanel border border-bgHover rounded p-3 flex items-center justify-between text-[15px]">
                        <div className="min-w-0">
                          <p className="font-black uppercase text-white">{b.dog_name} · <span className="text-shBlue">{b.service_type}</span></p>
                          <p className="text-[14px] text-gray-400">{b.date}{b.end_date && b.end_date !== b.date ? ` → ${b.end_date}` : ""}</p>
                        </div>
                        <span className={`shrink-0 text-[13px] font-black uppercase px-2 py-1 rounded ${b.status==="approved"?"bg-shGreen/15 text-shGreen":b.status==="pending"?"bg-shOrange/15 text-shOrange":"bg-gray-500/15 text-gray-400"}`}>{b.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Training */}
              {Object.keys(data.enrollments_by_dog || {}).length > 0 && (
                <section>
                  <h4 className="text-xs font-black uppercase tracking-widest text-shBlue mb-3"><i className="fas fa-medal mr-2"/>Training Progress</h4>
                  <div className="space-y-2" data-testid="preview-training">
                    {data.dogs.map(d => (data.enrollments_by_dog[d.id] || []).map(e => (
                      <div key={e.id} className="bg-bgPanel border border-bgHover rounded p-3 flex items-center gap-3">
                        <ProgressRing percent={e.mastered_pct || 0} size={48} stroke={5} color="#00a9e0" label={`${e.mastered_goals||0}/${e.total_goals||0}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-black uppercase text-white truncate">{d.name} · {e.program_snapshot?.name || "Program"}</p>
                          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">Started {e.started_at} · {e.status}</p>
                        </div>
                      </div>
                    )))}
                  </div>
                </section>
              )}

              {/* Homework */}
              {data.homework.length > 0 && (
                <section>
                  <h4 className="text-xs font-black uppercase tracking-widest text-shBlue mb-3"><i className="fas fa-graduation-cap mr-2"/>Homework · {data.homework.length}</h4>
                  <ul className="space-y-2" data-testid="preview-homework">
                    {data.homework.map(h => (
                      <li key={h.id} className="bg-bgPanel border border-bgHover rounded p-3 text-[15px]">
                        <p className="font-black uppercase text-white">{h.title || h.template_name || "Homework"}</p>
                        <p className="text-[14px] text-gray-400 mt-1">Due {h.due_date || "—"} · Status: <span className="text-shBlue">{h.status}</span></p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Recent history */}
              {recent.length > 0 && (
                <section>
                  <h4 className="text-xs font-black uppercase tracking-widest text-shBlue mb-3"><i className="fas fa-clock-rotate-left mr-2"/>Recent visits</h4>
                  <ul className="space-y-1.5" data-testid="preview-recent">
                    {recent.map(b => (
                      <li key={b.id} className="text-[14px] text-gray-400 flex items-center justify-between">
                        <span>{b.date} · <span className="text-white font-black uppercase">{b.dog_name}</span> · {b.service_type}</span>
                        <span className="text-gray-500">{b.status}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
