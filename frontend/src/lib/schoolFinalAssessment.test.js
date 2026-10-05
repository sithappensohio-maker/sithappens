/**
 * The certificate names the trainer who graded the final assessment. HQ checkpoints carry the
 * grader as graded_by_name, so the name was never found and every certificate printed
 * "Sit Happens Trainer" (audit #71).
 */
import { finalAssessmentSummary } from "./schoolCertificate";

const FINAL = {
  rubric_snapshot: { assessment_type: "final_assessment" }, graded_by_name: "Sam Rivera",
  handler_overall: "strong", dog_overall: "steady", outcome: "advance",
};
const PRACTICE = { rubric_snapshot: { assessment_type: "checkpoint" }, graded_by_name: "Lee Park", outcome: "advance" };

test("the final assessment's grader is named on the certificate", () => {
  expect(finalAssessmentSummary([PRACTICE, FINAL])).toEqual({
    trainer_name: "Sam Rivera", handler_overall: "strong", dog_overall: "steady",
  });
});

test("a course with no final assessment names no trainer", () => {
  expect(finalAssessmentSummary([PRACTICE])).toBeNull();
  expect(finalAssessmentSummary([])).toBeNull();
  expect(finalAssessmentSummary(undefined)).toBeNull();
});
