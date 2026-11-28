import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * 顶栏那个 h1 的名字必须和 document.title 同源 —— 都走 documentTitle 里那张路由表。
 *
 * 为什么值得钉住:两边原本各有一套逻辑。顶栏按**侧栏导航前缀**猜,标签页按路由表取,
 * 顶层的 19 条路由恰好一致,所以看截图看不出问题;一旦进到子路由就漂:
 *
 * | 路由                | 浏览器标签 | 修改前的顶栏 |
 * | ------------------- | ---------- | ------------ |
 * | /transactions/new   | 记一笔     | 交易流水     |
 * | /transactions/:id   | 编辑流水   | 交易流水     |
 * | /settings           | 设置       | 账号设置(三个页签之一) |
 *
 * 这里读源码而不是渲染 AppLayout:渲染它要拖进 auth context、SettingsPage、数据同步门
 * 与一堆 store(jsdom 里代价很大、也容易假失败),而"这个名字从哪来"就是这一行的全部真相。
 */
describe('顶栏标题的来源', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/widgets/layout/AppLayout.tsx'), 'utf8');

  it('顶栏标题取自 resolvePageTitle(与文档标题同一张表)', () => {
    expect(source).toContain('resolvePageTitle(location.pathname, tFallback)');
  });

  it('不再自己按侧栏导航前缀猜标题', () => {
    // 那段逻辑只存在于 currentWorkspaceTitle 里,删掉后全仓不该再有。
    expect(source).not.toContain('navItems.find(');
  });

  it('助手工作区的动态名字仍然单独处理(它不在路由表里)', () => {
    expect(source).toContain('return assistantWorkspaceTitle;');
  });
});
