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
// Sprint 110ak — tier-coloured border used by the freeform layout, where the
// circular tier ring is dropped in favour of the design itself.
const TIER_BORDER = {
  bronze: "border-amber-600/70",
  silver: "border-slate-300/70",
  gold: "border-yellow-400/80",
  platinum: "border-cyan-300/80",
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
  // Awarded trophies snapshot the catalog image as `trophy_custom_image` at
  // award-time (see trophy_service.award_trophy). Definitions store it as
  // `custom_image`. Check both so the badge shows the uploaded picture on
  // dog/client cards instead of falling back to the icon placeholder.
  const image = t.trophy_custom_image || t.custom_image || "";
  // Sprint 110ak — image_fit chooses how the upload fills the badge:
  //   "circle"   — cover-crop, full bleed circle (legacy default)
  //   "contain"  — fit inside the circle, keep the tier ring
  //   "freeform" — no clip / no ring; design IS the trophy, rendered as a
  //                rounded square with a thin tier-coloured border
  const imageFit = t.trophy_image_fit || t.image_fit || "circle";
  const dim = size === "sm" ? "w-12 h-12 text-xl" : size === "lg" ? "w-28 h-28 text-5xl" : "w-20 h-20 text-3xl";
  const ring = TIER_RING[tier] || TIER_RING.bronze;
  const txt = TIER_TEXT[tier] || TIER_TEXT.bronze;
  const tierBorder = TIER_BORDER[tier] || TIER_BORDER.bronze;

  // Freeform: rectangular card, no circle clip, thin tier border so the
  // bronze/silver/gold/platinum signal isn't lost.
  if (image && imageFit === "freeform") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={name}
        data-testid={testId || `trophy-${t.trophy_code || t.code || "badge"}`}
        className={`relative ${dim} rounded-2xl bg-bgBase grid place-items-center transition transform overflow-hidden border-2 ${tierBorder} shadow-lg ${onClick ? "hover:scale-105 cursor-pointer" : "cursor-default"} ${locked ? "opacity-30 grayscale" : ""}`}
      >
        <img src={image} alt={name} className="w-full h-full object-contain"/>
        {locked && <i className="fas fa-lock absolute bottom-0 right-0 text-[12px] bg-bgBase rounded-full p-1 text-gray-400"/>}
      </button>
    );
  }

  // Circle (legacy) and Contain — both keep the round badge + tier ring.
  // Difference is `object-cover` (crop) vs `object-contain` (whole design,
  // blank padding inside the circle).
  const imgClass = imageFit === "contain"
    ? "w-[88%] h-[88%] object-contain"
    : "w-full h-full object-cover";
  // Sprint 110al — focal point for circle mode. Admin can drag the upload
  // around to pick which part of the image stays visible after the cover-crop.
  const offX = typeof (t.trophy_image_offset_x ?? t.image_offset_x) === "number"
    ? (t.trophy_image_offset_x ?? t.image_offset_x) : 50;
  const offY = typeof (t.trophy_image_offset_y ?? t.image_offset_y) === "number"
    ? (t.trophy_image_offset_y ?? t.image_offset_y) : 50;
  const imgStyle = imageFit === "circle" ? { objectPosition: `${offX}% ${offY}%` } : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      title={name}
      data-testid={testId || `trophy-${t.trophy_code || t.code || "badge"}`}
      className={`relative ${dim} rounded-full bg-gradient-to-br ${ring} ring-2 grid place-items-center transition transform ${onClick ? "hover:scale-105 cursor-pointer" : "cursor-default"} ${locked ? "opacity-30 grayscale" : ""}`}
    >
      {image ? (
        <img src={image} alt={name} style={imgStyle} className={`${imgClass} rounded-full`}/>
      ) : (
        <i className={`fas ${icon} ${txt} drop-shadow`}/>
      )}
      {locked && <i className="fas fa-lock absolute bottom-0 right-0 text-[12px] bg-bgBase rounded-full p-1 text-gray-400"/>}
    </button>
  );
}
