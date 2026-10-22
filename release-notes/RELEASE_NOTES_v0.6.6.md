# LedgerFlow v0.6.6

## Highlights

- Rebuilt the smart budget board around 16 budget categories with identity-weighted distribution. Legacy zero-budget plans redistribute once while preserving manual edits.
- Unified assistant and investment chat controls with a consistent thin-outline SVG icon set, including clearer clear-context, send, stop, web-search, and model-selector icons.
- Combined the investment overview and market workspace into one navigation path while keeping boards, watchlist, and news as dedicated views.
- Improved startup resilience when relational data import fails, and enabled the `/api` proxy for Vite preview deployments.
- Refreshed the default AI model presets and retained session-scoped SQL import and export endpoints.

## Upgrade notes

- This release does not require a manual database migration.
- Existing smart-budget plans with a zero budget are redistributed once automatically.
- Keep persistent SQLite data mounted at `/app/data` for Docker deployments.

## Validation

- `npm run build`
- `npx vitest run src/features/smart-budget src/pages/smart-budget src/pages/assistant src/pages/investments`
- `node --test server/authHttp.test.js`

For deployment and product documentation, see the repository README.
