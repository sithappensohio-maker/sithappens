// Upcoming public events — one shared fetch for the site nav, the homepage
// banner, the /events index and the client portal card, so every surface
// shows and hides the same events as they are published and closed.
import { useEffect, useState } from "react";
import { api, API_BASE } from "../lib/api";

let _eventsPromise = null;
export function loadPublicEvents() {
  if (!_eventsPromise) {
    _eventsPromise = api.get("/public/events").then((r) => r.data?.events || []).catch((e) => { _eventsPromise = null; throw e; });
  }
  return _eventsPromise;
}
export function _resetPublicEventsCacheForTests() { _eventsPromise = null; }

/** `null` while loading, otherwise the list (empty when nothing is coming up). */
export function usePublicEvents() {
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let alive = true;
    loadPublicEvents().then((list) => { if (alive) setEvents(list); }).catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, []);
  return events;
}

export function eventHref(ev) { return `/events/${ev.slug}`; }

/** Where an "Events" link should go: straight to the only event, or the index. */
export function eventsNavItem(events) {
  if (!events || events.length === 0) return null;
  return { key: "events", label: "Events", to: events.length === 1 ? eventHref(events[0]) : "/events" };
}

/** { day, time } for an event, or "" when there is no start. */
export function fmtEventWhen(ev) {
  if (!ev?.start_at) return "";
  const s = new Date(ev.start_at); const e = ev.end_at ? new Date(ev.end_at) : null;
  const day = s.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const t = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return { day, time: e ? `${t(s)} – ${t(e)}` : t(s) };
}

/** Short one-liner: "Sat, Oct 24, 2026 · 2:00 PM – 5:00 PM" (the year matters once events span a calendar). */
export function fmtEventShort(ev) {
  if (!ev?.start_at) return "";
  const s = new Date(ev.start_at); const e = ev.end_at ? new Date(ev.end_at) : null;
  const t = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · ${t(s)}${e ? ` – ${t(e)}` : ""}`;
}

/** Where an uploaded banner background lives, or null when there is none.
 *  No file extension on the path: production nginx serves image-looking
 *  paths statically before the API proxy sees them. */
export function bannerImageUrl(ev) {
  if (!ev?.banner_image_version) return null;
  return `${API_BASE}/public/events/${ev.slug}/banner?v=${ev.banner_image_version}`;
}
