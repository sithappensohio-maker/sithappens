"""Phase 6 performance endpoints.

These endpoints are additive and intentionally narrow.  They avoid forcing
UI surfaces that only need lists/options/counts through the much richer legacy
payloads while existing API contracts remain available unchanged.
"""
from __future__ import annotations

import asyncio
import math
import re
from typing import Any, Dict

from fastapi import Depends, HTTPException


def _rx(value: str) -> Dict[str, Any]:
    return {"$regex": re.escape((value or "").strip()), "$options": "i"}


def _with_deleted(base: dict, include_deleted: bool) -> dict:
    if include_deleted:
        return dict(base)
    if not base:
        return {"deleted_at": {"$exists": False}}
    return {"$and": [{"deleted_at": {"$exists": False}}, base]}


async def _decorate_client_page(*, db, items: list[dict], get_settings, business_today) -> list[dict]:
    """Attach only the rich fields used by the real Clients workspace.

    Unlike legacy GET /clients, every secondary query is constrained to this
    one page of client ids.  This keeps vaccine/waiver/intake work proportional
    to the 48 visible families rather than the entire historical database.
    """
    client_ids = [c.get("id") for c in items if c.get("id")]
    if not client_ids:
        return items

    dog_q = {"owner_id": {"$in": client_ids}, "deleted_at": {"$exists": False}}
    dogs_full, portal_users = await asyncio.gather(
        db.dogs.find(
            dog_q,
            {"_id": 0, "id": 1, "owner_id": 1, "name": 1, "breed": 1,
             "birthday": 1, "age_y": 1, "age_m": 1, "vaccines": 1, "vaccine_certs": 1},
        ).to_list(max(200, len(client_ids) * 20)),
        db.users.find(
            {"client_id": {"$in": client_ids}},
            {"_id": 0, "client_id": 1, "email": 1, "last_login_at": 1, "login_count": 1},
        ).to_list(max(100, len(client_ids) + 10)),
    )

    dogs_by_owner: Dict[str, list] = {}
    dogs_full_by_owner: Dict[str, list] = {}
    pending_vac_dog_ids = set()
    for dog in dogs_full:
        owner_id = dog.get("owner_id") or ""
        dogs_full_by_owner.setdefault(owner_id, []).append(dog)
        dogs_by_owner.setdefault(owner_id, []).append(
            {"id": dog.get("id"), "name": dog.get("name", ""), "breed": dog.get("breed", "")}
        )
        for _, info in (dog.get("vaccine_certs") or {}).items():
            if (
                isinstance(info, dict)
                and not info.get("reviewed_at")
                and not info.get("uploaded_by_admin")
                and (info.get("status") in ("pending_review", "pending") or info.get("pending_expires_on"))
            ):
                pending_vac_dog_ids.add(dog.get("id"))

    user_by_client = {u.get("client_id"): u for u in portal_users if u.get("client_id")}
    for client in items:
        user = user_by_client.get(client.get("id"))
        client["portal_email"] = user.get("email") if user else None
        client["last_login_at"] = user.get("last_login_at") if user else None
        client["login_count"] = int(user.get("login_count") or 0) if user else 0
        client["dogs"] = sorted(
            dogs_by_owner.get(client.get("id") or "", []),
            key=lambda x: (x.get("name") or "").lower(),
        )

    try:
        settings, waiver_rows, intake_rows = await asyncio.gather(
            get_settings(),
            db.waiver_signatures.find(
                {"client_id": {"$in": client_ids}},
                {"_id": 0, "client_id": 1, "waiver_version": 1, "signed_at": 1},
            ).sort("signed_at", -1).to_list(max(200, len(client_ids) * 10)),
            db.intake_submissions.find(
                {"client_id": {"$in": client_ids}, "status": {"$in": ["sent", "in_progress"]}},
                {"_id": 0, "client_id": 1},
            ).to_list(max(200, len(client_ids) * 10)),
        )
        required_vax = settings.get("required_vaccines", ["rabies"]) or []
        current_waiver_version = int(settings.get("waiver_version") or 1)
        waivers_by_client: Dict[str, Dict[str, Any]] = {}
        for sig in waiver_rows:
            cid = sig.get("client_id")
            if cid and cid not in waivers_by_client:
                waivers_by_client[cid] = sig
        intake_pending_clients: Dict[str, int] = {}
        for row in intake_rows:
            cid = row.get("client_id")
            if cid:
                intake_pending_clients[cid] = intake_pending_clients.get(cid, 0) + 1
        today_iso = business_today().isoformat()

        def _has_vac(vaccines, key: str) -> bool:
            if isinstance(vaccines, dict):
                value = vaccines.get(key) or ""
                return bool(value) and str(value)[:10] >= today_iso
            if isinstance(vaccines, list):
                for entry in vaccines:
                    if isinstance(entry, dict) and (entry.get("type") == key or entry.get("name") == key):
                        exp = entry.get("expires_on") or entry.get("expiration") or ""
                        return bool(exp) and str(exp)[:10] >= today_iso
            return False

        for client in items:
            cid = client.get("id")
            owner_dogs = dogs_full_by_owner.get(cid, [])
            info_ok = bool((client.get("name") or "").strip() and (client.get("phone") or "").strip() and (client.get("email") or "").strip())
            dog_ok = bool(owner_dogs) and all(
                (dog.get("name") or "").strip()
                and (dog.get("breed") or "").strip()
                and ((dog.get("birthday") or "").strip() or (dog.get("age_y") or 0) or (dog.get("age_m") or 0))
                for dog in owner_dogs
            )
            emerg_ok = bool((client.get("emerg") or "").strip())
            vac_ok = bool(owner_dogs) and all(
                all(_has_vac(dog.get("vaccines"), required) for required in required_vax)
                for dog in owner_dogs
            )
            vac_pending = any(dog.get("id") in pending_vac_dog_ids for dog in owner_dogs)
            waiver = waivers_by_client.get(cid)
            waiver_ok = bool(waiver and int(waiver.get("waiver_version") or 1) >= current_waiver_version)
            intake_pending = intake_pending_clients.get(cid, 0)
            hard_complete = info_ok and dog_ok and emerg_ok and vac_ok and waiver_ok and intake_pending == 0
            if hard_complete:
                client["setup_overall"] = "complete"
                client["setup_badge"] = "Ready to Book"
            elif vac_pending and info_ok and dog_ok and emerg_ok and waiver_ok and intake_pending == 0:
                client["setup_overall"] = "pending_review"
                client["setup_badge"] = "Pending Vaccine Review"
            elif info_ok or dog_ok or emerg_ok or waiver_ok or vac_pending:
                client["setup_overall"] = "in_progress"
                client["setup_badge"] = "Setup Incomplete"
            else:
                client["setup_overall"] = "not_started"
                client["setup_badge"] = "Setup Incomplete"
    except Exception:
        # Decoration must never turn the directory into a hard failure.
        pass
    return items


def _hoist_static_routes_above_dynamic_shadows(api) -> None:
    """Starlette resolves routes in registration order, and this module
    registers at domain-composition time — AFTER the legacy monolith's
    routes — so the static picker paths registered above would otherwise be
    captured forever by their earlier dynamic siblings and 404:
    /clients/{client_id} swallowing /clients/page|options|balances,
    /dogs/{dog_id} swallowing /dogs/options, and /homework/{homework_id}
    swallowing /homework/counts.  Re-seat each static route directly ahead
    of the first earlier-registered dynamic route that would match its
    path.  This is pure registration-order arrangement at composition time;
    no route's endpoint or dependant is ever touched (the Phase 4
    contract), and with no conflicting dynamic route it is a no-op."""
    def _dynamic_matches(dynamic_path: str, static_path: str) -> bool:
        if "{" not in dynamic_path:
            return False
        pattern = "^" + re.sub(r"\{[^}]+\}", "[^/]+", dynamic_path) + "$"
        return re.match(pattern, static_path) is not None

    routes = api.routes
    static_suffixes = (
        "/clients/page", "/clients/options", "/clients/balances",
        "/dogs/options", "/homework/counts",
    )
    for route in [r for r in routes if getattr(r, "path", "").endswith(static_suffixes)]:
        methods = getattr(route, "methods", set()) or set()
        for idx, earlier in enumerate(routes):
            if earlier is route:
                break
            earlier_methods = getattr(earlier, "methods", set()) or set()
            if (methods & earlier_methods) and _dynamic_matches(getattr(earlier, "path", ""), route.path):
                routes.remove(route)
                routes.insert(idx, route)
                break


def register_performance_routes(
    *, api, db, server_globals: dict, get_current_user, require_clients_view, perms_for,
    business_today,
) -> None:
    @api.get("/clients/page")
    async def clients_page(
        q: str = "", page: int = 1, page_size: int = 48, include_deleted: bool = False,
        _: dict = Depends(require_clients_view),
    ):
        page_num = max(1, int(page or 1))
        size = max(1, min(int(page_size or 48), 100))
        needle = (q or "").strip()
        base: Dict[str, Any] = {}
        if needle:
            rx = _rx(needle)
            base = {"$or": [{"name": rx}, {"email": rx}, {"phone": rx}]}
        query = _with_deleted(base, include_deleted)
        total = await db.clients.count_documents(query)
        pages = max(1, math.ceil(total / size)) if total else 1
        page_num = min(page_num, pages)
        rows = await db.clients.find(query, {"_id": 0}).sort("name", 1).skip((page_num - 1) * size).limit(size).to_list(size)
        await _decorate_client_page(
            db=db, items=rows, get_settings=server_globals["get_settings"], business_today=business_today,
        )
        # Match legacy GET /clients' response-model safety: never expose raw
        # internal client fields (Stripe ids/idempotency markers, etc.) merely
        # because this optimized endpoint bypasses FastAPI's List[ClientOut].
        client_model = server_globals["ClientOut"]
        safe_rows = [client_model.model_validate(row).model_dump() for row in rows]
        return {"items": safe_rows, "total": total, "page": page_num, "page_size": size, "pages": pages, "query": needle}

    @api.get("/clients/options")
    async def client_options(
        q: str = "", limit: int = 5000, _: dict = Depends(require_clients_view),
    ):
        needle = (q or "").strip()
        base: Dict[str, Any] = {}
        if needle:
            rx = _rx(needle)
            base = {"$or": [{"name": rx}, {"email": rx}, {"phone": rx}]}
        query = _with_deleted(base, False)
        size = max(1, min(int(limit or 5000), 5000))
        projection = {
            "_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1,
            "credits": 1, "training_credits": 1, "boarding_credits": 1,
            "client_status": 1, "account_balance": 1,
        }
        return await db.clients.find(query, projection).sort("name", 1).limit(size).to_list(size)

    @api.get("/clients/balances")
    async def client_balances(_: dict = Depends(require_clients_view)):
        projection = {
            "_id": 0, "id": 1, "credits": 1, "training_credits": 1,
            "boarding_credits": 1, "account_balance": 1,
        }
        return await db.clients.find({"deleted_at": {"$exists": False}}, projection).to_list(5000)

    @api.get("/dogs/options")
    async def dog_options(_: dict = Depends(require_clients_view)):
        return await db.dogs.find(
            {"deleted_at": {"$exists": False}},
            {"_id": 0, "id": 1, "name": 1, "breed": 1, "owner_id": 1},
        ).sort("name", 1).to_list(5000)

    @api.get("/homework/counts")
    async def homework_counts(user: dict = Depends(get_current_user), dog_id: str = ""):
        query: Dict[str, Any] = {}
        if user.get("role") != "admin":
            query["client_id"] = user.get("client_id")
        if dog_id:
            query["dog_id"] = dog_id
        assigned_q = dict(query)
        assigned_q["status"] = "assigned"
        completed_q = dict(query)
        completed_q["status"] = "completed"
        active_q = dict(query)
        active_q["status"] = {"$ne": "completed"}
        total, assigned, completed, active = await asyncio.gather(
            db.homework.count_documents(query),
            db.homework.count_documents(assigned_q),
            db.homework.count_documents(completed_q),
            db.homework.count_documents(active_q),
        )
        return {"all": total, "assigned": assigned, "completed": completed, "active": active}

    @api.get("/admin/live-summary")
    async def admin_live_summary(user: dict = Depends(get_current_user)):
        # One browser poll replaces four independent HTTP requests.  Keep the
        # same permission semantics by only evaluating counters the user may
        # actually see; inaccessible counters are returned as zeroed shapes.
        if user.get("role") == "client":
            raise HTTPException(status_code=403, detail="Staff access required")
        perms = perms_for(user)

        async def messages():
            if not perms.get("messages"):
                return {"unread": 0, "open": 0}
            return await server_globals["admin_unread_count"](user)

        async def shop_orders():
            if not perms.get("take_payments"):
                return {"unseen": 0}
            return await server_globals["shop_orders_unseen_count"](user)

        async def school():
            if not perms.get("manage_school"):
                return {"count": 0, "unread": 0}
            return await server_globals["admin_school_hq_attention_count"](user)

        async def pending():
            if not (perms.get("booking_edit") or perms.get("finance_reports") or perms.get("care_complete")):
                return {"total": 0}
            return await server_globals["admin_pending_actions_count"](user)

        message_count, shop_count, school_count, pending_count = await asyncio.gather(
            messages(), shop_orders(), school(), pending(),
        )
        return {
            "messages": message_count,
            "shop_orders": shop_count,
            "school": school_count,
            "pending_actions": pending_count,
            "generated_at": server_globals["now_iso"](),
        }

    _hoist_static_routes_above_dynamic_shadows(api)
