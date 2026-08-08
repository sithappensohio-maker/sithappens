# Capacity and Waitlist Race Protection

## Baseline preserved

This build starts from `sithappens-main-booking-enforcement-timezone-fixed.zip` and preserves:

- Register input-focus correction
- Boarding pickup-day and second-dog pricing
- Configurable boarding pickup cutoff
- Per-service booking rules
- Money-integrity protections
- Persistent verified backups
- Exact-service and America/New_York booking enforcement

## Problems corrected

### Simultaneous bookings could overfill the final opening

Capacity used to be checked before insert without a shared lock. Two API workers could both see one remaining opening and both save a booking.

A Mongo-backed lease now serializes the final recount-and-save operation across all backend workers. Locks are created per capacity resource:

- Daycare date
- Every boarding presence date
- Assigned kennel and date
- Shared timed-service pool and date

The booking is recounted while the lock is held and saved only when capacity still exists. Leases expire automatically after 180 seconds if a worker crashes.

### Multi-dog groups were not protected as one operation

A group booking now acquires all required capacity locks before inserting its first dog and keeps them until the whole group finishes. If the entire group does not fit, inserted group rows are rolled back rather than partially filling the reservation.

### Reschedules and assignments could bypass capacity

Capacity validation now also runs for:

- Booking reschedules
- Admin date/time changes
- Kennel assignments and changes
- Approved reschedule requests
- Prepaid session moves
- Program-session generation

The existing booking is excluded from its own capacity count.

### Timed services had no configurable class size

Each timed service now has `capacity_per_slot`.

In **Settings → Services & Programs**, the service editor displays **Dogs per time slot**:

- `1` keeps a private appointment exclusive
- A higher number allows a group class to accept that many dog booking rows at the same time

Different overlapping timed services still conflict with each other. A group class only shares its slot with bookings for that exact service.

### Portal could claim a waitlist request was submitted when none existed

The client portal now creates an actual waitlist record before showing a waitlist confirmation. It preserves:

- Exact service
- Requested date or boarding range
- Appointment time
- Drop-off and pickup times
- Selected add-ons
- Dog and client ownership

Duplicate active waitlist requests are deduplicated using a unique key.

### Multi-date capacity handling was misleading

Multi-date requests can now place genuinely full dates on the waitlist when enabled. The result distinguishes booked, skipped, and actually waitlisted dates.

### Waitlist conversion could overbook

Conversion now atomically claims one waitlist entry with an internal `converting` state. It then creates the booking **without** a capacity override. Conversion succeeds only if a real opening still exists. On failure, the waitlist entry returns to its prior waiting/offered state.

## Capacity rules enforced

- Daycare uses configured daily dog capacity.
- Boarding checks every presence date in the stay.
- Assigned kennels use configured maximum dogs per kennel.
- Timed private services remain exclusive.
- Timed group services use their exact service slot capacity.
- Checked-out bookings no longer consume current capacity.
- Pending and approved active bookings reserve capacity.

## Validation performed

- 19 non-test backend Python files compiled successfully.
- 511 API routes scanned; 511 unique routes and no duplicate method/path pairs.
- All three modified frontend JavaScript/JSX files parsed successfully.
- Static integrity checks passed for:
  - Mongo shared capacity locks
  - Group lock context
  - Capacity-safe rescheduling
  - Waitlist conversion without override
  - Active waitlist deduplication
  - Per-service slot capacity
  - Multi-date waitlist handling

## Deployment verification still required

This environment did not have Motor/PyMongo, a live MongoDB database, Docker, or installed frontend dependencies. After deployment on Bazzite, run live smoke tests with two browsers submitting the same final opening simultaneously and confirm:

1. Only one request is booked.
2. The other receives a capacity response or creates a real waitlist entry.
3. A group class accepts exactly its configured number of dogs.
4. A private service remains limited to one booking.
5. Rescheduling into a full date or slot is rejected.
6. Two dogs cannot be assigned to a one-dog kennel for overlapping dates.
