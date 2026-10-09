# Ticket chat

The ticket detail page (`/client|team|admin/tickets/[id]`) shows the ticket
conversation as a chat between the client and ClickfieldAI staff. This is
human-to-human messaging. **There is no AI of any kind** (CLAUDE.md rule 1).

## Data model: chat reuses `ticket_comments`

There is no chat table. A chat message **is** a `ticket_comments` row, and a
file in a message **is** a `ticket_attachments` row with `comment_id` set.
The UI is a new presentation over the existing API:

| Chat action | Existing endpoint |
|---|---|
| load messages | `GET /api/tickets/{id}/comments` |
| send message / internal note | `POST /api/tickets/{id}/comments` (`visibility: CLIENT \| INTERNAL`) |
| attach a file | `POST /api/tickets/{id}/attachments` with `comment_id`, then PUT to the signed upload URL |
| open a file | `GET /api/tickets/{id}/attachments/{aid}/download` (60 s signed URL) |

Why: a second message store would duplicate the RLS policies, the audit
trail, soft-delete rules, notification triggers and tenant-isolation tests,
and the two could drift. With one model there is one source of truth for who
can read what.

Frontend: `components/tickets/TicketChat.tsx` (UI) and `lib/chat.ts` (pure
helpers, unit-tested in `lib/chat.test.ts`), used by the shared
`components/tickets/TicketDetail.tsx` that all three role pages render.

## Visibility and internal-note isolation

- **Client message**: `visibility = CLIENT`, authored by a client. Shown as a grey bubble.
- **Staff reply**: `visibility = CLIENT`, authored by staff. Shown as a brand-blue bubble tagged "ClickfieldAI".
- **Internal note**: `visibility = INTERNAL`, staff only. Shown as an amber dashed bubble with a lock icon.
  The composer's "Reply to client / Internal note" toggle (from the earlier
  redesign, reused here) is only rendered for staff.

The UI is not the boundary. Enforcement is unchanged and lives in:

1. **Postgres RLS** (`0002_rls.sql`, `0004`, `0006`): a client's `SELECT` never
   returns `INTERNAL` comments or attachments bound to them, and a client
   `INSERT` with `INTERNAL` is rejected by the database.
2. **API permissions** (`permissions.can_write_comment`) as a second layer.
3. **Audit**: `comment_added` / `internal_note_added` / `attachment_added`
   rows store only ids and visibility, never message text. Attachments on
   internal notes are flagged `internal` and hidden from clients' audit view (0006).

When a client views a staff reply, RLS hides the staff `users` row, so the API
returns the author's first name via `comment_author_first_name()` and
`author_role = null`. The chat treats `null` as staff (`messageKind()`). The
previous thread UI mislabelled these replies as "Client"; that is fixed.

## Freshness: Realtime first, polling as the safety net

**Sending (optimistic UI).** Pressing Send shows the message at once with a
"Sending..." note and clears the box; the POST runs in the background. Each
send is its own TanStack mutation (`useSendMessage` in `TicketChat.tsx`), so
in-flight and failed messages are rendered from the mutation cache and survive
refetches. On success the created comment returned by the API is written into
the `["comments", ticketId]` cache with `setQueryData`, with no refetch. On
failure the bubble stays with a red outline, the error, **Retry** and
**Discard**. Text is never lost.

**Receiving (Supabase Realtime).** Migration `0007_realtime_comments.sql` adds
only `ticket_comments` to the `supabase_realtime` publication.
`lib/useTicketRealtime.ts` opens one channel per open ticket, authenticated
with the signed-in user's own Supabase JWT and filtered to that `ticket_id`
for `INSERT`. Realtime authorizes every event against the existing
`ticket_comments_select` RLS policy for that JWT, so:

- clients never receive internal notes, even unfiltered;
- nobody receives another organization's messages, even with that ticket's id as the filter;
- team members only receive messages on tickets assigned to them;
- an anon-key-only socket receives nothing.

All of this is proven against the real DEV project by
`backend/tests/test_realtime_rls.py`, with positive controls. The ticket_id
filter is only a narrowing, not the boundary. The event row is written into
the cache using the author name/role the API already resolved for that author.
Only a first message from a not-yet-seen author triggers one list refetch.
The channel is removed on unmount and on ticket change, so navigating never
stacks subscriptions.

**Polling fallback.** While the channel is live, comments/attachments poll
every 60 s as a safety net. If Realtime is down, not yet connected, or 0007
is not applied (PROD until a human applies it), they poll every 10 s. Both
paths go through the same API + RLS. Files bound to someone else's new
message appear on the next attachments poll.

## Composer

Attach button, auto-growing text box and send button. Enter sends when a
physical keyboard is present; Shift+Enter adds a new line, and touch
keyboards always insert a new line. While a message is sending the button
shows a spinner, and errors appear inline. If the message posts but the file
upload fails, the error says so, so nothing is lost silently.

Files go through the existing validation (25 MB, MIME/extension allow-list,
checked client-side for UX and server-side for real) and private-bucket
signed-URL upload. If a file is sent without text, it becomes a ticket-level
attachment, the same as the Attachments card.

On mobile the composer is `position: sticky; bottom: 0` inside the
conversation card. It stays in reach while you read the thread but takes
real layout space at the end, so it never permanently covers a message. It
respects the iOS safe-area inset and uses a 16 px font so iOS does not zoom
on focus. Verified at 375 px with no horizontal overflow.

## Notifications

These are unchanged and already wired in `ticket_comments.py` via `commit_then_notify`:

- client message: in-app + email (`CLIENT_REPLY`) to the assignee, plus the CTO when unassigned or HIGH/CRITICAL (decision #8)
- staff reply: in-app + email (`TEAM_REPLY`) to the ticket creator
- internal note: no notification outside the team, no email

Email goes through whichever provider is configured (noop / Resend / SMTP,
see `docs/SMTP.md`).

## Unread indicator

Ticket lists show a small brand dot next to a ticket number when the viewer
has an unread in-app notification for that ticket. It uses the existing
`GET /api/notifications?unread_only=true` endpoint. Opening the ticket marks
those notifications read through the existing
`POST /api/notifications/{id}/read` endpoint, and RLS restricts both calls to
the viewer's own rows. There is no new table, no read receipts and no backend
change. Limitation: only the 100 most recent unread notifications are
considered.
