"""Transactional email templates (spec §19, §21 "Open Ticket" link).

Each template is a plain function returning (subject, html). Every value
interpolated into HTML is escaped. Templates never include comment text or
internal notes - only ticket number, subject, status and a link back into
the portal, where RLS decides what the recipient may see.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape

from app.core.config import settings

STAFF_ROLES = {"SUPER_ADMIN", "ADMIN", "TEAM_MEMBER"}


@dataclass(frozen=True)
class EmailContent:
    subject: str
    html: str


def ticket_url(ticket_id: str, recipient_role: str) -> str:
    if recipient_role in ("SUPER_ADMIN", "ADMIN"):
        area = "admin"
    elif recipient_role == "TEAM_MEMBER":
        area = "team"
    else:
        area = "client"
    return f"{settings.app_url.rstrip('/')}/{area}/tickets/{ticket_id}"


def _status_label(status: str) -> str:
    return status.replace("_", " ").title()


def _layout(heading: str, lines: list[str], url: str) -> str:
    body = "".join(f'<p style="margin:0 0 12px">{line}</p>' for line in lines)
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;max-width:560px">'
        f'<h2 style="font-size:18px;margin:0 0 16px">{heading}</h2>{body}'
        f'<p style="margin:20px 0"><a href="{escape(url, quote=True)}" '
        'style="background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;'
        'text-decoration:none">Open Ticket</a></p>'
        '<p style="color:#64748b;font-size:12px">Clickfield AI Support</p></div>'
    )


def new_ticket(*, number: str, subject: str, organization: str, priority: str, url: str) -> EmailContent:
    n, s = escape(number), escape(subject)
    return EmailContent(
        subject=f"[Clickfield AI] New Ticket {number} — {subject}",
        html=_layout(
            f"New ticket {n}",
            [
                f"<strong>{s}</strong>",
                f"Client: {escape(organization)}",
                f"Priority: {escape(priority)}",
            ],
            url,
        ),
    )


def ticket_assigned(*, number: str, subject: str, priority: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[Clickfield AI] Ticket {number} Assigned to You",
        html=_layout(
            f"Ticket {escape(number)} has been assigned to you",
            [f"<strong>{escape(subject)}</strong>", f"Priority: {escape(priority)}"],
            url,
        ),
    )


def client_reply(*, number: str, subject: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[Clickfield AI] New Reply — {number}",
        html=_layout(
            f"The client replied on {escape(number)}",
            [f"<strong>{escape(subject)}</strong>", "Open the ticket to read the reply."],
            url,
        ),
    )


def team_reply(*, number: str, subject: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[Clickfield AI] New Reply — {number}",
        html=_layout(
            f"Our team replied to your ticket {escape(number)}",
            [f"<strong>{escape(subject)}</strong>", "Open the ticket to read the reply."],
            url,
        ),
    )


def status_changed(*, number: str, status: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[Clickfield AI] Ticket {number} Updated",
        html=_layout(
            f"Your ticket {escape(number)} has been updated.",
            [f"Status: <strong>{escape(_status_label(status))}</strong>"],
            url,
        ),
    )


def ticket_resolved(*, number: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[Clickfield AI] Ticket {number} Resolved",
        html=_layout(
            f"Your ticket {escape(number)} has been marked as resolved.",
            ["Please review the ticket and confirm if the issue is fixed."],
            url,
        ),
    )


def ticket_closed(*, number: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[Clickfield AI] Ticket {number} Closed",
        html=_layout(f"Ticket {escape(number)} has been closed.", [], url),
    )
