"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
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

const buttonClass =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 disabled:opacity-50";
const primaryButtonClass =
  "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

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

  if (ticket.isLoading || me.isLoading) {
    return <main className="mx-auto max-w-5xl p-8 text-sm text-slate-500">Loading ticket...</main>;
  }
  if (ticket.error || !ticket.data || !me.data) {
    return (
      <main className="mx-auto max-w-5xl p-8">
        <p className="text-sm text-red-600">Ticket not found.</p>
        <Link href={backHref} className="mt-4 inline-block text-sm text-slate-500 underline">
          Back to tickets
        </Link>
      </main>
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

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link href={backHref} className="text-sm text-slate-500 underline">
        Back to tickets
      </Link>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-6">
        <p className="font-mono text-sm text-slate-500">{t.ticket_number}</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{t.subject}</h1>
        <div className="mt-3 flex gap-2">
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          {staff && <Field label="Client" value={t.organization_name ?? "-"} />}
          <Field label="Category" value={t.category_name ?? "-"} />
          <Field label="Assigned To" value={assigneeLabel} />
          <Field label="Created" value={formatDate(t.created_at)} />
          <Field label="Due" value={formatDate(t.due_at)} />
          {t.resolved_at && <Field label="Resolved" value={formatDate(t.resolved_at)} />}
          {t.closed_at && <Field label="Closed" value={formatDate(t.closed_at)} />}
        </dl>
        <p className="mt-5 whitespace-pre-wrap text-sm text-slate-800">{t.description}</p>

        {t.resolution_summary && (
          <div className="mt-5 rounded-md border border-green-200 bg-green-50 p-4 text-sm">
            <p className="font-medium text-green-800">Resolution summary</p>
            <p className="mt-1 whitespace-pre-wrap text-green-900">{t.resolution_summary}</p>
          </div>
        )}

        {!staff && t.status === "RESOLVED" && (
          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Issue resolved?</p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={closeTicket} className={primaryButtonClass}>
                Yes, Close Ticket
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => action.mutate({ path: "/reopen", method: "POST", body: { version } })}
                className={buttonClass}
              >
                Still an Issue
              </button>
            </div>
          </div>
        )}

        <ActionsPanel
          ticket={t}
          staff={staff}
          admin={admin}
          role={role}
          busy={busy}
          onAction={(path, method, body) => action.mutate({ path, method, body: { ...body, version } })}
          onClose={closeTicket}
        />
        {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
      </div>

      <AttachmentsSection ticketId={ticketId} attachments={attachments.data ?? []} onUploaded={refresh} />

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-slate-900">Conversation</h2>
        <div className="mt-3 space-y-3">
          {comments.data?.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
          {comments.data?.map((c) => <CommentItem key={c.id} comment={c} myUserId={me.data.user_id} />)}
        </div>
        {t.status !== "CLOSED" && (
          <ReplyBox ticketId={ticketId} staff={staff} onPosted={refresh} />
        )}
      </section>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

function ActionsPanel({
  ticket,
  staff,
  admin,
  role,
  busy,
  onAction,
  onClose,
}: {
  ticket: Ticket;
  staff: boolean;
  admin: boolean;
  role: Me["role"];
  busy: boolean;
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
    return null;
  }

  return (
    <div className="mt-6 space-y-4 border-t border-slate-200 pt-4">
      {targets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-600">Change status:</span>
          {targets.map((to) => (
            <button
              key={to}
              type="button"
              disabled={busy}
              className={buttonClass}
              onClick={() => onAction("/status", "PATCH", { status: to })}
            >
              {statusLabel(to)}
            </button>
          ))}
        </div>
      )}

      {admin && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (assignee) {
              onAction("/assign", "POST", { assigned_to: assignee, set_in_progress: setInProgress });
            }
          }}
        >
          <label className="text-sm text-slate-600" htmlFor="assignee">
            {ticket.assigned_to ? "Reassign to:" : "Assign to:"}
          </label>
          <select
            id="assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Select team member</option>
            {staffUsers.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={setInProgress}
              onChange={(e) => setSetInProgress(e.target.checked)}
            />
            Set In Progress
          </label>
          <button type="submit" disabled={busy || !assignee} className={primaryButtonClass}>
            Confirm assignment
          </button>
        </form>
      )}

      {canResolve(ticket.status, role) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (summary.trim()) {
              onAction("/resolve", "POST", { resolution_summary: summary });
              setSummary("");
            }
          }}
        >
          <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="resolution">
            Resolution summary - what was done?
          </label>
          <textarea
            id="resolution"
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy || !summary.trim()} className={`mt-2 ${primaryButtonClass}`}>
            Mark as Resolved
          </button>
        </form>
      )}

      {staff && (canClose(ticket.status, role) || canReopen(ticket.status, role)) && (
        <div className="flex gap-2">
          {canClose(ticket.status, role) && (
            <button type="button" disabled={busy} onClick={onClose} className={buttonClass}>
              Close Ticket
            </button>
          )}
          {canReopen(ticket.status, role) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction("/reopen", "POST", {})}
              className={buttonClass}
            >
              Reopen
            </button>
          )}
        </div>
      )}

      {showClientReopen && (
        <button type="button" disabled={busy} onClick={() => onAction("/reopen", "POST", {})} className={buttonClass}>
          Reopen Ticket
        </button>
      )}
    </div>
  );
}

function CommentItem({ comment, myUserId }: { comment: Comment; myUserId: string }) {
  const internal = comment.visibility === "INTERNAL";
  const author =
    comment.user_id === myUserId ? "You" : (comment.author_name ?? "Clickfield AI team");
  return (
    <div
      className={`rounded-lg border p-4 text-sm ${
        internal ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-medium uppercase text-slate-700">
          {internal ? `Internal note - ${author}` : author}
        </span>
        <span>{formatDate(comment.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-slate-800">{comment.comment}</p>
      {internal && <p className="mt-2 text-xs text-amber-800">Visible only to Clickfield AI team.</p>}
    </div>
  );
}

function ReplyBox({ ticketId, staff, onPosted }: { ticketId: string; staff: boolean; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"CLIENT" | "INTERNAL">("CLIENT");
  const [error, setError] = useState<string | null>(null);

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
      className="mt-4 rounded-lg border border-slate-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) post.mutate();
      }}
    >
      {staff && (
        <div className="mb-2 flex gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "CLIENT"}
              onChange={() => setVisibility("CLIENT")}
            />
            Reply to client
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "INTERNAL"}
              onChange={() => setVisibility("INTERNAL")}
            />
            Internal note
          </label>
        </div>
      )}
      <textarea
        aria-label="Message"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={visibility === "INTERNAL" ? "Internal note (not visible to the client)" : "Write a reply"}
        className={`w-full rounded-md border px-3 py-2 text-sm ${
          visibility === "INTERNAL" ? "border-amber-300 bg-amber-50" : "border-slate-300"
        }`}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={post.isPending || !text.trim()} className={`mt-2 ${primaryButtonClass}`}>
        {visibility === "INTERNAL" ? "Add internal note" : "Send reply"}
      </button>
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
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-slate-900">Attachments</h2>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        {attachments.length === 0 && <li className="p-3 text-slate-500">No attachments.</li>}
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center justify-between p-3">
            <span className="text-slate-800">
              {a.file_name} <span className="text-slate-500">({formatBytes(a.file_size)})</span>
            </span>
            <button type="button" className={buttonClass} onClick={() => download(a)}>
              Download
            </button>
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-sm text-slate-600">
        Add attachment (PNG, JPG, PDF, DOC/DOCX, XLS/XLSX, CSV, ZIP - up to 25 MB):
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.zip"
          disabled={upload.isPending}
          className="mt-1 block text-sm"
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
      </label>
      {upload.isPending && <p className="mt-2 text-sm text-slate-500">Uploading...</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
