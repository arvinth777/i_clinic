#!/usr/bin/env bash
# Weekly backup job (docs/build-plan.md item 8, docs/architecture-spec.md's
# "Backup and recovery"). Run from GitHub Actions (.github/workflows/backup.yml),
# never from Vercel cron -- Vercel Hobby cron is once-daily and this needs a
# real pg_dump, which Vercel's serverless functions can't shell out to.
#
# pg_dump connects as `backup_reader` (supabase/migrations/20260907020000),
# a role with SELECT only -- never service_role, never postgres. Because
# Supabase Free's own backup/retention isn't reliable, this dump *is* the
# primary backup, not a supplement (docs/architecture-spec.md is explicit
# about this) -- treat a failure here as a real incident, not a shrug.
#
# Required environment variables (set as GitHub Actions secrets, never
# committed -- see docs/runbook.md for where each one comes from):
#   BACKUP_DB_URL        postgres connection string for backup_reader
#   R2_ACCOUNT_ID          Cloudflare account id
#   R2_ACCESS_KEY_ID       R2 API token, needs Object Write on R2_BUCKET
#   R2_SECRET_ACCESS_KEY   the matching secret
#   R2_BUCKET              destination bucket name
#
# The age PUBLIC key is committed in the repo (backup/age-public-key.txt)
# -- per this project's own security-review.md, nothing that grants access
# belongs in a committed file, but a public key grants nothing (only
# encryption, never decryption) so it's safe there. The PRIVATE key is a
# human-only artifact that must exist before the first backup ever runs
# (see docs/runbook.md) -- it is never an input to this script at all.

set -euo pipefail

: "${BACKUP_DB_URL:?BACKUP_DB_URL is required}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PUBLIC_KEY_FILE="$REPO_ROOT/backup/age-public-key.txt"
PUBLIC_KEY="$(grep -o 'age1[a-z0-9]*' "$PUBLIC_KEY_FILE")"

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

DUMP_FILE="$WORKDIR/clinic-backup-$STAMP.sql"
ENCRYPTED_FILE="$WORKDIR/clinic-backup-$STAMP.sql.gz.age"

echo "Dumping public schema via backup_reader..."
# --no-owner/--no-privileges: backup_reader isn't the owner of anything it
# reads, and a restore should never try to reassign ownership or replay
# grants for a role that may not exist on the restore target. public schema
# only -- auth.users (login accounts) is deliberately out of scope; a full
# disaster recovery recreates logins via the existing admin-create-login
# flow (docs/STATUS.md), not by restoring Supabase's own auth tables.
pg_dump "$BACKUP_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --format=plain \
  --file="$DUMP_FILE"

echo "Encrypting..."
gzip -c "$DUMP_FILE" | age -r "$PUBLIC_KEY" -o "$ENCRYPTED_FILE"

echo "Uploading to R2..."
aws s3 cp "$ENCRYPTED_FILE" "s3://$R2_BUCKET/$(basename "$ENCRYPTED_FILE")" \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  --no-progress

echo "Backup complete: $(basename "$ENCRYPTED_FILE")"
