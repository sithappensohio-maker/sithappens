# Automated Email Reliability Fix

Scope: automated email delivery only. No booking, checkout, credit, pricing, register, P&L calculation, or frontend behavior was changed.

## Fixed

- Automated jobs start with the backend and no longer depend on opening the admin dashboard.
- Quiet-hours emails are stored in a durable MongoDB outbox instead of being discarded.
- Temporary Resend failures and missing-key periods are retried with backoff.
- Delivery stamps and notification-log rows are written only after Resend accepts an email.
- If an email is delivered but its database stamp fails, only the stamp is retried; the email is not sent twice.
- Low-credit warnings are stamped only after successful delivery.
- Birthday, vaccine, homework reminder, weekly digest, Monday digest, step-rollup, and monthly P&L emails use the reliable delivery path.
- Vaccine reminders catch up for vaccines expiring within 30 days, rather than being permanently missed when the app was offline on the exact 30-day date.
- Quiet-hours and reminder-day calculations use America/New_York business time.

## Validation

- Quiet-hours queue and later delivery passed.
- Transient Resend failure and retry passed.
- No false sent-stamp on failed delivery passed.
- Low-credit delivery stamp passed.
- Vaccine 30-day catch-up and deduplication passed.
- Monthly P&L attachment queue serialization passed.
- Delivered-email/stamp-failure retry passed without duplicate email.
- All backend Python files compiled successfully.
