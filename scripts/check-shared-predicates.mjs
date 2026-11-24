#!/usr/bin/env node
/**
 * 「共享谓词」闸门:禁止在别处重新手写已经被共享出来的判断。
 *
 * 为什么需要它:这些判断曾经在仓库里被手写了很多遍 —— 手写不会立刻出错,但会慢慢走形。
 * 已经出过一次真事故:财务分析的「资金动态看板」按月汇总时只对 `type === 'expense'` 求和、
 * 忘了排除退款,于是同一页上页头(走 summarizeTransactions)是净额、卡片是
 * 「净额 + 2×退款」,演示账本 11 月因此多算 ¥781.10。
 *
 * 目前守三条(都对应 src/shared 里的唯一真源):
 *   1. 退款/冲正判断  → isTransactionRefundLike       (src/shared/lib/transactionMetrics.ts)
 *   2. 是否计入余额的状态 → isBalanceAffectingStatus  (src/shared/lib/localDate.ts)
 *   3. 金额取整      → roundMoney                     (src/shared/lib/money.ts)
 *
 * 刻意不检查的地方(都有理由,不是漏网):
 *   · 谓词自身的实现文件 —— 那是唯一真源;
 *   · 测试文件 —— 测试必须自己把条件写一遍才有意义:如果断言也用实现里的谓词,
 *     谓词写错了测试会跟着一起错,等于没测;
 *   · 本脚本 —— 上面这些说明里就写着那些模式。
 *
 * 另外不拦「从 adjustmentKind 里取标签」(`refund ? '退款' : '冲正'`):它只出现在
 * 「已知是退款类」的分支里,不会与谓词走形。债务生命周期的 settled/closed/paused
 * 是另一套状态,也不属于这条。
 *
 * 2026-11-25 把范围从 src + scripts 扩到**也含 server**:服务端是 JS,而三个真源都在 src 里
 * 且是 TS —— 它 **import 不了**,所以服务端是最容易长出"第二份判断"的地方。加宽后跑过一遍:
 * **0 命中**,于是留着。万一将来这里真的报出命中,先想清楚那是不是"重复实现"还是"服务端
 * 确实复制了一份必须存在的逻辑"——前者照常改,后者应当在 ALLOW 里写明理由。
 *
 * 用法:
 *   node scripts/check-shared-predicates.mjs          # 有命中就非 0 退出
 *   node scripts/check-shared-predicates.mjs --list   # 只列出来,不失败
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-shared-predicates.mjs';
const args = new Set(process.argv.slice(2));

const REFUND_WHY = '手写「退款/冲正」谓词 —— 请改用 isTransactionRefundLike(tx)';
const STATUS_WHY = '手写「是否计入余额的状态」—— 请改用 isBalanceAffectingStatus(tx.status)';

/** 每一行(与下一行拼起来看)逐个匹配。 */
const CHECKS = [
  {
    name: 'refund',
    why: REFUND_WHY,
    test: (window) =>
      /adjustmentKind\s*===\s*'refund'[\s\S]{0,80}adjustmentKind\s*===\s*'reversal'/.test(window) ||
      /adjustmentKind\s*===\s*'reversal'[\s\S]{0,80}adjustmentKind\s*===\s*'refund'/.test(window)
  },
  {
    name: 'status',
    why: STATUS_WHY,
    // 一行里同时比对了两个以上的交易状态,基本就是把 ans 计入余额的规则抄了一遍。
    test: (window) => {
      const matches = ['pending', 'closed', 'failed'].filter((status) =>
        new RegExp(`status\\s*[!=]==?\\s*'${status}'`).test(window)
      );
      return matches.length >= 2;
    }
  }
];

/**
 * 「定义级」检查:不许在别处重新定义同名的共享助手。
 * 这类问题最阴的地方是**名字一样**:读代码的人看到 roundMoney(...) 会以为它就是
 * money.ts 里那套(带 EPSILON 修正、且把 -0 归一),实际却可能是另一套算法。
 * 实测两套在 1.005 / 2.675 / 0.615 / -1.005 上给出不同结果(toFixed 甚至会把
 * 1.01 输出成 1)。
 */
const DEFINITION_CHECKS = [
  {
    re: /^\s*(?:export\s+)?function\s+(roundMoney|roundCurrency)\s*\(/,
    why: '本地重新定义了共享的金额取整 —— 请 import { roundMoney } from 共享库'
  },
  {
    /*
     * 支出口径:transactionMetrics.isExpenseLike 与 dashboard/model/utils.isActualExpenseType
     * 在 2026-11-24 已**统一**(都是支出+还款,预算型不算),但仍是两个名字、两处定义 ——
     * 所以既不许再抄第三份(financial-analysis 里曾有一份完全相同的本地副本),
     * 改其中一个时也要想到另一个。
     */
    re: /^\s*(?:export\s+)?function\s+(isExpenseLike|isActualExpenseType)\s*\(/,
    why: '本地重新定义了支出口径 —— 请 import 共享的 isExpenseLike / isActualExpenseType'
  }
];

/** 整份文件豁免,理由必须写清。 */
const SKIP_FILES = new Map([
  ['src/shared/lib/transactionMetrics.ts', 'isTransactionRefundLike 自身的实现,唯一真源'],
  ['src/shared/lib/localDate.ts', 'isBalanceAffectingStatus 自身的实现,唯一真源'],
  ['src/shared/lib/money.ts', 'roundMoney 自身的实现,唯一真源'],
  [SELF, '本脚本的说明文字里就含这些模式']
]);

/**
 * 豁免:按「文件 + 那一行的内容」匹配,**不要用行号**。
 * 行号会随任何无关改动漂移 —— 第一版就是这么写的,一次注释插入就让三条豁免全部失效、
 * 闸门误报。内容匹配则稳:真要改这一行时也会被注意到是否还需要豁免。
 */
const ALLOW = new Map([
  [
    "src/features/dashboard/model/utils.ts||export function isActualExpenseType(type: 'expense' | 'income' | 'budget' | 'repayment'): boolean {",
    /*
     * 有意并存的两个名字:isActualExpenseType(首页多处按它读)与 shared 的 isExpenseLike,
     * 判定**完全相同**(支出 + 还款)—— 「预算」型不算支出是 v0.50.36 的定案。
     * 改任一处都要同时改另一处,而 src/shared/lib/expenseScope.contract.test.ts 钉着它们必须一致。
     *
     * 这条以前**没被检查**:该文件的注释里提到了 isExpenseLike,而旧判据是"全文出现共享名就放行",
     * 于是注释把检查压掉了(这个文件自己的注释还写着"check:shared-predicates 会盯着这两个名字" ——
     * 在 2026-11-25 剥掉注释之后才算真的兑现)。
     */
  ],
  [
    "src/shared/store/useFinanceStore.ts|tx.adjustmentKind === 'normal' |||tx.adjustmentKind === 'refund' ||",
    'normalizeAdjustmentKind:判断的是「是否已是三种已知 kind 之一」(含 normal),不是退款判断'
  ],
  [
    'src/shared/store/useFinanceStore.ts||function roundCurrency(raw: number): number {',
    'roundCurrency 只是交给 roundMoney 的薄别名(历史调用点多),算法本身没有第二份'
  ],
  [
    "src/pages/assistant/AssistantPage.tsx|const repaymentTodoCount = validRows.filter(|(item) => item.type === 'repayment' && (item.status === 'pending' || item.status === 'failed')",
    '助手待办:统计「待处理/失败」的还款笔数,与「是否计入余额」无关(它本来就是待处理项)'
  ],
  [
    "src/features/dashboard/model/utils.ts|*/|export function isActualExpenseType(type: 'expense' | 'income' | 'budget' | 'repayment'): boolean {",
    'isActualExpenseType 的**唯一真源**。2026-11-24 它已与 isExpenseLike 统一为「实际花掉」(预算型两边都不算),保留这个名字是因为首页多处按它读'
  ]
]);

/**
 * 豁免键:文件 + 上一行 + 本行(都去掉缩进)。
 * 带上上一行是为了精确 —— 只看本行的话,同一文件里再出现一模一样的一行会被连带豁免。
 */
function allowKey(rel, lines, at) {
  const current = (lines[at] || '').trim();
  const previous = at > 0 ? (lines[at - 1] || '').trim() : '';
  return rel + '|' + previous + '|' + current;
}

function isSkipped(rel) {
  if (SKIP_FILES.has(rel)) return true;
  return /\.test\.(ts|tsx)$/.test(rel);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * 把注释内容替换成空格,**保留换行**(行号不能变 —— ALLOW 是按行号/上下文匹配的)。
 *
 * 只处理两种注释:行注释 `//` 与块注释。字符串里的 `//`(比如 URL)会被误伤,但那只会让
 * 更少的文本参与匹配,不会制造误报;而这个脚本要匹配的都是 `adjustmentKind === 'refund'`
 * 这类代码片段,不会出现在字符串里。
 */
function stripComments(source) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => blank(match))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + blank(match.slice(prefix.length)));
}

const hits = [];
for (const file of walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'scripts')), walk(path.join(ROOT, 'server')))) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (isSkipped(rel)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  /*
   * 匹配前先把注释换成空白(保留行数,行号不变)。
   *
   * 为什么必须这么做:这条判据原本是「文件里有单边 refund 判断,且全文没有出现
   * isTransactionRefundLike」—— 而"出现"包括**注释里的提及**。于是只要写一句
   * 「这里应该改用共享的 isTransactionRefundLike(tx)」再照旧手写一遍判断,闸门就放行了。
   * 2026-11-25 实测确认过:同样两处违规,注释里提到共享名 -> exit 0;不提 -> exit 1。
   * 判据的本意是"作者**用**了共享谓词",不是"作者**知道**它"。剥掉注释之后,只剩真正的
   * 代码参与匹配 —— 注释既不能触发误报,也不能压制检查。
   */
  text = stripComments(text);
  const lines = text.split(/\r?\n/);
  // 文件级:整份文件里手写了单边「退款」判断,却没有引用共享谓词。
  /*
   * 为什么单独立一条:成对写法(refund 与 reversal 都判)能被下面的窗口规则抓到,
   * 但**单边**写法(tx.adjustmentKind !== 'refund')抓不到 —— 它看起来完全正常,
   * 只是漏了冲正。助手页的「平均支出 / 异常大额」就是这么漏的:冲正被当成一笔正常支出,
   * 把平均值和「异常大额」阈值一起抬高。
   *
   * 判据刻意收得很紧:只有**文件里根本没引用 isTransactionRefundLike** 时才报 ——
   * 引用了就说明作者知道共享谓词的存在。这样当前零命中,纯粹用于防第五处。
   */
  if (
    /adjustmentKind\s*[!=]==?\s*'refund'/.test(text) &&
    !/isTransactionRefundLike/.test(text)
  ) {
    const at = lines.findIndex((line) => /adjustmentKind\s*[!=]==?\s*'refund'/.test(line));
    hits.push({
      key: rel + ':' + (at + 1),
      allowKey: allowKey(rel, lines, at),
      why: "单边判断了 adjustmentKind === 'refund',却没引用共享的 isTransactionRefundLike(tx) —— 会漏掉冲正(reversal)"
    });
  }
  for (let index = 0; index < lines.length; index += 1) {
    const pair = lines.slice(index, index + 2);
    const window = pair.join(' ');
    // 定义级:直接看每一行,不拼窗口。
    const definition = DEFINITION_CHECKS.find((check) => check.re.test(lines[index]));
    if (definition) {
      if (!ALLOW.has(allowKey(rel, lines, index))) {
        hits.push({
        key: rel + ':' + (index + 1),
        allowKey: allowKey(rel, lines, index),
        why: definition.why
      });
      }
      continue;
    }

    const hit = CHECKS.find((check) => check.test(window));
    if (!hit) continue;
    // 报「真正写着比较的那一行」,而不是两行窗口的起点 —— 人按这个行号去 grep 才找得到。
    const offset = pair.findIndex((line) => /adjustmentKind|\.status/.test(line));
    const at = index + (offset === -1 ? 0 : offset);
    const key = rel + ':' + (at + 1);
    if (!ALLOW.has(allowKey(rel, lines, at))) {
      hits.push({ key, allowKey: allowKey(rel, lines, at), why: hit.why });
    }
    // 命中后跳过下一行:同一个写法会被相邻两次窗口各命中一次。
    index += 1;
  }
}

if (hits.length === 0) {
  console.log(
    '共享谓词检查通过:没有手写的「退款/冲正」「是否计入余额的状态」判断,没有本地重定义的金额取整,也没有重复定义的支出口径(isExpenseLike / isActualExpenseType)。'
  );
  process.exit(0);
}

console.log('发现 ' + hits.length + ' 处重复实现:');
for (const hit of hits) {
  console.log('  ' + hit.key + '\n    ' + hit.why);
  console.log('    · 若确属例外,加入豁免: ' + JSON.stringify(hit.allowKey));
}
if (args.has('--list')) process.exit(0);
process.exit(1);
