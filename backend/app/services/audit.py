"""Shared audit-log writer (spec §24, CLAUDE.md rule 8).

Every ticket event (creation, status change, assignment, comment, attachment,
resolve/close/reopen) writes exactly one row through this function, on the
SAME user-scoped connection/transaction as the change it describes - so the
audit row and the change commit or roll back together. audit_logs is
append-only (0002_rls.sql: no UPDATE/DELETE policy, REVOKE, guard trigger);
this module only ever INSERTs.

Note: clients can SELECT audit rows for their own organization's tickets
(audit_logs_select). Never put internal-note text or other internal-only
data into old_value/new_value/metadata.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.types.json import Jsonb


def write_audit(
    conn: psycopg.Connection,
    *,
    ticket_id: str | None,
    user_id: str,
    action: str,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> None:
    with conn.cursor() as cur:
        # No RETURNING: the caller may not be allowed to SELECT the row back.
        cur.execute(
            """
            insert into audit_logs (ticket_id, user_id, action, old_value, new_value, metadata, ip_address)
            values (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                ticket_id,
                user_id,
                action,
                Jsonb(old_value) if old_value is not None else None,
                Jsonb(new_value) if new_value is not None else None,
                Jsonb(metadata) if metadata is not None else None,
                ip_address,
            ),
        )
