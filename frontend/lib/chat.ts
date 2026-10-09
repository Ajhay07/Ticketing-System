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

/**
 * Poll intervals for an open ticket conversation (docs/CHAT.md). New messages
 * normally arrive over Supabase Realtime (RLS-checked per subscriber, 0007);
 * polling is the safety net, fast only while the realtime channel is down.
 */
export const CHAT_REFETCH_MS = 10_000;
export const CHAT_REFETCH_REALTIME_MS = 60_000;

/** A ticket_comments row as delivered by a Realtime INSERT event. */
export type CommentRow = {
  id: string;
  ticket_id: string;
  user_id: string;
  comment: string;
  visibility: "CLIENT" | "INTERNAL";
  created_at: string;
  deleted_at?: string | null;
};

/** Insert (or replace by id) a comment, keeping the thread in created_at order. */
export function upsertComment(list: Comment[] | undefined, comment: Comment): Comment[] {
  const rest = (list ?? []).filter((c) => c.id !== comment.id);
  rest.push(comment);
  return rest.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Turn a realtime row into a renderable Comment using what the cache already
 * knows about its author. Returns null when the author has not appeared in
 * this thread yet (the caller then refetches the list once to get the name
 * the API resolves under RLS) or when the row is not a live message.
 */
export function commentFromRealtime(row: CommentRow, known: Comment[] | undefined): Comment | null {
  if (row.deleted_at) return null;
  const prior = (known ?? []).find((c) => c.user_id === row.user_id);
  if (!prior) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    author_name: prior.author_name,
    author_role: prior.author_role,
    comment: row.comment,
    visibility: row.visibility,
    created_at: row.created_at,
  };
}

/** What the composer submits; also what an optimistic bubble renders. */
export type SendVars = {
  clientId: string;
  text: string;
  visibility: "CLIENT" | "INTERNAL";
  fileName: string | null;
};

export type PendingMessage = SendVars & {
  mutationId: number;
  status: "pending" | "error";
  error: string | null;
  submittedAt: number;
};

/** Optimistic messages still to show (in flight or failed), in submission order. */
export function visiblePending(pending: PendingMessage[]): PendingMessage[] {
  return pending
    .filter((p) => p.status === "pending" || p.status === "error")
    .sort((a, b) => a.submittedAt - b.submittedAt);
}
