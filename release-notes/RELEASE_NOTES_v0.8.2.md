# LedgerFlow v0.8.2

## Highlights

- Localized the sign-in, sign-up, forgot-password, and reset-password screens. Until now the first screen every user sees was Chinese-only, even with the interface set to English.
- Localized the currency converter, including the currency names themselves (`Chinese Yuan`, `US Dollar`, `Hong Kong Dollar`, …) while keeping the API currency codes untouched.
- Localized the salary tools page: inputs, results, overtime reference, and unit labels now follow the interface language.
- Fixed raw timestamps leaking into the repayment record list. Entries rendered the stored value directly, so a user saw `2026-10-25T00:00:00.000Z`; they now show a localized date.
- Fixed the repayment record amount, which was hardcoded to `¥` plus `toFixed(2)` instead of the shared currency formatter.
- Fixed the repayment overview stat band rendering ungrouped numbers (`54860.40` next to `¥12,860.40` elsewhere on the same screen). Added `formatNumberFixed2`, which keeps the large-number/small-unit layout while grouping digits.
- `formatDate` now follows the interface language instead of always using `zh-CN`, and returns the original value instead of `Invalid Date` for unparseable input.
- Added a guard test that fails when the version shown in the UI (`src/shared/config/app.ts`) drifts from `package.json`. The v0.8.0 release shipped with a UI that still reported `v0.8.0` after the version had moved on.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Interface copy moves into `src/i18n/locales/*/translation.json`; both language files are kept key-for-key identical, and the Chinese fallback strings embedded in the components are byte-identical to the preceding literals, so nothing changes for users running Chinese.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npx prettier --check src/i18n/locales/en/translation.json src/i18n/locales/zh/translation.json`
- Verified in a real browser (English interface): the sign-in, forgot-password, currency converter, and salary tools pages contain no Chinese copy, and the repayment page no longer renders an ISO timestamp or an ungrouped amount.
