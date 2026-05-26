/**
 * Sprint 110m — Plan progress ring for client-portal homework cards.
 *
 * Compact circular indicator showing percent complete + "Day N of M" so
 * clients can scan momentum across all their plans at a glance.
 *
 * Pure SVG (no chart library) — instant render, no layout shift.
 */
export default function PlanProgressRing({ pct = 0, current = 0, total = 0, completed = 0, size = 76, stroke = 7, testid }) {
  const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - safePct / 100);
  // Ring color shifts by progress so finished plans glow green, mid runs
  // shine cyan, and brand new plans stay subtle.
  const ringColor =
    safePct >= 100 ? "#8cc63f" :   // shGreen
    safePct >= 60  ? "#00a9e0" :   // shBlue
    safePct >= 25  ? "#f59e0b" :   // amber
                     "#94a3b8";    // slate-400
  return (
    <div className="shrink-0 flex flex-col items-center"
         data-testid={testid}
         title={`${completed} of ${total} day${total === 1 ? "" : "s"} done`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius}
                  fill="none" stroke="#1e293b" strokeWidth={stroke}/>
          <circle cx={size / 2} cy={size / 2} r={radius}
                  fill="none" stroke={ringColor} strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={offset}
                  style={{ transition: "stroke-dashoffset 600ms ease-out, stroke 300ms" }}/>
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center leading-none">
            <p className="text-[15px] font-black text-white">{safePct}%</p>
          </div>
        </div>
      </div>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">
        Day <span className="text-white">{current || 1}</span>/{total || 1}
      </p>
    </div>
  );
}
