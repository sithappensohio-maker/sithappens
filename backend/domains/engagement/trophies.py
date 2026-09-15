"""Trophy catalog, awards, sharing and leaderboard endpoints.

Moved out of server.py verbatim; only the owning module changed. Everything the
moved code still needs is injected, and every moved name is handed back so the
host module can re-export it under its original name.
"""
import logging
import uuid
from typing import Any, Dict, Literal, Optional

from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, Field


logger = logging.getLogger("sithappens")


def make_trophy_domain(*, ManualAwardIn, TIER_COLORS, _serialize_awarded, api, award_trophy, business_today, check_client_trophies, db, get_current_user, logger, now_iso, recheck_all_trophies, render_share_card_png, require_admin, require_admin_and_permission):
    class TrophyIn(BaseModel):
        code: str = Field(min_length=2, max_length=64)
        name: str = Field(min_length=1)
        description: Optional[str] = ""
        category: Literal["dog", "client"]
        tier: Literal["bronze", "silver", "gold", "platinum"] = "bronze"
        icon: Optional[str] = "fa-trophy"
        custom_image: Optional[str] = ""  # base64 data URL
        # Sprint 110ak — how the uploaded custom_image is displayed:
        #   "circle"   — current behaviour, cover-crop into a perfect circle
        #   "contain"  — fit the whole design inside the circle (tier ring kept)
        #   "freeform" — no clip, rectangular card, no tier ring (image IS the trophy)
        image_fit: Literal["circle", "contain", "freeform"] = "circle"
        # Sprint 110al — focal point inside the badge for `circle` mode (0-100%).
        # CSS object-position semantics: 50/50 is centred (legacy default), 0/0
        # pins the image's top-left to the badge's top-left, 100/100 the opposite
        # corner. Ignored for `contain` and `freeform`.
        image_offset_x: int = Field(default=50, ge=0, le=100)
        image_offset_y: int = Field(default=50, ge=0, le=100)
        trigger_type: Literal["auto", "manual"] = "manual"
        trigger_kind: Optional[str] = ""
        threshold: int = 0
        active: bool = True

    class TrophyPatch(BaseModel):
        name: Optional[str] = None
        description: Optional[str] = None
        tier: Optional[Literal["bronze", "silver", "gold", "platinum"]] = None
        icon: Optional[str] = None
        custom_image: Optional[str] = None
        image_fit: Optional[Literal["circle", "contain", "freeform"]] = None
        image_offset_x: Optional[int] = Field(default=None, ge=0, le=100)
        image_offset_y: Optional[int] = Field(default=None, ge=0, le=100)
        threshold: Optional[int] = None
        active: Optional[bool] = None

    @api.get("/trophies/catalog")
    async def list_trophy_catalog(_: dict = Depends(get_current_user)):
        """Return all trophy definitions. Tier color palette returned alongside."""
        items = await db.trophies.find({}, {"_id": 0}).to_list(500)
        items.sort(key=lambda t: (t.get("category", ""), t.get("trigger_type", ""), int(t.get("threshold") or 0)))
        return {"trophies": items, "tier_colors": TIER_COLORS}

    @api.post("/trophies/catalog")
    async def create_custom_trophy(body: TrophyIn, _: dict = Depends(require_admin_and_permission("manage_engagement_content"))):
        if await db.trophies.find_one({"code": body.code}):
            raise HTTPException(status_code=400, detail="A trophy with that code already exists")
        doc = body.model_dump()
        doc.update({"id": str(uuid.uuid4()), "is_default": False, "created_at": now_iso()})
        await db.trophies.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @api.put("/trophies/catalog/{code}")
    async def update_trophy(code: str, body: TrophyPatch, _: dict = Depends(require_admin_and_permission("manage_engagement_content"))):
        existing = await db.trophies.find_one({"code": code}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Trophy not found")
        patch = {k: v for k, v in body.model_dump().items() if v is not None}
        if patch:
            await db.trophies.update_one({"code": code}, {"$set": patch})
            existing.update(patch)
            # If the admin changed the custom image (uploaded one or cleared it),
            # propagate it onto ALL previously-awarded rows for this trophy so the
            # new picture immediately shows up on dog/client cards, share-cards, etc.
            # Without this, awards made before the upload would stay stuck on the
            # icon placeholder.
            if "custom_image" in patch:
                await db.awarded_trophies.update_many(
                    {"trophy_code": code},
                    {"$set": {"trophy_custom_image": patch["custom_image"] or ""}},
                )
            # Sprint 110ak — same propagation for the new image_fit toggle so
            # historical awards reflect the admin's latest layout choice on the
            # wall + share cards.
            if "image_fit" in patch:
                await db.awarded_trophies.update_many(
                    {"trophy_code": code},
                    {"$set": {"trophy_image_fit": patch["image_fit"] or "circle"}},
                )
            # Sprint 110al — propagate focal-point repositioning to historical awards.
            offset_patch = {}
            if "image_offset_x" in patch:
                offset_patch["trophy_image_offset_x"] = int(patch["image_offset_x"])
            if "image_offset_y" in patch:
                offset_patch["trophy_image_offset_y"] = int(patch["image_offset_y"])
            if offset_patch:
                await db.awarded_trophies.update_many(
                    {"trophy_code": code},
                    {"$set": offset_patch},
                )
        return existing

    @api.delete("/trophies/catalog/{code}")
    async def delete_trophy(code: str, _: dict = Depends(require_admin_and_permission("manage_engagement_content"))):
        existing = await db.trophies.find_one({"code": code}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Trophy not found")
        if existing.get("is_default"):
            # Soft-disable defaults rather than deleting (keeps history valid).
            await db.trophies.update_one({"code": code}, {"$set": {"active": False}})
            return {"ok": True, "deactivated": True}
        await db.trophies.delete_one({"code": code})
        return {"ok": True, "deleted": True}

    @api.get("/dogs/{dog_id}/trophies")
    async def list_dog_trophies(dog_id: str, user: dict = Depends(get_current_user)):
        dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "owner_id": 1})
        if not dog:
            raise HTTPException(status_code=404, detail="Dog not found")
        if user.get("role") != "admin" and dog.get("owner_id") != user.get("client_id"):
            raise HTTPException(status_code=403, detail="Not allowed")
        rows = await db.awarded_trophies.find(
            {"recipient_type": "dog", "recipient_id": dog_id, "revoked": {"$ne": True}},
            {"_id": 0},
        ).sort("awarded_at", -1).to_list(200)
        return _serialize_awarded(rows)

    async def _recheck_client_trophies_after_practice(hw: dict, user: dict) -> None:
        """Best-effort client trophy re-evaluation after a Practice session log.
        Admin/trainer logs are bookkeeping, not the client's practice, so they
        never trigger it (and practice_days ignores them anyway)."""
        if user.get("role") == "admin" or not hw.get("client_id"):
            return
        try:
            await check_client_trophies(db, hw["client_id"])
        except Exception as exc:
            logger.warning("Client trophy check after practice log failed: %s", exc)

    async def _maybe_recheck_trophies_today():
        """Lazy once-per-business-day sweep (same pattern as _maybe_archive_today):
        catches awards whose inputs changed outside a hook — e.g. visit tiers
        after the archive job moved bookings, or a client who crossed a threshold
        before an evaluator fix shipped."""
        try:
            today = business_today().isoformat()
            marker = await db.system_runs.find_one({"_id": "trophy_recheck"})
            if marker and marker.get("date") == today:
                return
            summary = await recheck_all_trophies(db)
            await db.system_runs.update_one(
                {"_id": "trophy_recheck"},
                {"$set": {"date": today, "ran_at": now_iso(), "awarded": summary["awarded"]}},
                upsert=True,
            )
        except Exception as e:
            logger.warning("trophy recheck failed (non-fatal): %s", e)


    # Sprint 110ef — Batch endpoint to avoid the 429 storm caused by N parallel
    # `GET /dogs/{id}/trophies` calls when the Dogs admin page loads (one per
    # dog). Returns a `{dog_id: [trophies]}` map in a single round trip.

    @api.get("/admin/dog-trophies-summary")
    async def all_dog_trophies_summary(_: dict = Depends(require_admin)):
        rows = await db.awarded_trophies.find(
            {"recipient_type": "dog", "revoked": {"$ne": True}},
            {"_id": 0},
        ).sort("awarded_at", -1).to_list(10000)
        out: Dict[str, list] = {}
        for r in _serialize_awarded(rows):
            out.setdefault(r.get("recipient_id"), []).append(r)
        return out

    @api.get("/clients/{client_id}/trophies")
    async def list_client_trophies(client_id: str, user: dict = Depends(get_current_user)):
        if user.get("role") != "admin" and user.get("client_id") != client_id:
            raise HTTPException(status_code=403, detail="Not allowed")
        rows = await db.awarded_trophies.find(
            {"recipient_type": "client", "recipient_id": client_id, "revoked": {"$ne": True}},
            {"_id": 0},
        ).sort("awarded_at", -1).to_list(200)
        return _serialize_awarded(rows)

    @api.get("/admin/client-trophies-summary")
    async def all_client_trophies_summary(
        client_ids: Optional[str] = None, _: dict = Depends(require_admin),
    ):
        query: Dict[str, Any] = {"recipient_type": "client", "revoked": {"$ne": True}}
        if client_ids:
            ids = [value.strip() for value in client_ids.split(",") if value.strip()][:100]
            if ids:
                query["recipient_id"] = {"$in": ids}
        rows = await db.awarded_trophies.find(
            query,
            {"_id": 0},
        ).sort("awarded_at", -1).to_list(10000)
        out: Dict[str, list] = {}
        for r in _serialize_awarded(rows):
            out.setdefault(r.get("recipient_id"), []).append(r)
        return out

    @api.post("/dogs/{dog_id}/trophies/{code}/award")
    async def manual_award_dog(dog_id: str, code: str, body: ManualAwardIn, user: dict = Depends(require_admin)):
        row = await award_trophy(
            db, recipient_type="dog", recipient_id=dog_id, trophy_code=code,
            awarded_by=user.get("name") or "Admin", note=body.note or "",
        )
        if not row:
            raise HTTPException(status_code=400, detail="Dog already has this trophy (or trophy/code invalid)")
        return row

    @api.post("/clients/{client_id}/trophies/{code}/award")
    async def manual_award_client(client_id: str, code: str, body: ManualAwardIn, user: dict = Depends(require_admin)):
        row = await award_trophy(
            db, recipient_type="client", recipient_id=client_id, trophy_code=code,
            awarded_by=user.get("name") or "Admin", note=body.note or "",
        )
        if not row:
            raise HTTPException(status_code=400, detail="Client already has this trophy (or trophy/code invalid)")
        return row

    @api.delete("/awarded-trophies/{awarded_id}")
    async def revoke_awarded_trophy(awarded_id: str, _: dict = Depends(require_admin)):
        res = await db.awarded_trophies.update_one({"id": awarded_id}, {"$set": {"revoked": True, "revoked_at": now_iso()}})
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Trophy award not found")
        return {"ok": True}

    @api.post("/awarded-trophies/{awarded_id}/seen")
    async def mark_awarded_seen(awarded_id: str, user: dict = Depends(get_current_user)):
        """Client portal calls this after showing the new-trophy celebration toast."""
        row = await db.awarded_trophies.find_one({"id": awarded_id}, {"_id": 0, "client_id": 1})
        if not row:
            raise HTTPException(status_code=404, detail="Award not found")
        if user.get("role") != "admin" and user.get("client_id") != row.get("client_id"):
            raise HTTPException(status_code=403, detail="Not allowed")
        await db.awarded_trophies.update_one({"id": awarded_id}, {"$set": {"seen_by_client": True}})
        return {"ok": True}

    @api.get("/portal/trophies")
    async def portal_trophies(user: dict = Depends(get_current_user)):
        """Returns trophies for the current client + their dogs, plus an
        `unseen` list for the celebration toast."""
        cid = user.get("client_id")
        if user.get("role") != "client" or not cid:
            return {"client_trophies": [], "dog_trophies": [], "unseen": []}
        client_rows = await db.awarded_trophies.find(
            {"recipient_type": "client", "recipient_id": cid, "revoked": {"$ne": True}},
            {"_id": 0},
        ).sort("awarded_at", -1).to_list(200)
        dogs = await db.dogs.find({"owner_id": cid}, {"_id": 0, "id": 1, "name": 1}).to_list(50)
        dog_ids = [d["id"] for d in dogs]
        dog_rows = []
        if dog_ids:
            dog_rows = await db.awarded_trophies.find(
                {"recipient_type": "dog", "recipient_id": {"$in": dog_ids}, "revoked": {"$ne": True}},
                {"_id": 0},
            ).sort("awarded_at", -1).to_list(500)
        unseen = [r for r in (client_rows + dog_rows) if not r.get("seen_by_client")]
        return {
            "client_trophies": _serialize_awarded(client_rows),
            "dog_trophies": _serialize_awarded(dog_rows),
            "unseen": _serialize_awarded(unseen),
        }

    @api.get("/trophies/share-card/{awarded_id}.png")
    async def trophy_share_card(awarded_id: str):
        """Public PNG share card. Anyone with the awarded_id (uuid) can fetch — safe
        since IDs are unguessable and the image only shows public info."""
        row = await db.awarded_trophies.find_one({"id": awarded_id, "revoked": {"$ne": True}}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Award not found")
        # Backfill the trophy image for awards minted before we started snapshotting
        # it (so the share PNG always reflects the *current* catalog image when the
        # award doesn't have its own).
        if not row.get("trophy_custom_image"):
            trophy = await db.trophies.find_one(
                {"code": row.get("trophy_code")},
                {"_id": 0, "custom_image": 1, "image_fit": 1, "image_offset_x": 1, "image_offset_y": 1},
            )
            if trophy and trophy.get("custom_image"):
                row["trophy_custom_image"] = trophy["custom_image"]
                row["trophy_image_fit"] = trophy.get("image_fit") or "circle"
                row["trophy_image_offset_x"] = trophy.get("image_offset_x", 50)
                row["trophy_image_offset_y"] = trophy.get("image_offset_y", 50)
        # Backfill image_fit for awards minted before Sprint 110ak (defaults to
        # legacy "circle" behaviour so historical shares stay pixel-identical).
        if not row.get("trophy_image_fit"):
            trophy = await db.trophies.find_one(
                {"code": row.get("trophy_code")},
                {"_id": 0, "image_fit": 1, "image_offset_x": 1, "image_offset_y": 1},
            )
            row["trophy_image_fit"] = (trophy or {}).get("image_fit") or "circle"
            row.setdefault("trophy_image_offset_x", (trophy or {}).get("image_offset_x", 50))
            row.setdefault("trophy_image_offset_y", (trophy or {}).get("image_offset_y", 50))
        try:
            png = render_share_card_png(row)
        except Exception as exc:
            logger.warning("Share card render failed: %s", exc)
            raise HTTPException(status_code=500, detail="Failed to render share card")
        return Response(content=png, media_type="image/png")

    @api.get("/trophies/leaderboard")
    async def trophies_leaderboard(_: dict = Depends(require_admin), limit: int = 5):
        """Top dogs and top clients by trophy count (excluding revoked)."""
        pipeline_dog = [
            {"$match": {"recipient_type": "dog", "revoked": {"$ne": True}}},
            {"$group": {"_id": "$recipient_id", "count": {"$sum": 1}, "last": {"$max": "$awarded_at"}}},
            {"$sort": {"count": -1, "last": -1}},
            {"$limit": limit},
        ]
        pipeline_client = [
            {"$match": {"recipient_type": "client", "revoked": {"$ne": True}}},
            {"$group": {"_id": "$recipient_id", "count": {"$sum": 1}, "last": {"$max": "$awarded_at"}}},
            {"$sort": {"count": -1, "last": -1}},
            {"$limit": limit},
        ]
        dog_rows = await db.awarded_trophies.aggregate(pipeline_dog).to_list(limit)
        client_rows = await db.awarded_trophies.aggregate(pipeline_client).to_list(limit)
        dog_ids = [r["_id"] for r in dog_rows]
        client_ids = [r["_id"] for r in client_rows]
        dogs = {d["id"]: d for d in await db.dogs.find({"id": {"$in": dog_ids}}, {"_id": 0, "id": 1, "name": 1, "breed": 1, "owner_id": 1, "photo": 1}).to_list(50)}
        owner_ids = [d.get("owner_id") for d in dogs.values() if d.get("owner_id")]
        clients = {c["id"]: c for c in await db.clients.find({"id": {"$in": client_ids + owner_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(100)}
        return {
            "top_dogs": [
                {
                    "dog_id": r["_id"],
                    "dog_name": (dogs.get(r["_id"]) or {}).get("name", "—"),
                    "breed": (dogs.get(r["_id"]) or {}).get("breed", ""),
                    "photo": (dogs.get(r["_id"]) or {}).get("photo", ""),
                    "owner_id": (dogs.get(r["_id"]) or {}).get("owner_id"),
                    "owner_name": (clients.get((dogs.get(r["_id"]) or {}).get("owner_id")) or {}).get("name", ""),
                    "trophy_count": r["count"],
                }
                for r in dog_rows
            ],
            "top_clients": [
                {
                    "client_id": r["_id"],
                    "client_name": (clients.get(r["_id"]) or {}).get("name", "—"),
                    "trophy_count": r["count"],
                }
                for r in client_rows
            ],
        }

    return {"TrophyIn": TrophyIn, "TrophyPatch": TrophyPatch, "list_trophy_catalog": list_trophy_catalog, "create_custom_trophy": create_custom_trophy, "update_trophy": update_trophy, "delete_trophy": delete_trophy, "list_dog_trophies": list_dog_trophies, "_recheck_client_trophies_after_practice": _recheck_client_trophies_after_practice, "_maybe_recheck_trophies_today": _maybe_recheck_trophies_today, "all_dog_trophies_summary": all_dog_trophies_summary, "list_client_trophies": list_client_trophies, "all_client_trophies_summary": all_client_trophies_summary, "manual_award_dog": manual_award_dog, "manual_award_client": manual_award_client, "revoke_awarded_trophy": revoke_awarded_trophy, "mark_awarded_seen": mark_awarded_seen, "portal_trophies": portal_trophies, "trophy_share_card": trophy_share_card, "trophies_leaderboard": trophies_leaderboard}
