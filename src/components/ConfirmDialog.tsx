import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, type ConfirmOptions } from '../lib/confirm'
import { Button } from './ui/button'
import './ConfirmDialog.css'

type Pending = { options: ConfirmOptions; resolve: (confirmed: boolean) => void }

// One shared confirmation for the whole app, on a native <dialog>: the browser supplies the focus trap, Escape and
// the inert page behind it. While `locked` it is closed and cannot open: a dialog in the top layer would otherwise
// sit above the lock screen with patient names in it.
export function ConfirmProvider({ locked, children }: { locked: boolean; children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  // While locked nothing is shown and nothing is confirmed (the page stays mounted behind the lock and still receives keys).
  const confirm = useCallback((options: ConfirmOptions) => locked ? Promise.resolve(false) : new Promise<boolean>((resolve) => setPending({ options, resolve })), [locked])
  useEffect(() => { if (locked) dialog.current?.close('no') }, [locked])
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <dialog
          className="confirm-dialog"
          aria-labelledby={titleId}
          ref={(el) => { dialog.current = el; if (el && !el.open) el.showModal() }}
          onClose={(e) => { pending.resolve(e.currentTarget.returnValue === 'yes'); setPending(null) }}
          onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close('no') }}
        >
          <div className="confirm-dialog-body">
            <h2 id={titleId} className="confirm-dialog-title">{pending.options.title}</h2>
            {pending.options.body && <p className="confirm-dialog-text">{pending.options.body}</p>}
            <div className="confirm-dialog-actions">
              <Button type="button" variant="ghost" onClick={() => dialog.current?.close('no')}>{pending.options.cancelLabel ?? 'Cancel'}</Button>
              <Button type="button" variant="dark" onClick={() => dialog.current?.close('yes')}>{pending.options.confirmLabel ?? 'Confirm'}</Button>
            </div>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  )
}
