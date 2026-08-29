import { Languages } from 'lucide-react'
import { changeLanguage, getCurrentLanguage, languages, languageNames, type Language } from '../lib/i18n'
import { useTranslation } from '../lib/i18n/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Button } from './ui/button'

export function LanguageSwitcher() {
  const { t } = useTranslation()
  const currentLang = getCurrentLanguage() as Language

  const handleLanguageChange = (lang: Language) => {
    void changeLanguage(lang)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
          title={t('language.switchTo', { language: languageNames[currentLang] })}
        >
          <Languages size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onClick={() => handleLanguageChange(lang)}
            className={currentLang === lang ? 'bg-zinc-100 dark:bg-zinc-800' : ''}
          >
            <span className="mr-2">{lang === 'en' ? '🇺🇸' : '🇨🇳'}</span>
            {languageNames[lang]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
