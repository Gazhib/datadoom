import { createContext, useContext } from 'react'
import type { Locale, Translate } from './messages'

export const LocaleContext = createContext<{
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
} | null>(null)

export function useI18n() {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('Missing LocaleProvider')
  return context
}
