import { useEffect, useRef } from "react";

// Sprint 110ao — Live-refresh primitives for Sit Happens.
//
// Three behaviours wrapped into one hook:
//   1. Periodic polling — re-runs `loader` every `intervalMs` (default 30 s)
//      so the admin dashboard, run sheet, bookings list, etc. quietly stay
//      current without manual refresh.
//   2. Tab-focus refresh — refetches immediately when the tab gains focus
//      after being hidden, so flipping back to admin from your phone shows
//      the latest state right away.
//   3. Edit-lock awareness — pauses polling while ANY component holds the
//      global edit lock (open modal, mid-form, etc.) so we never clobber
//      unsaved input or cause UI flicker mid-typing.
//
// Usage:
//   useLiveRefresh(loadFn, { intervalMs: 30_000, onNewItems: (items) => ... });
//
// `loader` should return a Promise. The hook does NOT manage state — your
// component continues to setState inside `loader` just like a normal
// useEffect mount-load. The hook just calls it on the right cadence.
//
// `onNewItems(items)` is optional. When provided, the hook compares the
// resolved `loader` return value across calls and forwards any newly-added
// rows (by `id`) so the caller can fire a toast like "🐶 New booking ·
// Bella · daycare tomorrow".

// ───────────────────── Global edit lock ─────────────────────
//
// A single module-level counter — any component that's "in the middle of
// something" (open modal, in-flight save, focused form field) calls
// `acquireEditLock()` on mount and the returned `release()` on unmount.
// While the counter is > 0, all polling is paused.
let _lockCount = 0;
const _lockListeners = new Set();

export function acquireEditLock() {
  _lockCount += 1;
  _notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _lockCount = Math.max(0, _lockCount - 1);
    _notify();
  };
}

export function isEditLocked() {
  return _lockCount > 0;
}

function _notify() {
  _lockListeners.forEach((fn) => { try { fn(_lockCount); } catch { /* ignore */ } });
}

// React hook that auto-acquires + releases the lock for the component's
// lifetime. Use inside any modal / form where mid-typing data churn is bad.
export function useEditLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const release = acquireEditLock();
    return release;
  }, [active]);
}

// ───────────────────── Live refresh hook ─────────────────────
export function useLiveRefresh(loader, options = {}) {
  const {
    intervalMs = 30_000,
    enabled = true,
    onNewItems = null,
    getId = (x) => x?.id,
  } = options;

  const loaderRef = useRef(loader);
  const onNewRef = useRef(onNewItems);
  const getIdRef = useRef(getId);
  const prevIdsRef = useRef(null);
  const inflightRef = useRef(false);
  const timerRef = useRef(null);

  useEffect(() => { loaderRef.current = loader; }, [loader]);
  useEffect(() => { onNewRef.current = onNewItems; }, [onNewItems]);
  useEffect(() => { getIdRef.current = getId; }, [getId]);

  useEffect(() => {
    if (!enabled) return undefined;

    const runOnce = async () => {
      if (inflightRef.current) return;
      if (document.hidden) return;        // tab not visible
      if (isEditLocked()) return;         // modal / form open
      inflightRef.current = true;
      try {
        const result = await loaderRef.current?.();
        // Detect new rows for the optional toast hook
        if (onNewRef.current && Array.isArray(result)) {
          const ids = new Set(result.map(getIdRef.current).filter(Boolean));
          if (prevIdsRef.current) {
            const fresh = result.filter((r) => {
              const id = getIdRef.current(r);
              return id && !prevIdsRef.current.has(id);
            });
            if (fresh.length) onNewRef.current(fresh);
          }
          prevIdsRef.current = ids;
        }
      } catch {
        // Quiet failure — next tick will retry. Per-screen error banners
        // already exist on initial load; we never want polling to scream.
      } finally {
        inflightRef.current = false;
      }
    };

    // Tab visibility / focus → snap refresh
    const onVisibility = () => { if (!document.hidden) runOnce(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", runOnce);

    // Periodic tick
    timerRef.current = setInterval(runOnce, intervalMs);

    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", runOnce);
    };
  }, [enabled, intervalMs]);
}
