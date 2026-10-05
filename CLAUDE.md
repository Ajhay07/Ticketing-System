# CLAUDE.md — Clickfield AI Ticketing System

This file defines the development rules for this repository. Follow it for every
change, in every phase.

## Source of truth

- `docs/Clickfield_AI_Ticketing_System_Documentation.md` is the product/technical
  specification and is authoritative for *behavior*.
- `docs/V1_IMPLEMENTATION_PLAN.md` is authoritative for *architecture decisions* and
  records how spec ambiguities were resolved. Do not re-litigate those decisions
  without explicit new instruction from the project owner.

## Hard constraints (do not violate)

1. **No AI in V1.** No AI classification, summaries, chatbots, agents, or LLM-based
   workflows. Do not add any AI SDK/dependency.
2. **No scope creep.** Do not implement Phase 2 or Phase 3 features (email-to-ticket,
   WhatsApp, native mobile apps, advanced SLA/business hours, CSAT, knowledge base,
   canned responses, recurring tickets, billing, CRM, etc.) unless explicitly
   instructed.
3. **Frontend route guards are never sufficient authorization.** Every authorization
   decision must be enforced server-side: in FastAPI (permission checks, state
   machine) AND in PostgreSQL (Row Level Security). A frontend check is UX only.
4. **Never trust client input for identity/authorization.** `organization_id`,
   `user_id`, `role`, and permissions are always derived from the verified Supabase
   JWT on the server — never read from request body/query params.
5. **RLS must actually run.** Normal authenticated data access must go through
   Postgres using the *user's own JWT*, not the `service_role` key, so RLS policies
   are enforced. `service_role` is reserved for narrowly scoped, documented,
   audited privileged operations only (see `backend/app/core/privileged.py`).
6. **Tenant isolation is mandatory and tested.** Any change touching tickets,
   comments, attachments, or audit logs must keep the cross-organization isolation
   test passing (`backend/tests/test_tenant_isolation.py`). Cross-tenant access
   must return 404 and leak no protected data.
7. **Internal notes/comments are never visible to clients**, at the database layer
   (RLS), not just hidden in the UI.
8. **Audit logs are append-only.** Never add code paths that allow `UPDATE` or
   `DELETE` on `audit_logs` for normal application roles.
9. **Soft delete only.** Tickets and related records are never hard-deleted by
   normal application code; only a documented, isolated super-admin path may
   hard-delete, and that path itself must write an audit record before deleting.
10. **Email failures must never fail ticket operations.** Ticket writes commit
    first; notifications are enqueued and processed by the worker, independently
    retried, and failures are logged to `email_logs` — never raised back to the
    user-facing request.

## Working conventions

- **Read the relevant spec section before implementing a feature.** Cite the
  section number in the PR/commit description when it clarifies a non-obvious
  decision.
- Keep the email provider abstracted (`app/services/email/`) — no direct Resend
  calls outside that module.
- Keep the queue abstracted (`app/services/queue.py`) — no direct Redis calls
  outside that module.
- Migrations are SQL files under `supabase/migrations/`, numbered sequentially,
  forward-only. Never edit a migration that has already been applied anywhere;
  write a new one.
- All new tenant-scoped tables must: have `organization_id`, enable RLS, have a
  policy for every role that can touch them, and be added to the tenant-isolation
  test suite.
- Backend: FastAPI + Pydantic v2, routers thin, business logic in `services/` and
  `domain/`, DB access in `repositories/`.
- Frontend: Next.js App Router + TypeScript + Tailwind + shadcn/ui + TanStack
  Query. Server state lives in TanStack Query, not ad-hoc `useState` + `useEffect`
  fetching.
- Run lint, typecheck, tests, and build before considering a phase complete.

## Phase discipline

Work proceeds in the phases defined in `docs/V1_IMPLEMENTATION_PLAN.md` §4. Do not
start the next phase until the current phase's completion report has been reviewed
and explicitly approved.
