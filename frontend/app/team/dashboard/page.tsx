"use client";

import { ArrowRight } from "lucide-react";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { StatusCounts } from "@/components/StatusCounts";
import { ButtonLink } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/Card";

/** Team dashboard. Team members see only tickets assigned to them (decision #5). */
export default function TeamDashboardPage() {
  return (
    <Page>
      <PageHeader
        title="Team Dashboard"
        description="Your assigned work at a glance."
        actions={
          <ButtonLink href="/team/tickets" variant="primary">
            My Assigned Tickets
            <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        }
      />
      <StatusCounts statuses={["ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CLIENT", "REOPENED"]} />
      <NotificationsPanel ticketBasePath="/team/tickets" />
    </Page>
  );
}
