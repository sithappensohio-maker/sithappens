# Legacy Login Internal Server Error Fix

## Problem
Existing users created before the security hardening may not have a `must_change_password` field.
The login endpoint explicitly included that missing value as `null`, while the response model requires a boolean.
FastAPI therefore raised a response validation error after validating the password, and the browser displayed
`Internal Server Error`.

## Fix
The login response now normalizes the field with:

```python
bool(user.get("must_change_password", False))
```

No user records, passwords, sessions, bookings, payments, or other business data are migrated or changed.
Legacy accounts default safely to `false`; newly created temporary-password accounts continue to use `true`.

## Validation
- Backend server module compiles successfully.
- Login response always supplies a boolean for `must_change_password`.
