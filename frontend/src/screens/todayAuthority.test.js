import fs from "fs";
import path from "path";

const todaySrc = fs.readFileSync(path.join(__dirname, "Today.jsx"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "App.js"), "utf8");
const opsSrc = fs.readFileSync(path.join(__dirname, "..", "components", "TodayOperations.jsx"), "utf8");

test("Today no longer embeds the legacy Dashboard wholesale", () => {
  expect(todaySrc).not.toMatch(/import Dashboard from/);
  expect(todaySrc).not.toMatch(/<Dashboard\b/);
  expect(todaySrc).not.toMatch(/More Dashboard Information/);
  expect(todaySrc).toMatch(/<TodayOperations/);
});

test("legacy dashboard navigation resolves to the authoritative Today screen", () => {
  expect(appSrc).not.toMatch(/import Dashboard from/);
  expect(appSrc).toMatch(/\["today", "dashboard"\]\.includes\(tab\)/);
  expect(appSrc).not.toMatch(/tab === "dashboard"[\s\S]{0,80}<Dashboard/);
});

test("Today directly owns the operational workflows that used to exist only on Dashboard", () => {
  expect(opsSrc).toMatch(/Check-In \/ Check-Out/);
  expect(opsSrc).toMatch(/<OwnerClock\/>/);
  expect(opsSrc).toMatch(/<EndOfDayPanel/);
  expect(opsSrc).toMatch(/\/admin\/vaccine-cert-uploads/);
  expect(opsSrc).toMatch(/\/admin\/quote-requests\?status=open/);
  expect(opsSrc).toMatch(/<HelpRequestsTile/);
  expect(opsSrc).toMatch(/<SalesTaxDueTile/);
  expect(opsSrc).toMatch(/<TaxCenterTile/);
});

test("duplicate dashboard training and rewards queues are not copied into TodayOperations", () => {
  expect(opsSrc).not.toMatch(/pending-homework-reviews/);
  expect(opsSrc).not.toMatch(/pending-checkpoint-reviews/);
  expect(opsSrc).not.toMatch(/top-dogs-leaderboard/);
  expect(opsSrc).not.toMatch(/programs\/active-summary/);
});
