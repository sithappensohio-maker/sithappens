import { useState } from "react";
import useInstallPrompt from "../lib/useInstallPrompt";

/**
 * Manual "Install App" link for the sidebar / portal. Renders as a styled
 * <button> that takes one of three actions:
 *  - Already installed → nothing (component returns null).
 *  - Native prompt ready → fires `install()` from the shared hook.
 *  - iOS / unsupported → shows a modal with platform-specific steps.
 *
 * Accepts an optional `className` override so it can blend into different
 * surfaces (sidebar nav, settings page, etc.).
 */
export default function InstallAppButton({ className = "", label = "Install App", testid = "install-app-nav" }) {
  const { canInstall, isIOS, installed, install } = useInstallPrompt();
  const [howToOpen, setHowToOpen] = useState(false);

  if (installed) return null;

  const onClick = async () => {
    if (canInstall) {
      const outcome = await install();
      // If user dismissed the native prompt, show steps so they can still do it manually.
      if (outcome !== "accepted") setHowToOpen(true);
    } else {
      setHowToOpen(true);
    }
  };

  return (
    <>
      <button
        onClick={onClick}
        data-testid={testid}
        className={className || "flex items-center gap-3 px-4 py-2 rounded text-shGreen hover:bg-shGreen/10 text-[14px] font-black uppercase tracking-widest w-full"}
        title="Install Sit Happens as an app"
      >
        <i className="fas fa-download" />
        <span>{label}</span>
      </button>

      {howToOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4" onClick={()=>setHowToOpen(false)}>
          <div className="bg-bgPanel border border-bgHover rounded-xl max-w-md w-full p-6 shadow-2xl" onClick={(e)=>e.stopPropagation()} data-testid="install-howto-modal">
            <div className="flex items-center gap-3 mb-4">
              <img src="/icon-192.png" alt="" className="h-12 w-12 rounded-lg" />
              <div>
                <h3 className="text-white font-black text-lg uppercase tracking-tight leading-tight">Install Sit Happens</h3>
                <p className="text-gray-400 text-[15px]">Lives on your home screen like a real app.</p>
              </div>
            </div>

            {isIOS ? (
              <ol className="space-y-3 text-gray-200 text-[14px]">
                <li className="flex gap-3"><span className="text-shGreen font-black">1.</span> <span>Tap the <strong className="text-shBlue">Share <i className="fas fa-arrow-up-from-bracket mx-1"/></strong> button at the bottom of Safari.</span></li>
                <li className="flex gap-3"><span className="text-shGreen font-black">2.</span> <span>Scroll down and tap <strong className="text-shGreen">Add to Home Screen</strong>.</span></li>
                <li className="flex gap-3"><span className="text-shGreen font-black">3.</span> <span>Tap <strong>Add</strong> — the husky icon appears on your home screen.</span></li>
              </ol>
            ) : (
              <ol className="space-y-3 text-gray-200 text-[14px]">
                <li className="flex gap-3"><span className="text-shGreen font-black">1.</span> <span>Look for the <strong className="text-shBlue"><i className="fas fa-circle-plus mx-1"/>install icon</strong> at the right end of your browser's address bar.</span></li>
                <li className="flex gap-3"><span className="text-shGreen font-black">2.</span> <span>Or open the browser menu (three dots) → <strong className="text-shGreen">Install Sit Happens…</strong> / <strong>Add to Home Screen</strong>.</span></li>
                <li className="flex gap-3"><span className="text-shGreen font-black">3.</span> <span>Click <strong>Install</strong>. The app opens in its own window with no browser bar.</span></li>
              </ol>
            )}

            <p className="text-gray-500 text-[14px] mt-4 leading-snug">
              Tip: in Chrome the prompt sometimes only appears after you've used the site a couple of times — keep this tab open and try again in a minute.
            </p>

            <button onClick={()=>setHowToOpen(false)} data-testid="install-howto-close"
                    className="mt-4 w-full bg-bgHover text-white py-2 rounded font-black uppercase tracking-widest text-[15px] hover:bg-bgHover/70">
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
