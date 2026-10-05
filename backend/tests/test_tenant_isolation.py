"""THE mandatory security test (spec §60).

Organization A must never be able to access Organization B's ticket data.

This test is an INTEGRATION test: it requires a real Postgres instance with
the Supabase `auth` schema present and `supabase/migrations/*.sql` +
`supabase/seed.sql` already applied (i.e. a real Supabase project, or
`supabase start` locally). It is automatically skipped - not faked as a
pass - when no such database is reachable, so CI/local runs are honest about
whether tenant isolation was actually proven against Postgres or not.

See docs/V1_IMPLEMENTATION_PLAN.md and the Phase 1 completion report for how
to run this for real.
"""

from __future__ import annotations

import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_principal
from app.core.security import Principal, Role
from app.main import app
from tests.conftest import postgres_available

pytestmark = pytest.mark.skipif(
    not postgres_available(),
    reason=(
        "No reachable Postgres instance (DATABASE_URL). This test requires a "
        "provisioned Supabase project (or `supabase start`) with migrations "
        "and seed data applied. See README.md 'Running the tenant isolation "
        "test' for setup."
    ),
)


def _schema_ready(conn: psycopg.Connection) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "select to_regclass('public.tickets') is not null "
            "and to_regclass('auth.users') is not null"
        )
        row = cur.fetchone()
        return bool(row and row[0])


@pytest.fixture
def two_orgs_with_tickets(service_conn: psycopg.Connection):
    if not _schema_ready(service_conn):
        pytest.skip(
            "Database is reachable but migrations/auth schema are not applied. "
            "Run `supabase db reset` (or apply supabase/migrations/*.sql against "
            "a Supabase project) before running this test."
        )

    org_a = str(uuid.uuid4())
    org_b = str(uuid.uuid4())
    user_a = str(uuid.uuid4())
    ticket_a = str(uuid.uuid4())
    ticket_b = str(uuid.uuid4())

    with service_conn.cursor() as cur:
        cur.execute(
            "insert into organizations (id, name, slug) values (%s, 'Org A', %s), (%s, 'Org B', %s)",
            (org_a, f"org-a-{org_a[:8]}", org_b, f"org-b-{org_b[:8]}"),
        )
        # auth.users row is required by the FK on public.users; insert the
        # minimal row Supabase's auth schema needs.
        cur.execute(
            "insert into auth.users (id, email) values (%s, %s)",
            (user_a, "user-a@example.com"),
        )
        cur.execute(
            "insert into users (id, organization_id, name, email, role) "
            "values (%s, %s, 'User A', %s, 'CLIENT_USER')",
            (user_a, org_a, "user-a@example.com"),
        )
        cur.execute(
            "insert into tickets (id, ticket_number, organization_id, created_by, subject, description) "
            "values (%s, %s, %s, %s, 'Issue in Org A', 'desc')",
            (ticket_a, f"CF-{str(uuid.uuid4().int)[:6]}", org_a, user_a),
        )
        cur.execute(
            "insert into tickets (id, ticket_number, organization_id, created_by, subject, description) "
            "values (%s, %s, %s, %s, 'Issue in Org B - SECRET', 'confidential description')",
            (ticket_b, f"CF-{str(uuid.uuid4().int)[:6]}", org_b, user_a),
        )

    return {"org_a": org_a, "org_b": org_b, "user_a": user_a, "ticket_a": ticket_a, "ticket_b": ticket_b}


def test_org_a_cannot_access_org_b_ticket(two_orgs_with_tickets: dict[str, str]) -> None:
    data = two_orgs_with_tickets
    principal = Principal(
        user_id=data["user_a"],
        organization_id=data["org_a"],
        role=Role.CLIENT_USER,
        email="user-a@example.com",
        raw_token="irrelevant-overridden-below",
    )

    app.dependency_overrides[get_current_principal] = lambda: principal
    try:
        client = TestClient(app)

        own_ticket_response = client.get(f"/api/tickets/{data['ticket_a']}")
        assert own_ticket_response.status_code == 200

        other_org_response = client.get(f"/api/tickets/{data['ticket_b']}")

        # Decision #4: 404, never 200, and never any protected data.
        assert other_org_response.status_code == 404
        body_text = other_org_response.text
        assert "SECRET" not in body_text
        assert "confidential description" not in body_text
        assert data["ticket_b"] not in [t.get("id") for t in client.get("/api/tickets").json()]
    finally:
        app.dependency_overrides.pop(get_current_principal, None)


def test_org_a_ticket_list_never_includes_org_b_tickets(two_orgs_with_tickets: dict[str, str]) -> None:
    data = two_orgs_with_tickets
    principal = Principal(
        user_id=data["user_a"],
        organization_id=data["org_a"],
        role=Role.CLIENT_USER,
        email="user-a@example.com",
        raw_token="irrelevant-overridden-below",
    )
    app.dependency_overrides[get_current_principal] = lambda: principal
    try:
        client = TestClient(app)
        tickets = client.get("/api/tickets").json()
        ids = {t["id"] for t in tickets}
        assert data["ticket_a"] in ids
        assert data["ticket_b"] not in ids
    finally:
        app.dependency_overrides.pop(get_current_principal, None)
