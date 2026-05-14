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
          "Hit 'Approve' (deducts credits if daycare) or 'Reject' with a reason.",
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
    title: "Homework Forms",
    icon: "fa-clipboard-list",
    color: "text-shGreen",
    cards: [
      {
        title: "Assign a homework template in 4 clicks",
        steps: [
          "Sidebar → Homework.",
          "Tap 'Assign from Template' (the green button).",
          "Pick a template from the tier-grouped picker.",
          "Pick the dog, add an optional personal note, hit Assign.",
        ],
        tip: "Templates auto-set a due date based on the program length (e.g., First 48 Hours = 2 days, Bulletproof Recall = 14 days).",
      },
      {
        title: "Read the client's structured log",
        steps: [
          "Sidebar → Homework → find the row.",
          "Tap 'View Report.'",
          "Each section shows avg reps, total reps, trend arrow (↑ improving, → steady, ↓ declining), and a green ✓ if they hit goal.",
          "Click into the homework card to see every individual session entry.",
        ],
        tip: "If a stat shows the down-arrow as red, that's the client losing ground on that drill — bring it up next session.",
      },
      {
        title: "Create your own custom homework",
        steps: [
          "Sidebar → Homework → '+ Custom.'",
          "Free-form title, instructions, optional YouTube demo, due date.",
          "Use this for one-offs that don't fit a template.",
        ],
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
    title: "Training Homework",
    icon: "fa-clipboard-list",
    color: "text-shOrange",
    cards: [
      {
        title: "Find your homework",
        steps: [
          "Look for the 'Training Homework' section about halfway down your portal.",
          "Each assigned form shows your dog's name, the title, and the due date.",
          "If your trainer added a YouTube video, you'll see a 'Watch Demo' link — open it before practicing.",
        ],
      },
      {
        title: "Log a practice session (this is the big one)",
        steps: [
          "Most homework now has sections like 'Crate Schedule' or 'Loading the Marker Words.' Read the instructions in each.",
          "Tap '+ Log a session' on whichever section you practiced today.",
          "Fill in just the numbers you tracked — reps, minutes, success-rate, whatever. Skip fields you didn't measure.",
          "Add a quick note ('Place was solid until the kids came home') and hit Save.",
        ],
        tip: "Be honest with the numbers. Your trainer sees trends — if 'jump attempts' is going UP each week, they'll re-teach the protocol next session. That's a feature, not a punishment.",
      },
      {
        title: "Mark the whole assignment as Done",
        steps: [
          "When you've worked the form for the week, tap the green 'Mark Done' button.",
          "Add a final note about wins/struggles.",
          "Snap a quick photo if you have one (a happy dog on Place, a clean recall video screenshot — anything).",
          "Hit Save. Your trainer sees it the next time they open the app.",
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
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-[13px]" />
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
                    className="bg-shBlue/15 text-shBlue px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest hover:bg-shBlue/25 flex items-center gap-2">
              <i className="fas fa-print" />
              <span className="hidden sm:inline">Print Page</span>
            </button>
            <button onClick={printAll} data-testid="tutorials-print-all"
                    title="Print the full guide (all sections)"
                    className="bg-shGreen/15 text-shGreen px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest hover:bg-shGreen/25 flex items-center gap-2">
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
            className={`px-4 py-2 rounded-lg text-[13px] font-black uppercase tracking-widest border transition ${
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
                      <i className={`fas fa-circle-check ${s.color} mt-1 text-[12px]`} />
                      <span>{c.title}</span>
                    </h5>
                    <ol className="mt-3 space-y-2 text-[13px] text-gray-300">
                      {c.steps.map((step, j) => (
                        <li key={j} className="flex gap-3">
                          <span className={`${s.color} font-black flex-shrink-0`}>{j + 1}.</span>
                          <span className="leading-snug">{step}</span>
                        </li>
                      ))}
                    </ol>
                    {c.tip && (
                      <p className="mt-3 text-[12px] text-shOrange bg-shOrange/5 border border-shOrange/20 rounded p-2.5 leading-snug tip-box">
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
