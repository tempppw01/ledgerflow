import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router/router';
import { useAppPreferences } from '../shared/store/useAppPreferences';
import { useResolvedTheme } from '../shared/hooks/useResolvedTheme';
import { initOfflineSyncQueue } from '../shared/lib/dataSync';

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
  const highContrast = useAppPreferences((s) => s.highContrast);
  const resolvedTheme = useResolvedTheme(theme);

  /**
   * 把主题标记挂到 html 根节点，避免仅在局部容器生效，
   * 解决暗黑模式下 body 背景与内容区颜色不一致的问题。
   */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-contrast', highContrast ? 'high' : 'normal');
  }, [highContrast]);

  useEffect(() => {
    initOfflineSyncQueue();
  }, []);

  return (
    <div className="app-shell">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </div>
  );
}
