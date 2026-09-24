import { useEffect, useRef } from "react";
import { FIX_ACTIONS } from "../lib/bookingBlocks";

/**
 * Why a booking was refused, and the button that fixes it.
 *
 * `failure` is { message, block } from lib/bookingBlocks.bookingFailure.
 * `onFix(action, block)` runs the fix; an action the host can't handle
 * (not in `actions`) gets no button — the sentence still says what to do.
 * `extra` renders additional buttons (e.g. "Join the waitlist").
 *
 * Scrolls itself into view when it appears: the wizard's Confirm button sits
 * at the bottom of a long modal, and an error rendered above the fold used
 * to look like "nothing happened".
 */
export default function BookingBlockNotice({ failure, onFix, actions, extra, testid = "booking-block-notice" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (failure) ref.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [failure]);
  if (!failure) return null;
  const action = failure.block?.action;
  const fix = action ? FIX_ACTIONS[action] : null;
  const showFix = !!(fix?.label && onFix && (!actions || actions.includes(action)));
  return (
    <div ref={ref} role="alert" data-testid={testid} data-block-code={failure.block?.code || ""}
         className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 space-y-2.5">
      <p className="text-[15px] text-red-200 leading-snug" data-testid={`${testid}-message`}>
        <i className="fas fa-circle-exclamation text-red-400 mr-2"/>{failure.message}
      </p>
      {(showFix || extra) && (
        <div className="flex flex-wrap gap-2">
          {showFix && (
            <button type="button" onClick={() => onFix(action, failure.block)} data-testid={`${testid}-fix`}
                    className="px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest bg-shSecondary text-shText hover:bg-shSecondary/90">
              <i className={`fas ${fix.icon} mr-1.5`}/>{fix.label}
            </button>
          )}
          {extra}
        </div>
      )}
    </div>
  );
}
