import { apiFetch } from "@/lib/api";
import { apiJson, MAX_ATTACHMENT_BYTES, type Attachment } from "@/lib/tickets";

/**
 * Multi-file attachment helpers for ticket creation. Client-side checks are
 * UX only: the API validates every file again on its own
 * (app/services/attachments.py) and caps attachments per ticket.
 */

export const MAX_FILES_PER_TICKET = 10;
export const UPLOAD_CONCURRENCY = 3;

/** Extension allow-list mirroring the server's MIME/extension table. */
export const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "pdf", "doc", "docx", "xls", "xlsx", "csv", "zip"] as const;
export const ACCEPT = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Why one file is rejected, or null if it may be queued. */
export function fileProblem(file: Pick<File, "name" | "size">): string | null {
  if (file.size <= 0) return "is empty";
  if (file.size > MAX_ATTACHMENT_BYTES) return "is larger than 25 MB";
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) return "is not an allowed file type";
  return null;
}

/**
 * Validate each incoming file independently against the already-queued list.
 * Good files are accepted even when others in the same pick are rejected.
 */
export function addFiles<T extends Pick<File, "name" | "size" | "lastModified">>(
  queued: T[],
  incoming: T[],
  max = MAX_FILES_PER_TICKET
): { files: T[]; errors: string[] } {
  const files = [...queued];
  const errors: string[] = [];
  const key = (f: T) => `${f.name}:${f.size}:${f.lastModified}`;
  for (const f of incoming) {
    const problem = fileProblem(f);
    if (problem) {
      errors.push(`${f.name} ${problem}.`);
    } else if (files.some((q) => key(q) === key(f))) {
      errors.push(`${f.name} is already attached.`);
    } else if (files.length >= max) {
      errors.push(`${f.name} was not added: at most ${max} files per ticket.`);
    } else {
      files.push(f);
    }
  }
  return { files, errors };
}

/** Run `worker` over items with at most `limit` in flight; never rejects. */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        await worker(items[i] as T, i);
      } catch {
        // per-item failures are reported by the worker itself
      }
    }
  });
  await Promise.all(lanes);
}

/** PUT with progress events (fetch cannot report upload progress). */
function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("File upload failed")));
    xhr.onerror = () => reject(new Error("File upload failed"));
    xhr.onabort = () => reject(new Error("File upload was cancelled"));
    xhr.send(file);
  });
}

/**
 * Same two-step flow as uploadAttachment (metadata -> signed PUT) with
 * progress. If the PUT fails after the metadata row exists, the row is
 * abandoned (soft-deleted server-side) so no undownloadable file lingers.
 */
export async function uploadWithProgress(
  ticketId: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<void> {
  const created = await apiJson<Attachment & { upload_url: string }>(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: JSON.stringify({
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      file_size: file.size,
      comment_id: null,
    }),
  });
  try {
    await putWithProgress(created.upload_url, file, onProgress);
  } catch (e) {
    await apiFetch(`/api/tickets/${ticketId}/attachments/${created.id}/abandon`, { method: "POST" }).catch(() => undefined);
    throw e;
  }
  onProgress(1);
}
