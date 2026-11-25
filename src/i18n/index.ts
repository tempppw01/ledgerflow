import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { registerApiTranslator } from '../shared/lib/apiErrorTranslator';
import { setFormattingLocale } from '../shared/lib/format';
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

/**
 * 语言切换后同步 <html lang>,避免浏览器/字体回退策略仍按旧语言渲染,
 * 也让需要区分中英文的输入法、朗读工具拿到正确语言。
 */
function handleLanguageChanged(language: string) {
  applyDocumentLanguage(language);
  // 文档标题不在这里改:它要跟着**路由**走(WCAG 2.4.2 要求每个页面有自己的标题),
  // 由 src/shared/lib/documentTitle.ts 的 useDocumentTitle 统一写入,
  // 那里同时依赖 i18n.language —— 切语言时会跟着重算,不需要第二个写入方。
  // 金额简写(万/亿 与 K/M/B)跟随界面语言,避免英文界面里出现「¥1.84万」。
  setFormattingLocale(language);
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
setFormattingLocale(i18n.language || initialLanguage);
i18n.off('languageChanged', handleLanguageChanged);
i18n.on('languageChanged', handleLanguageChanged);
// API 层的错误文案走同一个 i18n 实例(那边不在模块顶层引入 i18n,避免影响初始化顺序)
registerApiTranslator((key, options) => i18n.t(key, options));

export default i18n;
