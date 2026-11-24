/**
 * MySQL DATETIME 用的日期字符串:「YYYY-MM-DD HH:MM:SS」(UTC)。
 *
 * 为什么单独成一个模块:`toMysqlDate` 原先在 `authService.js` 与 `relationalDataRepository.js`
 * 里各写了一份,而 `relationalDatabase.js` **用到了却没有定义或 import** —— 那是个真的
 * ReferenceError,而且它落在 **MySQL 迁移路径**上(写「已应用的迁移版本」那一行):
 * 任何 MySQL 用户的首次建库 / 升级都会抛,被 catch 抓住后回滚,迁移直接失败。
 *
 * 为什么这么久没被发现:CI 跑的 `relationalDatabase.test.js` 走的是 SQLite 默认路径,
 * MySQL 迁移那一支没有覆盖;而 `server/` 下的 .js 文件**没有任何静态检查** ——
 * eslint 的 files 只匹配 TS/TSX、tsconfig 也只 include src 目录。
 * 给 server 套上 JS 规则之后,no-undef 立刻把那一行指了出来。
 *
 * (写这段注释时踩过一次:`**` 后面紧跟 `/` 会**提前结束块注释**,于是后半段被当成代码解析。
 *  所以这里不再把 glob 写成字面量。)
 */
export function toMysqlDate(value) {
  const parsed = new Date(value || Date.now());
  const iso = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  return iso.replace('T', ' ').replace('Z', '');
}
