import { apiFetch } from "@/lib/api";

export type Role = "SUPER_ADMIN" | "ADMIN" | "TEAM_MEMBER" | "CLIENT_ADMIN" | "CLIENT_USER";
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type TicketStatus =
  | "OPEN"
  | "TRIAGED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "WAITING_FOR_CLIENT"
  | "RESOLVED"
  | "CLOSED"
  | "REOPENED";

export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export const STATUSES: TicketStatus[] = [
  "OPEN",
  "TRIAGED",
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_FOR_CLIENT",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
];
export const PAGE_SIZES = [25, 50, 100] as const;

export type Ticket = {
  id: string;
  ticket_number: string;
  organization_id: string;
  organization_name: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: Priority;
  category_id: string | null;
  category_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by: string;
  created_by_name: string | null;
  due_at: string | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type TicketPage = { items: Ticket[]; page: number; page_size: number; total: number };

export type Comment = {
  id: string;
  user_id: string;
  author_name: string | null;
  author_role: Role | null;
  comment: string;
  visibility: "CLIENT" | "INTERNAL";
  created_at: string;
};

export type Attachment = {
  id: string;
  comment_id: string | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

export type Category = { id: string; name: string; description: string | null };
export type StaffUser = { id: string; name: string; email: string; role: Role };
export type Me = { user_id: string; organization_id: string; role: Role; email: string };

/** fetch + JSON + error detail. Authorization is decided by the API, not here. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await apiFetch(path, { ...init, headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body.detail === "string" ? body.detail : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return body as T;
}

export function ticketListPath(params: {
  page: number;
  pageSize: number;
  status?: string;
  priority?: string;
}): string {
  const query = new URLSearchParams({ page: String(params.page), page_size: String(params.pageSize) });
  if (params.status) query.set("status", params.status);
  if (params.priority) query.set("priority", params.priority);
  return `/api/tickets?${query.toString()}`;
}

export function statusLabel(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const STAFF: Role[] = ["SUPER_ADMIN", "ADMIN", "TEAM_MEMBER"];
const ADMINS: Role[] = ["SUPER_ADMIN", "ADMIN"];
const CLIENTS: Role[] = ["CLIENT_ADMIN", "CLIENT_USER"];

/**
 * Generic PATCH /status transitions offered as buttons. UX ONLY - mirrors
 * backend/app/domain/state_machine.py so we don't show buttons that would be
 * rejected; the backend re-checks every transition. RESOLVED, CLOSED and
 * REOPENED have dedicated controls and are not listed here.
 */
const STATUS_BUTTONS: { from: TicketStatus; to: TicketStatus; roles: Role[] }[] = [
  { from: "OPEN", to: "TRIAGED", roles: ADMINS },
  { from: "ASSIGNED", to: "IN_PROGRESS", roles: STAFF },
  { from: "IN_PROGRESS", to: "WAITING_FOR_CLIENT", roles: STAFF },
  { from: "WAITING_FOR_CLIENT", to: "IN_PROGRESS", roles: [...STAFF, ...CLIENTS] },
  { from: "REOPENED", to: "IN_PROGRESS", roles: STAFF },
];

export function statusTargets(status: TicketStatus, role: Role): TicketStatus[] {
  return STATUS_BUTTONS.filter((t) => t.from === status && t.roles.includes(role)).map((t) => t.to);
}

export function canResolve(status: TicketStatus, role: Role): boolean {
  return STAFF.includes(role) && (status === "IN_PROGRESS" || status === "WAITING_FOR_CLIENT");
}

export function canClose(status: TicketStatus, role: Role): boolean {
  return status === "RESOLVED" && (ADMINS.includes(role) || CLIENTS.includes(role));
}

export function canReopen(status: TicketStatus, role: Role): boolean {
  return (status === "RESOLVED" || status === "CLOSED") && (ADMINS.includes(role) || CLIENTS.includes(role));
}

export function isStaff(role: Role | undefined): boolean {
  return role !== undefined && STAFF.includes(role);
}

export function isAdmin(role: Role | undefined): boolean {
  return role !== undefined && ADMINS.includes(role);
}

/** Metadata first (server validates type/size), then PUT to the signed URL. */
export async function uploadAttachment(ticketId: string, file: File, commentId?: string): Promise<void> {
  const created = await apiJson<Attachment & { upload_url: string }>(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body: JSON.stringify({
      file_name: file.name,
      mime_type: file.type || "application/octet-stream",
      file_size: file.size,
      comment_id: commentId ?? null,
    }),
  });
  const upload = await fetch(created.upload_url, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!upload.ok) {
    throw new Error("File upload failed");
  }
}
