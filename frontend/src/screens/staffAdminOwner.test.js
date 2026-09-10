// The admin login can be the owner on the Staff page: listed, rate + Owner
// editable, but never deactivated or password-reset from there.
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "Staff.jsx"), "utf8");

test("admin logins are marked and protected in the staff list", () => {
  expect(src).toMatch(/e\.role === "admin" && <span[^>]*data-testid=\{`staff-admin-\$\{e\.id\}`\}/);
  expect(src).toMatch(/\{e\.role !== "admin" && <button onClick=\{\(\)=>setModal\(\{ mode: "reset-pw", emp: e \}\)\}/);
  expect(src).toMatch(/\{e\.role !== "admin" && e\.active && <button onClick=\{\(\)=>deactivate\(e\)\}/);
});

test("the edit form keeps an admin login's email and access out of reach, but rate and Owner stay editable", () => {
  expect(src).toMatch(/emp\?\.role === "admin"\s*\? <p[^>]*data-testid="emp-admin-note"/);
  expect(src).toMatch(/\{mode === "edit" && emp\?\.role !== "admin" && \(/);
  // rate + owner controls are unconditional
  expect(src).toMatch(/testid="emp-rate"/);
  expect(src).toMatch(/data-testid="emp-is-owner"/);
});

test("the owner clock on Today / Dashboard is not gated on anything", () => {
  const clock = fs.readFileSync(path.join(__dirname, "..", "components", "OwnerClockAndEndOfDay.jsx"), "utf8");
  expect(clock).toMatch(/api\.post\("\/time-clock\/clock-in"/);
  expect(clock).toMatch(/api\.post\("\/time-clock\/clock-out"/);
  expect(clock).not.toMatch(/disabled=\{!state\.open\}/);
});
