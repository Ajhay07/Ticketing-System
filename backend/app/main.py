from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import admin, health, me, organizations, tickets
from app.core.config import settings

app = FastAPI(title="Clickfield AI Ticketing System API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(me.router)
app.include_router(organizations.router)
app.include_router(tickets.router)
app.include_router(admin.router)
