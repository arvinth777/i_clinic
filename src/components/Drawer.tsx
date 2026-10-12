import { useEffect, useRef, type ReactNode } from 'react'
import { useConfirm } from '../lib/confirm'
import './Drawer.css'

export function Drawer({ open, onClose, title, children, placement = 'right' }: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  placement?: 'right' | 'top'
}) {
  const panel = useRef<HTMLDivElement>(null)
  const dirty = useRef(false)
  const close = useRef(onClose)
  const confirm = useConfirm()
  const confirmRef = useRef(confirm)
  useEffect(() => { close.current = onClose; confirmRef.current = confirm }, [onClose, confirm])
  async function requestClose() {
    if (!dirty.current || await confirmRef.current({ title: 'Discard unsaved input?', body: 'Closing this form throws away what you entered.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' })) close.current()
  }
  useEffect(() => {
    if (!open) return
    dirty.current = false
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const focusable = () => [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])].filter(el => el.getClientRects().length > 0)
    focusable()[0]?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as Element | null)?.closest?.('dialog')) return // keys inside the confirmation dialog belong to it
      if (event.key === 'Escape') { event.preventDefault(); requestClose() }
      if (event.key !== 'Tab') return
      const items = focusable()
      const first = items[0]
      const last = items.at(-1)
      if (!first) { event.preventDefault(); panel.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.documentElement.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  return open ? <>
    <div className="drawer-scrim" onClick={requestClose} />
    <div ref={panel} className={`drawer-panel drawer-${placement}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} onInput={() => { dirty.current = true }}>
      <div className="drawer-head"><h2 className="drawer-title">{title}</h2><button type="button" className="drawer-close" onClick={requestClose}>Close</button></div>
      <div className="drawer-body">{children}</div>
    </div>
  </> : null
}
