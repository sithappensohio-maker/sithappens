import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

const META = {
  urgent: { label: "Urgent", border: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-300", icon: "fa-triangle-exclamation" },
  warn:   { label: "Needs Attention", border: "border-shOrange/40", bg: "bg-shOrange/10", text: "text-shOrange", icon: "fa-circle-exclamation" },
  info:   { label: "FYI / Follow-up", border: "border-shGreen/40", bg: "bg-shGreen/10", text: "text-shGreen", icon: "fa-lightbulb" },
};

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

  const items = data?.items || [];
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

  const runCTA = (item) => {
    const cta = item?.cta || {};
    if (cta.type === "open_dog" && cta.id) onJumpToDog(cta.id);
    else if (cta.type === "open_client" && cta.id) onJumpToClient(cta.id);
    else if (cta.type === "open_screen" && cta.screen) onNavigate(cta.screen);
    else if (cta.type === "send_monday_digest") {
      api.post("/admin/homework/send-monday-digest")
        .then(() => alert("Monday digest fired — check your admin email."))
        .catch((e) => alert("Failed to send: " + (e.response?.data?.detail || e.message)));
    }
  };

  return (
    <div className="space-y-5 animate-slide-in" data-testid="action-center-screen">
      <div className="relative overflow-hidden rounded-2xl border border-bgHover bg-gradient-to-br from-bgPanel via-bgBase to-bgPanel p-5 sm:p-7">
        <div className="absolute inset-0 pointer-events-none opacity-35"
             style={{ background: "radial-gradient(circle at 12% 15%, rgba(0,169,224,0.38) 0%, transparent 38%), radial-gradient(circle at 90% 75%, rgba(140,198,63,0.34) 0%, transparent 44%)" }}/>
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-2"><i className="fas fa-list-check mr-2"/>Daily Command Center</p>
            <h1 className="text-3xl sm:text-4xl font-black uppercase italic text-white tracking-tight">Action Center</h1>
            <p className="text-[14px] text-gray-400 mt-2 max-w-3xl">One place for things that need attention: vaccines, rewards, quote requests, unpaid balances, closeouts, stuck checkouts, and other cleanup before they turn into business problems.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={load} disabled={busy} data-testid="action-center-refresh" className="bg-bgBase border border-bgHover text-gray-200 hover:border-shBlue hover:text-white rounded-lg px-4 py-2 text-[12px] font-black uppercase tracking-widest transition"><i className="fas fa-rotate mr-1"/>Refresh</button>
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

      {err && <div className="card-warning rounded-xl p-4 text-shOrange text-sm font-bold" data-testid="action-center-error">{err}</div>}

      {!data ? (
        <div className="rounded-xl border border-bgHover bg-bgPanel p-5 text-gray-400 text-sm">Loading Action Center…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-shGreen/30 bg-shGreen/5 p-8 text-center" data-testid="action-center-empty">
          <p className="text-lg font-black uppercase italic text-shGreen"><i className="fas fa-check-circle mr-2"/>All clear</p>
          <p className="text-gray-400 text-sm mt-2">Nothing in this group right now.</p>
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
    <button onClick={onClick} className={`text-left rounded-2xl border ${active ? meta.border : "border-bgHover"} ${active ? meta.bg : "bg-bgPanel"} p-4 hover:border-shGreen/50 transition`} data-testid={`action-center-count-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <p className={`text-xl ${meta.text}`}><i className={`fas ${icon}`}/></p>
      <p className="text-3xl font-black text-white mt-2">{value || 0}</p>
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-1">{label}</p>
    </button>
  );
}

function ActionRow({ item, onOpen, onDismiss, busy }) {
  const meta = META[item.priority] || META.info;
  return (
    <div className={`relative rounded-2xl border ${meta.border} ${meta.bg} p-4 shadow-lg`} data-testid={`action-center-row-${item.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <button onClick={onOpen} className="flex items-start gap-3 text-left min-w-0 flex-1" data-testid={`action-center-open-${item.id}`}>
          <span className={`w-11 h-11 rounded-xl grid place-items-center bg-bgBase border border-bgHover shrink-0 ${meta.text}`}><i className={`fas ${item.icon || meta.icon}`}/></span>
          <span className="min-w-0">
            <span className="block text-[11px] font-black uppercase tracking-widest text-gray-500 mb-1">{meta.label} · {item.kind || "task"}</span>
            <span className="block text-[16px] font-black text-white uppercase italic tracking-tight">{item.title}</span>
            {item.subtitle && <span className="block text-[13px] text-gray-400 mt-1">{item.subtitle}</span>}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onOpen} className="bg-shBlue/15 border border-shBlue/30 text-shBlue hover:bg-shBlue/25 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-widest transition"><i className="fas fa-arrow-right mr-1"/>Open</button>
          <button onClick={onDismiss} disabled={busy} className="bg-bgBase border border-bgHover text-gray-400 hover:text-red-300 hover:border-red-400/40 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-widest transition disabled:opacity-50"><i className="fas fa-times mr-1"/>Hide</button>
        </div>
      </div>
    </div>
  );
}
