import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Admin "Pending Reviews" queue + per-day Review modal.
 * Lists every daily-tracker day that's awaiting approval and lets the admin
 * approve or send back with a note.
 */
export default function DailyReviewQueue({ onClose, onReviewed }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // {homework_id, day_number}
  const [activeDetail, setActiveDetail] = useState(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/homework/pending-reviews");
      setItems(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const open = async (it) => {
    setActive(it);
    setReviewNote("");
    setErr("");
    try {
      const { data } = await api.get(`/homework/${it.homework_id}`);
      setActiveDetail(data);
    } catch { setActiveDetail(null); }
  };

  const review = async (action) => {
    if (!active) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/homework/${active.homework_id}/day/${active.day_number}/review`, { action, note: reviewNote });
      setActive(null); setActiveDetail(null);
      await load();
      onReviewed?.();
    } catch (e) { setErr(e.response?.data?.detail || "Failed to save"); }
    finally { setBusy(false); }
  };

  const dayObj = activeDetail?.daily_progress?.find(p => p.day_number === active?.day_number);
  const submission = dayObj?.log || {};
  const mood = submission.field_values?.__mood;
  const photo = submission.field_values?.__photo;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose} data-testid="review-queue-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover p-5 flex items-center justify-between z-10">
          <div>
            <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
              <i className="fas fa-clipboard-check text-shOrange mr-2" />Daily Tracker Reviews
            </h3>
            <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">
              {loading ? "Loading…" : items.length === 0 ? "Inbox zero — nothing pending" : `${items.length} day${items.length === 1 ? "" : "s"} awaiting your review`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl" data-testid="review-queue-close">
            <i className="fas fa-times" />
          </button>
        </div>

        {!active ? (
          <div className="p-5 space-y-3" data-testid="review-queue-list">
            {items.length === 0 && !loading && (
              <div className="text-center py-12 text-gray-500">
                <i className="fas fa-mug-hot text-3xl mb-3 opacity-40 block" />
                <p className="text-[14px] font-black uppercase tracking-widest">All caught up.</p>
              </div>
            )}
            {items.map((it, idx) => (
              <button key={`${it.homework_id}-${it.day_number}`} onClick={() => open(it)}
                      data-testid={`review-queue-item-${idx}`}
                      className="w-full text-left bg-bgBase border border-bgHover rounded-lg p-4 hover:border-shOrange/40 transition">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-shOrange bg-shOrange/15 text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded">
                        Day {it.day_number} of {it.total_days}
                      </span>
                      {it.has_photo && <span className="text-purple-400 bg-purple-500/10 text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded"><i className="fas fa-camera mr-1" />photo</span>}
                      <span className="text-gray-500 text-[12px] font-black uppercase tracking-widest">
                        {(it.submitted_at || "").slice(0, 10)} · {(it.submitted_at || "").slice(11, 16)}
                      </span>
                    </div>
                    <p className="text-white font-black text-[15px] truncate">{it.dog_name} · {it.client_name}</p>
                    <p className="text-gray-400 text-[13px] truncate mt-0.5">{it.title}</p>
                    {it.note && <p className="text-gray-400 text-[13px] italic mt-1 truncate">"{it.note}"</p>}
                  </div>
                  <i className="fas fa-chevron-right text-gray-500" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-5 space-y-4" data-testid="review-detail-pane">
            <button onClick={() => { setActive(null); setActiveDetail(null); }} className="text-[14px] text-gray-400 hover:text-shBlue font-black uppercase tracking-widest" data-testid="review-back">
              <i className="fas fa-chevron-left mr-1" />Back to queue
            </button>

            <div className="bg-bgBase border border-bgHover rounded-xl p-4">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <span className="text-shOrange bg-shOrange/15 text-[13px] font-black uppercase tracking-widest px-2.5 py-1 rounded">
                  Day {active.day_number} of {active.total_days}
                </span>
                <span className="text-gray-500 text-[13px] font-black uppercase tracking-widest">
                  Submitted {(active.submitted_at || "").slice(0, 16).replace("T", " ")}
                </span>
              </div>
              <h4 className="text-white text-lg font-black tracking-tight">{active.dog_name} · {active.client_name}</h4>
              <p className="text-gray-400 text-[14px] mt-1">{active.title}</p>
              {dayObj?.day_focus && (
                <p className="text-shGreen text-[14px] font-black uppercase tracking-widest mt-3">
                  <i className="fas fa-bullseye mr-1" />Today's focus: <span className="text-white normal-case">{dayObj.day_focus}</span>
                </p>
              )}
            </div>

            {/* Submission body */}
            <div className="bg-bgBase border border-bgHover rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-black uppercase tracking-widest text-shBlue">
                <i className="fas fa-clipboard-list mr-1" />Client's submission
              </p>
              {/* Mood */}
              {mood && (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">Mood:</span>
                  <span className="text-2xl">{["", "😞", "😅", "😐", "💪", "😄"][mood] || "—"}</span>
                  <span className="text-gray-300 text-[14px] font-black">{mood}/5</span>
                </div>
              )}
              {/* Field values */}
              <div className="space-y-1.5">
                {(dayObj?.fields || []).map(f => {
                  const v = submission.field_values?.[f.id];
                  if (v === undefined || v === "" || v === null) return null;
                  let display = v;
                  if (typeof v === "boolean") display = v ? "✓ yes" : "✗ no";
                  return (
                    <div key={f.id} className="flex justify-between items-start gap-3 border-b border-bgHover/40 pb-1.5 last:border-0">
                      <span className="text-[14px] font-black uppercase tracking-widest text-gray-500">{f.label}</span>
                      <span className="text-white text-[14px] font-black text-right whitespace-pre-wrap">{String(display)}</span>
                    </div>
                  );
                })}
              </div>
              {submission.note && (
                <div className="bg-bgPanel/60 rounded p-3 mt-2">
                  <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-1">Client's note</p>
                  <p className="text-gray-200 text-[14px] italic whitespace-pre-wrap">"{submission.note}"</p>
                </div>
              )}
              {photo && (
                <div className="mt-2">
                  <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-1">Photo</p>
                  <img src={photo} alt="Day submission" loading="lazy" className="max-h-72 rounded border border-bgHover" data-testid="review-photo" />
                </div>
              )}
              {submission.field_values?.__video_id && (
                <ReviewVideo homeworkId={active.homework_id} mediaId={submission.field_values.__video_id} />
              )}
            </div>

            {/* Question thread */}
            <QuestionThreadAdmin homeworkId={active.homework_id} dayNumber={active.day_number}
                                 questions={dayObj?.questions || []}
                                 onAnswered={async () => { const { data } = await api.get(`/homework/${active.homework_id}`); setActiveDetail(data); }} />

            {/* Review action */}
            <div className="bg-bgBase border border-bgHover rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-black uppercase tracking-widest text-shBlue">
                <i className="fas fa-comment mr-1" />Your note (optional — emailed to client)
              </p>
              <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} rows={3} data-testid="review-note"
                        placeholder="e.g., Great work! Tomorrow add the doorbell trigger. Or: try slowing down step 2 and resubmit."
                        className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
              {err && <p className="text-red-400 text-[14px] uppercase font-black">{err}</p>}
              <div className="flex gap-2 justify-end pt-2 border-t border-bgHover/50">
                <button onClick={() => review("needs_redo")} disabled={busy} data-testid="review-send-back"
                        className="bg-red-500/15 text-red-300 border border-red-500/40 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-red-500/25 disabled:opacity-50">
                  <i className="fas fa-rotate-left mr-1" />Send back for redo
                </button>
                <button onClick={() => review("approve")} disabled={busy} data-testid="review-approve"
                        className="bg-shGreen text-bgHeader px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
                  <i className="fas fa-check mr-1" />Approve · Unlock next day
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewVideo({ homeworkId, mediaId }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/homework/${homeworkId}/media/${mediaId}`);
        setSrc(data.data || "");
      } catch { /* ignore */ }
    })();
  }, [homeworkId, mediaId]);
  if (!src) return <p className="text-[13px] text-gray-500 mt-2 font-black uppercase tracking-widest"><i className="fas fa-spinner fa-spin mr-1"/>Loading video…</p>;
  return (
    <div className="mt-2" data-testid="review-video">
      <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-1">Video</p>
      <video src={src} controls playsInline className="max-h-72 rounded border border-bgHover w-full"/>
    </div>
  );
}

function QuestionThreadAdmin({ homeworkId, dayNumber, questions, onAnswered }) {
  const [openId, setOpenId] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const answer = async (qid) => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/homework/${homeworkId}/day/${dayNumber}/answer/${qid}`, { text });
      setText(""); setOpenId(null);
      await onAnswered?.();
    } finally { setBusy(false); }
  };

  if (!questions.length) return null;
  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-4 space-y-3" data-testid="admin-question-thread">
      <p className="text-[13px] font-black uppercase tracking-widest text-shBlue">
        <i className="fas fa-comments mr-1"/>Client's questions ({questions.length})
      </p>
      <div className="space-y-2">
        {questions.map(q => (
          <div key={q.id} className="bg-bgPanel/60 border border-bgHover rounded p-2.5">
            <p className="text-gray-200 text-[14px]">
              <span className="text-shBlue font-black uppercase text-[11px] tracking-widest mr-1">Q:</span>{q.text}
            </p>
            {q.answer ? (
              <p className="text-gray-100 mt-2 pl-2 border-l-2 border-shGreen/50 text-[14px]">
                <span className="text-shGreen font-black uppercase text-[11px] tracking-widest mr-1">A:</span>{q.answer}
                <span className="text-gray-500 text-[11px] ml-2">— {q.answered_by}</span>
              </p>
            ) : openId === q.id ? (
              <div className="flex gap-2 mt-2">
                <input value={text} onChange={(e) => setText(e.target.value)}
                       onKeyDown={(e) => e.key === "Enter" && answer(q.id)}
                       placeholder="Type your answer…"
                       data-testid={`answer-input-${q.id}`}
                       className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
                <button onClick={() => answer(q.id)} disabled={busy} data-testid={`answer-send-${q.id}`}
                        className="bg-shBlue text-white px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/80 disabled:opacity-50">
                  <i className="fas fa-paper-plane"/>
                </button>
              </div>
            ) : (
              <button onClick={() => { setOpenId(q.id); setText(""); }} data-testid={`answer-btn-${q.id}`}
                      className="text-shBlue hover:text-shBlue/80 text-[12px] font-black uppercase tracking-widest mt-2">
                <i className="fas fa-reply mr-1"/>Reply
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
