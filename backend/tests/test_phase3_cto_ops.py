"""Phase 3 (CTO operations) + Phase 5 (SLA, concurrency, rate limiting,
staff first-name projection) + Phase 6 tampering checks, against the REAL
DEV Supabase project with real signed JWTs and real RLS."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import account, queue, rate_limit
from tests.realdev import REAL_JWT_SECRET, auth, requires_dev, scenario, service_conn

pytestmark = requires_dev
client = TestClient(app)


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", REAL_JWT_SECRET)
    monkeypatch.setattr(queue, "_backend", queue.InMemoryQueueBackend())


@pytest.fixture(scope="module")
def s() -> Iterator[dict[str, Any]]:
    people = {
        "client_a": ("CLIENT_USER", "org_a"),
        "client_b": ("CLIENT_USER", "org_b"),
        "admin": ("ADMIN", "internal"),
        "arjun": ("TEAM_MEMBER", "internal"),
        "other_team": ("TEAM_MEMBER", "internal"),
    }
    with scenario("p3", people, ["org_a", "org_b"]) as data:
        tickets = {}
        for key, prio in (("crit", "CRITICAL"), ("low", "LOW"), ("assigned", "HIGH")):
            r = client.post(
                "/api/tickets",
                headers=auth(data, "client_a"),
                json={
                    "subject": f"RLS-TEST p3 {key} {data['run_id']}",
                    "description": "searchable-description-token",
                    "category_id": data["category_id"],
                    "priority": prio,
                },
            )
            assert r.status_code == 201, r.text
            tickets[key] = r.json()
            data["ticket_ids"].append(r.json()["id"])
        r = client.post(
            f"/api/tickets/{tickets['assigned']['id']}/assign",
            headers=auth(data, "admin"),
            json={"assigned_to": data["arjun_id"], "set_in_progress": True},
        )
        assert r.status_code == 200, r.text
        data["t"] = tickets
        yield data


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# --- role gating -----------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/dashboard",
        "/api/admin/unassigned",
        "/api/admin/workload",
        "/api/admin/team",
        "/api/admin/clients",
        "/api/admin/reports",
        "/api/admin/audit-logs",
    ],
)
def test_admin_ops_endpoints_are_admin_only(s: dict, path: str) -> None:
    assert client.get(path, headers=auth(s, "admin")).status_code == 200
    for who in ("arjun", "client_a", "client_b"):
        assert client.get(path, headers=auth(s, who)).status_code == 403
    assert client.get(path).status_code == 401


def test_team_member_cannot_list_unassigned_via_ticket_list(s: dict) -> None:
    r = client.get("/api/tickets?assigned_to=unassigned", headers=auth(s, "arjun"))
    assert r.status_code == 403


# --- dashboard / unassigned / workload ----------------------------------------------


def test_dashboard_metrics_shape(s: dict) -> None:
    d = client.get("/api/admin/dashboard", headers=auth(s, "admin")).json()
    for key in ("open", "in_progress", "waiting_for_client", "overdue", "resolved_today", "unassigned"):
        assert isinstance(d["metrics"][key], int)
    assert d["metrics"]["in_progress"] >= 1 and d["metrics"]["unassigned"] >= 2
    assert [p["priority"] for p in d["priority_queue"]] == ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    assert len(d["recent_tickets"]) <= 10


def test_unassigned_queue_contents(s: dict) -> None:
    items = client.get("/api/admin/unassigned?page_size=100", headers=auth(s, "admin")).json()["items"]
    ids = [t["id"] for t in items]
    assert s["t"]["crit"]["id"] in ids and s["t"]["low"]["id"] in ids
    assert s["t"]["assigned"]["id"] not in ids
    assert all(t["assigned_to"] is None for t in items)
    assert ids.index(s["t"]["crit"]["id"]) < ids.index(s["t"]["low"]["id"])


def test_workload_exposes_only_name_and_counts(s: dict) -> None:
    rows = client.get("/api/admin/workload", headers=auth(s, "admin")).json()
    arjun = next(r for r in rows if r["id"] == s["arjun_id"])
    assert arjun["in_progress"] >= 1
    assert set(arjun) == {
        "id",
        "name",
        "role",
        "open",
        "in_progress",
        "waiting_for_client",
        "overdue",
        "active_total",
    }
    assert not any("@" in str(v) for r in rows for v in r.values())


# --- clients ---------------------------------------------------------------------------


def test_client_list_and_detail(s: dict) -> None:
    rows = client.get("/api/admin/clients", headers=auth(s, "admin")).json()
    a = next(r for r in rows if r["id"] == s["org_a"])
    assert a["total_tickets"] == 3 and a["active_users"] == 1 and a["in_progress"] == 1
    assert not any(r["slug"] == "clickfield-ai" for r in rows)
    d = client.get(f"/api/admin/clients/{s['org_a']}", headers=auth(s, "admin")).json()
    assert {u["id"] for u in d["users"]} == {s["client_a_id"]}
    assert len(d["recent_tickets"]) == 3
    internal = "00000000-0000-0000-0000-000000000001"
    assert client.get(f"/api/admin/clients/{internal}", headers=auth(s, "admin")).status_code == 404


def test_create_and_update_client_org(s: dict) -> None:
    slug = f"rls-test-p3-new-{s['run_id']}"
    r = client.post(
        "/api/admin/clients", headers=auth(s, "admin"), json={"name": "RLS-TEST new", "slug": slug}
    )
    assert r.status_code == 201, r.text
    org_id = r.json()["id"]
    dup = client.post("/api/admin/clients", headers=auth(s, "admin"), json={"name": "x", "slug": slug})
    assert dup.status_code == 409
    r = client.patch(f"/api/admin/clients/{org_id}", headers=auth(s, "admin"), json={"status": "DISABLED"})
    assert r.status_code == 200 and r.json()["status"] == "DISABLED"
    with service_conn() as conn, conn.cursor() as cur:
        cur.execute("select is_internal from organizations where id = %s", (org_id,))
        row = cur.fetchone()
        assert row is not None and row[0] is False
    assert (
        client.post("/api/admin/clients", headers=auth(s, "client_a"), json={"name": "x"}).status_code == 403
    )


def test_user_management_validation(s: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    base = {"email": f"rls-test-p3-x-{s['run_id']}@example.com", "password": "Password123!", "name": "x"}
    # Staff role in a client org, client role in internal org, unknown org.
    bad = [
        ({**base, "organization_id": s["org_a"], "role": "ADMIN"}, 422),
        ({**base, "organization_id": "00000000-0000-0000-0000-000000000001", "role": "CLIENT_USER"}, 422),
        ({**base, "organization_id": "11111111-1111-1111-1111-111111111111", "role": "CLIENT_USER"}, 404),
    ]
    for body, code in bad:
        assert client.post("/api/admin/users", headers=auth(s, "admin"), json=body).status_code == code
    assert (
        client.post(
            "/api/admin/users",
            headers=auth(s, "arjun"),
            json={**base, "organization_id": s["org_a"], "role": "CLIENT_USER"},
        ).status_code
        == 403
    )
    # Admin may not escalate a client to a staff role inside a client org.
    r = client.patch(f"/api/admin/users/{s['client_b_id']}", headers=auth(s, "admin"), json={"role": "ADMIN"})
    assert r.status_code == 422
    # Reset access: audited, admin-only (email sending stubbed - no real mail).
    sent: list[str] = []
    monkeypatch.setattr(account, "send_password_reset", lambda *, email: sent.append(email))
    r = client.post(f"/api/admin/users/{s['client_b_id']}/reset-access", headers=auth(s, "admin"))
    assert r.status_code == 202 and sent == [s["client_b_email"]]
    assert (
        client.post(
            f"/api/admin/users/{s['client_b_id']}/reset-access", headers=auth(s, "client_a")
        ).status_code
        == 403
    )


def test_disable_blocks_sign_in_and_enable_restores(s: dict) -> None:
    from tests.supabase_admin import sign_in

    assert (
        client.post(f"/api/admin/users/{s['client_b_id']}/disable", headers=auth(s, "admin")).status_code
        == 204
    )
    with pytest.raises(Exception):  # noqa: B017 - GoTrue rejects banned users
        sign_in(email=s["client_b_email"], password=s["password"])
    assert (
        client.post(f"/api/admin/users/{s['client_b_id']}/enable", headers=auth(s, "admin")).status_code
        == 204
    )
    assert sign_in(email=s["client_b_email"], password=s["password"])
    assert (
        client.post(f"/api/admin/users/{s['admin_id']}/disable", headers=auth(s, "admin")).status_code == 422
    )


# --- search / filter / sort -------------------------------------------------------------


def test_search_by_number_subject_client_and_description(s: dict) -> None:
    crit = s["t"]["crit"]
    for q in (crit["ticket_number"], f"p3 crit {s['run_id']}", f"p3 org_a {s['run_id']}"):
        items = client.get("/api/tickets", headers=auth(s, "admin"), params={"q": q}).json()["items"]
        assert crit["id"] in {t["id"] for t in items}, q
    items = client.get(
        "/api/tickets",
        headers=auth(s, "client_a"),
        params={"q": "searchable-description-token", "page_size": 100},
    ).json()["items"]
    assert {t["id"] for t in items} >= {t["id"] for t in s["t"].values()}
    # LIKE wildcards are literal.
    assert client.get("/api/tickets", headers=auth(s, "client_a"), params={"q": "%"}).json()["total"] == 0


def test_search_and_filters_never_cross_tenants(s: dict) -> None:
    crit = s["t"]["crit"]
    for params in (
        {"q": crit["ticket_number"]},
        {"organization_id": s["org_a"]},
        {"q": "searchable-description"},
    ):
        r = client.get("/api/tickets", headers=auth(s, "client_b"), params=params)
        assert r.status_code == 200 and r.json()["total"] == 0, params
    r = client.get("/api/tickets", headers=auth(s, "other_team"), params={"q": crit["ticket_number"]})
    assert r.json()["total"] == 0


def test_sorting(s: dict) -> None:
    items = client.get(
        "/api/tickets", headers=auth(s, "admin"), params={"organization_id": s["org_a"], "sort": "priority"}
    ).json()["items"]
    assert [t["priority"] for t in items] == ["CRITICAL", "HIGH", "LOW"]
    items = client.get(
        "/api/tickets", headers=auth(s, "admin"), params={"organization_id": s["org_a"], "sort": "oldest"}
    ).json()["items"]
    assert items[0]["id"] == s["t"]["crit"]["id"]
    assert client.get("/api/tickets?sort=bogus", headers=auth(s, "admin")).status_code == 422


# --- SLA / overdue / triage (Phase 5) -------------------------------------------------------


def test_sla_deadlines_set_on_creation(s: dict) -> None:
    t = client.get(f"/api/tickets/{s['t']['crit']['id']}", headers=auth(s, "admin")).json()
    created = _dt(t["created_at"])
    assert _dt(t["response_due_at"]) - created == timedelta(minutes=30)
    assert _dt(t["due_at"]) - created == timedelta(minutes=120)
    assert t["is_overdue"] is False


def test_admin_triage_priority_due_date_and_overdue(s: dict) -> None:
    tid = s["t"]["low"]["id"]
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()  # noqa: UP017
    r = client.patch(
        f"/api/tickets/{tid}",
        headers=auth(s, "admin"),
        json={
            "due_at": past,
            "organization_id": s["org_b"],
            "assigned_to": s["arjun_id"],
            "status": "CLOSED",
        },
    )
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["is_overdue"] is True
    assert str(t["organization_id"]) == s["org_a"] and t["assigned_to"] is None and t["status"] == "OPEN"
    items = client.get("/api/tickets?overdue=true&page_size=100", headers=auth(s, "admin")).json()["items"]
    assert tid in {i["id"] for i in items}
    assert client.get("/api/admin/dashboard", headers=auth(s, "admin")).json()["metrics"]["overdue"] >= 1
    # Priority change recomputes the SLA deadline from created_at.
    r = client.patch(f"/api/tickets/{tid}", headers=auth(s, "admin"), json={"priority": "MEDIUM"})
    t = r.json()
    assert _dt(t["due_at"]) - _dt(t["created_at"]) == timedelta(
        minutes=1440
    )
    for who in ("client_a", "arjun"):
        assert (
            client.patch(f"/api/tickets/{tid}", headers=auth(s, who), json={"priority": "HIGH"}).status_code
            == 403
        )


def test_stale_version_rejected_on_patch_and_status(s: dict) -> None:
    tid = s["t"]["assigned"]["id"]
    r = client.patch(
        f"/api/tickets/{tid}", headers=auth(s, "admin"), json={"priority": "CRITICAL", "version": 1}
    )
    assert r.status_code == 409
    r = client.patch(
        f"/api/tickets/{tid}/status",
        headers=auth(s, "arjun"),
        json={"status": "WAITING_FOR_CLIENT", "version": 1},
    )
    assert r.status_code == 409


# --- staff names, history, audit visibility ------------------------------------------------------


def test_client_sees_staff_first_name_only_and_history_hides_internal(s: dict) -> None:
    tid = s["t"]["assigned"]["id"]
    client.post(f"/api/tickets/{tid}/comments", headers=auth(s, "arjun"), json={"comment": "Checking"})
    client.post(
        f"/api/tickets/{tid}/comments",
        headers=auth(s, "arjun"),
        json={"comment": "secret", "visibility": "INTERNAL"},
    )
    comments = client.get(f"/api/tickets/{tid}/comments", headers=auth(s, "client_a")).json()
    staff = [c for c in comments if c["user_id"] == s["arjun_id"]]
    assert len(staff) == 1 and staff[0]["author_name"] == "RLS-TEST" and staff[0]["author_role"] is None
    t = client.get(f"/api/tickets/{tid}", headers=auth(s, "client_a")).json()
    assert t["assigned_to_name"] == "RLS-TEST"

    client_hist = client.get(f"/api/tickets/{tid}/history", headers=auth(s, "client_a")).json()
    actions = {h["action"] for h in client_hist}
    assert "ticket_created" in actions and "internal_note_added" not in actions
    assert all(h["ip_address"] is None for h in client_hist)
    admin_hist = client.get(f"/api/tickets/{tid}/history", headers=auth(s, "admin")).json()
    assert "internal_note_added" in {h["action"] for h in admin_hist}
    assert client.get(f"/api/tickets/{tid}/history", headers=auth(s, "other_team")).status_code == 404
    assert client.get(f"/api/tickets/{tid}/history", headers=auth(s, "client_b")).status_code == 404


def test_team_member_audit_visibility_limited_to_assigned(s: dict) -> None:
    from app.core.db import user_scoped_connection
    from app.core.security import principal_from_token

    with user_scoped_connection(principal_from_token(s["other_team_token"])) as conn, conn.cursor() as cur:
        cur.execute(
            "select count(*) from audit_logs where ticket_id = any(%s::uuid[])",
            ([t["id"] for t in s["t"].values()],),
        )
        row = cur.fetchone()
        assert row is not None and row[0] == 0
        cur.execute("select count(*) from audit_logs where ticket_id is null")
        row = cur.fetchone()
        assert row is not None and row[0] == 0  # privileged rows are admin-only


# --- rate limiting (Phase 5) ------------------------------------------------------------------


def test_ticket_creation_is_rate_limited(s: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(rate_limit.LIMITS, "comment_create", (2, 3600))
    tid = s["t"]["crit"]["id"]
    codes = [
        client.post(
            f"/api/tickets/{tid}/comments", headers=auth(s, "client_a"), json={"comment": "c"}
        ).status_code
        for _ in range(3)
    ]
    assert codes == [201, 201, 429]
    # Limits are per user: another user is unaffected.
    r = client.post(f"/api/tickets/{tid}/comments", headers=auth(s, "admin"), json={"comment": "c"})
    assert r.status_code == 201
