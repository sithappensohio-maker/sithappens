// Client-portal Book Service wizard — Step 1 category-first redesign.
//
// Pure, framework-free bucketing logic so it can be unit-tested without
// rendering anything. Deliberately derives categories from data ALREADY on
// each service row (service_type, slug, name, capacity_per_slot,
// package_program_id) — no per-service hardcoded IDs, no new backend fields.
//
// "training" is the one service_type that needs sub-dividing (Group Classes /
// Private Training / Evaluations / Board & Train) since the catalog has no
// dedicated sub-type field for it. The heuristics below are ordered so the
// more specific signal wins; anything training-flavored that matches nothing
// else falls through to Private Training, the most common case.

export const CATEGORY_ORDER = [
  "daycare",
  "boarding",
  "group_classes",
  "private_training",
  "evaluations",
  "board_train",
  "grooming",
  "photography",
  "other",
];

export const CATEGORY_META = {
  daycare:          { label: "Daycare",     icon: "fa-paw",              color: "bg-shGreen/15 text-shGreen border-shGreen/40" },
  boarding:         { label: "Boarding",    icon: "fa-bed",              color: "bg-purple-500/15 text-purple-300 border-purple-500/40" },
  group_classes:    { label: "Group Classes", icon: "fa-people-group",   color: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  private_training: { label: "Private Training", icon: "fa-graduation-cap", color: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  evaluations:      { label: "Evaluations", icon: "fa-clipboard-check",  color: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  board_train:      { label: "Board & Train / Specialty Training", icon: "fa-house-chimney", color: "bg-purple-500/15 text-purple-300 border-purple-500/40" },
  grooming:         { label: "Grooming & Add-ons", icon: "fa-bath",      color: "bg-pink-500/15 text-pink-300 border-pink-500/40" },
  photography:      { label: "Photography", icon: "fa-camera",           color: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  other:            { label: "Other Services", icon: "fa-tag",           color: "bg-gray-500/15 text-gray-300 border-gray-500/40" },
};

// Which app-wide feature-visibility flag (useFeature() key) gates each
// category. The training sub-categories all ride on the single "training"
// toggle since there's no per-sub-category flag. "other" has none — an
// uncategorized active service is never hidden by a feature switch.
export const CATEGORY_FEATURE = {
  daycare: "daycare",
  boarding: "boarding",
  group_classes: "training",
  private_training: "training",
  evaluations: "training",
  board_train: "training",
  grooming: "grooming",
  photography: "photography",
  other: null,
};

function norm(v) {
  return (v || "").toString().toLowerCase();
}

/** Bucket a single service (or a synthetic fallback tile) into a category key. */
export function categorizeService(service) {
  const s = service || {};
  const type = s.service_type || "other";
  const haystack = `${norm(s.slug)} ${norm(s.name)}`;

  // Board & Train can attach its auto-enroll program to a training OR a
  // boarding-type row (see ServiceIn.package_program_id) — check this before
  // the plain type checks so it doesn't get swallowed by "boarding".
  if (!!s.package_program_id || /board.{0,3}(&|and)?.{0,3}train|specialty/.test(haystack)) {
    return "board_train";
  }
  if (type === "daycare") return "daycare";
  if (type === "boarding") return "boarding";
  if (type === "grooming") return "grooming";
  if (type === "photography") return "photography";
  if (type === "training") {
    if (/\beval/.test(haystack)) return "evaluations";
    if (/\bgroup\b|\bclass/.test(haystack) || Number(s.capacity_per_slot) > 1) return "group_classes";
    return "private_training";
  }
  return "other";
}

/** First sentence or first `max` chars of a description — for the collapsed
 * card view. Full text stays available via the "View details" toggle. */
export function summarizeDescription(desc, max = 90) {
  const text = (desc || "").trim();
  if (!text) return "";
  // A clean sentence boundary wins even if the full text would otherwise
  // fit under `max` — the goal is one tidy sentence, not "as much as fits."
  const sentenceEnd = text.indexOf(". ");
  if (sentenceEnd > 0 && sentenceEnd < max) {
    return text.slice(0, sentenceEnd + 1).trim();
  }
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}…`;
}

/**
 * Groups an already-filtered (active, feature-enabled, client-visible) list
 * of catalog services into ordered, non-empty category buckets.
 *
 * `fallbackTiles` — optional synthetic entries (shape: { key, label, icon,
 * desc }) used ONLY when the business has zero real catalog rows at all, so
 * a freshly-enabled category still shows one coarse tile instead of
 * disappearing. Matches the pre-redesign "coarse fallback" behavior.
 */
export function groupServicesByCategory(services, { featureByType = {}, fallbackTiles = [] } = {}) {
  const byCategory = {};
  for (const s of services || []) {
    const cat = categorizeService(s);
    (byCategory[cat] = byCategory[cat] || []).push(s);
  }
  for (const tile of fallbackTiles) {
    const cat = categorizeService({ service_type: tile.key });
    if (!byCategory[cat]) byCategory[cat] = [tile];
  }
  return CATEGORY_ORDER
    .filter((key) => (byCategory[key] || []).length > 0)
    .filter((key) => {
      const feat = CATEGORY_FEATURE[key];
      return feat == null || featureByType[feat] !== false;
    })
    .map((key) => ({ key, meta: CATEGORY_META[key], items: byCategory[key] }));
}
