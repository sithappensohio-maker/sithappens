import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import PortalShop from "../components/PortalShop";
import GuestAuthModal from "../components/GuestAuthModal";
import PublicBrandShell from "../components/PublicBrandShell";
import { EmptyState, PremiumButton, SectionCard } from "../components/premium";
import { isFreeClaimable } from "../lib/freeCourseClaim";
import { dogsTrainedLabel, ratingSummary } from "../lib/schoolStorefront";
import { readGuestCart, writeGuestCart, stashPendingShopRedirect } from "../lib/shopGuestCart";

function initialPublicShopTab() {
  if (typeof window === "undefined") return "all";
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("section") || params.get("tab");
  return requested === "online_school" ? "online_school" : "all";
}

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
  const [shopTab, setShopTab] = useState(initialPublicShopTab);
  const [freeCourse, setFreeCourse] = useState(null);
  // Online School storefront aggregates — real numbers only. Chips render
  // solely when the data clears its honesty threshold (lib/schoolStorefront),
  // so a fresh install shows the plain value-prop pills, never a fake stat.
  const [schoolStats, setSchoolStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get("/public/school/storefront")
      .then(({ data }) => { if (!cancelled) setSchoolStats(data?.stats || null); })
      .catch(() => { if (!cancelled) setSchoolStats(null); });
    return () => { cancelled = true; };
  }, []);
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

  // Online School discovery — the public hero can send a visitor straight
  // to the real free-course item when one is deliberately configured as
  // claimable. The catalog remains the source of truth; no program id/name
  // is hardcoded into the marketing surface.
  //
  // The list comes from the PortalShop below rather than a second fetch of
  // the same endpoint: it was loading the entire public catalog twice on
  // every visit to find one item.
  const onCatalogLoaded = useCallback((items) => {
    setFreeCourse((items || []).find((item) =>
      item.kind === "training_program"
      && item.purchase_fulfillment === "online_school"
      && isFreeClaimable(item)) || null);
  }, []);

  const handleRequireAccount = () => {
    // Defense in depth — the primary path never navigates away from /shop
    // at all (see GuestAuthModal's doc comment), but stashing the current,
    // strictly-validated location means a real navigation elsewhere (e.g.
    // the visitor manually leaves and comes back) still returns them here.
    stashPendingShopRedirect(window.location.pathname);
    setAuthOpen(true);
  };

  const focusOnlineSchool = () => {
    // Departments are a real URL now (?dept=), so this is a navigation
    // rather than a scroll to a section that may not be rendered.
    setShopTab("online_school");
    const params = new URLSearchParams(window.location.search);
    params.set("dept", "online_school");
    params.delete("section"); params.delete("tab");
    const query = params.toString();
    window.location.href = `${window.location.pathname}${query ? `?${query}` : ""}`;
  };

  const startFreeCourse = () => {
    if (freeCourse?.id) {
      window.location.href = `/shop/item/training_program/${encodeURIComponent(freeCourse.id)}`;
      return;
    }
    focusOnlineSchool();
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
      /* No title/subtitle here any more. The Shop's own hero says where you
         are, and two page headings stacked on top of each other was the
         single biggest reason the storefront read as an admin screen: on a
         phone it put the first product almost two screens down. The shell
         keeps what only it can provide — brand chrome and the sign-in
         action. */
      action={shellAction}
      testid="public-shop-page"
      homeTestId="public-shop-home-link"
      mascotKey="shop-husky"
    >
      <section className="sh-public-shop-canvas" data-testid="public-online-school-catalog">
        <PortalShop mode="guest" fullScreen initialTab={shopTab} cart={cart}
                    onCartChange={setCart} onRequireAccount={handleRequireAccount}
                    onItemsLoaded={onCatalogLoaded} schoolStats={schoolStats} />
      </section>
      <GuestAuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </PublicBrandShell>
  );
}
