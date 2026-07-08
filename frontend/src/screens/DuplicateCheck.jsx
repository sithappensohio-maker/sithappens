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

function Info({ label, value }) {
  return <div className="bg-black/20 border border-bgHover/60 rounded-lg px-2 py-1.5"><div className="text-gray-500 font-black uppercase tracking-widest text-[9px]">{label}</div><div className="text-gray-200 font-black mt-0.5">{value}</div></div>;
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

function DogMergeControls({ cand, onPreview }) {
  const dogs = cand.dogs || [];
  const firstPrimary = cand.recommended_primary_id || dogs[0]?.id || "";
  const firstDuplicate = cand.recommended_duplicate_id || dogs.find((d)=>d.id !== firstPrimary)?.id || "";
  const [primary, setPrimary] = useState(firstPrimary);
  const [duplicate, setDuplicate] = useState(firstDuplicate);
  if (dogs.length < 2) return null;
  return (
    <div className="bg-shBlue/10 border border-shBlue/30 rounded-xl p-3 space-y-3">
      <div className="text-[11px] font-black uppercase tracking-widest text-shBlue"><i className="fas fa-wand-magic-sparkles mr-2"/>Phase 8B safe dog merge</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="text-xs text-gray-400 font-bold uppercase tracking-widest">Main dog to keep
          <select value={primary} onChange={(e)=>{ setPrimary(e.target.value); if (e.target.value === duplicate) setDuplicate(dogs.find((d)=>d.id !== e.target.value)?.id || ""); }} className="mt-1 w-full bg-bgBase border border-bgHover rounded-lg px-3 py-2 text-white normal-case tracking-normal">
            {dogs.map((d)=><option key={d.id} value={d.id}>{d.name} · {d.booking_count || 0} bookings · {(d.created_at || "").slice(0,10)}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-400 font-bold uppercase tracking-widest">Duplicate to archive
          <select value={duplicate} onChange={(e)=>setDuplicate(e.target.value)} className="mt-1 w-full bg-bgBase border border-bgHover rounded-lg px-3 py-2 text-white normal-case tracking-normal">
            {dogs.filter((d)=>d.id !== primary).map((d)=><option key={d.id} value={d.id}>{d.name} · {d.booking_count || 0} bookings · {(d.created_at || "").slice(0,10)}</option>)}
          </select>
        </label>
      </div>
      <button onClick={()=>onPreview(primary, duplicate)} disabled={!primary || !duplicate || primary === duplicate} className="bg-shGreen text-black px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
        <i className="fas fa-eye mr-2"/>Preview safe merge
      </button>
      <p className="text-[11px] text-gray-500">This opens a dry-run first. The duplicate dog is archived, never hard-deleted.</p>
    </div>
  );
}

function CandidateCard({ cand, type, onDogMergePreview }) {
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
      {type === "dog" && <DogMergeControls cand={cand} onPreview={onDogMergePreview} />}
      {type === "client" && <div className="text-xs text-gray-500 bg-bgBase border border-bgHover rounded-lg p-3"><i className="fas fa-lock mr-2 text-shOrange"/>Client merging is still preview-only. Dog merge is safe for same-owner duplicates. Client account merge needs a separate dry-run workflow.</div>}
    </div>
  );
}

function MergePreviewModal({ preview, busy, confirmText, setConfirmText, note, setNote, onClose, onMerge, error, result }) {
  if (!preview && !result) return null;
  const p = preview || result?.preview_before || {};
  const primary = p.primary || {};
  const duplicate = p.duplicate || {};
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-bgPanel border border-shBlue/40 rounded-2xl max-w-4xl w-full max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto p-5 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-white text-xl font-black uppercase italic"><i className="fas fa-paw text-shGreen mr-2"/>Dog merge dry-run</h2>
            <p className="text-sm text-gray-400 mt-1">Main dog is kept. Duplicate dog is archived. No hard delete.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="fas fa-times text-xl"/></button>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-red-300 text-sm font-semibold">{error}</div>}
        {result?.ok && <div className="bg-shGreen/10 border border-shGreen/40 rounded-xl p-3 text-shGreen text-sm font-black uppercase tracking-widest"><i className="fas fa-check mr-2"/>Merge complete. Duplicate dog archived.</div>}
        {!p.allowed && <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-red-300 text-sm font-semibold">This merge is blocked. These dogs are probably under different client accounts.</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-bgBase border border-shGreen/35 rounded-xl p-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-shGreen mb-2">Keep this dog</div>
            <MiniDog d={primary} />
          </div>
          <div className="bg-bgBase border border-red-500/35 rounded-xl p-3">
            <div className="text-[11px] font-black uppercase tracking-widest text-red-300 mb-2">Archive this duplicate</div>
            <MiniDog d={duplicate} />
          </div>
        </div>

        <div className="bg-bgBase border border-bgHover rounded-xl p-3">
          <div className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">Records that will point to the main dog</div>
          {(p.moves || []).length === 0 ? <div className="text-sm text-gray-500">No linked records to move. The duplicate will just be archived with an audit note.</div> : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {(p.moves || []).map((m)=><Info key={`${m.collection}-${m.field}`} label={m.collection} value={`${m.count} record${m.count === 1 ? "" : "s"}`} />)}
            </div>
          )}
        </div>

        {(p.warnings || []).length > 0 && <div className="bg-shOrange/10 border border-shOrange/35 rounded-xl p-3 text-sm text-shOrange space-y-1">
          {(p.warnings || []).map((w, i)=><div key={i}><i className="fas fa-triangle-exclamation mr-2"/>{w}</div>)}
        </div>}

        <div className="bg-shBlue/10 border border-shBlue/30 rounded-xl p-3 text-xs text-gray-300 space-y-1">
          {(p.safe_notes || []).map((n, i)=><div key={i}><i className="fas fa-shield-halved text-shBlue mr-2"/>{n}</div>)}
        </div>

        {!result?.ok && <>
          <label className="block text-xs text-gray-400 font-black uppercase tracking-widest">Optional merge note
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} className="mt-1 w-full bg-bgBase border border-bgHover rounded-lg p-3 text-white font-normal normal-case tracking-normal" rows={2} placeholder="Example: Oreo duplicate created by mistake; keep older record with bookings." />
          </label>
          <label className="block text-xs text-gray-400 font-black uppercase tracking-widest">Type MERGE DOG to confirm
            <input value={confirmText} onChange={(e)=>setConfirmText(e.target.value)} className="mt-1 w-full bg-bgBase border border-bgHover rounded-lg p-3 text-white font-normal normal-case tracking-normal" placeholder="MERGE DOG" />
          </label>
          <div className="flex flex-wrap gap-2 justify-end">
            <button onClick={onClose} className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest">Cancel</button>
            <button onClick={onMerge} disabled={!p.allowed || confirmText.trim().toUpperCase() !== "MERGE DOG" || busy} className="bg-shGreen text-black px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
              <i className="fas fa-wand-magic-sparkles mr-2"/>{busy ? "Merging…" : "Merge/archive duplicate"}
            </button>
          </div>
        </>}
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
  const [mergePreview, setMergePreview] = useState(null);
  const [mergeError, setMergeError] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [mergeNote, setMergeNote] = useState("");
  const [mergeResult, setMergeResult] = useState(null);

  const run = async () => {
    setLoading(true); setErr("");
    try {
      const r = await api.get(`/admin/duplicates/report?include_archived=${includeArchived ? "true" : "false"}`);
      setData(r.data || {});
    } catch (e) {
      setErr(e.response?.data?.detail || "Could not run duplicate check");
    } finally { setLoading(false); }
  };

  const previewDogMerge = async (primary_dog_id, duplicate_dog_id) => {
    setMergeError(""); setMergeResult(null); setConfirmText(""); setMergeNote(""); setMergeBusy(true);
    try {
      const r = await api.post('/admin/duplicates/dogs/merge-preview', { primary_dog_id, duplicate_dog_id });
      setMergePreview(r.data || {});
    } catch (e) {
      setMergeError(e.response?.data?.detail || "Could not preview dog merge");
      setMergePreview({ allowed: false, primary: {}, duplicate: {}, warnings: [e.response?.data?.detail || "Could not preview dog merge"] });
    } finally { setMergeBusy(false); }
  };

  const doDogMerge = async () => {
    if (!mergePreview?.primary?.id || !mergePreview?.duplicate?.id) return;
    setMergeBusy(true); setMergeError("");
    try {
      const r = await api.post('/admin/duplicates/dogs/merge', {
        primary_dog_id: mergePreview.primary.id,
        duplicate_dog_id: mergePreview.duplicate.id,
        confirm_text: confirmText,
        note: mergeNote,
      });
      setMergeResult(r.data || {});
      await run();
    } catch (e) {
      setMergeError(e.response?.data?.detail || "Could not complete merge");
    } finally { setMergeBusy(false); }
  };

  const closeMerge = () => { setMergePreview(null); setMergeResult(null); setMergeError(""); setConfirmText(""); setMergeNote(""); };

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
        highlight="Safe merge preview."
        subtitle="Find possible duplicate clients and dogs. Same-owner duplicate dogs can be merged only after a dry-run preview. Clients are still preview-only."
        right={<button onClick={run} disabled={loading} className="bg-shGreen text-black px-4 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest"><i className="fas fa-magnifying-glass mr-2"/>{loading ? "Scanning…" : "Run Check"}</button>}
        testid="duplicate-check-hero"
      />

      <MergePreviewModal preview={mergePreview} result={mergeResult} busy={mergeBusy} confirmText={confirmText} setConfirmText={setConfirmText} note={mergeNote} setNote={setMergeNote} onClose={closeMerge} onMerge={doDogMerge} error={mergeError} />

      <div className="bg-shBlue/10 border border-shBlue/30 rounded-xl p-4 text-sm text-gray-300">
        <p className="font-black text-shBlue uppercase tracking-widest text-xs mb-2"><i className="fas fa-shield-halved mr-2"/>Safe workflow</p>
        <p>This screen searches for likely duplicates. Dog merge is available only for same-owner dogs and always archives the duplicate instead of deleting it. Client merges remain preview-only until they get their own dry-run workflow.</p>
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
            {clientCandidates.length === 0 ? <div className="bg-bgPanel border border-bgHover rounded-xl p-5 text-gray-400 text-sm">No possible duplicate clients in this filter.</div> : clientCandidates.map((cand)=><CandidateCard key={cand.id} cand={cand} type="client" onDogMergePreview={previewDogMerge} />)}
          </section>

          <section className="space-y-3">
            <h2 className="text-white font-black uppercase italic"><i className="fas fa-paw text-shGreen mr-2"/>Possible duplicate dogs</h2>
            {dogCandidates.length === 0 ? <div className="bg-bgPanel border border-bgHover rounded-xl p-5 text-gray-400 text-sm">No possible duplicate dogs in this filter.</div> : dogCandidates.map((cand)=><CandidateCard key={cand.id} cand={cand} type="dog" onDogMergePreview={previewDogMerge} />)}
          </section>
        </>
      )}

      {!data && !loading && <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-gray-400 text-sm">Run the check when you want to scan for duplicates. It is safe to run any time.</div>}
    </div>
  );
}
