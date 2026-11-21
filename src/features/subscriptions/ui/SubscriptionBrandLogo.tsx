import type { CSSProperties, ReactNode } from 'react';
import type { BrandMark } from '../model/brandMarks';

interface SubscriptionBrandLogoProps {
  /** resolveBrandMark() 的结果;为空时渲染 fallback。 */
  mark: BrandMark | null;
  /** 没有对应品牌时显示的内容(一般为按订阅类型画的通用图标)。 */
  fallback?: ReactNode;
  /** 尺寸修饰:卡片用 md,模板/摘要用 sm。 */
  size?: 'sm' | 'md';
}

/**
 * 订阅品牌标识:有官方图标就用品牌色画出来,没有图标但有品牌色的品牌
 * (中国移动、爱奇艺等)渲染成品牌色文字瓦片,两者都不是才退回通用图标。
 *
 * 图标路径内置在 brandMarks.ts(构建期生成),不走任何运行时网络请求,
 * 离线或内网部署也能正常显示。
 */
export function SubscriptionBrandLogo({
  mark,
  fallback = null,
  size = 'md'
}: SubscriptionBrandLogoProps) {
  if (!mark) return <>{fallback}</>;

  const style = { '--brand-color': `#${mark.hex}` } as CSSProperties;

  return (
    <span
      className={`subscription-brand-logo is-${size}${mark.path ? '' : ' is-wordmark'}`}
      style={style}
      title={mark.title}
      role="img"
      aria-label={mark.title}
    >
      {mark.path ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={mark.path} fill="currentColor" />
        </svg>
      ) : (
        <span className="subscription-brand-wordmark" aria-hidden="true">
          {mark.label ?? mark.title}
        </span>
      )}
    </span>
  );
}
