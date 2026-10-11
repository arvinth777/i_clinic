# Initial production release evidence — 2026-10-11

Release PR #6: `f01a36b`, snapshot of tested source `c8b2c11`.
Vercel: `dpl_HqxBYMhJJ6dXv2Rm7s7bYBwfyrZX`, Production, Ready.
URL: https://iclinic-theta.vercel.app

Browser signed in as doctor at the main address and reception at the deployment
address to keep their sessions separate. Both use clinic-prod. Screenshots show
empty workspaces and a live queue dot. No patient data or passwords are shown.
Hanken Grotesk / 15px and no horizontal overflow verified on the doctor screen.

Backend smoke: both logins/role assignments, doctor report access, reception report
denial, empty visit queue, both realtime subscriptions and unauthenticated health
200/{ok:true}. Database lint zero errors; production migration history contains
the verified schema-only bootstrap. No staging fixture records were copied.

Fresh local PostgreSQL 17 install/retry/assertions: 32 RLS tables, exact restricted
anonymous RPC grants, one clinic/two stock points, no clinical/catalog/identity
copies, expected four publication members. A partial-schema test refused bootstrap
and preserved its existing row. Hosted staging permissions and prior workflow
evidence remain in STATUS; no real patient/payment transaction was run in prod.

User approved all four physical printer samples and explicitly requested immediate
production promotion. Browser offline reload remains unverified after network
emulation was denied; boundary replay tests pass. Backup/restore, R2 secrets and
external monitoring remain incomplete. Placeholder login IDs require the privately
delivered random passwords; they are not real recovery mailboxes.
