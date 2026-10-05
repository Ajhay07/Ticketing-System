"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatMinutes, type ReportsData } from "@/lib/admin";
import { apiJson } from "@/lib/tickets";

/** Basic V1 reports (spec §37): plain tables, no charts (spec §34 "avoid unnecessary charts"). */
export default function ReportsPage() {
  const [days, setDays] = useState(30);
  const { data, error } = useQuery({
    queryKey: ["reports", days],
    queryFn: () => apiJson<ReportsData>(`/api/admin/reports?days=${days}`),
  });
  const card = "rounded-lg border border-slate-200 bg-white p-4";
  const th = "px-3 py-2 font-medium";
  const td = "px-3 py-2";

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <select
          aria-label="Report window"
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{(error as Error).message}</p>}
      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Avg response", formatMinutes(data.resolution.avg_response_minutes)],
              ["Avg resolution", formatMinutes(data.resolution.avg_resolution_minutes)],
              ["Tickets resolved", String(data.resolution.tickets_resolved)],
              ["Tickets reopened", String(data.resolution.tickets_reopened)],
            ].map(([label, value]) => (
              <div key={label} className={card}>
                <p className="text-xs uppercase text-slate-500">{label}</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">Ticket volume</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(["day", "week", "month"] as const).map((unit) => (
              <div key={unit} className={card}>
                <p className="text-xs uppercase text-slate-500">Per {unit}</p>
                <ul className="mt-2 max-h-56 overflow-y-auto text-sm">
                  {data.volume[unit].map((v) => (
                    <li key={v.period} className="flex justify-between">
                      <span className="text-slate-600">{new Date(v.period).toLocaleDateString()}</span>
                      <span className="font-medium">{v.tickets}</span>
                    </li>
                  ))}
                  {data.volume[unit].length === 0 && <li className="text-slate-500">No tickets</li>}
                </ul>
              </div>
            ))}
          </div>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">By client</h2>
          <table className="mt-3 w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className={th}>Client</th>
                <th className={th}>Tickets</th>
                <th className={th}>Open</th>
                <th className={th}>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {data.by_client.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className={td}>{c.name}</td>
                  <td className={td}>{c.total_tickets}</td>
                  <td className={td}>{c.open_tickets}</td>
                  <td className={td}>{c.overdue_tickets}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-8 text-lg font-semibold text-slate-900">By team member</h2>
          <table className="mt-3 w-full rounded-lg border border-slate-200 bg-white text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className={th}>Team member</th>
                <th className={th}>Assigned</th>
                <th className={th}>Resolved</th>
                <th className={th}>Open workload</th>
                <th className={th}>Avg resolution</th>
              </tr>
            </thead>
            <tbody>
              {data.by_team.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className={td}>{t.name}</td>
                  <td className={td}>{t.tickets_assigned}</td>
                  <td className={td}>{t.tickets_resolved}</td>
                  <td className={td}>{t.open_workload}</td>
                  <td className={td}>{formatMinutes(t.avg_resolution_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
