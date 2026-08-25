import {
  resolveSchoolCertificateTemplate,
  schoolCertificateCourseName,
  schoolCertificateDefaults,
  schoolCertificateNumber,
} from "./schoolCertificate";

describe("Sit Happens School completion certificate templates", () => {
  test("certificate editor field wrapper is available before Program Studio renders", () => {
    expect(globalThis.Field).toEqual(expect.any(Function));
    const field = globalThis.Field({ label: "Graduate banner", children: "preview" });
    expect(field.type).toBe("div");
    expect(field.props.children[0].props.children).toBe("Graduate banner");
    expect(field.props.children[1].props.children).toBe("preview");
  });

  test("each flagship course and the free mini course resolve to their own baseline template", () => {
    expect(resolveSchoolCertificateTemplate("FREE Mini Course: Sit & Down").key).toBe("free-sit-down");
    expect(resolveSchoolCertificateTemplate("Level 1: Basic Manners — Online School").key).toBe("level-1");
    expect(resolveSchoolCertificateTemplate("Level 2: Intermediate Skills — Online School").key).toBe("level-2");
    expect(resolveSchoolCertificateTemplate("Level 3: Advanced Off-Leash — Online School").key).toBe("level-3");
  });

  test("the free mini course gets its own certificate identity", () => {
    const t = resolveSchoolCertificateTemplate("FREE Mini Course: Sit & Down");
    expect(t.level).toBe("MINI COURSE");
    expect(t.sealMark).toBe("FREE");
    expect(t.eyebrow).toBe("MINI COURSE GRADUATE");
    expect(schoolCertificateNumber({
      schoolEnrollmentId: "free-enrollment-12345678",
      programName: "FREE Mini Course: Sit & Down",
      completionSummary: { completed_at: "2026-08-25T12:00:00Z" },
    })).toBe("SH-FREE-2026-12345678");
  });

  test("Program Studio certificate overrides are applied without changing the course identity", () => {
    const t = resolveSchoolCertificateTemplate("Level 1: Basic Manners", {
      eyebrow: "CUSTOM GRADUATE",
      completion_note: "Custom completion copy.",
      accent: "#123456",
      accent2: "#abcdef",
    });
    expect(t.key).toBe("level-1");
    expect(t.eyebrow).toBe("CUSTOM GRADUATE");
    expect(t.completionNote).toBe("Custom completion copy.");
    expect(t.accent).toBe("#123456");
    expect(t.accent2).toBe("#abcdef");
  });

  test("invalid custom colors fall back to the branded defaults", () => {
    const base = schoolCertificateDefaults("Level 2: Intermediate Skills");
    const t = resolveSchoolCertificateTemplate("Level 2: Intermediate Skills", { accent: "blue", accent2: "#12" });
    expect(t.accent).toBe(base.accent);
    expect(t.accent2).toBe(base.accent2);
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

  test("Level 3 carries the course-completion safety clarification and cannot lose it to an empty edit", () => {
    const t = resolveSchoolCertificateTemplate("Level 3: Advanced Off-Leash", { safety_note: "" });
    expect(t.safetyNote).toMatch(/not a legal off-leash authorization/i);
    expect(t.safetyNote).toMatch(/not a .*guarantee/i);
  });

  test("certificate can be disabled at the program level", () => {
    expect(resolveSchoolCertificateTemplate("Level 1: Basic Manners", { enabled: false }).enabled).toBe(false);
  });
});
