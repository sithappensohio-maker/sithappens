import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import AdminStatCard from "../components/admin/AdminStatCard";
import PageHero from "../components/PageHero";
import ActionRow from "../components/admin/ActionRow";
import ActionMenu from "../components/admin/ActionMenu";
import { runTodayBrainCTA } from "../lib/todayBrain";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import Dashboard from "./Dashboard";
import { visibleRecents } from "../lib/recentlyOpened";

const RECENT_ICON = {
  client: "fa-user", dog: "fa-paw", booking: "fa-calendar-check",
  invoice: "fa-file-invoice-dollar", payment: "fa-money-bill-wave",
  shop_order: "fa-box", prepaid_purchase: "fa-ticket",
};

/* Admin IA overhaul — Phase 1: the new "Today" workspace. Reuses existing
 * data sources wholesale (no new business logic, no new calculations):
 *   - GET /dashboard/stats      -> today_roster (dogs here/arriving/leaving,
 *                                   today's flow, today's unpaid balances)
 *   - GET /admin/today-brain    -> the exact same prioritized feed Action
 *                                   Center already shows ("Do This Now")
 *   - GET /admin/register/day   -> register status + money received today
 *   - GET /admin/messages/unread-count -> unread badge, same as the sidebar
 *
 * Dashboard and Action Center are NOT touched or replaced — both remain
 * fully reachable, and the existing Dashboard is embedded verbatim (not
 * reimplemented) under "More Dashboard Information" below.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function fmtClock(t) {
  if (!t) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return String(t);
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

const SERVICE_LABEL = {
  daycare: "Daycare", boarding: "Boarding", training: "Training",
  grooming: "Grooming", photography: "Photography",
};

export default function Today({ onNavigate = () => {}, onJumpToDog = () => {}, onJumpToClient = () => {}, onOpenSearch = () => {}, can = () => false, actionGroups = [], newMenuBlocked = false, refreshSignal = 0, userId = null, onOpenRecent = () => {} }) {
  const [recents, setRecents] = useState(() => visibleRecents(userId, can));
  useEffect(() => { setRecents(visibleRecents(userId, can)); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [stats, setStats] = useState(null);
  const [brain, setBrain] = useState(null);
  const [registerDay, setRegisterDay] = useState(null);
  const [messagesUnread, setMessagesUnread] = useState(0);
  const [trainingToday, setTrainingToday] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [brainBusy, setBrainBusy] = useState(false);

  const load = async () => {
    try {
      const [s, tb, reg, mu, tr] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/admin/today-brain").catch(() => ({ data: null })),
        can("finance_reports") ? api.get("/admin/register/day").catch(() => ({ data: null })) : Promise.resolve({ data: null }),
        api.get("/admin/messages/unread-count").catch(() => ({ data: { unread: 0 } })),
        can("manage_training_sessions") ? api.get("/admin/training/today").catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      setStats(s.data);
      setBrain(tb.data);
      setRegisterDay(reg.data);
      setMessagesUnread(mu.data?.unread || 0);
      setTrainingToday(tr.data || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLiveRefresh(load, { intervalMs: 30_000 });
  // The global "+ New" launcher's booking modal lives outside this screen
  // (mounted in App.js so it works from anywhere), so it can't call our
  // `load` directly the way the old screen-local modal did. App.js bumps
  // `refreshSignal` on every successful creation instead; skip the initial
  // mount since the effect above already loads once.
  const [didMountRefresh, setDidMountRefresh] = useState(false);
  useEffect(() => {
    if (!didMountRefresh) { setDidMountRefresh(true); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const today = new Date().toISOString().slice(0, 10);
  const roster = useMemo(() => stats?.today_roster || [], [stats]);

  const dogsHere = useMemo(() => roster.filter((b) => b.checked_in_at && !b.checked_out_at).length, [roster]);
  const arrivingToday = useMemo(() => roster.filter((b) => !b.checked_in_at && b.date === today).length, [roster, today]);
  const leavingToday = useMemo(() => roster.filter((b) => !b.checked_out_at && (b.end_date || b.date) === today).length, [roster, today]);
  const amountDueToday = useMemo(
    () => roster.reduce((sum, b) => sum + (Number(b.balance_due) > 0 ? Number(b.balance_due) : 0), 0),
    [roster],
  );

  const pendingApprovals = useMemo(() => {
    const item = (brain?.items || []).find((i) => i.kind === "booking_pending");
    if (!item) return 0;
    const m = /booking-pending:(\d+)/.exec(item.id || "");
    return m ? parseInt(m[1], 10) : 0;
  }, [brain]);

  const registerOpen = !!registerDay?.drawer_session && !registerDay?.register_closed;
  const incomingTotal = Number(registerDay?.totals?.incoming_total || 0);
  const cashIn = Number(registerDay?.totals?.cash_in || 0);
  const cardOrOnline = Math.max(0, incomingTotal - cashIn);
  const expectedCash = Number(registerDay?.totals?.expected_cash || 0);

  const flow = useMemo(() => {
    const rows = [];
    for (const b of roster) {
      const dogName = b.dog?.name || b.dog_name || "Dog";
      const svc = SERVICE_LABEL[b.service_type] || b.service_type;
      if (!b.checked_in_at && b.date === today) {
        rows.push({
          id: `${b.id}-arrive`, time: b.dropoff_time || "", sortTime: b.dropoff_time || "99:99",
          label: `${dogName} arriving for ${svc}`, booking: b,
        });
      }
      if (!b.checked_out_at && (b.end_date || b.date) === today) {
        rows.push({
          id: `${b.id}-leave`, time: b.pickup_time || "", sortTime: b.pickup_time || "99:98",
          label: b.service_type === "boarding" ? `${dogName} boarding pickup` : `${dogName} pickup`, booking: b,
        });
      }
    }
    return rows.sort((a, b) => a.sortTime.localeCompare(b.sortTime)).slice(0, 12);
  }, [roster, today]);

  const doThisNowItems = (brain?.items || []).slice(0, 6);

  const dismissBrainItem = async (item) => {
    setBrainBusy(true);
    try {
      await api.post("/admin/today-brain/dismiss", { item_id: item.id, signature: item.signature || "" });
      await load();
    } finally {
      setBrainBusy(false);
    }
  };

  if (loading && !stats) {
    return <div className="p-6 text-shTextMuted text-sm">Loading Today…</div>;
  }

  return (
    <div className="space-y-5 animate-slide-in" data-testid="today-screen">
      {/* 1. Daily workspace hero + primary actions */}
      <PageHero
        compact
        testid="today-page-hero"
        eyebrow={{ icon: "fa-sun", text: "Today at Sit Happens", color: "text-shPrimary" }}
        title="Today."
        highlight="Your day at a glance."
        subtitle={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        right={(
          <div className="flex flex-wrap items-center gap-2" data-testid="today-top-actions">
            <ActionMenu groups={actionGroups} disabled={newMenuBlocked}
                        disabledReason="Close the current dialog first."
                        buttonTestId="today-new-action-button" />
            <button onClick={onOpenSearch} data-testid="today-open-search"
                    className="min-h-[44px] px-4 py-2.5 rounded-xl border border-shBorder bg-[var(--sh-card-base)] text-shText font-bold text-[13px] hover:border-shPrimary/40 transition">
              <i className="fas fa-search mr-2 text-shTextMuted"/>Search
            </button>
          </div>
        )}
      />

      {/* 1b. Recently Opened — compact horizontal strip, only when non-empty */}
      {recents.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1" data-testid="today-recently-opened">
          <span className="text-[11px] font-black uppercase tracking-widest text-shTextMuted/70 shrink-0">Recently Opened</span>
          {recents.slice(0, 8).map((r) => (
            <button key={`${r.kind}-${r.id}`} onClick={() => onOpenRecent({ kind: r.kind, id: r.id, client_id: r.clientId, title: r.title, subtitle: r.subtitle })}
                    data-testid={`today-recent-${r.kind}-${r.id}`}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-shBorder bg-[var(--sh-card-base)] text-shText text-[12px] font-bold hover:border-shPrimary/40 transition whitespace-nowrap">
              <i className={`fas ${RECENT_ICON[r.kind] || "fa-clock-rotate-left"} text-shTextMuted`}/>{r.title}
            </button>
          ))}
        </div>
      )}

      {/* 2. Daily snapshot */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="today-snapshot">
        <AdminStatCard icon="fa-paw" value={dogsHere} label="Dogs Here" accent="lime" testid="today-stat-dogs-here"
                       onClick={() => onNavigate("kennel")}/>
        <AdminStatCard icon="fa-right-to-bracket" value={arrivingToday} label="Arriving" accent="cyan" testid="today-stat-arriving"
                       onClick={() => onNavigate("runsheet")}/>
        <AdminStatCard icon="fa-right-from-bracket" value={leavingToday} label="Leaving" accent="orange" testid="today-stat-leaving"
                       onClick={() => onNavigate("runsheet")}/>
        {can("finance_reports") && (
          <AdminStatCard icon="fa-file-invoice-dollar" value={money(amountDueToday)} label="Amount Due" accent="amber" testid="today-stat-amount-due"
                         onClick={() => onNavigate("income")}/>
        )}
        {pendingApprovals > 0 && (
          <AdminStatCard icon="fa-hourglass-half" value={pendingApprovals} label="Approvals" accent="orange" testid="today-stat-pending-approvals"
                         onClick={() => onNavigate("bookings")}/>
        )}
        {messagesUnread > 0 && (
          <AdminStatCard icon="fa-comments" value={messagesUnread} label="Unread" accent="cyan" testid="today-stat-unread"
                         onClick={() => onNavigate("messages")}/>
        )}
        {can("finance_reports") && registerDay && (
          <AdminStatCard icon="fa-cash-register" value={registerOpen ? "Open" : "Closed"} label="Register" accent={registerOpen ? "lime" : "orange"}
                         testid="today-stat-register" onClick={() => onNavigate("pos")}/>
        )}
      </div>

      {/* 3. Do This Now */}
      <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="today-do-this-now">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-[15px] font-black uppercase italic tracking-tight text-shText">
            <i className="fas fa-list-check text-shPrimary mr-2"/>Do This Now
          </h2>
          <button onClick={() => onNavigate("action_center")} data-testid="today-view-all-actions"
                  className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline">
            View All Actions <i className="fas fa-arrow-right ml-1"/>
          </button>
        </div>
        {doThisNowItems.length === 0 ? (
          <div className="rounded-xl border border-shPrimary/30 bg-shPrimary/5 p-6 text-center" data-testid="today-do-this-now-empty">
            <p className="text-shPrimary font-black uppercase italic"><i className="fas fa-check-circle mr-2"/>All clear</p>
            <p className="text-shTextMuted text-[13px] mt-1">Nothing needs attention right now.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5">
            {doThisNowItems.map((item) => (
              <ActionRow key={item.id} item={item} busy={brainBusy}
                         onOpen={() => runTodayBrainCTA(item, { onJumpToDog, onJumpToClient, onNavigate })}
                         onDismiss={() => dismissBrainItem(item)}/>
            ))}
          </div>
        )}
      </div>

      {/* 4. Today's Training Plan — read-only command center. Assignment
          and session work stay in the Training Hub so there is still one
          authoritative workflow, not a second editor on Today. */}
      {can("manage_training_sessions") && (
        <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="today-training-plan">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-[15px] font-black uppercase italic tracking-tight text-shText">
                <i className="fas fa-graduation-cap text-shPrimary mr-2"/>Today&apos;s Training Plan
              </h2>
              <p className="text-[11px] text-shTextMuted mt-1">Who is training each dog and exactly where that dog is in the curriculum.</p>
            </div>
            <button onClick={() => onNavigate("pipeline")} data-testid="today-open-training-hub"
                    className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline whitespace-nowrap">
              Open Training Hub <i className="fas fa-arrow-right ml-1"/>
            </button>
          </div>
          {trainingToday.length === 0 ? (
            <p className="text-shTextMuted text-[13px] text-center py-4" data-testid="today-training-plan-empty">No training dogs scheduled today.</p>
          ) : (
            <div className="space-y-2">
              {trainingToday.map((r) => (
                <button key={r.booking_id} onClick={() => onNavigate("pipeline")}
                        className="w-full text-left rounded-xl border border-shBorder bg-black/10 px-3 py-2.5 hover:border-shPrimary/35 transition"
                        data-testid={`today-training-plan-${r.booking_id}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[13px] font-black text-shText">{r.dog_name || "Dog"}</span>
                    <span className="text-[11px] text-shTextMuted">{r.residential_training ? "Residential" : (fmtClock(r.time) || "—")}</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${r.assigned_trainer ? "text-shSecondary" : "text-shAccent"}`}>
                      <i className={`fas ${r.assigned_trainer ? "fa-user" : "fa-user-slash"} mr-1`}/>{r.assigned_trainer || "Unassigned"}
                    </span>
                    <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-shTextMuted">{(r.session_status || "not_checked_in").replace(/_/g, " ")}</span>
                  </div>
                  <p className="text-[12px] text-shTextMuted mt-1 truncate">
                    {[r.program_name, r.current_module_name, r.current_lesson_name].filter(Boolean).join(" · ") || "Training program needs attention"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. Today's Flow */}
      <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="today-flow">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-[15px] font-black uppercase italic tracking-tight text-shText">
            <i className="fas fa-clock text-shSecondary mr-2"/>Today's Flow
          </h2>
          <button onClick={() => onNavigate("schedule")} data-testid="today-view-full-schedule"
                  className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline">
            Full Schedule <i className="fas fa-arrow-right ml-1"/>
          </button>
        </div>
        {flow.length === 0 ? (
          <p className="text-shTextMuted text-[13px] text-center py-4" data-testid="today-flow-empty">Nothing scheduled to arrive or leave today.</p>
        ) : (
          <div className="divide-y divide-shBorder">
            {flow.map((row) => (
              <button key={row.id} onClick={() => onJumpToDog(row.booking.dog_id)} data-testid={`today-flow-${row.id}`}
                      className="w-full text-left py-2.5 flex items-center gap-3 hover:bg-shSurfaceRaised/40 transition rounded px-1.5 -mx-1.5">
                <span className="text-[12px] font-black text-shTextMuted w-20 shrink-0 tabular-nums">{fmtClock(row.time) || "—"}</span>
                <span className="text-[14px] text-shText flex-1 min-w-0 truncate">{row.label}</span>
                <i className="fas fa-chevron-right text-shTextMuted text-xs"/>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 6. Business snapshot */}
      {can("finance_reports") && registerDay && (
        <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="today-business-snapshot">
          <h2 className="text-[15px] font-black uppercase italic tracking-tight text-shText mb-3">
            <i className="fas fa-chart-simple text-shPrimary mr-2"/>Business Snapshot
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SnapshotFigure label="Received Today" value={money(incomingTotal)}/>
            <SnapshotFigure label="Cash Received" value={money(cashIn)}/>
            <SnapshotFigure label="Card / Online" value={money(cardOrOnline)}/>
            <SnapshotFigure label="Expected Drawer" value={money(expectedCash)}/>
          </div>
          <div className="flex flex-wrap gap-4 mt-3 text-[13px] text-shTextMuted">
            <span>Register: <span className={`font-black ${registerOpen ? "text-shPrimary" : "text-shAccent"}`}>{registerOpen ? "Open" : "Closed"}</span></span>
            <span>Dogs Checked In: <span className="font-black text-shText">{dogsHere}</span></span>
          </div>
          <button onClick={() => onNavigate("income")} data-testid="today-open-finance"
                  className="mt-3 text-[11px] font-black uppercase tracking-widest text-shSecondary hover:underline">
            Open Finance <i className="fas fa-arrow-right ml-1"/>
          </button>
        </div>
      )}

      {/* 7. More Dashboard Information — collapsed by default, embeds the
          EXISTING Dashboard screen wholesale (unchanged) so nothing is
          removed, duplicated, or reimplemented. */}
      <div className="rounded-2xl border border-shBorder overflow-hidden" data-testid="today-more-dashboard-wrap">
        <button type="button" onClick={() => setMoreOpen((v) => !v)} data-testid="today-more-dashboard-toggle"
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 bg-[var(--sh-card-base)] hover:bg-shSurfaceRaised/40 transition">
          <span className="text-[14px] font-bold text-shText">
            <i className="fas fa-chart-line text-shTextMuted mr-2"/>More Dashboard Information
          </span>
          <i className={`fas fa-chevron-down text-shTextMuted transition-transform ${moreOpen ? "rotate-180" : ""}`}/>
        </button>
        {moreOpen && (
          <div className="p-4 sm:p-5 border-t border-shBorder" data-testid="today-more-dashboard-body">
            <Dashboard onNavigate={onNavigate} onJumpToDog={onJumpToDog} onJumpToClient={onJumpToClient} can={can}/>
          </div>
        )}
      </div>
    </div>
  );
}

function SnapshotFigure({ label, value }) {
  return (
    <div className="rounded-xl border border-shBorder bg-bgBase/40 p-3" data-testid={`today-snapshot-figure-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <p className="text-lg sm:text-xl font-black text-shText">{value}</p>
      <p className="text-[11px] font-bold uppercase tracking-widest text-shTextMuted mt-0.5">{label}</p>
    </div>
  );
}
