import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import { toast } from "sonner";
import PageHero from "../components/PageHero";
import { useConfirm } from "../lib/useConfirm";
import { ProductEditor } from "../components/ManageProductsPanel";
import { PackEditor } from "../components/CreditPacksSettings";
import { ProgramEditor } from "../components/Programs";
import ItemThumbnail from "../components/ItemThumbnail";
import ShopImageUpload from "../components/ShopImageUpload";
import PortalShop from "../components/PortalShop";
import {
  inventoryStatus, itemWarnings, marginDisplay, filterItemsByView,
  orderRef, orderComputedStatus, filterOrdersByView, searchOrders,
} from "../lib/shopManagerPolish";

/* ============================================================================
 * Shop Manager — the ONE place to create, edit, organize, price, display,
 * and manage everything sold through the app.
 *
 * Architecture rule this file follows throughout: physical products, prepaid
 * credit packs, and training programs keep their existing specialized
 * models/business logic completely untouched (inventory/SKU/tax for
 * products; credits/expiration for packs; sessions/modules/enrollment for
 * programs). This screen unifies the ADMIN EXPERIENCE only — listing,
 * filtering, placement, and editing — by reusing the exact same editor
 * components the previous standalone screens used (ProductEditor,
 * PackEditor, ProgramEditor are all imported, not reimplemented) and the
 * exact same endpoints for every write.
 * ========================================================================== */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const WARNING_TONE_CLASS = {
  bad: "bg-red-500/10 text-red-400",
  warn: "bg-shOrange/10 text-shOrange",
  muted: "bg-shBorder/40 text-shTextMuted",
};

const SECTION_TABS = [
  { key: "all", label: "All" },
  { key: "merch", label: "Merch & Gear" },
  { key: "prepaid_visits", label: "Prepaid Visits" },
  { key: "training", label: "Training" },
];

const KIND_LABEL = { physical_product: "Product", credit_pack: "Prepaid Pack", training_program: "Training Program" };

const BLANK_PRODUCT_FORM = {
  name: "", category: "", description: "", price: "", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  show_online: false, online_description: "", image_id: null, online_sort_order: "",
  category_id: null, subcategory_id: null, featured: false, show_at_register: true,
  sales_destination: "internal", shopify_product_url: "", shopify_display_price: "", shopify_from_price: false,
  publicly_visible: false, guest_cart_allowed: false, show_public_price: true,
  requires_approval: false, requires_completed_onboarding: false,
};

const BLANK_PACK_FORM = {
  name: "", qty: 10, price: 300, service_type: "daycare", icon: "fa-tag", color: "", active: true, welcome_email_template_slug: null,
  available_online: false, online_description: "", image_id: null,
  category_id: null, subcategory_id: null, show_at_register: true, featured: false,
  publicly_visible: false, show_public_price: true, requires_completed_onboarding: false,
};

const blankProgramForm = (type = "private_lessons") => ({
  name: "", slug: "", type, description: "", focus: "",
  format: { count: 1, unit: "sessions" }, min_age_months: 0,
  prereq_slugs: [], modules: [], price: 0, active: true,
  available_online: false, online_description: "", image_id: null,
  category_id: null, subcategory_id: null, show_at_register: true, featured: false,
  publicly_visible: false, show_public_price: true,
  requires_dog: false, requires_approval: false, requires_completed_onboarding: false,
});

function itemKindLabel(it) {
  if (it.kind === "physical_product" && it.sales_destination === "shopify_external") return "Shopify Merchandise";
  return KIND_LABEL[it.kind];
}

function StatusPill({ active, label }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${
      active ? "bg-shPrimary/15 border-shPrimary/35 text-shPrimary" : "bg-shBorder/40 border-shBorder text-shTextMuted"
    }`}>
      <i className={`fas ${active ? "fa-circle-check" : "fa-circle-pause"}`} />{label || (active ? "Active" : "Inactive")}
    </span>
  );
}

/* ============================================================================
 * ITEMS TAB
 * ========================================================================== */
function ItemsTab({ onEditItem, onAddShopItem }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("all");
  // all | missing_details | uncategorized | low_stock | out_of_stock | hidden | inactive | archived
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [stockModal, setStockModal] = useState(null); // { item, mode: "receive" | "adjust" }
  const [stockQty, setStockQty] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [historyItem, setHistoryItem] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // product only, mirrors ManageProductsPanel's safe-delete flow
  const [hasHistory, setHasHistory] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setForbidden(false);
    const params = {};
    if (section !== "all") params.section = section;
    if (view === "uncategorized") params.category_id = "uncategorized";
    if (view === "hidden") params.hidden_only = true;
    // Archived products are excluded from the normal response by design —
    // this is the one view that deliberately asks for them instead.
    if (view === "archived") params.include_archived = true;
    api.get("/shop-manager/items", { params })
      .then(({ data }) => setItems(data.items || []))
      .catch((e) => {
        if (e?.response?.status === 403) setForbidden(true);
        else toast.error("Could not load Shop Manager items");
      })
      .finally(() => setLoading(false));
  }, [section, view]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const list = filterItemsByView(items, view);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((it) => (it.name || "").toLowerCase().includes(q));
  }, [items, view, search]);

  const priceDisplay = (it) => {
    if (it.kind === "physical_product" && it.sales_destination === "shopify_external") {
      return it.shopify_display_price != null ? `${it.shopify_from_price ? "From " : ""}${money(it.shopify_display_price)}` : "—";
    }
    return money(it.list_price);
  };

  const duplicateItem = async (it) => {
    setBusyId(it.id);
    const path = it.kind === "physical_product" ? `/pos/products/${it.id}/duplicate`
      : it.kind === "credit_pack" ? `/credit-packs/${it.id}/duplicate`
      : `/programs/${it.id}/duplicate`;
    try {
      await api.post(path);
      toast.success(`"${it.name}" duplicated — the copy starts hidden until you review it`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not duplicate");
    }
    setBusyId(null);
  };

  const archiveProduct = async (it) => {
    setBusyId(it.id);
    try {
      await api.post(`/pos/products/${it.id}/archive`);
      toast.success(`"${it.name}" archived`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not archive");
    }
    setBusyId(null);
  };

  const restoreProduct = async (it) => {
    setBusyId(it.id);
    try {
      await api.post(`/pos/products/${it.id}/restore`);
      toast.success(`"${it.name}" restored`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not restore");
    }
    setBusyId(null);
  };

  const openDeleteProduct = (it) => { setDeleteTarget(it); setHasHistory(false); };
  const confirmDeleteProduct = async () => {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await api.delete(`/pos/products/${deleteTarget.id}`);
      toast.success(`"${deleteTarget.name}" permanently deleted`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      if (e?.response?.status === 409) setHasHistory(true);
      else toast.error(e?.response?.data?.detail || "Could not delete");
    }
    setBusyId(null);
  };
  const archiveFromDeleteFlow = async () => {
    if (!deleteTarget) return;
    await archiveProduct(deleteTarget);
    setDeleteTarget(null);
  };

  // Packs/programs have no archive concept — "Hide"/"Activate" ALWAYS goes
  // through each kind's own PUT (which replaces the whole record, so the
  // full existing doc is fetched fresh first), toggling only `active`.
  // Deliberately NEVER calls DELETE here: DELETE /credit-packs/{id} hard-
  // deletes any non-default pack outright (only default/seeded packs get
  // soft-deactivated) — using it for a reversible "Hide" action would
  // silently destroy a custom pack instead of just hiding it.
  const toggleHidePackOrProgram = async (it) => {
    setBusyId(it.id);
    try {
      if (it.kind === "credit_pack") {
        const { data } = await api.get("/credit-packs", { params: { include_inactive: true } });
        const raw = (data || []).find((p) => p.id === it.id);
        if (raw) await api.put(`/credit-packs/${it.id}`, { ...raw, active: !it.active });
      } else {
        const { data } = await api.get("/programs", { params: { include_inactive: true } });
        const raw = (data || []).find((p) => p.id === it.id);
        if (raw) await api.put(`/programs/${it.id}`, { ...raw, active: !it.active });
      }
      toast.success(it.active ? `"${it.name}" hidden` : `"${it.name}" activated`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update");
    }
    setBusyId(null);
  };

  const openReceiveStock = (it) => { setStockModal({ item: it, mode: "receive" }); setStockQty(""); setStockReason("Shipment received"); };
  const openAdjustStock = (it) => { setStockModal({ item: it, mode: "adjust" }); setStockQty(""); setStockReason(""); };

  const submitStock = async () => {
    const qty = Number(stockQty);
    if (!qty) { toast.error("Enter a non-zero quantity"); return; }
    if (stockModal.mode === "receive" && qty <= 0) { toast.error("Receive Stock only accepts a positive quantity"); return; }
    if (stockReason.trim().length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    const delta = stockModal.mode === "receive" ? Math.abs(qty) : qty;
    const source = stockModal.mode === "receive" ? "RESTOCK" : "MANUAL_ADJUSTMENT";
    try {
      const { data } = await api.post(`/pos/products/${stockModal.item.id}/adjust-stock`, { quantity_delta: delta, reason: stockReason.trim(), source });
      toast.success(`Stock updated — now ${data.stock_on_hand}`);
      setStockModal(null);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust stock");
    }
  };

  const openStockHistory = (it) => {
    setHistoryItem(it);
    setHistoryLoading(true);
    setHistoryRows([]);
    api.get(`/pos/products/${it.id}/movements`)
      .then(({ data }) => setHistoryRows(data || []))
      .catch(() => toast.error("Could not load stock history"))
      .finally(() => setHistoryLoading(false));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SECTION_TABS.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)} data-testid={`sm-section-${s.key}`}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${section === s.key ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items"
               className="flex-1 min-w-[160px] bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
        {[
          ["all", "All"], ["missing_details", "Missing Details"], ["uncategorized", "Uncategorized"],
          ["low_stock", "Low Stock"], ["out_of_stock", "Out of Stock"], ["hidden", "Hidden"],
          ["inactive", "Inactive"], ["archived", "Archived"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)} data-testid={`sm-view-${k}`}
                  className={`px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest ${view === k ? "bg-shSecondary text-bgHeader" : "bg-[var(--sh-card-base)] text-shTextMuted"}`}>
            {label}
          </button>
        ))}
        <button onClick={onAddShopItem} data-testid="sm-add-item"
                className="bg-shPrimary text-bgHeader rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest">
          + Add Shop Item
        </button>
      </div>

      {forbidden ? (
        <div className="text-center text-shTextMuted py-10 text-sm" data-testid="sm-items-forbidden">
          You don't have permission to view Shop items and pricing. Ask an owner/admin to grant the pricing permission,
          or use the Categories &amp; Layout tab if you only need to organize categories.
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-shTextMuted text-[11px] uppercase tracking-widest text-left border-b border-shBorder">
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Type</th>
              <th className="py-2 pr-2">Section</th>
              <th className="py-2 pr-2">Category</th>
              <th className="py-2 pr-2 text-right">Price</th>
              <th className="py-2 pr-2 text-right">Cost</th>
              <th className="py-2 pr-2 text-right">Margin</th>
              <th className="py-2 pr-2">Inventory</th>
              <th className="py-2 pr-2">Shop</th>
              <th className="py-2 pr-2">Register</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12} className="py-6 text-center text-shTextMuted">Loading…</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={12} className="py-6 text-center text-shTextMuted">No items found.</td></tr>}
            {filtered.map((it) => {
              const margin = marginDisplay(it);
              const inv = inventoryStatus(it);
              const warnings = itemWarnings(it);
              return (
              <tr key={`${it.kind}:${it.id}`} className="border-b border-shBorder/60" data-testid={`sm-item-row-${it.id}`}>
                <td className="py-2 pr-2 text-shText font-bold cursor-pointer" onClick={() => onEditItem(it)}>
                  <div className="flex items-center gap-2">
                    <ItemThumbnail imageId={it.image_id} alt={it.name} size={40} />
                    <span>
                      {it.name}
                      {it.featured && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary align-middle">Featured</span>}
                      {warnings.map((w, wi) => (
                        <span key={wi} className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest align-middle ${WARNING_TONE_CLASS[w.tone]}`} data-testid={`sm-warning-${it.id}`}>
                          {w.label}
                        </span>
                      ))}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-2 text-shTextMuted">{itemKindLabel(it)}</td>
                <td className="py-2 pr-2 text-shTextMuted">{it.section_label}</td>
                <td className="py-2 pr-2 text-shTextMuted">{it.category_name || "Uncategorized"}{it.subcategory_name ? ` / ${it.subcategory_name}` : ""}</td>
                <td className="py-2 pr-2 text-right text-shText">
                  {priceDisplay(it)}
                  {it.pricing_variable && <span className="ml-1 text-[10px] text-shSecondary" title="Client-specific/grandfathered pricing may apply">*</span>}
                </td>
                <td className="py-2 pr-2 text-right text-shTextMuted" data-testid={`sm-cost-${it.id}`}>
                  {margin ? margin.cost : "—"}
                </td>
                <td className="py-2 pr-2 text-right text-shTextMuted" data-testid={`sm-margin-${it.id}`}>
                  {margin && margin.gm ? margin.gm : "—"}
                </td>
                <td className="py-2 pr-2 text-shTextMuted">
                  {inv ? (
                    <span className={inv.tone === "bad" ? "text-red-400" : inv.tone === "warn" ? "text-shOrange" : inv.tone === "ok" ? "text-shPrimary" : "text-shTextMuted"}>
                      {inv.label}
                    </span>
                  ) : "—"}
                </td>
                <td className="py-2 pr-2"><StatusPill active={it.show_online} label={it.show_online ? "Shown" : "Hidden"} /></td>
                <td className="py-2 pr-2"><StatusPill active={it.show_at_register} label={it.show_at_register ? "Shown" : "Hidden"} /></td>
                <td className="py-2 pr-2">
                  {it.kind === "physical_product" && it.archived
                    ? <StatusPill active={false} label="Archived" />
                    : <StatusPill active={it.active} />}
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <div className="flex items-center gap-2 justify-end">
                    {it.kind === "physical_product" && it.archived ? (
                      <button onClick={() => restoreProduct(it)} disabled={busyId === it.id} data-testid={`sm-restore-${it.id}`}
                              className="text-shPrimary text-[11px] font-black uppercase tracking-widest disabled:opacity-40">Restore</button>
                    ) : (
                      <>
                        <button onClick={() => onEditItem(it)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Edit</button>
                        <button onClick={() => duplicateItem(it)} disabled={busyId === it.id} data-testid={`sm-duplicate-${it.id}`}
                                className="text-shTextMuted text-[11px] font-black uppercase tracking-widest disabled:opacity-40">Duplicate</button>
                        {it.kind === "physical_product" && it.track_inventory && (
                          <>
                            <button onClick={() => openReceiveStock(it)} data-testid={`sm-receive-stock-${it.id}`}
                                    className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Receive Stock</button>
                            <button onClick={() => openAdjustStock(it)} data-testid={`sm-adjust-stock-${it.id}`}
                                    className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Adjust Stock</button>
                            <button onClick={() => openStockHistory(it)} data-testid={`sm-stock-history-${it.id}`}
                                    className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Stock History</button>
                          </>
                        )}
                        {it.kind === "physical_product" ? (
                          <button onClick={() => openDeleteProduct(it)} data-testid={`sm-delete-${it.id}`}
                                  className="text-red-400 text-[11px] font-black uppercase tracking-widest">Delete</button>
                        ) : (
                          <button onClick={() => toggleHidePackOrProgram(it)} disabled={busyId === it.id}
                                  data-testid={`sm-toggle-active-${it.id}`}
                                  className="text-shTextMuted text-[11px] font-black uppercase tracking-widest disabled:opacity-40">
                            {it.active ? "Hide" : "Activate"}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {stockModal && (() => {
        const isReceive = stockModal.mode === "receive";
        const parsedQty = Number(stockQty);
        const delta = isReceive ? Math.abs(parsedQty || 0) : (parsedQty || 0);
        const resulting = (stockModal.item.stock_on_hand ?? 0) + delta;
        return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="sm-stock-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3">
            <p className="text-shText font-black uppercase tracking-widest">{isReceive ? "Receive Stock" : "Adjust Stock"} — {stockModal.item.name}</p>
            <p className="text-shTextMuted text-sm">Current stock: {stockModal.item.stock_on_hand}</p>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">
                {isReceive ? "Quantity received" : "Quantity adjustment (+/-)"}
              </label>
              <input type="number" min={isReceive ? 0 : undefined} value={stockQty} onChange={(e) => setStockQty(e.target.value)}
                     data-testid="sm-stock-qty-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Reason</label>
              <input value={stockReason} onChange={(e) => setStockReason(e.target.value)}
                     placeholder={isReceive ? "e.g. Shipment received" : "e.g. Damaged, Lost, count correction"}
                     data-testid="sm-stock-reason-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
            </div>
            {parsedQty !== 0 && !Number.isNaN(parsedQty) && (
              <p className="text-shTextMuted text-sm" data-testid="sm-stock-resulting">
                Resulting stock: <span className="text-shText font-bold">{resulting}</span>
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button onClick={() => setStockModal(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">Cancel</button>
              <button onClick={submitStock} data-testid="sm-stock-save" className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest">Save</button>
            </div>
          </div>
        </div>
        );
      })()}

      {historyItem && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="sm-stock-history-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg p-5 space-y-3 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <p className="text-shText font-black uppercase tracking-widest">Stock History — {historyItem.name}</p>
              <button onClick={() => setHistoryItem(null)} className="text-shTextMuted hover:text-shText"><i className="fas fa-xmark" /></button>
            </div>
            {historyLoading ? (
              <p className="text-shTextMuted text-sm py-6 text-center">Loading…</p>
            ) : historyRows.length === 0 ? (
              <p className="text-shTextMuted text-sm py-6 text-center">No stock movements recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-shTextMuted text-[11px] uppercase tracking-widest text-left border-b border-shBorder">
                      <th className="py-2 pr-2">Date</th>
                      <th className="py-2 pr-2">Type</th>
                      <th className="py-2 pr-2">Reason</th>
                      <th className="py-2 pr-2 text-right">Change</th>
                      <th className="py-2 pr-2 text-right">Before</th>
                      <th className="py-2 pr-2 text-right">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((m) => (
                      <tr key={m.id} className="border-b border-shBorder/60" data-testid={`sm-movement-${m.id}`}>
                        <td className="py-2 pr-2 text-shTextMuted whitespace-nowrap">{m.created_at ? new Date(m.created_at).toLocaleString() : "—"}</td>
                        <td className="py-2 pr-2 text-shText">{m.type}</td>
                        <td className="py-2 pr-2 text-shTextMuted">{m.reason}</td>
                        <td className={`py-2 pr-2 text-right font-bold ${m.quantity_delta > 0 ? "text-shPrimary" : "text-red-400"}`}>
                          {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                        </td>
                        <td className="py-2 pr-2 text-right text-shTextMuted">{m.stock_before}</td>
                        <td className="py-2 pr-2 text-right text-shText">{m.stock_after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" data-testid="sm-delete-confirm">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3">
            {!hasHistory ? (
              <>
                <p className="text-shText font-black uppercase tracking-widest">Delete "{deleteTarget.name}"?</p>
                <p className="text-shTextMuted text-sm">This permanently removes the product. Only possible with no order, sale, or inventory history — otherwise we'll offer to archive it instead.</p>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setDeleteTarget(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">Cancel</button>
                  <button onClick={confirmDeleteProduct} className="flex-1 bg-red-500 text-white rounded-xl py-3 font-black uppercase tracking-widest">Permanently Delete</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-shText font-black uppercase tracking-widest">"{deleteTarget.name}" has order history</p>
                <p className="text-shTextMuted text-sm">Can't be permanently deleted — archiving instead keeps every past order/receipt/report intact.</p>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => setDeleteTarget(null)} className="flex-1 text-shTextMuted font-black uppercase text-sm tracking-widest py-3">Cancel</button>
                  <button onClick={archiveFromDeleteFlow} className="flex-1 bg-shPrimary text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest">Archive Product</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * ADD SHOP ITEM — type picker
 * ========================================================================== */
function TypePickerModal({ onClose, onPick }) {
  const options = [
    { key: "physical_product", label: "Physical Product", icon: "fa-box", desc: "Inventory, SKU, cost, tax, register + Shop checkout." },
    { key: "shopify_external", label: "Shopify/External Merchandise", icon: "fa-arrow-up-right-from-square", desc: "Display-only Shop link — Shopify handles checkout." },
    { key: "credit_pack", label: "Prepaid Visit Pack", icon: "fa-ticket", desc: "Bulk daycare/boarding/visit credits." },
    { key: "training_program", label: "Training Program", icon: "fa-graduation-cap", desc: "Sessions, curriculum, enrollment." },
  ];
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg p-6 space-y-3">
        <p className="text-shText text-lg font-black uppercase tracking-widest">What are you adding?</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {options.map((o) => (
            <button key={o.key} onClick={() => onPick(o.key)} data-testid={`sm-pick-${o.key}`}
                    className="text-left bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 hover:border-shPrimary/60 transition">
              <i className={`fas ${o.icon} text-shPrimary text-lg mb-2`} />
              <p className="text-shText font-black text-sm">{o.label}</p>
              <p className="text-shTextMuted text-[12px] mt-1">{o.desc}</p>
            </button>
          ))}
        </div>
        <div className="flex justify-end pt-1">
          <button onClick={onClose} className="text-shTextMuted font-black uppercase text-sm tracking-widest">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * CATEGORIES & LAYOUT TAB
 * ========================================================================== */
function CategoriesTab() {
  const [section, setSection] = useState("merch");
  const [categories, setCategories] = useState([]);
  const [uncategorized, setUncategorized] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const BLANK_CATEGORY_DRAFT = { name: "", description: "", image_id: null, mobile_image_id: null, is_featured: false, hide_when_empty: null };
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null); // null = adding new; category.id = editing
  const [categoryDraft, setCategoryDraft] = useState(BLANK_CATEGORY_DRAFT);
  const [categoryOriginalImageId, setCategoryOriginalImageId] = useState(null);
  const [categoryOriginalMobileImageId, setCategoryOriginalMobileImageId] = useState(null);
  const [addingSubFor, setAddingSubFor] = useState(null);
  const [subDraft, setSubDraft] = useState({ name: "", description: "" });

  const [removeTarget, setRemoveTarget] = useState(null);
  const [removeAction, setRemoveAction] = useState("deactivate");
  const [removeDestination, setRemoveDestination] = useState("");

  const [bulkSelection, setBulkSelection] = useState([]);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkSubcategoryId, setBulkSubcategoryId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, uncatRes] = await Promise.all([
        api.get("/shop/categories", { params: { include_inactive: true, section } }),
        api.get("/shop/uncategorized-items", { params: { section } }),
      ]);
      setCategories(catRes.data.categories || []);
      setUncategorized(uncatRes.data.items || []);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }, [section]);
  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const openAddCategory = () => {
    setEditingCategoryId(null);
    setCategoryDraft(BLANK_CATEGORY_DRAFT);
    setCategoryOriginalImageId(null);
    setCategoryOriginalMobileImageId(null);
    setAddingCategory(true);
  };
  const openEditCategory = (cat) => {
    setEditingCategoryId(cat.id);
    setCategoryDraft({
      name: cat.name || "", description: cat.description || "",
      image_id: cat.image_id || null, mobile_image_id: cat.mobile_image_id || null,
      is_featured: !!cat.is_featured, hide_when_empty: cat.hide_when_empty ?? null,
    });
    setCategoryOriginalImageId(cat.image_id || null);
    setCategoryOriginalMobileImageId(cat.mobile_image_id || null);
    setAddingCategory(true);
  };
  const cancelCategoryForm = () => {
    // Closing without saving — drop any not-yet-saved uploads from this session.
    if (categoryDraft.image_id && categoryDraft.image_id !== categoryOriginalImageId) {
      api.delete(`/shop/media/${categoryDraft.image_id}`).catch(() => {});
    }
    if (categoryDraft.mobile_image_id && categoryDraft.mobile_image_id !== categoryOriginalMobileImageId) {
      api.delete(`/shop/media/${categoryDraft.mobile_image_id}`).catch(() => {});
    }
    setAddingCategory(false);
    setEditingCategoryId(null);
    setCategoryDraft(BLANK_CATEGORY_DRAFT);
  };

  const saveCategory = async () => {
    setErr("");
    if (!categoryDraft.name.trim()) return setErr("Category name is required.");
    const body = {
      name: categoryDraft.name.trim(), description: categoryDraft.description || null,
      // PUT is a patch — the backend treats `null` as "field omitted, leave
      // unchanged" and only clears on an explicit "" (see update_shop_category).
      // POST (create) has no such ambiguity, so it keeps sending null.
      image_id: categoryDraft.image_id || (editingCategoryId ? "" : null),
      mobile_image_id: categoryDraft.mobile_image_id || (editingCategoryId ? "" : null),
      is_featured: categoryDraft.is_featured, hide_when_empty: categoryDraft.hide_when_empty,
    };
    try {
      if (editingCategoryId) {
        await api.put(`/shop/categories/${editingCategoryId}`, body);
        // Save succeeded — now safe to drop old images, if replaced/removed.
        if (categoryOriginalImageId && categoryOriginalImageId !== categoryDraft.image_id) {
          api.delete(`/shop/media/${categoryOriginalImageId}`).catch(() => {});
        }
        if (categoryOriginalMobileImageId && categoryOriginalMobileImageId !== categoryDraft.mobile_image_id) {
          api.delete(`/shop/media/${categoryOriginalMobileImageId}`).catch(() => {});
        }
      } else {
        await api.post("/shop/categories", { ...body, section });
      }
      setAddingCategory(false);
      setEditingCategoryId(null);
      setCategoryDraft(BLANK_CATEGORY_DRAFT);
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const saveSubcategory = async (categoryId) => {
    setErr("");
    if (!subDraft.name.trim()) return setErr("Subcategory name is required.");
    try {
      await api.post("/shop/subcategories", { category_id: categoryId, name: subDraft.name.trim(), description: subDraft.description || null });
      setAddingSubFor(null);
      setSubDraft({ name: "", description: "" });
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const toggleCategoryActive = async (cat) => {
    try { await api.put(`/shop/categories/${cat.id}`, { active: !cat.active }); load(); } catch (e) { setErr(formatErr(e)); }
  };
  const toggleSubActive = async (sub) => {
    try { await api.put(`/shop/subcategories/${sub.id}`, { active: !sub.active }); load(); } catch (e) { setErr(formatErr(e)); }
  };

  const moveCategory = async (fromIdx, toIdx) => {
    const ids = categories.map((c) => c.id);
    if (toIdx < 0 || toIdx >= ids.length) return;
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    setCategories((prev) => {
      const byId = Object.fromEntries(prev.map((c) => [c.id, c]));
      return ids.map((id) => byId[id]);
    });
    try { await api.post("/shop/categories/reorder", { ordered_ids: ids }); } catch (e) { setErr(formatErr(e)); load(); }
  };

  const moveSubcategory = async (category, fromIdx, toIdx) => {
    const subs = category.subcategories || [];
    if (toIdx < 0 || toIdx >= subs.length) return;
    const ids = subs.map((s) => s.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    try { await api.post("/shop/subcategories/reorder", { ordered_ids: ids }); load(); } catch (e) { setErr(formatErr(e)); }
  };

  const openRemoveCategory = async (cat) => {
    try {
      const { data } = await api.get(`/shop/categories/${cat.id}/impact`);
      setRemoveTarget({ type: "category", row: cat, impact: data });
      setRemoveAction("deactivate");
      setRemoveDestination("");
    } catch (e) { setErr(formatErr(e)); }
  };
  const openRemoveSubcategory = (cat, sub) => {
    setRemoveTarget({ type: "subcategory", row: sub, parentCategory: cat, impact: { item_count: sub.item_count } });
    setRemoveAction("deactivate");
    setRemoveDestination("");
  };
  const confirmRemove = async () => {
    setErr("");
    try {
      if (removeTarget.type === "category") {
        const body = { action: removeAction };
        if (removeAction === "move_to_category") body.target_category_id = removeDestination;
        await api.delete(`/shop/categories/${removeTarget.row.id}`, { data: body });
      } else {
        const body = { action: removeAction };
        if (removeAction === "move_to_subcategory") body.target_subcategory_id = removeDestination;
        await api.delete(`/shop/subcategories/${removeTarget.row.id}`, { data: body });
      }
      setRemoveTarget(null);
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const toggleBulkItem = (kind, id) => {
    setBulkSelection((prev) => {
      const exists = prev.find((s) => s.kind === kind && s.id === id);
      if (exists) return prev.filter((s) => !(s.kind === kind && s.id === id));
      return [...prev, { kind, id }];
    });
  };
  const applyBulkAssign = async () => {
    setErr("");
    if (bulkSelection.length === 0) return setErr("Select at least one item.");
    try {
      await api.post("/shop/items/bulk-assign", { items: bulkSelection, category_id: bulkCategoryId || null, subcategory_id: bulkSubcategoryId || null });
      setBulkSelection([]);
      setBulkCategoryId("");
      setBulkSubcategoryId("");
      load();
    } catch (e) { setErr(formatErr(e)); }
  };

  const bulkCategoryOptions = categories.filter((c) => c.active);
  const bulkSubcategoryOptions = (categories.find((c) => c.id === bulkCategoryId)?.subcategories || []).filter((s) => s.active);
  const activeCategoriesForDest = (excludeId) => categories.filter((c) => c.id !== excludeId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {SECTION_TABS.filter((s) => s.key !== "all").map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)} data-testid={`sm-cat-section-${s.key}`}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${section === s.key ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="sm-cat-error">{err}</div>}

      {loading ? (
        <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={openAddCategory} data-testid="sm-add-category"
                    className="bg-shPrimary text-bgBase px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shPrimary/90">
              <i className="fas fa-plus mr-1" />Add Category to {SECTION_TABS.find((s) => s.key === section)?.label}
            </button>
          </div>

          {addingCategory && (
            <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3" data-testid="sm-category-form">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">{editingCategoryId ? "Edit Category" : "New Category"}</p>
              <input value={categoryDraft.name} onChange={(e) => setCategoryDraft((d) => ({ ...d, name: e.target.value }))}
                     placeholder="Category name" data-testid="sm-category-name-input"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <input value={categoryDraft.description} onChange={(e) => setCategoryDraft((d) => ({ ...d, description: e.target.value }))}
                     placeholder="Optional description"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Cover Image</label>
                  <ShopImageUpload imageId={categoryDraft.image_id} originalImageId={categoryOriginalImageId}
                                   onChange={(id) => setCategoryDraft((d) => ({ ...d, image_id: id }))} />
                </div>
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Mobile Cover Image (optional — falls back to Cover Image)</label>
                  <ShopImageUpload imageId={categoryDraft.mobile_image_id} originalImageId={categoryOriginalMobileImageId}
                                   onChange={(id) => setCategoryDraft((d) => ({ ...d, mobile_image_id: id }))} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={categoryDraft.is_featured}
                         onChange={(e) => setCategoryDraft((d) => ({ ...d, is_featured: e.target.checked }))}
                         data-testid="sm-category-featured" />
                  <span className="text-shText text-sm">Featured (shown first, before non-featured categories)</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-shText">
                  Hide when empty:
                  <select value={categoryDraft.hide_when_empty === null ? "" : categoryDraft.hide_when_empty ? "true" : "false"}
                          onChange={(e) => setCategoryDraft((d) => ({ ...d, hide_when_empty: e.target.value === "" ? null : e.target.value === "true" }))}
                          data-testid="sm-category-hide-when-empty"
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm">
                    <option value="">Default (use global setting)</option>
                    <option value="true">Always</option>
                    <option value="false">Never</option>
                  </select>
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={cancelCategoryForm} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest px-3 py-2">Cancel</button>
                <button onClick={saveCategory} data-testid="sm-save-category"
                        className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[12px] tracking-widest">Save Category</button>
              </div>
            </div>
          )}

          {categories.length === 0 && !addingCategory && (
            <div className="text-center text-shTextMuted py-10 text-sm italic">No categories in this section yet.</div>
          )}

          {categories.map((cat, idx) => (
            <div key={cat.id} className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl overflow-hidden" data-testid={`sm-category-${cat.id}`}>
              <div className="flex flex-wrap items-center gap-3 p-3">
                <button onClick={() => toggleExpand(cat.id)} className="text-shTextMuted hover:text-shText">
                  <i className={`fas fa-chevron-${expanded[cat.id] ? "down" : "right"} text-[12px]`} />
                </button>
                <ItemThumbnail imageId={cat.image_id} alt={cat.name} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-shText font-bold text-sm truncate">
                    {cat.name} <span className="text-shTextMuted font-normal">· {cat.item_count} item{cat.item_count === 1 ? "" : "s"}</span>
                    {cat.is_featured && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary align-middle">Featured</span>}
                  </p>
                </div>
                <StatusPill active={cat.active} />
                <div className="flex items-center gap-1">
                  <button onClick={() => moveCategory(idx, idx - 1)} disabled={idx === 0} className="w-7 h-7 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-up text-[11px]" /></button>
                  <button onClick={() => moveCategory(idx, idx + 1)} disabled={idx === categories.length - 1} className="w-7 h-7 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-down text-[11px]" /></button>
                </div>
                <button onClick={() => openEditCategory(cat)} data-testid={`sm-edit-category-${cat.id}`} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">Edit</button>
                <button onClick={() => toggleCategoryActive(cat)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">{cat.active ? "Hide" : "Show"}</button>
                <button onClick={() => openRemoveCategory(cat)} className="text-red-400 text-[11px] font-black uppercase tracking-widest">Remove</button>
              </div>
              {expanded[cat.id] && (
                <div className="border-t border-shBorder p-3 pl-9 space-y-2">
                  {(cat.subcategories || []).map((sub, sidx) => (
                    <div key={sub.id} className="flex items-center gap-2 text-[13px]">
                      <span className="flex-1 text-shText">{sub.name} <span className="text-shTextMuted">· {sub.item_count}</span></span>
                      <StatusPill active={sub.active} />
                      <button onClick={() => moveSubcategory(cat, sidx, sidx - 1)} disabled={sidx === 0} className="w-6 h-6 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-up text-[10px]" /></button>
                      <button onClick={() => moveSubcategory(cat, sidx, sidx + 1)} disabled={sidx === (cat.subcategories || []).length - 1} className="w-6 h-6 rounded border border-shBorder text-shTextMuted disabled:opacity-30"><i className="fas fa-chevron-down text-[10px]" /></button>
                      <button onClick={() => toggleSubActive(sub)} className="text-shTextMuted text-[11px] font-black uppercase tracking-widest">{sub.active ? "Hide" : "Show"}</button>
                      <button onClick={() => openRemoveSubcategory(cat, sub)} className="text-red-400 text-[11px] font-black uppercase tracking-widest">Remove</button>
                    </div>
                  ))}
                  {addingSubFor === cat.id ? (
                    <div className="flex gap-2">
                      <input value={subDraft.name} onChange={(e) => setSubDraft((d) => ({ ...d, name: e.target.value }))}
                             placeholder="Subcategory name" data-testid={`sm-subcategory-name-input-${cat.id}`}
                             className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                      <button onClick={() => setAddingSubFor(null)} className="text-shTextMuted font-black uppercase text-[12px] tracking-widest px-2">Cancel</button>
                      <button onClick={() => saveSubcategory(cat.id)} className="bg-shPrimary text-bgBase px-3 py-1.5 rounded font-black uppercase text-[12px] tracking-widest">Save</button>
                    </div>
                  ) : (
                    <button onClick={() => { setAddingSubFor(cat.id); setSubDraft({ name: "", description: "" }); }}
                            data-testid={`sm-add-subcategory-${cat.id}`}
                            className="text-[12px] font-black uppercase text-shPrimary tracking-widest">
                      <i className="fas fa-plus mr-1" />Add Subcategory
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3 mt-6">
            <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Bulk Assign Uncategorized Items ({SECTION_TABS.find((s) => s.key === section)?.label})</p>
            {uncategorized.length === 0 ? (
              <p className="text-[13px] text-shTextMuted italic">No uncategorized items in this section.</p>
            ) : (
              <>
                <div className="max-h-52 overflow-y-auto space-y-1">
                  {uncategorized.map((it) => {
                    const checked = bulkSelection.some((s) => s.kind === it.kind && s.id === it.id);
                    return (
                      <label key={`${it.kind}:${it.id}`} className="flex items-center gap-2 p-1.5 rounded border border-shBorder text-[13px] text-shText cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => toggleBulkItem(it.kind, it.id)} />
                        <ItemThumbnail imageId={it.image_id} alt={it.name} size={36} />
                        <span className="flex-1 truncate">{it.name}</span>
                        <span className="text-[11px] uppercase tracking-widest text-shTextMuted">{itemKindLabel(it)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={bulkCategoryId} onChange={(e) => { setBulkCategoryId(e.target.value); setBulkSubcategoryId(""); }}
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                    <option value="">Choose category…</option>
                    {bulkCategoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <select value={bulkSubcategoryId} onChange={(e) => setBulkSubcategoryId(e.target.value)} disabled={!bulkCategoryId}
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm disabled:opacity-40">
                    <option value="">No subcategory</option>
                    {bulkSubcategoryOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="flex justify-end">
                  <button onClick={applyBulkAssign} disabled={!bulkCategoryId}
                          className="bg-shPrimary text-bgBase px-4 py-2 rounded font-black uppercase text-[12px] tracking-widest disabled:opacity-40">
                    Apply to {bulkSelection.length} item{bulkSelection.length === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {removeTarget && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-md p-5 space-y-3">
            <p className="text-shText font-black uppercase tracking-widest">Remove "{removeTarget.row.name}"?</p>
            <p className="text-shTextMuted text-sm">
              {removeTarget.impact.item_count} item{removeTarget.impact.item_count === 1 ? "" : "s"} currently assigned.
              {removeTarget.type === "category" && ` ${removeTarget.impact.subcategory_count || 0} subcategor${(removeTarget.impact.subcategory_count || 0) === 1 ? "y" : "ies"}.`}
              {" "}Products/packs/programs are never deleted by this action.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-shText">
                <input type="radio" checked={removeAction === "deactivate"} onChange={() => setRemoveAction("deactivate")} />
                Deactivate (hide from Shop, keep items assigned)
              </label>
              <label className="flex items-center gap-2 text-sm text-shText">
                <input type="radio" checked={removeAction === (removeTarget.type === "category" ? "move_to_uncategorized" : "move_to_category")} onChange={() => setRemoveAction(removeTarget.type === "category" ? "move_to_uncategorized" : "move_to_category")} />
                Delete and move items to {removeTarget.type === "category" ? "Uncategorized" : "the parent category"}
              </label>
              {removeTarget.type === "category" && (
                <label className="flex items-center gap-2 text-sm text-shText">
                  <input type="radio" checked={removeAction === "move_to_category"} onChange={() => setRemoveAction("move_to_category")} />
                  Delete and move items to another category:
                  <select value={removeDestination} onChange={(e) => setRemoveDestination(e.target.value)} disabled={removeAction !== "move_to_category"}
                          className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1 text-shText text-sm disabled:opacity-40">
                    <option value="">Choose…</option>
                    {activeCategoriesForDest(removeTarget.row.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="flex gap-3 pt-1 justify-end">
              <button onClick={() => setRemoveTarget(null)} className="text-shTextMuted font-black uppercase text-sm tracking-widest px-3 py-2">Cancel</button>
              <button onClick={confirmRemove} className="bg-shPrimary text-bgHeader rounded-xl px-4 py-2 font-black uppercase tracking-widest">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * CLIENT PREVIEW TAB — mounts the REAL PortalShop presentation in
 * mode="preview" (see PortalShop.jsx), which itself reuses the exact same
 * catalog builder + pricing resolver + category-card navigation a real
 * client sees. Never a second, bespoke storefront implementation to keep
 * in sync — the client-picker below only decides `previewClientId`.
 * ========================================================================== */
function ClientPreviewTab() {
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState([]);
  const [previewClient, setPreviewClient] = useState(null);

  useEffect(() => {
    if (clientQuery.trim().length < 2) { setClientResults([]); return; }
    let cancelled = false;
    // GET /clients has no server-side search param — fetch the full list
    // and filter client-side, matching PricingTiersPanel's identical
    // working pattern for the same kind of client-picker search box.
    api.get("/clients").then(({ data }) => {
      if (cancelled) return;
      const q = clientQuery.toLowerCase();
      setClientResults((data || []).filter((c) => c.name?.toLowerCase().includes(q)).slice(0, 8));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [clientQuery]);

  return (
    <div className="space-y-4">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted mb-2">Preview as</p>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setPreviewClient(null); setClientQuery(""); }}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${!previewClient ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
            Standard / public pricing
          </button>
          {previewClient && (
            <span className="px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest bg-shSecondary/15 text-shSecondary">
              {previewClient.name}
            </span>
          )}
          <div className="relative flex-1 min-w-[200px]">
            <input value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Search a client to preview their exact pricing…"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            {clientResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-[var(--sh-card-base)] border border-shBorder rounded shadow-lg max-h-48 overflow-y-auto">
                {clientResults.map((c) => (
                  <button key={c.id} onClick={() => { setPreviewClient(c); setClientQuery(""); setClientResults([]); }}
                          className="block w-full text-left px-3 py-2 text-sm text-shText hover:bg-shPrimary/10">
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <PortalShop key={previewClient?.id || "standard"} mode="preview" previewClientId={previewClient?.id || null} fullScreen />
    </div>
  );
}

/* ============================================================================
 * ONLINE ORDERS TAB — reuses the exact same admin order/fulfillment
 * endpoints Front Desk's Online Orders panel already uses (Pos.jsx is left
 * completely untouched; Front Desk still needs its own quick pickup
 * actions). Never a second order model or fulfillment workflow — this is
 * only a second admin SURFACE onto the same shop_orders data.
 * ========================================================================== */
const ORDER_FILTERS = [
  ["all", "All"], ["open", "Open"], ["new", "New"], ["preparing", "Preparing"],
  ["ready_for_pickup", "Ready for Pickup"], ["completed", "Completed"], ["needs_attention", "Needs Attention"],
];

const ORDER_STATUS_LABEL = {
  needs_attention: "Needs Attention", picked_up: "Picked Up", ready_for_pickup: "Ready for Pickup",
  preparing: "Preparing", processing: "Processing", completed: "Completed",
};

function OnlineOrdersTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [forbidden, setForbidden] = useState(false);

  const load = () => {
    setLoading(true);
    setForbidden(false);
    api.get("/admin/shop-orders")
      .then(({ data }) => {
        const rows = data.orders || [];
        setOrders(rows);
        // Same "mark seen once actually shown" contract as Front Desk's own
        // Online Orders panel — only after a successful fetch, only the
        // orders that came back genuinely unseen.
        const newlyUnseenIds = rows.filter((o) => o.admin_unseen === true).map((o) => o.id);
        if (newlyUnseenIds.length > 0) {
          api.post("/admin/shop-orders/mark-seen", { order_ids: newlyUnseenIds })
            .then(() => {
              setOrders((prev) => prev.map((o) => (newlyUnseenIds.includes(o.id) ? { ...o, admin_unseen: false } : o)));
              window.dispatchEvent(new CustomEvent("sh:shop-orders-seen"));
            })
            .catch(() => {});
        }
      })
      .catch((e) => {
        if (e?.response?.status === 403) setForbidden(true);
        else toast.error("Could not load online orders");
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(
    () => searchOrders(filterOrdersByView(orders, filter), search),
    [orders, filter, search],
  );

  const runAction = async (orderId, action) => {
    setBusyId(orderId);
    try {
      await api.post(`/admin/shop-orders/${orderId}/fulfillment`, { action });
      load();
      toast.success(action === "retry_fulfillment" ? "Fulfillment retried" : "Order updated");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not update this order");
    }
    setBusyId(null);
  };

  if (forbidden) {
    return (
      <div className="text-center text-shTextMuted py-10 text-sm" data-testid="sm-orders-forbidden">
        You don't have permission to view or update online orders. Ask an owner/admin to grant the payments permission.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {ORDER_FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} data-testid={`sm-order-filter-${k}`}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest ${filter === k ? "bg-shPrimary text-bgHeader" : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted"}`}>
            {label}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-[11px] uppercase tracking-widest font-black text-shTextMuted hover:text-shPrimary">
          <i className="fas fa-rotate-right mr-1" />Refresh
        </button>
      </div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by client, order reference, or item"
             data-testid="sm-order-search"
             className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />

      {loading ? (
        <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <p className="text-shTextMuted text-sm py-6 text-center">No orders match this filter.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((o) => {
            const busy = busyId === o.id;
            const status = orderComputedStatus(o);
            const hasPhysical = (o.lines || []).some((l) => l.kind === "product");
            return (
              <div key={o.id} className="border border-shBorder rounded-xl p-3" data-testid={`sm-order-${o.id}`}>
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-shText font-bold text-sm">
                      Order #{orderRef(o)} · {o.client_name || "Unknown client"}
                      {o.admin_unseen === true && (
                        <span className="ml-2 inline-block bg-shAccent text-bgHeader text-[10px] font-black px-1.5 py-0.5 rounded-full align-middle" data-testid={`sm-order-new-${o.id}`}>NEW</span>
                      )}
                    </p>
                    <p className="text-shTextMuted text-[12px]">
                      {o.created_at ? new Date(o.created_at).toLocaleString() : "—"} · {money(o.total)}
                    </p>
                    <p className="text-[11px] text-shTextMuted mt-1">
                      {(o.lines || []).map((l) => `${l.quantity}× ${l.name}`).join(", ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-[11px] font-black uppercase tracking-widest ${
                      status === "needs_attention" ? "text-shOrange" : ["picked_up", "completed"].includes(status) ? "text-shPrimary" : "text-shTextMuted"
                    }`}>
                      {ORDER_STATUS_LABEL[status]}
                    </p>
                    <p className="text-[10px] text-shTextMuted mt-1">
                      Payment: Paid{hasPhysical ? ` · Pickup: ${ORDER_STATUS_LABEL[status]}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {status === "needs_attention" && (
                    <button onClick={() => runAction(o.id, "retry_fulfillment")} disabled={busy} data-testid={`sm-order-retry-${o.id}`}
                            className="bg-shAccent/15 border border-shAccent/40 text-shAccent px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shAccent/25 transition disabled:opacity-50">
                      {busy ? "Retrying…" : "Retry Fulfillment"}
                    </button>
                  )}
                  {o.pickup_status === "preparing" && (
                    <button onClick={() => runAction(o.id, "mark_ready")} disabled={busy} data-testid={`sm-order-mark-ready-${o.id}`}
                            className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                      Mark Ready
                    </button>
                  )}
                  {o.pickup_status === "ready_for_pickup" && (
                    <button onClick={() => runAction(o.id, "mark_picked_up")} disabled={busy} data-testid={`sm-order-mark-picked-up-${o.id}`}
                            className="bg-[var(--sh-card-base)] border border-shBorder hover:border-shPrimary/50 text-shText px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest disabled:opacity-50">
                      Mark Picked Up
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * SHOP SETTINGS TAB — global shop appearance/organization settings + the
 * public no-account storefront toggles, all living on the same shop_page
 * sub-object of the one settings singleton (GET/PUT /settings). Reuses
 * ShopImageUpload for the banner/section cover images, same delete-old-
 * image-after-save sequencing as every other editor in this file.
 * ========================================================================== */
const SHOP_SETTINGS_SECTION_KEYS = ["merch", "prepaid_visits", "training"];

function ShopSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [sp, setSp] = useState(null); // shop_page draft
  const [originalBannerImageId, setOriginalBannerImageId] = useState(null);
  const [originalSectionImageIds, setOriginalSectionImageIds] = useState({});

  const load = () => {
    setLoading(true);
    api.get("/settings")
      .then(({ data }) => {
        const shopPage = data.shop_page || {};
        setSp(shopPage);
        setOriginalBannerImageId(shopPage.banner_image_id || null);
        const orig = {};
        for (const key of SHOP_SETTINGS_SECTION_KEYS) orig[key] = (shopPage.sections || {})[key]?.image_id || null;
        setOriginalSectionImageIds(orig);
      })
      .catch(() => toast.error("Could not load shop settings"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const setField = (patch) => setSp((s) => ({ ...s, ...patch }));
  const setSection = (key, patch) => setSp((s) => ({ ...s, sections: { ...(s.sections || {}), [key]: { ...((s.sections || {})[key] || {}), ...patch } } }));

  const save = async () => {
    setErr("");
    if (sp.banner_cta_url && !(/^\/(?!\/)/.test(sp.banner_cta_url) || /^https:\/\//.test(sp.banner_cta_url))) {
      setErr("Banner link must be an internal path (starting with /) or an https:// URL.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/settings", { shop_page: sp });
      // Save succeeded — now safe to drop any replaced/removed images.
      if (originalBannerImageId && originalBannerImageId !== sp.banner_image_id) {
        api.delete(`/shop/media/${originalBannerImageId}`).catch(() => {});
      }
      for (const key of SHOP_SETTINGS_SECTION_KEYS) {
        const origId = originalSectionImageIds[key];
        const nextId = sp.sections?.[key]?.image_id || null;
        if (origId && origId !== nextId) api.delete(`/shop/media/${origId}`).catch(() => {});
      }
      toast.success("Shop settings saved");
      load();
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Could not save shop settings");
    }
    setSaving(false);
  };

  if (loading || !sp) return <div className="text-center text-shTextMuted py-10 text-sm">Loading…</div>;

  return (
    <div className="space-y-5 max-w-3xl" data-testid="sm-shop-settings">
      {err && <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm p-3 rounded" data-testid="sm-shop-settings-error">{err}</div>}

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Global</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Shop Title</label>
            <input value={sp.title || ""} onChange={(e) => setField({ title: e.target.value })} data-testid="sm-shop-title"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Subtitle</label>
            <input value={sp.subtitle || ""} onChange={(e) => setField({ subtitle: e.target.value })} data-testid="sm-shop-subtitle"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
        </div>
        <div>
          <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Default Landing View</label>
          <select value={sp.landing_mode || "section_cards"} onChange={(e) => setField({ landing_mode: e.target.value })} data-testid="sm-shop-landing-mode"
                  className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
            <option value="section_cards">Section Cards (default)</option>
            <option value="featured_items">Featured Items</option>
            <option value="all_items">All Items</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.show_search !== false} onChange={(e) => setField({ show_search: e.target.checked })} data-testid="sm-shop-show-search" />
            <span className="text-shText text-sm">Show Search</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.show_item_counts !== false} onChange={(e) => setField({ show_item_counts: e.target.checked })} data-testid="sm-shop-show-counts" />
            <span className="text-shText text-sm">Show Category Item Counts</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.show_out_of_stock !== false} onChange={(e) => setField({ show_out_of_stock: e.target.checked })} data-testid="sm-shop-show-oos" />
            <span className="text-shText text-sm">Show Out-of-Stock Products</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={sp.hide_empty_categories !== false} onChange={(e) => setField({ hide_empty_categories: e.target.checked })} data-testid="sm-shop-hide-empty" />
            <span className="text-shText text-sm">Hide Empty Categories (default)</span>
          </label>
        </div>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Banner</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner Heading</label>
            <input value={sp.banner_heading || ""} onChange={(e) => setField({ banner_heading: e.target.value })} data-testid="sm-banner-heading"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner Image</label>
            <ShopImageUpload imageId={sp.banner_image_id} originalImageId={originalBannerImageId}
                             onChange={(id) => setField({ banner_image_id: id })} />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner CTA Text (optional)</label>
            <input value={sp.banner_cta_text || ""} onChange={(e) => setField({ banner_cta_text: e.target.value })} data-testid="sm-banner-cta-text"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Banner Link (internal path or https:// URL)</label>
            <input value={sp.banner_cta_url || ""} onChange={(e) => setField({ banner_cta_url: e.target.value })} placeholder="/shop or https://…" data-testid="sm-banner-cta-url"
                   className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
          </div>
        </div>
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-4">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Sections</p>
        {SHOP_SETTINGS_SECTION_KEYS.map((key) => {
          const row = sp.sections?.[key] || {};
          return (
            <div key={key} className="border-t border-shBorder pt-3 first:border-t-0 first:pt-0 space-y-2" data-testid={`sm-section-row-${key}`}>
              <p className="text-[11px] text-shTextMuted uppercase tracking-widest">Permanent key: <span className="text-shText font-bold">{key}</span></p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Customer-Facing Name</label>
                  <input value={row.label || ""} onChange={(e) => setSection(key, { label: e.target.value })} data-testid={`sm-section-label-${key}`}
                         className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Order</label>
                  <input type="number" value={row.order ?? 0} onChange={(e) => setSection(key, { order: parseInt(e.target.value, 10) || 0 })} data-testid={`sm-section-order-${key}`}
                         className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Short Description</label>
                  <input value={row.description || ""} onChange={(e) => setSection(key, { description: e.target.value })} data-testid={`sm-section-description-${key}`}
                         className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
                </div>
                <div>
                  <label className="text-[11px] text-shTextMuted uppercase tracking-widest mb-1 block">Cover Image</label>
                  <ShopImageUpload imageId={row.image_id} originalImageId={originalSectionImageIds[key]}
                                   onChange={(id) => setSection(key, { image_id: id })} />
                </div>
                <label className="flex items-center gap-2 self-end pb-2">
                  <input type="checkbox" checked={row.visible !== false} onChange={(e) => setSection(key, { visible: e.target.checked })} data-testid={`sm-section-visible-${key}`} />
                  <span className="text-shText text-sm">Visible</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
        <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Public Storefront (signed-out visitors)</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!sp.public_shop_enabled} onChange={(e) => setField({ public_shop_enabled: e.target.checked })} data-testid="sm-public-shop-enabled" />
          <span className="text-shText text-sm">Enable Public Shop (/shop, no account required)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!sp.public_browsing_enabled} onChange={(e) => setField({ public_browsing_enabled: e.target.checked })} data-testid="sm-public-browsing-enabled" />
          <span className="text-shText text-sm">Allow Public Browsing</span>
        </label>
        {sp.public_shop_enabled && sp.public_browsing_enabled && (
          <>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_prices !== false} onChange={(e) => setField({ show_public_prices: e.target.checked })} data-testid="sm-show-public-prices" />
                <span className="text-shText text-sm">Show Prices to Guests</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_merch !== false} onChange={(e) => setField({ show_public_merch: e.target.checked })} data-testid="sm-show-public-merch" />
                <span className="text-shText text-sm">Merch & Gear Publicly Browsable</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_prepaid !== false} onChange={(e) => setField({ show_public_prepaid: e.target.checked })} data-testid="sm-show-public-prepaid" />
                <span className="text-shText text-sm">Prepaid Visits Publicly Browsable</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sp.show_public_training !== false} onChange={(e) => setField({ show_public_training: e.target.checked })} data-testid="sm-show-public-training" />
                <span className="text-shText text-sm">Training Publicly Browsable</span>
              </label>
            </div>
            <label className="flex items-center gap-2 opacity-60" title="Credit packs and training programs always require an account regardless of this setting.">
              <input type="checkbox" checked disabled />
              <span className="text-shText text-sm">Require Account for Credit Packs &amp; Training (always on)</span>
            </label>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">"Existing Client Pricing" Message</label>
              <input value={sp.existing_client_pricing_message || ""} onChange={(e) => setField({ existing_client_pricing_message: e.target.value })} data-testid="sm-existing-client-pricing-message"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-shTextMuted uppercase tracking-widest">Guest Sign-In Prompt Message</label>
              <input value={sp.guest_sign_in_message || ""} onChange={(e) => setField({ guest_sign_in_message: e.target.value })} data-testid="sm-guest-sign-in-message"
                     className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} data-testid="sm-save-shop-settings"
                className="bg-shPrimary text-bgBase px-6 py-2.5 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-40">
          {saving ? "Saving…" : "Save Shop Settings"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
 * MAIN SHELL
 * ========================================================================== */
export default function ShopManager({ openCreateOnMount = false, onCreateConsumed = () => {} }) {
  const confirm = useConfirm();
  const [tab, setTab] = useState("items"); // items | categories | preview
  const [pickerOpen, setPickerOpen] = useState(false);

  // Product editor state (shared shape with ManageProductsPanel)
  const [productForm, setProductForm] = useState(null);
  const [productEditingId, setProductEditingId] = useState(null);
  const [productOriginalImageId, setProductOriginalImageId] = useState(null);
  const [productSaving, setProductSaving] = useState(false);

  // Pack editor state (shared shape with CreditPacksSettings)
  const [packForm, setPackForm] = useState(null);
  const [packEditing, setPackEditing] = useState(null);
  const [packOriginalImageId, setPackOriginalImageId] = useState(null);
  const [packErr, setPackErr] = useState("");
  const [emailTemplates, setEmailTemplates] = useState([]);

  // Program editor state (shared shape with Programs.jsx)
  const [programForm, setProgramForm] = useState(null);
  const [programOriginalImageId, setProgramOriginalImageId] = useState(null);
  const [programMeta, setProgramMeta] = useState(null);
  const [allPrograms, setAllPrograms] = useState([]);

  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    api.get("/admin/email-templates").then((r) => setEmailTemplates((r.data || []).filter((t) => t.audience === "client"))).catch(() => setEmailTemplates([]));
    api.get("/programs/meta").then((r) => setProgramMeta(r.data)).catch(() => {});
    api.get("/programs", { params: { include_inactive: true } }).then((r) => setAllPrograms(r.data || [])).catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    // Deliberately depends on openCreateOnMount (not mount-only []) — the
    // "+ New → Add Shop Item" launcher can fire while ShopManager is
    // ALREADY mounted (the admin is already on this screen), in which case
    // a mount-only effect would never re-open the picker on a repeat click.
    if (openCreateOnMount) {
      setTab("items");
      setPickerOpen(true);
      onCreateConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateOnMount]);

  const closeAllEditors = () => {
    setProductForm(null);
    setPackForm(null);
    setProgramForm(null);
  };

  const pickType = (key) => {
    setPickerOpen(false);
    if (key === "physical_product" || key === "shopify_external") {
      setProductEditingId(null);
      setProductOriginalImageId(null);
      setProductForm({ ...BLANK_PRODUCT_FORM, sales_destination: key === "shopify_external" ? "shopify_external" : "internal" });
    } else if (key === "credit_pack") {
      setPackEditing(null);
      setPackOriginalImageId(null);
      setPackErr("");
      setPackForm({ ...BLANK_PACK_FORM });
    } else if (key === "training_program") {
      setProgramOriginalImageId(null);
      setProgramForm(blankProgramForm());
    }
  };

  const editItem = async (item) => {
    if (item.kind === "physical_product") {
      const { data } = await api.get("/pos/products", { params: item.archived ? { include_archived: true } : { include_inactive: true } });
      const raw = (data || []).find((p) => p.id === item.id);
      if (!raw) { toast.error("Could not load product"); return; }
      setProductEditingId(raw.id);
      setProductOriginalImageId(raw.image_id || null);
      setProductForm({
        name: raw.name || "", category: raw.category || "", description: raw.description || "",
        price: String(raw.price ?? ""), cost: raw.cost != null ? String(raw.cost) : "",
        starting_stock: String(raw.stock_on_hand ?? 0),
        low_stock_threshold: raw.low_stock_threshold != null ? String(raw.low_stock_threshold) : "",
        track_inventory: !!raw.track_inventory, active: raw.active !== false,
        show_online: !!raw.show_online, online_description: raw.online_description || "",
        image_id: raw.image_id || null,
        online_sort_order: raw.online_sort_order != null ? String(raw.online_sort_order) : "",
        category_id: raw.category_id || null, subcategory_id: raw.subcategory_id || null,
        featured: !!raw.featured, show_at_register: raw.show_at_register !== false,
        sales_destination: raw.sales_destination === "shopify_external" ? "shopify_external" : "internal",
        shopify_product_url: raw.shopify_product_url || "",
        shopify_display_price: raw.shopify_display_price != null ? String(raw.shopify_display_price) : "",
        shopify_from_price: !!raw.shopify_from_price,
        publicly_visible: !!raw.publicly_visible, guest_cart_allowed: !!raw.guest_cart_allowed,
        show_public_price: raw.show_public_price !== false,
        requires_approval: !!raw.requires_approval, requires_completed_onboarding: !!raw.requires_completed_onboarding,
      });
    } else if (item.kind === "credit_pack") {
      const { data } = await api.get("/credit-packs", { params: { include_inactive: true } });
      const raw = (data || []).find((p) => p.id === item.id);
      if (!raw) { toast.error("Could not load pack"); return; }
      setPackEditing(raw);
      setPackOriginalImageId(raw.image_id || null);
      setPackErr("");
      setPackForm({ ...BLANK_PACK_FORM, ...raw });
    } else {
      const { data } = await api.get("/programs", { params: { include_inactive: true } });
      const raw = (data || []).find((p) => p.id === item.id);
      if (!raw) { toast.error("Could not load program"); return; }
      setProgramOriginalImageId(raw.image_id || null);
      setProgramForm({ ...raw });
    }
  };

  const saveProduct = async () => {
    if (!productForm.name.trim()) { toast.error("Product name is required"); return; }
    const isShopify = productForm.sales_destination === "shopify_external";
    if (!isShopify && !(Number(productForm.price) >= 0)) { toast.error("Selling price is required"); return; }
    if (isShopify && !productForm.shopify_product_url.trim()) { toast.error("A Shopify product URL is required"); return; }
    const body = {
      name: productForm.name.trim(), category: isShopify ? "" : productForm.category.trim(), description: productForm.description.trim() || null,
      price: isShopify ? 0 : Number(productForm.price), cost: (!isShopify && productForm.cost !== "") ? Number(productForm.cost) : null,
      low_stock_threshold: (!isShopify && productForm.low_stock_threshold !== "") ? Number(productForm.low_stock_threshold) : null,
      track_inventory: !isShopify && productForm.track_inventory, active: productForm.active,
      show_online: productForm.show_online, online_description: productForm.online_description.trim() || null,
      image_id: productForm.image_id || null,
      online_sort_order: productForm.online_sort_order !== "" ? parseInt(productForm.online_sort_order, 10) : null,
      category_id: productForm.category_id || null, subcategory_id: productForm.subcategory_id || null,
      featured: productForm.featured, show_at_register: productForm.show_at_register,
      sales_destination: productForm.sales_destination,
      shopify_product_url: isShopify ? productForm.shopify_product_url.trim() : null,
      shopify_display_price: (isShopify && productForm.shopify_display_price !== "") ? Number(productForm.shopify_display_price) : null,
      shopify_from_price: isShopify && productForm.shopify_from_price,
      publicly_visible: !isShopify && productForm.publicly_visible,
      guest_cart_allowed: !isShopify && productForm.publicly_visible && productForm.guest_cart_allowed,
      show_public_price: productForm.show_public_price,
      requires_approval: !isShopify && productForm.publicly_visible && productForm.requires_approval,
      requires_completed_onboarding: !isShopify && productForm.publicly_visible && productForm.requires_completed_onboarding,
    };
    setProductSaving(true);
    try {
      if (productEditingId) {
        await api.put(`/pos/products/${productEditingId}`, body);
        toast.success("Product updated");
      } else {
        await api.post("/pos/products", { ...body, starting_stock: isShopify ? 0 : Number(productForm.starting_stock || 0) });
        toast.success("Product added");
      }
      if (productOriginalImageId && productOriginalImageId !== productForm.image_id) {
        api.delete(`/shop/media/${productOriginalImageId}`).catch(() => {});
      }
      setProductForm(null);
      bumpRefresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save product");
    }
    setProductSaving(false);
  };
  const closeProductWithoutSaving = () => {
    if (productForm?.image_id && productForm.image_id !== productOriginalImageId) {
      api.delete(`/shop/media/${productForm.image_id}`).catch(() => {});
    }
    setProductForm(null);
  };

  const savePack = async () => {
    setPackErr("");
    if (!packForm.name?.trim()) { setPackErr("Pack name is required."); return; }
    if (!Number.isFinite(packForm.qty) || packForm.qty < 1) { setPackErr("Credits per pack must be at least 1."); return; }
    if (!Number.isFinite(packForm.price) || packForm.price < 0) { setPackErr("Price must be 0 or higher."); return; }
    try {
      if (packEditing) await api.put(`/credit-packs/${packEditing.id}`, packForm);
      else await api.post("/credit-packs", packForm);
      if (packOriginalImageId && packOriginalImageId !== packForm.image_id) {
        api.delete(`/shop/media/${packOriginalImageId}`).catch(() => {});
      }
      toast.success(packEditing ? "Pack updated" : "Pack added");
      setPackForm(null);
      bumpRefresh();
    } catch (e) {
      setPackErr(formatErr(e.response?.data?.detail) || "Save failed");
    }
  };
  const closePackWithoutSaving = () => {
    if (packForm?.image_id && packForm.image_id !== packOriginalImageId) {
      api.delete(`/shop/media/${packForm.image_id}`).catch(() => {});
    }
    setPackForm(null);
  };

  const saveProgram = async () => {
    try {
      const payload = { ...programForm };
      if (programForm.id) {
        // Editing an existing program: ask whether to push changes to dogs
        // already enrolled — mirrors Programs.jsx's own save() exactly, so
        // Shop Manager never silently defaults to (or skips) a cascade.
        let cascade = false;
        try {
          const { data } = await api.get(`/programs/${programForm.id}/active-enrollments-count`);
          if ((data?.count || 0) > 0) {
            cascade = await confirm({
              title: `Apply changes to ${data.count} enrolled dog${data.count > 1 ? "s" : ""}?`,
              body: "Yes: every active enrollment updates to the new program. Trainer scores and notes for goals that still exist are preserved; progress on any removed goals is dropped.\n\nNo: only future enrollments use the new version. Currently-enrolled dogs keep their existing program snapshot.",
              confirmText: "Yes, update enrolled dogs",
              cancelText: "No, only future enrollments",
              tone: "warning",
            });
          }
        } catch { /* count endpoint failure isn't fatal — just skip cascade */ }
        const url = `/programs/${programForm.id}${cascade ? "?cascade=true" : ""}`;
        await api.put(url, payload);
      } else {
        await api.post("/programs", payload);
      }
      if (programOriginalImageId && programOriginalImageId !== payload.image_id) {
        api.delete(`/shop/media/${programOriginalImageId}`).catch(() => {});
      }
      toast.success(programForm.id ? "Program updated" : "Program added");
      setProgramForm(null);
      bumpRefresh();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Save failed");
    }
  };
  const closeProgramWithoutSaving = () => {
    if (programForm?.image_id && programForm.image_id !== programOriginalImageId) {
      api.delete(`/shop/media/${programForm.image_id}`).catch(() => {});
    }
    setProgramForm(null);
  };

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow={{ icon: "fa-bag-shopping", text: "Shop Manager", color: "text-shPrimary" }}
        title="Shop Manager"
        highlight="one place for everything you sell."
        subtitle="Create, edit, organize, price, and display physical products, Shopify merchandise, prepaid visit packs, and training programs — all from one screen."
      />

      <div className="flex gap-2 border-b border-shBorder">
        {[["items", "Items"], ["categories", "Categories & Layout"], ["shop_settings", "Shop Settings"], ["orders", "Online Orders"], ["preview", "Client Preview"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} data-testid={`sm-tab-${key}`}
                  className={`px-3 py-2 text-[12px] font-black uppercase tracking-widest border-b-2 -mb-px ${
                    tab === key ? "border-shPrimary text-shPrimary" : "border-transparent text-shTextMuted hover:text-shText"
                  }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "items" && <ItemsTab key={refreshKey} onEditItem={editItem} onAddShopItem={() => setPickerOpen(true)} />}
      {tab === "categories" && <CategoriesTab key={`cat-${refreshKey}`} />}
      {tab === "shop_settings" && <ShopSettingsTab key={`shop-settings-${refreshKey}`} />}
      {tab === "orders" && <OnlineOrdersTab key={`orders-${refreshKey}`} />}
      {tab === "preview" && <ClientPreviewTab key={`prev-${refreshKey}`} />}

      {pickerOpen && <TypePickerModal onClose={() => setPickerOpen(false)} onPick={pickType} />}

      {productForm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" data-testid="sm-product-editor-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <ProductEditor form={productForm} setForm={setProductForm} editingId={productEditingId}
                           originalImageId={productOriginalImageId} saving={productSaving}
                           onSave={saveProduct} onClose={closeProductWithoutSaving} />
          </div>
        </div>
      )}

      {packForm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6" data-testid="sm-pack-editor-modal">
          <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl shadow-2xl max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto">
            <div className="sticky top-0 bg-[var(--sh-card-base)] border-b border-shBorder px-5 py-4 flex items-center justify-between gap-3 z-10">
              <h5 className="text-shText font-black text-[16px] uppercase italic tracking-tight">{packEditing ? `Edit · ${packEditing.name}` : "New Pack"}</h5>
              <button onClick={closePackWithoutSaving} className="text-shTextMuted hover:text-shText"><i className="fas fa-xmark text-xl" /></button>
            </div>
            <PackEditor form={packForm} setForm={setPackForm} editing={packEditing} originalImageId={packOriginalImageId}
                        emailTemplates={emailTemplates} err={packErr} onSave={savePack} onClose={closePackWithoutSaving} />
          </div>
        </div>
      )}

      {programForm && programMeta && (
        <ProgramEditor program={programForm} setProgram={setProgramForm} meta={programMeta} allPrograms={allPrograms}
                       onSave={saveProgram} onClose={closeProgramWithoutSaving} originalImageId={programOriginalImageId} />
      )}
    </div>
  );
}
