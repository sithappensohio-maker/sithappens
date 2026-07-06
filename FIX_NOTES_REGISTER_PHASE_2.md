# Register / POS Phase 2

Safe upgrade notes:

- Adds a central Staff → Register money hub with one front door for:
  - Today/register overview
  - New Sale
  - Sell Credit Pack
  - Record Client Payment
  - Issue Refund
  - Cash Drawer Payout
  - Close Day
- Existing checkout, credit pack sale, expenses, Income, and tax screens remain in place.
- New Register actions write to the existing safe collections instead of replacing them:
  - retail_sales for register sales, tab payments, credit-pack sales, refunds
  - expenses for cash drawer payouts
  - cash_drawer_sessions for opening drawer cash
  - daily_closeouts for closeout records
- Adds /api/admin/register/refund for POS-style refund records.
- Adds /api/admin/register/cash-payout for cash drawer expense payouts.
- Register day summary now includes refunds, expenses, and recent activity.
- Cash refunds reduce expected cash by payment method when the refund method is cash.
- Refund rows reduce Schedule C income estimates instead of being ignored.
- No destructive migrations. No client/dog/credit/booking data is deleted or rewritten.

Recommended smoke test:

1. Staff → Register loads.
2. Set opening drawer cash.
3. Log a New Sale with Cash and confirm expected cash increases.
4. Sell a Credit Pack and confirm the client credits increase.
5. Record a client payment and confirm it appears in Register totals.
6. Record a cash refund and confirm expected cash decreases.
7. Log a Cash Payout and confirm expected drawer decreases and an expense exists.
8. Save Close Day.
9. Confirm Income/Money Audit still load.
