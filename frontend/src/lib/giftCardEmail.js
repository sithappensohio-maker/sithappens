/* Whether a digital gift card's code reached anybody — one set of words for
 * every screen (audit 2026-09-25 #56). The server decides the state
 * (services.email_state): "sent" only when the email really went, "queued"
 * while it waits in the email queue to be retried (Quiet Hours, an email
 * hiccup), "not_sent" when nothing went and nothing is waiting (a send that
 * failed without being queued — including every one from before this fix —
 * or was interrupted), "none" for a printed card. Never "emailed" unless it
 * was, and never "being emailed" unless something really is.
 *
 * `staff` words it for the Gift Cards screen; otherwise it is written to the
 * buyer, who can see the code and hand it over themselves.
 */
export function giftCardEmailLine(card, { staff = false } = {}) {
  const state = card?.email_state;
  const to = (state === "sent" ? card?.email_delivered_to : "") || card?.emailed_to || card?.recipient_email || "";
  const toThem = to ? ` to ${to}` : "";
  switch (state) {
    case "sent":
      return `Emailed${toThem}.`;
    case "queued":
      return staff
        ? `Not delivered yet${toThem} — the app keeps trying and sends it as soon as it can.`
        : `Not delivered yet${toThem} — we keep trying and it goes out as soon as it can. You can also give them the code yourself.`;
    case "not_sent":
      return staff
        ? `Not emailed yet${toThem}.`
        : `Not emailed yet${toThem} — you can give them the code yourself, or ask us to send it.`;
    default:
      return "";
  }
}
