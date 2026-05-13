"""Resend email service for booking notifications.
All sends are non-blocking (asyncio.to_thread) and best-effort —
failures log a warning but never break the booking flow."""
import asyncio
import logging
import os

import resend

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
ADMIN_NOTIFICATION_EMAIL = os.environ.get("ADMIN_NOTIFICATION_EMAIL", "")
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


BRAND_GREEN = "#8cc63f"
BRAND_BLUE = "#00a9e0"
BRAND_DARK = "#0f172a"


def _wrap(title: str, intro: str, rows: list, cta_text: str | None = None, cta_url: str | None = None) -> str:
    rows_html = "".join(
        f'<tr><td style="padding:8px 0;color:#64748b;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;width:140px;">{k}</td>'
        f'<td style="padding:8px 0;color:#0f172a;font-size:15px;font-weight:600;">{v}</td></tr>'
        for k, v in rows
    )
    cta_html = (
        f'<a href="{cta_url}" style="display:inline-block;background:{BRAND_BLUE};color:#fff;text-decoration:none;'
        f'padding:14px 28px;border-radius:6px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;font-size:13px;">{cta_text}</a>'
        if cta_text and cta_url else ""
    )
    return f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:{BRAND_DARK};padding:24px 32px;">
          <p style="margin:0;color:{BRAND_GREEN};font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.25em;">Sit Happens</p>
          <h1 style="margin:6px 0 0 0;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.01em;">{title}</h1>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 18px 0;color:#334155;font-size:15px;line-height:1.5;">{intro}</p>
          <table cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:8px 0 20px 0;">{rows_html}</table>
          {cta_html}
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">Sit Happens Dog Training · Daycare · Boarding<br/>
          You're receiving this because of activity on your Sit Happens account.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _service_label(svc: str) -> str:
    return {"daycare": "Daycare", "boarding": "Boarding", "training": "Training", "grooming": "Grooming"}.get(svc, svc.title())


def _date_range(start: str, end: str | None) -> str:
    if end and end != start:
        return f"{start} → {end}"
    return start


async def _send(to_email: str, subject: str, html: str) -> None:
    """Fire-and-forget send. Logs failures but never raises."""
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping email to %s", to_email)
        return
    if not to_email:
        return
    try:
        params = {"from": SENDER_EMAIL, "to": [to_email], "subject": subject, "html": html}
        # Replies land in the admin inbox instead of the unmonitored sender address
        if ADMIN_NOTIFICATION_EMAIL:
            params["reply_to"] = ADMIN_NOTIFICATION_EMAIL
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Email sent to %s: %s", to_email, result.get("id") if isinstance(result, dict) else result)
    except Exception as e:
        logger.warning("Email send to %s failed: %s", to_email, e)


async def notify_admin_new_booking(booking: dict, client: dict) -> None:
    """New booking arrived from the client portal — notify the operator."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    rows = [
        ("Dog", booking.get("dog_name", "—")),
        ("Service", _service_label(booking.get("service_type", ""))),
        ("Dates", _date_range(booking.get("date", ""), booking.get("end_date"))),
        ("Client", booking.get("client_name", "—")),
        ("Phone", client.get("phone", "—") or "—"),
        ("Email", client.get("email", "—") or "—"),
    ]
    if booking.get("notes"):
        rows.append(("Notes", booking["notes"]))
    if booking.get("kennel"):
        rows.append(("Kennel", booking["kennel"]))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"🐾 New Booking · {booking.get('dog_name', '')}",
        intro=f"<strong>{booking.get('client_name', 'A client')}</strong> just requested a booking through the portal. It's pending your approval.",
        rows=rows,
        cta_text="Open Bookings" if cta_url else None,
        cta_url=cta_url,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"New booking · {booking.get('dog_name','')} · {_service_label(booking.get('service_type',''))} · {booking.get('date','')}",
        html,
    )


async def notify_client_booking_approved(booking: dict, client: dict) -> None:
    """Booking approved — let the client know."""
    to_email = client.get("email", "")
    if not to_email:
        return
    rows = [
        ("Dog", booking.get("dog_name", "—")),
        ("Service", _service_label(booking.get("service_type", ""))),
        ("Dates", _date_range(booking.get("date", ""), booking.get("end_date"))),
    ]
    if booking.get("dropoff_time"):
        rows.append(("Drop-off", booking["dropoff_time"]))
    if booking.get("pickup_time"):
        rows.append(("Pickup", booking["pickup_time"]))
    if booking.get("kennel"):
        rows.append(("Kennel", booking["kennel"]))
    html = _wrap(
        title=f"You're confirmed! · {booking.get('dog_name', '')}",
        intro=f"Hi {client.get('name', 'there').split(' ')[0]}, your booking has been approved. We can't wait to see {booking.get('dog_name','your pup')}!",
        rows=rows,
        cta_text=None,
        cta_url=None,
    )
    await _send(
        to_email,
        f"Booking confirmed · {booking.get('dog_name','')} · {booking.get('date','')}",
        html,
    )
