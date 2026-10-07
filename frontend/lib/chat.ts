import { isStaff, type Attachment, type Comment } from "@/lib/tickets";

/**
 * Pure helpers for the ticket chat UI. The chat is a presentation of the
 * existing ticket_comments thread - no separate data model. Which rows a
 * viewer receives is decided by the API + Postgres RLS (clients never get
 * INTERNAL comments or attachments on them); nothing here is a security check.
 */

export type MessageKind = "internal" | "staff" | "client";

/**
 * author_role is null when the viewer cannot read the author's users row -
 * which under RLS only happens for a client viewing a staff member's reply
 * (comment_author_first_name, 0006). So null means "staff".
 */
export function messageKind(c: Pick<Comment, "visibility" | "author_role">): MessageKind {
  if (c.visibility === "INTERNAL") return "internal";
  if (c.author_role === null) return "staff";
  return isStaff(c.author_role) ? "staff" : "client";
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Attachments bound to a message (comment_id), keyed by comment id. */
export function attachmentsByComment(attachments: Attachment[]): Map<string, Attachment[]> {
  const map = new Map<string, Attachment[]>();
  for (const a of attachments) {
    if (!a.comment_id) continue;
    const list = map.get(a.comment_id) ?? [];
    list.push(a);
    map.set(a.comment_id, list);
  }
  return map;
}

/** Ticket ids that have at least one unread in-app notification for the viewer. */
export function unreadTicketIds(items: { ticket_id: string | null; read_at: string | null }[]): Set<string> {
  const ids = new Set<string>();
  for (const n of items) if (n.ticket_id && !n.read_at) ids.add(n.ticket_id);
  return ids;
}

/** Poll interval for an open ticket conversation (no realtime; see docs/CHAT.md). */
export const CHAT_REFETCH_MS = 15_000;
