# LedgerFlow v0.10.0

## Highlights

Subscription management now shows the real brand for each subscription. Previously the subscription list had no logo at all and the template picker used one hand-drawn grey glyph for everything, so Netflix, Apple Music and iCloud were visually indistinguishable from a phone bill.

- **77 brands bundled offline.** Brand marks come from [Simple Icons](https://simpleicons.org) (CC0 1.0) and are generated into `src/features/subscriptions/model/brandMarks.ts` by `scripts/generate-brand-icons.mjs`. Nothing is requested at runtime — no favicon service, no CDN — so the logos still render in an offline or intranet deployment. Only the brands that are actually useful for subscriptions are bundled rather than the full 3,000+ icon set, and the module lands in the lazily-loaded `SubscriptionsPage` chunk, so visitors who never open the page never download it.
- **Brands that no icon set covers fall back to a colour + wordmark tile, not an invented logo.** China Mobile, China Unicom, China Telecom, iQIYI, Youku, Tencent Video, QQ Music, Kugou, Baidu Netdisk, Xunlei, WPS, Disney+, Microsoft 365, Adobe, JD and Pinduoduo are not in Simple Icons; these render as a tile in the brand's own colour with a short label instead of a hand-drawn approximation.
- **Matching prefers the specific brand over the parent brand.** `Apple Music` resolves to Apple Music rather than Apple, `QQ 音乐` to QQ Music rather than QQ, `百度网盘` to Baidu Netdisk rather than Baidu. The order of the generated table carries that priority and is now asserted by tests, so a future regeneration cannot silently swap them.
- **Unknown services keep the old generic icon**, so a subscription is never mislabelled with someone else's brand.
- The same logo appears in the "从常用模板开始" template list, which previously used the hand-drawn glyphs for every entry.

Also included in this version line (shipped in the interim `v0.9.12` patch, summarised here because they belong to the same body of work):

- **Login device IP is now recorded and displayed.** Every session stores the source address it was created from (`auth_sessions.client_ip`, schema migration v5) and the device list under Settings → Account shows `登录 IP`. Addresses are normalised from `x-real-ip` / the first `X-Forwarded-For` hop / the socket peer, including `host:port`, `[ipv6]:port`, `::ffff:` mapped and zone suffixes; anything that is not a usable address is stored as empty rather than writing a raw header into the database. Sessions that predate the column are backfilled once on their next request and are never overwritten afterwards.
- **Three visible defects fixed**: the asset/liability forecast range buttons leaked the raw i18n key `dashboard.ui.simulation.horizonMonths` four times; the dashboard calendar's month-start cell was 5px narrower than its column and its "12月" tag covered the day number; the transactions table showed a descending-sort icon on the Amount column even when the table was not sorted by amount.
- **`npm run i18n:check`** now audits the whole `src` tree in both languages. The previous Python checker covered 16 hand-written files and its regular expressions were broken, so it reported "0 missing" while raw keys were reaching the UI.

## Upgrade notes

- No manual migration is required. The only schema change is the additive `auth_sessions.client_ip` column (relational schema version 4 → 5), applied automatically on the next request after upgrading.
- Sessions created before the upgrade show `未记录` for the IP until they are used again; that is expected, and other devices' sessions are deliberately not filled with the current device's address.
- Keep persistent SQLite and account data mounted at `/app/data` for Docker deployments.
- Existing ledgers, subscription records, investment data and account sessions remain compatible.

## Validation

- `npx tsc --noEmit`
- `npm run lint`
- `npx vitest run` — 94 files / 712 tests
- `npm run i18n:check` — 0 missing keys, zh/en key sets identical
- `npx vite build` — brand marks confirmed present only in `SubscriptionsPage-*.js`
- Verified with the MCP browser at 1440×900 and 390×844: subscription cards and the template list render the correct brand for Spotify / China Mobile / iCloud / Apple One / Apple Music / Netflix, unknown templates still fall back to the generic icon, and no horizontal overflow is introduced on mobile.
