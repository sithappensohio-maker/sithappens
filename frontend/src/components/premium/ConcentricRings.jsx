function polar(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const TICK_ANGLES = [20, 65, 110, 160, 200, 245, 290, 335];
const DOT_ANGLES = [40, 130, 220, 310];

/* Reusable radar/ripple ring graphic behind a premium-card icon: a faint
 * full outer ring, a broken/dashed arc ring, a brighter mid ring, a thin
 * dashed inner ring, radial ticks, and a few orbit dots — all static SVG
 * in one accent color at varying opacity. No animation, no randomness. */
export default function ConcentricRings({ accentRgb, strong = false }) {
  const cx = 100, cy = 100;
  const boost = strong ? 1 : 0;

  return (
    <svg viewBox="0 0 200 200" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      {/* faint outer arc — kept subdued so the mid ring reads as the star */}
      <circle cx={cx} cy={cy} r={94} fill="none" stroke={`rgba(${accentRgb},${0.13 + boost * 0.04})`} strokeWidth="1" />
      <circle cx={cx} cy={cy} r={80} fill="none" stroke={`rgba(${accentRgb},${0.28 + boost * 0.08})`} strokeWidth="1.25"
              strokeDasharray="36 14 8 22 18 16" strokeLinecap="round" />
      {/* brighter inner ring — the main graphic focal ring */}
      <circle cx={cx} cy={cy} r={62} fill="none" stroke={`rgba(${accentRgb},${0.52 + boost * 0.18})`} strokeWidth={strong ? 2 : 1.75} />
      <circle cx={cx} cy={cy} r={46} fill="none" stroke={`rgba(${accentRgb},${0.36 + boost * 0.1})`} strokeWidth="1"
              strokeDasharray="4 6" />
      {TICK_ANGLES.map((angle, i) => {
        const [x1, y1] = polar(cx, cy, 96, angle);
        const [x2, y2] = polar(cx, cy, 104, angle);
        return (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={`rgba(${accentRgb},${0.42 + boost * 0.16})`} strokeWidth="1.5" strokeLinecap="round" />
        );
      })}
      {DOT_ANGLES.map((angle, i) => {
        const [x, y] = polar(cx, cy, 71, angle);
        return <circle key={i} cx={x} cy={y} r={strong ? 2.25 : 1.75} fill={`rgba(${accentRgb},${0.62 + boost * 0.2})`} />;
      })}
    </svg>
  );
}
