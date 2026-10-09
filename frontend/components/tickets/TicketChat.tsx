"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useMutationState, useQueryClient, type Mutation } from "@tanstack/react-query";
import { AlertCircle, Lock, MessageSquare, MessagesSquare, Paperclip, RotateCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { ErrorText } from "@/components/ui/Form";
import { EmptyState, Skeleton, Spinner } from "@/components/ui/States";
import {
  attachmentsByComment,
  initials,
  messageKind,
  upsertComment,
  visiblePending,
  type MessageKind,
  type PendingMessage,
  type SendVars,
} from "@/lib/chat";
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
  onPosted: (sentFile: boolean) => void;
}) {
  // Defence in depth for rendering only.
  const visible = comments.filter((c) => staff || c.visibility !== "INTERNAL");
  const files = attachmentsByComment(attachments);
  const { pending, retry, discard, send } = useSendMessage(ticketId, onPosted);
  const shownPending = visiblePending(pending).filter((p) => staff || p.visibility !== "INTERNAL");

  return (
    <section aria-labelledby="conversation-heading">
      <h2 id="conversation-heading" className="cf-section mb-4 flex items-center gap-2">
        <MessagesSquare className="h-4 w-4 text-slate-400" />
        Conversation
        {visible.length > 0 && <span className="text-sm font-normal text-slate-400 tabular">({visible.length})</span>}
      </h2>
      {/* No overflow clipping here: the composer is position:sticky. */}
      <div className="rounded-lg border border-cf-border bg-white shadow-sm">
        <div className="px-3 py-4 sm:px-5">
          {loading && (
            <div className="space-y-4" role="status" aria-label="Loading messages">
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="ml-auto h-16 w-2/3" />
            </div>
          )}
          {!loading && visible.length === 0 && shownPending.length === 0 && (
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
            {shownPending.map((p) => (
              <PendingBubble
                key={p.clientId}
                message={p}
                staff={staff}
                onRetry={() => retry(p)}
                onDiscard={() => discard(p.mutationId)}
              />
            ))}
          </ol>
        </div>
        {closed ? (
          <p className="border-t border-cf-border px-5 py-3 text-center text-xs text-slate-500">
            This ticket is closed. Reopen it to send a new message.
          </p>
        ) : (
          <Composer ticketId={ticketId} staff={staff} send={send} />
        )}
      </div>
    </section>
  );
}

const BUBBLE: Record<MessageKind, string> = {
  client: "border border-cf-border bg-cf-soft text-cf-ink",
  staff: "bg-cf-black text-white",
  internal: "border border-dashed border-amber-300 bg-amber-50 text-slate-900",
};
const AVATAR: Record<MessageKind, string> = {
  client: "bg-slate-200 text-slate-700",
  staff: "bg-cf-black text-white",
  internal: "bg-amber-100 text-amber-800",
};
const TAG: Record<MessageKind, [string, string]> = {
  client: ["Client", "bg-slate-100 text-slate-600"],
  staff: ["ClickfieldAI", "bg-cf-black text-white"],
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
          "flex h-8 w-8 shrink-0 items-center justify-center rounded text-2xs font-bold",
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
        <div className={cn("max-w-full rounded-md px-3.5 py-2.5", mine ? "rounded-br-none" : "rounded-bl-none", BUBBLE[kind])}>
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
                      kind === "staff" ? "bg-white/15 text-white" : "bg-white text-slate-700 ring-1 ring-cf-border"
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

function Composer({
  ticketId,
  staff,
  send,
}: {
  ticketId: string;
  staff: boolean;
  send: (vars: SendVars, file: File | null) => void;
}) {
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

  const canSend = text.trim().length > 0 || file !== null;

  function submit() {
    if (!canSend) return;
    setError(null);
    // Optimistic: the bubble appears immediately and the composer clears; the
    // request runs in the background (useSendMessage).
    send({ clientId: newClientId(), text: text.trim(), visibility, fileName: file?.name ?? null }, file);
    setText("");
    setFile(null);
  }

  return (
    <form
      className={cn(
        "sticky bottom-0 z-10 rounded-b-lg border-t bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur",
        internal ? "border-amber-300" : "border-cf-border"
      )}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
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
                  "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-semibold transition-colors duration-150 focus-within:outline focus-within:outline-2 focus-within:outline-cf-ink sm:text-sm",
                  active
                    ? value === "INTERNAL"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-cf-black text-white"
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
              submit();
            }
          }}
          placeholder={internal ? "Write an internal note" : staff ? "Reply to the client" : "Write a message"}
          className={cn(
            "block min-h-[40px] min-w-0 flex-1 resize-none rounded border px-3 py-2 text-base leading-snug text-cf-ink placeholder:text-cf-muted focus:border-cf-ink focus:outline-none focus:ring-1 focus:ring-cf-ink sm:text-sm",
            internal ? "border-amber-200 bg-amber-50/40" : "border-cf-border bg-white"
          )}
        />
        <Button
          type="submit"
          variant="primary"
          className="h-10 shrink-0 px-3 sm:px-4"
          disabled={!canSend}
          aria-label={internal ? "Add internal note" : "Send message"}
        >
          {internal ? (
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

let clientSeq = 0;
function newClientId(): string {
  clientSeq += 1;
  return `local-${Date.now().toString(36)}-${clientSeq}`;
}

type SendResult = { created: Comment | null };
/** The message was saved; only its file upload failed. */
class AttachmentAfterMessageError extends Error {}

/**
 * Optimistic message sending (TanStack Query v5 "via the mutation cache"
 * pattern). Every send is its own mutation keyed by ticket, so pending and
 * failed messages survive the thread's polling/realtime updates and are
 * rendered from useMutationState. On success the created comment is written
 * into the ["comments", ticketId] cache with setQueryData - no refetch.
 */
export function useSendMessage(ticketId: string, onPosted: (sentFile: boolean) => void) {
  const queryClient = useQueryClient();
  const mutationKey = ["send-message", ticketId];
  const files = useRef(new Map<string, File>());

  const mutation = useMutation<SendResult, Error, SendVars>({
    mutationKey,
    gcTime: Infinity, // keep failed sends until retried or discarded
    mutationFn: async (vars) => {
      const file = files.current.get(vars.clientId) ?? null;
      let created: Comment | null = null;
      if (vars.text) {
        created = await apiJson<Comment>(`/api/tickets/${ticketId}/comments`, {
          method: "POST",
          body: JSON.stringify({ comment: vars.text, visibility: vars.visibility }),
        });
        const persisted = created;
        queryClient.setQueryData<Comment[]>(["comments", ticketId], (old) => upsertComment(old, persisted));
      }
      if (file) {
        try {
          // Same private-storage upload path as the Attachments card; bound to the message when there is one.
          await uploadAttachment(ticketId, file, created?.id);
        } catch (e) {
          const msg = (e as Error).message;
          if (created) throw new AttachmentAfterMessageError(`Message sent, but the attachment failed: ${msg}`);
          throw e;
        }
      }
      return { created };
    },
    onMutate: async () => {
      // A poll already in flight could land after our write and briefly drop the new message.
      await queryClient.cancelQueries({ queryKey: ["comments", ticketId] });
    },
    onSettled: (_data, error, vars) => {
      const hadFile = files.current.has(vars.clientId);
      if (!error) files.current.delete(vars.clientId); // kept for Retry after a failure
      onPosted(hadFile && !error);
    },
  });

  const pending = useMutationState({
    filters: { mutationKey, predicate: (m) => m.state.status === "pending" || m.state.status === "error" },
    select: (m: Mutation<unknown, Error, unknown, unknown>): PendingMessage => {
      const vars = m.state.variables as SendVars;
      const error = m.state.error;
      const saved = error instanceof AttachmentAfterMessageError;
      return {
        ...vars,
        // The text already reached the thread; keep only the file note visible.
        text: saved ? "" : vars.text,
        mutationId: m.mutationId,
        status: m.state.status === "error" ? "error" : "pending",
        error: error ? error.message : null,
        submittedAt: m.state.submittedAt,
      };
    },
  });

  function removeMutation(mutationId: number) {
    const cache = queryClient.getMutationCache();
    const m = cache.getAll().find((x) => x.mutationId === mutationId);
    if (m) cache.remove(m);
  }

  return {
    pending,
    send: (vars: SendVars, file: File | null) => {
      if (file) files.current.set(vars.clientId, file);
      mutation.mutate(vars);
    },
    retry: (p: PendingMessage) => {
      removeMutation(p.mutationId);
      mutation.mutate({ clientId: p.clientId, text: p.text, visibility: p.visibility, fileName: p.fileName });
    },
    discard: (mutationId: number) => removeMutation(mutationId),
  };
}

function PendingBubble({
  message,
  staff,
  onRetry,
  onDiscard,
}: {
  message: PendingMessage;
  staff: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const kind: MessageKind = message.visibility === "INTERNAL" ? "internal" : staff ? "staff" : "client";
  const failed = message.status === "error";
  return (
    <li className="flex flex-row-reverse items-end gap-2" data-kind={kind} data-pending={failed ? "failed" : "sending"}>
      <span
        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded text-2xs font-bold", AVATAR[kind])}
        aria-hidden
      >
        {kind === "internal" ? <Lock className="h-3.5 w-3.5" /> : "Y"}
      </span>
      <div className="flex min-w-0 max-w-[85%] flex-col items-end sm:max-w-[75%]">
        <div className="mb-1 text-xs font-semibold text-slate-800">You</div>
        <div
          className={cn(
            "max-w-full rounded-md rounded-br-none px-3.5 py-2.5 transition-opacity",
            BUBBLE[kind],
            failed ? "ring-2 ring-red-500" : "opacity-70"
          )}
        >
          {message.text && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>}
          {message.fileName && (
            <p className="mt-1 flex items-center gap-1.5 text-xs opacity-80">
              <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{message.fileName}</span>
            </p>
          )}
        </div>
        {failed ? (
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-2xs" role="alert">
            <span className="flex items-center gap-1 font-medium text-red-600">
              <AlertCircle className="h-3 w-3" aria-hidden /> {message.error ?? "Not sent"}
            </span>
            {message.text || message.fileName ? (
              <button
                type="button"
                onClick={onRetry}
                className="flex items-center gap-1 font-semibold text-cf-ink underline-offset-2 hover:underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden /> Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDiscard}
              className="font-semibold text-slate-500 underline-offset-2 hover:underline"
            >
              Discard
            </button>
          </div>
        ) : (
          <span className="mt-1 flex items-center gap-1 text-2xs text-slate-400" role="status">
            <Spinner className="h-3 w-3" /> Sending...
          </span>
        )}
      </div>
    </li>
  );
}
