/* Reusable dark form controls for the client portal — near-black field,
 * subtle blue-gray border at rest, brand-colored illuminated edge on
 * focus. Replaces generic light/white input styling screen-by-screen. */
const FIELD_CLASS =
  "w-full rounded-lg px-3 py-2.5 text-[14px] text-shText placeholder:text-shTextMuted border border-shBorder transition " +
  "focus:outline-none focus:border-shPrimary/60 focus:shadow-[0_0_0_3px_rgba(140,198,63,0.15)] " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

export function FormInput({ className = "", invalid = false, ...rest }) {
  return (
    <input
      className={`${FIELD_CLASS} ${invalid ? "border-shDanger focus:border-shDanger focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]" : ""} ${className}`}
      style={{ background: "var(--sh-card-base)" }}
      {...rest}
    />
  );
}

export function FormTextarea({ className = "", invalid = false, ...rest }) {
  return (
    <textarea
      className={`${FIELD_CLASS} ${invalid ? "border-shDanger focus:border-shDanger focus:shadow-[0_0_0_3px_rgba(239,68,68,0.15)]" : ""} ${className}`}
      style={{ background: "var(--sh-card-base)" }}
      {...rest}
    />
  );
}

export function FormSelect({ className = "", children, ...rest }) {
  return (
    <select className={`${FIELD_CLASS} ${className}`} style={{ background: "var(--sh-card-base)" }} {...rest}>
      {children}
    </select>
  );
}

export function FormLabel({ children, className = "" }) {
  return <label className={`block text-[12px] font-semibold text-shTextMuted uppercase tracking-wide mb-1.5 ${className}`}>{children}</label>;
}

export function FormError({ children }) {
  if (!children) return null;
  return <p className="text-[12px] text-shDanger mt-1.5 flex items-center gap-1.5"><i className="fas fa-circle-exclamation" />{children}</p>;
}
