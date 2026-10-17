-- The old doctor-approved payment path bypasses the revised requirement that
-- reception choose an active product with the prescribed molecule, strength
-- and unit. Keep the function for privileged historical maintenance, but do
-- not expose it to clinic accounts or anonymous clients. Existing paid rows
-- and their immutable snapshots are unchanged.
revoke execute on function public.confirm_bill(uuid, text, bigint, bigint, jsonb)
  from public, anon, authenticated;
