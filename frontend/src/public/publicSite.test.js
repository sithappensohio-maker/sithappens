/**
 * @jest-environment jsdom
 */
// The public website layer: who lands where at `/`, the helpers the pages
// share, and the wiring that keeps the site on the app's existing doors.
import fs from "fs";
import path from "path";
import { rootDestination, hoursRows, fmtTime, money, formatLabel, bookingHref, PUBLIC_NAV, ONLINE_SCHOOL_HREF } from "./publicSite";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

describe("rootDestination — the one URL whose meaning depends on who is asking", () => {
  test("auth still loading → loading; any signed-in user → the existing app", () => {
    expect(rootDestination({ user: null })).toBe("loading");
    expect(rootDestination({ user: undefined })).toBe("loading");
    expect(rootDestination({ user: { role: "client" } })).toBe("app");
    expect(rootDestination({ user: { role: "employee" } })).toBe("app");
    expect(rootDestination({ user: { role: "admin", must_change_password: true } })).toBe("app");
  });
  test("a guest gets the public homepage, including the PWA start URL", () => {
    expect(rootDestination({ user: false })).toBe("public");
    expect(rootDestination({ user: false, search: "?source=pwa" })).toBe("public");
    expect(rootDestination({ user: false, search: "", hash: "" })).toBe("public");
  });
  test("links only the sign-in screen can honour still reach it", () => {
    expect(rootDestination({ user: false, search: "?ref=7KTUMQ" })).toBe("login");
    expect(rootDestination({ user: false, hash: "#landing-auth" })).toBe("login");
    expect(rootDestination({ user: { role: "client" }, search: "?ref=X" })).toBe("app");
  });
});

describe("helpers", () => {
  test("hours collapse consecutive identical days", () => {
    const h = { monday: { open: "07:00", close: "19:00" }, tuesday: { open: "07:00", close: "19:00" }, wednesday: { open: "07:00", close: "19:00" },
      thursday: { open: "07:00", close: "19:00" }, friday: { open: "07:00", close: "19:00" }, saturday: { open: "08:00", close: "17:30" }, sunday: { closed: true } };
    expect(hoursRows(h)).toEqual([
      { days: "Mon–Fri", hours: "7 AM – 7 PM" },
      { days: "Sat", hours: "8 AM – 5:30 PM" },
      { days: "Sun", hours: "Closed" },
    ]);
    expect(hoursRows(null)).toEqual([]);
  });
  test("formatting", () => {
    expect(fmtTime("06:30")).toBe("6:30 AM");
    expect(fmtTime("12:00")).toBe("12 PM");
    expect(money(30)).toBe("$30");
    expect(money(19.99)).toBe("$19.99");
    expect(money(null)).toBe("");
    expect(formatLabel({ count: 5, unit: "sessions" })).toBe("5 sessions");
    expect(formatLabel({ count: 1, unit: "weeks" })).toBe("1 week");
    expect(formatLabel(null)).toBe("");
  });
  test("booking goes through the app: guests sign in first, clients go to their portal", () => {
    expect(bookingHref(null)).toBe("/login");
    expect(bookingHref({ role: "client" })).toBe("/");
    expect(ONLINE_SCHOOL_HREF).toBe("/shop?section=online_school");
  });
  test("navigation mirrors the live site's menu and uses app-owned destinations", () => {
    const labels = PUBLIC_NAV.map((n) => n.label);
    for (const l of ["Home", "Training", "Contact", "About Us", "Pet Photography", "Shop"]) expect(labels).toContain(l);
    expect(PUBLIC_NAV.find((n) => n.key === "shop").to).toBe("/shop");
    expect(PUBLIC_NAV.find((n) => n.key === "school").to).toBe(ONLINE_SCHOOL_HREF);
  });
});

describe("wiring", () => {
  const app = read("..", "App.js");
  const home = read("PublicHome.jsx");
  const bits = read("PublicBits.jsx");
  const shell = read("PublicSiteShell.jsx");
  const login = read("..", "screens", "Login.jsx");

  test("routes: / is decided by RootGate, /login is the focused sign-in, public pages have their own routes, app routes untouched", () => {
    expect(app).toMatch(/<Route path="\/" element=\{<AppProviders><RootGate \/><\/AppProviders>\} \/>/);
    expect(app).toMatch(/<Route path="\/login" element=\{<AppProviders><LoginRoute \/><\/AppProviders>\} \/>/);
    for (const p of ["/training", "/about", "/photography", "/contact"]) expect(app).toContain(`<Route path="${p}" element={<AppProviders>`);
    expect(app).toMatch(/<Route path="\/shop\/\*" element=\{<AppProviders><ShopGate \/><\/AppProviders>\} \/>/);
    expect(app).toMatch(/<Route path="\/admin\/\*" element=\{<AppProviders><Gate \/><\/AppProviders>\} \/>/);
    expect(app).toMatch(/<Route path="\*" element=\{<AppProviders><Gate \/><\/AppProviders>\} \/>/);
    // RootGate hands signed-in users to the unchanged Gate, guests to PublicHome, referral links to /login
    expect(app).toMatch(/if \(dest === "login"\) return <Navigate to=\{`\/login\$\{search \|\| ""\}`\} replace \/>;/);
    expect(app).toMatch(/if \(dest === "public"\) return <PublicHome \/>;/);
    expect(app).toMatch(/return <Gate \/>;\n\}\n\n\/\/ \/login/);
    expect(app).toMatch(/if \(user\) return <Navigate to="\/" replace \/>;\s*return <Login focus \/>;/);
    // Gate itself is unchanged: guest → Login, roles → their shells
    expect(app).toMatch(/if \(!user\) return <Login \/>;\s*if \(user\.must_change_password\) return <ForcedPasswordChange \/>;\s*if \(user\.role === "admin"\) return <AdminShell \/>;\s*if \(user\.role === "employee"\) return <EmployeePortal \/>;\s*return <Portal \/>;/);
  });

  test("the homepage answers the seven questions with the app's own systems", () => {
    expect(home).toMatch(/data-testid="site-hero-headline"/);           // what we do
    expect(home).toMatch(/ContactStrip site=\{site\} testid="site-hero-contact"/); // where we are
    expect(home).toMatch(/api\.get\("\/public\/training-programs"\)/);   // training options from programs
    expect(home).toMatch(/api\.get\("\/public\/services"\)/);            // daycare/boarding/photo prices from services
    expect(home).toMatch(/to=\{bookingHref\(user\)\}/);                  // booking through the app
    expect(home).toMatch(/<FreeCourseCard \/>/);                         // free course from the storefront
    expect(bits).toMatch(/api\.get\("\/public\/shop\/catalog"\)/);
    expect(bits).toMatch(/i\.kind === "training_program" && i\.free_claim_available === true/);
    expect(bits).toMatch(/free_claim_available === true/);
    expect(home).toMatch(/to=\{user \? "\/" : "\/login"\}/);             // client login
    expect(home).toMatch(/data-testid="site-contact-details"/);         // contact
    // the doors are the existing ones
    expect(bits).toMatch(/import RequestMeetGreetModal from "\.\.\/components\/RequestMeetGreetModal"/);
    expect(bits).toMatch(/import ContactInquiryModal from "\.\.\/components\/ContactInquiryModal"/);
    // no business facts hardcoded in the pages — they come from /public/site
    for (const src of [home, bits, shell]) {
      expect(src).not.toMatch(/330-978|978-5575|sithappensohio@gmail|137 North/);
    }
  });

  test("the shell offers guests account creation, not just login, and My portal once signed in", () => {
    expect(shell).toMatch(/const accountHref = signedIn \? "\/" : "\/login";/);
    // The slash in the label has to be escaped or it closes the literal.
    expect(shell).toMatch(/const accountLabel = signedIn \? "My portal" : "Sign in \/ Create account";/);
    expect(shell).toMatch(/data-testid="site-menu-toggle"/);
  });

  test("Login keeps every auth path and gains a focused mode for /login", () => {
    expect(login).toMatch(/export default function Login\(\{ focus = false \}\)/);
    expect(login).toMatch(/if \(focus\) \{/);
    expect(login).toMatch(/data-testid="login-screen" data-focus="true"/);
    expect(login).toMatch(/data-testid="login-back-site"/);
    // the one auth card, rendered in both layouts
    expect(login.match(/\{authCard\}/g)).toHaveLength(2);
    for (const id of ["login-email-input", "login-password-input", "login-submit-button", "tab-register", "forgot-password-link", "login-mfa-input", "register-refcode-input"]) {
      expect(login).toContain(`data-testid="${id}"`);
    }
  });
});

test("Settings → Public Website edits the same facts the website reads", () => {
  const settings = read("..", "screens", "Settings.jsx");
  const panel = read("..", "components", "PublicWebsitePanel.jsx");
  expect(settings).toMatch(/import PublicWebsitePanel from "\.\.\/components\/PublicWebsitePanel"/);
  expect(settings).toMatch(/\{ id: "public_site", label: "Public Website", icon: "fa-globe",/);
  expect(settings).toMatch(/\{tab === "public_site" && <PublicWebsitePanel \/>\}/);
  expect(panel).toMatch(/api\.get\("\/public\/site"\)/);
  expect(panel).toMatch(/api\.put\("\/settings", \{ public_site \}\)/);
  for (const k of ["phone", "email", "address_line", "city", "state", "zip", "service_area", "hero_headline", "hero_subheadline", "gallery_url"]) {
    expect(panel).toContain(`key: "${k}"`);
  }
});
