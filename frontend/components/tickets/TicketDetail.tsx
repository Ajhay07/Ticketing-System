"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Lock,
  MessageSquare,
  MessagesSquare,
  Paperclip,
  Send,
  UploadCloud,
} from "lucide-react";
import { TicketHistory, TriagePanel } from "@/components/tickets/TicketExtras";
import { DueDate, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, Page } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { Checkbox, ErrorText, Label, Select, Textarea } from "@/components/ui/Form";
import { EmptyState, ErrorState, Skeleton, Spinner } from "@/components/ui/States";
import {
  apiJson,
  canClose,
  canReopen,
  canResolve,
  formatBytes,
  formatDate,
  isAdmin,
  isStaff,
  MAX_ATTACHMENT_BYTES,
  statusLabel,
  statusTargets,
  uploadAttachment,
  type Attachment,
  type Comment,
  type Me,
  type StaffUser,
  type Ticket,
} from "@/lib/tickets";

/**
 * Ticket detail + conversation (spec §10, §11, §41, §43). Which controls are
 * shown is UX only - every action is re-authorized by the API (permissions +
 * state machine) and by Postgres RLS. Internal notes never reach a client's
 * browser at all: the API/RLS simply does not return them.
 */
export function TicketDetail({ ticketId, backHref }: { ticketId: string; backHref: string }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const me = useQuery({ queryKey: ["me"], queryFn: () => apiJson<Me>("/api/me") });
  const ticket = useQuery({
    queryKey: ["ticket", ticketId],
    queryFn: () => apiJson<Ticket>(`/api/tickets/${ticketId}`),
  });
  const comments = useQuery({
    queryKey: ["comments", ticketId],
    queryFn: () => apiJson<Comment[]>(`/api/tickets/${ticketId}/comments`),
    enabled: ticket.isSuccess,
  });
  const attachments = useQuery({
    queryKey: ["attachments", ticketId],
    queryFn: () => apiJson<Attachment[]>(`/api/tickets/${ticketId}/attachments`),
    enabled: ticket.isSuccess,
  });

  function refresh() {
    for (const key of ["ticket", "comments", "attachments"]) {
      queryClient.invalidateQueries({ queryKey: [key, ticketId] });
    }
    queryClient.invalidateQueries({ queryKey: ["tickets"] });
  }

  const action = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      apiJson<Ticket>(`/api/tickets/${ticketId}${path}`, {
        method,
        body: JSON.stringify(body ?? {}),
      }),
    onMutate: () => setActionError(null),
    onSuccess: refresh,
    onError: (e: Error) => setActionError(e.message),
  });

  const back = (
    <Link
      href={backHref}
      className="mb-4 inline-flex items-center gap-1.5 rounded text-sm font-medium text-slate-500 hover:text-slate-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to tickets
    </Link>
  );

  if (ticket.isLoading || me.isLoading) {
    return (
      <Page>
        {back}
        <DetailSkeleton />
      </Page>
    );
  }
  if (ticket.error || !ticket.data || !me.data) {
    return (
      <Page>
        {back}
        <ErrorState message="Ticket not found." detail="It may have been removed, or you may not have access to it." />
      </Page>
    );
  }

  const t = ticket.data;
  const role = me.data.role;
  const staff = isStaff(role);
  const admin = isAdmin(role);
  const version = t.version;
  const busy = action.isPending;

  function closeTicket() {
    // Spec §43: confirm before closing.
    if (window.confirm(`Are you sure you want to close ${t.ticket_number}?`)) {
      action.mutate({ path: "/close", method: "POST", body: { version } });
    }
  }

  const assigneeLabel = t.assigned_to ? (t.assigned_to_name ?? "Clickfield AI team") : "Unassigned";
  // Defence in depth for rendering only: the API never returns INTERNAL comments to clients.
  const visibleComments = (comments.data ?? []).filter((c) => staff || c.visibility !== "INTERNAL");

  return (
    <Page>
      {back}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="p-5 sm:p-6">
              <p className="font-mono text-xs font-medium text-slate-500">{t.ticket_number}</p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{t.subject}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge status={t.status} />
                <PriorityBadge priority={t.priority} />
                {t.is_overdue && <OverdueBadge />}
              </div>
            </div>
            <div className="border-t border-slate-100 px-5 py-5 sm:px-6">
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-slate-400">Description</p>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-800">{t.description}</p>

              {t.resolution_summary && (
                <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Resolution summary
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">{t.resolution_summary}</p>
                </div>
              )}

              {!staff && t.status === "RESOLVED" && (
                <div className="mt-5 rounded-md border border-brand-200 bg-brand-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Issue resolved?</p>
                  <p className="mt-0.5 text-sm text-slate-600">Let us know if the fix worked for you.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" disabled={busy} onClick={closeTicket}>
                      Yes, close ticket
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => action.mutate({ path: "/reopen", method: "POST", body: { version } })}
                    >
                      Still an issue
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <section aria-labelledby="conversation-heading">
            <h2 id="conversation-heading" className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
              <MessagesSquare className="h-4 w-4 text-slate-400" />
              Conversation
              {visibleComments.length > 0 && (
                <span className="text-sm font-normal text-slate-400 tabular">({visibleComments.length})</span>
              )}
            </h2>
            {comments.isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}
            {comments.data && visibleComments.length === 0 && (
              <Card>
                <EmptyState compact icon={MessageSquare} title="No messages yet" description="Replies will appear here." />
              </Card>
            )}
            <ol className="space-y-3">
              {visibleComments.map((c) => (
                <CommentItem key={c.id} comment={c} myUserId={me.data.user_id} />
              ))}
            </ol>
            {t.status !== "CLOSED" && <ReplyBox ticketId={ticketId} staff={staff} onPosted={refresh} />}
          </section>

          <AttachmentsSection ticketId={ticketId} attachments={attachments.data ?? []} onUploaded={refresh} />

          <TicketHistory ticketId={ticketId} />
        </div>

        {/* Right sidebar */}
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-slate-100 text-sm">
              <Field label="Status" value={<StatusBadge status={t.status} />} />
              <Field label="Priority" value={<PriorityBadge priority={t.priority} />} />
              {staff && <Field label="Client" value={t.organization_name ?? "-"} />}
              <Field label="Category" value={t.category_name ?? "-"} />
              <Field
                label="Assigned To"
                value={<span className={t.assigned_to ? "" : "italic text-slate-400"}>{assigneeLabel}</span>}
              />
              <Field label="Created" value={formatDate(t.created_at)} />
              <Field label="Updated" value={formatDate(t.updated_at)} />
              <Field label="Due" value={<DueDate value={formatDate(t.due_at)} overdue={t.is_overdue} />} />
              {t.resolved_at && <Field label="Resolved" value={formatDate(t.resolved_at)} />}
              {t.closed_at && <Field label="Closed" value={formatDate(t.closed_at)} />}
            </dl>
          </Card>

          <ActionsPanel
            ticket={t}
            staff={staff}
            admin={admin}
            role={role}
            busy={busy}
            error={actionError}
            onAction={(path, method, body) => action.mutate({ path, method, body: { ...body, version } })}
            onClose={closeTicket}
          />
          {admin && <TriagePanel key={t.version} ticket={t} onSaved={refresh} />}
        </aside>
      </div>
    </Page>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading ticket" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Card className="space-y-3 p-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-16 w-full" />
        </Card>
        <Skeleton className="h-24 w-full" />
      </div>
      <Card className="space-y-3 p-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-2.5">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function ActionsPanel({
  ticket,
  staff,
  admin,
  role,
  busy,
  error,
  onAction,
  onClose,
}: {
  ticket: Ticket;
  staff: boolean;
  admin: boolean;
  role: Me["role"];
  busy: boolean;
  error: string | null;
  onAction: (path: string, method: string, body: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState("");
  const [assignee, setAssignee] = useState("");
  const [setInProgress, setSetInProgress] = useState(false);

  const staffUsers = useQuery({
    queryKey: ["assignable-users"],
    queryFn: () => apiJson<StaffUser[]>("/api/users/assignable"),
    enabled: admin,
  });

  const targets = statusTargets(ticket.status, role);
  const showClientReopen = !staff && ticket.status === "CLOSED" && canReopen(ticket.status, role);
  if (!staff && targets.length === 0 && !showClientReopen) {
    return error ? <ErrorText>{error}</ErrorText> : null;
  }

  return (
    <Card>
      <CardHeader title="Actions" />
      <div className="divide-y divide-slate-100">
        {targets.length > 0 && (
          <div className="px-5 py-4">
            <p className="mb-2 text-xs font-medium text-slate-500">Change status</p>
            <div className="flex flex-wrap gap-2">
              {targets.map((to) => (
                <Button key={to} size="sm" disabled={busy} onClick={() => onAction("/status", "PATCH", { status: to })}>
                  {statusLabel(to)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {admin && (
          <form
            className="space-y-3 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (assignee) {
                onAction("/assign", "POST", { assigned_to: assignee, set_in_progress: setInProgress });
              }
            }}
          >
            <div>
              <Label htmlFor="assignee" className="text-xs text-slate-500">
                {ticket.assigned_to ? "Reassign to" : "Assign to"}
              </Label>
              <Select id="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Select team member</option>
                {staffUsers.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </div>
            <Checkbox
              label="Set In Progress"
              checked={setInProgress}
              onChange={(e) => setSetInProgress(e.target.checked)}
            />
            <Button type="submit" variant="primary" disabled={busy || !assignee} className="w-full">
              Assign ticket
            </Button>
          </form>
        )}

        {canResolve(ticket.status, role) && (
          <form
            className="px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (summary.trim()) {
                onAction("/resolve", "POST", { resolution_summary: summary });
                setSummary("");
              }
            }}
          >
            <Label htmlFor="resolution" className="text-xs text-slate-500">
              Resolution summary - what was done?
            </Label>
            <Textarea id="resolution" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
            <Button type="submit" variant="primary" disabled={busy || !summary.trim()} className="mt-2 w-full">
              <CheckCircle2 className="h-4 w-4" />
              Resolve ticket
            </Button>
          </form>
        )}

        {staff && (canClose(ticket.status, role) || canReopen(ticket.status, role)) && (
          <div className="flex flex-wrap gap-2 px-5 py-4">
            {canClose(ticket.status, role) && (
              <Button variant="destructive" disabled={busy} onClick={onClose} className="flex-1">
                Close ticket
              </Button>
            )}
            {canReopen(ticket.status, role) && (
              <Button disabled={busy} onClick={() => onAction("/reopen", "POST", {})} className="flex-1">
                Reopen ticket
              </Button>
            )}
          </div>
        )}

        {showClientReopen && (
          <div className="px-5 py-4">
            <Button disabled={busy} onClick={() => onAction("/reopen", "POST", {})} className="w-full">
              Reopen ticket
            </Button>
          </div>
        )}

        {(busy || error) && (
          <div className="px-5 py-3">
            {busy && (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Spinner /> Saving...
              </p>
            )}
            {error && <ErrorText>{error}</ErrorText>}
          </div>
        )}
      </div>
    </Card>
  );
}

function CommentItem({ comment, myUserId }: { comment: Comment; myUserId: string }) {
  const internal = comment.visibility === "INTERNAL";
  const fromTeam = isStaff(comment.author_role ?? undefined);
  const author = comment.user_id === myUserId ? "You" : (comment.author_name ?? "Clickfield AI team");

  if (internal) {
    return (
      <li className="overflow-hidden rounded-lg border border-amber-300 bg-amber-50 shadow-xs">
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-100/70 px-4 py-2 text-xs font-semibold text-amber-900">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          Internal Note
          <span className="font-normal text-amber-800">&mdash; visible only to Clickfield AI team</span>
        </div>
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-800">{author}</span>
            <time className="tabular text-slate-500">{formatDate(comment.created_at)}</time>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{comment.comment}</p>
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "rounded-lg border bg-white px-4 py-3 shadow-xs",
        fromTeam ? "border-l-[3px] border-slate-200 border-l-brand-500" : "border-slate-200"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-2xs font-semibold",
              fromTeam ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"
            )}
            aria-hidden
          >
            {author.slice(0, 1).toUpperCase()}
          </span>
          <span className="font-semibold text-slate-800">{author}</span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide",
              fromTeam ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"
            )}
          >
            {fromTeam ? "Clickfield AI" : "Client"}
          </span>
        </span>
        <time className="tabular text-slate-500">{formatDate(comment.created_at)}</time>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{comment.comment}</p>
    </li>
  );
}

function ReplyBox({ ticketId, staff, onPosted }: { ticketId: string; staff: boolean; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"CLIENT" | "INTERNAL">("CLIENT");
  const [error, setError] = useState<string | null>(null);
  const internal = visibility === "INTERNAL";

  const post = useMutation({
    mutationFn: () =>
      apiJson<Comment>(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment: text, visibility }),
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setText("");
      onPosted();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form
      className={cn(
        "mt-4 overflow-hidden rounded-lg border bg-white shadow-sm transition-colors",
        internal ? "border-amber-300" : "border-slate-200"
      )}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) post.mutate();
      }}
    >
      {staff && (
        <div role="radiogroup" aria-label="Message type" className="flex border-b border-slate-100 bg-slate-50/60 p-1">
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
                  "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-brand-500",
                  active
                    ? value === "INTERNAL"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-white text-slate-900 shadow-xs"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                <input
                  type="radio"
                  name="visibility"
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
        <p className="flex items-center gap-1.5 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          This note will be visible only to the Clickfield AI team, never to the client.
        </p>
      )}
      <div className="p-3">
        <textarea
          aria-label="Message"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={internal ? "Internal note (not visible to the client)" : "Write a reply"}
          className={cn(
            "block w-full resize-y rounded-md border-0 px-1 py-1 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0",
            internal ? "bg-amber-50/40" : "bg-white"
          )}
        />
        {error && <ErrorText className="mt-2">{error}</ErrorText>}
        <div className="mt-2 flex justify-end">
          <Button type="submit" variant="primary" disabled={post.isPending || !text.trim()}>
            {post.isPending ? <Spinner className="text-white/80" /> : internal ? <Lock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {internal ? "Add internal note" : "Send reply"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function AttachmentsSection({
  ticketId,
  attachments,
  onUploaded,
}: {
  ticketId: string;
  attachments: Attachment[];
  onUploaded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useMutation({
    mutationFn: (file: File) => uploadAttachment(ticketId, file),
    onMutate: () => setError(null),
    onSuccess: onUploaded,
    onError: (e: Error) => setError(e.message),
  });

  async function download(attachment: Attachment) {
    setError(null);
    try {
      const { url } = await apiJson<{ url: string }>(
        `/api/tickets/${ticketId}/attachments/${attachment.id}/download`
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<Paperclip className="h-4 w-4" />}
        title="Attachments"
        actions={
          <Button size="sm" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
            {upload.isPending ? <Spinner /> : <UploadCloud className="h-3.5 w-3.5" />}
            {upload.isPending ? "Uploading..." : "Add attachment"}
          </Button>
        }
      />
      {attachments.length === 0 ? (
        <EmptyState compact icon={Paperclip} title="No attachments" description="PNG, JPG, PDF, DOC/DOCX, XLS/XLSX, CSV, ZIP - up to 25 MB." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <FileText className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{a.file_name}</p>
                <p className="text-xs text-slate-500">{formatBytes(a.file_size)}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => download(a)} aria-label={`Download ${a.file_name}`}>
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
            </li>
          ))}
        </ul>
      )}
      <label className="sr-only" htmlFor={`attach-${ticketId}`}>
        Add attachment (PNG, JPG, PDF, DOC/DOCX, XLS/XLSX, CSV, ZIP - up to 25 MB)
      </label>
      <input
        ref={inputRef}
        id={`attach-${ticketId}`}
        type="file"
        accept=".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip"
        disabled={upload.isPending}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > MAX_ATTACHMENT_BYTES) {
            setError("Attachments must be 25 MB or smaller.");
            return;
          }
          upload.mutate(file);
        }}
      />
      {error && (
        <div className="px-5 pb-4">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </Card>
  );
}
