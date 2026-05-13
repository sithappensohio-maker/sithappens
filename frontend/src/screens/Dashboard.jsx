import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const load = async () => {
    try { const { data } = await api.get("/dashboard/stats"); setStats(data); } catch {}
  };
  useEffect(() => { load(); }, []);
  if (!stats) return <div className="text-gray-400 text-sm">Loading dashboard…</div>;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="admin-dashboard">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard label="Daycare Today" value={`${stats.daycare_occupancy} / ${stats.daycare_capacity}`} accent="border-t-shBlue" textColor="text-white" testId="stat-daycare" />
        <StatCard label="Boarding Today" value={stats.boarding_today} accent="border-t-shGreen" textColor="text-shGreen" testId="stat-boarding" />
        <StatCard label="Health Flags" value={stats.health_flags} accent="border-t-shOrange" textColor="text-shOrange" testId="stat-health" />
        <StatCard label="Total Dogs" value={stats.total_dogs} accent="border-t-bgHover" textColor="text-white" testId="stat-dogs" />
      </div>

      <div className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between">
          <h3 className="text-xs font-black text-white uppercase tracking-widest">Today's Roster</h3>
          <span className="text-[10px] font-black text-gray-500 uppercase">{stats.today_roster?.length || 0} bookings</span>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="text-[10px] text-gray-500 font-black uppercase">
            <tr><th className="px-6 py-3">Dog</th><th className="px-6 py-3">Owner</th><th className="px-6 py-3">Service</th><th className="px-6 py-3">Status</th></tr>
          </thead>
          <tbody data-testid="roster-body">
            {(stats.today_roster || []).map(b => (
              <tr key={b.id} className="border-t border-bgHover/40">
                <td className="px-6 py-4 text-white font-black uppercase text-xs">{b.dog_name}</td>
                <td className="px-6 py-4 text-gray-300 text-xs">{b.client_name}</td>
                <td className="px-6 py-4"><span className="text-[10px] font-black uppercase px-2 py-1 rounded" style={{ background: b.service_type==="daycare"?"rgba(140,198,63,0.15)":"rgba(0,169,224,0.15)", color: b.service_type==="daycare"?"#8cc63f":"#00a9e0" }}>{b.service_type}</span></td>
                <td className="px-6 py-4 text-[10px] font-black uppercase text-gray-400">{b.status}</td>
              </tr>
            ))}
            {(!stats.today_roster || stats.today_roster.length === 0) && (
              <tr><td colSpan={4} className="px-6 py-10 text-center text-xs text-gray-500 uppercase font-black">No dogs scheduled today.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, textColor, testId }) {
  return (
    <div className={`bg-bgPanel p-6 rounded-xl border-t-4 ${accent} shadow-lg`} data-testid={testId}>
      <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{label}</p>
      <p className={`text-3xl font-black mt-2 ${textColor}`}>{value}</p>
    </div>
  );
}
