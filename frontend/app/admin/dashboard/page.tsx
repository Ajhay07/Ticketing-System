"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, Clock, Hourglass, Inbox } from "lucide-react";
import { AdminHero, DashboardGreeting, PriorityQueue, TicketTrends } from "@/components/dashboard/Editorial";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { DueDate, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import { ButtonLink } from "@/components/ui/Button";
import { Page, SectionTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState, LoadingState } from "@/components/ui/States";
import { Table, TableContainer, TBody, TD, TH, THead, TicketNumberLink, TR } from "@/components/ui/Table";
import { ErrorText } from "@/components/ui/Form";
import type { DashboardData } from "@/lib/admin";
import { apiJson, formatDate } from "@/lib/tickets";

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
  { key: "overdue", label: "Overdue", href: "/admin/tickets", icon: AlertTriangle, tone: "danger" },
  { key: "resolved_today", label: "Resolved Today", href: "/admin/tickets", icon: CheckCircle2, tone: "success" },
  { key: "unassigned", label: "Unassigned", href: "/admin/unassigned", icon: Inbox, tone: "violet" },
];

const COLUMNS = ["Ticket", "Client", "Subject", "Category", "Priority", "Assigned To", "Status", "Created", "Due", "Last Updated"];

/** CTO dashboard (spec §13): "What needs my attention right now?" */
export default function AdminDashboardPage() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => apiJson<DashboardData>("/api/admin/dashboard"),
    refetchInterval: 60_000,
  });

  return (
    <Page>
      <DashboardGreeting
        section="ClickfieldAI Operations"
        description="CTO dashboard: what needs your attention right now across every client and queue."
      />
      <AdminHero />
      {isLoading && <LoadingState label="Loading dashboard..." />}
      {error && <ErrorText>{(error as Error).message}</ErrorText>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6 xl:gap-6">
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

          <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-12">
            <div className="md:col-span-2 xl:col-span-6">
              <TicketTrends />
            </div>
            <div className="xl:col-span-3">
              <PriorityQueue rows={data.priority_queue} href="/admin/tickets" />
            </div>
            <div className="xl:col-span-3">
              <NotificationsPanel ticketBasePath="/admin/tickets" title="Recent activity" className="mt-0 h-full" />
            </div>
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
                      <TD className="max-w-[320px] truncate font-semibold text-cf-ink">
                        <Link href={`/admin/tickets/${t.id}`} className="rounded-sm underline-offset-4 hover:underline">
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
    </Page>
  );
}
