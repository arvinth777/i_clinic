"""Check browser PDFs from print-layout-fixtures.mjs (requires Poppler)."""
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("docs/evidence/vector-letterhead")
ns = {"p": "http://www.w3.org/1999/xhtml"}
for name, medicine_count, receipt in [
    ("short", 1, False), ("typical", 5, False), ("long", 30, False),
    ("receipt", 0, True), ("combined", 30, True),
]:
    data = subprocess.check_output(["pdftotext", "-bbox", str(folder / f"{name}.pdf"), "-"], text=True)
    pages = ET.fromstring(data).findall(".//p:page", ns)
    image_info = subprocess.check_output(["pdfimages", "-list", str(folder / f"{name}.pdf")], text=True)
    images = [line.split() for line in image_info.splitlines() if line.split() and line.split()[0].isdigit()]
    all_text = []
    for index, page in enumerate(pages):
        words = page.findall("p:word", ns)
        text = " ".join(word.text or "" for word in words)
        all_text.append(text)
        assert abs(float(page.attrib["width"]) - 595.28) < 1, "Paper must be A4"
        assert abs(float(page.attrib["height"]) - 841.89) < 1, "Paper must be A4"
        if receipt and index == len(pages) - 1:
            assert "Receipt" in text and re.search(r"₹\s*270\.00", text), "Receipt must retain its frozen total"
            assert "Synthetic medicine" not in text, "Prescription must not spill onto receipt"
            continue
        assert "CURING CENTRE" in text and "SALEM PAIN" in text, "Every Rx page needs its letterhead"
        assert "#12" in text, "Continuation pages must repeat the patient reference"
        artwork = {(int(row[3]), int(row[4])) for row in images if int(row[0]) == index + 1}
        assert {(162, 162), (455, 450)} <= artwork, "Every Rx page needs its logo and watermark"
        for position, word in enumerate(words[:-1]):
            if word.text == "Synthetic" and words[position + 1].text == "medicine":
                assert 205 <= float(word.attrib["yMin"]) < 740, "Medicine overlaps header/footer"
    text = " ".join(all_text)
    for number in range(1, medicine_count + 1):
        assert len(re.findall(rf"Synthetic medicine {number}(?!\d)", text)) == 1, f"Medicine {number} lost or duplicated"
    if medicine_count > 5:
        assert len(pages) > 1 + int(receipt), "Long Rx must continue onto another page"
    else:
        assert len(pages) == 1, "Short documents must not add blank pages"
    print(f"PASS: {name}, {len(pages)} A4 page(s), all medicines and writing areas intact")
