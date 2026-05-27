import { useCallback } from 'react';
import {
  MONITOR_ICON_URL,
  MOON_ICON_URL,
  SUN_ICON_URL
} from '../../shared/config/brandAssets';
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

  const handleThemeChange = useCallback(
    (newTheme: AppTheme) => {
      document.body.classList.add('theme-transition');
      setTheme(newTheme);
      setTimeout(() => {
        document.body.classList.remove('theme-transition');
      }, 500);
    },
    [setTheme]
  );

  return (
    <div className="theme-switcher" aria-label="主题切换">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={theme === option.value ? 'theme-icon-btn active' : 'theme-icon-btn'}
          onClick={() => handleThemeChange(option.value)}
          title={option.label}
          aria-label={option.label}
        >
          <img className="theme-icon" src={option.iconSrc} alt="" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
