"use client";

import { TicketList } from "@/components/tickets/TicketList";

export default function AdminTicketsPage() {
  return <TicketList title="All Tickets" basePath="/admin/tickets" showOrganization adminFilters />;
}
