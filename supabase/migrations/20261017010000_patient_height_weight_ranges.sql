-- patients.height_cm / weight_kg exist since the core schema (plain numeric, never used by the app).
-- The registration form now captures them; bound them like age so a typo (1650 cm, 0 kg) cannot be saved.
-- NOT VALID: enforced for every new or changed row; existing rows are not re-checked (same as patients_age_range).
alter table public.patients
  add constraint patients_height_range check (height_cm is null or height_cm between 30 and 260) not valid,
  add constraint patients_weight_range check (weight_kg is null or weight_kg between 1 and 400) not valid;
