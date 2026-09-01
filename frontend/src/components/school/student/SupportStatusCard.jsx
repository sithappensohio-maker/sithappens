function fmtSchedule(ta) {
  if (!ta?.scheduled_date) return null;
  return [ta.scheduled_date, ta.scheduled_time].filter(Boolean).join(" · ");
}

export default function SupportStatusCard({ home, onAskTrainer, onStartPractice }) {
  const action = home?.current_action || {};
  const cp = home?.checkpoint_status || {};
  if (!['remediation', 'trainer_assist'].includes(action.type)) return null;

  if (action.type === 'remediation') {
    const p = cp.prescription || {};
    const remaining = p.practice_sessions_remaining;
    return (
      <section className="rounded-2xl border border-shAccent/30 bg-shAccent/[0.055] p-4 sm:p-5" data-testid="school-remediation-card">
        <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shAccent"><i className="fas fa-rotate-left mr-1.5" />Your trainer's plan</p>
        <h3 className="text-[20px] font-black text-shText mt-1">More practice before you move on</h3>
        {cp.trainer_feedback && <p className="text-[16px] text-gray-200 mt-2 leading-relaxed border-l-2 border-shAccent/35 pl-3">“{cp.trainer_feedback}”</p>}
        <div className="mt-3 space-y-1.5 text-[16px] text-shTextMuted">
          <p><span className="font-black text-shText">Plan:</span> {p.action === "assign_refresher_lesson" && p.refresher_lesson_name ? `Review ${p.refresher_lesson_name} and practice it` : p.action === "assign_recipe" ? "Complete the new practice your trainer assigned" : "Repeat this lesson's practice"}</p>
          {remaining != null && <p><span className="font-black text-shText">Practice sessions remaining:</span> {remaining}</p>}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          {onStartPractice && <button onClick={onStartPractice} className="min-h-[44px] px-4 rounded-xl bg-shAccent text-bgHeader text-[14px] font-black uppercase tracking-widest" data-testid="school-remediation-start"><i className="fas fa-paw mr-1.5" />Start prescribed practice</button>}
          <button onClick={onAskTrainer} className="min-h-[44px] px-1 text-[15px] font-black uppercase tracking-widest text-shSecondary hover:text-shText"><i className="fas fa-comment-dots mr-1.5" />Ask about this plan</button>
        </div>
      </section>
    );
  }

  const ta = cp.trainer_assist || {};
  const status = ta.status || 'needs_attention';
  const scheduled = fmtSchedule(ta);
  const content = {
    scheduled: ['Trainer Assist scheduled', scheduled || 'Your trainer has scheduled time to work with you directly.'],
    reschedule_needed: ['Trainer Assist needs a new time', 'The previous appointment was canceled. Your trainer will help get a replacement scheduled.'],
    contacted: ['Your trainer is working with you', 'Your trainer has reached out about the next step.'],
    completed: ['Trainer Assist complete', ta.client_summary || 'The hands-on session is complete. Follow the next training action shown above.'],
    needs_attention: ['Let’s get a trainer involved', 'Your trainer recommends direct help with this skill before you continue.'],
  }[status] || ['Trainer Assist', 'Your trainer is helping with the next step.'];
  return (
    <section className="rounded-2xl border border-purple-400/30 bg-purple-500/[0.055] p-4 sm:p-5" data-testid="school-trainer-assist-card">
      <p className="text-[13px] font-black uppercase tracking-[0.2em] text-purple-300"><i className="fas fa-hand-holding-heart mr-1.5" />Trainer Assist</p>
      <h3 className="text-[20px] font-black text-shText mt-1">{content[0]}</h3>
      <p className="text-[16px] text-shTextMuted mt-2 leading-relaxed">{content[1]}</p>
      {cp.trainer_feedback && <p className="text-[16px] text-gray-200 mt-3 leading-relaxed border-l-2 border-purple-400/35 pl-3">“{cp.trainer_feedback}”</p>}
      <button onClick={onAskTrainer} className="mt-4 text-[15px] font-black uppercase tracking-widest text-shSecondary hover:text-shText"><i className="fas fa-comment-dots mr-1.5" />Ask your trainer</button>
    </section>
  );
}
