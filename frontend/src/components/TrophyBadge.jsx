import React from "react";

const TIER_RING = {
  bronze: "ring-amber-700 from-amber-900/40 to-amber-700/10",
  silver: "ring-slate-300 from-slate-700/40 to-slate-500/10",
  gold: "ring-yellow-400 from-yellow-700/40 to-yellow-400/10",
  platinum: "ring-cyan-300 from-cyan-700/40 to-cyan-400/10",
};
const TIER_TEXT = {
  bronze: "text-amber-400",
  silver: "text-slate-200",
  gold: "text-yellow-300",
  platinum: "text-cyan-200",
};

/**
 * Reusable trophy badge. Pass either:
 *   - `trophy` (full awarded_trophies row), OR
 *   - `definition` (raw catalog item) when previewing in the admin UI.
 * Size: "sm" (40px), "md" (64px), "lg" (96px).
 */
export default function TrophyBadge({ trophy, definition, size = "md", onClick, locked = false, "data-testid": testId }) {
  const t = trophy || definition || {};
  const tier = t.trophy_tier || t.tier || "bronze";
  const icon = t.trophy_icon || t.icon || "fa-trophy";
  const name = t.trophy_name || t.name || "Trophy";
  const image = t.custom_image || ""; // optional admin-uploaded override
  const dim = size === "sm" ? "w-12 h-12 text-xl" : size === "lg" ? "w-28 h-28 text-5xl" : "w-20 h-20 text-3xl";
  const ring = TIER_RING[tier] || TIER_RING.bronze;
  const txt = TIER_TEXT[tier] || TIER_TEXT.bronze;
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      data-testid={testId || `trophy-${t.trophy_code || t.code || "badge"}`}
      className={`relative ${dim} rounded-full bg-gradient-to-br ${ring} ring-2 grid place-items-center transition transform ${onClick ? "hover:scale-105 cursor-pointer" : "cursor-default"} ${locked ? "opacity-30 grayscale" : ""}`}
    >
      {image ? (
        <img src={image} alt={name} className="w-full h-full rounded-full object-cover"/>
      ) : (
        <i className={`fas ${icon} ${txt} drop-shadow`}/>
      )}
      {locked && <i className="fas fa-lock absolute bottom-0 right-0 text-[10px] bg-bgBase rounded-full p-1 text-gray-400"/>}
    </button>
  );
}
