import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const completionSrc = read("CourseCompletionCard.jsx");

test("completed School course personalizes the certificate from real client/course enrollment data", () => {
  expect(completionSrc).toMatch(/useAuth/);
  expect(completionSrc).toMatch(/clientName:\s*user\?\.name/);
  expect(completionSrc).toMatch(/dogName:\s*dog/);
  expect(completionSrc).toMatch(/programName:\s*course/);
  expect(completionSrc).toMatch(/schoolEnrollmentId:\s*home\?\.school_enrollment_id/);
});
