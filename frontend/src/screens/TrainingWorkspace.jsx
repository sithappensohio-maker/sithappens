import { useEffect, useState } from "react";
import AdminPageHeader from "../components/admin/AdminPageHeader";
import AdminTabs from "../components/admin/AdminTabs";
import Pipeline from "./Pipeline";
import SchoolHQ from "./SchoolHQ";
import Homework from "./Homework";
import Rewards from "./Rewards";
import Trophies from "./Trophies";

/**
 * Phase 1 modernization: trainer operations, School administration, Practice,
 * and rewards now live behind one Training destination. Existing screens are
 * mounted unchanged so progression, review, reward, and session behavior is
 * preserved while the operator gets one obvious place to work.
 */
export default function TrainingWorkspace({
  initialSection = "today",
  onJumpToDog = () => {},
  can = () => false,
  featureOn = () => true,
  onSectionChange = () => {},
}) {
  const normalize = (value) => ({
    pipeline: "today",
    school_hq: "school",
    homework: "practice",
    rewards_center: "rewards",
    trophies: "trophies",
  }[value] || value || "today");

  const showSchool = can("manage_school");
  const showRewards = featureOn("rewards");
  const availableTabs = [
    { key: "today", label: "Today", icon: "fa-dog", accent: "lime" },
    ...(showSchool ? [{ key: "school", label: "School", icon: "fa-school", accent: "cyan" }] : []),
    // Homework/Practice has historically been reachable through internal
    // training deep links even though it is not a standalone NAV_ITEMS entry.
    { key: "practice", label: "Practice", icon: "fa-book-open", accent: "purple" },
    ...(showRewards ? [
      { key: "rewards", label: "Rewards", icon: "fa-gift", accent: "orange" },
      { key: "trophies", label: "Trophies", icon: "fa-trophy", accent: "orange" },
    ] : []),
  ];
  const allowedKeys = availableTabs.map((t) => t.key);
  const requested = normalize(initialSection);
  const [section, setSection] = useState(allowedKeys.includes(requested) ? requested : "today");

  useEffect(() => {
    const next = normalize(initialSection);
    setSection(allowedKeys.includes(next) ? next : "today");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection, showSchool, showRewards]);

  return (
    <div className="space-y-4" data-testid="training-workspace">
      <AdminPageHeader
        icon="fa-graduation-cap"
        title="Training"
        description="Daily trainer work, School students, Practice review, and training rewards in one workspace."
        testid="training-workspace-header"
      />
      <AdminTabs
        items={availableTabs}
        value={section}
        onChange={(next) => { setSection(next); onSectionChange(next); }}
        testid="training-workspace-tabs"
      />

      <div data-testid={`training-workspace-section-${section}`}>
        {section === "today" && <Pipeline onJumpToDog={onJumpToDog} />}
        {section === "school" && <SchoolHQ />}
        {section === "practice" && <Homework />}
        {section === "rewards" && <Rewards />}
        {section === "trophies" && <Trophies />}
      </div>
    </div>
  );
}
