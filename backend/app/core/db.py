"""Per-request, JWT-scoped Postgres connections.

This is the mechanism that makes decision #1 ("RLS must actually run") real:
for every normal request we check out a connection, set the Postgres
session's `request.jwt.claims` GUC to the caller's verified JWT payload, and
switch to role `authenticated`. This mirrors exactly what Supabase's own
PostgREST/pooler layer does, so the `auth.jwt()` / `auth.uid()` /
`auth.role()` helpers used by our RLS policies
(supabase/migrations/0002_rls.sql) behave identically to a request made
through Supabase's REST API — RLS is enforced by Postgres itself, not
emulated in application code.

Connections come from a small process-wide pool instead of a fresh
`psycopg.connect()` per request. The database is far from the API host, so a
new connection (TCP + TLS + Postgres auth) cost several network round trips
on EVERY request. Pooling does not change the RLS model:

- The claims and role are set on every checkout, from this request's
  Principal only. They are SESSION-level (not SET LOCAL) on purpose: several
  routes commit mid-request, and transaction-local settings would silently
  revert to the privileged login role after the first commit.
- On return, the pool's `reset` hook runs `RESET ROLE` and clears the claims
  before the connection can be handed to anyone else. If that reset fails,
  psycopg_pool discards the connection rather than reusing it. A connection
  returned mid-transaction is rolled back by the pool first.

The service_role path (privileged.py) is the ONLY other way the backend talks
to Postgres, and it is isolated there deliberately (it does not use this
pool).
"""

from __future__ import annotations

import json
import threading
import time
import weakref
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg_pool import ConnectionPool

from app.core.config import settings
from app.core.security import Principal

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()

# The database is a full cross-region round trip away, so every statement the
# pool itself sends (ping, BEGIN, reset, COMMIT) costs as much as a real
# query. Pipeline mode sends a group of statements in ONE round trip; the
# semantics are unchanged (same statements, same order, same transaction).

# When each pooled connection was last returned. Only connections idle longer
# than this are pinged on checkout: a connection used moments ago is alive,
# and pinging it on every request cost a full round trip per request.
_last_returned: weakref.WeakKeyDictionary[psycopg.Connection, float] = weakref.WeakKeyDictionary()
_CHECK_AFTER_IDLE_SECONDS = 30.0


# Connections whose identity was already stripped in-band by _scoped() on the
# success path (commit + reset in the same round trip). The pool's reset hook
# skips those once; every other return (errors, anything unexpected) still
# goes through the full reset below.
_already_reset: weakref.WeakSet[psycopg.Connection] = weakref.WeakSet()


def _strip_identity(conn: psycopg.Connection) -> None:
    """RESET ROLE + clear claims + COMMIT, pipelined into one round trip.
    Callers must not issue it with a request's transaction still pending
    unless they intend to commit that transaction (see _scoped)."""
    with conn.pipeline():
        conn.execute("reset role")
        conn.execute("select set_config('request.jwt.claims', '', false)")
        conn.commit()


def _reset_session(conn: psycopg.Connection) -> None:
    """Strip any per-request identity before a connection is reused.

    If any statement fails, the exception propagates and psycopg_pool
    discards the connection instead of reusing it (unchanged behavior).
    """
    if conn in _already_reset:
        _already_reset.discard(conn)
        # Belt and braces, no network: a connection that was reset in-band
        # cannot be in a transaction; if it somehow is, do the full reset.
        if conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE:
            _last_returned[conn] = time.monotonic()
            return
    _strip_identity(conn)
    _last_returned[conn] = time.monotonic()


def _check_if_idle(conn: psycopg.Connection) -> None:
    """Ping only connections that sat idle long enough for the remote pooler
    to have dropped them; raising makes the pool discard and replace it."""
    returned = _last_returned.get(conn)
    if returned is None or time.monotonic() - returned > _CHECK_AFTER_IDLE_SECONDS:
        ConnectionPool.check_connection(conn)


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ConnectionPool(
                    settings.database_url,
                    min_size=1,
                    # Kept small: the Supabase session pooler caps client
                    # connections per project.
                    max_size=5,
                    max_idle=300,
                    timeout=15,
                    reset=_reset_session,
                    # Drop connections the remote pooler closed while idle,
                    # instead of failing a request (pings only idle ones).
                    check=_check_if_idle,
                    open=True,
                    name="user_scoped",
                )
    return _pool


@contextmanager
def _scoped(role: str, claims: dict | None) -> Iterator[psycopg.Connection]:
    with _get_pool().connection() as conn:
        # set_config('role', ..., false) is equivalent to SET ROLE. Pipelined
        # so the implicit BEGIN and this statement share one round trip; the
        # pipeline syncs (and raises on error) before any route query runs.
        with conn.pipeline():
            conn.execute(
                "select set_config('request.jwt.claims', %s, false), set_config('role', %s, false)",
                (json.dumps(claims) if claims is not None else "", role),
            )
        # pool.connection() rolls back on exception (and then fully resets).
        yield conn
        # Success: commit the request's work AND strip its identity in one
        # round trip (was COMMIT, then a separate reset round trip). The
        # pool's own commit afterwards is a no-op (no open transaction). If
        # this raises, nothing is marked and the pool rolls back + resets.
        if conn.info.transaction_status != psycopg.pq.TransactionStatus.INERROR:
            _strip_identity(conn)
            _already_reset.add(conn)


@contextmanager
def user_scoped_connection(principal: Principal) -> Iterator[psycopg.Connection]:
    """Check out a connection scoped to `principal`'s JWT, with RLS enforced.

    Usage:
        with user_scoped_connection(principal) as conn:
            with conn.cursor() as cur:
                cur.execute("select * from tickets")
    """
    claims = {
        "sub": principal.user_id,
        "role": "authenticated",
        "email": principal.email,
        "app_metadata": {
            "role": principal.role.value,
            "organization_id": principal.organization_id,
        },
    }
    with _scoped("authenticated", claims) as conn:
        yield conn


@contextmanager
def anon_connection() -> Iterator[psycopg.Connection]:
    """Connection with no authenticated claims (for truly public reads, if any)."""
    with _scoped("anon", None) as conn:
        yield conn
