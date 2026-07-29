import NeonEdge from "./NeonEdge";
import { accentRgb } from "./tokens";

/* Reusable "standard/subtle" intensity section wrapper — the dark premium
 * surface used for informational/secondary content throughout the client
 * portal (My Dogs, Credits, Payment Plans, Training, etc). Same NeonEdge
 * shell as the hero cards, just a calmer intensity by default. */
export default function SectionCard({
  accent = "lime", intensity = "standard", as = "div", className = "", children, ...rest
}) {
  return (
    <NeonEdge as={as} accentRgb={accentRgb(accent)} intensity={intensity} className={`p-4 sm:p-5 ${className}`} {...rest}>
      {children}
    </NeonEdge>
  );
}
