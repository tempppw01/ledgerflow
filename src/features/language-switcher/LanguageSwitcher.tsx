import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHEVRON_DOWN_ICON_URL, GLOBE_ICON_URL } from '../../shared/config/brandAssets';
import './language-switcher.css';

type Language = 'zh' | 'en';

const LANGUAGES: Array<{ value: Language; label: string; shortLabel: string }> = [
  { value: 'zh', label: '简体中文', shortLabel: '中文' },
  { value: 'en', label: 'English', shortLabel: 'EN' }
];

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const activeLanguage: Language = (i18n.resolvedLanguage || i18n.language || 'zh').startsWith('en')
    ? 'en'
    : 'zh';
  const current = LANGUAGES.find((language) => language.value === activeLanguage) ?? LANGUAGES[0];
  const title = t('layout.languageSwitch', { defaultValue: '切换语言' });
  const visibleLabel = t('layout.language', { defaultValue: '语言' });

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const activeOption = menuRef.current?.querySelector<HTMLButtonElement>('[data-active="true"]');
    activeOption?.focus();
  }, [open]);

  const selectLanguage = useCallback(
    (language: Language) => {
      setOpen(false);
      triggerRef.current?.focus();
      if (language !== activeLanguage) {
        void i18n.changeLanguage(language);
      }
    },
    [activeLanguage, i18n]
  );

  return (
    <div className="language-switcher" ref={rootRef} data-open={open ? 'true' : 'false'}>
      <button
        ref={triggerRef}
        type="button"
        className="language-switcher-trigger"
        onClick={() => setOpen((value) => !value)}
        title={`${title}: ${current.label}`}
        aria-label={`${title}：${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        data-language={activeLanguage}
      >
        <span className="language-switcher-icon-shell" aria-hidden="true">
          <img className="language-switcher-icon" src={GLOBE_ICON_URL} alt="" />
        </span>
        <span className="language-switcher-copy">
          <span className="language-switcher-label">{visibleLabel}</span>
          <strong className="language-switcher-current">{current.shortLabel}</strong>
        </span>
        <img
          className="language-switcher-chevron"
          src={CHEVRON_DOWN_ICON_URL}
          alt=""
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="language-switcher-menu"
          role="menu"
          aria-label={title}
        >
          <div className="language-switcher-menu-title" aria-hidden="true">
            {title}
          </div>
          {LANGUAGES.map((language) => {
            const isActive = language.value === activeLanguage;
            return (
              <button
                key={language.value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                data-active={isActive}
                className={
                  isActive ? 'language-switcher-option is-active' : 'language-switcher-option'
                }
                onClick={() => selectLanguage(language.value)}
              >
                <span className="language-switcher-option-label">{language.label}</span>
                {isActive ? (
                  <svg
                    className="language-switcher-check"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m5 12 4.5 4.5L19 7" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
