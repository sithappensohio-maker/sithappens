"""Production ASGI entrypoint for Sit Happens.

Phase 4 made server.py's application composition explicit. Training/School
routers and services are registered before ``server.app`` is exported, so the
ASGI entrypoint no longer performs post-import monkey-patching.
"""
import server

app = server.app
