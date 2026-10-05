"use client";

import { useQueries } from "@tanstack/react-query";
import { apiJson, statusLabel, ticketListPath, type TicketPage, type TicketStatus } from "@/lib/tickets";

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
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {statuses.map((status, i) => (
        <div key={status} className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">{statusLabel(status)}</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{results[i]?.data?.total ?? "-"}</p>
        </div>
      ))}
    </div>
  );
}
