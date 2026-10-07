"use client";

import { useQueries } from "@tanstack/react-query";
import { CheckCircle2, CircleDot, Clock, Hourglass, RotateCcw, UserCheck } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { apiJson, statusLabel, ticketListPath, type TicketPage, type TicketStatus } from "@/lib/tickets";

const ICONS: Partial<Record<TicketStatus, { icon: React.ComponentType<{ className?: string }>; tone: "brand" | "warning" | "success" | "violet" | "neutral" | "danger" }>> = {
  OPEN: { icon: CircleDot, tone: "brand" },
  ASSIGNED: { icon: UserCheck, tone: "violet" },
  IN_PROGRESS: { icon: Clock, tone: "brand" },
  WAITING_FOR_CLIENT: { icon: Hourglass, tone: "warning" },
  RESOLVED: { icon: CheckCircle2, tone: "success" },
  REOPENED: { icon: RotateCcw, tone: "danger" },
};

/** Status counters (spec §17), using the list endpoint's server-side totals.
 * RLS scopes every count to what the caller may see. */
export function StatusCounts({ statuses }: { statuses: TicketStatus[] }) {
  const results = useQueries({
    queries: statuses.map((status) => ({
      queryKey: ["ticket-count", status],
      queryFn: () => apiJson<TicketPage>(ticketListPath({ page: 1, pageSize: 25, status })),
    })),
  });
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:gap-6">
      {statuses.map((status, i) => {
        const meta = ICONS[status];
        return (
          <StatCard
            key={status}
            label={statusLabel(status)}
            value={results[i]?.data?.total ?? "–"}
            icon={meta?.icon}
            tone={meta?.tone}
          />
        );
      })}
    </div>
  );
}
