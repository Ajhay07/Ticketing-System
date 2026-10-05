"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { History, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { ErrorText, Input, Label, Select } from "@/components/ui/Form";
import { EmptyState, Skeleton } from "@/components/ui/States";
import { apiJson, formatDate, PRIORITIES, statusLabel, type Priority, type Ticket } from "@/lib/tickets";
import { describeAuditEntry, type AuditEntry } from "@/lib/admin";

/** Ticket history (spec §24). Which rows appear is decided by the API + RLS. */
export function TicketHistory({ ticketId }: { ticketId: string }) {
  const history = useQuery({
    queryKey: ["ticket-history", ticketId],
    queryFn: () => apiJson<AuditEntry[]>(`/api/tickets/${ticketId}/history`),
  });
  return (
    <Card>
      <CardHeader icon={<History className="h-4 w-4" />} title="Activity" />
      {history.isLoading && (
        <div className="space-y-2 p-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}
      {history.error && (
        <div className="p-5">
          <ErrorText>Could not load ticket history.</ErrorText>
        </div>
      )}
      {history.data && history.data.length === 0 && <EmptyState compact icon={History} title="No activity yet" />}
      {history.data && history.data.length > 0 && (
        <ol className="relative px-5 py-4">
          <span className="absolute bottom-6 left-[27px] top-6 w-px bg-slate-200" aria-hidden />
          {history.data.map((h) => (
            <li key={h.id} className="relative flex gap-3 py-1.5">
              <span className="relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-white bg-slate-300 ring-1 ring-slate-200" aria-hidden />
              <div className="min-w-0 text-sm">
                <p className="text-slate-800">
                  {describeAuditEntry(h)}
                  <span className="text-slate-500"> by {h.actor_name ?? "Clickfield AI team"}</span>
                </p>
                <p className="text-xs tabular text-slate-400">{formatDate(h.created_at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
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
    <Card>
      <CardHeader icon={<SlidersHorizontal className="h-4 w-4" />} title="Triage" />
      <div className="space-y-3 px-5 py-4">
        <div>
          <Label htmlFor="triage-priority" className="text-xs text-slate-500">
            Priority
          </Label>
          <Select id="triage-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {statusLabel(p)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="triage-due" className="text-xs text-slate-500">
            Due date
          </Label>
          <Input id="triage-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        <Button
          variant="primary"
          className="w-full"
          disabled={save.isPending || (priority === ticket.priority && !due)}
          onClick={() => save.mutate()}
        >
          Save triage
        </Button>
        {save.error && <ErrorText>{(save.error as Error).message}</ErrorText>}
      </div>
    </Card>
  );
}
