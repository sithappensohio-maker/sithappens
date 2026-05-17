"""Resend email service for booking notifications.
All sends are non-blocking (asyncio.to_thread) and best-effort —
failures log a warning but never break the booking flow."""
import asyncio
import base64
import io
import logging
import os

import qrcode
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


def _qr_data_url(url: str) -> str:
    """Return a base64 data: URL containing a 200x200 PNG QR code for `url`.
    Cached per-URL so we don't regenerate on every email send."""
    if url in _QR_CACHE:
        return _QR_CACHE[url]
    img = qrcode.make(url, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    data_url = f"data:image/png;base64,{data}"
    _QR_CACHE[url] = data_url
    return data_url


_QR_CACHE: dict = {}


def _install_footer() -> str:
    """Branded "Install the app" block (QR + iOS/Android steps) appended
    inside the white card of every client-facing email. No-op if APP_PUBLIC_URL
    isn't configured."""
    if not APP_PUBLIC_URL:
        return ""
    qr = _qr_data_url(APP_PUBLIC_URL)
    return f"""
<div style="margin-top:28px;border-top:1px solid #e2e8f0;padding-top:20px;">
  <p style="margin:0 0 12px 0;color:{BRAND_DARK};font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:0.08em;">📱 Install the app on your phone</p>
  <table cellpadding="0" cellspacing="0" style="width:100%;">
    <tr>
      <td style="vertical-align:top;width:120px;padding-right:16px;">
        <img src="{qr}" alt="Scan to open Sit Happens" width="110" height="110" style="display:block;border:4px solid #fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);" />
      </td>
      <td style="vertical-align:top;color:#334155;font-size:13px;line-height:1.55;">
        <strong style="color:{BRAND_DARK};">Scan the QR with your phone camera</strong> to open your client portal, then:
        <ul style="margin:8px 0 0 18px;padding:0;color:#334155;">
          <li><strong>iPhone:</strong> tap <span style="white-space:nowrap;">Share <span style="font-size:11px;">⬆️</span></span> → <em>Add to Home Screen</em></li>
          <li><strong>Android:</strong> tap the <span style="white-space:nowrap;">⋮ menu</span> → <em>Install app</em></li>
        </ul>
        <p style="margin:10px 0 0 0;color:#64748b;font-size:12px;">Opens in one tap — no app store needed.</p>
      </td>
    </tr>
  </table>
</div>"""


def _wrap(title: str, intro: str, rows: list, cta_text: str | None = None, cta_url: str | None = None, show_install: bool = True) -> str:
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
    install_html = _install_footer() if show_install else ""
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
          {install_html}
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
    svc_label = _service_label(booking.get("service_type", ""))
    if booking.get("service_type") == "grooming" and booking.get("grooming_type"):
        gt = "Bath" if booking["grooming_type"] == "bath" else "Nail Trim"
        svc_label = f"{svc_label} · {gt}"
    rows = [
        ("Dog", booking.get("dog_name", "—")),
        ("Service", svc_label),
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
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"New booking · {booking.get('dog_name','')} · {svc_label} · {booking.get('date','')}",
        html,
    )


async def notify_admin_new_client(user: dict, client: dict) -> None:
    """A new client just self-registered — let the operator know."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    rows = [
        ("Name", client.get("name") or user.get("name", "—")),
        ("Email", user.get("email", "—")),
        ("Phone", client.get("phone") or "—"),
    ]
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title="🎉 New client signup",
        intro=f"<strong>{client.get('name') or user.get('name', 'A new client')}</strong> just created an account on the Sit Happens portal.",
        rows=rows,
        cta_text="Open Admin" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"New client signup · {client.get('name') or user.get('name', '')}",
        html,
    )


async def notify_admin_first_booking(booking: dict, client: dict) -> None:
    """🎉 The client just made their first-ever booking — celebrate it with the operator."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    svc_label = _service_label(booking.get("service_type", ""))
    if booking.get("service_type") == "grooming" and booking.get("grooming_type"):
        gt = "Bath" if booking["grooming_type"] == "bath" else "Nail Trim"
        svc_label = f"{svc_label} · {gt}"
    rows = [
        ("Client", client.get("name") or booking.get("client_name", "—")),
        ("Dog", booking.get("dog_name", "—")),
        ("Service", svc_label),
        ("Dates", _date_range(booking.get("date", ""), booking.get("end_date"))),
    ]
    if client.get("phone"):
        rows.append(("Phone", client["phone"]))
    if client.get("email"):
        rows.append(("Email", client["email"]))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    name = client.get("name") or booking.get("client_name", "A new client")
    html = _wrap(
        title=f"🎉 First booking — {name}",
        intro=(
            f"<strong>{name}</strong> just made their first-ever booking on Sit Happens. "
            f"That's a brand-new client across the threshold — nice work."
        ),
        rows=rows,
        cta_text="Open Admin" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"🎉 First booking · {name} · {svc_label} · {booking.get('date','')}",
        html,
    )


async def notify_admin_quote_request(client: dict, item: dict, message: str) -> None:
    """A logged-in client requested pricing/availability for a service or program."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    name = client.get("name") or "—"
    kind = "Program" if item.get("kind") == "program" else "Service"
    item_label = item.get("name") or "—"
    rows = [
        ("Client", name),
        (kind, item_label),
    ]
    if item.get("price") is not None:
        rows.append(("Listed price", f"${float(item['price']):.2f}"))
    if client.get("phone"):
        rows.append(("Phone", client["phone"]))
    if client.get("email"):
        rows.append(("Email", client["email"]))
    if message:
        rows.append(("Message", message))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"💬 Quote request — {item_label}",
        intro=(
            f"<strong>{name}</strong> is interested in <strong>{item_label}</strong> and would like a quote or more info. "
            f"Reach out when you can."
        ),
        rows=rows,
        cta_text="Open Admin" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"💬 Quote request · {name} · {item_label}",
        html,
    )


async def notify_client_quote_received(client: dict, item: dict, message: str) -> None:
    """Auto-responder: thank the client for their quote request so they know
    we got it and don't feel ghosted while we draft a real reply."""
    to_email = (client or {}).get("email") or ""
    if not to_email:
        return
    name = (client or {}).get("name") or "there"
    first_name = name.split()[0] if name else "there"
    kind = "training program" if item.get("kind") == "program" else "service"
    item_label = item.get("name") or "that"
    rows = [
        ("Interested in", item_label),
    ]
    if item.get("price"):
        rows.append(("Listed price", f"${float(item['price']):.2f}"))
    if message:
        rows.append(("Your message", message))
    intro = (
        f"Hey {first_name}! 🐾 Thanks for asking about <strong>{item_label}</strong> — "
        f"we got your request and someone will be in touch within <strong>24 hours</strong> "
        f"with availability and any other details you need."
        f"<br/><br/>"
        f"In the meantime, feel free to browse the rest of our {kind}s in the portal — "
        f"or reply to this email directly with any other questions."
    )
    html = _wrap(
        title="We got it — talk soon!",
        intro=intro,
        rows=rows,
        cta_text="Open Client Portal" if APP_PUBLIC_URL else None,
        cta_url=APP_PUBLIC_URL or None,
        show_install=False,
    )
    await _send(
        to_email,
        f"We got your request about {item_label} — Sit Happens",
        html,
    )



async def notify_admin_training_log(dog: dict, log: dict, client: dict) -> None:
    """A client logged a training note on their dog — notify the operator."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    rows = [
        ("Dog", dog.get("name", "—")),
        ("Client", client.get("name", "—")),
        ("Date", log.get("date", "—")),
    ]
    if log.get("tags"):
        rows.append(("Tags", ", ".join(log["tags"])))
    if log.get("note"):
        rows.append(("Note", log["note"]))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"📝 New training note · {dog.get('name', '')}",
        intro=f"<strong>{client.get('name', 'A client')}</strong> just added a training note for <strong>{dog.get('name','their dog')}</strong>.",
        rows=rows,
        cta_text="Open Pipeline" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"Training note · {dog.get('name','')} · {client.get('name','')}",
        html,
    )


async def notify_admin_homework_section_log(hw: dict, entry: dict, client: dict, dog: dict) -> None:
    """A client logged a homework session — notify the operator."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    section_name = "—"
    snap = hw.get("template_snapshot") or {}
    for s in snap.get("sections", []):
        if s.get("id") == entry.get("section_id"):
            section_name = s.get("name") or s.get("label") or section_name
            break
    rows = [
        ("Dog", dog.get("name", "—") if dog else "—"),
        ("Client", client.get("name", "—")),
        ("Homework", hw.get("title", "—")),
        ("Section", section_name),
        ("Date", entry.get("date", "—")),
    ]
    if entry.get("note"):
        rows.append(("Note", entry["note"]))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title="📋 Homework session logged",
        intro=f"<strong>{client.get('name', 'A client')}</strong> just logged a training session for <strong>{hw.get('title','homework')}</strong>.",
        rows=rows,
        cta_text="Open Homework" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"Homework session · {hw.get('title','')} · {client.get('name','')}",
        html,
    )


async def notify_admin_homework_completed(hw: dict, client: dict, dog: dict) -> None:
    """A client marked a homework assignment as complete — notify the operator."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return
    rows = [
        ("Dog", dog.get("name", "—") if dog else "—"),
        ("Client", client.get("name", "—")),
        ("Homework", hw.get("title", "—")),
        ("Completed", hw.get("completed_at", "—")),
    ]
    if hw.get("completion_note"):
        rows.append(("Note", hw["completion_note"]))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"✅ Homework completed · {hw.get('title','')}",
        intro=f"<strong>{client.get('name', 'A client')}</strong> just finished a homework assignment.",
        rows=rows,
        cta_text="Open Homework" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"Homework completed · {hw.get('title','')} · {client.get('name','')}",
        html,
    )


async def notify_client_homework_assigned(hw: dict, client: dict) -> None:
    """A client just got a new homework assignment — let them know."""
    to_email = client.get("email", "")
    if not to_email:
        return
    rows = [
        ("Dog", hw.get("dog_name", "—")),
        ("Assignment", hw.get("title", "—")),
    ]
    if hw.get("due_date"):
        rows.append(("Due", hw["due_date"]))
    if hw.get("assigned_by"):
        rows.append(("Assigned by", hw["assigned_by"]))
    if hw.get("instructions"):
        # Trim long instructions for the email preview
        notes = hw["instructions"]
        if len(notes) > 280:
            notes = notes[:280] + "…"
        rows.append(("Notes", notes))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    first_name = (client.get('name') or 'there').split(' ')[0]
    html = _wrap(
        title=f"📚 New homework · {hw.get('dog_name', '')}",
        intro=f"Hi {first_name}, your trainer just assigned <strong>{hw.get('title','a new homework')}</strong> for <strong>{hw.get('dog_name','your pup')}</strong>. Log in to your portal to start tracking sessions.",
        rows=rows,
        cta_text="Open Portal" if cta_url else None,
        cta_url=cta_url,
    )
    await _send(
        to_email,
        f"New homework · {hw.get('title','')} · {hw.get('dog_name','')}",
        html,
    )


async def notify_client_low_credits(client: dict, service_type: str, remaining: int) -> None:
    """Heads-up to the client when their daycare/training credits hit the
    low-balance threshold (currently 2 or fewer)."""
    to_email = client.get("email", "")
    if not to_email:
        return
    label = "Training" if service_type == "training" else "Daycare"
    unit = "sessions" if service_type == "training" else "days"
    rows = [
        ("Pool", f"{label} credits"),
        ("Remaining", f"{remaining} {unit}"),
    ]
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    first_name = (client.get('name') or 'there').split(' ')[0]
    intro_state = "you're out of credits" if remaining <= 0 else f"you've only got <strong>{remaining} {unit}</strong> left on your <strong>{label.lower()}</strong> pack"
    html = _wrap(
        title=f"⚠️ Low {label.lower()} credits",
        intro=f"Hi {first_name}, heads up — {intro_state}. Reach out anytime and we'll get a new pack set up so {label.lower()} doesn't pause.",
        rows=rows,
        cta_text="Open Portal" if cta_url else None,
        cta_url=cta_url,
    )
    await _send(
        to_email,
        f"Low {label.lower()} credits · {remaining} {unit} left",
        html,
    )


async def notify_client_pack_receipt(client: dict, lines: list, totals: dict, payment_method: str, note: str, sold_by: str, sold_at: str) -> None:
    """Email a receipt to the client after one or more credit packs are sold.
    `lines` is [{name, qty, unit_price, line_total, service_type}], totals is
    the same shape returned by /sell-packs."""
    to_email = client.get("email", "")
    if not to_email:
        return
    rows_html = "".join(
        f'<tr>'
        f'<td style="padding:10px 12px;color:#0f172a;font-size:14px;font-weight:700;border-bottom:1px solid #e2e8f0;">'
        f'{ln["name"]}<br/><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">{ln["qty"]} × ${ln["unit_price"]:.2f} · {("training sessions" if ln.get("service_type")=="training" else "daycare credits")}</span></td>'
        f'<td style="padding:10px 12px;color:#0f172a;font-size:14px;font-weight:800;text-align:right;border-bottom:1px solid #e2e8f0;">${ln["line_total"]:.2f}</td>'
        f'</tr>'
        for ln in lines
    )
    grand_total = round((totals.get("daycare", {}).get("price", 0) or 0) + (totals.get("training", {}).get("price", 0) or 0), 2)
    pool_breakdown = ""
    if totals.get("daycare", {}).get("qty", 0):
        pool_breakdown += f"<tr><td style='padding:6px 12px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;'>Daycare added</td><td style='padding:6px 12px;color:#0f172a;font-size:14px;font-weight:800;text-align:right;'>+{totals['daycare']['qty']} credits</td></tr>"
    if totals.get("training", {}).get("qty", 0):
        pool_breakdown += f"<tr><td style='padding:6px 12px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;'>Training added</td><td style='padding:6px 12px;color:#0f172a;font-size:14px;font-weight:800;text-align:right;'>+{totals['training']['qty']} sessions</td></tr>"

    method_label = (payment_method or "cash").title()
    note_html = f'<p style="margin:14px 0 0 0;color:#64748b;font-size:13px;font-style:italic;">Note: {note}</p>' if note else ""
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    cta_html = (
        f'<a href="{cta_url}" style="display:inline-block;background:{BRAND_BLUE};color:#fff;text-decoration:none;'
        f'padding:14px 28px;border-radius:6px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;font-size:13px;margin-top:18px;">Open Portal</a>'
        if cta_url else ""
    )
    first_name = (client.get("name") or "there").split(" ")[0]
    body_html = f"""<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:{BRAND_DARK};padding:24px 32px;">
          <p style="margin:0;color:{BRAND_GREEN};font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.25em;">Sit Happens · Receipt</p>
          <h1 style="margin:6px 0 0 0;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.01em;">Thanks, {first_name}!</h1>
          <p style="margin:8px 0 0 0;color:#94a3b8;font-size:13px;">Your credit pack purchase has been recorded.</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <table cellpadding="0" cellspacing="0" style="width:100%;">{rows_html}</table>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:10px;">{pool_breakdown}</table>
          <table cellpadding="0" cellspacing="0" style="width:100%;margin-top:14px;border-top:2px solid #0f172a;">
            <tr>
              <td style="padding:12px 12px 4px 12px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;">Payment</td>
              <td style="padding:12px 12px 4px 12px;color:#0f172a;font-size:14px;font-weight:800;text-align:right;">{method_label}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px 12px 12px;color:#0f172a;font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:0.04em;">Total charged</td>
              <td style="padding:4px 12px 12px 12px;color:{BRAND_GREEN};font-size:22px;font-weight:900;text-align:right;">${grand_total:.2f}</td>
            </tr>
          </table>
          {note_html}
          <p style="margin:18px 0 0 0;color:#64748b;font-size:12px;">Sold {sold_at[:10]} by {sold_by}. Credits never expire.</p>
          {cta_html}
          {_install_footer()}
        </td></tr>
        <tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.5;">Sit Happens Dog Training · Daycare · Boarding<br/>
          Questions about this receipt? Just reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""
    await _send(
        to_email,
        f"Receipt · ${grand_total:.2f} · Sit Happens credit packs",
        body_html,
    )


async def notify_client_booking_approved(booking: dict, client: dict) -> None:
    """Booking approved — let the client know."""
    to_email = client.get("email", "")
    if not to_email:
        return
    svc_label = _service_label(booking.get("service_type", ""))
    if booking.get("service_type") == "grooming" and booking.get("grooming_type"):
        gt = "Bath" if booking["grooming_type"] == "bath" else "Nail Trim"
        svc_label = f"{svc_label} · {gt}"
    rows = [
        ("Dog", booking.get("dog_name", "—")),
        ("Service", svc_label),
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



async def send_account_claim(
    to_email: str,
    client_name: str,
    claim_url: str,
    is_reset: bool = False,
    expires_days: int = 7,
) -> None:
    """Send a 'Claim your account' (or 'Reset your password') email to a client.
    The claim URL embeds a single-use token that the public /claim page consumes."""
    first = (client_name or "there").split(" ")[0]
    if is_reset:
        title = "Reset your password"
        intro = (
            f"Hi {first}, we received a request to reset the password on your Sit Happens portal. "
            f"Tap the button below to set a new one. The link expires in {expires_days} days."
        )
        subject = "Reset your Sit Happens password"
        cta_text = "Reset password"
    else:
        title = "Welcome — claim your account"
        intro = (
            f"Hi {first}, your Sit Happens client portal is ready. "
            f"Tap the button below to set your password and finish activating your account."
        )
        subject = "Activate your Sit Happens portal"
        cta_text = "Claim your account"

    instructions_html = f"""
<div style="margin:8px 0 20px 0;padding:18px 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
  <p style="margin:0 0 10px 0;color:{BRAND_DARK};font-size:13px;font-weight:900;text-transform:uppercase;letter-spacing:0.1em;">How to {('reset your password' if is_reset else 'claim your account')}</p>
  <ol style="margin:0;padding-left:22px;color:#334155;font-size:14px;line-height:1.7;">
    <li>Tap the <strong>{cta_text}</strong> button below.</li>
    <li>Choose a password (at least 6 characters) and confirm it.</li>
    <li>You'll be signed in to your portal — bookmark it or install the app from your home screen.</li>
  </ol>
  <p style="margin:12px 0 0 0;color:#64748b;font-size:12px;">This link expires in {expires_days} days. If you didn't expect this email, you can ignore it.</p>
</div>"""

    html = _wrap(
        title=title,
        intro=intro + instructions_html,
        rows=[("Account", to_email)],
        cta_text=cta_text,
        cta_url=claim_url,
    )
    await _send(to_email, subject, html)
