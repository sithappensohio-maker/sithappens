import PremiumActionCard from "./premium/PremiumActionCard";

/* Redesign — the three primary Home actions (Book Now / Shop / Photography).
 * Thin adapter over the shared PremiumActionCard/NeonEdge/NeonIconStage
 * system: same external prop API as before (Portal.jsx is unchanged), the
 * illuminated radar/glow visual construction now lives in components/premium.
 * Book and Shop share the lime family (Shop turned up — bigger icon,
 * stronger bloom, brighter edge, Popular badge); Photography is orange
 * with a small sparkle accent — matching the approved reference literally. */
const ACCENT_RGB = {
  primary: "140,198,63",
  shop: "140,198,63",
  accent: "242,101,34",
};

export default function PortalHomeActionCard({
  icon, title, description, ctaLabel, accent = "primary", emphasized = false,
  badge, cartCount = 0, onClick, testId,
}) {
  const accentRgb = ACCENT_RGB[accent] || ACCENT_RGB.primary;
  return (
    <PremiumActionCard
      icon={icon}
      title={title}
      description={description}
      ctaLabel={ctaLabel}
      accentRgb={accentRgb}
      strong={emphasized}
      sparkle={accent === "accent"}
      badge={badge}
      cartCount={cartCount}
      onClick={onClick}
      testId={testId}
    />
  );
}
