import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useEditLock } from "../lib/useLiveRefresh";

// Sprint 110am — Per-client price overrides ("Client-Specific Pricing").
// Admins use this to lock an individual client into a fixed final price for
// ONE exact service or credit pack, independent of the public catalog rate.
// Service prices and credit-pack prices are intentionally separate — a
// credit pack's price is never derived from a service rate, a quantity
// multiplier, or any formula; it is always the exact price the admin typed.
// The backend resolves the effective price at booking-checkout, credit-
// pack-sell, and Shop-checkout time via resolve_client_price(), so the
// override can't be bypassed even if a curious user inspects the network
// tab. "Legacy Pricing" is kept only as a secondary/compat label since
// existing tooling and this file's own historical name still use it.
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const KIND_LABELS = { service: "Service", credit_pack: "Credit Pack", pos_product: "Product" };
const KIND_ICONS = { service: "fa-tag", credit_pack: "fa-coins", pos_product: "fa-box" };
const kindLabel = (kind) => KIND_LABELS[kind] || kind;
const kindIcon = (kind) => KIND_ICONS[kind] || "fa-tag";

function statusBadgeClass(row) {
  if (row.status === "revoked") return "bg-shBorder text-shTextMuted";
  if (!row.active) return "bg-red-500/15 text-red-400";
  if (row.expires_on) return "bg-amber-500/15 text-amber-400";
  return "bg-shPrimary/15 text-shPrimary";
}

function OverrideRow({ row, onRevoke }) {
  return (
    <li data-testid={`override-row-${row.id}`}
        className={`bg-[var(--sh-card-base)]/40 border rounded-lg p-3 flex flex-wrap items-center gap-3 ${row.active ? "border-amber-500/30" : "border-shBorder opacity-70"}`}>
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/15 grid place-items-center">
        <i className={`fas ${kindIcon(row.target_kind)} text-amber-400`} />
      </div>
      <div className="flex-1 min-w-[180px]">
        <div className="text-sm font-bold text-shText truncate">{row.target_name}</div>
        <div className="text-[11px] text-shTextMuted uppercase tracking-widest font-bold mt-0.5">
          {kindLabel(row.target_kind)}
        </div>
      </div>
      <div className="text-[13px] text-shTextMuted min-w-[110px]">
        <div className="text-[10px] uppercase tracking-widest font-black text-gray-600">Public price</div>
        <div>{money(row.list_price)}</div>
      </div>
      <div className="text-[13px] min-w-[110px]">
        <div className="text-[10px] uppercase tracking-widest font-black text-gray-600">Client price</div>
        <div className="text-amber-400 font-bold">{money(row.override_price)}</div>
      </div>
      <div className="text-[13px] min-w-[90px]">
        <div className="text-[10px] uppercase tracking-widest font-black text-gray-600">Savings</div>
        <div className={row.savings > 0 ? "text-shPrimary" : "text-shTextMuted"}>
          {row.savings > 0 ? `$${row.savings.toFixed(2)}` : "—"}
        </div>
      </div>
      <div className="min-w-[110px]">
        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-widest ${statusBadgeClass(row)}`}
              data-testid={`override-status-${row.id}`}>
          {row.status_label}
        </span>
      </div>
      <div className="flex flex-col gap-1 ml-auto">
        {row.status !== "revoked" && (
          <button onClick={() => onRevoke(row)}
                  data-testid={`override-revoke-${row.id}`}
                  className="text-[11px] font-black uppercase text-red-400 hover:text-red-300 tracking-widest">
            <i className="fas fa-rotate-left mr-1" />Return to standard price
          </button>
        )}
      </div>
    </li>
  );
}

function AddOverrideFlow({ catalogFor, draft, setDraft, onCancel, onSave, err }) {
  const catalog = catalogFor(draft.target_kind);
  const selectedRow = catalog.find((r) => r.id === draft.target_code);
  const listPrice = draft.target_kind === "service" ? (selectedRow?.base_price || 0) : (selectedRow?.price || 0);
  const priceValid = draft.override_price !== "" && Number(draft.override_price) >= 0;
  const datesValid = !draft.starts_on || !draft.expires_on || draft.starts_on <= draft.expires_on;

  return (
    <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded-xl p-4 space-y-3" data-testid="add-override-flow">
      <div className="text-[12px] font-black uppercase tracking-widest text-shPrimary">
        <i className="fas fa-plus-circle mr-1" />Set a client-specific price
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">1. Type</label>
          <select value={draft.target_kind}
                  onChange={(e) => setDraft((d) => ({ ...d, target_kind: e.target.value, target_code: "" }))}
                  data-testid="legacy-kind-select"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="service">Service</option>
            <option value="credit_pack">Credit Pack</option>
            <option value="pos_product">Physical Product</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">2. Exact item</label>
          <select value={draft.target_code}
                  onChange={(e) => setDraft((d) => ({ ...d, target_code: e.target.value }))}
                  data-testid="legacy-target-select"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="">— Choose —</option>
            {catalog.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (current ${draft.target_kind === "service" ? r.base_price : r.price})
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedRow && (
        <div className="text-[13px] text-shTextMuted">
          3. Current public price: <span className="text-shText font-bold">{money(listPrice)}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">4. Client-specific final price ($)</label>
          <input type="number" min="0" step="0.01" value={draft.override_price}
                 onChange={(e) => setDraft((d) => ({ ...d, override_price: e.target.value }))}
                 data-testid="legacy-price-input"
                 placeholder="e.g. 350.00"
                 className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
        </div>
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">5. Expiration (optional)</label>
          <input type="date" value={draft.expires_on}
                 onChange={(e) => setDraft((d) => ({ ...d, expires_on: e.target.value }))}
                 data-testid="legacy-expiry-input"
                 className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          <p className="text-[11px] text-shTextMuted mt-1 italic">Leave blank for no expiration.</p>
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">6. Start date (optional)</label>
        <input type="date" value={draft.starts_on || ""}
               onChange={(e) => setDraft((d) => ({ ...d, starts_on: e.target.value }))}
               data-testid="legacy-starts-input"
               className="w-full max-w-[calc(50%_-_0.375rem)] bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
        <p className="text-[11px] text-shTextMuted mt-1 italic">Leave blank to apply immediately.</p>
      </div>

      {selectedRow && priceValid && (
        <div className="bg-shPrimary/5 border border-shPrimary/30 rounded-lg p-3 text-[13px] text-shText leading-relaxed"
             data-testid="legacy-preview">
          <i className="fas fa-eye mr-1 text-shPrimary" />
          This client will pay <span className="font-bold text-shPrimary">{money(draft.override_price)}</span> for{" "}
          <span className="font-bold">{selectedRow.name}</span>.
          {" "}The current public price is {money(listPrice)}.
          {draft.target_kind === "credit_pack"
            ? " This does not change this client's single-day service prices."
            : draft.target_kind === "pos_product"
            ? " This does not change this client's service or credit-pack prices."
            : " This does not change this client's credit-pack prices."}
          {draft.starts_on && <> This price starts on {draft.starts_on}.</>}
          {draft.expires_on && <> This price expires on {draft.expires_on}.</>}
        </div>
      )}
      {!datesValid && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-2 rounded">Start date must be on or before the expiration date.</div>}

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-2 rounded">{err}</div>}

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-shTextMuted font-black uppercase text-[13px] tracking-widest px-3 py-2 hover:text-shText">
          Cancel
        </button>
        <button onClick={() => onSave(draft)}
                disabled={!selectedRow || !priceValid || !datesValid}
                data-testid="legacy-save-btn"
                className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[13px] tracking-widest hover:bg-shPrimary/90 disabled:opacity-40 disabled:cursor-not-allowed">
          <i className="fas fa-check mr-1" />Save this price
        </button>
      </div>
    </div>
  );
}

function BulkApplyFlow({ services, packs, onCancel, onSave, err }) {
  const [step, setStep] = useState(1);
  const [selections, setSelections] = useState([]); // [{target_kind, target_code, override_price, expires_on}]

  const allItems = useMemo(() => [
    ...services.map((s) => ({ target_kind: "service", target_code: s.id, name: s.name, listPrice: s.base_price })),
    ...packs.map((p) => ({ target_kind: "credit_pack", target_code: p.id, name: p.name, listPrice: p.price })),
  ], [services, packs]);

  const toggle = (item) => {
    setSelections((prev) => {
      const exists = prev.find((s) => s.target_kind === item.target_kind && s.target_code === item.target_code);
      if (exists) return prev.filter((s) => !(s.target_kind === item.target_kind && s.target_code === item.target_code));
      return [...prev, { ...item, override_price: "", expires_on: "" }];
    });
  };
  const updateSelection = (item, patch) => {
    setSelections((prev) => prev.map((s) =>
      (s.target_kind === item.target_kind && s.target_code === item.target_code) ? { ...s, ...patch } : s));
  };

  const readyForReview = selections.length > 0 && selections.every((s) => s.override_price !== "" && Number(s.override_price) >= 0);

  return (
    <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded-xl p-4 space-y-3" data-testid="bulk-apply-flow">
      <div className="text-[12px] font-black uppercase tracking-widest text-shPrimary">
        <i className="fas fa-layer-group mr-1" />Apply pricing set
      </div>

      {step === 1 && (
        <>
          <p className="text-[12px] text-shTextMuted">Select every service and credit pack this client should get an exact final price on.</p>
          <div className="max-h-64 overflow-y-auto space-y-1">
            {allItems.map((item) => {
              const checked = selections.some((s) => s.target_kind === item.target_kind && s.target_code === item.target_code);
              return (
                <label key={`${item.target_kind}:${item.target_code}`}
                       className="flex items-center gap-2 p-2 rounded border border-shBorder cursor-pointer text-[13px] text-shText"
                       data-testid={`bulk-item-${item.target_kind}-${item.target_code}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(item)} />
                  <span className="flex-1">{item.name}</span>
                  <span className="text-[11px] uppercase tracking-widest text-shTextMuted">{item.target_kind === "service" ? "Service" : "Credit Pack"}</span>
                  <span className="text-shTextMuted">{money(item.listPrice)}</span>
                </label>
              );
            })}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={onCancel} className="text-shTextMuted font-black uppercase text-[13px] tracking-widest px-3 py-2 hover:text-shText">Cancel</button>
            <button onClick={() => setStep(2)} disabled={selections.length === 0}
                    data-testid="bulk-next-btn"
                    className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[13px] tracking-widest hover:bg-shPrimary/90 disabled:opacity-40">
              Next <i className="fas fa-arrow-right ml-1" />
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-[12px] text-shTextMuted">Enter the exact final price for each item.</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {selections.map((s) => (
              <div key={`${s.target_kind}:${s.target_code}`} className="grid grid-cols-3 gap-2 items-center p-2 border border-shBorder rounded">
                <span className="text-[13px] text-shText truncate">{s.name} <span className="text-shTextMuted">({money(s.listPrice)})</span></span>
                <input type="number" min="0" step="0.01" placeholder="Final price"
                       value={s.override_price}
                       onChange={(e) => updateSelection(s, { override_price: e.target.value })}
                       data-testid={`bulk-price-${s.target_kind}-${s.target_code}`}
                       className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm" />
                <input type="date" value={s.expires_on}
                       onChange={(e) => updateSelection(s, { expires_on: e.target.value })}
                       className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm" />
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setStep(1)} className="text-shTextMuted font-black uppercase text-[13px] tracking-widest px-3 py-2 hover:text-shText">Back</button>
            <button onClick={() => setStep(3)} disabled={!readyForReview}
                    data-testid="bulk-review-btn"
                    className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[13px] tracking-widest hover:bg-shPrimary/90 disabled:opacity-40">
              Review <i className="fas fa-arrow-right ml-1" />
            </button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p className="text-[12px] text-shTextMuted font-black uppercase tracking-widest">Review before saving</p>
          <table className="w-full text-[13px]" data-testid="bulk-review-table">
            <thead>
              <tr className="text-[11px] uppercase tracking-widest text-shTextMuted text-left">
                <th className="pb-1">Item</th><th className="pb-1">Public price</th><th className="pb-1">New client price</th><th className="pb-1">Expires</th>
              </tr>
            </thead>
            <tbody>
              {selections.map((s) => (
                <tr key={`${s.target_kind}:${s.target_code}`} className="border-t border-shBorder">
                  <td className="py-1 text-shText">{s.name}</td>
                  <td className="py-1 text-shTextMuted">{money(s.listPrice)}</td>
                  <td className="py-1 text-amber-400 font-bold">{money(s.override_price)}</td>
                  <td className="py-1 text-shTextMuted">{s.expires_on || "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-2 rounded">{err}</div>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setStep(2)} className="text-shTextMuted font-black uppercase text-[13px] tracking-widest px-3 py-2 hover:text-shText">Back</button>
            <button onClick={() => onSave(selections)}
                    data-testid="bulk-save-btn"
                    className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[13px] tracking-widest hover:bg-shPrimary/90">
              <i className="fas fa-check mr-1" />Save pricing set
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function LegacyPricingModal({ client, onClose }) {
  useEditLock(true);
  const [overrides, setOverrides] = useState([]);
  const [services, setServices] = useState([]);
  const [packs, setPacks] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExpired, setShowExpired] = useState(false);
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState({ target_kind: "service", target_code: "", override_price: "", starts_on: "", expires_on: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [over, svcs, pcks, prods] = await Promise.all([
        api.get(`/clients/${client.id}/price-overrides`, { params: { include_expired: showExpired } }),
        api.get("/services"),
        api.get("/credit-packs"),
        api.get("/pos/products"),
      ]);
      setOverrides(over.data.overrides || []);
      setServices((svcs.data || []).filter((s) => s.active !== false && !s.is_addon));
      setPacks((pcks.data || []).filter((p) => p.active !== false));
      // Shopify-linked merchandise is never a valid override target — Shopify
      // controls that price, not client-specific/grandfathered pricing (the
      // backend rejects it too; this just keeps the picker from offering it).
      setProducts((prods.data || []).filter((p) => p.active !== false && !p.archived && p.sales_destination !== "shopify_external"));
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }, [client.id, showExpired]);
  useEffect(() => { load(); }, [load]);

  const catalogFor = (kind) => (kind === "service" ? services : kind === "credit_pack" ? packs : products);

  const save = async (d) => {
    setErr("");
    if (!d.target_code) return setErr("Pick which item to set a price on.");
    if (d.override_price === "" || Number(d.override_price) < 0) return setErr("Enter a valid client-specific price.");
    if (d.starts_on && d.expires_on && d.starts_on > d.expires_on) return setErr("Start date must be on or before the expiration date.");
    try {
      await api.post(`/clients/${client.id}/price-overrides`, {
        target_kind: d.target_kind, target_code: d.target_code,
        override_price: Number(d.override_price), starts_on: d.starts_on || null, expires_on: d.expires_on || null,
      });
      setAdding(false);
      setDraft({ target_kind: "service", target_code: "", override_price: "", starts_on: "", expires_on: "" });
      load();
    } catch (e) {
      setErr(formatErr(e));
    }
  };

  const saveBulk = async (selections) => {
    setErr("");
    try {
      const { data } = await api.post(`/clients/${client.id}/price-overrides/bulk-apply`, {
        entries: selections.map((s) => ({
          target_kind: s.target_kind, target_code: s.target_code,
          override_price: Number(s.override_price), expires_on: s.expires_on || null,
        })),
      });
      if (data.errors && data.errors.length) {
        setErr(`Applied ${data.applied} of ${selections.length}. ${data.errors.length} failed — ${data.errors[0].detail}`);
      } else {
        setBulkOpen(false);
      }
      load();
    } catch (e) {
      setErr(formatErr(e));
    }
  };

  const revoke = async (row) => {
    const ok = window.confirm(
      `Return "${row.target_name}" to standard pricing?\n\n` +
      `This client will immediately pay the current public price (${money(row.list_price)}) on their next purchase. ` +
      `This override's history is kept, not deleted. Nothing about past bookings, orders, payments, or credit lots changes.`
    );
    if (!ok) return;
    try {
      await api.delete(`/price-overrides/${row.id}`);
      load();
    } catch (e) {
      setErr(formatErr(e));
    }
  };

  const serviceRows = overrides.filter((r) => r.target_kind === "service");
  const packRows = overrides.filter((r) => r.target_kind === "credit_pack");
  const productRows = overrides.filter((r) => r.target_kind === "pos_product");

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 grid place-items-center p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
         data-testid="legacy-pricing-modal">
      <div className="bg-bgCard border border-shBorder rounded-2xl shadow-2xl w-full max-w-3xl max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-amber-500/20 to-amber-500/5 border-b border-amber-500/30 p-5 z-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] font-black text-amber-400 mb-1">
                <i className="fas fa-tag mr-1" />Client-Specific Pricing <span className="text-shTextMuted normal-case tracking-normal font-normal">(Legacy Pricing)</span>
              </div>
              <h2 className="text-2xl font-black tracking-tight text-shText">{client.name}</h2>
              <p className="text-[13px] text-shTextMuted mt-1 max-w-lg leading-relaxed">
                Set a fixed price for an individual client. Service prices and credit-pack prices are separate.
                Changing the public price will not change an active client-specific price.
              </p>
            </div>
            <button onClick={onClose} data-testid="legacy-close"
                    className="text-shTextMuted hover:text-shText text-xl"><i className="fas fa-times" /></button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {err && !adding && !bulkOpen && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="legacy-error">
              {err}
            </div>
          )}

          {!adding && !bulkOpen && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-[12px] text-shTextMuted font-black uppercase tracking-widest flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
                Include expired / revoked
              </label>
              <div className="flex gap-2">
                <button onClick={() => setBulkOpen(true)}
                        data-testid="legacy-bulk-btn"
                        className="border border-shBorder text-shText px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:border-shPrimary/60">
                  <i className="fas fa-layer-group mr-1" />Apply pricing set
                </button>
                <button onClick={() => setAdding(true)}
                        data-testid="legacy-add-btn"
                        className="bg-shPrimary text-bgBase px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shPrimary/90">
                  <i className="fas fa-plus mr-1" />Set a price
                </button>
              </div>
            </div>
          )}

          {adding && (
            <AddOverrideFlow catalogFor={catalogFor} draft={draft} setDraft={setDraft}
                              onCancel={() => { setAdding(false); setErr(""); }} onSave={save} err={err} />
          )}

          {bulkOpen && (
            <BulkApplyFlow services={services} packs={packs}
                            onCancel={() => { setBulkOpen(false); setErr(""); }} onSave={saveBulk} err={err} />
          )}

          {!adding && !bulkOpen && (
            loading ? (
              <div className="text-center text-shTextMuted py-6 text-sm">Loading…</div>
            ) : overrides.length === 0 ? (
              <div className="text-center text-shTextMuted py-8 text-sm italic">
                <i className="fas fa-tag text-2xl block mb-2 text-gray-700" />
                No client-specific prices yet. This client pays standard pricing for everything.
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Service Prices</p>
                  {serviceRows.length === 0 ? (
                    <p className="text-[13px] text-shTextMuted italic">No client-specific service prices.</p>
                  ) : (
                    <ul className="space-y-2" data-testid="legacy-service-overrides-list">
                      {serviceRows.map((row) => <OverrideRow key={row.id} row={row} onRevoke={revoke} />)}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Credit-Pack Prices</p>
                  {packRows.length === 0 ? (
                    <p className="text-[13px] text-shTextMuted italic">No client-specific credit-pack prices.</p>
                  ) : (
                    <ul className="space-y-2" data-testid="legacy-pack-overrides-list">
                      {packRows.map((row) => <OverrideRow key={row.id} row={row} onRevoke={revoke} />)}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Product Prices</p>
                  {productRows.length === 0 ? (
                    <p className="text-[13px] text-shTextMuted italic">No client-specific product prices.</p>
                  ) : (
                    <ul className="space-y-2" data-testid="legacy-product-overrides-list">
                      {productRows.map((row) => <OverrideRow key={row.id} row={row} onRevoke={revoke} />)}
                    </ul>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
