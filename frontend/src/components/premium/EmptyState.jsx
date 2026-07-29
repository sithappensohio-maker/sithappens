import { accentRgb, HOVER_BORDER_CLASS } from "./tokens";

/* Reusable premium empty-state pattern (extracted from My Dogs' "no dogs
 * yet" state) — dashed border, glowing icon circle, optional CTA pill. */
export default function EmptyState({ icon = "fa-circle-info", accent = "lime", title, description, ctaLabel, onClick, testId }) {
  const rgb = accentRgb(accent);
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      className={`w-full border border-dashed border-shBorder rounded-xl p-5 text-center transition duration-200 ${onClick ? `hover:-translate-y-0.5 ${HOVER_BORDER_CLASS[accent] || ""}` : ""}`}
    >
      <span
        className="inline-flex w-12 h-12 rounded-full items-center justify-center"
        style={{ background: `rgba(${rgb},0.15)`, border: `1px solid rgba(${rgb},0.3)`, boxShadow: `0 0 18px -5px rgba(${rgb},0.45)` }}
      >
        <i className={`fas ${icon} text-xl`} style={{ color: `rgb(${rgb})` }} />
      </span>
      <p className="text-shText font-bold text-[14px] mt-3">{title}</p>
      {description && <p className="text-[13px] text-shTextMuted mt-1">{description}</p>}
      {ctaLabel && (
        <span className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-full text-[12px] font-black uppercase tracking-widest text-bgHeader" style={{ background: `rgb(${rgb})` }}>
          {ctaLabel}
        </span>
      )}
    </Comp>
  );
}
