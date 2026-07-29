import NeonEdge from "./NeonEdge";
import NeonIconStage from "./NeonIconStage";
import { accentRgb, HOVER_BORDER_CLASS } from "./tokens";

/* Reusable small tile with a glowing icon + label — Quick Actions and
 * similar grids. Deliberately no concentric rings (rings={false}) so a
 * grid of these doesn't turn into a wall of radar graphics. */
export default function MiniActionCard({ icon, label, accent = "lime", onClick, badge = 0, testid, wide = false }) {
  const rgb = accentRgb(accent);
  return (
    <button type="button" onClick={onClick} data-testid={testid} className={`relative text-left ${wide ? "col-span-2" : ""}`}>
      <NeonEdge
        accentRgb={rgb}
        intensity="subtle"
        className={`flex flex-col items-center justify-center gap-1.5 min-h-[68px] px-3 py-2.5 transition duration-200 hover:-translate-y-0.5 w-full ${HOVER_BORDER_CLASS[accent] || ""}`}
      >
        <NeonIconStage icon={icon} accentRgb={rgb} rings={false} sizeClass="w-8 h-8" iconSizeClass="text-sm" />
        <span className="text-[11px] sm:text-[12px] text-shText font-semibold text-center leading-tight">{label}</span>
      </NeonEdge>
      {badge > 0 && (
        <span style={{ position: "absolute" }} className="z-10 -top-1 -right-1 min-w-[19px] h-[19px] px-1 rounded-full bg-shAccent text-white text-[10px] font-black grid place-items-center">
          {badge}
        </span>
      )}
    </button>
  );
}
