// Training UI Phase 3 — the client-facing "Today" experience: prominent,
// always visible (not buried behind "More"), one glance to see what's
// active and what to do next. Consumes the SAME `homework`/`dogs`/
// `bookings` already loaded by Portal.jsx's loadAll() — no duplicate
// fetch of homework, so an assignment can never be represented twice.
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { assignmentCardModel, sortAssignments, groupByDog, weeklyPracticeStats } from "../../lib/clientPracticePolish";
import DogIdentityHeader from "./DogIdentityHeader";
import PracticeAssignmentCard from "./PracticeAssignmentCard";
import WeeklyPracticeSummary from "./WeeklyPracticeSummary";
import EmptyState from "./EmptyState";

function nextAppointmentLabel(bookings) {
  const today = new Date().toISOString().slice(0, 10);
  const next = bookings
    .filter(b => ["approved", "pending"].includes(b.status) && (b.date || "") >= today)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))[0];
  if (!next) return null;
  const d = new Date(`${next.date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? next.date : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ClientTodayPanel({ dogs, homework, bookings, onOpenPractice, testid }) {
  const [progressByDog, setProgressByDog] = useState({});

  useEffect(() => {
    api.get("/portal/progress").then(({ data }) => {
      const map = {};
      for (const d of data || []) map[d.dog_id] = d;
      setProgressByDog(map);
    }).catch(() => setProgressByDog({}));
  }, []);

  const trainingHomework = homework.filter(hw => dogs.some(d => d.id === hw.dog_id));
  if (trainingHomework.length === 0) return null;

  const groups = groupByDog(sortAssignments(trainingHomework), dogs);
  const stats = weeklyPracticeStats(trainingHomework);
  const nextAppt = nextAppointmentLabel(bookings);

  return (
    <div id="portal-homework-anchor" data-testid={testid || "client-today-panel"}>
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
    </div>
  );
}
