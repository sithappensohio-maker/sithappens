# Sit Happens frontend

React 19 SPA built with Vite. Production is served by nginx from `dist/` and
uses the existing SPA fallback for React Router deep links.

## Local development

```bash
corepack enable
yarn install
yarn dev
```

When `VITE_BACKEND_URL` is blank, the Vite dev server proxies `/api` to
`VITE_DEV_BACKEND_URL` (default `http://127.0.0.1:8001`). Existing deployments
that still define `REACT_APP_BACKEND_URL` remain supported during migration.

## Tests

```bash
yarn test:ci
```

The existing Jest suite remains Jest intentionally; Phase 7 changes the build
tool, not test semantics.

## Production build

```bash
yarn build
```

Output is written to `dist/`.
