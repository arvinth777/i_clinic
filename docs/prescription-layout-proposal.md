# A4 prescription layout proposal

2026-10-10. A planning document, not implemented UI or a final print
spec. The user supplied the clinic letterhead, a body-layout reference,
and confirmed A4 with the full design printed on blank paper.

## References and confirmed intent

- [Clinic letterhead](references/salem-pain-clinic-letterhead.png):
  original 1055 × 1491 PNG, preserved unchanged.
- [Body reference](references/prescription-body-reference.png):
  patient details, chief complaints, diagnosis, two-column medicine
  rows, advice/investigations, review date, and signature area. This
  describes the intended content; its dark preview is not a request
  for a dark printed page.
- The user wants selectors and typing options. Treat medicine and
  instruction inputs as editable search/select fields, not selectors
  that restrict entry to a closed list.
- User's letterhead, header, watermark, and footer are the print identity.
  The web app's navigation and controls use its existing design tokens.

## Proposed placement

Use an A4 portrait page (210 × 297 mm). The letterhead's blue header
divider is about 64 mm from the top and its footer starts around
275 mm, when the image is mapped to the full page. These are estimates
from the source image, not printer-verified coordinates.

Recommended content bounds: left 12 mm, right 198 mm. Keep all variable
content beneath the header and above the footer. Use the existing Ref.
and Date line instead of adding a second competing date row.

| Region | Proposed placement on the full-page reference | Content |
| --- | --- | --- |
| Reference/date | Existing printed Ref./Date line, approx. y = 70–78 mm | Patient ID beside Ref.; visit date aligned with Date. Label the on-screen field Patient ID and do not confuse it with the changing queue token |
| Patient details | y = 82–99 mm | Name across the first row; age/sex and optional height/weight on a second row |
| Clinical context | Starts at y = 104 mm; height follows text | Chief complaints, then diagnosis; compact labels above editable text |
| Prescription | Follows clinical context, nominally y = 129 mm | Rx marker, then aligned medicine rows; left 12–126 mm for medicine/strength/instructions, right 132–198 mm for frequency, food timing, and duration |
| Advice | After the last medicine | Advice/investigations, when entered |
| Closing area | Final-page reservation approx. y = 250–267 mm | Review date on left, space for handwritten signature/registration on right |
| Footer | Source letterhead artwork starts approx. y = 275 mm | Existing clinic footer, untouched |

Only the letterhead and closing areas have reserved positions. Complaints,
diagnosis, medicines, and advice flow vertically; do not pin each medicine
to an absolute y coordinate or assume there are exactly three rows.
The two cells of a medicine share one row container, so wrapping a long
name cannot detach its dosage from it. A prescription that exceeds the
usable area continues onto another letterhead page with patient identity
and a page number. Never overlap the footer or shrink text indefinitely
to force one page. Exact page-break policy needs preview/print validation.

## How editing should work

Keep the current token and waiting count in app chrome outside the A4
document. Patient details and date fill automatically from the selected
visit; corrections use the patient/visit form rather than creating a
second copy of the identity inside the prescription.

| Field | Proposed editing control | Printed result |
| --- | --- | --- |
| Chief complaints | Text area, initially populated from reception; optional clinician-saved phrase suggestions | Doctor-reviewed complaint text |
| Diagnosis | Typed text with optional clinician-saved phrase suggestions | Entered diagnosis; no automatic diagnosis from complaints |
| Medicine | Searchable editable combo field; catalog matches and existing prescription templates | Medicine name and strength |
| Strength | Catalog options where available plus typing | Chosen/entered strength |
| Frequency | Common presets plus custom typed instructions | Explicit frequency text, e.g. 1-0-1 or the doctor's custom wording |
| Food timing | Common options plus custom wording | Food instruction |
| Duration | Typed day count with small common-duration suggestions | Duration in days |
| Route/special instructions | Editable text, with optional saved phrases | Instruction under the medicine name |
| Advice/investigations | Text area, with optional saved phrases | Entered advice |
| Review | Date input | Review date, only when set |

Use one field that supports selection and typing, rather than separate
Select and Type modes. Tab navigation should move naturally through each
row. No control borders, dropdown arrows, suggestions, Add/Remove buttons,
or empty placeholders print. The editor and preview use the same stored
values; no separately retyped prescription text.

Typing a new medicine label must not silently create a stock item or
assign a price. A dispensed/billed medicine needs a resolved catalog item
and an explicit stock/billing unit. Custom frequency wording must be
preserved as entered; do not guess a dispensed quantity from it. Duration,
frequency, and supplied quantity are separate values.

## Print behaviour to validate

- Render the full letterhead as a page image with an aligned content layer,
  preserving its aspect ratio. Locally retain the template and required
  visit data so browser print does not fetch them during an outage.
- The image has artwork at the paper edges. Provide an inset composition
  for ordinary printer margins; exact edge-to-edge output requires a
  capable printer. Scale the artwork and variable content together, never
  independently. Coordinates above describe the full-page reference,
  not a promise of a printer's final physical position.
- Prefer a normally printed image element over relying on a browser's
  optional background-graphics setting for the letterhead.
- Review a filled A4 preview with short/long names and instructions and
  enough medicine rows to force a second page; check wrapping, identity,
  footer clearance, and signature space. A physical print confirms the
  printer margins after the preview is agreed.
- No stored signature image or automatic signature is requested. Leave
  signing space; use the doctor's configured registration number.
- Patient-memory notes are private record content and do not automatically
  print. Only the selected prescription sections print; the receipt is a
  separate document and carries money/payment information.

## Existing code gaps

`PrescriptionForm.tsx` already has medicine search, templates, strength,
food, frequency, duration, quantity, and notes. Its food/frequency inputs
are closed selects; they do not yet provide the proposed typing workflow.
`Billing.tsx` prints a generic letterhead table. The proposed complaints,
diagnosis, advice, patient/vital fields, and uploaded-template composition
need a persistence/role-boundary review before implementation. Route is
not a dedicated field in the current draft type; decide whether existing
instruction text suffices before adding a column. Do not assume new fields
exist because they appear in this mockup reference.

## Interactive mockup — 2026-10-10

The user explicitly invoked `visualize`. The conversation now has two
editable alternatives using this letterhead: **On the page** and **Editor
beside preview**. Both support medicine/frequency suggestions plus typing,
custom strength/instructions, add/remove medicine rows, and a plain-text
print preview. The separate editor uses expandable medicine sections.
Optional host design controls adjust body placement, column widths,
medicine spacing, and vital visibility. No layout variant is chosen yet.

The durable source is
`/Users/arvinthcinmayankirupakaran/.codex/visualizations/2026/10/10/01a12480-851d-7e23-961e-222e97f93434/a4-prescription-studio.html`.
It embeds a compressed display copy of the supplied letterhead; the
original PNG remains unchanged in `docs/references/`. Contains sample
patient/medicine text, no live data or clinical recommendation. Only UI
layout choices, medicine row count, and preview mode go to widget state; edited clinical
text is not persisted to widget state or any server.

Local Chromium checks confirmed typing, cross-variant preview updates,
add/remove, overflow into additional pages, narrow layout, dark appearance,
and restored design settings. No runtime errors. Desktop visual inspection
confirmed body placement and header/footer clearance. Narrow previews
paginate more often to keep text readable; this is not physical print
pagination. A4 millimetre geometry, printer margins, persistence and
authorization still need production implementation/verification.

Next: choose/refine the editing layout and field placement before building.
No application screen, dependency, schema, or price calculation changed.
