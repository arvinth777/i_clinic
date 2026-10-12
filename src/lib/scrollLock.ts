// Overlays (drawer, lock screen, confirmation, document preview) all freeze the page behind them. Saving and restoring
// the "previous" value per overlay breaks when two close in the same render: the last restore wins and can leave the
// page locked. One shared count fixes that: the first lock saves the value, the last unlock restores it.
let locks = 0
let saved = ''

export function lockPageScroll() {
  const root = document.documentElement
  if (locks++ === 0) { saved = root.style.overflow; root.style.overflow = 'hidden' }
  let released = false
  return () => {
    if (released) return
    released = true
    if (--locks === 0) root.style.overflow = saved
  }
}
