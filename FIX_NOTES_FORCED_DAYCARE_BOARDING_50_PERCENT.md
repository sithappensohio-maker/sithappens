# Forced daycare/boarding additional-dog 50% rule

This patch removes the old discount systems from daycare/boarding math paths.

## Why
Some installs still had legacy values in Mongo, such as:
- `services.additional_dog_rate`
- `settings.multi_dog_discount_by_service.daycare.mode = flat`
- `settings.multi_dog_discount_by_service.daycare.value = 12.50`

Those old values could make daycare estimates show:

- Base price: $60.00
- Discount: -$12.50
- Total: $47.50

For Sit Happens, the intended rule is:

- First daycare/boarding dog = full base rate
- Every additional daycare/boarding dog = 50% off that same base rate
- Add-ons are not discounted

So two daycare dogs at $30/day should show:

- Base price: $60.00
- Additional dog discount: -$15.00
- Estimated total: $45.00

## What changed

- Backend `_multi_dog_discount_config_for()` now ignores old daycare/boarding discount settings and returns a fixed 50% percent rule.
- Backend `/api/pricing/quote` already ignores `additional_dog_rate` for daycare/boarding; this patch makes the discount config match that rule.
- Admin booking estimate ignores stale flat settings and uses the fixed 50% daycare/boarding rule.
- Admin booking estimate now uses the highest normal per-dog base as the reference rate so stale per-dog quote rows cannot create a $12.50 discount.
- Client booking estimate ignores stale daycare/boarding discount settings and uses fixed 50%.
- Booking detail group estimates ignore old daycare/boarding discount settings and use fixed 50%.

## Data safety

This does not delete existing data or rewrite service records. It simply stops daycare/boarding pricing code from trusting old discount fields.
