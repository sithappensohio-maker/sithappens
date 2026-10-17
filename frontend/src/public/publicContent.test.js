/**
 * Owner, 2026-10-17: a public-site "What we do" headline kept naming
 * "School" after Online School was turned off in Settings — the category
 * cards below it already correctly dropped the School card (both read
 * feature_visibility), but the headline was a separate hardcoded string
 * nothing re-derived it from. This proves the extracted headline builder
 * actually changes with the same flags the cards use, not just that the
 * word "School" appears somewhere in source.
 */
import { whatWeDoHeadline } from "./publicContent";

test("both services visible reads exactly like the original hand-written copy", () => {
  expect(whatWeDoHeadline(true, true))
    .toBe("Training, daycare, boarding, School and portraits. One team that knows your dog.");
});

test("Online School turned off drops it from the sentence, not just the cards", () => {
  const headline = whatWeDoHeadline(false, true);
  expect(headline).not.toContain("School");
  expect(headline).toBe("Training, daycare, boarding and portraits. One team that knows your dog.");
});

test("photography turned off drops it the same way", () => {
  const headline = whatWeDoHeadline(true, false);
  expect(headline).not.toContain("portraits");
  expect(headline).toBe("Training, daycare, boarding and School. One team that knows your dog.");
});

test("both turned off still reads as a complete, grammatical sentence", () => {
  expect(whatWeDoHeadline(false, false))
    .toBe("Training, daycare and boarding. One team that knows your dog.");
});
