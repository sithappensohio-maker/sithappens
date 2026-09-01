import { useEffect, useState } from "react";
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
  useEffect(() => {
    let cancelled = false;
    api.get("/public/shop/catalog")
      .then(({ data }) => {
        if (cancelled) return;
        const free = (data?.items || []).find((item) =>
          item.kind === "training_program"
          && item.purchase_fulfillment === "online_school"
          && isFreeClaimable(item));
        setFreeCourse(free || null);
      })
      .catch(() => { if (!cancelled) setFreeCourse(null); });
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

  const focusOnlineSchool = () => {
    setShopTab("online_school");
    const params = new URLSearchParams(window.location.search);
    params.set("section", "online_school");
    params.delete("tab");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setTimeout(() => {
      document.querySelector('[data-testid="public-online-school-catalog"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
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
      eyebrow="Shop"
      title="SHOP SIT HAPPENS."
      subtitle="Courses, packs, programs, and dog gear — all in one place."
      action={shellAction}
      testid="public-shop-page"
      homeTestId="public-shop-home-link"
      mascotKey="shop-husky"
    >
      <section
        data-testid="public-online-school-hero"
        className="relative overflow-hidden rounded-2xl border border-shSecondary/35 bg-gradient-to-br from-shSecondary/15 via-[var(--sh-card-base)] to-shPrimary/10 p-5 sm:p-7 mb-5 shadow-sh"
      >
        <div className="absolute inset-0 pointer-events-none opacity-80"
             style={{ background: "radial-gradient(circle at 0% 0%, rgba(0,169,224,0.18), transparent 42%), radial-gradient(circle at 100% 100%, rgba(140,198,63,0.13), transparent 44%)" }}/>
        <div className="relative grid lg:grid-cols-[1fr_auto] gap-5 lg:gap-8 items-center">
          <div>
            <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.28em] text-shSecondary">
              <i className="fas fa-graduation-cap mr-2 text-shPrimary"/>Sit Happens Online School
            </p>
            <h2 className="sh-display text-2xl sm:text-4xl text-shText mt-2 leading-tight">TRAIN YOUR DOG. ANYWHERE.</h2>
            <p className="text-shTextMuted text-sm sm:text-base leading-relaxed mt-2 max-w-2xl">
              Real Sit Happens training in a guided online format — clear lessons, hands-on practice, progress tracking, and trainer-built programs you can work through at home.
            </p>
            <div className="flex flex-wrap gap-2 mt-4 text-[10px] sm:text-[11px] font-black uppercase tracking-widest">
              {(() => {
                // Real trust numbers replace the generic pills once they
                // exist; until then the value-prop pills carry the hero.
                const dogs = dogsTrainedLabel(schoolStats?.dogs_trained);
                const rating = ratingSummary(schoolStats);
                if (!dogs && !rating) {
                  return (
                    <>
                      <span className="px-2.5 py-1.5 rounded-full border border-shSecondary/30 bg-shSecondary/10 text-shSecondary"><i className="fas fa-circle-play mr-1.5"/>Self-paced</span>
                      <span className="px-2.5 py-1.5 rounded-full border border-shPrimary/30 bg-shPrimary/10 text-shPrimary"><i className="fas fa-list-check mr-1.5"/>Guided practice</span>
                      <span className="px-2.5 py-1.5 rounded-full border border-shBorder bg-black/15 text-shTextMuted"><i className="fas fa-chart-line mr-1.5"/>Track progress</span>
                    </>
                  );
                }
                return (
                  <>
                    {dogs && <span className="px-2.5 py-1.5 rounded-full border border-shPrimary/30 bg-shPrimary/10 text-shPrimary" data-testid="public-school-stat-dogs"><i className="fas fa-paw mr-1.5"/>{dogs} dogs trained</span>}
                    {rating && <span className="px-2.5 py-1.5 rounded-full border border-shPrimary/30 bg-shPrimary/10 text-shPrimary" data-testid="public-school-stat-rating"><i className="fas fa-star mr-1.5"/>{rating.average} from {rating.count} reviews</span>}
                    <span className="px-2.5 py-1.5 rounded-full border border-shSecondary/30 bg-shSecondary/10 text-shSecondary"><i className="fas fa-user-check mr-1.5"/>Real trainer feedback</span>
                  </>
                );
              })()}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2 min-w-[220px]">
            <PremiumButton variant="primary" onClick={focusOnlineSchool} data-testid="public-online-school-view-classes" className="justify-center py-3">
              <i className="fas fa-graduation-cap"/>View Online Classes
            </PremiumButton>
            <PremiumButton variant="secondary" onClick={startFreeCourse} data-testid="public-online-school-start-free" className="justify-center py-3">
              <i className="fas fa-gift"/>Start Free Course
            </PremiumButton>
            <p className="text-[10px] text-shTextMuted text-center lg:text-left">
              {freeCourse ? "Free starter course available now — no checkout required." : "Browse Online School to see current classes and free-course availability."}
            </p>
          </div>
        </div>
      </section>

      <section className="sh-public-shop-canvas" data-testid="public-online-school-catalog">
        <PortalShop mode="guest" fullScreen initialTab={shopTab} cart={cart} onCartChange={setCart} onRequireAccount={handleRequireAccount} />
      </section>
      <GuestAuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </PublicBrandShell>
  );
}
