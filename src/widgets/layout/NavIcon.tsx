import { useState } from 'react';

type NavIconProps = {
  /** 图标文件放在 CDN 上(经同源 /cdn 代理),上游抖一下就会 500。 */
  src: string;
  /**
   * 文件加载失败时显示的字形。
   *
   * 每个导航项**本来就带一个**(`🤖`、`📋`、`🗂️` …),原来只在「没有图标文件」时才用它 ——
   * 于是文件一失败,侧栏就只剩一个空框(实测:2026-11-28 界面审计抓到
   * `500 GET /cdn/ui/calendar.svg` 等 4 个图标请求失败)。
   */
  fallback: string;
};

/**
 * CDN 图标 + 字形兜底。
 *
 * 失败时记住的是**哪一个 src 失败**,不是"失败过"这个事实 —— 回收站图标会随条目数
 * 在两个文件之间切换(`TRASH_ICON_URL` / `TRASH_2_ICON_URL`),换了地址就要重新试一次。
 */
export function NavIcon({ src, fallback }: NavIconProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <span className="nav-icon-fallback" aria-hidden="true">
        {fallback}
      </span>
    );
  }

  return <img className="nav-image-icon" src={src} alt="" onError={() => setFailedSrc(src)} />;
}
