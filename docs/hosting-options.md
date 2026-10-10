# Hosting options — 2026-10-10

Recommendation only; the user is considering MongoDB and student benefits.
No backend migration, subscription, or benefit redemption is agreed.

Keep PostgreSQL/Supabase during the rework. The existing application depends on
Supabase Auth, Realtime, RLS, SQL functions, and 40 migrations. Replacing the
database means redesigning those integrations and verifying financial, stock,
and access-control behaviour again. MongoDB can support transactions; the cost
here is replacing the existing implementation, not an inability to do billing.

| Option | Current primary-source facts | Implication for this project |
|---|---|---|
| Supabase Free | 500 MB database, 1 GB file storage; low activity over 7 days can pause it | Suitable during development; inactivity is a real production concern |
| Supabase Pro | From $25/month, first project included; additional projects from $10/month; 8 GB database per project and 100 GB file storage; no inactivity pausing | Smallest backend change for reliable daily clinic use; two paid projects cost more than the headline price |
| MongoDB Atlas | Pack gives $50 credits; Free has 512 MB including indexes and pauses after 30 inactive days | Does not solve either concern permanently; would require a substantial rewrite |
| Appwrite Education | Pack currently offers two Pro-equivalent projects for six months; provider begins enforcing that term November 1, 2026 | Temporary learning benefit, not a permanent free clinic backend; also requires integration changes |
| Heroku | Pack offers $13/month credit for 24 months | Potential hosting budget relief if a different backend is chosen; not a drop-in Supabase replacement |

Use the Pack selectively: 1Password (one year) for maintainer credentials;
Sentry (student monitoring allocation, one year renewable) for errors with patient
data excluded and replay disabled on clinical screens; BrowserStack (one mobile
automation parallel/user for one year) if actual mobile testing is needed.
Avoid another authentication provider or database solely because it is included.

Database records and binary files are separate storage needs. Preserve patient,
visit, bill, and stock records in the database; measure expected scans/PDF/audio
volume before choosing private file storage. Voice recording remains exploratory.
Student credits and plan terms expire; budget for the service after the offer.

Sources checked:

- [GitHub Student Developer Pack](https://education.github.com/pack?sort=az)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Atlas storage limits](https://www.mongodb.com/docs/atlas/manage-clusters/)
- [Atlas inactivity pausing](https://www.mongodb.com/docs/atlas/pause-terminate-cluster/)
- [Appwrite six-month Education enforcement announcement](https://appwrite.io/changelog/entry/2026-09-30)

Limits are current observations, not guaranteed entitlements for the user's account.
