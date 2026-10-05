"""Checkout previews: the discount, early-checkout, money-modifier and group previews
a checkout screen asks for before it charges (step 4 of the checkout pricing move).

They are built by build(), which server.py calls once with its globals, because their
dependency (require_employee_or_admin) is defined in server.py. Server helpers are read
at call time through _g, the same as checkout_quotes."""
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException


_server_globals: dict = {}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def build(server_globals: dict) -> dict:
    """Define the four preview handlers against the server globals and return them."""
    configure(server_globals=server_globals)

    async def discount_preview(booking_id: str, _: dict = Depends(_g("require_employee_or_admin"))):
        """Pre-checkout preview of the multi-dog discount that WILL apply at
        check-out time, given the current siblings already checked out today
        and the configured base/service price. Used by the checkout modal so
        the client sees the discount BEFORE submit."""
        booking = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        booking, _rank_fields = await _g("group_rank").settle(_g("db"), booking, now=_g("now_iso")())
        settings = await _g("get_settings")()
        # Resolve a tentative price the same way check_out() would.
        tentative_price = float(booking.get("actual_price") or 0)
        # Sprint 110ar — Training visits are package-paid; never auto-suggest a
        # catalog price in the preview (admin types the amount manually when one
        # is owed). Without this the modal showed e.g. "$75" on a $0 visit.
        if tentative_price <= 0 and booking.get("service_type") != "training":
            default_svc = await _g("db").services.find_one(
                {"service_type": booking.get("service_type"), "is_default": True, "active": True},
                {"_id": 0},
            )
            if default_svc:
                unit = float(default_svc.get("base_price") or 0)
                # Sprint 110am — honour the client's legacy-pricing override in the
                # check-out preview so admins see the locked rate before confirming.
                pricing = await _g("resolve_client_price")(
                    _g("friends_family").payer_id(booking),
                    "service",
                    default_svc.get("id") or "",
                    unit,
                )
                unit = pricing["effective_price"]
                if (booked := await _g("_boarding_auto_base")(booking, settings)) > 0:   # the stay's booked rate: what checkout charges (audit #2)
                    tentative_price = booked
                elif booking.get("service_type") == "boarding":
                    ps = booking.get("pricing_snapshot") or {}
                    cutoff_time = ps.get("pickup_cutoff_time") or _g("_boarding_full_day_cutoff_from_rules")(settings.get("booking_rules") or {})
                    pickup_clock = booking.get("pickup_time") or cutoff_time
                    units = _g("_billable_boarding_units")(
                        booking.get("date"), booking.get("end_date"), pickup_clock,
                        legacy_minimum=1,
                        cutoff_time=cutoff_time,
                    )
                    late_fee = await _g("_boarding_late_pickup_daycare_fee")(
                        _g("friends_family").payer_id(booking), pickup_clock, cutoff_time,
                    )
                    tentative_price = (unit * units + float(late_fee.get("amount") or 0)) * _g("_group_row_price_factor")(booking)
                else:
                    tentative_price = unit
        preview_booking = {**booking, "actual_price": round(tentative_price, 2)}
        pre_applied = bool((booking.get("multi_dog_discount") or {}).get("pre_applied")) or _g("group_rank").group_priced(booking)
        disc = None if pre_applied else await _g("_compute_multi_dog_discount")(preview_booking, exclude_id=booking_id)
        # The late-pickup daycare fee is always cash, even when credits cover the nights,
        # so the screen shows it as due (the checkout charges the same figure; audit #3).
        late_pickup_fee_cash = 0.0
        if booking.get("service_type") == "boarding" and booking.get("end_date"):
            fee_cutoff = (booking.get("pricing_snapshot") or {}).get("pickup_cutoff_time") or _g("_boarding_full_day_cutoff_from_rules")(settings.get("booking_rules") or {})
            fee = await _g("_boarding_late_pickup_daycare_fee")(_g("friends_family").payer_id(booking), booking.get("pickup_time") or fee_cutoff, fee_cutoff)
            late_pickup_fee_cash = round(float(fee.get("amount") or 0) * _g("_group_row_price_factor")(booking), 2)
        return {
            "eligible": bool(disc and disc["amount"] > 0),
            "preview_base_price": round(tentative_price, 2),
            "late_pickup_fee_cash": late_pickup_fee_cash,
            "discount": disc,
        }

    async def early_checkout_quote(booking_id: str, _: dict = Depends(_g("require_employee_or_admin"))):
        """Boarding early-checkout pricing: what the stay is worth through TODAY.

        A dog leaving before the booked end_date was previously still quoted the
        full original span (the modal only handled EXTRA nights). This returns the
        same canonical quote (_quote_base_service_price: client-override rate,
        snapshot checkout time, nights + late-pickup daycare rule) with end_date =
        today and the pickup-day rule evaluated at the CURRENT business-local
        clock — the dog is walking out now, not at the originally planned pickup
        time.
        Returns {applicable: false} unless this is a boarding row being ended
        before its booked end date.
        """
        booking = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        booking, _rank_fields = await _g("group_rank").settle(_g("db"), booking, now=_g("now_iso")())
        today = _g("business_today")().isoformat()
        now_clock = _g("datetime").now(_g("BUSINESS_TZ")).strftime("%H:%M")
        left = _g("booking_reopen").pricing_ts(booking, "")
        if left:  # a reopened checkout: the stay ended when the dog really left (audit #14)
            left_at = _g("datetime").fromisoformat(left.replace("Z", "+00:00")).astimezone(_g("BUSINESS_TZ"))
            today, now_clock = left_at.date().isoformat(), left_at.strftime("%H:%M")
        if (
            booking.get("service_type") != "boarding"
            or not booking.get("end_date")
            or today >= str(booking.get("end_date"))
            or today < str(booking.get("date") or today)
        ):
            return {"applicable": False}
        ps = booking.get("pricing_snapshot") or {}
        settings = await _g("get_settings")()
        cutoff_time = ps.get("pickup_cutoff_time") or _g("_boarding_full_day_cutoff_from_rules")(settings.get("booking_rules") or {})
        quote = await _g("_quote_base_service_price")(
            client_id=_g("friends_family").payer_id(booking),  # the payer's rates on a friends & family visit
            service_type="boarding",
            start_date=booking.get("date"),
            end_date=today,
            pickup_time=now_clock,
            pickup_cutoff_time=cutoff_time,
            service_id=booking.get("service_id"),
            legacy_boarding_minimum=1,
        )
        units = float(quote.get("units") or 1)
        unit_price = float(quote.get("unit_price") or 0)
        late_fee_amount = float(quote.get("late_pickup_daycare_fee") or 0)
        base_price = round((unit_price * units + late_fee_amount) * _g("_group_row_price_factor")(booking), 2)
        return {
            "applicable": True,
            "actual_end_date": today,
            "original_end_date": booking.get("end_date"),
            "units": units,
            "unit_price": unit_price,
            "late_pickup_daycare_fee": round(late_fee_amount, 2),
            "base_price": base_price,
            "pickup_time_used": now_clock,
            "pickup_cutoff_time": cutoff_time,
        }

    async def money_modifier_preview(
        booking_id: str,
        _: dict = Depends(_g("require_employee_or_admin")),
    ):
        """Preview holiday/peak, late-pickup, and rounding rules for checkout."""
        booking = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        booking, _rank_fields = await _g("group_rank").settle(_g("db"), booking, now=_g("now_iso")())
        settings = await _g("get_settings")()
        base_amount = max(
            0.0,
            round(float(booking.get("estimated_price") or 0) - _g("_booking_addon_total_from")(booking), 2),
        )
        boarding_auto = await _g("_boarding_auto_base")(booking, settings)
        if boarding_auto > 0:
            base_amount = boarding_auto
        if base_amount <= 0:
            base_preview = await _g("discount_preview")(booking_id, {})
            base_amount = float(base_preview.get("preview_base_price") or 0)
        result = _g("_money_modifier_breakdown")(booking, base_amount, settings, _g("booking_reopen").pricing_ts(booking, _g("now_iso")()))
        tax_cfg = (settings.get("sales_tax") or {})
        applies = _g("_service_type_sales_taxable")(booking.get("service_type"), tax_cfg)
        result["sales_tax"] = {
            "enabled": bool(tax_cfg.get("enabled")),
            "rate_pct": float(tax_cfg.get("rate_pct") or 0),
            "label": tax_cfg.get("label") or "Sales Tax",
            "applies": applies,
        }
        return result

    async def checkout_group_preview(
        booking_id: str,
        _: dict = Depends(_g("require_employee_or_admin")),
    ):
        """Return the household rows and a combined pre-checkout ticket preview."""
        anchor = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
        if not anchor:
            raise HTTPException(status_code=404, detail="Booking not found")
        rows = await _g("_active_household_checkout_rows")(anchor)
        settings = await _g("get_settings")()
        cfg = _g("_multi_dog_discount_config_for")(settings, anchor.get("service_type") or "")
        preview_rows: List[Dict[str, Any]] = []
        combined = 0.0
        discount_total = 0.0
        anchor_service = anchor.get("service_type") or "daycare"
        ticket_dogs = [r.get("dog_id") for r in rows if r.get("dog_id")]
        prior_q = {
            "client_id": anchor.get("client_id"),
            "date": anchor.get("date"),
            "service_type": {"$in": [anchor_service] + ([None, ""] if anchor_service == "daycare" else [])},
            "status": "completed",
            "checked_out_at": {"$exists": True, "$ne": None},
            # Only this family's own dogs — never one another family paid for (a friend's dog on a friends & family group).
            "bill_to_client_id": {"$in": [None, "", anchor.get("client_id")]},
            "$or": [{"multi_dog_discount": None}, {"multi_dog_discount.pre_applied": True}],
        }
        if ticket_dogs:
            prior_q["dog_id"] = {"$nin": ticket_dogs}   # a dog's own earlier visit is not a sibling
        prior_completed = await _g("db").bookings.count_documents(prior_q)
        for idx, row in enumerate(rows):
            row, _rank_fields = await _g("group_rank").settle(_g("db"), row, now=_g("now_iso")())
            row = await _g("_refresh_booking_price_for_current_override")(row)
            addons = _g("_booking_addon_total_from")(row)
            total = float(row.get("estimated_price") or row.get("actual_price") or 0)
            if total <= 0 and row.get("service_type") in ("daycare", "boarding"):
                quote = await _g("_quote_base_service_price")(
                    client_id=row.get("client_id"),
                    service_type=row.get("service_type"),
                    start_date=row.get("date"),
                    end_date=row.get("end_date"),
                    pickup_time=row.get("pickup_time"),
                    service_id=row.get("service_id"),
                    legacy_boarding_minimum=1,
                )
                total = round(float(quote.get("unit_price") or 0) * float(quote.get("units") or 1) + addons, 2)
            base = max(0.0, round(total - addons, 2))
            pre_applied = bool((row.get("multi_dog_discount") or {}).get("pre_applied")) or _g("group_rank").group_priced(row)
            predicted_discount = 0.0
            if (prior_completed + idx) > 0 and not pre_applied:
                predicted_discount = _g("_discount_amount_for_extra_dogs")(base, cfg, additional_dogs=1)
            row_total = max(0.0, round(total - predicted_discount, 2))
            out = dict(row)
            out["checkout_preview_total"] = row_total
            out["checkout_preview_discount"] = round(predicted_discount, 2)
            preview_rows.append(out)
            combined += row_total
            discount_total += predicted_discount
        return {
            "bookings": preview_rows,
            "count": len(preview_rows),
            "is_group_checkout": len(preview_rows) > 1,
            "combined_total": round(combined, 2),
            "discount_total": round(discount_total, 2),
        }

    return {
        "discount_preview": discount_preview,
        "early_checkout_quote": early_checkout_quote,
        "money_modifier_preview": money_modifier_preview,
        "checkout_group_preview": checkout_group_preview,
    }
