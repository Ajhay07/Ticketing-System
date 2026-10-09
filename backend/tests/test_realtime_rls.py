"""Supabase Realtime (Postgres Changes) must respect RLS on ticket_comments.

Migration 0007 adds ticket_comments to the supabase_realtime publication so
the ticket chat updates live. This suite proves, against the REAL DEV
project, that the realtime stream leaks nothing the REST API would not:

- a client never receives an INTERNAL note, even when subscribed to the
  whole table with no filter;
- a client never receives a message on another organization's ticket, even
  when subscribing with that ticket's id as the filter;
- a team member does not receive messages on tickets not assigned to them;
- an unauthenticated (anon key only) socket receives nothing;
- positive controls: the client DOES receive the client-visible reply on its
  own ticket and the admin receives both (so "nothing received" is meaningful).
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from typing import Any

import pytest
import websockets
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import queue
from tests.realdev import REAL_JWT_SECRET, auth, requires_dev, scenario

pytestmark = requires_dev

client = TestClient(app)


class _NullQueue:
    def enqueue(self, name: str, payload: dict[str, Any]) -> None:
        return None

    def dequeue(self, name: str, timeout: int = 5) -> dict[str, Any] | None:
        return None


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_jwt_secret", REAL_JWT_SECRET)
    monkeypatch.setattr(queue, "_backend", _NullQueue())


@pytest.fixture(scope="module")
def s() -> Iterator[dict[str, Any]]:
    people = {
        "client_a": ("CLIENT_USER", "org_a"),
        "client_b": ("CLIENT_USER", "org_b"),
        "admin": ("ADMIN", "internal"),
        "other_team": ("TEAM_MEMBER", "internal"),
    }
    with scenario("rt", people, ["org_a", "org_b"]) as data:
        yield data


def _ticket(s: dict[str, Any], who: str) -> str:
    r = client.post(
        "/api/tickets",
        headers=auth(s, who),
        json={"subject": "realtime rls", "description": "d", "category_id": s["category_id"], "priority": "LOW"},  # noqa: E501
    )
    assert r.status_code == 201, r.text
    s["ticket_ids"].append(r.json()["id"])
    return str(r.json()["id"])


def _post(s: dict[str, Any], who: str, ticket_id: str, text: str, visibility: str) -> None:
    r = client.post(
        f"/api/tickets/{ticket_id}/comments",
        headers=auth(s, who),
        json={"comment": text, "visibility": visibility},
    )
    assert r.status_code == 201, r.text


def _url() -> str:
    base = settings.supabase_url.rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
    return f"{base}/realtime/v1/websocket?apikey={settings.supabase_anon_key}&vsn=1.0.0"


async def _collect(
    subs: dict[str, tuple[str | None, str | None]], actions: Any, settle: float = 8.0
) -> dict[str, list[str]]:
    """subs: name -> (jwt or None, filter or None). Returns comment texts per name."""
    received: dict[str, list[str]] = {name: [] for name in subs}
    sockets = []

    async def reader(name: str, ws: Any) -> None:
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("event") == "postgres_changes":
                record = msg["payload"]["data"].get("record") or {}
                received[name].append(str(record.get("comment")))

    tasks = []
    for name, (jwt, flt) in subs.items():
        ws = await websockets.connect(_url())
        change: dict[str, Any] = {"event": "*", "schema": "public", "table": "ticket_comments"}
        if flt:
            change["filter"] = flt
        payload: dict[str, Any] = {"config": {"postgres_changes": [change]}}
        if jwt:
            payload["access_token"] = jwt
        await ws.send(
            json.dumps({"topic": f"realtime:{name}", "event": "phx_join", "ref": "1", "payload": payload})
        )
        sockets.append(ws)
        tasks.append(asyncio.create_task(reader(name, ws)))
    await asyncio.sleep(4)  # let every subscription register
    await asyncio.to_thread(actions)
    await asyncio.sleep(settle)
    for task in tasks:
        task.cancel()
    for ws in sockets:
        await ws.close()
    return received


def test_realtime_respects_internal_notes_and_tenants(s: dict[str, Any]) -> None:
    a_ticket = _ticket(s, "client_a")
    b_ticket = _ticket(s, "client_b")
    run = s["run_id"]
    internal = f"rt-internal-{run}"
    reply_a = f"rt-reply-a-{run}"
    reply_b = f"rt-reply-b-{run}"

    def actions() -> None:
        _post(s, "admin", a_ticket, internal, "INTERNAL")
        _post(s, "admin", a_ticket, reply_a, "CLIENT")
        _post(s, "admin", b_ticket, reply_b, "CLIENT")

    got = asyncio.run(
        _collect(
            {
                "client_a_all": (s["client_a_token"], None),
                "client_a_own": (s["client_a_token"], f"ticket_id=eq.{a_ticket}"),
                "client_a_foreign": (s["client_a_token"], f"ticket_id=eq.{b_ticket}"),
                "client_b_all": (s["client_b_token"], None),
                "team_unassigned": (s["other_team_token"], None),
                "anon": (None, None),
                "admin": (s["admin_token"], None),
            },
            actions,
        )
    )

    # Positive controls: the stream works.
    assert reply_a in got["client_a_own"], got
    assert {internal, reply_a, reply_b} <= set(got["admin"]), got
    # Internal note never reaches a client, filtered or not.
    for name in ("client_a_all", "client_a_own", "client_a_foreign", "client_b_all"):
        assert internal not in got[name], (name, got[name])
    # Cross-tenant: org A's client never sees org B's message and vice versa.
    assert reply_b not in got["client_a_all"], got
    assert got["client_a_foreign"] == [], got
    assert reply_a not in got["client_b_all"] and internal not in got["client_b_all"], got
    assert reply_b in got["client_b_all"], got
    # Unassigned team member and anon receive nothing from these tickets.
    assert not ({internal, reply_a, reply_b} & set(got["team_unassigned"])), got
    assert got["anon"] == [], got
