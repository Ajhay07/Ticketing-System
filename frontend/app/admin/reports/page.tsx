"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, MessageSquareReply, RotateCcw } from "lucide-react";
import { Card, CardHeader, Page, PageHeader, SectionTitle } from "@/components/ui/Card";
import { Select } from "@/components/ui/Form";
import { StatCard } from "@/components/ui/StatCard";
import { ErrorState, LoadingState } from "@/components/ui/States";
import { Table, TableContainer, TBody, TD, TH, THead } from "@/components/ui/Table";
import { formatMinutes, type ReportsData } from "@/lib/admin";
import { apiJson } from "@/lib/tickets";

/** Basic V1 reports (spec §37): plain tables, no charts (spec §34 "avoid unnecessary charts"). */
export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["reports", days],
    queryFn: () => apiJson<ReportsData>(`/api/admin/reports?days=${days}`),
  });

  return (
    <Page>
      <PageHeader
        title="Reports"
        description="Response, resolution and volume across clients and the team."
        actions={
          <Select aria-label="Report window" className="w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </Select>
        }
      />
      {isLoading && <LoadingState label="Loading reports..." />}
      {error && <ErrorState message="We couldn't load reports." onRetry={() => refetch()} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Avg response" value={formatMinutes(data.resolution.avg_response_minutes)} icon={MessageSquareReply} tone="brand" />
            <StatCard label="Avg resolution" value={formatMinutes(data.resolution.avg_resolution_minutes)} icon={Clock} tone="brand" />
            <StatCard label="Tickets resolved" value={data.resolution.tickets_resolved} icon={CheckCircle2} tone="success" />
            <StatCard label="Tickets reopened" value={data.resolution.tickets_reopened} icon={RotateCcw} tone="warning" />
          </div>

          <SectionTitle className="mt-10">Ticket volume</SectionTitle>
          <div className="grid gap-4 md:grid-cols-3">
            {(["day", "week", "month"] as const).map((unit) => (
              <Card key={unit}>
                <CardHeader title={`Per ${unit}`} />
                <ul className="max-h-60 divide-y divide-cf-border overflow-y-auto text-sm">
                  {data.volume[unit].map((v) => (
                    <li key={v.period} className="flex justify-between px-5 py-2">
                      <span className="tabular text-slate-600">{new Date(v.period).toLocaleDateString()}</span>
                      <span className="font-semibold tabular text-slate-900">{v.tickets}</span>
                    </li>
                  ))}
                  {data.volume[unit].length === 0 && <li className="px-5 py-6 text-center text-slate-500">No tickets</li>}
                </ul>
              </Card>
            ))}
          </div>

          <SectionTitle className="mt-10">By client</SectionTitle>
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Client</TH>
                  <TH align="right">Tickets</TH>
                  <TH align="right">Open</TH>
                  <TH align="right">Overdue</TH>
                </tr>
              </THead>
              <TBody>
                {data.by_client.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80">
                    <TD className="font-medium text-slate-900">{c.name}</TD>
                    <TD align="right">{c.total_tickets}</TD>
                    <TD align="right">{c.open_tickets}</TD>
                    <TD align="right" className={c.overdue_tickets > 0 ? "font-semibold text-red-600" : "text-slate-400"}>
                      {c.overdue_tickets}
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>

          <SectionTitle className="mt-10">By team member</SectionTitle>
          <TableContainer>
            <Table>
              <THead>
                <tr>
                  <TH>Team member</TH>
                  <TH align="right">Assigned</TH>
                  <TH align="right">Resolved</TH>
                  <TH align="right">Open workload</TH>
                  <TH align="right">Avg resolution</TH>
                </tr>
              </THead>
              <TBody>
                {data.by_team.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80">
                    <TD className="font-medium text-slate-900">{t.name}</TD>
                    <TD align="right">{t.tickets_assigned}</TD>
                    <TD align="right">{t.tickets_resolved}</TD>
                    <TD align="right">{t.open_workload}</TD>
                    <TD align="right">{formatMinutes(t.avg_resolution_minutes)}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Page>
  );
}
