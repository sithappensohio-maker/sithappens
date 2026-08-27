# Sit Happens App Modernization Roadmap

This roadmap is intentionally incremental. Each phase must leave the running
application usable and must preserve existing business behavior unless a
behavior change is explicitly chosen and documented.

## Governing rule

**Modernization must not change business behavior by accident.**

Architecture, navigation, routing, and performance work should preserve
permissions, pricing, training progression, booking rules, historical data,
and client-visible behavior unless the owner deliberately approves a change.

## Phase 1 — Admin workflow consolidation

- Make Today the authoritative owner/admin landing workspace.
- Remove Dashboard as a competing standalone destination and migrate any
  Dashboard-only operational tools into Today rather than embedding the whole
  Dashboard forever.
- Consolidate Schedule, Bookings, Waitlist, and Recurring into one scheduling
  workspace.
- Consolidate trainer daily work, School HQ, Practice, Rewards, and Trophies
  into one Training workspace.
- Reduce sidebar decisions while preserving every existing capability and
  permission boundary.

## Phase 2 — Real admin routing

- Introduce React Router.
- Give major admin workspaces and records durable URLs.
- Support browser Back/Forward, refresh, bookmarks, and direct record links.
- Gradually remove setTab(), sh:nav, sessionStorage navigation handoffs, and
  similar home-grown routing plumbing.

## Phase 3 — Shared frontend data layer

- Centralize clients, dogs, services, programs, settings, and global counters.
- Standardize loading, retry, error, caching, and invalidation behavior.
- Stop unrelated screens from repeatedly fetching the same data independently.

## Phase 4 — Freeze backend/server.py and extract Training/School

- Substantial new backend features do not go directly into server.py.
- Introduce domain routers/services while retaining existing endpoint URLs.
- Extract Training and School first because they are actively evolving.
- Replace runtime endpoint patching with direct canonical service calls where
  practical and covered by regression tests.

## Phase 5 — Extract Bookings, Pricing, and POS

- Move booking creation, pricing resolution, checkout, register, and POS logic
  behind explicit domain services.
- Reduce the chance that separate sales/check-in paths develop different price
  interpretations.
- Treat this as high financial-risk work and only begin after Phase 4 proves
  the extraction pattern.

## Phase 6 — API and performance optimization

- Add server-side search/pagination to heavy list endpoints.
- Make Practice active-first and page historical work.
- Batch remaining N+1 database access.
- Consolidate shell polling and reduce duplicate payloads.
- Profile actual slow endpoints before optimizing them.

## Phase 7 — Infrastructure cleanup

- Split runtime, test, and development Python dependencies.
- Remove unused production dependencies.
- Move Create React App/CRACO to Vite after the application architecture is
  stable enough to make the build-tool migration boring.
- Add automated CI for backend, frontend, and release-critical tests.
- Harden update.sh so each deployment records its exact Git SHA and can roll
  back cleanly to the previously deployed SHA.

## Current status

**All seven modernization phases are complete in the working package.**

### Phase 1 complete

- Schedule, Bookings, Waitlist, and Recurring are one Schedule workspace.
- Pipeline, School HQ, Practice, Rewards, and Trophies are one Training workspace.
- Today is the authoritative admin landing workspace.
- The old Dashboard is no longer mounted or embedded; legacy `dashboard` navigation resolves to Today.
- Unique Dashboard operations were moved into Today: check-in/check-out, owner clock/end-of-day, vaccine review, quote requests, help requests, and finance/compliance reminders.
- Duplicate Dashboard summaries and duplicate Training/Rewards queues were intentionally not copied.

### Phase 2 complete

- React Router/BrowserRouter now owns admin browser history instead of an in-memory `tab` state.
- Major admin destinations have durable `/admin/...` URLs.
- Schedule and Training workspace tabs have nested URLs and participate in Back/Forward history.
- Client and dog records can be addressed directly, including Client Hub booking/invoice/message targets.
- Settings subsections and category overviews are bookmarkable and restore correctly on refresh/Back.
- Existing `sh:nav` callers remain supported as a compatibility bridge, but now resolve through router navigation.
- Legacy `dashboard`, `register`, old booking/workspace aliases, and invalid admin paths canonicalize safely.
- The existing nginx SPA fallback already supports refreshing a deep `/admin/...` URL without a server 404.
- Route-opened client/dog UI is guarded so normal data refreshes do not repeatedly reopen the same record.

Remaining sessionStorage handoffs used for specialized in-screen targeting (for example a particular finance panel or pending-action focus) are intentionally retained for now; their screen-level routing can be retired incrementally without blocking the core admin router.

### Phase 3 complete

- Added a token-scoped shared GET cache underneath the existing API client for clients, dogs, services, programs, settings, and admin navigation counters.
- Cache keys include URL + stable query params, so filtered/paginated variants never collide.
- Cache lifetimes are intentionally short and the cache is bounded/pruned; transactional/detail endpoints remain uncached.
- Existing screens benefit immediately without requiring an all-at-once rewrite.
- Added automatic resource invalidation after successful POST/PUT/PATCH/DELETE mutations, including cross-resource cases such as pricing-tier assignments and POS changes that alter client state.
- Added reusable `useSharedData` hooks for Clients, Dogs, Services, Programs, and Settings, plus imperative `getSharedData`/refresh helpers.
- Services/Programs settings now consume the hook layer directly, establishing the migration pattern for future screens.
- Replaced four separate App-shell badge polling effects with one shared `useAdminNavCounts` owner while retaining the existing backend endpoints and event-driven immediate refresh behavior.
- Shared cache is cleared on login/MFA/register/logout/token failure so one authenticated identity never retains another identity's memory cache.

### Phase 4 complete

- Added `backend/domains/` as the required home for substantial new backend features.
- Froze the route set remaining in `backend/server.py`; architecture tests allow extraction to shrink it but reject new `@api.*` routes there.
- Extracted the Training Today HTTP route and roster query into `domains/training`, leaving only a compatibility callable in `server.py` for existing direct callers/tests.
- Moved trainer-controlled manual In-Person progression out of the School-suite wrapper into the Training domain while preserving the exact `/api/training/enrollments/{id}/manual-progress` URLs.
- School curriculum, School suite, School experience feedback, and Training routes now register through an explicit domain bootstrap before `app.include_router(api)`.
- `app_entry.py` no longer installs extensions or mutates the application after import; it only exports the already-composed `server.app`.
- Board & Train scheduling, AM/PM draft orchestration, completion-record enforcement, automatic daily closeout, checkout gating, In-Person checkpoint authority, and Today enrichment are called directly from canonical server functions through `domains.training.services`.
- Curriculum-import Practice hardening now uses explicit preflight/post-success hooks rather than replacing FastAPI `route.endpoint` / `dependant.call` after registration.
- School Practice delete protection is called directly by the canonical delete endpoints; the legacy route-patching compatibility path is disabled in production registration.
- Normalized route-signature parity was checked against the Phase 3 package: all 767 production API method/path pairs are preserved, with no additions or losses.

### Phase 5 complete

- Moved all 42 Booking, 15 Pricing, 13 Register, and 21 POS HTTP registrations out of `server.py` into explicit domain route modules while preserving the existing endpoint callables and dependency signatures.
- Extracted the canonical client-specific pricing resolver, override lifecycle/precedence rules, add-on pricing snapshots, and base booking quote into `domains/pricing/services.py`.
- Extracted exact base-service selection into `domains/bookings/services.py`, so booking creation cannot bypass the canonical catalog/service rule while the large transaction body remains behavior-compatible.
- Extracted register-open enforcement and opening-cash rollover semantics into `domains/register/services.py`, shared by POS and booking/payment paths.
- Extracted the Front Desk register catalog and unified POS cart-pricing kernel into `domains/pos/services.py`; both POS preview and POS checkout continue to call the same pricing function.
- Kept proven transaction bodies as compatibility implementations while routing booking creation, booking checkout, and POS sale entrypoints through stable domain-service seams; existing internal callers/tests do not need a simultaneous rewrite.
- Added a 91-route financial manifest and architecture tests preventing booking/pricing/register/POS route ownership from drifting back into `server.py`.
- Verified the complete production API signature set remains identical to Phase 4: 767 method/path pairs before and 767 after, with zero additions or losses.
- Preserved the active-vs-revoked client-price selection rule that fixed Quick Check-In and kept pricing-tier fallback below an individual client override.

### Phase 6 complete

- Added a server-paged `/clients/page` directory endpoint so the Clients workspace no longer downloads and decorates the complete client history before it can render or search.
- Added lightweight `/clients/options`, `/clients/balances`, and `/dogs/options` payloads for pickers/searches that only need identity, ownership, or balances; production frontend code no longer calls the heavyweight exact `/clients` list endpoint.
- Scoped payment-plan and trophy-summary lookups to the currently visible client page rather than loading business-wide data for each directory refresh.
- Added active-first Practice loading with exact `/homework/counts`, status filtering, bounded historical loading, and deep-link fallback so old Practice remains reachable without sending thousands of records on every visit.
- Added `/admin/live-summary` and changed the app shell from four independent badge polling requests to one permission-aware summary request while retaining event-driven immediate refreshes.
- Removed the dog-result upcoming-booking N+1 lookup by batching matching dog IDs into one booking query.
- Made independent Action Required count queries concurrent without changing the returned count semantics or permission gates.
- Added targeted indexes for the optimized dog-booking, Practice, waiver/intake, shop-order, and message-thread access paths.
- Added request timing instrumentation with a standard `Server-Timing` header and slow-API logging threshold so future optimization can be driven by measured server latency rather than guesses.
- Added six additive optimization endpoints without removing any Phase 5 route; all existing route URLs remain intact.

### Phase 7 complete

- Split backend Python dependencies into runtime (`requirements.txt`), test (`requirements-test.txt`), and developer (`requirements-dev.txt`) layers; the production image no longer installs unused AI/data-science/lint/test packages.
- Replaced Create React App/CRACO with Vite 8 while preserving the existing React SPA, nginx single-origin `/api` proxy, PWA assets, `@/` alias, Tailwind/PostCSS pipeline, and legacy `REACT_APP_*` build-variable fallback.
- Kept the existing Jest suite as a standalone Jest/Babel/JSDOM test runner so build-tool migration does not simultaneously change test semantics.
- Added GitHub Actions CI gates for frontend Jest + Vite build, backend compile/modernization architecture checks, and the curated clean-database release-critical backend gate against Mongo 7.
- Hardened `update.sh` to fetch and deploy the exact remote `main` commit, refuse tracked local edits, require a verified backup, record current/previous/attempted SHAs, expose `--status`, support `--rollback [SHA]`, and automatically rebuild the previous successful SHA if the new runtime fails startup/health/media verification.
- Added `APP_GIT_SHA` to the backend runtime and `/api/health` response so the running deployment can report the commit it was built from.
- Simulated the hardened update + rollback control flow in a disposable Git repository and verified exact-SHA state transitions in both directions.
- Preserved the complete Phase 6 API route surface: no API methods/paths were added or removed by the infrastructure migration.

**Next:** run the final cumulative release gate on an environment with the full Python/frontend dependency trees, then promote the completed modernization source to GitHub `main` and deploy it as one controlled release.
