# Deployment Guide — Clickfield AI Ticketing System (V1)

Status: **documentation only. Nothing described here has been executed against
PROD.** As of this writing the app is not deployed anywhere, PROD
(`zirvrpejigqwxcscpskf`) has only migrations 0001-0002 (+ seed) applied, and
every command below that touches PROD must be run by a human.

Topology (spec §51, §57):

```
Vercel (Next.js frontend)  ->  Backend container (FastAPI, Dockerfile)  ->  Supabase PROD (Postgres + Auth + Storage)
                                         |
                                       Redis  <-  Worker container (same image, `python -m app.workers.notification_worker`)  ->  Resend
```

---

## 1. Environment variables

Reference: `.env.example`. Never commit real values; store them in the
hosting platforms' secret stores.

### Backend + worker (same values for both containers)

| Variable | Required | Notes |
|---|---|---|
| `ENVIRONMENT` | yes | `production` (enables HSTS header; logs an error if `RESEND_API_KEY` is missing) |
| `SUPABASE_URL` | yes | PROD project URL `https://zirvrpejigqwxcscpskf.supabase.co` |
| `SUPABASE_ANON_KEY` | yes | used for password-reset emails (`/auth/v1/recover`) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **secret**; used only by `app/core/privileged.py` |
| `SUPABASE_JWT_SECRET` | if legacy HS256 | not needed when the project signs with ES256/JWKS |
| `DATABASE_URL` | yes | **Session pooler** connection string (port 5432), NOT the transaction pooler (6543) — the backend relies on session-level `SET ROLE` / `set_config` |
| `REDIS_URL` | yes | managed Redis (e.g. Upstash/Redis Cloud), `rediss://` if TLS |
| `RESEND_API_KEY` | yes in prod | without it the worker uses the no-op provider (emails logged with provider `noop`, never sent) |
| `EMAIL_FROM_ADDRESS` | yes | must be on a domain verified in Resend |
| `EMAIL_PROVIDER` | no | `noop` \| `resend` \| `smtp`; empty = auto (Resend if key set, SMTP if `SMTP_HOST` set, else noop). See `docs/SMTP.md` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` | if using SMTP | backend + worker only, never `NEXT_PUBLIC_`; empty `SMTP_HOST` = noop |
| `SMTP_FROM_EMAIL` / `SMTP_FROM_NAME` / `SMTP_USE_TLS` / `SMTP_USE_SSL` | if using SMTP | STARTTLS on 587 (`SMTP_USE_TLS=true`) or implicit TLS on 465 (`SMTP_USE_SSL=true`) |
| `APP_URL` | yes | public frontend URL, used for "Open Ticket" links and password-reset redirect |
| `CORS_ALLOW_ORIGINS` | yes | JSON list, e.g. `["https://support.clickfieldai.com"]` — never `*` |
| `STORAGE_BUCKET` | no | default `ticket-attachments` |
| `RATE_LIMIT_BACKEND` | if >1 API instance | `redis` to share counters across instances (default `memory`) |
| `RATE_LIMIT_*`, `EMAIL_MAX_ATTEMPTS`, `EMAIL_RETRY_BASE_SECONDS`, `LOG_LEVEL` | no | defaults in `backend/app/core/config.py` |

### Frontend (Vercel project env vars)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | PROD project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PROD anon key (public by design) |
| `NEXT_PUBLIC_API_URL` | public backend URL, e.g. `https://api.support.clickfieldai.com` |
| `NEXT_PUBLIC_APP_URL` | public frontend URL |

---

## 2. Database migrations for PROD (human-run)

Migrations are forward-only SQL files in `supabase/migrations/`:

| File | Applied to DEV | Applied to PROD |
|---|---|---|
| `0001_schema.sql` | yes | yes |
| `0002_rls.sql` | yes | yes |
| `0003_storage_attachments.sql` | yes | **NO — pending** |
| `0004_soft_delete_fix.sql` | yes | **NO — pending** |
| `0005_notification_type.sql` | yes | **NO — pending** |
| `0006_sla_audit_visibility_staff_names.sql` | yes | **NO — pending** |

Pre-flight:

1. Confirm PITR / a fresh backup exists (Supabase dashboard → Database →
   Backups). Note the timestamp — it is your rollback point.
2. Put PROD credentials in a **separate, temporary** env file (e.g.
   `backend/.env.prod`, never committed, delete afterwards). Do not edit
   `backend/.env`, which must keep pointing at DEV.

Apply exactly the pending files, in order, each in its own transaction
(run from `backend/` with the venv active):

```bash
cd backend
python - <<'PY'
import psycopg
from pathlib import Path
from dotenv import dotenv_values          # pip install python-dotenv if needed
env = dotenv_values(".env.prod")
assert "zirvrpejigqwxcscpskf" in env["SUPABASE_URL"], "not the PROD project"
PENDING = [
    "0003_storage_attachments.sql",
    "0004_soft_delete_fix.sql",
    "0005_notification_type.sql",
    "0006_sla_audit_visibility_staff_names.sql",
]
with psycopg.connect(env["DATABASE_URL"]) as conn:
    for name in PENDING:
        sql = (Path("../supabase/migrations") / name).read_text(encoding="utf-8")
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
        print("applied", name)
PY
```

Alternatively paste each file, in order, into the Supabase SQL editor.

Post-checks (SQL editor):

```sql
select id, public from storage.buckets where id = 'ticket-attachments';            -- 1 row, public = false
select proname from pg_proc where proname in ('soft_delete_ticket','apply_ticket_sla',
  'ticket_assignee_first_name','comment_author_first_name');                       -- 4 rows
select unnest(enum_range(null::notification_type));                                -- includes TEAM_REPLY
select tgname from pg_trigger where tgname in ('tickets_guard_update','tickets_apply_sla'); -- 2 rows
```

Then run the backend test-suite **against DEV only** (never point tests at
PROD) to confirm the same migration set is green there.

Optional PROD tidy-up: the Phase 1 `RLS-TEST` rows in PROD are already
soft-deleted; leave them or disable the four test users in Auth.

---

## 3. Supabase Auth settings (PROD dashboard)

- Authentication → URL Configuration: **Site URL** = production frontend
  URL; **Redirect URLs** include `https://<domain>/login` and
  `https://<domain>/**` (password-reset links from `/forgot-password` and
  the admin "Reset access" action redirect to `/login`).
- Authentication → Providers: email/password enabled; public sign-ups can be
  **disabled** (all accounts are created by admins via the Admin API).
- Authentication → Rate Limits: keep defaults or tighten (login and
  password-reset rate limiting for spec §54 is enforced here, since the
  browser talks to Supabase Auth directly).
- Authentication → SMTP: configure custom SMTP (e.g. Resend SMTP) so auth
  emails are not limited by Supabase's built-in sender.
- JWT signing: ES256 (JWKS) is supported out of the box; nothing to set.

## 4. Storage

Migration 0003 creates the private `ticket-attachments` bucket (25 MB, MIME
allow-list) and its `storage.objects` RLS policies; 0004 is required for the
orphan-attachment cleanup path. No manual bucket configuration is needed
after the migrations. Do **not** make the bucket public.

## 5. Backend deploy (container)

```bash
cd backend
docker build -t clickfield-ticketing-api:<git-sha> .
# push to your registry, then run on Cloud Run / Azure Container Apps / a VPS:
docker run -p 8000:8000 --env-file <secret env> clickfield-ticketing-api:<git-sha>
```

- Terminate TLS at the platform/load balancer (HTTPS only, spec §53).
- Liveness probe: `GET /health` (no dependencies).
- Readiness / load-balancer health check: `GET /ready` (checks Postgres and
  Redis; returns 503 with which dependency failed).
- Logs are JSON lines on stdout (request id, method, path, status,
  duration) — ship them to the platform's log store.

## 6. Worker deploy

Same image, different command, exactly one or more replicas:

```bash
docker run --env-file <secret env> clickfield-ticketing-api:<git-sha> python -m app.workers.notification_worker
```

It needs `DATABASE_URL`, `SUPABASE_*`, `REDIS_URL`, `RESEND_API_KEY`,
`EMAIL_FROM_ADDRESS`, `APP_URL` (or `EMAIL_PROVIDER=smtp` + `SMTP_*`, see `docs/SMTP.md`). Monitor `email_logs` for `status = 'FAILED'`.
Note: jobs enqueued while Redis is down are lost (the ticket change itself is
always committed); re-sending is a manual action in V1.

## 7. Frontend deploy (Vercel)

1. Import the repo, root directory `frontend/`, framework Next.js.
2. Set the four `NEXT_PUBLIC_*` env vars (section 1).
3. Build command `npm run build`; the CI gate below must pass first.
4. Attach the production domain; Vercel provisions SSL.

## 8. CI gate (spec §58) — run before every deploy

```bash
cd backend && ruff check . && mypy app && pytest -v          # against DEV
cd frontend && npm run lint && npm run typecheck && npm run test && npm run build
```

## 9. Backups (spec §55)

Not configured by this run (no deployed infrastructure exists). Before
go-live, in the PROD Supabase dashboard:
- Confirm daily backups are enabled (Pro plan or above).
- Enable **Point-in-Time Recovery** (paid add-on) — strongly recommended.
- Storage objects are not covered by DB PITR: schedule a periodic export of
  the `ticket-attachments` bucket (e.g. `supabase storage` CLI / S3-compatible
  sync) to separate storage.

## 10. Rollback

**Application (backend / worker / frontend):** redeploy the previous image
tag / Vercel deployment ("Promote to Production" on the previous build).
Migrations 0004-0006 are backward compatible with the previous app version
(they only add functions/triggers/policies and enum values).

**Bad migration:** migrations are forward-only. Prefer writing a new
corrective migration (`0007_...sql`). If a migration must be undone
immediately:

- 0006: `drop trigger tickets_apply_sla on tickets; drop function
  apply_ticket_sla(), ticket_assignee_first_name(uuid),
  comment_author_first_name(uuid);` and recreate `audit_logs_select` from
  `0002_rls.sql`. (The current app expects the two name functions — roll the
  app back first.)
- 0005: enum values cannot be dropped in Postgres; they are harmless if unused.
- 0004: drop the `*_guard_update` triggers and `soft_delete_*` functions and
  recreate the five UPDATE policies exactly as in `0002_rls.sql`
  (re-introduces the soft-delete bug; only as an emergency measure).
- Worst case: restore the PITR snapshot taken in the pre-flight step
  (loses writes after that point — announce downtime first).

---

## 11. Pre-launch checklist (status as verified on 2026-10-05)

| # | Item | Status |
|---|---|---|
| 1 | Tenant isolation (cross-org tickets, lists, comments, attachments, search, audit) | DONE — real-DEV tests |
| 2 | Internal notes invisible to clients at DB level (incl. audit history) | DONE — real-DEV tests |
| 3 | Team members only see assigned tickets; unassigned queue admin-only | DONE — real-DEV tests |
| 4 | Client/admin authorization, role & assignment tampering ignored/blocked | DONE — real-DEV tests |
| 5 | service_role confined to `privileged.py`, audited | DONE — static tests + real-DEV audit check |
| 6 | Audit logs append-only | DONE — real-DEV tests |
| 7 | Soft delete works, resurrection and org_id tampering blocked | DONE — real-DEV tests (0004) |
| 8 | Email failures never fail ticket operations; retries logged | DONE — real-DEV worker tests with a fake provider |
| 9 | Real email delivery through Resend | **NOT DONE** — needs a Resend account, verified domain, `RESEND_API_KEY` |
| 10 | Rate limiting | DONE in API (tickets/comments/uploads/admin reset); login/self-service reset rely on Supabase Auth limits — **configure in PROD dashboard** |
| 11 | Migrations 0003-0006 applied to PROD | **NOT DONE** — human action (section 2) |
| 12 | PROD Auth Site URL / redirect URLs / SMTP | **NOT DONE** — needs real domain (section 3) |
| 13 | Backend + worker deployed, Redis provisioned, `/ready` wired | **NOT DONE** |
| 14 | Frontend deployed on Vercel with domain + SSL | **NOT DONE** |
| 15 | CORS restricted to the production domain | Code ready (env-driven); **set value at deploy** |
| 16 | Backups / PITR enabled | **NOT DONE** — dashboard setting |
| 17 | Malware scanning of attachments | Not in V1 (decision #10); extension point exists |
| 18 | Monitoring/alerting on logs, `/ready`, failed `email_logs` | **NOT DONE** — platform-specific |
| 19 | First SUPER_ADMIN / ADMIN accounts created in PROD | **NOT DONE** — create via Supabase Admin API (as `tests/supabase_admin.py` does) with `app_metadata.role`/`organization_id` = internal org, plus a matching `public.users` row |
| 20 | Lint / typecheck / tests / build green | DONE — see final report |
