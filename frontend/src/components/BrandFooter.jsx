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
      <i className="fas fa-paw text-shGreen" />
      <span className="font-black uppercase tracking-widest">{text}</span>
    </>
  );

  const classes = "hidden sm:inline-flex fixed bottom-4 right-4 z-50 items-center gap-2 px-3 py-2 rounded-full bg-bgHeader/90 border border-bgHover text-gray-400 transition backdrop-blur-sm shadow-lg";
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
      className={classes}
      style={{ fontSize: "11px", letterSpacing: "0.15em" }}
    >
      {inner}
    </div>
  );
}
