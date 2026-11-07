import { UiError } from '../i18n/messages'
import type { Translate } from '../i18n/messages'

export function captureError(error: unknown): Error {
  return error instanceof Error ? error : new UiError('unexpectedError')
}

export function errorMessage(error: Error, t: Translate) {
  const localized = error instanceof UiError ? error : error.cause
  return localized instanceof UiError ? t(localized.key, localized.values) : error.message
}
