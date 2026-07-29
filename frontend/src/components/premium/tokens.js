/* Single source of truth for the premium design-system accent colors.
 * Every premium/* component takes an accent NAME (not a raw rgb string)
 * so the whole client portal shares exactly six colors instead of each
 * screen inventing its own rgb triples. */
export const ACCENT_RGB = {
  lime: "140,198,63",
  cyan: "0,169,224",
  orange: "242,101,34",
  purple: "168,85,247",
  amber: "245,179,44",
  danger: "239,68,68",
  neutral: "148,163,184",
};

export function accentRgb(name) {
  return ACCENT_RGB[name] || ACCENT_RGB.lime;
}

/* Literal (non-interpolated) Tailwind hover-border classes per accent —
 * written out in full so Tailwind's content scanner can find them; never
 * build these strings dynamically from accentRgb() at runtime. */
export const HOVER_BORDER_CLASS = {
  lime: "hover:border-shPrimary/50",
  cyan: "hover:border-shSecondary/50",
  orange: "hover:border-shAccent/50",
  purple: "hover:border-purple-400/50",
  amber: "hover:border-amber-400/50",
  danger: "hover:border-red-400/50",
  neutral: "hover:border-gray-400/40",
};
