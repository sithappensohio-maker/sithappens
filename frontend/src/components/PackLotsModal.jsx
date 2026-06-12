import { useEffect, useState } from "react";
import { api } from "../lib/api";

// Sprint 110da — Quick reference modal for the operator to see ALL credit
// lots on a client at once, with a clear "Legacy" vs "Paid at sale" badge
// per lot. Legacy lots (no `recognize_at_sale` flag) still drive revenue
// when each credit is redeemed — operator enters a $ amount at checkout.
// Sprint 110cs+ lots are pre-paid revenue, no further action at checkout.
//
// Read-only by design. Adjust / consume happens elsewhere.
export default function PackLotsModal({ client, onClose }) {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showDrained, setShowDrained] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr("");
      // Tiny retry-on-429: React StrictMode double-fires effects in dev and
      // the ingress can rate-limit two parallel requests. One short retry
      // recovers gracefully without bothering the operator.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await api.get(`/clients/${client.id}/credit-lots`);
          if (cancelled) return;
          setLots(Array.isArray(r.data) ? r.data : []);
          setLoading(false);
          return;
        } catch (e) {
          if (cancelled) return;
          if (e?.response?.status === 429 && attempt < 2) {
            await new Promise(res => setTimeout(res, 600 + attempt * 400));
            continue;
          }
          setErr(e?.response?.data?.detail || "Couldn't load lots");
          setLots([]);
          setLoading(false);
          return;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [client.id]);

  const visible = lots.filter(l => showDrained || (l.qty_remaining || 0) > 0);
  const legacy = visible.filter(l => !l.recognize_at_sale && !l.pack_kind);
  const paidAtSale = visible.filter(l => l.recognize_at_sale === true);
  const programs = visible.filter(l => l.pack_kind === "training_program");

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
         data-testid="pack-lots-modal" onClick={onClose}>
      <div onClick={(e)=>e.stopPropagation()}
           className="bg-bgPanel border border-bgHover rounded-xl p-5 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-1">
          <div>
            <h2 className="text-[20px] font-black text-white uppercase italic tracking-tight">Pack Lots</h2>
            <p className="text-[13px] text-gray-400 font-black uppercase tracking-widest">{client.name}</p>
          </div>
          <button onClick={onClose} data-testid="pack-lots-close"
                  className="text-gray-400 hover:text-white text-xl px-2"><i className="fas fa-times"/></button>
        </div>

        <p className="text-[12px] text-gray-400 mt-2 mb-4 leading-relaxed">
          <i className="fas fa-circle-info mr-1 text-shBlue"/>
          <strong className="text-shBlue">Paid at sale</strong> = revenue already counted, no $ at checkout.
          <strong className="text-amber-400 ml-2">Legacy</strong> = pre-existing pack — system uses the per-credit value stored at sell-time.
        </p>

        {loading ? (
          <p className="text-gray-500 text-sm italic" data-testid="pack-lots-loading">Loading lots…</p>
        ) : err ? (
          <p className="text-red-400 text-[14px]" data-testid="pack-lots-error">{err}</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-500 text-[14px] italic" data-testid="pack-lots-empty">
            No active credit lots. {!showDrained && lots.length > 0 && "Toggle below to see fully drained lots."}
          </p>
        ) : (
          <div className="space-y-4">
            {paidAtSale.length > 0 && (
              <LotGroup
                title="Paid at Sale (Sprint 110cs+)"
                color="text-shBlue"
                badgeClass="bg-shBlue/15 text-shBlue border-shBlue/40"
                badgeLabel="✓ Paid at sale"
                lots={paidAtSale}
                testidPrefix="lot-paid-at-sale"
              />
            )}
            {programs.length > 0 && (
              <LotGroup
                title="Training Programs"
                color="text-purple-300"
                badgeClass="bg-purple-500/15 text-purple-300 border-purple-500/40"
                badgeLabel="🎓 Program"
                lots={programs}
                testidPrefix="lot-program"
              />
            )}
            {legacy.length > 0 && (
              <LotGroup
                title="Legacy (needs $ at checkout)"
                color="text-amber-400"
                badgeClass="bg-amber-500/15 text-amber-400 border-amber-500/40"
                badgeLabel="🏷️ Legacy"
                lots={legacy}
                testidPrefix="lot-legacy"
              />
            )}
          </div>
        )}

        <label className="mt-5 flex items-center gap-2 text-[12px] text-gray-400 font-black uppercase tracking-widest cursor-pointer">
          <input type="checkbox" checked={showDrained} onChange={(e)=>setShowDrained(e.target.checked)}
                 data-testid="pack-lots-show-drained" className="accent-shBlue"/>
          Show fully drained lots
        </label>
      </div>
    </div>
  );
}

function LotGroup({ title, color, badgeClass, badgeLabel, lots, testidPrefix }) {
  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
  return (
    <div>
      <p className={`text-[12px] font-black uppercase tracking-widest mb-2 ${color}`}>
        {title} · {lots.length}
      </p>
      <div className="space-y-2">
        {lots.map(lot => {
          const totalQty = lot.qty_total || 0;
          const remaining = lot.qty_remaining || 0;
          const used = Math.max(totalQty - remaining, 0);
          const pct = totalQty > 0 ? Math.round((remaining / totalQty) * 100) : 0;
          const valueEach = Number(lot.value_each || 0);
          const drained = remaining <= 0;
          return (
            <div key={lot.id}
                 className={`bg-bgBase border rounded-lg p-3 ${drained ? "border-bgHover/40 opacity-60" : "border-bgHover"}`}
                 data-testid={`${testidPrefix}-${lot.id}`}>
              <div className="flex items-start gap-3 justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-white font-black truncate">{lot.pack_name || lot.pack_id || "Pack"}</p>
                  <p className="text-[12px] text-gray-400 mt-0.5">
                    <span className="font-black">{remaining}</span> of {totalQty} {lot.service_type || "credits"} remaining
                    {valueEach > 0 && <span className="text-gray-500"> · {fmt(valueEach)}/credit</span>}
                  </p>
                  <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest mt-1">
                    Sold {(lot.purchased_at || "").slice(0, 10)}
                    {lot.payment_method && ` · ${lot.payment_method}`}
                    {Number(lot.price_paid || 0) > 0 && ` · ${fmt(lot.price_paid)}`}
                  </p>
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest border rounded px-2 py-1 whitespace-nowrap ${badgeClass}`}>
                  {badgeLabel}
                </span>
              </div>
              {totalQty > 0 && (
                <div className="mt-2 h-1.5 bg-bgHover/60 rounded overflow-hidden">
                  <div className={`h-full ${drained ? "bg-gray-600" : "bg-shGreen"}`}
                       style={{ width: `${pct}%` }}/>
                </div>
              )}
              {used > 0 && (
                <p className="text-[10px] text-gray-500 mt-1 italic">
                  {used} used · {pct}% remaining
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
