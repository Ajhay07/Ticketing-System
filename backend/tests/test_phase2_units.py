"""Phase 2 unit tests (no database): new permission helpers, attachment
validation, and the commit-then-notify ordering guarantee."""

from __future__ import annotations

from typing import Any

import pytest

from app.core.security import Principal, Role
from app.domain import permissions
from app.services import attachments, notifications, queue
from app.services.notifications import InAppNotification, commit_then_notify


def _p(role: Role, *, user_id: str = "u1", org: str = "org-a") -> Principal:
    return Principal(user_id=user_id, organization_id=org, role=role, email="x@example.com", raw_token="t")


# --- permissions -----------------------------------------------------------


def test_only_clients_create_tickets() -> None:
    assert permissions.can_create_client_ticket(_p(Role.CLIENT_USER))
    assert permissions.can_create_client_ticket(_p(Role.CLIENT_ADMIN))
    for role in (Role.TEAM_MEMBER, Role.ADMIN, Role.SUPER_ADMIN):
        assert not permissions.can_create_client_ticket(_p(role))


def test_resolve_requires_admin_or_assignee() -> None:
    assert permissions.can_resolve_ticket(_p(Role.ADMIN), ticket_assigned_to=None)
    assert permissions.can_resolve_ticket(_p(Role.TEAM_MEMBER, user_id="arjun"), ticket_assigned_to="arjun")
    assert not permissions.can_resolve_ticket(_p(Role.TEAM_MEMBER, user_id="arjun"), ticket_assigned_to="k")
    assert not permissions.can_resolve_ticket(_p(Role.CLIENT_USER), ticket_assigned_to=None)


def test_reopen_is_client_own_org_or_admin() -> None:
    assert permissions.can_reopen_ticket(_p(Role.CLIENT_USER), ticket_organization_id="org-a")
    assert not permissions.can_reopen_ticket(_p(Role.CLIENT_USER), ticket_organization_id="org-b")
    assert permissions.can_reopen_ticket(_p(Role.ADMIN), ticket_organization_id="org-b")
    assert not permissions.can_reopen_ticket(_p(Role.TEAM_MEMBER), ticket_organization_id="org-a")


def test_client_cannot_write_internal_comment() -> None:
    client = _p(Role.CLIENT_ADMIN)
    assert permissions.can_write_comment(
        client, visibility="CLIENT", ticket_organization_id="org-a", ticket_assigned_to=None
    )
    assert not permissions.can_write_comment(
        client, visibility="INTERNAL", ticket_organization_id="org-a", ticket_assigned_to=None
    )
    assert not permissions.can_write_comment(
        client, visibility="CLIENT", ticket_organization_id="org-b", ticket_assigned_to=None
    )


def test_internal_note_by_team_member_requires_assignment() -> None:
    tm = _p(Role.TEAM_MEMBER, user_id="arjun")
    assert permissions.can_write_comment(
        tm, visibility="INTERNAL", ticket_organization_id="org-a", ticket_assigned_to="arjun"
    )
    assert not permissions.can_write_comment(
        tm, visibility="INTERNAL", ticket_organization_id="org-a", ticket_assigned_to="other"
    )


# --- attachment validation -------------------------------------------------


@pytest.mark.parametrize(
    ("name", "mime"),
    [
        ("shot.png", "image/png"),
        ("photo.JPG", "image/jpeg"),
        ("report.pdf", "application/pdf"),
        ("data.csv", "text/csv"),
        ("bundle.zip", "application/zip"),
        ("sheet.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ],
)
def test_allowed_attachment_types(name: str, mime: str) -> None:
    attachments.validate_attachment(file_name=name, mime_type=mime, file_size=1000)


@pytest.mark.parametrize(
    ("name", "mime", "size"),
    [
        ("evil.exe", "application/x-msdownload", 100),
        ("page.html", "text/html", 100),
        ("fake.pdf", "image/png", 100),  # extension/MIME mismatch
        ("big.pdf", "application/pdf", 25 * 1024 * 1024 + 1),
        ("empty.pdf", "application/pdf", 0),
    ],
)
def test_rejected_attachments(name: str, mime: str, size: int) -> None:
    with pytest.raises(attachments.AttachmentValidationError):
        attachments.validate_attachment(file_name=name, mime_type=mime, file_size=size)


def test_exactly_25mb_is_allowed() -> None:
    attachments.validate_attachment(
        file_name="a.pdf", mime_type="application/pdf", file_size=25 * 1024 * 1024
    )


def test_safe_file_name_strips_paths() -> None:
    assert attachments.safe_file_name("../../etc/passwd") == "passwd"
    assert attachments.safe_file_name("C:\\x\\my report (1).pdf") == "my_report_1_.pdf"
    assert attachments.safe_file_name("...") == "file"


# --- commit-then-notify ----------------------------------------------------


class _FakeCursor:
    def __init__(self, conn: _FakeConn) -> None:
        self.conn = conn

    def __enter__(self) -> _FakeCursor:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, query: str, params: Any = None) -> None:
        self.conn.events.append("insert_notification")
        if self.conn.fail_inserts:
            raise RuntimeError("notifications table down")


class _FakeConn:
    def __init__(self, *, fail_inserts: bool = False) -> None:
        self.events: list[str] = []
        self.fail_inserts = fail_inserts

    def commit(self) -> None:
        self.events.append("commit")

    def rollback(self) -> None:
        self.events.append("rollback")

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self)


class _RecordingQueue:
    def __init__(self, events: list[str], fail: bool = False) -> None:
        self.events = events
        self.fail = fail
        self.jobs: list[dict[str, Any]] = []

    def enqueue(self, name: str, payload: dict[str, Any]) -> None:
        self.events.append("enqueue")
        if self.fail:
            raise ConnectionError("redis down")
        self.jobs.append(payload)

    def dequeue(self, name: str, timeout: int = 5) -> dict[str, Any] | None:
        return None


def test_commit_happens_before_notifications_and_enqueue(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _FakeConn()
    q = _RecordingQueue(conn.events)
    monkeypatch.setattr(queue, "_backend", q)
    commit_then_notify(
        conn,  # type: ignore[arg-type]
        actor_user_id="actor",
        ticket_id="t1",
        in_app=[InAppNotification("someone", "TICKET_ASSIGNED", "t", "m")],
        job={"event": "X"},
    )
    assert conn.events == ["commit", "insert_notification", "commit", "enqueue"]
    assert q.jobs[0]["ticket_id"] == "t1"


def test_notification_failures_never_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _FakeConn(fail_inserts=True)
    monkeypatch.setattr(queue, "_backend", _RecordingQueue(conn.events, fail=True))
    commit_then_notify(
        conn,  # type: ignore[arg-type]
        actor_user_id="actor",
        ticket_id="t1",
        in_app=[InAppNotification("someone", "TICKET_ASSIGNED", "t", "m")],
        job={"event": "X"},
    )
    assert conn.events[0] == "commit"
    assert "rollback" in conn.events
    assert conn.events[-1] == "enqueue"


def test_actor_is_never_notified_about_own_action(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = _FakeConn()
    monkeypatch.setattr(queue, "_backend", _RecordingQueue(conn.events))
    commit_then_notify(
        conn,  # type: ignore[arg-type]
        actor_user_id="actor",
        ticket_id="t1",
        in_app=[
            InAppNotification("actor", "TICKET_CLOSED", "t", "m"),
            InAppNotification(None, "TICKET_CLOSED", "t", "m"),
        ],
    )
    assert conn.events == ["commit"]


def test_notifications_module_never_imports_privileged() -> None:
    import inspect

    assert "privileged" not in inspect.getsource(notifications)


def test_attachment_count_below_cap_is_allowed() -> None:
    attachments.validate_attachment_count(0)
    attachments.validate_attachment_count(49)


def test_attachment_count_at_cap_is_rejected() -> None:
    with pytest.raises(attachments.AttachmentValidationError):
        attachments.validate_attachment_count(50)


def test_each_file_in_a_batch_is_validated_independently() -> None:
    # The create-ticket form uploads several files; each goes through the same
    # per-file validator, so one bad file never makes another one pass or fail.
    batch = [
        ("ok.pdf", "application/pdf", 10),
        ("evil.exe", "application/x-msdownload", 10),
        ("ok.png", "image/png", 10),
        ("huge.zip", "application/zip", 25 * 1024 * 1024 + 1),
    ]
    results = []
    for name, mime, size in batch:
        try:
            attachments.validate_attachment(file_name=name, mime_type=mime, file_size=size)
            results.append(True)
        except attachments.AttachmentValidationError:
            results.append(False)
    assert results == [True, False, True, False]


def test_counts_route_is_registered_before_ticket_id_route() -> None:
    # "/counts" must not be captured by "/{ticket_id}" (which would 422 on a non-UUID).
    from app.main import app

    paths = [getattr(r, "path", "") for r in app.routes]
    assert paths.index("/api/tickets/counts") < paths.index("/api/tickets/{ticket_id}")
