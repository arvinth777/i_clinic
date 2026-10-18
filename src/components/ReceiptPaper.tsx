import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

// The bill is printed on 10 x 12 in stock. This draws that whole sheet at its real size and shrinks it to fit the column, so the
// on-screen preview has the same proportions and the same line breaks as the paper (it is not a separately laid-out thumbnail).
const SHEET_WIDTH_PX = 960 // 10 in at 96 dpi
const SHEET_HEIGHT_PX = 1152 // 12 in

export function ReceiptPaper({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.33)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / SHEET_WIDTH_PX))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={box} className="receipt-paper" style={{ height: SHEET_HEIGHT_PX * scale }}>
      <div className="receipt-paper-sheet" style={{ width: SHEET_WIDTH_PX, height: SHEET_HEIGHT_PX, transform: `scale(${scale})` }}>{children}</div>
    </div>
  )
}
