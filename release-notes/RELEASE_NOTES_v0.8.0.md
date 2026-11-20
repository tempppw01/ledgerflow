# LedgerFlow v0.8.0

## Highlights

- Migrated all business data to SQL-backed persistence, with SQLite and MySQL as first-class providers.
- Moved every public asset to Cloudflare R2 and added a migration tool for the legacy bucket.
- Expanded the AI assistant into a merged bookkeeping agent with ledger tools for recording, editing, and deleting entries.
- Added account management tools and kept agent tool context in sync within a single turn.
- Added streaming fallbacks: when a tool call is missing from a streamed response the request retries as non-streaming instead of failing.
- Kept successful agent results when a later round in the same turn fails.
- Rebuilt the category workspace as a two-level tree, with tag rename, parent-category rollups, and child transactions counted into their parent.
- Added English localization to the overview, transactions, subscription, transaction-edit, and data & backup pages.
- Regenerated jargon follow-up suggestions in plain, everyday language.
- Polished the narrow-screen mode switch, the Nasdaq 100 label, provider icons, and the financial-analysis bar chart height.

## Upgrade notes

- This release does not require a manual database migration; the SQL-backed store initializes on first start.
- Existing SQLite and MySQL deployments keep their data, and account sessions remain compatible.
- Public assets now load from Cloudflare R2. Self-hosted deployments that block third-party origins should allow `pub-*.r2.dev`.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`
