"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { apiJson, formatDate, type StaffUser, type Ticket, type TicketPage } from "@/lib/tickets";

/** Unassigned queue (spec §15, decision #5: admin-only - the API returns 403 to anyone else). */
export default function UnassignedQueuePage() {
  const queue = useQuery({
    queryKey: ["unassigned"],
    queryFn: () => apiJson<TicketPage>("/api/admin/unassigned?page_size=100"),
  });
  const staff = useQuery({
    queryKey: ["assignable"],
    queryFn: () => apiJson<StaffUser[]>("/api/users/assignable"),
  });

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Unassigned Tickets</h1>
      {queue.error && <p className="mt-4 text-sm text-red-600">{(queue.error as Error).message}</p>}
      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Ticket</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Subject</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 font-medium">Assign</th>
            </tr>
          </thead>
          <tbody>
            {queue.data?.items.map((t) => (
              <Row key={t.id} ticket={t} staff={staff.data ?? []} />
            ))}
          </tbody>
        </table>
        {queue.data?.items.length === 0 && (
          <p className="p-4 text-sm text-slate-500">No unassigned tickets.</p>
        )}
      </div>
    </main>
  );
}

function Row({ ticket, staff }: { ticket: Ticket; staff: StaffUser[] }) {
  const queryClient = useQueryClient();
  const [assignee, setAssignee] = useState("");
  const [inProgress, setInProgress] = useState(false);
  const assign = useMutation({
    mutationFn: () =>
      apiJson<Ticket>(`/api/tickets/${ticket.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ assigned_to: assignee, set_in_progress: inProgress, version: ticket.version }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unassigned"] });
      queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
    },
  });
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-3 py-2 font-mono text-xs">
        <Link href={`/admin/tickets/${ticket.id}`}>{ticket.ticket_number}</Link>
      </td>
      <td className="px-3 py-2">{ticket.organization_name}</td>
      <td className="px-3 py-2">{ticket.subject}</td>
      <td className="px-3 py-2">
        <PriorityBadge priority={ticket.priority} />
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={ticket.status} />
      </td>
      <td className="px-3 py-2 text-slate-500">
        {formatDate(ticket.due_at)} {ticket.is_overdue && <OverdueBadge />}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Assignee for ${ticket.ticket_number}`}
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Select team member</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={inProgress} onChange={(e) => setInProgress(e.target.checked)} />
            + In Progress
          </label>
          <button
            type="button"
            disabled={!assignee || assign.isPending}
            onClick={() => assign.mutate()}
            className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            Assign
          </button>
        </div>
        {assign.error && <p className="mt-1 text-xs text-red-600">{(assign.error as Error).message}</p>}
      </td>
    </tr>
  );
}
