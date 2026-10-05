"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { OverdueBadge, PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import type { DashboardData } from "@/lib/admin";
import { apiJson, formatDate } from "@/lib/tickets";

const METRICS: { key: keyof DashboardData["metrics"]; label: string; href: string }[] = [
  { key: "open", label: "Open", href: "/admin/tickets" },
  { key: "in_progress", label: "In Progress", href: "/admin/tickets" },
  { key: "waiting_for_client", label: "Waiting Client", href: "/admin/tickets" },
  { key: "overdue", label: "Overdue", href: "/admin/tickets" },
  { key: "resolved_today", label: "Resolved Today", href: "/admin/tickets" },
  { key: "unassigned", label: "Unassigned", href: "/admin/unassigned" },
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
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">CTO Dashboard</h1>
      {isLoading && <p className="mt-4 text-sm text-slate-500">Loading...</p>}
      {error && <p className="mt-4 text-sm text-red-600">{(error as Error).message}</p>}
      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {METRICS.map((m) => {
              const alert = m.key === "overdue" && data.metrics.overdue > 0;
              return (
                <Link key={m.key} href={m.href} className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs uppercase text-slate-500">{m.label}</p>
                  <p className={`mt-1 text-2xl font-semibold ${alert ? "text-red-600" : "text-slate-900"}`}>
                    {data.metrics[m.key]}
                  </p>
                </Link>
              );
            })}
          </div>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">Priority Queue</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.priority_queue.map((p) => (
              <div key={p.priority} className="rounded-lg border border-slate-200 bg-white p-4">
                <PriorityBadge priority={p.priority} />
                <p className="mt-2 text-sm text-slate-700">
                  {p.count} ticket{p.count === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">Recent Tickets</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {COLUMNS.map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent_tickets.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/admin/tickets/${t.id}`}>{t.ticket_number}</Link>
                    </td>
                    <td className="px-3 py-2">{t.organization_name}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/tickets/${t.id}`}>{t.subject}</Link>
                    </td>
                    <td className="px-3 py-2">{t.category_name ?? "-"}</td>
                    <td className="px-3 py-2">
                      <PriorityBadge priority={t.priority} />
                    </td>
                    <td className="px-3 py-2">{t.assigned_to_name ?? "Unassigned"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-3 py-2 text-slate-500">{formatDate(t.created_at)}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDate(t.due_at)} {t.is_overdue && <OverdueBadge />}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{formatDate(t.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.recent_tickets.length === 0 && <p className="p-4 text-sm text-slate-500">No tickets yet.</p>}
          </div>
        </>
      )}
      <NotificationsPanel ticketBasePath="/admin/tickets" />
    </main>
  );
}
