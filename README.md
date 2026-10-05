# Clickfield AI — Client Ticketing & Support Platform

See:
- `docs/Clickfield_AI_Ticketing_System_Documentation.md` — product/technical spec (source of truth for behavior)
- `docs/V1_IMPLEMENTATION_PLAN.md` — approved architecture & decisions
- `CLAUDE.md` — development rules for this repo

## Prerequisites

- Node.js 22+, Python 3.11+ (3.10 also works for Phase 1)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase start` runs Postgres + Auth + Storage locally)
- Redis (via `docker compose up redis`, or any local Redis)

## Setup

```bash
cp .env.example .env
cp .env.example frontend/.env.local   # then trim to NEXT_PUBLIC_* / frontend vars

supabase init        # first time only
supabase start       # starts local Postgres/Auth/Storage
supabase db reset    # applies supabase/migrations/*.sql then supabase/seed.sql
```

Fill in `.env` / `frontend/.env.local` with the values `supabase start` prints
(`API URL`, `anon key`, `service_role key`, `JWT secret`, `DB URL`).

### Backend

```bash
cd backend
python -m venv .venv && . .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Worker (Phase 4 stub for now)

```bash
cd backend
python -m app.workers.notification_worker
```

## Running checks

```bash
# Backend
cd backend
ruff check .
mypy app
pytest -v

# Frontend
cd frontend
npm run lint
npm run typecheck
npm run test
npm run build
```

## Running the mandatory tenant-isolation test (spec §60)

`backend/tests/test_tenant_isolation.py` proves Organization A can never read
Organization B's ticket data (plus 9 related RLS checks — see the file's
docstring), enforced by real Postgres RLS. It requires a live Postgres with
the Supabase `auth` schema, this repo's migrations + seed applied, and real
Supabase Admin API credentials — it **automatically skips** (not a false
pass) when any of that isn't available.

### Option A — local Supabase CLI (needs Docker)

```bash
supabase start
supabase db reset   # applies supabase/migrations/*.sql + supabase/seed.sql
cd backend
pytest tests/test_tenant_isolation.py -v
```

### Option B — hosted Supabase project (no Docker needed)

This is what was actually used to validate Phase 1, since this environment
has no Docker. Steps and gotchas:

1. Create a free project at supabase.com.
2. Collect from the dashboard: **Settings → Data API** (Project URL),
   **Settings → API → "Legacy anon, service_role API keys"** tab (anon +
   service_role keys), **Settings → API → JWT Keys** (JWT Secret), and
   **Settings → Database → Connection string**.
3. ⚠️ **Use the "Session pooler" connection string, not "Direct connection".**
   New Supabase projects only expose direct connections over IPv6 (an IPv4
   add-on is paid); if your network has no IPv6 route, the direct host will
   fail DNS resolution. The Session pooler (port 5432, host
   `aws-0-<region>.pooler.supabase.com`) is IPv4-reachable and — unlike the
   *Transaction* pooler on port 6543 — still gives each connection a
   dedicated session-level Postgres backend, which our `SET ROLE` /
   `set_config('request.jwt.claims', ...)` approach (`app/core/db.py`)
   depends on.
4. Put all 5 values in `backend/.env` (never commit this file).
5. Apply migrations/seed directly via `psycopg` (no `supabase login`/Docker
   needed — run from `backend/` with the venv active):
   ```bash
   python -c "
   from app.core.config import settings
   import psycopg
   from pathlib import Path
   conn = psycopg.connect(settings.database_url)
   for f in sorted(Path('../supabase/migrations').glob('*.sql')) + [Path('../supabase/seed.sql')]:
       with conn.cursor() as cur:
           cur.execute(f.read_text(encoding='utf-8'))
       conn.commit()
       print('applied', f.name)
   "
   ```
6. `pytest tests/test_tenant_isolation.py -v`

⚠️ **JWT signing scheme**: current-generation Supabase projects sign access
tokens with asymmetric ES256 keys (verified via the project's JWKS
endpoint), not the legacy shared HS256 "JWT Secret". `app/core/security.py`
verifies both, chosen by the token's own `alg` header — this matters if
you're reading the code and wondering why there are two code paths.

⚠️ **auth.users**: never insert into `auth.users` directly, even as
`service_role` — a real hosted project rejects it (`permission denied for
table users`). Always go through the Supabase Auth Admin API, exactly as
`app/core/privileged.py::provision_user` and `tests/supabase_admin.py` do.

## Database migrations

SQL files in `supabase/migrations/`, applied in filename order. Apply with
`supabase db reset` (local) or `supabase db push` (against a hosted project).
Never edit an already-applied migration — add a new one.
