#!/usr/bin/env python3
"""Assemble manual.html from chapters/*.html, expanding figure macros and TOC page numbers.
Usage: build.py [pages.json]  (pages.json = {anchor: page} from a previous render)"""
import re, sys, json, glob, html
from pathlib import Path
here = Path(__file__).parent
pages = json.loads(Path(sys.argv[1]).read_text()) if len(sys.argv) > 1 else {}
def fig(m):
    name, cap, cls = (m.group(1).split('|') + ['', ''])[:3]
    c = f' class="{cls}"' if cls else ''
    return f'<figure{c}><img src="img/{name}.png" alt="{html.escape(cap)}"><figcaption>{cap}</figcaption></figure>'
def pair(m):
    items = m.group(1).split(';;')
    cls = 'pair w60' if m.group(0).startswith('{{pair60') else 'pair'
    out = []
    for it in items:
        name, cap = it.split('|', 1)
        out.append(f'<figure><img src="img/{name}.png" alt="{html.escape(cap)}"><figcaption>{cap}</figcaption></figure>')
    return f'<div class="{cls}">' + ''.join(out) + '</div>'
body = ''
toc = []
for f in sorted(glob.glob(str(here / 'chapters' / '*.html'))):
    body += Path(f).read_text() + '\n'
body = re.sub(r'\{\{fig:([^}]+)\}\}', fig, body)
body = re.sub(r'\{\{pair(?:60)?:([^}]+)\}\}', pair, body)
body = re.sub(r'\{\{phones:([^}]+)\}\}', lambda m: '<div class="phones">' + ''.join(
    f'<figure><img src="img/{a.split("|")[0]}.png" alt=""><figcaption>{a.split("|")[1]}</figcaption></figure>' for a in m.group(1).split(';;')) + '</div>', body)
# TOC from h1/h2 with ids
rows = []
for m in re.finditer(r'<(h1|h2) id="([^"]+)"[^>]*>(?:<span class="num">([^<]*)</span>)?(.*?)</\1>', body, re.S):
    tag, id_, num, title = m.groups()
    title = html.unescape(re.sub(r'<[^>]+>', '', re.sub(r'<span class="who[^>]*>.*?</span>', '', title))).strip()
    label = (num + '  ' if num and tag == 'h1' else '') + title
    pg = pages.get(id_, '')
    rows.append(f'<li class="{"ch" if tag=="h1" else "sec"}"><span>{label}</span><span class="dots"></span><span class="pg">{pg}</span></li>')
tochtml = '<section class="toc"><h1 id="toc">Contents</h1><ol>' + ''.join(rows) + '</ol></section>'
cover = (here / 'cover.html').read_text()
doc = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>iClinic user manual</title><link rel="stylesheet" href="manual.css"></head><body>{cover}{tochtml}{body}</body></html>'
(here / 'manual.html').write_text(doc)
print('built', len(rows), 'toc rows')
