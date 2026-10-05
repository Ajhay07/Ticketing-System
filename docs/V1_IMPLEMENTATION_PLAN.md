# Clickfield AI Ticketing System — V1 Implementation Plan (Approved)

Status: **Approved 2026-10-05**. This document is the agreed plan for V1. The product
specification in `docs/Clickfield_AI_Ticketing_System_Documentation.md` remains the
source of truth for behavior; this document records *how* V1 is built and the
decisions made to resolve ambiguities in that spec.

## 1. Architecture

```
Client (Web)
   │
   ▼
Next.js (frontend/)  ── Supabase Auth (session cookies)
   │
   ▼
FastAPI (backend/)   ── verifies Supabase JWT per request
   │                     - normal requests: Postgres client scoped to the
   │                       user's JWT → RLS enforced
   │                     - privileged ops only: service_role key, isolated
   │                       and audited (see §2)
   ▼
PostgreSQL (Supabase) ── RLS is the authoritative tenant boundary
   │
   ▼
Supabase Storage (private buckets, signed URLs)

Redis ── queue for outbound notifications
   │
   ▼
Worker (backend/app/workers) ── sends email via Resend, retries, logs to email_logs
```

## 2. Decisions resolving spec ambiguities

| # | Topic | Decision |
|---|-------|----------|
| 1 | FastAPI ↔ RLS | Normal authenticated requests use the **user's JWT** against Postgres so RLS is enforced. `service_role` is used ONLY for narrowly scoped, documented privileged operations (auth `app_metadata` administration, ticket-number sequence allocation, system/worker writes). Every privileged-path use is isolated in `app/core/privileged.py` and audited. |
| 2 | Queue | Redis + a dedicated worker process for V1, behind a small `QueueBackend` abstraction (`app/services/queue.py`) so it can be swapped later. |
| 3 | Internal staff org | A dedicated internal organization row (`slug = "clickfield-ai"`, `is_internal = true`) holds all `SUPER_ADMIN` / `ADMIN` / `TEAM_MEMBER` users. |
| 4 | Cross-tenant denial | Return **404** for any resource the caller is not authorized to see. Never reveal existence, never return protected fields. |
| 5 | Team member visibility | Team members see only tickets assigned to them (plus tickets they authored internal notes/comments on). The unassigned queue is **ADMIN / CTO / SUPER_ADMIN only**. |
| 6 | Schema gaps | Added: `tickets.resolution_summary`, `tickets.first_response_at`, `tickets.response_due_at`, soft-delete (`deleted_at`) on `tickets`/`ticket_comments`/`ticket_attachments`, optimistic concurrency (`version` integer, incremented on every ticket update). |
| 7 | Client user management | Only `SUPER_ADMIN` / `ADMIN` (CTO) create/disable/change-role/remove client users in V1. `CLIENT_ADMIN` has no extra user-management capability in V1 (reserved for Phase 2). |
| 8 | New client reply notifications | Notify the assigned team member always. Also notify the CTO (all `ADMIN` users in the internal org) when the ticket is unassigned, or priority is `HIGH`/`CRITICAL`. |
| 9 | Reopening | Unlimited reopens allowed; every reopen writes an audit log row. |
| 10 | Malware scanning | Not implemented in V1 (not a blocker). Attachment validation (type/size) and private storage ARE implemented. The attachment pipeline has an explicit extension point (`app/services/attachments.py: scan_hook`) so a scanner can be added later without redesign. |

## 3. Explicitly out of scope for V1 (per spec §62 and user instruction)

AI/ML of any kind, AI chatbot, AI classification/summaries, AI agents, voice support,
WhatsApp integration, native mobile apps, complex billing, advanced CRM, marketing
automation, customer success module, email-to-ticket (Phase 2), advanced SLA/business
hours/escalations (Phase 2), CSAT ratings (Phase 2), knowledge base (Phase 2), canned
responses (Phase 2), recurring tickets (Phase 2), and all Phase 3 modules.

## 4. Build phases

- **Phase 1 — Foundation** (this delivery): scaffolding, schema, migrations, RLS,
  indexes, seed data, Supabase Auth integration, user/org models, roles/permissions,
  backend auth middleware, frontend shell, dev/docker config, foundational tests.
- **Phase 2 — Core ticketing**: creation, list/detail, status/priority/category,
  assignment, comments, internal notes, attachments.
- **Phase 3 — CTO operations**: dashboard, unassigned queue, team workload, client
  management, search/filter, audit history UI.
- **Phase 4 — Notifications**: email service + templates, in-app notifications.
- **Phase 5 — Reliability**: error handling, email retry, rate limiting, logging,
  backups.
- **Phase 6 — Testing**: full unit/integration/E2E suite, tenant-isolation and
  authorization tests.
- **Phase 7 — Production**: staging/production deployment, domain, SSL, monitoring,
  final security review.

Each phase stops for explicit approval before the next begins.

## 5. Schema (Phase 1 — see `supabase/migrations/`)

Tables: `organizations`, `users`, `categories`, `sla_policies`, `tickets`,
`ticket_comments`, `ticket_attachments`, `audit_logs`, `notifications`, `email_logs`.

Enums: `user_role`, `ticket_priority`, `ticket_status`, `comment_visibility`.

RLS: enabled on every tenant-scoped table; policies derive `organization_id` and
`role` from `auth.jwt()` claims (never from client input). Audit logs are
append-only (`UPDATE`/`DELETE` revoked + trigger guard).

## 6. Local development

See `README.md` for setup commands. Requires: Node 22, Python 3.10+, a Supabase
project (or local Postgres via `docker-compose.yml`), Redis.
