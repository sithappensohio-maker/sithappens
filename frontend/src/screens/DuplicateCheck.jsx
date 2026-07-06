import { useMemo, useState } from "react";
import PageHero from "../components/PageHero";
import { api } from "../lib/api";

const fmtCredits = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtMoney = (n) => `$${Number(n || 0).toFixed(2)}`;

function ConfidenceBadge({ value }) {
  const v = value || "medium";
  const cls = v === "high" ? "bg-red-500/15 border-red-500/35 text-red-300" : v === "medium" ? "bg-shOrange/15 border-shOrange/35 text-shOrange" : "bg-shBlue/15 border-shBlue/35 text-shBlue";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${cls}`}>{v}</span>;
}

function Stat({ label, value, icon }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-4">
      <div className="text-shGreen text-xl mb-2"><i className={`fas ${icon}`} /></div>
      <div className="text-2xl font-black text-white">{value ?? 0}</div>
      <div className="text-[11px] font-black uppercase tracking-widest text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function MiniClient({ c }) {
  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-3 text-sm" data-testid={`duplicate-client-${c.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-black text-white uppercase italic">{c.name}</div>
          <div className="text-xs text-gray-500 mt-1">{c.email || "no email"} · {c.phone || "no phone"}</div>
          <div className="text-xs text-gray-500 mt-1">Created {(c.created_at || "").slice(0, 10) || "unknown"}</div>
        </div>
        {c.deleted && <span className="text-[10px] font-black uppercase tracking-widest bg-red-500/15 text-red-300 border border-red-500/30 rounded px-2 py-1">Archived</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
        <Info label="Dogs" value={c.dog_count} />
        <Info label="Bookings" value={c.booking_count} />
        <Info label="Future" value={c.future_booking_count} />
        <Info label="Portal users" value={c.portal_user_count} />
        <Info label="Daycare credits" value={fmtCredits(c.credits?.daycare)} />
        <Info label="Boarding credits" value={fmtCredits(c.credits?.boarding)} />
        <Info label="Training credits" value={fmtCredits(c.credits?.training)} />
        <Info label="Tab balance" value={fmtMoney(c.account_balance)} />
      </div>
      {Array.isArray(c.dogs) && c.dogs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.dogs.map((d)=><span key={d.id} className="text-[11px] font-bold text-gray-300 bg-bgPanel border border-bgHover rounded-full px-2 py-1"><i className="fas fa-paw text-shGreen mr-1"/>{d.name}{d.breed ? ` · ${d.breed}` : ""}</span>)}
        </div>
      )}
    </div>
  );
}

function MiniDog({ d }) {
  return (
    <div className="bg-bgBase border border-bgHover rounded-xl p-3 text-sm" data-testid={`duplicate-dog-${d.id}`}>
      <div className="font-black text-white uppercase italic"><i className="fas fa-paw text-shGreen mr-2"/>{d.name}</div>
      <div className="text-xs text-gray-500 mt-1">Owner: {d.owner_name} · {d.owner_email || "no email"}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
        <Info label="Breed" value={d.breed || "—"} />
        <Info label="Bookings" value={d.booking_count} />
        <Info label="Future" value={d.future_booking_count} />
        <Info label="Created" value={(d.created_at || "").slice(0,10) || "—"} />
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return <div className="bg-black/20 border border-bgHover/60 rounded-lg px-2 py-1.5"><div className="text-gray-500 font-black uppercase tracking-widest text-[9px]">{label}</div><div className="text-gray-200 font-black mt-0.5">{value}</div></div>;
}

function CandidateCard({ cand, type }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-2xl p-4 space-y-3" data-testid={`duplicate-candidate-${cand.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-1"><ConfidenceBadge value={cand.confidence} /><span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Score {cand.score}</span></div>
          <h3 className="text-white font-black uppercase italic">{cand.reason}</h3>
          <p className="text-xs text-gray-500 mt-1">{cand.safe_action || "Preview only."}</p>
        </div>
        <span className="text-[11px] font-black uppercase tracking-widest text-shBlue bg-shBlue/10 border border-shBlue/30 rounded px-2 py-1">{type === "client" ? "Client match" : "Dog match"}</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {type === "client" ? (cand.clients || []).map((c)=><MiniClient key={c.id} c={c}/>) : (cand.dogs || []).map((d)=><MiniDog key={d.id} d={d}/>) }
      </div>
    </div>
  );
}

export default function DuplicateCheck() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filter, setFilter] = useState("all");

  const run = async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.get(`/admin/duplicates/report?include_archived=${includeArchived ? "true" : "false"}`);
      setData(r.data || {});
    } catch (e) {
      setErr(e.response?.data?.detail || "Could not run duplicate check");
    } finally { setLoading(false); }
  };

  const clientCandidates = useMemo(() => {
    const arr = data?.client_candidates || [];
    return filter === "all" ? arr : arr.filter((c)=>c.confidence === filter);
  }, [data, filter]);
  const dogCandidates = useMemo(() => {
    const arr = data?.dog_candidates || [];
    return filter === "all" ? arr : arr.filter((c)=>c.confidence === filter);
  }, [data, filter]);
  const summary = data?.summary || {};

  return (
    <div className="space-y-6 animate-slide-in" data-testid="duplicate-check-screen">
      <PageHero
        eyebrow={{ icon: "fa-copy", text: "Data safety", color: "text-shBlue" }}
        title="Duplicate check."
        highlight="Preview only."
        subtitle="Find possible duplicate clients and dogs before they split credits, bookings, payments, vaccines, or portal accounts. This phase does not merge, delete, archive, or rewrite anything."
        right={<button onClick={run} disabled={loading} className="bg-shGreen text-black px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest"><i className="fas fa-magnifying-glass mr-2"/>{loading ? "Scanning…" : "Run Check"}</button>}
        testid="duplicate-check-hero"
      />

      <div className="bg-shBlue/10 border border-shBlue/30 rounded-xl p-4 text-sm text-gray-300">
        <p className="font-black text-shBlue uppercase tracking-widest text-xs mb-2"><i className="fas fa-shield-halved mr-2"/>Safe preview only</p>
        <p>This screen only searches for likely duplicates. It does not merge records. It does not move credits. It does not touch bookings or payment history. Phase 8B can add an actual merge workflow later with a dry-run preview and audit log.</p>
      </div>

      <div className="bg-bgPanel border border-bgHover rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={includeArchived} onChange={(e)=>setIncludeArchived(e.target.checked)} />
          Include archived/soft-deleted records in the scan
        </label>
        <div className="flex flex-wrap gap-2">
          {["all", "high", "medium", "low"].map((f)=><button key={f} onClick={()=>setFilter(f)} className={`rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-widest border ${filter===f ? "border-shGreen text-shGreen bg-shGreen/10" : "border-bgHover text-gray-400 bg-bgBase"}`}>{f}</button>)}
        </div>
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-red-300 text-sm font-semibold">{err}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat icon="fa-users" label="Clients scanned" value={summary.clients_scanned} />
            <Stat icon="fa-paw" label="Dogs scanned" value={summary.dogs_scanned} />
            <Stat icon="fa-user-group" label="Client candidates" value={summary.client_candidates} />
            <Stat icon="fa-dog" label="Dog candidates" value={summary.dog_candidates} />
            <Stat icon="fa-triangle-exclamation" label="High confidence" value={summary.high_confidence} />
          </div>

          {(data.notes || []).map((n, idx)=><div key={idx} className="text-xs text-gray-500 bg-bgPanel border border-bgHover rounded-lg p-3"><i className="fas fa-circle-info text-shBlue mr-2"/>{n}</div>)}

          <section className="space-y-3">
            <h2 className="text-white font-black uppercase italic"><i className="fas fa-users text-shOrange mr-2"/>Possible duplicate clients</h2>
            {clientCandidates.length === 0 ? <div className="bg-bgPanel border border-bgHover rounded-xl p-5 text-gray-400 text-sm">No possible duplicate clients in this filter.</div> : clientCandidates.map((cand)=><CandidateCard key={cand.id} cand={cand} type="client" />)}
          </section>

          <section className="space-y-3">
            <h2 className="text-white font-black uppercase italic"><i className="fas fa-paw text-shGreen mr-2"/>Possible duplicate dogs</h2>
            {dogCandidates.length === 0 ? <div className="bg-bgPanel border border-bgHover rounded-xl p-5 text-gray-400 text-sm">No possible duplicate dogs in this filter.</div> : dogCandidates.map((cand)=><CandidateCard key={cand.id} cand={cand} type="dog" />)}
          </section>
        </>
      )}

      {!data && !loading && <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-gray-400 text-sm">Run the check when you want to scan for duplicates. It is safe to run any time.</div>}
    </div>
  );
}
