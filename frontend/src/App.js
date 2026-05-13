import { useState } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import Schedule from "./screens/Schedule";
import Clients from "./screens/Clients";
import Dogs from "./screens/Dogs";
import Bookings from "./screens/Bookings";
import Portal from "./screens/Portal";

function AdminShell() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("dashboard");

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "fa-chart-line", color: "shBlue" },
    { id: "schedule", label: "Schedule", icon: "fa-calendar-alt", color: "shBlue" },
    { id: "bookings", label: "Bookings", icon: "fa-clipboard-list", color: "shOrange" },
    { id: "clients", label: "Clients", icon: "fa-users", color: "shBlue" },
    { id: "dogs", label: "Dogs", icon: "fa-paw", color: "shGreen" },
  ];

  return (
    <div className="h-screen w-screen flex bg-bgBase">
      <aside className="bg-bgHeader w-64 border-r border-bgHover flex-col hidden md:flex">
        <div className="p-4 border-b border-bgHover text-center">
          <img src="/logo.png" alt="Sit Happens" className="h-20 mx-auto" data-testid="sidebar-logo" />
          <p className="text-[9px] text-gray-500 font-black uppercase tracking-[0.25em] mt-2">Daycare • Boarding</p>
        </div>
        <nav className="flex-grow p-4 space-y-1">
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} data-testid={`nav-${n.id}`}
                    className={`w-full text-left py-3 px-4 rounded-lg text-[11px] font-black uppercase tracking-widest transition ${tab===n.id?"bg-bgPanel border-l-4 border-shBlue text-shBlue":"hover:bg-bgHover text-gray-400"}`}>
              <i className={`fas ${n.icon} mr-3 w-4`} /> {n.label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-bgHover">
          <div className="bg-bgPanel rounded-lg p-3">
            <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest">Signed in</p>
            <p className="text-xs text-white font-black truncate">{user.name}</p>
            <button onClick={logout} data-testid="admin-logout" className="mt-2 w-full text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-300">Logout</button>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-bgHeader border-b border-bgHover h-16 flex items-center justify-between px-8">
          <h2 className="text-xs font-black uppercase text-white tracking-widest" data-testid="header-title">{tab}</h2>
        </header>
        <div className="flex-1 overflow-y-auto p-8">
          {tab === "dashboard" && <Dashboard />}
          {tab === "schedule" && <Schedule />}
          {tab === "bookings" && <Bookings />}
          {tab === "clients" && <Clients />}
          {tab === "dogs" && <Dogs />}
        </div>
      </main>
    </div>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === null) return <div className="h-screen w-screen flex items-center justify-center bg-bgBase text-gray-400 text-sm font-black uppercase tracking-widest">Loading…</div>;
  if (!user) return <Login />;
  if (user.role === "admin") return <AdminShell />;
  return <Portal />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
