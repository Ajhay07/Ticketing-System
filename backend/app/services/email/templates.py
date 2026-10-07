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


BRAND_NAME = "ClickfieldAI"
_BRAND = "#2557e6"  # brand-600 (frontend tailwind.config.ts)
_INK = "#0f172a"
_MUTED = "#64748b"
_FONT = "Arial,Helvetica,sans-serif"


def _layout(heading: str, lines: list[str], url: str) -> str:
    """Branded, table-based, inline-styled layout (no external CSS/fonts) so it
    renders consistently across email clients, including on mobile."""
    body = "".join(
        f'<p style="margin:0 0 12px;font-family:{_FONT};font-size:14px;line-height:1.5;color:{_INK}">'
        f"{line}</p>"
        for line in lines
    )
    href = escape(url, quote=True)
    return (
        '<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e2e8f0">'
        # Header
        f'<tr><td style="padding:18px 24px;border-bottom:3px solid {_BRAND}">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td style="background:{_BRAND};color:#ffffff;font-family:{_FONT};font-weight:bold;'
        'font-size:14px;width:28px;height:28px;text-align:center;border-radius:6px">C</td>'
        f'<td style="padding-left:10px;font-family:{_FONT};font-size:17px;font-weight:bold;color:{_INK}">'
        f'Clickfield<span style="color:{_BRAND}">AI</span></td></tr></table></td></tr>'
        # Body
        f'<tr><td style="padding:24px">'
        f'<h1 style="margin:0 0 16px;font-family:{_FONT};font-size:18px;line-height:1.3;color:{_INK}">'
        f"{heading}</h1>"
        f"{body}"
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px"><tr>'
        f'<td style="background:{_BRAND};border-radius:6px">'
        f'<a href="{href}" style="display:inline-block;padding:11px 20px;font-family:{_FONT};font-size:14px;'
        'font-weight:bold;color:#ffffff;text-decoration:none">Open Ticket</a></td></tr></table>'
        f'<p style="margin:12px 0 0;font-family:{_FONT};font-size:12px;color:{_MUTED};word-break:break-all">'
        f'Or open this link: <a href="{href}" style="color:{_BRAND}">{escape(url)}</a></p>'
        "</td></tr>"
        # Footer
        f'<tr><td style="padding:16px 24px;border-top:1px solid #e2e8f0;font-family:{_FONT};font-size:12px;'
        f'color:{_MUTED}">{BRAND_NAME} Support &middot; This is an automated message from the '
        f"{BRAND_NAME} Ticketing System.</td></tr>"
        "</table></td></tr></table></body></html>"
    )


def new_ticket(*, number: str, subject: str, organization: str, priority: str, url: str) -> EmailContent:
    n, s = escape(number), escape(subject)
    return EmailContent(
        subject=f"[ClickfieldAI] New Ticket {number} — {subject}",
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
        subject=f"[ClickfieldAI] Ticket {number} Assigned to You",
        html=_layout(
            f"Ticket {escape(number)} has been assigned to you",
            [f"<strong>{escape(subject)}</strong>", f"Priority: {escape(priority)}"],
            url,
        ),
    )


def client_reply(*, number: str, subject: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[ClickfieldAI] New Reply — {number}",
        html=_layout(
            f"The client replied on {escape(number)}",
            [f"<strong>{escape(subject)}</strong>", "Open the ticket to read the reply."],
            url,
        ),
    )


def team_reply(*, number: str, subject: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[ClickfieldAI] New Reply — {number}",
        html=_layout(
            f"Our team replied to your ticket {escape(number)}",
            [f"<strong>{escape(subject)}</strong>", "Open the ticket to read the reply."],
            url,
        ),
    )


def status_changed(*, number: str, status: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[ClickfieldAI] Ticket {number} Updated",
        html=_layout(
            f"Your ticket {escape(number)} has been updated.",
            [f"Status: <strong>{escape(_status_label(status))}</strong>"],
            url,
        ),
    )


def ticket_resolved(*, number: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[ClickfieldAI] Ticket {number} Resolved",
        html=_layout(
            f"Your ticket {escape(number)} has been marked as resolved.",
            ["Please review the ticket and confirm if the issue is fixed."],
            url,
        ),
    )


def ticket_closed(*, number: str, url: str) -> EmailContent:
    return EmailContent(
        subject=f"[ClickfieldAI] Ticket {number} Closed",
        html=_layout(f"Ticket {escape(number)} has been closed.", [], url),
    )
