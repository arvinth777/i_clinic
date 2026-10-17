// TEMPORARY (user manual screenshots): never commit. Loaded with: await import('/__manual-helper.js')
window.__w = ms => new Promise(r => setTimeout(r, ms));
window.__shot = async (name, opts = {}) => {
  const m = await import('/node_modules/html2canvas-pro/dist/html2canvas-pro.esm.js');
  const h2c = m.default || m.html2canvas || m;
  await document.fonts.ready;
  const fix = document.createElement('style'); fix.textContent = 'details:not([open]) > :not(summary){display:none !important} summary{list-style:none !important} summary::-webkit-details-marker{display:none}'; document.head.appendChild(fix);
  const banner = document.querySelector('.staging-banner'); const prev = banner ? banner.style.display : '';
  if (banner) banner.style.display = 'none';
  const hidden = [...document.querySelectorAll('.offline-queue-banner')].filter(b => /PDFs? pending in Google Drive/.test(b.innerText)); hidden.forEach(b => { b.dataset.prevDisplay = b.style.display; b.style.display = 'none'; });
  if (opts.top) window.scrollTo({ top: 0, behavior: 'instant' });
  for (let i = 0, last = -1; i < 12 && last !== scrollY; i++) { last = scrollY; await window.__w(120); }
  await window.__w(150);
  const H = opts.height || innerHeight;
  try {
    const canvas = await h2c(document.body, { scale: 2, useCORS: true, backgroundColor: '#ffffff', width: innerWidth, height: H, windowWidth: innerWidth, windowHeight: innerHeight, x: scrollX, y: opts.y ?? scrollY, scrollX: 0, scrollY: 0, logging: false });
    const r = await fetch(location.protocol + '//' + location.hostname + ':5199/save?name=' + name, { method: 'POST', body: canvas.toDataURL('image/png') });
    return (await r.text()) + ' ' + canvas.width + 'x' + canvas.height;
  } finally { fix.remove(); hidden.forEach(b => { b.style.display = b.dataset.prevDisplay || ''; }); if (banner) banner.style.display = prev; }
};
window.__set = (el, v) => { const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
const vis = e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
window.__btn = (text, root = document) => { const all = [...root.querySelectorAll('button,a,summary,[role=tab]')].filter(vis); return all.find(b => b.innerText.trim() === text) || all.find(b => b.innerText.trim().startsWith(text)); };
window.__go = async h => { const menu = [...document.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('Menu') && b.offsetParent); if (menu) { menu.click(); await window.__w(450); } const a = [...document.querySelectorAll('a[href="#' + h + '"]')].filter(x => x.offsetParent).pop(); a.click(); await window.__w(2200); window.scrollTo({ top: 0, behavior: 'instant' }); await window.__w(300); return document.title; };
// keep the idle lock (2 min reception / 15 min doctor) from firing while screenshots are being taken
if (!window.__keepAlive) window.__keepAlive = setInterval(() => window.dispatchEvent(new Event('mousemove')), 15000);
// capture one element (document coordinates), with padding: await __shotEl('name', element, 16)
window.__shotEl = async (name, el, pad = 0, foreign = false) => {
  const m = await import('/node_modules/html2canvas-pro/dist/html2canvas-pro.esm.js');
  const h2c = m.default || m.html2canvas || m;
  await document.fonts.ready;
  const fix = document.createElement('style'); fix.textContent = 'details:not([open]) > :not(summary){display:none !important} summary{list-style:none !important} summary::-webkit-details-marker{display:none}'; document.head.appendChild(fix);
  const banner = document.querySelector('.staging-banner'); if (banner) banner.style.display = 'none';
  const hidden = [...document.querySelectorAll('.offline-queue-banner')].filter(b => /PDFs? pending in Google Drive/.test(b.innerText)); hidden.forEach(b => { b.style.display = 'none'; });
  const sticky = [...document.querySelectorAll('.rx-actions')]; sticky.forEach(b => { b.dataset.pd = b.style.display; b.style.display = 'none'; });
  await window.__w(150);
  const r = el.getBoundingClientRect();
  const x = Math.max(0, r.left + scrollX - pad), y = Math.max(0, r.top + scrollY - pad), w = r.width + pad * 2, h = r.height + pad * 2;
  try {
    const canvas = await h2c(document.body, { scale: 2, useCORS: true, backgroundColor: '#ffffff', x, y, width: w, height: h, windowWidth: innerWidth, windowHeight: innerHeight, scrollX: 0, scrollY: 0, logging: false, foreignObjectRendering: foreign });
    const res = await fetch(location.protocol + '//' + location.hostname + ':5199/save?name=' + name, { method: 'POST', body: canvas.toDataURL('image/png') });
    return (await res.text()) + ' ' + canvas.width + 'x' + canvas.height;
  } finally { fix.remove(); sticky.forEach(b => { b.style.display = b.dataset.pd || ''; }); hidden.forEach(b => { b.style.display = ''; }); if (banner) banner.style.display = ''; }
};
