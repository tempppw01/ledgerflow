#!/usr/bin/env node
/**
 * 生成关于页「最近更新」的数据模块。
 *
 * 输入:`release-notes/RELEASE_NOTES_v*.md`(最近 10 个版本)
 * 输出:`src/pages/about/recentReleases.generated.ts`(**这个文件要一起提交**)
 *
 * 用法:
 *   node scripts/generate-release-history.mjs            # 写文件
 *   node scripts/generate-release-history.mjs --dry-run  # 只打印,不写
 *
 * 什么时候要跑:**新增 / 修改发布说明之后**。发布流程里就是在写完
 * `RELEASE_NOTES_v<version>.md` 之后、提交之前跑一次(见 docs/release-process.md)。
 * 忘了跑不会静默过去 —— `npm run check:release-history`(CI 里跑)会非 0 退出。
 *
 * 为什么不是"运行时读文件":见 scripts/lib/releaseHistory.mjs 头部注释。
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORY_LIMIT, buildReleaseHistory } from './lib/releaseHistory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTES_DIR = path.join(ROOT, 'release-notes');
const TARGET = path.join(ROOT, 'src/pages/about/recentReleases.generated.ts');

const dryRun = process.argv.includes('--dry-run');
const { entries, estimated, source } = buildReleaseHistory({
  notesDir: NOTES_DIR,
  targetFile: TARGET,
  root: ROOT,
  limit: HISTORY_LIMIT
});

if (dryRun) {
  process.stdout.write(source);
} else {
  writeFileSync(TARGET, source, 'utf8');
  console.log(
    `已写入 ${path.relative(ROOT, TARGET).replace(/\\/g, '/')}:` +
      `${entries.length} 个版本(${entries
        .map((entry) => `v${entry.version}${entry.publishedOn ? `@${entry.publishedOn}` : '@?'}`)
        .join(', ')})`
  );
  if (estimated.length > 0) {
    // 不是错误:发布流程就是「先写说明、后打 tag」,生成时最新一条还没有 tag。
    console.log(
      `注意:${estimated.join(', ')} 没有对应 tag(或本机取不到 tag),日期先按当天写入 —— ` +
        '打完 tag 再跑一次本脚本即可校准。'
    );
  }
}
