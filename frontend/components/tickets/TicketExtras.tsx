"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiJson, formatDate, PRIORITIES, statusLabel, type Priority, type Ticket } from "@/lib/tickets";
import { describeAuditEntry, type AuditEntry } from "@/lib/admin";

/** Ticket history (spec §24). Which rows appear is decided by the API + RLS. */
export function TicketHistory({ ticketId }: { ticketId: string }) {
  const history = useQuery({
    queryKey: ["ticket-history", ticketId],
    queryFn: () => apiJson<AuditEntry[]>(`/api/tickets/${ticketId}/history`),
  });
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-slate-900">History</h2>
      {history.error && <p className="mt-2 text-sm text-red-600">{(history.error as Error).message}</p>}
      <ul className="mt-3 space-y-1 text-sm">
        {history.data?.map((h) => (
          <li key={h.id} className="flex gap-3">
            <span className="w-44 shrink-0 text-slate-500">{formatDate(h.created_at)}</span>
            <span className="text-slate-800">
              {describeAuditEntry(h)}
              <span className="text-slate-500"> by {h.actor_name ?? "Clickfield AI team"}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** CTO triage: change priority / due date (spec §3.2). Admin-only UX; the API re-checks. */
export function TriagePanel({ ticket, onSaved }: { ticket: Ticket; onSaved: () => void }) {
  const [priority, setPriority] = useState<Priority>(ticket.priority);
  const [due, setDue] = useState("");
  const save = useMutation({
    mutationFn: () =>
      apiJson<Ticket>(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: ticket.version,
          priority: priority !== ticket.priority ? priority : undefined,
          due_at: due ? new Date(due).toISOString() : undefined,
        }),
      }),
    onSuccess: () => {
      setDue("");
      onSaved();
    },
  });
  return (
    <div className="mt-5 flex flex-wrap items-end gap-3 rounded-md border border-slate-200 p-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase text-slate-500">Priority</span>
        <select
          className="rounded-md border border-slate-300 px-2 py-1.5"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {statusLabel(p)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase text-slate-500">Due date</span>
        <input
          type="datetime-local"
          className="rounded-md border border-slate-300 px-2 py-1.5"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={save.isPending || (priority === ticket.priority && !due)}
        onClick={() => save.mutate()}
        className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50"
      >
        Save triage
      </button>
      {save.error && <p className="text-red-600">{(save.error as Error).message}</p>}
    </div>
  );
}
