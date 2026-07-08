import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Keep the app aligned to the *visible* mobile viewport. `100vh` can include
// browser chrome or the area hidden by the on-screen keyboard, which makes
// the bottom of pages and dialogs impossible to reach on some phones.
const syncVisualViewport = () => {
  const viewport = window.visualViewport;
  const height = Math.max(320, Math.round(viewport?.height || window.innerHeight));
  const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
  document.documentElement.style.setProperty("--app-height", `${height}px`);
  document.documentElement.style.setProperty("--visual-viewport-offset-top", `${offsetTop}px`);
};
syncVisualViewport();
window.addEventListener("resize", syncVisualViewport, { passive: true });
window.addEventListener("orientationchange", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("resize", syncVisualViewport, { passive: true });
window.visualViewport?.addEventListener("scroll", syncVisualViewport, { passive: true });

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register PWA service worker. We only register in production-style builds
// (i.e., when served by the platform, not when running localhost dev).
if ("serviceWorker" in navigator && window.location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => {
        // Auto-activate a waiting worker so users get the latest build on next nav.
        if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              nw.postMessage("SKIP_WAITING");
            }
          });
        });
      })
      .catch(() => { /* SW registration failures should never break the app */ });

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
