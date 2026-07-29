import { useState } from "react";
import { Pill } from "./uikit";

/* Redesign Phase B — persistent left sidebar for the client shell (desktop
 * only; mobile uses ClientMobileNav instead). Every item here reuses an
 * existing Portal.jsx handler passed down as a prop — no new booking/shop/
 * messages/credits/rewards logic lives in this file, it's purely navigation
 * chrome around already-working behavior. `activeKey` is local, purely
 * visual "selected row" state (this app has no router/real pages), not a
 * new source of truth for anything. */

function NavItem({ icon, label, itemKey, badge, onClick, active, muted, onSelect }) {
  return (
    <button
      onClick={() => { onSelect(itemKey); onClick(); }}
      data-testid={`client-nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left text-[13px] font-semibold transition ${
        active
          ? "bg-shPrimary/14 border-shPrimary/30 text-shText"
          : muted
          ? "border-transparent text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised"
          : "border-transparent text-shTextMuted hover:text-shText hover:bg-shSurfaceRaised"
      }`}
      style={active ? { boxShadow: "0 0 14px -6px rgba(140,198,63,0.45)" } : undefined}
    >
      <i className={`fas ${icon} w-4 text-center text-[13px] ${active ? "text-shPrimary" : "text-shTextMuted"}`} />
      <span className="flex-1 truncate">{label}</span>
      {badge > 0 && <Pill tone="accent">{badge}</Pill>}
    </button>
  );
}

export default function ClientSidebar({
  shopCartCount = 0,
  messagesUnread = 0,
  showPhotography = false,
  showMessages = true,
  showHelp = false,
  onHome, onBook, onShop, onPhotography, onMessages,
  onMyDogs, onPayments, onCredits, onRewards, onRefer, onHelp,
}) {
  const [activeKey, setActiveKey] = useState("home");

  return (
    <aside
      className="hidden md:flex md:flex-col w-52 shrink-0 border-r border-shBorder h-full"
      style={{ background: "var(--sh-card-base)" }}
      data-testid="client-sidebar"
    >
      <div className="relative px-5 py-6 flex items-center justify-start border-b border-shBorder overflow-hidden">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(80% 120% at 20% 30%, rgba(140,198,63,0.12), transparent 60%), radial-gradient(70% 100% at 90% 80%, rgba(0,169,224,0.08), transparent 60%)" }}/>
        <img src="/logo.png" alt="Sit Happens" className="relative z-10 h-14 w-auto" />
      </div>
      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
        <NavItem icon="fa-house" label="Home" itemKey="home" active={activeKey === "home"} onSelect={setActiveKey} onClick={onHome} />
        <NavItem icon="fa-calendar-plus" label="Book" itemKey="book" active={activeKey === "book"} onSelect={setActiveKey} onClick={onBook} />
        <NavItem icon="fa-bag-shopping" label="Shop" itemKey="shop" active={activeKey === "shop"} onSelect={setActiveKey} badge={shopCartCount} onClick={onShop} />
        {showPhotography && (
          <NavItem icon="fa-camera-retro" label="Photography" itemKey="photography" active={activeKey === "photography"} onSelect={setActiveKey} onClick={onPhotography} />
        )}
        {showMessages && (
          <NavItem icon="fa-comment-dots" label="Messages" itemKey="messages" active={activeKey === "messages"} onSelect={setActiveKey} badge={messagesUnread} onClick={onMessages} />
        )}

        <div className="pt-2 mt-2 border-t border-shBorder space-y-0.5">
          <NavItem icon="fa-paw" label="My Dogs" itemKey="dogs" active={activeKey === "dogs"} onSelect={setActiveKey} muted onClick={onMyDogs} />
          <NavItem icon="fa-file-invoice-dollar" label="Payments" itemKey="payments" active={activeKey === "payments"} onSelect={setActiveKey} muted onClick={onPayments} />
          <NavItem icon="fa-wallet" label="Credits" itemKey="credits" active={activeKey === "credits"} onSelect={setActiveKey} muted onClick={onCredits} />
          <NavItem icon="fa-trophy" label="Rewards" itemKey="rewards" active={activeKey === "rewards"} onSelect={setActiveKey} muted onClick={onRewards} />
          <NavItem icon="fa-user-plus" label="Refer a Friend" itemKey="refer" active={activeKey === "refer"} onSelect={setActiveKey} muted onClick={onRefer} />
          {showHelp && (
            <NavItem icon="fa-circle-question" label="Help" itemKey="help" active={activeKey === "help"} onSelect={setActiveKey} muted onClick={onHelp} />
          )}
        </div>
      </nav>
    </aside>
  );
}
