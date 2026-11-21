# LedgerFlow v0.8.9

## Highlights

- Localized the mobile navigation drawer's insight card (`AppLayout`). On a 390×844 viewport the drawer used to show the whole MobileNavInsight card in Chinese even in the English interface: "This month's balance", "Cash flow", "Income gap", "Latest update" and their descriptions, plus the drawer subtitle and monthly balance/income-expense lines.
- The drawer card now uses the same `useTFallback()` pattern as the rest of the app instead of a hand-written `isEnglish ? … : …` ternary, so it respects the i18n fallback mechanism rather than a hard-coded language check.
- Fixed three `defaultValue` strings in `t('layout.xxx', { defaultValue: '中文' })` that were still Chinese, which would have leaked Chinese into the English interface whenever the locale key was missing.
- Taught the repository's bare-Chinese scanner to recognize `tFallback` as an i18n call, so `AppLayout.tsx` now reports zero bare Chinese (down from 24).

No change to navigation behavior, styling, or layout. The `isEnglish` flag is retained only for the text-truncation length branch.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Chinese interface wording is unchanged; component fallback strings stay byte-identical.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test` — 96 files / 711 tests
- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.9.md`
- Verified with the MCP browser on a 390×844 viewport in the English interface: the drawer's insight card renders in English, and switching back to Chinese reproduces the previous Chinese text.
