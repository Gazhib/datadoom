import { useI18n } from '../i18n/useI18n'
import { useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Icon } from './Icon'

export function Dialog({ title, kicker, wide, pending, onClose, initialFocus, children }: {
  title: string
  kicker: string
  wide?: boolean
  pending: boolean
  onClose: () => void
  initialFocus?: RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const { t } = useI18n()
  const id = useId()
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    initialFocus?.current?.focus()
    return () => dialog.close()
  }, [initialFocus])

  return <dialog ref={ref} className={wide ? 'dialog dialog-wide' : 'dialog'} aria-labelledby={id}
    onCancel={(event) => {
      event.preventDefault()
      if (!pending) onClose()
    }}>
    <div className="dialog-heading">
      <div><p className="kicker">{kicker}</p><h2 id={id}>{title}</h2></div>
      <button className="button icon-button" type="button" aria-label={t('closeDialog')} disabled={pending} onClick={onClose}><Icon name="close" /></button>
    </div>
    {children}
  </dialog>
}
