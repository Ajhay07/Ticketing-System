"""Simple fixed-window rate limiting (spec §54).

Protects the authenticated write endpoints the spec names: ticket creation,
comment creation, file upload, and the admin-triggered password reset.
(Interactive login and self-service password reset go straight from the
browser to Supabase Auth, which applies its own per-IP/per-email rate
limits - configured in the Supabase dashboard, see docs/DEPLOYMENT.md.)

Counters are kept in-process by default. That is correct for a single API
instance; when the API is scaled horizontally, set RATE_LIMIT_BACKEND=redis
to share counters through the queue module's Redis connection (CLAUDE.md:
no direct Redis calls outside app/services/queue.py). If Redis is
unreachable the limiter fails OPEN (logs a warning) - availability of
ticket creation matters more than strict limiting.
"""

from __future__ import annotations

import logging
import threading
import time

from fastapi import HTTPException, status

from app.core.config import settings
from app.services import queue

logger = logging.getLogger(__name__)

# action -> (max requests, window seconds)
LIMITS: dict[str, tuple[int, int]] = {
    "ticket_create": (settings.rate_limit_ticket_create_per_hour, 3600),
    "comment_create": (settings.rate_limit_comment_create_per_hour, 3600),
    "attachment_upload": (settings.rate_limit_attachment_upload_per_hour, 3600),
    "password_reset": (settings.rate_limit_password_reset_per_hour, 3600),
}


class _MemoryCounter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: dict[str, tuple[int, float]] = {}

    def hit(self, key: str, window: int) -> int:
        now = time.monotonic()
        with self._lock:
            count, started = self._counts.get(key, (0, now))
            if now - started >= window:
                count, started = 0, now
            count += 1
            self._counts[key] = (count, started)
            if len(self._counts) > 50_000:  # bound memory: drop expired windows
                self._counts = {k: v for k, v in self._counts.items() if now - v[1] < window}
            return count

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


_memory = _MemoryCounter()


def reset() -> None:
    """Test helper: clear in-process counters."""
    _memory.reset()


def _hit(key: str, window: int) -> int:
    if settings.rate_limit_backend == "redis":
        try:
            return queue.incr_window_counter(key, window)
        except Exception:
            logger.warning("Rate-limit store unavailable; allowing request", exc_info=True)
            return 0
    return _memory.hit(key, window)


def enforce_rate_limit(action: str, subject: str) -> None:
    """Raise 429 if `subject` (a user id, from the verified Principal) has
    exceeded the limit for `action` in the current window."""
    if not settings.rate_limit_enabled:
        return
    limit, window = LIMITS[action]
    count = _hit(f"ratelimit:{action}:{subject}", window)
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests, please slow down and try again later",
            headers={"Retry-After": str(window)},
        )
