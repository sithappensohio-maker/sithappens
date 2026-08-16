// Front Desk register refresh bus — Step 3.
//
// One window-level event connects every register-affecting mutation to every
// component that displays register money. A component that shows expected
// cash / today's activity subscribes with `onRegisterChanged`; every checkout,
// payment, refund, void, till adjustment, pack sale, drawer opening, and
// closeout emits `emitRegisterChanged()` AFTER its POST succeeds. This is the
// same cross-component window-event convention the app already uses for the
// shop-order badge (see App.js) — deliberately not a state-management rewrite,
// and deliberately not polling: subscribers refetch only when something
// actually changed (plus a modest focus/interval fallback they own).
export const REGISTER_CHANGED_EVENT = "sh:register-changed";

export const emitRegisterChanged = () => {
  try {
    window.dispatchEvent(new CustomEvent(REGISTER_CHANGED_EVENT));
  } catch {
    /* non-browser context — nothing to notify */
  }
};

// Returns the unsubscribe function, ready for a useEffect cleanup.
export const onRegisterChanged = (handler) => {
  window.addEventListener(REGISTER_CHANGED_EVENT, handler);
  return () => window.removeEventListener(REGISTER_CHANGED_EVENT, handler);
};
