"""Regression tests for migration 0004 (soft-delete fix + update-policy
hardening), against the REAL DEV Supabase project.

Every DB-layer assertion runs through app.core.db.user_scoped_connection with
a genuinely signed JWT from a real GoTrue sign-in, i.e. exactly the
connection the API uses, with RLS + the 0004 guard triggers in force. API
assertions go through the FastAPI app with the same real tokens.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import user_scoped_connection
from app.core.security import principal_from_token
from app.main import app
from app.services import queue
from tests.realdev import REAL_JWT_SECRET, auth, requires_dev, scenario, service_conn

pytestmark = requires_dev

client = TestClient(app)


class _NullQueue:
    def enqueue(self, name: str, payload: dict[str, Any]) -> None:
        return None

    def dequeue(self, name: str, timeout: int = 5) -> dict[str, Any] | None:
        return None


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", REAL_JWT_SECRET)
    monkeypatch.setattr(queue, "_backend", _NullQueue())


@pytest.fixture(scope="module")
def s() -> Iterator[dict[str, Any]]:
    people = {
        "client_a": ("CLIENT_USER", "org_a"),
        "client_a2": ("CLIENT_ADMIN", "org_a"),
        "client_b": ("CLIENT_USER", "org_b"),
        "admin": ("ADMIN", "internal"),
        "arjun": ("TEAM_MEMBER", "internal"),
        "other_team": ("TEAM_MEMBER", "internal"),
    }
    with scenario("sd", people, ["org_a", "org_b"]) as data:
        yield data


def _create_ticket(s: dict[str, Any], subject: str) -> str:
    r = client.post(
        "/api/tickets",
        headers=auth(s, "client_a"),
        json={"subject": subject, "description": "d", "category_id": s["category_id"], "priority": "MEDIUM"},
    )
    assert r.status_code == 201, r.text
    s["ticket_ids"].append(r.json()["id"])
    return str(r.json()["id"])


def _assign(s: dict[str, Any], ticket_id: str, who: str = "arjun") -> None:
    r = client.post(
        f"/api/tickets/{ticket_id}/assign", headers=auth(s, "admin"), json={"assigned_to": s[f"{who}_id"]}
    )
    assert r.status_code == 200, r.text


def _as(s: dict[str, Any], who: str):  # noqa: ANN202 - context manager
    return user_scoped_connection(principal_from_token(s[f"{who}_token"]))


def _deleted_at(table: str, row_id: str) -> Any:
    with service_conn() as conn, conn.cursor() as cur:
        cur.execute(f"select deleted_at from {table} where id = %s", (row_id,))  # noqa: S608
        row = cur.fetchone()
        assert row is not None
        return row[0]


def _org_of(ticket_id: str) -> str:
    with service_conn() as conn, conn.cursor() as cur:
        cur.execute("select organization_id from tickets where id = %s", (ticket_id,))
        row = cur.fetchone()
        assert row is not None
        return str(row[0])


# --- authorized soft delete ---------------------------------------------------


def test_admin_soft_delete_succeeds_and_is_audited(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd admin archive")
    r = client.delete(f"/api/tickets/{tid}", headers=auth(s, "admin"))
    assert r.status_code == 204, r.text
    assert _deleted_at("tickets", tid) is not None
    with service_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select count(*) from audit_logs where ticket_id = %s and action = 'ticket_archived'", (tid,)
        )
        row = cur.fetchone()
        assert row is not None and row[0] == 1
    # Second delete: already gone -> 404, never an error leak.
    assert client.delete(f"/api/tickets/{tid}", headers=auth(s, "admin")).status_code == 404


def test_select_still_hides_soft_deleted_rows(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd hidden after delete")
    client.post(f"/api/tickets/{tid}/comments", headers=auth(s, "client_a"), json={"comment": "hello"})
    assert client.delete(f"/api/tickets/{tid}", headers=auth(s, "admin")).status_code == 204
    for who in ("admin", "client_a", "client_a2"):
        assert client.get(f"/api/tickets/{tid}", headers=auth(s, who)).status_code == 404
        assert client.get(f"/api/tickets/{tid}/comments", headers=auth(s, who)).status_code == 404
        listing = client.get("/api/tickets?page_size=100", headers=auth(s, who)).json()
        ids = {t["id"] for t in listing["items"]}
        assert tid not in ids
    with _as(s, "admin") as conn, conn.cursor() as cur:
        cur.execute("select count(*) from tickets where id = %s", (tid,))
        row = cur.fetchone()
        assert row is not None and row[0] == 0
        cur.execute("select count(*) from ticket_comments where ticket_id = %s", (tid,))
        row = cur.fetchone()
        assert row is not None and row[0] == 0


# --- unauthorized soft delete ---------------------------------------------------


def test_client_and_team_member_cannot_soft_delete_via_api(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd unauthorized api")
    _assign(s, tid)
    for who in ("client_a", "client_a2", "arjun", "other_team", "client_b"):
        assert client.delete(f"/api/tickets/{tid}", headers=auth(s, who)).status_code == 403
    assert _deleted_at("tickets", tid) is None
    assert client.get(f"/api/tickets/{tid}", headers=auth(s, "client_a")).status_code == 200


def test_client_and_team_member_cannot_soft_delete_at_db_layer(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd unauthorized db")
    _assign(s, tid)
    for who in ("client_a", "arjun"):
        # Direct UPDATE (e.g. PostgREST with their own JWT) is rejected...
        with pytest.raises(psycopg.Error):
            with _as(s, who) as conn, conn.cursor() as cur:
                cur.execute("update tickets set deleted_at = now() where id = %s", (tid,))
        # ...and so is the soft-delete function.
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with _as(s, who) as conn, conn.cursor() as cur:
                cur.execute("select soft_delete_ticket(%s)", (tid,))
    assert _deleted_at("tickets", tid) is None


def test_cross_tenant_soft_delete_and_update_denied(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd cross tenant")
    assert client.get(f"/api/tickets/{tid}", headers=auth(s, "client_b")).status_code == 404
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with _as(s, "client_b") as conn, conn.cursor() as cur:
            cur.execute("select soft_delete_ticket(%s)", (tid,))
    with _as(s, "client_b") as conn, conn.cursor() as cur:
        cur.execute("update tickets set status = 'CLOSED' where id = %s", (tid,))
        assert cur.rowcount == 0  # invisible: nothing to update
    with _as(s, "other_team") as conn, conn.cursor() as cur:
        cur.execute("update tickets set status = 'IN_PROGRESS' where id = %s", (tid,))
        assert cur.rowcount == 0
    assert _deleted_at("tickets", tid) is None


# --- organization_id / identity tampering -----------------------------------------


def test_organization_id_is_immutable_even_for_admin(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd org tamper")
    for who in ("admin", "client_a"):
        with pytest.raises(psycopg.Error):
            with _as(s, who) as conn, conn.cursor() as cur:
                cur.execute("update tickets set organization_id = %s where id = %s", (s["org_b"], tid))
    assert _org_of(tid) == s["org_a"]
    with pytest.raises(psycopg.Error):
        with _as(s, "admin") as conn, conn.cursor() as cur:
            cur.execute("update tickets set ticket_number = 'CF-999999' where id = %s", (tid,))


def test_comment_cannot_be_moved_or_made_internal_by_client(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd comment tamper")
    other = _create_ticket(s, "RLS-TEST sd comment tamper target")
    r = client.post(f"/api/tickets/{tid}/comments", headers=auth(s, "client_a"), json={"comment": "mine"})
    assert r.status_code == 201
    cid = r.json()["id"]
    for stmt, params in (
        ("update ticket_comments set ticket_id = %s where id = %s", (other, cid)),
        ("update ticket_comments set visibility = 'INTERNAL' where id = %s", (cid,)),
        ("update ticket_comments set user_id = %s where id = %s", (s["client_a2_id"], cid)),
    ):
        with pytest.raises(psycopg.Error):
            with _as(s, "client_a") as conn, conn.cursor() as cur:
                cur.execute(stmt, params)


def test_client_cannot_tamper_assignment_priority_or_status_directly(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd assignment tamper")
    for stmt, params in (
        ("update tickets set assigned_to = %s where id = %s", (s["arjun_id"], tid)),
        ("update tickets set priority = 'CRITICAL' where id = %s", (tid,)),
        ("update tickets set status = 'RESOLVED' where id = %s", (tid,)),
        ("update tickets set due_at = now() + interval '30 days' where id = %s", (tid,)),
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with _as(s, "client_a") as conn, conn.cursor() as cur:
                cur.execute(stmt, params)
    t = client.get(f"/api/tickets/{tid}", headers=auth(s, "admin")).json()
    assert t["assigned_to"] is None and t["priority"] == "MEDIUM" and t["status"] == "OPEN"


def test_user_cannot_escalate_own_role_or_org(s: dict) -> None:
    for stmt in (
        "update users set role = 'ADMIN' where id = %s",
        "update users set organization_id = '00000000-0000-0000-0000-000000000001' where id = %s",
        "update users set status = 'ACTIVE', email = 'x@example.com' where id = %s",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with _as(s, "client_a") as conn, conn.cursor() as cur:
                cur.execute(stmt, (s["client_a_id"],))
    # A harmless self-edit (display name) is still allowed.
    with _as(s, "client_a") as conn, conn.cursor() as cur:
        cur.execute("update users set name = name where id = %s", (s["client_a_id"],))
        assert cur.rowcount == 1


# --- resurrection ---------------------------------------------------------------


def test_soft_deleted_rows_cannot_be_resurrected_by_normal_roles(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd resurrect")
    r = client.post(f"/api/tickets/{tid}/comments", headers=auth(s, "client_a"), json={"comment": "c"})
    cid = r.json()["id"]
    with _as(s, "client_a") as conn, conn.cursor() as cur:
        cur.execute("select soft_delete_comment(%s)", (cid,))
        row = cur.fetchone()
        assert row is not None and row[0] is True
    assert client.delete(f"/api/tickets/{tid}", headers=auth(s, "admin")).status_code == 204

    for who in ("client_a", "arjun", "admin"):
        with _as(s, who) as conn, conn.cursor() as cur:
            cur.execute("update tickets set deleted_at = null where id = %s", (tid,))
            assert cur.rowcount == 0
            cur.execute("update ticket_comments set deleted_at = null where id = %s", (cid,))
            assert cur.rowcount == 0
    assert _deleted_at("tickets", tid) is not None
    assert _deleted_at("ticket_comments", cid) is not None


# --- existing restrictions preserved ---------------------------------------------


def test_assigned_team_member_can_still_update_and_others_cannot(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd team update")
    _assign(s, tid)
    r = client.patch(f"/api/tickets/{tid}/status", headers=auth(s, "arjun"), json={"status": "IN_PROGRESS"})
    assert r.status_code == 200, r.text
    r = client.patch(
        f"/api/tickets/{tid}/status", headers=auth(s, "other_team"), json={"status": "WAITING_FOR_CLIENT"}
    )
    assert r.status_code == 404
    # The assignee cannot hand the ticket to someone else at the DB layer.
    with pytest.raises(psycopg.Error):
        with _as(s, "arjun") as conn, conn.cursor() as cur:
            cur.execute("update tickets set assigned_to = %s where id = %s", (s["other_team_id"], tid))


def test_comment_soft_delete_authorization(s: dict) -> None:
    tid = _create_ticket(s, "RLS-TEST sd comment delete")
    cid = client.post(
        f"/api/tickets/{tid}/comments", headers=auth(s, "client_a"), json={"comment": "x"}
    ).json()["id"]
    for who in ("client_a2", "client_b", "other_team"):
        with _as(s, who) as conn, conn.cursor() as cur:
            cur.execute("select soft_delete_comment(%s)", (cid,))
            row = cur.fetchone()
            assert row is not None and row[0] is False
    assert _deleted_at("ticket_comments", cid) is None


def test_notifications_only_read_at_is_mutable(s: dict) -> None:
    with service_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into notifications (user_id, type, title, message) values (%s, 'NEW_TICKET', 't', 'm') "
            "returning id",
            (s["client_a_id"],),
        )
        row = cur.fetchone()
        assert row is not None
        nid = str(row[0])
    with _as(s, "client_a") as conn, conn.cursor() as cur:
        cur.execute("update notifications set read_at = now() where id = %s", (nid,))
        assert cur.rowcount == 1
    with pytest.raises(psycopg.Error):
        with _as(s, "client_a") as conn, conn.cursor() as cur:
            cur.execute("update notifications set user_id = %s where id = %s", (s["client_b_id"], nid))
