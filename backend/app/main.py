"""FastAPI application factory: routers, CORS, request logging, security
headers and a consistent error shape (spec §45, §53).

Error responses always have the shape {"detail": <str | list>, "request_id":
<str>} - FastAPI's own {"detail": ...} for HTTP and validation errors (so
the frontend's existing handling keeps working), with a request id added for
correlation with the structured logs. Unexpected exceptions return a generic
500 and never leak internals.
"""

from __future__ import annotations

import logging
import time
import uuid

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routers import (
    admin,
    admin_ops,
    categories,
    health,
    me,
    notifications,
    organizations,
    ticket_attachments,
    ticket_comments,
    tickets,
    users,
)
from app.core.config import settings
from app.core.logging import configure_logging

configure_logging()
logger = logging.getLogger("app.request")

app = FastAPI(title="ClickfieldAI Ticketing System API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # Env-driven (CORS_ALLOW_ORIGINS, JSON list); never "*" with credentials.
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}


@app.middleware("http")
async def request_context(request: Request, call_next):  # noqa: ANN001, ANN201
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = request_id
    started = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    response.headers["X-Request-ID"] = request_id
    for header, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(header, value)
    if settings.environment == "production":
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    # Path only - never query strings (may contain search text) or bodies.
    logger.info(
        "request",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "")


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "request_id": _rid(request)},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors, "request_id": _rid(request)})


@app.exception_handler(psycopg.errors.InsufficientPrivilege)
async def db_privilege_error(request: Request, exc: psycopg.errors.InsufficientPrivilege) -> JSONResponse:
    # RLS WITH CHECK / guard-trigger rejection that slipped past the API
    # checks: report as forbidden without echoing the database message.
    logger.warning("Database rejected a write (42501)", extra={"request_id": _rid(request)})
    return JSONResponse(status_code=403, content={"detail": "Not permitted", "request_id": _rid(request)})


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error", extra={"request_id": _rid(request), "path": request.url.path})
    return JSONResponse(
        status_code=500, content={"detail": "Internal server error", "request_id": _rid(request)}
    )


app.include_router(health.router)
app.include_router(me.router)
app.include_router(organizations.router)
app.include_router(tickets.router)
app.include_router(ticket_comments.router)
app.include_router(ticket_attachments.router)
app.include_router(categories.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(admin_ops.router)
app.include_router(notifications.router)
