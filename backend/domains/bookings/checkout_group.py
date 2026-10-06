"""Group checkout: a household leaving together, and the checkout endpoint that
checks one dog out (step 5 of the checkout pricing move).

Built by build(), which server.py calls once with its globals: the request models and
the dependency are defined in server.py. The money and state work stays in server.py
(_check_out_locked is looked up at call time, so the existing patch points still apply).
"""
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException


_server_globals: dict = {}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def build(server_globals: dict) -> dict:
    """Define the group checkout and the checkout endpoint against the server globals."""
    configure(server_globals=server_globals)

    async def check_out_group(
        booking_id: str,
        body: Optional[_g("CheckoutIn")] = None,
        user: dict = Depends(_g("require_employee_or_admin")),
    ):
        """Check out every active dog in the same multi-dog booking group at once.

        The individual booking rows remain intact for care history, reporting, and
        per-dog pricing, but one click now closes the whole household visit and
        writes a single grouped checkout receipt with the combined total.
        """
        body = body or _g("CheckoutIn")()
        # Payment rebuild Phase 2 — same additive, layered take_payments check
        # as single checkout (see check_out above).
        if not _g("_perms_for")(user).get("take_payments"):
            raise HTTPException(status_code=403, detail="You don't have permission to take payments.")
        anchor = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
        if not anchor:
            raise HTTPException(status_code=404, detail="Booking not found")
        await _g("checkout_prices").refuse_price_changes(booking_id, body, user)   # audit #23: before any dog leaves
        _g("friends_family").expected(body, bool(anchor.get("bill_to_client_id")))
        if anchor.get("bill_to_client_id"):  # friends & family: every dog on the payer's account, then one bill
            return await _g("friends_family").check_out_together(anchor, body, user)
        group_id = anchor.get("group_id")
        if body.amount_paid is not None and not bool(body.use_credits):
            raise HTTPException(
                status_code=400,
                detail="Partial payments are not available during a combined multi-dog checkout. Use paid in full, or check the dogs out separately for a partial payment.",
            )

        targets = await _g("_active_household_checkout_rows")(anchor)
        if len(targets) < 2:
            raise HTTPException(status_code=409, detail="There are no other active dogs left in this checkout group.")
        if any(t.get("bill_to_client_id") for t in targets):  # (never listed — a friends & family dog leaves its own way)
            raise HTTPException(status_code=409, detail=_g("friends_family").MSG_PAY_ON_BILL)
        if not body.late_day_resolution and (late_rows := [t for t in targets if _g("late_day_checkout").needs_answer(t)]):
            raise HTTPException(status_code=409, detail=_g("late_day_checkout").question_detail(late_rows, _g("business_today")().isoformat()))

        operation_id = str(_g("uuid").uuid4())
        checkout_group_id = str(_g("uuid").uuid4())
        lock_ts = _g("now_iso")()
        stale_lock_before = (_g("datetime").now(_g("timezone").utc) - _g("timedelta")(minutes=15)).isoformat()
        originals: List[Dict[str, Any]] = []
        client_id = anchor.get("client_id")
        client_lock_acquired = False
        snapshot: Dict[str, Any] = {"client": None, "lots": []}
        token = _g("_checkout_operation_id_ctx").set(operation_id)

        try:
            # Lock every row before touching money so a double click cannot complete
            # one dog while the grouped checkout is still being calculated.
            for target in targets:
                original = await _g("db").bookings.find_one_and_update(
                    {
                        "$and": [
                            {"id": target["id"]},
                            {"status": {"$ne": "completed"}},
                            {"$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}]},
                            # Same check-in requirement as single checkout — targets
                            # already come from _active_household_checkout_rows
                            # (which itself now requires checked_in_at), but this
                            # atomic re-assertion is what actually protects a
                            # direct API request from a race, not just the query
                            # that built the target list a moment earlier.
                            {"checked_in_at": {"$exists": True, "$nin": [None, ""]}},
                            {"$or": [
                                {"checkout_in_progress": {"$exists": False}},
                                {"checkout_in_progress": False},
                                {"checkout_started_at": {"$lt": stale_lock_before}},
                            ]},
                            {"bill_to_client_id": {"$in": [None, ""]}},  # (a friends & family dog leaves its own way)
                        ]
                    },
                    {"$set": {
                        "checkout_in_progress": True,
                        "checkout_operation_id": operation_id,
                        "checkout_started_at": lock_ts,
                    }},
                    projection={"_id": 0},
                    return_document=_g("ReturnDocument").BEFORE,
                )
                if not original:
                    raise HTTPException(status_code=409, detail="One of the dogs is already being checked out. Refresh and try again.")
                original.pop("checkout_in_progress", None)
                original.pop("checkout_operation_id", None)
                original.pop("checkout_started_at", None)
                originals.append(original)

            if client_id:
                locked_client = await _g("db").clients.find_one_and_update(
                    {
                        "id": client_id,
                        "$and": [
                            {"$or": [
                                {"financial_checkout_in_progress": {"$exists": False}},
                                {"financial_checkout_in_progress": False},
                                {"financial_checkout_started_at": {"$lt": stale_lock_before}},
                            ]},
                            {"$or": [
                                {"financial_correction_in_progress": {"$exists": False}},
                                {"financial_correction_in_progress": False},
                                {"financial_correction_started_at": {"$lt": stale_lock_before}},
                            ]},
                        ],
                    },
                    {"$set": {
                        "financial_checkout_in_progress": True,
                        "financial_checkout_operation_id": operation_id,
                        "financial_checkout_started_at": lock_ts,
                    }},
                    projection={"_id": 0, "id": 1},
                    return_document=_g("ReturnDocument").BEFORE,
                )
                if not locked_client:
                    raise HTTPException(status_code=409, detail="Another checkout or financial correction for this client is already in progress. Wait a moment and refresh.")
                client_lock_acquired = True

            snapshot = await _g("_checkout_financial_snapshot")(client_id)
            might_collect_money = (
                body.use_credits is False
                or body.amount_paid is not None
                or (body.payment_method not in (None, "credits"))
                or bool(body.add_ons)
                or int(body.extra_nights or 0) > 0 or bool(body.retail_lines)
            )
            if might_collect_money:
                await _g("_require_register_day_open")(_g("business_today")().isoformat())

            # Payment rebuild Phase 2 — pre-loop, additive-only checks. Group
            # cash tender/change capture is explicitly deferred (no safe way to
            # validate a tendered amount before pricing is known for every dog
            # in the loop — see the Phase 2 plan), but these two checks don't
            # depend on the final price at all, so they run safely up front,
            # before any row/client lock has been used for anything but the
            # lock acquisition itself.
            resolved_group_tender = _g("_normalize_payment_method")(group_tender, store=True) if (group_tender := body.payment_method or (body.retail_payment_method if body.retail_lines else None)) else None
            if resolved_group_tender == "other" and not (body.payment_notes or "").strip():
                raise HTTPException(status_code=400, detail="A note is required when the payment method is Other.")
            if resolved_group_tender == "cash":
                drawer_open = await _g("db").cash_drawer_sessions.find_one(
                    {"date": _g("business_today")().isoformat()}, {"_id": 0, "date": 1}
                )
                if not drawer_open:
                    raise HTTPException(status_code=400, detail="Open the register before taking cash payments.")

            completed: List[Dict[str, Any]] = []
            goods_print_tokens: List[str] = []   # the merchandise rung on one dog's checkout prints with the group (audit #89)
            share = _g("checkout_discount").HouseholdShare(body)
            # The household leaves at the early price when the screen charged the
            # early price for the dog whose button was pressed. Then every other
            # dog that is leaving early is charged its own early price too, as a
            # single dog would be (not its booked stay).
            early_group = bool(body.base_price is not None and await _g("_is_early_checkout_price")(booking_id, body, user))
            for target in targets:
                payload = body.model_dump()
                # New add-ons and a manual base override belong to the dog whose
                # checkout button was clicked. Shared stay extensions apply to all
                # dogs because the group has the same reservation dates/service.
                if target.get("id") != booking_id:
                    payload["add_ons"] = []
                    payload["base_price"] = None
                    payload["additional_cash_charge"] = 0
                    if early_group:
                        settled_target, _rank_fields = await _g("group_rank").settle(_g("db"), target, now=_g("now_iso")())
                        early = await _g("_early_stay_quote")(settled_target)
                        if early:
                            payload["base_price"] = round(float(early.get("base_price") or 0), 2)
                    # Merchandise belongs to the one checkout it was rung on, not
                    # to every dog in the household. Ringing it per dog would sell
                    # the same bag of food three times.
                    payload["retail_lines"] = []
                # In a mixed credits + cash group, each row calculates its own exact
                # uncovered cash. A combined amount_paid must not be copied to every dog.
                if bool(body.use_credits):
                    payload["amount_paid"] = None
                row_body = _g("CheckoutIn")(**share.payload_for(payload))
                # Payment rebuild Phase 1 — invoice creation is suppressed per-dog
                # here; exactly ONE canonical invoice covering every booking_id in
                # the group is created once below, after the whole group succeeds.
                row = await _g("_check_out_locked")(target["id"], row_body, user, create_invoice=False)
                completed.append(share.took(row))
                goods_print_tokens.extend(row.get("pos_extra_print_receipt_tokens") or [])

            combined_total = round(sum(float(row.get("actual_price") or 0) for row in completed), 2)
            combined_cash = round(sum(float(row.get("cash_revenue") or 0) for row in completed), 2)
            combined_discount = round(sum(float((row.get("multi_dog_discount") or {}).get("amount") or 0) for row in completed), 2)
            dog_names = [row.get("dog_name") or "Dog" for row in completed]
            group_meta = {
                "id": checkout_group_id,
                "booking_group_id": group_id or checkout_group_id,
                "booking_ids": [row.get("id") for row in completed],
                "client_id": client_id,
                "client_name": anchor.get("client_name"),
                "service_type": anchor.get("service_type"),
                "date": anchor.get("date"),
                "dog_names": dog_names,
                "total": combined_total,
                "cash_total": combined_cash,
                "discount_total": combined_discount,
                "payment_method": _g("_normalize_payment_method")(body.payment_method or (completed[0].get("payment_method") if completed else None), store=True),
                "checked_out_at": _g("now_iso")(),
                "checked_out_by": user.get("id"),
                "checked_out_by_name": user.get("display_name") or user.get("name"),
                "operation_id": operation_id,
            }
            await _g("db").checkout_groups.insert_one(group_meta.copy())
            await _g("db").bookings.update_many(
                {"id": {"$in": group_meta["booking_ids"]}},
                {"$set": {
                    "checkout_group_id": checkout_group_id,
                    "checkout_group_total": combined_total,
                    "checkout_group_cash_total": combined_cash,
                    "checkout_group_dog_count": len(completed),
                }},
            )
            for row in completed:
                row.update({
                    "checkout_group_id": checkout_group_id,
                    "checkout_group_total": combined_total,
                    "checkout_group_cash_total": combined_cash,
                    "checkout_group_dog_count": len(completed),
                })
            pos_print_receipt_token = None
            pos_open_drawer_token = None
            group_invoice = None
            group_waiting = False
            extra_bills: List[Dict[str, Any]] = []
            extra_print_tokens: List[str] = []
            try:
                invoice_ts = _g("now_iso")()
                group_invoice = await _g("_create_invoice_for_bookings")(
                    [row.get("id") for row in completed],
                    user=user, ts=invoice_ts, checkout_group_id=checkout_group_id,
                    payment_notes=body.payment_notes,
                )
                # Dogs from two reopened bills checked out together: each bill was
                # rebuilt and each gets its own receipt (audit #14).
                extra_bills = await _g("billing_tab_sync").rebuilt_alongside(group_invoice, [row.get("id") for row in completed], invoice_ts)
                # Front-desk POS hardware integration — best-effort, additive,
                # issued only AFTER the group invoice already committed above.
                if group_invoice:
                    # A bill still waiting for another reopened dog shows the old
                    # checkout, so no receipt for it yet (audit #14).
                    group_waiting = await _g("billing_tab_sync").any_visit_reopened(group_invoice)
                    try:
                        rs_for_print = await _g("get_receipt_settings")()
                        if rs_for_print.get("auto_print_receipts") and not group_waiting:
                            pos_print_receipt_token = await _g("_issue_pos_token")(
                                action="print_receipt", workstation_id=body.workstation_id, invoice_id=group_invoice["id"],
                            )
                            for extra in extra_bills:
                                extra_print_tokens.append(await _g("_issue_pos_token")(
                                    action="print_receipt", workstation_id=body.workstation_id, invoice_id=extra["id"]))
                        if resolved_group_tender == "cash" and combined_cash > 0:
                            pos_open_drawer_token = await _g("_issue_pos_token")(
                                action="open_drawer", workstation_id=body.workstation_id, invoice_id=group_invoice["id"],
                            )
                    except Exception as exc:
                        _g("logger").warning("POS token issuance failed for checkout_group %s: %s", checkout_group_id, exc)
                    try:
                        group_client_id = completed[0].get("client_id") if completed else None
                        for bill in ([] if group_waiting else [group_invoice]) + extra_bills:
                            # a rebuilt bill is its own receipt, not the first one again
                            _g("asyncio").create_task(_g("_maybe_auto_email_receipt")(
                                "invoice", bill["id"], group_client_id,
                                claim_key=f"{bill['id']}:{bill['rebuilt_at']}" if bill.get("rebuilt_at") else None))
                    except Exception as exc:
                        _g("logger").warning("auto-email receipt spawn failed for checkout_group %s: %s", checkout_group_id, exc)
            except Exception as exc:
                _g("logger").warning("group invoice creation failed for checkout_group %s: %s", checkout_group_id, exc)
            return {
                "checkout_group_id": checkout_group_id,
                "booking_group_id": group_id or checkout_group_id,
                "bookings": completed,
                "dog_names": dog_names,
                "count": len(completed),
                "total": combined_total,
                "cash_total": combined_cash,
                "discount_total": combined_discount,
                "payment_method": group_meta["payment_method"],
                "pos_invoice_id": group_invoice["id"] if group_invoice else None,
                "pos_print_receipt_token": pos_print_receipt_token,
                "pos_open_drawer_token": pos_open_drawer_token,
                "pos_receipt_waiting": group_waiting,
                "pos_extra_invoice_ids": [b["id"] for b in extra_bills],
                "pos_extra_print_receipt_tokens": extra_print_tokens + goods_print_tokens,
            }
        except Exception:
            if originals:
                # Restore the first booking plus all mutable client/credit/ledger
                # state, then restore the remaining booking rows.
                await _g("_rollback_checkout_finances")(
                    booking_id=originals[0]["id"],
                    original_booking=originals[0],
                    snapshot=snapshot,
                    operation_id=operation_id,
                )
                for original in originals[1:]:
                    try:
                        await _g("db").bookings.replace_one({"id": original["id"]}, original, upsert=False)
                    except Exception as exc:
                        _g("logger").critical("group checkout rollback could not restore booking %s: %s", original.get("id"), exc)
            try:
                await _g("db").checkout_groups.delete_one({"id": checkout_group_id})
            except Exception:
                pass
            raise
        finally:
            _g("_checkout_operation_id_ctx").reset(token)
            if client_lock_acquired and client_id:
                await _g("db").clients.update_one(
                    {"id": client_id, "financial_checkout_operation_id": operation_id},
                    {"$unset": {
                        "financial_checkout_in_progress": "",
                        "financial_checkout_operation_id": "",
                        "financial_checkout_started_at": "",
                    }},
                )
            await _g("db").bookings.update_many(
                {"checkout_operation_id": operation_id},
                {"$unset": {
                    "checkout_in_progress": "",
                    "checkout_operation_id": "",
                    "checkout_started_at": "",
                }},
            )

    async def _check_out_endpoint_impl(
        booking_id: str,
        body: Optional[_g("CheckoutIn")] = None,
        user: dict = Depends(_g("require_employee_or_admin")),
    ):
        """Run checkout once, with a lock and compensating rollback.

        This prevents double-click/double-request charges and restores the booking,
        credit balances, credit lots, client tab, and ledger rows if any critical
        money step fails before checkout completes.
        """
        body = body or _g("CheckoutIn")()
        # Sprint 110ff — the price-override field was open to every staff
        # account regardless of their assigned Roles & Permissions matrix,
        # which made the "pricing" permission toggle decorative for checkout.
        # Admins (and staff explicitly granted "pricing") can still override;
        # everyone else checks out at the normal computed price.
        await _g("checkout_prices").refuse_price_changes(booking_id, body, user)   # audit #23: one rule for every price at checkout
        # Payment rebuild Phase 2 — additive, layered on top of the existing
        # require_employee_or_admin gate (not a replacement for it), matching
        # the "pricing" check just above. Defaults True for every staff role,
        # so this is a no-op today until the owner explicitly disables it.
        if not _g("_perms_for")(user).get("take_payments"):
            raise HTTPException(status_code=403, detail="You don't have permission to take payments.")
        # A friends & family dog pays nothing here: its visit goes on the payer's account (friends_family).
        ff_row = bool((await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0, "bill_to_client_id": 1}) or {}).get("bill_to_client_id"))
        _g("friends_family").expected(body, ff_row)
        if ff_row:
            body = _g("friends_family").on_the_payers_tab(body)
        operation_id = str(_g("uuid").uuid4())
        lock_ts = _g("now_iso")()
        stale_lock_before = (_g("datetime").now(_g("timezone").utc) - _g("timedelta")(minutes=15)).isoformat()
        original_booking = await _g("db").bookings.find_one_and_update(
            {
                "$and": [
                    {"id": booking_id},
                    {"status": {"$ne": "completed"}},
                    {"$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}]},
                    # Front Desk check-in safety — checkout must never run ahead
                    # of an actual arrival. This protects the direct API call
                    # too, not just the frontend button's visibility rule.
                    {"checked_in_at": {"$exists": True, "$nin": [None, ""]}},
                    {"$or": [
                        {"checkout_in_progress": {"$exists": False}},
                        {"checkout_in_progress": False},
                        {"checkout_started_at": {"$lt": stale_lock_before}},
                    ]},
                    {"bill_to_client_id": {"$nin": [None, ""]} if ff_row else {"$in": [None, ""]}},  # (still what decided the path)
                ]
            },
            {"$set": {
                "checkout_in_progress": True,
                "checkout_operation_id": operation_id,
                "checkout_started_at": lock_ts,
            }},
            projection={"_id": 0},
            return_document=_g("ReturnDocument").BEFORE,
        )
        if not original_booking:
            current = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
            if not current:
                raise HTTPException(status_code=404, detail="Booking not found")
            if current.get("checked_out_at") or current.get("status") == "completed":
                raise HTTPException(status_code=409, detail="This booking has already been checked out.")
            if not current.get("checked_in_at"):
                raise HTTPException(status_code=409, detail="Check the dog in before completing checkout.")
            if bool(current.get("bill_to_client_id")) != ff_row:
                raise HTTPException(status_code=409, detail="This booking was just changed. Refresh and try again.")
            raise HTTPException(status_code=409, detail="Checkout is already in progress. Wait a moment and refresh.")

        # Operational lock fields are never part of the business record snapshot.
        # This also cleans up a stale lock if the previous process crashed.
        original_booking.pop("checkout_in_progress", None)
        original_booking.pop("checkout_operation_id", None)
        original_booking.pop("checkout_started_at", None)

        # Serialize money changes per client. Without this, a failed checkout could
        # restore a client snapshot over a second successful checkout for another
        # dog in the same household. On a friends & family visit that's the payer.
        client_id = _g("friends_family").payer_id(original_booking)
        client_lock_acquired = False
        if client_id:
            locked_client = await _g("db").clients.find_one_and_update(
                {
                    "id": client_id,
                    "$and": [
                        {"$or": [
                            {"financial_checkout_in_progress": {"$exists": False}},
                            {"financial_checkout_in_progress": False},
                            {"financial_checkout_started_at": {"$lt": stale_lock_before}},
                        ]},
                        {"$or": [
                            {"financial_correction_in_progress": {"$exists": False}},
                            {"financial_correction_in_progress": False},
                            {"financial_correction_started_at": {"$lt": stale_lock_before}},
                        ]},
                    ],
                },
                {"$set": {
                    "financial_checkout_in_progress": True,
                    "financial_checkout_operation_id": operation_id,
                    "financial_checkout_started_at": lock_ts,
                }},
                projection={"_id": 0, "id": 1},
                return_document=_g("ReturnDocument").BEFORE,
            )
            if not locked_client:
                await _g("db").bookings.replace_one({"id": booking_id}, original_booking, upsert=False)
                current_client = await _g("db").clients.find_one({"id": client_id}, {"_id": 0, "id": 1})
                if not current_client:
                    raise HTTPException(status_code=409, detail="The client record linked to this booking no longer exists.")
                raise HTTPException(status_code=409, detail="Another checkout or financial correction for this client is already in progress. Wait a moment and refresh.")
            client_lock_acquired = True

        snapshot: Dict[str, Any] = {"client": None, "lots": []}
        token = _g("_checkout_operation_id_ctx").set(operation_id)
        try:
            snapshot = await _g("_checkout_financial_snapshot")(client_id)
            # Catch the most common failure before any credit mutation.  Credits-only
            # checkouts remain allowed without opening the cash drawer.
            might_collect_money = not ff_row and (
                body.use_credits is False
                or body.amount_paid is not None
                or (body.payment_method not in (None, "credits"))
                or bool(body.add_ons)
                or int(body.extra_nights or 0) > 0 or bool(body.retail_lines)
            )
            if might_collect_money:
                await _g("_require_register_day_open")(_g("business_today")().isoformat())

            if ff_row:  # waiting for the group's one bill (a failed checkout's rollback takes this off)
                await _g("db").bookings.update_one({"id": booking_id}, {"$set": {"group_bill_pending": True}})
            result = await _g("_check_out_locked")(booking_id, body, user, create_invoice=not ff_row)
            if ff_row:  # the group's one bill is made when its last dog has left
                result["group_bill"] = await _g("friends_family").close_group_bill(original_booking.get("group_id"), user,
                                                                             leaving=booking_id)
            result.pop("checkout_in_progress", None)
            result.pop("checkout_operation_id", None)
            result.pop("checkout_started_at", None)
            await _g("db").bookings.update_one(
                {"id": booking_id, "checkout_operation_id": operation_id},
                {"$unset": {
                    "checkout_in_progress": "",
                    "checkout_operation_id": "",
                    "checkout_started_at": "",
                }},
            )
            return result
        except Exception:
            await _g("_rollback_checkout_finances")(
                booking_id=booking_id,
                original_booking=original_booking,
                snapshot=snapshot,
                operation_id=operation_id,
            )
            raise
        finally:
            _g("_checkout_operation_id_ctx").reset(token)
            if client_lock_acquired and client_id:
                await _g("db").clients.update_one(
                    {"id": client_id, "financial_checkout_operation_id": operation_id},
                    {"$unset": {
                        "financial_checkout_in_progress": "",
                        "financial_checkout_operation_id": "",
                        "financial_checkout_started_at": "",
                    }},
                )
            await _g("db").bookings.update_one(
                {"id": booking_id, "checkout_operation_id": operation_id},
                {"$unset": {
                    "checkout_in_progress": "",
                    "checkout_operation_id": "",
                    "checkout_started_at": "",
                }},
            )

    return {
        "check_out_group": check_out_group,
        "_check_out_endpoint_impl": _check_out_endpoint_impl,
    }
