import { Toaster } from "sonner";
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
import IntakeForms from "./screens/IntakeForms";
import CareBoard from "./screens/CareBoard";
import Waitlist from "./screens/Waitlist";
import KennelBoard from "./screens/KennelBoard";
import Claim from "./screens/Claim";
import ShareCertificate from "./screens/ShareCertificate";
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

  // Sprint 110eh — Settings card-grid links to external screens (Staff,
  // Income, Trophies) dispatch a `sh:nav` event so the shell can flip the
  // active tab without prop-drilling setTab into every panel.
  useEffect(() => {
    const onNav = (e) => {
      const dest = e?.detail;
      if (typeof dest === "string" && dest) setTab(dest);
    };
    window.addEventListener("sh:nav", onNav);
    return () => window.removeEventListener("sh:nav", onNav);
  }, []);

  const navigateTo = (item) => {
    setSearchOpen(false);
    // Sprint 110cm — search results scroll-and-flash (don't auto-open the
    // edit modal). Operator clicks the card if they want to drill in.
    if (item.kind === "dog") { setSearchTarget({ kind: "dog", id: item.id, mode: "scroll" }); setTab("dogs"); }
    else if (item.kind === "client") { setSearchTarget({ kind: "client", id: item.id, mode: "scroll" }); setTab("clients"); }
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "fa-chart-line" },
    { id: "schedule", label: "Schedule", icon: "fa-calendar-alt" },
    { id: "runsheet", label: "Run Sheet", icon: "fa-clipboard-list" },
    { id: "care", label: "Care Board", icon: "fa-bowl-food" },
    { id: "kennel", label: "Kennel Board", icon: "fa-paw" },
    { id: "bookings", label: "Bookings", icon: "fa-calendar-check" },
    { id: "waitlist", label: "Waitlist", icon: "fa-hourglass-half" },
    { id: "recurring", label: "Recurring", icon: "fa-rotate" },
    { id: "clients", label: "Clients", icon: "fa-users" },
    { id: "dogs", label: "Dogs", icon: "fa-paw" },
    { id: "pipeline", label: "Pipeline", icon: "fa-line-chart" },
    { id: "homework", label: "Homework", icon: "fa-graduation-cap" },
    { id: "trophies", label: "Trophies", icon: "fa-trophy" },
    { id: "income", label: "Income", icon: "fa-dollar-sign" },
    { id: "staff", label: "Staff", icon: "fa-users-gear" },
    { id: "incidents", label: "Incidents", icon: "fa-triangle-exclamation" },
    { id: "intake", label: "Intake Forms", icon: "fa-clipboard-list" },
    { id: "settings", label: "Settings", icon: "fa-cog" },
    { id: "tutorials", label: "How to Use", icon: "fa-circle-question" },
  ];

  const handleNav = (id) => { setTab(id); setDrawerOpen(false); };

  const sidebarContent = (prefix) => (
    <>
      {/* Sprint 110u — branded sidebar header. Logo gets a soft brand-color
          halo so it pops the way the landing-page hero logo does. */}
      <div className="relative p-5 border-b border-bgHover text-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none opacity-60 blur-2xl"
             style={{ background: "radial-gradient(circle at 50% 30%, rgba(140,198,63,0.35) 0%, rgba(0,169,224,0.22) 45%, transparent 75%)" }}/>
        <img src="/logo.png" alt="Sit Happens"
             className="relative h-24 mx-auto drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]"
             data-testid={`${prefix}sidebar-logo`} />
        <p className="relative text-[11px] text-gray-400 font-black uppercase tracking-[0.3em] mt-2">
          Dog Training · Daycare · Boarding · Photography
        </p>
      </div>
      <nav className="flex-grow p-3 space-y-1 overflow-y-auto">
        {navItems.map(n => (
          <button key={n.id} onClick={() => handleNav(n.id)} data-testid={`${prefix}nav-${n.id}`}
                  className={`group w-full text-left py-2.5 px-3 rounded-lg text-[14px] font-black uppercase tracking-widest transition-all ${tab===n.id?"bg-gradient-to-r from-shBlue/25 to-transparent border-l-4 border-shGreen text-white shadow-inner":"hover:bg-bgPanel/60 hover:translate-x-0.5 text-gray-400 hover:text-white border-l-4 border-transparent"}`}>
            <i className={`fas ${n.icon} mr-3 w-4 ${tab===n.id?"text-shGreen":"text-gray-500 group-hover:text-shBlue"}`} /> {n.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-bgHover space-y-3">
        <TextSizePicker testid={`${prefix}text-size`} compact />
        <InstallAppButton testid={`${prefix}install-app-nav`} />
        <div className="bg-bgPanel rounded-lg p-3 border border-bgHover">
          <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest">
            <i className="fas fa-user-shield text-shGreen mr-1"/>Signed in
          </p>
          <p className="text-xs text-white font-black truncate mt-0.5">{user.name}</p>
          <button onClick={logout} data-testid={`${prefix}admin-logout`}
                  className="mt-2 w-full text-[12px] font-black uppercase tracking-widest text-red-400 hover:text-red-300 transition">
            <i className="fas fa-right-from-bracket mr-1"/>Logout
          </button>
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
        {/* Sprint 110u — top header gets the same backdrop-blur + accent glow
            treatment as the landing page nav. Page title becomes a big
            uppercase-italic-black badge instead of a tiny label. */}
        <header className="relative bg-bgHeader/95 backdrop-blur border-b border-bgHover h-16 flex items-center justify-between px-4 md:px-8 gap-3 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-25"
               style={{ background: "radial-gradient(circle at 0% 50%, rgba(0,169,224,0.35) 0%, transparent 40%), radial-gradient(circle at 100% 50%, rgba(140,198,63,0.25) 0%, transparent 45%)" }}/>
          <div className="relative flex items-center gap-3 min-w-0">
            <button onClick={()=>setDrawerOpen(true)} data-testid="drawer-toggle"
                    className="md:hidden text-gray-200 hover:text-shGreen p-2 -ml-2 text-lg transition">
              <i className="fas fa-bars" />
            </button>
            <img src="/logo.png" alt="Sit Happens"
                 className="h-11 md:hidden drop-shadow-[0_0_10px_rgba(140,198,63,0.4)]" />
            <h2 className="text-base sm:text-lg font-black uppercase italic text-white tracking-tight truncate pr-1"
                data-testid="header-title">
              <span className="text-shGreen">·</span> {tab}
            </h2>
          </div>
          <button onClick={()=>setSearchOpen(true)} data-testid="open-search"
                  className="relative hidden md:flex items-center gap-2 bg-bgPanel border border-bgHover rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:border-shGreen hover:text-white transition">
            <i className="fas fa-search text-[14px]" />
            <span>Search clients, dogs…</span>
            <kbd className="text-[12px] font-black bg-bgBase border border-bgHover rounded px-1.5 py-0.5">⌘K</kbd>
          </button>
          <button onClick={()=>setSearchOpen(true)} className="relative md:hidden text-gray-300 p-2 hover:text-shGreen transition"><i className="fas fa-search" /></button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 relative" data-scroll-root>
          {tab === "dashboard" && <Dashboard
            onNavigate={(t)=>setTab(t)}
            onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id, mode:"open"}); setTab("dogs"); }}
            onJumpToClient={(id)=>{ setSearchTarget({kind:"client", id, mode:"open"}); setTab("clients"); }}
          />}
          {tab === "schedule" && <Schedule />}
          {tab === "runsheet" && <RunSheet />}
          {tab === "care" && <CareBoard />}
          {tab === "kennel" && <KennelBoard />}
          {tab === "bookings" && <Bookings />}
          {tab === "waitlist" && <Waitlist />}
          {tab === "recurring" && <RecurringTemplates />}
          {tab === "clients" && <Clients focusId={searchTarget?.kind==="client"?searchTarget.id:null} focusMode={searchTarget?.mode || "scroll"} onConsumed={()=>setSearchTarget(null)} onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id, mode:"open"}); setTab("dogs"); }} />}
          {tab === "dogs" && <Dogs focusId={searchTarget?.kind==="dog"?searchTarget.id:null} focusMode={searchTarget?.mode || "scroll"} onConsumed={()=>setSearchTarget(null)} />}
          {tab === "pipeline" && <Pipeline onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id, mode:"open"}); setTab("dogs"); }} />}
          {tab === "homework" && <Homework />}
          {tab === "trophies" && <Trophies />}
          {tab === "income" && <Income />}
          {tab === "staff" && <Staff />}
          {tab === "incidents" && <Incidents />}
          {tab === "intake" && <IntakeForms />}
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
  // Sprint 110b — public shareable certificate page (no auth).
  const shareMatch = typeof window !== "undefined" && window.location.pathname.match(/^\/share\/cert\/([^/?#]+)/);
  if (shareMatch) {
    return (
      <ErrorBoundary>
        <ShareCertificate token={decodeURIComponent(shareMatch[1])} />
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
            {/* Sprint 110ao — global toast layer for live-refresh new-arrival
                pings (e.g. "🐶 New booking · Bella · daycare tomorrow"). */}
            <Toaster theme="dark" position="top-right" richColors closeButton expand />
          </ConfirmProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
