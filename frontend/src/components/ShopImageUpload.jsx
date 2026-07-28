import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import { toast } from "sonner";

// Client Shop Phase 1 — one shared image-upload widget reused by Manage
// Products, Credit Packs Settings, and Programs. Uploads to the shared
// POST /shop/media endpoint and stores only the returned image_id on the
// parent record — the image bytes never live on the product/pack/program
// document itself.
//
// Media lifecycle (see server.py's DELETE /shop/media/{id}):
//   - `originalImageId` is the image the entity ALREADY had saved when this
//     form opened (null for a brand-new entity). This widget never deletes
//     that one itself — only the parent, after ITS save succeeds, may
//     delete the old originalImageId (never before).
//   - Any OTHER image_id currently showing (i.e. `imageId !== originalImageId`)
//     is a not-yet-saved upload from this same editing session, so it is
//     always safe for this widget to delete it immediately when replaced
//     or removed — nothing points to it yet, and losing it costs nothing.
export default function ShopImageUpload({ imageId, originalImageId = null, onChange }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!imageId) { setPreview(null); return; }
    let cancelled = false;
    api.get(`/shop/media/${imageId}`)
      .then(({ data }) => { if (!cancelled) setPreview(data.data); })
      .catch(() => { if (!cancelled) setPreview(null); });
    return () => { cancelled = true; };
  }, [imageId]);

  const deleteIfTemporary = (id) => {
    if (id && id !== originalImageId) {
      api.delete(`/shop/media/${id}`).catch(() => {}); // best-effort
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 });
      const { data } = await api.post("/shop/media", { data: compressed, filename: file.name });
      deleteIfTemporary(imageId); // replacing an unsaved temp upload — safe to drop it now
      onChange(data.media_id);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not upload image");
    }
    setBusy(false);
  };

  const handleRemove = () => {
    deleteIfTemporary(imageId); // only deletes if this was a not-yet-saved upload
    onChange(null);
  };

  return (
    <div className="flex items-center gap-3" data-testid="shop-image-upload">
      {preview ? (
        <img src={preview} alt="" className="w-16 h-16 object-cover rounded border border-bgHover" />
      ) : (
        <div className="w-16 h-16 rounded border border-dashed border-bgHover flex items-center justify-center text-gray-600">
          <i className="fas fa-image" />
        </div>
      )}
      <label className="bg-bgBase border border-bgHover text-gray-300 px-3 py-2 rounded text-[11px] font-black uppercase tracking-widest cursor-pointer hover:border-shGreen/50 transition">
        {busy ? "Uploading…" : "Upload Photo"}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} disabled={busy} data-testid="shop-image-file-input" />
      </label>
      {imageId && (
        <button type="button" onClick={handleRemove}
                className="text-gray-500 hover:text-red-400 text-[11px] font-black uppercase tracking-widest">
          Remove
        </button>
      )}
    </div>
  );
}
