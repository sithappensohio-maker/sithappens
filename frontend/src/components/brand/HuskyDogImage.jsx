const HUSKY_PLACEHOLDERS = [
  "/brand/husky-placeholder-black-white.png",
  "/brand/husky-placeholder-gray-white.png",
  "/brand/husky-placeholder-red-white.png",
  "/brand/husky-placeholder-silver-white.png",
];

function stableIndex(value = "") {
  const text = String(value || "husky");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % HUSKY_PLACEHOLDERS.length;
}

export function huskyPlaceholderSrc(name = "") {
  return HUSKY_PLACEHOLDERS[stableIndex(name)];
}

/**
 * Brand-safe dog image: real client dog photo when available; otherwise one
 * of the Sit Happens husky mascot variants. The fallback is deterministic by
 * dog name so the same dog does not randomly change mascots between screens.
 */
export default function HuskyDogImage({ src, name = "", alt, className = "", style, ...rest }) {
  const isRealPhoto = !!src;
  return (
    <img
      src={src || huskyPlaceholderSrc(name)}
      alt={alt ?? name}
      loading="lazy"
      decoding="async"
      className={className}
      // A real dog photo frames to the CENTER — a top-crop cuts the dog off
      // (see the reported card issue). The husky mascot is drawn peeking from
      // the TOP, so it stays anchored there. This inline object-position
      // intentionally overrides any `object-top` utility a caller passes, so
      // every dog card/avatar gets correct framing from this one place. A
      // caller can still override by passing its own style.objectPosition.
      style={{ objectPosition: isRealPhoto ? "center" : "top", ...style }}
      {...rest}
    />
  );
}
