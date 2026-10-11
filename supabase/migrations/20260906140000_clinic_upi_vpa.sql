-- Per-clinic UPI payee address (VPA), needed for the billing screen's UPI
-- QR code. Nullable: a real clinic may not have this configured yet (there
-- is no dedicated Admin/Settings field for it -- that screen isn't built
-- yet either) -- the billing screen shows a plain "not configured" message
-- instead of a QR when it's null, rather than fabricate a payee id that
-- doesn't exist.
alter table public.clinics add column upi_vpa text;

-- Synthetic value for the staging seed clinic only (same footing as the
-- rest of 20260905190153_seed_synthetic_phase1_data.sql -- no real payment
-- details anywhere in this repo).
update public.clinics set upi_vpa = 'clinic-a-staging@upi' where name = 'Clinic A (staging seed)';
