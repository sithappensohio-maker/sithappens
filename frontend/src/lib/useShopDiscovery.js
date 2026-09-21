import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { recentRefs, rememberViewed } from "./shopRecent";

/**
 * Saved items and "what else", in as few requests as possible.
 *
 * Both hooks here exist mostly to stop a pattern that is easy to fall into
 * and expensive to undo: resolving a list of saved references one at a time.
 * Six favourites are one request, not six; a recently-viewed row is one
 * request, not twelve. The server is built to answer them in one pass, and
 * these are the callers that keep it that way.
 *
 * Neither hook stores anything about an item. What a thing costs, whether
 * there is any left and whether it is still sold are always whatever the
 * response just said.
 */

/**
 * The client's saved items.
 *
 * Optimistic, because a heart that waits for a round trip feels broken. The
 * server is idempotent on both add and remove, so the optimistic state and
 * the real state converge: a failure puts the heart back and says so, and a
 * double tap leaves one favourite either way.
 */
export function useFavorites(enabled) {
  const [saved, setSaved] = useState(() => new Set());   // "kind:ref_id"
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return [];
    try {
      const { data } = await api.get("/shop/favorites");
      const list = data?.favorites || [];
      setSaved(new Set(list.map((f) => `${f.kind}:${f.ref_id}`)));
      setLoaded(true);
      return list;
    } catch {
      setLoaded(true);
      return [];
    }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  const isSaved = useCallback((kind, refId) => saved.has(`${kind}:${refId}`), [saved]);

  const toggle = useCallback(async (kind, refId) => {
    if (!enabled) return false;
    const key = `${kind}:${refId}`;
    const wasSaved = saved.has(key);
    setSaved((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(key); else next.add(key);
      return next;
    });
    try {
      if (wasSaved) await api.delete(`/shop/favorites/${kind}/${encodeURIComponent(refId)}`);
      else await api.post("/shop/favorites", { kind, ref_id: refId });
      return !wasSaved;
    } catch (e) {
      // Put it back. A heart that silently lies about what was saved is
      // worse than one that admits the save did not happen.
      setSaved((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(key); else next.delete(key);
        return next;
      });
      throw e;
    }
  }, [enabled, saved]);

  return { isSaved, toggle, reload, loaded, count: saved.size };
}

/**
 * Recommendations, and the items behind this browser's recently-viewed list.
 *
 * One request for both, because they are shown on the same page and each
 * needs the same catalogue read behind it. `guest` decides which endpoint
 * answers, and therefore which catalogue is used — that is the whole of the
 * visibility rule on this side.
 */
export function useDiscovery({ kind, refId, clientId, guest, enabled = true, limit = 4 }) {
  const [state, setState] = useState({ recommendations: [], recentlyViewed: [] });
  const asked = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const recent = recentRefs(guest ? null : clientId);
    // Nothing to ask about: no product page, and nothing remembered.
    if (!refId && recent.length === 0) {
      setState({ recommendations: [], recentlyViewed: [] });
      return undefined;
    }
    const signature = `${guest ? "g" : clientId || ""}|${kind}|${refId}|${recent.length}|${limit}`;
    if (asked.current === signature) return undefined;
    asked.current = signature;

    let cancelled = false;
    const url = guest ? "/public/shop/discovery" : "/shop/discovery";
    // Discovery is decoration. If it cannot load, the page it decorates must
    // still work — so every way this call can go wrong ends in an empty row
    // and nothing else. Promise.resolve wrapped in a try/catch covers all
    // three: a rejection, a synchronous throw, and a client that hands back
    // something that is not a promise at all.
    const settle = () => { if (!cancelled) setState({ recommendations: [], recentlyViewed: [] }); };
    try {
      Promise.resolve(api.post(url, { kind: kind || null, ref_id: refId || null, recent, limit }))
        .then((res) => {
          if (cancelled) return;
          const data = res?.data;
          setState({
            recommendations: data?.recommendations || [],
            recentlyViewed: data?.recently_viewed || [],
          });
        })
        .catch(settle);
    } catch {
      settle();
    }
    // Clearing the guard on teardown matters more than it looks. React's
    // StrictMode runs an effect, tears it down, and runs it again; without
    // this the second run saw a matching signature and returned early,
    // while the first run's response arrived to find `cancelled` already
    // true and threw its data away. The result was a recommendation row
    // that fetched correctly, got a correct answer, and rendered nothing.
    return () => { cancelled = true; asked.current = null; };
  }, [kind, refId, clientId, guest, enabled, limit]);

  return state;
}

/** Record that someone opened a product page. Separate from the hook above
 *  so the write happens once, on arrival, and never as a side effect of a
 *  re-render. */
export function useRememberViewed({ kind, refId, clientId, guest, enabled = true }) {
  useEffect(() => {
    if (!enabled || !kind || !refId) return;
    rememberViewed(guest ? null : clientId, kind, refId);
  }, [kind, refId, clientId, guest, enabled]);
}
