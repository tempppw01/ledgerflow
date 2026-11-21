# LedgerFlow v0.8.6

## Highlights

- Localized the transaction detail drawer. Opening any transaction used to show an entirely Chinese drawer in the English interface — the primary interaction surface on the busiest page, and one that page-load checks never reach because it only renders after a click.
- Localized the transactions page areas that are hidden by default: the bulk-action panel, the insights side panel, the bill-import pre-check and report, the toolbar menu, the refund and duplicate-confirmation dialogs, the quick-add and share drawers, and every toast.
- The drawer and the transaction table now describe the same transaction with the same wording, and PDF export and A4 print output follow the interface language for titles, headers, and generation time.
- Localized the investments page market-closed notices, session labels, board-health labels, and algorithm-signal copy. Market and fund API error messages now follow the interface language too.
- Replaced single-letter transaction direction badges (`I`/`E`) with readable short forms (`In`/`Out`, and `Ref`/`Rev` for refunds) that keep the compact badge layout.
- Fixed `investments.notice.weekendDetail` and `holidayDetail` missing their `{date}` placeholder, which rendered as `" is a weekend…"` in English.
- Moved the API error translator into `src/shared/lib/apiErrorTranslator.ts`. It previously lived inside a feature module, which made the i18n bootstrap depend on a feature (a layering violation), and the fund client registered its translator into a second, never-connected registry — so its errors were never translated. There is now one shared registry, registered from `src/i18n`.

Both locale files hold the same 3029 keys.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Chinese interface wording is unchanged: component fallback strings stay byte-identical, and this release did not retranslate Chinese copy.
- Known remaining Chinese in the English interface: AI system prompts (intentionally, they are instructions sent to the model), market data such as fund, index, sector and news names, and a few investment-chat strings scheduled for a later release.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test` — 96 files / 711 tests
- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.6.md`
- Verified in a real browser (English interface) with zero console errors: the transaction drawer renders `Transaction details / Category / Account / Source / Manual entry / Status / Completed / Share / Issue refund / Edit / Delete / More`, the delete dialog renders `Move to the recycle bin?`, and only user data such as category, account and note text stays Chinese.
