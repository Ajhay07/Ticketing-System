"use client";

import { Plus } from "lucide-react";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { StatusCounts } from "@/components/StatusCounts";
import { ButtonLink } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/Card";

/** Client dashboard (spec §17). */
export default function ClientDashboardPage() {
  return (
    <Page>
      <PageHeader
        title="My Tickets"
        description="Welcome to ClickfieldAI Support. Track the status of your requests here."
        actions={
          <>
            <ButtonLink href="/client/tickets">All my tickets</ButtonLink>
            <ButtonLink href="/client/tickets/new" variant="primary">
              <Plus className="h-4 w-4" />
              Create New Ticket
            </ButtonLink>
          </>
        }
      />
      <StatusCounts statuses={["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED"]} />
      <NotificationsPanel ticketBasePath="/client/tickets" />
    </Page>
  );
}
