import { useState } from "react";

/**
 * Operator + client tutorial center.
 *
 * The screen is role-aware: admins see the current Admin Portal playbook,
 * clients see the current Client Portal walkthrough. Card schema:
 *   - badges[]            ← Beginner / Daily Use / Admin Only / Client-Facing / Setup Only / Coming Soon
 *   - path (optional)     ← "Where to find it" breadcrumb-style string, using CURRENT nav labels
 *   - steps[]
 *   - tip (optional)      ← Pro tip box
 *   - mistake (optional)  ← Common mistake / pitfall box
 *   - related[] (optional)← Links to related tutorials or app pages
 *
 * Content audited against the live app (redesigned Client Portal + Admin
 * Portal, dedicated Shop, Stripe Online payments, Shop pickup workflow,
 * full-page Photography, updated nav) — not against old documentation.
 * Coming-soon features are explicitly labeled — no fake functionality.
 * Search filters across titles, steps, tips, mistakes, and paths.
 */

const ADMIN_QUICK_ACTIONS = [
  { id: "_qa_setup",     label: "First-Time Setup",     icon: "fa-rocket",           target: "getting-started" },
  { id: "_qa_frontdesk", label: "Front Desk Basics",    icon: "fa-cash-register",    target: "front-desk" },
  { id: "_qa_addclient", label: "Add Client & Dog",     icon: "fa-user-plus",        target: "clients-dogs" },
  { id: "_qa_booking",   label: "Create Booking",       icon: "fa-calendar-plus",    target: "bookings-schedule" },
  { id: "_qa_shop",      label: "Manage Shop",          icon: "fa-bag-shopping",     target: "shop-orders" },
  { id: "_qa_photo",     label: "Photography Page",     icon: "fa-camera-retro",     target: "photography-admin" },
  { id: "_qa_finance",   label: "Finance & Payments",   icon: "fa-dollar-sign",      target: "finance" },
  { id: "_qa_vaccines",  label: "Check Vaccines",       icon: "fa-shield-virus",     target: "clients-dogs" },
  { id: "_qa_messages",  label: "Client Messages",      icon: "fa-comments",         target: "messages-admin" },
  { id: "_qa_settings",  label: "Settings Map",         icon: "fa-cog",              target: "settings-help" },
  { id: "_qa_mobile",    label: "Admin on a Phone",     icon: "fa-mobile",           target: "mobile-admin" },
  { id: "_qa_backup",    label: "Backup Data",          icon: "fa-database",         target: "troubleshooting-admin" },
];

const ADMIN_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started — First-Time Setup",
    icon: "fa-rocket",
    color: "text-shPrimary",
    overview: "Do these in order the first time you log in. Each step unlocks the next part of the app.",
    cards: [
      {
        title: "Step 1 — Set your business hours & capacity",
        badges: ["Setup Only", "Admin Only"],
        path: "Settings → Business Operations → Hours & Closures / Capacity & Kennels",
        steps: [
          "Open Settings in the sidebar (System group).",
          "Click the Business Operations category.",
          "Open Hours & Closures — set open/close time per day for each service, plus any planned closures.",
          "Open Capacity & Kennels — set your daily daycare cap and add every kennel/boarding suite with a label.",
          "Save Changes on each subsection.",
        ],
        mistake: "Forgetting weekend hours means clients can't book Saturday/Sunday online even if you're open.",
      },
      {
        title: "Step 2 — Define services, programs & pricing",
        badges: ["Setup Only"],
        path: "Settings → Services & Pricing → Services & Programs",
        steps: [
          "Open Settings → Services & Pricing → Services & Programs.",
          "Review the default Daycare / Boarding / Grooming / Training services and edit base price, duration, description.",
          "Add specialty services if you offer them (private training, bath-only, nail trim, photography sessions).",
          "Toggle Active on/off to control what clients can see and book.",
          "Photography's Sessions & Packages on the client Photography page pull directly from this same catalog — there is no separate photography price list to maintain.",
        ],
        related: ["Settings → Services & Pricing → Credit Packs", "Settings → Services & Pricing → Payment Plans"],
      },
      {
        title: "Step 3 — Lock down vaccines and the waiver",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Clients, Dogs & Compliance",
        steps: [
          "Open Vaccine Requirements — toggle each vaccine you require (Rabies is on by default) and set a warning lead time.",
          "Open Waiver — paste your waiver text and tick Require for booking.",
          "Open Compliance Rules (Operator Quick Controls card) to decide hard-block vs warn-only per vaccine.",
        ],
        tip: "Recommended: hard block for Rabies, warn-only for everything else.",
      },
      {
        title: "Step 4 — Set up email & notifications",
        badges: ["Setup Only"],
        path: "Settings → Email & Notifications",
        steps: [
          "Open Email Designer — set sender name, signature, and tweak wording on any of the email templates.",
          "Open Email Timing & Quiet Hours — set reminder lead time and quiet hours.",
          "Open Email Automation — toggle which automations fire (booking confirmations, reminders, review requests).",
        ],
        mistake: "Skip the Email Health check at your own risk — if the sending domain isn't verified, none of your emails reach clients.",
      },
      {
        title: "Step 5 — Turn on the payment methods you accept",
        badges: ["Setup Only", "Admin Only"],
        path: "Settings → Finance & Bookkeeping → Payment Options",
        steps: [
          "Open Payment Options.",
          "Toggle which methods clients see on booking confirmations and in the portal (Cash, Check, Venmo, PayPal).",
          "Stripe Online payments (card, via the client portal) and the in-house Front Desk register are always available to staff regardless of this toggle — this setting only controls what's shown to clients as informal payment options.",
        ],
      },
      {
        title: "Step 6 — Change your admin password",
        badges: ["Setup Only", "Admin Only"],
        path: "Settings → System & Data → My Account",
        steps: [
          "Open My Account.",
          "Enter the seeded admin password (given on first login).",
          "Choose and save a strong new password.",
        ],
      },
      {
        title: "Step 7 — Install Sit Happens on your devices",
        badges: ["Setup Only", "Daily Use"],
        steps: [
          "Look for the Install App button near the bottom of the sidebar.",
          "Click it — you'll see the native install prompt or a step-by-step modal.",
          "On iPhone: open in Safari, tap Share → Add to Home Screen.",
        ],
        tip: "Install it on your phone, tablet, and the front-desk computer — same data, every device.",
      },
    ],
  },
  {
    id: "daily-ops",
    title: "Daily Operations",
    icon: "fa-sun",
    color: "text-shAccent",
    overview: "The screens you touch every day, in the order most teams use them: Dashboard, Run Sheet, Care Board, Kennel Board, Waitlist, Recurring.",
    cards: [
      {
        title: "Start with the Dashboard",
        badges: ["Daily Use"],
        path: "Sidebar → Dashboard",
        steps: [
          "The hero shows today's date and quick counts: Daycare / Boarding / Training / Grooming / Photography scheduled today.",
          "The Owner Clock card is where you clock in/out and see today's hours.",
          "Today's Sales tile shows net incoming and a one-tap Open Front Desk button.",
          "Needs-Attention style widgets (pending homework, expiring vaccines, new client uploads, quote requests) sit below — click any row to jump straight to it.",
          "The Operational Readiness checklist (top of Dashboard, only shows while incomplete) walks through first-time setup — hours, pricing, vaccines, waiver, staff roles, first backup.",
        ],
      },
      {
        title: "Pull up today's Run Sheet",
        badges: ["Daily Use"],
        path: "Sidebar → Run Sheet",
        steps: [
          "Run Sheet lists every dog scheduled today with feeding/medication notes.",
          "Print it or open it on a tablet at the front desk.",
          "Special diets/medications show as a highlighted pill — don't miss them.",
        ],
      },
      {
        title: "Care Board — feeding & medication tracker",
        badges: ["Daily Use", "All staff"],
        path: "Sidebar → Care Board",
        steps: [
          "Auto-pulls today's feeding + meds for every on-site dog, sorted by time, with status pills: Not due / Due now / Completed / Missed / Skipped.",
          "Tap Complete to log staff initials + an optional note, or Skip with a preset reason.",
          "The schedule auto-seeds from each dog's default feeding/medication plan — edit the dog profile to change the defaults.",
          "Auto-refreshes every 60 seconds so Due now rolls into Missed without a manual refresh.",
        ],
      },
      {
        title: "Kennel Board — where every dog goes",
        badges: ["Daily Use", "Care/Dog perms"],
        path: "Sidebar → Kennel Board",
        steps: [
          "One card per on-site dog, grouped by service (Daycare / Boarding / Training / Grooming / Photography).",
          "Each card has assignment slots — Kennel, Room, Crate, Yard group, Training group — click the card to edit.",
          "Edit the dropdown options via the Labels button (one label per line).",
          "Warning badges fire automatically: vaccine lapsed, overdue medication, do-not-group flag, open incident.",
        ],
      },
      {
        title: "Waitlist + capacity guardrail",
        badges: ["Daily Use"],
        path: "Sidebar → Waitlist",
        steps: [
          "When daycare or boarding is at capacity, drop the client on the waitlist instead of a booking error.",
          "Each entry carries priority, service type, requested date range, and notes.",
          "Status flow: Waiting → Offered → Booked / Declined / Expired / Removed.",
          "Hit Convert to create the real booking — this bypasses the daily cap but still checks vaccines, waiver, and conflicts.",
        ],
      },
      {
        title: "Recurring bookings",
        badges: ["Daily Use"],
        path: "Sidebar → Recurring",
        steps: [
          "Open Recurring → + New Recurring.",
          "Pick client, dog, and the days of week (e.g. every Mon/Wed/Fri).",
          "Set a start date and optional end date — bookings auto-generate from this template.",
        ],
      },
      {
        title: "End of day",
        badges: ["Daily Use"],
        path: "Sidebar → Front Desk / Schedule",
        steps: [
          "Check out every dog that's leaving from Front Desk or the Schedule view.",
          "Confirm the register's expected cash matches the drawer before closing out (see Front Desk section).",
          "Log any incidents from the day before you clock out.",
        ],
      },
    ],
  },
  {
    id: "front-desk",
    title: "Front Desk",
    icon: "fa-cash-register",
    color: "text-shPrimary",
    overview: "One screen for check-in/checkout, taking payment, the cash register, and everything Shop-related that happens at the counter. This is the highest-traffic screen in the app.",
    cards: [
      {
        title: "Check a dog in or out",
        badges: ["Daily Use"],
        path: "Sidebar → Front Desk",
        steps: [
          "Find the booking (search or the day's list) and tap Check In on arrival.",
          "On departure, tap Check Out — this is where the invoice is created and payment is taken.",
          "If the booking has add-ons (bath, nail trim), they're included automatically in the checkout total.",
        ],
      },
      {
        title: "Take payment at checkout",
        badges: ["Daily Use"],
        steps: [
          "Choose the tender: Cash, Card (via Stripe if the client pays online), Check, Venmo/PayPal, or existing account credit.",
          "For cash, enter the amount tendered — the app calculates change due automatically.",
          "A balance can be paid across more than one tender (split payment) if needed.",
          "The receipt/payment record is attached to the client's invoice history automatically — no separate logging step.",
        ],
        mistake: "Don't take cash before the register is opened for the day — the app blocks cash tenders until the drawer session is started, precisely so counted cash never gets double-attributed.",
      },
      {
        title: "Open the register / cash drawer",
        badges: ["Daily Use", "Admin Only"],
        path: "Front Desk → Register status bar",
        steps: [
          "The status bar at the top of Front Desk shows Register: OPEN / NOT_OPEN / CLOSED and Printer status.",
          "Tap Open Drawer to start the day's register session (admin only).",
          "Recent Sales shows every register transaction today with a reprint option.",
          "Manage Products opens the retail catalog (see Shop & Online Orders).",
        ],
        tip: "Open the drawer before the first cash sale of the day — expected-cash reporting depends on it.",
      },
      {
        title: "Online Payments (Stripe)",
        badges: ["Live"],
        path: "Front Desk → Online Payments panel",
        steps: [
          "Any invoice a client pays with a card through their portal shows up here automatically, separate from cash/manual entries.",
          "Use this panel to confirm a payment landed and to see amount, date, and which client/invoice it's tied to.",
          "Refunds on a Stripe payment are issued from this same panel — Front Desk always shows the correct current status, it never needs a manual 'mark as paid' step for online payments.",
        ],
        mistake: "Don't try to refund a Stripe payment through a generic cash-refund flow — always use the Stripe refund action so the client's card is actually credited.",
      },
      {
        title: "Online Orders — Shop pickup workflow",
        badges: ["Live"],
        path: "Front Desk → Online Orders panel",
        steps: [
          "Every Shop order a client pays for online and marks for local pickup lands here with a status: PREPARING, READY FOR PICKUP, COMPLETED, or NEEDS ATTENTION.",
          "A small NEW badge marks orders you haven't opened yet — it's independent of the pickup status itself.",
          "Tap Mark Ready once the order is bagged and waiting at the counter — this is what flips the client's own order status to Ready for Pickup.",
          "Tap Mark Picked Up once the client has it in hand — this is the final, completed state.",
          "If an order shows NEEDS ATTENTION (usually a payment or inventory hiccup), open it and use Retry Fulfillment once the underlying issue is resolved.",
        ],
        mistake: "The old internal \"fulfilled\" flag is not the customer-facing status — always read and act on the four pickup states above, not a raw fulfilled/unfulfilled toggle.",
      },
    ],
  },
  {
    id: "bookings-schedule",
    title: "Bookings & Schedule",
    icon: "fa-calendar-check",
    color: "text-shPrimary",
    overview: "Create, edit, cancel, and read the schedule, plus how capacity warnings work.",
    cards: [
      {
        title: "Create a booking from the admin side",
        badges: ["Daily Use"],
        path: "Sidebar → Bookings → New Booking",
        steps: [
          "Click New Booking.",
          "Pick the client, then their dog (or dogs — multi-dog bookings can be grouped together).",
          "Pick the service (daycare / boarding / training / grooming / photography) and the date (boarding asks for start and end date).",
          "Add any add-ons and save — a confirmation email sends automatically.",
        ],
      },
      {
        title: "Approve pending requests",
        badges: ["Daily Use"],
        path: "Sidebar → Bookings",
        steps: [
          "Filter by Status = Pending.",
          "Open each one, confirm the dog's vaccines are current, then Approve or Reject.",
          "Approved bookings auto-send a confirmation email to the client.",
        ],
      },
      {
        title: "Edit, reschedule, or cancel a booking",
        badges: ["Daily Use"],
        path: "Sidebar → Bookings → open one",
        steps: [
          "Open the booking row and click Edit to change date, time, or service — the client is notified of the change.",
          "Click Cancel to cancel — pick a reason; any cancellation fee is calculated from your Money Rules and the client is emailed.",
        ],
        mistake: "You can't edit a checked-out booking — once it's a closed receipt, use the refund/reversal flow from Front Desk instead.",
      },
      {
        title: "Read the Schedule view",
        badges: ["Daily Use"],
        path: "Sidebar → Schedule",
        steps: [
          "Switch between Day / Week / Month at the top.",
          "Colored dots represent each booking by service — click any booking for the detail card.",
          "Capacity ticks fill up as the day books; once you hit your daycare cap, new same-day requests get blocked (admins can still force-book with a confirm prompt).",
        ],
      },
    ],
  },
  {
    id: "clients-dogs",
    title: "Clients & Dogs",
    icon: "fa-paw",
    color: "text-shSecondary",
    overview: "Adding, updating, and looking up the families and dogs you work with, plus compliance and safety.",
    cards: [
      {
        title: "Add a client and a dog",
        badges: ["Daily Use"],
        path: "Sidebar → Clients → Add Client · Sidebar → Dogs → Add Dog",
        steps: [
          "From Clients, click Add Client — name, email, phone, address, emergency contact. Tick Create portal login to let them book online.",
          "From Dogs, click Add Dog — pick the owner, then breed/sex/birthday, vaccine expiries, feeding/meds, and vet info.",
        ],
        tip: "Clients can also self-register from your portal link — their record auto-creates and appears in Clients.",
      },
      {
        title: "Vaccines, waiver & compliance",
        badges: ["Daily Use"],
        path: "Sidebar → Dogs → open dog → Vaccines",
        steps: [
          "Enter the expiry date for each required vaccine, optionally attach the vet certificate.",
          "Dogs without a current waiver are flagged on the Dashboard — message the client a re-sign link.",
          "Compliance behavior (hard block / warn-only / grace period) is configured in Settings → Clients, Dogs & Compliance → Compliance Rules.",
        ],
      },
      {
        title: "Incidents & safety flags",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Incidents · Per-dog flags on Dogs cards",
        steps: [
          "Log an incident with severity (Low/Medium/High/Critical) and type (bite, fight, injury, escape attempt, resource guarding, etc.).",
          "Safety Flags on each dog card get auto-suggested from incident history and intake answers — click a suggested flag to apply it instantly.",
        ],
      },
      {
        title: "Duplicate Check",
        badges: ["Live", "Admin Only"],
        path: "Sidebar → Duplicate Check",
        steps: [
          "Preview-only scan for duplicate client/dog records before credits, bookings, vaccines, or payments get split across two accounts.",
          "Nothing is merged automatically — it's a safe list to review before you manually consolidate anything.",
        ],
      },
      {
        title: "View a client's full history",
        badges: ["Daily Use"],
        path: "Sidebar → Clients → open a client",
        steps: [
          "Every booking, payment, credit pack, waiver signature, and trophy is timestamped on the client's page.",
          "Communication Log at the bottom captures every call, text, email, or in-person note tied to that family.",
        ],
      },
    ],
  },
  {
    id: "shop-orders",
    title: "Shop & Online Orders",
    icon: "fa-bag-shopping",
    color: "text-shAccent",
    overview: "The Shop is the client-facing storefront for retail products, credit packs, and training programs. Admin manages the catalog here; Front Desk handles the pickup side (see Front Desk section).",
    cards: [
      {
        title: "Manage products",
        badges: ["Live", "Admin Only"],
        path: "Front Desk → Manage Products",
        steps: [
          "Add/edit retail products: name, price, photo, stock tracking (on/off), and low-stock threshold.",
          "Toggle Online Visible to control whether a product appears in the client-facing Shop, independent of whether it's sellable at the register.",
          "Stock automatically decrements on a completed sale (register or online) and restores on a void/refund.",
        ],
      },
      {
        title: "Credit packs & training programs",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Services & Pricing → Credit Packs · Sidebar → Pipeline (programs)",
        steps: [
          "Credit Packs: set service, quantity, and price — mark Online Visible to sell it through the Shop.",
          "Training Programs: the same Online Visible toggle controls whether a program shows in the Shop as a purchasable item.",
          "When a client buys a credit pack or program through the Shop, the credits/enrollment are applied automatically the moment payment clears — no manual step needed.",
        ],
      },
      {
        title: "Understand the Shop order lifecycle",
        badges: ["Live"],
        steps: [
          "A client adds products/packs/programs to their cart and checks out with Stripe.",
          "Digital items (credits, program enrollment) apply automatically on payment success.",
          "Physical items requiring pickup flow into Front Desk → Online Orders with the PREPARING → READY FOR PICKUP → COMPLETED lifecycle (full detail in the Front Desk section).",
        ],
        related: ["Front Desk → Online Orders panel"],
      },
      {
        title: "Apparel / print-on-demand",
        badges: ["Reference"],
        steps: [
          "Branded apparel (t-shirts, hoodies, etc.) is handled through your external Shopify/Printify storefront if you've linked one — it is not built into this app's Shop directly.",
          "If you have a print-on-demand link configured, add it as a Portal Link so clients can find it from the portal.",
        ],
      },
    ],
  },
  {
    id: "photography-admin",
    title: "Photography",
    icon: "fa-camera-retro",
    color: "text-shAccent",
    overview: "Photography is a full, dedicated page in the client portal — not a small popup. Admin manages the featured gallery and headline; session pricing reuses your existing Services & Programs catalog.",
    cards: [
      {
        title: "Manage the Featured Photos gallery",
        badges: ["Live", "Admin Only"],
        path: "Settings → Marketing & Branding → Photography Page",
        steps: [
          "Upload photos to the Featured Photos gallery — these are what clients see in the lightbox gallery on their Photography page.",
          "Reorder photos with the up/down controls, feature or hide individual photos, or delete one.",
          "Edit the page headline shown at the top of the client Photography page.",
        ],
      },
      {
        title: "Sessions & Packages come from your Services catalog",
        badges: ["Live", "Reference"],
        path: "Settings → Services & Pricing → Services & Programs",
        steps: [
          "The Photography page's Sessions & Packages section lists whatever services you've tagged as Photography in Services & Programs — there is no separate photography price list.",
          "Add, edit, or retire a photography package the same way you manage any other service.",
        ],
      },
      {
        title: "Pixieset delivery link",
        badges: ["Live", "Client-Facing"],
        path: "Settings → Marketing & Branding → Portal Links",
        steps: [
          "The client's Photography page has an 'Already Had a Session?' section that points to your Pixieset (or other delivery platform) gallery link.",
          "Set that link under Portal Links so it stays current — this is the same mechanism as your other outbound portal links (Instagram, Google Reviews, etc.).",
        ],
        mistake: "We deliberately did not build a direct Pixieset API integration or an in-app photo-delivery platform — delivered galleries live on Pixieset, and the portal only links out to it.",
      },
    ],
  },
  {
    id: "finance",
    title: "Payments & Finance",
    icon: "fa-dollar-sign",
    color: "text-shPrimary",
    overview: "Pricing, packs, plans, the P&L, and how cash-basis revenue is tracked across every tender type.",
    cards: [
      {
        title: "Track income",
        badges: ["Daily Use", "Admin Only"],
        path: "Sidebar → Finance",
        steps: [
          "Finance has KPI tiles: Completed / Paid / Unpaid / Booked Upcoming, with a breakdown by service.",
          "Switch date ranges (This Week / Month / Quarter / YTD) and drill into any day.",
          "Export CSV, download or email the P&L PDF from the toolbar at the top.",
        ],
      },
      {
        title: "Stripe Online payments — day to day",
        badges: ["Live"],
        path: "Sidebar → Finance · Front Desk → Online Payments",
        steps: [
          "Stripe payments show up in your income totals exactly like any other tender, tagged so you can always tell a card-online payment apart from cash/manual.",
          "To refund a Stripe payment, use the refund action inside its own record (Front Desk → Online Payments, or the invoice itself) — this is the only path that actually returns money to the client's card.",
          "Distinguishing Stripe from cash/manual: look at the tender/method column on any transaction — Stripe-paid rows are labeled distinctly from Cash/Check/Venmo/PayPal rows.",
        ],
        mistake: "Never try to reverse a Stripe charge by logging a manual cash refund — it won't touch the card and will make your books wrong.",
      },
      {
        title: "Credit Audit (reconciliation)",
        badges: ["Live", "Admin Only"],
        path: "Sidebar → Credit Audit",
        steps: [
          "Cross-checks client credit balances against the bookings/purchases that should have produced them, surfacing anything that looks off.",
          "Use it after a bulk import or a suspected data issue — not a routine daily task.",
        ],
      },
      {
        title: "Payment plans for big-ticket purchases",
        badges: ["Admin Only"],
        path: "Sidebar → Clients → open client → Payment Plans",
        steps: [
          "Open the client's profile → New Payment Plan.",
          "Pick the service/program and set the installment schedule.",
          "Revenue posts to the P&L only as each installment is marked Paid.",
        ],
      },
      {
        title: "A note on payment methods you'll still see referenced",
        badges: ["Reference"],
        steps: [
          "Settings → Finance & Bookkeeping → Payment Options still lists a Clover toggle from an earlier payment-processor evaluation.",
          "Clover is not the active payment path — Stripe (online) plus cash/manual entry through the Front Desk register is. If you see a Clover option anywhere, treat it as legacy and do not configure it; flag it to support if it's confusing.",
        ],
      },
    ],
  },
  {
    id: "messages-admin",
    title: "Messages & Communications",
    icon: "fa-comments",
    color: "text-shSecondary",
    overview: "Two tools for staying in touch with clients — Client Messages for one-to-one back-and-forth, Bulk Email for one-to-many announcements — plus the audit trail behind every send.",
    cards: [
      {
        title: "Client Messages (direct inbox)",
        badges: ["Live", "Permission-gated"],
        path: "Sidebar → Client Messages",
        steps: [
          "A unified inbox of every conversation a client starts from their portal — filter by Open / Pending / Resolved, or toggle Unread only.",
          "Click a thread, type a reply, and hit Reply — by default it also emails the client (uncheck to keep it in-app only).",
          "Internal Notes at the bottom of a thread are visible to staff only, never to the client.",
          "The sidebar shows an orange unread badge that refreshes every 60 seconds.",
        ],
      },
      {
        title: "Bulk Client Email",
        badges: ["Live", "Admin Only"],
        path: "Sidebar → Bulk Email",
        steps: [
          "Pick a recipient slice using filter chips (Active clients, has upcoming bookings, missing vaccines, etc.) — a live recipient counter updates as you adjust.",
          "Start from a template or write your own, use merge tags for personalization, and Send Test before sending to everyone.",
          "Every send is logged on each recipient's Communication timeline and in the Bulk Email History tab.",
        ],
      },
      {
        title: "Announcements banner",
        badges: ["Live", "Client-Facing"],
        path: "Sidebar → Announcements",
        steps: [
          "Post a banner clients see at the top of their portal Home — set title, message, style (info/success/warning/urgent), and a date window.",
        ],
      },
      {
        title: "Audit Log",
        badges: ["Live", "Admin/Manager"],
        path: "Sidebar → Audit Log",
        steps: [
          "Every staff/admin write is captured automatically — filter by group (Bookings, Dogs, Clients, Money, Settings, etc.), user, or free text.",
          "Click a row to expand the payload — passwords, tokens, and card numbers are auto-redacted.",
        ],
      },
    ],
  },
  {
    id: "training-homework",
    title: "Training Programs & Homework",
    icon: "fa-graduation-cap",
    color: "text-purple-300",
    overview: "Sell training programs, move clients through stages, assign and track homework.",
    cards: [
      {
        title: "Pipeline — move a training client through stages",
        badges: ["Daily Use", "Admin Only"],
        path: "Sidebar → Pipeline",
        steps: [
          "+ New → pick client, dog, and training program, stage starts at Intake.",
          "Drag the card through Assessment → Active → Graduating → Graduated — each move is timestamped.",
        ],
      },
      {
        title: "Assign and track homework",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Homework",
        steps: [
          "+ New Homework → pick client/dog, choose a template or write custom tasks, set a due date.",
          "The client sees it in their portal immediately and can check items off; you can mark it Complete when you agree it's done.",
        ],
      },
    ],
  },
  {
    id: "staff",
    title: "Staff & Permissions",
    icon: "fa-users-gear",
    color: "text-shSecondary",
    overview: "Team accounts, roles, and what each role can see and do.",
    cards: [
      {
        title: "Add and manage staff",
        badges: ["Admin Only"],
        path: "Sidebar → Staff",
        steps: [
          "Add a new staff account, set their role, and (if enabled) their staff-portal access.",
          "New staff default to Read-only so a brand-new account can't accidentally change anything destructive.",
        ],
      },
      {
        title: "Roles & permission matrix",
        badges: ["Admin Only"],
        path: "Sidebar → Staff (Roles panel) · Settings → Staff & Admin → Permission Matrix",
        steps: [
          "Roles: Owner / Manager / Trainer / Daycare Staff / Boarding Staff / Front Desk / Read-only.",
          "The permission matrix is a full grid of role × permission — toggle a checkbox to grant/revoke, changes apply on next request.",
          "The sidebar automatically hides items a staffer doesn't have permission to use.",
        ],
      },
    ],
  },
  {
    id: "settings-help",
    title: "Settings",
    icon: "fa-cog",
    color: "text-shSecondary",
    overview: "Settings is organized into nine categories. Use the search box inside Settings to jump straight to a subsection.",
    cards: [
      {
        title: "Business Operations",
        badges: ["Reference"],
        steps: [
          "Feature Visibility (turn major features on/off app-wide), Client Portal Controls, Booking Flow Controls, Dashboard Widget Controls, Operator Quick Controls, Hours & Closures, Capacity & Kennels, Booking Guardrails.",
        ],
      },
      {
        title: "Services & Pricing",
        badges: ["Reference"],
        steps: [
          "Services & Programs, Credit Packs, Payment Plans, Money Rules (fees/tipping/deposits), Holiday & Peak-Season Pricing.",
        ],
      },
      {
        title: "Clients, Dogs & Compliance",
        badges: ["Reference"],
        steps: [
          "Vaccine Requirements, Waiver, Compliance Rules, Training Commands, plus links out to Intake Forms and Incidents & Safety Flags.",
        ],
      },
      {
        title: "Email & Notifications",
        badges: ["Reference"],
        steps: [
          "Email Designer, Email Automation, Email Timing & Quiet Hours. Text Message Settings and Marketing Emails are listed but are Coming Soon — not live yet.",
        ],
      },
      {
        title: "Marketing & Branding",
        badges: ["Reference"],
        steps: [
          "Brand & Theme, Portal & UI Polish, Public Service Info, Mood Tags, Portal Links, Photography Page, First Visit Card, Review Links, Marketing QR Codes.",
        ],
      },
      {
        title: "Staff & Admin",
        badges: ["Reference"],
        steps: [
          "Links out to Manage Staff and Roles & Permissions (both live on the Staff screen), plus the Permission Matrix. Payroll Settings is Coming Soon.",
        ],
      },
      {
        title: "Finance & Bookkeeping",
        badges: ["Reference"],
        steps: [
          "Links out to the Finance screen, Finance Defaults (fiscal year, export format, mileage rate), and Payment Options (which methods clients see).",
          "Payment Processors and Refund Rules are listed as Coming Soon in this category — day-to-day Stripe operations happen on the Finance and Front Desk screens today, not here.",
        ],
      },
      {
        title: "Rewards & Referrals",
        badges: ["Reference"],
        steps: [
          "Links out to Rewards Center and Trophy Wall, plus Loyalty Tiers, Streaks & Referral Rules configuration.",
        ],
      },
      {
        title: "System & Data",
        badges: ["Reference"],
        steps: [
          "My Account, Backup & Restore, Server Errors, Data Export (CSV), plus links out to Duplicate Check and Audit Log.",
        ],
      },
    ],
  },
  {
    id: "mobile-admin",
    title: "Using Admin on a Phone",
    icon: "fa-mobile",
    color: "text-shSecondary",
    overview: "The Admin Portal is fully responsive. On a phone, the desktop sidebar disappears and is replaced by a compact header and a full-screen navigation drawer.",
    cards: [
      {
        title: "Mobile header & navigation",
        badges: ["Live"],
        steps: [
          "The top bar shows your logo, the current page title, and a hamburger menu button.",
          "Tap the hamburger to open the full navigation drawer — every destination is grouped exactly like the desktop sidebar (Operations / Clients / Business / Team / System), with large tap targets.",
          "The drawer also has your text-size control, the Install App button, and Sign out.",
        ],
      },
      {
        title: "Dense screens become stacked cards",
        badges: ["Live"],
        steps: [
          "Desktop tables (Clients, Dogs, Bookings, Audit Log, etc.) automatically switch to stacked mobile cards on a phone — you'll see the same information, just rearranged, never a sideways-scrolling spreadsheet.",
          "Front Desk's toolbar buttons (Open Drawer / Recent Sales / Manage Products) wrap onto their own rows on narrow screens instead of getting clipped.",
        ],
      },
      {
        title: "What to expect on Dashboard, Front Desk, Finance",
        badges: ["Live"],
        steps: [
          "Dashboard: hero and stat tiles stack in a single column.",
          "Front Desk: register/printer status stacks above the action buttons; cart and product grid stack vertically.",
          "Finance: KPI tiles wrap into a 2-column grid; the transaction table becomes a stacked list.",
        ],
      },
    ],
  },
  {
    id: "troubleshooting-admin",
    title: "Troubleshooting & Backups",
    icon: "fa-shield-halved",
    color: "text-shSecondary",
    overview: "Keep your data safe and know what to do when something looks wrong.",
    cards: [
      {
        title: "Take a manual backup",
        badges: ["Admin Only"],
        path: "Settings → System & Data → Backup & Restore",
        steps: [
          "Click Snapshot Now, wait for the downloadable file, and save it somewhere outside the server.",
        ],
        tip: "Do this before any big configuration change — restoring is a 3-click rollback.",
      },
      {
        title: "An email isn't arriving",
        badges: ["Admin Only"],
        path: "Settings → Email & Notifications → Email Designer",
        steps: [
          "Check the Email Health status pill at the top of Email Designer — green means the sending domain is verified and healthy.",
          "If it's red, your sender domain needs to be verified before any client email will deliver.",
        ],
      },
      {
        title: "Check the server error log",
        badges: ["Admin Only"],
        path: "Settings → System & Data → Server Errors",
        steps: [
          "Latest errors appear at the top — copy the message if you need to contact support.",
        ],
      },
      {
        title: "Export your data",
        badges: ["Live", "Admin Only"],
        path: "Settings → System & Data → Data Export",
        steps: [
          "One-click CSV downloads for Clients, Dogs, Bookings, Waitlist, Intake, Incidents, Vaccines, Income, Communications, Staff Time-Clock, and more.",
        ],
      },
    ],
  },
];

const CLIENT_QUICK_ACTIONS = [
  { id: "_cqa_login",    label: "Log In",           icon: "fa-right-to-bracket", target: "getting-started" },
  { id: "_cqa_book",     label: "Book a Visit",      icon: "fa-calendar-plus",    target: "booking" },
  { id: "_cqa_shop",     label: "Shop",              icon: "fa-bag-shopping",     target: "shop" },
  { id: "_cqa_photo",    label: "Photography",       icon: "fa-camera-retro",     target: "photography" },
  { id: "_cqa_dog",      label: "My Dogs & Records", icon: "fa-paw",              target: "dogs-records" },
  { id: "_cqa_credits",  label: "Credits & Payments",icon: "fa-wallet",           target: "credits-payments" },
  { id: "_cqa_mobile",   label: "Install on Phone",  icon: "fa-mobile",           target: "mobile-app" },
];

const CLIENT_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: "fa-rocket",
    color: "text-shPrimary",
    overview: "Open the portal, log in, complete first-time setup, and find your way around Home.",
    cards: [
      {
        title: "Log in and complete first-time setup",
        badges: ["Required"],
        steps: [
          "Open the portal link your business sent you and log in with the email/password on file.",
          "The first time you log in, an Action Needed banner walks you through: Your Information, Dog Information, Emergency Contact, Vaccine Records, and the Waiver.",
          "Any service-specific intake form your business assigns (boarding/daycare/training) also appears here — fill it out before that service can be booked.",
          "Booking unlocks automatically the moment every step is complete — no refresh needed.",
        ],
        tip: "Forgot your password? Tap Forgot Password on the login screen — you'll get a reset link by email (valid 24 hours).",
      },
      {
        title: "What's on Home",
        badges: ["Beginner"],
        steps: [
          "Three quick-action cards at the top: Book Now, Shop, and (if your business offers it) Photography.",
          "An announcement banner from your business, if one is posted.",
          "An Action Needed card if any setup step is still incomplete.",
          "A contextual next-step banner (e.g. \"Add your dog\") when something's missing.",
          "My Dogs, your upcoming bookings, credits, and Quick Links further down the page.",
        ],
      },
    ],
  },
  {
    id: "booking",
    title: "Booking",
    icon: "fa-calendar-plus",
    color: "text-shAccent",
    overview: "Request daycare, boarding, training, grooming, or a photography session.",
    cards: [
      {
        title: "Book a service",
        badges: ["Beginner"],
        steps: [
          "Tap the Book Now card on Home (or Book in the sidebar/bottom nav).",
          "Pick the service, the dog (or dogs), the date, and any add-ons.",
          "Submit — your business is notified and the request shows up under My Bookings as Pending.",
        ],
      },
      {
        title: "What happens after you submit",
        badges: ["Beginner"],
        steps: [
          "Your business approves or rejects the request — you'll get an email either way.",
          "Approved bookings appear under Upcoming on Home.",
          "Some businesses instantly confirm certain services instead of requiring manual approval — if that applies to you, you'll see the booking confirm immediately.",
        ],
      },
      {
        title: "Before you can book",
        badges: ["Beginner"],
        steps: [
          "A missing vaccine, an unsigned waiver, or an incomplete profile/dog/emergency-contact section will block a new booking — the portal tells you exactly which one.",
          "Fix the flagged item (see Dogs & Records) and the booking goes through.",
        ],
      },
      {
        title: "Cancel or request a reschedule",
        badges: ["Beginner"],
        path: "Portal → Upcoming → open a booking",
        steps: [
          "Open the upcoming booking and tap Cancel or Request Reschedule.",
          "Cancellations may carry a fee depending on how close to the date you are — your business sets these rules.",
        ],
      },
    ],
  },
  {
    id: "shop",
    title: "Shop",
    icon: "fa-bag-shopping",
    color: "text-shPrimary",
    overview: "A dedicated Shop for retail products, credit packs, and training programs — separate from booking a service.",
    cards: [
      {
        title: "Browse and buy",
        badges: ["Beginner"],
        path: "Portal → Shop",
        steps: [
          "Open Shop from the sidebar (desktop) or the bottom nav (mobile).",
          "Browse Products, Credit Packs, and Training Programs, and add anything to your cart.",
          "Check out securely with a card through Stripe.",
        ],
      },
      {
        title: "Credits and programs apply automatically",
        badges: ["Beginner"],
        steps: [
          "Buying a credit pack adds those credits to your account the moment payment clears — no waiting on staff to manually apply it.",
          "Buying a training program enrolls you in that program the same way.",
        ],
      },
      {
        title: "Local pickup items",
        badges: ["Beginner"],
        steps: [
          "Physical products you buy for pickup move through four stages: Preparing → Ready for Pickup → Completed. If something needs attention (a payment or stock issue), it shows Needs Attention and your business will follow up.",
          "You'll get an email when your order is marked Ready for Pickup.",
        ],
      },
      {
        title: "Apparel and branded merch",
        badges: ["Reference"],
        steps: [
          "Branded apparel may be sold through an external Shopify/Printify store linked from your business's portal, rather than inside this Shop directly — look for that link on the portal if your business offers it.",
        ],
      },
    ],
  },
  {
    id: "photography",
    title: "Photography",
    icon: "fa-camera-retro",
    color: "text-shAccent",
    overview: "Photography is its own full page — a gallery, a way to book a session, and a link to your delivered photos.",
    cards: [
      {
        title: "The Photography page",
        badges: ["Beginner"],
        path: "Portal → Photography",
        steps: [
          "Open Photography from the sidebar (desktop) or the Photos icon on the bottom nav (mobile, if your business offers photography).",
          "Browse the Featured Photos gallery — tap any photo to open it full-screen and swipe through the set.",
          "Sessions & Packages lists the photography options your business offers, with pricing — tap Book a Session to start a booking for the one you want.",
        ],
      },
      {
        title: "Already had a session?",
        badges: ["Beginner"],
        steps: [
          "The \"Already Had a Session?\" section at the bottom links out to your business's Pixieset (or similar) gallery — that's where your actual delivered, downloadable photos live.",
          "The portal's Featured Photos gallery is a showcase of great shots, not your personal delivered gallery — go to the Pixieset link for the photos from your own session.",
        ],
      },
    ],
  },
  {
    id: "dogs-records",
    title: "Dogs & Records",
    icon: "fa-paw",
    color: "text-shPrimary",
    overview: "Add your dog, keep vaccine records current, sign the waiver, and see training progress.",
    cards: [
      {
        title: "Add or update a dog",
        badges: ["Beginner"],
        path: "Portal → My Dogs",
        steps: [
          "Open My Dogs → + Add Dog. Enter name, breed, sex, birthday, and fixed/intact status.",
          "Tap a dog to update any field, or add notes for trainers/daycare staff to see.",
        ],
      },
      {
        title: "Vaccines and the waiver",
        badges: ["Beginner"],
        path: "Portal → My Dogs → open dog → Vaccines",
        steps: [
          "Open the dog's Vaccines tab — required vaccines and their expiry dates are listed; expiring/expired ones show in red.",
          "Tap Update to enter a new expiry date and upload the certificate (photo or PDF).",
          "Sign or review the waiver from the Waiver page — some businesses require a yearly re-sign, and you'll be prompted automatically.",
        ],
      },
      {
        title: "Training progress",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "If your dog is in an active training program, Training Progress on Home shows goals, completed skills, and files from your trainer.",
          "Assigned homework appears with a checkbox — tick items off as you practice at home so your trainer can see progress.",
        ],
      },
    ],
  },
  {
    id: "credits-payments",
    title: "Credits & Payments",
    icon: "fa-wallet",
    color: "text-shSecondary",
    overview: "Where to see your credit balance, buy more, and review what you've paid.",
    cards: [
      {
        title: "View your credits",
        badges: ["Beginner"],
        path: "Portal → Home → Credits card",
        steps: [
          "The Credits card on Home shows your remaining balance for each credit type (daycare, training, boarding).",
          "Grooming and one-off services are paid at the time of the visit, not from a credit pack.",
        ],
      },
      {
        title: "Buy more credits",
        badges: ["Beginner"],
        steps: [
          "Tap Buy More Credits on the Credits card, or the orange \"Need more credits?\" prompt when you're running low — both take you straight to the Shop, filtered to credit packs.",
        ],
      },
      {
        title: "Payments, invoices & payment plans",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Payments/Invoices shows what you've paid, including anything paid online with a card.",
          "If your business set up a payment plan for you (e.g. an 8-week training program), it shows each installment, whether it's Due or Paid, and the due date.",
        ],
        mistake: "The portal only shows your own balances and receipts — it never shows your business's internal bookkeeping, staff notes, or other clients' information.",
      },
    ],
  },
  {
    id: "messages",
    title: "Messages",
    icon: "fa-comments",
    color: "text-shSecondary",
    overview: "A direct line to your business's team — like a mini inbox.",
    cards: [
      {
        title: "Send and read messages",
        badges: ["Beginner"],
        steps: [
          "Tap the Messages button at the top of the portal (desktop header or mobile bottom nav / More menu).",
          "Hit New Message, pick a topic (Booking / Vaccines / Payments / Other) and write your message.",
          "When your business replies, the Messages button shows an orange unread count — tap it, open the thread, and reply from the bottom.",
        ],
        tip: "A resolved thread automatically re-opens if you reply again — no need to start a new conversation.",
      },
    ],
  },
  {
    id: "rewards",
    title: "Rewards & Referrals",
    icon: "fa-gift",
    color: "text-shAccent",
    overview: "Trophies for your dog and a referral program, if your business has them turned on.",
    cards: [
      {
        title: "Trophies",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Trophies your dog has earned show on their profile and in the Rewards section of Home.",
        ],
      },
      {
        title: "Refer a friend",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Open Refer a Friend from Quick Links (desktop sidebar) or the More menu (mobile).",
          "Share your referral code — when a new client signs up and books using it, you get the reward your business offers (commonly a free daycare day).",
        ],
      },
    ],
  },
  {
    id: "mobile-app",
    title: "Using Sit Happens on Your Phone",
    icon: "fa-mobile",
    color: "text-shSecondary",
    overview: "The portal works like a native app on your phone, with a bottom navigation bar instead of the desktop sidebar.",
    cards: [
      {
        title: "Mobile navigation",
        badges: ["Beginner"],
        steps: [
          "On a phone, the bottom bar has: Home, Book, Shop, Photos (if your business offers photography), and More.",
          "More opens a sheet with My Dogs, Payments, Credits, Rewards, Refer a Friend, and Help.",
          "The desktop sidebar (with Home/Book/Shop/Photography/Messages listed vertically) only appears on larger screens — on a phone, use the bottom bar and More sheet instead.",
        ],
      },
      {
        title: "Install it on your home screen",
        badges: ["Beginner"],
        steps: [
          "iPhone: open the portal in Safari, tap Share, then Add to Home Screen.",
          "Android: open the portal in Chrome, tap the three-dot menu, then Install app (or Add to Home Screen).",
          "Once installed, it opens in its own window with no browser address bar and updates automatically.",
        ],
      },
    ],
  },
];

export default function Tutorials({ role = "admin" }) {
  const sections = role === "client" ? CLIENT_SECTIONS : ADMIN_SECTIONS;
  const quickActions = role === "client" ? CLIENT_QUICK_ACTIONS : ADMIN_QUICK_ACTIONS;
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(sections[0]?.id || "");

  const matches = (c) => {
    const haystack = [
      c.title,
      c.tip || "",
      c.mistake || "",
      c.path || "",
      (c.badges || []).join(" "),
      (c.steps || []).join(" "),
      (c.related || []).join(" "),
    ].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase());
  };

  const filtered = !query.trim()
    ? sections
    : sections
        .map((s) => ({ ...s, cards: s.cards.filter(matches) }))
        .filter((s) => s.cards.length > 0);

  const printCurrent = () => {
    document.body.classList.add("tutorials-printing");
    setTimeout(() => { window.print(); document.body.classList.remove("tutorials-printing"); }, 50);
  };
  const printAll = () => {
    document.body.classList.add("tutorials-printing", "tutorials-print-all");
    setTimeout(() => { window.print(); document.body.classList.remove("tutorials-printing", "tutorials-print-all"); }, 50);
  };

  return (
    <div className="space-y-6 animate-slide-in tutorials-root" data-testid="tutorials-screen" data-role={role}>
      <style>{`
        @media print {
          body.tutorials-printing aside,
          body.tutorials-printing header,
          body.tutorials-printing [data-testid="portal-tutorials-overlay"] > header,
          body.tutorials-printing .tutorials-no-print,
          body.tutorials-printing #emergent-badge { display: none !important; }
          body.tutorials-printing { background: #ffffff !important; }
          body.tutorials-printing .tutorials-root,
          body.tutorials-printing .tutorials-root * {
            color: #111 !important; background: #ffffff !important;
            box-shadow: none !important; border-color: #d4d4d4 !important;
          }
          body.tutorials-printing .tutorials-root h3,
          body.tutorials-printing .tutorials-root h4,
          body.tutorials-printing .tutorials-root h5 { color: #000 !important; }
          body.tutorials-printing .tutorials-root .tip-box {
            background: #fff8e8 !important; border-color: #f0c000 !important; color: #5a4500 !important;
          }
          body.tutorials-printing .tutorials-root .mistake-box {
            background: #fdebeb !important; border-color: #c44 !important; color: #722 !important;
          }
          body.tutorials-printing .tutorials-root .tip-box *,
          body.tutorials-printing .tutorials-root .mistake-box * { color: inherit !important; }
          body.tutorials-printing .tutorials-root .grid { display: block !important; }
          body.tutorials-printing .tutorials-root .tutorial-card {
            page-break-inside: avoid; margin-bottom: 12px;
            border: 1px solid #d4d4d4 !important; padding: 14px !important;
          }
          body.tutorials-printing .tutorials-root .tutorial-section {
            page-break-inside: avoid; margin-bottom: 24px;
          }
          body.tutorials-printing.tutorials-print-all .tutorial-section.print-hidden { display: block !important; }
        }
      `}</style>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 tutorials-no-print">
        <div>
          <h3 className="text-xl font-black text-shText uppercase italic tracking-tight">
            <i className="fas fa-circle-question text-shPrimary mr-2" />
            {role === "client" ? "Client Portal Tutorial" : "How To Use Sit Happens"}
          </h3>
          <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest mt-1">
            {role === "client"
              ? "How clients book, manage dogs, view homework, and keep records updated"
              : "Operator tutorial center — learn the daily workflow step by step"}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative w-full sm:w-64">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-shTextMuted text-[15px]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tutorials…"
              data-testid="tutorials-search"
              className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded-lg pl-9 pr-3 py-2 text-shText text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={printCurrent} data-testid="tutorials-print-current"
                    title="Print only the section you're looking at"
                    className="bg-shSecondary/15 text-shSecondary px-4 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest hover:bg-shSecondary/25 flex items-center gap-2">
              <i className="fas fa-print" /><span className="hidden sm:inline">Print Page</span>
            </button>
            <button onClick={printAll} data-testid="tutorials-print-all"
                    title="Print the full guide (all sections)"
                    className="bg-shPrimary/15 text-shPrimary px-4 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest hover:bg-shPrimary/25 flex items-center gap-2">
              <i className="fas fa-file-pdf" /><span className="hidden sm:inline">Print All</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick action cards */}
      <div className="tutorials-no-print">
        <p className="text-[11px] font-black uppercase tracking-[0.25em] text-shTextMuted mb-2">Quick Jumps</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {quickActions.map(qa => (
            <button
              key={qa.id}
              onClick={() => { setQuery(""); setOpenId(qa.target); }}
              data-testid={`tutorials-quick-${qa.id}`}
              className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shSecondary/60 hover:bg-[var(--sh-card-base)]/50 rounded-lg p-3 text-left transition flex items-center gap-2.5"
            >
              <i className={`fas ${qa.icon} text-shSecondary text-[14px] w-4`} />
              <span className="text-[12px] font-black uppercase tracking-widest text-shText leading-tight">{qa.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Section chip nav */}
      <div className="flex flex-wrap gap-2 tutorials-no-print">
        {filtered.map((s) => (
          <button
            key={s.id}
            onClick={() => setOpenId(s.id)}
            data-testid={`tutorial-chip-${s.id}`}
            className={`px-4 py-2 rounded-lg text-[15px] font-black uppercase tracking-widest border transition ${
              openId === s.id
                ? "bg-[var(--sh-card-base)] border-shSecondary text-shSecondary"
                : "bg-[var(--sh-card-base)]/40 border-shBorder text-shTextMuted hover:border-shSecondary/40"
            }`}
          >
            <i className={`fas ${s.icon} ${s.color} mr-2`} />{s.title}
          </button>
        ))}
      </div>

      {/* Section cards */}
      <div className="space-y-6">
        {filtered.map((s) => {
          const isActive = query.trim() || openId === s.id;
          return (
            <div key={s.id} className={`tutorial-section ${isActive ? "" : "hidden print-hidden"}`}>
              {/* Section overview header */}
              <div className="bg-[var(--sh-card-base)]/40 border border-shBorder rounded-lg p-4 mb-3">
                <h4 className={`text-[15px] font-black uppercase tracking-widest ${s.color}`}>
                  <i className={`fas ${s.icon} mr-2`} />{s.title}
                </h4>
                {s.overview && (
                  <p className="text-[14px] text-shTextMuted mt-1.5 normal-case leading-relaxed">{s.overview}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid={`tutorial-section-${s.id}`}>
                {s.cards.map((c, i) => (
                  <div key={i} className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-5 shadow-lg tutorial-card" data-testid={`tutorial-card-${s.id}-${i}`}>
                    <h5 className="text-shText font-black uppercase tracking-tight text-[15px] flex items-start gap-2">
                      <i className={`fas fa-circle-check ${s.color} mt-1 text-[14px]`} />
                      <span>{c.title}</span>
                    </h5>
                    {(c.badges || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.badges.map(b => <CardBadge key={b} label={b} />)}
                      </div>
                    )}
                    {c.path && (
                      <p className="mt-2.5 text-[12px] text-shSecondary bg-shSecondary/10 border border-shSecondary/25 rounded px-2 py-1.5 inline-block normal-case font-bold tracking-wide">
                        <i className="fas fa-location-arrow mr-1.5" />{c.path}
                      </p>
                    )}
                    <ol className="mt-3 space-y-2 text-[15px] text-shTextMuted">
                      {(c.steps || []).map((step, j) => (
                        <li key={j} className="flex gap-3">
                          <span className={`${s.color} font-black flex-shrink-0`}>{j + 1}.</span>
                          <span className="leading-snug">{step}</span>
                        </li>
                      ))}
                    </ol>
                    {c.tip && (
                      <p className="mt-3 text-[14px] text-shAccent bg-shAccent/5 border border-shAccent/20 rounded p-2.5 leading-snug tip-box">
                        <i className="fas fa-lightbulb mr-1" />
                        <strong className="uppercase tracking-widest">Pro tip · </strong>{c.tip}
                      </p>
                    )}
                    {c.mistake && (
                      <p className="mt-2 text-[14px] text-red-300 bg-red-500/5 border border-red-500/30 rounded p-2.5 leading-snug mistake-box">
                        <i className="fas fa-triangle-exclamation mr-1" />
                        <strong className="uppercase tracking-widest">Common mistake · </strong>{c.mistake}
                      </p>
                    )}
                    {(c.related || []).length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-shBorder">
                        <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">Related</p>
                        <ul className="space-y-1">
                          {c.related.map((r, k) => (
                            <li key={k} className="text-[13px] text-shSecondary normal-case">
                              <i className="fas fa-arrow-right text-[10px] mr-1.5" />{r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-10 text-center text-shTextMuted uppercase font-black tracking-widest text-xs">
            No tutorials match &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}

function CardBadge({ label }) {
  const palette = {
    "Beginner":            "bg-shPrimary/15 text-shPrimary border-shPrimary/30",
    "Daily Use":           "bg-shSecondary/15 text-shSecondary border-shSecondary/30",
    "Admin Only":          "bg-red-500/15 text-red-400 border-red-500/30",
    "Client-Facing":       "bg-purple-500/15 text-purple-300 border-purple-500/30",
    "Setup Only":          "bg-shAccent/15 text-shAccent border-shAccent/30",
    "Staff-Only":          "bg-shAccent/15 text-shAccent border-shAccent/30",
    "Optional":            "bg-shSecondary/15 text-shSecondary border-shSecondary/30",
    "Required":            "bg-red-500/15 text-red-400 border-red-500/30",
    "Reference":           "bg-shSurfaceRaised/60 text-shTextMuted border-shBorder",
    "Live":                "bg-shPrimary/15 text-shPrimary border-shPrimary/30",
    "Permission-gated":    "bg-shSurfaceRaised/60 text-shTextMuted border-shBorder",
    "All staff":           "bg-shSurfaceRaised/60 text-shTextMuted border-shBorder",
    "Care/Dog perms":      "bg-shSurfaceRaised/60 text-shTextMuted border-shBorder",
    "Coming Soon":         "bg-shSurfaceRaised/60 text-shTextMuted border-shBorder",
    "Only shown if enabled": "bg-shSurfaceRaised/60 text-shTextMuted border-shBorder",
  }[label] || "bg-shSurfaceRaised/60 text-shTextMuted border-shBorder";
  return (
    <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded border ${palette}`}>
      {label}
    </span>
  );
}
