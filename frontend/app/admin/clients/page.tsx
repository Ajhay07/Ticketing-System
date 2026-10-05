"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";
import { TableSkeleton } from "@/components/tickets/TicketList";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/Card";
import { ErrorText, Input } from "@/components/ui/Form";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { ClientOrg } from "@/lib/admin";
import { apiJson } from "@/lib/tickets";

/** Client organizations (spec §18, §38). Admin-only; enforced by the API. */
export default function ClientsPage() {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => apiJson<ClientOrg[]>("/api/admin/clients") });
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const create = useMutation({
    mutationFn: () => apiJson<ClientOrg>("/api/admin/clients", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });
  const rows = (clients.data ?? []).filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Page>
      <PageHeader title="Clients" description="Client organizations and their ticket activity." />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            type="search"
            aria-label="Filter clients"
            placeholder="Filter clients..."
            className="pl-9"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Input
            aria-label="New client name"
            placeholder="New client organization name"
            className="sm:w-72"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
            <Plus className="h-4 w-4" />
            Add client
          </Button>
        </form>
      </div>
      {create.error && <ErrorText className="mb-4">{(create.error as Error).message}</ErrorText>}

      {clients.isLoading && <TableSkeleton rows={4} />}
      {clients.error && <ErrorState message="We couldn't load clients." onRetry={() => clients.refetch()} />}
      {clients.data && (
        <TableContainer>
          {rows.length === 0 ? (
            <EmptyState icon={Building2} title={filter ? "No clients match that filter" : "No clients yet"} />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Client</TH>
                  <TH>Status</TH>
                  <TH align="right">Active Users</TH>
                  <TH align="right">Open</TH>
                  <TH align="right">In Progress</TH>
                  <TH align="right">Overdue</TH>
                  <TH align="right">Resolved This Month</TH>
                  <TH align="right">Total</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id} href={`/admin/clients/${c.id}`}>
                    <TD className="font-medium text-slate-900">
                      <Link href={`/admin/clients/${c.id}`} className="rounded hover:text-brand-700">
                        {c.name}
                      </Link>
                    </TD>
                    <TD>
                      <Badge tone={c.status === "ACTIVE" ? "green" : "slate"} dot>
                        {c.status === "ACTIVE" ? "Active" : "Disabled"}
                      </Badge>
                    </TD>
                    <TD align="right">{c.active_users}</TD>
                    <TD align="right">{c.open}</TD>
                    <TD align="right">{c.in_progress}</TD>
                    <TD align="right" className={c.overdue > 0 ? "font-semibold text-red-600" : "text-slate-400"}>
                      {c.overdue}
                    </TD>
                    <TD align="right">{c.resolved_this_month}</TD>
                    <TD align="right" className="font-medium text-slate-900">
                      {c.total_tickets}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </TableContainer>
      )}
    </Page>
  );
}
