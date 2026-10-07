"use client";

import { TicketList } from "@/components/tickets/TicketList";

export default function ClientTicketsPage() {
  return (
    <TicketList
      title="My Tickets"
      basePath="/client/tickets"
      showCreate
      emptyMessage="You have not created any tickets yet. Create one and the ClickfieldAI team will help."
    />
  );
}
