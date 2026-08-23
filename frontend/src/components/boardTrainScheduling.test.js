// Board & Train is priced/enrolled as training, but it occupies the facility
// for the full linked Program Studio duration. Quick Check-In must therefore
// render/send a real multi-day span instead of a one-hour training slot.
import fs from "fs";
import path from "path";
import {
  addDaysISO,
  boardTrainProgramDurationDays,
  legacyBoardTrainDurationDays,
  resolveBoardTrainSchedule,
} from "./AdminBookingModal";

const src = fs.readFileSync(path.join(__dirname, "AdminBookingModal.jsx"), "utf8");
const backend = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "backend", "board_train_scheduling.py"), "utf8");

test("1/2/3 week Board & Train pickup dates are full program spans", () => {
  expect(addDaysISO("2026-08-23", 7)).toBe("2026-08-30");
  expect(addDaysISO("2026-08-23", 14)).toBe("2026-09-06");
  expect(addDaysISO("2026-08-23", 21)).toBe("2026-09-13");
  for (const weeks of [1, 2, 3]) {
    expect(boardTrainProgramDurationDays({
      type: "board_train", format: { count: weeks, unit: "weeks" },
    })).toBe(weeks * 7);
  }
});

test("linked Program Studio Board & Train is recognized while service_type stays training", () => {
  const program = { id: "p1", type: "board_train", format: { count: 1, unit: "weeks" } };
  const svc = { id: "s1", service_type: "training", package_program_id: "p1" };
  expect(resolveBoardTrainSchedule(svc, [program])).toMatchObject({
    isBoardTrain: true, durationDays: 7, program,
  });
  expect(svc.service_type).toBe("training");
});

test("legacy explicit Board & Train service still gets safe duration fallback", () => {
  expect(legacyBoardTrainDurationDays({ name: "Board & Train (per week)" })).toBe(7);
  expect(legacyBoardTrainDurationDays({ name: "2-Week Board & Train" })).toBe(14);
  expect(legacyBoardTrainDurationDays({ name: "Private Training 2 weeks" })).toBe(0);
});

test("Quick Check-In hides appointment/multi-date behavior and shows program pickup", () => {
  expect(src).toMatch(/api\.get\("\/programs"\)/);
  expect(src).toMatch(/const isDateSpanService = serviceType === "boarding" \|\| isBoardTrainStay/);
  expect(src).toMatch(/!isEdit && !isDateSpanService/);
  expect(src).toMatch(/includes\(serviceType\) && !isBoardTrainStay \?/);
  expect(src).toMatch(/Program Pickup Date/);
  expect(src).toMatch(/readOnly=\{isBoardTrainStay\}/);
  expect(src).toMatch(/end_date: isDateSpanService \? \(endDate \|\| date\) : null/);
});

test("backend canonical hook removes appointment requirement only for verified Board & Train", () => {
  expect(backend).toMatch(/object\.__setattr__\(body, "_board_train_residential", True\)/);
  expect(backend).toMatch(/booking_start_with_residential_training/);
  expect(backend).toMatch(/model_copy\(update=\{"service_type": "boarding", "time": ""\}\)/);
  expect(backend).toMatch(/server_module\._booking_start_local = booking_start_with_residential_training/);
});
