"""Account helpers that call Supabase Auth's PUBLIC endpoints (anon key).

Nothing here uses service_role: a password-recovery email can be requested
by anyone for any address through GoTrue's public /recover endpoint (which
Supabase itself rate-limits and which never reveals whether the address
exists). The admin "Reset access" action (spec §18) simply triggers it.
"""

from __future__ import annotations

import httpx

from app.core.config import settings


def send_password_reset(*, email: str) -> None:
    url = f"{settings.supabase_url}/auth/v1/recover"
    headers = {"apikey": settings.supabase_anon_key, "Content-Type": "application/json"}
    params = {"redirect_to": f"{settings.app_url}/login"}
    response = httpx.post(url, headers=headers, params=params, json={"email": email}, timeout=10.0)
    response.raise_for_status()
