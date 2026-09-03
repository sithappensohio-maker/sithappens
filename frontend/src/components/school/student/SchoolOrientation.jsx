import { useEffect, useRef, useState } from "react";
import { focusDialogTitle } from "../../../lib/schoolViewport";
import { useImmersiveWorkflow } from "../../../lib/immersiveWorkflow";

/* "How School works" — the four-step GPS explanation of the client journey.
 *
 * ONE first-time orientation: the Program Welcome page (ProgramWelcome.jsx)
 * shows these same four steps the first time a client has a Today plan, and
 * then hands them straight to their current action. This overlay never opens
 * on its own any more; it is the on-demand version behind the "How School
 * works" button, for anyone who wants the reminder later. */

const ORIENTATION_KEY = "sh_school_orientation_v3";

export const ORIENTATION_STEPS = [
  { n: "1", icon: "fa-arrow-pointer", title: "Use the big next button", body: "Open Today. The large green action is the one thing you should do now." },
  { n: "2", icon: "fa-list-ol", title: "Do one step at a time", body: "Read the current step, actually do what it says, then tap the button at the bottom. Your place is saved." },
  { n: "3", icon: "fa-paw", title: "Practice when School tells you", body: "When it is time to train with your dog, Practice will open and tell you what to work on. You do not need to invent a session." },
  { n: "4", icon: "fa-book-open", title: "Go back whenever you want", body: "Completed lessons stay in your Course library. Review them or practice again without erasing the completion you already earned." },
];

function markSeen() {
  try { window.localStorage.setItem(ORIENTATION_KEY, "1"); } catch { /* storage can be disabled */ }
}

export function actionCoachCopy(action, dogName) {
  const dog = dogName || "your dog";
  switch (action?.type) {
    case "start":
      return "Start here. School will open the first lesson and tell you exactly what to do first.";
    case "lesson":
      return "Open the lesson and do one step at a time. Read the current step, follow it, then use the big button at the bottom. You do not need to plan what comes next.";
    case "practice":
      return `Get ${dog} and the supplies from the lesson. Then start Practice and follow the directions on screen. You do not need to invent a training session.`;
    case "remediation":
      return `Do the extra practice your trainer prescribed for ${dog}. This is the next job; you do not need to restart the course.`;
    case "submit_checkpoint":
      return "Follow the trainer check directions exactly as shown. Film the short clip the app asks for and send it, then you are done until the result comes back.";
    case "module_quiz":
      return "Answer the short review before moving on. It checks that the important pieces make sense; it is not a trick test.";
    case "advance":
      return "You finished the work for this lesson. Use the Continue button and School will move you to the correct next lesson automatically.";
    case "awaiting_review":
      return "You are done for now. Your trainer has something to review, so there is nothing else you need to complete until that comes back.";
    case "trainer_assist":
      return "Open your trainer feedback first. It tells you what needs to change before you continue.";
    case "trainer_guided":
      return "This part is trainer-guided. Review the course material if you want, but follow your trainer's direction for the next live step.";
    case "course_complete":
      return "The guided path is complete. Your course stays in School so you can review lessons and practice skills again whenever you need them.";
    case "onboarding":
      return "Finish the short School setup first. Once that is done, School will give you the first training step.";
    case "course_paused":
      return "Your course is paused. You can review work you already reached, but there is no new training step to complete right now.";
    case "access_expired":
      return "There is no training action to complete right now. Contact Sit Happens if you believe this course should still be available.";
    default:
      return "Use the big button below. School will take you to the correct next step and tell you what to do when you get there.";
  }
}

/* One short, plain sentence for the line directly above Today's button. The
   server's sublabel wins when it says something; these are the fallbacks. */
export function doThisNowCopy(action, dogName, lessonName) {
  const dog = dogName || "your dog";
  const sub = String(action?.sublabel || "").trim();
  if (sub && sub !== String(lessonName || "").trim()) return sub;
  switch (action?.type) {
    case "start": return "Start your first lesson.";
    case "lesson": return "Read this lesson one part at a time.";
    case "practice": return `Get ${dog} and do today's practice.`;
    case "remediation": return `Do the extra practice your trainer set for ${dog}.`;
    case "submit_checkpoint": return "Film a short clip so your trainer can check it.";
    case "module_quiz": return "Answer a few quick questions before moving on.";
    case "advance": return "You finished this lesson. Continue to the next one.";
    case "awaiting_review": return "Your trainer is reviewing your work.";
    case "course_complete": return "You finished the course.";
    case "onboarding": return "Answer a few setup questions first.";
    default: return sub;
  }
}

export function CurrentActionGuide({ home }) {
  const action = home?.current_action || {};
  const noAction = ["awaiting_review", "access_expired", "setup_required", "course_paused"].includes(action.type);
  const title = home?.current_lesson?.name || action.label || "Your next step";
  return (
    <section className="rounded-2xl border border-shPrimary/30 bg-shPrimary/[0.06] p-4 sm:p-5" data-testid="school-current-action-guide">
      <p className="text-[13px] font-black uppercase tracking-[0.18em] text-shPrimary">{noAction ? "Where you are" : "Do this now"}</p>
      <h2 className="text-[21px] sm:text-[23px] font-black text-shText mt-1 leading-tight text-balance">{title}</h2>
      <p className="text-[17px] sm:text-[18px] text-shText mt-2 leading-relaxed">{actionCoachCopy(action, home?.dog?.name)}</p>
      {!noAction && (
        <p className="text-[14px] text-shTextMuted mt-2.5">Use the big action directly below. Finish this one thing; School will choose the next step for you.</p>
      )}
    </section>
  );
}

export function OrientationSteps({ dogName, inPerson = false, testid }) {
  const steps = ORIENTATION_STEPS.map((s) => (
    inPerson && s.n === "3"
      ? { ...s, title: "Train with your trainer", body: "Your trainer advances your lessons during your in-person sessions and keeps your plan on track." }
      : s.n === "3" && dogName ? { ...s, body: s.body.replace("your dog", dogName) } : s
  ));
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid={testid}>
      {steps.map((s) => (
        <div key={s.n} className="rounded-2xl border border-shBorder/55 bg-black/10 p-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full grid place-items-center shrink-0 border border-shSecondary/35 bg-shSecondary/10 text-shSecondary text-[15px] font-black">{s.n}</span>
            <i className={`fas ${s.icon} text-shPrimary text-[16px]`} aria-hidden="true" />
            <h3 className="text-[19px] font-black text-shText leading-tight">{s.title}</h3>
          </div>
          <p className="text-[17px] text-shTextMuted mt-2 leading-relaxed">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export default function SchoolOrientation({ dogName }) {
  // On demand only. The first-time orientation is the Program Welcome page.
  const [open, setOpen] = useState(false);
  const titleRef = useRef(null);
  useImmersiveWorkflow(open);
  useEffect(() => { if (open) focusDialogTitle(titleRef.current); }, [open]);
  const close = () => { markSeen(); setOpen(false); };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="school-how-it-works"
              className="min-h-[40px] px-2 rounded-lg text-shSecondary text-[13px] font-black uppercase tracking-widest hover:text-shText focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary">
        <i className="fas fa-circle-question mr-1.5" />How School works
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm p-3 sm:p-6 grid place-items-center"
             role="dialog" aria-modal="true" aria-labelledby="school-orientation-title" data-testid="school-orientation">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-shSecondary/35 bg-[var(--sh-card-base)] shadow-2xl p-5 sm:p-7">
            <p className="text-[13px] font-black uppercase tracking-[0.22em] text-shPrimary">How School works</p>
            <h2 id="school-orientation-title" ref={titleRef} tabIndex={-1} className="text-[25px] sm:text-[32px] font-black text-shText mt-1 leading-tight text-balance focus:outline-none">
              You do not need to know how to use School. We will guide you.
            </h2>
            <p className="text-[18px] sm:text-[19px] text-shTextMuted mt-2 leading-relaxed">
              {dogName ? `School tells you what to do with ${dogName}, one step at a time.` : "School tells you what to do with your dog, one step at a time."} You should never have to guess which lesson to open or what comes next.
            </p>

            <div className="mt-5"><OrientationSteps dogName={dogName} /></div>

            <div className="mt-5 rounded-2xl border border-shPrimary/25 bg-shPrimary/[0.06] p-4">
              <p className="text-[17px] sm:text-[18px] text-shText leading-relaxed">
                <strong>If you get lost:</strong> go back to <strong>Today</strong>. School will pick up from the correct place and tell you what to do next.
              </p>
            </div>

            <button type="button" onClick={close} data-testid="school-orientation-start"
                    className="mt-5 w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[17px] sm:text-[18px] font-black uppercase tracking-widest hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
              Got it <i className="fas fa-arrow-right ml-1.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
