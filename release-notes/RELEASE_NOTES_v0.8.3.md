# LedgerFlow v0.8.3

## Highlights

- Localized the AI assistant page. The welcome card for all three assistant modes (title, description, the three capability rows, and the month-to-date expense/income/balance summary) and the first greeting message now follow the interface language.
- Replaced the hardcoded Chinese date and weekday in the assistant greeting with `Intl.DateTimeFormat`, so it reads naturally in English instead of always using Chinese formatting.
- Localized the repayment page's remaining status copy: the debt-to-income label including its Healthy / Watch / High wording, all eight debt status badges (paid this cycle, awaiting due date, overdue, due today, due this cycle, and so on), the monthly income source labels, and the "needs confirmation" hint.
- Fixed a hidden localization coupling: focusing the credit assistant's composer looked the textarea up by the Chinese `aria-label` string. As soon as that label followed the interface language, the lookup would silently fail in English. It now uses the existing `ref` instead.
- Localized the assistant composer `aria-label` and the credit chat header, which were still hardcoded Chinese.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Both locale files hold the same 2511 keys. Chinese fallback strings embedded in components stay byte-identical to the previous literals, so the Chinese interface is unchanged.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.3.md`
- Verified in a real browser: `/assistant` renders with no Chinese copy in the English interface, `/repayment-management` keeps its remaining chart labels for a follow-up release, and switching back to Chinese leaks no raw i18n keys on either page.
