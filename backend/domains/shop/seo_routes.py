"""The routes a crawler, a social preview bot and a sitemap fetcher hit.

All public, all unauthenticated, all built from the PUBLIC catalogue — the
same `_public_visible_shop_items()` the storefront shows a signed-out
visitor. That single choice is what makes every requirement in this area
true at once: a hidden product is missing from the sitemap, missing from
structured data, missing from the social preview, and 404s on a direct
crawler request, because it is missing from the one list all of them read.

Nothing here needs a session and nothing here accepts one. There is no
parameter that changes what is visible.
"""
from __future__ import annotations

import os
from typing import Optional

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response

from domains.shop import seo

# Long enough that a crawler revisiting in an hour gets a cheap answer, short
# enough that hiding a product takes effect the same day. Public and
# cacheable: there is nothing per-person in any of these responses.
CACHE = "public, max-age=900"


def register_shop_seo_routes(*, api, server_globals: dict) -> None:
    def _s(name):
        return server_globals[name]

    async def _limit(request: Request, bucket: str, *, limit: int, window: int) -> None:
        await _s("_enforce_rate_limit")(
            request, bucket, _s("_client_ip")(request), limit=limit, window_seconds=window)

    async def _context():
        settings = await _s("get_settings")() or {}
        base = seo.base_url(settings, os.environ.get("APP_PUBLIC_URL", ""))
        if not base:
            base = "http://localhost:3000"
        return settings, base

    @api.get("/public/shop/page-meta/{kind}/{item_id}", response_class=HTMLResponse)
    async def public_shop_item_meta(kind: str, item_id: str, request: Request):
        """A real HTML page for one public shop item.

        This is what nginx hands to a crawler or a link-preview bot in place
        of the JavaScript shell. Same facts as the page a person sees —
        title, description, price, picture — just delivered in the first
        response instead of after a bundle executes.

        404 for anything the public catalogue does not contain: hidden,
        inactive, account-only, or never real. All four look identical from
        out here.
        """
        await _limit(request, "shop_page_meta", limit=120, window=60)
        settings, base = await _context()
        items = await _s("_public_visible_shop_items")()
        item = next((i for i in items if i.get("kind") == kind and i.get("id") == item_id), None)
        if item is None:
            raise HTTPException(status_code=404, detail="Not found.")

        site = seo.site_name(settings)
        title = seo.item_title(item, settings)
        description = seo.description_for(item, f"{item.get('name')} from {site}.")
        canonical = seo.item_canonical(item, base)
        image = seo.image_url(item, base)

        facts = [description]
        price = item.get("price")
        if price is not None and item.get("show_public_price") is not False:
            facts.append(f"${float(price):.2f}")

        html_doc = seo.render_document(
            title=title, description=description, canonical=canonical, image=image,
            site=site, og_type="product",
            jsonld=seo.structured_data(item, settings, base),
            body_heading=str(item.get("name") or ""), body_lines=facts,
        )
        return HTMLResponse(html_doc, headers={"Cache-Control": CACHE})

    @api.get("/public/shop/page-meta", response_class=HTMLResponse)
    async def public_shop_landing_meta(request: Request, dept: Optional[str] = None):
        """The shop's front page, or one department, as real HTML."""
        await _limit(request, "shop_page_meta", limit=120, window=60)
        settings, base = await _context()
        site = seo.site_name(settings)
        shop_page = (settings.get("shop_page") or {})

        if dept and dept in seo.DEPARTMENT_SEO:
            label, tagline = seo.DEPARTMENT_SEO[dept]
            title = f"{label} | {site}"
            description = tagline
            canonical = f"{base}/shop?dept={dept}"
            heading = label
        else:
            title = f"Shop | {site}"
            # The owner's own words where they have written some. A generic
            # fallback beats a fabricated claim about the merchandise.
            description = (seo._clip(shop_page.get("subtitle"))
                           or f"Training gear, programs and prepaid visits from {site}.")
            canonical = f"{base}/shop"
            heading = seo._text(shop_page.get("title")) or f"Shop {site}"

        return HTMLResponse(
            seo.render_document(
                title=title, description=description, canonical=canonical,
                image=None, site=site, og_type="website", body_heading=heading),
            headers={"Cache-Control": CACHE})

    @api.get("/public/shop/sitemap.xml")
    async def public_shop_sitemap(request: Request):
        """Every public shop URL worth indexing, and no others."""
        await _limit(request, "shop_sitemap", limit=60, window=60)
        settings, base = await _context()
        items = await _s("_public_visible_shop_items")()

        urls = [{"loc": f"{base}/shop", "changefreq": "daily"}]
        seen_departments = set()
        for item in items:
            dept = _department_of(item)
            if dept and dept not in seen_departments:
                seen_departments.add(dept)
                urls.append({"loc": f"{base}/shop?dept={dept}", "changefreq": "weekly"})
        for item in items:
            urls.append({
                "loc": seo.item_canonical(item, base),
                "lastmod": str(item.get("updated_at") or item.get("listed_on") or "")[:10] or None,
                "changefreq": "weekly",
            })
        return Response(seo.sitemap_xml(urls), media_type="application/xml",
                        headers={"Cache-Control": CACHE})

    @api.get("/public/shop/robots.txt", response_class=PlainTextResponse)
    async def public_shop_robots(request: Request):
        await _limit(request, "shop_sitemap", limit=60, window=60)
        _settings, base = await _context()
        return PlainTextResponse(seo.robots_txt(base), headers={"Cache-Control": CACHE})


def _department_of(item: dict) -> Optional[str]:
    """The same five departments the storefront uses."""
    kind = item.get("kind")
    if kind == "product":
        return "gear"
    if kind == "credit_pack":
        return "prepaid"
    if kind == "gift_card":
        return "gift_cards"
    if kind == "training_program":
        return "online_school" if item.get("purchase_fulfillment") == "online_school" else "training"
    return None
