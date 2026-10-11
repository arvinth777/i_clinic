# Clinic UI handoff decisions — 2026-10-10

User-approved addendum. These decisions supersede `CODEX_BRIEF.md`, the initial
handoff assessment, and conflicting older queue/pricing requirements. Where this
document is silent, `docs/rework-brief.md` governs. This is the target behaviour;
implementation and verification status live in `docs/STATUS.md`.

## Prices and discounts

1. Both the doctor and reception may edit catalog unit prices.
2. Only the doctor may give a discount on a bill.
3. Every price change is logged with user, time, medicine, old price and new price.
4. Bill lines snapshot the unit price at the moment the doctor approves the bill.
   Price changes made afterwards apply only to new bills.
5. Change billing copy from “Prices and discount are set by the doctor · locked”
   to “Discount set by the doctor”. Keep “Ask doctor to change discount”.

The existing ₹250 consultation fee and name-only refill workflow remain in force.
Refills retain the existing exception allowing reception to confirm saved catalog
prices without doctor approval; only the doctor can discount them.

## Queue: reorder, not here, no-show

This replaces strict physical-arrival ordering.

1. Reception can move a waiting patient up or down, with an optional reason
   (for example emergency, elderly or palliative). Each move is logged and shown
   on the doctor's waiting list as “moved up by reception” or the actual direction.
2. Reception marks an absent called patient **Not here**. Call next skips them;
   they stay visible with the marking time. Reception can return them to their
   original queue position or the end.
3. After the no-show time, reception can mark a Not here visit **No-show**.
   The default is 30 minutes, configurable in Settings. Prompt reception when
   time passes; never remove someone automatically. Retain the no-show visit
   record, remove it from today's active queue, and allow later check-in with a
   new token.
4. After the doctor calls a token, reception taps **Sent in**. Until then the
   doctor sees “Called · waiting for reception”; afterwards “Reception sent #N
   in”. Both screens update in realtime through invalidation/refetch.
5. Statuses become `waiting → called → with_doctor → ready_to_bill → paid`,
   plus `not_here` and `no_show`.

## Prescription filling

1. Diagnosis and advice/investigations are saved fields, introduced through a
   migration with doctor write permission. Show them in history, retain them in
   offline print snapshots, and print both on the letterhead.
2. Finish blocks without at least one medicine, or when any medicine lacks a
   dose (or SOS) or duration. Missing diagnosis and review date produce reminders
   that do not block sending. Review date remains `visits.follow_up_date`, using
   the existing `CarePanel` model. Existing unit/quantity validation remains.
3. **Finish** and **Call next** are separate actions. Finishing never calls the
   next patient automatically.
4. Skip/drafts are out of scope. Preserve protection against losing an edit.
5. Implement only the NSAID-allergy check using the patient's recorded allergy
   data. A warning requires **Remove** or **Keep**, and the choice is logged.
   Duplicate-class and interaction warnings wait for a real interaction source.
6. Supplied quantity stays explicit in the confirmed billing/stock unit.
   For tablets and capsules, suggest dose × days as a starting value for the
   doctor to confirm or edit. Never suggest for bottles, tubes or SOS. Never cap
   the prescription at stock; low stock is a notice only.

## Partial dispensing

1. Reception may supply less than prescribed, never more than the approved
   quantity and never more than current stock.
2. Payable = supplied quantity × snapshotted unit price + consultation − the
   doctor's discount.
3. The discount is a fixed rupee amount, reduced only when it exceeds the new
   subtotal. Store and calculate it in integer paise.
4. A reduction needs no fresh doctor approval. Record each item's shortfall on
   the bill and show it to the doctor in visit history.
5. Increasing a line beyond the approved quantity requires doctor re-approval.

Existing procedure charges remain supported under the rework brief. A reduction
in medicine supply must not remove approved procedure charges or change paid
bills. Pharmacy sales retain their name-only workflow.

## Definition of done

Deliver one pull request per step in `docs/ui-handoff-plan.md`. A step is done
only when its applicable evidence is recorded:

1. **Visual:** reference layout at 1440 px and working 390 px layout without
   sideways page scrolling.
2. **Roles:** doctor and reception permissions tested against the backend,
   not only hidden controls.
3. **Money:** integer paise; tests cover rounding, discount, partial supply and
   retry/idempotency.
4. **Offline:** actions survive reload while offline; pending state remains
   visible until sync succeeds.
5. **Printing:** every printed output checked with the real clinic printer and
   real paper, with a photo or PDF saved as evidence, including continuation pages.
6. **Regression:** existing features absent from the mockups still work.
7. **Review:** security check of changed data paths and code review before merge.

For a documentation-only step, explicitly record runtime checks as not applicable;
that is not evidence that the implementation or clinical release passes them.
An implementation with missing hardware evidence remains awaiting sign-off.

## Physical print sign-off

Before release, print short, typical and continuation-page prescriptions, plus
one receipt, on the clinic printer. Confirm letterhead alignment and no clipping.
Save evidence and the user's sign-off against the tested revision. A browser PDF
alone verifies rendering, not physical printer alignment. Release only after
sign-off. No physical printer checks or sign-off have occurred yet.

## Clarification during implementation — 2026-10-10

The user confirmed there is no existing allergy source: the allergy information
in the handoff is mock data. They explicitly authorized rewriting the entire
frontend as needed to match the supplied HTML. Visual fidelity is the priority
of this integration; preserve real app workflows and do not fabricate clinical
warnings or introduce a new allergy data model from the sample. This supersedes
the earlier assumption that existing allergy data was already held.
