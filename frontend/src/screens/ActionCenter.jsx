import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import ActionRow, { ACTION_PRIORITY_META as META } from "../components/admin/ActionRow";
import { runTodayBrainCTA } from "../lib/todayBrain";

export default function ActionCenter({ onNavigate = () => {}, onJumpToDog = () => {}, onJumpToClient = () => {} }) {
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/admin/today-brain");
      setData(data);
      setErr("");
    } catch (e) {
      setErr(e.response?.data?.detail || "Failed to load Action Center");
    }
  };
  useEffect(() => { load(); }, []);

  const items = useMemo(() => data?.items || [], [data]);
  const counts = data?.counts || { urgent: 0, warn: 0, info: 0, total: 0 };
  const filtered = useMemo(() => filter === "all" ? items : items.filter((it) => it.priority === filter), [items, filter]);

  const dismiss = async (item) => {
    setBusy(true);
    try {
      await api.post("/admin/today-brain/dismiss", { item_id: item.id, signature: item.signature || "" });
      await load();
    } finally { setBusy(false); }
  };

  const clearAll = async () => {
    if (!(await confirm({ title: "Hide every current item?", body: "Anything that changes will come back automatically.", confirmText: "Hide all", tone: "warning" }))) return;
    setBusy(true);
    try { await api.post("/admin/today-brain/clear-all"); await load(); }
    finally { setBusy(false); }
  };

  const runCTA = (item) => runTodayBrainCTA(item, { onJumpToDog, onJumpToClient, onNavigate });

  return (
    <div className="space-y-5 animate-slide-in" data-testid="action-center-screen">
      <div className="relative overflow-hidden rounded-2xl border border-shBorder bg-gradient-to-br from-[var(--sh-card-base)] via-[var(--sh-card-base)] to-[var(--sh-card-base)] p-5 sm:p-7">
        <div className="absolute inset-0 pointer-events-none opacity-35"
             style={{ background: "radial-gradient(circle at 12% 15%, rgba(0,169,224,0.38) 0%, transparent 38%), radial-gradient(circle at 90% 75%, rgba(140,198,63,0.34) 0%, transparent 44%)" }}/>
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shPrimary mb-2"><i className="fas fa-list-check mr-2"/>Daily Command Center</p>
            <h1 className="text-3xl sm:text-4xl font-black uppercase italic text-shText tracking-tight">Action Center</h1>
            <p className="text-[14px] text-shTextMuted mt-2 max-w-3xl">One place for things that need attention: vaccines, rewards, quote requests, unpaid balances, closeouts, stuck checkouts, and other cleanup before they turn into business problems.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} disabled={busy} data-testid="action-center-refresh" className="bg-[var(--sh-card-base)] border border-shBorder text-gray-200 hover:border-shSecondary hover:text-shText rounded-lg px-4 py-2 text-[12px] font-black uppercase tracking-widest transition"><i className="fas fa-rotate mr-1"/>Refresh</button>
            {items.length > 0 && <button onClick={clearAll} disabled={busy} data-testid="action-center-clear-all" className="bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 rounded-lg px-4 py-2 text-[12px] font-black uppercase tracking-widest transition"><i className="fas fa-broom mr-1"/>Clear All</button>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CountTile label="Total" value={counts.total} icon="fa-list-check" active={filter === "all"} onClick={() => setFilter("all")} />
        <CountTile label="Urgent" value={counts.urgent} icon="fa-triangle-exclamation" tone="urgent" active={filter === "urgent"} onClick={() => setFilter("urgent")} />
        <CountTile label="Needs Attention" value={counts.warn} icon="fa-circle-exclamation" tone="warn" active={filter === "warn"} onClick={() => setFilter("warn")} />
        <CountTile label="FYI" value={counts.info} icon="fa-lightbulb" tone="info" active={filter === "info"} onClick={() => setFilter("info")} />
      </div>

      {err && <div className="card-warning rounded-xl p-4 text-shAccent text-sm font-bold" data-testid="action-center-error">{err}</div>}

      {!data ? (
        <div className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-5 text-shTextMuted text-sm">Loading Action Center…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-shPrimary/30 bg-shPrimary/5 p-8 text-center" data-testid="action-center-empty">
          <p className="text-lg font-black uppercase italic text-shPrimary"><i className="fas fa-check-circle mr-2"/>All clear</p>
          <p className="text-shTextMuted text-sm mt-2">Nothing in this group right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3" data-testid="action-center-list">
          {filtered.map((item) => <ActionRow key={item.id} item={item} onOpen={() => runCTA(item)} onDismiss={() => dismiss(item)} busy={busy} />)}
        </div>
      )}
    </div>
  );
}

function CountTile({ label, value, icon, tone = "info", active, onClick }) {
  const meta = META[tone] || META.info;
  return (
    <button onClick={onClick} className={`text-left rounded-2xl border ${active ? meta.border : "border-shBorder"} ${active ? meta.bg : "bg-[var(--sh-card-base)]"} p-4 hover:border-shPrimary/50 transition`} data-testid={`action-center-count-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <p className={`text-xl ${meta.text}`}><i className={`fas ${icon}`}/></p>
      <p className="text-3xl font-black text-shText mt-2">{value || 0}</p>
      <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mt-1">{label}</p>
    </button>
  );
}
