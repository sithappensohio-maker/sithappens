/* The Today / Action Center rows say what a card is in plain words, never the
 * backend code (audit: "The Today list shows internal codes instead of names").
 * Mounted; the completeness guard reads the server's feed so a new kind
 * without a label fails here, not on a staff screen.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import fs from "fs";
import path from "path";

jest.mock("../../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (e) => String(e) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./StuckCheckoutsResolver", () => () => null);

const { ACTION_KIND_LABEL } = require("./ActionRow");
const ActionRow = require("./ActionRow").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const EXPECTED = {
  hw_review: "Homework Review", hw_question: "Homework Question", school_practice_log: "Online School Practice",
  steps_incomplete: "Tracker Steps Open", vaccine_upload_review: "Vaccine Upload", vaccine_missing: "Vaccine Missing",
  vaccine_expired: "Vaccine Expired", vaccine_expiring: "Vaccine Expiring", no_checkin: "Not Checked In",
  low_credits: "Low Credits", booking_pending: "Booking Needs Approval", contact_inquiry: "New Inquiry",
  help_request: "Help Request", quote_request: "Quote Request", reward_referral: "Referral Reward",
  reward_trivia: "Trivia Reward", unpaid_balance: "Unpaid Balance", missing_closeout: "Register Closeout",
  stuck_checkout: "Missed Checkout", pipeline_ready: "Certificate Ready", new_signup: "New Signup",
  monday_digest: "Monday Digest", waitlist_spot_open: "Waitlist — Spot Opened",
  recurring_renewal_missed: "Weekly Schedule — Days Not Booked", prepaid_sessions_closed: "Prepaid Lessons Closed",
};

let container; let root;
const kindText = (id) => container.querySelector(`[data-testid="action-center-kind-${id}"]`)?.textContent;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const mount = async (item) => { await act(async () => { root.render(<ActionRow item={item} onOpen={() => {}} />); }); };

test("a stuck checkout row says Missed Checkout, not stuck_checkout", async () => {
  await mount({ id: "stuck-checkout:1", kind: "stuck_checkout", priority: "urgent", title: "1 checked-in booking may be stuck" });
  expect(kindText("stuck-checkout:1")).toBe("Urgent · Missed Checkout");
  expect(container.textContent).not.toContain("stuck_checkout");
});

test.each(Object.entries(EXPECTED))("kind %s shows plain words", async (kind, words) => {
  await mount({ id: `k-${kind}`, kind, priority: "info", title: "x" });
  expect(kindText(`k-${kind}`)).toBe(`FYI / Follow-up · ${words}`);
  expect(kindText(`k-${kind}`)).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
});

test("an unknown kind or a missing kind shows only the priority, never a code or 'task'", async () => {
  await mount({ id: "u1", kind: "brand_new_kind", priority: "warn", title: "x" });
  expect(kindText("u1")).toBe("Needs Attention");
  await mount({ id: "u2", priority: "info", title: "x" });
  expect(kindText("u2")).toBe("FYI / Follow-up");
  expect(container.textContent).not.toContain("brand_new_kind");
  expect(container.textContent).not.toMatch(/·\s*task/i);
});

test("every kind the Today feed can send has a label", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "backend", "server.py"), "utf8");
  const start = server.indexOf("async def admin_today_brain(");
  const end = server.indexOf("def _today_brain_signature(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const kinds = new Set([...server.slice(start, end).matchAll(/"kind": "([a-z_]+)"/g)].map((m) => m[1]));
  for (const f of ["waitlist_spots.py", "renewal_misses.py", "prepaid_close.py"]) {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "backend", "domains", "bookings", f), "utf8");
    for (const m of src.matchAll(/(?:TYPE\s*=\s*|"kind":\s*)"([a-z_]+)"/g)) kinds.add(m[1]);
  }
  expect(kinds.size).toBeGreaterThanOrEqual(25);
  const missing = [...kinds].filter((k) => !(k in ACTION_KIND_LABEL));
  expect(missing).toEqual([]);
});
