import { useEffect, useState } from "react";
import useInstallPrompt from "../lib/useInstallPrompt";

/**
 * Bottom-left install pill — shown automatically when the browser is
 * ready to install (Chrome/Edge/Android) or on iOS Safari with a
 * "Share → Add to Home Screen" hint.
 *
 * Dismissals are persisted for 14 days. Manual install (sidebar button)
 * uses the same `useInstallPrompt` hook so the state stays in sync.
 */
const DISMISS_KEY = "sh_install_dismissed_at";
const DISMISS_DAYS = 14;

function wasRecentlyDismissed() {
  const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
  if (!t) return false;
  return Date.now() - t < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

export default function InstallPrompt() {
  const { canInstall, isIOS, installed, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(wasRecentlyDismissed);

  // Re-check dismissed flag if the user clears localStorage in another tab.
  useEffect(() => {
    const onStorage = () => setDismissed(wasRecentlyDismissed());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (installed || dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  if (canInstall) {
    return (
      <div
        data-testid="install-app-prompt"
        className="fixed bottom-4 left-4 z-[9998] flex items-center gap-3 bg-bgPanel border border-shGreen/40 shadow-2xl rounded-xl px-4 py-3 max-w-xs"
      >
        <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-black text-[14px] uppercase tracking-widest leading-tight">Install Sit Happens</p>
          <p className="text-gray-400 text-[12px] mt-0.5 leading-tight">Add to your home screen for one-tap access.</p>
        </div>
        <div className="flex flex-col gap-1">
          <button onClick={install} data-testid="install-app-btn"
                  className="bg-shGreen text-black font-black uppercase text-[11px] tracking-widest px-3 py-1.5 rounded hover:bg-shGreen/80">
            Install
          </button>
          <button onClick={dismiss} data-testid="install-app-dismiss"
                  className="text-gray-500 hover:text-gray-300 text-[11px] uppercase tracking-widest">
            Later
          </button>
        </div>
      </div>
    );
  }

  if (isIOS) {
    return (
      <div
        data-testid="install-ios-hint"
        className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm z-[9998] flex items-start gap-3 bg-bgPanel border border-shBlue/40 shadow-2xl rounded-xl px-4 py-3"
      >
        <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-lg flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-white font-black text-[14px] uppercase tracking-widest leading-tight">Install Sit Happens</p>
          <p className="text-gray-300 text-[12px] mt-1 leading-snug">
            Tap <i className="fas fa-arrow-up-from-bracket text-shBlue mx-0.5" /> then
            {" "}<span className="text-shGreen font-bold">Add to Home Screen</span>.
          </p>
        </div>
        <button onClick={dismiss} data-testid="install-ios-dismiss"
                className="text-gray-500 hover:text-gray-300 text-lg leading-none">
          <i className="fas fa-times" />
        </button>
      </div>
    );
  }

  return null;
}
