/**
 * Round profile avatar that renders `src` (base64 or remote URL) if present,
 * otherwise falls back to an iconified placeholder. Use for clients (fa-user)
 * and dogs (fa-paw). Sizes: sm | md | lg.
 *
 * Props:
 *   src:      data URL or remote URL (optional)
 *   icon:     fontawesome class to show when src is empty (defaults to fa-user)
 *   size:     sm (32) | md (48) | lg (64). Defaults to md.
 *   ring:     tailwind border-color class (e.g. "border-shBlue"). Defaults to border-bgHover.
 *   testid:   data-testid attribute
 */
const SIZE = { sm: "w-8 h-8 text-base", md: "w-12 h-12 text-lg", lg: "w-16 h-16 text-2xl" };

export default function Avatar({ src, icon = "fa-user", size = "md", ring = "border-bgHover", alt = "", testid }) {
  const cls = `${SIZE[size] || SIZE.md} shrink-0 rounded-full border-2 ${ring} overflow-hidden bg-bgBase grid place-items-center`;
  if (src) {
    return (
      <div className={cls} data-testid={testid}>
        <img src={src} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover"/>
      </div>
    );
  }
  return (
    <div className={cls} data-testid={testid}>
      <i className={`fas ${icon} text-gray-500`}/>
    </div>
  );
}
