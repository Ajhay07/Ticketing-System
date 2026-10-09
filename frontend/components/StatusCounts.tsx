"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDot, Clock, Hourglass, RotateCcw, UserCheck } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { apiJson, statusLabel, type TicketStatus } from "@/lib/tickets";

const ICONS: Partial<Record<TicketStatus, { icon: React.ComponentType<{ className?: string }>; tone: "brand" | "warning" | "success" | "violet" | "neutral" | "danger" }>> = {
  OPEN: { icon: CircleDot, tone: "brand" },
  ASSIGNED: { icon: UserCheck, tone: "violet" },
  IN_PROGRESS: { icon: Clock, tone: "brand" },
  WAITING_FOR_CLIENT: { icon: Hourglass, tone: "warning" },
  RESOLVED: { icon: CheckCircle2, tone: "success" },
  REOPENED: { icon: RotateCcw, tone: "danger" },
};

/** Status counters (spec §17) from ONE request (GET /api/tickets/counts)
 * instead of one list request per status. RLS scopes every count to what the
 * caller may see. Mutations that change status invalidate ["tickets"]. */
export function StatusCounts({ statuses }: { statuses: TicketStatus[] }) {
  const counts = useQuery({
    queryKey: ["tickets", "counts"],
    queryFn: () => apiJson<Record<TicketStatus, number>>("/api/tickets/counts"),
  });
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:gap-6">
      {statuses.map((status) => {
        const meta = ICONS[status];
        return (
          <StatCard
            key={status}
            label={statusLabel(status)}
            value={counts.data?.[status] ?? "–"}
            icon={meta?.icon}
            tone={meta?.tone}
          />
        );
      })}
    </div>
  );
}
