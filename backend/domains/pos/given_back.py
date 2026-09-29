"""What has already gone back to the customer on a Register sale.

Money goes back on a sale three ways — a void, a return, or a manual refund
against its receipt — and each writes a negative `retail_sales` row carrying
the sale's `pos_sale_id` and the sales tax it reversed. Summing those rows is
the one answer to "how much of this sale was given back": the manual refund
uses it as its ceiling.
"""
from __future__ import annotations

from typing import Dict, Iterable, Optional, Tuple


async def by_sale(db, sale_ids: Iterable[str]) -> Dict[str, Tuple[float, float]]:
    """{sale id: (money given back, sales tax given back)} for each sale
    that has had any. Sales with none are simply absent."""
    ids = sorted({i for i in sale_ids if i})
    if not ids:
        return {}
    sums: Dict[str, list] = {}
    async for r in db.retail_sales.find({"pos_sale_id": {"$in": ids}, "amount": {"$lt": 0}},
                                        {"_id": 0, "pos_sale_id": 1, "amount": 1, "tax_amount": 1}):
        s = sums.setdefault(r["pos_sale_id"], [0.0, 0.0])
        s[0] += abs(float(r.get("amount") or 0))
        s[1] += abs(float(r.get("tax_amount") or 0))
    return {k: (round(a, 2), round(t, 2)) for k, (a, t) in sums.items()}


async def hand_refund_block(db, sale: dict, action: str) -> Optional[str]:
    """Why a void or return of this sale is refused, if it is: money was
    already refunded by hand against its receipt (Register Tools -> Refund).
    That refund is money only, not items, so a void or return after it
    would hand the same money and tax back a second time. The hand refund
    itself counts every void and return before it, so the one ceiling holds
    whichever order things happen in."""
    total = 0.0
    async for r in db.retail_sales.find({"pos_sale_id": sale.get("id"), "source_kind": "refund", "amount": {"$lt": 0}},
                                        {"_id": 0, "amount": 1}):
        total += abs(float(r.get("amount") or 0))
    if total < 0.005:
        return None
    receipt = sale.get("receipt_number") or ""
    return (f"${total:.2f} of sale #{receipt} was already refunded by hand (Register Tools → Refund), so a {action} "
            f"here could give the same money back twice. Give back anything more the same way, against receipt #{receipt}, "
            f"and put any goods that came back into stock by hand.")
