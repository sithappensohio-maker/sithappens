/* Focused Client Usability phase — persistent success confirmations.
 *
 * A reusable panel for the moment right after a client action the server
 * has ALREADY confirmed succeeded (booking request, payment, Shop purchase,
 * prepaid-visit purchase, vaccine upload, message submission, waiver
 * signature). Never shown speculatively — callers only render this once
 * their own API call has resolved successfully.
 *
 * Fields, matching the required shape: what succeeded, the relevant dog/
 * transaction, date, amount (when applicable), current status, what
 * happens next, and 1-2 actions (a detail/receipt action plus "Done").
 */
export default function PortalSuccessPanel({
  title, subtitle, date, amount, status, statusTone = "blue", nextSteps,
  primaryActionLabel, onPrimaryAction, onDone, testId,
}) {
  const toneClass = {
    blue: "text-shBlue bg-shBlue/10 border-shBlue/40",
    green: "text-shGreen bg-shGreen/10 border-shGreen/40",
    orange: "text-shOrange bg-shOrange/10 border-shOrange/40",
  }[statusTone] || "text-shBlue bg-shBlue/10 border-shBlue/40";

  return (
    <div className="rounded-2xl border border-shGreen/40 bg-shGreen/5 p-5 shadow-sh" data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 shrink-0 rounded-full bg-shGreen/15 border border-shGreen/40 text-shGreen grid place-items-center text-xl">
          <i className="fas fa-circle-check"/>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[18px] font-bold text-shText leading-snug">{title}</h3>
          {subtitle && <p className="text-[15px] text-shText font-semibold mt-1">{subtitle}</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-[14px] text-shTextMuted">
            {date && <span><i className="fas fa-calendar-day mr-1.5"/>{date}</span>}
            {amount != null && <span><i className="fas fa-dollar-sign mr-1.5"/>{amount}</span>}
          </div>
          {status && (
            <span className={`inline-block mt-2 px-2.5 py-1 rounded-full border text-[12px] font-black uppercase tracking-widest ${toneClass}`}>
              {status}
            </span>
          )}
          {nextSteps && <p className="text-[14px] text-shTextMuted mt-2 leading-relaxed">{nextSteps}</p>}
          <div className="flex flex-wrap gap-2 mt-3.5">
            {primaryActionLabel && (
              <button type="button" onClick={onPrimaryAction} data-testid={`${testId}-primary-action`}
                      className="min-h-[44px] px-4 py-2.5 rounded-lg border border-shBorder text-shText font-bold text-[14px] hover:border-shPrimary/50 transition">
                {primaryActionLabel}
              </button>
            )}
            <button type="button" onClick={onDone} data-testid={`${testId}-done`}
                    className="min-h-[44px] px-5 py-2.5 rounded-lg bg-shGreen text-bgHeader font-black uppercase tracking-widest text-[13px] hover:brightness-110 transition">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
