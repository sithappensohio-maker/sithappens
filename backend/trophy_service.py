"""Trophy engine: idempotent awarding, auto-evaluators that run after the
relevant write hooks, and a Pillow-based share-card PNG renderer."""
from __future__ import annotations

import base64
import io
import logging
import re
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Any, Dict, List, Optional

from PIL import Image, ImageDraw, ImageFont

from trophies_data import SEED_TROPHIES, TIER_COLORS

logger = logging.getLogger("sithappens.trophies")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def seed_trophies_if_empty(db) -> None:
    """Insert default catalog on first boot. Won't overwrite admin edits — only
    inserts trophy codes that don't already exist."""
    existing_codes = {
        t["code"] for t in await db.trophies.find({}, {"_id": 0, "code": 1}).to_list(500)
    }
    to_insert = []
    now = _now_iso()
    for t in SEED_TROPHIES:
        if t["code"] in existing_codes:
            continue
        doc = {**t, "id": str(uuid.uuid4()), "created_at": now}
        to_insert.append(doc)
    if to_insert:
        await db.trophies.insert_many(to_insert)
        logger.info("Seeded %d default trophies", len(to_insert))


async def _already_awarded(db, recipient_type: str, recipient_id: str, code: str) -> bool:
    return await db.awarded_trophies.find_one(
        {"recipient_type": recipient_type, "recipient_id": recipient_id, "trophy_code": code, "revoked": {"$ne": True}},
        {"_id": 0, "id": 1},
    ) is not None


async def award_trophy(
    db,
    *,
    recipient_type: str,
    recipient_id: str,
    trophy_code: str,
    awarded_by: str = "system",
    note: str = "",
    meta: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Idempotently award a trophy. Returns the awarded row on success, None if
    already held or trophy code is unknown/inactive."""
    if await _already_awarded(db, recipient_type, recipient_id, trophy_code):
        return None
    trophy = await db.trophies.find_one({"code": trophy_code, "active": True}, {"_id": 0})
    if not trophy:
        return None
    # Resolve recipient display name for the audit row.
    recipient_name = ""
    dog_id = None
    client_id = None
    if recipient_type == "dog":
        dog = await db.dogs.find_one({"id": recipient_id}, {"_id": 0, "name": 1, "owner_id": 1})
        if not dog:
            return None
        recipient_name = dog.get("name") or ""
        dog_id = recipient_id
        client_id = dog.get("owner_id")
    elif recipient_type == "client":
        client = await db.clients.find_one({"id": recipient_id}, {"_id": 0, "name": 1})
        if not client:
            return None
        recipient_name = client.get("name") or ""
        client_id = recipient_id
    else:
        return None

    awarded = {
        "id": str(uuid.uuid4()),
        "trophy_code": trophy_code,
        "trophy_name": trophy.get("name", trophy_code),
        "trophy_tier": trophy.get("tier", "bronze"),
        "trophy_icon": trophy.get("icon", "fa-trophy"),
        # Snapshot the custom image at award-time so historical shares keep
        # their visual even if the admin later edits/removes the catalog image.
        "trophy_custom_image": trophy.get("custom_image", "") or "",
        "trophy_description": trophy.get("description", ""),
        "recipient_type": recipient_type,
        "recipient_id": recipient_id,
        "recipient_name": recipient_name,
        "dog_id": dog_id,
        "client_id": client_id,
        "awarded_by": awarded_by,
        "note": note or "",
        "meta": meta or {},
        "awarded_at": _now_iso(),
        "revoked": False,
        "seen_by_client": False,
    }
    await db.awarded_trophies.insert_one(awarded)
    awarded.pop("_id", None)
    return awarded


# ───────────────────────── evaluators ──────────────────────────


async def _eligible_trophies(db, *, category: str, kind: str) -> List[Dict[str, Any]]:
    return await db.trophies.find(
        {
            "category": category,
            "active": True,
            "trigger_type": "auto",
            "trigger_kind": kind,
        },
        {"_id": 0},
    ).sort("threshold", 1).to_list(50)


async def _count_dog_goals_at_5(db, dog_id: str) -> int:
    enrollments = await db.dog_programs.find(
        {"dog_id": dog_id}, {"_id": 0, "goal_progress": 1}
    ).to_list(200)
    n = 0
    for e in enrollments:
        for _gid, gp in (e.get("goal_progress") or {}).items():
            try:
                if int(gp.get("score") or 0) >= 5:
                    n += 1
            except Exception:
                continue
    return n


async def _count_dog_programs_completed(db, dog_id: str) -> int:
    return await db.dog_programs.count_documents({"dog_id": dog_id, "status": "completed"})


async def check_dog_trophies(db, dog_id: str) -> List[Dict[str, Any]]:
    """Re-evaluate auto-trophies for a single dog and award newly-met ones."""
    awarded: List[Dict[str, Any]] = []
    # 1) goal_score_5_count
    goal5 = await _count_dog_goals_at_5(db, dog_id)
    for t in await _eligible_trophies(db, category="dog", kind="goal_score_5_count"):
        if goal5 >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="dog", recipient_id=dog_id, trophy_code=t["code"],
                meta={"goal_score_5_count_at_award": goal5},
            )
            if row:
                awarded.append(row)
    # 2) program_completed
    progs = await _count_dog_programs_completed(db, dog_id)
    for t in await _eligible_trophies(db, category="dog", kind="program_completed"):
        if progs >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="dog", recipient_id=dog_id, trophy_code=t["code"],
                meta={"programs_completed_at_award": progs},
            )
            if row:
                awarded.append(row)
    return awarded


async def _count_homework_completed(db, client_id: str) -> int:
    return await db.homework.count_documents({"client_id": client_id, "status": "completed"})


async def _homework_streak_days(db, client_id: str) -> int:
    """Longest current streak of consecutive days ending today (or yesterday)
    where the client completed at least one homework assignment."""
    docs = await db.homework.find(
        {"client_id": client_id, "status": "completed"},
        {"_id": 0, "completed_at": 1},
    ).to_list(2000)
    days = set()
    for d in docs:
        ts = d.get("completed_at") or ""
        try:
            days.add(datetime.fromisoformat(ts).date())
        except Exception:
            continue
    if not days:
        return 0
    today = date.today()
    # Start anchor: today if hit, else yesterday (so we don't break the streak
    # just because they haven't logged today yet).
    anchor = today if today in days else today - timedelta(days=1)
    streak = 0
    cur = anchor
    while cur in days:
        streak += 1
        cur -= timedelta(days=1)
    return streak


async def _client_visit_count(db, client_id: str) -> int:
    return await db.bookings.count_documents({
        "client_id": client_id,
        "checked_out_at": {"$ne": None, "$exists": True},
    })


async def _client_successful_referrals(db, client_id: str) -> int:
    return await db.referrals.count_documents({"referrer_id": client_id})


async def check_client_trophies(db, client_id: str) -> List[Dict[str, Any]]:
    """Re-evaluate auto-trophies for a single client and award newly-met ones."""
    awarded: List[Dict[str, Any]] = []
    # homework_streak_days
    streak = await _homework_streak_days(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="homework_streak_days"):
        if streak >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"streak_at_award": streak},
            )
            if row:
                awarded.append(row)
    # homework_completed
    hw_done = await _count_homework_completed(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="homework_completed"):
        if hw_done >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"homework_completed_at_award": hw_done},
            )
            if row:
                awarded.append(row)
    # visit_count
    visits = await _client_visit_count(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="visit_count"):
        if visits >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"visit_count_at_award": visits},
            )
            if row:
                awarded.append(row)
    # successful_referrals
    refs = await _client_successful_referrals(db, client_id)
    for t in await _eligible_trophies(db, category="client", kind="successful_referrals"):
        if refs >= int(t.get("threshold") or 0):
            row = await award_trophy(
                db, recipient_type="client", recipient_id=client_id, trophy_code=t["code"],
                meta={"successful_referrals_at_award": refs},
            )
            if row:
                awarded.append(row)
    return awarded


# ─────────────────────── share card PNG ────────────────────────


def _font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    """Try a few common system fonts before falling back to default."""
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates:
        try:
            return ImageFont.truetype(c, size)
        except Exception:
            continue
    return ImageFont.load_default()


def render_share_card_png(awarded: Dict[str, Any]) -> bytes:
    """1200x630 social share card. Renders trophy ring + title + recipient +
    branding. Returns raw PNG bytes."""
    W, H = 1200, 630
    tier = awarded.get("trophy_tier", "bronze")
    colors = TIER_COLORS.get(tier, TIER_COLORS["bronze"])

    img = Image.new("RGB", (W, H), (16, 22, 30))
    draw = ImageDraw.Draw(img)

    # Soft gradient background
    for y in range(H):
        t = y / H
        r = int(16 + (28 - 16) * t)
        g = int(22 + (38 - 22) * t)
        b = int(30 + (54 - 30) * t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Trophy circle on the left
    cx, cy, radius = 300, H // 2, 200
    ring_color = tuple(int(colors["ring"].lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    fill_color = tuple(int(colors["fill"].lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
    # Outer ring
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=fill_color, outline=ring_color, width=12)
    # Inner highlight ring
    draw.ellipse((cx - radius + 24, cy - radius + 24, cx + radius - 24, cy + radius - 24), outline=ring_color, width=4)

    # Centerpiece: admin-uploaded image (preferred) circular-masked inside the
    # ring, falling back to the universal ★ glyph if no image is on the trophy.
    custom_image = awarded.get("trophy_custom_image") or ""
    pasted = False
    if custom_image:
        try:
            # Accept both "data:image/...;base64,XXXX" and raw base64 payloads.
            payload = custom_image.split(",", 1)[1] if custom_image.startswith("data:") else custom_image
            payload = re.sub(r"\s+", "", payload)
            raw = base64.b64decode(payload)
            tile = Image.open(io.BytesIO(raw)).convert("RGBA")
            inner = radius - 36  # leave room for the inner highlight ring
            size = inner * 2
            # Cover-fit (crop to square then scale to size)
            w, h = tile.size
            short = min(w, h)
            left = (w - short) // 2
            top = (h - short) // 2
            tile = tile.crop((left, top, left + short, top + short)).resize((size, size), Image.LANCZOS)
            # Circular mask
            mask = Image.new("L", (size, size), 0)
            ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
            img.paste(tile, (cx - inner, cy - inner), mask)
            pasted = True
        except Exception as exc:
            logger.warning("trophy share-card image paste failed (%s); falling back to glyph", exc)

    if not pasted:
        big = _font(200, bold=True)
        glyph = "★"
        try:
            bbox = draw.textbbox((0, 0), glyph, font=big)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        except Exception:
            tw, th = big.getsize(glyph)
        draw.text((cx - tw // 2, cy - th // 2 - 20), glyph, fill=ring_color, font=big)

    # Right side text block
    text_x = 580
    label_font = _font(22, bold=True)
    title_font = _font(56, bold=True)
    sub_font = _font(32)
    meta_font = _font(22)

    draw.text((text_x, 110), tier.upper() + " TROPHY", fill=ring_color, font=label_font)
    title = awarded.get("trophy_name", "Trophy")
    draw.text((text_x, 145), title, fill=(255, 255, 255), font=title_font)

    recipient = awarded.get("recipient_name", "")
    if recipient:
        prefix = "Awarded to" if awarded.get("recipient_type") == "client" else "Awarded to good dog"
        draw.text((text_x, 230), f"{prefix}", fill=(180, 195, 210), font=meta_font)
        draw.text((text_x, 260), recipient, fill=(255, 255, 255), font=sub_font)

    desc = awarded.get("trophy_description", "") or ""
    if desc:
        # Hand-wrap description to ~36 chars per line
        words, lines, cur = desc.split(), [], ""
        for w in words:
            if len(cur) + len(w) + 1 > 36:
                lines.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            lines.append(cur)
        for i, ln in enumerate(lines[:3]):
            draw.text((text_x, 340 + i * 36), ln, fill=(200, 215, 230), font=meta_font)

    # Footer branding
    brand_font = _font(28, bold=True)
    draw.text((text_x, H - 80), "SIT HAPPENS", fill=(140, 198, 63), font=brand_font)
    draw.text((text_x, H - 48), "Dog Training · Daycare · Boarding", fill=(120, 140, 160), font=meta_font)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
