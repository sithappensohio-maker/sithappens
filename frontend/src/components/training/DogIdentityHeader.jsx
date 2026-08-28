// Training UI Phase 1 — shared dog/program identity header. Reuses the
// existing Avatar component for the photo + clean fallback (no new image
// handling logic).
import Avatar from "../Avatar";

export default function DogIdentityHeader({ dogName, dogPhoto, breadcrumb, testid }) {
  return (
    <div className="flex items-center gap-3 min-w-0" data-testid={testid}>
      <span className="inline-flex rounded-full shadow-[0_0_0_3px_rgba(140,198,63,0.55),0_0_18px_rgba(140,198,63,0.45)] shrink-0">
        <Avatar src={dogPhoto} icon="fa-paw" size="lg" ring="border-shPrimary/40" alt={dogName} testid={testid ? `${testid}-avatar` : undefined}/>
      </span>
      <div className="min-w-0">
        <h3 className="text-lg sm:text-xl font-black text-shText uppercase tracking-tight truncate">{dogName || "Dog"}</h3>
        {breadcrumb && <p className="text-[12px] text-shTextMuted truncate">{breadcrumb}</p>}
      </div>
    </div>
  );
}
