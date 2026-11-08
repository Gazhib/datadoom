import { useI18n } from '../i18n/useI18n'
import { useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Icon } from './Icon'

export function Dialog({ title, kicker, wide, className, actions, pending, onClose, initialFocus, children }: {
  title: string
  kicker: string
  wide?: boolean
  className?: string
  // Extra heading controls, rendered before the close button.
  actions?: ReactNode
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

  return <dialog ref={ref} className={['dialog', wide && 'dialog-wide', className].filter(Boolean).join(' ')} aria-labelledby={id}
    onCancel={(event) => {
      event.preventDefault()
      if (!pending) onClose()
    }}>
    <div className="dialog-heading">
      <div><p className="kicker">{kicker}</p><h2 id={id}>{title}</h2></div>
      <div className="dialog-heading-actions">
        {actions}
        <button className="button icon-button" type="button" aria-label={t('closeDialog')} disabled={pending} onClick={onClose}><Icon name="close" /></button>
      </div>
    </div>
    {children}
  </dialog>
}
