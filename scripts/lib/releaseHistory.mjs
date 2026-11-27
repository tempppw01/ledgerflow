/**
 * 「最近更新」数据的抽取逻辑(release-notes → 前端可用的结构化记录)。
 *
 * 为什么要有这个东西:`release-notes/` 里已有 116 个版本的说明,但它们
 *   · **不在 Docker 的构建上下文里**(`.dockerignore` 排除了 `release-notes/`),
 *     所以前端**不能** `import` 那些 markdown;
 *   · 而且它们是**中文散文**,不是能直接渲染的数据。
 *
 * 所以做成一件事:**在提交时把最近的若干版本抽成一份 TS 数据模块并提交**
 * (`src/pages/about/recentReleases.generated.ts`),运行时不读文件、不发请求。
 * 这跟 `scripts/generate-changelog.mjs` → `CHANGELOG.md` 是同一个套路,
 * 区别只在于产物要在浏览器里渲染,所以必须是 TS 而不是 markdown。
 *
 * 抽取规则(全部可复现,**没有**任何"大概意思"的加工):
 *
 *   version     文件名里的 `v<major>.<minor>.<patch>`
 *   title       第一个 `## ` 行(去掉 markdown 标记)—— 就是发布说明的一句话标题
 *   summary     标题之后**第一段散文**(跳过标题/表格/列表/引用/代码块),
 *               去掉行内 markdown 与换行;超过 150 字时整句截断(见 clampSummary)
 *   publishedOn tag 的创建日期(YYYY-MM-DD);取不到就沿用已提交的值,
 *               再取不到才用当天日期(见 resolvePublishedOn)
 *
 * 关于日期的取舍:发布流程是「写说明 → 提交 → 打 tag」,**生成数据时 tag 还不存在**,
 * 所以最新一条的日期只能是当天;打 tag 之后重跑一次就会校准成 tag 的真实日期。
 * CI 的 checkout 默认不取 tag(fetch-depth 1),因此那里的日期一律沿用已提交值 —— 
 * 也就是说**日期漂移只会在本地被抓到**,这一点写在 docs/verified-invariants.md 里。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** 数据里保留多少个版本。 */
export const HISTORY_LIMIT = 10;

/** 摘要上限(字符)。超长时按整句截断,宁可短也不要半句话。 */
export const SUMMARY_MAX = 150;

const NOTE_FILE_RE = /^RELEASE_NOTES_v(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.md$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 行内 markdown 去掉,只留文字。 */
function inlineText(text) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 这些行属于"另一块内容",不是散文段落。 */
function blockKind(line) {
  const trimmed = line.trim();
  if (trimmed === '') return 'blank';
  if (/^#{1,6}\s/.test(trimmed)) return 'heading';
  if (/^\|/.test(trimmed)) return 'table';
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) return 'list';
  if (/^\s*>/.test(line)) return 'quote';
  if (/^\s*```/.test(line)) return 'fence';
  if (/^\s*!\[/.test(trimmed)) return 'image';
  return null;
}

/** 跳过空行,看后面紧跟的是不是"非散文"的块(表格/列表/引用/代码)。 */
function nextBlockKind(lines, from) {
  for (let i = from; i < lines.length; i += 1) {
    const kind = blockKind(lines[i]);
    if (kind === 'blank') continue;
    return kind;
  }
  return null;
}

/** 标题之后第一段散文:跳过标题/表格/列表/引用/代码块,遇到空行结束。 */
function firstParagraph(lines, startIndex) {
  const collected = [];
  let inFence = false;
  let continues = false;
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    const kind = blockKind(line);
    if (kind === 'fence') {
      inFence = !inFence;
      if (collected.length > 0) {
        continues = true;
        break;
      }
      continue;
    }
    if (inFence) continue;
    if (kind === 'blank') {
      if (collected.length > 0) {
        // 段落后面紧跟表格/列表/引用 = 这句话只是"引子",没说完就断了。
        continues = nextBlockKind(lines, i + 1) !== null;
        break;
      }
      continue;
    }
    if (kind !== null) {
      if (collected.length > 0) {
        continues = true;
        break;
      }
      continue;
    }
    collected.push(line.trim());
  }
  return { text: collected.join('\n'), continues };
}

const LATIN_EDGE = /[A-Za-z0-9)\]]$/;
const LATIN_START = /^[A-Za-z0-9([]/;

/**
 * 把 markdown 的硬换行拼回一行。
 *
 * 这些发布说明是**按中文硬换行**写的,原来直接 `join(' ')` 会在中文标点后面留一个空格
 * (实测过:"…还有多久结束、 下一段…")。所以只在两侧都是拉丁字符时才补空格 ——
 * 中文与中文、中文与拉丁之间都不需要空格。
 */
function joinWrappedLines(raw) {
  const parts = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  let out = '';
  for (const part of parts) {
    if (out === '') {
      out = part;
      continue;
    }
    out += LATIN_EDGE.test(out) && LATIN_START.test(part) ? ` ${part}` : part;
  }
  return out;
}

/** 段落被截断或被后续块打断时,收尾要诚实:该省略就省略,别留一个悬空的冒号。 */
function tidyEnd(text, continues) {
  // 结尾是冒号的,后面接着的要么是表格/列表(已经断在别处),要么是下一段 —— 两种情况都没说完。
  const dangling = /[:：]\s*$/.test(text);
  const out = text.replace(/[\s:：]+$/, '');
  if ((continues || dangling) && !/[。!?!!??…]$/.test(out)) return `${out}…`;
  return out;
}

/** 超长摘要按整句截断;半句都不完整时(没有合适句末)才硬切并加省略号。 */
export function clampSummary(text, max = SUMMARY_MAX) {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  let cut = -1;
  for (const mark of ['。', '!', '?', '!', '?', ';', ';']) {
    const index = window.lastIndexOf(mark);
    if (index > cut) cut = index;
  }
  // 句末落在前半段的话,截出来会短得没信息量,不如硬切。
  if (cut >= Math.floor(max / 2)) return window.slice(0, cut + 1);
  return `${window.trimEnd()}…`;
}

/** 从发布说明正文里抽 title / summary。 */
export function parseReleaseNote(version, text) {
  const lines = text.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^##\s+\S/.test(line));
  const rawTitle = titleIndex === -1 ? '' : lines[titleIndex].replace(/^#+\s*/, '');
  const title = inlineText(rawTitle);
  const { text: paragraph, continues } = firstParagraph(lines, titleIndex + 1);
  const summary = clampSummary(tidyEnd(inlineText(joinWrappedLines(paragraph)), continues));
  return { version, title, summary };
}

function versionParts(version) {
  return version.split('.').map((part) => Number(part) || 0);
}

/** 版本号倒序(数字比,不是字符串比:0.50.9 要排在 0.50.10 后面)。 */
export function compareVersionDesc(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return right[i] - left[i];
  }
  return 0;
}

/** 列出目录里全部版本说明,按版本倒序。 */
export function listReleaseNotes(notesDir) {
  return readdirSync(notesDir)
    .map((file) => {
      const match = NOTE_FILE_RE.exec(file);
      if (!match) return null;
      const version = `${match[1]}.${match[2]}.${match[3]}`;
      return { version, file, text: readFileSync(path.join(notesDir, file), 'utf8') };
    })
    .filter(Boolean)
    .sort((a, b) => compareVersionDesc(a.version, b.version));
}

/** 全部 tag 的创建日期。取不到 git(浅克隆)时返回空 Map。 */
export function readTagDates(root) {
  const dates = new Map();
  let output = '';
  try {
    output = execFileSync(
      'git',
      ['for-each-ref', '--format=%(refname:short) %(creatordate:short)', 'refs/tags'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch {
    return dates;
  }
  for (const line of output.split('\n')) {
    const [tag, date] = line.trim().split(/\s+/);
    const match = /^v(\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(tag || '');
    if (match && DATE_RE.test(date || '')) dates.set(match[1], date);
  }
  return dates;
}

/** 从**已提交**的数据模块里读出 version → publishedOn,作为取不到 tag 时的兜底。 */
export function readCommittedDates(source) {
  const dates = new Map();
  if (!source) return dates;
  const entryRe = /version: '([^']+)',\s*\n\s*publishedOn: (?:'([^']+)'|null)/g;
  for (const match of source.matchAll(entryRe)) {
    dates.set(match[1], match[2] || null);
  }
  return dates;
}

function localToday(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 组装要写进数据模块的条目。
 *
 * 日期优先 tag → 已提交值 → 当天,并回报每一条的来源,免得"看着有日期"其实全是兜底。
 */
export function collectReleaseHistory({ notesDir, tagDates, committedDates, limit = HISTORY_LIMIT, now } = {}) {
  const notes = listReleaseNotes(notesDir).slice(0, limit);
  const entries = [];
  const estimated = [];
  for (const note of notes) {
    const { version, title, summary } = parseReleaseNote(note.version, note.text);
    let publishedOn = tagDates?.get(version) || null;
    let source = publishedOn ? 'tag' : null;
    if (!publishedOn) {
      const committed = committedDates?.get(version) || null;
      if (committed) {
        publishedOn = committed;
        source = 'committed';
      } else {
        publishedOn = localToday(now);
        source = 'today';
        estimated.push(version);
      }
    }
    entries.push({ version, publishedOn, title, summary, dateSource: source });
  }
  return { entries, estimated };
}

function tsString(value) {
  const text = String(value);
  const single = (text.match(/'/g) || []).length;
  const double = (text.match(/"/g) || []).length;
  // 跟 prettier 的取舍一致:引号少的那种才少转义。
  if (single > double) return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * 渲染数据模块源码。
 *
 * 注意:**输出就是提交进仓库的那份文件**,`check-release-history.mjs` 逐字节比对,
 * 所以这里不能有任何"大概一样"的地方(时间戳、随机顺序、平台相关的换行都不行)。
 */
export function renderReleaseHistoryModule(entries, limit = HISTORY_LIMIT) {
  const body = entries.map((entry) => {
    const lines = [
      '  {',
      `    version: ${tsString(entry.version)},`,
      `    publishedOn: ${entry.publishedOn ? tsString(entry.publishedOn) : 'null'},`,
      `    title: ${tsString(entry.title)},`,
      `    summary: ${tsString(entry.summary)}`,
      '  }'
    ];
    return lines.join('\n');
  });

  return `/**
 * 关于页「最近更新」用的数据 —— **由脚本生成,不要手改**。
 *
 * 生成:node scripts/generate-release-history.mjs
 * 核对:node scripts/check-release-history.mjs(CI 里跑;与 release-notes 不一致就非 0 退出)
 *
 * 为什么是生成的文件、而不是运行时去读或去请求:
 *   · \`release-notes/\` 被 .dockerignore 排除,镜像里没有这些 markdown,前端 import 不到;
 *   · 运行时请求 GitHub API 会引入网络依赖与限流(关于页的"检查更新"是用户主动点的,
 *     这里不该变成每次打开页面都打一次外部接口)。
 * 抽取规则与取舍写在 scripts/lib/releaseHistory.mjs 的头部注释里。
 */

export interface ReleaseHistoryEntry {
  /** 版本号,与 package.json 的 version、tag 去掉 \`v\` 之后一致 */
  readonly version: string;
  /** 该版本的发布日期(YYYY-MM-DD);取不到时是 null */
  readonly publishedOn: string | null;
  /** 发布说明标题(第一个 \`## \` 行) */
  readonly title: string;
  /** 发布说明正文的第一段,超过 ${SUMMARY_MAX} 字按整句截断 */
  readonly summary: string;
}

/** 数据里保留的版本数,兜底测试与文档引用它。 */
export const RELEASE_HISTORY_LIMIT = ${limit};

/**
 * 最近的 ${entries.length} 个版本,新的在前。
 *
 * prettier-ignore:这一段是生成出来的,逐字节就是提交进仓库的内容
 * (check-release-history.mjs 按原文比对),所以不要让格式化器改动它。
 */
// prettier-ignore
export const RELEASE_HISTORY: readonly ReleaseHistoryEntry[] = [
${body.join(',\n')}
];
`;
}

/**
 * 读 release-notes + 已有数据模块,产出「应该提交的那份源码」。
 *
 * 生成器与过期闸门共用这一个函数 —— 两边的抽取规则必须**完全**是同一份,
 * 否则闸门会一直红,而人只好顺手改数据,那闸门就废了。
 */
export function buildReleaseHistory({ notesDir, targetFile, root, limit = HISTORY_LIMIT }) {
  const existing = targetFile && existsSync(targetFile) ? readFileSync(targetFile, 'utf8') : '';
  const { entries, estimated } = collectReleaseHistory({
    notesDir,
    tagDates: readTagDates(root || path.dirname(notesDir)),
    committedDates: readCommittedDates(existing),
    limit
  });
  return { entries, estimated, source: renderReleaseHistoryModule(entries, limit) };
}

export { localToday };
