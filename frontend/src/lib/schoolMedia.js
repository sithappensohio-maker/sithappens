import { api } from "./api";

/**
 * Load authenticated School media without re-expanding filesystem files into
 * base64 JSON. Returns a browser-usable URL plus a revoke callback for blob
 * URLs. Legacy Mongo-only School media falls back to the metadata data-url.
 */
export async function loadSchoolMediaUrl(mediaId) {
  if (!mediaId) throw new Error("Missing media id");
  try {
    const { data } = await api.get(`/portal/school/media/${mediaId}/file`, { responseType: "blob" });
    const url = URL.createObjectURL(data);
    return { url, revoke: () => URL.revokeObjectURL(url), isBlob: true };
  } catch (fileError) {
    const { data } = await api.get(`/portal/school/media/${mediaId}`);
    if (!data?.data) throw fileError;
    return { url: data.data, revoke: () => {}, isBlob: false };
  }
}

/** Open an authenticated School resource in a new tab/window. */
export async function openSchoolMedia(mediaId) {
  const popup = window.open("", "_blank");
  try {
    const media = await loadSchoolMediaUrl(mediaId);
    if (popup) popup.location.href = media.url;
    else window.open(media.url, "_blank", "noopener,noreferrer");
    // Give the new document plenty of time to claim/read the blob URL.
    if (media.isBlob) window.setTimeout(media.revoke, 5 * 60 * 1000);
    return true;
  } catch (err) {
    try { popup?.close(); } catch { /* ignore */ }
    throw err;
  }
}
