import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { DashboardPage } from './lazyPages';
import { useAppPreferences } from '../../shared/store/useAppPreferences';

/**
 * 首页入口:按「默认打开页面」设置决定显示什么。
 *
 * 两个要点:
 *
 * 1. **只重定向一次**(每次页面加载一次)。用模块级变量而不是组件 state —— 组件会随路由
 *    切换卸载/重挂,用 state 的话用户每次点「首页」都会被弹走;模块级变量在刷新后归零,
 *    正好等于「打开应用时」的语义。
 *
 * 2. 判断放在 **effect 里**、直接读 store 的当前值,而不是在渲染期读 hook 的值。
 *    渲染期读会有水合时序问题:首屏渲染时 persist 可能还没把 defaultLandingPath 恢复出来,
 *    于是就渲染了首页并且不再跳(实测过:设置明明存着,刷新却不跳)。effect 在提交之后运行,
 *    此时水合一定已完成。
 */
let landingRedirected = false;

export function HomeRoute() {
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  useEffect(() => {
    if (landingRedirected) return;
    const path = useAppPreferences.getState().defaultLandingPath;
    if (path) {
      landingRedirected = true;
      setRedirectTo(path);
    }
  }, []);

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }
  return <DashboardPage />;
}
