import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

/* Client Shop — Phase 1 (catalog browsing only, no checkout yet).
 * Aggregates the three existing authoritative sources via GET /shop/catalog
 * (pos_products, credit_packs, programs) — this component never defines its
 * own product/pack/program data, it only displays what that endpoint returns.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const TABS = [
  { key: "all", label: "All" },
  { key: "product", label: "Merch & Gear" },
  { key: "credit_pack", label: "Credit Packs" },
  { key: "training_program", label: "Training" },
];

function ShopImage({ imageId, alt }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!imageId) { setSrc(null); return; }
    let cancelled = false;
    api.get(`/shop/media/${imageId}`)
      .then(({ data }) => { if (!cancelled) setSrc(data.data); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [imageId]);

  if (src) return <img src={src} alt={alt || ""} className="w-full h-32 object-cover rounded-lg" />;
  return (
    <div className="w-full h-32 rounded-lg bg-bgBase border border-bgHover grid place-items-center text-gray-600">
      <i className="fas fa-image text-2xl" />
    </div>
  );
}

function ItemCard({ item }) {
  return (
    <div className="bg-bgPanel border border-bgHover rounded-xl p-3 flex flex-col" data-testid={`shop-card-${item.kind}-${item.id}`}>
      <ShopImage imageId={item.image_id} alt={item.name} />
      <p className="text-white font-black text-[14px] mt-3 truncate">{item.name}</p>
      {item.description && <p className="text-gray-400 text-[12px] mt-1 line-clamp-2">{item.description}</p>}

      {item.kind === "product" && (
        <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black mt-1">
          {item.track_inventory
            ? (item.in_stock ? `${item.stock_on_hand} in stock` : "Out of stock")
            : "Available"}
        </p>
      )}
      {item.kind === "credit_pack" && (
        <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black mt-1">
          {item.qty} {item.service_type} credits
        </p>
      )}
      {item.kind === "training_program" && (
        <p className="text-[11px] text-gray-500 uppercase tracking-widest font-black mt-1">
          {item.format_count} {item.format_unit}
        </p>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between gap-2">
        <p className="text-shGreen font-black text-[18px]">{money(item.price)}</p>
        <button disabled data-testid={`shop-buy-${item.kind}-${item.id}`}
                className="bg-bgBase border border-bgHover text-gray-500 px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest cursor-not-allowed">
          Coming Next
        </button>
      </div>
    </div>
  );
}

export default function PortalShop({ initialTab = "all" }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(initialTab);

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  useEffect(() => {
    setLoading(true);
    api.get("/shop/catalog")
      .then(({ data }) => setItems(data.items || []))
      .catch((e) => setErr(e?.response?.data?.detail || "Could not load the shop"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return items;
    return items.filter((i) => i.kind === tab);
  }, [items, tab]);

  return (
    <div id="portal-shop-anchor" className="bg-bgPanel card-pop p-6 rounded-2xl border border-bgHover shadow-2xl" data-testid="portal-shop">
      <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen text-center mb-4">
        <i className="fas fa-bag-shopping mr-1" />Shop
      </p>

      <div className="flex flex-wrap gap-2 justify-center mb-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`shop-tab-${t.key}`}
                  className={`px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest transition ${
                    tab === t.key ? "bg-shGreen text-bgHeader" : "bg-bgBase border border-bgHover text-gray-400 hover:border-shGreen/50"
                  }`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-500 text-sm text-center py-6">Loading the shop…</p>}
      {!loading && err && <p className="text-red-400 text-sm text-center py-6">{err}</p>}
      {!loading && !err && filtered.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-6">Nothing here yet — check back soon.</p>
      )}
      {!loading && !err && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {filtered.map((item) => <ItemCard key={`${item.kind}-${item.id}`} item={item} />)}
        </div>
      )}
    </div>
  );
}
