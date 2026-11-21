/**
 * 把用户数据安全地放进 HTML 片段里。
 *
 * 用在两处拼 HTML 字符串的场景:打印预览(iframe srcDoc)与账单详情打印。
 * 这两处都把用户可控内容(备注、标签、账户名、分类名)直接插进 HTML,
 * 所以必须转义 —— 否则备注里写一段 `<img onerror=…>` 就能在预览里执行脚本,
 * 而预览 iframe 没有 sandbox,是同源的。
 *
 * 之前这个函数在两个文件里各写了一份完全相同的实现。行为一致时无所谓,
 * 但只要有人只改其中一处(比如补一个字符),另一处就会静默留下缺口,
 * 所以收敛到这里,并由 escapeHtml.test.ts 守住字符覆盖。
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}