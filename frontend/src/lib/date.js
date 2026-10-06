// Date helpers: the business's calendar, not UTC's and not the device's.
//
// "Today" for Sit Happens is the date on the wall in Warren, Ohio. The server
// works the same way (backend BUSINESS_TZ = ZoneInfo("America/New_York"),
// business_today()). Two things go wrong without these helpers:
//   • new Date().toISOString().slice(0, 10) is the UTC date, which is already
//     TOMORROW from 8 PM Eastern (7 PM in winter);
//   • getFullYear/getMonth/getDate on new Date() is the DEVICE's date, which is
//     wrong on a phone or computer set to another time zone.
//
// Rules:
//   • today as YYYY-MM-DD ................................. todayISO()
//   • n days before / after today .......................... daysAgoISO(n) / daysFromTodayISO(n)
//   • any YYYY-MM-DD plus or minus n days .................. addDaysISO(iso, n)
//   • the Ohio time (HH:MM) of an instant, default now ..... businessTimeHHMM(when)
//   • the Ohio date a stored timestamp falls on ............ businessDateOf(ts)
//   • a Date that stands for a calendar-grid day ........... parseLocalISO / localISOFromDate
// Never slice toISOString() for a date, and never build "today" from
// getFullYear/getMonth/getDate on new Date().

// Must match backend BUSINESS_TZ (server.py, daily_jobs.py).
export const BUSINESS_TZ = "America/New_York";

const pad2 = (v) => String(v).padStart(2, "0");

function deviceISO(d) {
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Built once. null means this runtime cannot do IANA time zones (no current
// browser); fall back to the device's own date rather than break every screen.
let businessFormatter;
function getBusinessFormatter() {
  if (businessFormatter === undefined) {
    try {
      businessFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit",
      });
    } catch {
      businessFormatter = null;
    }
  }
  return businessFormatter;
}

// The Ohio calendar date (YYYY-MM-DD) of an instant: a Date, epoch ms, or a
// stored timestamp such as "2026-10-01T00:30:00+00:00". A bare YYYY-MM-DD is
// already a calendar date and comes back unchanged. Empty or unreadable
// input returns "".
export function businessDateOf(when) {
  if (when === null || when === undefined || when === "") return "";
  if (typeof when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(when)) return when;
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = getBusinessFormatter();
  if (!fmt) return deviceISO(d);
  // formatToParts, not format(): a locale's date pattern is not a contract.
  let y = "", m = "", dd = "";
  for (const p of fmt.formatToParts(d)) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") dd = p.value;
  }
  return `${y.padStart(4, "0")}-${m}-${dd}`;
}

// Today in Ohio, on every device: the same day as the server's
// business_today(). Passes an explicit new Date() so Jest's fake clock
// freezes it.
export function todayISO() {
  return businessDateOf(new Date());
}

// Built once, like the date formatter. hourCycle "h23" keeps midnight at
// "00", never "24".
let businessTimeFormatter;
function getBusinessTimeFormatter() {
  if (businessTimeFormatter === undefined) {
    try {
      businessTimeFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: BUSINESS_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      });
    } catch {
      businessTimeFormatter = null;
    }
  }
  return businessTimeFormatter;
}

// The Ohio wall-clock time (HH:MM, 24-hour) of an instant. Defaults to now.
// Like businessDateOf(), it never reads the device's own hours or minutes,
// so a form pre-filled with it shows the same time as the business's day.
// Invalid input returns "".
export function businessTimeHHMM(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = getBusinessTimeFormatter();
  if (!fmt) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  let hh = "", mm = "";
  for (const p of fmt.formatToParts(d)) {
    if (p.type === "hour") hh = p.value;
    else if (p.type === "minute") mm = p.value;
  }
  return `${pad2(hh)}:${pad2(mm)}`;
}

// Calendar arithmetic on a YYYY-MM-DD string: no clock, no time zone, no DST.
// addDaysISO("2026-11-01", 7) is "2026-11-08" everywhere. Invalid input
// returns "".
export function addDaysISO(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (Number(n) || 0)));
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function daysAgoISO(n) {
  return addDaysISO(todayISO(), -n);
}

export function daysFromTodayISO(n) {
  return addDaysISO(todayISO(), n);
}

// Format a Date that stands for a calendar day (made by parseLocalISO or
// new Date(y, m, d) in a calendar grid) back to YYYY-MM-DD. Not for "now" or
// stored timestamps: use todayISO() / businessDateOf() for those.
export function localISOFromDate(d) {
  if (!d) return "";
  return deviceISO(d);
}

export function parseLocalISO(s) {
  // Parse a YYYY-MM-DD string as a LOCAL date (midnight local time), NOT UTC.
  if (!s) return new Date();
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
