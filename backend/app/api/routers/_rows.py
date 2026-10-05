"""Tiny helper to turn a cursor's result into a list of dicts, satisfying the
type checker about `cursor.description` possibly being None (it never is
after a SELECT has executed, but psycopg's stub types it that way)."""

from __future__ import annotations

from typing import Any

import psycopg


def rows_as_dicts(cur: psycopg.Cursor) -> list[dict[str, Any]]:
    description = cur.description
    if description is None:
        return []
    columns = [col.name for col in description]
    return [dict(zip(columns, row, strict=True)) for row in cur.fetchall()]


def row_as_dict(cur: psycopg.Cursor) -> dict[str, Any] | None:
    description = cur.description
    if description is None:
        return None
    row = cur.fetchone()
    if row is None:
        return None
    columns = [col.name for col in description]
    return dict(zip(columns, row, strict=True))
