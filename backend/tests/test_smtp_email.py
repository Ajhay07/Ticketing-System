"""SMTP email provider: selection, message building, error sanitising
(SMTP credentials must never reach logs or email_logs). Pure unit tests -
smtplib is replaced by a fake, no network or DB."""

from __future__ import annotations

import logging
import smtplib
from typing import Any

import pytest

from app.core.config import settings
from app.services import email as email_pkg
from app.services.email import templates

SECRET = "sup3r-secret-smtp-pa55word"


class FakeSMTP:
    instances: list[FakeSMTP] = []
    fail_login: bool = False
    fail_connect: bool = False

    def __init__(self, host: str, port: int, timeout: float = 0, **kw: Any) -> None:
        if FakeSMTP.fail_connect:
            raise ConnectionRefusedError(f"cannot reach {host} with {SECRET}")
        self.host, self.port = host, port
        self.started_tls = False
        self.logged_in: tuple[str, str] | None = None
        self.sent: list[Any] = []
        FakeSMTP.instances.append(self)

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *a: object) -> None:
        return None

    def starttls(self, context: Any = None) -> None:
        self.started_tls = True

    def login(self, user: str, password: str) -> None:
        if FakeSMTP.fail_login:
            # Real servers sometimes echo credentials back; make sure we never propagate it.
            raise smtplib.SMTPAuthenticationError(535, f"bad credentials {user}:{password}".encode())
        self.logged_in = (user, password)

    def send_message(self, msg: Any) -> None:
        self.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch: pytest.MonkeyPatch) -> type[FakeSMTP]:
    FakeSMTP.instances = []
    FakeSMTP.fail_login = False
    FakeSMTP.fail_connect = False
    monkeypatch.setattr(email_pkg.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(email_pkg.smtplib, "SMTP_SSL", FakeSMTP)
    for k, v in {
        "email_provider": "",
        "resend_api_key": "",
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "smtp_username": "mailer@example.test",
        "smtp_password": SECRET,
        "smtp_from_email": "support@example.test",
        "smtp_from_name": "ClickfieldAI Support",
        "smtp_use_tls": True,
        "smtp_use_ssl": False,
    }.items():
        monkeypatch.setattr(settings, k, v)
    return FakeSMTP


def test_provider_selection(smtp: type[FakeSMTP], monkeypatch: pytest.MonkeyPatch) -> None:
    assert email_pkg.get_email_provider().name == "smtp"  # auto-detected from SMTP_HOST
    monkeypatch.setattr(settings, "email_provider", "noop")
    assert email_pkg.get_email_provider().name == "noop"  # explicit noop wins
    monkeypatch.setattr(settings, "email_provider", "smtp")
    monkeypatch.setattr(settings, "smtp_host", "")
    assert email_pkg.get_email_provider().name == "noop"  # selected but unconfigured -> noop
    monkeypatch.setattr(settings, "email_provider", "carrier-pigeon")
    assert email_pkg.get_email_provider().name == "noop"


def test_noop_when_nothing_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("email_provider", "resend_api_key", "smtp_host", "smtp_from_email"):
        monkeypatch.setattr(settings, k, "")
    p = email_pkg.get_email_provider()
    assert p.name == "noop" and p.send(to="a@example.com", subject="s", html_body="h").startswith("noop-")


def test_smtp_send_starttls_login_and_message(smtp: type[FakeSMTP]) -> None:
    p = email_pkg.get_email_provider()
    content = templates.team_reply(number="CF-1", subject="Printer", url="https://x/client/tickets/1")
    mid = p.send(to="client@example.com", subject=content.subject, html_body=content.html)
    conn = smtp.instances[0]
    assert conn.started_tls and conn.logged_in == ("mailer@example.test", SECRET)
    msg = conn.sent[0]
    assert msg["To"] == "client@example.com" and msg["Subject"] == "[ClickfieldAI] New Reply — CF-1"
    assert "ClickfieldAI Support" in msg["From"] and mid == msg["Message-ID"]
    html = msg.get_body(preferencelist=("html",)).get_content()
    assert "https://x/client/tickets/1" in html and "Open Ticket" in html
    assert SECRET not in msg.as_string() and SECRET not in repr(p)


def test_smtp_ssl_mode_skips_starttls(smtp: type[FakeSMTP], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "smtp_use_ssl", True)
    email_pkg.get_email_provider().send(to="a@example.com", subject="s", html_body="<p>h</p>")
    assert smtp.instances[0].started_tls is False


@pytest.mark.parametrize("mode", ["login", "connect"])
def test_smtp_errors_never_contain_credentials(
    smtp: type[FakeSMTP], mode: str, caplog: pytest.LogCaptureFixture
) -> None:
    from app.workers import notification_worker as worker

    smtp.fail_login = mode == "login"
    smtp.fail_connect = mode == "connect"
    p = email_pkg.get_email_provider()
    with pytest.raises(email_pkg.EmailSendError) as ei:
        p.send(to="a@example.com", subject="s", html_body="h")
    err = ei.value
    assert SECRET not in str(err) and "mailer@example.test" not in str(err)
    assert err.__cause__ is None and err.__suppress_context__  # no chained exception carrying secrets

    # Through the worker's real retry/bookkeeping path, with email_logs writes captured.
    stored: list[dict[str, Any]] = []
    orig = worker.privileged

    class _Priv:
        @staticmethod
        def create_email_log(**kw: Any) -> str:
            stored.append(kw)
            return "log-1"

        @staticmethod
        def update_email_log(**kw: Any) -> None:
            stored.append(kw)

    worker.privileged = _Priv  # type: ignore[assignment]
    try:
        with caplog.at_level(logging.DEBUG):
            ok = worker.deliver_email(
                p,
                ticket_id="t",
                recipient="a@example.com",
                email_type="TEAM_REPLY",
                content=templates.EmailContent(subject="s", html="h"),
                sleep=lambda _: None,
            )
    finally:
        worker.privileged = orig
    assert ok is False
    assert stored[-1]["status"] == "FAILED"
    assert SECRET not in repr(stored)
    assert SECRET not in caplog.text


def test_templates_are_branded_and_table_based() -> None:
    c = templates.new_ticket(number="CF-1", subject="s", organization="o", priority="LOW", url="https://x")
    assert c.subject.startswith("[ClickfieldAI]")
    assert "Clickfield AI" not in c.html and "ClickfieldAI Support" in c.html
    assert 'role="presentation"' in c.html and "<link" not in c.html and "<style" not in c.html
