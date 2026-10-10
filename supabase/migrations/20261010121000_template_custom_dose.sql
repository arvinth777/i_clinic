-- Saved sets must accept the same doctor-entered schedules as prescriptions.
alter table public.prescription_template_items drop constraint prescription_template_items_dosage_frequency_check;
alter table public.prescription_template_items add constraint prescription_template_items_dosage_frequency_check
  check (dosage_frequency is null or length(btrim(dosage_frequency)) between 1 and 200);
