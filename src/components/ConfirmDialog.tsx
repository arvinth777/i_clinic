import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AskReasonContext, ConfirmContext, type ConfirmOptions, type ReasonOptions } from '../lib/confirm'
import { Button } from './ui/button'
import { lockPageScroll } from '../lib/scrollLock'
import './ConfirmDialog.css'

type Pending = { options: ConfirmOptions; resolve: (confirmed: boolean) => void }
type PendingReason = { options: ReasonOptions; resolve: (reason: string | null) => void }

function ReasonDialog({ pending, onDone }: { pending: PendingReason; onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  const [text, setText] = useState('')
  const [needed, setNeeded] = useState(false)
  const mount = useCallback((el: HTMLDialogElement | null) => { dialog.current = el; if (el && !el.open) el.showModal() }, [])
  const { options } = pending
  return (
    <dialog className="confirm-dialog" aria-labelledby={titleId} ref={mount}
      onClose={e => { pending.resolve(e.currentTarget.returnValue === 'yes' && text.trim() ? text.trim() : null); onDone() }}
      onClick={e => { if (e.target === e.currentTarget) e.currentTarget.close('no') }}>
      <form className="confirm-dialog-body" onSubmit={e => { e.preventDefault(); if (text.trim()) dialog.current?.close('yes'); else { setNeeded(true); document.getElementById(`${titleId}-reason`)?.focus() } }}>
        <h2 id={titleId} className="confirm-dialog-title">{options.title}</h2>
        {options.body && <p className="confirm-dialog-text">{options.body}</p>}
        {options.choices && <div className="confirm-dialog-choices">{options.choices.map(choice => <button key={choice} type="button" className="shell-nav-item" aria-pressed={text === choice} onClick={() => setText(choice)}>{choice}</button>)}</div>}
        <label className="field-label" htmlFor={`${titleId}-reason`}>{options.label}</label>
        <input id={`${titleId}-reason`} className="confirm-dialog-input" value={text} maxLength={200} onChange={e => setText(e.target.value)} autoFocus />
        {needed && !text.trim() && <p className="form-error" role="alert">Please give a short reason.</p>}
        <div className="confirm-dialog-actions">
          <Button type="button" variant="ghost" onClick={() => dialog.current?.close('no')}>{options.cancelLabel ?? 'Keep the visit'}</Button>
          <Button type="submit" variant="dark">{options.confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  )
}

// One shared confirmation on a native <dialog> (focus trap, Escape and the inert page come from the browser).
// While `locked` it cannot open and closes if open: in the top layer it would sit above the lock screen.
export function ConfirmProvider({ locked, children }: { locked: boolean; children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [reasonPending, setReasonPending] = useState<PendingReason | null>(null)
  const dialog = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()
  // The page stays mounted behind the lock and still receives keys, so refuse to open while locked.
  const confirm = useCallback((options: ConfirmOptions) => locked ? Promise.resolve(false) : new Promise<boolean>((resolve) => setPending({ options, resolve })), [locked])
  const askReason = useCallback((options: ReasonOptions) => locked ? Promise.resolve(null) : new Promise<string | null>((resolve) => setReasonPending({ options, resolve })), [locked])
  useEffect(() => { if (locked) dialog.current?.close('no') }, [locked])
  useEffect(() => (pending || reasonPending ? lockPageScroll() : undefined), [pending, reasonPending])
  // Stable, so it runs only on mount: an inline ref would reopen a closing dialog on re-render.
  const mount = useCallback((el: HTMLDialogElement | null) => { dialog.current = el; if (el && !el.open) el.showModal() }, [])
  return (
    <ConfirmContext.Provider value={confirm}>
      <AskReasonContext.Provider value={askReason}>
      {children}
      {reasonPending && !locked && <ReasonDialog pending={reasonPending} onDone={() => setReasonPending(null)} />}
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
      </AskReasonContext.Provider>
    </ConfirmContext.Provider>
  )
}
