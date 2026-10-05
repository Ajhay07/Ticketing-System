"""Supabase Storage signed-URL helpers (spec §31).

Every call is made with the CALLER'S OWN JWT (Principal.raw_token) plus the
public anon key - never the service_role key. Supabase Storage enforces RLS
on storage.objects when signing (policies in
supabase/migrations/0003_storage_attachments.sql), so a URL can only be
issued for an object whose ticket_attachments metadata row the caller can
see (download) or created themselves (upload).
"""

from __future__ import annotations

from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.security import Principal


class StorageError(RuntimeError):
    pass


def _headers(principal: Principal) -> dict[str, str]:
    return {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {principal.raw_token}",
    }


def _object_url(kind: str, path: str) -> str:
    return f"{settings.supabase_url}/storage/v1/object/{kind}/{settings.storage_bucket}/{quote(path)}"


def _absolute(relative: str) -> str:
    return f"{settings.supabase_url}/storage/v1{relative}"


def create_signed_upload_url(principal: Principal, storage_path: str) -> str:
    response = httpx.post(_object_url("upload/sign", storage_path), headers=_headers(principal), timeout=10.0)
    if response.status_code >= 400:
        raise StorageError(f"Storage refused upload signing ({response.status_code})")
    url = response.json().get("url")
    if not url:
        raise StorageError("Storage returned no upload URL")
    return _absolute(url)


def create_signed_download_url(principal: Principal, storage_path: str, file_name: str) -> str:
    response = httpx.post(
        _object_url("sign", storage_path),
        headers=_headers(principal),
        json={"expiresIn": settings.signed_url_expires_seconds},
        timeout=10.0,
    )
    if response.status_code >= 400:
        raise StorageError(f"Storage refused download signing ({response.status_code})")
    url = response.json().get("signedURL") or response.json().get("signedUrl")
    if not url:
        raise StorageError("Storage returned no download URL")
    return f"{_absolute(url)}&download={quote(file_name)}"
