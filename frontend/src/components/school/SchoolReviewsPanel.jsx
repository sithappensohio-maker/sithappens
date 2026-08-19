// School HQ → Reviews — the ONE trainer review workspace. Two distinct
// review types share this screen without sharing a data model:
//   Practice  = coaching on a client's practice log (Looks Good / Keep
//               Practicing / Needs Trainer Attention — never a grade)
//   Checkpoints = formal graded assessments (opens the existing
//               CheckpointReviewQueue — the single grading implementation)
import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatErr } from "../../lib/api";
import { loadSchoolMediaUrl } from "../../lib/schoolMedia";
import EmptyState from "../premium/EmptyState";
import HuskyDogImage from "../brand/HuskyDogImage";

const DIFFICULTY_LABEL = { easy: "Easy", good: "Good", okay: "Okay", hard: "Hard", very_hard: "Very hard" };
const REVIEW_STATUS_META = {
  looks_good: { label: "Looks Good", cls: "bg-shPrimary/15 text-shPrimary border-shPrimary/40" },
  keep_practicing: { label: "Keep Practicing", cls: "bg-shSecondary/15 text-shSecondary border-shSecondary/40" },
  trainer_attention: { label: "Needs Trainer Attention", cls: "bg-shAccent/15 text-shAccent border-shAccent/40" },
};

function fmtWhen(iso) {
  if (!iso) return "";
  return `${(iso || "").slice(0, 10)} · ${(iso || "").slice(11, 16)}`;
}

function ReasonChips({ row }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {row.has_video && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-purple-500/15 text-purple-300 border-purple-400/40"><i className="fas fa-video mr-1" />Video</span>}
      {row.could_not_complete && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-red-500/15 text-red-300 border-red-500/40"><i className="fas fa-triangle-exclamation mr-1" />Couldn&apos;t complete</span>}
      {["hard", "very_hard"].includes(row.difficulty) && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-shAccent/15 text-shAccent border-shAccent/40"><i className="fas fa-gauge-high mr-1" />{DIFFICULTY_LABEL[row.difficulty]}</span>}
      {row.unanswered_questions > 0 && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-shSecondary/15 text-shSecondary border-shSecondary/40"><i className="fas fa-circle-question mr-1" />{row.unanswered_questions} question{row.unanswered_questions === 1 ? "" : "s"}</span>}
    </span>
  );
}

function PracticeRow({ row, onOpen, testid }) {
  const reviewed = REVIEW_STATUS_META[row.review_status];
  return (
    <button type="button" onClick={() => onOpen(row)} data-testid={testid}
            className="w-full text-left border border-shBorder/60 bg-black/20 rounded-2xl p-3.5 hover:border-shPrimary/40 hover:bg-white/[0.025] transition">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl overflow-hidden border border-shBorder/70 shrink-0 bg-black/30">
          <HuskyDogImage src={row.dog_photo} name={row.dog_name} alt={row.dog_name} className="w-full h-full object-cover object-top" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {reviewed
              ? <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${reviewed.cls}`}>{reviewed.label}</span>
              : <ReasonChips row={row} />}
            <span className="text-shTextMuted text-[10px] font-bold">{fmtWhen(row.logged_at)}</span>
          </div>
          <p className="text-shText font-black text-[14px] truncate">{row.dog_name || "Dog"} · {row.client_name || "Client"}</p>
          <p className="text-shTextMuted text-[12px] truncate mt-0.5">
            {[row.program_name, row.module_name, row.lesson_name].filter(Boolean).join(" · ") || row.practice_title}
            {row.day_number ? ` · Day ${row.day_number}` : ""}
          </p>
          {row.note && <p className="text-shTextMuted text-[12px] italic mt-1 truncate">&ldquo;{row.note}&rdquo;</p>}
        </div>
        <div className="hidden sm:grid w-9 h-9 rounded-xl border border-shBorder/60 place-items-center shrink-0"><i className="fas fa-chevron-right text-shTextMuted text-[11px]" /></div>
      </div>
    </button>
  );
}

function PracticeVideo({ mediaId }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true; let cleanup = () => {};
    loadSchoolMediaUrl(mediaId).then((media) => { if (!live) { media.revoke(); return; } cleanup = media.revoke; setSrc(media.url); }).catch(() => {});
    return () => { live = false; cleanup(); };
  }, [mediaId]);
  if (!src) return <p className="text-[12px] text-shTextMuted font-black uppercase tracking-widest"><i className="fas fa-spinner fa-spin mr-1" />Loading video…</p>;
  return <video src={src} controls playsInline className="w-full max-h-[420px] rounded-2xl border border-shBorder/55 bg-black/40" data-testid="practice-review-video" />;
}

function MetricTile({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="rounded-xl border border-shBorder/45 bg-black/15 p-2.5">
      <p className="text-[9px] font-black uppercase tracking-widest text-shTextMuted">{label}</p>
      <p className="text-[16px] font-black text-shText mt-0.5">{String(value)}</p>
    </div>
  );
}

function PracticeDetail({ row, onBack, onReviewed }) {
  const [feedback, setFeedback] = useState(row.review_note || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const m = row.metrics || {};
  const reviewed = REVIEW_STATUS_META[row.review_status];

  const review = async (status) => {
    setBusy(true); setErr("");
    try {
      await api.post(`/admin/school/practice-reviews/${row.homework_id}/${row.log_id}`, { status, note: feedback });
      onReviewed?.();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Couldn't save this review.");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="practice-review-detail">
      <button onClick={onBack} className="inline-flex items-center min-h-[42px] text-[12px] text-shTextMuted hover:text-shSecondary font-black" data-testid="practice-review-back">
        <i className="fas fa-chevron-left mr-1" />Back to Reviews
      </button>

      <div className="rounded-2xl border border-shBorder/60 bg-black/15 p-4">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-2xl overflow-hidden border border-shPrimary/25 shrink-0"><HuskyDogImage src={row.dog_photo} name={row.dog_name} alt={row.dog_name} className="w-full h-full object-cover object-top" /></div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-shPrimary">Practice review · coaching, not a grade</p>
            <h4 className="text-shText text-lg font-black tracking-tight mt-1 truncate">{row.dog_name || "Dog"} <span className="text-shTextMuted font-medium">· {row.client_name || "Client"}</span></h4>
            <p className="text-shTextMuted text-[12px] mt-0.5 truncate">{[row.program_name, row.module_name, row.lesson_name].filter(Boolean).join(" · ") || row.practice_title}{row.day_number ? ` · Day ${row.day_number}` : ""}</p>
            <p className="text-shTextMuted text-[11px] mt-0.5">{fmtWhen(row.logged_at)}</p>
          </div>
        </div>
      </div>

      {row.video_media_id && <PracticeVideo mediaId={row.video_media_id} />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="practice-review-metrics">
        <MetricTile label="Reps attempted" value={m.reps_attempted} />
        <MetricTile label="Successful reps" value={m.successful_reps} />
        <MetricTile label="Success rate" value={m.success_rate != null ? `${m.success_rate}%` : null} />
        <MetricTile label="Rounds" value={m.rounds_completed} />
      </div>

      <div className="flex flex-wrap gap-2">
        {row.difficulty && <span className="text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border bg-black/20 border-shBorder/55 text-shText"><i className="fas fa-gauge-high mr-1 text-shSecondary" />Difficulty: {DIFFICULTY_LABEL[row.difficulty] || row.difficulty}</span>}
      </div>

      {row.could_not_complete && (
        <div className="rounded-xl border border-red-400/30 bg-red-500/[0.06] p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-red-300"><i className="fas fa-triangle-exclamation mr-1" />Could not complete</p>
          {row.could_not_complete_reason && <p className="text-[13px] text-gray-200 mt-1 whitespace-pre-wrap">{row.could_not_complete_reason}</p>}
        </div>
      )}

      {row.note && (
        <div className="rounded-xl border border-shBorder/50 bg-black/15 p-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1"><i className="fas fa-comment mr-1" />Client&apos;s note</p>
          <p className="text-gray-200 text-[13px] italic whitespace-pre-wrap">&ldquo;{row.note}&rdquo;</p>
        </div>
      )}

      {row.unanswered_questions > 0 && (
        <div className="rounded-xl border border-shSecondary/35 bg-shSecondary/[0.05] p-3" data-testid="practice-review-question-note">
          <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-circle-question mr-1" />{row.unanswered_questions} unanswered client question{row.unanswered_questions === 1 ? "" : "s"}</p>
          <p className="text-[12px] text-shTextMuted mt-1">Reviewing this practice does not answer their question — reply from the Practice record so it reaches them.</p>
        </div>
      )}

      {err && <p className="text-red-400 text-[13px] uppercase font-black" data-testid="practice-review-error">{err}</p>}

      {reviewed ? (
        <div className={`rounded-xl border p-3 ${reviewed.cls}`} data-testid="practice-review-already">
          <p className="text-[11px] font-black uppercase tracking-widest">Reviewed · {reviewed.label}{row.reviewed_by ? ` · ${row.reviewed_by}` : ""}</p>
          {row.review_note && <p className="text-[12px] mt-1 whitespace-pre-wrap">{row.review_note}</p>}
        </div>
      ) : (
        <div className="bg-black/15 border border-shBorder/55 rounded-2xl p-4 space-y-3" data-testid="practice-review-actions">
          <p className="text-[12px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-comment mr-1" />Trainer feedback</p>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} data-testid="practice-review-feedback"
                    placeholder="Coaching for the client — what went well, what to adjust next session…"
                    className="w-full min-h-[96px] bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-shSecondary/40" />
          <div className="grid grid-cols-1 sm:flex gap-2 sm:justify-end">
            <button onClick={() => review("trainer_attention")} disabled={busy} data-testid="practice-review-trainer-attention"
                    className="min-h-[46px] bg-shAccent/10 text-shAccent border border-shAccent/30 px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shAccent/15 disabled:opacity-50">
              <i className="fas fa-hand-holding-heart mr-1" />Needs Trainer Attention
            </button>
            <button onClick={() => review("keep_practicing")} disabled={busy} data-testid="practice-review-keep-practicing"
                    className="min-h-[46px] bg-shSecondary/10 text-shSecondary border border-shSecondary/30 px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shSecondary/15 disabled:opacity-50">
              <i className="fas fa-rotate mr-1" />Keep Practicing
            </button>
            <button onClick={() => review("looks_good")} disabled={busy} data-testid="practice-review-looks-good"
                    className="min-h-[46px] bg-shPrimary text-bgHeader px-5 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shPrimary/85 disabled:opacity-50">
              <i className="fas fa-thumbs-up mr-1" />Looks Good
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckpointRow({ it, onOpen, testid }) {
  return (
    <button type="button" onClick={() => onOpen(it)} data-testid={testid}
            className="w-full text-left border border-shBorder/60 bg-black/20 rounded-2xl p-3.5 hover:border-shAccent/40 hover:bg-white/[0.025] transition">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl overflow-hidden border border-shBorder/70 shrink-0 bg-black/30">
          <HuskyDogImage src={it.dog_photo} name={it.dog_name} alt={it.dog_name} className="w-full h-full object-cover object-top" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-shAccent/15 text-shAccent border-shAccent/40"><i className="fas fa-clipboard-check mr-1" />Checkpoint</span>
            {it.video_media_id && <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border bg-purple-500/15 text-purple-300 border-purple-400/40"><i className="fas fa-video mr-1" />Video</span>}
            <span className="text-shTextMuted text-[10px] font-bold">{fmtWhen(it.submitted_at)}</span>
          </div>
          <p className="text-shText font-black text-[14px] truncate">{it.dog_name} · {it.client_name}</p>
          <p className="text-shTextMuted text-[12px] truncate mt-0.5">{it.lesson_name}</p>
          {it.client_note && <p className="text-shTextMuted text-[12px] italic mt-1 truncate">&ldquo;{it.client_note}&rdquo;</p>}
        </div>
        <div className="hidden sm:grid w-9 h-9 rounded-xl border border-shBorder/60 place-items-center shrink-0"><i className="fas fa-chevron-right text-shTextMuted text-[11px]" /></div>
      </div>
    </button>
  );
}

export default function SchoolReviewsPanel({ summary, initialReviewType = null, initialTarget = null, onOpenCheckpoint, onChanged }) {
  const [sub, setSub] = useState(initialReviewType === "checkpoints" ? "checkpoints" : "practice");
  const [pending, setPending] = useState(null);
  const [recent, setRecent] = useState(null);
  const [showRecent, setShowRecent] = useState(false);
  const [checkpoints, setCheckpoints] = useState(null);
  const [active, setActive] = useState(null);
  const targetHandled = useRef(false);

  const loadPractice = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/school/practice-reviews/pending", { params: { limit: 100 } });
      setPending(data || []);
    } catch { setPending([]); }
  }, []);
  const loadRecent = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/school/practice-reviews/recent", { params: { limit: 30 } });
      setRecent(data || []);
    } catch { setRecent([]); }
  }, []);
  const loadCheckpoints = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/school/checkpoints/pending");
      setCheckpoints(data || []);
    } catch { setCheckpoints([]); }
  }, []);

  useEffect(() => { loadPractice(); loadCheckpoints(); }, [loadPractice, loadCheckpoints]);
  useEffect(() => { if (showRecent && recent === null) loadRecent(); }, [showRecent, recent, loadRecent]);

  // Deep-link: open the exact practice submission once the queue loads.
  useEffect(() => {
    if (targetHandled.current || !initialTarget?.section_log_id) return;
    const pool = [...(pending || []), ...(recent || [])];
    const hit = pool.find((r) => r.log_id === initialTarget.section_log_id);
    if (hit) { setActive(hit); setSub("practice"); targetHandled.current = true; }
    else if (pending !== null && recent === null) { setShowRecent(true); }
  }, [pending, recent, initialTarget]);

  const practiceCount = summary?.practice_reviews_pending ?? (pending || []).length;
  const checkpointCount = summary?.checkpoints_pending ?? (checkpoints || []).length;

  const reviewedNow = async () => {
    setActive(null);
    await loadPractice();
    if (recent !== null) await loadRecent();
    onChanged?.();
  };

  if (active) {
    return <PracticeDetail row={active} onBack={() => setActive(null)} onReviewed={reviewedNow} />;
  }

  return (
    <div className="space-y-4" data-testid="school-reviews-panel">
      {/* Sub-navigation — two distinct review types, one workspace. */}
      <div className="flex flex-wrap gap-2" data-testid="school-reviews-subnav">
        <button type="button" onClick={() => setSub("practice")} data-testid="reviews-subtab-practice"
                className={`min-h-[44px] px-4 rounded-xl border text-[12px] font-black uppercase tracking-widest transition ${sub === "practice" ? "bg-shPrimary/15 border-shPrimary/45 text-shPrimary" : "bg-black/15 border-shBorder/55 text-shTextMuted hover:text-shText"}`}>
          <i className="fas fa-dumbbell mr-1.5" />Practice
          {practiceCount > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-md bg-shPrimary/20 text-shPrimary text-[10px]" data-testid="reviews-practice-badge">{practiceCount}</span>}
        </button>
        <button type="button" onClick={() => setSub("checkpoints")} data-testid="reviews-subtab-checkpoints"
                className={`min-h-[44px] px-4 rounded-xl border text-[12px] font-black uppercase tracking-widest transition ${sub === "checkpoints" ? "bg-shAccent/15 border-shAccent/45 text-shAccent" : "bg-black/15 border-shBorder/55 text-shTextMuted hover:text-shText"}`}>
          <i className="fas fa-clipboard-check mr-1.5" />Checkpoints
          {checkpointCount > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-md bg-shAccent/20 text-shAccent text-[10px]" data-testid="reviews-checkpoints-badge">{checkpointCount}</span>}
        </button>
      </div>

      {sub === "practice" && (
        <div className="space-y-3" data-testid="reviews-practice-pane">
          <p className="text-[12px] font-black uppercase tracking-[0.28em] text-shTextMuted"><i className="fas fa-bell mr-1.5 text-shPrimary" />Needs review</p>
          {pending === null ? (
            <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
          ) : pending.length === 0 ? (
            <EmptyState icon="fa-mug-hot" accent="lime" title="All caught up" description="No practice submissions are waiting on a trainer right now." />
          ) : (
            <div className="space-y-2">
              {pending.map((row, i) => <PracticeRow key={row.log_id} row={row} onOpen={setActive} testid={`practice-review-row-${i}`} />)}
            </div>
          )}

          <button type="button" onClick={() => setShowRecent((v) => !v)} data-testid="reviews-toggle-recent"
                  className="min-h-[44px] inline-flex items-center text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">
            {showRecent ? "Hide recent practice" : "Show recent practice"} <i className={`fas fa-chevron-${showRecent ? "up" : "down"} ml-1.5`} />
          </button>
          {showRecent && (
            <div className="space-y-2" data-testid="reviews-recent-pane">
              <p className="text-[12px] font-black uppercase tracking-[0.28em] text-shTextMuted"><i className="fas fa-stream mr-1.5 text-shSecondary" />Recent practice</p>
              {recent === null ? (
                <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
              ) : recent.length === 0 ? (
                <p className="text-[13px] text-shTextMuted">No practice has been logged yet.</p>
              ) : (
                recent.map((row, i) => <PracticeRow key={`r-${row.log_id}`} row={row} onOpen={setActive} testid={`practice-recent-row-${i}`} />)
              )}
            </div>
          )}
        </div>
      )}

      {sub === "checkpoints" && (
        <div className="space-y-3" data-testid="reviews-checkpoints-pane">
          <p className="text-[12px] font-black uppercase tracking-[0.28em] text-shTextMuted"><i className="fas fa-clipboard-check mr-1.5 text-shAccent" />Awaiting grading</p>
          {checkpoints === null ? (
            <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
          ) : checkpoints.length === 0 ? (
            <EmptyState icon="fa-mug-hot" accent="lime" title="All caught up" description="No checkpoints are waiting for review." />
          ) : (
            <div className="space-y-2">
              {checkpoints.map((it, i) => <CheckpointRow key={it.id} it={it} onOpen={(row) => onOpenCheckpoint?.(row.id)} testid={`checkpoint-queue-row-${i}`} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
