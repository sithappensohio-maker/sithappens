/**
 * Round profile avatar that renders `src` (base64 or remote URL) if present.
 * Dog avatars (`icon="fa-paw"`) use a deterministic Sit Happens husky mascot
 * when the client has not uploaded a real dog photo; people retain the simple
 * icon fallback. Sizes: sm | md | lg.
 */
import { huskyPlaceholderSrc } from "./brand/HuskyDogImage";

const SIZE = { sm: "w-8 h-8 text-base", md: "w-12 h-12 text-lg", lg: "w-16 h-16 text-2xl" };

export default function Avatar({ src, icon = "fa-user", size = "md", ring = "border-shBorder", alt = "", testid }) {
  const cls = `${SIZE[size] || SIZE.md} shrink-0 rounded-full border-2 ${ring} overflow-hidden bg-[var(--sh-card-base)] grid place-items-center`;
  if (src || icon === "fa-paw") {
    return (
      <div className={cls} data-testid={testid}>
        <img
          src={src || huskyPlaceholderSrc(alt)}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover object-top"
        />
      </div>
    );
  }
  return (
    <div className={cls} data-testid={testid}>
      <i className={`fas ${icon} text-shTextMuted`}/>
    </div>
  );
}
