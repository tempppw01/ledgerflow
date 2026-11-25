#!/usr/bin/env node
/**
 * 发布相关的一致性检查。
 *
 * 两条都是 `docs/release-process.md` 明文要求的,但**没有任何东西在核对**:
 *
 *   1. 改版本号要同时改 `package.json` 与 `src/shared/config/app.ts` 的 `APP_VERSION`。
 *      只改一处时,界面显示的版本号就是假的 —— 而"应用内显示什么版本"正是排查问题时最常被问的。
 *   2. 每个 tag 必须有对应的 `release-notes/RELEASE_NOTES_v<tag>.md`。
 *      缺了的话 release 工作流会失败(它就是靠这个文件建 Release 的)。
 *
 * 用法:node scripts/check-version-sync.mjs
 *      不一致就非 0 退出。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const pkgVersion = String(pkg.version || '');

const appSource = readFileSync(path.join(ROOT, 'src/shared/config/app.ts'), 'utf8');
const appMatch = appSource.match(/export const APP_VERSION\s*=\s*'([^']+)'/);
const appVersion = appMatch ? appMatch[1] : null;

const problems = [];

if (!pkgVersion) {
  problems.push('package.json 里没有 version 字段');
}
if (!appVersion) {
  problems.push("src/shared/config/app.ts 里没找到 `export const APP_VERSION = '...'`");
}
if (pkgVersion && appVersion && pkgVersion !== appVersion) {
  problems.push(
    `版本号不一致:package.json 是 ${pkgVersion},而 APP_VERSION 是 ${appVersion} —— ` +
      '发布流程要求两处一起改(见 docs/release-process.md 第 1 步)'
  );
}

const notesFile = `release-notes/RELEASE_NOTES_v${pkgVersion}.md`;
if (pkgVersion && !existsSync(path.join(ROOT, notesFile))) {
  problems.push(
    `缺少当前版本的发布说明:${notesFile} —— release 工作流靠它建 Release,打 tag 前必须补上`
  );
}

if (problems.length > 0) {
  console.log('发布一致性检查未通过:\n');
  for (const problem of problems) console.log('  ✗ ' + problem);
  process.exit(1);
}

console.log(
  `发布一致性检查通过:版本 ${pkgVersion} 在 package.json 与 APP_VERSION 里一致,` +
    `且 ${notesFile} 存在。`
);