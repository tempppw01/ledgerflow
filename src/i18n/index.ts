import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enTranslation from './locales/en/translation.json';
import zhTranslation from './locales/zh/translation.json';

function resolveInitialLanguage(): 'zh' | 'en' {
  if (typeof window === 'undefined') return 'zh';
  const stored = window.localStorage.getItem('i18nextLng') || '';
  if (stored.startsWith('en')) return 'en';
  if (stored.startsWith('zh')) return 'zh';
  return 'zh';
}

const initialLanguage = resolveInitialLanguage();

function applyDocumentLanguage(language: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', language.startsWith('en') ? 'en' : 'zh-CN');
}

function applyDocumentTitle(language: string) {
  if (typeof document === 'undefined') return;
  document.title = i18n.t('app.title', {
    lng: language.startsWith('en') ? 'en' : 'zh',
    defaultValue: language.startsWith('en') ? 'LedgerFlow Bookkeeping' : 'LedgerFlow 记账软件'
  });
}

/**
 * 语言切换后同步 <html lang>,避免浏览器/字体回退策略仍按旧语言渲染,
 * 也让需要区分中英文的输入法、朗读工具拿到正确语言。
 */
function handleLanguageChanged(language: string) {
  applyDocumentLanguage(language);
  applyDocumentTitle(language);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: initialLanguage,
    fallbackLng: 'zh',
    resources: {
      zh: { translation: zhTranslation },
      en: { translation: enTranslation }
    },
    initImmediate: false,
    supportedLngs: ['zh', 'en'],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    ns: ['translation'],
    defaultNS: 'translation',
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: ['localStorage']
    },
    react: {
      useSuspense: false
    }
  });

applyDocumentLanguage(i18n.language || initialLanguage);
applyDocumentTitle(i18n.language || initialLanguage);
i18n.off('languageChanged', handleLanguageChanged);
i18n.on('languageChanged', handleLanguageChanged);

export default i18n;
