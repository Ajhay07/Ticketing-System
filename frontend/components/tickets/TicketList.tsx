"use client";

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PriorityBadge, StatusBadge } from "@/components/tickets/Badges";
import {
  apiJson,
  formatDate,
  PAGE_SIZES,
  PRIORITIES,
  STATUSES,
  statusLabel,
  ticketListPath,
  type TicketPage,
} from "@/lib/tickets";

type Props = {
  title: string;
  basePath: string;
  showCreate?: boolean;
  showOrganization?: boolean;
  emptyMessage?: string;
};

/** Ticket list. Which rows appear is decided entirely by the API + RLS. */
export function TicketList({ title, basePath, showCreate, showOrganization, emptyMessage }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");

  const path = ticketListPath({ page, pageSize, status, priority });
  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets", path],
    queryFn: () => apiJson<TicketPage>(path),
    placeholderData: keepPreviousData,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const selectClass = "rounded-md border border-slate-300 px-2 py-1.5 text-sm";

  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {showCreate && (
          <Link
            href={`${basePath}/new`}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Create New Ticket
          </Link>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <select
          aria-label="Status filter"
          className={selectClass}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select
          aria-label="Priority filter"
          className={selectClass}
          value={priority}
          onChange={(e) => {
            setPriority(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {statusLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {isLoading && <p className="p-6 text-sm text-slate-500">Loading tickets...</p>}
        {error && <p className="p-6 text-sm text-red-600">{(error as Error).message}</p>}
        {data && data.items.length === 0 && (
          <p className="p-6 text-sm text-slate-500">{emptyMessage ?? "No tickets found."}</p>
        )}
        {data && data.items.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Ticket</th>
                <th className="px-4 py-2 font-medium">Subject</th>
                {showOrganization && <th className="px-4 py-2 font-medium">Client</th>}
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">
                    <Link href={`${basePath}/${t.id}`}>{t.ticket_number}</Link>
                  </td>
                  <td className="px-4 py-2 text-slate-900">
                    <Link href={`${basePath}/${t.id}`}>{t.subject}</Link>
                  </td>
                  {showOrganization && <td className="px-4 py-2 text-slate-600">{t.organization_name}</td>}
                  <td className="px-4 py-2">
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-2 text-slate-500">{formatDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            {data.total} ticket{data.total === 1 ? "" : "s"}
          </span>
          <div className="flex items-center gap-3">
            <select
              aria-label="Tickets per page"
              className={selectClass}
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
