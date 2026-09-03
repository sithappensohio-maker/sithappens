import { useEffect, useState } from "react";
import useInstallPrompt from "../lib/useInstallPrompt";
import { useImmersiveActive } from "../lib/immersiveWorkflow";
import { usePrimaryActionVisible } from "../lib/primaryActionGuard";

/**
 * Bottom install pill — shown automatically when the browser is ready to
 * install (Chrome/Edge/Android) or on iOS Safari with a "Share → Add to
 * Home Screen" hint.
 *
 * Dismissals are persisted for 14 days. Manual install (sidebar button)
 * uses the same `useInstallPrompt` hook so the state stays in sync.
 *
 * Two rules keep it from covering something that matters:
 *  1. While an immersive workflow is open (Practice Coach, Module Quiz, the
 *     trainer checkpoint form, Ask Trainer, troubleshooting, School's
 *     dialogs — see lib/immersiveWorkflow) the pill is simply not rendered.
 *     That is NOT a dismissal: nothing is written, and it returns when the
 *     workflow closes.
 *  2. While the customer's current primary action is on screen (School's
 *     `data-school-primary` CTA, or anything marked `data-primary-action` —
 *     see lib/primaryActionGuard) the pill is not rendered either. Also not a
 *     dismissal: scroll the CTA away and the pill may appear.
 *  3. On an ordinary screen it sits entirely ABOVE any bottom dock
 *     (`[data-bottom-dock]`: the School and Portal phone tab bars, the Shop
 *     checkout tray) instead of on top of it, and its z-index is below every
 *     dialog so a real modal always outranks it.
 */
const DISMISS_KEY = "sh_install_dismissed_at";
const DISMISS_DAYS = 14;
const DOCK_SELECTOR = "[data-bottom-dock]";

function wasRecentlyDismissed() {
  const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
  if (!t) return false;
  return Date.now() - t < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

/** Height of the tallest visible bottom dock, measured — never guessed. */
export function measureBottomDock() {
  if (typeof document === "undefined") return 0;
  let max = 0;
  document.querySelectorAll(DOCK_SELECTOR).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height <= 0) return;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    // How far the dock reaches up from the bottom of the viewport.
    max = Math.max(max, window.innerHeight - r.top);
  });
  return Math.max(0, Math.round(max));
}

function useBottomDockOffset(enabled) {
  const [dock, setDock] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const measure = () => setDock(measureBottomDock());
    measure();
    window.addEventListener("resize", measure);
    // Docks mount and unmount with screens (tab bars, the cart tray); watch
    // the tree rather than asking every screen to report in.
    const mo = typeof MutationObserver === "function"
      ? new MutationObserver(() => measure()) : null;
    if (mo) mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "data-bottom-dock"] });
    return () => { window.removeEventListener("resize", measure); if (mo) mo.disconnect(); };
  }, [enabled]);
  return dock;
}

export default function InstallPrompt() {
  const { canInstall, isIOS, installed, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(wasRecentlyDismissed);
  const immersive = useImmersiveActive();
  const eligible = !installed && !dismissed && (canInstall || isIOS);
  const primaryOnScreen = usePrimaryActionVisible(eligible && !immersive);
  const dock = useBottomDockOffset(eligible && !immersive && !primaryOnScreen);

  // Re-check dismissed flag if the user clears localStorage in another tab.
  useEffect(() => {
    const onStorage = () => setDismissed(wasRecentlyDismissed());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!eligible) return null;
  // Suppressed, not dismissed: no storage write, back when the workflow ends
  // or the primary action scrolls out of view.
  if (immersive) return null;
  if (primaryOnScreen) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };
  // `position` is inline on purpose: index.css gives every `.bg-bgPanel.rounded-xl`
  // card `position: relative`, which outranks the `fixed` utility and would
  // drop the pill into the page flow (under the tab bar) instead of floating it.
  const bottomStyle = { position: "fixed", bottom: `calc(${dock + 16}px + env(safe-area-inset-bottom))` };

  if (canInstall) {
    return (
      <div
        data-testid="install-app-prompt" data-dock-offset={dock}
        style={bottomStyle}
        className="fixed left-4 z-40 flex items-center gap-3 bg-bgPanel border border-shGreen/40 shadow-2xl rounded-xl px-4 py-3 max-w-xs"
      >
        <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-black text-[14px] uppercase tracking-widest leading-tight">Install Sit Happens</p>
          <p className="text-gray-400 text-[14px] mt-0.5 leading-tight">Add to your home screen for one-tap access.</p>
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={install} data-testid="install-app-btn"
                  className="bg-shGreen text-black font-black uppercase text-[13px] tracking-widest px-3 py-1.5 rounded hover:bg-shGreen/80">
            Install
          </button>
          <button onClick={dismiss} data-testid="install-app-dismiss"
                  className="text-gray-500 hover:text-gray-300 text-[13px] uppercase tracking-widest">
            Later
          </button>
        </div>
      </div>
    );
  }

  if (isIOS) {
    return (
      <div
        data-testid="install-ios-hint" data-dock-offset={dock}
        style={bottomStyle}
        className="fixed left-4 right-4 sm:right-auto sm:max-w-sm z-40 flex items-start gap-3 bg-bgPanel border border-shBlue/40 shadow-2xl rounded-xl px-4 py-3"
      >
        <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-black text-[14px] uppercase tracking-widest leading-tight">Install Sit Happens</p>
          <p className="text-gray-300 text-[14px] mt-1 leading-snug">
            Tap <i className="fas fa-arrow-up-from-bracket text-shBlue mx-0.5" /> then
            {" "}<span className="text-shGreen font-bold">Add to Home Screen</span>.
          </p>
        </div>
        <button onClick={dismiss} data-testid="install-ios-dismiss" aria-label="Not now"
                className="text-gray-500 hover:text-gray-300 text-lg leading-none">
          <i className="fas fa-times" />
        </button>
      </div>
    );
  }

  return null;
}
