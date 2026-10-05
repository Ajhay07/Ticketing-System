"""Phase 5 reliability: error shape, security headers, health/readiness,
CORS, rate limiter, structured logging, and static guards on service_role
usage. These do not need the DEV database (except /ready's DB probe, whose
result is asserted either way)."""

from __future__ import annotations

import inspect
import json
import logging
import re
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.logging import JsonFormatter
from app.main import app
from app.services import rate_limit

client = TestClient(app)


def test_health_and_security_headers() -> None:
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["X-Request-ID"]


def test_ready_reports_dependencies_without_details() -> None:
    r = client.get("/ready")
    assert r.status_code in (200, 503)
    body = r.json()
    assert set(body) == {"status", "database", "queue"}
    assert body["database"] in ("ok", "unavailable") and body["queue"] in ("ok", "unavailable")
    assert "postgres" not in r.text.lower()


def test_consistent_error_shape() -> None:
    r = client.get("/api/tickets")
    assert r.status_code == 401 and isinstance(r.json()["detail"], str) and "request_id" in r.json()
    r = client.get("/api/tickets/not-a-uuid", headers={"Authorization": "Bearer x"})
    assert r.status_code == 401
    r = client.get("/nope")
    assert r.status_code == 404 and r.json()["detail"] == "Not Found"


def test_validation_error_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.conftest import make_token

    token = make_token(user_id="u", role="CLIENT_USER", organization_id="o")
    r = client.get("/api/admin/clients/not-a-uuid", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (403, 422)


def test_cors_allows_configured_origin_only() -> None:
    allowed = settings.cors_allow_origins[0]
    ok = client.options("/api/tickets", headers={"Origin": allowed, "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == allowed
    bad = client.options(
        "/api/tickets", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}
    )
    assert "access-control-allow-origin" not in bad.headers
    assert "*" not in settings.cors_allow_origins


def test_rate_limiter_fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(rate_limit.LIMITS, "ticket_create", (3, 3600))
    for _ in range(3):
        rate_limit.enforce_rate_limit("ticket_create", "user-1")
    with pytest.raises(HTTPException) as exc:
        rate_limit.enforce_rate_limit("ticket_create", "user-1")
    assert exc.value.status_code == 429 and exc.value.headers == {"Retry-After": "3600"}
    rate_limit.enforce_rate_limit("ticket_create", "user-2")  # independent subject
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    rate_limit.enforce_rate_limit("ticket_create", "user-1")


def test_rate_limiter_fails_open_when_redis_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import queue

    def down(key: str, window: int) -> int:
        raise ConnectionError("redis down")

    monkeypatch.setattr(settings, "rate_limit_backend", "redis")
    monkeypatch.setattr(queue, "incr_window_counter", down)
    monkeypatch.setitem(rate_limit.LIMITS, "ticket_create", (0, 3600))
    rate_limit.enforce_rate_limit("ticket_create", "user-1")  # no exception


def test_json_log_formatter() -> None:
    record = logging.LogRecord("x", logging.INFO, "f", 1, "hello %s", ("w",), None)
    record.request_id = "r1"
    out = json.loads(JsonFormatter().format(record))
    assert out["msg"] == "hello w" and out["request_id"] == "r1" and out["level"] == "INFO"


# --- static guards on service_role (decision #1) ----------------------------------------


APP = Path(__file__).resolve().parents[1] / "app"


def test_privileged_module_is_imported_only_where_designated() -> None:
    importers = {
        str(p.relative_to(APP)).replace("\\", "/")
        for p in APP.rglob("*.py")
        if re.search(r"from app\.core import privileged|import app\.core\.privileged", p.read_text("utf-8"))
    }
    assert importers == {
        "api/routers/admin.py",  # user provisioning / role / status (Admin API)
        "services/tickets.py",  # ticket-number allocation only
        "workers/notification_worker.py",  # worker has no user JWT
    }


def test_every_privileged_function_writes_or_is_worker_bookkeeping() -> None:
    from app.core import privileged

    public = {
        n
        for n, f in inspect.getmembers(privileged, inspect.isfunction)
        if not n.startswith("_") and f.__module__ == privileged.__name__
    }
    assert public == {
        "provision_user",
        "update_user_role_or_org",
        "allocate_ticket_number",
        "hard_delete_ticket",
        "set_user_status",
        "resolve_notification_context",
        "insert_worker_notifications",
        "create_email_log",
        "update_email_log",
    }
    audited = {
        "provision_user",
        "update_user_role_or_org",
        "hard_delete_ticket",
        "set_user_status",
        "resolve_notification_context",
    }
    for name in audited:
        assert "_write_audit(" in inspect.getsource(getattr(privileged, name)), name


def test_worker_uses_only_worker_privileged_helpers() -> None:
    from app.workers import notification_worker

    uses = set(re.findall(r"privileged\.(\w+)\(", inspect.getsource(notification_worker)))
    assert uses == {
        "resolve_notification_context",
        "insert_worker_notifications",
        "create_email_log",
        "update_email_log",
    }


def test_no_direct_redis_or_resend_outside_their_modules() -> None:
    for p in APP.rglob("*.py"):
        rel = str(p.relative_to(APP)).replace("\\", "/")
        text = p.read_text("utf-8")
        if rel != "services/queue.py":
            assert "import redis" not in text, rel
        if not rel.startswith("services/email/"):
            assert "api.resend.com" not in text, rel
