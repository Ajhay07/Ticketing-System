"use client";

import Link from "next/link";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { StatusCounts } from "@/components/StatusCounts";

/** Team dashboard. Team members see only tickets assigned to them (decision #5). */
export default function TeamDashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Team Dashboard</h1>
        <Link href="/team/tickets" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          My Assigned Tickets
        </Link>
      </div>
      <StatusCounts statuses={["ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "REOPENED"]} />
      <NotificationsPanel ticketBasePath="/team/tickets" />
    </main>
  );
}
