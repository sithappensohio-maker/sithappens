import NeonEdge from "../premium/NeonEdge";
import NeonIconStage from "../premium/NeonIconStage";
import { accentRgb } from "../premium/tokens";

export default function AdminStatCard({ icon, value, label, detail, accent = "lime", intensity = "standard", onClick, testid }) {
  const Tag = onClick ? "button" : "div";
  return (
    <NeonEdge as={Tag} onClick={onClick} accentRgb={accentRgb(accent)} intensity={intensity}
              className={`sh-admin-stat text-left w-full ${onClick ? "hover:-translate-y-0.5 transition" : ""}`}
              data-testid={testid}>
      <NeonIconStage icon={icon} accentRgb={accentRgb(accent)} rings={false} sizeClass="w-11 h-11 sm:w-12 sm:h-12" iconSizeClass="text-base sm:text-lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-[26px] sm:text-[30px] font-black text-shText leading-none">{value}</p>
          <p className="text-[12px] font-bold text-shTextMuted truncate">{label}</p>
        </div>
        {detail && <p className="text-[11px] text-shTextMuted mt-1 truncate opacity-80">{detail}</p>}
      </div>
      {onClick && <i className="fas fa-arrow-right text-[11px] text-shTextMuted/60 shrink-0" />}
    </NeonEdge>
  );
}
