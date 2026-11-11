# LedgerFlow v0.7.1

## Highlights

- Added an AI investment agent that can read portfolio, watchlist, goal, and investable-cash context through tool calls.
- Added undoable investment actions for recording holding shares and updating goal progress from the assistant.
- Added investment-page AI entry points for holdings, watchlist items, market reviews, sectors, and breaking news.
- Shared the latest market snapshot between the investment page and the standalone AI investment assistant.
- Added a Data settings workspace with account-scoped record counts and a confirmed database reset flow.
- Reset now clears finance data, app preferences, AI memories, and the smart-budget cache while preserving the account, sessions, and database configuration.
- Added a forgot-password flow with single-use hashed reset tokens, SMTP delivery, rate limiting, and full session revocation after a password change.
- Stabilized date-sensitive repayment tests and Windows SQLite test cleanup.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Database reset is optional and irreversible. Export a JSON, WebDAV, OSS, or SQL backup first if the data may be needed again.
- Configure `LEDGERFLOW_APP_URL` and the `LEDGERFLOW_SMTP_*` variables to enable password reset email delivery. Without SMTP, the login page still shows the entry point and the API returns a configuration error.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.7.1.md package.json package-lock.json src/shared/config/app.ts src/pages/settings/SettingsPage.tsx src/pages/settings/SettingsPage.test.tsx src/pages/repayment-management/RepaymentManagementPage.test.tsx server/authHttp.test.js server/mysqlSnapshotServer.js src/shared/api/relationalDataClient.ts`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`
- `node --test server/*.test.js`

For deployment and product documentation, see the repository README.
