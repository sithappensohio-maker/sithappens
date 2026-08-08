# Phase 8B — Duplicate Dog Merge / Archive Workflow

This phase upgrades Duplicate Check from preview-only into a conservative dog merge workflow.

## Added

- Same-owner duplicate dog merge preview.
- Actual dog merge/archive action, only after typing `MERGE DOG`.
- The main dog is kept.
- The duplicate dog is soft-archived, never hard-deleted.
- Linked records that pointed at the duplicate dog are repointed to the main dog where safe:
  - bookings
  - bookings_archive
  - vaccine_uploads
  - incidents
  - homework
  - homework_media
  - training_sessions
  - training_session_log
  - dog_programs
  - program_enrollments
  - awarded_trophies
  - step_events
  - client_files
  - review_requests
- Useful profile details are merged into the main dog without overwriting better main-record data.
- Merge history is written to `duplicate_merge_audit`.
- `duplicate_merge_audit` is included in backups and backup safety checks.

## Safety rules

- Client merge is still preview-only.
- Dog merge is blocked if dogs are under different owners.
- Merge requires admin permission with `delete_records`.
- Merge requires explicit confirmation text: `MERGE DOG`.
- No client, dog, booking, credit, vaccine, payment, or message row is hard-deleted.

## Recommended use

For duplicates like:

- Oreo record A: 12 bookings / 1 future booking
- Oreo record B: 0 bookings

keep the record with bookings as the main dog and archive the empty duplicate.
