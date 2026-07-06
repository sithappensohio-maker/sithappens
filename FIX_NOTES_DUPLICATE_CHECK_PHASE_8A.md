# Phase 8A — Duplicate Client/Dog Safety Check

Adds a safe preview-only duplicate finder.

## What changed

- Added sidebar screen: `Duplicate Check`.
- Added Settings → System & Data → Duplicate Check shortcut.
- Added backend endpoint: `GET /api/admin/duplicates/report`.
- Scans for likely duplicate clients using:
  - same email
  - same phone
  - same normalized client name plus same dog name
  - similar client names with shared dog name / similar phone
- Scans for likely duplicate dogs using:
  - same owner + same dog name
  - same dog name across possible duplicate client accounts
- Shows impact preview before any future merge work:
  - dogs
  - bookings
  - future bookings
  - portal users
  - daycare / boarding / training credits
  - account balance
  - payment ledger row count

## Safety

This phase does not merge, delete, archive, rewrite, or move anything.

No clients, dogs, bookings, credits, vaccines, messages, payments, or portal accounts are changed.

Phase 8B can add actual merge tooling later, but only with a dry-run preview, explicit confirmation, and audit log.
