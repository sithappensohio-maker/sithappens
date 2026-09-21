import { useState } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import { shopImageUrl } from "../lib/shopImage";
import { toast } from "sonner";

/**
 * Product photo management for Shop Manager.
 *
 * Replaces the single-photo widget for products. The first image in the list
 * IS the primary one — the one that shows on cards, at the register and on a
 * receipt — so "make primary" is just "move to the front", which is easier
 * to understand and impossible to get into a contradictory state.
 *
 * Legacy products need nothing done to them: a product that only ever had
 * `image_id` arrives here as a one-image list and saves back as a one-image
 * gallery with the same picture still primary.
 *
 * Previews use the real derivative URLs, so opening the editor for a product
 * with eight photos costs eight ~2 KB thumbnails rather than eight
 * multi-megabyte originals.
 */
const MAX_IMAGES = 8;

export default function ShopGalleryUpload({ imageIds = [], originalImageIds = [], onChange }) {
  const [busy, setBusy] = useState(false);
  const ids = (imageIds || []).filter(Boolean);

  // Only an upload from THIS editing session is safe to delete on removal —
  // anything the product already had must survive until the parent's own
  // save succeeds, exactly as the single-image widget has always behaved.
  const deleteIfTemporary = (id) => {
    if (id && !(originalImageIds || []).includes(id)) {
      api.delete(`/shop/media/${id}`).catch(() => {});
    }
  };

  const addFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (!files.length) return;
    const room = MAX_IMAGES - ids.length;
    if (room <= 0) { toast.error(`Up to ${MAX_IMAGES} photos per product.`); return; }
    setBusy(true);
    const added = [];
    for (const file of files.slice(0, room)) {
      try {
        // Still compressed client-side: it keeps a 12 MP phone photo under
        // the upload ceiling. The server then builds every display size.
        const compressed = await compressImage(file, { maxWidth: 2000, maxHeight: 2000, quality: 0.86 });
        const { data } = await api.post("/shop/media", { data: compressed, filename: file.name });
        added.push(data.media_id);
      } catch (err) {
        toast.error(err?.response?.data?.detail || `Could not upload ${file.name}`);
      }
    }
    if (added.length) onChange([...ids, ...added]);
    if (files.length > room) toast.error(`Only the first ${room} were added — max ${MAX_IMAGES}.`);
    setBusy(false);
  };

  const move = (from, to) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  const remove = (id) => {
    deleteIfTemporary(id);
    onChange(ids.filter((x) => x !== id));
  };

  return (
    <div data-testid="shop-gallery-upload">
      <div className="flex flex-wrap gap-2">
        {ids.map((id, i) => (
          <div key={id} data-testid={`gallery-item-${i}`}
               className={`relative rounded border ${i === 0 ? "border-shGreen" : "border-bgHover"}`}>
            <img src={shopImageUrl(id, "thumb")} alt={i === 0 ? "Primary product photo" : `Product photo ${i + 1}`}
                 width={72} height={72} loading="lazy"
                 className="w-[72px] h-[72px] object-cover rounded" />
            {i === 0 && (
              <span className="absolute top-0 left-0 bg-shGreen text-bgHeader text-[9px] font-black uppercase tracking-widest px-1 rounded-br"
                    data-testid="gallery-primary-badge">Primary</span>
            )}
            <div className="flex items-center justify-between gap-0.5 px-1 py-0.5">
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0}
                      aria-label={`Move photo ${i + 1} earlier`} data-testid={`gallery-left-${i}`}
                      className="text-gray-400 hover:text-shGreen disabled:opacity-25 text-[11px] px-1">
                <i className="fas fa-chevron-left" />
              </button>
              <button type="button" onClick={() => remove(id)}
                      aria-label={`Remove photo ${i + 1}`} data-testid={`gallery-remove-${i}`}
                      className="text-gray-500 hover:text-red-400 text-[11px] px-1">
                <i className="fas fa-trash" />
              </button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === ids.length - 1}
                      aria-label={`Move photo ${i + 1} later`} data-testid={`gallery-right-${i}`}
                      className="text-gray-400 hover:text-shGreen disabled:opacity-25 text-[11px] px-1">
                <i className="fas fa-chevron-right" />
              </button>
            </div>
          </div>
        ))}

        {ids.length < MAX_IMAGES && (
          <label className="w-[72px] h-[72px] rounded border border-dashed border-bgHover flex flex-col items-center justify-center text-gray-600 hover:border-shGreen/50 cursor-pointer transition">
            <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-plus"}`} />
            <span className="text-[9px] uppercase tracking-widest mt-1">{busy ? "…" : "Add"}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                   onChange={addFiles} disabled={busy} data-testid="gallery-file-input" />
          </label>
        )}
      </div>
      <p className="text-[11px] text-shTextMuted mt-1.5">
        {ids.length === 0
          ? "No photos yet. The first one you add becomes the primary image."
          : `The first photo is the primary one — it is what shows on cards, at the register and on receipts. ${ids.length} of ${MAX_IMAGES} used.`}
      </p>
    </div>
  );
}
