/* Handler Skills vs Dog Performance — a product-fundamental distinction shown
 * together, in plain language, never merged into one generic grade. Reused by
 * the feedback card and (later) the feedback/progress screens. */
export function scoreTone(score) {
  if (score == null) return { color: "text-shTextMuted", bar: "148,163,184" };
  if (score >= 8) return { color: "text-shPrimary", bar: "140,198,63" };
  if (score >= 5) return { color: "text-shSecondary", bar: "0,169,224" };
  return { color: "text-shAccent", bar: "242,101,34" };
}

function ScoreRow({ label, help, score }) {
  const tone = scoreTone(score);
  const pct = score == null ? 0 : Math.max(0, Math.min(100, (score / 10) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[13px] font-black text-shText">{label}</p>
        <p className={`text-[15px] font-black ${tone.color}`}>{score == null ? "—" : `${score}/10`}</p>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-shBorder/60 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `rgb(${tone.bar})` }} />
      </div>
      {help && <p className="text-[11.5px] text-shTextMuted mt-1 leading-snug">{help}</p>}
    </div>
  );
}

export default function ScorePair({ handler, dog, compact = false }) {
  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"} data-testid="score-pair">
      <ScoreRow label="Handler Skills" score={handler}
                help={compact ? null : "How well you're performing the technique."} />
      <ScoreRow label="Dog Performance" score={dog}
                help={compact ? null : "How consistently your dog can do it right now."} />
    </div>
  );
}
