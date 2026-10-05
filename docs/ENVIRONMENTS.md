# Environments: DEV vs PROD

## Projects

| | Supabase project name | Project ref | Purpose |
|---|---|---|---|
| **Development** | `Clickfield AI Ticketing — DEV` | `bjhexfolreuvtjzqmdbt` | All local development, Phase 2+ feature work, running the test suite. |
| **Production** | (original project, dashboard shows "PRODUCTION") | `zirvrpejigqwxcscpskf` | Reserved for the real deployed app. Not used for day-to-day development from this point on. |

Both projects were provisioned from the identical SQL in `supabase/migrations/` +
`supabase/seed.sql` — same schema, same RLS policies, same seed data (internal
org, categories, SLA policies). There is no schema drift between them as of
this writing.

## Rule going forward

**Local development, and the automated test suite, run against DEV only.**
`backend/.env` and `frontend/.env.local` hold DEV credentials. Neither file
is committed (`.gitignore`); PROD credentials are never written into either
file during normal development.

PROD credentials exist only:
- In your own password manager / notes (wherever you saved them when you
  created the project), and
- Eventually, in whatever secret store the hosting platform uses once this
  is actually deployed (Vercel project env vars for the frontend, your
  backend host's secret store) — never in a repo file.

## What's in each environment right now

- **DEV**: schema + RLS + seed data only. No application data yet — Phase 2
  will start creating real-looking ticket data here as features are built.
- **PROD**: schema + RLS + seed data, plus a handful of clearly-labeled,
  soft-deleted `RLS-TEST ...` rows (two orgs, three tickets, two comments,
  one attachment, one audit log, four test auth users) left over from the
  Phase 1 validation run described in `docs/V1_IMPLEMENTATION_PLAN.md`. No
  real user/client data has ever been put in PROD. These can be cleaned up
  via the Supabase SQL editor whenever convenient; they do not affect
  anything since the app isn't deployed against PROD yet.

Per the Phase-1-Part-2 instructions: no PROD user data or PROD secrets were
copied into DEV, and PROD was not modified during DEV setup (DEV was
provisioned, and configured independently).

## Switching between environments locally

To point local development at a different Supabase project, edit
`backend/.env` and `frontend/.env.local` with that project's 5/2 values
respectively (see "Collect the same 5 values" in `README.md`). There is
intentionally no automatic environment switching (no `ENVIRONMENT=dev`
flag that silently picks a project) — which project you're pointed at is
always explicit in those two gitignored files, so it's never ambiguous
which database a local run is touching.

## Auth settings

Both projects use Supabase Auth's default configuration (email/password,
email confirmation required at sign-up). The application never relies on a
user completing the email-confirmation UI flow directly: every user account
the app creates goes through the Admin API (`app/core/privileged.py` in
production code, `tests/supabase_admin.py` in tests) with
`email_confirm: true` set explicitly, so accounts are usable immediately
after creation regardless of the project's confirmation setting. No
non-default Auth configuration was required for the Phase 1 test suite to
pass on either project.

When this app is actually deployed, the PROD project's **Site URL** and
**Redirect URLs** (Authentication → URL Configuration) will need to be set
to the real production domain for the password-reset email link
(`frontend/app/forgot-password/page.tsx`) to work correctly — not yet done,
since there is no deployed domain yet.

## Re-running the validation suite against either environment

```bash
cd backend
pytest -v              # full suite, including the 12 RLS/tenant-isolation tests
ruff check .
mypy app

cd ../frontend
npm run lint
npm run typecheck
npm run test
npm run build
```

Whichever project `backend/.env` / `frontend/.env.local` point to is the one
exercised. As of this writing this has been run clean against **both** DEV
and PROD (PROD run: see Phase 1 Part 2 report; DEV run: this document's
companion Phase 1 Part 3 report) — 12/12 RLS tests, 31/31 backend tests,
lint/typecheck clean, frontend build clean, in both cases.

## Migration status (Phase 2)

- `0003_storage_attachments.sql` (private `ticket-attachments` Storage bucket +
  `storage.objects` RLS policies) has been applied to **DEV only**. It must be
  applied to PROD before attachments are used there (same psycopg loop as in
  `README.md`, or the Supabase SQL editor). PROD was not touched in Phase 2.

## Migration status (Phases 3-7)

- `0004_soft_delete_fix.sql`, `0005_notification_type.sql`,
  `0006_sla_audit_visibility_staff_names.sql` are applied to **DEV only**.
- PROD still needs 0003-0006, applied by a human per `docs/DEPLOYMENT.md`
  section 2. PROD was not touched in Phases 3-7.
- DEV clean-up: all `RLS-TEST` fixture users/organizations in DEV were set to
  `DISABLED` (no hard deletes; audit_logs untouched); fixture tickets are
  soft-deleted. Test fixtures now do this automatically at teardown.
