"""Low-overhead request timing for Phase 6 profiling."""
from __future__ import annotations

import logging
import os
import time

logger = logging.getLogger("sithappens.performance")


def install_request_timing(app) -> None:
    threshold_ms = max(50.0, float(os.environ.get("SLOW_REQUEST_MS", "750") or 750))

    @app.middleware("http")
    async def _request_timing(request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        response.headers["Server-Timing"] = f"app;dur={elapsed_ms:.1f}"
        if elapsed_ms >= threshold_ms and request.url.path.startswith("/api/"):
            logger.warning(
                "slow_api method=%s path=%s status=%s duration_ms=%.1f",
                request.method, request.url.path, response.status_code, elapsed_ms,
            )
        return response
