import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import zh from './locales/zh.json'

export const languages = ['en', 'zh'] as const
export type Language = (typeof languages)[number]

export const languageNames: Record<Language, string> = {
  en: 'English',
  zh: '中文',
}

const resources = {
  en: { translation: en },
  zh: { translation: zh },
}

export function normalizeLanguage(input?: string | null): Language {
  if (input?.toLowerCase().startsWith('zh')) {
    return 'zh'
  }

  return 'en'
}

function syncDocumentLanguage(lang: string) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.lang = normalizeLanguage(lang)
}

i18n
  .use(LanguageDetector)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: languages,
    load: 'languageOnly',
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'vibemux-language',
    },
  })

i18n.on('languageChanged', syncDocumentLanguage)
syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language)

/**
 * 深合并追加语言资源（enterprise 商业 locale 经此注册；核心不 import enterprise）。
 * deep=true 保留已有命名空间下的其它键，overwrite=true 允许覆盖同名键。
 */
export function addI18nResources(lang: Language, bundle: Record<string, unknown>) {
  i18n.addResourceBundle(lang, 'translation', bundle, true, true)
}

export default i18n

export function changeLanguage(lang: Language) {
  return i18n.changeLanguage(lang)
}

export function getCurrentLanguage(): Language {
  return normalizeLanguage(i18n.resolvedLanguage ?? i18n.language)
}
