"use client";

import Link from "next/link";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { StatusCounts } from "@/components/StatusCounts";

/** Client dashboard (spec §17). */
export default function ClientDashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">My Tickets</h1>
        <div className="flex gap-3">
          <Link href="/client/tickets/new" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
            + Create New Ticket
          </Link>
          <Link href="/client/tickets" className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800">
            All my tickets
          </Link>
        </div>
      </div>
      <StatusCounts statuses={["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED"]} />
      <NotificationsPanel ticketBasePath="/client/tickets" />
    </main>
  );
}
