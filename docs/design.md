# Design system

The locked design system lives at **`/design.md`** (project root), per
Hallmark's multi-page `redesign` flow — genre, theme (OKLCH tokens), type
system, spacing/motion, and the per-page MUST-share/MAY-differ rules. Read
that file first for anything decision-level (colour, radius, font, card
language). This file stays only as the source-file map so nothing has to be
grepped for from scratch.

**v3 note:** the detailed extracted-from-code tables that used to live here
(colour token table, card language, responsive notes, "known
inconsistencies") were folded into or superseded by `/design.md` and removed
from this file to avoid keeping two documents in sync. Git history has the
old version if a past value or rationale is needed.

**Source files:**
- Tokens + font loading — `src/index.css`, `src/main.tsx` (`@fontsource/inter`, `@fontsource/jetbrains-mono` imports)
- Shell chrome — `src/components/AppShell.tsx` + `AppShell.css`
- Staging strip — `src/components/StagingBanner.tsx` + `.css`
- Reception content — `src/pages/Reception.tsx` + `Reception.css`
- Consultation content — `src/pages/Consultation.tsx` + `Consultation.css`, `src/components/PrescriptionForm.tsx`, `src/components/PricingPanel.tsx`
- Billing content — `src/components/Billing.tsx` + `Billing.css` (reuses `.record-area`/`.record-section`/`.pricing-block` from `Consultation.css`, since Vite bundles all statically-imported component CSS globally — there are no CSS Modules in this project)
- Token list / stage model — `src/components/TokenList.tsx`
- Forms — `src/components/NewPatientForm.tsx`, `src/components/SignIn.tsx`
