"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Paperclip,
  UploadCloud,
} from "lucide-react";
import { TicketChat } from "@/components/tickets/TicketChat";
import { TicketHistory, TriagePanel } from "@/components/tickets/TicketExtras";
import { CHAT_REFETCH_MS } from "@/lib/chat";
import type { Notification } from "@/lib/admin";
import { DueDate, OverdueBadge, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, Page } from "@/components/ui/Card";
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
  openAttachment,
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
    // Chat freshness by polling while the page is open (no realtime; docs/CHAT.md).
    refetchInterval: CHAT_REFETCH_MS,
  });
  const attachments = useQuery({
    queryKey: ["attachments", ticketId],
    queryFn: () => apiJson<Attachment[]>(`/api/tickets/${ticketId}/attachments`),
    enabled: ticket.isSuccess,
    refetchInterval: CHAT_REFETCH_MS,
  });
  useMarkTicketNotificationsRead(ticketId, ticket.isSuccess);

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
      className="mb-6 inline-flex items-center gap-1.5 rounded-sm text-[11px] font-bold uppercase tracking-[0.1em] text-cf-slate hover:text-cf-ink"
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

  const assigneeLabel = t.assigned_to ? (t.assigned_to_name ?? "ClickfieldAI team") : "Unassigned";

  return (
    <Page>
      {back}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <Card>
            <div className="p-5 sm:p-6">
              <p className="font-mono text-xs font-semibold text-cf-ink">{t.ticket_number}</p>
              <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-[-0.03em] text-cf-black sm:text-[34px]">{t.subject}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge status={t.status} />
                <PriorityBadge priority={t.priority} />
                {t.is_overdue && <OverdueBadge />}
              </div>
            </div>
            <div className="border-t border-cf-border px-5 py-5 sm:px-6">
              <p className="mb-2 cf-label">Description</p>
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

          <TicketChat
            ticketId={ticketId}
            comments={comments.data ?? []}
            loading={comments.isLoading}
            attachments={attachments.data ?? []}
            myUserId={me.data.user_id}
            staff={staff}
            closed={t.status === "CLOSED"}
            onPosted={refresh}
          />

          <AttachmentsSection ticketId={ticketId} attachments={attachments.data ?? []} onUploaded={refresh} />

          <TicketHistory ticketId={ticketId} />
        </div>

        {/* Right sidebar */}
        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-cf-border text-sm">
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

/**
 * Opening a ticket marks the viewer's own unread notifications for it as read
 * (existing /api/notifications endpoints; RLS limits this to the viewer's rows).
 * Drives the unread dot on ticket lists. Best-effort: failures are ignored.
 */
function useMarkTicketNotificationsRead(ticketId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => apiJson<{ items: Notification[]; unread: number }>("/api/notifications?unread_only=true&limit=100"),
    enabled,
  });
  const ids = (unread.data?.items ?? []).filter((n) => n.ticket_id === ticketId && !n.read_at).map((n) => n.id);
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    void Promise.all(
      key.split(",").map((id) => apiJson<null>(`/api/notifications/${id}/read`, { method: "POST" }).catch(() => null))
    ).then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }));
  }, [key, queryClient]);
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
      <div className="divide-y divide-cf-border">
        {targets.length > 0 && (
          <div className="px-5 py-4">
            <p className="cf-label mb-3">Change status</p>
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
      await openAttachment(ticketId, attachment.id);
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
        <ul className="divide-y divide-cf-border">
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
