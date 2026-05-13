import { useState } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import Schedule from "./screens/Schedule";
import Clients from "./screens/Clients";
import Dogs from "./screens/Dogs";
import Bookings from "./screens/Bookings";
import Portal from "./screens/Portal";
import Settings from "./screens/Settings";
import Incidents from "./screens/Incidents";
import RunSheet from "./screens/RunSheet";
import Homework from "./screens/Homework";

function AdminShell() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "fa-chart-line" },
    { id: "schedule", label: "Schedule", icon: "fa-calendar-alt" },
    { id: "runsheet", label: "Run Sheet", icon: "fa-clipboard-list" },
    { id: "bookings", label: "Bookings", icon: "fa-calendar-check" },
    { id: "clients", label: "Clients", icon: "fa-users" },
    { id: "dogs", label: "Dogs", icon: "fa-paw" },
    { id: "homework", label: "Homework", icon: "fa-graduation-cap" },
    { id: "incidents", label: "Incidents", icon: "fa-triangle-exclamation" },
    { id: "settings", label: "Settings", icon: "fa-cog" },
  ];

  const handleNav = (id) => { setTab(id); setDrawerOpen(false); };

  const sidebarContent = (prefix) => (
    <>
      <div className="p-4 border-b border-bgHover text-center">
        <img src="/logo.png" alt="Sit Happens" className="h-20 mx-auto" data-testid={`${prefix}sidebar-logo`} />
        <p className="text-[9px] text-gray-500 font-black uppercase tracking-[0.25em] mt-2">Daycare • Boarding</p>
      </div>
      <nav className="flex-grow p-4 space-y-1 overflow-y-auto">
        {navItems.map(n => (
          <button key={n.id} onClick={() => handleNav(n.id)} data-testid={`${prefix}nav-${n.id}`}
                  className={`w-full text-left py-3 px-4 rounded-lg text-[11px] font-black uppercase tracking-widest transition ${tab===n.id?"bg-bgPanel border-l-4 border-shBlue text-shBlue":"hover:bg-bgHover text-gray-400"}`}>
            <i className={`fas ${n.icon} mr-3 w-4`} /> {n.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-bgHover">
        <div className="bg-bgPanel rounded-lg p-3">
          <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest">Signed in</p>
          <p className="text-xs text-white font-black truncate">{user.name}</p>
          <button onClick={logout} data-testid={`${prefix}admin-logout`} className="mt-2 w-full text-[10px] font-black uppercase tracking-widest text-red-400 hover:text-red-300">Logout</button>
        </div>
      </div>
    </>
  );

  return (
    <div className="h-screen w-screen flex bg-bgBase overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="bg-bgHeader w-64 border-r border-bgHover flex-col hidden md:flex">
        {sidebarContent("")}
      </aside>

      {/* Mobile drawer */}
      <div className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${drawerOpen?"opacity-100 pointer-events-auto":"opacity-0 pointer-events-none"}`}
           onClick={()=>setDrawerOpen(false)} data-testid="drawer-backdrop">
        <div className="absolute inset-0 bg-black/70" />
      </div>
      <aside className={`md:hidden fixed top-0 left-0 bottom-0 z-50 w-64 bg-bgHeader border-r border-bgHover flex flex-col transition-transform duration-200 ${drawerOpen?"translate-x-0":"-translate-x-full"}`}
             data-testid="mobile-drawer">
        {sidebarContent("mobile-")}
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-bgHeader border-b border-bgHover h-16 flex items-center justify-between px-4 md:px-8 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={()=>setDrawerOpen(true)} data-testid="drawer-toggle"
                    className="md:hidden text-gray-300 hover:text-white p-2 -ml-2 text-lg">
              <i className="fas fa-bars" />
            </button>
            <img src="/logo.png" alt="Sit Happens" className="h-10 md:hidden" />
            <h2 className="text-xs font-black uppercase text-white tracking-widest truncate" data-testid="header-title">{tab}</h2>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          {tab === "dashboard" && <Dashboard />}
          {tab === "schedule" && <Schedule />}
          {tab === "runsheet" && <RunSheet />}
          {tab === "bookings" && <Bookings />}
          {tab === "clients" && <Clients />}
          {tab === "dogs" && <Dogs />}
          {tab === "homework" && <Homework />}
          {tab === "incidents" && <Incidents />}
          {tab === "settings" && <Settings />}
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
