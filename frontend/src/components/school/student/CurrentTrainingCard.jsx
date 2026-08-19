import { accentRgb } from "../../premium/tokens";
import { actionMeta, deliveryIcon, deliveryLabel, isCaughtUp } from "../../../lib/studentSchool";

/* The Student Home hero — answers "what should I do next?" at a glance, with
 * one obvious primary action. Everything comes from the backend view-model's
 * current_action (source of truth); this only presents it. */
export default function CurrentTrainingCard({ home, onPrimary }) {
  const action = home?.current_action || {};
  const meta = actionMeta(action.type);
  const rgb = accentRgb(meta.accent);
  const dog = home?.dog?.name || "your dog";
  const lesson = home?.current_lesson;
  const moduleName = home?.current_module?.name;
  const caughtUp = isCaughtUp(action.type);
  const noPrimaryAction = ["awaiting_review", "access_expired", "setup_required", "course_paused"].includes(action.type);
  const equipment = Array.isArray(lesson?.equipment_needed)
    ? lesson.equipment_needed.filter(Boolean)
    : (typeof lesson?.equipment_needed === "string" && lesson.equipment_needed
        ? lesson.equipment_needed.split(",").map((v) => v.trim()).filter(Boolean) : []);
  const minutes = lesson?.estimated_minutes || lesson?.practice_minutes;

  return (
    <section
      className="rounded-2xl border p-5 sm:p-6"
      style={{ borderColor: `rgba(${rgb},0.35)`, background: `linear-gradient(160deg, rgba(${rgb},0.10), var(--sh-card-base) 60%)` }}
      data-testid="current-training-card"
    >
      <p className="text-[11px] font-black uppercase tracking-[0.28em]" style={{ color: `rgb(${rgb})` }}>
        <i className={`fas ${meta.icon} mr-1.5`} />
        {caughtUp ? "You're caught up" : `${dog}'s training for today`}
      </p>

      {home?.program?.name && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <p className="text-[12px] text-shTextMuted uppercase tracking-widest font-bold truncate">{home.program.name}</p>
          <span className="text-[9px] font-black uppercase tracking-widest rounded-full border border-shSecondary/25 bg-shSecondary/10 text-shSecondary px-2 py-1" data-testid="school-delivery-mode">
            <i className={`fas ${deliveryIcon(home.delivery_mode)} mr-1`} />{deliveryLabel(home.delivery_mode)}
          </span>
        </div>
      )}
      <h2 className="text-shText font-black text-[20px] sm:text-[24px] leading-tight mt-1 text-balance">
        {lesson?.name || action.label || "Your training"}
      </h2>
      {moduleName && <p className="text-[12.5px] text-shTextMuted mt-1">{moduleName}</p>}

      {action.sublabel && action.sublabel !== lesson?.name && (
        <p className="text-[14px] text-shTextMuted mt-3 leading-relaxed">{action.sublabel}</p>
      )}

      {(equipment.length > 0 || minutes) && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {minutes && (
            <span className="text-[12px] font-bold text-shTextMuted bg-[var(--sh-card-base)] border border-shBorder rounded-full px-3 py-1">
              <i className="fas fa-clock mr-1.5" />{minutes} min
            </span>
          )}
          {equipment.map((e) => (
            <span key={e} className="text-[12px] font-bold text-shTextMuted bg-[var(--sh-card-base)] border border-shBorder rounded-full px-3 py-1">{e}</span>
          ))}
        </div>
      )}

      {noPrimaryAction ? (
        <p className="mt-5 text-[13px] font-bold text-shTextMuted" data-testid="current-training-no-cta">
          {action.type === "awaiting_review" ? "Your trainer has the checkpoint now — nothing else is required from you yet."
            : action.type === "setup_required" ? "Your trainer needs to update this lesson before you can continue."
            : action.type === "course_paused" ? "Training is paused for now. Your completed work and feedback remain saved."
            : "Reach out to Sit Happens if you need help restoring course access."}
        </p>
      ) : (
        <button
          type="button"
          onClick={onPrimary}
          className="mt-5 w-full sm:w-auto inline-flex items-center justify-center gap-2 text-[14px] font-black uppercase tracking-widest px-6 py-3.5 rounded-xl transition active:scale-[0.99]"
          style={{ background: `rgb(${rgb})`, color: "#0b0f14" }}
          data-testid="current-training-cta"
        >
          {action.label || "Start"}
          <i className="fas fa-arrow-right" />
        </button>
      )}
    </section>
  );
}
