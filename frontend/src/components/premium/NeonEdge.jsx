/* Reusable illuminated-perimeter card shell: a near-black vignette base
 * (NOT a tinted blue panel fill) plus a thin accent-colored edge and a
 * soft outer bloom. Color reads as emitted light along the edge/haze, not
 * as a large colored background rectangle. Polymorphic via `as` so it can
 * render as a <button> (primary action cards) or a plain <div> elsewhere.
 *
 * Effect-intensity hierarchy (per the client-portal rollout): pass
 * `intensity="hero" | "standard" | "subtle"` for the three tiers. `strong`
 * is kept as the original boolean API the approved Book/Shop/Photography
 * cards already call (`strong` → hero, default → standard) so those three
 * cards render byte-identical to before; new callers should prefer
 * `intensity` directly, including the new `subtle` tier it unlocks. */
import { useTheme, usePortalSurface } from "../../lib/theme";

export default function NeonEdge({
  as: Comp = "div", accentRgb, strong = false, intensity, className = "", style = {}, children, frameWidth = "10px", ...rest
}) {
  const ctx = useTheme();
  const surface = usePortalSurface();
  const tier = intensity || (strong ? "hero" : "standard");
  const edgeAlpha = { hero: 0.85, standard: 0.45, subtle: 0.22 }[tier];
  const bloom = {
    hero: `0 0 2px rgba(${accentRgb},0.9), 0 0 14px rgba(${accentRgb},0.5), 0 0 40px rgba(${accentRgb},0.28)`,
    standard: `0 0 2px rgba(${accentRgb},0.6), 0 0 9px rgba(${accentRgb},0.24), 0 0 22px rgba(${accentRgb},0.12)`,
    subtle: `0 0 1px rgba(${accentRgb},0.4), 0 0 6px rgba(${accentRgb},0.12)`,
  }[tier];

  const hazeAlpha = tier === "subtle" ? 0.05 : 0.09;

  // Theme Studio's "Card Frame" asset slot — a 9-slice border-image that
  // replaces the plain accent-colored edge everywhere NeonEdge renders
  // (stat tiles, action cards, panels, both portals). Switched on a plain
  // boolean (not the CSS var's own "none" fallback) because border-width
  // itself needs to change — a frame needs real width to show its art,
  // but the default 1px accent edge must stay 1px when no frame is set,
  // and CSS can't conditionally pick a border-width from whether a
  // DIFFERENT property resolved to "none". --theme-asset-card-frame (set
  // by applyBranding, same as every other asset slot) still supplies the
  // actual image URL — this just decides which border style to use.
  // border-image ignores border-radius, so an uploaded frame must bake its
  // own rounded/transparent corners into the art — spelled out in the
  // image guide's prompt for this slot.
  //
  // frameWidth lets a genuinely small call site (MiniActionCard's 68px
  // Quick Actions tiles, AccountsReceivable's compact KPI tiles/toast)
  // ask for a thinner frame than the 10px default — at those sizes the
  // full-width frame ate a third or more of the tile before any content
  // rendered. The slice stays fixed at 64 (how much of the SOURCE image
  // is sampled) regardless, so a thin frame reads softer/less detailed
  // than the full-size one, not just narrower — an acceptable tradeoff
  // for a small decorative edge, which was never going to show full
  // detail at that size anyway.
  // Unlike every other asset slot (each gated in CSS via the matching
  // html[data-theme-target-*] attribute), Card Frame now also respects
  // Theme Studio's "Enable Theme On" portal toggles — surface comes from
  // PortalSurfaceProvider (see theme.js); no provider in the tree (e.g. an
  // isolated test) means "enabled," not "hidden."
  const targetEnabled = surface ? (ctx?.branding?.enabled_targets?.[surface] ?? true) : true;
  const hasFrame = !!ctx?.branding?.assets?.cardFrame && targetEnabled;
  const borderStyle = hasFrame
    ? {
        borderWidth: frameWidth,
        borderStyle: "solid",
        borderImageSource: "var(--theme-asset-card-frame)",
        borderImageSlice: "64",
        borderImageWidth: frameWidth,
        borderImageOutset: "0",
        borderImageRepeat: "round",
      }
    : { border: `1px solid rgba(${accentRgb},${edgeAlpha})` };

  return (
    <Comp
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{
        background: [
          `radial-gradient(120% 90% at 50% 15%, rgba(${accentRgb},${hazeAlpha}), transparent 55%)`,
          `radial-gradient(160% 140% at 50% 45%, transparent 35%, rgba(0,0,0,0.55) 100%)`,
          `var(--sh-card-base)`,
        ].join(", "),
        ...borderStyle,
        boxShadow: bloom,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}
