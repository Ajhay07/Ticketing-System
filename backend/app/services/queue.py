"""Queue abstraction (decision #2: Redis + a dedicated worker for V1).

Kept deliberately minimal so the backend behind this interface can be
swapped later without touching call sites (CLAUDE.md rule). Full job
payloads/consumers for email notifications are implemented in Phase 4; this
Phase 1 version provides the interface and a working Redis-backed
implementation so the worker scaffold can be exercised.
"""

from __future__ import annotations

import json
from typing import Any, Protocol

import redis

from app.core.config import settings

NOTIFICATION_QUEUE_KEY = "clickfield:notifications"


class QueueBackend(Protocol):
    def enqueue(self, queue: str, payload: dict[str, Any]) -> None: ...

    def dequeue(self, queue: str, timeout: int = 5) -> dict[str, Any] | None: ...


class RedisQueueBackend:
    def __init__(self, redis_url: str | None = None) -> None:
        self._client = redis.Redis.from_url(redis_url or settings.redis_url)

    def enqueue(self, queue: str, payload: dict[str, Any]) -> None:
        self._client.rpush(queue, json.dumps(payload))

    def dequeue(self, queue: str, timeout: int = 5) -> dict[str, Any] | None:
        result = self._client.blpop([queue], timeout=timeout)
        if result is None:
            return None
        _, raw = result
        return json.loads(raw)


class InMemoryQueueBackend:
    """Process-local queue (tests, and single-process local dev without
    Redis). Not for production: jobs are lost on restart."""

    def __init__(self) -> None:
        self._queues: dict[str, list[dict[str, Any]]] = {}

    def enqueue(self, queue: str, payload: dict[str, Any]) -> None:
        # Round-trip through JSON exactly like Redis would.
        self._queues.setdefault(queue, []).append(json.loads(json.dumps(payload)))

    def dequeue(self, queue: str, timeout: int = 5) -> dict[str, Any] | None:
        items = self._queues.get(queue)
        return items.pop(0) if items else None


_backend: QueueBackend | None = None
_redis_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(settings.redis_url, socket_timeout=2, socket_connect_timeout=2)
    return _redis_client


def ping() -> bool:
    """Readiness probe for the queue store (used by GET /ready)."""
    return bool(_redis().ping())


def incr_window_counter(key: str, window_seconds: int) -> int:
    """Fixed-window counter shared across API instances (rate limiting,
    app/services/rate_limit.py). Lives here because CLAUDE.md keeps every
    direct Redis call inside this module."""
    client = _redis()
    pipe = client.pipeline()
    pipe.incr(key)
    pipe.expire(key, window_seconds, nx=True)
    count, _ = pipe.execute()
    return int(count)


def get_queue_backend() -> QueueBackend:
    global _backend
    if _backend is None:
        _backend = RedisQueueBackend()
    return _backend


def enqueue_notification(payload: dict[str, Any]) -> None:
    """Enqueue a notification job. Called AFTER the DB transaction that
    created/updated a ticket has committed (spec §45: email must never block
    or fail ticket operations)."""
    get_queue_backend().enqueue(NOTIFICATION_QUEUE_KEY, payload)
