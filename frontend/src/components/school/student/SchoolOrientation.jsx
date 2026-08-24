import { useState } from "react";

const ORIENTATION_KEY = "sh_school_orientation_v3";

function alreadySeen() {
  try { return window.localStorage.getItem(ORIENTATION_KEY) === "1"; }
  catch { return false; }
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
      return "Follow the Quick Check directions exactly as shown. Submit what the app asks for, then you are done until the result comes back.";
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
      return "Follow the next action School gives you. When you finish it, School will tell you exactly what to do next.";
  }
}

export function CurrentActionGuide({ home }) {
  const action = home?.current_action || {};
  const noAction = ["awaiting_review", "access_expired", "setup_required", "course_paused"].includes(action.type);
  const title = home?.current_lesson?.name || action.label || "Your next step";
  return (
    <section className="rounded-2xl border border-shPrimary/30 bg-shPrimary/[0.06] p-4 sm:p-5" data-testid="school-current-action-guide">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shPrimary">{noAction ? "Where you are" : "Do this now"}</p>
      <h2 className="text-[18px] sm:text-[20px] font-black text-shText mt-1 leading-tight text-balance">{title}</h2>
      <p className="text-[14px] sm:text-[15px] text-shText mt-2 leading-relaxed">{actionCoachCopy(action, home?.dog?.name)}</p>
      {!noAction && (
        <p className="text-[11.5px] text-shTextMuted mt-2.5">Use the big action directly below. Finish this one thing; School will choose the next step for you.</p>
      )}
    </section>
  );
}

export default function SchoolOrientation({ dogName }) {
  const [open, setOpen] = useState(() => !alreadySeen());
  const close = () => {
    try { window.localStorage.setItem(ORIENTATION_KEY, "1"); } catch { /* storage can be disabled */ }
    setOpen(false);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="school-how-it-works"
              className="min-h-[44px] px-3 rounded-xl border border-shSecondary/30 text-shSecondary text-[10.5px] sm:text-[11px] font-black uppercase tracking-widest hover:text-shText hover:border-shSecondary/50">
        <i className="fas fa-circle-question mr-1.5" />How School works
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm p-3 sm:p-6 grid place-items-center"
             role="dialog" aria-modal="true" aria-labelledby="school-orientation-title" data-testid="school-orientation">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl border border-shSecondary/35 bg-[var(--sh-card-base)] shadow-2xl p-5 sm:p-7">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-shPrimary">Before you start</p>
            <h2 id="school-orientation-title" className="text-[25px] sm:text-[32px] font-black text-shText mt-1 leading-tight text-balance">
              You do not need to know how to use School. We will guide you.
            </h2>
            <p className="text-[15px] sm:text-[16px] text-shTextMuted mt-2 leading-relaxed">
              {dogName ? `School tells you what to do with ${dogName}, one step at a time.` : "School tells you what to do with your dog, one step at a time."} You should never have to guess which lesson to open or what comes next.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 mt-5">
              <OrientationStep n="1" icon="fa-arrow-pointer" title="Use the big next button">
                Open <strong>Today</strong>. The large green action is the one thing you should do now.
              </OrientationStep>
              <OrientationStep n="2" icon="fa-list-ol" title="Do one step at a time">
                Read the current step, actually do what it says, then tap the button at the bottom. Your place is saved.
              </OrientationStep>
              <OrientationStep n="3" icon="fa-paw" title="Practice when School tells you">
                When it is time to train with your dog, Practice will open and tell you what to work on. You do not need to invent a session.
              </OrientationStep>
              <OrientationStep n="4" icon="fa-book-open" title="Go back whenever you want">
                Completed lessons stay in your Course library. Review them or practice again without erasing the completion you already earned.
              </OrientationStep>
            </div>

            <div className="mt-5 rounded-2xl border border-shPrimary/25 bg-shPrimary/[0.06] p-4">
              <p className="text-[14px] sm:text-[15px] text-shText leading-relaxed">
                <strong>If you get lost:</strong> go back to <strong>Today</strong>. School will pick up from the correct place and tell you what to do next.
              </p>
            </div>

            <button type="button" onClick={close} data-testid="school-orientation-start" autoFocus
                    className="mt-5 w-full min-h-[56px] rounded-xl bg-shPrimary text-bgHeader text-[14px] sm:text-[15px] font-black uppercase tracking-widest hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary focus-visible:ring-offset-2 focus-visible:ring-offset-bgBase">
              Show me what to do <i className="fas fa-arrow-right ml-1.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function OrientationStep({ n, icon, title, children }) {
  return (
    <div className="rounded-2xl border border-shBorder/55 bg-black/10 p-4">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-full grid place-items-center shrink-0 border border-shSecondary/35 bg-shSecondary/10 text-shSecondary text-[12px] font-black">{n}</span>
        <i className={`fas ${icon} text-shPrimary text-[13px]`} aria-hidden="true" />
        <h3 className="text-[16px] font-black text-shText leading-tight">{title}</h3>
      </div>
      <p className="text-[14px] text-shTextMuted mt-2 leading-relaxed">{children}</p>
    </div>
  );
}
