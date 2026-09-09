/* Practice-recipe media (a step's demo picture, the Good Rep / Not This
 * example) — shared resolution for the editor preview and the client Coach.
 *
 * A recipe item may carry:
 *   media_url — an external link, used as-is;
 *   media_id  — a file the trainer uploaded (stored in homework_media and
 *               served by GET /homework/resource/{id}, which checks that the
 *               client owns a homework whose recipe references it).
 * Uploaded files are fetched through the authenticated API and turned into
 * a data URL, so an <img> can show them without a public URL. */
import { useEffect, useState } from "react";
import { api } from "./api";

const _cache = new Map(); // media_id -> Promise<string>

export function recipeMediaSrc(item) {
  if (!item) return Promise.resolve("");
  if (item.media_url) return Promise.resolve(item.media_url);
  if (!item.media_id) return Promise.resolve("");
  if (!_cache.has(item.media_id)) {
    _cache.set(item.media_id, api.get(`/homework/resource/${item.media_id}`).then((r) => r.data?.data || "").catch(() => { _cache.delete(item.media_id); return ""; }));
  }
  return _cache.get(item.media_id);
}

export function hasRecipeMedia(item) {
  return !!(item && (item.media_url || item.media_id));
}

/** Does this recipe show the client any demo media at all? */
export function recipeHasAnyMedia(pc) {
  if (!pc) return false;
  return (pc.steps || []).some(hasRecipeMedia) || hasRecipeMedia(pc.good_rep) || hasRecipeMedia(pc.not_this);
}

export function useRecipeMediaSrc(item) {
  const url = item?.media_url || "";
  const id = item?.media_id || "";
  const [src, setSrc] = useState(url);
  useEffect(() => {
    if (url) { setSrc(url); return undefined; }
    if (!id) { setSrc(""); return undefined; }
    let live = true;
    recipeMediaSrc({ media_id: id }).then((s) => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [url, id]);
  return src;
}

export function _resetRecipeMediaCacheForTests() { _cache.clear(); }
