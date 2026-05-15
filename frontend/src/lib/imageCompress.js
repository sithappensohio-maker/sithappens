/**
 * Compress images client-side before uploading them to the backend.
 *
 * Why: dog photos, report cards, and incident attachments are stored as base64
 * inside MongoDB. A typical iPhone photo is 3-5 MB; after canvas-resize to
 * 1200px and JPEG quality 0.8 it drops to ~150-300 KB with no visible quality
 * loss. That's a 10-20× reduction in DB storage and download bandwidth.
 *
 * Non-image files (PDFs, etc.) are returned as-is so this is safe to wrap any
 * existing FileReader-based upload flow.
 */

const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_MAX_HEIGHT = 1600;
const DEFAULT_QUALITY = 0.82;

function _readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function _loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}

/**
 * @param {File|Blob} file
 * @param {object} [opts]
 * @param {number} [opts.maxWidth=1600]
 * @param {number} [opts.maxHeight=1600]
 * @param {number} [opts.quality=0.82] - 0-1 JPEG quality
 * @returns {Promise<string>} data URL ready to POST to the backend
 */
export async function compressImage(file, opts = {}) {
  if (!file) return null;
  const { maxWidth = DEFAULT_MAX_WIDTH, maxHeight = DEFAULT_MAX_HEIGHT, quality = DEFAULT_QUALITY } = opts;

  const original = await _readAsDataURL(file);
  // Non-images pass through untouched.
  if (!file.type || !file.type.startsWith("image/")) return original;
  // Skip compression for SVG (it's vector + tiny anyway).
  if (file.type === "image/svg+xml") return original;

  try {
    const img = await _loadImage(original);
    let { width, height } = img;
    if (width <= maxWidth && height <= maxHeight && file.size < 400_000) {
      // Already small + within size limits — no need to recompress.
      return original;
    }
    const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // White background — keeps transparency from becoming black on JPEG export.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const compressed = canvas.toDataURL("image/jpeg", quality);
    // Only swap if the compressed version is actually smaller.
    return compressed.length < original.length ? compressed : original;
  } catch (e) {
    // Decode failure shouldn't break upload — fall back to original payload.
    return original;
  }
}
