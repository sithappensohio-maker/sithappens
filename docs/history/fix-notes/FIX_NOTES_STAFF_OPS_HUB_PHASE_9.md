# Staff Ops Hub + Start Day Staff Readiness

Adds a conservative staff-operations polish pass.

## Backend

- Adds read-only `GET /api/admin/staff/readiness`.
- Summarizes today's:
  - scheduled shifts
  - currently clocked-in staff
  - scheduled staff not clocked in after start time
  - expected dog load by service
  - boarding stayovers
  - boarding dogs due out today
  - pending time-off requests
  - pending punch corrections
  - staff-to-dog ratio warning using the existing Settings guardrail
- Adds the same staff readiness summary into `GET /api/admin/end-of-day` so the Start Day checklist can show staff status.

## Frontend

- Adds a new Staff → Ops Hub tab as the default staff landing tab.
- Shows quick staffing readiness cards:
  - Scheduled today
  - Clocked in now
  - Expected dogs
  - Dogs per staff
- Shows warnings for ratio problems, missed clock-ins, pending time off, and pending punch corrections.
- Adds staff readiness to the Dashboard Start Day checklist.

## Safety

- No database migration.
- No staff records rewritten.
- No bookings rewritten.
- No clock entries rewritten.
- No payroll/tax calculations changed.
- This is a read-only visibility/operations pass.
