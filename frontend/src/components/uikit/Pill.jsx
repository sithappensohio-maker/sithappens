/* Redesign Phase A — shared status Pill/badge primitive. */
const TONES = {
  muted: "bg-shSurfaceRaised text-shTextMuted",
  primary: "bg-shPrimary/15 text-shPrimary border border-shPrimary/30",
  secondary: "bg-shSecondary/15 text-shSecondary border border-shSecondary/30",
  accent: "bg-shAccent/15 text-shAccent border border-shAccent/30",
  danger: "bg-shDanger/15 text-red-400 border border-shDanger/30",
};

export default function Pill({ tone = "muted", className = "", children, ...rest }) {
  const toneClass = TONES[tone] || TONES.muted;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${toneClass} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}
