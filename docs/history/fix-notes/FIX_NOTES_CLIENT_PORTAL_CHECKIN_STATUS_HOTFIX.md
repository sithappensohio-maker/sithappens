# Client Portal Check-In Status Hotfix

## Problem
The engagement hub could show a dog as currently checked in when the dog was not on today's schedule. Two cases were involved:

1. Old or malformed booking rows with `checked_in_at` but no `checked_out_at` were treated as active forever.
2. Admin client-portal previews could receive the admin's wider booking list, allowing another client's active booking to influence the preview card.

## Fix
- A portal booking is now considered actively on premises only when:
  - it has a check-in timestamp,
  - it has no checkout timestamp,
  - its status is approved (or the legacy checked-in status), and
  - today's date falls within the booking's scheduled date range.
- Engagement bookings are defensively filtered to the dogs actually loaded in the current portal account.
- The same filtering is applied to the priority card, dog status cards, and recent activity.

## Validation
- Portal engagement tests: 11/11 passed.
- Production frontend build completed successfully with the project's existing ESLint and source-map warnings only.
