"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, MessageSquare, MessagesSquare, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { ErrorText } from "@/components/ui/Form";
import { EmptyState, Skeleton, Spinner } from "@/components/ui/States";
import { attachmentsByComment, initials, messageKind, type MessageKind } from "@/lib/chat";
import {
  apiJson,
  formatBytes,
  formatDate,
  MAX_ATTACHMENT_BYTES,
  openAttachment,
  uploadAttachment,
  type Attachment,
  type Comment,
} from "@/lib/tickets";

const ACCEPT = ".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip";

/**
 * Ticket-linked chat between the client and ClickfieldAI staff (no AI).
 * A presentation of the existing ticket_comments thread: messages are
 * comments, files are ticket_attachments bound by comment_id, and every read
 * and write goes through the same API + RLS as before. Internal notes never
 * reach a client's browser - the API simply does not return them.
 */
export function TicketChat({
  ticketId,
  comments,
  loading,
  attachments,
  myUserId,
  staff,
  closed,
  onPosted,
}: {
  ticketId: string;
  comments: Comment[];
  loading: boolean;
  attachments: Attachment[];
  myUserId: string;
  staff: boolean;
  closed: boolean;
  onPosted: () => void;
}) {
  // Defence in depth for rendering only.
  const visible = comments.filter((c) => staff || c.visibility !== "INTERNAL");
  const files = attachmentsByComment(attachments);

  return (
    <section aria-labelledby="conversation-heading">
      <h2 id="conversation-heading" className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
        <MessagesSquare className="h-4 w-4 text-slate-400" />
        Conversation
        {visible.length > 0 && <span className="text-sm font-normal text-slate-400 tabular">({visible.length})</span>}
      </h2>
      {/* No overflow clipping here: the composer is position:sticky. */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="px-3 py-4 sm:px-5">
          {loading && (
            <div className="space-y-4" role="status" aria-label="Loading messages">
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="ml-auto h-16 w-2/3" />
            </div>
          )}
          {!loading && visible.length === 0 && (
            <EmptyState
              compact
              icon={MessageSquare}
              title="No messages yet"
              description={
                staff ? "Reply to the client or add an internal note." : "Send a message to the ClickfieldAI team."
              }
            />
          )}
          <ol className="space-y-4" aria-live="polite">
            {visible.map((c) => (
              <ChatMessage
                key={c.id}
                comment={c}
                mine={c.user_id === myUserId}
                files={files.get(c.id) ?? []}
                ticketId={ticketId}
              />
            ))}
          </ol>
        </div>
        {closed ? (
          <p className="border-t border-slate-100 px-5 py-3 text-center text-xs text-slate-500">
            This ticket is closed. Reopen it to send a new message.
          </p>
        ) : (
          <Composer ticketId={ticketId} staff={staff} onPosted={onPosted} />
        )}
      </div>
    </section>
  );
}

const BUBBLE: Record<MessageKind, string> = {
  client: "bg-slate-100 text-slate-900",
  staff: "bg-brand-600 text-white",
  internal: "border border-dashed border-amber-300 bg-amber-50 text-slate-900",
};
const AVATAR: Record<MessageKind, string> = {
  client: "bg-slate-200 text-slate-700",
  staff: "bg-brand-100 text-brand-700",
  internal: "bg-amber-100 text-amber-800",
};
const TAG: Record<MessageKind, [string, string]> = {
  client: ["Client", "bg-slate-100 text-slate-600"],
  staff: ["ClickfieldAI", "bg-brand-50 text-brand-700"],
  internal: ["Internal note", "bg-amber-100 text-amber-900"],
};

function ChatMessage({
  comment,
  mine,
  files,
  ticketId,
}: {
  comment: Comment;
  mine: boolean;
  files: Attachment[];
  ticketId: string;
}) {
  const kind = messageKind(comment);
  const name = comment.author_name ?? "ClickfieldAI team";
  const [error, setError] = useState<string | null>(null);
  const [tag, tagClass] = TAG[kind];

  return (
    <li className={cn("flex items-end gap-2", mine && "flex-row-reverse")} data-kind={kind}>
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-2xs font-semibold",
          AVATAR[kind]
        )}
        aria-hidden
      >
        {kind === "internal" ? <Lock className="h-3.5 w-3.5" /> : initials(name)}
      </span>
      <div className={cn("flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%]", mine ? "items-end" : "items-start")}>
        <div className={cn("mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", mine && "justify-end")}>
          <span className="font-semibold text-slate-800">{mine ? "You" : name}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide", tagClass)}>{tag}</span>
        </div>
        <div className={cn("max-w-full rounded-2xl px-3.5 py-2.5", mine ? "rounded-br-sm" : "rounded-bl-sm", BUBBLE[kind])}>
          {kind === "internal" && (
            <p className="mb-1 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-amber-800">
              <Lock className="h-3 w-3" aria-hidden /> Visible only to the ClickfieldAI team
            </p>
          )}
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{comment.comment}</p>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f) => (
                <li key={f.id} className="max-w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      openAttachment(ticketId, f.id).catch((e: Error) => setError(e.message));
                    }}
                    className={cn(
                      "flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-medium underline-offset-2 hover:underline",
                      kind === "staff" ? "bg-white/15 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
                    )}
                    aria-label={`Download ${f.file_name}`}
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{f.file_name}</span>
                    <span className="shrink-0 opacity-70">{formatBytes(f.file_size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <time dateTime={comment.created_at} className="mt-1 text-2xs tabular text-slate-400">
          {formatDate(comment.created_at)}
        </time>
        {error && <ErrorText className="mt-1">{error}</ErrorText>}
      </div>
    </li>
  );
}

function Composer({ ticketId, staff, onPosted }: { ticketId: string; staff: boolean; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [visibility, setVisibility] = useState<"CLIENT" | "INTERNAL">("CLIENT");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const internal = visibility === "INTERNAL";

  // Grow the textarea with its content (capped) instead of a fixed tall box.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const send = useMutation({
    mutationFn: async () => {
      let commentId: string | undefined;
      if (text.trim()) {
        const created = await apiJson<Comment>(`/api/tickets/${ticketId}/comments`, {
          method: "POST",
          body: JSON.stringify({ comment: text, visibility }),
        });
        commentId = created.id;
        setText("");
      }
      if (file) {
        try {
          // Same private-storage upload path as the Attachments card; bound to the message when there is one.
          await uploadAttachment(ticketId, file, commentId);
        } catch (e) {
          const msg = (e as Error).message;
          throw new Error(commentId ? `Message sent, but the attachment failed: ${msg}` : msg);
        }
        setFile(null);
      }
    },
    onMutate: () => setError(null),
    onSettled: onPosted,
    onError: (e: Error) => setError(e.message),
  });

  const canSend = (text.trim().length > 0 || file !== null) && !send.isPending;

  return (
    <form
      className={cn(
        "sticky bottom-0 z-10 rounded-b-lg border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur",
        internal ? "border-amber-300" : "border-slate-200"
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) send.mutate();
      }}
    >
      {staff && (
        <div role="radiogroup" aria-label="Message type" className="flex gap-1 px-2 pt-2">
          {(
            [
              ["CLIENT", "Reply to client", Send],
              ["INTERNAL", "Internal note", Lock],
            ] as const
          ).map(([value, label, Icon]) => {
            const active = visibility === value;
            return (
              <label
                key={value}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-brand-500 sm:text-sm",
                  active
                    ? value === "INTERNAL"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-brand-50 text-brand-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                )}
              >
                <input
                  type="radio"
                  name={`visibility-${ticketId}`}
                  className="sr-only"
                  checked={active}
                  onChange={() => setVisibility(value)}
                />
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </label>
            );
          })}
        </div>
      )}
      {internal && (
        <p className="mx-2 mt-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Visible only to the ClickfieldAI team, never to the client.
        </p>
      )}
      {file && (
        <div className="mx-2 mt-2 flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
          <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="shrink-0 text-slate-400">{formatBytes(file.size)}</span>
          <button
            type="button"
            className="rounded p-0.5 text-slate-400 hover:text-slate-700"
            onClick={() => setFile(null)}
            aria-label="Remove attachment"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {error && <ErrorText className="mx-3 mt-2">{error}</ErrorText>}
      <div className="flex items-end gap-2 p-2">
        <Button
          type="button"
          variant="ghost"
          className="h-10 w-10 shrink-0 px-0"
          onClick={() => fileRef.current?.click()}
          disabled={send.isPending}
          aria-label="Attach a file"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > MAX_ATTACHMENT_BYTES) {
              setError("Attachments must be 25 MB or smaller.");
              return;
            }
            setError(null);
            setFile(f);
          }}
        />
        <textarea
          ref={textRef}
          aria-label="Message"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends with a physical keyboard; Shift+Enter adds a line. Touch keyboards insert a newline.
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              window.matchMedia("(pointer: fine)").matches
            ) {
              e.preventDefault();
              if (canSend) send.mutate();
            }
          }}
          placeholder={internal ? "Write an internal note" : staff ? "Reply to the client" : "Write a message"}
          className={cn(
            "block min-h-[40px] min-w-0 flex-1 resize-none rounded-lg border px-3 py-2 text-base leading-snug text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:text-sm",
            internal ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"
          )}
        />
        <Button
          type="submit"
          variant="primary"
          className="h-10 shrink-0 px-3 sm:px-4"
          disabled={!canSend}
          aria-label={internal ? "Add internal note" : "Send message"}
        >
          {send.isPending ? (
            <Spinner className="text-white/80" />
          ) : internal ? (
            <Lock className="h-4 w-4" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{internal ? "Add note" : "Send"}</span>
        </Button>
      </div>
    </form>
  );
}
