import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider, useTheme } from "./lib/theme";
import Login from "./screens/Login";
import Dashboard from "./screens/Dashboard";
import ActionCenter from "./screens/ActionCenter";
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
import Rewards from "./screens/Rewards";
import DuplicateCheck from "./screens/DuplicateCheck";
import Staff from "./screens/Staff";
import Pos from "./screens/Pos";
import CreditReconciliation from "./screens/CreditReconciliation";
import RecurringTemplates from "./screens/RecurringTemplates";
import Tutorials from "./screens/Tutorials";
import IntakeForms from "./screens/IntakeForms";
import CareBoard from "./screens/CareBoard";
import Waitlist from "./screens/Waitlist";
import KennelBoard from "./screens/KennelBoard";
import AuditLog from "./screens/AuditLog";
import BulkEmail from "./screens/BulkEmail";
import ClientMessages from "./screens/ClientMessages";
import Announcements from "./screens/Announcements";
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
import ForcedPasswordChange from "./components/ForcedPasswordChange";
import { api } from "./lib/api";

function AdminShell() {
  const { user, logout, can } = useAuth();
  const { branding } = useTheme();
  // Sprint 110di-17 — feature_visibility map. Default-true if missing so
  // first paint never hides anything.
  const fv = branding?.feature_visibility || {};
  const featureOn = (key) => fv[key] !== false;
  const [tab, setTab] = useState("dashboard");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Sprint 110di-41 — Desktop sidebar collapse to icons-only. Persisted in
  // localStorage so the operator's preference survives reloads.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("sh_sidebar_collapsed") === "1"; }
    catch { return false; }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem("sh_sidebar_collapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState(null);
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [shopOrdersUnseen, setShopOrdersUnseen] = useState(0);

  // Poll the admin messages-unread badge every 60s and on tab change so
  // the sidebar dot stays roughly fresh without hammering the API.
  useEffect(() => {
    if (!can || !can("messages")) return;
    let alive = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/admin/messages/unread-count");
        if (alive) setMessagesUnread(data?.unread || 0);
      } catch { /* ignore */ }
    };
    tick();
    const h = setInterval(tick, 60000);
    return () => { alive = false; clearInterval(h); };
  }, [can, tab]);

  // Same pattern for the new-Shop-order badge on Front Desk. Pos.jsx
  // dispatches "sh:shop-orders-seen" right after it successfully marks
  // displayed orders seen, so the sidebar badge drops immediately instead
  // of waiting up to 60s for the next poll — mirrors the existing "sh:nav"
  // cross-component event convention rather than prop-drilling into Pos.
  useEffect(() => {
    if (!can || !can("take_payments")) return;
    let alive = true;
    const tick = async () => {
      try {
        const { data } = await api.get("/admin/shop-orders/unseen-count");
        if (alive) setShopOrdersUnseen(data?.unseen || 0);
      } catch { /* ignore */ }
    };
    tick();
    const h = setInterval(tick, 60000);
    const onSeen = () => tick();
    window.addEventListener("sh:shop-orders-seen", onSeen);
    return () => { alive = false; clearInterval(h); window.removeEventListener("sh:shop-orders-seen", onSeen); };
  }, [can, tab]);

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
    { id: "pos", label: "Front Desk", icon: "fa-cash-register", perm: "take_payments" },
    { id: "action_center", label: "Action Center", icon: "fa-list-check" },
    { id: "schedule", label: "Schedule", icon: "fa-calendar-alt" },
    { id: "runsheet", label: "Run Sheet", icon: "fa-clipboard-list" },
    { id: "care", label: "Care Board", icon: "fa-bowl-food", perm: "care_complete" },
    { id: "kennel", label: "Kennel Board", icon: "fa-paw", perm: "dogs_view" },
    { id: "bookings", label: "Bookings", icon: "fa-calendar-check" },
    { id: "waitlist", label: "Waitlist", icon: "fa-hourglass-half", perm: "booking_edit", feature: "waitlist" },
    { id: "recurring", label: "Recurring", icon: "fa-rotate" },
    { id: "clients", label: "Clients", icon: "fa-users", perm: "clients_view" },
    { id: "dogs", label: "Dogs", icon: "fa-paw", perm: "dogs_view" },
    { id: "duplicate_check", label: "Duplicate Check", icon: "fa-copy", perm: "settings" },
    { id: "pipeline", label: "Pipeline", icon: "fa-line-chart" },
    { id: "homework", label: "Homework", icon: "fa-graduation-cap", feature: "homework" },
    { id: "rewards_center", label: "Rewards", icon: "fa-gift", feature: "rewards" },
    { id: "trophies", label: "Trophies", icon: "fa-trophy", feature: "rewards" },
    { id: "income", label: "Finance", icon: "fa-dollar-sign", perm: "finance_reports" },
    { id: "credit_reconciliation", label: "Credit Audit", icon: "fa-scale-balanced", perm: "finance_reports" },
    { id: "staff", label: "Staff", icon: "fa-users-gear", perm: "payroll", feature: "staff_portal" },
    { id: "incidents", label: "Incidents", icon: "fa-triangle-exclamation", perm: "incidents" },
    { id: "intake", label: "Intake Forms", icon: "fa-clipboard-list", perm: "clients_edit" },
    { id: "messages", label: "Client Messages", icon: "fa-comments", perm: "messages", feature: "client_messaging" },
    { id: "announcements", label: "Announcements", icon: "fa-bullhorn", perm: "settings" },
    { id: "bulkemail", label: "Bulk Email", icon: "fa-paper-plane", perm: "settings" },
    { id: "audit", label: "Audit Log", icon: "fa-list-check", perm: "settings" },
    { id: "settings", label: "Settings", icon: "fa-cog", perm: "settings" },
    { id: "tutorials", label: "How to Use", icon: "fa-circle-question" },
  ];

  // Admin redesign — group existing nav items for scannability. No new
  // routes/ids are introduced; this only changes how the same flat
  // `navItems` list above is presented in the sidebar.
  const NAV_GROUPS = [
    { label: "Operations", ids: ["dashboard", "pos", "action_center", "schedule", "runsheet", "care", "kennel", "bookings", "waitlist", "recurring"] },
    { label: "Clients", ids: ["clients", "dogs", "messages", "intake", "incidents", "duplicate_check"] },
    { label: "Business", ids: ["income", "credit_reconciliation", "pipeline", "homework", "rewards_center", "trophies"] },
    { label: "Team", ids: ["staff"] },
    { label: "System", ids: ["announcements", "bulkemail", "audit", "settings", "tutorials"] },
  ];
  const navById = Object.fromEntries(navItems.map(n => [n.id, n]));
  const visibleGroups = NAV_GROUPS
    .map(g => ({ ...g, items: g.ids.map(id => navById[id]).filter(n => n && (!n.perm || can(n.perm)) && (!n.feature || featureOn(n.feature))) }))
    .filter(g => g.items.length > 0);
  const currentNavLabel = navById[tab]?.label || tab;

  const [collapsedGroups, setCollapsedGroups] = useState({});
  const toggleGroup = (label) => setCollapsedGroups(g => ({ ...g, [label]: !g[label] }));

  const handleNav = (id) => { setTab(id); setDrawerOpen(false); };

  const sidebarContent = (prefix, collapsed = false) => (
    <>
      {/* Real logo, subtle lime/cyan halo — unchanged from before, just
          converted to the new near-black/border tokens. */}
      <div className={`relative shrink-0 border-b border-shBorder overflow-hidden ${collapsed ? "p-2" : "p-3"}`}>
        <div className="flex items-center justify-between gap-2 mb-2">
          {prefix === "" && (
            <button onClick={toggleSidebar} data-testid="sidebar-toggle-collapse"
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    className="hidden md:inline-flex items-center justify-center w-8 h-8 rounded text-shTextMuted hover:text-shPrimary hover:bg-shSurfaceRaised transition">
              <i className={`fas ${collapsed ? "fa-chevron-right" : "fa-chevron-left"} text-[14px]`}/>
            </button>
          )}
          {prefix === "mobile-" && (
            <button onClick={()=>setDrawerOpen(false)} data-testid="drawer-close"
                    title="Close menu"
                    className="ml-auto inline-flex items-center justify-center w-8 h-8 rounded text-shTextMuted hover:text-shPrimary hover:bg-shSurfaceRaised transition">
              <i className="fas fa-times text-[16px]"/>
            </button>
          )}
        </div>
        {!collapsed && (
          <div className="relative text-center">
            <div className="absolute inset-0 pointer-events-none opacity-60 blur-2xl"
                 style={{ background: "radial-gradient(circle at 50% 30%, rgba(140,198,63,0.35) 0%, rgba(0,169,224,0.22) 45%, transparent 75%)" }}/>
            <img src="/logo.png" alt="Sit Happens"
                 className="relative h-16 mx-auto drop-shadow-[0_6px_18px_rgba(0,0,0,0.55)]"
                 data-testid={`${prefix}sidebar-logo`} />
            <p className="relative text-[10px] text-shTextMuted font-bold uppercase tracking-[0.25em] mt-1.5 leading-tight">
              Dog Training · Daycare · Boarding · Photography
            </p>
          </div>
        )}
        {collapsed && (
          <img src="/logo.png" alt="Sit Happens"
               className="h-8 mx-auto drop-shadow-[0_4px_12px_rgba(0,0,0,0.55)]"
               data-testid={`${prefix}sidebar-logo`} />
        )}
      </div>
      <nav className={`flex-grow space-y-3 overflow-y-auto ${collapsed ? "p-2" : "p-3"}`}>
        {visibleGroups.map(g => {
          const isCollapsed = !!collapsedGroups[g.label];
          return (
            <div key={g.label}>
              {!collapsed && (
                <button onClick={() => toggleGroup(g.label)} data-testid={`${prefix}nav-group-${g.label.toLowerCase()}`}
                        className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-shTextMuted/70 hover:text-shTextMuted transition">
                  <span>{g.label}</span>
                  <i className={`fas fa-chevron-${isCollapsed ? "right" : "down"} text-[9px]`}/>
                </button>
              )}
              {(collapsed || !isCollapsed) && (
                <div className="space-y-0.5 mt-0.5">
                  {g.items.map(n => {
                    const active = tab === n.id;
                    return (
                      <button key={n.id} onClick={() => handleNav(n.id)} data-testid={`${prefix}nav-${n.id}`}
                              title={collapsed ? n.label : undefined}
                              style={active ? {
                                background: "linear-gradient(90deg, rgba(140,198,63,0.14), rgba(140,198,63,0.02))",
                                borderLeft: "3px solid rgb(140,198,63)",
                                boxShadow: "0 0 18px -8px rgba(140,198,63,0.5)",
                              } : { borderLeft: "3px solid transparent" }}
                              className={`group relative w-full ${collapsed ? "text-center py-2.5 px-0" : "text-left py-2 px-2.5"} rounded-md text-[13px] font-semibold transition-all ${active ? "text-shText" : "text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised"}`}>
                        <i className={`fas ${n.icon} ${collapsed ? "" : "mr-2.5 w-4"} ${active ? "text-shPrimary" : "text-shTextMuted group-hover:text-shSecondary"}`} />
                        {!collapsed && n.label}
                        {n.id === "messages" && messagesUnread > 0 && (
                          <span className={`${collapsed ? "absolute top-0 right-0 -mt-1 -mr-1" : "ml-2"} inline-block bg-shAccent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle`}
                                data-testid={`${prefix}nav-messages-badge`}>{collapsed ? "•" : messagesUnread}</span>
                        )}
                        {n.id === "pos" && shopOrdersUnseen > 0 && (
                          <span className={`${collapsed ? "absolute top-0 right-0 -mt-1 -mr-1" : "ml-2"} inline-block bg-shAccent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle`}
                                data-testid={`${prefix}nav-pos-badge`}>{collapsed ? "•" : shopOrdersUnseen}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className={`border-t border-shBorder ${collapsed ? "p-2 space-y-2" : "p-4 space-y-3"}`}>
        {!collapsed && (
          <>
            <TextSizePicker testid={`${prefix}text-size`} compact />
            <InstallAppButton testid={`${prefix}install-app-nav`} />
            <div className="rounded-lg p-3 border border-shBorder" style={{ background: "var(--sh-card-base)" }}>
              <p className="text-[11px] text-shTextMuted font-bold uppercase tracking-widest">
                <i className="fas fa-user-shield text-shPrimary mr-1"/>Signed in
              </p>
              <p className="text-xs text-shText font-bold truncate mt-0.5">{user.name}</p>
              <button onClick={logout} data-testid={`${prefix}admin-logout`}
                      className="mt-2 w-full text-[12px] font-bold uppercase tracking-widest text-shDanger hover:text-shDanger/80 transition text-left">
                <i className="fas fa-right-from-bracket mr-1"/>Logout
              </button>
            </div>
          </>
        )}
        {collapsed && (
          <button onClick={logout} data-testid={`${prefix}admin-logout-collapsed`}
                  title="Logout"
                  className="w-full py-2 rounded-lg text-shDanger hover:bg-shDanger/10 transition">
            <i className="fas fa-right-from-bracket"/>
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="app-shell h-screen w-screen flex overflow-hidden" style={{ background: "var(--sh-card-base)" }}>
      {/* Desktop sidebar — width responds to collapsed state (w-16 icon-only
          / w-64 full). Transition kept short so the page reflow feels snappy. */}
      <aside className={`border-r border-shBorder flex-col hidden md:flex transition-[width] duration-200 ${sidebarCollapsed ? "w-16" : "w-64"}`}
             style={{ background: "var(--sh-card-base)" }}>
        {sidebarContent("", sidebarCollapsed)}
      </aside>

      {/* Mobile drawer */}
      <div className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${drawerOpen?"opacity-100 pointer-events-auto":"opacity-0 pointer-events-none"}`}
           onClick={()=>setDrawerOpen(false)} data-testid="drawer-backdrop">
        <div className="absolute inset-0 bg-black/70" />
      </div>
      <aside className={`app-mobile-drawer md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 max-w-[85vw] border-r border-shBorder flex flex-col min-h-0 transition-transform duration-200 ${drawerOpen?"translate-x-0":"-translate-x-full"}`}
             style={{ background: "var(--sh-card-base)" }}
             data-testid="mobile-drawer">
        {sidebarContent("mobile-")}
      </aside>

      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        {/* Persistent top header — near-black w/ restrained accent glow,
            friendly page label (from nav metadata, not the raw tab id). */}
        <header className="relative shrink-0 border-b border-shBorder h-16 flex items-center justify-between px-4 md:px-8 gap-3 overflow-hidden"
                style={{ background: "rgba(7,8,13,0.95)", backdropFilter: "blur(8px)" }}>
          <div className="absolute inset-0 pointer-events-none opacity-20"
               style={{ background: "radial-gradient(circle at 0% 50%, rgba(0,169,224,0.3) 0%, transparent 40%), radial-gradient(circle at 100% 50%, rgba(140,198,63,0.22) 0%, transparent 45%)" }}/>
          <div className="relative flex items-center gap-3 min-w-0">
            <button onClick={()=>setDrawerOpen(true)} data-testid="drawer-toggle"
                    className="md:hidden text-shText hover:text-shPrimary p-2 -ml-2 text-lg transition">
              <i className="fas fa-bars" />
            </button>
            <img src="/logo.png" alt="Sit Happens"
                 className="h-11 md:hidden drop-shadow-[0_0_10px_rgba(140,198,63,0.4)]" />
            <h2 className="text-base sm:text-lg font-bold text-shText tracking-tight truncate pr-1"
                data-testid="header-title">
              <span className="text-shPrimary">·</span> {currentNavLabel}
            </h2>
          </div>
          <button onClick={()=>setSearchOpen(true)} data-testid="open-search"
                  className="relative hidden md:flex items-center gap-2 border border-shBorder rounded-lg px-3 py-1.5 text-xs text-shTextMuted hover:border-shPrimary/40 hover:text-shText transition"
                  style={{ background: "var(--sh-card-base)" }}>
            <i className="fas fa-search text-[14px]" />
            <span>Search clients, dogs…</span>
            <kbd className="text-[12px] font-bold border border-shBorder rounded px-1.5 py-0.5" style={{ background: "rgba(255,255,255,0.04)" }}>⌘K</kbd>
          </button>
          <button onClick={()=>setSearchOpen(true)} className="relative md:hidden text-shTextMuted p-2 hover:text-shPrimary transition"><i className="fas fa-search" /></button>
        </header>
        <div className="app-scroll-root flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-8 relative" data-scroll-root>
          {tab === "dashboard" && <Dashboard
            onNavigate={(t)=>setTab(t)}
            onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id, mode:"open"}); setTab("dogs"); }}
            onJumpToClient={(id)=>{ setSearchTarget({kind:"client", id, mode:"open"}); setTab("clients"); }}
            can={can}
          />}
          {tab === "action_center" && <ActionCenter
            onNavigate={(t)=>setTab(t)}
            onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id, mode:"open"}); setTab("dogs"); }}
            onJumpToClient={(id)=>{ setSearchTarget({kind:"client", id, mode:"open"}); setTab("clients"); }}
          />}
          {tab === "schedule" && <Schedule />}
          {tab === "runsheet" && <RunSheet />}
          {tab === "care" && <CareBoard />}
          {tab === "kennel" && <KennelBoard />}
          {tab === "bookings" && <Bookings />}
          {tab === "waitlist" && featureOn("waitlist") && <Waitlist />}
          {tab === "recurring" && <RecurringTemplates />}
          {tab === "clients" && <Clients focusId={searchTarget?.kind==="client"?searchTarget.id:null} focusMode={searchTarget?.mode || "scroll"} onConsumed={()=>setSearchTarget(null)} onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id, mode:"open"}); setTab("dogs"); }} />}
          {tab === "dogs" && <Dogs focusId={searchTarget?.kind==="dog"?searchTarget.id:null} focusMode={searchTarget?.mode || "scroll"} onConsumed={()=>setSearchTarget(null)} />}
          {tab === "duplicate_check" && <DuplicateCheck />}
          {tab === "pipeline" && <Pipeline onJumpToDog={(id)=>{ setSearchTarget({kind:"dog", id, mode:"open"}); setTab("dogs"); }} />}
          {tab === "homework" && featureOn("homework") && <Homework />}
          {tab === "rewards_center" && featureOn("rewards") && <Rewards />}
          {tab === "trophies" && featureOn("rewards") && <Trophies />}
          {/* The old standalone Register screen is gone — Front Desk now owns
              all of that functionality. Redirect any stale nav call
              (bookmarked sidebar state, old localStorage flag, etc.) that
              still targets "register" here instead of rendering nothing. */}
          {(tab === "pos" || tab === "register") && <Pos />}
          {tab === "income" && <Income />}
          {tab === "credit_reconciliation" && <CreditReconciliation />}
          {tab === "staff" && featureOn("staff_portal") && <Staff />}
          {tab === "incidents" && <Incidents />}
          {tab === "intake" && <IntakeForms />}
          {tab === "messages" && featureOn("client_messaging") && <ClientMessages />}
          {tab === "announcements" && <Announcements />}
          {tab === "bulkemail" && <BulkEmail />}
          {tab === "audit" && <AuditLog />}
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
  if (user === null) return <div className="h-screen w-screen flex items-center justify-center text-shTextMuted text-sm font-bold uppercase tracking-widest" style={{ background: "var(--sh-card-base)" }}>Loading…</div>;
  if (!user) return <Login />;
  if (user.must_change_password) return <ForcedPasswordChange />;
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
