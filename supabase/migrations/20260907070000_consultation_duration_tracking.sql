-- Phase UI-4 (docs/STATUS.md): the app already tracks wait time
-- (arrived_at), but nothing records how long the doctor actually spent
-- with a patient once the consultation started -- a different number,
-- wanted purely for data reference later (a live clock now, a reporting
-- screen is explicitly not part of this phase).
--
-- Both columns are nullable, no default, and set only by the client
-- update that already flips `stage` at that exact transition
-- (Consultation.tsx's callNext / consultationDone) -- no new RPC, no new
-- trigger. This is additive to an already-permitted write, not a new
-- privilege boundary: the existing blanket `visits_update` policy
-- already lets doctor/receptionist update `stage` on this table (per
-- this file's own prior note that a blanket policy isn't enough to
-- enforce *which* role sets a given column) -- unlike follow_up_date/
-- is_long_term, nothing here needs a column-specific BEFORE UPDATE
-- guard, because there is no wrong-role case to prevent: the timestamp
-- is just a record of when a transition happened, not a decision that
-- needs restricting to one role. Duration is always computed as the
-- difference between the two, never stored as its own column, so it
-- can never drift out of sync with the timestamps it's derived from.
alter table public.visits
  add column with_doctor_at timestamptz,
  add column consultation_ended_at timestamptz;
