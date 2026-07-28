/* Manage Products — simple retail stock management, reached from Front Desk.
 *
 * No barcodes, no SKU/UPC requirement. Reuses the existing pos_products
 * catalog (GET/POST/PUT /pos/products) and adds the stock side: starting
 * stock at creation, POST /pos/products/{id}/adjust-stock for receiving
 * shipments and manual corrections (always with a reason, never a silent
 * edit), and GET /pos/products/{id}/movements for history. Editing a
 * product's info (name/price/etc.) never touches stock_on_hand — that only
 * changes via a sale, a void, or an explicit adjustment here.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import ShopImageUpload from "./ShopImageUpload";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const BLANK_FORM = {
  name: "", category: "", description: "", price: "", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  show_online: false, online_description: "", image_id: null, online_sort_order: "",
};

function stockStatus(p) {
  if (!p.active) return { label: "INACTIVE", cls: "text-gray-500 bg-bgHover" };
  if (!p.track_inventory) return { label: "NOT TRACKED", cls: "text-gray-400 bg-bgHover" };
  const stock = Number(p.stock_on_hand || 0);
  if (stock <= 0.0005) return { label: "OUT OF STOCK", cls: "text-red-400 bg-red-500/10" };
  if (p.low_stock_threshold != null && stock <= Number(p.low_stock_threshold) + 0.0005) {
    return { label: "LOW STOCK", cls: "text-shOrange bg-shOrange/10" };
  }
  return { label: "IN STOCK", cls: "text-shGreen bg-shGreen/10" };
}

export default function ManageProductsPanel({ onClose, onChanged }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | low | out | inactive

  const load = () => {
    setLoading(true);
    api.get("/pos/products", { params: { include_inactive: true } })
      .then(({ data }) => setProducts(data || []))
      .catch(() => toast.error("Could not load products"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => products.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "inactive") return !p.active;
    if (!p.active) return filter === "all" ? true : false;
    if (filter === "low") {
      return p.track_inventory && p.low_stock_threshold != null &&
        Number(p.stock_on_hand || 0) <= Number(p.low_stock_threshold) + 0.0005 && Number(p.stock_on_hand || 0) > 0.0005;
    }
    if (filter === "out") return p.track_inventory && Number(p.stock_on_hand || 0) <= 0.0005;
    return true;
  }), [products, search, filter]);

  // ── Add/Edit form ─────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  // Client Shop Phase 1 media lifecycle — the image_id this product had
  // BEFORE this form opened (null for a brand-new product). Never deleted
  // by ShopImageUpload itself; only this panel deletes it, and only after
  // a successful save that actually replaced/removed it.
  const [originalImageId, setOriginalImageId] = useState(null);

  const openAdd = () => { setEditingId(null); setForm(BLANK_FORM); setOriginalImageId(null); setFormOpen(true); };
  const openEdit = (p) => {
    setEditingId(p.id);
    setOriginalImageId(p.image_id || null);
    setForm({
      name: p.name || "", category: p.category || "", description: p.description || "",
      price: String(p.price ?? ""), cost: p.cost != null ? String(p.cost) : "",
      starting_stock: String(p.stock_on_hand ?? 0),
      low_stock_threshold: p.low_stock_threshold != null ? String(p.low_stock_threshold) : "",
      track_inventory: !!p.track_inventory, active: p.active !== false,
      show_online: !!p.show_online, online_description: p.online_description || "",
      image_id: p.image_id || null,
      online_sort_order: p.online_sort_order != null ? String(p.online_sort_order) : "",
    });
    setFormOpen(true);
  };

  // Shared cleanup: if a new (not-yet-saved) image was uploaded this
  // session, delete it; the original persisted image (if any) is left
  // alone since nothing about the product actually changed.
  const cleanupUnsavedImageIfAny = () => {
    if (form.image_id && form.image_id !== originalImageId) {
      api.delete(`/shop/media/${form.image_id}`).catch(() => {});
    }
  };

  const closeFormWithoutSaving = () => {
    cleanupUnsavedImageIfAny();
    setFormOpen(false);
  };

  // The panel's own top-level X closes the WHOLE Manage Products modal —
  // including the add/edit form if it happened to be open underneath.
  // That exit path must get the identical cleanup as Cancel; otherwise
  // closing the panel with the form open leaks the same temp upload.
  const handlePanelClose = () => {
    if (formOpen) cleanupUnsavedImageIfAny();
    onClose();
  };

  const saveForm = async () => {
    if (!form.name.trim()) { toast.error("Product name is required"); return; }
    if (!(Number(form.price) >= 0)) { toast.error("Selling price is required"); return; }
    const body = {
      name: form.name.trim(), category: form.category.trim(), description: form.description.trim() || null,
      price: Number(form.price), cost: form.cost !== "" ? Number(form.cost) : null,
      low_stock_threshold: form.low_stock_threshold !== "" ? Number(form.low_stock_threshold) : null,
      track_inventory: form.track_inventory, active: form.active,
      show_online: form.show_online, online_description: form.online_description.trim() || null,
      image_id: form.image_id || null,
      online_sort_order: form.online_sort_order !== "" ? parseInt(form.online_sort_order, 10) : null,
    };
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/pos/products/${editingId}`, body);
        toast.success("Product updated");
      } else {
        await api.post("/pos/products", { ...body, starting_stock: Number(form.starting_stock || 0) });
        toast.success("Product added");
      }
      // Save succeeded — NOW it's safe to drop the old image, if replaced/removed.
      if (originalImageId && originalImageId !== form.image_id) {
        api.delete(`/shop/media/${originalImageId}`).catch(() => {});
      }
      setFormOpen(false);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save product");
    }
    setSaving(false);
  };

  // ── Quick stock actions (receive / adjust) ──────────────────────────────
  const [stockModal, setStockModal] = useState(null); // { product, mode: "receive" | "adjust" }
  const [stockQty, setStockQty] = useState("");
  const [stockReason, setStockReason] = useState("");
  const [stockBusy, setStockBusy] = useState(false);

  const openReceive = (p) => { setStockModal({ product: p, mode: "receive" }); setStockQty(""); setStockReason("Shipment received"); };
  const openAdjust = (p) => { setStockModal({ product: p, mode: "adjust" }); setStockQty(""); setStockReason(""); };

  const submitStock = async () => {
    const qty = Number(stockQty);
    if (!qty) { toast.error("Enter a non-zero quantity"); return; }
    if (stockReason.trim().length < 3) { toast.error("Enter a reason (3+ characters)"); return; }
    const delta = stockModal.mode === "receive" ? Math.abs(qty) : qty;
    const source = stockModal.mode === "receive" ? "RESTOCK" : "MANUAL_ADJUSTMENT";
    setStockBusy(true);
    try {
      await api.post(`/pos/products/${stockModal.product.id}/adjust-stock`, {
        quantity_delta: delta, reason: stockReason.trim(), source,
      });
      toast.success("Stock updated");
      setStockModal(null);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not adjust stock");
    }
    setStockBusy(false);
  };

  // ── History ──────────────────────────────────────────────────────────────
  const [historyProduct, setHistoryProduct] = useState(null);
  const [movements, setMovements] = useState([]);
  const openHistory = (p) => {
    setHistoryProduct(p);
    api.get(`/pos/products/${p.id}/movements`).then(({ data }) => setMovements(data || [])).catch(() => setMovements([]));
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" data-testid="manage-products-panel">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-white text-xl font-black uppercase tracking-widest">Manage Products</p>
          <button onClick={handlePanelClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-lg" /></button>
        </div>

        {formOpen ? (
          <div className="space-y-3">
            <p className="text-gray-400 text-[13px] uppercase tracking-widest font-black">{editingId ? "Edit Product" : "Add Product"}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] text-gray-500 uppercase tracking-widest">Product Name *</label>
                <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-widest">Category</label>
                <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-widest">Selling Price *</label>
                <input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-widest">Cost (optional)</label>
                <input type="number" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-widest">
                  {editingId ? "Stock On Hand (use Receive/Adjust to change)" : "Starting Stock"}
                </label>
                <input type="number" disabled={!!editingId} value={form.starting_stock}
                       onChange={(e) => setForm((f) => ({ ...f, starting_stock: e.target.value }))}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white disabled:opacity-50" />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-gray-500 uppercase tracking-widest">Description (optional)</label>
                <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                       className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="track-inv" checked={form.track_inventory}
                       onChange={(e) => setForm((f) => ({ ...f, track_inventory: e.target.checked }))} />
                <label htmlFor="track-inv" className="text-white text-sm">Track Inventory</label>
              </div>
              {form.track_inventory && (
                <div>
                  <label className="text-[11px] text-gray-500 uppercase tracking-widest">Low Stock Warning</label>
                  <input type="number" value={form.low_stock_threshold}
                         onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))}
                         className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.active}
                       onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
                <label htmlFor="active" className="text-white text-sm">Active</label>
              </div>
            </div>

            {/* Client Shop Phase 1 — additive online-visibility controls. */}
            <div className="border-t border-bgHover pt-3 mt-1 space-y-3">
              <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black">Client Shop</p>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="show-online" checked={form.show_online}
                       onChange={(e) => setForm((f) => ({ ...f, show_online: e.target.checked }))}
                       data-testid="product-show-online" />
                <label htmlFor="show-online" className="text-white text-sm">Show Online (client Shop)</label>
              </div>
              {form.show_online && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-[11px] text-gray-500 uppercase tracking-widest">Online Description (optional — falls back to Description)</label>
                    <input value={form.online_description} onChange={(e) => setForm((f) => ({ ...f, online_description: e.target.value }))}
                           data-testid="product-online-description"
                           className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-widest">Sort Order (optional)</label>
                    <input type="number" value={form.online_sort_order}
                           onChange={(e) => setForm((f) => ({ ...f, online_sort_order: e.target.value }))}
                           className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[11px] text-gray-500 uppercase tracking-widest mb-1 block">Product Photo</label>
                    <ShopImageUpload imageId={form.image_id} originalImageId={originalImageId}
                                     onChange={(id) => setForm((f) => ({ ...f, image_id: id }))} />
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={closeFormWithoutSaving} className="flex-1 text-gray-400 font-black uppercase text-sm tracking-widest py-3">
                Cancel
              </button>
              <button onClick={saveForm} disabled={saving}
                      className="flex-1 bg-shGreen text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : historyProduct ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-[13px] uppercase tracking-widest font-black">History — {historyProduct.name}</p>
              <button onClick={() => setHistoryProduct(null)} className="text-shGreen text-[11px] font-black uppercase tracking-widest">Back</button>
            </div>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {movements.length === 0 && <p className="text-gray-500 text-sm">No stock movements yet.</p>}
              {movements.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm border-b border-bgHover py-1.5">
                  <div>
                    <span className="text-white font-bold">{new Date(m.created_at).toLocaleDateString()}</span>{" "}
                    <span className="text-gray-400">{m.type} — {m.reason}</span>
                  </div>
                  <span className={m.quantity_delta > 0 ? "text-shGreen font-bold" : "text-red-400 font-bold"}>
                    {m.quantity_delta > 0 ? "+" : ""}{m.quantity_delta}{"  "}
                    <span className="text-gray-500 font-normal">{m.stock_before} → {m.stock_after}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products"
                     className="flex-1 min-w-[160px] bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              {[["all", "All"], ["low", "Low Stock"], ["out", "Out of Stock"], ["inactive", "Inactive"]].map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                        className={`px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest ${filter === k ? "bg-shGreen text-bgHeader" : "bg-bgBase text-gray-400"}`}>
                  {label}
                </button>
              ))}
              <button onClick={openAdd} className="bg-shGreen text-bgHeader rounded px-4 py-2 text-[12px] font-black uppercase tracking-widest">
                + Add Product
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 text-[11px] uppercase tracking-widest text-left border-b border-bgHover">
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2">Category</th>
                    <th className="py-2 pr-2 text-right">Price</th>
                    <th className="py-2 pr-2 text-right">Cost</th>
                    <th className="py-2 pr-2 text-right">Stock</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={7} className="py-6 text-center text-gray-500">Loading…</td></tr>}
                  {!loading && filtered.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-gray-500">No products found.</td></tr>}
                  {filtered.map((p) => {
                    const status = stockStatus(p);
                    return (
                      <tr key={p.id} className="border-b border-bgHover/60">
                        <td className="py-2 pr-2 text-white font-bold cursor-pointer" onClick={() => openEdit(p)}>{p.name}</td>
                        <td className="py-2 pr-2 text-gray-400">{p.category || "—"}</td>
                        <td className="py-2 pr-2 text-right text-white">{money(p.price)}</td>
                        <td className="py-2 pr-2 text-right text-gray-400">{p.cost != null ? money(p.cost) : "—"}</td>
                        <td className="py-2 pr-2 text-right text-white">{p.track_inventory ? p.stock_on_hand : "—"}</td>
                        <td className="py-2 pr-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest ${status.cls}`}>{status.label}</span>
                        </td>
                        <td className="py-2 pr-2 whitespace-nowrap">
                          <div className="flex items-center gap-2 justify-end">
                            {p.track_inventory && (
                              <>
                                <button onClick={() => openReceive(p)} className="text-shGreen text-[11px] font-black uppercase tracking-widest">Receive</button>
                                <button onClick={() => openAdjust(p)} className="text-gray-400 text-[11px] font-black uppercase tracking-widest">Adjust</button>
                                <button onClick={() => openHistory(p)} className="text-gray-400 text-[11px] font-black uppercase tracking-widest">History</button>
                              </>
                            )}
                            <button onClick={() => openEdit(p)} className="text-gray-400 text-[11px] font-black uppercase tracking-widest">Edit</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {stockModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-sm p-5 space-y-3">
            <p className="text-white font-black uppercase tracking-widest">
              {stockModal.mode === "receive" ? "Receive Stock" : "Adjust Stock"} — {stockModal.product.name}
            </p>
            <p className="text-gray-400 text-sm">Current: {stockModal.product.stock_on_hand}</p>
            <div>
              <label className="text-[11px] text-gray-500 uppercase tracking-widest">
                {stockModal.mode === "receive" ? "Quantity received" : "Quantity adjustment (+/-)"}
              </label>
              <input type="number" value={stockQty} onChange={(e) => setStockQty(e.target.value)}
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 uppercase tracking-widest">Reason</label>
              <input value={stockReason} onChange={(e) => setStockReason(e.target.value)} placeholder="e.g. Damaged, Lost, count correction"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white" />
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setStockModal(null)} className="flex-1 text-gray-400 font-black uppercase text-sm tracking-widest py-3">
                Cancel
              </button>
              <button onClick={submitStock} disabled={stockBusy}
                      className="flex-1 bg-shGreen text-bgHeader rounded-xl py-3 font-black uppercase tracking-widest disabled:opacity-40">
                {stockBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
