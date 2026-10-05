"use client";

import { TicketList } from "@/components/tickets/TicketList";

/** The API/RLS only returns tickets assigned to the caller (decision #5). */
export default function TeamTicketsPage() {
  return (
    <TicketList
      title="My Assigned Tickets"
      basePath="/team/tickets"
      showOrganization
      emptyMessage="No tickets are assigned to you."
    />
  );
}
