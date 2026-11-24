#!/usr/bin/env node
/**
 * 闸门:store 里声明的公开方法,必须**在别处被提到过**。
 *
 * 起因是两个已修的真问题,长得一模一样:
 *   · 分类学习:suggestCategoryByLearning / recordCategoryCorrection / undoLatestCategoryLearning
 *     是空壳(返回 null / noop / false),而且**在 store 之外一次都没被提到**;
 *   · 主题色:setAccentTheme 没人用,而 App.tsx 把 data-accent-theme 写死成 'amber'。
 *
 * 这类问题**类型检查全过、测试也全过**,因为它"存在"。
 *
 * 判据刻意**取得很宽**:只要这个名字在 store 之外(非测试代码里)出现过一次就算"有人用"。
 * 宽的好处是**零误报** —— 我先试过「必须出现 `.name(`」,结果 27 个全是误报:
 * 组件里常写成 `const foo = useStore(s => s.foo)`(取值时不带括号)或解构调用。
 * 而这条宽规则恰好能抓住那两个真问题 —— 它们当时在 store 之外**一次都没被提及**。
 *
 * 用法:node scripts/check-orphan-store-methods.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STORES = [
  'src/shared/store/useFinanceStore.ts',
  'src/shared/store/useAppPreferences.ts',
  'src/shared/store/useSmartBudgetStore.ts',
  'src/shared/store/useGlobalMemoryStore.ts',
  'src/shared/store/useAiSettings.ts'
];

/** 豁免:确实只在 store 内部使用、但**有理由**的方法。理由必须写清楚。 */
const ALLOW = new Map([]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const sources = new Map(
  walk(path.join(ROOT, 'src')).map((file) => [
    path.relative(ROOT, file).split(path.sep).join('/'),
    readFileSync(file, 'utf8')
  ])
);

const orphans = [];

for (const store of STORES) {
  const text = sources.get(store);
  if (!text) continue;

  const declared = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s{2}([\w$]+):\s*\(/.exec(line);
    if (match) declared.add(match[1]);
  }

  for (const name of declared) {
    if (ALLOW.has(store + '::' + name)) continue;

    let mentions = 0;
    const wordRe = new RegExp('\\b' + name + '\\b', 'g');
    for (const [rel, src] of sources) {
      // 测试里提到不算"接上"(测试可以为了测空壳而调用它)
      if (/\.test\.(ts|tsx)$/.test(rel)) continue;
      const found = src.match(wordRe);
      if (!found) continue;
      // store 自身里扣掉接口声明那一处
      mentions += rel === store ? Math.max(0, found.length - 1) : found.length;
    }

    if (mentions === 0) orphans.push({ store, name });
  }
}

if (orphans.length === 0) {
  console.log('store 公开方法检查通过:声明的每个方法都在别处被用到过。');
  process.exit(0);
}

console.log('以下 store 公开方法在 store 之外**一次都没被提到** —— 多半是功能没接上:');
for (const item of orphans) {
  console.log('  ✗ ' + item.store.replace('src/shared/store/', '') + ' → ' + item.name);
}
console.log('\n要么把它接上,要么删掉;确实要先留着,请在脚本的 ALLOW 里写明理由。');
process.exit(1);