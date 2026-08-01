/* Pure helpers behind Front Desk's "Today's Visits" (Pos.jsx) — classify,
 * filter, and sort GET /employee/roster-today rows. `checked_in_at` /
 * `checked_out_at` / booking `status` remain the only source of truth; this
 * never derives a parallel notion of "on-site" — it only reads those same
 * fields the way the backend already computed them (including the
 * backend-computed `is_missed_checkout` flag).
 */

export function classifyVisit(row) {
  if (row.checked_out_at) return "checked_out";
  if (row.checked_in_at) return "on_site";
  return "expected";
}

export function isMissedCheckout(row) {
  return !!row.is_missed_checkout;
}

// Customer-facing status word for one row.
export function visitStatusLabel(row) {
  const bucket = classifyVisit(row);
  if (bucket === "checked_out") return "Checked Out";
  if (bucket === "on_site") return isMissedCheckout(row) ? "Missed Checkout" : "On-Site";
  return "Expected";
}

export function visitCounts(roster) {
  const counts = { expected: 0, on_site: 0, checked_out: 0 };
  for (const r of roster) counts[classifyVisit(r)] += 1;
  return counts;
}

export function filterVisits(roster, tab, search) {
  let list = tab === "all" ? roster : roster.filter((r) => classifyVisit(r) === tab);
  const q = (search || "").trim().toLowerCase();
  if (q) {
    list = list.filter((r) => (r.dog_name || "").toLowerCase().includes(q) || (r.client_name || "").toLowerCase().includes(q));
  }
  return list;
}

// Missing/blank times sort after real ones within their bucket.
const timeKey = (t) => (t && t.trim()) || "99:99";

function sortExpected(list) {
  return [...list].sort((a, b) => {
    const d = timeKey(a.dropoff_time).localeCompare(timeKey(b.dropoff_time));
    if (d !== 0) return d;
    const t = timeKey(a.time).localeCompare(timeKey(b.time));
    if (t !== 0) return t;
    return (a.dog_name || "").localeCompare(b.dog_name || "");
  });
}

function sortOnSite(list) {
  return [...list].sort((a, b) => {
    const ma = isMissedCheckout(a) ? 0 : 1, mb = isMissedCheckout(b) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    const p = timeKey(a.pickup_time).localeCompare(timeKey(b.pickup_time));
    if (p !== 0) return p;
    return (a.checked_in_at || "").localeCompare(b.checked_in_at || "");
  });
}

function sortCheckedOut(list) {
  return [...list].sort((a, b) => (b.checked_out_at || "").localeCompare(a.checked_out_at || ""));
}

export function sortVisits(list, tab) {
  if (tab === "expected") return sortExpected(list);
  if (tab === "on_site") return sortOnSite(list);
  if (tab === "checked_out") return sortCheckedOut(list);
  // "all" — grouped Expected -> On-Site -> Checked Out, each internally
  // sorted by its own rule above, so the operational priority order still
  // reads top-to-bottom even in the unfiltered view.
  const buckets = { expected: [], on_site: [], checked_out: [] };
  for (const r of list) buckets[classifyVisit(r)].push(r);
  return [...sortExpected(buckets.expected), ...sortOnSite(buckets.on_site), ...sortCheckedOut(buckets.checked_out)];
}
