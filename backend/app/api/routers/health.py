"""Liveness and readiness probes (spec §45, §57).

/health  - process is up (no dependencies touched). Use for liveness.
/ready   - Postgres and the queue store (Redis) are reachable. Use for
           readiness / load-balancer health checks. Returns 503 with which
           dependency failed, never any connection details.
"""

from __future__ import annotations

import logging

import psycopg
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.services import queue

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready() -> JSONResponse:
    checks: dict[str, str] = {}
    try:
        with psycopg.connect(settings.database_url, connect_timeout=3) as conn, conn.cursor() as cur:
            cur.execute("select 1")
        checks["database"] = "ok"
    except Exception:
        logger.warning("Readiness: database unreachable", exc_info=True)
        checks["database"] = "unavailable"
    try:
        queue.ping()
        checks["queue"] = "ok"
    except Exception:
        logger.warning("Readiness: queue store unreachable", exc_info=True)
        checks["queue"] = "unavailable"
    ok = all(v == "ok" for v in checks.values())
    body = {"status": "ok" if ok else "degraded", **checks}
    return JSONResponse(status_code=200 if ok else 503, content=body)
