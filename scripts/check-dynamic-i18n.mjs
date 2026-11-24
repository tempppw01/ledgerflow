#!/usr/bin/env node
/**
 * 核对**动态拼出来的 i18n 键**是否都存在。
 *
 * 静态检查(i18n:check)能查 `t('a.b')` 这种字面量,但查不到拼接:
 *   t(`dataSync.${notice.kind}`) / t(`dataSync.${error}`) / t(`recycleBin.kinds.${kind}`)
 * 一旦某个分支的键漏了,**只有走到那个罕见状态**时界面上才会露出原始 key —— 平时完全看不见。
 *
 * 候选键不是手写列表,而是**从代码里推导**:解析 SyncNotice 的类型联合(以及错误态那两个值),
 * 所以新增一个 kind 时会自动被核对,列表不会腐烂。
 *
 * 用法:node scripts/check-dynamic-i18n.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATE = path.join(ROOT, 'src/features/database-provider/ui/SqlDataSyncGate.tsx');
const ZH = path.join(ROOT, 'src/i18n/locales/zh/translation.json');
const EN = path.join(ROOT, 'src/i18n/locales/en/translation.json');

const zh = JSON.parse(readFileSync(ZH, 'utf8'));
const en = JSON.parse(readFileSync(EN, 'utf8'));

function has(tree, key) {
  let node = tree;
  for (const part of key.split('.')) {
    if (node === null || node === undefined) return false;
    node = node[part];
  }
  return node !== undefined && node !== null;
}

/** 从 SyncNotice 类型联合里取所有 kind。
 *  注意:不能用 `;` 结尾 —— 联合里每个成员都带分号(`{ kind: 'x'; detail: string }`),
 *  用分号截断只会拿到前两个。这里截到空行为止。 */
const gateSource = readFileSync(GATE, 'utf8').replace(/\r\n/g, '\n');
const noticeTypeMatch = gateSource.match(/type SyncNotice =([\s\S]*?)\n\n/);
if (!noticeTypeMatch) throw new Error('找不到 SyncNotice 类型定义');
const kinds = [...new Set([...noticeTypeMatch[1].matchAll(/kind:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]))];

/** 错误态:`t(`dataSync.${error}`)`,取值见 error 的联合类型。 */
const errorTypeMatch = gateSource.match(/setError: React\.Dispatch<React\.SetStateAction<([^>]+)>>/) ||
  gateSource.match(/const \[error, setError\] = useState<([^>]+)>/);
const errors = errorTypeMatch
  ? [...new Set([...errorTypeMatch[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]))]
  : ['readFailed', 'initFailed'];

const candidates = [
  ...kinds.map((kind) => 'dataSync.' + kind),
  ...errors.map((value) => 'dataSync.' + value),
  // 回收站条目的类型标签:值域来自 entities 里的 kind(fixed 四种)
  'recycleBin.kinds.transaction',
  'recycleBin.kinds.category',
  'recycleBin.kinds.account',
  'recycleBin.kinds.subscription'
];

const missing = candidates.filter((key) => !has(zh, key) || !has(en, key));

console.log('动态 i18n 键:' + candidates.length + ' 个(从代码推导的 kind:' + kinds.length + ')');
if (missing.length === 0) {
  console.log('全部存在(中英都有)。');
  process.exit(0);
}

console.log('\n以下键会被动态拼出来,但语言文件里没有 —— 界面会露出原始 key:');
for (const key of missing) {
  console.log('  ✗ ' + key + ' | zh:' + has(zh, key) + ' en:' + has(en, key));
}
process.exit(1);