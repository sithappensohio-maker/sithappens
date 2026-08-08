# Sit Happens — Configurability Audit (Feb 2026)

> Source of truth for what's controllable from Settings vs what still requires
> code changes. Updated each time a configurability gap is closed.

## Legend
- **A** = Already configurable from Settings
- **B** = Hard-coded but SHOULD be configurable (gap)
- **C** = Intentionally hard-coded (and why)

---

## Admin Dashboard
| Item | Status | Notes |
|---|---|---|
| Stat-card colors / borders | **A** | Brand & Theme → Card Type Themes (`stat`) |
| Stat-card visibility per service | **A** | Feature Visibility (daycare/boarding/training/grooming/photography) hides matching stat cards |
| Hero card / Tasks / Dog Fact / Trivia / P&L / Mileage / Owner Clock / Quick Links / Closing Checklist visibility | **B → A** | **Closed in this sprint** via `dashboard_widgets` block |
| Quick-link tile destinations | **C** | Tightly coupled to nav routes — change requires route work |

## Client Portal
| Item | Status | Notes |
|---|---|---|
| Section show/hide | **A** | Client Portal Controls (11 sections) |
| Labels / CTAs / lock message / empty-state copy | **A** | Client Portal Controls |
| Announcement banner | **A** | Client Portal Controls (with date window + style) |
| Credit tiles per service | **A** | Feature Visibility + CPC |
| Landing priority reorder render | **B (partial)** | Storage + UI works; Portal still renders in original code order. Setup-checklist-first override DOES work. Refactor to honor user order is out of scope per "no portal redesign". |

## Staff Portal
| Item | Status | Notes |
|---|---|---|
| Visibility | **A** | Feature Visibility (`staff_portal`) hides nav + route |
| Per-role permission keys | **A** | `users.permissions` schema; ~12 known keys (clients_view, dogs_edit, bookings, messages, finance_reports, payroll, incidents, settings, care_complete, etc.) |
| Per-role permission matrix UI | **A** | **Closed in 110di-20** — Settings → Permission Matrix (14 keys × 7 roles, owner locked, dependency auto-enable, lockout guard) |

## Booking Flow
| Item | Status | Notes |
|---|---|---|
| Global rules (max advance, lead time, deposit) | **A** | `booking_rules` |
| Day-to-day guardrails (same-day allowed, weekend lead, max per client, max consecutive nights) | **A** | `day_to_day.guardrails` |
| Service-disabled rejection | **A** | Feature Visibility booking guard |
| **Per-service** require-approval / instant / same-day / lead time / max advance | **B → A** | **Closed in this sprint** via `booking_flow_controls.per_service[*]` |
| Waitlist when capacity reached | **A** | `day_to_day.guardrails` + Feature Visibility (`waitlist`) |

## Waitlist / Care Board / Kennel Board / Intake / Waiver / Rewards / Messaging
| Item | Status | Notes |
|---|---|---|
| Feature toggle | **A** | Feature Visibility |
| Card styling | **A** | Card Type Themes (waitlist/care/kennel/intake/waiver) |
| Intake form content | **A** | Intake Forms screen (custom questionnaires) |
| Waiver text + version + scope | **A** | Settings → Waiver |
| Required vaccines / grace days | **A** | Settings → Vaccine Requirements |
| Trophy criteria | **C** | Code-defined milestones — explicit kennel-club rules; change requires schema review. |

## Reports / Finance
| Item | Status | Notes |
|---|---|---|
| Visible service filters | **A** | Feature Visibility (disabled services hidden from filters; historical data preserved) |
| Fiscal year start / 1099 threshold / mileage rate | **A** | `day_to_day.finance` |
| P&L card visibility on dashboard | **A** | Dashboard Widget Controls (new) |

## Settings / Navigation / Theme
| Item | Status | Notes |
|---|---|---|
| Sidebar items respect features | **A** | App.js nav filter |
| Card styling per surface | **A** | Card Type Themes (24 types + 3 legacy aliases) |
| Brand colors / fonts / footer | **A** | Brand & Theme |
| Letter case / time / date / week start / splatter | **A** | `day_to_day.ui` |

---

## Single Source of Truth Map
| Concern | Storage | UI |
|---|---|---|
| Features | `settings.feature_visibility` | Settings → Feature Visibility |
| Portal behavior | `settings.client_portal_controls` | Settings → Client Portal Controls |
| Booking behavior | `settings.booking_rules` + `settings.day_to_day.guardrails` + `settings.booking_flow_controls.per_service` | Settings → Booking Rules + Booking Guardrails + Booking Flow Controls |
| Permissions | `users.permissions[]` + `settings.staff_role_permissions` | Settings → Permission Matrix (14 keys × 7 roles) |
| Theme | `settings.card_type_themes` + brand_* + theme_* | Settings → Brand & Theme |
| Notifications | `settings.email_per_step` + `email_templates` + `automation` block | Settings → Email Designer + Email Automation |
| Dashboard widgets | `settings.dashboard_widgets` | Settings → Dashboard Widgets |
| Requirements to Book | `/api/portal/setup-status` (computed, never stored as a duplicate) | Settings → Compliance |

## Settings Debt — final
- No duplicate card editors (Sprint 110di-13 merged Cards & Panels into Card Type Themes Default).
- No duplicate theme controls (one Brand & Theme panel).
- No duplicate feature flags (Feature Visibility is the only feature on/off).
- No duplicate portal controls (Client Portal Controls is the only portal UI configurability panel).
- No duplicate booking-requirement system (`/api/portal/setup-status` is unique).
- Legacy aliases (`card_type_themes.stats/training/profile`) kept on purpose for back-compat — they're not separate editors.

## Intentionally hard-coded (C list — and why)
1. **Trophy criteria & training-milestone definitions** — domain-specific dog-care logic; making fully editable would require a rule engine.
2. **Sit Happens brand-language micro-copy** (header tagline, splatter aesthetic, eyebrow text styling) — part of the visual identity, not operational behavior.
3. **PWA service-worker cache key** — implementation detail (managed automatically).
4. **Stripe/payment processor terminology** — driven by Stripe SDK, not editable copy.
5. **Audit log keys** — stable identifiers used by downstream queries/reports.

## Remaining hard-coded business decisions (recommend NOT to expose until requested)
- Per-day max retail items per client (no demand)
- Trophy unlock thresholds (handled via training programs)
- Reschedule grace window per service (covered by `day_to_day.guardrails`)
