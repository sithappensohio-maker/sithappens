/* Public website layer — shared, framework-free logic.
 *
 * The app is BOTH the public Sit Happens website and the client/staff
 * application. This module answers the routing question for `/` and holds
 * the small pure helpers the public pages share, so the rules can be tested
 * without rendering anything.
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api";

/** Where a visitor at `/` should land.
 *  - "loading": auth state unknown yet
 *  - "login":   guest, but the link carries something only the sign-in screen
 *               handles (a referral code, or the old #landing-auth anchor)
 *  - "public":  guest → the public homepage
 *  - "app":     signed in → the existing client / staff / admin experience */
export function rootDestination({ user, search = "", hash = "" } = {}) {
  if (user === null || user === undefined) return "loading";
  if (user) return "app";
  let params;
  try { params = new URLSearchParams(search || ""); } catch { params = new URLSearchParams(); }
  if ((params.get("ref") || "").trim()) return "login";
  if ((hash || "").replace(/^#/, "") === "landing-auth") return "login";
  return "public";
}

/** Public navigation — mirrors the live site's menu, minus the parts the app
 *  already owns (Account → Client login, Cart → the app's Shop). */
export const PUBLIC_NAV = [
  { key: "home", label: "Home", to: "/" },
  { key: "training", label: "Training", to: "/training" },
  { key: "daycare", label: "Daycare & Boarding", to: "/#daycare-boarding" },
  // Grooming is a real, configured service that the website never mentioned.
  // The section hides itself when nothing is configured; this link resolves to
  // that section, so an empty install simply lands at the top of the page.
  { key: "grooming", label: "Grooming", to: "/#grooming" },
  { key: "school", label: "Online School", to: "/shop?section=online_school" },
  { key: "photography", label: "Pet Photography", to: "/photography" },
  { key: "about", label: "About Us", to: "/about" },
  { key: "shop", label: "Shop", to: "/shop" },
  { key: "contact", label: "Contact", to: "/contact" },
];

/** Where the primary "book" action goes. Booking lives inside the app, so a
 *  guest is sent to sign in and lands in their portal afterwards; a signed-in
 *  client goes straight to their portal. */
export function bookingHref(user) {
  return user ? "/" : "/login";
}

/** The existing Online School door (the same URL the old landing used). */
export const ONLINE_SCHOOL_HREF = "/shop?section=online_school";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABEL = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

export function fmtTime(hhmm) {
  if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return hhmm || "";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${period}` : `${h12} ${period}`;
}

/** Collapse a business_hours map into readable rows: consecutive days with
 *  the same hours share a row ("Mon–Sat 7 AM – 7 PM", "Sun Closed"). */
export function hoursRows(businessHours) {
  const rows = [];
  if (!businessHours || typeof businessHours !== "object") return rows;
  const label = (d) => {
    const r = businessHours[d];
    if (!r) return null;
    if (r.closed) return "Closed";
    if (!r.open || !r.close) return null;
    return `${fmtTime(r.open)} – ${fmtTime(r.close)}`;
  };
  let start = null; let prev = null; let prevLabel = null;
  const flush = () => {
    if (!start) return;
    rows.push({ days: start === prev ? DAY_LABEL[start] : `${DAY_LABEL[start]}–${DAY_LABEL[prev]}`, hours: prevLabel });
  };
  for (const d of DAYS) {
    const l = label(d);
    if (l === null) { flush(); start = null; prev = null; prevLabel = null; continue; }
    if (start && l === prevLabel) { prev = d; continue; }
    flush(); start = d; prev = d; prevLabel = l;
  }
  flush();
  return rows;
}

export function money(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "";
  const v = Number(n);
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

export function formatLabel(format) {
  if (!format || !format.count || !format.unit) return "";
  const unit = String(format.unit);
  const singular = unit.endsWith("s") ? unit.slice(0, -1) : unit;
  return `${format.count} ${format.count === 1 ? singular : unit}`;
}

/** One shared fetch of /public/site for every public page in the session. */
let _sitePromise = null;
export function loadPublicSite() {
  if (!_sitePromise) {
    _sitePromise = api.get("/public/site").then((r) => r.data).catch((e) => { _sitePromise = null; throw e; });
  }
  return _sitePromise;
}
export function _resetPublicSiteCacheForTests() { _sitePromise = null; }

export function usePublicSite() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPublicSite().then((d) => { if (alive) setData(d); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  return { site: data?.site || null, data, failed };
}
