"""Shop image delivery.

Two routes, deliberately separate, because they answer to different rules:

  * the authenticated one serves any signed-in user. A media id is
    content-addressed — replacing a picture creates a NEW id — so the bytes
    behind one can never change and the response is immutable. `private`,
    not `public`, so a shared proxy never holds a signed-in response.

  * the public one re-checks authorization on EVERY request, including
    conditional ones. An image whose product was hidden since must start
    404ing immediately, and a cheap 304 would otherwise keep serving it. It
    therefore revalidates rather than caching hard — exactly the rule the
    existing public JSON media route already follows.

Both return real image bytes with a real Content-Type, so the browser
caches, decodes and reuses them like any other image on the web.
"""
from __future__ import annotations

from fastapi import HTTPException, Request, Response

from domains.shop import media as shop_media


def register_shop_routes(*, api, server_globals: dict) -> None:
    enforce_rate_limit = server_globals["_enforce_rate_limit"]
    client_ip = server_globals["_client_ip"]
    is_public_shop_media = server_globals["_is_public_shop_media"]

    def _image_response(deriv: dict, *, request: Request, public: bool) -> Response:
        etag = f'"{deriv["etag"]}"'
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={
                "ETag": etag,
                "Cache-Control": ("public, max-age=0, must-revalidate" if public
                                  else "private, max-age=31536000, immutable"),
            })
        return Response(
            content=bytes(deriv["data"]),
            media_type=deriv["mime"],
            headers={
                "ETag": etag,
                "Cache-Control": ("public, max-age=0, must-revalidate" if public
                                  else "private, max-age=31536000, immutable"),
                # Nothing here is user-supplied text, but an image route
                # should never be talked into rendering as a document.
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": "inline",
            },
        )

    @api.get("/shop/media/{media_id}/{size}")
    async def get_shop_media_derivative(media_id: str, size: str, request: Request):
        """A product image at the size the caller is actually drawing.

        Deliberately not session-gated, because an <img> tag cannot send a
        bearer token — and without an <img> tag there is no srcset, no
        browser image cache and no point to any of this. What replaces the
        session is a narrower rule: the image must still be REFERENCED by a
        live catalog item. An orphan, a deleted product's photo or a guessed
        id serves nothing.

        The rule is PUBLIC VISIBILITY, not mere existence: the image must
        belong to an item that is active, published, and publicly visible,
        or be storefront chrome. An account-only product keeps its
        photography private — asking for it here returns 404 exactly like a
        made-up id, and the client Shop falls back to the authenticated
        route for those, as it always did.
        """
        await enforce_rate_limit(
            request, "shop_media_asset", client_ip(request), limit=600, window_seconds=60)
        if not await shop_media.is_catalog_public_image(media_id):
            raise HTTPException(status_code=404, detail="Image not found")
        deriv = await shop_media.derivative(media_id, size)
        if not deriv:
            raise HTTPException(status_code=404, detail="Image not found")
        return _image_response(deriv, request=request, public=False)

    @api.get("/public/shop/media/{media_id}/{size}")
    async def get_public_shop_media_derivative(media_id: str, size: str, request: Request):
        """The same picture for a guest, but only while its product is
        actually public. Authorization is re-checked every time."""
        await enforce_rate_limit(
            request, "public_shop_media", client_ip(request), limit=300, window_seconds=60)
        if not await is_public_shop_media(media_id):
            raise HTTPException(status_code=404, detail="Not found.")
        deriv = await shop_media.derivative(media_id, size)
        if not deriv:
            raise HTTPException(status_code=404, detail="Not found.")
        return _image_response(deriv, request=request, public=True)
