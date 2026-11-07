import { en } from './en'
import type { Catalog, MessageKey } from './en'
import { kk } from './kk'
import { ru } from './ru'

export const localeNames = { en: 'English', ru: 'Русский', kk: 'Қазақша' }
export type Locale = keyof typeof localeNames
type Values = Record<string, string | number>
export type Translate = (key: MessageKey, values?: Values) => string

const catalogs: Record<Locale, Catalog> = { en, ru, kk }

export function translator(locale: Locale): Translate {
  const plurals = new Intl.PluralRules(locale)
  return (key, values = {}) => {
    const message = catalogs[locale][key]
    const template = typeof message === 'string'
      ? message
      : message[plurals.select(Number(values.count))] ?? message.other ?? message.many ?? message.one ?? ''
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder)
  }
}

const english = translator('en')

export class UiError extends Error {
  readonly key: MessageKey
  readonly values?: Values

  constructor(key: MessageKey, values?: Values) {
    super(english(key, values))
    this.key = key
    this.values = values
  }
}
