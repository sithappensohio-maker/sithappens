import { useEffect, useState } from "react";
import { api } from "../lib/api";
import PortalShop from "../components/PortalShop";
import GuestAuthModal from "../components/GuestAuthModal";
import { readGuestCart, writeGuestCart, stashPendingShopRedirect } from "../lib/shopGuestCart";

// Public no-account storefront — the guest-mode entry point mounted by
// App.js's ShopRouteGate whenever a visitor with no valid session lands on
// /shop or /shop/item/:kind/:id. Reuses PortalShop in mode="guest" (the
// exact same presentation the authenticated Shop and admin Client Preview
// already use) rather than a second storefront implementation.
export default function PublicShop() {
  const [cart, setCartState] = useState(() => readGuestCart());
  const setCart = (updater) => {
    setCartState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      writeGuestCart(next);
      return next;
    });
  };

  const [authOpen, setAuthOpen] = useState(false);
  // null = still checking; true/false once /settings/public resolves.
  // Read directly rather than waiting on PortalShop's own fetch so a
  // disabled shop shows a clean "closed" state instead of a raw 404 error
  // string bubbling up through PortalShop's generic error path.
  const [shopEnabled, setShopEnabled] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get("/settings/public")
      .then(({ data }) => {
        if (cancelled) return;
        const sp = data.shop_page || {};
        setShopEnabled(!!(sp.public_shop_enabled && sp.public_browsing_enabled));
      })
      .catch(() => { if (!cancelled) setShopEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  const handleRequireAccount = () => {
    // Defense in depth — the primary path never navigates away from /shop
    // at all (see GuestAuthModal's doc comment), but stashing the current,
    // strictly-validated location means a real navigation elsewhere (e.g.
    // the visitor manually leaves and comes back) still returns them here.
    stashPendingShopRedirect(window.location.pathname);
    setAuthOpen(true);
  };

  if (shopEnabled === null) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-shTextMuted text-sm font-bold uppercase tracking-widest" style={{ background: "var(--sh-card-base)" }}>
        Loading…
      </div>
    );
  }

  if (!shopEnabled) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-3 text-center px-6" style={{ background: "var(--sh-card-base)" }} data-testid="public-shop-disabled">
        <img src="/logo.png" alt="Sit Happens" className="h-16 mb-2" />
        <p className="text-shText font-black text-xl">Shop is currently closed</p>
        <p className="text-shTextMuted text-sm max-w-md">Check back soon, or sign in to your account.</p>
        <a href="/" data-testid="public-shop-disabled-home" className="mt-2 text-shPrimary font-bold uppercase tracking-widest text-sm hover:text-shText transition">
          Back to Sit Happens
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full" style={{ background: "var(--sh-card-base)" }} data-testid="public-shop-page">
      <header className="border-b border-shBorder flex items-center justify-between px-4 sm:px-8 py-3">
        <a href="/" data-testid="public-shop-home-link">
          <img src="/logo.png" alt="Sit Happens" className="h-9 sm:h-12" />
        </a>
        <button onClick={handleRequireAccount} data-testid="public-shop-sign-in"
                className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[12px] uppercase tracking-widest hover:brightness-110 transition">
          Sign In / Create Account
        </button>
      </header>
      <div className="max-w-6xl mx-auto p-3 sm:p-6">
        <PortalShop mode="guest" fullScreen initialTab="all" cart={cart} onCartChange={setCart} onRequireAccount={handleRequireAccount} />
      </div>
      <GuestAuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
