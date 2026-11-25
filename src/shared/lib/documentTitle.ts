/**
 * 文档标题(浏览器标签页、历史记录、读屏器读到的第一件事)。
 *
 * 为什么需要:WCAG 2.4.2(Page Titled,Level A)要求**每个页面/视图**都有能说明其主题的标题。
 * 此前全站标题只在语言切换时设一次 `app.title`,22 条路由读到的是同一句话 ——
 * 靠读屏器或标签页在页面间切换的人分不出自己在哪一页,浏览器历史里也全是同名条目。
 *
 * 键名放在表里(而不是散落的字面量调用),所以**由单测**核对两份语言文件里都存在,
 * 见 documentTitle.test.ts —— 表里写错键名会红,不会悄悄退回兜底文案。
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type TitleTranslater = (key: string, fallback: string) => string;

export type RouteTitle = {
  /** 路径;**不带**尾部斜杠 */
  path: string;
  /** 路径的更深子路径用这个(例如 /transactions/abc -> 编辑流水) */
  key: string;
  fallback: string;
  /** 路径本身用这个;缺省与更深路径同标题 */
  exactKey?: string;
  exactFallback?: string;
};

/**
 * 顺序有意义:**先具体、后宽泛**。
 * `/transactions` 这一行最容易写错 —— 它把「路径本身」(交易流水)与「更深一层」
 * (编辑流水)分开了,所以必须排在其他能前缀命中 `/transactions...` 的规则之前,
 * 同时 `/transactions/new` 又要排在它之前。
 */
export const ROUTE_TITLES: RouteTitle[] = [
  { path: '/transactions/new', key: 'docTitle.newTransaction', fallback: '记一笔' },
  {
    path: '/transactions',
    key: 'docTitle.editTransaction',
    fallback: '编辑流水',
    exactKey: 'nav.transactions',
    exactFallback: '交易流水'
  },
  { path: '/categories-accounts', key: 'nav.categoriesAccounts', fallback: '账户与分类' },
  { path: '/balance-changes', key: 'nav.balanceChanges', fallback: '余额变动' },
  { path: '/recycle-bin', key: 'nav.recycleBin', fallback: '回收站' },
  { path: '/subscriptions', key: 'nav.subscriptions', fallback: '订阅管理' },
  { path: '/database-settings', key: 'nav.dbSettings', fallback: '数据与备份' },
  { path: '/financial-analysis', key: 'nav.financialAnalysis', fallback: '财务分析' },
  { path: '/repayment-management', key: 'nav.repayment', fallback: '还款管理' },
  { path: '/smart-budget', key: 'nav.smartBudget', fallback: '智能预算' },
  { path: '/global-memory', key: 'nav.globalMemory', fallback: '全局记忆' },
  { path: '/salary-tools', key: 'nav.salaryTools', fallback: '工资工具' },
  { path: '/exchange', key: 'nav.exchange', fallback: '汇率工具' },
  { path: '/finance', key: 'nav.finance', fallback: '行情资讯' },
  { path: '/investments', key: 'nav.investments', fallback: '投资理财' },
  { path: '/assistant', key: 'nav.assistant', fallback: 'AI 助手' },
  { path: '/settings', key: 'nav.settings', fallback: '设置' },
  { path: '/help', key: 'nav.help', fallback: '帮助' },
  { path: '/about', key: 'nav.about', fallback: '关于' },
  // /tags 是重定向到账户与分类的旧路径,保留自己的标题以免重定向途中闪一下"页面不存在"
  { path: '/tags', key: 'nav.categoriesAccounts', fallback: '账户与分类' },
  { path: '/', key: 'nav.dashboard', fallback: '数据概览' }
];

/** 去掉查询串与尾部斜杠,让 `/x/` 与 `/x` 等价;根路径保持 `/` */
function normalize(pathname: string): string {
  const noQuery = (pathname || '/').split('?')[0].split('#')[0];
  const trimmed = noQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * 把路径解析成标题。取不到页面名时**退回"页面不存在"(再退回应用名)**,
 * 绝不把原始 key 露到界面上。
 */
export function resolveDocumentTitle(pathname: string, t: TitleTranslater): string {
  const appName = t('app.title', 'LedgerFlow 记账软件');
  const clean = normalize(pathname);

  for (const route of ROUTE_TITLES) {
    if (clean === route.path) {
      return join(t(route.exactKey ?? route.key, route.exactFallback ?? route.fallback), appName);
    }
    // 更深一层:必须按 / 边界匹配,否则 /transaction 会命中 /transactions
    if (route.path !== '/' && clean.startsWith(`${route.path}/`)) {
      return join(t(route.key, route.fallback), appName);
    }
  }

  return join(t('docTitle.notFound', '页面不存在'), appName);
}

function join(page: string, appName: string): string {
  const page_ = (page || '').trim();
  const app_ = (appName || '').trim();
  if (!page_) return app_;
  if (!app_) return page_;
  return `${page_} · ${app_}`;
}

/**
 * 路由或语言变化时更新 document.title,并返回解析出的标题。
 *
 * 这是**唯一**写入 document.title 的地方(i18n 初始化里原先那次写入已删掉),
 * 否则语言切换时两处会抢着写,顺序一变标题就退回全站同一句。
 */
export function useDocumentTitle(pathname: string): string {
  const { t, i18n } = useTranslation();
  const title = resolveDocumentTitle(pathname, (key, fallback) =>
    t(key, { defaultValue: fallback })
  );

  useEffect(() => {
    if (typeof document !== 'undefined' && document.title !== title) {
      document.title = title;
    }
  }, [title, i18n.language]);

  return title;
}