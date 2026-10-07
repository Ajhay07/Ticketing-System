"""Email provider abstraction (spec §20, CLAUDE.md: no direct Resend calls
outside this package).

`get_email_provider()` picks the provider from EMAIL_PROVIDER
("noop" | "resend" | "smtp"). When EMAIL_PROVIDER is empty it auto-selects
"resend" if RESEND_API_KEY is set, else "smtp" if SMTP_HOST is set, else
noop. A provider that is selected but not fully configured also falls back
to noop - we never guess and never send in dev without explicit config.
SMTP credentials are backend-only and never logged or stored in email_logs
(SmtpEmailProvider sanitises every error it raises).
Providers raise EmailSendError on failure; retry/backoff and email_logs
bookkeeping live in the worker (app/workers/notification_worker.py).
"""

from __future__ import annotations

import logging
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Protocol

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class EmailSendError(Exception):
    """A delivery attempt failed (retryable from the worker's perspective)."""


class EmailProvider(Protocol):
    name: str

    def send(self, *, to: str, subject: str, html_body: str) -> str:
        """Send an email; return a provider message id. Raise EmailSendError."""
        ...


class NoopEmailProvider:
    """Used when no provider is configured (local dev / tests). Never sends;
    logs the recipient + subject only (no body) and returns a synthetic id.
    email_logs rows written for it carry provider = 'noop', so they are never
    mistaken for real deliveries."""

    name = "noop"

    def send(self, *, to: str, subject: str, html_body: str) -> str:
        logger.info("Email provider not configured; skipping send to %s: %s", to, subject)
        return f"noop-{uuid.uuid4()}"


class ResendEmailProvider:
    name = "resend"

    def __init__(self, api_key: str, from_address: str, timeout: float = 10.0) -> None:
        self._api_key = api_key
        self._from = from_address
        self._timeout = timeout

    def send(self, *, to: str, subject: str, html_body: str) -> str:
        try:
            response = httpx.post(
                RESEND_API_URL,
                headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                json={"from": self._from, "to": [to], "subject": subject, "html": html_body},
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise EmailSendError(f"Resend request failed: {type(exc).__name__}") from exc
        if response.status_code >= 400:
            # Never include the API key; Resend's error body is safe to keep.
            raise EmailSendError(f"Resend returned HTTP {response.status_code}: {response.text[:300]}")
        message_id = response.json().get("id")
        return str(message_id or "")


class SmtpEmailProvider:
    """Plain SMTP via the stdlib (synchronous, matching the worker's
    synchronous provider.send() call). Supports implicit TLS (SMTP_USE_SSL,
    usually port 465) or STARTTLS (SMTP_USE_TLS, usually port 587).

    Error messages raised from here are built only from the exception type and
    SMTP status code - never str(exc) from smtplib, never the username or
    password - because the worker stores the message in email_logs and logs it.
    """

    name = "smtp"

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        from_email: str,
        from_name: str = "",
        use_tls: bool = True,
        use_ssl: bool = False,
        timeout: float = 15.0,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._from_email = from_email
        self._from_name = from_name
        self._use_tls = use_tls
        self._use_ssl = use_ssl
        self._timeout = timeout

    def __repr__(self) -> str:  # never expose credentials via repr()
        return f"SmtpEmailProvider(host={self._host!r}, port={self._port})"

    def build_message(self, *, to: str, subject: str, html_body: str) -> EmailMessage:
        msg = EmailMessage()
        msg["From"] = formataddr((self._from_name, self._from_email)) if self._from_name else self._from_email
        msg["To"] = to
        msg["Subject"] = subject
        msg["Message-ID"] = make_msgid(domain=self._from_email.split("@")[-1] or None)
        msg.set_content("This message requires an HTML-capable email client.")
        msg.add_alternative(html_body, subtype="html")
        return msg

    def send(self, *, to: str, subject: str, html_body: str) -> str:
        msg = self.build_message(to=to, subject=subject, html_body=html_body)
        context = ssl.create_default_context()
        try:
            smtp: smtplib.SMTP
            if self._use_ssl:
                smtp = smtplib.SMTP_SSL(self._host, self._port, timeout=self._timeout, context=context)
            else:
                smtp = smtplib.SMTP(self._host, self._port, timeout=self._timeout)
            with smtp:
                if self._use_tls and not self._use_ssl:
                    smtp.starttls(context=context)
                if self._username:
                    smtp.login(self._username, self._password)
                smtp.send_message(msg)
        except smtplib.SMTPResponseException as exc:
            raise EmailSendError(f"SMTP error {exc.smtp_code} ({type(exc).__name__})") from None
        except (smtplib.SMTPException, OSError) as exc:
            raise EmailSendError(f"SMTP send failed: {type(exc).__name__}") from None
        return str(msg["Message-ID"])


def _smtp_configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_from_email)


def get_email_provider() -> EmailProvider:
    choice = (settings.email_provider or "").strip().lower()
    if not choice:
        if settings.resend_api_key:
            choice = "resend"
        elif _smtp_configured():
            choice = "smtp"
        else:
            choice = "noop"

    if choice == "resend" and settings.resend_api_key:
        return ResendEmailProvider(settings.resend_api_key, settings.email_from_address)
    if choice == "smtp" and _smtp_configured():
        return SmtpEmailProvider(
            host=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username,
            password=settings.smtp_password,
            from_email=settings.smtp_from_email,
            from_name=settings.smtp_from_name,
            use_tls=settings.smtp_use_tls,
            use_ssl=settings.smtp_use_ssl,
        )
    if choice not in ("noop", "resend", "smtp"):
        logger.error("Unknown EMAIL_PROVIDER %r; falling back to noop", choice)
    elif choice != "noop":
        logger.error("EMAIL_PROVIDER=%s is selected but not fully configured; falling back to noop", choice)
    if settings.environment == "production":
        logger.error("No email provider configured in production; emails will NOT be sent")
    return NoopEmailProvider()
