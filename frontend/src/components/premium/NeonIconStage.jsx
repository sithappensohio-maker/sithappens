import ConcentricRings from "./ConcentricRings";

/* Reusable illuminated icon focal-point: a dark radial "well" + concentric
 * rings behind a crisp icon lit by layered drop-shadows (not blurred).
 * This — not a big translucent background fill — is what should read as
 * the card's light source. */
export default function NeonIconStage({
  icon, accentRgb, strong = false, sparkle = false, rings = true,
  sizeClass = "w-14 h-14 sm:w-24 sm:h-24",
  iconSizeClass = "text-2xl sm:text-3xl",
}) {
  return (
    <div className={`relative shrink-0 ${sizeClass}`}>
      <div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, rgba(${accentRgb},${strong ? 0.22 : 0.16}) 0%, rgba(0,0,0,0.6) 55%, transparent 78%)` }}
      />
      {/* Radar rings are the hero/standard treatment — small mini-tiles
          (Quick Actions etc.) pass rings={false} to stay a plain glowing
          icon, per "not radar rings on every box". */}
      {rings && <ConcentricRings accentRgb={accentRgb} strong={strong} />}
      <div className="absolute inset-0 grid place-items-center">
        <i
          className={`fas ${icon} ${iconSizeClass}`}
          style={{
            color: `rgb(${accentRgb})`,
            /* Small TIGHT glow keeps the glyph crisp; medium + large bloom
               layers carry the illumination outward without smearing the
               icon shape itself (medium layer intentionally lighter than
               before — that's what was making Book Now read as mushy). */
            filter: `drop-shadow(0 0 1.5px rgba(${accentRgb},0.95)) drop-shadow(0 0 6px rgba(${accentRgb},0.5)) drop-shadow(0 0 ${strong ? 26 : 18}px rgba(${accentRgb},0.32))`,
          }}
          aria-hidden="true"
        />
      </div>
      {sparkle && (
        <i
          className="fas fa-star absolute text-[10px] sm:text-xs"
          style={{ top: "4%", right: "8%", color: "#fff", filter: `drop-shadow(0 0 6px rgba(${accentRgb},0.9))` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
