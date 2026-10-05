"""Notification worker (spec §19-§21, §26, §45, §46; decision #8).

Runs as its own process (`python -m app.workers.notification_worker`),
consuming jobs that request handlers enqueue AFTER their ticket transaction
has committed (app.services.notifications.commit_then_notify). For each job:

  1. Resolve the ticket summary and recipients server-side via
     app.core.privileged.resolve_notification_context. "Notify the CTO"
     (`notify_cto: true`) is resolved HERE - to every active ADMIN in the
     internal org - never in the client's request, because clients cannot
     (and must not) read staff rows under RLS.
  2. Write in-app notification rows for the CTO recipients resolved here
     (creator/assignee rows were already written in the request path).
  3. Render the spec §19 template and send through the configured
     EmailProvider, up to settings.email_max_attempts times with exponential
     backoff, recording every attempt in email_logs (status / attempt_count
     / error_message).

The worker never raises out of the loop: every job, and every recipient
within a job, is isolated by try/except, so one bad job or provider outage
cannot stop later jobs. It is fully decoupled from the request path, so
nothing here can fail or roll back a ticket operation.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

from app.core import privileged
from app.core.config import settings
from app.core.logging import configure_logging
from app.services.email import EmailProvider, get_email_provider, templates
from app.services.queue import NOTIFICATION_QUEUE_KEY, get_queue_backend

logger = logging.getLogger("notification_worker")

CLIENT_ROLES = {"CLIENT_ADMIN", "CLIENT_USER"}

# event -> (email_notification_type, in-app notification_type for CTO recipients)
EVENTS: dict[str, tuple[str, str]] = {
    "NEW_TICKET": ("NEW_TICKET", "NEW_TICKET"),
    "TICKET_ASSIGNED": ("TICKET_ASSIGNED", "TICKET_ASSIGNED"),
    "CLIENT_REPLY": ("CLIENT_REPLY", "CLIENT_REPLY"),
    "TEAM_REPLY": ("TEAM_REPLY", "TEAM_REPLY"),
    "STATUS_CHANGED": ("STATUS_CHANGED", "TICKET_STATUS_CHANGED"),
    "RESOLVED": ("TICKET_RESOLVED", "TICKET_RESOLVED"),
    "CLOSED": ("TICKET_CLOSED", "TICKET_CLOSED"),
    "REOPENED": ("STATUS_CHANGED", "TICKET_REOPENED"),
}


def render(
    event: str, ticket: dict[str, Any], recipient_role: str, job: dict[str, Any]
) -> templates.EmailContent:
    url = templates.ticket_url(ticket["id"], recipient_role)
    number, subject = ticket["ticket_number"], ticket["subject"]
    if event == "NEW_TICKET":
        return templates.new_ticket(
            number=number,
            subject=subject,
            organization=ticket["organization_name"],
            priority=ticket["priority"],
            url=url,
        )
    if event == "TICKET_ASSIGNED":
        return templates.ticket_assigned(number=number, subject=subject, priority=ticket["priority"], url=url)
    if event == "CLIENT_REPLY":
        return templates.client_reply(number=number, subject=subject, url=url)
    if event == "TEAM_REPLY":
        return templates.team_reply(number=number, subject=subject, url=url)
    if event == "RESOLVED":
        return templates.ticket_resolved(number=number, url=url)
    if event == "CLOSED":
        return templates.ticket_closed(number=number, url=url)
    # STATUS_CHANGED / REOPENED
    return templates.status_changed(number=number, status=job.get("new_status") or ticket["status"], url=url)


def select_email_recipients(event: str, job: dict[str, Any], recipients: list[dict[str, Any]]) -> list[dict]:
    actor = job.get("actor_user_id")
    chosen = []
    for r in recipients:
        if not r.get("email"):
            continue
        # The actor is never emailed about their own action, except the
        # client's own "ticket received" confirmation (spec §9).
        if r["id"] == actor and event != "NEW_TICKET":
            continue
        # Spec §19: status / resolved / closed emails are client-facing.
        if event in ("STATUS_CHANGED", "RESOLVED", "CLOSED") and r["role"] not in CLIENT_ROLES:
            continue
        chosen.append(r)
    return chosen


def deliver_email(
    provider: EmailProvider,
    *,
    ticket_id: str,
    recipient: str,
    email_type: str,
    content: templates.EmailContent,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    """Send one email with retry + exponential backoff (spec §46), recording
    each attempt in email_logs. Returns True on success. Never raises for a
    provider failure."""
    log_id = privileged.create_email_log(
        ticket_id=ticket_id, recipient=recipient, notification_type=email_type, provider=provider.name
    )
    attempts = max(1, settings.email_max_attempts)
    for attempt in range(1, attempts + 1):
        try:
            message_id = provider.send(to=recipient, subject=content.subject, html_body=content.html)
        except Exception as exc:  # any provider/network failure is retryable
            final = attempt == attempts
            privileged.update_email_log(
                email_log_id=log_id,
                status="FAILED" if final else "PENDING",
                attempt_count=attempt,
                error_message=str(exc)[:500] or type(exc).__name__,
            )
            logger.warning("Email attempt %s/%s to %s failed: %s", attempt, attempts, recipient, exc)
            if not final:
                sleep(settings.email_retry_base_seconds * (2 ** (attempt - 1)))
            continue
        privileged.update_email_log(
            email_log_id=log_id, status="SENT", attempt_count=attempt, provider_message_id=message_id
        )
        return True
    return False


def process_job(
    job: dict[str, Any],
    provider: EmailProvider | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int]:
    """Handle one queue job. Returns counters (for logging and tests)."""
    result = {"in_app": 0, "emails_sent": 0, "emails_failed": 0}
    event = str(job.get("event", ""))
    if event not in EVENTS:
        logger.warning("Ignoring job with unknown event %r", event)
        return result
    ticket_id = job.get("ticket_id")
    if not ticket_id:
        logger.warning("Ignoring %s job without ticket_id", event)
        return result
    email_type, in_app_type = EVENTS[event]
    user_ids = [str(u) for u in (job.get("recipient_user_ids") or []) if u]
    context = privileged.resolve_notification_context(
        ticket_id=str(ticket_id), user_ids=user_ids, include_admins=bool(job.get("notify_cto"))
    )
    if context is None:
        logger.info("Ticket %s no longer visible (deleted?); dropping %s job", ticket_id, event)
        return result
    ticket, recipients = context["ticket"], context["recipients"]
    actor = job.get("actor_user_id")

    cto_rows = [
        {
            "user_id": r["id"],
            "ticket_id": ticket["id"],
            "type": in_app_type,
            "title": f"{ticket['ticket_number']}: {event.replace('_', ' ').title()}",
            "message": ticket["subject"],
        }
        for r in recipients
        if r["via_cto"] and r["id"] != actor
    ]
    try:
        privileged.insert_worker_notifications(cto_rows)
        result["in_app"] = len(cto_rows)
    except Exception:
        logger.exception("Failed to write CTO in-app notifications for ticket %s", ticket_id)

    provider = provider or get_email_provider()
    for r in select_email_recipients(event, job, recipients):
        try:
            content = render(event, ticket, r["role"], job)
            ok = deliver_email(
                provider,
                ticket_id=ticket["id"],
                recipient=r["email"],
                email_type=email_type,
                content=content,
                sleep=sleep,
            )
            result["emails_sent" if ok else "emails_failed"] += 1
        except Exception:
            result["emails_failed"] += 1
            logger.exception("Email delivery bookkeeping failed for ticket %s", ticket_id)
    return result


def run_once(timeout: int = 5) -> bool:
    """Dequeue and process at most one job. Returns True if a job was seen."""
    job = get_queue_backend().dequeue(NOTIFICATION_QUEUE_KEY, timeout=timeout)
    if job is None:
        return False
    try:
        outcome = process_job(job)
        logger.info("Processed %s job for ticket %s: %s", job.get("event"), job.get("ticket_id"), outcome)
    except Exception:
        # Never let one job kill the worker.
        logger.exception(
            "Notification job failed: event=%s ticket=%s", job.get("event"), job.get("ticket_id")
        )
    return True


def run_forever() -> None:
    configure_logging()
    logger.info("Notification worker started, watching queue %s", NOTIFICATION_QUEUE_KEY)
    while True:
        try:
            run_once(timeout=5)
        except Exception:
            # Queue store unreachable etc.: back off and keep going.
            logger.exception("Queue unavailable; retrying in 5s")
            time.sleep(5)


if __name__ == "__main__":
    run_forever()
