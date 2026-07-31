import { categorizeService, groupServicesByCategory, summarizeDescription, CATEGORY_META } from "./serviceCategories";

const daycare = { id: "s-daycare", name: "Daycare", slug: "daycare", service_type: "daycare", base_price: 40 };
const boarding = { id: "s-boarding", name: "Boarding (per night)", slug: "boarding_night", service_type: "boarding", base_price: 50 };
const grooming = { id: "s-groom", name: "Nail Trim", slug: "nail_trim", service_type: "grooming", base_price: 20 };
const photography = { id: "s-photo", name: "Portrait Session", slug: "portrait", service_type: "photography", base_price: 150 };
const privateLesson = { id: "s-private", name: "1-on-1 Private Lesson", slug: "private_lesson", service_type: "training", capacity_per_slot: 1, base_price: 75 };
const groupClass = { id: "s-group", name: "Puppy Group Class", slug: "puppy_group_class", service_type: "training", capacity_per_slot: 8, base_price: 30 };
const evaluation = { id: "s-eval", name: "Service Dog Evaluation", slug: "service_dog_eval", service_type: "training", capacity_per_slot: 1, base_price: 60 };
const boardTrain = { id: "s-bnt", name: "Board & Train (per week)", slug: "board_train_week", service_type: "training", base_price: 900 };
const boardTrainViaProgram = { id: "s-bnt2", name: "2-Week Intensive", slug: "intensive_2wk", service_type: "boarding", package_program_id: "prog-1", base_price: 1200 };
const uncategorized = { id: "s-other", name: "Mystery Add-on Fee", slug: "mystery_fee", service_type: "other", base_price: 5 };

test("daycare/boarding/grooming/photography map directly from service_type", () => {
  expect(categorizeService(daycare)).toBe("daycare");
  expect(categorizeService(boarding)).toBe("boarding");
  expect(categorizeService(grooming)).toBe("grooming");
  expect(categorizeService(photography)).toBe("photography");
});

test("private lesson (capacity 1, no special keywords) buckets as Private Training", () => {
  expect(categorizeService(privateLesson)).toBe("private_training");
});

test("high-capacity or 'group'/'class' named training buckets as Group Classes", () => {
  expect(categorizeService(groupClass)).toBe("group_classes");
  // capacity alone should also trigger it even without the word "group"
  expect(categorizeService({ ...privateLesson, id: "s-capacity-only", name: "Advanced Session", slug: "advanced", capacity_per_slot: 6 })).toBe("group_classes");
});

test("'eval' in name/slug buckets training as Evaluations", () => {
  expect(categorizeService(evaluation)).toBe("evaluations");
});

test("board & train buckets correctly whether service_type is training or boarding-with-program", () => {
  expect(categorizeService(boardTrain)).toBe("board_train");
  expect(categorizeService(boardTrainViaProgram)).toBe("board_train");
});

test("a service with an unrecognized service_type falls back to Other Services", () => {
  expect(categorizeService(uncategorized)).toBe("other");
  expect(categorizeService({})).toBe("other");
});

test("groupServicesByCategory only returns non-empty, feature-enabled categories in a stable order", () => {
  const groups = groupServicesByCategory(
    [boardTrain, daycare, groupClass, privateLesson, evaluation, grooming],
    { featureByType: { training: true, daycare: true, grooming: true } },
  );
  const keys = groups.map((g) => g.key);
  // daycare, then the training sub-categories in CATEGORY_ORDER, then grooming
  expect(keys).toEqual(["daycare", "group_classes", "private_training", "evaluations", "board_train", "grooming"]);
  // categories never present in the input never appear
  expect(keys).not.toContain("boarding");
  expect(keys).not.toContain("photography");
  expect(keys).not.toContain("other");
});

test("selecting a category means only that category's services are present in its bucket", () => {
  const groups = groupServicesByCategory([daycare, boarding, groupClass, privateLesson]);
  const training = groups.find((g) => g.key === "private_training");
  expect(training.items.map((i) => i.id)).toEqual(["s-private"]);
  const daycareGroup = groups.find((g) => g.key === "daycare");
  expect(daycareGroup.items.map((i) => i.id)).toEqual(["s-daycare"]);
});

test("a category whose top-level feature is disabled is entirely omitted", () => {
  const groups = groupServicesByCategory([daycare, privateLesson], { featureByType: { training: false } });
  expect(groups.map((g) => g.key)).toEqual(["daycare"]);
});

test("uncategorized active services land in Other Services and nowhere else", () => {
  const groups = groupServicesByCategory([daycare, uncategorized]);
  const other = groups.find((g) => g.key === "other");
  expect(other).toBeTruthy();
  expect(other.items.map((i) => i.id)).toEqual(["s-other"]);
  expect(other.meta.label).toBe(CATEGORY_META.other.label);
});

test("hidden/inactive services never reach the grouping (caller is responsible for pre-filtering)", () => {
  // The wizard only ever passes already-filtered (active, feature-on,
  // per-service booking-enabled) rows into groupServicesByCategory — an
  // inactive/hidden row simply isn't in the input array at all.
  const activeOnly = [daycare]; // an inactive service was excluded upstream
  const groups = groupServicesByCategory(activeOnly);
  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
  expect(allIds).toEqual(["s-daycare"]);
});

test("fallback tiles (zero real catalog rows) still bucket into a real category", () => {
  const groups = groupServicesByCategory([], {
    fallbackTiles: [{ key: "training", label: "Training", icon: "fa-graduation-cap", desc: "1-on-1 session" }],
  });
  expect(groups).toHaveLength(1);
  expect(groups[0].key).toBe("private_training");
  expect(groups[0].items[0].key).toBe("training");
});

describe("summarizeDescription", () => {
  test("empty description summarizes to empty string", () => {
    expect(summarizeDescription("")).toBe("");
    expect(summarizeDescription(null)).toBe("");
  });

  test("short description passes through unchanged", () => {
    expect(summarizeDescription("Drop-in day care.")).toBe("Drop-in day care.");
  });

  test("long training-style description is truncated to a single short line", () => {
    const long = "This is a comprehensive board-and-train program designed for dogs needing intensive, structured behavioral rehabilitation over a full two-week residential stay with daily one-on-one sessions.";
    const summary = summarizeDescription(long);
    expect(summary.length).toBeLessThan(long.length);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("cuts at the first sentence when it's short enough", () => {
    const text = "Bath and blow-dry. Includes ear cleaning and nail trim on request.";
    expect(summarizeDescription(text)).toBe("Bath and blow-dry.");
  });
});
