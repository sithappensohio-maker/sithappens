import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import IntakeFormsSection from "./IntakeFormsSection";
import DogTrainingTab from "./DogTrainingTab";
import DogTimeline from "./DogTimeline";
import TrophyWall from "./TrophyWall";
import { BOOKING_STATUS, vaccineStatus } from "../lib/statusDefs";

const TABS = [
  { id: "overview", label: "Overview", icon: "fa-paw" },
  { id: "vaccines", label: "Vaccines", icon: "fa-shield" },
  { id: "bookings", label: "Bookings", icon: "fa-calendar-check" },
  { id: "care", label: "Care", icon: "fa-heart-pulse" },
  { id: "training", label: "Training", icon: "fa-graduation-cap" },
  { id: "incidents", label: "Incidents", icon: "fa-triangle-exclamation" },
  { id: "documents", label: "Documents", icon: "fa-folder-open" },
  { id: "history", label: "History", icon: "fa-clock-rotate-left" },
];

const VACCINE_LABELS = { rabies: "Rabies", bordetella: "Bordetella", dhpp: "DHPP" };

/* Dog Record Hub — a tabbed reorganization of the SAME data and workflows
 * already used across Dogs.jsx, Care Board, Kennel Board, Training, and
 * Incidents. No new booking/care/training/incident logic anywhere in this
 * file: every tab either reads an existing authoritative endpoint directly,
 * embeds an existing component (DogTrainingTab, DogTimeline, TrophyWall,
 * IntakeFormsSection) verbatim, or links out to the specialist screen that
 * already owns that workflow (Care Board, Kennel Board, Front Desk). Quick
 * actions call back into Dogs.jsx/App.js's own existing modal-opening
 * functions (onEditDog, onBook, onLogIncident) — the exact same ones the
 * dog card's action menu already uses. */
export default function DogHub({
  dog, onClose, can = () => false,
  initialTab = "overview", focusRecordId = null,
  onBook, onEditDog, onLogIncident, onOpenCareBoard, onOpenKennelBoard, onOpenFrontDesk, onMessageOwner,
}) {
  const [tab, setTab] = useState(TABS.some(t => t.id === initialTab) ? initialTab : "overview");

  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [incidents, setIncidents] = useState(null);
  const [trophies, setTrophies] = useState(null);
  const [full, setFull] = useState(null);

  useEffect(() => {
    api.get(`/dogs/${dog.id}/stats`).then(({ data }) => setStats(data)).catch(() => setStats({}));
    api.get(`/dogs/${dog.id}`).then(({ data }) => setFull(data)).catch(() => setFull(dog));
  }, [dog.id]);

  useEffect(() => {
    if (tab === "bookings" && bookings === null) {
      api.get("/bookings", { params: { dog_id: dog.id, include_all: true } })
        .then(({ data }) => setBookings(data || []))
        .catch(() => setBookings([]));
    }
    if (tab === "incidents" && incidents === null) {
      api.get("/incidents", { params: { dog_id: dog.id } }).then(({ data }) => setIncidents(data || [])).catch(() => setIncidents([]));
    }
    if (tab === "history" && trophies === null) {
      api.get(`/dogs/${dog.id}/trophies`).then(({ data }) => setTrophies(data || [])).catch(() => setTrophies([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dog.id]);

  const nextBooking = useMemo(() => {
    const list = bookings || [];
    const today = new Date().toISOString().slice(0, 10);
    return list.filter(b => b.date >= today && ["approved", "pending"].includes(b.status))
      .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  }, [bookings]);

  const vaccines = (full || dog).vaccines || {};

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose} data-testid="dog-hub">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-bgHover shrink-0">
          <div className="min-w-0">
            <h3 className="text-white font-black text-lg uppercase italic truncate">{dog.name}</h3>
            <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest truncate">{dog.breed || "Unknown breed"}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white shrink-0 ml-3" aria-label="Close"><i className="fas fa-times text-xl" /></button>
        </div>

        <div className="flex overflow-x-auto border-b border-bgHover shrink-0 px-2" data-testid="dog-hub-tabs">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} data-testid={`dog-hub-tab-${t.id}`}
                    className={`shrink-0 flex items-center gap-1.5 px-3 py-3 min-h-[44px] text-[12px] font-black uppercase tracking-widest border-b-2 transition ${tab === t.id ? "border-shGreen text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>
              <i className={`fas ${t.icon}`} />{t.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-5" data-testid="dog-hub-content">
          {tab === "overview" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onBook(dog.id, dog.owner_id)} data-testid="hub-action-book" className="min-h-[44px] px-3 py-2 rounded bg-shGreen text-black text-[12px] font-black uppercase tracking-widest">New Booking</button>
                <button onClick={onOpenFrontDesk} data-testid="hub-action-front-desk" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Check In / Front Desk</button>
                <button onClick={() => onEditDog(dog, "vaccines")} data-testid="hub-action-add-vaccine" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Add Vaccine Record</button>
                {can("incidents") && <button onClick={() => onLogIncident(dog.id)} data-testid="hub-action-log-incident" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Log Incident</button>}
                {can("messages") && <button onClick={() => onMessageOwner(dog)} data-testid="hub-action-message-owner" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Message Owner</button>}
                <button onClick={() => onEditDog(dog)} data-testid="hub-action-edit" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Edit Dog</button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Daycare Days</p>
                  <p className="text-xl font-black text-shGreen">{stats?.daycare_days ?? "…"}</p>
                </div>
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Boarding Nights</p>
                  <p className="text-xl font-black text-shAccent">{stats?.boarding_nights ?? "…"}</p>
                </div>
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Training Sessions</p>
                  <p className="text-xl font-black text-purple-400">{stats?.training_sessions ?? "…"}</p>
                </div>
                <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest">Incidents</p>
                  <p className={`text-xl font-black ${stats?.incidents > 0 ? "text-red-400" : "text-shGreen"}`}>{stats?.incidents ?? "…"}</p>
                </div>
              </div>

              <div className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest mb-1">Last Visit</p>
                <p className="text-white text-sm font-bold">{stats?.last_visit || (stats === null ? "Loading…" : "No visits yet")}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {Object.entries(VACCINE_LABELS).map(([key, label]) => {
                  const meta = vaccineStatus(vaccines[key]);
                  return (
                    <span key={key} className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-widest ${meta.cls}`}>
                      <i className={`fas ${meta.icon} mr-1`} />{label}: {meta.short}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {tab === "vaccines" && (
            <div className="space-y-2">
              {Object.entries(VACCINE_LABELS).map(([key, label]) => {
                const meta = vaccineStatus(vaccines[key]);
                return (
                  <div key={key} className="bg-bgBase/40 border border-bgHover rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <p className="text-white font-bold">{label}</p>
                      <p className="text-[12px] text-gray-500">{vaccines[key] ? `Expires ${vaccines[key]}` : "No record on file"}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${meta.cls}`}>{meta.label}</span>
                  </div>
                );
              })}
              <button onClick={() => onEditDog(dog, "vaccines")} data-testid="hub-edit-vaccines" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Edit Vaccine Records</button>
            </div>
          )}

          {tab === "bookings" && (
            <div className="space-y-2">
              {bookings === null && <p className="text-gray-500 text-sm">Loading…</p>}
              {bookings?.length === 0 && <p className="text-gray-500 italic text-sm">No bookings in the last/next 90 days.</p>}
              {nextBooking && (
                <div className="bg-bgBase/40 border border-shGreen/40 rounded-lg p-3 mb-2">
                  <p className="text-[11px] uppercase font-black text-shGreen tracking-widest">Next Booking</p>
                  <p className="text-white text-sm font-bold">{nextBooking.service_type} · {nextBooking.date}</p>
                </div>
              )}
              {(bookings || []).map((b) => {
                const meta = BOOKING_STATUS[b.status] || { label: b.status, cls: "text-gray-400 bg-gray-500/10" };
                return (
                  <div key={b.id} data-testid={`hub-booking-${b.id}`}
                       className={`bg-bgBase/40 border rounded-lg p-3 flex items-center justify-between ${focusRecordId === b.id ? "border-shGreen" : "border-bgHover"}`}>
                    <div>
                      <p className="text-white font-bold">{b.service_type}</p>
                      <p className="text-[12px] text-gray-500">{b.date}{b.end_date && b.end_date !== b.date ? ` – ${b.end_date}` : ""}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${meta.cls}`}>{meta.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "care" && (
            <div className="space-y-3">
              <p className="text-gray-400 text-sm">Live daily care tasks and kennel status are managed on the operational boards, not here — jump directly to this dog's entry.</p>
              <div className="flex flex-wrap gap-2">
                <button onClick={onOpenCareBoard} data-testid="hub-open-care-board" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Open Care Board</button>
                <button onClick={onOpenKennelBoard} data-testid="hub-open-kennel-board" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Open Kennel Board</button>
              </div>
            </div>
          )}

          {tab === "training" && <DogTrainingTab dogId={dog.id} dogName={dog.name} dogAgeMonths={(dog.age_y || 0) * 12 + (dog.age_m || 0)} />}

          {tab === "incidents" && (
            <div className="space-y-2">
              {incidents === null && <p className="text-gray-500 text-sm">Loading…</p>}
              {incidents?.length === 0 && <p className="text-gray-500 italic text-sm">No incidents on file.</p>}
              {(incidents || []).map((inc) => (
                <div key={inc.id} data-testid={`hub-incident-${inc.id}`} className="bg-bgBase/40 border border-bgHover rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-white font-bold capitalize">{inc.type.replace(/_/g, " ")}</p>
                    <span className="text-[12px] text-gray-500">{inc.date}</span>
                  </div>
                  <p className="text-[13px] text-gray-400 mt-1">{inc.description}</p>
                </div>
              ))}
              {can("incidents") && <button onClick={() => onLogIncident(dog.id)} data-testid="hub-log-incident-2" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Log New Incident</button>}
            </div>
          )}

          {tab === "documents" && (
            <div className="space-y-4">
              <IntakeFormsSection dogId={dog.id} />
              {can("messages") && (
                <div>
                  <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest mb-2">Owner Communication</p>
                  <button onClick={() => onMessageOwner(dog)} data-testid="hub-message-owner-2" className="min-h-[44px] px-3 py-2 rounded bg-bgBase border border-bgHover text-gray-200 text-[12px] font-black uppercase tracking-widest">Message Owner</button>
                </div>
              )}
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-4">
              <DogTimeline dogId={dog.id} dogName={dog.name} />
              <div>
                <p className="text-[11px] uppercase font-black text-gray-500 tracking-widest mb-2">Trophies</p>
                {trophies === null ? <p className="text-gray-500 text-sm">Loading…</p> : <TrophyWall awards={trophies} testIdPrefix="dog-hub-trophies" />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
