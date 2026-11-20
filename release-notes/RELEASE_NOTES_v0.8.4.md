# LedgerFlow v0.8.4

## Highlights

- Localized the repayment page's chart section and debt detail panel: projected repayment trend, periods, principal and interest, remaining-interest estimate, period selector, "more details", annual-rate ranking, estimated monthly payment, and 30 further strings.
- Chart month ticks now follow the interface language through `Intl.DateTimeFormat` (`11月` in Chinese, `Nov` in English) instead of a hardcoded Chinese month table, and add the year only when the axis crosses a year boundary.
- Period labels and repayment days are localized too: `第 3 期` renders as `Period 3` and `25 日` as `25th` (with correct `1st` / `2nd` / `3rd` handling).
- Reused the existing `src/shared/lib/i18nDate.ts` helpers for month keys, so Chinese output is byte-identical to before.

With this release the repayment page contains no Chinese interface copy in the English interface; what remains is user data such as debt names and repayment notes.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Three repayment-page assertions were updated because the rendered date and period format intentionally changed; none of them were loosened in coverage.
- The debt create/edit form is not part of this release and is still Chinese in the English interface.
- Both locale files hold the same 2548 keys, and Chinese fallback strings stay byte-identical to the previous literals.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test` — 96 files / 711 tests
- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.4.md`
- Verified in a real browser (English interface): the repayment page reports only debt names and a user-written note as remaining Chinese text, and the month axis renders `Dec … 2027/Oct`.
