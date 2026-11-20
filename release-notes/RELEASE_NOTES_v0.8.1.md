# LedgerFlow v0.8.1

## Highlights

- Fixed the site-wide font loading failure. `MiSans` and `Geist Mono` were served from the public CDN domain without an `Access-Control-Allow-Origin` header, so the browser blocked every `@font-face` request; the app silently fell back to system fonts and printed a CORS error on every page. Fonts are now requested from the same origin (`/cdn/fonts/...`) with the CDN URL kept as a second candidate, so the intended numeral and Chinese typography finally renders.
- Added the same-origin `/cdn` proxy to the Vite dev server, the Vite preview server, and the bundled Nginx configuration, removing the dependency on CDN cross-origin configuration.
- Localized the Accounts & Categories page into English.
- Localized the Smart Budget page into English, including the step wizard and every budget panel read from `src/features/smart-budget`.
- The global "checking account status" loading state now follows the interface language instead of always rendering Chinese.
- Finished the third English pass over the repayment page: debt list, filters and sorting, and the repayment timeline.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Docker deployments that terminate TLS in front of Nginx should keep `/cdn/` reachable; if the proxy is unavailable the browser falls back to the public CDN URL, which degrades to the previous system-font rendering instead of breaking the page.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.1.md package.json`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`
- Verified in a real browser: no CORS errors remain in the console, `document.fonts` reports the MiSans and Geist Mono faces as `loaded`, and `/cdn/fonts/MiSans-Regular.woff2` returns `200` with `content-type: font/woff2`.
