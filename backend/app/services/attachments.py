"""Attachment validation (spec §12, §31, decision #10).

Validation runs BEFORE any metadata row is written or any signed URL is
issued. The storage bucket enforces the same size/MIME limits again on its
side (supabase/migrations/0003_storage_attachments.sql).
"""

from __future__ import annotations

import re

from app.core.config import settings

# MIME type -> allowed file extensions for that type (spec §12).
ALLOWED_TYPES: dict[str, set[str]] = {
    "image/png": {"png"},
    "image/jpeg": {"jpg", "jpeg"},
    "application/pdf": {"pdf"},
    "application/msword": {"doc"},
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {"docx"},
    "application/vnd.ms-excel": {"xls"},
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"xlsx"},
    "text/csv": {"csv"},
    "application/zip": {"zip"},
    "application/x-zip-compressed": {"zip"},
}


class AttachmentValidationError(ValueError):
    pass


def safe_file_name(file_name: str) -> str:
    """Reduce a client-supplied name to a safe storage path segment."""
    base = file_name.replace("\\", "/").split("/")[-1].strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    return cleaned[:150] or "file"


def validate_attachment(*, file_name: str, mime_type: str, file_size: int) -> None:
    if file_size <= 0:
        raise AttachmentValidationError("File is empty")
    if file_size > settings.attachment_max_bytes:
        raise AttachmentValidationError("File exceeds the 25 MB limit")
    allowed_extensions = ALLOWED_TYPES.get(mime_type.lower())
    if allowed_extensions is None:
        raise AttachmentValidationError("File type is not allowed")
    extension = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if extension not in allowed_extensions:
        raise AttachmentValidationError("File extension does not match an allowed type")


def scan_hook(*, storage_path: str, mime_type: str) -> None:
    """Extension point for malware scanning (decision #10). Not implemented
    in V1; intentionally a no-op."""
    return None
