"""Email provider abstraction.

Full templates and send logic land in Phase 4 (spec §19-21). This Phase 1
stub only defines the interface so the queue worker scaffold has something
concrete to call, per the provider-abstraction rule in CLAUDE.md.
"""

from __future__ import annotations

from typing import Protocol


class EmailProvider(Protocol):
    def send(self, *, to: str, subject: str, html_body: str) -> str:
        """Send an email; return a provider message id."""
        ...


class NoopEmailProvider:
    """Used until Phase 4 wires a real provider (Resend). Never used in
    production - app startup should fail if RESEND_API_KEY is unset and
    environment == 'production' once Phase 4 lands."""

    def send(self, *, to: str, subject: str, html_body: str) -> str:
        raise NotImplementedError("Email sending is implemented in Phase 4")
