import NeonEdge from "./NeonEdge";
import NeonIconStage from "./NeonIconStage";

/* Reusable premium primary-action card: NeonEdge shell + NeonIconStage +
 * title/description + a flatter, glowing CTA rectangle. Built as a shared
 * system (not three hand-hacked card blocks) so Book/Shop/Photography stay
 * one visual family and this can be reused later (e.g. on Admin). */
export default function PremiumActionCard({
  icon, title, description, ctaLabel, accentRgb, strong = false, sparkle = false,
  badge, cartCount = 0, onClick, testId,
}) {
  return (
    <NeonEdge
      as="button"
      onClick={onClick}
      data-testid={testId}
      accentRgb={accentRgb}
      strong={strong}
      className="flex items-center gap-3 text-left p-4 sm:flex-col sm:items-center sm:text-center sm:gap-2 sm:p-5 transition duration-200 hover:-translate-y-1 hover:shadow-2xl"
    >
      {badge && (
        <span
          style={{ position: "absolute", background: `rgba(${accentRgb},0.14)`, border: `1px solid rgba(${accentRgb},0.55)` }}
          className="z-10 top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wide"
        >
          <i className="fas fa-star text-[9px]" style={{ color: `rgb(${accentRgb})` }} />
          <span style={{ color: `rgb(${accentRgb})` }}>{badge}</span>
        </span>
      )}
      {cartCount > 0 && (
        <span style={{ position: "absolute" }} className="z-10 top-3 left-3 min-w-[20px] h-5 px-1.5 bg-shAccent text-white text-[11px] font-black rounded-full grid place-items-center">
          {cartCount}
        </span>
      )}

      <NeonIconStage
        icon={icon}
        accentRgb={accentRgb}
        strong={strong}
        sparkle={sparkle}
        sizeClass={strong ? "w-16 h-16 sm:w-36 sm:h-36" : "w-16 h-16 sm:w-32 sm:h-32"}
        iconSizeClass={strong ? "text-3xl sm:text-6xl" : "text-3xl sm:text-5xl"}
      />

      <div className="relative z-10 flex-1 min-w-0 sm:flex-none sm:mt-0.5">
        <h3 className={`text-[16px] ${strong ? "sm:text-3xl" : "sm:text-2xl"} font-black text-white tracking-tight truncate sm:truncate-none sm:text-center`}>
          {title}
        </h3>
        <p className="text-[12px] sm:text-[13px] text-gray-300/85 leading-snug mt-0.5 sm:mt-1 truncate sm:whitespace-normal sm:truncate-none sm:text-center sm:max-w-[250px] sm:mx-auto">
          {description}
        </p>
      </div>

      <i className="relative z-10 fas fa-chevron-right text-shTextMuted text-sm shrink-0 sm:hidden" />

      <span
        className="relative z-10 hidden sm:inline-flex mt-2 items-center gap-1.5 px-5 py-2.5 rounded-md text-[13px] font-black text-bgHeader overflow-hidden"
        style={{ background: `rgb(${accentRgb})`, boxShadow: `0 8px 20px -8px rgba(${accentRgb},${strong ? 0.7 : 0.6})` }}
      >
        <span className="pointer-events-none absolute inset-0 rounded-md" style={{ background: "linear-gradient(to bottom, rgba(255,255,255,0.45), transparent 55%)" }} />
        <span className="relative z-10">{ctaLabel}</span>
        <i className="fas fa-arrow-right text-[11px] relative z-10" />
      </span>
    </NeonEdge>
  );
}
