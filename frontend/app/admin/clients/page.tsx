"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientOrg } from "@/lib/admin";
import { apiJson } from "@/lib/tickets";

const COLUMNS = ["Client", "Status", "Active Users", "Open", "In Progress", "Overdue", "Resolved This Month", "Total"];

/** Client organizations (spec §18, §38). Admin-only; enforced by the API. */
export default function ClientsPage() {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => apiJson<ClientOrg[]>("/api/admin/clients") });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => apiJson<ClientOrg>("/api/admin/clients", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="text-2xl font-semibold text-slate-900">Clients</h1>
      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <input
          aria-label="New client name"
          placeholder="New client organization name"
          className="w-80 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add client
        </button>
      </form>
      {create.error && <p className="mt-2 text-sm text-red-600">{(create.error as Error).message}</p>}
      {clients.error && <p className="mt-4 text-sm text-red-600">{(clients.error as Error).message}</p>}

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
            {clients.data?.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-900">
                  <Link href={`/admin/clients/${c.id}`}>{c.name}</Link>
                </td>
                <td className="px-3 py-2 text-slate-600">{c.status}</td>
                <td className="px-3 py-2">{c.active_users}</td>
                <td className="px-3 py-2">{c.open}</td>
                <td className="px-3 py-2">{c.in_progress}</td>
                <td className={`px-3 py-2 ${c.overdue > 0 ? "font-semibold text-red-600" : ""}`}>{c.overdue}</td>
                <td className="px-3 py-2">{c.resolved_this_month}</td>
                <td className="px-3 py-2">{c.total_tickets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
