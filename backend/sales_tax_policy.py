"""THE sales-tax rule for Sit Happens, in one place.

**Only physical merchandise is sales-taxable.** Everything the business does
as a service — daycare, boarding, training, grooming, photography, training
programs, prepaid credit packs, add-ons sold at pickup — is a service under
Ohio law for this business and never carries sales tax. Service dollars stay
business income everywhere (Finance, P&L, Schedule C, quarterly estimates);
only the sales-tax slice is zero.

There is deliberately NO per-category switch any more. `sales_tax.applies_to`
used to decide this, and a merchandise sale could go out untaxed because one
toggle deep in Settings was off while everything else looked configured — a
filing problem that is invisible until you reconcile. The only two controls
are whether tax is collected at all, and at what rate.

Nothing here rewrites history: rows that already stored a tax amount keep it.
This module only decides what to charge on a NEW sale.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

# What a line says about itself when it is a service rather than a good.
SERVICE_EXEMPT_REASON = "Service — not sales-taxable"


def merchandise_tax_rate(tax_cfg: Optional[Dict[str, Any]]) -> float:
    """The percentage to charge on physical goods — 0.0 when tax is switched
    off or has no rate. Merchandise is ALWAYS taxable at that rate; there is
    no category that can exempt it."""
    cfg = tax_cfg or {}
    if not cfg.get("enabled"):
        return 0.0
    try:
        rate = float(cfg.get("rate_pct") or 0)
    except (TypeError, ValueError):
        return 0.0
    return rate if rate > 0 else 0.0


def tax_on(amount: float, rate_pct: float) -> float:
    """Tax added ON TOP of a pre-tax amount, to the cent."""
    if rate_pct <= 0 or amount <= 0:
        return 0.0
    return round(float(amount) * (float(rate_pct) / 100.0), 2)


def service_tax_rate(_tax_cfg: Optional[Dict[str, Any]] = None) -> float:
    """Always 0.0. A service is never sales-taxable — see the module
    docstring. This exists so the rule is stated at every call site instead
    of being an unexplained missing branch."""
    return 0.0
