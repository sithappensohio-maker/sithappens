# Day Status / Start Day Patch

- Dashboard closing card now changes based on day state:
  - Start Day when no drawer/session is open
  - Day Started / Ready to Close after opening cash drawer is saved
  - Day Complete after closeout is saved
- Added a lightweight Start Day checklist to the wrap-up modal. It saves opening cash through the existing cash drawer session endpoint.
- Boarding dogs staying overnight no longer count as closeout blockers. They are shown as informational stayovers.
- Boarding dogs due for pickup today/past due still count as closeout blockers until checkout.
- No client, dog, credit, payment, or booking data is rewritten.
