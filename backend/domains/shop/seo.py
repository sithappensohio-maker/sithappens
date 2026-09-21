"""What a crawler, or a link pasted into a chat, actually receives.

This exists because of one uncomfortable fact about how this app is served:
nginx hands every non-asset request the same `index.html`, and React fills in
the `<head>` afterwards. Googlebot renders JavaScript and would eventually
see those tags. **Facebook, iMessage, WhatsApp, Slack, Discord and Twitter do
not.** They fetch the URL once, read the bytes, and show whatever generic
title the shell happened to carry. So a product link shared in a group chat
would preview as "Sit Happens Dog Training • Daycare • Boarding" with no
picture, forever, no matter how good the client-side tags were.

The fix is small and deliberately not an SSR rewrite: the backend renders a
real HTML document for these routes, and nginx routes crawler requests to it.
People still get the SPA. Crawlers get the same facts, in HTML, on the first
response. Nothing is cloaked — the title, description, price and picture a
bot sees are the ones a person sees, because both come from this catalogue.

Everything here is built from the PUBLIC catalogue only. An account-only
product, a hidden one, an inactive one and one that never existed all produce
the same 404, so nothing in this file can be used to discover what the shop
is not showing the world. Account-required pages carry `noindex`, are absent
from the sitemap, and are refused here.
"""
from __future__ import annotations

import html
import json
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote

# Routes a search engine should be allowed to keep. Everything else about the
# shop — carts, orders, favourites, guest-order token links, the account-only
# catalogue — is either private or meaningless to a stranger.
INDEXABLE_PREFIXES = ("/shop", "/training", "/about", "/photography", "/contact")

# Never indexed, never in the sitemap, always noindex if reached.
PRIVATE_PREFIXES = (
    "/portal", "/admin", "/shop-manager", "/school", "/login", "/register",
    "/orders", "/favorites", "/cart", "/checkout", "/shop/order",
)

DEPARTMENT_SEO = {
    "gear": ("Dog Training Gear", "Leads, harnesses and the kit we actually use."),
    "training": ("Dog Training Programs", "Work with a trainer, in person."),
    "online_school": ("Online Dog Training School", "Guided courses you work through at home."),
    "prepaid": ("Prepaid Daycare Visits", "Buy visits up front, use them whenever."),
    "gift_cards": ("Gift Cards", "Emailed straight through. Spend it on anything."),
}

MAX_DESCRIPTION = 300


def _text(value: Any) -> str:
    """Plain words out of whatever an admin typed.

    Tags stripped, entities decoded, whitespace collapsed — a description
    field that happens to contain markup should not put markup into a meta
    tag, and a meta tag is not a place where HTML means anything anyway.
    """
    if not isinstance(value, str):
        return ""
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _clip(value: str, limit: int = MAX_DESCRIPTION) -> str:
    value = _text(value)
    if len(value) <= limit:
        return value
    # Cut at a word, not mid-syllable.
    return value[:limit].rsplit(" ", 1)[0].rstrip(",.;:—-") + "…"


def site_name(settings: dict) -> str:
    return _text((settings or {}).get("business_name")) or "Sit Happens"


def base_url(settings: dict, fallback: str = "") -> str:
    """The site's own address, from configuration rather than from the
    request — a canonical URL built from a Host header is a canonical URL an
    attacker can set."""
    configured = _text((settings or {}).get("public_url")) or fallback
    return configured.rstrip("/")


def description_for(item: dict, fallback: str) -> str:
    """The best true sentence available about this item.

    In order of preference: what the admin wrote for the shop, then the
    general description, then what the programme says it helps with, then a
    plain factual fallback. Nothing invents a marketing claim — if nobody has
    described this product, the description says what it is, not how good it
    is.
    """
    for key in ("online_description", "description"):
        text = _clip(item.get(key))
        if text:
            return text
    helps = [h for h in (item.get("helps_with") or []) if isinstance(h, str)]
    if helps:
        return _clip("Training for " + ", ".join(helps[:3]).lower() + ".")
    return _clip(fallback)


def item_title(item: dict, settings: dict) -> str:
    return f"{_text(item.get('name')) or 'Shop'} | {site_name(settings)}"


def item_canonical(item: dict, base: str) -> str:
    return f"{base}/shop/item/{quote(str(item.get('kind')))}/{quote(str(item.get('id')))}"


def image_url(item: dict, base: str) -> Optional[str]:
    """A picture big enough for a social card.

    The `pdp` derivative, not `thumb`: a 128px square stretched across a
    Facebook card looks like a mistake, and the larger file already exists.
    The public media route is used because whoever renders this card has no
    session and never will.
    """
    media_id = item.get("image_id") or (item.get("image_ids") or [None])[0]
    if not media_id:
        return None
    return f"{base}/api/public/shop/media/{quote(str(media_id))}/pdp"


def availability_for(item: dict) -> str:
    """schema.org availability, from real stock state only."""
    if item.get("kind") != "product":
        # Services and digital goods do not run out.
        return "https://schema.org/InStock"
    if item.get("availability") == "out_of_stock" or item.get("in_stock") is False:
        return "https://schema.org/OutOfStock"
    return "https://schema.org/InStock"


def structured_data(item: dict, settings: dict, base: str) -> Dict[str, Any]:
    """JSON-LD for one item, containing only what is actually known.

    The schema TYPE follows the thing being sold rather than forcing
    everything into `Product`: a leash is a Product, a course is a `Course`,
    a block of daycare visits and an in-person programme are `Service`. A
    gift card is a Product with a fixed price, which is what it is.

    Deliberately absent, and it must stay absent: aggregateRating,
    reviewCount, brand, manufacturer, sku when there is none, shipping rates,
    and any return policy. Nothing here is configured anywhere in this app,
    and inventing structured data is how a shop gets its rich results
    removed — quite apart from it being a lie.
    """
    kind = item.get("kind")
    name = _text(item.get("name"))
    description = description_for(item, f"{name} from {site_name(settings)}.")
    canonical = item_canonical(item, base)
    image = image_url(item, base)
    price = item.get("price")

    if kind == "training_program":
        schema_type = "Course" if item.get("purchase_fulfillment") == "online_school" else "Service"
    elif kind == "credit_pack":
        schema_type = "Service"
    else:
        schema_type = "Product"

    data: Dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": schema_type,
        "name": name,
        "description": description,
        "url": canonical,
    }
    if image:
        data["image"] = image
    if schema_type == "Course":
        # A Course must say who provides it; that is the one fact schema.org
        # requires here and the one fact we genuinely have.
        data["provider"] = {"@type": "Organization", "name": site_name(settings), "url": base}
    if schema_type == "Service":
        data["provider"] = {"@type": "LocalBusiness", "name": site_name(settings), "url": base}

    # An Offer only when there is a real, publicly visible price. A price the
    # shop deliberately hides must not reappear in structured data.
    if price is not None and item.get("show_public_price") is not False:
        data["offers"] = {
            "@type": "Offer",
            "price": f"{float(price):.2f}",
            "priceCurrency": "USD",
            "availability": availability_for(item),
            "url": canonical,
        }
    return data


def _meta(name: str, content: str, *, prop: bool = False) -> str:
    attr = "property" if prop else "name"
    return f'    <meta {attr}="{html.escape(name, quote=True)}" content="{html.escape(content or "", quote=True)}">'


def render_document(*, title: str, description: str, canonical: str,
                    image: Optional[str], site: str, og_type: str,
                    jsonld: Optional[Dict[str, Any]] = None,
                    body_heading: str = "", body_lines: Optional[List[str]] = None,
                    noindex: bool = False) -> str:
    """A complete, honest HTML document.

    Everything interpolated goes through `html.escape`, including the values
    inside attributes — a product named with a quotation mark must not be
    able to end an attribute and start writing tags. The JSON-LD block escapes
    `<` as well, which is the one character that can close a `<script>` from
    inside a JSON string.

    There is a real `<body>` too, not just a head full of tags. A crawler that
    finds an empty body treats the page as thin, and a person who somehow
    lands here should see the thing they were looking for and a way into the
    real page rather than a blank screen.
    """
    robots = "noindex, nofollow" if noindex else "index, follow"
    parts = [
        "<!doctype html>",
        '<html lang="en">',
        "  <head>",
        '    <meta charset="utf-8">',
        '    <meta name="viewport" content="width=device-width, initial-scale=1">',
        f"    <title>{html.escape(title)}</title>",
        _meta("description", description),
        _meta("robots", robots),
        f'    <link rel="canonical" href="{html.escape(canonical, quote=True)}">',
        _meta("og:site_name", site, prop=True),
        _meta("og:title", title, prop=True),
        _meta("og:description", description, prop=True),
        _meta("og:url", canonical, prop=True),
        _meta("og:type", og_type, prop=True),
        _meta("twitter:card", "summary_large_image" if image else "summary"),
        _meta("twitter:title", title),
        _meta("twitter:description", description),
    ]
    if image:
        parts.append(_meta("og:image", image, prop=True))
        parts.append(_meta("og:image:alt", body_heading or title, prop=True))
        parts.append(_meta("twitter:image", image))
    if jsonld:
        encoded = json.dumps(jsonld, ensure_ascii=False).replace("<", "\\u003c")
        parts.append(f'    <script type="application/ld+json">{encoded}</script>')
    parts += [
        "  </head>",
        "  <body>",
        f"    <h1>{html.escape(body_heading or title)}</h1>",
    ]
    for line in body_lines or [description]:
        parts.append(f"    <p>{html.escape(line)}</p>")
    parts += [
        f'    <p><a href="{html.escape(canonical, quote=True)}">View this on {html.escape(site)}</a></p>',
        "  </body>",
        "</html>",
        "",
    ]
    return "\n".join(parts)


def sitemap_xml(urls: List[Dict[str, str]]) -> str:
    """A sitemap of public shop routes and nothing else.

    What is in it is decided by the same public catalogue the storefront
    uses, so a hidden product cannot appear here any more than it can appear
    on the shop's front page. Carts, orders, favourites, guest-order token
    links, account pages and admin are absent by construction — they are
    never added, rather than added and filtered.
    """
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for entry in urls:
        lines.append("  <url>")
        lines.append(f"    <loc>{html.escape(entry['loc'], quote=True)}</loc>")
        if entry.get("lastmod"):
            lines.append(f"    <lastmod>{html.escape(entry['lastmod'], quote=True)}</lastmod>")
        if entry.get("changefreq"):
            lines.append(f"    <changefreq>{html.escape(entry['changefreq'])}</changefreq>")
        lines.append("  </url>")
    lines.append("</urlset>")
    lines.append("")
    return "\n".join(lines)


def robots_txt(base: str) -> str:
    """Let the shop be found; keep everything private out.

    Written as an allowlist of disallows rather than a blanket rule, because
    the failure mode that matters here is disallowing the whole site by
    accident — which is a thing that happens, and which nobody notices for a
    month.
    """
    lines = ["User-agent: *"]
    for prefix in PRIVATE_PREFIXES:
        lines.append(f"Disallow: {prefix}")
    lines += [
        "# The API is data, not pages. Product images are deliberately allowed:",
        "# a social card cannot render without fetching one.",
        "Disallow: /api/",
        "Allow: /api/public/shop/media/",
        "",
        f"Sitemap: {base}/sitemap.xml",
        "",
    ]
    return "\n".join(lines)
