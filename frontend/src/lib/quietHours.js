/**
 * Quiet Hours (audit: "Quiet Hours drop emails instead of holding them").
 *
 * An email that comes due inside the owner's Quiet Hours waits in the outbox
 * and goes out when they end. Only sign-up and password-reset links and the
 * owner's own test emails go at once. These say so on the screens that send.
 */
export const QUIET_HOURS_HINT =
  "Emails that come due during quiet hours wait and go out when quiet hours end. " +
  "Password-reset and sign-up links, and your own test emails, always go out right away.";

// A time box needs "HH:MM"; an older "9:00" setting would otherwise show blank.
export const asTimeValue = (v) => (/^\d:\d\d$/.test(v || "") ? `0${v}` : v || "");

export function bulkSendMessage(data, testOnly) {
  const sent = data?.success_count || 0;
  const queued = data?.queued_count || 0;
  const total = data?.recipient_count || 0;
  const skipped = data?.skipped_already_sent || 0;
  if (testOnly) {
    return queued ? "Test email queued — it goes out when quiet hours end." : `Test email sent to ${sent}/${total}.`;
  }
  // A bulk send is queued and the email worker sends it in the background (audit #40).
  if (data?.status) {
    if (!queued) {
      return skipped
        ? `Nothing new to send — all ${skipped} ${skipped === 1 ? "family" : "families"} already had this message.`
        : "Nothing to send.";
    }
    const note = skipped ? ` ${skipped} already had this message and ${skipped === 1 ? "was" : "were"} skipped.` : "";
    return `${queued} ${queued === 1 ? "email" : "emails"} queued to send in the background.${note}`;
  }
  if (!queued) return `Sent ${sent} / ${total} emails`;
  return `${sent ? `Sent ${sent}, ` : ""}${queued} of ${total} queued — they go out when quiet hours end`;
}

export const statementMessage = (data, sentText) =>
  data?.queued ? `Statement queued for ${data.sent_to} — it goes out when quiet hours end.` : sentText;
