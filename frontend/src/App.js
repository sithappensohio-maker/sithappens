import { Toaster, toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ThemeProvider, useTheme } from "./lib/theme";
import { addRecent } from "./lib/recentlyOpened";
import Login from "./screens/Login";
import Today from "./screens/Today";
import ActionCenter from "./screens/ActionCenter";
import ScheduleWorkspace from "./screens/ScheduleWorkspace";
import TrainingWorkspace from "./screens/TrainingWorkspace";
import Clients from "./screens/Clients";
import Dogs from "./screens/Dogs";
import Portal from "./screens/Portal";
import EmployeePortal from "./screens/EmployeePortal";
import Settings from "./screens/Settings";
import Incidents from "./screens/Incidents";
import RunSheet from "./screens/RunSheet";
import Income from "./screens/Income";
import DuplicateCheck from "./screens/DuplicateCheck";
import Staff from "./screens/Staff";
import Pos from "./screens/Pos";
import CreditReconciliation from "./screens/CreditReconciliation";
import ShopManager from "./screens/ShopManager";
import Tutorials from "./screens/Tutorials";
import IntakeForms from "./screens/IntakeForms";
import CareBoard from "./screens/CareBoard";
import KennelBoard from "./screens/KennelBoard";
import AuditLog from "./screens/AuditLog";
import BulkEmail from "./screens/BulkEmail";
import ClientMessages from "./screens/ClientMessages";
import Announcements from "./screens/Announcements";
import Claim from "./screens/Claim";
import ShareCertificate from "./screens/ShareCertificate";
import PublicShop from "./screens/PublicShop";
import GlobalSearch from "./components/GlobalSearch";
import AdminBookingModal from "./components/AdminBookingModal";
import TakePaymentModal from "./components/TakePaymentModal";
import ActionMenu from "./components/admin/ActionMenu";
import ErrorBoundary from "./components/ErrorBoundary";
import InstallPrompt from "./components/InstallPrompt";
import InstallAppButton from "./components/InstallAppButton";
import { ConfirmProvider } from "./lib/useConfirm";
import ImpersonationBanner from "./components/ImpersonationBanner";
import TextSizePicker from "./components/TextSizePicker";
import BrandFooter from "./components/BrandFooter";
import ForcedPasswordChange from "./components/ForcedPasswordChange";
import { useAdminNavCounts } from "./lib/sharedData";
import { adminPathForTab, parseAdminLocation, SCHEDULE_TAB_BY_SECTION, TRAINING_TAB_BY_SECTION } from "./lib/adminRoutes";

function AdminShell() {
  const { user, logout, can, isOwner } = useAuth();
  const { branding } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  // Sprint 110di-17 — feature_visibility map. Default-true if missing so
  // first paint never hides anything.
  const fv = branding?.feature_visibility || {};
  const featureOn = (key) => fv[key] !== false;

  // Modernization Phase 2 — the browser URL is now the authoritative admin
  // navigation state. Existing screens still receive their legacy tab ids so
  // this routing migration does not alter business behavior.
  const routeInfo = useMemo(
    () => parseAdminLocation(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const tab = routeInfo.tab;
  const searchTarget = routeInfo.target;
  const navigateAdmin = useCallback((destination, target = null, options = {}) => {
    navigate(adminPathForTab(destination, target), { replace: !!options.replace });
  }, [navigate]);
  // Compatibility shim: old shell callbacks and `sh:nav` events can keep
  // speaking in tab ids while React Router owns history/back/forward.
  const setTab = useCallback((destination) => navigateAdmin(destination), [navigateAdmin]);
  const clearSearchTarget = useCallback(() => {}, []);
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
  // Modernization Phase 3 — one shared owner for the shell badges. This
  // replaces four independent polling effects (which also re-polled on every
  // tab change) while preserving the same permissions, endpoints and events.
  const { messagesUnread, shopOrdersUnseen, schoolAttention, pendingActions } = useAdminNavCounts({
    messages: !!can?.("messages"),
    shopOrders: !!can?.("take_payments"),
    school: !!can?.("manage_school"),
    pendingActions: !!can?.("booking_edit"),
  });

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
    // Extended for the Section 1 search expansion: bookings/bills/payments/
    // shop-orders/prepaid-visit purchases all route to the owning client's
    // record (or, for shop orders, the Front Desk order list) since none of
    // them have a standalone detail screen of their own — Client Hub (once
    // built) reads `searchTarget.kind` to focus the right tab.
    if (item.kind === "dog") navigateAdmin("dogs", { kind: "dog", id: item.id, mode: "scroll" });
    else if (item.kind === "client") navigateAdmin("clients", { kind: "client", id: item.id, mode: "scroll" });
    else if (item.kind === "booking") navigateAdmin("clients", { kind: "booking", id: item.id, clientId: item.client_id, mode: "open" });
    else if (item.kind === "invoice") navigateAdmin("clients", { kind: "invoice", id: item.id, clientId: item.client_id, mode: "open" });
    else if (item.kind === "payment") navigateAdmin("clients", { kind: "client", id: item.client_id, mode: "scroll" });
    else if (item.kind === "shop_order") navigateAdmin("pos");
    else if (item.kind === "prepaid_purchase") navigateAdmin("clients", { kind: "client", id: item.client_id, mode: "scroll" });
    // Section 2 — Recently Opened. Record every kind search can navigate to,
    // using the same title/subtitle already computed for the search row so
    // the recents list reads identically to how it appeared in search.
    addRecent(user?.id, { kind: item.kind, id: item.id, title: item.title, subtitle: item.subtitle, clientId: item.client_id });
  };

  // Quick actions attached to individual search result rows (the secondary
  // buttons — "Book", "Take Payment", "Open Client"). Reuses the exact same
  // global modal / navigation mechanisms as everywhere else; no new forms.
  const onSearchAction = (act, item) => {
    setSearchOpen(false);
    if (act === "open_dog") { navigateAdmin("dogs", { kind: "dog", id: item.id, mode: "scroll" }); addRecent(user?.id, { kind: "dog", id: item.id, title: item.title, subtitle: item.subtitle }); }
    else if (act === "open_client" || act === "open_client_of") {
      const id = act === "open_client_of" ? item.client_id : item.id;
      navigateAdmin("clients", { kind: "client", id, mode: "scroll" });
      addRecent(user?.id, { kind: "client", id, title: act === "open_client_of" ? item.subtitle : item.title, subtitle: "" });
    }
    else if (act === "open_booking") { navigateAdmin("clients", { kind: "booking", id: item.id, clientId: item.client_id, mode: "open" }); addRecent(user?.id, { kind: "booking", id: item.id, title: item.title, subtitle: item.subtitle, clientId: item.client_id }); }
    else if (act === "open_invoice") { navigateAdmin("clients", { kind: "invoice", id: item.id, clientId: item.client_id, mode: "open" }); addRecent(user?.id, { kind: "invoice", id: item.id, title: item.title, subtitle: item.subtitle, clientId: item.client_id }); }
    else if (act === "open_shop_order") { navigateAdmin("pos"); addRecent(user?.id, { kind: "shop_order", id: item.id, title: item.title, subtitle: item.subtitle, clientId: item.client_id }); }
    else if (act === "book_dog") { setPendingBookingPreset({ clientId: item.client_id, dogId: item.id }); setGlobalModal("new_booking"); }
    else if (act === "take_payment") { setPendingPaymentPresetClientId(item.client_id); setGlobalModal("take_payment"); }
  };

  const navItems = NAV_ITEMS;

  // Modernization Phase 1: sidebar destinations now represent real workspaces.
  // Legacy tab ids stay registered and renderable for compatibility, but
  // child destinations (Bookings/Waitlist/Recurring and School/Rewards/etc.)
  // are hidden from the sidebar because their workspace tabs own discovery.
  // Dashboard is also hidden as a standalone destination; Today is the owner
  // landing workspace while Dashboard-only tools are migrated into it.
  const NAV_GROUPS = [
    { label: "Daily Work", ids: ["today", "dashboard", "action_center", "pos", "clients", "dogs", "messages"] },
    { label: "Schedule", ids: ["schedule", "bookings", "waitlist", "recurring"] },
    { label: "Care", ids: ["runsheet", "care", "kennel", "incidents"] },
    { label: "Training", ids: ["pipeline", "school_hq", "rewards_center", "trophies"] },
    { label: "Shop", ids: ["shop_manager"] },
    { label: "Money", ids: ["income", "credit_reconciliation"] },
    { label: "Communication", ids: ["announcements", "bulkemail", "intake"] },
    { label: "Administration", ids: ["staff", "duplicate_check", "audit", "settings", "tutorials"] },
  ];
  // The three core operating areas are open by default; secondary/admin groups stay collapsed.
  const DEFAULT_COLLAPSED_GROUPS = Object.fromEntries(
    NAV_GROUPS.filter(g => !["Daily Work", "Schedule", "Training"].includes(g.label)).map(g => [g.label, true])
  );
  const navById = Object.fromEntries(navItems.map(n => [n.id, n]));
  // Admin IA overhaul — permission-bug checkpoint: single source of truth for
  // "is this tab id allowed right now", reused for BOTH sidebar visibility
  // and render-level gating below, so a restricted screen can never mount
  // (e.g. via a stale `tab` value from before a permission downgrade) even
  // though its nav link is correctly hidden. "register" is a legacy alias
  // for the "pos" nav entry (see the render line below) so it's resolved to
  // the same permission before checking.
  const navAllowed = (id) => navItemAllowed(navById[id === "register" ? "pos" : id], can, featureOn);
  const visibleGroups = NAV_GROUPS
    .map(g => ({ ...g, items: g.ids.map(id => navById[id]).filter(n => n && n.sidebar !== false && navAllowed(n.id)) }))
    .filter(g => g.items.length > 0);
  const sidebarActiveId = workspaceRootForTab(tab);
  const currentNavLabel = navById[sidebarActiveId]?.label || navById[tab]?.label || tab;

  // Phase 4 — global "+ New" action launcher. A pure launcher: every action
  // below opens the EXACT existing workflow used elsewhere (no duplicate
  // forms, no new endpoints). Three actions (New Booking, Take Payment, Add
  // Shop Product) are standalone modals mountable anywhere via `globalModal`.
  // The rest live as local modal state inside their own screen already —
  // for those we navigate to the screen and ask it to open its own existing
  // create modal via `openCreateOnMount` (a tiny additive prop on each
  // screen, not a second form). "Sell Prepaid Visits" has no screen-level
  // Add button (it's per-client-row, via a component private to Clients.jsx)
  // so it navigates there with a clear hint instead of inventing a picker.
  const [globalModal, setGlobalModal] = useState(null); // "new_booking" | "take_payment" | "manage_products" | null
  // Bumped whenever a booking is created via the global launcher so Today
  // (mounted separately from AdminBookingModal here) refreshes immediately
  // instead of waiting for its 30s poll.
  const [todayRefreshSignal, setTodayRefreshSignal] = useState(0);
  // Section 1 (expanded global search) — quick-action context passed to the
  // same global modals above when a search result's "Book" / "Take Payment"
  // button is used, so the form opens pre-filled instead of blank.
  const [pendingBookingPreset, setPendingBookingPreset] = useState(null); // { clientId, dogId } | null
  const [pendingPaymentPresetClientId, setPendingPaymentPresetClientId] = useState(null);
  const [pendingCreateTab, setPendingCreateTab] = useState(null);
  const [pendingIncidentPresetDogId, setPendingIncidentPresetDogId] = useState(null);
  const goCreate = (targetTab) => { setTab(targetTab); setPendingCreateTab(targetTab); };
  const ACTION_GROUPS = [
    {
      label: "People and bookings",
      actions: [
        { id: "new_booking", label: "New Booking", icon: "fa-calendar-plus", perm: null, targetTab: null,
          onSelect: () => setGlobalModal("new_booking") },
        { id: "new_client", label: "New Client", icon: "fa-user-plus", perm: "clients_edit", targetTab: "clients",
          onSelect: () => goCreate("clients") },
        { id: "new_dog", label: "New Dog", icon: "fa-paw", perm: "dogs_edit", targetTab: "dogs",
          onSelect: () => goCreate("dogs") },
      ],
    },
    {
      label: "Payments and sales",
      actions: [
        { id: "take_payment", label: "Take Payment", icon: "fa-cash-register", perm: "take_payments", targetTab: null,
          onSelect: () => setGlobalModal("take_payment") },
        { id: "sell_prepaid", label: "Sell Prepaid Visits", icon: "fa-ticket", perm: "sell_credits", targetTab: "clients",
          onSelect: () => { setTab("clients"); toast.info('Pick a client, then choose "Sell Prepaid Visits" from their card.'); } },
        { id: "add_expense", label: "Add Expense", icon: "fa-receipt", perm: "finance_reports", targetTab: "income",
          onSelect: () => goCreate("income") },
      ],
    },
    {
      label: "Operations",
      actions: [
        { id: "log_incident", label: "Log Incident", icon: "fa-triangle-exclamation", perm: "incidents", targetTab: "incidents",
          onSelect: () => goCreate("incidents") },
        { id: "send_message", label: "Send Message", icon: "fa-comments", perm: "messages", targetTab: "messages",
          onSelect: () => setTab("messages") },
        { id: "create_announcement", label: "Create Announcement", icon: "fa-bullhorn", perm: "manage_communications", targetTab: "announcements",
          onSelect: () => goCreate("announcements") },
      ],
    },
    {
      label: "Shop",
      actions: [
        { id: "add_shop_item", label: "Add Shop Item", icon: "fa-bag-shopping", perm: "view_shop_categories", targetTab: "shop_manager",
          onSelect: () => goCreate("shop_manager") },
      ],
    },
  ];
  const visibleActionGroups = ACTION_GROUPS
    .map(g => ({
      ...g,
      actions: g.actions.filter(a => (!a.perm || can(a.perm)) && (!a.targetTab || navAllowed(a.targetTab))),
    }))
    .filter(g => g.actions.length > 0);
  // Never stack modals: the launcher itself refuses to open while a global
  // modal or the search overlay is already up (ActionMenu shows a clear
  // toast instead of silently doing nothing).
  const newMenuBlocked = !!globalModal || searchOpen;

  // Phase 3 — Pinned favorites. Small personalized shortcut section, purely
  // additive: it opens the exact same `tab` ids as the grouped sidebar (no
  // duplicate routes/components/business logic), and is filtered through
  // the same `navAllowed()` used everywhere else so a pinned favorite can
  // never bypass a permission, a feature flag, or an owner-only gate.
  const FAVORITES_LIMIT = 8;
  const DEFAULT_FAVORITES_BY_ROLE = {
    owner: ["today", "pos", "schedule", "clients", "income"],
    manager: ["today", "pos", "schedule", "clients", "messages"],
    front_desk: ["today", "pos", "schedule", "clients", "messages"],
    trainer: ["today", "schedule", "dogs", "pipeline", "homework"],
    daycare_staff: ["today", "runsheet", "care", "kennel", "dogs"],
    boarding_staff: ["today", "runsheet", "care", "kennel", "dogs"],
    read_only: ["today"],
  };
  const computeDefaultFavorites = () => {
    const sr = isOwner() ? "owner" : (user?.staff_role || "").toLowerCase();
    const list = DEFAULT_FAVORITES_BY_ROLE[sr] || ["today"];
    return list.filter(id => navById[id] && navAllowed(id)).slice(0, FAVORITES_LIMIT);
  };
  // Namespaced by user id, same pattern as sh_sidebar_groups/sh_sidebar_
  // collapsed — isolates favorites per staff user on a shared device and
  // survives reloads. Defaults are computed ONLY the very first time (no
  // saved key at all — an explicitly-saved empty array is a real choice
  // and must be respected), then persisted immediately below so a later
  // staff_role change never silently recomputes/overwrites them again.
  const favoritesStorageKey = `sh_pinned_favorites_${user?.id || "anon"}`;
  const [favorites, setFavorites] = useState(() => {
    try {
      const saved = localStorage.getItem(favoritesStorageKey);
      if (saved !== null) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return computeDefaultFavorites();
  });
  useEffect(() => {
    try {
      if (localStorage.getItem(favoritesStorageKey) === null) {
        localStorage.setItem(favoritesStorageKey, JSON.stringify(favorites));
      }
    } catch (e) { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isPinned = (id) => favorites.includes(id);
  const togglePin = (id) => {
    setFavorites(prev => {
      let next;
      if (prev.includes(id)) {
        next = prev.filter(x => x !== id);
      } else {
        if (prev.length >= FAVORITES_LIMIT) {
          toast.error(`You can pin up to ${FAVORITES_LIMIT} screens — unpin one first.`);
          return prev;
        }
        next = [...prev, id];
      }
      try { localStorage.setItem(favoritesStorageKey, JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  };
  // Reorders within the full saved list, but "up"/"down" is judged against
  // the currently VISIBLE order (what the user actually sees), so a
  // temporarily-hidden favorite sitting between two visible ones never
  // produces a confusing no-op or a swap with the wrong neighbor.
  const moveFavorite = (id, direction) => {
    setFavorites(prev => {
      const visibleIds = prev.filter(fid => navById[fid] && navAllowed(fid));
      const visIdx = visibleIds.indexOf(id);
      const swapWith = visibleIds[visIdx + direction];
      if (!swapWith) return prev;
      const a = prev.indexOf(id), b = prev.indexOf(swapWith);
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      try { localStorage.setItem(favoritesStorageKey, JSON.stringify(next)); } catch (e) { /* ignore */ }
      return next;
    });
  };
  // Never filters/mutates the SAVED list based on current permissions —
  // only what's rendered. A saved favorite that's currently unauthorized
  // (or whose nav id was renamed/removed) simply doesn't appear here; if
  // permission is restored later it reappears on its own, and it's never
  // deleted from storage just for being temporarily hidden.
  const visibleFavorites = [...new Set(favorites)]
    .filter(id => navById[id] && navById[id].sidebar !== false && navAllowed(id))
    .map(id => navById[id]);

  // Canonicalize legacy/invalid admin URLs and make /admin/today the owner
  // landing route. `replace` keeps stale aliases out of browser Back history.
  useEffect(() => {
    if (routeInfo.isAdminPath && routeInfo.needsCanonicalRedirect) {
      navigate(routeInfo.canonicalPath, { replace: true });
      return;
    }
    // Normal admin login begins at the historical root URL. Move that one
    // landing case onto the durable Today URL, while preserving special
    // authenticated public routes such as /shop.
    if (!routeInfo.isAdminPath && location.pathname === "/") {
      navigate("/admin/today", { replace: true });
    }
  }, [location.pathname, navigate, routeInfo.canonicalPath, routeInfo.isAdminPath, routeInfo.needsCanonicalRedirect]);

  // If the current route becomes unauthorized (e.g. a live permissions
  // refresh downgrades this account), replace it with Today rather than
  // leaving a restricted screen mounted or making Back return to it.
  useEffect(() => {
    if (!navAllowed(tab)) navigateAdmin("today", null, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, can, featureOn]);

  // Sidebar group expand/collapse — persisted per staff user (namespaced by
  // user id, reusing the same localStorage-preference pattern already used
  // elsewhere in this file, e.g. sh_sidebar_collapsed) so switching accounts
  // on a shared front-desk device never leaks one user's layout into
  // another's, and each user's choice survives reloads.
  const sidebarGroupsStorageKey = `sh_sidebar_groups_${user?.id || "anon"}`;
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try {
      const saved = localStorage.getItem(sidebarGroupsStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return DEFAULT_COLLAPSED_GROUPS;
  });
  const toggleGroup = (label) => setCollapsedGroups(g => {
    const next = { ...g, [label]: !g[label] };
    try { localStorage.setItem(sidebarGroupsStorageKey, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  });

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
          <div className="relative px-1 pb-1">
            <div className="absolute inset-0 pointer-events-none opacity-45 blur-2xl"
                 style={{ background: "radial-gradient(circle at 35% 25%, rgba(140,198,63,0.30) 0%, rgba(0,169,224,0.18) 48%, transparent 76%)" }}/>
            <div className="relative flex items-center gap-3">
              <img src="/logo.png" alt="Sit Happens"
                   className="h-12 w-12 object-contain shrink-0 drop-shadow-[0_5px_14px_rgba(0,0,0,0.55)]"
                   data-testid={`${prefix}sidebar-logo`} />
              <div className="min-w-0 text-left">
                <p className="sh-shell-wordmark text-[22px] leading-[0.9]">Sit Happens</p>
                <p className="sh-shell-kicker mt-1">Dog Training · Daycare</p>
              </div>
            </div>
          </div>
        )}
        {collapsed && (
          <img src="/logo.png" alt="Sit Happens"
               className="h-9 mx-auto drop-shadow-[0_4px_12px_rgba(0,0,0,0.55)]"
               data-testid={`${prefix}sidebar-logo`} />
        )}
      </div>
      <nav className={`flex-grow space-y-3 overflow-y-auto ${collapsed ? "p-2" : "p-3"}`}>
        {!collapsed && visibleFavorites.length > 0 && (
          <div data-testid={`${prefix}nav-pinned-section`}>
            <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-shTextMuted/70">
              <i className="fas fa-thumbtack mr-1 text-[9px]"/>Pinned
            </p>
            <div className="space-y-0.5 mt-0.5">
              {visibleFavorites.map((n, idx) => {
                const active = sidebarActiveId === n.id;
                return (
                  <div key={n.id} className="group relative flex items-center gap-0.5">
                    <button onClick={() => handleNav(n.id)} data-testid={`${prefix}pinned-${n.id}`}
                            style={active ? {
                              background: "linear-gradient(90deg, rgba(140,198,63,0.14), rgba(140,198,63,0.02))",
                              borderLeft: "3px solid rgb(140,198,63)",
                              boxShadow: "0 0 18px -8px rgba(140,198,63,0.5)",
                            } : { borderLeft: "3px solid transparent" }}
                            className={`flex-1 min-w-0 text-left py-2 px-2.5 rounded-md text-[13px] font-semibold transition-all truncate ${active ? "text-shText" : "text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised"}`}>
                      <i className={`fas ${n.icon} mr-2.5 w-4 ${active ? "text-shPrimary" : "text-shTextMuted group-hover:text-shSecondary"}`} />
                      <span className="truncate">{n.label}</span>
                      {n.id === "messages" && messagesUnread > 0 && (
                        <span className="ml-2 inline-block bg-shAccent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle"
                              data-testid={`${prefix}pinned-messages-badge`}>{messagesUnread}</span>
                      )}
                      {n.id === "pos" && shopOrdersUnseen > 0 && (
                        <span className="ml-2 inline-block bg-shAccent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle"
                              data-testid={`${prefix}pinned-pos-badge`}>{shopOrdersUnseen}</span>
                      )}
                      {(n.id === "schedule" || n.id === "today") && pendingActions > 0 && (
                        <span className="ml-2 inline-block bg-shAccent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle"
                              data-testid={`${prefix}pinned-${n.id}-pending-badge`}>{pendingActions}</span>
                      )}
                    </button>
                    <div className="shrink-0 flex items-center">
                      <button onClick={(e) => { e.stopPropagation(); moveFavorite(n.id, -1); }}
                              disabled={idx === 0}
                              data-testid={`${prefix}pinned-up-${n.id}`}
                              aria-label={`Move ${n.label} up in Pinned`}
                              title="Move up"
                              className="w-8 h-8 flex items-center justify-center text-shTextMuted/50 hover:text-shPrimary disabled:opacity-20 disabled:hover:text-shTextMuted/50 transition">
                        <i className="fas fa-chevron-up text-[10px]"/>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); moveFavorite(n.id, 1); }}
                              disabled={idx === visibleFavorites.length - 1}
                              data-testid={`${prefix}pinned-down-${n.id}`}
                              aria-label={`Move ${n.label} down in Pinned`}
                              title="Move down"
                              className="w-8 h-8 flex items-center justify-center text-shTextMuted/50 hover:text-shPrimary disabled:opacity-20 disabled:hover:text-shTextMuted/50 transition">
                        <i className="fas fa-chevron-down text-[10px]"/>
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); togglePin(n.id); }}
                              data-testid={`${prefix}pinned-unpin-${n.id}`}
                              aria-label={`Unpin ${n.label}`}
                              title="Unpin"
                              className="w-8 h-8 flex items-center justify-center text-shPrimary hover:text-shDanger transition">
                        <i className="fas fa-thumbtack text-[11px]"/>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
                    const active = sidebarActiveId === n.id;
                    const pinned = isPinned(n.id);
                    return (
                      <div key={n.id} className="group relative flex items-center gap-0.5">
                        <button onClick={() => handleNav(n.id)} data-testid={`${prefix}nav-${n.id}`}
                                title={collapsed ? n.label : undefined}
                                style={active ? {
                                  background: "linear-gradient(90deg, rgba(140,198,63,0.14), rgba(140,198,63,0.02))",
                                  borderLeft: "3px solid rgb(140,198,63)",
                                  boxShadow: "0 0 18px -8px rgba(140,198,63,0.5)",
                                } : { borderLeft: "3px solid transparent" }}
                                className={`relative flex-1 min-w-0 ${collapsed ? "text-center py-2.5 px-0" : "text-left py-2 px-2.5"} rounded-md text-[13px] font-semibold transition-all ${active ? "text-shText" : "text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised"}`}>
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
                          {n.id === "pipeline" && schoolAttention > 0 && (
                            <span className={`${collapsed ? "absolute top-0 right-0 -mt-1 -mr-1" : "ml-2"} inline-block bg-shAccent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle`}
                                  data-testid={`${prefix}nav-training-badge`}>{collapsed ? "•" : schoolAttention}</span>
                          )}
                          {(n.id === "schedule" || n.id === "today") && pendingActions > 0 && (
                            <span className={`${collapsed ? "absolute top-0 right-0 -mt-1 -mr-1" : "ml-2"} inline-block bg-shAccent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle`}
                                  data-testid={`${prefix}nav-${n.id}-pending-badge`}>{collapsed ? "•" : pendingActions}</span>
                          )}
                        </button>
                        {!collapsed && (
                          <button onClick={(e) => { e.stopPropagation(); togglePin(n.id); }}
                                  data-testid={`${prefix}pin-toggle-${n.id}`}
                                  aria-label={pinned ? `Unpin ${n.label}` : `Pin ${n.label}`}
                                  title={pinned ? "Unpin" : "Pin"}
                                  className={`shrink-0 w-8 h-8 rounded flex items-center justify-center transition ${pinned ? "text-shPrimary" : "text-shTextMuted/40 hover:text-shPrimary"}`}>
                            <i className={`fas fa-thumbtack text-[11px] ${pinned ? "" : "rotate-45"}`}/>
                          </button>
                        )}
                      </div>
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
        <header className="relative shrink-0 border-b border-shBorder h-[68px] flex items-center justify-between px-4 md:px-7 gap-3 overflow-hidden"
                style={{ background: "rgba(7,8,13,0.95)", backdropFilter: "blur(8px)" }}>
          <div className="absolute inset-0 pointer-events-none opacity-20"
               style={{ background: "radial-gradient(circle at 0% 50%, rgba(0,169,224,0.3) 0%, transparent 40%), radial-gradient(circle at 100% 50%, rgba(140,198,63,0.22) 0%, transparent 45%)" }}/>
          <div className="relative flex items-center gap-3 min-w-0">
            <button onClick={()=>setDrawerOpen(true)} data-testid="drawer-toggle"
                    className="md:hidden text-shText hover:text-shPrimary p-2 -ml-2 text-lg transition">
              <i className="fas fa-bars" />
            </button>
            <div className="md:hidden min-w-0">
              <p className="sh-shell-wordmark text-[16px] leading-none">Sit Happens</p>
              <p className="sh-shell-page-title truncate mt-0.5" data-testid="header-title">{currentNavLabel}</p>
            </div>
            <div className="hidden md:block min-w-0">
              <p className="sh-shell-kicker">Sit Happens · Workspace</p>
              <h2 className="sh-shell-page-title truncate mt-0.5" data-testid="header-title">{currentNavLabel}</h2>
            </div>
          </div>
          <div className="relative hidden md:flex items-center gap-2">
            <ActionMenu groups={visibleActionGroups} disabled={newMenuBlocked}
                        disabledReason="Close the current dialog first."
                        buttonTestId="header-new-action-button"
                        buttonClassName="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-shPrimary text-bgHeader font-black uppercase tracking-widest text-[12px] hover:brightness-110 transition" />
            <button onClick={()=>setSearchOpen(true)} data-testid="open-search"
                    className="relative flex items-center gap-2 border border-shBorder rounded-lg px-3 py-1.5 text-xs text-shTextMuted hover:border-shPrimary/40 hover:text-shText transition"
                    style={{ background: "var(--sh-card-base)" }}>
              <i className="fas fa-search text-[14px]" />
              <span>Search clients, dogs…</span>
              <kbd className="text-[12px] font-bold border border-shBorder rounded px-1.5 py-0.5" style={{ background: "rgba(255,255,255,0.04)" }}>⌘K</kbd>
            </button>
          </div>
          <div className="relative flex items-center gap-1 md:hidden">
            <ActionMenu groups={visibleActionGroups} disabled={newMenuBlocked}
                        disabledReason="Close the current dialog first."
                        buttonTestId="mobile-header-new-action-button"
                        buttonClassName="text-shTextMuted hover:text-shPrimary p-2 transition" label="" />
            <button onClick={()=>setSearchOpen(true)} className="relative text-shTextMuted p-2 hover:text-shPrimary transition"><i className="fas fa-search" /></button>
          </div>
        </header>
        <div className="app-scroll-root flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-7 relative" data-scroll-root>
          {["today", "dashboard"].includes(tab) && navAllowed("today") && <Today
            onNavigate={(t)=>setTab(t)}
            onJumpToDog={(id)=>navigateAdmin("dogs", {kind:"dog", id, mode:"open"})}
            onJumpToClient={(id)=>navigateAdmin("clients", {kind:"client", id, mode:"open"})}
            onOpenSearch={()=>setSearchOpen(true)}
            can={can}
            actionGroups={visibleActionGroups}
            newMenuBlocked={newMenuBlocked}
            refreshSignal={todayRefreshSignal}
            userId={user?.id}
            onOpenRecent={navigateTo}
            messagesUnread={messagesUnread}
          />}
          {tab === "action_center" && navAllowed("action_center") && <ActionCenter
            onNavigate={(t)=>setTab(t)}
            onJumpToDog={(id)=>navigateAdmin("dogs", {kind:"dog", id, mode:"open"})}
            onJumpToClient={(id)=>navigateAdmin("clients", {kind:"client", id, mode:"open"})}
          />}
          {["schedule", "bookings", "waitlist", "recurring"].includes(tab) && navAllowed(tab) && (
            <ScheduleWorkspace initialSection={tab} can={can} featureOn={featureOn}
              onSectionChange={(section)=>navigateAdmin(SCHEDULE_TAB_BY_SECTION[section] || "schedule")} />
          )}
          {tab === "runsheet" && navAllowed("runsheet") && <RunSheet />}
          {tab === "care" && navAllowed("care") && <CareBoard />}
          {tab === "kennel" && navAllowed("kennel") && <KennelBoard />}
          {tab === "clients" && navAllowed("clients") && <Clients focusId={searchTarget?.kind==="client"?searchTarget.id:null} focusMode={searchTarget?.mode || "scroll"}
            hubTarget={["booking","invoice","messages"].includes(searchTarget?.kind) ? searchTarget : null}
            onConsumed={clearSearchTarget} onJumpToDog={(id)=>navigateAdmin("dogs", {kind:"dog", id, mode:"open"})}
            onAddDog={()=>goCreate("dogs")}
            onBookForClient={(clientId)=>{ setPendingBookingPreset({ clientId, dogId: null }); setGlobalModal("new_booking"); }}
            openCreateOnMount={pendingCreateTab === "clients"} onCreateConsumed={()=>setPendingCreateTab(null)} userId={user?.id} can={can} />}
          {tab === "dogs" && navAllowed("dogs") && <Dogs focusId={searchTarget?.kind==="dog"?searchTarget.id:null} focusMode={searchTarget?.mode || "scroll"} onConsumed={clearSearchTarget} openCreateOnMount={pendingCreateTab === "dogs"} onCreateConsumed={()=>setPendingCreateTab(null)} userId={user?.id}
            can={can}
            onBookForDog={(dogId, ownerId)=>{ setPendingBookingPreset({ clientId: ownerId || null, dogId }); setGlobalModal("new_booking"); }}
            onLogIncident={(dogId)=>{ setPendingIncidentPresetDogId(dogId); setPendingCreateTab("incidents"); setTab("incidents"); }}
            onOpenCareBoard={()=>setTab("care")}
            onOpenKennelBoard={()=>setTab("kennel")}
            onOpenFrontDesk={()=>setTab("pos")}
            onMessageOwner={(dog)=>navigateAdmin("clients", { kind: "messages", clientId: dog.owner_id, id: null })}
          />}
          {tab === "duplicate_check" && navAllowed("duplicate_check") && <DuplicateCheck />}
          {["pipeline", "school_hq", "homework", "rewards_center", "trophies"].includes(tab) && navAllowed(tab) && (
            <TrainingWorkspace
              initialSection={tab}
              can={can}
              featureOn={featureOn}
              onSectionChange={(section)=>navigateAdmin(TRAINING_TAB_BY_SECTION[section] || "pipeline")}
              onJumpToDog={(id)=>navigateAdmin("dogs", {kind:"dog", id, mode:"open"})}
            />
          )}
          {/* The old standalone Register screen is gone — Front Desk now owns
              all of that functionality. Redirect any stale nav call
              (bookmarked sidebar state, old localStorage flag, etc.) that
              still targets "register" here instead of rendering nothing. */}
          {(tab === "pos" || tab === "register") && navAllowed("pos") && <Pos onOpenShopManager={() => setTab("shop_manager")} />}
          {tab === "income" && navAllowed("income") && <Income openCreateExpenseOnMount={pendingCreateTab === "income"} onCreateConsumed={()=>setPendingCreateTab(null)} />}
          {tab === "credit_reconciliation" && navAllowed("credit_reconciliation") && <CreditReconciliation />}
          {tab === "shop_manager" && navAllowed("shop_manager") && <ShopManager openCreateOnMount={pendingCreateTab === "shop_manager"} onCreateConsumed={()=>setPendingCreateTab(null)} />}
          {/* Old "shop_organization" tab id redirects here rather than showing a broken/blank screen. */}
          {tab === "shop_organization" && navAllowed("shop_manager") && <ShopManager openCreateOnMount={false} onCreateConsumed={()=>{}} />}
          {tab === "staff" && navAllowed("staff") && <Staff />}
          {tab === "incidents" && navAllowed("incidents") && <Incidents openCreateOnMount={pendingCreateTab === "incidents"} onCreateConsumed={()=>{ setPendingCreateTab(null); setPendingIncidentPresetDogId(null); }} presetDogId={pendingIncidentPresetDogId} />}
          {tab === "intake" && navAllowed("intake") && <IntakeForms />}
          {tab === "messages" && navAllowed("messages") && <ClientMessages />}
          {tab === "announcements" && navAllowed("announcements") && <Announcements openCreateOnMount={pendingCreateTab === "announcements"} onCreateConsumed={()=>setPendingCreateTab(null)} />}
          {tab === "bulkemail" && navAllowed("bulkemail") && <BulkEmail />}
          {tab === "audit" && navAllowed("audit") && <AuditLog />}
          {tab === "settings" && navAllowed("settings") && <Settings
            initialSection={searchTarget?.kind === "settings" ? searchTarget.section : "__overview__ops"}
            onSectionChange={(section)=>navigateAdmin("settings", { kind: "settings", section })}
          />}
          {tab === "tutorials" && navAllowed("tutorials") && <Tutorials role="admin" />}
        </div>
      </main>
      <GlobalSearch open={searchOpen} onClose={()=>setSearchOpen(false)} onNavigate={navigateTo} onAction={onSearchAction} userId={user?.id} can={can} />

      {/* Phase 4 — the three "+ New" actions that are standalone, already-
          reusable modals get mounted here so they work from anywhere in the
          admin app without navigating away or duplicating their form. Only
          one can be open at a time (`globalModal` is a single value), and
          the launcher itself refuses to open a second one on top. */}
      {globalModal === "new_booking" && (
        <AdminBookingModal onClose={()=>{ setGlobalModal(null); setPendingBookingPreset(null); }}
                           presetClientId={pendingBookingPreset?.clientId || null}
                           presetDogId={pendingBookingPreset?.dogId || null}
                           onCreated={()=>{ setGlobalModal(null); setPendingBookingPreset(null); setTodayRefreshSignal((n)=>n+1); }} />
      )}
      {globalModal === "take_payment" && (
        <TakePaymentModal onClose={()=>{ setGlobalModal(null); setPendingPaymentPresetClientId(null); }}
                           presetClientId={pendingPaymentPresetClientId}
                           onSuccess={()=>{ setGlobalModal(null); setPendingPaymentPresetClientId(null); }} />
      )}
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

// Public no-account storefront — /shop and /shop/item/:kind/:id resolve
// through AuthProvider's OWN token-validation loadMe() (GET /auth/me,
// clearing sh_token on failure — see lib/auth.js) rather than a second,
// parallel validation implementation. `user === false` (loadMe ran and
// found no valid session, whether because there never was a token or
// because a stale/expired one just got cleared) falls back to the guest
// storefront at the SAME URL; every other outcome renders the exact same
// Gate() the rest of the app uses, so an authenticated visitor on /shop
// gets the real client Shop (via Portal.jsx's widened shopOpen match),
// an admin/employee gets their normal shell, exactly as if they had
// navigated here from inside the app.
function ShopGate() {
  const { user } = useAuth();
  if (user === null) {
    return <div className="h-screen w-screen flex items-center justify-center text-shTextMuted text-sm font-bold uppercase tracking-widest" style={{ background: "var(--sh-card-base)" }}>Loading…</div>;
  }
  if (!user) return <PublicShop />;
  return <Gate />;
}

// Flat nav registry — module scope so tests can assert the REAL permission
// gating data (e.g. Finance ⇒ finance_reports) without rendering the app.
// Moved verbatim out of App() during the Front Desk navigation-regression
// fix; contents unchanged.
// The single gating rule for a nav item: permission first, then feature
// visibility. Exported so tests exercise the REAL rule with the REAL data.
export const navItemAllowed = (item, can, featureOn = () => true) => {
  if (!item) return true;
  if (item.perm && !can(item.perm)) return false;
  if (item.feature && !featureOn(item.feature)) return false;
  return true;
};

export const WORKSPACE_ROOT_BY_TAB = {
  dashboard: "today",
  bookings: "schedule",
  waitlist: "schedule",
  recurring: "schedule",
  school_hq: "pipeline",
  homework: "pipeline",
  rewards_center: "pipeline",
  trophies: "pipeline",
};

export const workspaceRootForTab = (id) => WORKSPACE_ROOT_BY_TAB[id] || id;

export const NAV_ITEMS = [
  { id: "today", label: "Today", icon: "fa-sun" },
    { id: "dashboard", label: "Dashboard", icon: "fa-chart-line", sidebar: false },
    { id: "pos", label: "Front Desk", icon: "fa-cash-register", perm: "take_payments" },
    { id: "action_center", label: "Action Center", icon: "fa-list-check" },
    { id: "schedule", label: "Schedule", icon: "fa-calendar-alt" },
    { id: "runsheet", label: "Run Sheet", icon: "fa-clipboard-list" },
    { id: "care", label: "Care Board", icon: "fa-bowl-food", perm: "care_complete" },
    { id: "kennel", label: "Kennel Board", icon: "fa-paw", perm: "dogs_view" },
    { id: "bookings", label: "Bookings", icon: "fa-calendar-check", sidebar: false },
    { id: "waitlist", label: "Waitlist", icon: "fa-hourglass-half", perm: "booking_edit", feature: "waitlist", sidebar: false },
    { id: "recurring", label: "Recurring", icon: "fa-rotate", sidebar: false },
    { id: "clients", label: "Clients", icon: "fa-users", perm: "clients_view" },
    { id: "dogs", label: "Dogs", icon: "fa-paw", perm: "dogs_view" },
    { id: "duplicate_check", label: "Duplicate Check", icon: "fa-copy", perm: "settings" },
    { id: "pipeline", label: "Training", icon: "fa-graduation-cap" },
    { id: "school_hq", label: "School HQ", icon: "fa-school", perm: "manage_school", sidebar: false },
    { id: "rewards_center", label: "Rewards", icon: "fa-gift", feature: "rewards", sidebar: false },
    { id: "trophies", label: "Trophies", icon: "fa-trophy", feature: "rewards", sidebar: false },
    { id: "income", label: "Finance", icon: "fa-dollar-sign", perm: "finance_reports" },
    { id: "credit_reconciliation", label: "Credit Audit", icon: "fa-scale-balanced", perm: "finance_reports" },
    { id: "shop_manager", label: "Shop Manager", icon: "fa-bag-shopping", perm: "view_shop_categories" },
    { id: "staff", label: "Staff", icon: "fa-users-gear", perm: "payroll", feature: "staff_portal" },
    { id: "incidents", label: "Incidents", icon: "fa-triangle-exclamation", perm: "incidents" },
    { id: "intake", label: "Intake Forms", icon: "fa-clipboard-list", perm: "clients_edit" },
    { id: "messages", label: "Client Messages", icon: "fa-comments", perm: "messages", feature: "client_messaging" },
    { id: "announcements", label: "Announcements", icon: "fa-bullhorn", perm: "manage_communications" },
    { id: "bulkemail", label: "Bulk Email", icon: "fa-paper-plane", perm: "manage_communications" },
    { id: "audit", label: "Audit Log", icon: "fa-list-check", perm: "audit_log" },
    { id: "settings", label: "Settings", icon: "fa-cog", perm: "settings" },
    { id: "tutorials", label: "How to Use", icon: "fa-circle-question" },
];

function ClaimRoute() {
  const { token = "" } = useParams();
  return <Claim token={token} />;
}

function CertificateShareRoute() {
  const { token = "" } = useParams();
  return <ShareCertificate token={token} />;
}

function AppProviders({ children }) {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ThemeProvider>
          <ConfirmProvider>
            <ImpersonationBanner />
            {children}
            <InstallPrompt />
            <BrandFooter />
            <Toaster theme="dark" position="top-right" richColors closeButton expand />
          </ConfirmProvider>
        </ThemeProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default function App() {
  // Phase 2 modernization: React Router now owns browser history. Public
  // routes keep their existing behavior while all authenticated admin URLs
  // are interpreted by AdminShell through the same router context.
  return (
    <Routes>
      <Route path="/claim/:token" element={<ErrorBoundary><ClaimRoute /></ErrorBoundary>} />
      <Route path="/share/cert/:token" element={<ErrorBoundary><CertificateShareRoute /></ErrorBoundary>} />
      <Route path="/shop/*" element={<AppProviders><ShopGate /></AppProviders>} />
      <Route path="/admin/*" element={<AppProviders><Gate /></AppProviders>} />
      <Route path="*" element={<AppProviders><Gate /></AppProviders>} />
    </Routes>
  );
}
