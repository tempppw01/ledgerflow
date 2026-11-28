import { describe, expect, it } from 'vitest';
import { ROUTE_TITLES, resolveDocumentTitle, resolvePageTitle } from './documentTitle';
import zh from '../../i18n/locales/zh/translation.json';
import en from '../../i18n/locales/en/translation.json';

/** 测试用的假翻译器:键存在就返回 `${键}#${兜底}`,不存在就返回兜底 —— 便于断言"命中了哪个键" */
function fakeT(tree: Record<string, unknown>) {
  return (key: string, fallback: string): string => {
    let node: unknown = tree;
    for (const part of key.split('.')) {
      if (node === null || typeof node !== 'object') return fallback;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' ? `${key}#${node}` : fallback;
  };
}

const zhT = fakeT(zh as Record<string, unknown>);
const enT = fakeT(en as Record<string, unknown>);

/** 表里的键必须在两份语言文件里都存在 —— 键名写在表里,静态闸门查不到,所以用这条钉住。 */
describe('documentTitle 的键名', () => {
  it('每个键在 zh 与 en 里都存在(否则会静默退回兜底文案)', () => {
    for (const route of ROUTE_TITLES) {
      expect(zhT(route.key, '__缺失__'), `zh 缺少 ${route.key}`).not.toBe('__缺失__');
      expect(enT(route.key, '__缺失__'), `en 缺少 ${route.key}`).not.toBe('__缺失__');
    }
    for (const key of ['app.title', 'docTitle.notFound']) {
      expect(zhT(key, '__缺失__'), `zh 缺少 ${key}`).not.toBe('__缺失__');
      expect(enT(key, '__缺失__'), `en 缺少 ${key}`).not.toBe('__缺失__');
    }
  });
});

describe('resolveDocumentTitle', () => {
  const appName = zhT('app.title', 'app.title');

  it('首页用 nav.dashboard 的真实中文值(不是猜的文案)', () => {
    // 早期这条断言写成「数据概览」是猜的 —— 语言文件里 nav.dashboard 实际是「财务概览」。
    // 用真实值断言,以后改文案时这里会跟着红,提醒同步看一眼标题是否还合理。
    expect(resolveDocumentTitle('/', zhT)).toBe(`nav.dashboard#财务概览 · ${appName}`);
  });

  it('每个主路由都有自己的页面名(不是全站同一句)', () => {
    const titles = ['/', '/transactions', '/investments', '/settings', '/help', '/about'].map((p) =>
      resolveDocumentTitle(p, zhT)
    );
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('更具体的路径优先:/transactions/new 不会命中"交易流水"', () => {
    expect(resolveDocumentTitle('/transactions/new', zhT)).toContain('docTitle.newTransaction#');
    expect(resolveDocumentTitle('/transactions/abc-123', zhT)).toContain(
      'docTitle.editTransaction#'
    );
    expect(resolveDocumentTitle('/transactions', zhT)).toContain('nav.transactions#');
  });

  it('子路径与查询串不会跑掉:/investments/flow 与 ?tab=x 仍算投资理财', () => {
    expect(resolveDocumentTitle('/investments/flow', zhT)).toContain('nav.investments#');
    expect(resolveDocumentTitle('/investments?tab=x', zhT)).toContain('nav.investments#');
    expect(resolveDocumentTitle('/settings/security', zhT)).toContain('nav.settings#');
    expect(resolveDocumentTitle('/assistant/chat', zhT)).toContain('nav.assistant#');
  });

  it('前缀不能跨词命中:/transaction 不等于 /transactions', () => {
    expect(resolveDocumentTitle('/transaction', zhT)).toContain('docTitle.notFound#');
  });

  it('未知路径退回"页面不存在"而不是原始 key', () => {
    expect(resolveDocumentTitle('/这条路径不存在', zhT)).toContain('docTitle.notFound#');
    expect(resolveDocumentTitle('/这条路径不存在', zhT)).not.toContain('docTitle.notFound ·');
  });

  it('英文界面用的是英文页面名(与中文不同)', () => {
    const zhTitle = resolveDocumentTitle('/investments', zhT);
    const enTitle = resolveDocumentTitle('/investments', enT);
    expect(zhTitle).not.toBe(enTitle);
    expect(enTitle).toContain('nav.investments#');
  });

  it('应用名取不到时不会出现孤零零的分隔符', () => {
    const t = (key: string, fallback: string) => (key === 'app.title' ? '' : fallback);
    expect(resolveDocumentTitle('/', t)).toBe('数据概览');
    expect(resolveDocumentTitle('/', t)).not.toContain('·');
  });
});

/*
 * 顶栏那个 h1 用的就是这个函数(见 widgets/layout/workspaceTitle.test.ts)。
 * 它原来是一段"按侧栏前缀猜"的独立逻辑,于是子路由会漂:
 * /transactions/new 的顶栏写「交易流水」而浏览器标签写「记一笔」,/settings 的顶栏写
 * 页签名「账号设置」而页面自己的 h2 写「设置」。现在两边同源。
 */
describe('resolvePageTitle', () => {
  const appName = zhT('app.title', 'app.title');

  it('只给页面名,不带应用名', () => {
    expect(resolvePageTitle('/', zhT)).toBe('nav.dashboard#财务概览');
    expect(resolvePageTitle('/', zhT)).not.toContain(appName);
    expect(resolvePageTitle('/', zhT)).not.toContain('·');
  });

  it('子路由给的是"这一屏"的名字:记一笔 / 编辑流水,而不是它所属的工作区', () => {
    expect(resolvePageTitle('/transactions/new', zhT)).toContain('docTitle.newTransaction#');
    expect(resolvePageTitle('/transactions/abc-123', zhT)).toContain('docTitle.editTransaction#');
    expect(resolvePageTitle('/transactions', zhT)).toContain('nav.transactions#');
  });

  it('设置页是「设置」这个页面名,不是页签名「账号设置」', () => {
    expect(resolvePageTitle('/settings', zhT)).toContain('nav.settings#');
    expect(resolvePageTitle('/settings/security', zhT)).toContain('nav.settings#');
    expect(resolvePageTitle('/settings', zhT)).not.toContain('账号设置');
  });

  it('未命中的路径给「页面不存在」,与浏览器标签一致', () => {
    expect(resolvePageTitle('/这条路径不存在', zhT)).toContain('docTitle.notFound#');
  });

  it('文档标题 = 页面名 + 应用名(两边不可能漂开)', () => {
    const routes = [
      '/',
      '/transactions',
      '/transactions/new',
      '/transactions/abc-123',
      '/settings',
      '/settings/security',
      '/investments/flow',
      '/assistant',
      '/这条路径不存在'
    ];
    for (const route of routes) {
      expect(resolveDocumentTitle(route, zhT), route).toBe(
        `${resolvePageTitle(route, zhT)} · ${appName}`
      );
    }
  });
});
