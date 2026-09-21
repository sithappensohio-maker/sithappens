import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { readAuthCart, writeAuthCart } from "./cartIntent";
import { resolveCartLines, applyResolved, restoreNotices } from "./cartRestore";

/**
 * A signed-in client's cart, surviving a reload.
 *
 * Until now it did not: closing the tab, a refresh, or following a link out
 * and back emptied the cart, and the customer started again. That is the
 * whole of what this fixes.
 *
 * What is remembered is INTENT and nothing else (lib/cartIntent) — what they
 * meant to buy, for which dog, for whom. What it COSTS, whether there is any
 * left, and whether they may buy it at all are asked for again here, on
 * every restore, against the catalogue as it stands right now. A restored
 * cart is therefore never "the old cart"; it is a fresh cart built from an
 * old wish, and anything that no longer holds is dropped and said out loud.
 *
 * The server remains the only authority. It prices, reserves and authorizes
 * every line again at checkout; this makes the customer see the truth in
 * the cart instead of at the payment page.
 */
export function useAuthCart(clientId, cart, setCart) {
  // Lines that came back changed or did not come back at all. Shown once,
  // dismissible, and never for a cart that restored intact — a notice on
  // every reload is a notice nobody reads on the reload that mattered.
  const [notices, setNotices] = useState([]);

  // The client whose cart has finished being restored. Nothing is written
  // back to storage before this matches: an empty cart on first render is
  // "not loaded yet", and writing it out would erase the very cart we are
  // about to read.
  const restoredFor = useRef(null);
  const inFlight = useRef(null);
  // The cart as it stands right now. The restore is async, so it must merge
  // with whatever the cart holds when the catalogue finally arrives — not
  // with whatever it held when the request went out.
  const cartRef = useRef(cart);
  cartRef.current = cart;

  useEffect(() => {
    if (!clientId) return undefined;

    // A different account in the same browser. Drop the cart on screen
    // before anything can persist it, so one client's cart can never be
    // written into another's bucket.
    if (restoredFor.current && restoredFor.current !== clientId) {
      restoredFor.current = null;
      setCart([]);
    }
    if (restoredFor.current === clientId || inFlight.current === clientId) return undefined;

    const stored = readAuthCart(clientId);
    if (stored.length === 0) {
      restoredFor.current = clientId; // nothing to restore; persistence is live from here
      return undefined;
    }

    let cancelled = false;
    inFlight.current = clientId;
    // /dogs is a shared cached read (see api.SHARED_GET_POLICIES) and is
    // almost always already in hand from the portal's own load, so in
    // practice this costs one request, and only when something was stored.
    Promise.all([api.get("/shop/catalog"), api.get("/dogs").catch(() => ({ data: [] }))])
      .then(([cat, dg]) => {
        if (cancelled) return;
        const catalog = cat?.data?.items || [];
        const dogs = Array.isArray(dg?.data) ? dg.data : [];
        // Resolved against the live cart, not against an empty one: if they
        // managed to add something while the catalogue was loading, the
        // restore merges with it instead of overwriting it — and the stock
        // cap is applied to the combined quantity.
        const existing = cartRef.current;
        const resolved = resolveCartLines(stored, { catalog, dogs, existing });
        restoredFor.current = clientId;
        setNotices(restoreNotices(resolved));
        setCart(applyResolved(existing, resolved));
      })
      .catch(() => {
        // The catalogue did not load. Leave the cart empty and leave
        // STORAGE ALONE, so the next reload tries again — better than
        // discarding a cart because one request failed.
      })
      .finally(() => { inFlight.current = null; });

    return () => { cancelled = true; inFlight.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Persist every change, but never before the restore has had its say.
  useEffect(() => {
    if (!clientId || restoredFor.current !== clientId) return;
    writeAuthCart(clientId, cart);
  }, [clientId, cart]);

  return { notices, dismissNotices: () => setNotices([]) };
}
