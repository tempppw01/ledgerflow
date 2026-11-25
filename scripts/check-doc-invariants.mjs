#!/usr/bin/env node
/**
 * 文档引用体检:docs/verified-invariants.md 里提到的测试文件必须真实存在,表格结构要完整。
 *
 * 为什么需要:那份清单的价值全在「照着它能找到守门的那条测试」。一旦某个测试被改名或删掉,
 * 文档就变成**指向空处的承诺** —— 比没有文档更糟,因为它让人以为有东西守着。
 *
 * 检查两件事:
 *   1. 反引号里出现的 `*.test.ts(x)` / `*.test.js` 都能在仓库里找到(支持 `store/xxx.test.ts` 这种末段简写);
 *   2. 每张表格里各行列数与表头一致(多一列少一列会让渲染错位)。
 *
 * 用法:node scripts/check-doc-invariants.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = path.join(ROOT, 'docs/verified-invariants.md');

if (!existsSync(DOC)) {
  console.error('找不到 docs/verified-invariants.md');
  process.exit(1);
}

const doc = readFileSync(DOC, 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.test\.(ts|tsx|js)$/.test(entry)) {
      out.push(path.relative(ROOT, full).split(path.sep).join('/').toLowerCase());
    }
  }
  return out;
}

const allTests = walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'server')));
const referenced = [
  ...new Set([...doc.matchAll(/`([a-zA-Z0-9_/.-]*\.test\.(?:ts|tsx|js))`/g)].map((match) => match[1]))
];

const missing = referenced.filter((ref) => {
  const needle = ref.toLowerCase();
  return !allTests.some((candidate) => candidate === needle || candidate.endsWith('/' + needle));
});

/**
 * 文档的表格结构检查。
 *
 * 原先只跑在 docs/verified-invariants.md 一份上,而仓库里有 17 份文档 —— 我自己新写的
 * verification-recipes.md 带着表格与代码块,从头到尾没被检查过。现在覆盖全部 docs/*.md。
 *
 * 报错带文件名:不然只有"第 305 行",根本不知道是哪份文档。
 */
function checkTables(rel, lines) {
  const columns = [];
  const fragments = [];
  let headerCols = null;
  let tableStart = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isRow = line.trimStart().startsWith('|');
    if (!isRow) {
      headerCols = null;
      continue;
    }
    /*
     * 表格残块:一行表格行如果是「一块表格的第一行」,它**下面必须紧跟分隔行**(`| --- |`)。
     * 缺分隔行说明这是一段没有表头的残表,Markdown 会把它渲染成纯文本。
     *
     * 这个检查针对我自己犯过的错:把一段说明插进表格中间,后半段表格就悄悄失效了。
     * 旧版只比列数,完全看不出来 —— 而且正文两侧即使留了空行也照样会切断表格,
     * 所以判据要看「有没有表头 + 分隔行」,而不是看上一行是不是正文。
     */
    const previous = (lines[index - 1] || '').trim();
    const startsTableBlock = !previous || !previous.startsWith('|');
    if (startsTableBlock) {
      const separator = (lines[index + 1] || '').trim();
      const hasSeparator = /^\|[\s:|-]+\|$/.test(separator) && separator.includes('-');
      if (!hasSeparator) {
        fragments.push(
          `${rel}:${index + 1} 表格残块(这一行是一块表格的开头,但下一行不是 | --- | 分隔行,后半段会被渲染成纯文本)`
        );
      }
    }
    const cols = line.split('|').length - 2;
    if (headerCols === null) {
      headerCols = cols;
      tableStart = index + 1;
      continue;
    }
    if (cols !== headerCols) {
      columns.push(
        `${rel}:${index + 1}(表格起于第 ${tableStart} 行):期望 ${headerCols} 列,实际 ${cols} 列`
      );
    }
  }

  return { columns, fragments };
}

/** 仓库里所有文档。 */
const DOC_FILES = readdirSync(path.join(ROOT, 'docs'))
  .filter((entry) => entry.endsWith('.md'))
  .sort()
  .map((entry) => 'docs/' + entry);

const columnIssues = [];
const fragmentIssues = [];
for (const rel of DOC_FILES) {
  const result = checkTables(rel, readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/));
  columnIssues.push(...result.columns);
  fragmentIssues.push(...result.fragments);
}

console.log(
  '文档引用的测试文件 ' + referenced.length + ' 个,仓库里共 ' + allTests.length + ' 个测试文件'
);

/**
 * 代码块必须成对:未闭合的 ``` 会把后面整段文档吞成代码块(渲染出来面目全非),
 * 而只看表格列数的检查完全看不到这件事。
 */
const FENCE_FILES = DOC_FILES;
const fenceIssues = [];
for (const rel of FENCE_FILES) {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) continue;
  const count = readFileSync(full, "utf8").split("```").length - 1;
  if (count % 2 !== 0) {
    fenceIssues.push(rel + ": ``` 出现 " + count + " 次(奇数,有未闭合的代码块)");
  }
}

/**
 * 文档里写的 `npm run <script>` 都存在吗?
 *
 * 这个脚本原先只核对"文档引用的测试文件是否存在"。而文档里更常出现的是**命令** ——
 * 命令被改名或删掉时没人会发现,直到有人照着做才失败。
 * 2026-11-25:我自己就在验证配方里把静态闸门数写错过(10 vs 实际 9),说明这类对不上的事真会发生。
 */
const scriptNames = new Set(Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts || {}));
const commandIssues = [];
for (const rel of ['README.md', ...DOC_FILES]) {
  const full = path.join(ROOT, rel);
  if (!existsSync(full)) continue;
  const text = readFileSync(full, 'utf8');
  for (const match of text.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
    if (!scriptNames.has(match[1])) {
      commandIssues.push(`${rel}: npm run ${match[1]} —— package.json 里没有这个脚本`);
    }
  }
}

/**
 * docker-compose.yml 里用到的环境变量,都得在 .env.example 里出现。
 *
 * 为什么:compose 描述"部署时能配什么",.env.example 是"用户照着填什么"。
 * 往 compose 加一个新变量却忘了写进示例,用户根本不知道它存在 —— 这个文件就是给部署者看的。
 * 反向不检查:.env.example 里还有一批 VITE_*(前端构建期)和开发期变量,本来就不经过 compose。
 */
const composeIssues = [];
{
  const composePath = path.join(ROOT, 'docker-compose.yml');
  const examplePath = path.join(ROOT, '.env.example');
  if (existsSync(composePath) && existsSync(examplePath)) {
    const compose = readFileSync(composePath, 'utf8');
    const example = readFileSync(examplePath, 'utf8');

    const composeVars = new Set();
    for (const match of compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)) composeVars.add(match[1]);
    for (const match of compose.matchAll(/^\s{6}([A-Z_][A-Z0-9_]*):/gm)) composeVars.add(match[1]);

    const exampleVars = new Set();
    for (const match of example.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)) exampleVars.add(match[1]);

    for (const name of [...composeVars].sort()) {
      if (!exampleVars.has(name)) {
        composeIssues.push(`${name} —— docker-compose.yml 用到它,但 .env.example 里没有`);
      }
    }
  }
}

if (missing.length === 0 && columnIssues.length === 0 && fragmentIssues.length === 0 && fenceIssues.length === 0 && commandIssues.length === 0 && composeIssues.length === 0) {
  console.log(
    `文档引用体检通过:docs/*.md 共 ${DOC_FILES.length} 份 —— 引用的测试文件全部存在、` +
      '表格列数一致、没有被打断的表格、代码块成对、文档里写的 npm 脚本都存在、' +
      'compose 的环境变量都在 .env.example 里。'
  );
  process.exit(0);
}
if (composeIssues.length > 0) {
  console.log('\ndocker-compose.yml 用到、但 .env.example 没写的环境变量(用户不知道要配它):');
  for (const issue of composeIssues) console.log('  ✗ ' + issue);
}
if (commandIssues.length > 0) {
  console.log('\n文档里写了不存在的 npm 脚本(照着做会失败):');
  for (const issue of commandIssues) console.log('  ✗ ' + issue);
}
if (missing.length > 0) {
  console.log('\n以下引用找不到对应文件(测试改名/删除后忘了同步文档):');
  for (const ref of missing) console.log('  ✗ ' + ref);
}
if (columnIssues.length > 0) {
  console.log('\n表格列数不一致(渲染会错位):');
  for (const issue of columnIssues) console.log('  ✗ ' + issue);
}
if (fenceIssues.length > 0) {
  console.log("\n代码块未闭合(后半段会被渲染成代码):");
  for (const issue of fenceIssues) console.log("  ✗ " + issue);
}
if (fragmentIssues.length > 0) {
  console.log('\n表格被正文从中间切断(后半段会渲染成纯文本):');
  for (const issue of fragmentIssues) console.log('  ✗ ' + issue);
  console.log('\n请把说明挪到整张表之后,表格中间不要夹正文。');
}
process.exit(1);