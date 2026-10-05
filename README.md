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
Organization B's ticket data, enforced by real Postgres RLS. It requires a
live Postgres with the Supabase `auth` schema and this repo's migrations +
seed applied — it **automatically skips** (not a false pass) when no such
database is reachable, which is the case in a plain CI runner or sandbox with
no Supabase project.

To run it for real:

```bash
supabase start
supabase db reset   # applies supabase/migrations/*.sql + supabase/seed.sql
cd backend
pytest tests/test_tenant_isolation.py -v
```

## Database migrations

SQL files in `supabase/migrations/`, applied in filename order. Apply with
`supabase db reset` (local) or `supabase db push` (against a hosted project).
Never edit an already-applied migration — add a new one.
