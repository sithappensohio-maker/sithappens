// Training UI Phase 3 — the client-facing "Today" experience: prominent,
// always visible (not buried behind "More"), one glance to see what's
// active and what to do next. Practice consumes the SAME `homework`/`dogs`/
// `bookings` already loaded by Portal.jsx. Board & Train daily updates are
// the one additive fetch because they are their own durable trainer-delivery
// record, not a homework assignment.
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { assignmentCardModel, sortAssignments, groupByDog, weeklyPracticeStats } from "../../lib/clientPracticePolish";
import DogIdentityHeader from "./DogIdentityHeader";
import PracticeAssignmentCard from "./PracticeAssignmentCard";
import WeeklyPracticeSummary from "./WeeklyPracticeSummary";
import EmptyState from "./EmptyState";

function nextAppointmentLabel(bookings) {
  const today = new Date().toISOString().slice(0, 10);
  const next = (bookings || [])
    .filter(b => ["approved", "pending"].includes(b.status) && (b.date || "") >= today)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))[0];
  if (!next) return null;
  const d = new Date(`${next.date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? next.date : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtUpdateDate(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function BoardTrainUpdateCard({ update, compact = false }) {
  return (
    <article className="relative overflow-hidden rounded-2xl border border-shSecondary/35 bg-gradient-to-br from-shSecondary/[0.10] via-[var(--sh-card-base)] to-shPrimary/[0.08] p-4 sm:p-5 shadow-lg"
             data-testid={`board-train-update-${update.id}`}>
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-shPrimary to-shSecondary"/>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-shSecondary">
            <i className="fas fa-house-chimney-user mr-1.5"/>Board &amp; Train Daily Update
          </p>
          <h3 className="text-lg sm:text-xl font-black text-shText mt-1">
            {update.dog_name} · Day {update.day_number} of {update.total_days}
          </h3>
          <p className="text-[11px] text-shTextMuted mt-1">
            {fmtUpdateDate(update.session_date)} · {update.program_name}
            {update.trainer_name ? ` · ${update.trainer_name}` : ""}
          </p>
        </div>
        {update.email_status && (
          <span className="rounded-full border border-shPrimary/30 bg-shPrimary/[0.08] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-shPrimary">
            <i className="fas fa-envelope-circle-check mr-1"/>{update.email_status === "sent" ? "Emailed" : update.email_status === "queued" ? "Email queued" : "Saved in Hub"}
          </span>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-shSecondary/20 bg-black/15 p-3.5">
        <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary">Today&apos;s update</p>
        <p className="text-[13px] sm:text-[14px] text-shText leading-relaxed whitespace-pre-wrap mt-1.5">{update.client_update}</p>
      </div>

      {!compact && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3">
          <div className="rounded-xl border border-shPrimary/25 bg-shPrimary/[0.05] p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-trophy mr-1"/>Biggest win</p>
            <p className="text-[12px] text-shText mt-1 whitespace-pre-wrap">{update.biggest_win || "—"}</p>
          </div>
          <div className="rounded-xl border border-shAccent/25 bg-shAccent/[0.05] p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-shAccent"><i className="fas fa-bullseye mr-1"/>Working on</p>
            <p className="text-[12px] text-shText mt-1 whitespace-pre-wrap">{update.biggest_challenge || "—"}</p>
          </div>
          <div className="rounded-xl border border-shSecondary/25 bg-shSecondary/[0.05] p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-forward mr-1"/>Tomorrow</p>
            <p className="text-[12px] text-shText mt-1 whitespace-pre-wrap">{update.tomorrow_focus || "—"}</p>
          </div>
        </div>
      )}
    </article>
  );
}

export default function ClientTodayPanel({ dogs = [], homework = [], bookings = [], onOpenPractice, testid }) {
  const [progressByDog, setProgressByDog] = useState({});
  const [boardTrainUpdates, setBoardTrainUpdates] = useState([]);
  const [showUpdateHistory, setShowUpdateHistory] = useState(false);

  useEffect(() => {
    api.get("/portal/progress").then(({ data }) => {
      const map = {};
      for (const d of data || []) map[d.dog_id] = d;
      setProgressByDog(map);
    }).catch(() => setProgressByDog({}));
    api.get("/portal/board-train/updates", { params: { limit: 30 } })
      .then(({ data }) => setBoardTrainUpdates(data || []))
      .catch(() => setBoardTrainUpdates([]));
  }, []);

  const trainingHomework = homework.filter(hw => dogs.some(d => d.id === hw.dog_id));
  const groups = groupByDog(sortAssignments(trainingHomework), dogs);
  const stats = weeklyPracticeStats(trainingHomework);
  const nextAppt = nextAppointmentLabel(bookings);

  // One newest card per enrolled dog stays prominent. Older entries remain
  // available as a real history instead of disappearing after the next day.
  const latestUpdates = useMemo(() => {
    const seen = new Set();
    return boardTrainUpdates.filter(u => {
      const key = u.enrollment_id || u.dog_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [boardTrainUpdates]);
  const olderUpdates = useMemo(() => boardTrainUpdates.filter(u => !latestUpdates.some(x => x.id === u.id)), [boardTrainUpdates, latestUpdates]);

  if (trainingHomework.length === 0 && boardTrainUpdates.length === 0) return null;

  return (
    <div id="portal-homework-anchor" data-testid={testid || "client-today-panel"} className="space-y-6">
      {boardTrainUpdates.length > 0 && (
        <section data-testid="client-board-train-updates">
          <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shSecondary mb-1">
                <i className="fas fa-dog mr-1.5"/>While they&apos;re with us
              </p>
              <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Board &amp; Train Updates.</h2>
              <p className="text-[12px] text-shTextMuted mt-1">Your trainer closes each training day once. The same update is saved here and sent to your email automatically.</p>
            </div>
            {olderUpdates.length > 0 && (
              <button type="button" onClick={() => setShowUpdateHistory(v => !v)}
                      data-testid="board-train-update-history-toggle"
                      className="min-h-[40px] px-3 rounded-xl border border-shSecondary/35 bg-shSecondary/[0.06] text-[10px] font-black uppercase tracking-widest text-shSecondary hover:bg-shSecondary/[0.12]">
                <i className={`fas ${showUpdateHistory ? "fa-chevron-up" : "fa-clock-rotate-left"} mr-1.5`}/>
                {showUpdateHistory ? "Hide history" : `Previous updates · ${olderUpdates.length}`}
              </button>
            )}
          </div>
          <div className="space-y-3">
            {latestUpdates.map(update => <BoardTrainUpdateCard key={update.id} update={update}/>) }
            {showUpdateHistory && olderUpdates.map(update => <BoardTrainUpdateCard key={update.id} update={update} compact/>) }
          </div>
        </section>
      )}

      {trainingHomework.length > 0 && (
        <section>
          <div className="mb-3">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shPrimary mb-1">
              <i className="fas fa-list-check mr-1.5"/>Today
            </p>
            <h2 className="text-2xl font-black text-white uppercase italic tracking-tight">Today&apos;s Plan.</h2>
          </div>

          <div className="mb-4">
            <WeeklyPracticeSummary
              todayCompleted={stats.todayCompleted} todayTotal={stats.todayTotal}
              weekCompleted={stats.weekCompleted} streak={stats.streak}
              nextAppointment={nextAppt} feedbackWaiting={stats.feedbackWaiting}
              testid="today-weekly-summary"
            />
          </div>

          <div className="space-y-5">
            {groups.map(({ dog, items }) => {
              const prog = progressByDog[dog.id];
              const breadcrumb = prog ? [prog.program_name, prog.current_module_name].filter(Boolean).join(" · ") : "";
              return (
                <div key={dog.id} data-testid={`today-dog-group-${dog.id}`}>
                  {groups.length > 1 && (
                    <div className="mb-2">
                      <DogIdentityHeader dogName={dog.name} dogPhoto={dog.photo} breadcrumb={breadcrumb} testid={`today-dog-header-${dog.id}`}/>
                    </div>
                  )}
                  <div className="space-y-2.5">
                    {items.map(hw => {
                      const model = assignmentCardModel(hw);
                      return (
                        <PracticeAssignmentCard
                          key={hw.id}
                          icon={hw.daily_tracker ? "fa-calendar-check" : "fa-dumbbell"}
                          title={hw.title}
                          goal={hw.instructions ? hw.instructions.split("\n")[0] : ""}
                          sessionsRequired={model.sessionsRequired}
                          status={model.status}
                          attentionLabel={model.attentionLabel}
                          primaryActionLabel={model.primaryAction}
                          onPrimaryAction={() => onOpenPractice(hw)}
                          dogName={groups.length > 1 ? null : dog.name}
                          dogPhoto={dog.photo}
                          testid={`today-card-${hw.id}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {trainingHomework.every(hw => assignmentCardModel(hw).status === "completed") && (
            <EmptyState icon="fa-champagne-glasses" message="All practice completed for now — nice work!" testid="today-all-done"/>
          )}
        </section>
      )}
    </div>
  );
}
