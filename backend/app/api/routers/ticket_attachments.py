"""Ticket attachments (spec §12, §31, decision #10).

Flow:
  1. POST metadata -> validate type/size BEFORE anything else (422 on
     failure, nothing written, no URL issued).
  2. Insert the ticket_attachments row on the user-scoped connection
     (ticket_attachments_insert RLS decides if the caller may attach to this
     ticket) together with its audit row, and commit.
  3. Ask Supabase Storage for a short-lived signed UPLOAD URL using the
     caller's own JWT; storage.objects RLS (0003 migration) only permits the
     upload because step 2's row exists and was created by this user.
  4. The browser PUTs the file directly to that URL.

Download: the metadata row is read under RLS (404 if hidden - cross-tenant,
internal-comment attachment, or nonexistent), then a 60-second signed
DOWNLOAD URL is requested, again with the caller's JWT, so Storage re-checks
access itself. Raw storage paths are never returned to the client.
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, StringConstraints

from app.api.deps import client_ip, get_current_principal, get_db
from app.api.routers._rows import row_as_dict, rows_as_dicts
from app.core.config import settings
from app.core.security import Principal
from app.domain import permissions
from app.services import attachments as attachment_rules
from app.services import storage
from app.services import tickets as ticket_service
from app.services.audit import write_audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tickets", tags=["attachments"])

# storage_path is intentionally NOT in this list.
_ATTACHMENT_COLUMNS = "id, ticket_id, comment_id, uploaded_by, file_name, mime_type, file_size, created_at"


class CreateAttachmentRequest(BaseModel):
    file_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    mime_type: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    file_size: int
    comment_id: UUID | None = None


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")


@router.get("/{ticket_id}/attachments")
def list_attachments(
    ticket_id: UUID,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> list[dict[str, Any]]:
    ticket_service.fetch_ticket(conn, str(ticket_id))
    with conn.cursor() as cur:
        cur.execute(
            f"select {_ATTACHMENT_COLUMNS} from ticket_attachments where ticket_id = %s order by created_at",
            (str(ticket_id),),
        )
        return rows_as_dicts(cur)


@router.post("/{ticket_id}/attachments", status_code=201)
def create_attachment(
    ticket_id: UUID,
    body: CreateAttachmentRequest,
    request: Request,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    try:
        attachment_rules.validate_attachment(
            file_name=body.file_name, mime_type=body.mime_type, file_size=body.file_size
        )
    except attachment_rules.AttachmentValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    ticket = ticket_service.fetch_ticket(conn, str(ticket_id))
    assigned_to = str(ticket["assigned_to"]) if ticket["assigned_to"] else None
    if not permissions.can_view_ticket(
        principal, ticket_organization_id=str(ticket["organization_id"]), ticket_assigned_to=assigned_to
    ):
        raise ticket_service.not_found()

    if body.comment_id is not None:
        with conn.cursor() as cur:
            cur.execute(
                "select id from ticket_comments where id = %s and ticket_id = %s",
                (str(body.comment_id), str(ticket_id)),
            )
            if cur.fetchone() is None:
                raise HTTPException(status_code=422, detail="Unknown comment for this ticket")

    attachment_id = str(uuid.uuid4())
    storage_path = (
        f"{ticket['organization_id']}/{ticket_id}/{attachment_id}/"
        f"{attachment_rules.safe_file_name(body.file_name)}"
    )
    with conn.cursor() as cur:
        cur.execute(
            f"""
            insert into ticket_attachments
              (id, ticket_id, comment_id, uploaded_by, file_name, storage_path, mime_type, file_size)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            returning {_ATTACHMENT_COLUMNS}
            """,
            (
                attachment_id,
                str(ticket_id),
                str(body.comment_id) if body.comment_id else None,
                principal.user_id,
                body.file_name,
                storage_path,
                body.mime_type.lower(),
                body.file_size,
            ),
        )
        attachment = row_as_dict(cur)
    assert attachment is not None
    write_audit(
        conn,
        ticket_id=str(ticket_id),
        user_id=principal.user_id,
        action="attachment_added",
        new_value={
            "attachment_id": attachment_id,
            "file_name": body.file_name,
            "mime_type": body.mime_type.lower(),
            "file_size": body.file_size,
        },
        ip_address=client_ip(request),
    )
    conn.commit()  # storage.objects RLS must see the committed metadata row

    try:
        upload_url = storage.create_signed_upload_url(principal, storage_path)
    except Exception as exc:
        logger.exception("Signed upload URL failed for attachment %s", attachment_id)
        # Best effort only: under the 0002 policies, RLS rejects a soft
        # delete by normal roles (the updated row would no longer pass
        # ticket_attachments_select). The orphan row is harmless - it has
        # no object behind it, so its download returns 404.
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "update ticket_attachments set deleted_at = now() where id = %s", (attachment_id,)
                )
            conn.commit()
        except Exception:
            logger.warning("Could not soft-delete orphan attachment row %s", attachment_id)
            conn.rollback()
        raise HTTPException(status_code=502, detail="File storage is unavailable, try again") from exc

    attachment_rules.scan_hook(storage_path=storage_path, mime_type=body.mime_type)
    return {**attachment, "upload_url": upload_url, "upload_method": "PUT"}


@router.get("/{ticket_id}/attachments/{attachment_id}/download")
def download_attachment(
    ticket_id: UUID,
    attachment_id: UUID,
    principal: Principal = Depends(get_current_principal),
    conn: psycopg.Connection = Depends(get_db),
) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            "select file_name, storage_path from ticket_attachments where id = %s and ticket_id = %s",
            (str(attachment_id), str(ticket_id)),
        )
        row = row_as_dict(cur)
    if row is None:
        raise _not_found()
    try:
        url = storage.create_signed_download_url(principal, row["storage_path"], row["file_name"])
    except storage.StorageError as exc:
        # Storage itself refused (e.g. object never uploaded). Don't leak why.
        raise _not_found() from exc
    return {"url": url, "expires_in": settings.signed_url_expires_seconds}
