import { useEffect, useState } from "react";
import { api } from "../lib/api";
import PortalShop from "../components/PortalShop";
import GuestAuthModal from "../components/GuestAuthModal";
import PublicBrandShell from "../components/PublicBrandShell";
import { EmptyState, PremiumButton, SectionCard } from "../components/premium";
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

  const shellAction = (
    <PremiumButton onClick={handleRequireAccount} data-testid="public-shop-sign-in" className="whitespace-nowrap">
      <i className="fas fa-user mr-1"/>Sign In / Create Account
    </PremiumButton>
  );

  if (shopEnabled === null) {
    return (
      <PublicBrandShell compact center eyebrow="Shop" title="Loading the shop…" subtitle="Getting the latest Sit Happens products and programs." footer={false}>
        <SectionCard accent="cyan" className="w-full max-w-md text-center py-10">
          <i className="fas fa-circle-notch fa-spin text-3xl text-shSecondary"/>
          <p className="text-shTextMuted text-sm font-semibold mt-4">Just a second.</p>
        </SectionCard>
      </PublicBrandShell>
    );
  }

  if (!shopEnabled) {
    return (
      <PublicBrandShell compact center eyebrow="Shop" title="The shop is closed." subtitle="Check back soon, or sign in to your Sit Happens account." testid="public-shop-disabled">
        <EmptyState
          icon="fa-store"
          accent="cyan"
          title="Shop is currently closed"
          description="The storefront is temporarily unavailable. Your account and training history are unaffected."
          ctaLabel="Back to Sit Happens"
          onClick={() => { window.location.href = "/"; }}
          testId="public-shop-disabled-home"
        />
      </PublicBrandShell>
    );
  }

  return (
    <PublicBrandShell
      eyebrow="Shop"
      title="SHOP SIT HAPPENS."
      subtitle="Courses, packs, programs, and dog gear — all in one place."
      action={shellAction}
      testid="public-shop-page"
      homeTestId="public-shop-home-link"
      mascotKey="shop-husky"
    >
      <section className="sh-public-shop-canvas">
        <PortalShop mode="guest" fullScreen initialTab="all" cart={cart} onCartChange={setCart} onRequireAccount={handleRequireAccount} />
      </section>
      <GuestAuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </PublicBrandShell>
  );
}
