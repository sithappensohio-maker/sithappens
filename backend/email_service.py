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


def _wrap(title: str, intro: str, rows: list, cta_text: str | None = None, cta_url: str | None = None, show_install: bool = True, body_html: str = "") -> str:
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
    rows_block = f'<table cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:8px 0 20px 0;">{rows_html}</table>' if rows_html else ""
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
          {rows_block}
          {body_html}
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


async def _send(to_email: str, subject: str, html: str) -> bool:
    """Fire-and-forget send. Logs failures but never raises. Returns True on success."""
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping email to %s", to_email)
        return False
    if not to_email:
        return False
    try:
        params = {"from": SENDER_EMAIL, "to": [to_email], "subject": subject, "html": html}
        # Replies land in the admin inbox instead of the unmonitored sender address
        if ADMIN_NOTIFICATION_EMAIL:
            params["reply_to"] = ADMIN_NOTIFICATION_EMAIL
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("Email sent to %s: %s", to_email, result.get("id") if isinstance(result, dict) else result)
        return True
    except Exception as e:
        logger.warning("Email send to %s failed: %s", to_email, e)
        return False


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


async def notify_admin_bulk_booking(
    bookings: list,
    client: dict,
    *,
    service_type: str = "",
    skipped: list | None = None,
    kind: str = "multi-dates",
) -> None:
    """A client just created multiple bookings in one shot (recurring schedule
    or pick-specific-days). Send ONE summary email instead of N spammy alerts.
    `kind` is a short label like 'recurring' or 'multi-dates' that shows in the
    subject so the operator knows at a glance what flow triggered it.
    """
    if not ADMIN_NOTIFICATION_EMAIL or not bookings:
        return
    svc_label = _service_label(service_type or bookings[0].get("service_type", "")) if bookings else "—"
    dog_name = bookings[0].get("dog_name", "—") if bookings else "—"
    # Up to 10 dates inline; rest summarized.
    dates = [b.get("date") for b in bookings if b.get("date")]
    dates_preview = ", ".join(dates[:10])
    if len(dates) > 10:
        dates_preview += f" … (+{len(dates) - 10} more)"
    rows = [
        ("Client", client.get("name") or bookings[0].get("client_name", "—")),
        ("Dog", dog_name),
        ("Service", svc_label),
        ("Created", str(len(bookings))),
        ("Dates", dates_preview or "—"),
        ("Phone", client.get("phone") or "—"),
        ("Email", client.get("email") or "—"),
    ]
    if skipped:
        skipped_lines = [f"{s.get('date','?')} — {s.get('reason','?')}" for s in skipped[:6]]
        if len(skipped) > 6:
            skipped_lines.append(f"… (+{len(skipped) - 6} more)")
        rows.append(("Skipped", "<br/>".join(skipped_lines)))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    kind_label = "recurring schedule" if kind == "recurring" else "multi-date booking"
    html = _wrap(
        title=f"🐾 {len(bookings)} New Bookings · {dog_name}",
        intro=f"<strong>{client.get('name') or 'A client'}</strong> just created a {kind_label} for <strong>{dog_name}</strong>. All bookings are pending your approval.",
        rows=rows,
        cta_text="Open Bookings" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
    )
    await _send(
        ADMIN_NOTIFICATION_EMAIL,
        f"{len(bookings)} new bookings · {dog_name} · {svc_label}",
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


async def notify_trainer_monday_digest(data: dict) -> bool:
    """Monday-morning digest to the operator (admin email)."""
    if not ADMIN_NOTIFICATION_EMAIL:
        return False
    week_start = data.get("week_start", "")
    week_end = data.get("week_end", "")

    def section(title: str, icon: str, rows_html: str, empty: str = "") -> str:
        if not rows_html and not empty:
            return ""
        return f"""
        <div style='margin:18px 0;'>
          <h3 style='margin:0 0 8px 0;color:{BRAND_DARK};font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;'>
            {icon} {title}
          </h3>
          {rows_html or f"<p style='margin:0;color:#94a3b8;font-style:italic;font-size:14px;'>{empty}</p>"}
        </div>
        """

    leaders_rows = "".join(
        f"<div style='padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:{BRAND_DARK};'>"
        f"<strong style='color:{BRAND_GREEN};'>🔥 {it['streak']}-day</strong> · <strong>{it['dog']}</strong> ({it['client']}) — {it['title']}</div>"
        for it in data.get("streak_leaders", [])
    )

    lost_rows = "".join(
        f"<div style='padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:{BRAND_DARK};'>"
        f"<strong>{it['dog']}</strong> ({it['client']}) lost a <strong>{it['streak_was']}-day</strong> streak on {it['title']}</div>"
        for it in data.get("lost_streak", [])
    )

    pending_rows = "".join(
        f"<div style='padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:{BRAND_DARK};'>"
        f"<strong>Day {it['day']}</strong> · {it['dog']} ({it['client']}) · {it['title']} "
        f"<span style='color:#94a3b8;font-size:12px;'>· submitted {(it.get('submitted_at') or '')[:10]}</span></div>"
        for it in data.get("pending_reviews", [])
    )

    qs_rows = "".join(
        f"<div style='padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:{BRAND_DARK};'>"
        f"<strong>{it['dog']}</strong> ({it['client']}) · Day {it['day']}<br/>"
        f"<em style='color:#475569;'>\"{it.get('text','')[:240]}\"</em></div>"
        for it in data.get("unanswered_qs", [])
    )

    done_rows = "".join(
        f"<div style='padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:{BRAND_DARK};'>"
        f"🎓 <strong>{it['dog']}</strong> ({it['client']}) finished <strong>{it['title']}</strong> on {it['completed_at']} "
        f"<span style='color:#dc2626;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;'>· upload cert</span></div>"
        for it in data.get("just_completed", [])
    )

    vax_rows = "".join(
        f"<div style='padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:{BRAND_DARK};'>"
        f"<strong>{it['dog']}</strong> ({it['client']}) · {it['vaccine']} expires {it['expires']}</div>"
        for it in data.get("expiring_vax", [])
    )

    bookings_block = ""
    if data.get("week_bookings"):
        bookings_block = f"""
        <div style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:18px 0;'>
          <p style='margin:0 0 4px 0;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;'>This week</p>
          <p style='margin:0;color:{BRAND_DARK};font-size:18px;font-weight:900;'>
            {data['week_bookings']} bookings · ${data.get('week_revenue_forecast', 0):,.2f} forecast
          </p>
        </div>
        """

    body_html = (
        bookings_block
        + section("Streak leaders 🔥", "🔥", leaders_rows, "No active streaks ≥ 3 days.")
        + section("Lost-the-streak nudges 📉", "📉", lost_rows, "Nobody needs a nudge — nice.")
        + section(f"Review queue ({len(data.get('pending_reviews', []))})", "⏳", pending_rows, "Inbox zero.")
        + section(f"Unanswered questions ({len(data.get('unanswered_qs', []))})", "❓", qs_rows, "All caught up.")
        + section(f"Just completed — upload certs ({len(data.get('just_completed', []))})", "🎓", done_rows, "No new completions this week.")
        + section(f"Vaccines expiring this week ({len(data.get('expiring_vax', []))})", "🩺", vax_rows, "")
    )

    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"🐾 Your Monday brief · {week_start} → {week_end}",
        intro="Here's your week ahead. Knock these out before the coffee gets cold.",
        rows=[],
        cta_text="Open Dashboard" if cta_url else None,
        cta_url=cta_url,
        show_install=False,
        body_html=body_html,
    )
    return bool(await _send(ADMIN_NOTIFICATION_EMAIL, f"Monday brief · {week_start}", html))


async def notify_client_certificate_issued(hw: dict, client: dict) -> bool:
    """Tell the client their completion certificate is ready to download."""
    to_email = client.get("email", "")
    if not to_email:
        return False
    first_name = (client.get('name') or 'there').split(' ')[0]
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    rows = [
        ("Dog", hw.get("dog_name", "—")),
        ("Plan", hw.get("title", "—")),
        ("Completed", hw.get("completed_at", "")[:10] if hw.get("completed_at") else "—"),
    ]
    intro = (
        f"🎓 Huge congrats, {first_name}! <strong>{hw.get('dog_name','')}</strong> just earned their "
        f"<strong>{hw.get('title','')}</strong> certificate. Open the portal to download and share it."
    )
    html = _wrap(
        title=f"🎓 Certificate ready · {hw.get('dog_name','')}",
        intro=intro,
        rows=rows,
        cta_text="Download Certificate" if cta_url else None,
        cta_url=cta_url,
    )
    return bool(await _send(to_email, f"🎓 Certificate ready · {hw.get('dog_name','')}", html))


async def notify_client_homework_reminder(client: dict, plans: list) -> bool:
    """Email the client a 'time to practice' nudge for their open daily-tracker
    plans. `plans` is a list of {hw_title, dog_name, today_focus, day_number, total_days}."""
    to_email = client.get("email", "")
    if not to_email or not plans:
        return False
    first_name = (client.get('name') or 'there').split(' ')[0]
    body_rows = "".join(
        f"""
        <div style='border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin:10px 0;background:#fff;'>
          <p style='margin:0 0 4px 0;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;'>
            {p.get('dog_name','')} · Day {p.get('day_number',0)} of {p.get('total_days',0)}
          </p>
          <h3 style='margin:0 0 6px 0;color:{BRAND_DARK};font-size:17px;font-weight:900;'>{p.get('hw_title','')}</h3>
          <p style='margin:0;color:#0f172a;font-size:14px;'>Today's focus: <strong>{p.get('today_focus','')}</strong></p>
        </div>
        """
        for p in plans
    )
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    intro = (
        f"Hi {first_name} — it's training time. Here's what's on the schedule today. "
        f"Even 5 minutes counts. 🐾"
    )
    html = _wrap(
        title="⏰ Time to practice",
        intro=intro,
        rows=[],
        cta_text="Open Portal" if cta_url else None,
        cta_url=cta_url,
        body_html=body_rows,
    )
    return bool(await _send(to_email, f"Practice nudge · {plans[0].get('dog_name','')} 🐾", html))


async def notify_client_weekly_homework_digest(client: dict, items: list, week_start: str, week_end: str) -> bool:
    """Sunday-night digest of the client's daily-tracker progress for the week.

    `items` is a list of dicts shaped:
        {hw_title, dog_name, total_days, approved_total, approved_this_week,
         streak, photos: [data_url, …], notes: [{day, focus, note}], next_focus}
    Returns True if an email was actually sent."""
    to_email = client.get("email", "")
    if not to_email or not items:
        return False
    first_name = (client.get('name') or 'there').split(' ')[0]
    rows = []
    for it in items:
        streak_chip = f"<span style='display:inline-block;background:{BRAND_GREEN}15;color:{BRAND_GREEN};font-weight:900;font-size:12px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border-radius:4px;'>🔥 {it['streak']}-day streak</span>" if it.get("streak", 0) > 0 else ""
        progress = f"{it.get('approved_total', 0)} of {it.get('total_days', 0)} approved"
        this_week = f"{it.get('approved_this_week', 0)} this week"
        notes_html = ""
        for n in (it.get("notes") or [])[:3]:
            notes_html += f"""
              <div style='background:#f8fafc;border-left:3px solid {BRAND_BLUE};padding:8px 12px;margin:6px 0;border-radius:4px;'>
                <p style='margin:0 0 4px 0;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;'>Day {n['day']} · {n.get('focus','')}</p>
                <p style='margin:0;color:#0f172a;font-size:14px;font-style:italic;'>"{n['note']}"</p>
              </div>
            """
        photos_html = ""
        for p in (it.get("photos") or [])[:3]:
            photos_html += f"<img src='{p}' alt='' width='110' height='110' style='display:inline-block;width:110px;height:110px;object-fit:cover;border-radius:6px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.08);margin-right:6px;' />"
        next_html = ""
        if it.get("next_focus"):
            next_html = f"""
              <p style='margin:12px 0 0 0;color:{BRAND_DARK};font-size:14px;'>
                <span style='color:#64748b;font-weight:900;text-transform:uppercase;letter-spacing:.06em;font-size:11px;'>Up next:</span>
                <strong>{it['next_focus']}</strong>
              </p>
            """
        rows.append(f"""
          <div style='border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin:14px 0;background:#fff;'>
            <p style='margin:0 0 4px 0;color:#64748b;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;'>{it.get('dog_name','')}</p>
            <h3 style='margin:0 0 8px 0;color:{BRAND_DARK};font-size:18px;font-weight:900;'>{it.get('hw_title','')}</h3>
            <p style='margin:0 0 10px 0;color:#475569;font-size:14px;'>
              {streak_chip} <span style='color:#64748b;'>{progress} · {this_week}</span>
            </p>
            {photos_html and f"<div style='margin:10px 0;'>{photos_html}</div>" or ""}
            {notes_html and f"<div style='margin-top:8px;'>{notes_html}</div>" or ""}
            {next_html}
          </div>
        """)
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    intro = (
        f"Hi {first_name}, here's your weekly training round-up for "
        f"<strong>{week_start} → {week_end}</strong>. Keep stacking days — your dog notices."
    )
    html = _wrap(
        title=f"🐾 Weekly Training Recap · {len(items)} plan{'s' if len(items)!=1 else ''} in flight",
        intro=intro,
        rows=[],  # custom body below
        cta_text="Open Portal" if cta_url else None,
        cta_url=cta_url,
        body_html="".join(rows),
    )
    subject = f"Weekly training recap · {len(items)} plan{'s' if len(items)!=1 else ''} 🐾"
    return bool(await _send(to_email, subject, html))


async def notify_client_day_reviewed(hw: dict, day_number: int, action: str, review_note: str, client: dict) -> None:
    """Tell the client whether their Day-N submission was approved or needs a redo."""
    to_email = client.get("email", "")
    if not to_email:
        return
    first_name = (client.get('name') or 'there').split(' ')[0]
    if action == "approved":
        emoji = "✅"
        verb = "approved your Day {n} check-in"
        body_intro = (
            f"Great work, {first_name}! Your trainer just <strong>approved Day {day_number}</strong> "
            f"for <strong>{hw.get('dog_name', 'your pup')}</strong>. Day {day_number + 1} is now unlocked."
        )
    else:
        emoji = "↩️"
        verb = "asked you to redo Day {n}"
        body_intro = (
            f"Hi {first_name}, your trainer sent <strong>Day {day_number}</strong> back for a redo. "
            f"Check the note below and re-submit when you're ready."
        )
    rows = [
        ("Dog", hw.get("dog_name", "—")),
        ("Plan", hw.get("title", "—")),
        ("Day", f"Day {day_number} of {hw.get('total_days') or '?'}"),
    ]
    if review_note:
        note = review_note if len(review_note) <= 400 else review_note[:400] + "…"
        rows.append(("Note from your trainer", note))
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"{emoji} {verb.format(n=day_number)} · {hw.get('dog_name','')}",
        intro=body_intro,
        rows=rows,
        cta_text="Open Portal" if cta_url else None,
        cta_url=cta_url,
    )
    subject = (
        f"Day {day_number} approved · {hw.get('dog_name','')}"
        if action == "approved"
        else f"Day {day_number} needs a redo · {hw.get('dog_name','')}"
    )
    await _send(to_email, subject, html)


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



async def notify_client_dog_birthday(client: dict, dog: dict) -> None:
    """Wish the owner a happy birthday for their dog. Uses the dog's first
    photo (if any) as a hero image. No discount code — just a card."""
    to_email = client.get("email", "")
    if not to_email:
        return
    dog_name = (dog.get("name") or "your pup").strip()
    breed = (dog.get("breed") or "").strip()
    first_name = (client.get("name") or "there").split(" ")[0]
    photos = dog.get("photos") or []
    hero_html = ""
    if photos and isinstance(photos[0], str) and photos[0]:
        hero_html = (
            f'<div style="margin:-28px -32px 20px -32px;background:#0f172a;">'
            f'<img src="{photos[0]}" alt="{dog_name}" '
            f'style="display:block;width:100%;max-height:300px;object-fit:cover;" />'
            f"</div>"
        )
    intro = (
        f"{hero_html}"
        f"Hi {first_name} — it's a special day! 🎂<br/><br/>"
        f"All of us at Sit Happens want to wish <strong>{dog_name}</strong> "
        f"the happiest birthday. Whether it's their 1st or their 15th, every "
        f"birthday with a great pup is one worth celebrating."
    )
    rows = [
        ("Birthday Pup", dog_name + (f" · {breed}" if breed else "")),
        ("From", "The Sit Happens crew 🐾"),
    ]
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"🎉 Happy birthday, {dog_name}!",
        intro=intro,
        rows=rows,
        cta_text="Open Portal" if cta_url else None,
        cta_url=cta_url,
    )
    await _send(
        to_email,
        f"🎂 Happy birthday, {dog_name}!",
        html,
    )


async def notify_client_vaccine_expiring(client: dict, dog: dict, vaccines_expiring: list) -> None:
    """Heads-up that one or more of a dog's vaccines expires in ~30 days.
    `vaccines_expiring` is [{"name": "Rabies", "expires_on": "2026-06-15"}, ...]."""
    to_email = client.get("email", "")
    if not to_email or not vaccines_expiring:
        return
    dog_name = (dog.get("name") or "your dog").strip()
    first_name = (client.get("name") or "there").split(" ")[0]
    list_html = "".join(
        f'<li style="margin:4px 0;color:#0f172a;"><strong>{v["name"]}</strong> — expires {v["expires_on"]}</li>'
        for v in vaccines_expiring
    )
    intro = (
        f"Hi {first_name}, a quick heads-up — <strong>{dog_name}</strong>'s "
        f"vaccines are coming up for renewal in the next 30 days. Please book "
        f"your vet visit and upload the updated record through your portal so "
        f"we never have to turn {dog_name} away at drop-off."
        f'<ul style="margin:14px 0 0 18px;padding:0;">{list_html}</ul>'
    )
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    rows = [("Dog", dog_name), ("Renewals due", str(len(vaccines_expiring)))]
    html = _wrap(
        title=f"📋 Vaccine renewal coming up for {dog_name}",
        intro=intro,
        rows=rows,
        cta_text="Upload Updated Record" if cta_url else None,
        cta_url=cta_url,
    )
    await _send(
        to_email,
        f"📋 {dog_name}: vaccine renewal in 30 days",
        html,
    )



async def notify_admin_pl_report(pdf_bytes: bytes, start_date: str, end_date: str, summary: dict) -> None:
    """Email the admin a Profit & Loss PDF report as an attachment.
    `summary` is the dict returned by `pl_report.build_pl_data` — used to
    render KPI snapshots in the email body."""
    if not ADMIN_NOTIFICATION_EMAIL:
        logger.warning("ADMIN_NOTIFICATION_EMAIL not set — skipping P&L email")
        return
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping P&L email")
        return

    service_income = summary.get("income", {}).get("completed_total", 0)
    retail_income = summary.get("retail", {}).get("total", 0)
    income = summary.get("income", {}).get("gross_total") or (service_income + retail_income)
    expenses = summary.get("expenses", {}).get("total", 0)
    net = summary.get("net", 0)
    net_color = "#16a34a" if net >= 0 else "#dc2626"
    rows = [
        ("Period", f"{start_date} → {end_date}"),
        ("Service income", f"${service_income:,.2f}"),
        ("Retail income", f"${retail_income:,.2f}"),
        ("Gross income", f"${income:,.2f}"),
        ("Expenses", f"${expenses:,.2f}"),
        ("Net profit", f"${net:,.2f}"),
        ("Completed bookings", str(summary.get("income", {}).get("completed_count", 0))),
    ]
    cta_url = f"{APP_PUBLIC_URL}/" if APP_PUBLIC_URL else None
    html = _wrap(
        title=f"📊 P&amp;L Report · {start_date} → {end_date}",
        intro=(
            "Your monthly Profit &amp; Loss report is attached as a PDF. "
            f"<strong style='color:{net_color}'>Net: ${net:,.2f}</strong> for this period."
        ),
        rows=rows,
        cta_text="Open Income Dashboard" if cta_url else None,
        cta_url=cta_url + "#income" if cta_url else None,
        show_install=False,
    )

    attachment_name = f"PL_Report_{start_date}_to_{end_date}.pdf"
    try:
        params = {
            "from": SENDER_EMAIL,
            "to": [ADMIN_NOTIFICATION_EMAIL],
            "subject": f"📊 P&L Report · {start_date} → {end_date} · Net ${net:,.2f}",
            "html": html,
            "attachments": [{
                "filename": attachment_name,
                "content": list(pdf_bytes),  # Resend SDK accepts a list of ints
            }],
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("P&L email sent to %s: %s", ADMIN_NOTIFICATION_EMAIL,
                    result.get("id") if isinstance(result, dict) else result)
    except Exception as e:
        logger.warning("P&L email send failed: %s", e)
