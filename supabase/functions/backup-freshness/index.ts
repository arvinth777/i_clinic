// Backup freshness check (docs/build-plan.md item 8, docs/architecture-
// spec.md's "Backup freshness" signal). Deliberately an outcome check, not
// a trigger-success check: a dormant GitHub Actions workflow, a dead R2
// credential, and a silently broken backup.sh are all invisible to "did
// the last scheduled run report success", but all show up identically as
// a stale bucket. An external uptime monitor (UptimeRobot) pings this on
// its own schedule -- wiring that up is a human-only step, see
// docs/runbook.md; until it's wired, this endpoint existing and passing
// proves nothing is actually being watched.
//
// Public on purpose, same posture as supabase/functions/health: an uptime
// monitor can't hold a session, and this returns nothing beyond
// {"ok":true/false} -- no object names, no bucket contents, no error
// text. verify_jwt is disabled for this function alone in
// supabase/config.toml (must ship with this file, same reasoning as
// health's own comment: a redeploy from the CLI would otherwise silently
// re-enable JWT verification).
//
// Lists the R2 bucket via its S3-compatible API using a read-only-scoped
// R2 API token (Object Read only -- separate from the write-scoped token
// scripts/backup.sh uses to upload, least privilege in both directions).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { S3Client, ListObjectsV2Command } from 'npm:@aws-sdk/client-s3@3'

const MAX_AGE_DAYS = 8

Deno.serve(async () => {
  try {
    const accountId = Deno.env.get('R2_ACCOUNT_ID')!
    const bucket = Deno.env.get('R2_BUCKET')!
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
        secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
      },
    })

    const { Contents } = await client.send(new ListObjectsV2Command({ Bucket: bucket }))
    const newest = (Contents ?? []).reduce<Date | null>((latest, obj) => {
      if (!obj.LastModified) return latest
      return !latest || obj.LastModified > latest ? obj.LastModified : latest
    }, null)

    const ageDays = newest ? (Date.now() - newest.getTime()) / (1000 * 60 * 60 * 24) : Infinity
    const ok = ageDays <= MAX_AGE_DAYS

    return new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    // Any failure (bad credentials, bucket unreachable, R2 down) is itself
    // "not fresh, can't prove otherwise" -- fail closed, never 200 on an
    // error just because the try block didn't reach the freshness check.
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
