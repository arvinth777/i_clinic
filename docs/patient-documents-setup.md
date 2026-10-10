# Patient documents in Google Drive

Integrated from `codex/clinic-drive-documents` into `codex/clinic-drive-integration`, based on the released app. The unshipped migration is dated after the production bootstrap; its SQL content is unchanged. Nothing in this branch
connects a Google account or deploys a database/function automatically.

## What is included

The doctor's patient profile has a Documents tab for PDF, JPG and PNG files,
up to 25 MiB each. Each file has a title, category (MRI, X-ray, lab report,
discharge summary or other), optional examination date and note. Images and
PDFs open in the app, with Download and Open in Drive alternatives. PDF viewing
uses the browser's native PDF viewer; some mobile browsers prefer download.
These are ordinary scanned files, not DICOM studies or a diagnostic viewer.

Supabase keeps patient links and metadata. Google Drive keeps the bytes in a
private `Clinic patient documents` folder. Files have generated identifiers
as names; patient names, titles and notes are not added to Drive metadata.
Uploaded document contents can of course contain patient information.
No public sharing permission is created.

Doctor-only access preserves the clinic's existing clinical-history rule.
Reception has no API, SQL or UI access to these documents or Google credentials.
A doctor connects the clinic account once; the backend refreshes access for
subsequent requests. Staff do not need to sign into Google for the in-app
viewer. **Open in Drive** requires a browser signed into the connected Google
account, or another account the clinic has separately permitted.

## One-time setup when the account is ready

Creating a Google account alone is not enough: Google also needs an OAuth app
registration. Once the following is configured, the clinic's recurring setup
is simply **Documents → Connect Google Drive → sign in and approve access**.

1. Create the clinic Google account and a Google Cloud project owned by the
   clinic. Enable **Google Drive API** in that project.
2. Configure Google Auth Platform branding, audience and data access. Request
   only `https://www.googleapis.com/auth/drive.file`. This is Google's
   non-sensitive, per-file scope; it allows this app's uploads, not a search
   through the account's existing unrelated files. Add the clinic account as
   a test user while testing. Use separate test and clinic accounts/folders
   for staging and production.
3. Create an OAuth client of type **Web application**. Register the exact
   redirect URI `https://YOUR-APP-HOST/?drive_callback=1`. The origin must match
   `CLINIC_APP_URL`. A local test client can instead register
   `http://127.0.0.1:5192/?drive_callback=1`. Do not register wildcard preview URLs.
4. Before long-term use, move the OAuth app out of Testing, following Google's
   publishing requirements. With Drive access, an external app left in Testing
   receives refresh tokens that expire after seven days. Publishing does not
   guarantee access forever; revoked/expired access shows a reconnect action.
5. Store the following as **Supabase Edge Function secrets**, separately in each
   environment. Never put them in a `VITE_*` variable, Git, chat or screenshots:

   | Secret | Value |
   | --- | --- |
   | `CLINIC_APP_URL` | Exact deployed app URL, e.g. `https://clinic.example` |
   | `GOOGLE_DRIVE_CLIENT_ID` | Web OAuth client ID |
   | `GOOGLE_DRIVE_CLIENT_SECRET` | Web OAuth client secret |
   | `GOOGLE_DRIVE_ENCRYPTION_KEY` | Base64 encoding of 32 cryptographically random bytes |

   Keep the encryption key in the clinic's password manager. Replacing it
   without re-encrypting existing credentials requires reconnecting Drive.
   The standard Supabase URL/anon/service-role environment variables are
   supplied to the function by Supabase. The service-role key stays server-side.
6. Follow `docs/runbook.md`: review the migration list/actual project target,
   apply `20261011120000_patient_drive_files.sql` through the CLI to staging,
   deploy the `patient-documents` Edge Function with JWT verification enabled,
   and deploy the frontend. Test with synthetic files first. Production remains
   a separate reviewed promotion in the clinic's release window. Do not apply
   unrelated pending migrations blindly.
7. Sign into the clinic app **as the doctor**, open any patient → Documents,
   select Connect Google Drive, and consent using the clinic Google account.
   The app creates its private folder automatically. Test PDF and photo uploads,
   refresh, preview, download, permission denials and a network interruption.

Google references: [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[refresh token expiry](https://developers.google.com/identity/protocols/oauth2#expiration).

## Failure and recovery behaviour

- Add document persists the original file bytes and metadata to IndexedDB
  before clearing the form. The header and document row remain pending until
  the backend confirms the upload. Reloading while offline retains them.
- This local copy is temporary storage, not a backup: clearing browser data,
  private browsing, disk loss or browser storage eviction can remove it.
  Keep the original until the upload is confirmed. Storage quota failures leave
  the form/file selection in place and display an error.
- The upload queue belongs to the clinic account that added the file. Switching
  accounts does not replay another user's files. Document failures do not block
  the separate billing/clinical write queue.
- Retries retain the same document and Drive IDs. A lost response does not
  create a second visible document. This implementation retries the whole file
  (maximum 25 MiB), rather than persisting resumable chunk offsets.
- A 4xx error waits for explicit Retry; network/server errors retry while the
  app is open. Setup, storage-full and authorization errors never count as saved.
- Disconnect clears the server's refresh credential but does not delete files,
  change their sharing or revoke Google's account-level grant. Google Account
  settings can revoke that grant separately. Reconnect must use the same clinic
  Google account so older records remain accessible.
- Do not rename/move the managed folder out of the app's access, share it
  publicly, or replace/delete managed files directly in Drive. Missing files
  show an error; edited files fail the stored checksum check and must be added
  as a new document. There is no file deletion or account-migration feature.
- Patient merges preserve uploaded file links. Finish pending uploads before
  merging patients; an upload still queued for the removed patient must be
  removed locally and added to the surviving profile.
- The database backup contains links, not Drive file bytes. Include the clinic
  Drive account in the clinic's backup/recovery process separately.

## Verification and release gates

Run with Node 24 from the checkout:

```sh
node scripts/patient-documents-test.mjs
node scripts/document-upload-queue-test.mjs
node scripts/offline-queue-owner-test.mjs
node scripts/prescription-draft-test.mjs
npm run lint
npm run build
```

The SQL test runs the actual new migration and RLS checks in a transaction on
an **empty disposable local PostgreSQL database**, then rolls it back:

```sh
PATIENT_DOCUMENT_TEST_DB=postgresql://localhost:55440/clinic_document_test node scripts/patient-documents-sql-test.mjs
```

It intentionally rejects remote database URLs and other database names. It
uses a minimal fixture for existing tables; it does not replace a staging
migration test against the full existing schema.

For the saved-file UI fixture, run Vite locally and open
`/scripts/fixtures/patient-documents/preview.html`. It renders the production
component with synthetic responses and blocks unrelated external requests.
This fixture is not bundled into production. Do not click its synthetic Drive
link as if it were a real saved file.

Local checks cover doctor/reception/other-clinic/anonymous access, protected
credentials, one-use OAuth state, encryption integrity, metadata and file
validation, upload retries, merge preservation and account-bound offline saves.
Chrome checks cover actual IndexedDB persistence across an offline production
reload, 1440/390px rendering, PDF viewing, dialog keyboard dismissal and focus.
Evidence is in `docs/evidence/patient-documents/`.

**Before release:** apply/test the migration on staging, test the actual Google
consent/upload/download/reconnect flow and file-size limit, run the available
Supabase security advisor, and obtain independent code review. None of those
external checks is replaced by the local test doubles. The native PDF check is
Chrome desktop; mobile Safari and actual phone file selection need checking.
