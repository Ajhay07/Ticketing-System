"""Phase 2 core-ticketing integration tests against the REAL DEV Supabase
project (same approach as tests/test_tenant_isolation.py: real Admin-API
users, real GoTrue sign-in, real signed JWTs, real RLS, real Storage).

Every request goes through the HTTP API with a genuinely signed JWT. Where a
test needs to prove something at the DATABASE layer specifically (e.g. a
client cannot insert an INTERNAL comment even if the API check were
removed), it uses app.core.db.user_scoped_connection with the decoded real
token. Verification reads (audit rows, notification rows) use a
service_role test connection - never the application's code paths.

The tests in this module run in definition order and share one scenario;
each builds on the ticket state left by the previous one (create -> assign ->
comment -> attach -> resolve -> close -> reopen).

The notification queue is replaced by an in-memory recorder (no Redis needed)
so jobs can be asserted; one test swaps in a FAILING queue to prove ticket
creation still succeeds.

Skipped (not faked) when DEV credentials / database are unreachable.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import user_scoped_connection
from app.core.security import principal_from_token
from app.main import app
from app.services import queue
from tests.conftest import postgres_available
from tests.supabase_admin import create_auth_user, sign_in

CREDENTIALS_CONFIGURED = bool(
    settings.supabase_url and settings.supabase_service_role_key and settings.supabase_anon_key
)

pytestmark = pytest.mark.skipif(
    not (postgres_available() and CREDENTIALS_CONFIGURED),
    reason="Requires the DEV Supabase project (backend/.env) with migrations 0001-0003 + seed applied.",
)

INTERNAL_ORG_ID = "00000000-0000-0000-0000-000000000001"
_REAL_JWT_SECRET = settings.supabase_jwt_secret

PDF_BYTES = b"%PDF-1.4\n% RLS-TEST attachment body\n%%EOF\n"


@pytest.fixture(autouse=True)
def _use_real_supabase_jwt_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", _REAL_JWT_SECRET)


class RecordingQueue:
    def __init__(self) -> None:
        self.jobs: list[dict[str, Any]] = []

    def enqueue(self, name: str, payload: dict[str, Any]) -> None:
        self.jobs.append(payload)

    def dequeue(self, name: str, timeout: int = 5) -> dict[str, Any] | None:
        return None


class FailingQueue(RecordingQueue):
    def enqueue(self, name: str, payload: dict[str, Any]) -> None:
        raise ConnectionError("simulated Redis outage")


RECORDER = RecordingQueue()


@pytest.fixture(autouse=True)
def _recording_queue(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(queue, "_backend", RECORDER)


def _service_conn() -> psycopg.Connection:
    conn = psycopg.connect(settings.database_url, autocommit=True)
    with conn.cursor() as cur:
        cur.execute("set role service_role")
    return conn


def _audit_actions(ticket_id: str) -> list[dict[str, Any]]:
    with _service_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select action, user_id, old_value, new_value from audit_logs "
            "where ticket_id = %s order by created_at",
            (ticket_id,),
        )
        return [
            {"action": r[0], "user_id": str(r[1]) if r[1] else None, "old": r[2], "new": r[3]}
            for r in cur.fetchall()
        ]


@pytest.fixture(scope="module")
def s() -> Any:
    run_id = uuid.uuid4().hex[:8]
    password = f"Phase2Test!{run_id}"
    org_a, org_b = str(uuid.uuid4()), str(uuid.uuid4())

    conn = _service_conn()
    with conn.cursor() as cur:
        cur.execute("select to_regclass('public.tickets') is not null")
        row = cur.fetchone()
        if not (row and row[0]):
            pytest.skip("Migrations not applied")
        cur.execute("select 1 from storage.buckets where id = %s", (settings.storage_bucket,))
        if cur.fetchone() is None:
            pytest.skip("Migration 0003 (attachments bucket) not applied")
        cur.execute(
            "insert into organizations (id, name, slug) values (%s, %s, %s), (%s, %s, %s)",
            (
                org_a,
                f"RLS-TEST P2 Org A {run_id}",
                f"rls-test-p2-a-{run_id}",
                org_b,
                f"RLS-TEST P2 Org B {run_id}",
                f"rls-test-p2-b-{run_id}",
            ),
        )

    people = {
        "client_a": ("CLIENT_USER", org_a),
        "client_b": ("CLIENT_USER", org_b),
        "admin": ("ADMIN", INTERNAL_ORG_ID),
        "arjun": ("TEAM_MEMBER", INTERNAL_ORG_ID),
        "other_team": ("TEAM_MEMBER", INTERNAL_ORG_ID),
    }
    data: dict[str, Any] = {"org_a": org_a, "org_b": org_b, "ticket_ids": []}
    for key, (role, org) in people.items():
        email = f"rls-test-p2-{key.replace('_', '-')}-{run_id}@example.com"
        user_id = create_auth_user(email=email, password=password, role=role, organization_id=org)
        with conn.cursor() as cur:
            cur.execute(
                "insert into users (id, organization_id, name, email, role) values (%s, %s, %s, %s, %s)",
                (user_id, org, f"RLS-TEST P2 {key}", email, role),
            )
        data[f"{key}_id"] = user_id
        data[f"{key}_token"] = sign_in(email=email, password=password)

    with conn.cursor() as cur:
        cur.execute("select id from categories where is_active order by name limit 1")
        cat = cur.fetchone()
        assert cat is not None
        data["category_id"] = str(cat[0])

    yield data

    with conn.cursor() as cur:
        cur.execute("update tickets set deleted_at = now() where id = any(%s::uuid[])", (data["ticket_ids"],))
    conn.close()


def _h(s: dict[str, Any], who: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {s[f'{who}_token']}"}


client = TestClient(app)


# --- categories ------------------------------------------------------------


def test_categories_lists_active_categories(s: dict) -> None:
    r = client.get("/api/categories", headers=_h(s, "client_a"))
    assert r.status_code == 200
    names = {c["name"] for c in r.json()}
    assert "Bug" in names


def test_categories_requires_auth() -> None:
    assert client.get("/api/categories").status_code == 401


# --- creation ----------------------------------------------------------------


def test_client_creates_ticket(s: dict) -> None:
    RECORDER.jobs.clear()
    r = client.post(
        "/api/tickets",
        headers=_h(s, "client_a"),
        json={
            "subject": "RLS-TEST P2 Login broken",
            "description": "Users see an error at login.",
            "category_id": s["category_id"],
            "priority": "HIGH",
            # Attempted identity forgery must be ignored (CLAUDE.md rule 4):
            "organization_id": s["org_b"],
            "created_by": s["client_b_id"],
        },
    )
    assert r.status_code == 201, r.text
    t = r.json()
    s["ticket_ids"].append(t["id"])
    s["ticket"] = t["id"]
    assert t["ticket_number"].startswith("CF-")
    assert t["status"] == "OPEN"
    assert t["priority"] == "HIGH"
    assert str(t["organization_id"]) == s["org_a"]
    assert str(t["created_by"]) == s["client_a_id"]
    assert t["category_name"]
    assert t["version"] == 1

    audit = _audit_actions(t["id"])
    assert [a["action"] for a in audit] == ["ticket_created"]
    assert audit[0]["user_id"] == s["client_a_id"]
    assert audit[0]["new"]["ticket_number"] == t["ticket_number"]

    assert RECORDER.jobs and RECORDER.jobs[-1]["event"] == "NEW_TICKET"
    assert RECORDER.jobs[-1]["notify_cto"] is True


def test_ticket_creation_survives_queue_outage(s: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(queue, "_backend", FailingQueue())
    r = client.post(
        "/api/tickets",
        headers=_h(s, "client_a"),
        json={
            "subject": "RLS-TEST P2 created during queue outage",
            "description": "desc",
            "category_id": s["category_id"],
            "priority": "LOW",
        },
    )
    assert r.status_code == 201, r.text
    s["ticket_ids"].append(r.json()["id"])
    # Committed and visible on a fresh request.
    assert client.get(f"/api/tickets/{r.json()['id']}", headers=_h(s, "client_a")).status_code == 200


def test_ticket_creation_validation_and_roles(s: dict) -> None:
    base = {"subject": "x", "description": "y", "category_id": s["category_id"], "priority": "LOW"}
    assert (
        client.post(
            "/api/tickets", headers=_h(s, "client_a"), json={**base, "priority": "URGENT"}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/tickets", headers=_h(s, "client_a"), json={**base, "subject": "   "}).status_code
        == 422
    )
    missing = {k: v for k, v in base.items() if k != "category_id"}
    assert client.post("/api/tickets", headers=_h(s, "client_a"), json=missing).status_code == 422
    bad_cat = {**base, "category_id": str(uuid.uuid4())}
    assert client.post("/api/tickets", headers=_h(s, "client_a"), json=bad_cat).status_code == 422
    assert client.post("/api/tickets", headers=_h(s, "arjun"), json=base).status_code == 403
    assert client.post("/api/tickets", json=base).status_code == 401


# --- read / list -------------------------------------------------------------


def test_other_org_cannot_read_ticket(s: dict) -> None:
    r = client.get(f"/api/tickets/{s['ticket']}", headers=_h(s, "client_b"))
    assert r.status_code == 404
    assert "Login broken" not in r.text


def test_list_pagination_and_filters(s: dict) -> None:
    r = client.get("/api/tickets?page_size=25&priority=HIGH", headers=_h(s, "client_a"))
    assert r.status_code == 200
    body = r.json()
    assert body["page"] == 1 and body["page_size"] == 25
    ids = {t["id"] for t in body["items"]}
    assert s["ticket"] in ids
    assert all(t["priority"] == "HIGH" for t in body["items"])
    assert body["total"] >= 1

    assert client.get("/api/tickets?page_size=10", headers=_h(s, "client_a")).status_code == 422
    assert client.get("/api/tickets?assigned_to=nope", headers=_h(s, "client_a")).status_code == 422
    b_ids = {t["id"] for t in client.get("/api/tickets", headers=_h(s, "client_b")).json()["items"]}
    assert s["ticket"] not in b_ids


def test_team_member_cannot_see_unassigned_ticket(s: dict) -> None:
    assert client.get(f"/api/tickets/{s['ticket']}", headers=_h(s, "arjun")).status_code == 404


# --- assignment ----------------------------------------------------------------


def test_non_admins_cannot_assign(s: dict) -> None:
    body = {"assigned_to": s["arjun_id"]}
    assert (
        client.post(f"/api/tickets/{s['ticket']}/assign", headers=_h(s, "client_a"), json=body).status_code
        == 403
    )
    assert (
        client.post(f"/api/tickets/{s['ticket']}/assign", headers=_h(s, "arjun"), json=body).status_code
        == 403
    )


def test_cannot_assign_to_client_user(s: dict) -> None:
    r = client.post(
        f"/api/tickets/{s['ticket']}/assign", headers=_h(s, "admin"), json={"assigned_to": s["client_a_id"]}
    )
    assert r.status_code == 422


def test_admin_assigns_and_sets_in_progress(s: dict) -> None:
    RECORDER.jobs.clear()
    r = client.post(
        f"/api/tickets/{s['ticket']}/assign",
        headers=_h(s, "admin"),
        json={"assigned_to": s["arjun_id"], "set_in_progress": True, "version": 1},
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert str(t["assigned_to"]) == s["arjun_id"]
    assert t["status"] == "IN_PROGRESS"
    assert t["assigned_to_name"] == "RLS-TEST P2 arjun"  # admin may read staff names

    last = _audit_actions(s["ticket"])[-1]
    assert last["action"] == "ticket_assigned"
    assert last["user_id"] == s["admin_id"]
    assert last["old"] == {"assigned_to": None, "status": "OPEN"}
    assert last["new"] == {"assigned_to": s["arjun_id"], "status": "IN_PROGRESS"}

    with _service_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select type from notifications where user_id = %s and ticket_id = %s",
            (s["arjun_id"], s["ticket"]),
        )
        assert ("TICKET_ASSIGNED",) in cur.fetchall()
    assert RECORDER.jobs[-1]["event"] == "TICKET_ASSIGNED"

    # Arjun can now see it; the unrelated team member still cannot.
    assert client.get(f"/api/tickets/{s['ticket']}", headers=_h(s, "arjun")).status_code == 200
    assert client.get(f"/api/tickets/{s['ticket']}", headers=_h(s, "other_team")).status_code == 404


def test_stale_version_is_rejected(s: dict) -> None:
    r = client.post(
        f"/api/tickets/{s['ticket']}/assign",
        headers=_h(s, "admin"),
        json={"assigned_to": s["arjun_id"], "version": 1},
    )
    assert r.status_code == 409


def test_client_cannot_read_staff_names_but_sees_assignment(s: dict) -> None:
    t = client.get(f"/api/tickets/{s['ticket']}", headers=_h(s, "client_a")).json()
    assert str(t["assigned_to"]) == s["arjun_id"]
    # Phase 5 (spec §10 "Assigned To: Arjun"): clients get the assignee's
    # FIRST NAME only, via ticket_assignee_first_name() (0006). The full
    # staff row stays hidden by users_select RLS.
    assert t["assigned_to_name"] == "RLS-TEST"  # first token of "RLS-TEST P2 arjun"
    with user_scoped_connection(principal_from_token(s["client_a_token"])) as conn, conn.cursor() as cur:
        cur.execute("select count(*) from users where id = %s", (s["arjun_id"],))
        row = cur.fetchone()
        assert row is not None and row[0] == 0


# --- comments / internal notes ---------------------------------------------------


def test_client_reply_and_internal_note_visibility(s: dict) -> None:
    tid = s["ticket"]
    RECORDER.jobs.clear()
    r = client.post(
        f"/api/tickets/{tid}/comments", headers=_h(s, "client_a"), json={"comment": "Still failing"}
    )
    assert r.status_code == 201, r.text
    assert r.json()["visibility"] == "CLIENT"
    assert RECORDER.jobs[-1]["event"] == "CLIENT_REPLY"
    assert RECORDER.jobs[-1]["notify_cto"] is True  # HIGH priority (decision #8)

    r = client.post(
        f"/api/tickets/{tid}/comments",
        headers=_h(s, "client_a"),
        json={"comment": "sneaky", "visibility": "INTERNAL"},
    )
    assert r.status_code == 403

    secret = f"RLS-TEST INTERNAL expired config {uuid.uuid4().hex}"
    r = client.post(
        f"/api/tickets/{tid}/comments",
        headers=_h(s, "arjun"),
        json={"comment": secret, "visibility": "INTERNAL"},
    )
    assert r.status_code == 201, r.text
    s["internal_comment_id"] = r.json()["id"]
    s["internal_secret"] = secret

    r = client.post(
        f"/api/tickets/{tid}/comments", headers=_h(s, "admin"), json={"comment": "Looking into it"}
    )
    assert r.status_code == 201

    # Client view: no INTERNAL rows, secret text absent from the entire response.
    r = client.get(f"/api/tickets/{tid}/comments", headers=_h(s, "client_a"))
    assert r.status_code == 200
    assert {c["visibility"] for c in r.json()} == {"CLIENT"}
    assert len(r.json()) == 2
    assert secret not in r.text

    # Assigned team member sees all three.
    r = client.get(f"/api/tickets/{tid}/comments", headers=_h(s, "arjun"))
    assert {c["visibility"] for c in r.json()} == {"CLIENT", "INTERNAL"}
    assert secret in r.text

    # Other org / unrelated team member: 404 for both read and write.
    assert client.get(f"/api/tickets/{tid}/comments", headers=_h(s, "client_b")).status_code == 404
    assert (
        client.post(
            f"/api/tickets/{tid}/comments", headers=_h(s, "client_b"), json={"comment": "x"}
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/tickets/{tid}/comments",
            headers=_h(s, "other_team"),
            json={"comment": "x", "visibility": "INTERNAL"},
        ).status_code
        == 404
    )

    actions = [a["action"] for a in _audit_actions(tid)]
    assert actions.count("comment_added") == 2
    assert actions.count("internal_note_added") == 1
    # Internal note text is never copied into (client-readable) audit rows.
    assert all(secret not in str(a) for a in _audit_actions(tid))

    t = client.get(f"/api/tickets/{tid}", headers=_h(s, "admin")).json()
    assert t["first_response_at"] is not None


def test_db_layer_blocks_internal_comment_for_client_even_without_api_checks(s: dict) -> None:
    """Bypass the API entirely: under the client's real JWT, RLS itself must
    hide the internal note and reject an INTERNAL insert."""
    principal = principal_from_token(s["client_a_token"])
    with user_scoped_connection(principal) as conn, conn.cursor() as cur:
        cur.execute("select id, comment from ticket_comments where ticket_id = %s", (s["ticket"],))
        rows = cur.fetchall()
    assert s["internal_comment_id"] not in {str(r[0]) for r in rows}
    assert all(s["internal_secret"] not in r[1] for r in rows)

    with pytest.raises(psycopg.errors.DatabaseError):
        with user_scoped_connection(principal) as conn, conn.cursor() as cur:
            cur.execute(
                "insert into ticket_comments (ticket_id, user_id, comment, visibility) "
                "values (%s, %s, 'forged internal', 'INTERNAL')",
                (s["ticket"], s["client_a_id"]),
            )


# --- attachments -------------------------------------------------------------------


def test_attachment_validation_happens_before_anything_is_written(s: dict) -> None:
    tid = s["ticket"]
    for body in (
        {"file_name": "evil.exe", "mime_type": "application/x-msdownload", "file_size": 10},
        {"file_name": "huge.pdf", "mime_type": "application/pdf", "file_size": 25 * 1024 * 1024 + 1},
        {"file_name": "fake.pdf", "mime_type": "image/png", "file_size": 10},
    ):
        r = client.post(f"/api/tickets/{tid}/attachments", headers=_h(s, "client_a"), json=body)
        assert r.status_code == 422, body
        assert "upload_url" not in r.text
    with _service_conn() as conn, conn.cursor() as cur:
        cur.execute("select count(*) from ticket_attachments where ticket_id = %s", (tid,))
        row = cur.fetchone()
        assert row is not None and row[0] == 0


def test_attachment_upload_and_download_roundtrip(s: dict) -> None:
    tid = s["ticket"]
    r = client.post(
        f"/api/tickets/{tid}/attachments",
        headers=_h(s, "client_a"),
        json={"file_name": "error report.pdf", "mime_type": "application/pdf", "file_size": len(PDF_BYTES)},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "storage_path" not in body
    s["attachment_id"] = body["id"]

    put = httpx.put(
        body["upload_url"], content=PDF_BYTES, headers={"Content-Type": "application/pdf"}, timeout=30.0
    )
    assert put.status_code in (200, 201), put.text

    listed = client.get(f"/api/tickets/{tid}/attachments", headers=_h(s, "client_a")).json()
    assert [a["id"] for a in listed] == [s["attachment_id"]]

    r = client.get(f"/api/tickets/{tid}/attachments/{s['attachment_id']}/download", headers=_h(s, "client_a"))
    assert r.status_code == 200, r.text
    assert r.json()["expires_in"] == 60
    got = httpx.get(r.json()["url"], timeout=30.0)
    assert got.status_code == 200
    assert got.content == PDF_BYTES

    assert "attachment_added" in [a["action"] for a in _audit_actions(tid)]


def test_cross_tenant_attachment_access_denied(s: dict) -> None:
    tid, aid = s["ticket"], s["attachment_id"]
    r = client.get(f"/api/tickets/{tid}/attachments/{aid}/download", headers=_h(s, "client_b"))
    assert r.status_code == 404
    assert "url" not in r.json()
    assert client.get(f"/api/tickets/{tid}/attachments", headers=_h(s, "client_b")).status_code == 404
    r = client.post(
        f"/api/tickets/{tid}/attachments",
        headers=_h(s, "client_b"),
        json={"file_name": "x.pdf", "mime_type": "application/pdf", "file_size": 10},
    )
    assert r.status_code == 404
    assert (
        client.get(f"/api/tickets/{tid}/attachments/{aid}/download", headers=_h(s, "other_team")).status_code
        == 404
    )

    # Bypass the API: Org B's own JWT straight against Supabase Storage for
    # Org A's object path. Storage RLS (0003) must refuse to sign it.
    with _service_conn() as conn, conn.cursor() as cur:
        cur.execute("select storage_path from ticket_attachments where id = %s", (aid,))
        row = cur.fetchone()
        assert row is not None
        path = row[0]
    resp = httpx.post(
        f"{settings.supabase_url}/storage/v1/object/sign/{settings.storage_bucket}/{path}",
        headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {s['client_b_token']}"},
        json={"expiresIn": 60},
        timeout=15.0,
    )
    assert resp.status_code >= 400
    assert "signedURL" not in resp.text
    # Nor may anyone read it without a signature (bucket is private).
    public = httpx.get(
        f"{settings.supabase_url}/storage/v1/object/public/{settings.storage_bucket}/{path}", timeout=15.0
    )
    assert public.status_code >= 400


def test_internal_note_attachment_hidden_from_client(s: dict) -> None:
    tid = s["ticket"]
    r = client.post(
        f"/api/tickets/{tid}/attachments",
        headers=_h(s, "arjun"),
        json={
            "file_name": "prod-logs.csv",
            "mime_type": "text/csv",
            "file_size": 10,
            "comment_id": s["internal_comment_id"],
        },
    )
    assert r.status_code == 201, r.text
    internal_attachment = r.json()["id"]
    listed = client.get(f"/api/tickets/{tid}/attachments", headers=_h(s, "client_a")).json()
    assert internal_attachment not in [a["id"] for a in listed]
    r = client.get(
        f"/api/tickets/{tid}/attachments/{internal_attachment}/download", headers=_h(s, "client_a")
    )
    assert r.status_code == 404


# --- status transitions / resolve / close / reopen ------------------------------------


def test_illegal_and_unauthorized_transitions(s: dict) -> None:
    tid = s["ticket"]
    # RESOLVED only via /resolve (summary required).
    r = client.patch(f"/api/tickets/{tid}/status", headers=_h(s, "arjun"), json={"status": "RESOLVED"})
    assert r.status_code == 422
    # IN_PROGRESS -> TRIAGED is not in the state machine.
    r = client.patch(f"/api/tickets/{tid}/status", headers=_h(s, "admin"), json={"status": "TRIAGED"})
    assert r.status_code == 409
    # Client may not resolve.
    r = client.post(
        f"/api/tickets/{tid}/resolve", headers=_h(s, "client_a"), json={"resolution_summary": "x"}
    )
    assert r.status_code == 403
    # Resolution summary required and non-blank.
    r = client.post(f"/api/tickets/{tid}/resolve", headers=_h(s, "arjun"), json={"resolution_summary": "  "})
    assert r.status_code == 422
    # Cannot close a ticket that isn't resolved.
    assert client.post(f"/api/tickets/{tid}/close", headers=_h(s, "client_a")).status_code == 409
    # Other org cannot touch it at all.
    assert client.post(f"/api/tickets/{tid}/close", headers=_h(s, "client_b")).status_code == 404


def test_waiting_for_client_roundtrip_writes_status_changed(s: dict) -> None:
    tid = s["ticket"]
    r = client.patch(
        f"/api/tickets/{tid}/status", headers=_h(s, "arjun"), json={"status": "WAITING_FOR_CLIENT"}
    )
    assert r.status_code == 200, r.text
    r = client.patch(f"/api/tickets/{tid}/status", headers=_h(s, "client_a"), json={"status": "IN_PROGRESS"})
    assert r.status_code == 200, r.text
    changes = [a for a in _audit_actions(tid) if a["action"] == "status_changed"]
    assert [(c["old"]["status"], c["new"]["status"]) for c in changes] == [
        ("IN_PROGRESS", "WAITING_FOR_CLIENT"),
        ("WAITING_FOR_CLIENT", "IN_PROGRESS"),
    ]


def test_resolve_close_reopen_lifecycle(s: dict) -> None:
    tid = s["ticket"]
    RECORDER.jobs.clear()
    summary = "Fixed authentication configuration and redeployed."
    r = client.post(
        f"/api/tickets/{tid}/resolve", headers=_h(s, "arjun"), json={"resolution_summary": summary}
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["status"] == "RESOLVED"
    assert t["resolution_summary"] == summary
    assert t["resolved_at"] is not None
    assert RECORDER.jobs[-1]["event"] == "RESOLVED"
    with _service_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select 1 from notifications where user_id = %s and ticket_id = %s and type = 'TICKET_RESOLVED'",
            (s["client_a_id"], tid),
        )
        assert cur.fetchone() is not None

    # Team members may not close (spec §42).
    assert client.post(f"/api/tickets/{tid}/close", headers=_h(s, "arjun")).status_code == 403

    r = client.post(f"/api/tickets/{tid}/close", headers=_h(s, "client_a"))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CLOSED" and r.json()["closed_at"] is not None

    r = client.post(f"/api/tickets/{tid}/reopen", headers=_h(s, "client_a"))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "REOPENED"
    assert r.json()["closed_at"] is None
    # REOPENED -> REOPENED is not a transition.
    assert client.post(f"/api/tickets/{tid}/reopen", headers=_h(s, "client_a")).status_code == 409

    audit = _audit_actions(tid)
    by_action = {a["action"]: a for a in audit}
    assert by_action["ticket_resolved"]["old"] == {"status": "IN_PROGRESS"}
    assert by_action["ticket_resolved"]["new"] == {"status": "RESOLVED", "resolution_summary": summary}
    assert by_action["ticket_resolved"]["user_id"] == s["arjun_id"]
    assert by_action["ticket_closed"]["old"] == {"status": "RESOLVED"}
    assert by_action["ticket_closed"]["new"] == {"status": "CLOSED"}
    assert by_action["ticket_reopened"]["old"] == {"status": "CLOSED"}
    assert by_action["ticket_reopened"]["new"] == {"status": "REOPENED"}
    assert by_action["ticket_reopened"]["user_id"] == s["client_a_id"]


def test_reopen_is_unlimited_and_reassignment_is_audited(s: dict) -> None:
    tid = s["ticket"]
    # REOPENED -> ASSIGNED (reassign to another team member) -> IN_PROGRESS -> RESOLVED -> REOPENED
    r = client.post(
        f"/api/tickets/{tid}/assign", headers=_h(s, "admin"), json={"assigned_to": s["other_team_id"]}
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ASSIGNED"
    assert client.get(f"/api/tickets/{tid}", headers=_h(s, "arjun")).status_code == 404  # no longer assigned
    assert (
        client.patch(
            f"/api/tickets/{tid}/status", headers=_h(s, "other_team"), json={"status": "IN_PROGRESS"}
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/tickets/{tid}/resolve",
            headers=_h(s, "other_team"),
            json={"resolution_summary": "Again fixed"},
        ).status_code
        == 200
    )
    assert client.post(f"/api/tickets/{tid}/reopen", headers=_h(s, "client_a")).status_code == 200

    audit = _audit_actions(tid)
    actions = [a["action"] for a in audit]
    assert actions.count("ticket_reopened") == 2
    reassign = next(a for a in audit if a["action"] == "ticket_reassigned")
    assert reassign["old"]["assigned_to"] == s["arjun_id"]
    assert reassign["new"]["assigned_to"] == s["other_team_id"]


def test_every_required_event_was_audited(s: dict) -> None:
    actions = set(a["action"] for a in _audit_actions(s["ticket"]))
    required = {
        "ticket_created",
        "ticket_assigned",
        "ticket_reassigned",
        "comment_added",
        "internal_note_added",
        "attachment_added",
        "status_changed",
        "ticket_resolved",
        "ticket_closed",
        "ticket_reopened",
    }
    assert required <= actions, required - actions
    assert all(a["user_id"] for a in _audit_actions(s["ticket"]))


# --- static guard: service_role confined to ticket-number allocation ---------------------


def test_new_routers_never_use_privileged_module() -> None:
    import inspect

    from app.api.routers import categories, ticket_attachments, ticket_comments, tickets, users
    from app.services import audit, notifications, storage

    for module in (
        tickets,
        ticket_comments,
        ticket_attachments,
        categories,
        users,
        audit,
        notifications,
        storage,
    ):
        assert "privileged" not in inspect.getsource(module), module.__name__
    assert "service_role_key" not in inspect.getsource(storage)


def test_ticket_service_uses_privileged_only_for_number_allocation() -> None:
    import inspect
    import re

    from app.services import tickets as ticket_service

    uses = set(re.findall(r"privileged\.(\w+)\(", inspect.getsource(ticket_service)))
    assert uses == {"allocate_ticket_number"}
