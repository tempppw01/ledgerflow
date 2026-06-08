import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useEffect } from 'react';
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
  const theme = useAppPreferences((s) => s.theme);
  const resolvedTheme = useResolvedTheme(theme);

  /**
   * 把主题标记挂到 html 根节点，避免仅在局部容器生效，
   * 解决暗黑模式下 body 背景与内容区颜色不一致的问题。
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-accent-theme', 'amber');
  }, [resolvedTheme]);

  return (
    <div className="app-shell">
      <QueryClientProvider client={queryClient}>
        <Suspense
          fallback={
            <div className="page-skeleton" role="status" aria-live="polite" style={{ padding: 24 }}>
              页面加载中…
            </div>
          }
        >
          <RouterProvider router={router} />
        </Suspense>
      </QueryClientProvider>
    </div>
  );
}
