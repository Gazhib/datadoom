import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { translator } from './messages'
import type { Locale } from './messages'
import { LocaleContext } from './useI18n'

const storageKey = 'datadoom.interface-language'

function savedLocale(): Locale {
  try {
    const locale = localStorage.getItem(storageKey)
    if (locale === 'ru' || locale === 'kk') return locale
  } catch { /* The selector also works without browser storage. */ }
  return 'en'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(savedLocale)
  const t = useMemo(() => translator(locale), [locale])

  useEffect(() => {
    document.documentElement.lang = locale
    document.title = t('pageTitle')
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('pageDescription'))
    try { localStorage.setItem(storageKey, locale) } catch { /* Browser storage is optional. */ }
  }, [locale, t])

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>
}

