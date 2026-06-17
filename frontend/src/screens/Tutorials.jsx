import { useState } from "react";

/**
 * Sprint 110ej — Operator tutorial center.
 *
 * The screen is role-aware: admins see the 11-step operator playbook,
 * clients see the 9-step portal walkthrough. Card schema now includes
 *   - badges[]            ← Beginner / Daily Use / Admin Only / Client-Facing / Setup Only / Coming Soon
 *   - path (optional)     ← "Where to find it" breadcrumb-style string
 *   - steps[]
 *   - tip (optional)      ← Pro tip box
 *   - mistake (optional)  ← Common mistake / pitfall box
 *   - related[] (optional)← Links to related tutorials or app pages
 *
 * Coming-soon features are explicitly labeled — no fake functionality.
 * Search filters across titles, steps, tips, mistakes, and paths.
 */

const ADMIN_QUICK_ACTIONS = [
  { id: "_qa_setup",    label: "First-Time Setup",        icon: "fa-rocket",          target: "start-here" },
  { id: "_qa_runsheet", label: "Daily Run Sheet",         icon: "fa-list-check",      target: "daily-workflow" },
  { id: "_qa_addclient",label: "Add Client & Dog",        icon: "fa-user-plus",       target: "clients-dogs" },
  { id: "_qa_booking",  label: "Create Booking",          icon: "fa-calendar-plus",   target: "bookings-schedule" },
  { id: "_qa_homework", label: "Assign Homework",         icon: "fa-pen-to-square",   target: "homework" },
  { id: "_qa_vaccines", label: "Check Vaccines",          icon: "fa-shield-virus",    target: "compliance" },
  { id: "_qa_pricing",  label: "Update Services & Pricing", icon: "fa-dollar-sign",   target: "payments" },
  { id: "_qa_portal",   label: "Client Portal Setup",     icon: "fa-mobile",          target: "branding" },
  { id: "_qa_backup",   label: "Backup Data",             icon: "fa-database",        target: "system" },
  { id: "_qa_export",   label: "Export CSVs",             icon: "fa-cloud-arrow-down", target: "system" },
  { id: "_qa_bulkemail",label: "Send Bulk Email",         icon: "fa-paper-plane",     target: "bulkemail" },
  { id: "_qa_messages", label: "Client Messages",         icon: "fa-comments",        target: "messages" },
];

const ADMIN_SECTIONS = [
  {
    id: "communications",
    title: "Communication Tools",
    icon: "fa-comments",
    color: "text-shGreen",
    overview: "Two tools for keeping clients in the loop: Bulk Email for one-to-many announcements, and Client Messages for one-to-one back-and-forth. Both feed the existing per-client communication timeline so nothing falls through the cracks.",
    cards: [
      {
        title: "Bulk Client Email",
        badges: ["Live", "Admin Only"],
        path: "Sidebar → Bulk Email",
        steps: [
          "Pick a recipient slice using filter chips: Active clients, Daycare/Boarding/Training clients, Has upcoming bookings, Has missing vaccines, Has NOT switched to the new app, or any combination (filters are AND-combined).",
          "Watch the live recipient counter on the right — it updates the moment you change a chip, and shows the first 50 names so you can sanity-check before hitting send.",
          "Pick a starter template from the Templates tab (Welcome to New App / Switch Reminder / Vaccine / Booking / Policy Update / General) or write your own from scratch.",
          "Use merge tags {{client_first_name}} and {{dog_names}} for personalisation — the live preview shows what your first recipient will actually see.",
          "Hit Send Test to fire a single email to the first matching client and confirm formatting end-to-end before doing the full blast.",
          "Hit Send to {N} clients — a confirmation modal shows the count + subject before anything goes out.",
          "Save any composition as a custom Template for reuse. System templates cannot be deleted; custom ones can.",
          "Every successful send is logged once per recipient in that client's Communications timeline (Type = email · Summary = [Bulk] <subject>) so you have a full audit trail.",
          "The History tab shows every blast: subject, sender, date/time, total recipients, success and failure counts.",
        ],
        tip: "Use the 'Has not switched to the new app' filter to gently nudge old-system clients without spamming the ones who already migrated.",
      },
      {
        title: "Client Messages (Direct Inbox)",
        badges: ["Live", "Permission-gated"],
        path: "Sidebar → Client Messages",
        steps: [
          "A unified inbox of every conversation started by a client from their portal — filter by Status (All / Open / Pending / Resolved) and toggle 'Unread only' to focus.",
          "Search by client name, dog name, or subject from the search box at the top.",
          "Click any thread to open the conversation. Each message bubble shows sender, role and timestamp.",
          "Type your reply and hit Reply — by default it also fires a transactional email to the client (uncheck 'Also email the client' to keep it in-app only).",
          "Change a thread's status (Open / Pending / Resolved) from the top-right of the conversation. Resolved threads automatically reopen if the client replies again.",
          "Internal Notes (bottom of every thread) are visible to all staff with the messages permission but NEVER to the client. Use them for handoff context like 'told her to bring vaccine paperwork on Tuesday'.",
          "Sidebar shows an orange unread badge so you always know when something needs attention. The badge refreshes every 60 seconds.",
          "Every visible message and reply is also logged on the client's Communications timeline (Type = message) so the full history lives in one place.",
        ],
        tip: "Set 'Pending' when you're waiting on info from the client — it gets it out of your Open list without resolving it prematurely.",
      },
      {
        title: "Single-client email (one-off)",
        badges: ["Live", "Admin Only"],
        path: "Clients screen → Hover a client card → Paper-plane icon",
        steps: [
          "Open the Clients screen and hover (or tap on mobile) any client card.",
          "Tap the green paper-plane icon next to Edit/Delete — only shown when the client has an email on file.",
          "Pick a template (optional), write your subject + body, hit Send.",
          "Merge tags {{client_first_name}} and {{dog_names}} work exactly like the bulk tool, with a live preview right in the modal.",
          "The send is logged on the client's Communications timeline and listed in Bulk Email → History (recipient_count = 1, manual_selection = true) so you have one place to audit every email leaving the system.",
        ],
        tip: "Use this for one-off follow-ups (a quick thank-you, a custom quote, a missed-call recap). For groups of clients, stick with Bulk Email so the filter chips do the heavy lifting.",
      },
      {
        title: "Roles & permissions for messaging",
        badges: ["Live", "Reference"],
        steps: [
          "Permission key: messages.",
          "Granted automatically to: Owner (admin), Manager, Trainer, Daycare staff, Boarding staff, Front desk.",
          "Read-only role does NOT get messages access by default — flip them up to Front Desk if they need to reply.",
          "Internal Notes are visible to anyone with the messages permission, so brief staff that the notes are private from clients but visible to teammates.",
        ],
      },
    ],
  },
  {
    id: "ops-command-center",
    title: "Operations Command Center — The New Stack",
    icon: "fa-tower-broadcast",
    color: "text-shOrange",
    overview: "These nine tools turn the app from a booking tracker into a full ops command center. Each one is live and wired into the existing data — open the sidebar to find them.",
    cards: [
      {
        title: "Intake Forms",
        badges: ["Live", "Admin/Manager/Front Desk"],
        path: "Sidebar → Intake Forms",
        steps: [
          "Eleven starter templates ship out of the box (new client, new dog, daycare temperament, boarding, feeding, medication, training eval, service-dog, behavior history, bite disclosure, emergency/vet).",
          "Hit New Form to build your own — short text, long text, dropdown, multi-select, yes/no, file-upload placeholder, plus internal-only staff fields that never reach the client.",
          "From any client or dog card, hit '+ Send' on the Intake Forms section to assign a template — the client sees it in their portal next time they log in.",
          "Submissions arrive with statuses: Sent / Submitted / Reviewed / Needs Follow-up / Archived. Click any submission to read the answers and leave admin review notes.",
        ],
      },
      {
        title: "Care Board (Feeding & Medication)",
        badges: ["Live", "All staff"],
        path: "Sidebar → Care Board",
        steps: [
          "Auto-pulls today's feeding + meds for every on-site dog and sorts by time.",
          "Each card shows status pills: Not due / Due now / Completed / Missed / Skipped, with a live overdue timer.",
          "Tap Complete to log staff initials + optional note; tap Skip with one of six preset reasons.",
          "The schedule auto-seeds from each dog's default feeding/medication plan on the dog profile — edit the dog to update defaults.",
          "Auto-refreshes every 60 seconds so 'Due now' rolls into 'Missed' without you hitting refresh.",
        ],
      },
      {
        title: "Waitlist + Capacity Guardrail",
        badges: ["Live", "All staff"],
        path: "Sidebar → Waitlist",
        steps: [
          "When daycare or boarding is at capacity, drop the client on the waitlist instead of bouncing them off a booking error.",
          "Each entry carries priority (Low / Normal / High), service type, requested date range, and notes.",
          "Status flow: Waiting → Offered → Booked / Declined / Expired / Removed.",
          "Hit Convert on a waiting entry to create the real booking — this bypasses the daily cap (admin override) but still runs every other check (vaccines, waiver, conflicts).",
          "The Add modal shows a live 'X of Y slots open today' check so staff can decide on the spot whether to book or queue.",
        ],
      },
      {
        title: "Kennel Board",
        badges: ["Live", "Care/Dog perms"],
        path: "Sidebar → Kennel Board",
        steps: [
          "One card per on-site dog grouped by service: Daycare / Boarding / Training / Grooming / Photography.",
          "Each card has 5 assignment slots (Kennel / Room / Crate / Yard group / Training group) — click the card to edit.",
          "Edit the dropdown options anywhere via the Labels button — one label per line, e.g. 'Kennel A, Kennel B, Suite 1'.",
          "Warning badges fire automatically: vaccine lapsed, overdue medication, do-not-group flag, open incident, has feeding plan, has med plan.",
          "Auto-refreshes every 60s.",
        ],
      },
      {
        title: "Incidents + Safety Flags (with auto-suggest)",
        badges: ["Live", "Admin/Manager/Trainer/Staff"],
        path: "Sidebar → Incidents · Per-dog flags on Dogs cards",
        steps: [
          "Incidents now support four severity tiers (Low / Medium / High / Critical) and 11 types (Bite, Fight, Injury, Illness, Escape attempt, Resource guarding, Reactivity, Human/Dog aggression, Property damage, Other).",
          "Each incident captures staff involved, witnesses, action taken, Manager Reviewed and Client Notified toggles, plus internal-only notes that never appear on client-facing surfaces.",
          "Safety Flags live on every dog card. Suggestions appear in an orange callout based on incident history + intake form answers (e.g. a logged bite auto-suggests Muzzle required + Staff only).",
          "Click any suggested flag to apply it instantly. Custom flags can also be added manually.",
        ],
      },
      {
        title: "Audit Log",
        badges: ["Live", "Admin/Manager"],
        path: "Sidebar → Audit Log",
        steps: [
          "Every staff/admin write (POST/PUT/PATCH/DELETE) is captured automatically — no manual logging required.",
          "Filter by group (Bookings, Dogs, Clients, Incidents, Intake, Waitlist, Money, Settings, Waivers), user, or free-text search.",
          "Click any row to expand the payload — passwords, tokens, and card numbers are auto-redacted.",
          "Date-grouped timeline so you can see exactly what happened on a given day.",
        ],
      },
      {
        title: "Roles & Permissions",
        badges: ["Live", "Admin only"],
        path: "Sidebar → Staff (Roles panel at top)",
        steps: [
          "Seven roles: Owner / Manager / Trainer / Daycare Staff / Boarding Staff / Front Desk / Read-only.",
          "Each role unlocks a specific slice of 13 permissions (Settings, Finance, Pricing, Clients view/edit, Dogs view/edit, Incidents, Care logging, Booking edits, Payroll, Data export, Delete records).",
          "New staff default to Read-only so a brand-new account can't accidentally do anything destructive — Owner upgrades them in one dropdown.",
          "The sidebar nav auto-hides items a staffer doesn't have permission to use, so the UI is never confusing.",
          "Click 'Show permission matrix' inside the Staff Roles panel for the full grid.",
        ],
      },
      {
        title: "Communication Log",
        badges: ["Live", "All staff"],
        path: "Per client card · Per dog card",
        steps: [
          "Log every phone call, voicemail, text, email, in-person chat, behavior conversation, schedule change, payment discussion, complaint, follow-up, or general note.",
          "Each entry stamps the staff member + timestamp automatically.",
          "Mark 'Follow-up needed' to surface the entry with an orange ring until someone resolves it.",
          "Filter pills appear once you have more than 3 entries — by type or 'Open follow-ups' only.",
          "Review requests get auto-logged here too, so the contact history stays cohesive.",
        ],
      },
      {
        title: "Review Requests",
        badges: ["Live", "All staff"],
        path: "Per client/dog card · Pipeline completed · Report Card modal",
        steps: [
          "First, drop your Google + Facebook (+ optional Yelp) review URLs into Settings → Marketing → Review Links along with your default request message.",
          "On every client or dog card, hit Request Review to open a modal with one-click Google / Facebook buttons — clicking opens the link in a new tab AND logs the request.",
          "Or pick Text / Email / In-person / Other to log a non-link request.",
          "Copy Message uses your template with {first_name} and {dog_name} substituted in.",
          "The button also appears in the Pipeline screen on completed training programs and on report cards that have been sent — the natural 'they're happy, ask now' moments.",
          "Every request auto-logs an entry on the client's communication timeline with a back-link.",
        ],
      },
    ],
  },
  {
    id: "start-here",
    title: "Start Here — First-Time Setup",
    icon: "fa-rocket",
    color: "text-shGreen",
    overview: "Do these in order. Each step unlocks the next part of the app — by the end your business is ready for its first booking.",
    cards: [
      {
        title: "Step 1 — Set your business hours",
        badges: ["Setup Only", "Admin Only"],
        path: "Settings → Business Operations → Hours & Closures",
        steps: [
          "Open the Settings tab.",
          "Click the Business Operations category.",
          "Open Hours & Closures.",
          "For each service (Daycare, Boarding, Grooming, Training), set the open and close time for every day you're open.",
          "Add any planned closure dates (holidays, vet visits, conference days).",
          "Hit Save Changes.",
        ],
        tip: "Daycare and boarding can have different hours — daycare ends at 6pm but boarding pickup runs until 8pm, for example.",
        mistake: "Forgetting to set Saturday/Sunday hours means clients can't book weekends online even if you're open.",
      },
      {
        title: "Step 2 — Define your services and prices",
        badges: ["Setup Only"],
        path: "Settings → Services & Pricing → Services & Programs",
        steps: [
          "Open Settings → Services & Pricing → Services & Programs.",
          "Review the default Daycare / Boarding / Grooming / Training services.",
          "Edit each one's base price, duration, and description.",
          "Add any specialty services you offer (private training, bath only, nail trim, photography).",
          "Toggle Active on/off to control which services appear to clients.",
        ],
        related: ["Settings → Services & Pricing → Credit Packs", "Settings → Services & Pricing → Payment Plans"],
      },
      {
        title: "Step 3 — Set capacity and add kennels",
        badges: ["Setup Only", "Admin Only"],
        path: "Settings → Business Operations → Capacity & Kennels",
        steps: [
          "Open Capacity & Kennels.",
          "Set your max daycare dogs per day (e.g. 30).",
          "Add every kennel/boarding suite — give each a label (Suite 1, Outdoor Run, etc.).",
          "Mark which kennels are small/medium/large if you size-match.",
        ],
        mistake: "Setting capacity higher than you can actually staff. Pick a number you'd be calm with on a bad-weather Monday.",
      },
      {
        title: "Step 4 — Lock down vaccine requirements",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Clients, Dogs & Compliance → Vaccine Requirements",
        steps: [
          "Toggle ON every vaccine you require (Rabies is on by default).",
          "Common required: Rabies, DHPP, Bordetella. Optional: Lepto, Influenza.",
          "Set a warning lead-time (default 30 days) so the system flags expiring vaccines.",
        ],
        tip: "Open the Compliance Rules card next to control what happens when a vaccine is missing — block bookings, warn only, or grace period.",
      },
      {
        title: "Step 5 — Add your waiver",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Clients, Dogs & Compliance → Waiver",
        steps: [
          "Paste your waiver text into the editor.",
          "Tick Require for booking so new clients can't book without accepting.",
          "Optional: set Re-sign frequency (yearly is common).",
        ],
      },
      {
        title: "Step 6 — Configure email and notifications",
        badges: ["Setup Only"],
        path: "Settings → Email & Notifications",
        steps: [
          "Open Email Designer — set your sender name, signature, and tweak any template wording.",
          "Open Email Timing & Quiet Hours — set reminder lead-time (24h is normal) and quiet hours (e.g. 8pm–8am).",
          "Open Email Automation — toggle which automations fire (booking confirmations, reminders, review requests).",
        ],
        mistake: "Skipping the Email Health pill check. If SPF/DKIM isn't configured at Resend, no emails will reach your clients.",
      },
      {
        title: "Step 7 — Change your admin password",
        badges: ["Setup Only", "Admin Only"],
        path: "Settings → System & Data → My Account",
        steps: [
          "Open My Account.",
          "Enter the seeded admin password (you got it on first login).",
          "Choose a strong new password.",
          "Save.",
        ],
      },
      {
        title: "Step 8 — Install Sit Happens on your home screen",
        badges: ["Setup Only", "Daily Use"],
        steps: [
          "Look for the green 'Install App' button at the bottom of the sidebar.",
          "Click it — you'll see the native install dialog OR a step-by-step modal.",
          "On iPhone: tap Share → Add to Home Screen.",
          "Once installed, Sit Happens opens in its own window with no browser bar.",
        ],
        tip: "Install it on your phone, tablet AND front-desk computer. Same data, three devices.",
      },
    ],
  },
  {
    id: "daily-workflow",
    title: "Daily Workflow",
    icon: "fa-sun",
    color: "text-shOrange",
    overview: "The 8 things you do in the same order every morning. Bookmark this section if you're a new staff member.",
    cards: [
      {
        title: "Morning — Check the Dashboard first",
        badges: ["Daily Use"],
        path: "Sidebar → Dashboard",
        steps: [
          "Glance at today's revenue gauge and capacity tile.",
          "Scan Today's Tasks (top right) — any vaccine expiries, follow-ups, or low-credit warnings will surface here.",
          "If there's a red flag, click it to jump straight to the issue.",
        ],
      },
      {
        title: "Pull up today's Run Sheet",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Run Sheet",
        steps: [
          "Run Sheet shows every dog scheduled today with their feeding/meds notes.",
          "Print it or open it on a tablet at the front desk.",
          "Tick each dog off as they check in.",
        ],
        tip: "If a dog is on a special diet or medication, it's flagged with an orange pill — don't miss it.",
      },
      {
        title: "Confirm pending bookings",
        badges: ["Daily Use"],
        path: "Sidebar → Bookings",
        steps: [
          "Filter by Status = Pending.",
          "Open each one, double-check the dog's vaccines are current.",
          "Approve, Reject, or message the client for clarification.",
          "Approved bookings auto-send a confirmation email.",
        ],
      },
      {
        title: "Address vaccine and waiver warnings",
        badges: ["Daily Use", "Admin Only"],
        path: "Sidebar → Dashboard → Today's Tasks",
        steps: [
          "Any dog with an expiring or expired vaccine shows under Today's Tasks.",
          "Open the dog → Vaccines tab → upload or type in the new expiry date.",
          "Dogs without a current waiver are also flagged — message the client a re-sign link.",
        ],
        mistake: "Letting expired vaccines pile up. Once a dog goes 30+ days expired, your bookings can auto-block depending on Compliance Rules.",
      },
      {
        title: "Mark training homework as the day unfolds",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Homework",
        steps: [
          "Open Homework → today's assignments are at the top.",
          "Tap a homework card → mark each task complete as the trainer works through it.",
          "Add a note for the client to read in their portal.",
        ],
      },
      {
        title: "Log incidents the moment they happen",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Incidents",
        steps: [
          "Sidebar → Incidents → + New Incident.",
          "Pick the dog, severity (minor/major), describe what happened.",
          "If it's major, the admin gets a notification.",
          "Always log even small stuff (vomiting, limping, scuffles) — the timeline is invaluable later.",
        ],
        tip: "Better to over-log than under-log. Owners appreciate knowing about small things proactively.",
      },
      {
        title: "End of day — check out everyone, log retail",
        badges: ["Daily Use"],
        path: "Sidebar → Schedule",
        steps: [
          "Open Schedule → today.",
          "For each dog leaving, tap Check Out.",
          "If they bought treats or merch on their way out, log it under Income → New Sale.",
          "Any tip the client added shows on the receipt.",
        ],
      },
    ],
  },
  {
    id: "clients-dogs",
    title: "Clients & Dogs",
    icon: "fa-paw",
    color: "text-shBlue",
    overview: "Everything about adding, updating, and looking up the families and dogs you work with.",
    cards: [
      {
        title: "Add a new client",
        badges: ["Daily Use"],
        path: "Sidebar → Clients → + Add Client",
        steps: [
          "Click + Add Client.",
          "Fill in name, email, phone, address, emergency contact.",
          "Tick Create portal login if you want them to be able to book online — set a starter password.",
          "Save. They'll receive a welcome email with their login link.",
        ],
        tip: "Clients can also self-sign-up. Send them your portal URL and they tap Register — their record auto-creates.",
      },
      {
        title: "Add a dog to a client",
        badges: ["Daily Use"],
        path: "Sidebar → Dogs → + Add Dog",
        steps: [
          "Pick the owner from the dropdown.",
          "Basics: name, breed, sex, birthday, fixed/intact.",
          "Vaccines: enter rabies expiry (required) plus any other vaccines you require.",
          "Feeding & Meds: add daily feedings and any medications — these show on the Run Sheet.",
          "Notes & Vet: vet name, vet phone, anything else worth remembering.",
        ],
      },
      {
        title: "Update dog notes and behavior flags",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Dogs → open a dog → Notes & Behavior",
        steps: [
          "Open the dog's profile.",
          "Scroll to Notes & Behavior.",
          "Add a date-stamped note (e.g. 'Reactive to skateboards — keep on leash near front').",
          "Toggle any risk flags that apply (resource guarding, fear-aggressive, escape artist).",
        ],
        mistake: "Free-text notes nobody reads. Use the flag toggles too — those appear as colored pills on the Schedule view.",
      },
      {
        title: "View a client's full history",
        badges: ["Daily Use"],
        path: "Sidebar → Clients → open a client",
        steps: [
          "Open any client.",
          "Scroll down — every booking, payment, credit pack, waiver, and trophy is timestamped.",
          "Use the 'Bookings' filter to see only past visits.",
        ],
      },
      {
        title: "Recover a client's login",
        badges: ["Admin Only"],
        path: "Sidebar → Clients → open a client → Account section",
        steps: [
          "Open the client's profile.",
          "Account section → click Send Password Reset.",
          "They get an email with a one-time reset link (valid 24h).",
        ],
        tip: "If they don't see the email, ask them to check spam, then check the Email Health pill (Settings → Email & Notifications → Email Designer).",
      },
    ],
  },
  {
    id: "bookings-schedule",
    title: "Bookings & Schedule",
    icon: "fa-calendar-check",
    color: "text-shGreen",
    overview: "Create, edit, cancel, and read the schedule. Plus how the capacity warnings work.",
    cards: [
      {
        title: "Create a booking from the admin side",
        badges: ["Daily Use"],
        path: "Sidebar → Bookings → New Booking",
        steps: [
          "Click New Booking.",
          "Pick the client, then their dog.",
          "Pick the service (daycare / boarding / training / grooming).",
          "Set the start and (for boarding) end date.",
          "Optional add-ons: bath, nail trim, photography.",
          "Save — confirmation email auto-sends.",
        ],
      },
      {
        title: "Edit or reschedule a booking",
        badges: ["Daily Use"],
        path: "Sidebar → Bookings → open one",
        steps: [
          "Open the booking row.",
          "Click Edit.",
          "Change date, time, or service.",
          "Save — the client gets a notification about the change.",
        ],
        mistake: "Editing a checked-out booking. Once checked out, it's a closed receipt — you can only reverse it via the payment reversal flow.",
      },
      {
        title: "Cancel a booking",
        badges: ["Daily Use"],
        path: "Sidebar → Bookings → open one → Cancel",
        steps: [
          "Open the booking → click Cancel.",
          "Pick the reason (client request, sick dog, weather, etc.).",
          "The cancellation fee tier is auto-calculated from your Money Rules.",
          "Confirm — the client is emailed about the cancellation and any fee.",
        ],
        tip: "Cancellation fees are tiered: free outside the window, partial inside it, full for no-shows. Configure under Settings → Services & Pricing → Money Rules.",
      },
      {
        title: "Set up recurring bookings",
        badges: ["Daily Use"],
        path: "Sidebar → Recurring",
        steps: [
          "Open Recurring from the sidebar.",
          "+ New Recurring → pick client and dog.",
          "Choose days of week (e.g. every Mon/Wed/Fri).",
          "Set start date and (optionally) end date.",
          "Bookings auto-generate from this template.",
        ],
      },
      {
        title: "Read the Schedule view",
        badges: ["Daily Use"],
        path: "Sidebar → Schedule",
        steps: [
          "Switch between Day / Week / Month at the top.",
          "Colored dots represent each booking by service.",
          "Click any booking for the detail card.",
          "On the Day view you'll see capacity ticks fill up — once you hit your daycare cap, new same-day requests get blocked.",
        ],
        related: ["Settings → Business Operations → Booking Guardrails"],
      },
      {
        title: "Understanding capacity warnings",
        badges: ["Daily Use", "Admin Only"],
        steps: [
          "When daycare hits the cap, new requests show as red on the public booking page.",
          "Admins can still force-book past capacity (a confirm dialog asks you to acknowledge).",
          "Boarding works on kennel slots, not a single number — each kennel can hold one dog at a time.",
        ],
      },
    ],
  },
  {
    id: "training-pipeline",
    title: "Training Programs & Pipeline",
    icon: "fa-graduation-cap",
    color: "text-shGreen",
    overview: "Sell training programs, move clients through stages, track progress.",
    cards: [
      {
        title: "Add a new training client to the pipeline",
        badges: ["Daily Use", "Admin Only"],
        path: "Sidebar → Pipeline → + New",
        steps: [
          "Click + New on the Pipeline screen.",
          "Pick the client and dog.",
          "Choose the training program (Puppy Foundation, Reactive Rehab, etc.).",
          "Set stage to 'Intake'.",
          "Save.",
        ],
      },
      {
        title: "Move a client through stages",
        badges: ["Daily Use", "Admin Only"],
        steps: [
          "Open the pipeline card.",
          "Drag the card from column to column (Intake → Assessment → Active → Graduating → Graduated).",
          "Each stage move auto-logs a timestamp.",
        ],
        tip: "If you charge the program as a payment plan, set the plan up first (Services & Pricing → Payment Plans) so installments are tied to the pipeline stage.",
      },
      {
        title: "Assign homework",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Homework → + New",
        steps: [
          "Click + New Homework.",
          "Pick the client/dog.",
          "Pick a template (Sit, Loose-leash walking, Place command) OR write custom tasks.",
          "Set due date.",
          "Save — the client sees it in their portal immediately.",
        ],
      },
      {
        title: "Track progress and review",
        badges: ["Daily Use", "Staff-Only"],
        path: "Sidebar → Pipeline → open a card → Progress",
        steps: [
          "Open the pipeline card.",
          "Scroll to Progress — every homework, session, and trainer note is timestamped.",
          "Add session notes after each in-person training session.",
          "Mark Graduation when ready.",
        ],
      },
      {
        title: "Use the standard training commands library",
        badges: ["Staff-Only"],
        path: "Settings → Clients, Dogs & Compliance → Training Commands",
        steps: [
          "Open Training Commands.",
          "Add/edit the standard commands menu (Sit, Down, Place, Heel, etc.).",
          "These appear on every dog's profile under Training and on homework templates.",
        ],
      },
    ],
  },
  {
    id: "homework",
    title: "Homework & Daily Plans",
    icon: "fa-pen-to-square",
    color: "text-purple-300",
    overview: "How homework is created, assigned, marked, and reviewed.",
    cards: [
      {
        title: "Create a homework template",
        badges: ["Setup Only"],
        path: "Sidebar → Homework → Templates",
        steps: [
          "Open Templates.",
          "+ New Template → name it (e.g. 'Loose-Leash Foundation').",
          "Add a checklist of tasks.",
          "Save. You can now apply this template in one click when creating new homework.",
        ],
      },
      {
        title: "Assign homework to a client/dog",
        badges: ["Daily Use", "Staff-Only"],
        steps: [
          "Sidebar → Homework → + New.",
          "Pick client and dog.",
          "Pick a template or write custom tasks.",
          "Set due date.",
          "Save → client sees it in their portal and gets a notification.",
        ],
      },
      {
        title: "Update homework status",
        badges: ["Daily Use", "Staff-Only"],
        steps: [
          "Open the homework card.",
          "Tick off each task as the trainer completes it.",
          "Add a note (e.g. 'Buddy held the sit-stay for 30 sec at distance').",
          "Mark Complete when done.",
        ],
        tip: "If the client marked it complete first but you disagree, leave a note and bump it back to In Progress — they'll see your reason.",
      },
      {
        title: "Review homework on the Dashboard",
        badges: ["Daily Use"],
        path: "Sidebar → Dashboard",
        steps: [
          "Dashboard shows the homework you owe an update on (top right).",
          "Click any row to jump directly into that homework.",
        ],
      },
    ],
  },
  {
    id: "payments",
    title: "Payments, Income & Services",
    icon: "fa-dollar-sign",
    color: "text-shGreen",
    overview: "Pricing, packs, plans, the P&L, and how the cash-basis ledger works.",
    cards: [
      {
        title: "Set service pricing",
        badges: ["Setup Only"],
        path: "Settings → Services & Pricing → Services & Programs",
        steps: [
          "Open Services & Programs.",
          "Edit base price, duration, and which add-ons apply per service.",
          "Save.",
        ],
        related: ["Settings → Services & Pricing → Money Rules", "Settings → Services & Pricing → Holiday & Peak-Season Pricing"],
      },
      {
        title: "Create a credit pack",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Services & Pricing → Credit Packs",
        steps: [
          "Open Credit Packs.",
          "+ New Pack → set the service, quantity, and price.",
          "Save → the pack is now available to sell to clients.",
        ],
        tip: "When you sell a pack, the revenue hits your P&L immediately (cash-basis rule). Burning a credit at checkout = $0 P&L impact.",
      },
      {
        title: "Sell a payment plan for a big-ticket purchase",
        badges: ["Admin Only"],
        path: "Sidebar → Clients → open client → Payment Plans",
        steps: [
          "Open the client's profile.",
          "Click New Payment Plan.",
          "Pick the service/program (e.g. 8-week training).",
          "Set the installment schedule (e.g. 4 weekly payments).",
          "Save — the first installment marks Due, and revenue hits the P&L only as each is marked Paid.",
        ],
        mistake: "Marking a future installment Paid before the cash has actually cleared — fix it via the Reverse Payment button.",
      },
      {
        title: "Track daily / weekly / monthly income",
        badges: ["Daily Use", "Admin Only"],
        path: "Sidebar → Income",
        steps: [
          "Income screen has KPI tiles (Completed / Paid / Unpaid / Booked Upcoming).",
          "Switch the date range with the picker.",
          "Auto-grouped Month → Day so you can drill into any day.",
          "Watch the green 'Auto-email P&L' status pill at the top — that's confirming the monthly auto-send is healthy.",
        ],
      },
      {
        title: "Read the P&L PDF",
        badges: ["Admin Only"],
        path: "Sidebar → Income → Email Me / Download PDF",
        steps: [
          "Click Email Me to mail the P&L to your inbox now, or Download to grab the PDF directly.",
          "Top: net income, expenses, payroll.",
          "Middle: Cash Flow Ledger (Pre-paid In / Register Cash In / Credits Redeemed).",
          "Bottom: daily revenue chart, top clients, top dogs, retail breakdown.",
        ],
      },
    ],
  },
  {
    id: "compliance",
    title: "Vaccines, Waivers & Compliance",
    icon: "fa-shield-virus",
    color: "text-red-400",
    overview: "Block bookings on missing vaccines, expired waivers, and any compliance gap.",
    cards: [
      {
        title: "Set which vaccines you require",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Clients, Dogs & Compliance → Vaccine Requirements",
        steps: [
          "Toggle each required vaccine on.",
          "Rabies is on by default.",
          "Set the warning lead time (default 30 days before expiry).",
        ],
      },
      {
        title: "Add or update a dog's vaccine records",
        badges: ["Daily Use"],
        path: "Sidebar → Dogs → open dog → Vaccines",
        steps: [
          "Open the dog → Vaccines tab.",
          "Enter the expiry date for each vaccine.",
          "Optionally upload the vet certificate (PDF or photo).",
          "Save.",
        ],
      },
      {
        title: "Require waiver signature before booking",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Clients, Dogs & Compliance → Waiver",
        steps: [
          "Open Waiver.",
          "Paste your waiver text.",
          "Tick 'Require for booking'.",
          "Optionally set a re-sign frequency (yearly is common).",
        ],
      },
      {
        title: "Read the compliance warnings on the Dashboard",
        badges: ["Daily Use"],
        path: "Sidebar → Dashboard",
        steps: [
          "Expiring vaccines + missing waivers appear under Today's Tasks.",
          "Click any to jump to that dog or client.",
        ],
      },
      {
        title: "Configure block-on-missing behavior",
        badges: ["Admin Only"],
        path: "Settings → Clients, Dogs & Compliance → Compliance Rules",
        steps: [
          "Open Compliance Rules.",
          "Decide: hard block, warn-only, or grace period.",
          "Recommended: hard block for rabies, warn-only for everything else.",
        ],
      },
    ],
  },
  {
    id: "email",
    title: "Email & Notifications",
    icon: "fa-paper-plane",
    color: "text-shGreen",
    overview: "Every email path, who gets what when, and how to confirm it's actually delivering.",
    cards: [
      {
        title: "What gets sent automatically",
        badges: ["Daily Use"],
        steps: [
          "Booking confirmation — when admin approves a pending booking.",
          "Booking reminder — N hours before (configurable).",
          "Review request — N hours after checkout (configurable).",
          "Vaccine reminder — when a vaccine is approaching expiry.",
          "Waiver re-sign — when waiver expires.",
          "Payment receipt — at checkout.",
          "Monthly P&L — to admin only, on the 1st of each month.",
        ],
      },
      {
        title: "Customize an email template",
        badges: ["Admin Only", "Client-Facing"],
        path: "Settings → Email & Notifications → Email Designer",
        steps: [
          "Open Email Designer.",
          "Pick the template (32 to choose from).",
          "Edit the subject and body — use the variable picker to insert dog/client/booking data.",
          "Click Send Test — a sample lands in your inbox so you can preview.",
          "Save.",
        ],
        tip: "The Email Health pill at the top tells you instantly if Resend can actually send. Green = healthy, red = your sender domain isn't verified.",
      },
      {
        title: "Adjust quiet hours and timing",
        badges: ["Admin Only"],
        path: "Settings → Email & Notifications → Email Timing & Quiet Hours",
        steps: [
          "Set quiet hours window (e.g. 8pm–8am).",
          "Set reminder lead time (e.g. 24h before the booking).",
          "Set review-request delay (e.g. 2h after checkout).",
        ],
      },
      {
        title: "Text messages (SMS)",
        badges: ["Coming Soon"],
        steps: [
          "SMS reminders via Twilio are on the roadmap.",
          "For now, all reminders go via email.",
        ],
      },
    ],
  },
  {
    id: "branding",
    title: "Branding & Client Portal",
    icon: "fa-palette",
    color: "text-shBlue",
    overview: "Your logo, colors, public copy, and what clients see in the portal.",
    cards: [
      {
        title: "Upload your logo and set brand colors",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Marketing & Branding → Brand & Theme",
        steps: [
          "Open Brand & Theme.",
          "Upload your logo (PNG or SVG, transparent background works best).",
          "Set primary, secondary, and accent colors.",
          "Optionally swap the font.",
          "Save — changes apply across the app and the client portal.",
        ],
      },
      {
        title: "Write public service descriptions",
        badges: ["Setup Only", "Client-Facing"],
        path: "Settings → Marketing & Branding → Public Service Info",
        steps: [
          "Open Public Service Info.",
          "For each service, write a 2-3 sentence description in plain language.",
          "These appear on the booking page and in confirmation emails.",
        ],
      },
      {
        title: "Add portal links",
        badges: ["Optional", "Client-Facing"],
        path: "Settings → Marketing & Branding → Portal Links",
        steps: [
          "Open Portal Links.",
          "Add outbound links you want clients to see (Instagram, Google Reviews, FAQ).",
          "These render as buttons on the client portal sidebar.",
        ],
      },
      {
        title: "Generate marketing QR codes",
        badges: ["Optional", "Admin Only"],
        path: "Settings → Marketing & Branding → Marketing QR Codes",
        steps: [
          "Open Marketing QR Codes.",
          "Pick a destination (homepage, booking page, Instagram, etc.).",
          "Download the PNG.",
          "Print on flyers, business cards, kennel-door signs.",
        ],
      },
    ],
  },
  {
    id: "system",
    title: "Backups, Self-Hosting & Data",
    icon: "fa-shield-halved",
    color: "text-shBlue",
    overview: "Keep your data safe and know what to do when something goes wrong.",
    cards: [
      {
        title: "Take a manual backup",
        badges: ["Admin Only"],
        path: "Settings → System & Data → Backup & Restore",
        steps: [
          "Open Backup & Restore.",
          "Click Snapshot Now.",
          "Wait 10-30 seconds — you'll get a downloadable .gz file.",
          "Save it somewhere outside the server (Google Drive, external HD).",
        ],
        tip: "Do this before any big config change. Restoring from a snapshot is a 3-click rollback.",
      },
      {
        title: "Restore from a backup",
        badges: ["Admin Only"],
        path: "Settings → System & Data → Backup & Restore",
        steps: [
          "Open Backup & Restore.",
          "Upload the .gz file.",
          "Confirm — this overwrites your current data.",
          "Wait for the restart.",
        ],
        mistake: "Restoring without a fresh snapshot first. Always backup the current state before overwriting.",
      },
      {
        title: "Check the server error log",
        badges: ["Admin Only"],
        path: "Settings → System & Data → Server Errors",
        steps: [
          "Open Server Errors.",
          "Latest errors at the top.",
          "If something's broken, copy the error message and contact support.",
        ],
      },
      {
        title: "Self-hosting notes",
        badges: ["Admin Only"],
        steps: [
          "Sit Happens runs on any modern Linux box with Docker.",
          "MongoDB stores everything — backups are full DB snapshots.",
          "The app auto-restarts if the container crashes.",
          "For HTTPS, put it behind Cloudflare or Caddy.",
        ],
      },
      {
        title: "Data export (CSV)",
        badges: ["Live", "Admin Only"],
        path: "Settings → System & Data → Data Export",
        steps: [
          "Twelve one-click downloads: Clients, Dogs, Bookings, Waitlist, Intake Templates, Intake Submissions, Incidents, Safety Flags, Vaccines, Income, Communications, Staff Time-Clock.",
          "Each row shows the current count so you know exactly what'll land in the file.",
          "Click Download CSV — your browser saves a date-stamped file (e.g. sithappens-clients-2026-02-15.csv).",
          "Nested data (vaccines, safety flags) is stored as JSON inside the cell so the spreadsheet stays a single tidy row per record.",
        ],
        tip: "Hand these straight to your bookkeeper, run pivot tables in Google Sheets, or use them as a paper trail before any major data migration.",
      },
      {
        title: "Operational Readiness Checklist",
        badges: ["Live", "Admin Only"],
        path: "Dashboard (top of screen)",
        steps: [
          "Nine setup checks that confirm your app is ready to run hands-free: business hours, services & pricing, vaccine rules, waiver, intake templates, review links, staff roles, kennel labels, first backup.",
          "Each unfinished item shows a one-tap Fix button that jumps straight to the right Settings page.",
          "Collapses into a single chip once everything is done so it doesn't clutter the dashboard.",
        ],
        tip: "If you're handing the dashboard off to a new staffer, this checklist is the fastest way to spot what's missing.",
      },
    ],
  },
];

const CLIENT_QUICK_ACTIONS = [
  { id: "_cqa_login",     label: "Log In",              icon: "fa-right-to-bracket", target: "getting-started" },
  { id: "_cqa_profile",   label: "Update My Info",      icon: "fa-user",             target: "client-profile" },
  { id: "_cqa_dog",       label: "Add My Dog",          icon: "fa-paw",              target: "dog-profile" },
  { id: "_cqa_book",      label: "Book a Visit",        icon: "fa-calendar-plus",    target: "booking" },
  { id: "_cqa_vaccines",  label: "Upload Vaccines",     icon: "fa-shield-virus",     target: "vaccines-waivers" },
  { id: "_cqa_homework",  label: "View Homework",       icon: "fa-pen-to-square",    target: "homework-training" },
  { id: "_cqa_install",   label: "Install on Phone",    icon: "fa-mobile",           target: "app-install" },
];

const CLIENT_SECTIONS = [
  {
    id: "messages",
    title: "Send a message to the team",
    icon: "fa-comments",
    color: "text-shGreen",
    overview: "Need to ask something? Use the Messages button at the top of the portal — it's like a mini inbox between you and the Sit Happens team.",
    cards: [
      {
        title: "Send a new message",
        badges: ["Beginner"],
        steps: [
          "Tap the green 'Messages' button at the top-right of the portal header.",
          "Hit 'New Message'.",
          "Pick what it's about (Booking / Daycare / Boarding / Training / Vaccines / Forms / Payments / Dog Records / Other) and which dog (optional).",
          "Add a short subject and type your message — same as texting.",
          "Tap Send. You'll see your message right away inside the app.",
        ],
        tip: "If you'd rather not pick a category, just leave it on 'Something else' and write what's on your mind.",
      },
      {
        title: "Read replies + reply back",
        badges: ["Beginner"],
        steps: [
          "When the team replies, the Messages button in the header shows an orange unread count.",
          "Tap the button to open your inbox, then tap the thread to read the full conversation.",
          "Type a reply at the bottom and hit Reply — the team is notified instantly.",
          "If your business has email notifications on, you'll also get a copy in your inbox.",
        ],
        tip: "Resolved threads automatically re-open if you reply — you don't have to start a new conversation if something comes up later.",
      },
    ],
  },
  {
    id: "getting-started",
    title: "Getting Started",
    icon: "fa-rocket",
    color: "text-shGreen",
    overview: "Open the portal, log in, and find your way around.",
    cards: [
      {
        title: "Open the client portal",
        badges: ["Beginner"],
        steps: [
          "Go to the link your dog daycare/training business sent you.",
          "Bookmark it or save it to your home screen for one-tap access.",
        ],
      },
      {
        title: "Log in to your account",
        badges: ["Beginner"],
        steps: [
          "Enter the email address your business has on file.",
          "Enter your password.",
          "Tick Remember me on your own device only.",
        ],
        tip: "If you signed up at the front desk, your business may have set a starter password — change it once you're in.",
      },
      {
        title: "Recover your login",
        badges: ["Beginner"],
        steps: [
          "On the login screen, tap Forgot Password.",
          "Enter your email.",
          "Check your inbox for a reset link (valid 24 hours).",
          "Set a new password and log in.",
        ],
        mistake: "Don't see the email? Check spam, then contact your business — they can manually send another reset link.",
      },
      {
        title: "What you'll see on the dashboard",
        badges: ["Beginner"],
        steps: [
          "Upcoming bookings at the top.",
          "Your dogs and their compliance status (vaccines, waiver).",
          "Active homework if you have any.",
          "Any payment plans or credit balances.",
        ],
      },
    ],
  },
  {
    id: "client-profile",
    title: "Your Profile",
    icon: "fa-user",
    color: "text-shBlue",
    overview: "Keep your contact info, address, and emergency contact up to date.",
    cards: [
      {
        title: "Update your contact info",
        badges: ["Beginner"],
        path: "Portal → My Account",
        steps: [
          "Open My Account.",
          "Edit name, email, phone, address.",
          "Save.",
        ],
        tip: "If you change your email, you'll log in with the new one next time.",
      },
      {
        title: "Set your emergency contact",
        badges: ["Beginner"],
        path: "Portal → My Account → Emergency Contact",
        steps: [
          "Open My Account.",
          "Scroll to Emergency Contact.",
          "Add name, phone, and relationship.",
          "Save.",
        ],
        mistake: "Skipping this. Your business needs someone to call if you can't be reached during a stay.",
      },
      {
        title: "Required fields",
        badges: ["Beginner"],
        steps: [
          "Some fields (name, email, phone) are required to book.",
          "If your profile has gaps, the portal will prompt you on your next booking.",
        ],
      },
    ],
  },
  {
    id: "dog-profile",
    title: "Your Dog's Profile",
    icon: "fa-paw",
    color: "text-shGreen",
    overview: "Add your dog, update notes, track behavior and training info.",
    cards: [
      {
        title: "Add a dog",
        badges: ["Beginner"],
        path: "Portal → My Dogs → + Add Dog",
        steps: [
          "Open My Dogs.",
          "Click + Add Dog.",
          "Enter name, breed, sex, birthday, fixed/intact.",
          "Save.",
        ],
      },
      {
        title: "Update dog details",
        badges: ["Beginner"],
        steps: [
          "Open My Dogs.",
          "Tap a dog.",
          "Edit any field (breed, birthday, fixed status, vet info).",
          "Save.",
        ],
      },
      {
        title: "Add notes about your dog",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Open your dog's profile.",
          "Scroll to Notes (if your business has enabled client notes).",
          "Add anything the trainer/daycare team should know.",
        ],
      },
      {
        title: "View training and behavior notes",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Open your dog's profile.",
          "Scroll to Behavior or Training Notes.",
          "Notes posted by your trainer appear with date stamps.",
        ],
      },
    ],
  },
  {
    id: "booking",
    title: "Booking Services",
    icon: "fa-calendar-plus",
    color: "text-shOrange",
    overview: "Request daycare, boarding, training, or grooming visits.",
    cards: [
      {
        title: "Request a daycare/boarding/training visit",
        badges: ["Beginner"],
        path: "Portal → Book a Visit",
        steps: [
          "Tap Book a Visit.",
          "Pick the dog.",
          "Pick the service (daycare, boarding, training, grooming).",
          "Pick the date — boarding will ask for start and end date.",
          "Add any add-ons (bath, nail trim).",
          "Submit.",
        ],
      },
      {
        title: "Understand availability",
        badges: ["Beginner"],
        steps: [
          "Dates that are full or closed appear greyed out.",
          "Same-day requests may not be available — check your business's lead-time rules.",
          "Boarding shows kennel availability across your date range.",
        ],
      },
      {
        title: "What happens after you submit",
        badges: ["Beginner"],
        steps: [
          "Your request goes to your business as 'Pending'.",
          "They'll approve or reject within their stated turnaround time.",
          "You'll get an email either way.",
          "Approved bookings appear under Upcoming on your dashboard.",
        ],
      },
      {
        title: "Cancel or reschedule",
        badges: ["Beginner"],
        path: "Portal → Upcoming → open a booking",
        steps: [
          "Open the upcoming booking.",
          "Tap Cancel or Request Reschedule.",
          "Cancellations may have a fee depending on how close to the date — your business sets these rules.",
        ],
      },
    ],
  },
  {
    id: "vaccines-waivers",
    title: "Vaccines & Waivers",
    icon: "fa-shield-virus",
    color: "text-red-400",
    overview: "Keep vaccine records current and sign the liability waiver.",
    cards: [
      {
        title: "View required vaccines",
        badges: ["Beginner"],
        path: "Portal → My Dogs → open dog → Vaccines",
        steps: [
          "Open your dog's Vaccines tab.",
          "You'll see each required vaccine and its current expiry date.",
          "Expired/expiring ones show in red.",
        ],
      },
      {
        title: "Upload an updated vaccine record",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Open the Vaccines tab.",
          "Tap Update next to the vaccine.",
          "Enter the new expiry date.",
          "Upload the certificate (photo or PDF).",
          "Save.",
        ],
        tip: "Most businesses verify the upload before clearing the warning. Submit it a few days before your next booking.",
      },
      {
        title: "Sign or review the waiver",
        badges: ["Beginner"],
        path: "Portal → Waiver",
        steps: [
          "Open Waiver.",
          "Read the text.",
          "Sign or tap I Agree.",
          "Some businesses require yearly re-sign — you'll be prompted automatically.",
        ],
      },
      {
        title: "Why a booking might be blocked",
        badges: ["Beginner"],
        steps: [
          "Missing required vaccine.",
          "Expired vaccine.",
          "Unsigned or expired waiver.",
          "Outstanding balance (depending on your business's rules).",
          "Fix the flagged item and the booking will be allowed.",
        ],
      },
    ],
  },
  {
    id: "homework-training",
    title: "Homework & Training",
    icon: "fa-pen-to-square",
    color: "text-purple-300",
    overview: "See your assigned practice, mark progress, read trainer notes.",
    cards: [
      {
        title: "View assigned homework",
        badges: ["Beginner", "Only shown if enabled"],
        path: "Portal → Homework",
        steps: [
          "Open Homework.",
          "Active assignments at the top.",
          "Tap any to see the full checklist and trainer notes.",
        ],
      },
      {
        title: "Mark practice complete",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Open the homework.",
          "Tick off each task as you practice it at home.",
          "Optionally add a note to your trainer.",
        ],
        tip: "Your trainer can see when you've completed tasks — it helps them tailor the next session.",
      },
      {
        title: "Read trainer notes",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Each homework card has a notes section.",
          "Trainer notes appear with date stamps.",
          "Older homework stays in the archive — useful for tracking progress over time.",
        ],
      },
    ],
  },
  {
    id: "payments-packages",
    title: "Payments & Packages",
    icon: "fa-dollar-sign",
    color: "text-shGreen",
    overview: "View packs, payment plans, and receipts.",
    cards: [
      {
        title: "View your credit packs",
        badges: ["Beginner", "Only shown if enabled"],
        path: "Portal → Packs & Plans",
        steps: [
          "Open Packs & Plans.",
          "See remaining credits per pack and expiry dates.",
        ],
      },
      {
        title: "View payment plan progress",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Open Packs & Plans → Payment Plans.",
          "See each installment, status (Due / Paid), and due date.",
        ],
      },
      {
        title: "View receipts and invoices",
        badges: ["Beginner", "Only shown if enabled"],
        path: "Portal → Receipts",
        steps: [
          "Open Receipts.",
          "Tap any to download a PDF.",
        ],
      },
      {
        title: "Deposits and cancellation policy",
        badges: ["Beginner", "Only shown if enabled"],
        steps: [
          "Your business may require a deposit for boarding or training.",
          "Cancellation fees are tiered — free outside the window, partial inside it, full for no-shows.",
          "These appear on the booking page when you submit.",
        ],
      },
    ],
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: "fa-bell",
    color: "text-shBlue",
    overview: "What emails you'll receive and when.",
    cards: [
      {
        title: "What you'll get",
        badges: ["Beginner"],
        steps: [
          "Booking confirmation — when your request is approved.",
          "Reminder — usually 24h before your booking.",
          "Vaccine reminder — when a vaccine is about to expire.",
          "Homework reminder — if you have an open assignment.",
          "Receipt — after each completed visit or purchase.",
          "Review request — a day or so after your visit.",
        ],
      },
      {
        title: "Why an email might not arrive",
        badges: ["Beginner"],
        steps: [
          "Check spam first.",
          "Quiet hours: your business may pause non-urgent emails overnight.",
          "Outdated email on file: update under My Account.",
          "Still missing? Contact your business — they can resend.",
        ],
      },
    ],
  },
  {
    id: "app-install",
    title: "Install on Your Phone",
    icon: "fa-mobile",
    color: "text-shOrange",
    overview: "Use the portal like a native app — one-tap booking from your home screen.",
    cards: [
      {
        title: "Install on iPhone",
        badges: ["Beginner"],
        steps: [
          "Open the portal in Safari (not Chrome).",
          "Tap the Share button at the bottom.",
          "Scroll and tap Add to Home Screen.",
          "Confirm — an icon appears on your home screen.",
        ],
      },
      {
        title: "Install on Android",
        badges: ["Beginner"],
        steps: [
          "Open the portal in Chrome.",
          "Tap the three-dot menu (top right).",
          "Tap Install app or Add to Home Screen.",
          "Confirm — an icon appears in your app drawer.",
        ],
      },
      {
        title: "Use it like an app",
        badges: ["Beginner"],
        steps: [
          "Tap the home-screen icon to open the portal in its own window — no browser address bar.",
          "Works the same as any installed app.",
          "Updates happen automatically — no app-store download needed.",
        ],
        tip: "If your business sends you an SMS link to a booking, tapping it opens straight in your installed portal app.",
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
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-circle-question text-shGreen mr-2" />
            {role === "client" ? "Client Portal Tutorial" : "How To Use Sit Happens"}
          </h3>
          <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">
            {role === "client"
              ? "How clients book, manage dogs, view homework, and keep records updated"
              : "Operator tutorial center — learn the daily workflow step by step"}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <div className="relative w-full sm:w-64">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-[15px]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tutorials…"
              data-testid="tutorials-search"
              className="w-full bg-bgPanel border border-bgHover rounded-lg pl-9 pr-3 py-2 text-white text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={printCurrent} data-testid="tutorials-print-current"
                    title="Print only the section you're looking at"
                    className="bg-shBlue/15 text-shBlue px-4 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/25 flex items-center gap-2">
              <i className="fas fa-print" /><span className="hidden sm:inline">Print Page</span>
            </button>
            <button onClick={printAll} data-testid="tutorials-print-all"
                    title="Print the full guide (all sections)"
                    className="bg-shGreen/15 text-shGreen px-4 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/25 flex items-center gap-2">
              <i className="fas fa-file-pdf" /><span className="hidden sm:inline">Print All</span>
            </button>
          </div>
        </div>
      </div>

      {/* Quick action cards */}
      <div className="tutorials-no-print">
        <p className="text-[11px] font-black uppercase tracking-[0.25em] text-gray-500 mb-2">Quick Jumps</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {quickActions.map(qa => (
            <button
              key={qa.id}
              onClick={() => { setQuery(""); setOpenId(qa.target); }}
              data-testid={`tutorials-quick-${qa.id}`}
              className="bg-bgPanel border border-bgHover hover:border-shBlue/60 hover:bg-bgBase/50 rounded-lg p-3 text-left transition flex items-center gap-2.5"
            >
              <i className={`fas ${qa.icon} text-shBlue text-[14px] w-4`} />
              <span className="text-[12px] font-black uppercase tracking-widest text-white leading-tight">{qa.label}</span>
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
                ? "bg-bgPanel border-shBlue text-shBlue"
                : "bg-bgPanel/40 border-bgHover text-gray-400 hover:border-shBlue/40"
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
              <div className="bg-bgPanel/40 border border-bgHover rounded-lg p-4 mb-3">
                <h4 className={`text-[15px] font-black uppercase tracking-widest ${s.color}`}>
                  <i className={`fas ${s.icon} mr-2`} />{s.title}
                </h4>
                {s.overview && (
                  <p className="text-[14px] text-gray-300 mt-1.5 normal-case leading-relaxed">{s.overview}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid={`tutorial-section-${s.id}`}>
                {s.cards.map((c, i) => (
                  <div key={i} className="bg-bgPanel border border-bgHover rounded-xl p-5 shadow-lg tutorial-card" data-testid={`tutorial-card-${s.id}-${i}`}>
                    <h5 className="text-white font-black uppercase tracking-tight text-[15px] flex items-start gap-2">
                      <i className={`fas fa-circle-check ${s.color} mt-1 text-[14px]`} />
                      <span>{c.title}</span>
                    </h5>
                    {(c.badges || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.badges.map(b => <CardBadge key={b} label={b} />)}
                      </div>
                    )}
                    {c.path && (
                      <p className="mt-2.5 text-[12px] text-shBlue bg-shBlue/10 border border-shBlue/25 rounded px-2 py-1.5 inline-block normal-case font-bold tracking-wide">
                        <i className="fas fa-location-arrow mr-1.5" />{c.path}
                      </p>
                    )}
                    <ol className="mt-3 space-y-2 text-[15px] text-gray-300">
                      {(c.steps || []).map((step, j) => (
                        <li key={j} className="flex gap-3">
                          <span className={`${s.color} font-black flex-shrink-0`}>{j + 1}.</span>
                          <span className="leading-snug">{step}</span>
                        </li>
                      ))}
                    </ol>
                    {c.tip && (
                      <p className="mt-3 text-[14px] text-shOrange bg-shOrange/5 border border-shOrange/20 rounded p-2.5 leading-snug tip-box">
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
                      <div className="mt-3 pt-2.5 border-t border-bgHover">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">Related</p>
                        <ul className="space-y-1">
                          {c.related.map((r, k) => (
                            <li key={k} className="text-[13px] text-shBlue normal-case">
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
          <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center text-gray-500 uppercase font-black tracking-widest text-xs">
            No tutorials match &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}

function CardBadge({ label }) {
  const palette = {
    "Beginner":            "bg-shGreen/15 text-shGreen border-shGreen/30",
    "Daily Use":           "bg-shBlue/15 text-shBlue border-shBlue/30",
    "Admin Only":          "bg-red-500/15 text-red-400 border-red-500/30",
    "Client-Facing":       "bg-purple-500/15 text-purple-300 border-purple-500/30",
    "Setup Only":          "bg-shOrange/15 text-shOrange border-shOrange/30",
    "Staff-Only":          "bg-shOrange/15 text-shOrange border-shOrange/30",
    "Optional":            "bg-shBlue/15 text-shBlue border-shBlue/30",
    "Coming Soon":         "bg-bgHover/60 text-gray-400 border-bgHover",
    "Only shown if enabled": "bg-bgHover/60 text-gray-400 border-bgHover",
  }[label] || "bg-bgHover/60 text-gray-400 border-bgHover";
  return (
    <span className={`text-[9px] font-black uppercase tracking-[0.2em] px-1.5 py-0.5 rounded border ${palette}`}>
      {label}
    </span>
  );
}
