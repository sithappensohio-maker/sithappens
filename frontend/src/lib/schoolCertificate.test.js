import {
  resolveSchoolCertificateTemplate,
  schoolCertificateCourseName,
  schoolCertificateNumber,
} from "./schoolCertificate";

describe("Sit Happens School completion certificate templates", () => {
  test("each flagship course resolves to its own baseline template", () => {
    expect(resolveSchoolCertificateTemplate("Level 1: Basic Manners — Online School").key).toBe("level-1");
    expect(resolveSchoolCertificateTemplate("Level 2: Intermediate Skills — Online School").key).toBe("level-2");
    expect(resolveSchoolCertificateTemplate("Level 3: Advanced Off-Leash — Online School").key).toBe("level-3");
  });

  test("the printed course name removes only the Online School presentation suffix", () => {
    expect(schoolCertificateCourseName("Level 1: Basic Manners — Online School")).toBe("Level 1: Basic Manners");
    expect(schoolCertificateCourseName("Custom Course")).toBe("Custom Course");
  });

  test("certificate number is deterministic for a completed enrollment", () => {
    const input = {
      schoolEnrollmentId: "school-enrollment-1234-ABCD5678",
      programName: "Level 2: Intermediate Skills — Online School",
      completionSummary: { completed_at: "2026-08-25T12:00:00Z" },
    };
    const a = schoolCertificateNumber(input);
    const b = schoolCertificateNumber(input);
    expect(a).toBe(b);
    expect(a).toBe("SH-L2-2026-ABCD5678");
  });

  test("Level 3 carries the course-completion safety clarification", () => {
    const t = resolveSchoolCertificateTemplate("Level 3: Advanced Off-Leash");
    expect(t.safetyNote).toMatch(/not a legal off-leash authorization/i);
    expect(t.safetyNote).toMatch(/not a .*guarantee/i);
  });
});
