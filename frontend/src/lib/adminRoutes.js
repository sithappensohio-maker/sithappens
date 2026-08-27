/**
 * Phase 2 modernization — canonical admin URL registry.
 *
 * The old application used an in-memory `tab` string as navigation state.
 * These helpers provide a stable URL for every admin destination while still
 * accepting the old tab ids during the migration.  Keeping all translation
 * here prevents components from inventing their own URL rules.
 */

const enc = (value) => encodeURIComponent(String(value ?? ""));
const dec = (value) => {
  try { return decodeURIComponent(value || ""); }
  catch { return value || ""; }
};

export const LEGACY_ADMIN_TAB_ALIASES = {
  dashboard: "today",
  register: "pos",
  shop_organization: "shop_manager",
};

export const ADMIN_PATH_BY_TAB = {
  today: "/admin/today",
  action_center: "/admin/action-center",
  pos: "/admin/front-desk",
  schedule: "/admin/schedule",
  runsheet: "/admin/run-sheet",
  care: "/admin/care",
  kennel: "/admin/kennel",
  clients: "/admin/clients",
  dogs: "/admin/dogs",
  duplicate_check: "/admin/duplicate-check",
  pipeline: "/admin/training",
  income: "/admin/finance",
  credit_reconciliation: "/admin/finance/credit-audit",
  shop_manager: "/admin/shop-manager",
  staff: "/admin/team",
  incidents: "/admin/incidents",
  intake: "/admin/intake",
  messages: "/admin/messages",
  announcements: "/admin/announcements",
  bulkemail: "/admin/bulk-email",
  audit: "/admin/audit-log",
  settings: "/admin/settings",
  tutorials: "/admin/help",
};

export const SCHEDULE_TAB_BY_SECTION = {
  calendar: "schedule",
  schedule: "schedule",
  bookings: "bookings",
  waitlist: "waitlist",
  recurring: "recurring",
};

export const TRAINING_TAB_BY_SECTION = {
  today: "pipeline",
  pipeline: "pipeline",
  school: "school_hq",
  school_hq: "school_hq",
  practice: "homework",
  homework: "homework",
  rewards: "rewards_center",
  rewards_center: "rewards_center",
  trophies: "trophies",
};

export const canonicalAdminTab = (tab) => LEGACY_ADMIN_TAB_ALIASES[tab] || tab || "today";

export function adminPathForTab(tab, target = null) {
  const rawTab = tab || "today";
  const canonical = canonicalAdminTab(rawTab);

  // Workspace child destinations keep their old tab ids internally, but get
  // human-readable nested URLs externally.
  if (["schedule", "bookings", "waitlist", "recurring"].includes(rawTab)) {
    if (rawTab === "schedule") return "/admin/schedule";
    return `/admin/schedule/${rawTab}`;
  }
  if (["pipeline", "school_hq", "homework", "rewards_center", "trophies"].includes(rawTab)) {
    const slug = {
      pipeline: "",
      school_hq: "school",
      homework: "practice",
      rewards_center: "rewards",
      trophies: "trophies",
    }[rawTab];
    return slug ? `/admin/training/${slug}` : "/admin/training";
  }

  if (canonical === "clients" && target) {
    const clientId = target.clientId || (target.kind === "client" ? target.id : null);
    if (clientId) {
      const root = `/admin/clients/${enc(clientId)}`;
      if (target.kind === "booking" && target.id) return `${root}/bookings/${enc(target.id)}`;
      if (target.kind === "invoice" && target.id) return `${root}/invoices/${enc(target.id)}`;
      if (target.kind === "messages") return `${root}/messages`;
      const focus = target.mode === "scroll" ? "?focus=scroll" : "";
      return `${root}${focus}`;
    }
  }

  if (canonical === "dogs" && target?.id) {
    const focus = target.mode === "scroll" ? "?focus=scroll" : "";
    return `/admin/dogs/${enc(target.id)}${focus}`;
  }

  if (canonical === "settings" && target?.section) {
    const section = String(target.section);
    if (section === "__overview__ops") return "/admin/settings";
    if (section.startsWith("__overview__")) {
      return `/admin/settings/category/${enc(section.slice("__overview__".length))}`;
    }
    return `/admin/settings/${enc(section)}`;
  }

  return ADMIN_PATH_BY_TAB[canonical] || "/admin/today";
}

const SIMPLE_ROUTE_TO_TAB = {
  "today": "today",
  "action-center": "action_center",
  "front-desk": "pos",
  "run-sheet": "runsheet",
  "care": "care",
  "kennel": "kennel",
  "duplicate-check": "duplicate_check",
  "finance": "income",
  "shop-manager": "shop_manager",
  "team": "staff",
  "incidents": "incidents",
  "intake": "intake",
  "messages": "messages",
  "announcements": "announcements",
  "bulk-email": "bulkemail",
  "audit-log": "audit",
  "help": "tutorials",
};

/**
 * Parse the current browser location into the legacy tab id expected by the
 * existing screens plus an optional record target.  This is intentionally a
 * pure function so routing behavior can be regression-tested without a DOM.
 */
export function parseAdminLocation(pathname = "/", search = "") {
  const clean = String(pathname || "/").replace(/\/+$/, "") || "/";
  const parts = clean.split("/").filter(Boolean).map(dec);
  const params = new URLSearchParams(search || "");

  if (parts[0] !== "admin") {
    return { isAdminPath: false, tab: "today", target: null, canonicalPath: "/admin/today" };
  }

  if (parts.length === 1) {
    return { isAdminPath: true, tab: "today", target: null, canonicalPath: "/admin/today", needsCanonicalRedirect: true };
  }

  const first = parts[1];

  // Legacy URL aliases are accepted so stale bookmarks don't break.
  if (first === "dashboard") {
    return { isAdminPath: true, tab: "today", target: null, canonicalPath: "/admin/today", needsCanonicalRedirect: true };
  }
  if (first === "bookings" || first === "waitlist" || first === "recurring") {
    const path = `/admin/schedule/${first}`;
    return { isAdminPath: true, tab: first, target: null, canonicalPath: path, needsCanonicalRedirect: true };
  }
  if (first === "school" || first === "practice" || first === "rewards" || first === "trophies") {
    const tab = TRAINING_TAB_BY_SECTION[first];
    const path = adminPathForTab(tab);
    return { isAdminPath: true, tab, target: null, canonicalPath: path, needsCanonicalRedirect: true };
  }

  if (first === "schedule") {
    const section = parts[2] || "calendar";
    const tab = SCHEDULE_TAB_BY_SECTION[section] || "schedule";
    return {
      isAdminPath: true,
      tab,
      target: null,
      canonicalPath: adminPathForTab(tab),
      needsCanonicalRedirect: !SCHEDULE_TAB_BY_SECTION[section],
    };
  }

  if (first === "training") {
    const section = parts[2] || "today";
    const tab = TRAINING_TAB_BY_SECTION[section] || "pipeline";
    return {
      isAdminPath: true,
      tab,
      target: null,
      canonicalPath: adminPathForTab(tab),
      needsCanonicalRedirect: !TRAINING_TAB_BY_SECTION[section],
    };
  }

  if (first === "clients") {
    if (!parts[2]) return { isAdminPath: true, tab: "clients", target: null, canonicalPath: "/admin/clients" };
    const clientId = parts[2];
    let target = { kind: "client", id: clientId, clientId, mode: params.get("focus") === "scroll" ? "scroll" : "open" };
    if (parts[3] === "bookings" && parts[4]) target = { kind: "booking", id: parts[4], clientId, mode: "open" };
    else if (parts[3] === "invoices" && parts[4]) target = { kind: "invoice", id: parts[4], clientId, mode: "open" };
    else if (parts[3] === "messages") target = { kind: "messages", id: null, clientId, mode: "open" };
    const recognizedSuffix = !parts[3] ||
      (parts[3] === "bookings" && !!parts[4]) ||
      (parts[3] === "invoices" && !!parts[4]) ||
      parts[3] === "messages";
    return {
      isAdminPath: true,
      tab: "clients",
      target,
      canonicalPath: adminPathForTab("clients", target),
      needsCanonicalRedirect: !recognizedSuffix || parts.length > (parts[3] === "bookings" || parts[3] === "invoices" ? 5 : parts[3] === "messages" ? 4 : 3),
    };
  }

  if (first === "dogs") {
    if (!parts[2]) return { isAdminPath: true, tab: "dogs", target: null, canonicalPath: "/admin/dogs", needsCanonicalRedirect: parts.length > 2 };
    const target = { kind: "dog", id: parts[2], mode: params.get("focus") === "scroll" ? "scroll" : "open" };
    return {
      isAdminPath: true,
      tab: "dogs",
      target,
      canonicalPath: adminPathForTab("dogs", target),
      needsCanonicalRedirect: parts.length > 3,
    };
  }

  if (first === "settings") {
    let section = null;
    if (parts[2] === "category" && parts[3]) section = `__overview__${parts[3]}`;
    else if (parts[2]) section = parts[2];
    const target = section ? { kind: "settings", section } : null;
    return { isAdminPath: true, tab: "settings", target, canonicalPath: adminPathForTab("settings", target) };
  }

  if (first === "finance" && parts[2] === "credit-audit") {
    return { isAdminPath: true, tab: "credit_reconciliation", target: null, canonicalPath: "/admin/finance/credit-audit" };
  }

  const tab = SIMPLE_ROUTE_TO_TAB[first];
  if (tab) return {
    isAdminPath: true,
    tab,
    target: null,
    canonicalPath: adminPathForTab(tab),
    needsCanonicalRedirect: parts.length > 2,
  };

  return { isAdminPath: true, tab: "today", target: null, canonicalPath: "/admin/today", needsCanonicalRedirect: true };
}
