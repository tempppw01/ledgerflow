import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHEVRON_DOWN_ICON_URL, GLOBE_ICON_URL } from '../../shared/config/brandAssets';
import './language-switcher.css';

type Language = 'zh' | 'en';

const LANGUAGES: Array<{ value: Language; label: string }> = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' }
];

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const activeLanguage: Language = (i18n.resolvedLanguage || i18n.language || 'zh').startsWith(
    'en'
  )
    ? 'en'
    : 'zh';
  const current = LANGUAGES.find((language) => language.value === activeLanguage) ?? LANGUAGES[0];
  const title = t('layout.languageSwitch', { defaultValue: '切换语言' });

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
        title={title}
        aria-label={`${title}：${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-language={activeLanguage}
      >
        <img className="language-switcher-icon" src={GLOBE_ICON_URL} alt="" aria-hidden="true" />
        <span className="language-switcher-current">{current.label}</span>
        <img
          className="language-switcher-chevron"
          src={CHEVRON_DOWN_ICON_URL}
          alt=""
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div ref={menuRef} className="language-switcher-menu" role="menu" aria-label={title}>
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
                  isActive
                    ? 'language-switcher-option is-active'
                    : 'language-switcher-option'
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
