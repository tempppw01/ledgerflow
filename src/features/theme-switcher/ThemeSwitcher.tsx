import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MONITOR_ICON_URL, MOON_ICON_URL, SUN_ICON_URL } from '../../shared/config/brandAssets';
import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { AppTheme } from '../../shared/types/app';
import './theme-switcher.css';

const OPTIONS: Array<{ value: AppTheme; iconSrc: string; labelKey: string }> = [
  { value: 'system', iconSrc: MONITOR_ICON_URL, labelKey: 'theme.system' },
  { value: 'dark', iconSrc: MOON_ICON_URL, labelKey: 'theme.dark' },
  { value: 'light', iconSrc: SUN_ICON_URL, labelKey: 'theme.light' }
];

export function ThemeSwitcher() {
  const { t } = useTranslation();
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
      aria-label={t('theme.switchLabel')}
    >
      {orderedOptions.map((option) => {
        const label = t(option.labelKey);
        return (
          <button
            key={option.value}
            type="button"
            className={theme === option.value ? 'theme-icon-btn active' : 'theme-icon-btn'}
            onClick={() => handleOptionClick(option.value)}
            title={label}
            aria-label={label}
            aria-expanded={theme === option.value && isMobileViewport ? isExpanded : undefined}
          >
            <img className="theme-icon" src={option.iconSrc} alt="" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
