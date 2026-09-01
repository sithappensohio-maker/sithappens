/* Online School storefront — display shaping over GET /public/school/storefront.
 *
 * The build rule for this whole surface is NO fabricated content: every
 * number and quote comes from the endpoint, and anything below its honesty
 * threshold renders as nothing rather than as a small-but-real-looking
 * claim. These helpers are the one place those thresholds live.
 */

/* A rating average is only shown once this many people have rated —
 * "5.0 from 1 review" reads as fake even when it's real. */
export const RATING_MIN_COUNT = 3;

/* The dogs-trained stat is hidden until it clears this floor, then rounded
 * DOWN to a "N+" claim so the storefront never overstates. */
export const DOGS_TRAINED_MIN = 10;

export function dogsTrainedLabel(count) {
  const n = Number(count || 0);
  if (n < DOGS_TRAINED_MIN) return null;
  return `${Math.floor(n / 10) * 10}+`;
}

/** Overall rating chip data, or null when below the honesty threshold. */
export function ratingSummary(stats) {
  const count = Number(stats?.rating_count || 0);
  const average = Number(stats?.average_rating || 0);
  if (count < RATING_MIN_COUNT || !average) return null;
  return { average, count };
}

/** One program's card rating, or null (below threshold / never rated). */
export function programRating(programRatings, programId) {
  const r = (programRatings || {})[programId];
  if (!r || Number(r.count || 0) < RATING_MIN_COUNT || !r.average) return null;
  return { average: Number(r.average), count: Number(r.count) };
}

/** Card chips derived from real program fields — empty fields yield no chip. */
export function courseCardChips(item) {
  const chips = [];
  if (item?.module_count > 0 && item?.lesson_count > 0) {
    chips.push(`${item.module_count} module${item.module_count === 1 ? "" : "s"} · ${item.lesson_count} lesson${item.lesson_count === 1 ? "" : "s"}`);
  }
  if (item?.estimated_weeks) chips.push(`~${item.estimated_weeks} week${item.estimated_weeks === 1 ? "" : "s"}`);
  if (item?.min_age_months > 0) chips.push(`${item.min_age_months}+ months`);
  return chips;
}
