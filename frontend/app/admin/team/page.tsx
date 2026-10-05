"use client";

import { useQuery } from "@tanstack/react-query";
import type { WorkloadRow } from "@/lib/admin";
import { apiJson, statusLabel } from "@/lib/tickets";

const COLUMNS = ["Team Member", "Role", "Open", "In Progress", "Waiting Client", "Overdue", "Active Total"];

/** Team workload (spec §16): display name + counts only. */
export default function TeamWorkloadPage() {
  const { data, error } = useQuery({
    queryKey: ["workload"],
    queryFn: () => apiJson<WorkloadRow[]>("/api/admin/workload"),
  });
  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Team Workload</h1>
      {error && <p className="mt-4 text-sm text-red-600">{(error as Error).message}</p>}
      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
            {data?.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                <td className="px-3 py-2 text-slate-600">{statusLabel(r.role)}</td>
                <td className="px-3 py-2">{r.open}</td>
                <td className="px-3 py-2">{r.in_progress}</td>
                <td className="px-3 py-2">{r.waiting_for_client}</td>
                <td className={`px-3 py-2 ${r.overdue > 0 ? "font-semibold text-red-600" : ""}`}>{r.overdue}</td>
                <td className="px-3 py-2">{r.active_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
