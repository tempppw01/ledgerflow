# LedgerFlow v0.7.0

## Highlights

- Added English and Chinese interface localization, including localized dates, amounts, page copy, and language switching.
- Hardened all four assistant modes with isolated conversation, input, pending-bill, and retry states.
- Improved AI streaming, timeout recovery, attachment handling, token usage visibility, duplicate-bill review, and model selection.
- Expanded the credit assistant with debt classification, repayment-cycle analysis, amount semantics, annualized-rate handling, and safer prefill-to-save flows.
- Improved investment chat attachments, market insight recovery, touch usability, and starter prompts.
- Polished transaction, refund, balance, filter, settings, mobile navigation, and responsive layouts across the app.
- Added consistent brand icons for supported AI and web-search providers.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, and investment records remain compatible.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.7.0.md package.json package-lock.json src/shared/config/app.ts`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`

For deployment and product documentation, see the repository README.
