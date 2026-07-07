# Client Engagement Hub — Phase 10A

## Goal

Organize the existing client-portal features into a simple home experience that answers:

1. What is happening with my dog?
2. Is there anything I need to do?
3. What should I do next?

This pass reuses existing bookings, dogs, setup status, messages, homework, credits, trophies, report cards, announcements, vaccine uploads, and portal controls. It does not change booking validation, pricing, credits, vaccines, waivers, payments, or training data.

## Changes

### Smart priority card

The portal now shows one primary action based on this order:

1. Finish required setup
2. Read unread messages
3. View a dog currently checked in
4. View a recent Pup Report Card
5. Complete active training homework
6. Review the next upcoming or pending booking
7. Review a low credit balance
8. Book the next visit / add the first dog

Every state has one plain-language button that opens the existing relevant workflow.

### My Dogs overview

A compact dog overview now shows each dog's most useful current status:

- Checked in
- Vaccine records needed
- Active training tasks
- Upcoming booking
- Profile ready

Selecting a dog opens the existing dog-edit modal. The complete My Dogs section remains farther down the portal for detailed management.

### Essential actions

The main overview now limits immediate shortcuts to:

- Book / Add Dog
- Message Us
- Upload Records
- Credits
- Get Help

Feature Visibility and Client Portal Controls continue to hide disabled actions.

### Recent activity

The new activity feed combines existing client-visible events:

- Booking requests and approvals
- Check-in / checkout
- Pup Report Cards
- Homework assignments and completions
- Trophies

Only the six newest items are shown. A report card does not also create a duplicate checkout row.

### Reduced clutter

- Removed the redundant welcome-only card.
- Removed the small Credits, My Bookings, My Dogs, and Messages callout bars.
- Moved dog facts, training tips, and trivia into a closed-by-default optional drawer.
- Renamed the old Quick Links card to More Options.
- Removed duplicate Book, My Bookings, and Vaccine Upload tiles from More Options because those actions now live in the main overview.
- Replaced the obsolete manual landing-order editor in Settings with an explanation of the automatic smart priority system.

### Emergent cleanup

- Removed `@emergentbase/visual-edits` from frontend dependencies.
- Removed the Emergent visual-edits CRACO wrapper.
- Added an explicit AJV 8 development dependency so current dependency resolution builds cleanly.

## Files

- `frontend/src/components/PortalEngagementHub.jsx`
- `frontend/src/components/PortalEngagementHub.test.js`
- `frontend/src/screens/Portal.jsx`
- `frontend/src/screens/Settings.jsx`
- `frontend/craco.config.js`
- `frontend/package.json`

## Validation

- Frontend production build: **PASS**
- Engagement priority/activity unit tests: **6/6 PASS**
- No new ESLint warnings from the new component.
- The build still reports pre-existing React hook dependency warnings in older files; these were not introduced by this pass.

## Safety

No backend models, API endpoints, booking calculations, permission checks, pricing rules, discounts, credits, payment behavior, vaccine enforcement, waiver enforcement, or training records were changed.
