import { useState } from "react";

/**
 * Role-aware tutorials screen. One component, two content sets.
 * Admin sees how to manage clients, dogs, bookings, training, homework.
 * Client sees how to book, sign waiver, mark homework done, log sessions.
 *
 * Pure content / no backend calls. Search filters across all topics.
 */
const ADMIN_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: "fa-rocket",
    color: "text-shGreen",
    cards: [
      {
        title: "Set up your business basics first",
        steps: [
          "Open Settings (sidebar → Settings).",
          "Hours tab: set open/close per service for each day of the week.",
          "Capacity & Kennels: set your daycare cap, then add every kennel/room you own.",
          "Vaccines: toggle which vaccines you require. Rabies is on by default.",
          "Waiver: paste your waiver text and tick 'Require for booking.'",
          "Account: change the admin password from the seeded one.",
        ],
        tip: "You only do this once. Everything else flows from here.",
      },
      {
        title: "Install the app to your home screen",
        steps: [
          "Look for the green 'Install App' button at the bottom of the sidebar.",
          "Click it — you'll either see the native install dialog OR a step-by-step modal.",
          "On iPhone: tap Share → Add to Home Screen instead.",
          "Once installed, Sit Happens opens in its own window with no browser bar.",
        ],
      },
    ],
  },
  {
    id: "clients-dogs",
    title: "Clients & Dogs",
    icon: "fa-paw",
    color: "text-shBlue",
    cards: [
      {
        title: "Add a new client (with optional portal login)",
        steps: [
          "Sidebar → Clients → '+ Add Client.'",
          "Fill in name, email, phone, address, emergency contact.",
          "If you want them to be able to book online, tick 'Create portal login' and set a starting password.",
          "Set their daycare credits if you've sold them a pack.",
          "Save. Email them the URL + login.",
        ],
        tip: "Clients can also self-sign-up — point them to the URL and tap Register. Their client record is auto-created.",
      },
      {
        title: "Add a dog to a client",
        steps: [
          "Sidebar → Dogs → '+ Add Dog.'",
          "Pick the owner from the dropdown.",
          "Basics tab: name, breed, sex, age, birthday, fixed.",
          "Vaccines tab: enter rabies expiry (required), plus any others you require.",
          "Feeding & Meds tab: add daily feedings/medications. These show up on the Run Sheet.",
          "Training tab: enroll the dog in a program if relevant.",
          "Notes & Vet tab: vet name + phone, anything you should remember.",
        ],
      },
      {
        title: "Bulk-find anyone with Cmd/Ctrl + K",
        steps: [
          "Press Cmd+K (Mac) or Ctrl+K (Windows) anywhere in the app.",
          "Start typing a dog or owner's name.",
          "Use arrow keys + Enter to open them directly.",
        ],
        tip: "Way faster than scrolling through Clients/Dogs lists.",
      },
    ],
  },
  {
    id: "bookings",
    title: "Bookings & Schedule",
    icon: "fa-calendar-check",
    color: "text-shOrange",
    cards: [
      {
        title: "Approve a client's booking request",
        steps: [
          "Sidebar → Bookings.",
          "Pending requests show with an orange 'pending' tag.",
          "Hit 'Approve' to confirm the spot or 'Reject' with a reason. Credits aren't deducted until check-out.",
          "Client gets an email automatically (Resend integration).",
        ],
      },
      {
        title: "Create a booking yourself",
        steps: [
          "From Dashboard: tap '+ Quick Check-in' — pre-fills today.",
          "From Bookings: tap '+ New Booking.'",
          "Pick client → dogs autoload → pick service, date, kennel, dropoff/pickup times.",
          "Toggle 'Check-in immediately' if they're walking in right now.",
          "Toggle overrides if you need to ignore vaccine or capacity rules (admin only).",
        ],
      },
      {
        title: "Reschedule by dragging on the calendar",
        steps: [
          "Sidebar → Schedule.",
          "Find the booking on the calendar.",
          "Drag it to a new date — confirms the move and rebooks automatically.",
        ],
        tip: "Don't drag a booking off a no-availability date; the rule still checks.",
      },
      {
        title: "Daily Run Sheet (print-friendly)",
        steps: [
          "Sidebar → Run Sheet.",
          "Pick the date (defaults to today).",
          "Tap Print — a print-only stylesheet hides the sidebar and lays out one row per dog with feeding/meds/vet/notes.",
          "Tape it to the wall every morning.",
        ],
      },
    ],
  },
  {
    id: "training-programs",
    title: "Training Programs & Pipeline",
    icon: "fa-graduation-cap",
    color: "text-purple-400",
    cards: [
      {
        title: "Enroll a dog in a training program",
        steps: [
          "Sidebar → Dogs → click a dog → Training tab.",
          "Tap 'Enroll' and pick a program (or 'Custom' for a one-off curriculum).",
          "Set a target completion date.",
          "Score each goal 1-5 (or check the box for manual-only goals) as the dog masters them.",
        ],
        tip: "Dogs can hold multiple active enrollments — useful for service dog candidates running Public Access alongside Basic Obedience.",
      },
      {
        title: "Track every dog in training from one place",
        steps: [
          "Sidebar → Pipeline.",
          "Filter by status (active / on hold / completed / withdrawn) or program type.",
          "Click any row to jump straight to that dog's profile.",
          "The chip on each dog card (Dogs page) is also a shortcut into the Training tab.",
        ],
      },
      {
        title: "Build your own custom program",
        steps: [
          "Sidebar → Settings → Training Programs.",
          "Click '+ New Program.'",
          "Pick a type (Private Lessons, Board & Train, Service Dog, Custom).",
          "Add modules. Each module gets goals. Each goal is either scored (1-5) or checkbox (done/not).",
          "Set completion_rule (% goals mastered, all goals, or specific goals).",
          "Save — it's now available to enroll anyone in.",
        ],
      },
    ],
  },
  {
    id: "homework",
    title: "Homework (Daily Plans)",
    icon: "fa-clipboard-list",
    color: "text-shGreen",
    cards: [
      {
        title: "Create a multi-day homework plan",
        steps: [
          "Sidebar → Homework → tap the green 'New plan' / 'Create' button.",
          "Step 1: pick the dog, give the plan a title ('5-Day Loose-Leash Plan'), and set how many days.",
          "Step 2: for each day, fill in the day focus (e.g., 'Introduce structure walk').",
          "Add Action Steps the client checks off as they practice. Each step gets a minutes target — the day total auto-rolls up at the top.",
          "Optionally add Fields to log (reps · sets · mood emoji · longtext notes · photo · video). Use the ↑/↓ buttons to reorder; the trash icon removes one.",
          "Optionally attach Resources — paste a URL (Drive / YouTube / direct PDF) OR tap 'Upload PDF / image' to send a file straight from your computer (≤10 MB, PDF/JPG/PNG/WEBP).",
          "Hit 'Assign N-day plan' on the last step. Day 1 unlocks immediately for the client.",
        ],
        tip: "Save a finished plan as a template (toggle on Step 1) so you can re-assign it to other dogs in 2 clicks.",
      },
      {
        title: "Approve the day's submission",
        steps: [
          "Sidebar → Homework → 'Pending reviews' tab shows the queue.",
          "Each row: dog · plan · day number · how long ago the client tapped Submit.",
          "Tap to expand. You'll see every step they checked off, the minute total, mood emoji, note, photo/video if any.",
          "Hit 'Approve' (unlocks Day N+1) OR 'Needs redo' with a one-line reason (client gets an email).",
        ],
        tip: "Day 2 stays locked until you approve Day 1, so the dog progresses at the right pace. No skipping ahead.",
      },
      {
        title: "Where step events surface (live + nightly email)",
        steps: [
          "Dashboard → Today's Tasks tile flags any tracker with steps still open at end of day (warn priority).",
          "Each step a client ticks off is silently logged to the step_events feed (no inbox spam by default).",
          "At end of day, ONE email goes out: 'Today's training progress · N steps done' with every step grouped by dog + plan.",
          "Want a real-time email on EVERY step? Settings → Email Automation → flip 'Per-step homework emails' to On. Heads-up: 5-day plans with 3 steps × 10 clients = lots of mail.",
        ],
      },
      {
        title: "Resources — what shows up where",
        steps: [
          "Plan-wide resources (Step 1 of builder) appear on every day card the client opens. Use for a 1-page summary or master cue sheet.",
          "Per-day resources (Step 2 of builder, in each day's purple panel) appear only on that day. Use for a specific diagram, link, or printable.",
          "Client portal: the 'Take with you' purple strip lists ALL resources for today (day + plan merged) — tap to open. Uploaded files stream via the secure resource endpoint; pasted links open in a new tab.",
        ],
      },
      {
        title: "Catch-up when a client misses a day",
        steps: [
          "If a client missed yesterday's step, the Today's Plan card on their portal shows a 'You missed day N' banner.",
          "They pick one of 3 strategies (you can also do it for them by opening their homework directly):",
          "• Skip — marks the missed day done, jumps to today. No reschedule.",
          "• Double up — adds yesterday's steps onto today's checklist as '(catch-up)' items.",
          "• Push schedule — extends due_date by 1 day; missed day stays available.",
        ],
        tip: "Streak counter resets only on a real miss (no skip/double-up applied). The dashboard sparkline visualises the trend.",
      },
    ],
  },
  {
    id: "todays-tasks",
    title: "Today's Tasks (Dashboard)",
    icon: "fa-list-check",
    color: "text-shBlue",
    cards: [
      {
        title: "Your single source of 'what needs me'",
        steps: [
          "The Today's Tasks tile is now the FIRST thing on your dashboard — above all the stat cards.",
          "It rolls up 10 alert types into one prioritised feed: 🔴 urgent → 🟠 warn → 🟢 info.",
          "Top 3 items always visible. Tap 'See all N →' for the full feed in a modal with filter chips.",
        ],
      },
      {
        title: "What's in the feed",
        steps: [
          "🔴 Homework day-submissions waiting for review",
          "🔴 Vaccines missing or expired (the standalone Vax Alert banner is GONE — those flags live here now)",
          "🔴 Dogs booked today but not yet checked in past 10 AM",
          "🟠 Vaccines expiring within your warning window",
          "🟠 Active clients with ≤2 credits left in any pool",
          "🟠 Bookings in 'pending' status awaiting your approval",
          "🟠 Unanswered homework questions from clients",
          "🟠 Trackers with today's steps still open (Sprint 105)",
          "🟢 Pipeline enrollments ≥95% — eligible for cert print",
          "🟢 New client signups in last 24h",
          "🟢 Monday digest hint (Mondays only)",
        ],
      },
      {
        title: "How items disappear",
        steps: [
          "Auto-resolve only — no manual dismiss. When the underlying issue is fixed, the item goes away on the next dashboard load.",
          "Approve a homework → the 'waiting for review' item vanishes.",
          "Client uploads new vaccine cert → 'rabies expired' moves to 'pending approval' bucket.",
          "Check in a dog → 'not yet checked in' goes away.",
        ],
        tip: "Sort is fixed (urgent → warn → info, then newest within each). Can't reorder by hand — but you don't need to, urgency wins.",
      },
    ],
  },
  {
    id: "ops-data",
    title: "Operations & Data",
    icon: "fa-database",
    color: "text-gray-300",
    cards: [
      {
        title: "Back up everything",
        steps: [
          "Settings → Backup & Restore.",
          "Tap 'Download Backup' — saves a date-stamped JSON file of all clients, dogs, bookings, incidents, homework, settings.",
          "Recommended: do this once a week. Store in Dropbox or Google Drive.",
        ],
      },
      {
        title: "Restore from a backup",
        steps: [
          "Settings → Backup & Restore → drop the JSON file.",
          "Pick mode: 'Merge' (safer — only adds/updates, never deletes) or 'Replace' (wipes and reloads).",
          "Confirm. Refresh the page.",
        ],
        tip: "Always do a fresh download BEFORE restoring, just in case.",
      },
      {
        title: "Log an incident",
        steps: [
          "Sidebar → Incidents → '+ New Incident.'",
          "Pick the dog, type (bite / injury / escape / illness / property / behavior / other), and severity.",
          "Add witnesses, action taken, photos (up to 4), vet visit flag if needed.",
          "This is your legal paper trail — fill it out thoroughly.",
        ],
      },
    ],
  },
  {
    id: "brand-and-theme",
    title: "Brand & Theme",
    icon: "fa-palette",
    color: "text-shGreen",
    cards: [
      {
        title: "Change the app's colors to match your business",
        steps: [
          "Sidebar → Settings → Brand & Theme tab.",
          "Brand Colors: pick a primary, accent, and warning color. They apply across every screen, every button, every badge.",
          "Font: pick from Inter / Nunito / Poppins / Roboto / System.",
          "Card Gradients: each card 'flavor' (Hero, Info, Warning, Danger, Success) gets its own color — affects dashboard tiles, banners, report cards, vaccine alerts, etc.",
          "Hit Save Brand — the whole app recolors instantly.",
        ],
        tip: "Live preview cards show exactly what each gradient will look like before you save.",
      },
      {
        title: "Set the footer pill text and link",
        steps: [
          "Settings → Brand & Theme → 'Footer Pill' section.",
          "Text: what the pill says in the bottom-right of every page (default 'Sit Happens').",
          "Link URL: blank = just a label, set a URL = clickable pill that opens in a new tab.",
          "Useful if your business has a marketing site separate from the app.",
        ],
      },
      {
        title: "Adjust text size per user",
        steps: [
          "Below the nav in the sidebar there's an S / M / L / XL picker.",
          "Each user (admin + every client) picks their own text size — it's saved to their account.",
          "Scales the entire app proportionally (16 / 18.5 / 21 / 24 px).",
        ],
        tip: "Great for older clients who need bigger fonts on their portal — they only change theirs, not yours.",
      },
    ],
  },
  {
    id: "vaccine-center",
    title: "Vaccine Center & Health Flags",
    icon: "fa-shield-heart",
    color: "text-shOrange",
    cards: [
      {
        title: "Triage every flagged vaccine in one place",
        steps: [
          "Dashboard → click the 'Health Flags' stat tile (or 'Manage All' on the orange Vaccine Alerts banner).",
          "The Vaccine Center modal opens with every flagged dog (missing OR expired) listed.",
          "Each row pre-fills a new expiry date 1 year from today — adjust if needed.",
          "Optionally upload a photo of the new certificate.",
          "Hit Save — that row disappears and the dashboard stat updates.",
          "Use 'Hide 30d' if you're waiting on the owner and want to suppress the alert temporarily.",
        ],
        tip: "Saves you opening each dog's profile individually — knock out the whole week's vaccine paperwork in 60 seconds.",
      },
      {
        title: "Send a mass claim-email after a migration",
        steps: [
          "Settings → Backup & Restore → 'Mass Claim Emails (Recovery)'.",
          "Click 'Send Claim Emails to All Clients'.",
          "Every client with an email and no portal login yet gets a 'Set up your account' link.",
          "Result chips show how many sent / skipped / errored.",
        ],
        tip: "Use this after restoring from a backup that didn't include user passwords. Each client picks their own password.",
      },
    ],
  },
  {
    id: "client-recovery",
    title: "Client Logins & Recovery",
    icon: "fa-key",
    color: "text-shBlue",
    cards: [
      {
        title: "Migrate logins between hosts (keep passwords)",
        steps: [
          "On the OLD instance: Settings → Backup & Restore → 'Migrate User Logins' → click 'Export Users.'",
          "A JSON file downloads with every user's bcrypt password hash.",
          "On the NEW instance: same panel → click 'Import Users' → pick the file.",
          "Existing accounts updated, new ones inserted. Your own admin record is left untouched.",
        ],
        tip: "Use this when moving from Emergent hosting to self-hosted, or between two PCs. Clients keep their existing passwords.",
      },
      {
        title: "Forgot Password",
        steps: [
          "Anyone (admin or client) clicks 'Forgot password?' under the Sign In form.",
          "They enter their email — a reset link is emailed via Resend.",
          "Link expires in 7 days. They click it, pick a new password, and are auto-logged-in.",
          "The system never reveals whether an email is registered — prevents account-probing.",
        ],
      },
      {
        title: "Auto-merge on self-signup",
        steps: [
          "If you create a client record with an email but no portal user, and that same person later self-registers using that exact email, they are auto-attached to the existing client record.",
          "All pre-loaded dogs, credits, and history follow them — no duplicates.",
          "Tip: even better, send them a claim email right after creating the record so they never see the signup form.",
        ],
      },
    ],
  },
  {
    id: "backups-hosting",
    title: "Backups & Self-Hosting",
    icon: "fa-cloud-arrow-down",
    color: "text-shGreen",
    cards: [
      {
        title: "One-shot nightly Google Drive backups",
        steps: [
          "SSH to your Bazzite PC and run `./setup-auto-backup.sh` inside `~/sit-happens`.",
          "It installs rclone (no rpm-ostree needed), walks you through Google Drive auth, and installs a systemd timer at 3 AM nightly.",
          "Local copies kept for 14 days at `~/sit-happens-backups/`. Cloud copies kept indefinitely in Drive → /sit-happens-backups/.",
        ],
        tip: "Run `./backup-now.sh` any time to make an immediate backup.",
      },
      {
        title: "Pull new app updates",
        steps: [
          "SSH to your Bazzite PC → `cd ~/sit-happens && ./update.sh`.",
          "Pulls the latest code from GitHub, rebuilds containers, restarts. ~1-3 minutes.",
        ],
      },
      {
        title: "Move to a new PC",
        steps: [
          "On the old PC: `./migrate-export.sh` → makes one big `.tar.gz` of code + DB + Cloudflare config.",
          "Copy that file to a USB stick.",
          "On the new PC (after installing Docker): `./migrate-import.sh path/to/that/file.tar.gz`.",
          "Same domain, same data. Done.",
        ],
      },
    ],
  },
];

const CLIENT_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: "fa-rocket",
    color: "text-shGreen",
    cards: [
      {
        title: "Finish your onboarding (top of portal)",
        steps: [
          "Look at the green banner at the top — it shows 3 steps: Profile → Add a Dog → Sign Waiver.",
          "Tap 'My Profile' to fill in your name, address, phone, and an emergency contact.",
          "Tap '+ Add a Dog' to add your dog's info, vaccines (rabies expiry is required), and a photo.",
          "Once you've added a dog, the waiver pops up. Type your name and check Accept.",
        ],
        tip: "You can't book anything until the waiver is signed — it's a 60-second step.",
      },
      {
        title: "Install Sit Happens on your phone",
        steps: [
          "Tap the green 'Install' button next to Logout at the top of the screen.",
          "On iPhone Safari: tap Share → Add to Home Screen.",
          "On Android Chrome: a prompt pops up — tap Install.",
          "The husky logo will appear on your home screen. Tap it to open like a normal app.",
        ],
      },
      {
        title: "Forgot your password?",
        steps: [
          "On the sign-in screen, tap 'Forgot password?' under the password field.",
          "Enter your email and tap 'Send Reset Link.'",
          "Check your inbox (and spam folder) — you'll get an email with a link.",
          "Click the link, pick a new password, and you're back in. Link is good for 7 days.",
        ],
        tip: "No need to call your trainer to reset it for you — you can do it yourself anytime.",
      },
      {
        title: "Make the text bigger (or smaller)",
        steps: [
          "Look for the small 'TEXT · M' pill at the bottom of the portal sidebar (or under the menu drawer on mobile).",
          "Tap it — a popover opens with S / M / L / XL pills.",
          "Tap whichever is most comfortable — everything scales up together. Tap outside or hit Close.",
          "Your choice is remembered every time you log in.",
        ],
      },
    ],
  },
  {
    id: "booking",
    title: "Booking",
    icon: "fa-calendar-plus",
    color: "text-shBlue",
    cards: [
      {
        title: "Book daycare, boarding, training, or grooming",
        steps: [
          "Scroll to the 'Book Service' card on your portal.",
          "Pick which dog.",
          "Pick the service: Daycare, Boarding, Training, or Grooming (Bath / Nail Trim).",
          "Pick the date — for boarding, also pick an end date.",
          "Hit 'Book Now.' Status starts as 'pending' until your trainer approves.",
        ],
        tip: "Daycare days come out of your credit pack first; boarding and training are pay-on-the-day.",
      },
      {
        title: "Book a recurring schedule",
        steps: [
          "On the Book Service card, tick 'Recurring Booking.'",
          "Pick a start date and end date.",
          "Tap the weekdays you want (e.g., Tuesday + Thursday).",
          "Hit Book — it creates one booking per matching day in the range.",
        ],
      },
      {
        title: "Cancel or reschedule",
        steps: [
          "Find the booking under 'My Bookings.'",
          "Tap Cancel (works for pending OR approved if it's outside the cutoff window your trainer set).",
          "Credits get refunded if any were charged.",
          "Need to move it instead? Cancel + rebook — easier than asking.",
        ],
      },
    ],
  },
  {
    id: "homework",
    title: "Daily Plans (Homework)",
    icon: "fa-clipboard-list",
    color: "text-shOrange",
    cards: [
      {
        title: "Find Today's Plan (the green target tile)",
        steps: [
          "Open the portal — Today's Plan sits at the top with a 🎯 icon and 'N ACTIVE' badge.",
          "Each card shows: your dog's name · Day X of Y · the total minutes for today · the day focus (e.g., 'Introduce structure walk').",
          "If your trainer attached any handouts, you'll see a purple 'Take with you' strip with tappable chips — open them BEFORE you start so you can print or screenshot.",
        ],
      },
      {
        title: "Check off steps as you practice",
        steps: [
          "Each step shows a label + a minutes target ('Practice heel position for 10 reps · 5 MIN').",
          "Tap a step to mark it done. It strikes through and goes grey.",
          "When ALL steps are checked, the day auto-submits to your trainer — no extra button needed.",
          "Your trainer reviews and approves; Day N+1 unlocks the next time you log in.",
        ],
        tip: "Don't rush. The minute targets are guides, not a stopwatch. Quality > quantity.",
      },
      {
        title: "Add a mood / note / photo at the end of the day (optional)",
        steps: [
          "Below the step list, expand the homework card to see optional fields your trainer set up.",
          "Tap the 😄 mood emoji to grade how the day went (1-5 scale).",
          "Add a short note ('She nailed the kitchen heel but distracted by the dog walker outside').",
          "Upload a photo or 10-second video if you want — your trainer loves seeing real moments.",
        ],
      },
      {
        title: "Missed a day? Use Catch-Up",
        steps: [
          "If you missed yesterday, the Today's Plan card shows an orange 'You missed day N' banner.",
          "Tap it to pick: Skip yesterday · Double up today · Push the schedule by 1 day.",
          "Pick the one that fits your week. Your trainer sees the choice automatically.",
        ],
        tip: "Missing one day is fine. Two in a row triggers a friendly nudge email — that's it.",
      },
      {
        title: "Ask your trainer a question",
        steps: [
          "On any homework day, tap 'Ask a question' and type what's confusing you.",
          "Your trainer replies inside the same day card so the answer stays attached to the right context.",
          "You'll get an email when they reply.",
        ],
      },
    ],
  },
  {
    id: "training-progress",
    title: "Training Progress",
    icon: "fa-graduation-cap",
    color: "text-purple-400",
    cards: [
      {
        title: "See where your dog is in their program",
        steps: [
          "Scroll to the 'Training Progress' section.",
          "Each enrolled program shows a % done, total goals mastered, and started/target dates.",
          "Tap 'View Progress' to see every command/goal with their current level.",
        ],
      },
      {
        title: "Earn badges (and print certificates)",
        steps: [
          "For service-dog and CGC-style programs, you'll see Bronze / Silver / Gold badges as your dog hits milestones.",
          "Tap 'Print Certificate' to download a landscape PDF-style cert — great for fridge, framing, or social media.",
        ],
      },
    ],
  },
  {
    id: "account",
    title: "Account & Profile",
    icon: "fa-user",
    color: "text-gray-300",
    cards: [
      {
        title: "Edit your profile",
        steps: [
          "Tap 'My Profile' on the Daycare Credits card.",
          "Update name, address, phone, or emergency contact.",
          "Hit Save.",
        ],
      },
      {
        title: "Edit your dog's profile",
        steps: [
          "Tap your dog's card on the portal.",
          "Update vaccines (especially when rabies renews!), weight, vet contact, or notes.",
          "Hit Save.",
        ],
        tip: "Keeping rabies current is mandatory — bookings auto-block if it expires.",
      },
      {
        title: "Re-sign the waiver",
        steps: [
          "If your trainer pushes a new waiver version, the modal pops up automatically on your next login.",
          "Type your name, check Accept, hit Save.",
        ],
      },
    ],
  },
];

export default function Tutorials({ role = "admin" }) {
  const sections = role === "client" ? CLIENT_SECTIONS : ADMIN_SECTIONS;
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(sections[0]?.id || "");

  const filtered = !query.trim()
    ? sections
    : sections
        .map((s) => ({
          ...s,
          cards: s.cards.filter((c) =>
            (c.title + " " + (c.tip || "") + " " + c.steps.join(" ")).toLowerCase().includes(query.toLowerCase())
          ),
        }))
        .filter((s) => s.cards.length > 0);

  // Two print modes — current section or every section.
  // `tutorials-print-all` body class toggles a CSS rule that forces all
  // section cards visible during the printed page.
  const printCurrent = () => {
    document.body.classList.add("tutorials-printing");
    setTimeout(() => {
      window.print();
      document.body.classList.remove("tutorials-printing");
    }, 50);
  };
  const printAll = () => {
    document.body.classList.add("tutorials-printing", "tutorials-print-all");
    setTimeout(() => {
      window.print();
      document.body.classList.remove("tutorials-printing", "tutorials-print-all");
    }, 50);
  };

  return (
    <div className="space-y-6 animate-slide-in tutorials-root" data-testid="tutorials-screen" data-role={role}>
      <style>{`
        @media print {
          /* Hide everything except the tutorials when printing. */
          body.tutorials-printing aside,
          body.tutorials-printing header,
          body.tutorials-printing [data-testid="portal-tutorials-overlay"] > header,
          body.tutorials-printing .tutorials-no-print,
          body.tutorials-printing #emergent-badge {
            display: none !important;
          }
          body.tutorials-printing { background: #ffffff !important; }
          body.tutorials-printing .tutorials-root,
          body.tutorials-printing .tutorials-root * {
            color: #111 !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border-color: #d4d4d4 !important;
          }
          body.tutorials-printing .tutorials-root h3,
          body.tutorials-printing .tutorials-root h4,
          body.tutorials-printing .tutorials-root h5 {
            color: #000 !important;
          }
          body.tutorials-printing .tutorials-root .tip-box {
            background: #fff8e8 !important;
            border-color: #f0c000 !important;
            color: #5a4500 !important;
          }
          body.tutorials-printing .tutorials-root .tip-box * { color: #5a4500 !important; }
          body.tutorials-printing .tutorials-root .grid {
            display: block !important;
          }
          body.tutorials-printing .tutorials-root .tutorial-card {
            page-break-inside: avoid;
            margin-bottom: 12px;
            border: 1px solid #d4d4d4 !important;
            padding: 14px !important;
          }
          body.tutorials-printing .tutorials-root .tutorial-section {
            page-break-inside: avoid;
            margin-bottom: 24px;
          }
          body.tutorials-printing.tutorials-print-all .tutorial-section.print-hidden {
            display: block !important;
          }
        }
      `}</style>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 tutorials-no-print">
        <div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-circle-question text-shGreen mr-2" />
            How to use Sit Happens
          </h3>
          <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">
            {role === "client" ? "Everything you need to make the most of the portal" : "Operator playbook — bookmarks for the stuff you do every day"}
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
              <i className="fas fa-print" />
              <span className="hidden sm:inline">Print Page</span>
            </button>
            <button onClick={printAll} data-testid="tutorials-print-all"
                    title="Print the full guide (all sections)"
                    className="bg-shGreen/15 text-shGreen px-4 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/25 flex items-center gap-2">
              <i className="fas fa-file-pdf" />
              <span className="hidden sm:inline">Print All</span>
            </button>
          </div>
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
            <i className={`fas ${s.icon} ${s.color} mr-2`} />
            {s.title}
          </button>
        ))}
      </div>

      {/* Cards for active section (or all when searching / printing all) */}
      <div className="space-y-6">
        {filtered.map((s) => {
          const isActive = query.trim() || openId === s.id;
          // print-hidden lets "Print All" override visibility via the body class
          return (
            <div key={s.id}
                 className={`tutorial-section ${isActive ? "" : "hidden print-hidden"}`}>
              {(query.trim() || filtered.length > 1) && (
                <h4 className={`text-[14px] font-black uppercase tracking-widest mb-3 ${s.color}`}>
                  <i className={`fas ${s.icon} mr-2`} />
                  {s.title}
                </h4>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid={`tutorial-section-${s.id}`}>
                {s.cards.map((c, i) => (
                  <div key={i} className="bg-bgPanel border border-bgHover rounded-xl p-5 shadow-lg tutorial-card" data-testid={`tutorial-card-${s.id}-${i}`}>
                    <h5 className="text-white font-black uppercase tracking-tight text-[15px] flex items-start gap-2">
                      <i className={`fas fa-circle-check ${s.color} mt-1 text-[14px]`} />
                      <span>{c.title}</span>
                    </h5>
                    <ol className="mt-3 space-y-2 text-[15px] text-gray-300">
                      {c.steps.map((step, j) => (
                        <li key={j} className="flex gap-3">
                          <span className={`${s.color} font-black flex-shrink-0`}>{j + 1}.</span>
                          <span className="leading-snug">{step}</span>
                        </li>
                      ))}
                    </ol>
                    {c.tip && (
                      <p className="mt-3 text-[14px] text-shOrange bg-shOrange/5 border border-shOrange/20 rounded p-2.5 leading-snug tip-box">
                        <i className="fas fa-lightbulb mr-1" />
                        <strong className="uppercase tracking-widest">Tip · </strong>
                        {c.tip}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center text-gray-500 uppercase font-black tracking-widest text-xs">
            No tutorials match "{query}"
          </div>
        )}
      </div>
    </div>
  );
}
