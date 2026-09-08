import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { PUBLIC_NAV, usePublicSite, hoursRows } from "./publicSite";

/**
 * The public website's frame: brand header with the site's navigation, a
 * phone-friendly drawer, and a footer with the business facts. Every public
 * page renders inside it. Signed-in visitors get "My portal" instead of
 * "Client login" so the website never hides the app from them.
 */
function isActive(item, pathname) {
  if (item.to === "/") return pathname === "/";
  const base = item.to.split(/[?#]/)[0];
  return base !== "/" && pathname.startsWith(base);
}

export default function PublicSiteShell({ children, testid = "public-site" }) {
  const { user } = useAuth();
  const { site, data } = usePublicSite();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const signedIn = !!user;
  const accountHref = signedIn ? "/" : "/login";
  const accountLabel = signedIn ? "My portal" : "Client login";
  const phone = site?.phone;
  const tel = phone ? phone.replace(/[^\d+]/g, "") : "";
  const rows = hoursRows(data?.business_hours);
  const year = new Date().getFullYear();

  const navLink = (item, extra = "") => {
    const active = isActive(item, pathname);
    const cls = `sh-site-nav__link ${active ? "is-active" : ""} ${extra}`;
    const external = item.to.startsWith("/shop");
    // Shop and Online School live in the app's own router tree; a full
    // navigation there is intentional (they mount their own providers).
    if (external || item.to.includes("#")) {
      return <a key={item.key} href={item.to} className={cls} data-testid={`site-nav-${item.key}`}>{item.label}</a>;
    }
    return <Link key={item.key} to={item.to} className={cls} data-testid={`site-nav-${item.key}`}>{item.label}</Link>;
  };

  return (
    <div className="sh-site min-h-screen w-full bg-bgBase text-white sh-public-landing" data-testid={testid}>
      <a href="#site-main" className="sh-site-skip">Skip to content</a>
      <header className="sh-site-header" data-testid="site-header">
        <div className="sh-site-header__inner">
          <Link to="/" className="sh-site-brand" aria-label="Sit Happens home" data-testid="site-brand">
            <img src="/logo.png" alt="" className="sh-site-brand__logo" />
            <span className="min-w-0">
              <span className="sh-public-wordmark sh-public-wordmark--header block">Sit Happens</span>
              <span className="sh-site-brand__sub">{site?.tagline || "Dog Training · Daycare & Boarding · Warren, Ohio"}</span>
            </span>
          </Link>
          <nav className="sh-site-nav" aria-label="Site">
            {PUBLIC_NAV.map((item) => navLink(item))}
          </nav>
          <div className="sh-site-header__actions">
            {tel && <a href={`tel:${tel}`} className="sh-site-phone" data-testid="site-header-phone"><i className="fas fa-phone" /><span>{phone}</span></a>}
            <Link to={accountHref} className="sh-site-account" data-testid="site-account-link">
              <i className={`fas ${signedIn ? "fa-house" : "fa-user"}`} />{accountLabel}
            </Link>
            <button type="button" className="sh-site-burger" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
                    onClick={() => setOpen((o) => !o)} data-testid="site-menu-toggle">
              <i className={`fas ${open ? "fa-xmark" : "fa-bars"}`} />
            </button>
          </div>
        </div>
        {open && (
          <div className="sh-site-drawer" data-testid="site-drawer">
            {PUBLIC_NAV.map((item) => navLink(item, "sh-site-drawer__link"))}
            <Link to={accountHref} className="sh-site-drawer__link is-account" data-testid="site-drawer-account">
              <i className={`fas ${signedIn ? "fa-house" : "fa-user"} mr-2`} />{accountLabel}
            </Link>
            {tel && <a href={`tel:${tel}`} className="sh-site-drawer__link"><i className="fas fa-phone mr-2" />Call {phone}</a>}
          </div>
        )}
      </header>

      <main id="site-main" className="sh-site-main">{children}</main>

      <footer className="sh-site-footer" data-testid="site-footer">
        <div className="sh-site-footer__grid">
          <div>
            <p className="sh-public-wordmark sh-public-wordmark--small">Sit Happens</p>
            <p className="text-[13px] text-gray-400 mt-2 leading-relaxed">{site?.tagline || "Dog Training · Daycare & Boarding · Warren, Ohio"}</p>
            {site?.service_area && <p className="text-[12px] text-gray-500 mt-2">Serving {site.service_area}.</p>}
          </div>
          <div data-testid="site-footer-contact">
            <p className="sh-site-footer__title">Contact</p>
            {phone && <a href={`tel:${tel}`} className="sh-site-footer__row"><i className="fas fa-phone" />{phone}</a>}
            {site?.email && <a href={`mailto:${site.email}`} className="sh-site-footer__row"><i className="fas fa-envelope" />{site.email}</a>}
            {site?.address_line && (
              <a href={site.map_url || "#"} target="_blank" rel="noopener noreferrer" className="sh-site-footer__row">
                <i className="fas fa-location-dot" />{site.address_line}, {site.city}, {site.state} {site.zip}
              </a>
            )}
          </div>
          <div data-testid="site-footer-hours">
            <p className="sh-site-footer__title">Hours</p>
            {rows.length === 0 && <p className="text-[13px] text-gray-400">Call or message us for current hours.</p>}
            {rows.map((r) => (
              <p key={r.days} className="sh-site-footer__row"><span className="w-20 shrink-0 text-gray-500">{r.days}</span>{r.hours}</p>
            ))}
          </div>
          <div>
            <p className="sh-site-footer__title">Explore</p>
            <div className="flex flex-col gap-1.5">
              {PUBLIC_NAV.filter((i) => i.key !== "home").map((item) => (
                item.to.startsWith("/shop") || item.to.includes("#")
                  ? <a key={item.key} href={item.to} className="sh-site-footer__link">{item.label}</a>
                  : <Link key={item.key} to={item.to} className="sh-site-footer__link">{item.label}</Link>
              ))}
              <Link to={accountHref} className="sh-site-footer__link">{accountLabel}</Link>
            </div>
          </div>
        </div>
        <div className="sh-site-footer__bar">
          <p>© {year} Sit Happens Dog Training · Warren, Ohio</p>
          <p><i className="fas fa-paw text-shGreen mr-1" />Where every pup finds their happy.</p>
        </div>
      </footer>
    </div>
  );
}
