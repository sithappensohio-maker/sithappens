# Mobile UI Scroll Audit — July 8, 2026

## Problem
On phones, some pages and dialogs could not scroll far enough to reach the final controls. The primary cause was the combination of static `100vh`, nested `overflow-hidden` flex layouts, mobile browser chrome, safe-area insets, and constrained modal cards whose flex children were not allowed to shrink.

## Fixes

- Added a visual-viewport synchronizer in `frontend/src/index.js` that tracks the actually visible phone height, including browser bars and the on-screen keyboard.
- Replaced static app-shell viewport sizing with `--app-height` and dynamic viewport fallbacks.
- Added `min-h-0` to the admin shell, portal shell, drawer, and constrained flex modal layouts.
- Hardened `[data-scroll-root]` regions with momentum scrolling, overscroll containment, and bottom scroll padding.
- Added global mobile handling for all full-screen flex/grid overlays so tall dialogs remain reachable from top to bottom.
- Updated shared Radix Dialog, Alert Dialog, Sheet, and Drawer primitives with visible-viewport max heights and internal scrolling.
- Converted old `88vh`, `90vh`, `92vh`, `95vh`, and `calc(100vh - …)` modal limits to the visible viewport variable.
- Preserved internal modal headers/footers while allowing the middle body to shrink and scroll.
- Corrected safe-area bottom padding so it never collapses normal button padding to zero.
- Moved phone-only fixed prompts, toasts, and the employee incident button above the gesture/navigation area.
- Added `scripts/audit_mobile_scroll.py` as a regression guard.

## Validation

- Static mobile audit: **PASS**
- Source files audited: **201**
- Full-screen overlays audited: **111**
- JavaScript/JSX parse: **199 files, 0 failures**
- CSS parse: **392 top-level rules, 0 failures**

## Environment limitation
A full production dependency install/build could not be completed in the audit environment. `npm install` timed out and Yarn could not reach its registry. Source syntax and CSS parsing completed successfully.
