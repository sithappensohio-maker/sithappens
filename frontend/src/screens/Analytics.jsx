import { useState } from "react";
import PageHero from "../components/PageHero";
import AdminTabs from "../components/admin/AdminTabs";
import OverviewTab from "./analytics/OverviewTab";
import VisitsTab from "./analytics/VisitsTab";
import ClientsTab from "./analytics/ClientsTab";
import ServicesTab from "./analytics/ServicesTab";
import RetailTab from "./analytics/RetailTab";
import StaffTab from "./analytics/StaffTab";

export default function Analytics() {
  const [tab, setTab] = useState("overview");

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={{ icon: "fa-chart-pie", text: "What's going on", color: "text-shPrimary" }}
        title="Analytics."
        highlight="The whole picture."
        subtitle="Visits, occupancy, clients, and what's selling — all in one place."
        testid="analytics-hero"
      />

      <AdminTabs
        compact
        testid="analytics-tabs"
        value={tab}
        onChange={setTab}
        items={[
          { key: "overview", label: "Overview", icon: "fa-gauge-high", testid: "analytics-tab-overview" },
          { key: "visits", label: "Visits", icon: "fa-calendar-check", testid: "analytics-tab-visits", accent: "orange" },
          { key: "clients", label: "Clients", icon: "fa-users", testid: "analytics-tab-clients", accent: "orange" },
          { key: "services", label: "Services", icon: "fa-paw", testid: "analytics-tab-services", accent: "orange" },
          { key: "retail", label: "Retail", icon: "fa-bag-shopping", testid: "analytics-tab-retail", accent: "orange" },
          { key: "staff", label: "Staff", icon: "fa-users-gear", testid: "analytics-tab-staff", accent: "orange" },
        ]}
      />

      {tab === "overview" && <OverviewTab />}
      {tab === "visits" && <VisitsTab />}
      {tab === "clients" && <ClientsTab />}
      {tab === "services" && <ServicesTab />}
      {tab === "retail" && <RetailTab />}
      {tab === "staff" && <StaffTab />}
    </div>
  );
}
