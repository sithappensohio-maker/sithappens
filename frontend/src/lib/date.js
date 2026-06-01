// Sprint 110bg — Local-date helpers.
//
// JavaScript's `new Date()` / `toISOString()` work in UTC, which breaks any
// "today" / month-range / week-range logic in negative-offset timezones
// (e.g. US Eastern is UTC-4/-5). The user's report: "today is the 1st of the
// new month and it's not displaying what I added today" — caused by
// `new Date("2026-06-01")` parsing as UTC midnight, which is May 31 8pm local
// in Warren OH, so the month preset computed May (last month) instead of June.
//
// Always use these helpers when:
//   • building "today" as a YYYY-MM-DD string
//   • parsing a YYYY-MM-DD string back into a Date
//   • formatting a Date back to YYYY-MM-DD for an API/state value

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function localISOFromDate(d) {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function parseLocalISO(s) {
  // Parse a YYYY-MM-DD string as a LOCAL date (midnight local time), NOT UTC.
  if (!s) return new Date();
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localISOFromDate(d);
}

export function daysFromTodayISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localISOFromDate(d);
}
