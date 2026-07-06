# Register Phase 4 — Expenses / Receipts / CPA Packet

Safe cleanup phase focused on organizing money-going-out workflows inside the Register without deleting or replacing existing Income/Expenses screens.

## Added / improved

- Register now has an **Expenses** tab for logging expenses from the money hub.
- Expense logging supports:
  - vendor/store
  - category
  - quantity
  - price each
  - total amount
  - payment method
  - tax deductible flag
  - paid out of cash drawer flag
  - recurring flag + interval
  - notes
  - receipt attachment
- Receipt uploads are guarded server-side:
  - only image/PDF data URLs
  - max about 2.5 MB
- Expense category endpoint now returns default business categories plus existing categories.
- Expenses export now includes quantity, unit price, recurring, and receipt-attached columns.
- Added one-click CPA/bookkeeper export:
  - `GET /api/admin/register/tax-packet.zip`
  - includes register activity, payment methods, closeouts, expenses, tax summary, and README.
- Dashboard Register card now opens the correct Sell Credits tab and includes an Expenses quick action.
- Existing Income → Expenses remains in place as a fallback.

## Safety

- No destructive database migration.
- No client/dog/booking/credit rewrites.
- Old expense records continue to work.
- Existing expense screen remains available.

## Validation

Backend compile checks passed:

```bash
python3 -m py_compile backend/server.py backend/pl_report.py backend/email_service.py backend/email_templates_registry.py backend/reset_db.py backend/cleanup_test_data.py
python3 -m compileall -q backend
```

Frontend production build was not run in this container because frontend dependencies are not installed here.
