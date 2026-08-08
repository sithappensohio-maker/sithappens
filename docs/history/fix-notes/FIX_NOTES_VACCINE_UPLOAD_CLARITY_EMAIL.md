# Vaccine upload clarity + admin email patch

Safe incremental patch on top of `top-tier-safety-audit`.

## What changed

- Client vaccine wizard now makes the flow dead clear:
  - Shows `Vaccine upload step X of Y`.
  - Shows a large `Right now: Rabies/Bordetella/DHPP` instruction box.
  - Shows a step list with done/current/upcoming vaccines.
  - After saving one vaccine, it explicitly says what was uploaded and what vaccine is next.
  - Button text now says `Submit Rabies & continue` / `Submit final vaccine`.
  - Bottom note says uploads are submitted for approval and booking stays locked until Sit Happens approves them.

- Client upload forms no longer call certificate photos optional when the backend requires proof.
  - Single vaccine modal says certificate photo is required.
  - Quick upload modal says every submitted vaccine needs expiry date + photo/PDF.
  - Quick upload shows a warning if a date is entered but no certificate file is attached.

- Admin email notification added when a client uploads a vaccine record for approval.
  - Uses existing Resend/email configuration.
  - Sends to `ADMIN_NOTIFICATION_EMAIL`.
  - Does not block or fail the client upload if email is down/misconfigured.
  - Added customizable email template slug: `admin_vaccine_upload_pending`.

## Data safety

- No destructive database changes.
- No client/dog/credit migration.
- No wipe/reset behavior.
- Existing pending approvals remain compatible.
