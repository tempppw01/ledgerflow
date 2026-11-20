# LedgerFlow v0.8.5

## Highlights

- Localized the debt create/edit form — the last major untranslated surface. This covers the primary actions (save changes, cancel editing, add another debt, finish and close), the "still missing: …" validation hint, the structured fields (remaining periods, total periods, loan amount, total repayment), and the manual repayment-plan editor.
- Localized the "confirm this period's payment" and "delete debt record" confirmation dialogs.
- Short dates in the form are no longer fixed to the Chinese month/day order; they go through `Intl.DateTimeFormat` and follow the interface language.
- Exchange request failures now report in the interface language. Previously the English interface showed a Chinese message such as `汇率 API 请求失败: 500`.

Every main page is now covered in both languages. Both locale files hold the same 2606 keys.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Chinese fallback strings embedded in components stay byte-identical to the previous literals, so the Chinese interface is unchanged.
- Two i18n keys are now read through the i18n singleton from non-component modules (`exchangeClient`, `useExchangeRates`); they keep their Chinese default value when a key is absent.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test` — 96 files / 711 tests
- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.5.md`
- Verified in a real browser that the repayment page renders with no Chinese interface copy in the English interface, and that all 14 dialog keys resolve in both locale files with no Chinese in the English values.
