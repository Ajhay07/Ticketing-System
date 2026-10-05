"""In-app notification rows + queue hand-off (spec §26, §45, CLAUDE.md rule 10).

`commit_then_notify` is the single place ticket-changing endpoints hand off
notifications. It structurally enforces the ordering CLAUDE.md requires:

  1. COMMIT the ticket change (+ its audit row). If this fails, the request
     fails - nothing has been notified.
  2. Best effort: insert in-app `notifications` rows (separate transaction).
  3. Best effort: enqueue a job for the Phase 4 email worker.

Failures in steps 2 and 3 are logged and swallowed; they can never fail or
roll back the ticket operation.

Recipient resolution: in-app rows are written only for recipients whose id
the caller can already see on the ticket row (creator, assignee). "Notify the
CTO" (decision #8, spec §9) is passed to the worker as `notify_cto: true`
rather than resolved here, because client callers cannot (and must not) read
internal staff rows under RLS; the Phase 4 worker resolves CTO recipients.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import psycopg

from app.services import queue

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class InAppNotification:
    user_id: str | None
    type: str  # notification_type enum value (0001_schema.sql)
    title: str
    message: str


def commit_then_notify(
    conn: psycopg.Connection,
    *,
    actor_user_id: str,
    ticket_id: str,
    in_app: list[InAppNotification] | None = None,
    job: dict[str, Any] | None = None,
) -> None:
    conn.commit()  # step 1: may raise -> request fails, nothing notified

    recipients: list[InAppNotification] = []
    seen: set[str] = set()
    for n in in_app or []:
        if n.user_id and n.user_id != actor_user_id and n.user_id not in seen:
            seen.add(n.user_id)
            recipients.append(n)

    if recipients:
        try:
            with conn.cursor() as cur:
                for n in recipients:
                    # No RETURNING: notifications_select only exposes the
                    # recipient's own rows, not the actor's.
                    cur.execute(
                        """
                        insert into notifications (user_id, ticket_id, type, title, message)
                        values (%s, %s, %s, %s, %s)
                        """,
                        (n.user_id, ticket_id, n.type, n.title, n.message),
                    )
            conn.commit()
        except Exception:
            logger.exception("Failed to write in-app notifications for ticket %s", ticket_id)
            try:
                conn.rollback()
            except Exception:
                logger.exception("Rollback after notification failure also failed")

    if job is not None:
        try:
            queue.enqueue_notification({**job, "ticket_id": ticket_id, "actor_user_id": actor_user_id})
        except Exception:
            logger.exception("Failed to enqueue notification job for ticket %s", ticket_id)
