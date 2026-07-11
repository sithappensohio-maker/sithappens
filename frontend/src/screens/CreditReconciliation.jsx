import { useEffect, useMemo, useState } from "react";
import PageHero from "../components/PageHero";
import { api } from "../lib/api";

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (value) => {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
};

function StatCard({ icon, label, value, tone = "green" }) {
  const cls = tone === "red" ? "text-red-300" : tone === "orange" ? "text-shOrange" : tone === "blue" ? "text-shBlue" : "text-shGreen";
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
      <i className={`fas ${icon} ${cls} text-xl`} />
      <div className="text-2xl font-black text-white mt-2">{value ?? 0}</div>
      <div className="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = status === "structural"
    ? ["Needs attention", "bg-red-500/15 border-red-500/35 text-red-300", "fa-triangle-exclamation"]
    : status === "review"
      ? ["Review", "bg-shOrange/15 border-shOrange/35 text-shOrange", "fa-magnifying-glass"]
      : ["Matched", "bg-shGreen/15 border-shGreen/35 text-shGreen", "fa-check"];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${cfg[1]}`}><i className={`fas ${cfg[2]}`}/>{cfg[0]}</span>;
}

function PoolBox({ name, row }) {
  const bad = row?.status === "issue";
  return (
    <div className={`rounded-xl border p-3 ${bad ? "border-shOrange/40 bg-shOrange/5" : "border-bgHover bg-black/15"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-widest text-gray-400">{name}</div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${bad ? "text-shOrange" : "text-shGreen"}`}>{bad ? "Review" : "Match"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div><div className="text-gray-500 uppercase tracking-widest text-[9px] font-black">Displayed</div><div className="text-white font-black mt-0.5">{fmt(row?.displayed)}</div></div>
        <div><div className="text-gray-500 uppercase tracking-widest text-[9px] font-black">Tracked total</div><div className="text-white font-black mt-0.5">{fmt(row?.tracked_total)}</div></div>
        <div><div className="text-gray-500 uppercase tracking-widest text-[9px] font-black">Lots remaining</div><div className="text-gray-300 font-bold mt-0.5">{fmt(row?.lot_remaining)}</div></div>
        <div><div className="text-gray-500 uppercase tracking-widest text-[9px] font-black">Manual net</div><div className="text-gray-300 font-bold mt-0.5">{fmt(row?.manual_adjustment_net)}</div></div>
      </div>
      <div className={`mt-3 rounded-lg px-2 py-1.5 text-xs font-black ${Math.abs(Number(row?.variance || 0)) > 0.009 ? "bg-red-500/10 text-red-300" : "bg-shGreen/10 text-shGreen"}`}>
        Variance: {Number(row?.variance || 0) > 0 ? "+" : ""}{fmt(row?.variance)}
      </div>
    </div>
  );
}

function DetailModal({ client, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setData(null);
    api.get(`/admin/credits/reconciliation/${client.id}`)
      .then((r) => { if (alive) setData(r.data || {}); })
      .catch((e) => { if (alive) setError(e.response?.data?.detail || "Could not load credit history"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3" onMouseDown={(e)=>{ if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-bgPanel border border-shBlue/35 rounded-2xl w-full max-w-6xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto p-4 md:p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-widest text-shBlue"><i className="fas fa-eye mr-2"/>Read-only detail</div>
            <h2 className="text-xl font-black uppercase italic text-white mt-1">{client.name}</h2>
            <p className="text-xs text-gray-500 mt-1">Nothing on this screen can change credits.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2"><i className="fas fa-times text-xl"/></button>
        </div>

        {loading && <div className="py-16 text-center text-gray-400 font-black uppercase tracking-widest"><i className="fas fa-spinner fa-spin mr-2"/>Loading history…</div>}
        {error && <div className="mt-4 bg-red-500/10 border border-red-500/35 rounded-xl p-3 text-red-300 text-sm font-semibold">{error}</div>}

        {data && !loading && (
          <div className="space-y-5 mt-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard icon="fa-dog" label="Daycare displayed" value={fmt(data.client?.credits)} />
              <StatCard icon="fa-graduation-cap" label="Training displayed" value={fmt(data.client?.training_credits)} tone="blue" />
              <StatCard icon="fa-moon" label="Boarding displayed" value={fmt(data.client?.boarding_credits)} tone="orange" />
            </div>

            <section>
              <h3 className="text-sm font-black uppercase italic text-white mb-2">Credit lots ({data.lots?.length || 0})</h3>
              <div className="overflow-x-auto border border-bgHover rounded-xl">
                <table className="w-full text-xs min-w-[760px]">
                  <thead className="bg-bgBase text-gray-500 uppercase tracking-widest text-[10px]"><tr><th className="text-left p-3">Purchased</th><th className="text-left p-3">Pool</th><th className="text-left p-3">Pack</th><th className="text-right p-3">Original</th><th className="text-right p-3">Remaining</th><th className="text-right p-3">Value each</th></tr></thead>
                  <tbody>
                    {(data.lots || []).map((lot)=><tr key={lot.id} className="border-t border-bgHover"><td className="p-3 text-gray-400">{fmtDate(lot.purchased_at)}</td><td className="p-3 text-white font-black uppercase">{lot.service_type || "unknown"}</td><td className="p-3 text-gray-300">{lot.pack_name || lot.program_name || "Legacy lot"}</td><td className="p-3 text-right text-gray-300">{fmt(lot.qty_total)}</td><td className={`p-3 text-right font-black ${Number(lot.qty_remaining || 0) < 0 ? "text-red-300" : "text-shGreen"}`}>{fmt(lot.qty_remaining)}</td><td className="p-3 text-right text-gray-400">${Number(lot.value_each || 0).toFixed(2)}</td></tr>)}
                    {(data.lots || []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">No credit lots recorded.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-sm font-black uppercase italic text-white mb-2">Manual adjustments ({data.adjustments?.length || 0})</h3>
              <div className="space-y-2">
                {(data.adjustments || []).map((a)=><div key={a.id} className="bg-bgBase border border-bgHover rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap"><div className="text-white font-black">{a.note || "Manual credit adjustment"}</div><div className="text-xs text-gray-500">{fmtDate(a.adjusted_at)}</div></div>
                  <div className="text-xs text-gray-500 mt-1">By {a.adjusted_by || "Admin"}</div>
                  <div className="flex flex-wrap gap-2 mt-2">{Object.entries(a.changes || {}).map(([pool, change])=><span key={pool} className="bg-black/20 border border-bgHover rounded-full px-2 py-1 text-xs text-gray-300"><strong className="uppercase text-white">{pool}</strong> {Number(change.delta || 0) > 0 ? "+" : ""}{fmt(change.delta)} · {fmt(change.before)} → {fmt(change.after)}</span>)}</div>
                </div>)}
                {(data.adjustments || []).length === 0 && <div className="bg-bgBase border border-bgHover rounded-xl p-5 text-center text-gray-500">No manual adjustments recorded.</div>}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-black uppercase italic text-white mb-2">Bookings that used credits ({data.credit_bookings?.length || 0})</h3>
              <div className="overflow-x-auto border border-bgHover rounded-xl">
                <table className="w-full text-xs min-w-[720px]">
                  <thead className="bg-bgBase text-gray-500 uppercase tracking-widest text-[10px]"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Service</th><th className="text-left p-3">Dog</th><th className="text-left p-3">Status</th><th className="text-right p-3">Credits used</th><th className="text-right p-3">Tracked lot rows</th></tr></thead>
                  <tbody>
                    {(data.credit_bookings || []).map((b)=><tr key={b.id} className="border-t border-bgHover"><td className="p-3 text-gray-400">{b.date || "—"}</td><td className="p-3 text-white font-black">{b.service_name || b.service_type || "—"}</td><td className="p-3 text-gray-300">{b.dog_name || "—"}</td><td className="p-3 text-gray-300 uppercase">{b.status || "—"}</td><td className="p-3 text-right text-shGreen font-black">{fmt(b.credits_deducted)}</td><td className="p-3 text-right text-gray-400">{b.credit_lot_redemptions?.length || 0}</td></tr>)}
                    {(data.credit_bookings || []).length === 0 && <tr><td colSpan={6} className="p-6 text-center text-gray-500">No credit-paid bookings recorded.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CreditReconciliation() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filter, setFilter] = useState("issues");
  const [search, setSearch] = useState("");
  const [detailClient, setDetailClient] = useState(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await api.get(`/admin/credits/reconciliation?include_archived=${includeArchived ? "true" : "false"}`);
      setData(r.data || {});
    } catch (e) {
      setError(e.response?.data?.detail || "Could not run credit reconciliation");
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [includeArchived]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.clients || []).filter((row) => {
      if (filter === "issues" && row.overall_status === "match") return false;
      if (filter === "matched" && row.overall_status !== "match") return false;
      if (q && !`${row.name} ${row.email} ${row.phone}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, filter, search]);

  const exportCsv = () => {
    const header = ["Client","Email","Status","Pool","Displayed","Lots remaining","Manual adjustment net","Tracked total","Variance","Issues"];
    const lines = [header];
    for (const client of data?.clients || []) {
      for (const [pool, row] of Object.entries(client.pools || {})) {
        lines.push([client.name, client.email, client.overall_status, pool, row.displayed, row.lot_remaining, row.manual_adjustment_net, row.tracked_total, row.variance, (client.issues || []).join(" | ")]);
      }
    }
    const csv = lines.map((line)=>line.map((v)=>`"${String(v ?? "").replaceAll('"','""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `credit-reconciliation-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 500);
  };

  const s = data?.summary || {};
  return (
    <div className="space-y-6 animate-slide-in" data-testid="credit-reconciliation-screen">
      <PageHero
        eyebrow={{ icon: "fa-scale-balanced", text: "Read-only money safety", color: "text-shBlue" }}
        title="Credit reconciliation."
        highlight="Nothing changes automatically."
        subtitle="Compare the balance clients see with remaining credit lots and the manual adjustment history. Review flags before making any correction."
        right={<div className="flex flex-wrap gap-2"><button onClick={exportCsv} disabled={!data} className="bg-bgPanel border border-bgHover text-gray-200 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest disabled:opacity-40"><i className="fas fa-file-csv mr-2"/>Export</button><button onClick={load} disabled={loading} className="bg-shGreen text-black px-4 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest disabled:opacity-50"><i className={`fas ${loading ? "fa-spinner fa-spin" : "fa-rotate"} mr-2`}/>{loading ? "Checking…" : "Refresh"}</button></div>}
      />

      <div className="bg-shBlue/10 border border-shBlue/30 rounded-xl p-3 text-sm text-gray-300"><i className="fas fa-lock text-shBlue mr-2"/><strong className="text-white">Read-only:</strong> this report cannot add, remove, or repair credits. A flagged legacy balance is not changed unless you review it separately.</div>
      {error && <div className="bg-red-500/10 border border-red-500/35 rounded-xl p-3 text-red-300 text-sm font-semibold">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon="fa-users" label="Clients checked" value={s.client_count} tone="blue" />
        <StatCard icon="fa-check-double" label="Matched" value={s.matched_count} />
        <StatCard icon="fa-magnifying-glass" label="Review" value={s.review_count} tone="orange" />
        <StatCard icon="fa-triangle-exclamation" label="Structural issues" value={s.structural_issue_count} tone="red" />
        <StatCard icon="fa-link-slash" label="Orphan groups" value={Number(s.orphan_lot_group_count || 0) + Number(s.orphan_adjustment_group_count || 0)} tone="red" />
      </div>

      <div className="bg-bgPanel border border-bgHover rounded-xl p-3 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1"><i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search client, email, or phone" className="w-full bg-bgBase border border-bgHover rounded-lg pl-9 pr-3 py-2.5 text-white text-sm"/></div>
        <div className="flex gap-2 flex-wrap">{[["issues","Issues"],["matched","Matched"],["all","All"]].map(([id,label])=><button key={id} onClick={()=>setFilter(id)} className={`px-3 py-2 rounded-lg border text-[11px] font-black uppercase tracking-widest ${filter===id ? "bg-shBlue/15 border-shBlue/45 text-shBlue" : "bg-bgBase border-bgHover text-gray-400"}`}>{label}</button>)}</div>
        <label className="flex items-center gap-2 text-xs text-gray-400 font-bold"><input type="checkbox" checked={includeArchived} onChange={(e)=>setIncludeArchived(e.target.checked)} className="accent-shGreen"/>Include archived</label>
      </div>

      {loading && !data && <div className="py-20 text-center text-gray-400 font-black uppercase tracking-widest"><i className="fas fa-spinner fa-spin mr-2"/>Checking credit records…</div>}
      {!loading && data && rows.length === 0 && <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center text-gray-500"><i className="fas fa-check-circle text-shGreen text-3xl mb-3"/><div className="font-black uppercase tracking-widest text-white">No rows match this filter</div></div>}

      <div className="space-y-3">
        {rows.map((client)=><div key={client.id} className="bg-bgPanel border border-bgHover rounded-2xl p-4" data-testid={`credit-recon-${client.id}`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div><div className="flex items-center gap-2 flex-wrap"><h3 className="text-white font-black uppercase italic">{client.name}</h3><StatusBadge status={client.overall_status}/>{client.archived && <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 border border-bgHover rounded-full px-2 py-1">Archived</span>}</div><div className="text-xs text-gray-500 mt-1">{client.email || "no email"}{client.phone ? ` · ${client.phone}` : ""}</div></div>
            <button onClick={()=>setDetailClient(client)} className="bg-bgBase border border-bgHover hover:border-shBlue text-gray-200 px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest"><i className="fas fa-clock-rotate-left mr-2"/>View history</button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4"><PoolBox name="Daycare" row={client.pools?.daycare}/><PoolBox name="Training" row={client.pools?.training}/><PoolBox name="Boarding" row={client.pools?.boarding}/></div>
          {(client.issues || []).length > 0 && <div className="mt-3 bg-red-500/5 border border-red-500/25 rounded-xl p-3 space-y-1">{client.issues.map((issue, idx)=><div key={idx} className="text-xs text-red-200"><i className="fas fa-circle-exclamation mr-2 text-red-300"/>{issue}</div>)}</div>}
        </div>)}
      </div>

      {((data?.orphan_lots || []).length > 0 || (data?.orphan_adjustments || []).length > 0) && <div className="bg-red-500/10 border border-red-500/35 rounded-xl p-4"><h3 className="text-red-300 font-black uppercase italic"><i className="fas fa-link-slash mr-2"/>Orphan credit records</h3><p className="text-sm text-gray-300 mt-1">These credit records reference a client ID that is not present in the selected client set. This section is still read-only.</p><div className="text-xs text-gray-400 mt-2">Lot groups: {data.orphan_lots?.length || 0} · Adjustment groups: {data.orphan_adjustments?.length || 0}</div></div>}

      {detailClient && <DetailModal client={detailClient} onClose={()=>setDetailClient(null)}/>} 
    </div>
  );
}
