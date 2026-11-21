# LedgerFlow v0.8.7

## Highlights

- Localized destructive confirmation dialogs. In the English interface, clearing all transactions and clearing the investment chat context were still explained and labeled in Chinese — exactly the case where a user can confirm an irreversible action without understanding it.
- The "clear all transactions" flow asks the user to type a confirmation word. It now accepts both the Chinese and the English word, so an English user is never locked out of a destructive action by the interface language, while the confirmation still requires typing a full word.
- Localized all five tabs of Data & backup, the database connection configuration, the snapshot panel, and the backup scope selector, including the error and success messages that only appear after pressing "test connection" or "back up now".
- Fixed the object storage options rendering a hardcoded label: `阿里云 OSS / S3 兼容` now correctly reads `Alibaba Cloud OSS / S3-compatible`.
- Localized the investment AI chat panel and the bill preview card. System prompts sent to the model intentionally stay in Chinese.
- Fixed the smart budget result screen showing the built-in `固定支出` / `储蓄/投资` labels in Chinese. The internal sentinel values used for sorting and filtering are unchanged; a display-only mapping now translates them, so user category names stay untouched.

Both locale files hold the same 3403 keys.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Chinese interface wording is unchanged; component fallback strings stay byte-identical to the previous literals.
- `src/features/connection-config/**` currently has no external references. Its copy was localized and covered by unit tests, but it could not be verified through the UI because it is unreachable.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test` — 96 files / 711 tests
- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.7.md`
- Verified with the MCP browser on the English interface, stopping at the dialog and cancelling rather than executing any destructive action: the clear-transactions dialog renders fully in English, typing the English word enables the confirm button, typing a wrong word keeps it disabled, and switching back to Chinese reproduces the previous Chinese text byte for byte.
