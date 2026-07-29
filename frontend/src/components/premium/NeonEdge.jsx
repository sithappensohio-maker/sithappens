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
export default function NeonEdge({
  as: Comp = "div", accentRgb, strong = false, intensity, className = "", style = {}, children, ...rest
}) {
  const tier = intensity || (strong ? "hero" : "standard");
  const edgeAlpha = { hero: 0.85, standard: 0.45, subtle: 0.22 }[tier];
  const bloom = {
    hero: `0 0 2px rgba(${accentRgb},0.9), 0 0 14px rgba(${accentRgb},0.5), 0 0 40px rgba(${accentRgb},0.28)`,
    standard: `0 0 2px rgba(${accentRgb},0.6), 0 0 9px rgba(${accentRgb},0.24), 0 0 22px rgba(${accentRgb},0.12)`,
    subtle: `0 0 1px rgba(${accentRgb},0.4), 0 0 6px rgba(${accentRgb},0.12)`,
  }[tier];

  const hazeAlpha = tier === "subtle" ? 0.05 : 0.09;

  return (
    <Comp
      className={`relative overflow-hidden rounded-2xl ${className}`}
      style={{
        background: [
          `radial-gradient(120% 90% at 50% 15%, rgba(${accentRgb},${hazeAlpha}), transparent 55%)`,
          `radial-gradient(160% 140% at 50% 45%, transparent 35%, rgba(0,0,0,0.55) 100%)`,
          `var(--sh-card-base)`,
        ].join(", "),
        border: `1px solid rgba(${accentRgb},${edgeAlpha})`,
        boxShadow: bloom,
        ...style,
      }}
      {...rest}
    >
      {children}
    </Comp>
  );
}
