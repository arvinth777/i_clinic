# Corrected doctor and billing evidence — 2026-10-11

All records are synthetic staging fixtures. Desktop and mobile captures show the
corrected doctor layout, actual arrival acknowledgement and saved history. Body
font is Hanken Grotesk / 15px; document scroll width does not exceed 1440/390px.

`prescription-and-receipt.pdf` is the actual browser flow: 10 tablets prescribed,
3 supplied, ₹40 doctor discount, ₹240 Cash payment, shortfall 7, stock 17 from 20.
`printed-prescription.png` renders its first page with the English/Tamil header.
`print/` contains short (1), typical (1), long (4), receipt (1) and combined (5)
A4 page fixtures from the production renderer. All pass `print-pdf-check.py`.

These PDFs are browser output, not physical clinic-printer sign-off. Browser
network-offline reload was unavailable; offline queue replay and print asset
failure/cancellation were checked at their code boundaries instead.
