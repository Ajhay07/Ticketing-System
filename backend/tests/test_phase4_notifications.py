"""Phase 4: notification worker, email provider/templates, in-app
notifications. The queue round-trip uses the in-memory QueueBackend (same
JSON round-trip as Redis; no Redis server is available in this
environment). Jobs are produced by the REAL API against the DEV project and
consumed by the REAL worker code, which reads/writes DEV via the
privileged worker helpers; only the email provider is faked."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import email as email_pkg
from app.services import queue
from app.services.email import templates
from app.workers import notification_worker as worker
from tests.realdev import REAL_JWT_SECRET, auth, requires_dev, scenario, service_conn

client = TestClient(app)
Q = queue.InMemoryQueueBackend()


class FakeProvider:
    name = "fake"

    def __init__(self, fail_times: int = 0) -> None:
        self.fail_times = fail_times
        self.sent: list[tuple[str, str]] = []
        self.calls = 0

    def send(self, *, to: str, subject: str, html_body: str) -> str:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise email_pkg.EmailSendError("simulated provider outage")
        self.sent.append((to, subject))
        return f"msg-{self.calls}"


def _drain() -> list[dict[str, Any]]:
    jobs = []
    while (job := Q.dequeue(queue.NOTIFICATION_QUEUE_KEY)) is not None:
        jobs.append(job)
    return jobs


def _email_logs(ticket_id: str) -> list[tuple]:
    with service_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select recipient, notification_type::text, provider, status::text, attempt_count, error_message "
            "from email_logs where ticket_id = %s order by created_at",
            (ticket_id,),
        )
        return cur.fetchall()


# --- pure unit tests (no DB) -----------------------------------------------------------


def test_templates_match_spec_subjects_and_escape_html() -> None:
    c = templates.new_ticket(
        number="CF-000001", subject="<b>x</b>", organization="NK", priority="HIGH", url="u"
    )
    assert c.subject == "[ClickfieldAI] New Ticket CF-000001 — <b>x</b>"
    assert "<b>x</b>" not in c.html and "&lt;b&gt;" in c.html
    assert templates.ticket_assigned(number="CF-1", subject="s", priority="LOW", url="u").subject == (
        "[ClickfieldAI] Ticket CF-1 Assigned to You"
    )
    assert (
        templates.client_reply(number="CF-1", subject="s", url="u").subject
        == "[ClickfieldAI] New Reply — CF-1"
    )
    assert "In Progress" in templates.status_changed(number="CF-1", status="IN_PROGRESS", url="u").html
    assert "confirm if the issue is fixed" in templates.ticket_resolved(number="CF-1", url="u").html
    assert "has been closed" in templates.ticket_closed(number="CF-1", url="u").html
    assert templates.ticket_url("t", "CLIENT_USER").endswith("/client/tickets/t")
    assert templates.ticket_url("t", "TEAM_MEMBER").endswith("/team/tickets/t")


def test_provider_selection_noop_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "resend_api_key", "")
    monkeypatch.setattr(settings, "email_provider", "")
    monkeypatch.setattr(settings, "smtp_host", "")
    p = email_pkg.get_email_provider()
    assert p.name == "noop" and p.send(to="a@example.com", subject="s", html_body="h").startswith("noop-")
    monkeypatch.setattr(settings, "resend_api_key", "re_test_dummy")
    assert email_pkg.get_email_provider().name == "resend"


def test_resend_provider_success_and_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    def ok(url: str, **kw: Any) -> httpx.Response:
        calls.append(kw)
        return httpx.Response(200, json={"id": "abc"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(email_pkg.httpx, "post", ok)
    p = email_pkg.ResendEmailProvider("re_test_dummy", "support@example.com")
    assert p.send(to="a@example.com", subject="s", html_body="h") == "abc"
    assert calls[0]["json"]["to"] == ["a@example.com"]

    monkeypatch.setattr(
        email_pkg.httpx,
        "post",
        lambda url, **kw: httpx.Response(503, text="down", request=httpx.Request("POST", url)),
    )
    with pytest.raises(email_pkg.EmailSendError):
        p.send(to="a@example.com", subject="s", html_body="h")

    def boom(url: str, **kw: Any) -> httpx.Response:
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(email_pkg.httpx, "post", boom)
    with pytest.raises(email_pkg.EmailSendError):
        p.send(to="a@example.com", subject="s", html_body="h")


def test_recipient_selection_rules() -> None:
    rs = [
        {"id": "c", "email": "c@x", "role": "CLIENT_USER", "via_cto": False},
        {"id": "t", "email": "t@x", "role": "TEAM_MEMBER", "via_cto": False},
    ]
    assert [r["id"] for r in worker.select_email_recipients("CLOSED", {"actor_user_id": "z"}, rs)] == ["c"]
    assert [r["id"] for r in worker.select_email_recipients("REOPENED", {"actor_user_id": "c"}, rs)] == ["t"]
    assert [r["id"] for r in worker.select_email_recipients("NEW_TICKET", {"actor_user_id": "c"}, rs)] == [
        "c",
        "t",
    ]


def test_unknown_or_malformed_jobs_are_ignored_without_raising() -> None:
    assert worker.process_job({"event": "NOPE"}) == {"in_app": 0, "emails_sent": 0, "emails_failed": 0}
    assert worker.process_job({"event": "NEW_TICKET"})["emails_sent"] == 0


def test_run_once_survives_a_crashing_job(monkeypatch: pytest.MonkeyPatch) -> None:
    q = queue.InMemoryQueueBackend()
    q.enqueue(queue.NOTIFICATION_QUEUE_KEY, {"event": "NEW_TICKET", "ticket_id": "x"})
    monkeypatch.setattr(queue, "_backend", q)

    def crash(job: dict, provider: Any = None, sleep: Any = None) -> dict:
        raise RuntimeError("boom")

    monkeypatch.setattr(worker, "process_job", crash)
    assert worker.run_once(timeout=0) is True
    assert worker.run_once(timeout=0) is False


# --- real DEV end-to-end ------------------------------------------------------------------


@pytest.fixture(scope="module")
def s() -> Iterator[dict[str, Any]]:
    people = {
        "client_a": ("CLIENT_USER", "org_a"),
        "client_b": ("CLIENT_USER", "org_b"),
        "admin": ("ADMIN", "internal"),
        "arjun": ("TEAM_MEMBER", "internal"),
    }
    with scenario("p4", people, ["org_a", "org_b"]) as data:
        yield data


@pytest.fixture
def dev(monkeypatch: pytest.MonkeyPatch, s: dict) -> dict:
    monkeypatch.setattr(settings, "supabase_jwt_secret", REAL_JWT_SECRET)
    monkeypatch.setattr(queue, "_backend", Q)
    _drain()
    return s


@requires_dev
def test_new_ticket_job_round_trips_to_worker_and_emails_cto(dev: dict) -> None:
    s = dev
    r = client.post(
        "/api/tickets",
        headers=auth(s, "client_a"),
        json={
            "subject": "RLS-TEST p4 new",
            "description": "d",
            "category_id": s["category_id"],
            "priority": "HIGH",
        },
    )
    assert r.status_code == 201
    tid = r.json()["id"]
    s["ticket_ids"].append(tid)
    s["ticket"] = tid
    jobs = _drain()
    assert len(jobs) == 1 and jobs[0]["event"] == "NEW_TICKET" and jobs[0]["notify_cto"] is True

    provider = FakeProvider()
    result = worker.process_job(jobs[0], provider=provider, sleep=lambda _: None)
    recipients = {to for to, _ in provider.sent}
    assert s["admin_email"] in recipients  # CTO resolved server-side by the worker
    assert s["client_a_email"] in recipients  # client confirmation
    assert s["arjun_email"] not in recipients and s["client_b_email"] not in recipients
    assert result["emails_failed"] == 0
    logs = {row[0]: row for row in _email_logs(tid)}
    assert logs[s["admin_email"]][1:5] == ("NEW_TICKET", "fake", "SENT", 1)
    with service_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "select type::text from notifications where ticket_id = %s and user_id = %s", (tid, s["admin_id"])
        )
        assert [r[0] for r in cur.fetchall()] == ["NEW_TICKET"]
        cur.execute(
            "select count(*) from audit_logs where action = 'privileged_cto_recipient_lookup' "
            "and new_value->>'ticket_id' = %s",
            (tid,),
        )
        row = cur.fetchone()
        assert row is not None and row[0] == 1


@requires_dev
def test_email_retry_with_backoff_then_success(dev: dict) -> None:
    s = dev
    job = {
        "event": "TICKET_ASSIGNED",
        "ticket_id": s["ticket"],
        "recipient_user_ids": [s["arjun_id"]],
        "actor_user_id": s["admin_id"],
    }
    sleeps: list[float] = []
    provider = FakeProvider(fail_times=2)
    result = worker.process_job(job, provider=provider, sleep=sleeps.append)
    assert result["emails_sent"] == 1 and provider.calls == 3
    assert sleeps == [settings.email_retry_base_seconds, settings.email_retry_base_seconds * 2]
    row = [r for r in _email_logs(s["ticket"]) if r[1] == "TICKET_ASSIGNED"][-1]
    assert row[0] == s["arjun_email"] and row[3] == "SENT" and row[4] == 3
    assert "simulated provider outage" in (row[5] or "")


@requires_dev
def test_email_permanent_failure_is_recorded_not_raised(dev: dict) -> None:
    s = dev
    job = {
        "event": "TEAM_REPLY",
        "ticket_id": s["ticket"],
        "recipient_user_ids": [s["client_a_id"]],
        "actor_user_id": s["arjun_id"],
    }
    provider = FakeProvider(fail_times=99)
    result = worker.process_job(job, provider=provider, sleep=lambda _: None)
    assert result == {"in_app": 0, "emails_sent": 0, "emails_failed": 1}
    row = [r for r in _email_logs(s["ticket"]) if r[1] == "TEAM_REPLY"][-1]
    assert row[3] == "FAILED" and row[4] == settings.email_max_attempts and row[5]


@requires_dev
def test_comment_and_assignment_survive_queue_outage(dev: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    s = dev

    class Down:
        def enqueue(self, name: str, payload: dict) -> None:
            raise ConnectionError("redis down")

        def dequeue(self, name: str, timeout: int = 5) -> None:
            return None

    monkeypatch.setattr(queue, "_backend", Down())
    r = client.post(
        f"/api/tickets/{s['ticket']}/assign", headers=auth(s, "admin"), json={"assigned_to": s["arjun_id"]}
    )
    assert r.status_code == 200
    r = client.post(
        f"/api/tickets/{s['ticket']}/comments", headers=auth(s, "client_a"), json={"comment": "hi"}
    )
    assert r.status_code == 201
    assert (
        client.get(f"/api/tickets/{s['ticket']}", headers=auth(s, "admin")).json()["assigned_to"]
        == s["arjun_id"]
    )


@requires_dev
def test_team_reply_in_app_notification_and_mark_read(dev: dict) -> None:
    s = dev
    r = client.post(
        f"/api/tickets/{s['ticket']}/comments", headers=auth(s, "arjun"), json={"comment": "On it"}
    )
    assert r.status_code == 201
    jobs = _drain()
    assert jobs and jobs[-1]["event"] == "TEAM_REPLY"
    n = client.get("/api/notifications", headers=auth(s, "client_a")).json()
    team = [i for i in n["items"] if i["type"] == "TEAM_REPLY"]
    assert team and n["unread"] >= 1
    nid = team[0]["id"]
    # Another user cannot mark it read (RLS: 404), the owner can.
    assert client.post(f"/api/notifications/{nid}/read", headers=auth(s, "client_b")).status_code == 404
    assert client.post(f"/api/notifications/{nid}/read", headers=auth(s, "client_a")).status_code == 204
    assert (
        client.get("/api/notifications?unread_only=true", headers=auth(s, "client_b")).json()["items"] == []
    )
    assert client.post("/api/notifications/read-all", headers=auth(s, "client_a")).status_code == 204
    assert client.get("/api/notifications", headers=auth(s, "client_a")).json()["unread"] == 0


@requires_dev
def test_team_reply_delivered_via_smtp_provider_without_leaking_credentials(
    dev: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Staff chat reply -> TEAM_REPLY job -> worker -> SmtpEmailProvider (smtplib
    faked, everything else real DEV). The SMTP password must never appear in
    email_logs, in any API response, or in an error message."""
    import smtplib

    s = dev
    secret = "dev-test-smtp-password-not-real"
    for k, v in {
        "email_provider": "smtp",
        "smtp_host": "smtp.example.test",
        "smtp_username": "mailer@example.test",
        "smtp_password": secret,
        "smtp_from_email": "support@example.test",
    }.items():
        monkeypatch.setattr(settings, k, v)

    sent: list[Any] = []
    fail = {"on": False}

    class FakeSMTP:
        def __init__(self, *a: Any, **kw: Any) -> None:
            pass

        def __enter__(self) -> FakeSMTP:
            return self

        def __exit__(self, *a: object) -> None:
            return None

        def starttls(self, **kw: Any) -> None:
            return None

        def login(self, user: str, password: str) -> None:
            if fail["on"]:
                raise smtplib.SMTPAuthenticationError(535, f"rejected {user} {password}".encode())

        def send_message(self, msg: Any) -> None:
            sent.append(msg)

    monkeypatch.setattr(email_pkg.smtplib, "SMTP", FakeSMTP)

    r = client.post(
        f"/api/tickets/{s['ticket']}/comments", headers=auth(s, "arjun"), json={"comment": "SMTP chat reply"}
    )
    assert r.status_code == 201 and secret not in r.text
    job = _drain()[-1]
    assert job["event"] == "TEAM_REPLY"

    provider = email_pkg.get_email_provider()
    assert provider.name == "smtp"
    assert worker.process_job(job, provider=provider, sleep=lambda _: None)["emails_sent"] == 1
    assert sent and sent[0]["To"] == s["client_a_email"]
    assert sent[0]["Subject"].startswith("[ClickfieldAI] New Reply")
    assert "SMTP chat reply" not in sent[0].as_string()  # templates never include message text

    fail["on"] = True
    assert worker.process_job(job, provider=provider, sleep=lambda _: None)["emails_failed"] == 1
    rows = [r for r in _email_logs(s["ticket"]) if r[1] == "TEAM_REPLY" and r[2] == "smtp"]
    assert [r[3] for r in rows[-2:]] == ["SENT", "FAILED"]
    assert all(secret not in repr(row) for row in _email_logs(s["ticket"]))

    for who in ("client_a", "arjun", "admin"):
        for path in (
            "/api/me",
            f"/api/tickets/{s['ticket']}",
            f"/api/tickets/{s['ticket']}/comments",
            "/api/notifications",
        ):
            resp = client.get(path, headers=auth(s, who))
            assert secret not in resp.text and "smtp_password" not in resp.text.lower()
