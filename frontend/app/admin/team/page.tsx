"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Users } from "lucide-react";
import { TableSkeleton } from "@/components/tickets/TicketList";
import { Page, PageHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, TableContainer, TBody, TD, TH, THead } from "@/components/ui/Table";
import type { WorkloadRow } from "@/lib/admin";
import { apiJson, statusLabel } from "@/lib/tickets";

/** Team workload (spec §16): display name + counts only. */
export default function TeamWorkloadPage() {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["workload"],
    queryFn: () => apiJson<WorkloadRow[]>("/api/admin/workload"),
  });
  const max = Math.max(1, ...(data ?? []).map((r) => r.active_total));
  return (
    <Page>
      <PageHeader title="Team Workload" description="Active tickets per team member." />
      {isLoading && <TableSkeleton rows={4} />}
      {error && <ErrorState message="We couldn't load team workload." onRetry={() => refetch()} />}
      {data && (
        <TableContainer>
          {data.length === 0 ? (
            <EmptyState icon={Users} title="No team members yet" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Team Member</TH>
                  <TH>Role</TH>
                  <TH align="right">Open</TH>
                  <TH align="right">In Progress</TH>
                  <TH align="right">Waiting Client</TH>
                  <TH align="right">Overdue</TH>
                  <TH>Active Total</TH>
                </tr>
              </THead>
              <TBody>
                {data.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <TD className="font-medium text-slate-900">{r.name}</TD>
                    <TD className="text-slate-500">{statusLabel(r.role)}</TD>
                    <TD align="right">{r.open}</TD>
                    <TD align="right">{r.in_progress}</TD>
                    <TD align="right">{r.waiting_for_client}</TD>
                    <TD align="right" className={r.overdue > 0 ? "font-semibold text-red-600" : "text-slate-400"}>
                      {r.overdue > 0 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />}
                      {r.overdue}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-right font-semibold tabular text-slate-900">{r.active_total}</span>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                          <span
                            className="block h-full rounded-full bg-brand-500"
                            style={{ width: `${(r.active_total / max) * 100}%` }}
                          />
                        </span>
                      </div>
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </TableContainer>
      )}
    </Page>
  );
}
