# Authentication Future Runtime Crash Hotfix

## Symptom
All authenticated pages returned HTTP 500 and failed to load. Backend logs showed:

```
TypeError: a coroutine was expected, got <Future pending ...>
```

## Cause
The short-lived authenticated-user cache passed Motor's `find_one()` Future to `asyncio.create_task()`. Python 3.11 `create_task()` only accepts coroutine objects.

## Fix
- Replaced `asyncio.create_task(...)` with `asyncio.ensure_future(...)`.
- Updated the in-flight lookup type to `asyncio.Future`.
- Parallel authenticated requests still share one Mongo lookup.
- No authentication, user, client, booking, payment, register, or database data is modified.

## Deployment
Rebuild and restart the backend container, then sign out/reload and log in again.
