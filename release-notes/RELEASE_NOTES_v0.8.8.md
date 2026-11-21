# LedgerFlow v0.8.8

## Highlights

- A copy-density pass. The interface had drifted toward reading like a software manual: every page opened with a marketing subtitle, most cards repeated their own purpose in a grey sentence, and several controls carried helper text explaining what the placeholder already said. About 100 of those strings are gone.
- The rule applied: if the line can be removed and a user still understands what the screen does within a few seconds, it goes. What a user learns by interacting does not need to be written down, and reference material belongs in the developer docs, not the UI.
- Removed: page-level subtitles, card descriptions that restated the heading, tap-here / fill-this-next instructions, per-checkbox scope explanations, and format hints duplicated by the placeholder.
- Kept deliberately: validation errors and failure messages, destructive-action warnings (including "this cannot be undone" and "the account itself is kept"), empty states, chart legends and units, and the technical notes without which a configuration field cannot be filled in correctly.
- Two test assertions referenced copy that was removed. They now assert the sibling element that still exists (a heading, a field, a period number) instead; no assertion was loosened in coverage.

## Upgrade notes

- This release does not require a manual database migration.
- Existing ledgers, assistant histories, investment records, and account sessions remain compatible.
- Copy has been removed from the UI; the corresponding i18n keys are still present in the locale files and are now unused. They are harmless and will be pruned in a later cleanup.
- Nothing was added to replace the removed text, and no layout container was left behind that only existed to hold it.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npm test` — 96 files / 711 tests
- `npx prettier --check README.md release-notes/RELEASE_NOTES_v0.8.8.md`
- Container and dialog copy was verified with the MCP browser in both languages: headings now go straight to content, no blank gaps or stray margins were left behind, and the destructive confirmation dialogs still show their full warnings.
