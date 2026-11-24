import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RouterProvider } from 'react-router-dom';
import { router } from './router/router';
import { useAppPreferences } from '../shared/store/useAppPreferences';
import { useResolvedTheme } from '../shared/hooks/useResolvedTheme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      refetchOnWindowFocus: false
    }
  }
});

export function App() {
  const { t } = useTranslation();
  const theme = useAppPreferences((s) => s.theme);
  const resolvedTheme = useResolvedTheme(theme);
  // 主题色:原来这里写死 'amber',于是设置里的 accentTheme 永远不生效(tokens.css 里
  // 六套 [data-accent-theme='…'] 只有 amber 那套真的被用上)。
  const accentTheme = useAppPreferences((s) => s.accentTheme);

  /**
   * 把主题标记挂到 html 根节点，避免仅在局部容器生效，
   * 解决暗黑模式下 body 背景与内容区颜色不一致的问题。
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-accent-theme', accentTheme);
  }, [resolvedTheme, accentTheme]);

  return (
    <div className="app-shell">
      <QueryClientProvider client={queryClient}>
        <Suspense
          fallback={
            <div className="page-skeleton" role="status" aria-live="polite" style={{ padding: 24 }}>
              {t('common.pageLoading')}
            </div>
          }
        >
          <RouterProvider router={router} />
        </Suspense>
      </QueryClientProvider>
    </div>
  );
}
