#!/usr/bin/env bash
# Restore drill for the weekly backup (docs/runbook.md "Backups"). Run it yourself: it needs the age PRIVATE key,
# which only you hold. The key is read from the clipboard (never a file, never printed), the decrypted dump lives
# in a temporary folder that is deleted on exit, and only table names and row COUNTS are printed.
#
#   bash scripts/backup-restore-drill.sh ~/Downloads/clinic-backup-<timestamp>.sql.gz.age
#
# Optional second level: set RESTORE_DB_URL to a SCRATCH Postgres (never staging or production) and the script
# also replays the whole dump into it, proving the file restores with plain psql.

set -euo pipefail

FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "usage: bash scripts/backup-restore-drill.sh path/to/clinic-backup-....sql.gz.age" >&2; exit 1; }
for tool in age gunzip pbpaste pbcopy awk; do command -v "$tool" >/dev/null || { echo "missing tool: $tool" >&2; exit 1; }; done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; printf "" | pbcopy' EXIT

echo "Copy the line that starts AGE-SECRET-KEY- from your password manager to the clipboard, then press Enter."
read -r _
pbpaste | age -d -i - -o "$WORK/dump.sql.gz" "$FILE" || { echo "Decryption failed: wrong key for this file?" >&2; exit 1; }
printf "" | pbcopy
echo "Decrypted. Clipboard cleared."

gunzip "$WORK/dump.sql.gz"
SIZE="$(wc -c < "$WORK/dump.sql" | tr -d ' ')"
grep -q '^-- PostgreSQL database dump' "$WORK/dump.sql" || { echo "This does not look like a pg_dump file." >&2; exit 1; }
echo "Dump size: $SIZE bytes"

# Plain-format dumps carry each table's rows in a COPY ... FROM stdin; block that ends with a line holding \.
COUNTS="$(awk '/^COPY public\./ { t = $2; n = 0; inb = 1; next } inb && /^\\\.$/ { print t, n; inb = 0; next } inb { n++ }' "$WORK/dump.sql")"
TABLES="$(printf '%s\n' "$COUNTS" | grep -c . || true)"
echo
echo "Rows per table (the restore drill compares these with what you expect):"
printf '%s\n' "$COUNTS" | sed 's/^/  /'
echo
echo "$TABLES tables found in the dump."

FAIL=0
count_of() { printf '%s\n' "$COUNTS" | awk -v t="public.$1" '$1 == t { print $2 }'; }
for t in clinics patients visits user_roles; do
  c="$(count_of "$t")"
  if [ -z "$c" ] || [ "$c" -lt 1 ]; then echo "CHECK FAILED: public.$t has no rows (expected at least 1)"; FAIL=1; fi
done
[ "$TABLES" -ge 30 ] || { echo "CHECK FAILED: fewer than 30 tables in the dump"; FAIL=1; }

if [ -n "${RESTORE_DB_URL:-}" ]; then
  echo
  echo "Replaying the dump into RESTORE_DB_URL (a scratch database)..."
  psql "$RESTORE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/dump.sql" >/dev/null && echo "Restore into the scratch database succeeded." || { echo "RESTORE FAILED"; FAIL=1; }
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "PASS: the backup decrypts and contains the clinic's data."; else echo "FAIL: see the messages above."; exit 1; fi
