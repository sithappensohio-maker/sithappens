import { useEffect, useState } from "react";
import AdminPageHeader from "../components/admin/AdminPageHeader";
import AdminTabs from "../components/admin/AdminTabs";
import Schedule from "./Schedule";
import Bookings from "./Bookings";
import Waitlist from "./Waitlist";
import RecurringTemplates from "./RecurringTemplates";

/**
 * Phase 1 modernization: one scheduling workspace instead of four competing
 * sidebar destinations. The existing screens stay intact and keep owning
 * their business logic; this component only gives them one predictable home.
 *
 * `initialSection` intentionally accepts the legacy App tab ids so old
 * sh:nav callers and stale in-memory destinations keep landing on the same
 * work after the sidebar is consolidated.
 */
export default function ScheduleWorkspace({
  initialSection = "calendar",
  can = () => false,
  featureOn = () => true,
  onSectionChange = () => {},
}) {
  const normalize = (value) => value === "schedule" ? "calendar" : value;
  const showWaitlist = can("booking_edit") && featureOn("waitlist");
  const availableTabs = [
    { key: "calendar", label: "Calendar", icon: "fa-calendar-days", accent: "cyan" },
    { key: "bookings", label: "Bookings", icon: "fa-calendar-check", accent: "lime" },
    ...(showWaitlist ? [{ key: "waitlist", label: "Waitlist", icon: "fa-hourglass-half", accent: "orange" }] : []),
    { key: "recurring", label: "Recurring", icon: "fa-rotate", accent: "purple" },
  ];
  const allowedKeys = availableTabs.map((t) => t.key);
  const requested = normalize(initialSection);
  const [section, setSection] = useState(allowedKeys.includes(requested) ? requested : "calendar");

  useEffect(() => {
    const next = normalize(initialSection);
    setSection(allowedKeys.includes(next) ? next : "calendar");
    // showWaitlist is the only dynamic permission/feature input that changes
    // the tab set; the remaining tabs are always available in this workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection, showWaitlist]);

  return (
    <div className="space-y-4" data-testid="schedule-workspace">
      <AdminPageHeader
        icon="fa-calendar-days"
        title="Schedule & Bookings"
        description="Calendar, booking management, waitlist, and recurring reservations in one workspace."
        testid="schedule-workspace-header"
      />
      <AdminTabs
        items={availableTabs}
        value={section}
        onChange={(next) => { setSection(next); onSectionChange(next); }}
        testid="schedule-workspace-tabs"
      />

      <div data-testid={`schedule-workspace-section-${section}`}>
        {section === "calendar" && <Schedule />}
        {section === "bookings" && <Bookings />}
        {section === "waitlist" && <Waitlist />}
        {section === "recurring" && <RecurringTemplates />}
      </div>
    </div>
  );
}
