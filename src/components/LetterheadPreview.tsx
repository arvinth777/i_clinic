import { useEffect, useRef, useState, type ReactNode } from 'react'

export function LetterheadPreview({ children }: { children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => {
      const paper = element.firstElementChild as HTMLElement | null
      if (paper?.offsetWidth && element.clientWidth) setScale(Math.min(1, element.clientWidth / paper.offsetWidth))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])
  return <aside className="rx-preview" aria-label="Prescription preview">
    <div className="rx-preview-label"><span>A4 · prescription preview</span><span>210 × 297 mm</span></div>
    <div className="rx-paper-frame" ref={frame}><div style={{ zoom: scale }}>{children}</div></div>
    <p className="field-hint">Full letterhead prints on blank A4 paper. Long prescriptions continue on the next page.</p>
  </aside>
}
