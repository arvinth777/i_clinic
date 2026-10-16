import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import html2canvas from 'html2canvas-pro'
import { PDFDocument, PageSizes } from 'pdf-lib'
import { PrintablePrescription, PrintableReceipt, type PrintVisit, type ClinicPrintInfo, type DetailRow, type BillLine, type Bill } from '../components/VisitPrintout'

export type ArchiveSnapshot = { kind: 'prescription' | 'receipt'; clinic: ClinicPrintInfo; visit?: PrintVisit; medicines?: DetailRow[]; customerName?: string; billable?: BillLine[]; amountPaise?: number; discountPaise?: number; bill?: Bill }

// Render the issued snapshot with the existing print components and their local fonts/assets.
export async function renderArchivePdf(snapshot: ArchiveSnapshot): Promise<Blob> {
  const frame = document.createElement('iframe')
  frame.title = 'Preparing archived PDF'
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', left: '0', zIndex: '-1', pointerEvents: 'none', top: '0', width: 'var(--paper-width)', height: 'var(--paper-height)', border: '0' })
  document.body.append(frame)
  const doc = frame.contentDocument!
  const rootElement = doc.createElement('div'); rootElement.className = 'print-area'; rootElement.style.setProperty('display','block','important'); doc.body.append(rootElement)
  const root = createRoot(rootElement)
  try {
    const style = doc.createElement('style')
    style.textContent = [...document.styleSheets].map(sheet => { try { return [...sheet.cssRules].map(rule => rule.cssText).join('\n') } catch { throw new Error('Print styles are not available on this device. Reload the app before retrying the archive.') } }).join('\n').replaceAll('@media print', '@media all').replace(/body \*[^{}]*\{[^{}]*\}/g, '').replace(/body :(?:has|not)\(\.print-area\)[^{]*\{[^{}]*\}/g, '')
    style.textContent += '\n.html2canvas-container { display:block !important; visibility:visible !important; }'
    doc.head.append(style)
    const base = doc.createElement('base'); base.href = document.baseURI; doc.head.prepend(base)
    flushSync(() => root.render(snapshot.kind === 'prescription'
      ? <PrintablePrescription clinic={snapshot.clinic} visit={snapshot.visit!} medicines={snapshot.medicines ?? []} />
      : <PrintableReceipt clinic={snapshot.clinic} visit={snapshot.visit} customerName={snapshot.customerName} billable={snapshot.billable ?? []} amountPaise={snapshot.amountPaise!} discountPaise={snapshot.discountPaise!} bill={snapshot.bill!} />))
    await Promise.all([...doc.fonts].map(font=>font.load()))
    await doc.fonts.ready
    await Promise.all([...doc.images].map(image => image.decode()))
    // A serialised SVG cannot fetch its external images or font files.
    async function inlineAsset(path:string){
      const url=new URL(path,document.baseURI)
      if(url.origin!==location.origin)throw new Error('Print assets must be stored in the app.')
      const response=await fetch(url)
      if(!response.ok)throw new Error('Print artwork or fonts are unavailable on this device.')
      const blob=await response.blob()
      return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob)})
    }
    await Promise.all([...doc.querySelectorAll('svg image')].map(async element=>element.setAttribute('href',await inlineAsset(element.getAttribute('href')!))))
    const fontRules=[...doc.styleSheets].flatMap(sheet=>[...sheet.cssRules]).filter(rule=>rule.type===CSSRule.FONT_FACE_RULE)
    const embeddedFonts=await Promise.all(fontRules.map(async rule=>{
      let css=rule.cssText
      for(const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g))css=css.replace(match[0],`url("${await inlineAsset(match[1])}")`)
      return css
    }))
    for(const svg of doc.querySelectorAll('svg')){const fonts=doc.createElementNS('http://www.w3.org/2000/svg','style');fonts.textContent=embeddedFonts.join('\n');svg.prepend(fonts)}
    const original = rootElement.querySelector<HTMLElement>('section')!
    const width = frame.contentWindow!.innerWidth, height = width * 297 / 210
    const pdf = await PDFDocument.create()
    const pages: HTMLElement[] = []
    if (snapshot.kind === 'prescription') {
      const table = original.querySelector('table')!, body = table.tBodies[0]
      const rows = [...body.rows].filter(row => !row.classList.contains('prescription-fill'))
      const patient = rows[0], labels = rows.find(row => row.classList.contains('prescription-column-labels'))!
      const capacity = height - table.tHead!.getBoundingClientRect().height - table.tFoot!.getBoundingClientRect().height
      let page = original.cloneNode(true) as HTMLElement, used = 0
      let target = page.querySelector('tbody')!; target.replaceChildren()
      function finish() { const fill = body.querySelector('.prescription-fill')!.cloneNode(true); target.append(fill); pages.push(page) }
      for (const row of rows) {
        const rowHeight = row.getBoundingClientRect().height
        if (rowHeight > capacity) throw new Error('A prescription paragraph is longer than a page. Split it into shorter paragraphs before archiving.')
        if (used + rowHeight > capacity) {
          finish(); page = original.cloneNode(true) as HTMLElement; target = page.querySelector('tbody')!; target.replaceChildren(patient.cloneNode(true), labels.cloneNode(true)); used = patient.getBoundingClientRect().height + labels.getBoundingClientRect().height
        }
        if (used + rowHeight > capacity) throw new Error('A prescription row cannot fit safely on its continuation page.')
        target.append(row.cloneNode(true)); used += rowHeight
      }
      finish()
    } else {
      // Receipts repeat clinic/customer context, and retain totals/payment only on the last page.
      const rows = [...original.querySelectorAll('tbody tr')]
      let page = original.cloneNode(true) as HTMLElement
      let target = page.querySelector('tbody')!; target.replaceChildren()
      const rowHeight = rows.map(row => row.getBoundingClientRect().height)
      const capacity = height - (original.getBoundingClientRect().height - rowHeight.reduce((a,b) => a+b,0))
      let used = 0
      const groups = [...rows.slice(0,-2).map((row,i)=>({rows:[row],height:rowHeight[i]})),{rows:rows.slice(-2),height:rowHeight.slice(-2).reduce((a,b)=>a+b,0)}]
      for (const group of groups) {
        if (group.height > capacity) throw new Error('A receipt line is longer than one page.')
        if (used + group.height > capacity) { page.querySelector('section > p:last-child')?.remove(); pages.push(page); page = original.cloneNode(true) as HTMLElement; target=page.querySelector('tbody')!; target.replaceChildren(); used=0 }
        target.append(...group.rows.map(row=>row.cloneNode(true))); used+=group.height
      }
      pages.push(page)
    }
    flushSync(() => root.render(null))
    for (let i=0;i<pages.length;i++) {
      const page = pages[i]
      Object.assign(page.style, { width: `${width}px`, height: `${height}px`, minHeight: `${height}px`, boxSizing:'border-box', overflow:'hidden' })
      const letterhead=page.querySelector<SVGElement>('.prescription-letterhead');if(letterhead)letterhead.style.position='absolute'
      rootElement.append(page)
      if (page.getBoundingClientRect().height < 1) throw new Error('The print layout could not be measured.')


      const canvas = await html2canvas(page, {scale:2,backgroundColor:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),width,height,windowWidth:width,windowHeight:height,logging:false})
      const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data
      let ink=0;for(let pixel=0;pixel<pixels.length;pixel+=64)if(Math.min(pixels[pixel],pixels[pixel+1],pixels[pixel+2])<200)ink++
      if(ink<100)throw new Error('The PDF page rendered blank. The issued record is safe; retry after reloading the app.')
      const jpeg=await pdf.embedJpg(canvas.toDataURL('image/jpeg',0.95))
      const outputPage=pdf.addPage(PageSizes.A4)
      outputPage.drawImage(jpeg,{x:0,y:0,width:outputPage.getWidth(),height:outputPage.getHeight()})
      page.remove()
    }
    const result = new Blob([new Uint8Array(await pdf.save())],{type:'application/pdf'})
    if (result.size > 25 * 1024 * 1024) throw new Error('The archived PDF exceeds 25 MB. Keep the issued record and retry after reducing its length.')
    return result
  } finally { root.unmount(); frame.remove() }
}
