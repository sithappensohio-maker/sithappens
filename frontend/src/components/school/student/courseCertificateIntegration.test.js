import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const completionSrc = read("CourseCompletionCard.jsx");
const adminSrc = read("..", "SchoolStudentsPanel.jsx");
const studioSrc = read("..", "..", "ProgramStudio.jsx");

test("completed School course personalizes the certificate from real client/course enrollment data", () => {
  expect(completionSrc).toMatch(/useAuth/);
  expect(completionSrc).toMatch(/clientName:\s*user\?\.name/);
  expect(completionSrc).toMatch(/dogName:\s*dog/);
  expect(completionSrc).toMatch(/programName:\s*course/);
  expect(completionSrc).toMatch(/schoolEnrollmentId:\s*home\?\.school_enrollment_id/);
  expect(completionSrc).toMatch(/certificateConfig/);
});

test("School HQ can print the same completed-course certificate", () => {
  expect(adminSrc).toMatch(/data-testid="school-admin-course-certificate"/);
  expect(adminSrc).toMatch(/printSchoolCertificate/);
  expect(adminSrc).toMatch(/clientName:data\?\.client\?\.name/);
  expect(adminSrc).toMatch(/dogName:data\?\.dog\?\.name/);
  expect(adminSrc).toMatch(/schoolEnrollmentId:studentId/);
});

test("Program Studio exposes an editable certificate tab with a live preview", () => {
  expect(studioSrc).toMatch(/key: "certificate", label: "Certificate"/);
  expect(studioSrc).toMatch(/data-testid="program-certificate-tab"/);
  expect(studioSrc).toMatch(/school_support\?\.certificate/);
  expect(studioSrc).toMatch(/Live preview/);
  expect(studioSrc).toMatch(/Reset course defaults/);
});
