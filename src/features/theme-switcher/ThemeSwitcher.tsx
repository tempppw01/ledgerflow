import { useAppPreferences } from '../../shared/store/useAppPreferences';
import { AppTheme } from '../../shared/types/app';
import './theme-switcher.css';

const OPTIONS: Array<{ value: AppTheme; icon: string; label: string }> = [
  { value: 'system', icon: '🖥️', label: '跟随设备' },
  { value: 'dark', icon: '🌙', label: '暗黑' },
  { value: 'light', icon: '☀️', label: '日间' }
];

export function ThemeSwitcher() {
  const theme = useAppPreferences((s) => s.theme);
  const setTheme = useAppPreferences((s) => s.setTheme);
  const highContrast = useAppPreferences((s) => s.highContrast);
  const setHighContrast = useAppPreferences((s) => s.setHighContrast);

  return (
    <div className="theme-switcher-wrap">
      <div className="theme-switcher" aria-label="主题切换">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={theme === option.value ? 'theme-icon-btn active' : 'theme-icon-btn'}
            onClick={() => setTheme(option.value)}
            title={option.label}
            aria-label={option.label}
          >
            <span>{option.icon}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className={highContrast ? 'theme-contrast-btn active' : 'theme-contrast-btn'}
        onClick={() => setHighContrast(!highContrast)}
        aria-label={highContrast ? '关闭高对比模式' : '开启高对比模式'}
        title={highContrast ? '关闭高对比模式' : '开启高对比模式'}
      >
        高对比
      </button>
    </div>
  );
}
