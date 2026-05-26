import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import Schedule from "./screens/Schedule";
import Clients from "./screens/Clients";
import Dogs from "./screens/Dogs";
import Bookings from "./screens/Bookings";
import Portal from "./screens/Portal";
import EmployeePortal from "./screens/EmployeePortal";
import Settings from "./screens/Settings";
import Incidents from "./screens/Incidents";
import RunSheet from "./screens/RunSheet";
import Homework from "./screens/Homework";
import Pipeline from "./screens/Pipeline";
import Income from "./screens/Income";
import Trophies from "./screens/Trophies";
import Staff from "./screens/Staff";
import RecurringTemplates from "./screens/RecurringTemplates";
import Tutorials from "./screens/Tutorials";
import Claim from "./screens/Claim";
import GlobalSearch from "./components/GlobalSearch";
import ErrorBoundary from "./components/ErrorBoundary";
import InstallPrompt from "./components/InstallPrompt";
import InstallAppButton from "./components/InstallAppButton";
import { ConfirmProvider } from "./lib/useConfirm";
import ImpersonationBanner from "./components/ImpersonationBanner";
import TextSizePicker from "./components/TextSizePicker";
import BrandFooter from "./components/BrandFooter";

function AdminShell() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState(null);

  // Cmd/Ctrl+K to open global search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigateTo = (item) => {
    setSearchOpen(false);
    if (item.kind === "dog") { setSearchTarget({ kind: "dog", id: item.id }); setTab("dogs"); }
    else if (item.kind === "client") { setSearchTarget({ kind: "client", id: item.id }); setTab("clients"); }
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "fa-chart-line" },
    { id: "schedule", label: "Schedule", icon: "fa-calendar-alt" },
    { id: "runsheet", label: "Run Sheet", icon: "fa-clipboard-list" },
    { id: "bookings", label: "Bookings", icon: "fa-calendar-check" },
    { id: "recurring", label: "Recurring", icon: "fa-rotate" },
    { id: "clients", label: "Clients", icon: "fa-users" },
    { id: "dogs", label: "Dogs", icon: "fa-paw" },
    { id: "pipeline", label: "Pipeline", icon: "fa-line-chart" },
    { id: "homework", label: "Homework", icon: "fa-graduation-cap" },
    { id: "trophies", label: "Trophies", icon: "fa-trophy" },
    { id: "income", label: "Income", icon: "fa-dollar-sign" },
    { id: "staff", label: "Staff", icon: "fa-users-gear" },
    { id: "incidents", label: "Incidents", icon: "fa-triangle-exclamation" },
    { id: "settings", label: "Settings", icon: "fa-cog" },
    { id: "tutorials", label: "How to Use", icon: "fa-circle-question" },
  ];

  const handleNav = (id) => { setTab(id); setDrawerOpen(false); };

  const sidebarContent = (prefix) => (
    <>
      <div className="p-4 border-b border-bgHover text-center">
        <img src="/logo.png" alt="Sit Happens" className="h-20 mx-auto" data-testid={`${prefix}sidebar-logo`} />
        <p className="text-[15px] text-gray-500 font-black uppercase tracking-[0.25em] mt-2">Dog Training • Daycare • Boarding • Photography</p>
      </div>
      <nav className="flex-grow p-4 space-y-1 overflow-y-auto">
        {navItems.map(n => (
          <button key={n.id} onClick={() => handleNav(n.id)} data-testid={`${prefix}nav-${n.id}`}
                  className={`w-full text-left py-3 px-4 rounded-lg text-[15px] font-black uppercase tracking-widest transition ${tab===n.id?"bg-bgPanel border-l-4 border-shBlue text-shBlue":"hover:bg-bgHover text-gray-400"}`}>
            <i className={`fas ${n.icon} mr-3 w-4`} /> {n.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-bgHover space-y-3">
        <TextSizePicker testid={`${prefix}text-size`} compact />
        <InstallAppButton testid={`${prefix}install-app-nav`} />
        <div className="bg-bgPanel rounded-lg p-3">
          <p className="text-[15px] text-gray-500 font-black uppercase tracking-widest">Signed in</p>
          <p className="text-xs text-white font-black truncate">{user.name}</p>
          <button onClick={logout} data-testid={`${prefix}admin-logout`} className="mt-2 w-full text-[14px] font-black uppercase tracking-widest text-red-400 hover:text-red-300">Logout</button>
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
          <button onClick={()=>setSearchOpen(true)} data-testid="open-search"
                  className="hidden md:flex items-center gap-2 bg-bgPanel border border-bgHover rounded px-3 py-1.5 text-xs text-gray-400 hover:border-shBlue">
            <i className="fas fa-search text-[14px]" />
            <span>Search…</span>
            <kbd className="text-[15px] font-black bg-bgBase border border-bgHover rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
          <button onClick={()=>setSearchOpen(true)} className="md:hidden text-gray-300 p-2"><i className="fas fa-search" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 relative" data-scroll-root>
          {tab === "dashboard" && <Dashboard
            onNavigate={(t)=>setTab(t)}
            onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id}); setTab("dogs"); }}
            onJumpToClient={(id)=>{ setSearchTarget({kind:"client", id}); setTab("clients"); }}
          />}
          {tab === "schedule" && <Schedule />}
          {tab === "runsheet" && <RunSheet />}
          {tab === "bookings" && <Bookings />}
          {tab === "recurring" && <RecurringTemplates />}
          {tab === "clients" && <Clients focusId={searchTarget?.kind==="client"?searchTarget.id:null} onConsumed={()=>setSearchTarget(null)} onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id}); setTab("dogs"); }} />}
          {tab === "dogs" && <Dogs focusId={searchTarget?.kind==="dog"?searchTarget.id:null} onConsumed={()=>setSearchTarget(null)} />}
          {tab === "pipeline" && <Pipeline onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id}); setTab("dogs"); }} />}
          {tab === "homework" && <Homework />}
          {tab === "trophies" && <Trophies />}
          {tab === "income" && <Income />}
          {tab === "staff" && <Staff />}
          {tab === "incidents" && <Incidents />}
          {tab === "settings" && <Settings />}
          {tab === "tutorials" && <Tutorials role="admin" />}
        </div>
      </main>
      <GlobalSearch open={searchOpen} onClose={()=>setSearchOpen(false)} onNavigate={navigateTo} />
    </div>
  );
}

function Gate() {
  const { user } = useAuth();
  if (user === null) return <div className="h-screen w-screen flex items-center justify-center bg-bgBase text-gray-400 text-sm font-black uppercase tracking-widest">Loading…</div>;
  if (!user) return <Login />;
  if (user.role === "admin") return <AdminShell />;
  if (user.role === "employee") return <EmployeePortal />;
  return <Portal />;
}

export default function App() {
  // Public claim/reset link — handled before auth so unauthenticated visitors can land here.
  const claimMatch = typeof window !== "undefined" && window.location.pathname.match(/^\/claim\/([^/?#]+)/);
  if (claimMatch) {
    return (
      <ErrorBoundary>
        <Claim token={decodeURIComponent(claimMatch[1])} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <ConfirmProvider>
            <ImpersonationBanner />
            <Gate />
            <InstallPrompt />
            <BrandFooter />
          </ConfirmProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
