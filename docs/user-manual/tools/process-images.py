"""Turn the raw 2x screenshots in ../screens into the figures used by the manual (../img).
Trims empty space below the content, crops the live A4 preview off editor shots (it is replaced by a native shot),
shrinks to at most 1600 px wide and reduces the palette: UI screenshots are flat colour, so this is lossless to the eye."""
import os, sys
from PIL import Image, ImageChops
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = os.path.join(HERE, '..', 'screens'); OUT = os.path.join(HERE, '..', 'img')
LEFT = {'doctor-prescription-empty', 'doctor-medicine-search', 'doctor-prescription-filled', 'doctor-review-step', 'doctor-template-added', 'doctor-save-template', 'doctor-prescription-confirmed', 'doctor-finish-area', 'doctor-issued-view'}  # keep x < 1520 (editor column)
TOPCUT = {'refills-form': 60}
WHITEOUT = {'settings-staff': (1285, 56, 1565, 206)}  # account menu was open over the Add login button (box in final 1600px coordinates)
# a leftover test template chip in the Quick add row (raw 2x coordinates: chip text x 231-806, next chip x 872-1152, row y)
CHIP_ROW = {'doctor-prescription-empty': 918, 'doctor-prescription-filled': 975, 'doctor-prescription-confirmed': 990}
def drop_test_chip(im, y):
    bg = im.getpixel((1400, y + 10)); box = (225, y - 8, 1160, y + 40)
    keep = im.crop((866, y - 8, 1160, y + 40)); im.paste(bg, box); im.paste(keep, (231, y - 8)); return im
def trim_bottom(im, pad=48):
    px = im.convert('RGB'); w, h = px.size
    last = px.crop((0, h - 1, w, h)); diff = ImageChops.difference(px, Image.new('RGB', (w, h)))  # placeholder to keep API simple
    y = h - 1
    bottom = px.crop((0, h - 1, w, h)).resize((w, 1))
    while y > 0:
        row = px.crop((0, y - 1, w, y))
        if ImageChops.difference(row, bottom).getbbox() is not None: break
        y -= 1
    return im.crop((0, 0, w, min(h, y + pad)))
for f in sorted(os.listdir(RAW)):
    if not f.endswith('.png') or f.startswith('t-') or f == 'a4-prescription.png': continue
    name = f[:-4]; im = Image.open(os.path.join(RAW, f)).convert('RGB')
    if name in CHIP_ROW: im = drop_test_chip(im, CHIP_ROW[name])
    if name in LEFT: im = im.crop((0, 0, 1520, im.size[1]))
    if name in TOPCUT: im = im.crop((0, TOPCUT[name], im.size[0], im.size[1]))
    im = trim_bottom(im)
    if im.size[0] > 1600: im = im.resize((1600, round(im.size[1] * 1600 / im.size[0])), Image.LANCZOS)
    if name in WHITEOUT: im.paste((255, 255, 255), WHITEOUT[name])
    im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(OUT, f), optimize=True)
# the native A4 shot is already 1:1
a4 = Image.open(os.path.join(RAW, 'a4-prescription.png')).convert('RGB'); a4.save(os.path.join(OUT, 'a4-prescription.png'), optimize=True)
print(len(os.listdir(OUT)), 'figures')
