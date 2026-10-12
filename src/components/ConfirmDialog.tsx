import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ConfirmContext, type ConfirmOptions } from '../lib/confirm'
import { Button } from './ui/button'
import { lockPageScroll } from '../lib/scrollLock'
import './ConfirmDialog.css'

type Pending = { options: ConfirmOptions; resolve: (confirmed: boolean) => void }

// One shared confirmation on a native <dialog> (focus trap, Escape and the inert page come from the browser).
// While `locked` it cannot open and closes if open: in the top layer it would sit above the lock screen.
export function ConfirmProvider({ locked, children }: { locked: boolean; children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  // The page stays mounted behind the lock and still receives keys, so refuse to open while locked.
  const confirm = useCallback((options: ConfirmOptions) => locked ? Promise.resolve(false) : new Promise<boolean>((resolve) => setPending({ options, resolve })), [locked])
  useEffect(() => { if (locked) dialog.current?.close('no') }, [locked])
  useEffect(() => (pending ? lockPageScroll() : undefined), [pending])
  // Stable, so it runs only on mount: an inline ref would reopen a closing dialog on re-render.
  const mount = useCallback((el: HTMLDialogElement | null) => { dialog.current = el; if (el && !el.open) el.showModal() }, [])
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <dialog
          className="confirm-dialog"
          aria-labelledby={titleId}
          ref={mount}
          onClose={(e) => { pending.resolve(e.currentTarget.returnValue === 'yes'); setPending(null) }}
          onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close('no') }}
        >
          <div className="confirm-dialog-body">
            <h2 id={titleId} className="confirm-dialog-title">{pending.options.title}</h2>
            {pending.options.body && <p className="confirm-dialog-text">{pending.options.body}</p>}
            <div className="confirm-dialog-actions">
              <Button type="button" variant="ghost" onClick={() => dialog.current?.close('no')}>{pending.options.cancelLabel ?? 'Cancel'}</Button>
              <Button type="button" variant="dark" onClick={() => dialog.current?.close('yes')}>{pending.options.confirmLabel}</Button>
            </div>
          </div>
        </dialog>
      )}
    </ConfirmContext.Provider>
  )
}
