"""The in-app backup covers every collection the app keeps — and stays that way.

Audit #5 (2026-09-25): Settings → Auto-Backup promised "every business
collection", but its hand-kept list had fallen behind the code. A restore
brought back revenue rows without the gift cards, register sales, products,
invoices, payments, Shop orders, events and Photo Specials behind them — so
every outstanding card balance, every register sale and every Shop order was
simply not in the file.

These pin:
  * every collection the backend reads or writes is either backed up or on
    the explicit excluded list with a reason — a new feature that adds a
    collection fails here until someone decides;
  * the newly covered records survive export → JSON file → restore;
  * none of them is "critical", so backups taken before them still restore;
  * the per-collection rules in domains/backup/rules.py: Shop photo sizes
    stay out of the file, a merge never aborts halfway on a key another live
    row holds, favourites merge on their natural key, counters only go up,
    and a freshly seeded event gives way to the backed-up one.
"""
import base64
import io
import json
import pathlib
import re
import uuid

import pytest
from fastapi.encoders import jsonable_encoder

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

ADMIN = {"id": "backup-admin", "role": "admin", "name": "Backup QA", "email": "backup@test"}
TAG = "TEST_BACKUP_GUARD"
BACKEND = pathlib.Path(__file__).resolve().parent

_REF = re.compile(r"\b_?db\.([a-z][a-z0-9_]*)\b")
_SUB = re.compile(r"""\b_?db\[\s*["']([a-z][a-z0-9_]*)["']\s*\]""")
_ARG = re.compile(r"""\b(?:orders|owners)_collection\s*=\s*["']([a-z][a-z0-9_]*)["']""")
_NOT_COLLECTIONS = {"find", "find_one", "client", "command", "get_collection", "list_collection_names",
                    "name", "drop_collection", "create_collection", "backups"}


@pytest.fixture(autouse=True)
def _snapshots_in_tmp(tmp_path, monkeypatch):
    """Every restore writes a full safety snapshot first; keep them out of the
    shared local backup folder."""
    monkeypatch.setattr(server, "BACKUP_ROOT", str(tmp_path))


def _collections_in_code() -> set:
    names = set()
    for p in BACKEND.rglob("*.py"):
        parts = set(p.parts)
        if parts & {".venv", "venv", ".venv_local_test", ".venv_ci", "tests", "scripts", "__pycache__"}:
            continue
        if p.name.startswith("test_") or p.name.startswith("_test") or p.name == "e2e_school_seed.py":
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        names |= set(_REF.findall(text)) | set(_SUB.findall(text)) | set(_ARG.findall(text))
    return names - _NOT_COLLECTIONS


def _restore(collections, mode="merge"):
    body = server.BackupRestoreIn(version=server.BACKUP_VERSION, collections=collections, mode=mode)
    return run(server.backup_restore(body=body, _=ADMIN))


def _as_file(payload):
    """What the auto-backup writes and the Settings upload sends back."""
    return json.loads(json.dumps(payload, separators=(",", ":"), default=str))


def _png_data_url():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 40)).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_every_collection_the_app_keeps_is_backed_up_or_deliberately_excluded():
    decided = set(server.BACKUP_COLLECTIONS) | set(server.BACKUP_EXCLUDED)
    undecided = sorted(_collections_in_code() - decided)
    assert not undecided, (
        f"these collections are not in the backup and not on BACKUP_EXCLUDED: {undecided}. "
        "Add each to BACKUP_COLLECTIONS (it holds records the business needs back) or to "
        "BACKUP_EXCLUDED with the reason it doesn't.")


def test_the_two_lists_do_not_overlap_and_every_exclusion_says_why():
    assert not set(server.BACKUP_COLLECTIONS) & set(server.BACKUP_EXCLUDED)
    assert all(len(reason) > 10 for reason in server.BACKUP_EXCLUDED.values())
    assert len(server.BACKUP_COLLECTIONS) == len(set(server.BACKUP_COLLECTIONS)), "no duplicates"


def test_the_records_the_audit_found_missing_are_now_backed_up():
    for c in ("gift_cards", "gift_card_transactions", "pos_sales", "pos_sale_returns", "pos_products",
              "inventory_movements", "shop_orders", "shop_categories", "invoices", "payments",
              "events", "event_registrations", "photo_specials", "inquiries", "agreement_signatures",
              "stripe_payment_attempts", "stripe_refund_attempts"):
        assert c in server.BACKUP_COLLECTIONS, c
    # A self-expiring analytics funnel; its expiry date can't survive JSON.
    assert "shop_events" in server.BACKUP_EXCLUDED


def test_older_backups_without_the_new_collections_still_restore():
    new = {"gift_cards", "pos_sales", "invoices", "payments", "shop_orders", "events"}
    assert not new & set(server._CRITICAL_BACKUP_COLLECTIONS)
    old = {"version": 9, "exported_at": server.now_iso(), "collections": {"clients": [], "dogs": []}}
    assert run(server.backup_restore(body=server.BackupRestoreIn(**old, mode="merge"), _=ADMIN)) is not None


def test_new_records_survive_export_file_delete_restore():
    rows = {
        "gift_cards": {"id": str(uuid.uuid4()), "code": f"BKP{uuid.uuid4().hex[:9].upper()}", "balance": 42.5,
                       "initial_amount": 50.0, "status": "active", "note": TAG},
        "pos_sales": {"id": str(uuid.uuid4()), "receipt_number": "BKP-1", "total": 21.35, "note": TAG},
        "invoices": {"id": str(uuid.uuid4()), "client_id": "bkp", "total": 99.0, "note": TAG},
        "shop_orders": {"id": str(uuid.uuid4()), "client_id": "bkp", "total": 25.0, "note": TAG},
    }
    counter_id = f"{TAG}-{uuid.uuid4().hex[:6]}"
    for c, doc in rows.items():
        run(server.db[c].insert_one(dict(doc)))
    run(server.db.event_counters.insert_one({"_id": counter_id, "seq": 17}))

    data = _as_file(run(server.backup_export(user=ADMIN)))
    assert data["version"] >= 10
    for c, doc in rows.items():
        assert any(d.get("id") == doc["id"] for d in data["collections"][c]), c
    assert any(d.get("_id") == counter_id for d in data["collections"]["event_counters"])

    for c, doc in rows.items():
        run(server.db[c].delete_one({"id": doc["id"]}))
    run(server.db.event_counters.delete_one({"_id": counter_id}))
    run(server.backup_restore(body=server.BackupRestoreIn(**{**data, "mode": "merge"}), _=ADMIN))

    for c, doc in rows.items():
        back = run(server.db[c].find_one({"id": doc["id"]}, {"_id": 0}))
        assert back and back.get("note") == TAG, f"{c} did not come back"
    assert run(server.db.gift_cards.find_one({"id": rows["gift_cards"]["id"]}))["balance"] == 42.5
    assert run(server.db.event_counters.find_one({"_id": counter_id}))["seq"] == 17, "confirmation numbering resumes"
    for c, doc in rows.items():
        run(server.db[c].delete_one({"id": doc["id"]}))
    run(server.db.event_counters.delete_one({"_id": counter_id}))


def test_shop_photos_download_cleanly_and_their_sizes_rebuild_after_restore():
    raw = _png_data_url()
    _mime, blob = server.shop_media_services.decode_data_url(raw)
    media_id = f"{TAG}-media-{uuid.uuid4().hex[:8]}"
    run(server.db.shop_media.insert_one({
        "id": media_id, "mime": "image/png", "data": raw, "filename": "bkp.png",
        "derivatives": server.shop_media_services.build_derivatives(blob), "derivatives_built_at": server.now_iso()}))
    try:
        # The Settings download goes through FastAPI's encoder: raw bytes crashed it.
        payload = run(server.backup_export(user=ADMIN))
        jsonable_encoder(payload)
        row = next(d for d in payload["collections"]["shop_media"] if d["id"] == media_id)
        assert "derivatives" not in row and row["data"] == raw

        # A file written before this rule carried the sizes as "b'...'" text.
        # A merge must never write that over the live bytes.
        stale = {**row, "derivatives": {"thumb": {"data": "b'\\x00\\x01'"}}}
        _restore({"shop_media": [stale]})
        live = run(server.db.shop_media.find_one({"id": media_id}))
        assert isinstance(live["derivatives"]["thumb"]["data"], bytes)

        # After a replace restore the row has no sizes; the first view builds them.
        file_rows = _as_file(payload)["collections"]["shop_media"]
        _restore({"shop_media": file_rows}, mode="replace")
        assert "derivatives" not in run(server.db.shop_media.find_one({"id": media_id}))
        thumb = run(server.shop_media_services.derivative(media_id, "thumb"))
        assert thumb and isinstance(thumb["data"], bytes) and len(thumb["data"]) > 0
    finally:
        run(server.db.shop_media.delete_one({"id": media_id}))


def test_a_merge_keeps_going_past_a_key_another_live_row_holds():
    ref = f"{TAG}-ref-{uuid.uuid4().hex[:8]}"
    live_id, backup_id = f"{TAG}-p-live-{uuid.uuid4().hex[:6]}", f"{TAG}-p-old-{uuid.uuid4().hex[:6]}"
    special_id = f"{TAG}-ps-{uuid.uuid4().hex[:6]}"
    run(server.db.payments.insert_one({"id": live_id, "idempotency_ref": ref, "amount": 10.0}))
    try:
        result = _restore({
            "payments": [{"id": backup_id, "idempotency_ref": ref, "amount": 10.0}],
            # A later collection in the same file must still be restored.
            "photo_specials": [{"id": special_id, "name": TAG}],
        })
        assert result["summary"]["payments"]["kept_live"] == 1
        assert result["summary"]["payments"]["kept_live_ids"] == [backup_id]
        assert result["kept_live"] == 1
        assert run(server.db.payments.find_one({"id": live_id}))["idempotency_ref"] == ref
        assert run(server.db.payments.find_one({"id": backup_id})) is None
        assert run(server.db.photo_specials.find_one({"id": special_id}))["name"] == TAG
    finally:
        run(server.db.payments.delete_many({"id": {"$in": [live_id, backup_id]}}))
        run(server.db.photo_specials.delete_one({"id": special_id}))


def test_a_saved_favourite_merges_on_client_item_not_as_a_second_copy():
    fav = {"client_id": f"{TAG}-c-{uuid.uuid4().hex[:6]}", "kind": "product", "ref_id": "bkp-product"}
    run(server.db.shop_favorites.insert_one({**fav, "created_at": "2026-09-01T00:00:00+00:00"}))
    try:
        result = _restore({"shop_favorites": [{**fav, "created_at": "2026-08-01T00:00:00+00:00"}]})
        assert result["summary"]["shop_favorites"] == {"mode": "merge", "upserted": 1}
        assert run(server.db.shop_favorites.count_documents(fav)) == 1
    finally:
        run(server.db.shop_favorites.delete_many(fav))


def test_a_merge_never_puts_an_event_counter_back():
    ahead, missing = f"{TAG}-ev:confirmation-{uuid.uuid4().hex[:6]}", f"{TAG}-ev:photo-{uuid.uuid4().hex[:6]}"
    run(server.db.event_counters.insert_one({"_id": ahead, "seq": 40}))
    try:
        _restore({"event_counters": [{"_id": ahead, "seq": 17}, {"_id": missing, "seq": 5}]})
        assert run(server.db.event_counters.find_one({"_id": ahead}))["seq"] == 40, \
            "registrations 18-40 still exist; their numbers must not be handed out again"
        assert run(server.db.event_counters.find_one({"_id": missing}))["seq"] == 5
    finally:
        run(server.db.event_counters.delete_many({"_id": {"$in": [ahead, missing]}}))


def test_a_freshly_seeded_event_gives_way_to_the_backed_up_one():
    slug, busy_slug = f"{TAG.lower()}-{uuid.uuid4().hex[:6]}", f"{TAG.lower()}-busy-{uuid.uuid4().hex[:6]}"
    seeded, real, reg = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    busy_live, busy_old, busy_reg = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.events.insert_one({"id": seeded, "slug": slug, "name": "seeded default"}))
    run(server.db.events.insert_one({"id": busy_live, "slug": busy_slug, "name": "live, has people"}))
    run(server.db.event_registrations.insert_one({"id": busy_reg, "event_id": busy_live, "confirmation_number": f"{TAG}-B1"}))
    try:
        result = _restore({
            "events": [{"id": real, "slug": slug, "name": "real event"},
                       {"id": busy_old, "slug": busy_slug, "name": "older copy"}],
            "event_registrations": [{"id": reg, "event_id": real, "confirmation_number": f"{TAG}-R1"}],
        })
        # Nothing pointed at the seeded row, so the real event (and its id) is back.
        assert run(server.db.events.find_one({"slug": slug}, {"_id": 0, "id": 1, "name": 1})) == {"id": real, "name": "real event"}
        assert run(server.db.events.count_documents({"slug": slug})) == 1
        assert run(server.db.event_registrations.find_one({"id": reg}))["event_id"] == real
        # A live event with registrations is never taken over; it is reported.
        assert run(server.db.events.find_one({"slug": busy_slug}))["id"] == busy_live
        assert result["summary"]["events"]["kept_live"] == 1
    finally:
        run(server.db.events.delete_many({"slug": {"$in": [slug, busy_slug]}}))
        run(server.db.event_registrations.delete_many({"id": {"$in": [reg, busy_reg]}}))
