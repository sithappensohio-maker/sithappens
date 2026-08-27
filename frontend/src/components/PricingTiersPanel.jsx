import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import { useConfirm, usePromptDialog } from "../lib/useConfirm";

/* Pricing Tiers — a lightweight, reusable alternative to entering the same
 * individual client override on every "Grandfathered Clients" / "Founding
 * Clients" / "Staff Pricing" client one at a time. A client is assigned to
 * AT MOST one tier (clients.pricing_tier_id, a single field) and the SAME
 * resolve_client_price() every individual override already goes through
 * checks the tier price ONLY when no individual override exists for that
 * client — see server.py's resolve_client_price docstring for the full
 * precedence. Tiers are never hard-deleted, only deactivated, so a past
 * order's `pricing_tier_name` snapshot always has something real behind it.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const KIND_LABELS = { service: "Service", credit_pack: "Credit Pack", pos_product: "Product" };

function TierList({ tiers, onOpen, onCreate }) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreate(name.trim());
      setName("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tier name, e.g. Founding Clients"
               data-testid="tier-new-name-input"
               className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
        <button onClick={create} disabled={creating || !name.trim()} data-testid="tier-create-btn"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-40">
          + Create Tier
        </button>
      </div>
      {tiers.length === 0 ? (
        <p className="text-shTextMuted text-sm italic text-center py-6">No pricing tiers yet.</p>
      ) : (
        <ul className="space-y-2" data-testid="tier-list">
          {tiers.map((t) => (
            <li key={t.id} onClick={() => onOpen(t)} data-testid={`tier-row-${t.id}`}
                className={`bg-[var(--sh-card-base)]/40 border rounded-lg p-3 flex items-center justify-between cursor-pointer hover:border-shPrimary/50 transition ${t.active ? "border-shBorder" : "border-shBorder opacity-60"}`}>
              <div>
                <p className="text-shText font-bold">{t.name}</p>
                <p className="text-[11px] text-shTextMuted uppercase tracking-widest font-bold mt-0.5">
                  {t.client_count} client{t.client_count === 1 ? "" : "s"} · {t.priced_item_count} priced item{t.priced_item_count === 1 ? "" : "s"}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${t.active ? "bg-shPrimary/15 text-shPrimary" : "bg-shBorder text-shTextMuted"}`}>
                {t.active ? "Active" : "Inactive"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddTierPriceFlow({ catalogs, onSave, onCancel }) {
  const [kind, setKind] = useState("service");
  const [code, setCode] = useState("");
  const [price, setPrice] = useState("");
  const catalog = catalogs[kind] || [];
  const selected = catalog.find((r) => r.id === code);
  const listPrice = kind === "service" ? (selected?.base_price || 0) : (selected?.price || 0);

  return (
    <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded-xl p-4 space-y-3" data-testid="tier-add-price-flow">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Type</label>
          <select value={kind} onChange={(e) => { setKind(e.target.value); setCode(""); }}
                  data-testid="tier-kind-select"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="service">Service</option>
            <option value="credit_pack">Credit Pack</option>
            <option value="pos_product">Physical Product</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Exact item</label>
          <select value={code} onChange={(e) => setCode(e.target.value)}
                  data-testid="tier-item-select"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="">— Choose —</option>
            {catalog.map((r) => (
              <option key={r.id} value={r.id}>{r.name} (current ${kind === "service" ? r.base_price : r.price})</option>
            ))}
          </select>
        </div>
      </div>
      {selected && <p className="text-[13px] text-shTextMuted">Current standard price: <span className="text-shText font-bold">{money(listPrice)}</span></p>}
      <div>
        <label className="block text-[11px] text-shTextMuted mb-1 uppercase tracking-widest font-black">Tier price ($)</label>
        <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
               data-testid="tier-price-input"
               className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-shTextMuted font-black uppercase text-[13px] tracking-widest px-3 py-2">Cancel</button>
        <button onClick={() => onSave({ target_kind: kind, target_code: code, override_price: Number(price) })}
                disabled={!code || price === "" || Number(price) < 0}
                data-testid="tier-save-price-btn"
                className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-40">
          Save
        </button>
      </div>
    </div>
  );
}

function TierDetail({ tier, onBack, onRefresh }) {
  const confirm = useConfirm();
  const promptDialog = usePromptDialog();
  const [detail, setDetail] = useState(null);
  const [addingPrice, setAddingPrice] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [catalogs, setCatalogs] = useState({ service: [], credit_pack: [], pos_product: [] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/pricing-tiers/${tier.id}`).then(({ data }) => setDetail(data)).catch(() => toast.error("Could not load tier"));
  }, [tier.id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      api.get("/services"), api.get("/credit-packs"), api.get("/pos/products"),
    ]).then(([svcs, packs, prods]) => {
      setCatalogs({
        service: (svcs.data || []).filter((s) => s.active !== false && !s.is_addon),
        credit_pack: (packs.data || []).filter((p) => p.active !== false),
        // Shopify-linked merchandise is never a valid tier-price target —
        // Shopify controls that price, not pricing tiers (backend rejects it
        // too; this just keeps the picker from offering it).
        pos_product: (prods.data || []).filter((p) => p.active !== false && !p.archived && p.sales_destination !== "shopify_external"),
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const needle = clientQuery.trim();
    if (needle.length < 2) { setClientResults([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.get("/clients/options", { params: { q: needle, limit: 8 } }).then(({ data }) => {
        if (!cancelled) setClientResults(data || []);
      }).catch(() => { if (!cancelled) setClientResults([]); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clientQuery]);


  const toggleActive = async () => {
    try {
      await api.put(`/pricing-tiers/${tier.id}`, { active: !detail.active });
      load(); onRefresh();
    } catch (e) { toast.error(formatErr(e)); }
  };

  const rename = async () => {
    const name = await promptDialog({
      title: "Rename pricing tier",
      body: "Choose the label staff will see anywhere this pricing tier is used.",
      defaultValue: detail.name,
      placeholder: "Tier name",
      confirmText: "Rename",
      tone: "info",
    });
    if (name === null || !name.trim() || name.trim() === detail.name) return;
    try {
      await api.put(`/pricing-tiers/${tier.id}`, { name: name.trim() });
      load(); onRefresh();
    } catch (e) { toast.error(formatErr(e)); }
  };

  const assignClient = async (client) => {
    setBusy(true);
    try {
      await api.post(`/pricing-tiers/${tier.id}/clients/${client.id}`);
      toast.success(`${client.name} assigned to ${detail.name}`);
      setClientQuery(""); setClientResults([]);
      load(); onRefresh();
    } catch (e) { toast.error(formatErr(e)); }
    setBusy(false);
  };

  const unassignClient = async (client) => {
    const ok = await confirm({
      title: `Remove ${client.name} from ${detail.name}?`,
      body: "They will immediately pay standard pricing unless they have an individual override.",
      confirmText: "Remove Client",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await api.delete(`/pricing-tiers/${tier.id}/clients/${client.id}`);
      load(); onRefresh();
    } catch (e) { toast.error(formatErr(e)); }
  };

  const savePrice = async (entry) => {
    try {
      await api.post(`/pricing-tiers/${tier.id}/prices`, entry);
      setAddingPrice(false);
      load(); onRefresh();
    } catch (e) { toast.error(formatErr(e)); }
  };

  const removePrice = async (price) => {
    const ok = await confirm({
      title: `Remove tier price for ${price.target_name}?`,
      body: "Assigned clients will fall back to their individual override or the standard price for this item.",
      confirmText: "Remove Price",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await api.delete(`/pricing-tiers/${tier.id}/prices/${price.id}`);
      load(); onRefresh();
    } catch (e) { toast.error(formatErr(e)); }
  };

  if (!detail) return <div className="text-center text-shTextMuted py-6 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-shPrimary text-[11px] font-black uppercase tracking-widest">
          <i className="fas fa-chevron-left mr-1" />Back to tiers
        </button>
        <div className="flex gap-2">
          <button onClick={rename} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Rename</button>
          <button onClick={toggleActive} data-testid="tier-toggle-active"
                  className={`text-[11px] font-black uppercase tracking-widest ${detail.active ? "text-red-400" : "text-shPrimary"}`}>
            {detail.active ? "Deactivate" : "Activate"}
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-shText font-black text-xl">{detail.name}</h3>
        <p className="text-[12px] text-shTextMuted uppercase tracking-widest font-bold mt-0.5">
          {detail.active ? "Active — applies to assigned clients" : "Inactive — assigned clients pay standard pricing until reactivated"}
        </p>
      </div>

      <div>
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Assigned Clients ({detail.clients.length})</p>
        <div className="relative mb-2">
          <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Search client to assign…"
                 data-testid="tier-assign-client-input"
                 className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          {clientResults.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-bgCard border border-shBorder rounded-lg shadow-2xl max-h-56 overflow-y-auto">
              {clientResults.map((c) => (
                <button key={c.id} onClick={() => assignClient(c)} disabled={busy} data-testid={`tier-assign-result-${c.id}`}
                        className="w-full text-left px-3 py-2 hover:bg-shSurfaceRaised/60 text-shText text-sm">
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        {detail.clients.length === 0 ? (
          <p className="text-[13px] text-shTextMuted italic">No clients assigned yet.</p>
        ) : (
          <ul className="space-y-1.5" data-testid="tier-clients-list">
            {detail.clients.map((c) => (
              <li key={c.id} className="flex items-center justify-between bg-[var(--sh-card-base)]/40 border border-shBorder rounded p-2">
                <span className="text-shText text-sm">{c.name}</span>
                <button onClick={() => unassignClient(c)} data-testid={`tier-unassign-${c.id}`}
                        className="text-red-400 text-[11px] font-black uppercase tracking-widest">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Priced Items ({detail.prices.length})</p>
          {!addingPrice && (
            <button onClick={() => setAddingPrice(true)} data-testid="tier-add-price-btn"
                    className="text-shPrimary text-[11px] font-black uppercase tracking-widest">+ Add Item Price</button>
          )}
        </div>
        {addingPrice && <AddTierPriceFlow catalogs={catalogs} onSave={savePrice} onCancel={() => setAddingPrice(false)} />}
        {detail.prices.length === 0 ? (
          <p className="text-[13px] text-shTextMuted italic mt-2">No item prices set for this tier yet.</p>
        ) : (
          <ul className="space-y-1.5 mt-2" data-testid="tier-prices-list">
            {detail.prices.map((p) => (
              <li key={p.id} className="flex items-center justify-between bg-[var(--sh-card-base)]/40 border border-shBorder rounded p-2">
                <div>
                  <span className="text-shText text-sm font-bold">{p.target_name}</span>
                  <span className="text-[11px] text-shTextMuted uppercase tracking-widest ml-2">{KIND_LABELS[p.target_kind] || p.target_kind}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-amber-400 font-bold text-sm">{money(p.override_price)}</span>
                  <button onClick={() => removePrice(p)} className="text-red-400 text-[11px] font-black uppercase tracking-widest">Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function PricingTiersPanel() {
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openTier, setOpenTier] = useState(null);

  const load = () => {
    setLoading(true);
    api.get("/pricing-tiers").then(({ data }) => setTiers(data.tiers || []))
      .catch(() => toast.error("Could not load pricing tiers"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const createTier = async (name) => {
    try {
      await api.post("/pricing-tiers", { name });
      load();
    } catch (e) { toast.error(formatErr(e)); }
  };

  return (
    <div className="space-y-4" data-testid="pricing-tiers-panel">
      <p className="text-[13px] text-shTextMuted max-w-2xl leading-relaxed">
        Grandfathered pricing groups (e.g. "Founding Clients", "Staff Pricing") — a reusable alternative to setting
        the same individual price on every client one at a time. A client's individual price (Client Record Hub →
        Money → Special Pricing) always beats their tier price for the same item.
      </p>
      {loading ? (
        <div className="text-center text-shTextMuted py-6 text-sm">Loading…</div>
      ) : openTier ? (
        <TierDetail tier={openTier} onBack={() => setOpenTier(null)} onRefresh={load} />
      ) : (
        <TierList tiers={tiers} onOpen={setOpenTier} onCreate={createTier} />
      )}
    </div>
  );
}
