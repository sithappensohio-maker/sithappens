import { useState } from "react";
import { api, API_BASE } from "../../lib/api";
import { toast } from "sonner";

// Theme Studio — one self-contained image-upload slot. Mirrors
// ShopImageUpload's API-ownership shape (the WIDGET itself owns the
// upload/delete calls; the parent only ever stores an asset id), but talks
// to the new, genuinely-public /theme-assets backend instead of the
// session-gated /shop/media one, and never recompresses the file (several
// slots are transparent PNGs or animated GIF/WEBP — canvas recompression
// would flatten/destroy both).
//
// Asset lifecycle (same rule as ShopImageUpload's deleteIfTemporary):
//   - `originalAssetId` is whatever this slot already had saved when the
//     editing session opened (null for an empty slot). This widget never
//     deletes that one itself — only the parent, after ITS OWN save
//     succeeds, may delete the true original.
//   - Any OTHER asset id currently showing (i.e. `assetId !== originalAssetId`)
//     is a not-yet-saved upload from this same editing session, so it's
//     always safe for this widget to delete it immediately when replaced
//     or removed — nothing points to it yet.
export default function ThemeAssetSlot({
  slotKey,
  label,
  hint,
  accept,
  isAnimation = false,
  previewSize = "card",
  assetId,
  originalAssetId = null,
  onChange,
}) {
  const [uploading, setUploading] = useState(false);

  const deleteIfTemporary = (id) => {
    if (id && id !== originalAssetId) {
      api.delete(`/theme-assets/${id}`).catch(() => {}); // best-effort
    }
  };

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) { e.target.value = ""; return; }

    const acceptedTypes = accept.split(",").map((t) => t.trim());
    if (!acceptedTypes.includes(file.type)) {
      if (isAnimation) {
        toast.error("Only GIF or WEBP files work here — use one of the other image slots for a regular picture.");
      } else if (file.type === "image/gif") {
        toast.error("GIFs only work in the Animation slot — this one needs a still image.");
      } else {
        toast.error("That file type isn't supported for this slot.");
      }
      e.target.value = "";
      return;
    }

    const previousAssetId = assetId;
    setUploading(true);
    try {
      // No canvas/compressImage here on purpose — that path always flattens
      // to an opaque-background JPEG, which would destroy PNG transparency
      // and animation frames. Post the raw file bytes verbatim; the backend
      // builds its own correctly-sized derivatives server-side (Pillow).
      const dataUrl = await readAsDataUrl(file);
      const { data } = await api.post("/theme-assets", { data: dataUrl, filename: file.name, slot: slotKey });
      deleteIfTemporary(previousAssetId); // replacing an unsaved temp upload — safe to drop it now
      onChange(data.asset_id);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not upload image");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleRemove = () => {
    deleteIfTemporary(assetId); // only deletes if this was a not-yet-saved upload
    onChange(null);
  };

  const size = isAnimation ? "original" : previewSize;

  return (
    <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3" data-testid={`theme-asset-slot-${slotKey}`}>
      <div className="text-[12px] font-black text-shText uppercase tracking-widest">{label}</div>
      {hint && <div className="text-[11px] text-shTextMuted mt-0.5">{hint}</div>}

      <div className="mt-2 w-full h-32 flex items-center justify-center overflow-hidden">
        {assetId ? (
          <div className="w-32 h-32 border border-shBorder rounded overflow-hidden">
            <img
              src={`${API_BASE}/theme-assets/${assetId}/${size}`}
              className="w-full h-full object-cover rounded"
              alt=""
            />
          </div>
        ) : (
          <div className="w-32 h-32 border border-dashed border-shBorder rounded flex items-center justify-center text-shTextMuted">
            <i className={isAnimation ? "fas fa-film" : "fas fa-image"} />
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <label className="min-h-9 px-3 rounded border border-shBorder text-shText font-black text-[11px] uppercase tracking-widest hover:border-shPrimary/50 cursor-pointer inline-flex items-center justify-center">
          {uploading ? "Uploading…" : "Upload"}
          <input
            type="file"
            accept={accept}
            className="hidden"
            onChange={handleFile}
            disabled={uploading}
            data-testid={`theme-asset-slot-${slotKey}-input`}
          />
        </label>
        {assetId && (
          <button
            type="button"
            onClick={handleRemove}
            className="text-shTextMuted hover:text-red-400 text-[11px] font-black uppercase tracking-widest"
            data-testid={`theme-asset-slot-${slotKey}-remove`}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
