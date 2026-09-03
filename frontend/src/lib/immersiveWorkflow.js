/* Immersive workflows — "the customer is in the middle of something where a
 * floating overlay could cover an important action."
 *
 * Practice Coach, the Module Quiz, the trainer checkpoint form, Ask Trainer,
 * the troubleshooting drawer and School's two dialogs each hold this while
 * they are mounted. Passive overlays (today: the install prompt) read it and
 * stay out of the way, then come back when the count returns to zero.
 *
 * Holding the signal is NOT a dismissal of anything: nothing is written to
 * storage, so an overlay's own eligibility is untouched.
 */
import { useEffect, useSyncExternalStore } from "react";

let count = 0;
const listeners = new Set();

function emit() { listeners.forEach((fn) => { try { fn(); } catch { /* ignore */ } }); }

export function enterImmersive() { count += 1; emit(); return () => leaveImmersive(); }
export function leaveImmersive() { count = Math.max(0, count - 1); emit(); }
export function immersiveCount() { return count; }
export function isImmersiveActive() { return count > 0; }
export function subscribeImmersive(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/** Test-only: forget every holder (a fresh jsdom document per test). */
export function _resetImmersiveForTests() { count = 0; emit(); }

/** Hold the signal while `active` (default true) and this component is mounted. */
export function useImmersiveWorkflow(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const release = enterImmersive();
    return release;
  }, [active]);
}

/** Whether any immersive workflow is open right now (re-renders on change). */
export function useImmersiveActive() {
  return useSyncExternalStore(subscribeImmersive, isImmersiveActive, () => false);
}
