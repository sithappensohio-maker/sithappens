// School redesign — shared circular progress ring. Purely presentational:
// callers pass a real percentage from data the app already owns.
export default function ProgressRing({ pct = 0, size = 92, label = "Complete", testid }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-testid={testid} aria-hidden="true">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sh-border)" strokeWidth="7" opacity="0.5"/>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sh-primary)" strokeWidth="7"
                strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - clamped / 100)}/>
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center">
        <span>
          <span className="block text-[20px] font-black text-shText leading-none">{Math.round(clamped)}%</span>
          {label && <span className="block text-[8px] font-black uppercase tracking-widest text-shTextMuted mt-0.5">{label}</span>}
        </span>
      </span>
    </div>
  );
}
