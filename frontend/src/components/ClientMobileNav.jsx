import { useState } from "react";

/* Redesign Phase B — primary mobile bottom navigation. Book and Online School
 * are permanent primary destinations; lower-frequency destinations live in
 * the "More" sheet. Every action here reuses an existing Portal.jsx handler
 * when supplied — no booking/shop/School business logic lives in this file. */

function NavButton({ icon, label, badge, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-shTextMuted active:text-shPrimary transition"
    >
      <i className={`fas ${icon} text-lg`} />
      <span className="text-[10px] font-black uppercase tracking-wide">{label}</span>
      {badge > 0 && (
        <span
          style={{ position: "absolute" }}
          className="top-1 right-[22%] min-w-[16px] h-[16px] px-1 bg-shAccent text-white text-[9px] font-black rounded-full grid place-items-center"
        >
          {badge}
        </span>
      )}
    </button>
  );
}

export default function ClientMobileNav({
  shopCartCount = 0,
  showPhotography = false,
  onHome, onBook, onSchool, onShop, onPhotography,
  onMyDogs, onPayments, onCredits, onRewards, onRefer, onHelp, showHelp,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const openSchool = onSchool || (() => { window.location.href = "/school"; });

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-bgHeader border-t border-shBorder pb-safe flex items-stretch shadow-sh"
        data-testid="client-mobile-nav"
      >
        <NavButton icon="fa-house" label="Home" onClick={onHome} testid="mobile-nav-home" />
        <NavButton icon="fa-calendar-plus" label="Book" onClick={onBook} testid="mobile-nav-book" />
        <NavButton icon="fa-graduation-cap" label="School" onClick={openSchool} testid="mobile-nav-school" />
        <NavButton icon="fa-bag-shopping" label="Shop" badge={shopCartCount} onClick={onShop} testid="mobile-nav-shop" />
        <NavButton icon="fa-ellipsis" label="More" onClick={() => setMoreOpen(true)} testid="mobile-nav-more" />
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex items-end" data-testid="client-mobile-more-sheet">
          <button
            className="absolute inset-0 bg-black/60"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
          />
          <div className="relative w-full bg-shSurface border-t border-shBorder rounded-t-2xl shadow-sh pb-safe">
            <div className="flex items-center justify-between px-5 py-4 border-b border-shBorder">
              <p className="text-shText font-black uppercase tracking-widest text-[13px]">More</p>
              <button onClick={() => setMoreOpen(false)} aria-label="Close" className="text-shTextMuted text-xl leading-none px-2">
                &times;
              </button>
            </div>
            <div className="p-2">
              {[
                ...(showPhotography ? [{ icon: "fa-camera-retro", label: "Photography", onClick: onPhotography }] : []),
                { icon: "fa-paw", label: "My Dogs", onClick: onMyDogs },
                { icon: "fa-file-invoice-dollar", label: "Payments", onClick: onPayments },
                { icon: "fa-wallet", label: "Credits", onClick: onCredits },
                { icon: "fa-trophy", label: "Rewards", onClick: onRewards },
                { icon: "fa-user-plus", label: "Refer a Friend", onClick: onRefer },
                ...(showHelp ? [{ icon: "fa-circle-question", label: "Help", onClick: onHelp }] : []),
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => { setMoreOpen(false); item.onClick(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-shText hover:bg-shSurfaceRaised text-[14px] font-bold text-left"
                >
                  <i className={`fas ${item.icon} w-5 text-center text-shPrimary`} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
