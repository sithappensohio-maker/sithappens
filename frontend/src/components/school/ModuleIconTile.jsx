import { useShopMediaSrc } from "../ItemThumbnail";
import { moduleIconFor } from "../../lib/moduleIcons";

/* The ONE module-icon tile, shared by the course trail, the welcome index,
 * and Program Studio's icon control — so an admin's upload / pick / auto
 * derivation can never look different between surfaces. Decoration only. */
export default function ModuleIconTile({ module, hue, size = 44, className = "" }) {
  const icon = moduleIconFor(module);
  const src = useShopMediaSrc(icon.type === "image" ? icon.imageId : null);
  const box = { width: size, height: size, minWidth: size, minHeight: size };

  if (icon.type === "image") {
    return src ? (
      <img src={src} alt="" style={box} data-testid="module-icon-image"
           className={`rounded-xl object-cover shrink-0 border border-shBorder/60 ${className}`} />
    ) : (
      <span style={box} className={`rounded-xl shrink-0 bg-black/30 border border-shBorder ${className}`} />
    );
  }
  return (
    <span
      style={{ ...box, background: hue ? `linear-gradient(135deg, ${hue.grad[0]}, ${hue.grad[1]})` : undefined }}
      data-testid={`module-icon-${icon.key}`}
      className={`rounded-xl grid place-items-center shrink-0 ${hue
        ? "text-[#071018] shadow-[inset_0_1px_0_rgba(255,255,255,.28),0_8px_20px_-8px_rgba(0,0,0,.6)]"
        : "border border-shBorder bg-black/25 text-shTextMuted"} ${className}`}
    >
      <i className={`fas ${icon.fa}`} style={{ fontSize: Math.round(size * 0.4) }} aria-hidden="true" />
    </span>
  );
}
