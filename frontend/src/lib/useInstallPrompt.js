import { useEffect, useState } from "react";

/**
 * Shared hook exposing PWA install state across the app.
 * Used by both `InstallPrompt` (auto-popping pill) and any manual
 * "Install App" links in the sidebar / settings.
 */
function isIOS() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export default function useInstallPrompt() {
  const [deferred, setDeferred] = useState(() => window.__sh_install_deferred__ || null);
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onBip = (e) => {
      e.preventDefault();
      window.__sh_install_deferred__ = e;
      setDeferred(e);
    };
    const onInstalled = () => {
      window.__sh_install_deferred__ = null;
      setDeferred(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferred) return null;
    deferred.prompt();
    try {
      const choice = await deferred.userChoice;
      window.__sh_install_deferred__ = null;
      setDeferred(null);
      return choice?.outcome || null;
    } catch {
      return null;
    }
  };

  return {
    canInstall: !!deferred && !installed,
    installed,
    isIOS: isIOS(),
    install,
  };
}
