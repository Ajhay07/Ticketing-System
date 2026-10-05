"""Email provider abstraction (spec §20, CLAUDE.md: no direct Resend calls
outside this package).

`get_email_provider()` returns the Resend-backed provider when
RESEND_API_KEY is configured, otherwise a NoopEmailProvider that only logs
(dev-safe: DEV has no real Resend key and the test suite never needs one).
Providers raise EmailSendError on failure; retry/backoff and email_logs
bookkeeping live in the worker (app/workers/notification_worker.py).
"""

from __future__ import annotations

import logging
import uuid
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


def get_email_provider() -> EmailProvider:
    if settings.resend_api_key:
        return ResendEmailProvider(settings.resend_api_key, settings.email_from_address)
    if settings.environment == "production":
        logger.error("RESEND_API_KEY is not set in production; emails will NOT be sent")
    return NoopEmailProvider()
