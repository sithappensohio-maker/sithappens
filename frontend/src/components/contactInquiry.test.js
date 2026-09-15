// The public "Tell us about your dog" questionnaire and where its answers go.
// Source-pinned (this repo's convention) so the landing door, the modal, the
// admin screen and Action Required stay wired together.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const modal = read("ContactInquiryModal.jsx");
const login = read("..", "screens", "Login.jsx");
const app = read("..", "App.js");
const inquiries = read("..", "screens", "Inquiries.jsx");
const panel = read("PendingActionsPanel.jsx");

test("the landing page offers the questionnaire as a third door and mounts the modal", () => {
  expect(login).toMatch(/import ContactInquiryModal from "\.\.\/components\/ContactInquiryModal"/);
  expect(login).toMatch(/data-testid="landing-inquiry-card"/);
  expect(login).toMatch(/data-testid="landing-hero-inquiry-cta"/);
  expect(login).toMatch(/Tell us about your dog/);
  expect(login).toMatch(/<ContactInquiryModal open=\{inquiryOpen\} onClose=/);
  // The Meet & Greet door is still there.
  expect(login).toMatch(/data-testid="landing-hero-meet-greet-cta"/);
});

test("the modal posts the whole questionnaire to the public endpoint and carries a honeypot", () => {
  expect(modal).toMatch(/api\.post\("\/public\/contact-inquiry", f\)/);
  expect(modal).toMatch(/api\.get\("\/public\/contact-inquiry-options"\)/);
  // the required eight
  for (const id of ["ci-name", "ci-phone", "ci-email", "ci-contact", "ci-dog-name", "ci-breed", "ci-age", "ci-interest", "ci-concern", "ci-message"]) {
    expect(modal).toContain(`testid="${id}"`);
  }
  // the optional extras live behind one toggle
  expect(modal).toMatch(/data-testid="ci-more-toggle"/);
  for (const id of ["ci-sex", "ci-fixed", "ci-vax", "ci-previous", "ci-household", "ci-zip", "ci-heard", "ci-start"]) {
    expect(modal).toContain(`testid="${id}"`);
  }
  // honeypot: off-screen, tab-skipped, named like a field a bot wants to fill
  expect(modal).toMatch(/website: "",\s*\/\/ honeypot/);
  expect(modal).toMatch(/aria-hidden="true" style=\{\{ position: "absolute", left: "-10000px"/);
  expect(modal).toMatch(/tabIndex=\{-1\}[^>]*data-testid="ci-website"/);
  // client-side guard rails match the server's min_length=1 on both lists
  expect(modal).toMatch(/if \(f\.interests\.length === 0\)/);
  expect(modal).toMatch(/if \(f\.concerns\.length === 0\)/);
  expect(modal).toMatch(/data-testid="contact-inquiry-success"/);
});

test("the vocabulary in the modal's fallback matches the server's", () => {
  const py = fs.readFileSync(path.join(__dirname, "..", "..", "..", "backend", "domains", "public_site", "routes.py"), "utf8").replace(/\r\n/g, "\n");
  const keys = (src, name) => {
    const start = src.indexOf(`${name} = {`);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("}", start); // dict values never contain a brace
    return src.slice(start, end).match(/"([a-z_]+)":/g).map((k) => k.slice(1, -2)).sort();
  };
  const jsKeys = (name) => {
    const m = modal.match(new RegExp(`${name}: \\{([^}]*)\\}`));
    return m[1].match(/([a-z_]+):/g).map((k) => k.slice(0, -1)).sort();
  };
  expect(jsKeys("interests")).toEqual(keys(py, "INQUIRY_INTERESTS"));
  expect(jsKeys("concerns")).toEqual(keys(py, "INQUIRY_CONCERNS"));
  expect(jsKeys("start_timing")).toEqual(keys(py, "INQUIRY_START_TIMING"));
});

test("Inquiries is a real admin screen, gated like Clients, reachable from Action Required", () => {
  expect(app).toMatch(/import Inquiries from "\.\/screens\/Inquiries"/);
  const routes = read("..", "lib", "adminRoutes.js");
  expect(routes).toMatch(/inquiries: "\/admin\/inquiries"/);
  expect(routes).toMatch(/"inquiries": "inquiries"/);
  expect(app).toMatch(/\{ id: "inquiries", label: "Inquiries", icon: "fa-inbox", perm: "clients_edit" \}/);
  expect(app).toMatch(/ids: \["today", "dashboard", "action_center", "pos", "clients", "inquiries", "dogs", "messages"\]/);
  expect(app).toMatch(/\{tab === "inquiries" && navAllowed\("inquiries"\) && <Inquiries can=\{can\} onOpenClient=/);
  expect(panel).toMatch(/contact_inquiry: "fa-inbox"/);
  expect(panel).toMatch(/contact_inquiry: "Review Inquiry"/);
  expect(panel).toMatch(/action\.type === "contact_inquiry" \?/);
  // the screen refreshes Action Required badges when a status changes
  expect(inquiries).toMatch(/api\.get\("\/inquiries", \{ params: \{ status: "all" \} \}\)/);
  expect(inquiries).toMatch(/api\.patch\(`\/inquiries\/\$\{inq\.id\}`, body\)/);
  expect(inquiries).toMatch(/new CustomEvent\("sh:pending-actions-changed"\)/);
  for (const id of ["-email", "-call", "-text", "-mark-contacted", "-close", "-reopen", "-open-client", "-notes"]) {
    expect(inquiries).toContain(`inquiry-\${inq.id}${id}`);
  }
});
