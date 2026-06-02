import { useCallback, useEffect, useRef, useState } from 'react';
import { MONITOR_ICON_URL, MOON_ICON_URL, SUN_ICON_URL } from '../../shared/config/brandAssets';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { AppTheme } from '../../shared/types/app';
import './theme-switcher.css';

const OPTIONS: Array<{ value: AppTheme; iconSrc: string; label: string }> = [
  { value: 'system', iconSrc: MONITOR_ICON_URL, label: '跟随设备' },
  { value: 'dark', iconSrc: MOON_ICON_URL, label: '暗黑' },
  { value: 'light', iconSrc: SUN_ICON_URL, label: '日间' }
];

export function ThemeSwitcher() {
  const theme = useAppPreferences((s) => s.theme);
  const setTheme = useAppPreferences((s) => s.setTheme);
  const switcherRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );
  const orderedOptions = [
    OPTIONS.find((option) => option.value === theme) || OPTIONS[0],
    ...OPTIONS.filter((option) => option.value !== theme)
  ];

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
      setIsExpanded(false);
    };

    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isExpanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isExpanded]);

  const handleThemeChange = useCallback(
    (newTheme: AppTheme) => {
      document.body.classList.add('theme-transition');
      setTheme(newTheme);
      setIsExpanded(false);
      setTimeout(() => {
        document.body.classList.remove('theme-transition');
      }, 500);
    },
    [setTheme]
  );

  const handleOptionClick = (newTheme: AppTheme) => {
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    if (isMobile && (newTheme === theme || !isExpanded)) {
      setIsExpanded(true);
      return;
    }

    handleThemeChange(newTheme);
  };

  return (
    <div
      ref={switcherRef}
      className="theme-switcher"
      data-expanded={isExpanded ? 'true' : 'false'}
      aria-label="主题切换"
    >
      {orderedOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          className={theme === option.value ? 'theme-icon-btn active' : 'theme-icon-btn'}
          onClick={() => handleOptionClick(option.value)}
          title={option.label}
          aria-label={option.label}
          aria-expanded={theme === option.value && isMobileViewport ? isExpanded : undefined}
        >
          <img className="theme-icon" src={option.iconSrc} alt="" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
