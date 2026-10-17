#!/usr/bin/env python3
"""Build the manual PDF: render once, read heading page numbers from the PDF, rebuild the contents page, render again."""
import json, re, subprocess, sys, html as html_
from pathlib import Path
from pypdf import PdfReader
root = Path(__file__).resolve().parent.parent
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
out = root / 'iClinic-User-Manual.pdf'
def render():
    subprocess.run([CHROME, '--headless', '--disable-gpu', '--no-pdf-header-footer', f'--print-to-pdf={out}', (root / 'manual.html').as_uri()], check=True, capture_output=True)
def heads():
    html = (root / 'manual.html').read_text()
    return [(m.group(1), html_.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<span class="who[^>]*>.*?</span>', '', m.group(2)))).strip()) for m in re.finditer(r'<h[12] id="([^"]+)"[^>]*>(.*?)</h[12]>', html, re.S) if m.group(1) != 'toc']
def pages():
    r = PdfReader(str(out)); texts = [re.sub(r'\s+', ' ', p.extract_text() or '') for p in r.pages]
    found, start = {}, 2  # skip cover + contents
    for hid, title in heads():
        key = re.sub(r'\s+', ' ', re.sub(r'^Chapter \d+|^Appendix [A-Z]', '', title)).strip()
        for i in range(start, len(texts)):
            if key in texts[i]: found[hid] = i + 1; start = i; break
    return found, len(texts)
subprocess.run([sys.executable, str(root / 'build.py')], check=True); render()
pg, n = pages()
# contents may grow by a page; iterate until stable
for _ in range(3):
    (root / 'pages.json').write_text(json.dumps(pg))
    subprocess.run([sys.executable, str(root / 'build.py'), str(root / 'pages.json')], check=True); render()
    new, n = pages()
    if new == pg: break
    pg = new
print('pages:', n, 'headings located:', len(pg), '/', len(heads()))
