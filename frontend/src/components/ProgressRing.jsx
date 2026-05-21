/* Circular SVG progress ring. Pure presentation. */
export default function ProgressRing({ percent = 0, size = 140, stroke = 12, color = "#8cc63f", label = "" }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safePercent = Math.max(0, Math.min(100, percent || 0));
  const dash = (safePercent / 100) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1e293b" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
                strokeLinecap="round" strokeDasharray={`${dash} ${circumference}`}
                style={{ transition: "stroke-dasharray 600ms ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-black text-white">{safePercent}%</span>
        {label && <span className="text-[14px] text-gray-400 font-black uppercase tracking-widest mt-0.5">{label}</span>}
      </div>
    </div>
  );
}
