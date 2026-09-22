// "Sit Happens" footer pill in the bottom-right corner. Text and link target
// are admin-configurable via Settings → Brand & Theme. Uses CSS vars so it
// recolors automatically when admin changes brand colors. Hidden on small
// screens (< 640px) so it doesn't fight for thumb space on mobile.

import { useTheme } from "../lib/theme";

export default function BrandFooter() {
  const ctx = useTheme();
  const text = ctx?.branding?.brand_footer_text || "Sit Happens";
  const url  = ctx?.branding?.brand_footer_url  || "";

  const inner = (
    <>
      <i className="fas fa-paw text-shGreen text-[11px]" />
      <span className="sh-shell-wordmark text-[13px] normal-case">{text}</span>
    </>
  );

  // Stage 1 — this pill sat at z-50 over the bottom-right corner, which is
  // exactly where sticky action bars put their primary button. On the Shop it
  // covered the Checkout button by 94x15px and won the hit test, so taps in
  // that corner went to a decorative badge instead of checkout.
  //
  // Two changes, because moving it a few pixels would only relocate the
  // problem: it now sits BELOW action bars in the stacking order (z-20 vs the
  // z-40+ those bars use), and the non-link version is inert, since a div
  // whose whole job is to say the business name has no business absorbing
  // clicks at all.
  const base = "hidden sm:inline-flex fixed bottom-4 right-4 z-20 items-center gap-2 px-3 py-2 rounded-full bg-bgHeader/90 border border-bgHover text-gray-400 transition backdrop-blur-sm shadow-lg";
  const classes = base;
  const interactiveClasses = url ? " hover:border-shGreen hover:text-shGreen cursor-pointer" : "";

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="brand-footer"
        className={classes + interactiveClasses}
        style={{ fontSize: "11px", letterSpacing: "0.15em" }}
      >
        {inner}
      </a>
    );
  }
  return (
    <div
      data-testid="brand-footer"
      aria-hidden="true"
      className={classes + " pointer-events-none"}
      style={{ fontSize: "11px", letterSpacing: "0.15em" }}
    >
      {inner}
    </div>
  );
}
