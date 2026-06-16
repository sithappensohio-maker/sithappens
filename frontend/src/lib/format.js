// Sprint 110dm — Lightweight UI formatters that honour the admin's
// `day_to_day.ui` settings (time_format / date_format / letter_case_preference
// / show_prices_in_portal). ThemeProvider writes the resolved values to
// `window.__shUi` on every branding fetch so any component can call these
// helpers synchronously without needing the context.
//
// Usage:
//   import { fmtTime, fmtDate, fmtPrice, applyCase } from "../lib/format";
//   <span>{fmtTime("14:30")}</span>     // → "2:30 PM" (12h) or "14:30" (24h)
//   <span>{fmtDate("2026-06-15")}</span> // → "06/15/2026" | "2026-06-15" | "15/06/2026"
//   <span>{fmtPrice(35)}</span>          // hides the $ in portal mode if disabled
//   <h2>{applyCase("Good morning")}</h2> // applies upper/title/sentence preference

const PREF = () => (typeof window !== "undefined" && window.__shUi) || {};

export function fmtTime(t) {
  if (!t) return "";
  // Accept "HH:MM" or "HH:MM:SS" or ISO timestamps.
  let h, m;
  try {
    if (t.includes("T")) {
      const d = new Date(t);
      h = d.getHours();
      m = d.getMinutes();
    } else {
      const [hh, mm] = t.split(":");
      h = parseInt(hh, 10);
      m = parseInt(mm, 10);
    }
  } catch {
    return t;
  }
  if (isNaN(h) || isNaN(m)) return t;
  const pad = (n) => String(n).padStart(2, "0");
  if ((PREF().time_format || "12h") === "24h") {
    return `${pad(h)}:${pad(m)}`;
  }
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${pad(m)} ${ap}`;
}

export function fmtDate(d) {
  if (!d) return "";
  // Accept "YYYY-MM-DD" or ISO. Always render based on prefs.
  let y, mo, da;
  try {
    if (d.includes("T") || d.length > 10) {
      const x = new Date(d);
      y = x.getFullYear();
      mo = x.getMonth() + 1;
      da = x.getDate();
    } else {
      [y, mo, da] = d.split("-").map((x) => parseInt(x, 10));
    }
  } catch {
    return d;
  }
  if (!y || !mo || !da) return d;
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = PREF().date_format || "us";
  if (fmt === "iso") return `${y}-${pad(mo)}-${pad(da)}`;
  if (fmt === "eu")  return `${pad(da)}/${pad(mo)}/${y}`;
  return `${pad(mo)}/${pad(da)}/${y}`;
}

export function fmtPrice(n, { hidable = false } = {}) {
  // When called from a client-portal screen with hidable=true, the admin's
  // show_prices_in_portal toggle decides whether to render the number at all.
  if (hidable && PREF().show_prices_in_portal === false) return "";
  const v = Number(n);
  if (isNaN(v)) return "";
  return `$${v.toFixed(2)}`;
}

export function applyCase(s) {
  if (!s) return s;
  const mode = PREF().letter_case_preference || "upper";
  if (mode === "upper")  return String(s).toUpperCase();
  if (mode === "sentence") return String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
  // "title"
  return String(s).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
}

export function weekStartsOnMonday() {
  return (PREF().week_starts_on || "sunday") === "monday";
}
