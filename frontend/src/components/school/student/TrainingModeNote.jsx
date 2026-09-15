import { trainingMode } from "../../../lib/studentSchool";

/* One-line "what kind of program is this?" explanation, placed next to the
 * program identity (portal hero, School Today, Course, Welcome). Reads the
 * server-decided delivery mode only — see trainingMode() for the mapping.
 * Deliberately a single sentence with a bold title so it never becomes a
 * second card competing with the real next action. */
export default function TrainingModeNote({ mode, testid = "training-mode-note", className = "" }) {
  const tm = trainingMode(mode);
  return (
    <p className={`text-[15px] text-shTextMuted leading-relaxed ${className}`} data-testid={testid} data-training-mode={tm.key}>
      <i className={`fas ${tm.icon} mr-1.5 text-shSecondary`} aria-hidden="true" />
      <span className="font-black text-shText">{tm.title}.</span> {tm.body}
    </p>
  );
}
