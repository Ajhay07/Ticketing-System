"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Clock, Flame, Hourglass, Inbox } from "lucide-react";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { DueDate, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { ButtonLink } from "@/components/ui/Button";
import { Page, PageHeader, SectionTitle } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, LoadingState } from "@/components/ui/States";
import { Table, TableContainer, TBody, TD, TH, THead, TicketNumberLink, TR } from "@/components/ui/Table";
import { ErrorText } from "@/components/ui/Form";
import type { DashboardData } from "@/lib/admin";
import { apiJson, formatDate, statusLabel, type Priority } from "@/lib/tickets";

type Tone = "brand" | "warning" | "success" | "violet" | "neutral" | "danger";

const METRICS: {
  key: keyof DashboardData["metrics"];
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
}[] = [
  { key: "open", label: "Open", href: "/admin/tickets", icon: CircleDot, tone: "brand" },
  { key: "in_progress", label: "In Progress", href: "/admin/tickets", icon: Clock, tone: "brand" },
  { key: "waiting_for_client", label: "Waiting Client", href: "/admin/tickets", icon: Hourglass, tone: "warning" },
  { key: "overdue", label: "Overdue", href: "/admin/tickets", icon: AlertTriangle, tone: "neutral" },
  { key: "resolved_today", label: "Resolved Today", href: "/admin/tickets", icon: CheckCircle2, tone: "success" },
  { key: "unassigned", label: "Unassigned", href: "/admin/unassigned", icon: Inbox, tone: "violet" },
];

const COLUMNS = ["Ticket", "Client", "Subject", "Category", "Priority", "Assigned To", "Status", "Created", "Due", "Last Updated"];

const QUEUE_STYLES: Record<Priority, { card: string; count: string; bar: string }> = {
  LOW: { card: "border-slate-200 bg-white", count: "text-slate-900", bar: "bg-slate-300" },
  MEDIUM: { card: "border-slate-200 bg-white", count: "text-slate-900", bar: "bg-blue-500" },
  HIGH: { card: "border-orange-200 bg-white", count: "text-orange-700", bar: "bg-orange-500" },
  CRITICAL: { card: "border-red-300 bg-red-50/60 ring-1 ring-red-200", count: "text-red-700", bar: "bg-red-600" },
};

/** CTO dashboard (spec §13): "What needs my attention right now?" */
export default function AdminDashboardPage() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => apiJson<DashboardData>("/api/admin/dashboard"),
    refetchInterval: 60_000,
  });

  return (
    <Page>
      <PageHeader title="CTO Dashboard" description="What needs your attention right now." />
      {isLoading && <LoadingState label="Loading dashboard..." />}
      {error && <ErrorText>{(error as Error).message}</ErrorText>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {METRICS.map((m) => (
              <StatCard
                key={m.key}
                label={m.label}
                value={data.metrics[m.key]}
                href={m.href}
                icon={m.icon}
                tone={m.tone}
                alert={m.key === "overdue" && data.metrics.overdue > 0}
              />
            ))}
          </div>

          <SectionTitle className="mt-10">Priority Queue</SectionTitle>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {data.priority_queue.map((p) => {
              const critical = p.priority === "CRITICAL" && p.count > 0;
              // Empty buckets stay calm; only a non-empty Critical bucket gets the alarm treatment.
              const s =
                p.priority === "CRITICAL" && !critical
                  ? { card: "border-slate-200 bg-white", count: "text-slate-900", bar: "bg-red-600" }
                  : QUEUE_STYLES[p.priority];
              return (
                <div key={p.priority} className={cn("relative overflow-hidden rounded-lg border p-4 shadow-sm", s.card)}>
                  <span className={cn("absolute inset-y-0 left-0 w-1", s.bar)} aria-hidden />
                  <div className="flex items-center justify-between gap-2 pl-1">
                    <PriorityBadge priority={p.priority} />
                    {critical && <Flame className="h-4 w-4 text-red-600" aria-hidden />}
                  </div>
                  <p className={cn("mt-3 pl-1 text-3xl font-semibold tabular tracking-tight", s.count)}>{p.count}</p>
                  <p className="pl-1 text-xs text-slate-500">
                    {statusLabel(p.priority)} ticket{p.count === 1 ? "" : "s"}
                  </p>
                </div>
              );
            })}
          </div>

          <SectionTitle
            className="mt-10"
            actions={
              <ButtonLink href="/admin/tickets" variant="ghost" size="sm">
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </ButtonLink>
            }
          >
            Recent Tickets
          </SectionTitle>
          <TableContainer>
            {data.recent_tickets.length === 0 ? (
              <EmptyState title="No tickets yet" description="New client tickets will appear here." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    {COLUMNS.map((h) => (
                      <TH key={h}>{h}</TH>
                    ))}
                  </tr>
                </THead>
                <TBody>
                  {data.recent_tickets.map((t) => (
                    <TR key={t.id} href={`/admin/tickets/${t.id}`}>
                      <TD>
                        <TicketNumberLink href={`/admin/tickets/${t.id}`}>{t.ticket_number}</TicketNumberLink>
                      </TD>
                      <TD className="text-slate-600">{t.organization_name}</TD>
                      <TD className="max-w-[280px] truncate font-medium text-slate-900">
                        <Link href={`/admin/tickets/${t.id}`} className="rounded hover:text-brand-700">
                          {t.subject}
                        </Link>
                      </TD>
                      <TD className="text-slate-600">{t.category_name ?? "-"}</TD>
                      <TD>
                        <PriorityBadge priority={t.priority} />
                      </TD>
                      <TD className={t.assigned_to_name ? "text-slate-700" : "italic text-slate-400"}>
                        {t.assigned_to_name ?? "Unassigned"}
                      </TD>
                      <TD>
                        <StatusBadge status={t.status} />
                      </TD>
                      <TD className="tabular text-slate-500">{formatDate(t.created_at)}</TD>
                      <TD>
                        <DueDate value={formatDate(t.due_at)} overdue={t.is_overdue} />
                      </TD>
                      <TD className="tabular text-slate-500">{formatDate(t.updated_at)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </TableContainer>
        </>
      )}
      <NotificationsPanel ticketBasePath="/admin/tickets" />
    </Page>
  );
}
