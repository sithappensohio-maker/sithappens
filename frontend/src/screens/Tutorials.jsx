import { useState } from "react";
import PageHero from "../components/PageHero";
import AdminTabs from "../components/admin/AdminTabs";
import { EmptyState, PremiumButton, SectionCard, StatusBadge } from "../components/premium";

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
 * Content audited 2026-09-02 against the live app: the consolidated admin
 * workspaces (Today / Action Center / Schedule / Training / Shop Manager),
 * Front Desk V2 + Register Hub, Finance tabs (Accounts Receivable, Sales Tax,
 * Tax Center), Online School (student journey + School HQ), Practice Coach,
 * trophies, receipts + logo, boarding stay rules, the job scheduler, and the
 * client portal's School-first navigation. Coming-soon features are labeled.
 * Search filters across titles, steps, tips, mistakes, and paths.
 *
 * Mechanical notes: card test ids are index-based (`tutorial-card-<section>-<i>`),
 * so inserting a card renumbers the ones after it; quick-action `target`
 * values must match a real section id or the page renders empty.
 */

const ADMIN_QUICK_ACTIONS = [
  { id: "_qa_setup",     label: "First-Time Setup",     icon: "fa-rocket",           target: "getting-started" },
  { id: "_qa_today",     label: "Today & Action Center", icon: "fa-sun",             target: "daily-ops" },
  { id: "_qa_frontdesk", label: "Front Desk & Register", icon: "fa-cash-register",   target: "front-desk" },
  { id: "_qa_booking",   label: "Schedule & Bookings",  icon: "fa-calendar-plus",    target: "bookings-schedule" },
  { id: "_qa_addclient", label: "Clients & Dogs",       icon: "fa-user-plus",        target: "clients-dogs" },
  { id: "_qa_school",    label: "Training & School",    icon: "fa-graduation-cap",   target: "training-school" },
  { id: "_qa_shop",      label: "Shop Manager",         icon: "fa-bag-shopping",     target: "shop-manager" },
  { id: "_qa_finance",   label: "Finance & Taxes",      icon: "fa-dollar-sign",      target: "finance" },
  { id: "_qa_messages",  label: "Client Messages",      icon: "fa-comments",         target: "messages-admin" },
  { id: "_qa_photo",     label: "Photography Page",     icon: "fa-camera-retro",     target: "photography-admin" },
  { id: "_qa_settings",  label: "Settings Map",         icon: "fa-cog",              target: "settings-help" },
  { id: "_qa_mobile",    label: "Admin on a Phone",     icon: "fa-mobile",           target: "mobile-admin" },
  { id: "_qa_backup",    label: "Backups & Automation", icon: "fa-database",         target: "troubleshooting-admin" },
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
          "Open Settings in the sidebar (Administration group — it starts collapsed, tap the group name to expand it).",
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
          "Review the default Daycare / Boarding / Grooming / Training services and edit base price, duration, description.",
          "Add specialty services if you offer them (private training, bath-only, nail trim, photography sessions).",
          "Toggle Active on/off to control what clients can see and book.",
          "Training programs are edited in Program Studio, which opens from the program's row here — modules, lessons, checkpoints, quizzes, and the Online School experience all live there.",
          "Set boarding stay rules under Money Rules → Stay-duration pricing: boarding bills per night, and a pickup after the checkout time adds a late-pickup charge (a full or half daycare day, a flat fee, or nothing — your choice).",
        ],
        related: ["Settings → Services & Pricing → Credit Packs (sold to clients as Prepaid Visits)", "Settings → Services & Pricing → Pricing Tiers", "Settings → Services & Pricing → Receipts"],
      },
      {
        title: "Step 3 — Lock down vaccines, the waiver, and agreements",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Clients, Dogs & Compliance",
        steps: [
          "Open Vaccine Requirements — toggle each vaccine you require (Rabies is on by default) and set a warning lead time.",
          "Open Waiver — paste your waiver text and tick Require for booking.",
          "Open Service & Program Agreements to add per-service or per-program agreements clients sign by typing their name; signed versions stay on file exactly as signed.",
          "Open Compliance Rules (Operator Quick Controls) to decide hard-block vs warn-only per vaccine.",
        ],
        tip: "Recommended: hard block for Rabies, warn-only for everything else.",
      },
      {
        title: "Step 4 — Set up email & notifications",
        badges: ["Setup Only"],
        path: "Settings → Email & Notifications",
        steps: [
          "Open Email Designer — set sender name, signature, and tweak wording on any of the email templates.",
          "Open Email Timing & Quiet Hours — set reminder lead time and quiet hours (queued mail waits until quiet hours end).",
          "Open Email Automation — toggle which automations fire (booking confirmations, reminders, birthday cards, practice reminders, weekly digests, review requests).",
        ],
        mistake: "Skip the Email Health check at your own risk — if the sending domain isn't verified, none of your emails reach clients.",
      },
      {
        title: "Step 5 — Payment methods, receipts, and your logo",
        badges: ["Setup Only", "Admin Only"],
        path: "Settings → Finance & Bookkeeping → Payment Options · Settings → Services & Pricing → Receipts",
        steps: [
          "Payment Options controls which informal methods clients see on confirmations and in the portal (Cash, Check, Venmo, PayPal). Stripe online payments and the Front Desk register are always available to staff.",
          "Receipts sets the business name, address, contact line, thank-you and policy footer, which optional fields print, and auto-email/auto-print behavior.",
          "Upload your logo on the Receipts panel — it prints on every on-screen, emailed, and thermal receipt (the preview shows exactly what the thermal printer will produce).",
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
      {
        title: "Step 8 — Learn the sidebar groups",
        badges: ["Beginner"],
        steps: [
          "The sidebar is grouped: Daily Work (Today, Action Center, Front Desk, Clients, Dogs, Client Messages), Schedule, Care (Run Sheet, Care Board, Kennel Board, Incidents), Training, Shop (Shop Manager), Money (Finance, Credit Audit), Communication (Announcements, Bulk Email, Intake Forms), Administration (Staff, Duplicate Check, Audit Log, Settings, How to Use).",
          "Only Daily Work, Schedule, and Training start expanded — tap a group name to open the rest.",
          "Some screens are tabs inside a workspace rather than sidebar items: Bookings, Waitlist, and Recurring live under Schedule; School HQ, Rewards, and Trophies live under Training.",
          "Use the search box at the top of the admin (clients, dogs, bookings, references) and the + New launcher for the common create actions; pin favorites so your daily screens sit at the top.",
        ],
      },
    ],
  },
  {
    id: "daily-ops",
    title: "Daily Operations",
    icon: "fa-sun",
    color: "text-shAccent",
    overview: "The screens you touch every day: Today, Action Center, Run Sheet, Care Board, Kennel Board, and the Schedule workspace.",
    cards: [
      {
        title: "Start on Today",
        badges: ["Daily Use"],
        path: "Sidebar → Daily Work → Today",
        steps: [
          "Today is the landing workspace. The hero shows the date and today's counts by service; the roster below lists every dog expected, on site, or overdue for pickup with care icons for feeding, meds, and training.",
          "The Owner Clock card is where you clock in/out; Today's Sales shows what's come in with a one-tap Open Front Desk button.",
          "Action Required is the prioritized queue of decisions: Meet & Greet requests, bookings awaiting approval, reschedule requests, Stripe disputes, shop refunds needing review, and overdue medications. The badge count always matches the list.",
          "Health Flags counts dogs with missing, expired, or soon-expiring vaccines — click through to Vaccine Alerts.",
        ],
        tip: "Opening Today used to be what triggered the day's automations. That is no longer true — the scheduler runs them on its own (see Backups & Automation).",
      },
      {
        title: "Action Center — the prioritized to-do feed",
        badges: ["Daily Use"],
        path: "Sidebar → Daily Work → Action Center",
        steps: [
          "One feed of everything that needs a human: vaccines, rewards to grant, quote requests, balances, register closeouts, stuck checkouts, and data cleanup — grouped and ordered by urgency.",
          "Open an item to jump straight to the screen that fixes it; dismiss what you've handled elsewhere, or Clear All for a group.",
          "When the feed says All clear, you're caught up.",
        ],
      },
      {
        title: "Pull up today's Run Sheet",
        badges: ["Daily Use"],
        path: "Sidebar → Care → Run Sheet",
        steps: [
          "Run Sheet lists every dog scheduled today with feeding/medication notes.",
          "Print it or open it on a tablet at the front desk.",
          "Special diets/medications show as a highlighted pill — don't miss them.",
        ],
      },
      {
        title: "Care Board — feeding & medication tracker",
        badges: ["Daily Use"],
        path: "Sidebar → Care → Care Board",
        steps: [
          "Auto-pulls today's feeding + meds for every on-site dog, sorted by time, with status pills: Not due / Due now / Completed / Missed / Skipped.",
          "Tap Complete to log staff initials + an optional note, or Skip with a preset reason.",
          "The schedule auto-seeds from each dog's default feeding/medication plan — edit the dog profile to change the defaults.",
          "Auto-refreshes every 60 seconds so Due now rolls into Missed without a manual refresh. Overdue meds also appear in Action Required.",
        ],
      },
      {
        title: "Kennel Board — where every dog goes",
        badges: ["Daily Use"],
        path: "Sidebar → Care → Kennel Board",
        steps: [
          "One card per on-site dog, grouped by service (Daycare / Boarding / Training / Grooming / Photography).",
          "Each card has assignment slots — Kennel, Room, Crate, Yard group, Training group — click the card to edit.",
          "Edit the dropdown options via the Labels button (one label per line).",
          "Warning badges fire automatically: vaccine lapsed, overdue medication, do-not-group flag, open incident.",
        ],
      },
      {
        title: "The Schedule workspace: Calendar, Bookings, Waitlist, Recurring",
        badges: ["Daily Use"],
        path: "Sidebar → Schedule",
        steps: [
          "Schedule is one workspace with four tabs. Calendar is the month/list view; Bookings is the full list with filters; Waitlist holds overflow; Recurring holds standing schedules.",
          "Waitlist: when daycare or boarding is at capacity, drop the client on the waitlist instead of a booking error. Status flow: Waiting → Offered → Booked / Declined / Expired / Removed. Convert creates the real booking (bypasses the daily cap, still checks vaccines, waiver, and conflicts).",
          "Recurring: create a template (client, dog, service, days of week, horizon in weeks). Click Extend once to book the first window.",
          "After that first Extend, the scheduler keeps the schedule booked ahead automatically — about two weeks before the booked window runs out it books the next horizon. Turn Auto-extend off on the template if you'd rather do it by hand.",
        ],
        mistake: "A template that has never been extended is left alone by the automation — the first Extend click is your opt-in.",
      },
      {
        title: "End of day",
        badges: ["Daily Use"],
        path: "Sidebar → Front Desk",
        steps: [
          "Check out every dog that's leaving from Front Desk (Overdue Pickups on the glance row tells you who's still here).",
          "Open Register Hub, compare Expected cash to the drawer, and Close Register — an over/short note is recorded with the closeout.",
          "Log any incidents from the day before you clock out.",
        ],
      },
    ],
  },
  {
    id: "front-desk",
    title: "Front Desk & Register",
    icon: "fa-cash-register",
    color: "text-shPrimary",
    overview: "One screen for check-in/checkout, taking payment, the cash register, online payments, and shop pickups. This is the highest-traffic screen in the app.",
    cards: [
      {
        title: "Read the screen: Today at a Glance, Register Hub, Quick Actions",
        badges: ["Daily Use"],
        path: "Sidebar → Daily Work → Front Desk",
        steps: [
          "Today at a Glance: Expected Visits, On-Site Dogs, Overdue Pickups, New Online Orders, and Register (OPEN / CLOSED).",
          "Register Hub sits directly under the glance row — open/close the register, expected cash, No Sale, and today's register activity.",
          "Quick Actions: Quick Check-In / Walk-In, Book a Service, Online Orders, Open Cash Drawer. The tool row underneath has Recent Sales, Register Tools, Online Payments, and Shop Manager (which opens the Shop Manager screen), plus the printer status chip.",
          "Action Required also appears here so approvals and requests can be handled without leaving the counter.",
        ],
      },
      {
        title: "Check a dog in or out",
        badges: ["Daily Use"],
        path: "Front Desk → Quick Check-In / Walk-In",
        steps: [
          "Find the booking (search or the day's list) and tap Check In on arrival. Walk-ins without a booking start from the same button.",
          "On departure, tap Check Out — this is where the invoice is created and payment is taken.",
          "Add-ons (bath, nail trim), late-pickup charges on boarding, and per-client pricing tiers are applied automatically to the checkout total.",
          "A dog that was never checked out shows under Overdue Pickups, and a stale one lands in Action Center as a stuck checkout with a one-click resolver.",
        ],
      },
      {
        title: "Take payment at checkout",
        badges: ["Daily Use"],
        steps: [
          "Choose the tender: Cash, Card, Check, Venmo/PayPal, existing account credit, or prepaid visits (credits).",
          "For cash, enter the amount tendered — the app shows change due.",
          "A balance can be split across tenders, or left on the client's account (it then shows in Accounts Receivable).",
          "Prepaid visits: the receipt shows the visit's value with $0 due. Income was already recorded when the pack was sold, so redeeming a visit never counts as revenue twice.",
          "The receipt attaches to the client's invoice history automatically. View, print, or email it from Recent Sales, and reprint any time later.",
        ],
        mistake: "Don't take cash before the register is opened for the day — the app blocks cash tenders until the drawer session is started, so counted cash never gets double-attributed.",
      },
      {
        title: "Register Hub — open, No Sale, close",
        badges: ["Daily Use", "Admin Only"],
        path: "Front Desk → Register Hub",
        steps: [
          "Open Register starts the day's session with an opening float. If the opening amount differs from yesterday's rollover, you'll be asked for a short override reason.",
          "Expected cash (finance permission) is the live number the drawer should hold: float plus cash taken minus cash paid out.",
          "No Sale opens the drawer with no transaction (making change) and requires the register PIN — set or change the PIN from Register Tools. Every No Sale is logged with who did it.",
          "Close Register records the count; any difference from expected cash is saved as an over/short note on the closeout.",
          "The activity log lists today's register events in order — sales, refunds, drawer opens, closeouts.",
        ],
        tip: "Open the register before the first cash sale of the day — expected-cash reporting depends on it.",
      },
      {
        title: "Online Payments (Stripe)",
        badges: ["Live"],
        path: "Front Desk → Online Payments",
        steps: [
          "Any invoice a client pays with a card through their portal shows up here automatically, separate from cash/manual entries.",
          "Use this panel to confirm a payment landed and to see amount, date, and which client/invoice it's tied to.",
          "Refunds on a Stripe payment are issued from this same panel; disputes/chargebacks appear in Action Required until resolved.",
        ],
        mistake: "Don't refund a Stripe payment through a cash-refund flow — always use the Stripe refund action so the client's card is actually credited.",
      },
      {
        title: "Online Orders — Shop pickup workflow",
        badges: ["Live"],
        path: "Front Desk → Online Orders (also Shop Manager → Online Orders)",
        steps: [
          "Every Shop order a client pays for online and marks for local pickup lands here with a status: PREPARING, READY FOR PICKUP, COMPLETED, or NEEDS ATTENTION.",
          "A NEW badge marks orders you haven't opened yet; the glance row counts them.",
          "Tap Mark Ready once the order is bagged — this flips the client's own order status to Ready for Pickup and emails them.",
          "Tap Mark Picked Up when the client has it in hand.",
          "NEEDS ATTENTION usually means a payment or stock hiccup — open it and use Retry Fulfillment once resolved. Refund reconciliations show in Action Required.",
        ],
      },
    ],
  },
  {
    id: "bookings-schedule",
    title: "Bookings & Schedule",
    icon: "fa-calendar-check",
    color: "text-shPrimary",
    overview: "Create, approve, edit, and read bookings; how boarding is priced; how capacity warnings work.",
    cards: [
      {
        title: "Create a booking from the admin side",
        badges: ["Daily Use"],
        path: "Sidebar → Schedule → Bookings → New Booking (or Front Desk → Book a Service)",
        steps: [
          "Click New Booking.",
          "Pick the client, then their dog (or dogs — multi-dog bookings are grouped and get the multi-dog discount at checkout).",
          "Pick the service and the date (boarding asks for drop-off, pickup date, and pickup time).",
          "The price estimate updates live, including per-client tier rates, seasonal pricing, and any late-pickup charge on boarding. Add add-ons and save — a confirmation email sends automatically.",
        ],
      },
      {
        title: "How boarding is priced",
        badges: ["Reference"],
        path: "Settings → Services & Pricing → Money Rules → Stay-duration pricing",
        steps: [
          "Boarding bills per night: a Friday-to-Sunday stay is two nights.",
          "Pickup after the checkout time (5 PM by default) adds a late-pickup charge — a full daycare day, a half day, a flat fee, or nothing, whichever you configured. It is always a cash charge, never taken from prepaid visits.",
          "Clients see the same rule on the booking form before they confirm, and the generated stay policy page explains it in their words.",
        ],
      },
      {
        title: "Approve pending requests",
        badges: ["Daily Use"],
        path: "Today / Front Desk → Action Required · Schedule → Bookings (filter Pending)",
        steps: [
          "New requests, Meet & Greet requests, and reschedule requests all land in Action Required with an urgency rank — requested-date-passed and today first.",
          "Open each one, confirm the dog's vaccines are current, then Approve or Reject.",
          "Approved bookings auto-send a confirmation email to the client.",
        ],
      },
      {
        title: "Edit, reschedule, or cancel a booking",
        badges: ["Daily Use"],
        path: "Schedule → Bookings → open one",
        steps: [
          "Open the booking row and click Edit to change date, time, or service — the client is notified of the change.",
          "Click Cancel to cancel — pick a reason; any cancellation fee is calculated from your Money Rules and the client is emailed.",
        ],
        mistake: "You can't edit a checked-out booking — once it's a closed receipt, use the refund/reversal flow from Front Desk or the Finance ledger instead.",
      },
      {
        title: "Read the Calendar",
        badges: ["Daily Use"],
        path: "Sidebar → Schedule → Calendar",
        steps: [
          "Month view by default (list view on phones). Colors follow the service; pending bookings are orange, completed ones muted gray so history stays visible without competing with the live queue.",
          "Page back as far as you like — the calendar loads whatever month you're looking at, including bookings older than 90 days that have moved to the archive.",
          "Capacity fills as the day books; once you hit your daycare cap, new same-day requests are blocked and go to the Waitlist.",
        ],
      },
      {
        title: "Booking history, search, and archived bookings",
        badges: ["Reference"],
        steps: [
          "Completed bookings older than 90 days are moved to a cold archive automatically. Nothing is lost: client and dog history, the calendar, global search (including a booking reference from an old receipt), receipts, finance reports, and visit counts all read the archive too.",
          "Opening an archived booking shows an Archived flag; ledger edits still land on the right record.",
        ],
      },
    ],
  },
  {
    id: "clients-dogs",
    title: "Clients & Dogs",
    icon: "fa-paw",
    color: "text-shSecondary",
    overview: "Adding, updating, and looking up the families and dogs you work with, plus compliance, pricing tiers, and safety.",
    cards: [
      {
        title: "Add a client and a dog",
        badges: ["Daily Use"],
        path: "Sidebar → Daily Work → Clients → Add Client · Dogs → Add Dog",
        steps: [
          "From Clients, click Add Client — name, email, phone, address, emergency contact. Tick Create portal login to let them book online.",
          "From Dogs, click Add Dog — pick the owner, then breed/sex/birthday, profile photo, vaccine expiries, feeding/meds, and vet info.",
          "Intake Forms (Communication group) holds the questionnaires new clients fill in from the portal; answers feed safety-flag suggestions.",
        ],
        tip: "Clients can also self-register from your portal link or while checking out in the Shop — their record auto-creates and appears in Clients.",
      },
      {
        title: "Vaccines, waiver & agreements",
        badges: ["Daily Use"],
        path: "Sidebar → Dogs → open dog → Vaccines · Today → Health Flags",
        steps: [
          "Enter the expiry date for each required vaccine, optionally attach the vet certificate.",
          "Clients can upload certificates from the portal's quick-upload wizard; those land as uploads for you to approve in bulk from Vaccine Alerts.",
          "Vaccine Alerts lists every dog that's missing, expired, or expiring within your warning window (every dog, no cap); dismiss an alert for a period if you're waiting on paperwork.",
          "Dogs without a current waiver or unsigned service agreements are flagged — message the client a re-sign link.",
          "Compliance behavior (hard block / warn-only / grace period) is configured in Settings → Clients, Dogs & Compliance → Compliance Rules.",
        ],
      },
      {
        title: "Pricing Tiers — per-client rates",
        badges: ["Admin Only"],
        path: "Settings → Services & Pricing → Pricing Tiers · Client profile → tier",
        steps: [
          "Create a tier (for example Founding Clients) with its own per-service rates, then assign clients to it from their profile.",
          "Bookings, checkout, and receipts use the client's tier rate automatically and show the public price next to their price so the discount is visible.",
        ],
      },
      {
        title: "Incidents & safety flags",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Care → Incidents · Per-dog flags on Dogs cards",
        steps: [
          "Log an incident with severity (Low/Medium/High/Critical) and type (bite, fight, injury, escape attempt, resource guarding, etc.).",
          "Safety Flags on each dog card get auto-suggested from incident history and intake answers — click a suggested flag to apply it instantly.",
        ],
      },
      {
        title: "Duplicate Check",
        badges: ["Live", "Admin Only"],
        path: "Sidebar → Administration → Duplicate Check",
        steps: [
          "Preview-only scan for duplicate client/dog records before credits, bookings, vaccines, or payments get split across two accounts.",
          "Each candidate shows how many bookings (including archived), portal logins, and ledger rows each record owns so you can pick the survivor.",
          "Nothing is merged automatically — it's a safe list to review before you consolidate.",
        ],
      },
      {
        title: "View a client's full history",
        badges: ["Daily Use"],
        path: "Sidebar → Clients → open a client",
        steps: [
          "Every booking (live and archived), payment, prepaid pack, agreement signature, and trophy is timestamped on the client's page.",
          "The dog's Timeline tab shows visits, Practice sessions, checkpoints, photos, and incidents in one stream.",
          "Communication Log captures every call, text, email, or in-person note tied to that family.",
          "Client Portal Preview shows what that client sees on their portal, including their training progress rings.",
        ],
      },
    ],
  },
  {
    id: "shop-manager",
    title: "Shop Manager & Online Orders",
    icon: "fa-bag-shopping",
    color: "text-shAccent",
    overview: "Shop Manager is the catalog and storefront control room: items, categories, shop settings, online orders, and a client preview. The client-facing Shop sells merch, prepaid visits, training programs, and Online School courses.",
    cards: [
      {
        title: "The five tabs",
        badges: ["Admin Only"],
        path: "Sidebar → Shop → Shop Manager",
        steps: [
          "Items — everything sellable, with photos, cost, price, margin, stock, tax flag, and online/register visibility.",
          "Categories & Layout — the sections and order clients see in the Shop (All, Merch & Gear, Prepaid Visits, Training, Online School).",
          "Shop Settings — pickup instructions, guest checkout, storefront copy.",
          "Online Orders — the same pickup queue Front Desk shows (Preparing → Ready for Pickup → Completed).",
          "Client Preview — the storefront exactly as a client sees it.",
        ],
      },
      {
        title: "Item kinds",
        badges: ["Reference"],
        steps: [
          "Physical Product — inventory, SKU, cost, tax, register + online. Stock decrements on a completed sale and restores on a void/refund.",
          "Shopify/External Merchandise — a link-out to your Shopify/Printify store for apparel; nothing is fulfilled in-app.",
          "Prepaid Visit Pack — bulk daycare/boarding visits (Credit Packs in Settings). Credits land on the client's account the moment payment clears.",
          "Training Program — in-person programs and Online School courses. Buying one enrolls the dog automatically; online courses open in the client's School right away.",
        ],
      },
      {
        title: "Photos and profit margins",
        badges: ["Admin Only"],
        steps: [
          "Upload a photo on any item — it shows in the Shop, on the register, and in order emails.",
          "Enter cost alongside price to see the margin per item and a catalog-wide profit summary at the top of Items.",
        ],
      },
      {
        title: "The Online School storefront",
        badges: ["Client-Facing"],
        path: "Client Shop → Online School tab",
        steps: [
          "The Online School tab is a full landing page: how it works, the difference between self-guided and trainer-guided programs, real completion stats, star ratings and approved testimonials from students.",
          "Numbers and testimonials only appear once there is real data behind them — nothing is faked.",
          "A course marked free can be claimed with one tap; guests are asked to create an account first and their cart carries over.",
        ],
      },
    ],
  },
  {
    id: "photography-admin",
    title: "Photography",
    icon: "fa-camera-retro",
    color: "text-shAccent",
    overview: "Photography is a full, dedicated page in the client portal. Admin manages the featured gallery and headline; session pricing reuses your Services & Programs catalog.",
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
          "The Photography page's Sessions & Packages section lists whatever services you've tagged as Photography — there is no separate photography price list.",
          "Add, edit, or retire a photography package the same way you manage any other service.",
        ],
      },
      {
        title: "Pixieset delivery link",
        badges: ["Live", "Client-Facing"],
        path: "Settings → Marketing & Branding → Portal Links",
        steps: [
          "The client's Photography page has an 'Already Had a Session?' section that points to your Pixieset (or other delivery platform) gallery link.",
          "Set that link under Portal Links so it stays current.",
        ],
        mistake: "Delivered galleries live on Pixieset — the portal only links out to it.",
      },
    ],
  },
  {
    id: "finance",
    title: "Finance, Taxes & Bookkeeping",
    icon: "fa-dollar-sign",
    color: "text-shPrimary",
    overview: "Finance has four tabs — Transactions, Accounts Receivable, Sales Tax, Tax Center — plus Credit Audit. Everything is cash-basis: revenue belongs to the day the money was collected.",
    cards: [
      {
        title: "Transactions — track income",
        badges: ["Daily Use", "Admin Only"],
        path: "Sidebar → Money → Finance → Transactions",
        steps: [
          "KPI tiles: Completed / Paid / Unpaid (incl. account balances) / Booked Upcoming, with a breakdown by service and by income category (Retail, Prepaid Visits, Training Programs, Payment Plans, Account Payments, Refunds).",
          "Switch date ranges (This Week / Month / Quarter / YTD) or pick any range — totals are computed over every row in the range, never a sample.",
          "Sales tax collected is reported beside revenue, never inside it; refunds and voids show as their own negative line.",
          "Export CSV, or download/email the P&L PDF from the toolbar. The monthly P&L also emails itself on the 1st (with a week of catch-up if the server was down).",
        ],
      },
      {
        title: "How prepaid visits and credits hit the books",
        badges: ["Reference"],
        steps: [
          "Selling a prepaid pack records the full pack price as income on the sale date, under Prepaid Visits.",
          "Redeeming a visit at checkout records $0 collected — the receipt shows the visit's value so the client sees what was used. No double counting.",
          "Mixed checkouts (a credit plus a cash add-on or late-pickup charge) record only the cash portion, and sales tax applies only to that cash portion.",
        ],
      },
      {
        title: "Accounts Receivable",
        badges: ["Admin Only"],
        path: "Finance → Accounts Receivable",
        steps: [
          "Owed to you, Credit on file, and Net are totals over every client account.",
          "The list shows the largest balances first; a note tells you if the list is cut short, but the totals never are.",
          "Send a statement from the client's row; the client can also pay a balance from their portal.",
        ],
      },
      {
        title: "Sales Tax tracker",
        badges: ["Admin Only"],
        path: "Finance → Sales Tax · Today → Sales Tax Due tile",
        steps: [
          "Each Ohio filing period shows tax collected, the liability, filed/unfiled status, and variance against what you actually remitted.",
          "Record a filing when you submit it; the Today tile shows the next due date.",
        ],
      },
      {
        title: "Tax Center — estimated taxes",
        badges: ["Admin Only"],
        path: "Finance → Tax Center",
        steps: [
          "Federal and Ohio estimated-tax cards project the year from your cash-basis books, show each quarter's installment, and track the payments you record.",
          "Fill in the Tax Profile (filing status, other income, withholding) so the projection uses your real situation.",
          "The Schedule C / 1099 export pulls from the same ledger the Transactions tab uses.",
        ],
      },
      {
        title: "Stripe Online payments — day to day",
        badges: ["Live"],
        path: "Finance → Transactions · Front Desk → Online Payments",
        steps: [
          "Stripe payments show in income totals like any other tender, labeled distinctly from Cash/Check/Venmo/PayPal rows.",
          "To refund a Stripe payment, use the refund action inside its own record — the only path that actually returns money to the client's card.",
        ],
        mistake: "Never reverse a Stripe charge by logging a manual cash refund — it won't touch the card and will make your books wrong.",
      },
      {
        title: "Credit Audit and payment plans",
        badges: ["Admin Only"],
        path: "Sidebar → Money → Credit Audit · Client profile → Payment Plans",
        steps: [
          "Credit Audit cross-checks every client's prepaid balance against the packs bought and visits redeemed (live and archived), surfacing anything that looks off. Use it after imports or a suspected data issue.",
          "Payment plans: open the client's profile → New Payment Plan, pick the program, set the installments. Revenue posts only as each installment is paid.",
        ],
      },
    ],
  },
  {
    id: "messages-admin",
    title: "Messages & Communications",
    icon: "fa-comments",
    color: "text-shSecondary",
    overview: "Client Messages for one-to-one, Bulk Email for one-to-many, Announcements for the portal banner, plus the audit trail behind every send.",
    cards: [
      {
        title: "Client Messages (direct inbox)",
        badges: ["Live", "Daily Use"],
        path: "Sidebar → Daily Work → Client Messages",
        steps: [
          "A unified inbox of every conversation a client starts from their portal — filter by Open / Pending / Resolved, or toggle Unread only.",
          "Click a thread, type a reply, and hit Reply — by default it also emails the client (uncheck to keep it in-app only).",
          "Internal Notes at the bottom of a thread are visible to staff only, never to the client.",
          "Online School questions (Ask Your Trainer) arrive tagged with the lesson so you can answer in context.",
        ],
      },
      {
        title: "Bulk Client Email",
        badges: ["Live", "Admin Only"],
        path: "Sidebar → Communication → Bulk Email",
        steps: [
          "Pick a recipient slice with filter chips: Active clients, upcoming bookings, missing vaccines, has ever done daycare / boarding / training (lifetime — archived history counts), not yet on the portal. A live recipient counter updates as you adjust.",
          "Start from a template or write your own, use merge tags, and Send Test before sending to everyone.",
          "Every send is logged on each recipient's Communication timeline and in the Bulk Email History tab. Sends respect quiet hours.",
        ],
      },
      {
        title: "Announcements banner",
        badges: ["Live", "Client-Facing"],
        path: "Sidebar → Communication → Announcements",
        steps: [
          "Post a banner clients see at the top of their portal Home — set title, message, style (info/success/warning/urgent), and a date window.",
        ],
      },
      {
        title: "Automatic emails",
        badges: ["Reference"],
        path: "Settings → Email & Notifications → Email Automation",
        steps: [
          "The scheduler sends these without anyone opening the admin: booking confirmations and reminders, dog birthday cards (with the profile photo), vaccine-expiry reminders, practice reminders on the client's chosen days, the Sunday practice digest, the Monday trainer digest, and the monthly P&L.",
          "Each one is deduplicated, so re-running never double-sends; missed days catch up when the server comes back.",
        ],
      },
      {
        title: "Audit Log",
        badges: ["Live", "Admin Only"],
        path: "Sidebar → Administration → Audit Log",
        steps: [
          "Every staff/admin write is captured automatically — filter by group (Bookings, Dogs, Clients, Money, Settings, etc.), user, or free text.",
          "Click a row to expand the payload — passwords, tokens, and card numbers are auto-redacted.",
        ],
      },
    ],
  },
  {
    id: "training-school",
    title: "Training, School HQ & Practice",
    icon: "fa-graduation-cap",
    color: "text-shSecondary",
    overview: "Training is one workspace with tabs: Today, School, Practice, Rewards, Trophies. In-person programs, Online School courses, and client Practice all run through it.",
    cards: [
      {
        title: "Training Hub — every dog, one view",
        badges: ["Daily Use"],
        path: "Sidebar → Training → Today",
        steps: [
          "Stat pills: Active / On Hold / Completed / Overdue. Each row is a dog's enrollment with its program, current module and lesson, trainer, and progress.",
          "Trainers record in-person sessions through the guided session workspace (attendance, skills worked, scores, next focus) — that is what moves the curriculum pointer for in-person and hybrid programs.",
          "Board & Train dogs get AM/PM session slots that follow the boarding stay automatically.",
        ],
      },
      {
        title: "Graduation is a decision, not an automatic step",
        badges: ["Admin Only"],
        path: "Training → Today → dog row",
        steps: [
          "When a dog has met the program's completion rule, the row shows a Ready to graduate badge — nothing completes on its own.",
          "The owner/manager or the assigned trainer graduates the dog; the completion date, who graduated it, and the certificate are recorded, and the Graduate trophy is awarded immediately.",
          "Made a mistake? Reopen the program (with a reason) — the reopen is audited and the dog resumes where it left off.",
        ],
      },
      {
        title: "School HQ — running Online School",
        badges: ["Daily Use", "Admin Only"],
        path: "Sidebar → Training → School",
        steps: [
          "Overview: active/inactive students, reviews to do, new questions, trainer assists, needs attention.",
          "Reviews is the daily queue: every Practice session a student logged with a video, a could-not-complete, a hard difficulty, or an unanswered question. Mark Looks good / Keep practicing / Trainer attention.",
          "Needs Attention and Trainer Assist list students who are stuck or asked for help; Interventions tracks what you did about it.",
          "Students shows each enrollment's course progress, checkpoints, and access state (pause, extend, revoke). Analytics, Client Feedback (course reviews), Resources, and Settings round out the tabs.",
          "Checkpoints: students submit a video for the lesson's checkpoint; you grade handler and dog scores with feedback and either advance them, prescribe more practice, or assign a refresher lesson.",
        ],
      },
      {
        title: "Practice — assignments and daily trackers",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Training → Practice",
        steps: [
          "Assign a Practice from a template or write custom tasks, with a due date, frequency, and target reps. School lessons create their own Practice automatically when the student reaches them.",
          "Clients log sessions from the Practice Coach; you see each session, its difficulty and notes, and can leave review notes.",
          "The trainer-attention badge, Analytics, and the Sunday digest all count School practice sessions, not just completed assignments.",
        ],
      },
      {
        title: "Program Studio — building a curriculum",
        badges: ["Admin Only"],
        path: "Settings → Services & Pricing → Services & Programs → open a program",
        steps: [
          "Modules hold skills (goals) and lessons. Each lesson has client-facing content blocks, a demo video, equipment, success criteria, a Practice template, and optionally a checkpoint or module quiz.",
          "Set the delivery mode (in-person, online, hybrid), the completion rule, welcome outcomes for the Program Welcome page, and module icons.",
          "Import a whole curriculum from a ZIP, and publish only when the readiness checklist is green — students enroll into a frozen snapshot, so later edits never change a running course unless you cascade them.",
        ],
      },
      {
        title: "Trophies — the awards catalog",
        badges: ["Admin Only"],
        path: "Sidebar → Training → Trophies",
        steps: [
          "Each trophy is manual or automatic. Automatic triggers: skills mastered (trainer-scored, or Online School lessons passed), programs completed, checkpoints passed, Practice streak days, Practice assignments completed, lifetime visits, successful referrals.",
          "Upload your own artwork per trophy and choose the fit (circle, contain, freeform) and focal point — the same image shows on the portal, share cards, and achievement lists everywhere.",
          "Re-check awards runs every evaluator for every client and dog right now. Use it after editing thresholds; it never awards twice.",
        ],
      },
      {
        title: "Rewards Center",
        badges: ["Admin Only"],
        path: "Sidebar → Training → Rewards",
        steps: [
          "Pending referrals become Ready once the referred client completes a first paid visit — grant the reward credit from here. A referral already paid can't be paid again.",
          "Trivia perks, reward credit grants, and every client's credit balances are listed on the same screen.",
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
        path: "Sidebar → Administration → Staff",
        steps: [
          "Add a new staff account, set their role and hourly rate, and (if enabled) their staff-portal access.",
          "New staff default to Read-only so a brand-new account can't accidentally change anything destructive.",
          "Trainers who run sessions need Manage training sessions; only the owner/manager or the assigned trainer can graduate a dog.",
        ],
      },
      {
        title: "Roles & permission matrix",
        badges: ["Admin Only"],
        path: "Staff (Roles panel) · Settings → Staff & Admin → Permission Matrix",
        steps: [
          "Roles: Owner / Manager / Trainer / Daycare Staff / Boarding Staff / Front Desk / Read-only.",
          "The permission matrix is a full grid of role × permission — toggle a checkbox to grant/revoke, changes apply on next request.",
          "The sidebar automatically hides items a staffer doesn't have permission to use; Front Desk staff get least-privilege register access (take payments, no finance reports).",
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
          "Feature Visibility, Client Portal Controls, Booking Flow Controls, Dashboard Widget Controls, Operator Quick Controls, Hours & Closures, Capacity & Kennels, Booking Guardrails, Booking Rules (legacy), Service Operational Defaults.",
        ],
      },
      {
        title: "Services & Pricing",
        badges: ["Reference"],
        steps: [
          "Services & Programs (with Program Studio), Credit Packs, Payment Plans, Receipts (branding, logo, print/email behavior), Pricing Tiers, Money Rules (fees, tipping, deposits, stay-duration pricing and late pickup), Holiday & Peak-Season Pricing. Discounts & Coupons is Coming Soon.",
        ],
      },
      {
        title: "Clients, Dogs & Compliance",
        badges: ["Reference"],
        steps: [
          "Vaccine Requirements, Waiver, Service & Program Agreements, Compliance Rules, Training Commands, plus links out to Intake Forms and Incidents & Safety Flags.",
        ],
      },
      {
        title: "Email & Notifications",
        badges: ["Reference"],
        steps: [
          "Email Designer, Email Automation, Email Timing & Quiet Hours. Text Message Settings and Marketing Emails are Coming Soon.",
        ],
      },
      {
        title: "Marketing & Branding",
        badges: ["Reference"],
        steps: [
          "Brand & Appearance, Portal & UI Polish, Public Service Info, Mood Tags, Portal Links, Photography Page, First Visit Card, Review Links, Marketing QR Codes.",
        ],
      },
      {
        title: "Staff & Admin",
        badges: ["Reference"],
        steps: [
          "Links out to Manage Staff and Roles & Permissions, plus the Permission Matrix. Payroll Settings is Coming Soon.",
        ],
      },
      {
        title: "Finance & Bookkeeping",
        badges: ["Reference"],
        steps: [
          "Income Dashboard link, Finance Defaults (fiscal year, export format, mileage rate), Payment Options (which methods clients see). Payment Processors and Refund Rules are Coming Soon — Stripe operations happen on Finance and Front Desk today.",
        ],
      },
      {
        title: "Rewards & Referrals",
        badges: ["Reference"],
        steps: [
          "Links out to Rewards Center and the Trophy catalog, plus Loyalty Tiers, Streaks & Referral Rules. Streak Auto-Awards is Coming Soon (practice-streak trophies already award automatically).",
        ],
      },
      {
        title: "System & Data",
        badges: ["Reference"],
        steps: [
          "My Account, Backup & Restore (download, nightly auto-backup, restore), Server Errors, Data Export (CSV), plus links out to Duplicate Check and Audit Log.",
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
          "Tap the hamburger to open the full navigation drawer — every destination is grouped exactly like the desktop sidebar (Daily Work / Schedule / Care / Training / Shop / Money / Communication / Administration), with large tap targets.",
          "The drawer also has your text-size control, the Install App button, and Sign out.",
        ],
      },
      {
        title: "Dense screens become stacked cards",
        badges: ["Live"],
        steps: [
          "Desktop tables (Clients, Dogs, Bookings, Audit Log, etc.) automatically switch to stacked mobile cards on a phone — the same information, never a sideways-scrolling spreadsheet.",
          "Front Desk's glance tiles, Register Hub, and Quick Action cards stack into a single column; the calendar switches to a list view.",
        ],
      },
      {
        title: "What to expect on Today, Front Desk, Finance",
        badges: ["Live"],
        steps: [
          "Today: hero, stat tiles, and Action Required stack in a single column.",
          "Front Desk: Quick Check-In and the register work the same; the thermal printer is driven by the front-desk computer's agent, not your phone.",
          "Finance: KPI tiles wrap into a 2-column grid; the transaction table becomes a stacked list.",
        ],
      },
    ],
  },
  {
    id: "troubleshooting-admin",
    title: "Backups, Automation & Troubleshooting",
    icon: "fa-shield-halved",
    color: "text-shSecondary",
    overview: "Keep your data safe, know what runs by itself, and know what to do when something looks wrong.",
    cards: [
      {
        title: "Backups: manual and nightly",
        badges: ["Admin Only"],
        path: "Settings → System & Data → Backup & Restore",
        steps: [
          "Download Backup (.json) gives you a full snapshot to save somewhere outside the server.",
          "Enable nightly backup, pick the hour/minute, host path, and how many to keep. Run Now takes one immediately; the panel shows the last run and history.",
          "Restore offers a config-only restore (settings, catalog, templates) separate from a full restore.",
        ],
        tip: "Take a download before any big configuration change — restoring is a 3-click rollback.",
      },
      {
        title: "What runs automatically",
        badges: ["Reference"],
        steps: [
          "A scheduler inside the app checks every minute and runs: the daily jobs after 7 AM (birthday, vaccine, practice reminder, digests, monthly P&L), booking archival, the trophy re-check, recurring-schedule auto-extend, and the nightly backup.",
          "Nobody needs to open the admin for any of it. If the server was down, the jobs catch up: Monday's digest sends through Wednesday, the monthly P&L through the 7th, birthdays within three days.",
          "Only one server worker runs jobs at a time, so nothing sends twice.",
        ],
      },
      {
        title: "An email isn't arriving",
        badges: ["Admin Only"],
        path: "Settings → Email & Notifications → Email Designer",
        steps: [
          "Check the Email Health status pill at the top of Email Designer — green means the sending domain is verified and healthy.",
          "If it's red, your sender domain needs to be verified before any client email will deliver.",
          "Quiet hours hold mail until they end — a reminder queued at 10 PM goes out in the morning.",
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
        title: "The thermal printer",
        badges: ["Admin Only"],
        path: "Front Desk → printer chip",
        steps: [
          "The printer is driven by a small agent on the front-desk computer; the chip shows whether it's reachable.",
          "Test-print from Settings → Receipts to confirm branding and the logo come out right.",
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
  { id: "_cqa_login",    label: "Log In",            icon: "fa-right-to-bracket", target: "getting-started" },
  { id: "_cqa_book",     label: "Book a Visit",       icon: "fa-calendar-plus",    target: "booking" },
  { id: "_cqa_school",   label: "Online School",      icon: "fa-graduation-cap",   target: "online-school" },
  { id: "_cqa_shop",     label: "Shop",               icon: "fa-bag-shopping",     target: "shop" },
  { id: "_cqa_dog",      label: "My Dogs & Records",  icon: "fa-paw",              target: "dogs-records" },
  { id: "_cqa_credits",  label: "Credits & Payments", icon: "fa-wallet",           target: "credits-payments" },
  { id: "_cqa_rewards",  label: "Trophies & Rewards", icon: "fa-trophy",           target: "rewards" },
  { id: "_cqa_photo",    label: "Photography",        icon: "fa-camera-retro",     target: "photography" },
  { id: "_cqa_mobile",   label: "Install on Phone",   icon: "fa-mobile",           target: "mobile-app" },
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
          "Any service or program agreement your business requires appears in the same place — you sign by typing your full name, and the signed version stays on file.",
          "Booking unlocks automatically the moment every step is complete — no refresh needed.",
        ],
        tip: "Forgot your password? Tap Forgot Password on the login screen — you'll get a reset link by email (valid 24 hours).",
      },
      {
        title: "What's on Home",
        badges: ["Beginner"],
        steps: [
          "If your dog is enrolled in Online School, the School card sits at the very top with your next step — tap it to jump straight into your course.",
          "Three quick-action cards: Book Now, Shop, and (if your business offers it) Photography.",
          "An announcement banner from your business, an Action Needed card if setup is incomplete, and a balance banner if you owe anything or have credit on file.",
          "My Dogs, your upcoming bookings, the Practice streak tile, and your credits.",
          "Tap More to reveal the rest: Prepaid Visits, Rewards, Refer a Friend, training history, Practice history, Photography, Files, and Trivia.",
        ],
        tip: "If a section you remember seems to be missing, it's behind the More button.",
      },
    ],
  },
  {
    id: "booking",
    title: "Booking",
    icon: "fa-calendar-plus",
    color: "text-shAccent",
    overview: "Request daycare, boarding, training, grooming, or a photography session, and manage what you've booked.",
    cards: [
      {
        title: "Book a service",
        badges: ["Beginner"],
        steps: [
          "Tap the Book Now card on Home (or Book in the sidebar/bottom bar).",
          "Pick the service, the dog (or dogs), the date, and any add-ons. The price shown updates as you choose — it's the price you'll pay.",
          "Submit — your business is notified and the request shows up under Upcoming as Pending.",
        ],
      },
      {
        title: "Boarding: nights, checkout time, and late pickup",
        badges: ["Beginner"],
        steps: [
          "Boarding is priced per night. Pick a drop-off date, a pickup date, and a pickup time.",
          "Pickup after the checkout time (usually 5 PM) adds a late-pickup charge — the booking form tells you exactly what it will be before you confirm.",
          "The late-pickup charge is paid at pickup; it isn't taken from prepaid visits.",
        ],
      },
      {
        title: "What happens after you submit",
        badges: ["Beginner"],
        steps: [
          "Your business approves or rejects the request — you'll get an email either way.",
          "Approved bookings appear under Upcoming on Home.",
          "Some services confirm instantly instead of requiring approval — if that applies to you, the booking confirms right away.",
        ],
      },
      {
        title: "Before you can book",
        badges: ["Beginner"],
        steps: [
          "A missing vaccine, an unsigned waiver or agreement, or an incomplete profile/dog/emergency-contact section will block a new booking — the portal tells you exactly which one.",
          "Fix the flagged item (see Dogs & Records) and the booking goes through.",
        ],
      },
      {
        title: "Cancel or request a reschedule",
        badges: ["Beginner"],
        path: "Home → Upcoming → open a booking",
        steps: [
          "Open the upcoming booking and tap Cancel or Request Reschedule.",
          "Cancellations may carry a fee depending on how close to the date you are — your business sets these rules.",
        ],
      },
      {
        title: "Recurring schedules (My Schedules)",
        badges: ["Beginner"],
        path: "Home → More → My Schedules",
        steps: [
          "Set up a standing schedule — for example daycare every Monday, Wednesday, and Friday — and the next weeks are booked for you.",
          "Once a schedule has been booked the first time, it keeps itself booked ahead automatically; you'll see the date it's booked through.",
          "Pause or edit it any time from the same place.",
        ],
      },
    ],
  },
  {
    id: "online-school",
    title: "Online School",
    icon: "fa-graduation-cap",
    color: "text-shSecondary",
    overview: "Train your dog at home with a real curriculum: lessons, coached practice, quizzes, and checkpoints your trainer grades. Everything lives under School.",
    cards: [
      {
        title: "Finding School",
        badges: ["Beginner"],
        path: "Sidebar → Online School · Bottom bar → School · Home → School card",
        steps: [
          "Buy a course from the Shop's Online School tab (or claim a free one), or your business enrolls you — it appears under School immediately.",
          "School has five tabs: Today, Course, Practice, Progress, Feedback. Today always tells you the single next thing to do.",
          "If more than one dog or course is enrolled, the selector at the top switches between them.",
        ],
      },
      {
        title: "The Welcome page and orientation",
        badges: ["Beginner"],
        steps: [
          "The first time you open a course you land on its Welcome page: what's covered, the outcomes, how it works, the full course index, and your trainer's promise. Tap Start (or Skip to course).",
          "A short How it works orientation explains the loop: learn the lesson, practice with the coach, pass the checkpoint, move on.",
          "You can reopen the Welcome page any time from About this program on the course screen.",
        ],
      },
      {
        title: "The Course trail",
        badges: ["Beginner"],
        steps: [
          "Course shows the trail of modules and lessons with your dog's photo on the current step. Completed lessons are behind you; the current lesson is highlighted; upcoming lessons in the current module are open to read ahead.",
          "Each module has an icon and the skills it teaches; tap a lesson to open it.",
          "Progress on the trail is course progress — lessons completed — not a score.",
        ],
      },
      {
        title: "Doing a lesson",
        badges: ["Beginner"],
        steps: [
          "Read the lesson material: why it matters, the steps, what success looks like, common mistakes, and equipment.",
          "Watch the demo video first — the coached practice starts after it.",
          "Work through the lesson's steps in order; the lesson tells you when you're ready for Practice or when you can mark it complete.",
        ],
      },
      {
        title: "Practice Coach — guided sessions",
        badges: ["Beginner"],
        steps: [
          "Practice is coached rep by rep: the coach tells you what to do now, you mark each rep as a clean rep or one that needs a reset, and it counts toward today's target.",
          "Say how it went — easy, okay, hard — add a note, and optionally a photo or a short video of the session. Then End Practice Here & Log Today's Session.",
          "Every logged session counts toward your Practice streak and your trophies. A rest day doesn't break bookkeeping, but it doesn't count as practice either.",
          "Your trainer reviews sessions with a video, a hard rating, or a question, and leaves notes you'll see on the Feedback tab.",
        ],
        tip: "Practice logs one session per day on the same assignment — you don't need to finish the whole assignment for your streak to grow.",
      },
      {
        title: "Checkpoints",
        badges: ["Beginner"],
        steps: [
          "Some lessons end with a checkpoint: film the skill and submit it for review. You'll see the criteria before you record.",
          "Statuses you'll see: Awaiting review (your trainer has it), Passed (you advance), Needs practice (a prescribed practice or refresher lesson to do first, then resubmit), or On hold when your trainer needs to clear something.",
          "In-person and hybrid programs have checkpoints your trainer assesses during a session instead.",
          "Your course progress never goes backwards while a checkpoint is being reviewed.",
        ],
      },
      {
        title: "Module quizzes",
        badges: ["Beginner"],
        steps: [
          "At the end of a module, a short quiz checks the ideas from its lessons. You can retake it; the best attempt counts.",
          "Once passed, the module is complete and the next module opens.",
        ],
      },
      {
        title: "Progress, feedback, and your certificate",
        badges: ["Beginner"],
        steps: [
          "Progress shows overall course progress, skill mastery, checkpoint history with your trainer's handler and dog scores, achievements earned, and the permanent training record for your dog.",
          "Feedback collects your trainer's notes and review outcomes; Ask Your Trainer sends a question tied to the lesson you're on and your trainer answers in Messages.",
          "On completion you get a printable certificate and a shareable link. Course history stays available for review afterwards, and your business may ask for a short course review.",
        ],
      },
    ],
  },
  {
    id: "shop",
    title: "Shop",
    icon: "fa-bag-shopping",
    color: "text-shPrimary",
    overview: "A dedicated Shop for merch, prepaid visits, training programs, and Online School courses — separate from booking a service.",
    cards: [
      {
        title: "Browse and buy",
        badges: ["Beginner"],
        path: "Sidebar → Shop · Bottom bar → Shop",
        steps: [
          "Tabs: All, Merch & Gear, Prepaid Visits, Training, Online School.",
          "Add anything to your cart and check out securely with a card through Stripe. You can browse and fill a cart before you have an account — you'll be asked to create one at checkout and the cart carries over.",
        ],
      },
      {
        title: "Prepaid visits, programs, and courses apply automatically",
        badges: ["Beginner"],
        steps: [
          "Buying a prepaid visit pack adds those visits to your account the moment payment clears — no waiting on staff.",
          "Buying a training program enrolls your dog; an Online School course opens under School right away. A course marked free can be claimed with one tap.",
        ],
      },
      {
        title: "Local pickup items",
        badges: ["Beginner"],
        steps: [
          "Physical products you buy for pickup move through three stages: Preparing → Ready for Pickup → Completed. If something needs attention (a payment or stock issue), it shows Needs Attention and your business will follow up.",
          "You'll get an email when your order is marked Ready for Pickup.",
        ],
      },
      {
        title: "Apparel and branded merch",
        badges: ["Reference"],
        steps: [
          "Branded apparel may be sold through an external Shopify/Printify store linked from the Merch & Gear tab, rather than inside this Shop directly.",
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
        path: "Sidebar → Photography · Bottom bar → More → Photography",
        steps: [
          "Browse the Featured Photos gallery — tap any photo to open it full-screen and swipe through the set.",
          "Sessions & Packages lists the photography options your business offers, with pricing — tap Book a Session to start a booking for the one you want.",
        ],
      },
      {
        title: "Already had a session?",
        badges: ["Beginner"],
        steps: [
          "The \"Already Had a Session?\" section at the bottom links out to your business's Pixieset (or similar) gallery — that's where your actual delivered, downloadable photos live.",
          "The portal's Featured Photos gallery is a showcase, not your personal delivered gallery.",
        ],
      },
    ],
  },
  {
    id: "dogs-records",
    title: "Dogs & Records",
    icon: "fa-paw",
    color: "text-shPrimary",
    overview: "Add your dog, keep vaccine records current, sign what needs signing, and see the training record.",
    cards: [
      {
        title: "Add or update a dog",
        badges: ["Beginner"],
        path: "My Dogs",
        steps: [
          "Open My Dogs → + Add Dog. Enter name, breed, sex, birthday, fixed/intact status, and a profile photo.",
          "Tap a dog to update any field, or add notes for trainers/daycare staff to see.",
        ],
        tip: "The profile photo is used everywhere — on your School course trail, your dog's birthday card, and their trophies.",
      },
      {
        title: "Vaccines, the waiver, and agreements",
        badges: ["Beginner"],
        path: "My Dogs → open dog → Vaccines",
        steps: [
          "Required vaccines and their expiry dates are listed; expiring/expired ones show in red.",
          "Use the quick-upload wizard to snap or upload the certificate — your business approves it and the date updates.",
          "Sign or review the waiver and any service or program agreements when prompted; signed versions stay on file exactly as signed.",
        ],
      },
      {
        title: "Training history and the timeline",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Online School progress lives under School → Progress. Trainer-led programs show under training history (Home → More).",
          "Report cards from daycare and boarding visits appear under Past Visits with photos and notes from the day.",
        ],
      },
    ],
  },
  {
    id: "credits-payments",
    title: "Credits, Payments & Receipts",
    icon: "fa-wallet",
    color: "text-shSecondary",
    overview: "Where to see your prepaid visits, buy more, review what you've paid, and get a receipt.",
    cards: [
      {
        title: "View your prepaid visits",
        badges: ["Beginner"],
        path: "Home → Credits card · Home → More → Prepaid Visits",
        steps: [
          "The Credits card on Home shows your remaining balance for each type (daycare, boarding, training).",
          "When a visit is paid with a prepaid credit, the receipt shows the visit's value with nothing due — the pack was paid for up front.",
          "Grooming, add-ons, and boarding late-pickup charges are paid at the visit, not from a pack.",
        ],
      },
      {
        title: "Buy more",
        badges: ["Beginner"],
        steps: [
          "Tap Buy More on the Credits card, or the \"Need more?\" prompt when you're running low — both take you to the Shop's Prepaid Visits tab.",
        ],
      },
      {
        title: "Payments, receipts & payment plans",
        badges: ["Beginner"],
        path: "Payments",
        steps: [
          "Payments shows every invoice with its status. Open one to View, Print, or Email the receipt — it carries your business's logo and the service dates.",
          "A balance you owe shows in a banner on Home and can be paid by card right there; credit on file shows the same way.",
          "If your business set up a payment plan for you (for example an 8-week training program), it lists each installment, Due or Paid, with its due date.",
        ],
        mistake: "The portal only shows your own balances and receipts — never your business's internal bookkeeping or other clients' information.",
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
          "Tap Messages (desktop sidebar) or the message button at the top of the portal on a phone.",
          "Hit New Message, pick a topic (Booking / Vaccines / Payments / Other) and write your message. Questions sent from a School lesson via Ask Your Trainer arrive here too.",
          "When your business replies, the Messages button shows an orange unread count — tap it, open the thread, and reply from the bottom.",
        ],
        tip: "A resolved thread automatically re-opens if you reply again — no need to start a new conversation.",
      },
    ],
  },
  {
    id: "rewards",
    title: "Trophies, Streaks & Referrals",
    icon: "fa-trophy",
    color: "text-shAccent",
    overview: "Trophies for your dog and for you, a Practice streak, and a referral program, if your business has them turned on.",
    cards: [
      {
        title: "Trophies",
        badges: ["Beginner", "Only shown if enabled"],
        path: "Home → More → Rewards · School → Progress → Achievements",
        steps: [
          "Your dog earns trophies for skills mastered, checkpoints passed, and programs completed; you earn them for Practice streaks, Practice assignments completed, lifetime visits (every visit counts, however old), and successful referrals.",
          "New trophies pop up with a celebration the next time you open the portal, show the artwork your business chose, and can be shared as a card.",
          "The trophy ladder shows what's next and how close you are.",
        ],
      },
      {
        title: "The Practice streak",
        badges: ["Beginner"],
        path: "Home → Practice streak tile",
        steps: [
          "Every day you log a real Practice session counts. The tile shows your current streak, your longest, and the next milestone (3, 7, 14, 30, 60, 100 days).",
          "Streak trophies award automatically when you hit a milestone.",
          "If you've opted into practice reminders, you'll get an email on your chosen days — unless you've already practiced that day.",
        ],
      },
      {
        title: "Refer a friend",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Open Refer a Friend from the sidebar or the More menu.",
          "Share your referral code — when a new client signs up with it and completes their first visit, you get the reward your business offers (commonly a free daycare day) and a referral trophy.",
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
          "On a phone, the bottom bar has: Home, Book, School, Shop, and More.",
          "More opens a sheet with Photography (if offered), My Dogs, Payments, Credits, Rewards, Refer a Friend, and Help.",
          "On larger screens the sidebar lists Home, Book, Online School, Shop, Photography, Messages, then My Dogs, Payments, Credits, Rewards, Refer a Friend, and Help.",
          "School works on a phone: the course trail, Practice Coach, and video checkpoint uploads are built for it.",
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
    <div className="space-y-5 animate-slide-in tutorials-root sh-tutorials-workspace" data-testid="tutorials-screen" data-role={role}>
      <style>{`
        @media print {
          body.tutorials-printing aside,
          body.tutorials-printing header,
          body.tutorials-printing [data-testid="portal-tutorials-overlay"] > header,
          body.tutorials-printing .tutorials-no-print,
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

      <div className="tutorials-no-print">
        <PageHero
          eyebrow={{ text: role === "client" ? "Client guide" : "How to use", icon: "fa-circle-question", color: "text-shSecondary" }}
          title={role === "client" ? "LEARN THE PORTAL." : "KNOW THE APP."}
          highlight={role === "client" ? "STEP BY STEP." : "WITHOUT GUESSING."}
          subtitle={role === "client"
            ? "Booking, Online School, Practice, dogs, payments, receipts, and the phone experience in plain language."
            : "The real Sit Happens operator playbook — Today, Front Desk, schedule, clients, training and School, money, shop, settings, and mobile."}
          right={(
            <div className="sh-tutorials-hero-actions">
              <div className="relative sh-tutorials-search">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-shTextMuted text-[13px]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tutorials…"
                  data-testid="tutorials-search"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded-lg pl-9 pr-3 py-2.5 text-shText text-[14px]"
                />
              </div>
              <PremiumButton onClick={printCurrent} data-testid="tutorials-print-current" variant="secondary" title="Print only the section you're looking at">
                <i className="fas fa-print"/><span className="hidden sm:inline">Print Page</span>
              </PremiumButton>
              <PremiumButton onClick={printAll} data-testid="tutorials-print-all" variant="ghost" title="Print the full guide (all sections)">
                <i className="fas fa-file-pdf"/><span className="hidden sm:inline">Print All</span>
              </PremiumButton>
            </div>
          )}
          testid="tutorials-hero"
        />
      </div>

      <SectionCard accent="cyan" intensity="subtle" className="tutorials-no-print sh-tutorials-quick-section">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="sh-eyebrow text-shSecondary">Quick jumps</p>
            <p className="text-[13px] text-shTextMuted mt-1">Go straight to the job you're trying to do.</p>
          </div>
          <span className="text-[11px] text-shTextMuted font-bold">{quickActions.length} shortcuts</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {quickActions.map(qa => (
            <button
              key={qa.id}
              onClick={() => { setQuery(""); setOpenId(qa.target); }}
              data-testid={`tutorials-quick-${qa.id}`}
              className="sh-tutorial-quick"
            >
              <span className="sh-tutorial-quick__icon"><i className={`fas ${qa.icon}`} /></span>
              <span className="text-[12px] font-bold text-shText leading-tight">{qa.label}</span>
            </button>
          ))}
        </div>
      </SectionCard>

      <div className="tutorials-no-print">
        <AdminTabs
          items={filtered.map((s) => ({ key: s.id, label: s.title, icon: s.icon, testid: `tutorial-chip-${s.id}`, accent: s.color.includes("Accent") ? "orange" : s.color.includes("Primary") ? "lime" : "cyan" }))}
          value={openId}
          onChange={(id) => setOpenId(id)}
          testid="tutorials-section-tabs"
          accent="cyan"
        />
      </div>

      <div className="space-y-5">
        {filtered.map((s) => {
          const isActive = query.trim() || openId === s.id;
          return (
            <div key={s.id} className={`tutorial-section ${isActive ? "" : "hidden print-hidden"}`}>
              <SectionCard accent={s.color.includes("Accent") ? "orange" : s.color.includes("Primary") ? "lime" : "cyan"} intensity="subtle" className="mb-3 sh-tutorial-section-head">
                <div className="flex items-start gap-3">
                  <span className="sh-tutorial-section-icon"><i className={`fas ${s.icon} ${s.color}`} /></span>
                  <div className="min-w-0">
                    <h4 className="text-[18px] font-black text-shText">{s.title}</h4>
                    {s.overview && <p className="text-[14px] text-shTextMuted mt-1 leading-relaxed">{s.overview}</p>}
                  </div>
                </div>
              </SectionCard>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3" data-testid={`tutorial-section-${s.id}`}>
                {s.cards.map((c, i) => (
                  <SectionCard key={i} accent="cyan" intensity="subtle" className="tutorial-card sh-tutorial-card" data-testid={`tutorial-card-${s.id}-${i}`}>
                    <div className="flex items-start gap-3">
                      <span className="sh-tutorial-check"><i className="fas fa-check"/></span>
                      <div className="min-w-0 flex-1">
                        <h5 className="text-shText font-black text-[15px] leading-tight">{c.title}</h5>
                        {(c.badges || []).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {c.badges.map(b => <CardBadge key={b} label={b} />)}
                          </div>
                        )}
                      </div>
                    </div>

                    {c.path && (
                      <p className="mt-3 text-[12px] text-shSecondary bg-shSecondary/10 border border-shSecondary/20 rounded-lg px-3 py-2 font-semibold">
                        <i className="fas fa-location-arrow mr-1.5" />{c.path}
                      </p>
                    )}

                    <ol className="mt-4 space-y-2.5 text-[14px] text-shTextMuted">
                      {(c.steps || []).map((step, j) => (
                        <li key={j} className="flex gap-3 items-start">
                          <span className="sh-tutorial-step">{j + 1}</span>
                          <span className="leading-relaxed pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>

                    {c.tip && (
                      <p className="mt-4 text-[13px] text-shAccent bg-shAccent/5 border border-shAccent/20 rounded-lg p-3 leading-relaxed tip-box">
                        <i className="fas fa-lightbulb mr-1.5"/><strong>Pro tip · </strong>{c.tip}
                      </p>
                    )}
                    {c.mistake && (
                      <p className="mt-3 text-[13px] text-red-300 bg-red-500/5 border border-red-500/25 rounded-lg p-3 leading-relaxed mistake-box">
                        <i className="fas fa-triangle-exclamation mr-1.5"/><strong>Common mistake · </strong>{c.mistake}
                      </p>
                    )}
                    {(c.related || []).length > 0 && (
                      <div className="mt-4 pt-3 border-t border-shBorder">
                        <p className="text-[11px] font-bold text-shTextMuted mb-2">Related</p>
                        <ul className="space-y-1.5">
                          {c.related.map((r, k) => (
                            <li key={k} className="text-[13px] text-shSecondary">
                              <i className="fas fa-arrow-right text-[10px] mr-1.5"/>{r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </SectionCard>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <EmptyState
            icon="fa-magnifying-glass"
            accent="cyan"
            title={`No tutorials match “${query}”`}
            description="Try a feature name like booking, payments, training, shop, or mobile."
          />
        )}
      </div>
    </div>
  );
}

function CardBadge({ label }) {
  const tone = {
    "Beginner": "success",
    "Daily Use": "info",
    "Admin Only": "error",
    "Client-Facing": "special",
    "Setup Only": "warning",
    "Staff-Only": "warning",
    "Optional": "info",
    "Required": "error",
    "Live": "success",
  }[label] || "info";
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}
