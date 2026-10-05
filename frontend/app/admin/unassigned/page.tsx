"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { DueDate, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { TableSkeleton } from "@/components/tickets/TicketList";
import { Button } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/Card";
import { Checkbox, Select } from "@/components/ui/Form";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, TableContainer, TBody, TD, TH, THead, TicketNumberLink } from "@/components/ui/Table";
import { apiJson, formatDate, type StaffUser, type Ticket, type TicketPage } from "@/lib/tickets";

function age(createdAt: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

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
    <Page>
      <PageHeader
        title="Unassigned Tickets"
        description={
          queue.data ? `${queue.data.items.length} ticket${queue.data.items.length === 1 ? "" : "s"} waiting for an owner` : "Tickets waiting for an owner"
        }
      />
      {queue.isLoading && <TableSkeleton />}
      {queue.error && <ErrorState message="We couldn't load the unassigned queue." onRetry={() => queue.refetch()} />}
      {queue.data && (
        <TableContainer>
          {queue.data.items.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No unassigned tickets" description="Every ticket has an owner. Nice work." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Ticket</TH>
                  <TH>Client</TH>
                  <TH>Subject</TH>
                  <TH>Priority</TH>
                  <TH>Status</TH>
                  <TH>Age</TH>
                  <TH>Due</TH>
                  <TH>Assign</TH>
                </tr>
              </THead>
              <TBody>
                {queue.data.items.map((t) => (
                  <Row key={t.id} ticket={t} staff={staff.data ?? []} />
                ))}
              </TBody>
            </Table>
          )}
        </TableContainer>
      )}
    </Page>
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
    <tr className="transition-colors hover:bg-slate-50/80">
      <TD>
        <TicketNumberLink href={`/admin/tickets/${ticket.id}`}>{ticket.ticket_number}</TicketNumberLink>
      </TD>
      <TD className="text-slate-600">{ticket.organization_name}</TD>
      <TD className="max-w-[260px] truncate font-medium text-slate-900">
        <Link href={`/admin/tickets/${ticket.id}`} className="rounded hover:text-brand-700">
          {ticket.subject}
        </Link>
      </TD>
      <TD>
        <PriorityBadge priority={ticket.priority} />
      </TD>
      <TD>
        <StatusBadge status={ticket.status} />
      </TD>
      <TD className="tabular text-slate-500" >
        <span title={formatDate(ticket.created_at)}>{age(ticket.created_at)}</span>
      </TD>
      <TD>
        <DueDate value={formatDate(ticket.due_at)} overdue={ticket.is_overdue} />
      </TD>
      <TD>
        <div className="flex items-center gap-2">
          <Select
            aria-label={`Assignee for ${ticket.ticket_number}`}
            className="h-8 w-44 text-xs"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Select team member</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Checkbox
            className="text-xs"
            label="+ In Progress"
            checked={inProgress}
            onChange={(e) => setInProgress(e.target.checked)}
          />
          <Button variant="primary" size="sm" disabled={!assignee || assign.isPending} onClick={() => assign.mutate()}>
            {assign.isPending ? "Assigning..." : "Assign ticket"}
          </Button>
        </div>
        {assign.error && <p className="mt-1 text-xs text-red-600">{(assign.error as Error).message}</p>}
      </TD>
    </tr>
  );
}
