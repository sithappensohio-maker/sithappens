import NeonEdge from "../premium/NeonEdge";
import NeonIconStage from "../premium/NeonIconStage";
import { accentRgb } from "../premium/tokens";

/* Compact admin dashboard stat tile — STANDARD intensity by default (per the
 * effect-intensity hierarchy: hero is reserved for Needs Attention/critical
 * alerts, not routine stat counts). */
export default function AdminStatCard({ icon, value, label, detail, accent = "lime", intensity = "standard", onClick, testid }) {
  const Tag = onClick ? "button" : "div";
  return (
    <NeonEdge as={Tag} onClick={onClick} accentRgb={accentRgb(accent)} intensity={intensity}
              className={`p-3 sm:p-4 flex items-center gap-3 text-left w-full ${onClick ? "hover:-translate-y-0.5 transition" : ""}`}
              data-testid={testid}>
      <NeonIconStage icon={icon} accentRgb={accentRgb(accent)} rings={false} sizeClass="w-10 h-10 sm:w-12 sm:h-12" iconSizeClass="text-base sm:text-lg" />
      <div className="min-w-0">
        <p className="text-xl sm:text-2xl font-bold text-shText leading-none">{value}</p>
        <p className="text-[11px] font-bold uppercase tracking-widest text-shTextMuted mt-1 truncate">{label}</p>
        {detail && <p className="text-[11px] text-shTextMuted mt-0.5 truncate opacity-80">{detail}</p>}
      </div>
    </NeonEdge>
  );
}
