#!/usr/bin/env node
/**
 * 「最近更新」数据的过期闸门。
 *
 * 守的是什么:关于页显示的那份数据(`src/pages/about/recentReleases.generated.ts`)
 * 必须与 `release-notes/` 里最新的若干版本**逐字节一致**。没有这道闸门的话,
 * 新增一个版本的发布说明之后忘了重新生成,页面上就会显示**上一个版本的内容** ——
 * 这跟"版本号显示成假的"是同一类错误:界面看起来完全正常,信息却是错的。
 *
 * 实现方式刻意选了"重新生成再比对"而不是"抽查几条":抽查只能证明抽到的对的,
 * 而这里真正的风险是**整体过期**(新增版本没进数据、改了标题没同步)。
 *
 * 用法:node scripts/check-release-history.mjs
 *      不一致就非 0 退出,并打印第一处差异 + 修复命令。
 *
 * 已知局限(写在 docs/verified-invariants.md 里,不要当成"已覆盖"):
 *   · 日期只在**本机能取到 tag** 时被真正核对。CI 的 checkout 默认 fetch-depth 1、
 *     不取 tag,那里的日期一律沿用已提交值 —— 所以"日期写错"只会在本地被抓到。
 *   · 它核对的是"生成结果 == 已提交文件",不判断发布说明本身写得对不对。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORY_LIMIT, buildReleaseHistory } from './lib/releaseHistory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = path.join(ROOT, 'release-notes');
const TARGET = path.join(ROOT, 'src/pages/about/recentReleases.generated.ts');
const RELATIVE = path.relative(ROOT, TARGET).replace(/\\/g, '/');

const committed = readFileSync(TARGET, 'utf8');
const { entries, estimated, source } = buildReleaseHistory({
  notesDir: NOTES_DIR,
  targetFile: TARGET,
  root: ROOT,
  limit: HISTORY_LIMIT
});

/** 日期是从哪来的 —— 只有 "tag" 那部分是**核对过的**,其余是沿用/估算。 */
function dateProvenance() {
  const count = (kind) => entries.filter((entry) => entry.dateSource === kind).length;
  return {
    fromTag: count('tag'),
    reused: count('committed'),
    estimated: count('today')
  };
}

if (committed === source) {
  const dates = dateProvenance();
  console.log(
    `最近更新数据是最新的:${entries.length} 个版本 ` +
      `(v${entries[0]?.version ?? '?'} … v${entries[entries.length - 1]?.version ?? '?'});` +
      `日期:取自 tag ${dates.fromTag} 条 · 沿用已提交值 ${dates.reused} 条 · 按当天 ${dates.estimated} 条。`
  );
  if (dates.fromTag < entries.length) {
    // 说清楚,免得把这一行读成"日期也核对过了":CI 的 checkout 默认不取 tag。
    console.log(
      `注意:只有那 ${dates.fromTag} 条的日期是本次核对过的` +
        `(tag 取不到时只能沿用已提交值或按当天记)—— 见 docs/verified-invariants.md 的已知局限。`
    );
  }
  if (estimated.length > 0) {
    console.log(
      `注意:${estimated.join(', ')} 本机取不到对应 tag,日期先按当天写入 —— ` +
        '打完 tag 再跑一次 `npm run gen:release-history` 即可校准。'
    );
  }
  process.exit(0);
}

console.log(`最近更新数据已过期:${RELATIVE} 与 release-notes/ 不一致。\n`);

const committedLines = committed.split('\n');
const generatedLines = source.split('\n');
const maxLines = Math.max(committedLines.length, generatedLines.length);
let shown = 0;
for (let i = 0; i < maxLines && shown < 5; i += 1) {
  if (committedLines[i] === generatedLines[i]) continue;
  console.log(`  第 ${i + 1} 行不同:`);
  console.log(`    已提交:${(committedLines[i] ?? '(没有这一行)').trim()}`);
  console.log(`    应改为:${(generatedLines[i] ?? '(没有这一行)').trim()}`);
  shown += 1;
}

console.log('\n修复:node scripts/generate-release-history.mjs');
process.exit(1);
