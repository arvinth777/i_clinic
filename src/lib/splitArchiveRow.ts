// Split an oversized text row at measured word boundaries, retaining inline markup.
export function splitArchiveRow(row: HTMLTableRowElement, maxHeight: number): { row: HTMLTableRowElement; height: number }[] {
  const doc = row.ownerDocument
  const cells = [...row.cells]
  const offsets = cells.map(() => 0)
  const lengths = cells.map(cell => cell.textContent?.length ?? 0)
  const parts: { row: HTMLTableRowElement; height: number }[] = []
  function fragment(cell: HTMLTableCellElement, start: number, end: number) {
    const copy = cell.cloneNode(false) as HTMLTableCellElement
    const walker = doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    function boundary(offset: number): [Text, number] {
      for (const node of nodes) {
        if (offset <= node.length) return [node, offset]
        offset -= node.length
      }
      return [nodes.at(-1)!, nodes.at(-1)!.length]
    }
    if (start < end) {
      const label = cell.firstElementChild
      if (start > 0 && label?.tagName === 'STRONG' && start >= (label.textContent?.length ?? 0)) copy.append(label.cloneNode(true), doc.createTextNode(' (continued) '))
      const range = doc.createRange()
      range.setStart(...boundary(start)); range.setEnd(...boundary(end))
      copy.append(range.cloneContents())
    }
    return copy
  }
  while (offsets.some((offset, i) => offset < lengths[i])) {
    const part = row.cloneNode(false) as HTMLTableRowElement
    part.append(...cells.map((cell, i) => fragment(cell, offsets[i], offsets[i])))
    row.parentElement!.append(part)
    try {
      let progressed = false
      for (let i = 0; i < cells.length; i++) {
        const start = offsets[i]
        if (start === lengths[i]) continue
        let low = start, high = lengths[i]
        while (low < high) {
          const end = Math.ceil((low + high) / 2)
          part.cells[i].replaceWith(fragment(cells[i], start, end))
          if (part.getBoundingClientRect().height <= maxHeight) low = end
          else high = end - 1
        }
        let end = low
        const text = cells[i].textContent!
        // Prefer whole words; unbroken text still splits only between graphemes.
        if (end < lengths[i]) {
          const space = text.slice(start, end).search(/\s+\S*$/)
          if (space > 0) end = start + space + 1
          else {
            for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
              if (segment.index > low) break
              end = segment.index
            }
          }
        }
        if (end <= start) throw new Error('The print text cannot fit safely on a continuation page.')
        part.cells[i].replaceWith(fragment(cells[i], start, end))
        offsets[i] = end; progressed = true
      }
      if (!progressed || part.getBoundingClientRect().height > maxHeight) throw new Error('The print row cannot fit safely on a continuation page.')
      parts.push({ row: part, height: part.getBoundingClientRect().height })
    } finally { part.remove() }
  }
  return parts
}
