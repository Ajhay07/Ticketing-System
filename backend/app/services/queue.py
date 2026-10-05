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


_backend: QueueBackend | None = None


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
